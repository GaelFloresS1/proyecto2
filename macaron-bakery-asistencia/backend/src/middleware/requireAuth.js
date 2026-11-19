import pool from '../config/database.js'

export function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase()
  if (['administrador', 'admin'].includes(role)) return 'administrador'
  if (['rh', 'recursos humanos', 'recursos_humanos'].includes(role)) return 'rh'
  if (['supervisor', 'supervisor de área', 'supervisor de area'].includes(role)) return 'supervisor'
  return 'empleado'
}

export function publicEmployee(row) {
  return {
    id: row.id_empleado,
    username: row.usuario,
    name: row.nombre_completo,
    position: row.puesto,
    role: normalizeRole(row.rol),
    salary: row.sueldo_base,
    shiftId: row.id_turno,
  }
}

export async function refreshSessionEmployee(req) {
  const employeeId = req.session?.employee?.id
  if (!employeeId) return null

  const [rows] = await pool.execute(
    `SELECT e.id_empleado, e.usuario, e.nombre_completo, e.puesto, e.sueldo_base, e.id_turno, r.nombre AS rol
       FROM empleado e
       INNER JOIN rol r ON r.id_rol = e.id_rol
      WHERE e.id_empleado = ? AND e.activo = 1 AND e.bloqueado = 0`,
    [employeeId],
  )

  if (!rows.length) {
    delete req.session.employee
    return null
  }

  req.session.employee = publicEmployee(rows[0])
  return req.session.employee
}

export async function requireAuth(req, res, next) {
  try {
    if (!(await refreshSessionEmployee(req))) {
      return res.status(401).json({ ok: false, message: 'Debes iniciar sesión.' })
    }
    next()
  } catch (error) {
    next(error)
  }
}
