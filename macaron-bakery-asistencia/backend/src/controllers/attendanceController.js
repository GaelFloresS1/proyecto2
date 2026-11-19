import pool from '../config/database.js'
import { hasPermission } from '../middleware/requirePermission.js'
import { addDays, adjustmentContext, attendanceState, closeCalculation, entryContext, withLateness } from '../services/attendanceCalculation.js'
import { validDate } from '../services/calendarDate.js'

const defaultTolerance = 10 // Valor predeterminado de config_nomina y del prototipo.
export const attendanceAdjustmentPermission = 'REPORTE_MODIFICAR'

const attendanceSelect = `
  SELECT a.id_asistencia, a.id_empleado, a.fecha, a.fecha_hora_entrada, a.fecha_hora_salida,
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
           WHERE b.entidad = 'asistencia' AND b.id_registro_afectado = a.id_asistencia
             AND b.campo = 'calculo_jornada'
             AND (b.accion = 'CORRECCION' OR (b.accion = 'CAMBIO' AND b.id_usuario = a.id_empleado))
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
  const lateMinutes = result && Object.hasOwn(result, 'lateMinutes') ? result.lateMinutes : entry?.lateMinutes
  return {
    ...row,
    ...hours,
    estado,
    estado_calculo: calculationStatus(estado, entry, result, Object.values(hours)),
    es_festivo: result?.festivo === true || result?.status === 'festivo_pendiente' || hours.horas_festiva > 0,
    minutos_retardo: lateMinutes ?? null,
    minutos_tolerancia: entry?.tolerance ?? null,
  }
}

export async function databaseClock(connection) {
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

function positiveId(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
  const id = Number(value)
  return id > 0 && id <= 2147483647 ? id : null
}

function localDateTime(value) {
  if (typeof value !== 'string') return null
  const parts = /^([1-9]\d{3}-\d{2}-\d{2})[T ](([01]\d|2[0-3]):[0-5]\d)(:[0-5]\d)?$/.exec(value)
  return parts && parts[0] === value && validDate(parts[1]) ? `${parts[1]} ${parts[2]}${parts[4] ?? ':00'}` : null
}

export async function readAttendancePeriod(database, clock, { from, to, employeeId }) {
  const [rows] = await database.execute(
    `${attendanceSelect}
      WHERE a.fecha BETWEEN ? AND ?${employeeId ? ' AND a.id_empleado = ?' : ''}
      ORDER BY a.fecha DESC, a.id_asistencia DESC`,
    employeeId ? [from, to, employeeId] : [from, to],
  )
  return rows.map(row => publicAttendance(decodeAttendance(row), clock))
}

export async function listAdjustableAttendance(req, res, next) {
  try {
    const { from, to, employeeId } = req.query
    if (!validDate(from) || !validDate(to) || from > to) {
      throw new AttendanceError(400, 'Selecciona un rango de fechas válido.')
    }
    const id = employeeId === undefined ? null : positiveId(employeeId)
    if (employeeId !== undefined && id === null) throw new AttendanceError(400, 'Selecciona un empleado válido.')

    const attendances = await readAttendancePeriod(pool, await databaseClock(pool), { from, to, employeeId: id })
    res.json({ ok: true, attendances })
  } catch (error) {
    if (error instanceof AttendanceError) return res.status(error.status).json({ ok: false, message: error.message })
    next(error)
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

async function logAttendance(connection, actorId, id, clock, action, field, data, previous = null, reason = null) {
  const before = previous && JSON.stringify(previous)
  const after = JSON.stringify({ ...data, version: 1 })
  if (before?.length > 255 || after.length > 255) throw new Error('El contexto de asistencia supera el espacio disponible en bitácora.')
  await connection.execute(
    `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo,
                          valor_anterior, valor_nuevo, motivo, id_usuario)
     VALUES (?, ?, 'asistencia', ?, ?, ?, ?, ?, ?)`,
    [clock.local, action, id, field, before, after, reason, actorId],
  )
}

async function hasHolidayDuring(connection, entryAt, exitAt) {
  const entryDate = entryAt.slice(0, 10)
  const exitDate = exitAt.slice(0, 10)
  const lastDateWorked = exitDate > entryDate && exitAt.endsWith(' 00:00:00') ? addDays(exitDate, -1) : exitDate
  const [[holiday]] = await connection.execute('SELECT 1 FROM festivo WHERE fecha BETWEEN ? AND ? LIMIT 1', [entryDate, lastDateWorked])
  return Boolean(holiday)
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

  const hasHoliday = await hasHolidayDuring(connection, row.entrada_local, clock.local)
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
    festivo: hasHoliday || undefined,
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
  if (status === 'descanso_pendiente') return 'Salida registrada. Las horas quedan pendientes porque el descanso programado de la jornada es inválido o no está disponible.'
  return 'Salida registrada. Las horas quedan pendientes de clasificación.'
}

function adjustmentInput(body) {
  const fields = ['entryAt', 'exitAt', 'reason']
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !fields.includes(key))) {
    throw new AttendanceError(400, 'Envía únicamente la entrada, la salida y el motivo.')
  }
  const entryAt = localDateTime(body.entryAt)
  const exitAt = localDateTime(body.exitAt)
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!entryAt || !exitAt) throw new AttendanceError(400, 'Escribe una fecha y hora válidas para la entrada y la salida.')
  if (exitAt <= entryAt) throw new AttendanceError(400, 'La salida debe ser posterior a la entrada. Para un turno nocturno, indica la fecha del día siguiente.')
  if (!reason || [...reason].length > 255) throw new AttendanceError(400, 'Escribe un motivo de entre 1 y 255 caracteres.')
  return { entryAt, exitAt, reason }
}

function auditValues(row) {
  return {
    fecha: row.fecha_local,
    entrada: row.entrada_local,
    salida: row.salida_local,
    retardo: row.retardo,
    normales: row.horas_normales,
    extra: row.horas_extra,
    festivas: row.horas_festiva,
    status: row.estado_calculo,
    lateMinutes: row.minutos_retardo,
    festivo: row.es_festivo || undefined,
  }
}

export async function adjustAttendance(req, res, next) {
  let connection
  let transaction = false
  try {
    const id = positiveId(req.params.id)
    if (id === null) throw new AttendanceError(400, 'El identificador de asistencia no es válido.')
    const { entryAt, exitAt, reason } = adjustmentInput(req.body)
    const actorId = req.session.employee.id
    connection = await pool.getConnection()
    const [[target]] = await connection.execute('SELECT id_empleado FROM asistencia WHERE id_asistencia = ?', [id])
    if (!target) throw new AttendanceError(404, 'No se encontró la asistencia.')

    await connection.beginTransaction()
    transaction = true
    // Usa el mismo bloqueo por empleado que los marcajes y un orden fijo para ambos usuarios.
    await connection.execute(
      'SELECT id_empleado FROM empleado WHERE id_empleado IN (?, ?) ORDER BY id_empleado FOR UPDATE',
      [actorId, target.id_empleado],
    )
    if (!(await hasPermission(actorId, attendanceAdjustmentPermission, connection))) {
      throw new AttendanceError(403, 'No tienes permiso para ajustar asistencias.')
    }
    const [[found]] = await connection.execute(`${attendanceSelect} WHERE a.id_asistencia = ? FOR UPDATE`, [id])
    if (!found || found.id_empleado !== target.id_empleado) {
      throw new AttendanceError(409, 'El registro cambió. Recarga el reporte antes de guardar.')
    }

    const row = decodeAttendance(found)
    const clock = await databaseClock(connection)
    const [[times]] = await connection.execute(
      'SELECT UNIX_TIMESTAMP(?) AS entry_epoch, UNIX_TIMESTAMP(?) AS exit_epoch',
      [entryAt, exitAt],
    )
    const enteredAt = Number(times.entry_epoch)
    const exitedAt = Number(times.exit_epoch)
    const elapsedSeconds = exitedAt - enteredAt
    if (!Number.isInteger(enteredAt) || !Number.isInteger(exitedAt) || enteredAt <= 0 ||
        elapsedSeconds <= 0 || elapsedSeconds >= 24 * 60 * 60) {
      throw new AttendanceError(400, 'La jornada debe tener una duración positiva menor de 24 horas.')
    }

    const entryClock = { local: entryAt, epoch: enteredAt }
    const { date, context } = adjustmentContext(row.entry, entryClock)
    if (context?.status === 'pendiente' && exitAt.slice(0, 10) > context.closeThrough) {
      throw new AttendanceError(400, 'La salida queda fuera de la fecha de cierre del turno registrado.')
    }
    const [[duplicate]] = await connection.execute(
      'SELECT id_asistencia FROM asistencia WHERE id_empleado = ? AND fecha = ? AND id_asistencia <> ? LIMIT 1',
      [row.id_empleado, date, id],
    )
    if (duplicate) throw new AttendanceError(409, 'Ya existe una asistencia para ese empleado y fecha.')

    const holiday = await hasHolidayDuring(connection, entryAt, exitAt)
    const computed = closeCalculation(context, { local: exitAt, epoch: exitedAt }, holiday)
    const status = !context && row.entry?.status === 'pendiente' ? 'fecha_sin_contexto' : computed.status
    const lateMinutes = context?.startsAt && Number.isInteger(context.tolerance) && context.tolerance >= 0
      ? withLateness(context, entryClock, context.tolerance).lateMinutes
      : null
    const updated = {
      fecha_local: date,
      entrada_local: entryAt,
      salida_local: exitAt,
      retardo: lateMinutes > 0 ? 1 : 0,
      horas_normales: computed.normal ?? 0,
      horas_extra: computed.extra ?? 0,
      horas_festiva: computed.holiday ?? 0,
      estado_calculo: status,
      minutos_retardo: lateMinutes,
      es_festivo: holiday,
    }
    await connection.execute(
      `UPDATE asistencia
          SET fecha = ?, fecha_hora_entrada = ?, fecha_hora_salida = ?, retardo = ?,
              horas_normales = ?, horas_extra = ?, horas_festiva = ?
        WHERE id_asistencia = ?`,
      [date, entryAt, exitAt, updated.retardo, updated.horas_normales, updated.horas_extra, updated.horas_festiva, id],
    )
    await logAttendance(
      connection, actorId, id, clock, 'CORRECCION', 'calculo_jornada',
      { ...auditValues(updated), elapsedSeconds }, auditValues(publicAttendance(row, clock)), reason,
    )
    const [[saved]] = await connection.execute(`${attendanceSelect} WHERE a.id_asistencia = ?`, [id])
    const attendance = publicAttendance(decodeAttendance(saved), clock)
    await connection.commit()
    transaction = false
    res.json({
      ok: true,
      attendance,
      message: status === 'calculado' ? 'Ajuste guardado y horas recalculadas.' : 'Ajuste guardado. Las horas requieren revisión.',
    })
  } catch (error) {
    if (transaction) await connection.rollback()
    if (error instanceof AttendanceError) return res.status(error.status).json({ ok: false, message: error.message })
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'Ya existe una asistencia para ese empleado y fecha.' })
    }
    if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
      return res.status(409).json({ ok: false, message: 'Otro cambio está en curso. Recarga el reporte e intenta de nuevo.' })
    }
    next(error)
  } finally {
    connection?.release()
  }
}
