import pool from '../config/database.js'
import { hasPermission } from '../middleware/requirePermission.js'
import { validDate } from '../services/calendarDate.js'

export const holidayManagementPermission = 'FESTIVO_GESTIONAR'
const holidaySelect = 'SELECT id_festivo AS id, CAST(fecha AS CHAR) AS date, descripcion AS description FROM festivo'

export async function listHolidays(req, res, next) {
  try {
    const id = req.session.employee.id
    const canManage = await hasPermission(id, holidayManagementPermission)
    if (!canManage && !(await hasPermission(id, 'ASISTENCIA_PROPIA')) && !(await hasPermission(id, 'ASISTENCIA_GENERAL'))) {
      return res.status(403).json({ ok: false, message: 'No tienes permiso para consultar el calendario.' })
    }
    const [holidays] = await pool.execute(`${holidaySelect} ORDER BY fecha`)
    res.json({ ok: true, holidays, canManage })
  } catch (error) {
    next(error)
  }
}

class HolidayError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function readHoliday(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(field => field !== 'date' && field !== 'description')) {
    throw new HolidayError(400, 'Envía la fecha y la descripción del día festivo.')
  }
  const date = body.date
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!validDate(date)) throw new HolidayError(400, 'Selecciona una fecha válida.')
  if (!description || [...description].length > 100) {
    throw new HolidayError(400, 'Escribe una descripción de entre 1 y 100 caracteres.')
  }
  return { date, description }
}

async function logHoliday(connection, action, id, actorId, previous, current) {
  // Un renglón por campo conserva los valores completos dentro de los límites de bitácora.
  await connection.execute(
    `INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo,
                          valor_anterior, valor_nuevo, id_usuario)
     VALUES (NOW(), ?, 'festivo', ?, 'fecha', ?, ?, ?),
            (NOW(), ?, 'festivo', ?, 'descripcion', ?, ?, ?)`,
    [
      action, id, previous?.date ?? null, current?.date ?? null, actorId,
      action, id, previous?.description ?? null, current?.description ?? null, actorId,
    ],
  )
}

function holidayMutation(action, message) {
  return async (req, res, next) => {
    let connection
    let transaction = false
    try {
      const creating = action === 'ALTA'
      const deleting = action === 'BAJA'
      let id = null
      if (!creating) {
        id = Number(req.params.id)
        if (!/^\d+$/.test(req.params.id) || !Number.isInteger(id) || id < 1 || id > 2147483647) {
          throw new HolidayError(400, 'El identificador del festivo no es válido.')
        }
      }
      const current = deleting ? null : readHoliday(req.body)
      const actorId = req.session.employee.id
      connection = await pool.getConnection()
      await connection.beginTransaction()
      transaction = true
      await connection.execute('SELECT id_empleado FROM empleado WHERE id_empleado = ? FOR UPDATE', [actorId])
      if (!(await hasPermission(actorId, holidayManagementPermission, connection))) {
        throw new HolidayError(403, 'No tienes permiso para gestionar días festivos.')
      }

      let previous = null
      if (creating) {
        const [insert] = await connection.execute(
          'INSERT INTO festivo (fecha, descripcion) VALUES (?, ?)',
          [current.date, current.description],
        )
        id = insert.insertId
      } else {
        [[previous]] = await connection.execute(`${holidaySelect} WHERE id_festivo = ? FOR UPDATE`, [id])
        if (!previous) throw new HolidayError(404, 'No se encontró el día festivo.')
        if (deleting) {
          await connection.execute('DELETE FROM festivo WHERE id_festivo = ?', [id])
        } else {
          await connection.execute(
            'UPDATE festivo SET fecha = ?, descripcion = ? WHERE id_festivo = ?',
            [current.date, current.description, id],
          )
        }
      }

      await logHoliday(connection, action, id, actorId, previous, current)
      await connection.commit()
      transaction = false
      res.status(creating ? 201 : 200).json({
        ok: true,
        message,
        holiday: current ? { id, ...current } : previous,
      })
    } catch (error) {
      if (transaction) await connection.rollback()
      if (error instanceof HolidayError) return res.status(error.status).json({ ok: false, message: error.message })
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Ya hay un día festivo registrado para esa fecha.' })
      }
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ ok: false, message: 'Otro cambio está en curso. Recarga el calendario e intenta de nuevo.' })
      }
      next(error)
    } finally {
      connection?.release()
    }
  }
}

export const createHoliday = holidayMutation('ALTA', 'Día festivo registrado.')
export const updateHoliday = holidayMutation('CAMBIO', 'Día festivo actualizado.')
export const deleteHoliday = holidayMutation('BAJA', 'Día festivo eliminado del calendario.')
