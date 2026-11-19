import pool from '../config/database.js'
import { normalizeRole } from '../middleware/requireAuth.js'
import { hasPermission } from '../middleware/requirePermission.js'

const salaryPermission = 'NOMINA_CONSULTAR'
const employeeFields = new Set(['name', 'username', 'position', 'salary', 'roleId', 'shiftId', 'password'])

const employeeSelect = `
  SELECT e.id_empleado AS id, e.nombre_completo AS name, e.usuario AS username,
         e.puesto AS position, e.sueldo_base AS salary, e.id_rol AS roleId,
         e.id_turno AS shiftId, e.activo AS active, e.bloqueado AS locked,
         r.nombre AS roleName, t.nombre AS shiftName
    FROM empleado e
    JOIN rol r ON r.id_rol = e.id_rol
    LEFT JOIN turno t ON t.id_turno = e.id_turno`

function mapEmployee(row, canSeeSalary) {
  return {
    ...row,
    salary: canSeeSalary ? row.salary : null,
    role: normalizeRole(row.roleName),
    active: Boolean(row.active),
    locked: Boolean(row.locked),
  }
}

export async function listEmployees(req, res, next) {
  try {
    const canSeeSalary = await hasPermission(req.session.employee.id, salaryPermission)
    const [employees] = await pool.execute(`${employeeSelect} ORDER BY e.nombre_completo, e.id_empleado`)
    const [roles] = await pool.execute('SELECT id_rol AS id, nombre AS name FROM rol ORDER BY id_rol')
    res.json({
      ok: true,
      employees: employees.map(row => mapEmployee(row, canSeeSalary)),
      roles,
    })
  } catch (error) {
    next(error)
  }
}

class EmployeeError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function validId(value) {
  return Number.isInteger(value) && value > 0 && value <= 2147483647
}

function readText(value, label, limit) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || [...text].length > limit || /[\r\n\0]/.test(text)) {
    throw new EmployeeError(400, `${label} debe tener entre 1 y ${limit} caracteres.`)
  }
  return text
}

function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateEmployee(body, isNew) {
  if (!isJsonObject(body)) {
    throw new EmployeeError(400, 'Envía los datos del empleado como un objeto JSON.')
  }
  if (Object.keys(body).some(key => !employeeFields.has(key))) {
    throw new EmployeeError(400, 'El formulario contiene campos que esta operación no admite.')
  }
  const name = readText(body.name, 'El nombre', 100)
  const username = readText(body.username, 'El usuario', 30)
  const position = readText(body.position, 'El puesto', 50)
  const salary = typeof body.salary === 'number' ? String(body.salary) : body.salary
  const { roleId, shiftId, password = '' } = body

  if ((isNew || salary !== undefined) &&
      (typeof salary !== 'string' || !/^\d{1,8}(?:\.\d{1,2})?$/.test(salary) || salary !== salary.trim())) {
    throw new EmployeeError(400, 'Escribe un sueldo de 0 a 99999999.99 con hasta dos decimales.')
  }
  if (!validId(roleId) || (shiftId !== null && !validId(shiftId))) {
    throw new EmployeeError(400, 'Selecciona un rol y un turno válidos. Puedes dejar el turno sin asignar.')
  }
  if (typeof password !== 'string' || ((isNew || password) &&
      (!password.trim() || [...password].length < 8 || [...password].length > 255))) {
    throw new EmployeeError(400, 'La contraseña debe tener entre 8 y 255 caracteres.')
  }

  return { name, username, position, salary, roleId, shiftId, password }
}

async function ensureActiveShift(connection, shiftId) {
  if (shiftId === null) return

  // Comparte el bloqueo de turno con su desactivación.
  const [rows] = await connection.execute('SELECT activo FROM turno WHERE id_turno = ? FOR UPDATE', [shiftId])
  if (!rows[0]?.activo) {
    throw new EmployeeError(409, 'Selecciona un turno activo o deja el turno sin asignar.')
  }
}

function employeeMutation(permission, mutate) {
  return async (req, res, next) => {
    let connection
    try {
      const hasBody = Number(req.get('content-length')) > 0 || Boolean(req.get('transfer-encoding'))
      if (hasBody && !req.is('application/json')) {
        throw new EmployeeError(415, 'Envía los datos con el tipo de contenido application/json.')
      }
      const actorId = req.session.employee.id
      const id = req.params.id === undefined ? null : Number(req.params.id)
      if (id !== null && (!/^\d+$/.test(req.params.id) || !validId(id))) {
        throw new EmployeeError(400, 'El ID del empleado no es válido.')
      }

      connection = await pool.getConnection()
      await connection.beginTransaction()
      // El actor y el destinatario se bloquean en el mismo orden en cada operación.
      const [rows] = await connection.execute(
        `SELECT id_empleado, id_rol, id_turno, activo FROM empleado
          WHERE id_empleado IN (?, ?) ORDER BY id_empleado FOR UPDATE`,
        [actorId, id ?? actorId],
      )
      if (!(await hasPermission(actorId, permission, connection))) {
        throw new EmployeeError(403, 'No tienes permiso para realizar esta acción.')
      }

      const actor = rows.find(row => row.id_empleado === actorId)
      const target = rows.find(row => row.id_empleado === id)
      if (id !== null && !target) throw new EmployeeError(404, 'No se encontró el empleado.')

      const [roles] = await connection.execute('SELECT id_rol AS id, nombre AS name FROM rol')
      const roleById = new Map(roles.map(role => [role.id, normalizeRole(role.name)]))
      const isAdmin = roleById.get(actor.id_rol) === 'administrador'
      if (!isAdmin && target && roleById.get(target.id_rol) === 'administrador') {
        throw new EmployeeError(403, 'Solo un administrador puede modificar una cuenta administradora.')
      }

      const result = await mutate({ req, connection, actorId, id, target, roleById, isAdmin })
      const canSeeSalary = await hasPermission(actorId, salaryPermission, connection)
      const [employees] = await connection.execute(`${employeeSelect} WHERE e.id_empleado = ?`, [result.id])
      await connection.commit()
      res.status(id === null ? 201 : 200).json({
        ok: true,
        message: result.message,
        employee: mapEmployee(employees[0], canSeeSalary),
      })
    } catch (error) {
      if (connection) await connection.rollback()
      if (error instanceof EmployeeError) {
        return res.status(error.status).json({ ok: false, message: error.message })
      }
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ ok: false, message: 'Ese nombre de usuario ya está en uso.' })
      }
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        return res.status(409).json({ ok: false, message: 'Hubo otro cambio simultáneo. Intenta de nuevo.' })
      }
      next(error)
    } finally {
      connection?.release()
    }
  }
}

async function saveEmployee({ req, connection, actorId, id, target, roleById, isAdmin }) {
  const { name, username, position, salary, roleId, shiftId, password } = validateEmployee(req.body, id === null)
  if (!roleById.has(roleId)) throw new EmployeeError(400, 'El rol seleccionado no existe.')
  if (!isAdmin && roleById.get(roleId) === 'administrador') {
    throw new EmployeeError(403, 'Solo un administrador puede asignar el rol de administrador.')
  }
  if (id === actorId && roleId !== target.id_rol) {
    throw new EmployeeError(409, 'No puedes cambiar el rol de tu propia cuenta.')
  }
  if (!target || target.id_turno !== shiftId) await ensureActiveShift(connection, shiftId)

  const values = [name, username, position, salary ?? null, roleId, shiftId]
  if (id === null) {
    const [result] = await connection.execute(
      `INSERT INTO empleado
         (nombre_completo, usuario, puesto, sueldo_base, id_rol, id_turno, contrasena, fecha_alta)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE())`,
      [...values, password],
    )
    return { id: result.insertId, message: 'Empleado dado de alta.' }
  }

  const passwordUpdate = password ? ', contrasena = ?, bloqueado = 0, intentos_fallidos = 0' : ''
  await connection.execute(
    `UPDATE empleado
        SET nombre_completo = ?, usuario = ?, puesto = ?, sueldo_base = COALESCE(?, sueldo_base), id_rol = ?, id_turno = ?,
            fecha_ultima_modificacion = CURDATE()${passwordUpdate}
      WHERE id_empleado = ?`,
    [...values, ...(password ? [password] : []), id],
  )
  return { id, message: 'Datos del personal actualizados.' }
}

function changeStatus(active) {
  return async ({ req, connection, actorId, id, target }) => {
    if (req.body !== undefined && (!isJsonObject(req.body) || Object.keys(req.body).length > 0)) {
      throw new EmployeeError(400, 'El cambio de estado se indica en la ruta. Envía la solicitud sin datos.')
    }
    if (!active && id === actorId) throw new EmployeeError(409, 'No puedes dar de baja tu propia cuenta.')
    if (Boolean(target.activo) !== active) {
      if (active) await ensureActiveShift(connection, target.id_turno)

      await connection.execute(
        `UPDATE empleado
            SET activo = ?, fecha_baja = IF(?, NULL, CURDATE()), fecha_ultima_modificacion = CURDATE()
          WHERE id_empleado = ?`,
        [active ? 1 : 0, active ? 1 : 0, id],
      )
    }
    return { id, message: active ? 'Empleado reactivado.' : 'Baja registrada. Se conserva el historial de asistencia.' }
  }
}

export const createEmployee = employeeMutation('EMPLEADO_CREAR', saveEmployee)
export const updateEmployee = employeeMutation('EMPLEADO_EDITAR', saveEmployee)
export const deactivateEmployee = employeeMutation('EMPLEADO_BAJA', changeStatus(false))
export const activateEmployee = employeeMutation('EMPLEADO_BAJA', changeStatus(true))
