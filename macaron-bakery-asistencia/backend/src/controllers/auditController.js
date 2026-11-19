import pool from '../config/database.js'
import { publicAuditMovement } from '../services/auditVisibility.js'
import { validDate } from '../services/calendarDate.js'

const actions = new Set(['ALTA', 'BAJA', 'CAMBIO', 'CORRECCION'])

function positiveInteger(value, max) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  return number <= max ? number : null
}

export async function listAuditMovements(req, res, next) {
  try {
    const { from = '', to = '', actor = '', entity = '', action = '' } = req.query
    const page = positiveInteger(req.query.page ?? '1', 2147483647)
    const pageSize = positiveInteger(req.query.pageSize ?? '25', 100)
    if (!page || !pageSize ||
        (from !== '' && !validDate(from)) || (to !== '' && !validDate(to)) ||
        (from && to && from > to) ||
        typeof actor !== 'string' || actor.length > 100 ||
        (entity !== '' && (typeof entity !== 'string' || !/^[\p{L}\p{N}_ -]{1,50}$/u.test(entity))) ||
        (action !== '' && !actions.has(action))) {
      return res.status(400).json({ ok: false, message: 'Revisa las fechas, los filtros y la página solicitada.' })
    }

    const conditions = []
    const params = []
    if (from) {
      conditions.push('b.fecha_hora >= ?')
      params.push(from + ' 00:00:00')
    }
    if (to) {
      conditions.push('b.fecha_hora <= ?')
      params.push(to + ' 23:59:59')
    }
    const name = actor.trim()
    if (name) {
      const id = positiveInteger(name, 2147483647)
      if (id) {
        conditions.push('b.id_usuario = ?')
        params.push(id)
      } else {
        conditions.push("e.nombre_completo LIKE ? ESCAPE '!'")
        params.push('%' + name.replace(/[!%_]/g, '!$&') + '%')
      }
    }
    if (entity) {
      conditions.push('b.entidad = ?')
      params.push(entity)
    }
    if (action) {
      conditions.push('b.accion = ?')
      params.push(action)
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const [rows] = await pool.execute(
      `SELECT b.id_bitacora AS id, DATE_FORMAT(b.fecha_hora, '%Y-%m-%dT%H:%i:%s') AS at,
              b.id_usuario AS employeeId, e.nombre_completo AS employeeName,
              b.accion AS action, b.entidad AS entity, b.id_registro_afectado AS recordId,
              b.campo AS field, b.valor_anterior AS previousValue, b.valor_nuevo AS newValue, b.motivo AS reason
         FROM bitacora b LEFT JOIN empleado e ON e.id_empleado = b.id_usuario
         ${where}
        ORDER BY b.fecha_hora DESC, b.id_bitacora DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize + 1, (page - 1) * pageSize],
    )
    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      movements: rows.slice(0, pageSize).map(publicAuditMovement),
      page,
      pageSize,
      hasNext: rows.length > pageSize,
    })
  } catch (error) {
    next(error)
  }
}
