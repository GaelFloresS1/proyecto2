import pool from '../config/database.js'
import { publicEmployee, refreshSessionEmployee } from '../middleware/requireAuth.js'
import { hasPermission } from '../middleware/requirePermission.js'

export async function login(req, res, next) {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : ''
    const password = typeof req.body?.password === 'string' ? req.body.password : ''

    if (!username || [...username].length > 30 || !password || [...password].length > 255) {
      return res.status(400).json({
        ok: false,
        message: 'Escribe tu usuario y contraseña.',
      })
    }

    const [rows] = await pool.execute(
      `SELECT e.id_empleado, e.usuario, e.nombre_completo, e.contrasena,
              e.puesto, e.sueldo_base, e.id_turno, e.activo, e.intentos_fallidos, e.bloqueado,
              r.nombre AS rol
         FROM empleado e
         INNER JOIN rol r ON r.id_rol = e.id_rol
        WHERE e.usuario = ?
        LIMIT 1`,
      [username],
    )

    const employee = rows[0]

    if (!employee) {
      return res.status(401).json({
        ok: false,
        message: 'Usuario o contraseña incorrectos.',
      })
    }

    if (!employee.activo) {
      return res.status(403).json({
        ok: false,
        message: 'Esta cuenta está inactiva. Contacta a Recursos Humanos.',
      })
    }

    if (employee.bloqueado) {
      return res.status(423).json({
        ok: false,
        message: 'La cuenta está bloqueada. Contacta al administrador.',
      })
    }

    // Comparación directa porque las contraseñas están en texto plano.
    const validPassword = password === employee.contrasena

    if (!validPassword) {
      const attempts = Number(employee.intentos_fallidos || 0) + 1
      const locked = attempts >= 5 ? 1 : 0

      await pool.execute(
        'UPDATE empleado SET intentos_fallidos = ?, bloqueado = ? WHERE id_empleado = ?',
        [attempts, locked, employee.id_empleado],
      )

      return res.status(401).json({
        ok: false,
        message: locked
          ? 'La cuenta quedó bloqueada después de cinco intentos. Contacta al administrador.'
          : `Usuario o contraseña incorrectos. Intentos restantes: ${5 - attempts}.`,
      })
    }

    await pool.execute(
      'UPDATE empleado SET intentos_fallidos = 0 WHERE id_empleado = ?',
      [employee.id_empleado],
    )

    const canViewEmployees = await hasPermission(employee.id_empleado, 'EMPLEADO_VER')
    req.session.employee = publicEmployee(employee)

    return res.json({
      ok: true,
      employee: req.session.employee,
      canViewEmployees,
    })

  } catch (error) {
    next(error)
  }
}

export async function currentUser(req, res, next) {
  try {
    const employee = await refreshSessionEmployee(req)
    const canViewEmployees = employee ? await hasPermission(employee.id, 'EMPLEADO_VER') : false
    res.json({ ok: true, employee, canViewEmployees })
  } catch (error) {
    next(error)
  }
}

export function logout(req, res, next) {
  req.session.destroy((error) => {
    if (error) return next(error)

    res.clearCookie('mb.sid')

    res.json({
      ok: true,
      message: 'Sesión cerrada.',
    })
  })
}
