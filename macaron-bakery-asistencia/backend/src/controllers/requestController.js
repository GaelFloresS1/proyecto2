import pool from '../config/database.js'
import { hasPermission } from '../middleware/requirePermission.js'
import { validDate } from '../services/calendarDate.js'

export const requestCreationPermission = 'SOLICITUD_CREAR'
export const requestReviewPermission = 'SOLICITUD_AUTORIZAR'
const requestTypes = new Map([['permiso', 'PERMISO_SALIDA'], ['falta', 'FALTA']])
const requestFields = `
  SELECT s.id_solicitud AS id, IF(s.tipo = 'FALTA', 'falta', 'permiso') AS type,
         CAST(s.fecha_permiso AS CHAR) AS date, TIME_FORMAT(s.hora_salida, '%H:%i') AS exitTime,
         NULL AS attendanceId, s.motivo AS reason,
         CASE s.estado WHEN 'AUTORIZADA' THEN 'aprobada' WHEN 'RECHAZADA' THEN 'rechazada' ELSE 'pendiente' END AS status,
         DATE_FORMAT(s.fecha_solicitud, '%Y-%m-%dT%H:%i:%s') AS createdAt,
         DATE_FORMAT(s.fecha_resolucion, '%Y-%m-%dT%H:%i:%s') AS resolvedAt`
const requestSource = 'FROM solicitud_permiso s'
const requestSelect = `${requestFields} ${requestSource}`
const justificationFields = `
  SELECT j.id_justificante AS id, 'justificacion' AS type, CAST(a.fecha AS CHAR) AS date,
         NULL AS exitTime, j.id_asistencia AS attendanceId, j.motivo AS reason,
         CASE j.estado WHEN 'ACEPTADO' THEN 'aprobada' WHEN 'RECHAZADO' THEN 'rechazada' ELSE 'pendiente' END AS status,
         DATE_FORMAT(j.fecha_creacion, '%Y-%m-%dT%H:%i:%s') AS createdAt,
         DATE_FORMAT(j.fecha_resolucion, '%Y-%m-%dT%H:%i:%s') AS resolvedAt`
const justificationSource = 'FROM justificante j JOIN asistencia a ON a.id_asistencia = j.id_asistencia'
const justificationSelect = `${justificationFields} ${justificationSource}`

const permissionReview = {
  table: 'solicitud_permiso', key: 'id_solicitud', id: 's.id_solicitud', owner: 's.id_solicitante',
  fields: requestFields, source: requestSource, alias: 's', approved: 'AUTORIZADA', rejected: 'RECHAZADA',
}
const justificationReview = {
  table: 'justificante', key: 'id_justificante', id: 'j.id_justificante', owner: 'a.id_empleado',
  fields: justificationFields, source: justificationSource, alias: 'j', approved: 'ACEPTADO', rejected: 'RECHAZADO',
}

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

function reviewSelect(source) {
  const { table, id, owner, fields, source: from, alias } = source
  return `${fields},
    e.id_empleado AS employeeId, e.nombre_completo AS employeeName, e.puesto AS employeePosition,
    ${alias}.estado AS storedStatus, ${alias}.id_resuelto_por AS resolvedBy,
    (SELECT b.motivo FROM bitacora b
      WHERE b.entidad = '${table}' AND b.id_registro_afectado = ${id}
        AND b.accion = 'CAMBIO' AND b.campo = 'resolucion'
      ORDER BY b.id_bitacora DESC LIMIT 1) AS reviewNote
    ${from} JOIN empleado e ON e.id_empleado = ${owner}`
}

function reviewEntry({ storedStatus, ...request }, reviewerId) {
  return { ...request, canResolve: storedStatus === 'PENDIENTE' && request.employeeId !== reviewerId }
}

export async function listReviewRequests(req, res, next) {
  try {
    const filter = req.query.status ?? 'pendiente'
    if (!['pendiente', 'aprobada', 'rechazada', 'todas'].includes(filter)) {
      return res.status(400).json({ ok: false, message: 'Selecciona un estado válido.' })
    }
    const [rows] = await pool.execute(
      `SELECT * FROM (
        ${reviewSelect(permissionReview)}
        UNION ALL
        ${reviewSelect(justificationReview)}
      ) AS inbox
      ${filter === 'todas' ? '' : 'WHERE status = ?'}
      ORDER BY createdAt DESC, type, id DESC`,
      filter === 'todas' ? [] : [filter],
    )
    const reviewerId = req.session.employee.id
    res.json({ ok: true, requests: rows.map(row => reviewEntry(row, reviewerId)) })
  } catch (error) {
    next(error)
  }
}

function readDecision(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => key !== 'decision' && key !== 'note')) {
    throw new RequestError(400, 'Envía únicamente la decisión y la observación.')
  }
  if (!['aprobar', 'rechazar'].includes(body.decision)) {
    throw new RequestError(400, 'Selecciona aprobar o rechazar.')
  }
  const note = typeof body.note === 'string' ? body.note.trim() : ''
  if ((body.note !== undefined && typeof body.note !== 'string') || [...note].length > 255) {
    throw new RequestError(400, 'La observación admite hasta 255 caracteres.')
  }
  if (body.decision === 'rechazar' && !note) throw new RequestError(400, 'Escribe el motivo del rechazo.')
  return { approved: body.decision === 'aprobar', note: note || null }
}

async function logReview(connection, { at, reviewerId, entity, id, action, field, before, after, note = null }) {
  await connection.execute(
    `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo,
                          valor_anterior, valor_nuevo, motivo, id_usuario)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [at, action, entity, id, field, before && JSON.stringify(before), JSON.stringify(after), note, reviewerId],
  )
}

async function approveAbsence(connection, row, reviewerId, at) {
  const [[attendance]] = await connection.execute(
    'SELECT id_asistencia FROM asistencia WHERE id_empleado = ? AND fecha = ? LIMIT 1 FOR UPDATE',
    [row.employeeId, row.date],
  )
  if (attendance) throw new RequestError(409, 'Hay un marcaje para esa fecha. Revisa la asistencia antes de autorizar la falta.')

  const [[previous]] = await connection.execute(
    `SELECT id_falta, autorizada, id_solicitud, id_validada_por
       FROM falta WHERE id_empleado = ? AND fecha = ? FOR UPDATE`,
    [row.employeeId, row.date],
  )
  if (previous?.id_solicitud != null && previous.id_solicitud !== row.id) {
    throw new RequestError(409, 'La falta de esa fecha ya está vinculada a otra solicitud.')
  }

  const validator = previous?.autorizada && previous.id_validada_por ? previous.id_validada_por : reviewerId
  let id = previous?.id_falta
  if (previous) {
    await connection.execute(
      'UPDATE falta SET autorizada = 1, id_solicitud = ?, id_validada_por = ? WHERE id_falta = ?',
      [row.id, validator, id],
    )
  } else {
    const [result] = await connection.execute(
      'INSERT INTO falta (fecha, autorizada, id_empleado, id_solicitud, id_validada_por) VALUES (?, 1, ?, ?, ?)',
      [row.date, row.employeeId, row.id, validator],
    )
    id = result.insertId
  }
  await logReview(connection, {
    at, reviewerId, entity: 'falta', id, action: previous ? 'CAMBIO' : 'ALTA', field: 'autorizacion',
    before: previous ?? null,
    after: { fecha: row.date, id_empleado: row.employeeId, autorizada: 1, id_solicitud: row.id, id_validada_por: validator },
  })
}

export async function resolveRequest(req, res, next) {
  let connection
  let transaction = false
  try {
    const { type } = req.params
    if (type !== 'justificacion' && !requestTypes.has(type)) throw new RequestError(400, 'El tipo de solicitud no es válido.')
    const id = Number(req.params.id)
    if (!/^\d+$/.test(req.params.id) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
      throw new RequestError(400, 'El identificador de la solicitud no es válido.')
    }
    const { approved, note } = readDecision(req.body)
    const kind = type === 'justificacion' ? justificationReview : permissionReview
    const reviewerId = req.session.employee.id
    connection = await pool.getConnection()
    const [[target]] = await connection.execute(
      `SELECT ${kind.owner} AS employeeId ${kind.source} WHERE ${kind.id} = ?`,
      [id],
    )
    if (!target) throw new RequestError(404, 'No se encontró la solicitud.')

    await connection.beginTransaction()
    transaction = true
    // Respeta el orden de bloqueo de solicitudes y asistencia.
    await connection.execute(
      'SELECT id_empleado FROM empleado WHERE id_empleado IN (?, ?) ORDER BY id_empleado FOR UPDATE',
      [reviewerId, target.employeeId],
    )
    if (!(await hasPermission(reviewerId, requestReviewPermission, connection))) {
      throw new RequestError(403, 'No tienes permiso para resolver solicitudes.')
    }
    const [[row]] = await connection.execute(`${reviewSelect(kind)} WHERE ${kind.id} = ? FOR UPDATE`, [id])
    if (!row || row.type !== type) throw new RequestError(404, 'No se encontró la solicitud.')
    if (row.employeeId !== target.employeeId) throw new RequestError(409, 'La solicitud cambió. Recarga la bandeja.')
    if (row.employeeId === reviewerId) throw new RequestError(403, 'Otra persona con permiso debe resolver tu solicitud.')
    if (row.storedStatus !== 'PENDIENTE') throw new RequestError(409, 'La solicitud ya fue resuelta.')

    const [[clock]] = await connection.query('SELECT CAST(NOW() AS CHAR) AS at')
    const at = clock.at
    const status = approved ? kind.approved : kind.rejected
    const [updated] = await connection.execute(
      `UPDATE ${kind.table} SET estado = ?, fecha_resolucion = ?, id_resuelto_por = ?
        WHERE ${kind.key} = ? AND estado = 'PENDIENTE'`,
      [status, at, reviewerId, id],
    )
    if (updated.affectedRows !== 1) throw new RequestError(409, 'La solicitud ya fue resuelta.')
    if (approved && type === 'falta') await approveAbsence(connection, row, reviewerId, at)

    await logReview(connection, {
      at, reviewerId, entity: kind.table, id, action: 'CAMBIO', field: 'resolucion', note,
      before: { estado: row.storedStatus, fecha_resolucion: row.resolvedAt, id_resuelto_por: row.resolvedBy },
      after: { estado: status, fecha_resolucion: at.replace(' ', 'T'), id_resuelto_por: reviewerId },
    })
    const [[saved]] = await connection.execute(`${reviewSelect(kind)} WHERE ${kind.id} = ?`, [id])
    await connection.commit()
    transaction = false
    res.json({
      ok: true,
      request: reviewEntry(saved, reviewerId),
      message: approved ? 'Solicitud aprobada.' : 'Solicitud rechazada.',
    })
  } catch (error) {
    if (transaction) await connection.rollback()
    if (error instanceof RequestError) return res.status(error.status).json({ ok: false, message: error.message })
    if (error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
      return res.status(409).json({ ok: false, message: 'Otra operación cambió esta jornada. Recarga la bandeja e intenta de nuevo.' })
    }
    next(error)
  } finally {
    connection?.release()
  }
}
