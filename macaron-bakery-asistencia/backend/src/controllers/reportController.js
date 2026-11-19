import pool from '../config/database.js'
import { normalizeRole } from '../middleware/requireAuth.js'
import { validDate } from '../services/calendarDate.js'
import { databaseClock, readAttendancePeriod } from './attendanceController.js'

const reportType = 'ASISTENCIA_PUNTUALIDAD'
const pageSize = 15
const maxId = 2147483647
const reportSelect = `
  SELECT r.id_reporte AS id, CAST(r.periodo_inicio AS CHAR) AS periodStart,
         CAST(r.periodo_fin AS CHAR) AS periodEnd,
         DATE_FORMAT(r.fecha_generacion, '%Y-%m-%dT%H:%i:%s') AS generatedAt,
         r.id_generado_por AS generatedById, e.nombre_completo AS generatedBy
    FROM reporte r JOIN empleado e ON e.id_empleado = r.id_generado_por
   WHERE r.tipo = ?`

function validId(value) {
  return Number.isInteger(value) && value > 0 && value <= maxId
}

function readId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && validId(Number(value))
    ? Number(value)
    : null
}

async function summarizePeriod(db, clock, { from, to, employeeId }) {
  const [employees] = await db.execute(
    `SELECT e.id_empleado AS id, r.nombre AS role
       FROM empleado e JOIN rol r ON r.id_rol = e.id_rol
       ${employeeId === undefined ? '' : 'WHERE e.id_empleado = ?'}
       ORDER BY e.id_empleado`,
    employeeId === undefined ? [] : [employeeId],
  )
  const details = new Map(employees.filter(employee => normalizeRole(employee.role) !== 'administrador')
    .map(employee => [employee.id, {
      employeeId: employee.id,
      attendances: 0, late: 0, authorizedAbsences: 0, unauthorizedAbsences: 0, authorizedExits: 0,
      normal: 0, extra: 0, holiday: 0, pendingHours: 0, pendingAbsences: 0,
    }]))
  if (!details.size) return details

  const marks = await readAttendancePeriod(db, clock, { from, to, employeeId })
  for (const mark of marks) {
    const detail = details.get(mark.id_empleado)
    if (!detail) continue
    if (validDate(mark.entrada_local?.slice(0, 10))) {
      detail.attendances++
      if (mark.retardo === 1) detail.late++
    }
    if (mark.estado === 'cerrado' && ['calculado', 'historico'].includes(mark.estado_calculo)) {
      detail.normal += Math.round(mark.horas_normales * 100)
      detail.extra += Math.round(mark.horas_extra * 100)
      detail.holiday += Math.round(mark.horas_festiva * 100)
    } else {
      detail.pendingHours++
    }
  }

  const [absences] = await db.execute(
    `SELECT f.id_empleado, f.autorizada, f.id_validada_por, f.id_solicitud, a.id_asistencia,
            s.tipo AS requestType, s.estado AS requestStatus
       FROM falta f
       LEFT JOIN asistencia a ON a.id_empleado = f.id_empleado AND a.fecha = f.fecha
       LEFT JOIN solicitud_permiso s ON s.id_solicitud = f.id_solicitud
         AND s.id_solicitante = f.id_empleado AND s.fecha_permiso = f.fecha
      WHERE f.fecha BETWEEN ? AND ?${employeeId === undefined ? '' : ' AND f.id_empleado = ?'}`,
    employeeId === undefined ? [from, to] : [from, to, employeeId],
  )
  for (const absence of absences) {
    const detail = details.get(absence.id_empleado)
    if (!detail) continue
    const authorized = absence.autorizada === 1
    const validated = absence.id_validada_por !== null && (authorized || absence.autorizada === 0)
    const resolved = absence.id_solicitud === null || (
      absence.requestType === 'FALTA' &&
      absence.requestStatus === (authorized ? 'AUTORIZADA' : 'RECHAZADA')
    )
    if (!validated || !resolved || absence.id_asistencia !== null) detail.pendingAbsences++
    else if (authorized) detail.authorizedAbsences++
    else detail.unauthorizedAbsences++
  }

  const [exits] = await db.execute(
    `SELECT id_solicitante AS employeeId, COUNT(*) AS total
       FROM solicitud_permiso
      WHERE fecha_permiso BETWEEN ? AND ? AND tipo = 'PERMISO_SALIDA' AND estado = 'AUTORIZADA'
        ${employeeId === undefined ? '' : 'AND id_solicitante = ?'}
      GROUP BY id_solicitante`,
    employeeId === undefined ? [from, to] : [from, to, employeeId],
  )
  for (const exit of exits) {
    const detail = details.get(exit.employeeId)
    if (detail) detail.authorizedExits = exit.total
  }

  return details
}

export async function createAttendanceReport(req, res, next) {
  const body = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['from', 'to', 'employeeId'].includes(key))) {
    return res.status(400).json({ ok: false, message: 'Envía únicamente el período y, si aplica, el empleado.' })
  }
  const { from, to, employeeId } = body
  if (!validDate(from) || !validDate(to) || from > to || (employeeId !== undefined && !validId(employeeId))) {
    return res.status(400).json({ ok: false, message: 'Selecciona un período y un empleado válidos.' })
  }

  let db
  try {
    db = await pool.getConnection()
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await db.beginTransaction()
    const clock = await databaseClock(db)
    const actorId = req.session.employee.id
    const details = await summarizePeriod(db, clock, body)
    if (!details.size) {
      await db.rollback()
      return res.status(404).json({ ok: false, message: 'No se encontraron empleados para el reporte.' })
    }

    const [report] = await db.execute(
      `INSERT INTO reporte (tipo, periodo_inicio, periodo_fin, fecha_generacion, id_generado_por)
       VALUES (?, ?, ?, ?, ?)`,
      [reportType, from, to, clock.local, actorId],
    )
    for (const detail of details.values()) {
      const [saved] = await db.execute(
        `INSERT INTO detalle_reporte (
           id_reporte, id_empleado, asistencias, retardos, faltas_autorizadas, faltas_no_autorizadas,
           salidas_autorizadas, horas_normal, horas_extra, horas_festiva, importe_estimado
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00)`,
        [report.insertId, detail.employeeId, detail.attendances, detail.late,
          detail.authorizedAbsences, detail.unauthorizedAbsences, detail.authorizedExits,
          detail.normal / 100, detail.extra / 100, detail.holiday / 100],
      )
      // El detalle no tiene columnas para conservar cuántos registros quedaron sin clasificar.
      await db.execute(
        `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo, valor_nuevo, id_usuario)
         VALUES (?, 'ALTA', 'detalle_reporte', ?, 'clasificacion', ?, ?)`,
        [clock.local, saved.insertId, JSON.stringify({
          pendingHours: detail.pendingHours, pendingAbsences: detail.pendingAbsences,
        }), actorId],
      )
    }
    await db.commit()
    res.status(201).json({ ok: true, reportId: report.insertId })
  } catch (error) {
    if (db) await db.rollback()
    next(error)
  } finally {
    db?.release()
  }
}

export async function listAttendanceReports(req, res, next) {
  try {
    const page = readId(req.query.page ?? '1')
    if (!page) return res.status(400).json({ ok: false, message: 'La página solicitada no es válida.' })
    const [reports] = await pool.execute(
      `${reportSelect} ORDER BY r.fecha_generacion DESC, r.id_reporte DESC LIMIT ? OFFSET ?`,
      [reportType, pageSize + 1, (page - 1) * pageSize],
    )
    res.set('Cache-Control', 'no-store')
    res.json({ ok: true, reports: reports.slice(0, pageSize), page, hasNext: reports.length > pageSize })
  } catch (error) {
    next(error)
  }
}

export async function getAttendanceReport(req, res, next) {
  try {
    const id = readId(req.params.id)
    if (!id) return res.status(400).json({ ok: false, message: 'El ID del reporte no es válido.' })
    const [[report]] = await pool.execute(`${reportSelect} AND r.id_reporte = ?`, [reportType, id])
    if (!report) return res.status(404).json({ ok: false, message: 'No se encontró el reporte de asistencia.' })
    const [rows] = await pool.execute(
      `SELECT d.id_empleado AS employeeId, e.nombre_completo AS employeeName,
              d.asistencias AS attendances, d.retardos AS late, d.faltas_autorizadas AS authorizedAbsences,
              d.faltas_no_autorizadas AS unauthorizedAbsences, d.salidas_autorizadas AS authorizedExits,
              d.horas_normal AS normal, d.horas_extra AS extra, d.horas_festiva AS holiday,
              (SELECT CASE WHEN JSON_VALID(b.valor_nuevo) THEN b.valor_nuevo END FROM bitacora b
                WHERE b.id_usuario = ? AND b.entidad = 'detalle_reporte' AND b.accion = 'ALTA'
                  AND b.id_registro_afectado = d.id_detalle AND b.campo = 'clasificacion'
                ORDER BY b.id_bitacora LIMIT 1) AS classification
         FROM detalle_reporte d JOIN empleado e ON e.id_empleado = d.id_empleado
        WHERE d.id_reporte = ?
        ORDER BY d.id_empleado`,
      [report.generatedById, id],
    )
    const details = rows.map(({ classification, ...detail }) => {
      const { pendingHours, pendingAbsences } = JSON.parse(classification) ?? {}
      return { ...detail, pendingHours: pendingHours ?? null, pendingAbsences: pendingAbsences ?? null }
    })
    res.set('Cache-Control', 'no-store')
    res.json({ ok: true, report: { ...report, details } })
  } catch (error) {
    next(error)
  }
}
