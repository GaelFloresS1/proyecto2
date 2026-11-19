import pool from '../config/database.js'
import { addDays, attendanceState, closeCalculation, entryContext, withLateness } from '../services/attendanceCalculation.js'

const defaultTolerance = 10 // Valor predeterminado de config_nomina y del prototipo.

const attendanceSelect = `
  SELECT a.id_asistencia, a.fecha, a.fecha_hora_entrada, a.fecha_hora_salida,
         a.retardo, a.horas_normales, a.horas_extra, a.horas_festiva,
         CAST(a.fecha AS CHAR) AS fecha_local,
         CAST(a.fecha_hora_entrada AS CHAR) AS entrada_local,
         CAST(a.fecha_hora_salida AS CHAR) AS salida_local,
         (SELECT b.valor_nuevo FROM bitacora b
           WHERE b.id_usuario = a.id_empleado AND b.entidad = 'asistencia'
             AND b.id_registro_afectado = a.id_asistencia AND b.accion = 'ALTA'
             AND b.campo = 'contexto_jornada'
           ORDER BY b.id_bitacora DESC LIMIT 1) AS entry_audit,
         (SELECT b.valor_nuevo FROM bitacora b
           WHERE b.id_usuario = a.id_empleado AND b.entidad = 'asistencia'
             AND b.id_registro_afectado = a.id_asistencia AND b.accion = 'CAMBIO'
             AND b.campo = 'calculo_jornada'
           ORDER BY b.id_bitacora DESC LIMIT 1) AS result_audit
    FROM asistencia a`

function readAudit(value) {
  try {
    const data = JSON.parse(value)
    return data?.version === 1 ? data : null
  } catch {
    return null
  }
}

function decodeAttendance({ entry_audit, result_audit, ...row }) {
  return { ...row, entry: readAudit(entry_audit), result: readAudit(result_audit) }
}

function decimalHours(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value))) return null
  const hours = Number(value)
  return Number.isFinite(hours) && hours >= 0 ? hours : null
}

function calculationStatus(state, entry, result, hours) {
  if (state === 'incompleto') return 'incompleto'
  if (state === 'abierto') return entry?.status ?? 'sin_contexto'
  if (result?.status && result.status !== 'calculado') return result.status
  if (hours.includes(null)) return result ? 'horas_pendientes' : 'historico_sin_calculo'
  if (result?.status === 'calculado') return 'calculado'
  return hours.some(hoursInCategory => hoursInCategory > 0) ? 'historico' : 'historico_sin_calculo'
}

export function publicAttendance({ entry, result, ...row }, clock) {
  const estado = attendanceState({ ...row, entry, result }, clock)
  const hours = {
    horas_normales: decimalHours(row.horas_normales),
    horas_extra: decimalHours(row.horas_extra),
    horas_festiva: decimalHours(row.horas_festiva),
  }
  return {
    ...row,
    ...hours,
    estado,
    estado_calculo: calculationStatus(estado, entry, result, Object.values(hours)),
    minutos_retardo: entry?.lateMinutes ?? null,
    minutos_tolerancia: entry?.tolerance ?? null,
  }
}

async function databaseClock(connection) {
  const [[clock]] = await connection.query('SELECT CAST(NOW() AS CHAR) AS local, UNIX_TIMESTAMP() AS epoch')
  return { local: clock.local, epoch: Number(clock.epoch) }
}

async function recentAttendance(connection, employeeId, clock) {
  const date = clock.local.slice(0, 10)
  const [rows] = await connection.execute(
    `${attendanceSelect}
      WHERE a.id_empleado = ? AND a.fecha BETWEEN ? AND ?
      ORDER BY a.fecha DESC`,
    [employeeId, addDays(date, -1), date],
  )
  return rows.map(decodeAttendance)
}

export async function today(req, res, next) {
  try {
    const clock = await databaseClock(pool)
    const rows = await recentAttendance(pool, req.session.employee.id, clock)
    const date = clock.local.slice(0, 10)
    const record = rows.find(row => attendanceState(row, clock) === 'abierto') ??
      rows.find(row => row.fecha_local === date || row.salida_local?.startsWith(date))
    res.json({ ok: true, attendance: record ? publicAttendance(record, clock) : null })
  } catch (error) {
    next(error)
  }
}

export async function history(req, res, next) {
  try {
    const clock = await databaseClock(pool)
    const [rows] = await pool.execute(
      `${attendanceSelect} WHERE a.id_empleado = ? ORDER BY a.fecha DESC LIMIT 30`,
      [req.session.employee.id],
    )
    res.json({ ok: true, attendances: rows.map(row => publicAttendance(decodeAttendance(row), clock)) })
  } catch (error) {
    next(error)
  }
}

class AttendanceError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function recordAttendance(status, changeAttendance) {
  return async (req, res, next) => {
    let connection
    try {
      connection = await pool.getConnection()
      await connection.beginTransaction()
      const employeeId = req.session.employee.id
      // Serializa entrada y salida incluso cuando todavía no hay una fila diaria.
      const [[employee]] = await connection.execute(
        'SELECT id_turno, activo, bloqueado FROM empleado WHERE id_empleado = ? FOR UPDATE',
        [employeeId],
      )
      if (!employee?.activo || employee.bloqueado) throw new AttendanceError(401, 'Debes iniciar sesión.')

      const clock = await databaseClock(connection)
      const rows = await recentAttendance(connection, employeeId, clock)
      const { id, message } = await changeAttendance({ connection, employeeId, employee, clock, rows })
      const [[row]] = await connection.execute(`${attendanceSelect} WHERE a.id_asistencia = ?`, [id])
      const attendance = publicAttendance(decodeAttendance(row), clock)
      await connection.commit()
      res.status(status).json({ ok: true, attendance, message })
    } catch (error) {
      if (connection) await connection.rollback()
      if (error instanceof AttendanceError) {
        return res.status(error.status).json({ ok: false, message: error.message })
      }
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Ya existe un registro para esa jornada.' })
      }
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ ok: false, message: 'Otro marcaje está en curso. Comprueba el historial e intenta de nuevo.' })
      }
      next(error)
    } finally {
      connection?.release()
    }
  }
}

async function logAttendance(connection, employeeId, id, clock, action, field, data) {
  await connection.execute(
    `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo, valor_nuevo, id_usuario)
     VALUES (?, ?, 'asistencia', ?, ?, ?, ?)`,
    [clock.local, action, id, field, JSON.stringify({ ...data, version: 1 }), employeeId],
  )
}

export const clockIn = recordAttendance(201, async ({ connection, employeeId, employee, clock, rows }) => {
  if (rows.some(row => attendanceState(row, clock) === 'abierto')) {
    throw new AttendanceError(409, 'Ya tienes una entrada pendiente de salida.')
  }

  let shift
  if (employee.id_turno !== null) {
    [[shift]] = await connection.execute(
      `SELECT id_turno, hora_inicio, hora_fin, minutos_descanso, dias_laborales, activo
         FROM turno WHERE id_turno = ? LOCK IN SHARE MODE`,
      [employee.id_turno],
    )
  }
  let context = entryContext(clock, shift)
  if (rows.some(row => row.fecha_local === context.date)) {
    throw new AttendanceError(409, 'Ya registraste tu entrada para esa jornada.')
  }

  if (context.startsAt) {
    const [[config]] = await connection.execute(
      `SELECT minutos_tolerancia FROM config_nomina
        WHERE fecha_vigencia <= ?
        ORDER BY fecha_vigencia DESC, id_config DESC LIMIT 1`,
      [context.date],
    )
    const tolerance = config?.minutos_tolerancia ?? defaultTolerance
    if (Number.isInteger(tolerance) && tolerance >= 0) context = withLateness(context, clock, tolerance)
  }

  const [result] = await connection.execute(
    `INSERT INTO asistencia (fecha, fecha_hora_entrada, id_empleado, id_registro_entrada, retardo)
     VALUES (?, ?, ?, ?, ?)`,
    [context.date, clock.local, employeeId, employeeId, context.lateMinutes > 0 ? 1 : 0],
  )
  await logAttendance(connection, employeeId, result.insertId, clock, 'ALTA', 'contexto_jornada', context)
  return { id: result.insertId, message: 'Entrada registrada correctamente.' }
})

export const clockOut = recordAttendance(200, async ({ connection, employeeId, clock, rows }) => {
  const open = rows.filter(row => attendanceState(row, clock) === 'abierto')
  if (open.length !== 1) {
    const message = open.length
      ? 'Hay varias entradas pendientes. Solicita la revisión del historial.'
      : 'No hay una entrada pendiente de salida para esta jornada.'
    throw new AttendanceError(409, message)
  }
  const [row] = open
  const elapsed = row.entry ? clock.epoch - row.entry.enteredAt : null
  if (elapsed !== null ? elapsed <= 0 : clock.local <= row.entrada_local) {
    throw new AttendanceError(409, 'La salida debe ser posterior a la entrada. Intenta de nuevo.')
  }

  let hasHoliday = false
  if (row.entry?.status === 'pendiente') {
    const entryDate = row.entrada_local.slice(0, 10)
    const exitDate = clock.local.slice(0, 10)
    const lastDateWorked = exitDate > entryDate && clock.local.endsWith(' 00:00:00') ? addDays(exitDate, -1) : exitDate
    const [[holiday]] = await connection.execute('SELECT 1 FROM festivo WHERE fecha BETWEEN ? AND ? LIMIT 1', [entryDate, lastDateWorked])
    hasHoliday = Boolean(holiday)
  }

  const result = closeCalculation(row.entry, clock, hasHoliday)
  const [update] = await connection.execute(
    `UPDATE asistencia
        SET fecha_hora_salida = ?, id_registro_salida = ?,
            horas_normales = COALESCE(?, horas_normales),
            horas_extra = COALESCE(?, horas_extra),
            horas_festiva = COALESCE(?, horas_festiva)
      WHERE id_asistencia = ? AND fecha_hora_salida IS NULL`,
    [clock.local, employeeId, result.normal ?? null, result.extra ?? null, result.holiday ?? null, row.id_asistencia],
  )
  if (update.affectedRows !== 1) throw new AttendanceError(409, 'La salida de esta jornada ya está registrada.')

  await logAttendance(connection, employeeId, row.id_asistencia, clock, 'CAMBIO', 'calculo_jornada', {
    status: result.status,
    elapsedSeconds: elapsed ?? undefined,
    workedSeconds: result.workedSeconds,
  })
  return {
    id: row.id_asistencia,
    message: closureMessage(result.status),
  }
})

function closureMessage(status) {
  if (status === 'calculado') return 'Salida registrada y horas guardadas.'
  if (status === 'descanso_pendiente') return 'Salida registrada. Las horas quedan pendientes de confirmar el descanso tomado.'
  return 'Salida registrada. Las horas quedan pendientes de clasificación.'
}
