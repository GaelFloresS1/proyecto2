import pool from '../config/database.js'
import { hasPermission } from '../middleware/requirePermission.js'
import { validDate } from '../services/calendarDate.js'

export const requestCreationPermission = 'SOLICITUD_CREAR'
const requestTypes = new Map([['permiso', 'PERMISO_SALIDA'], ['falta', 'FALTA']])
const requestSelect = `
  SELECT s.id_solicitud AS id, IF(s.tipo = 'FALTA', 'falta', 'permiso') AS type,
         CAST(s.fecha_permiso AS CHAR) AS date, TIME_FORMAT(s.hora_salida, '%H:%i') AS exitTime,
         NULL AS attendanceId, s.motivo AS reason,
         CASE s.estado WHEN 'AUTORIZADA' THEN 'aprobada' WHEN 'RECHAZADA' THEN 'rechazada' ELSE 'pendiente' END AS status,
         DATE_FORMAT(s.fecha_solicitud, '%Y-%m-%dT%H:%i:%s') AS createdAt,
         DATE_FORMAT(s.fecha_resolucion, '%Y-%m-%dT%H:%i:%s') AS resolvedAt
    FROM solicitud_permiso s`
const justificationSelect = `
  SELECT j.id_justificante AS id, 'justificacion' AS type, CAST(a.fecha AS CHAR) AS date,
         NULL AS exitTime, j.id_asistencia AS attendanceId, j.motivo AS reason,
         CASE j.estado WHEN 'ACEPTADO' THEN 'aprobada' WHEN 'RECHAZADO' THEN 'rechazada' ELSE 'pendiente' END AS status,
         DATE_FORMAT(j.fecha_creacion, '%Y-%m-%dT%H:%i:%s') AS createdAt,
         DATE_FORMAT(j.fecha_resolucion, '%Y-%m-%dT%H:%i:%s') AS resolvedAt
    FROM justificante j
    JOIN asistencia a ON a.id_asistencia = j.id_asistencia`

export async function listOwnRequests(req, res, next) {
  try {
    const employeeId = req.session.employee.id
    const canCreate = await hasPermission(employeeId, requestCreationPermission)
    const [requests] = await pool.execute(
      `${requestSelect} WHERE s.id_solicitante = ?
       UNION ALL
       ${justificationSelect} WHERE a.id_empleado = ?
       ORDER BY createdAt DESC, type, id DESC`,
      [employeeId, employeeId],
    )
    let lateAttendances = []
    if (canCreate) {
      [lateAttendances] = await pool.execute(
        `SELECT a.id_asistencia AS id, CAST(a.fecha AS CHAR) AS date,
                DATE_FORMAT(a.fecha_hora_entrada, '%Y-%m-%dT%H:%i:%s') AS entryAt
           FROM asistencia a
          WHERE a.id_empleado = ? AND a.retardo = 1
            AND NOT EXISTS (SELECT 1 FROM justificante j WHERE j.id_asistencia = a.id_asistencia)
          ORDER BY a.fecha DESC`,
        [employeeId],
      )
    }
    res.json({ ok: true, requests, lateAttendances, canCreate })
  } catch (error) {
    next(error)
  }
}

class RequestError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function readReason(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(field => !fields.includes(field))) {
    throw new RequestError(400, 'Envía únicamente los datos de la solicitud.')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason || [...reason].length > 255) {
    throw new RequestError(400, 'Escribe un motivo de entre 1 y 255 caracteres.')
  }
  return reason
}

function readRequest(body) {
  const reason = readReason(body, ['type', 'date', 'exitTime', 'reason'])
  const type = requestTypes.get(body.type)
  if (!type) throw new RequestError(400, 'Selecciona permiso de salida o falta.')
  if (!validDate(body.date)) throw new RequestError(400, 'Selecciona una fecha válida.')
  const exitTime = body.exitTime ?? ''
  if (exitTime !== '' && (type !== 'PERMISO_SALIDA' || typeof exitTime !== 'string' ||
      !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(exitTime) || exitTime !== exitTime.trim())) {
    throw new RequestError(400, 'La hora de salida solo corresponde a permisos y debe tener un formato válido.')
  }
  return { type, date: body.date, exitTime: exitTime || null, reason }
}

function readJustification(body) {
  const reason = readReason(body, ['attendanceId', 'reason'])
  const { attendanceId } = body
  if (!Number.isInteger(attendanceId) || attendanceId < 1 || attendanceId > 2147483647) {
    throw new RequestError(400, 'Selecciona una asistencia válida para justificar.')
  }
  return { attendanceId, reason }
}

async function logCreation(connection, employeeId, entity, request) {
  await connection.execute(
    `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado,
                          campo, valor_nuevo, motivo, id_usuario)
     VALUES (NOW(), 'ALTA', ?, ?, 'solicitud', ?, ?, ?)`,
    [
      entity,
      request.id,
      JSON.stringify({
        tipo: request.type,
        fecha: request.date,
        horaSalida: request.exitTime,
        idAsistencia: request.attendanceId,
        estado: request.status,
      }),
      request.reason,
      employeeId,
    ],
  )
}

function createOwnRecord(validate, insert, entity, message) {
  return async (req, res, next) => {
    let connection
    let transaction = false
    try {
      const input = validate(req.body)
      const employeeId = req.session.employee.id
      connection = await pool.getConnection()
      await connection.beginTransaction()
      transaction = true
      // Serializa solicitudes del mismo empleado, incluso antes de que exista una fila.
      await connection.execute('SELECT id_empleado FROM empleado WHERE id_empleado = ? FOR UPDATE', [employeeId])
      if (!(await hasPermission(employeeId, requestCreationPermission, connection))) {
        throw new RequestError(403, 'No tienes permiso para presentar solicitudes.')
      }

      const request = await insert(connection, employeeId, input)
      await logCreation(connection, employeeId, entity, request)
      await connection.commit()
      transaction = false
      res.status(201).json({ ok: true, request, message })
    } catch (error) {
      if (transaction) await connection.rollback()
      if (error instanceof RequestError) return res.status(error.status).json({ ok: false, message: error.message })
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Esta asistencia ya tiene un justificante.' })
      }
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ ok: false, message: 'Otra operación está en curso. Consulta tus solicitudes e intenta de nuevo.' })
      }
      next(error)
    } finally {
      connection?.release()
    }
  }
}

async function insertRequest(connection, employeeId, { type, date, exitTime, reason }) {
  const [[duplicate]] = await connection.execute(
    `SELECT id_solicitud FROM solicitud_permiso
      WHERE id_solicitante = ? AND tipo = ? AND fecha_permiso = ?
        AND estado IN ('PENDIENTE', 'AUTORIZADA') LIMIT 1`,
    [employeeId, type, date],
  )
  if (duplicate) throw new RequestError(409, 'Ya tienes una solicitud pendiente o aprobada de ese tipo para esa fecha.')

  const [result] = await connection.execute(
    `INSERT INTO solicitud_permiso (tipo, fecha_solicitud, fecha_permiso, hora_salida, motivo, id_solicitante)
     VALUES (?, NOW(), ?, ?, ?, ?)`,
    [type, date, exitTime, reason, employeeId],
  )
  const [[request]] = await connection.execute(`${requestSelect} WHERE s.id_solicitud = ?`, [result.insertId])
  return request
}

async function insertJustification(connection, employeeId, { attendanceId, reason }) {
  const [[attendance]] = await connection.execute(
    'SELECT retardo FROM asistencia WHERE id_asistencia = ? AND id_empleado = ? FOR UPDATE',
    [attendanceId, employeeId],
  )
  if (!attendance) throw new RequestError(404, 'No se encontró esa asistencia en tu historial.')
  if (attendance.retardo !== 1) throw new RequestError(400, 'La asistencia seleccionada no tiene un retardo registrado.')
  const [result] = await connection.execute(
    'INSERT INTO justificante (fecha_creacion, motivo, id_asistencia) VALUES (NOW(), ?, ?)',
    [reason, attendanceId],
  )
  const [[request]] = await connection.execute(`${justificationSelect} WHERE j.id_justificante = ?`, [result.insertId])
  return request
}

export const submitRequest = createOwnRecord(readRequest, insertRequest, 'solicitud_permiso', 'Solicitud enviada para revisión.')
export const submitJustification = createOwnRecord(readJustification, insertJustification, 'justificante', 'Justificación enviada para revisión.')
