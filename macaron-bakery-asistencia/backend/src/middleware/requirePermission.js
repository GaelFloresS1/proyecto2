
import pool from '../config/database.js'

export function requirePermission(permissionCode) {
  return async (req, res, next) => {
    try {
      const employeeId = req.session?.employee?.id

      if (!employeeId) {
        return res.status(401).json({
          ok: false,
          message: 'Debes iniciar sesión.',
        })
      }

      const [rows] = await pool.execute(
        `SELECT 1
         FROM empleado e
         INNER JOIN rol_permiso rp ON rp.id_rol = e.id_rol
         INNER JOIN permiso p ON p.id_permiso = rp.id_permiso
         WHERE e.id_empleado = ?
           AND e.activo = 1
           AND e.bloqueado = 0
           AND p.codigo = ?
         LIMIT 1`,
        [employeeId, permissionCode]
      )

      if (rows.length === 0) {
        return res.status(403).json({
          ok: false,
          message: 'No tienes permiso para realizar esta acción.',
        })
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}