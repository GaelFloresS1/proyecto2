/**
 * Estado compartido del prototipo. Empleados, sesión y turnos provienen
 * de MariaDB. Las funciones locales conservan su persistencia.
 */
const KEY = 'macaron-bakery-nomina-v1'

export const ROLES = {
  ADMIN: 'administrador',
  RH: 'rh',
  SUPERVISOR: 'supervisor',
  EMPLEADO: 'empleado',
}

export const ROLE_LABEL = {
  administrador: 'Administrador',
  rh: 'Recursos Humanos',
  supervisor: 'Supervisor de área',
  empleado: 'Empleado',
}

export const POSITIONS = [
  'Barista',
  'Cajero',
  'Capacitador',
  'Supervisor de área',
  'Recursos Humanos',
  'Administrador',
]

const listeners = new Set()
let state = null
let bootstrapPromise
let sessionVersion = 0

// Comunicación con el backend. Vite redirige /api hacia Express.
async function authRequest(path, options = {}) {
  let response

  try {
    response = await fetch(`/api/auth${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch {
    return {
      ok: false,
      message: 'No se pudo conectar con el servidor. Verifica que el backend esté iniciado.',
    }
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data?.ok !== true) {
    return {
      ok: false,
      message: data?.message || `Error de autenticación (${response.status}).`,
    }
  }

  return { ok: true, ...data }
}


// Comunicación con el módulo de asistencia.
async function attendanceRequest(path, options = {}) {
  let response

  try {
    response = await fetch(`/api/attendance${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch {
    return {
      ok: false,
      message: 'No se pudo conectar con el servidor. Verifica que el backend esté iniciado.',
    }
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      message: data.message || `Error de asistencia (${response.status}).`,
    }
  }

  return { ok: true, ...data }
}


async function adminRequest(resource, label, path, options = {}) {
  let response

  try {
    response = await fetch(`/api/${resource}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
  } catch {
    return {
      ok: false,
      message: `No se pudo conectar con el servidor de ${label}.`,
    }
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok || data?.ok !== true) {
    return {
      ok: false,
      status: response.status,
      message: data?.message || `Error de ${label} (${response.status}).`,
    }
  }

  return { ...data, ok: true }
}

function shiftRequest(path, options) {
  return adminRequest('shifts', 'turnos', path, options)
}

function employeeRequest(path, options) {
  return adminRequest('employees', 'empleados', path, options)
}

// Convierte una fecha de MySQL al formato YYYY-MM-DD.
function dbDateToISO(value) {
  if (!value) return ''

  if (value instanceof Date) {
    return localISO(value)
  }

  return String(value).slice(0, 10)
}

// Convierte un DATETIME de MySQL al formato HH:mm.
function dbTimeToHM(value) {
  if (!value) return null

  if (value instanceof Date) {
    return hm(value)
  }

  const text = String(value)

  // Formato DATETIME: YYYY-MM-DD HH:mm:ss
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) {
    return text.slice(11, 16)
  }

  // Formato ISO.
  const date = new Date(text)

  return Number.isNaN(date.getTime()) ? null : hm(date)
}

// Convierte un registro de MySQL al formato utilizado por React.
function mapAttendanceRow(row, user) {
  const checkIn = dbTimeToHM(row.fecha_hora_entrada)
  const checkOut = dbTimeToHM(row.fecha_hora_salida)
  const shift = getShift(user.shiftId)

  const lateMinutes = shift && checkIn
    ? Math.max(
        0,
        minutesOf(checkIn) -
          minutesOf(shift.start) -
          state.config.graceMinutes,
      )
    : 0

  return {
    id: row.id_asistencia,
    userId: user.id,
    date: dbDateToISO(row.fecha),
    checkIn,
    checkOut,
    source: 'sistema',
    late: Boolean(row.retardo) || lateMinutes > 0,
    lateMinutes,
    extraHoursOverride: null,
    holidayHoursOverride: null,
    notes: '',
  }
}


function mapEmployeeToUser(employee) {
  return {
    id: employee.id,
    username: employee.username,
    name: employee.name,
    role: employee.role,
    position: employee.position,
    salary: employee.salary ?? null,
    shiftId: employee.shiftId ?? null,
    locked: employee.locked ?? false,
    active: employee.active ?? true,
  }
}

function upsertUser(users, user) {
  if (!users.some(item => item.id === user.id)) return [...users, user]
  return users.map(item => item.id === user.id ? user : item)
}

function usersFromDirectory(employees, sessionUser) {
  const users = employees.map(mapEmployeeToUser)
  const current = users.find(user => user.id === sessionUser.id)
  return upsertUser(users, current ? { ...current, salary: current.salary ?? sessionUser.salary } : sessionUser)
}

function clearSession() {
  sessionVersion += 1
  commit({ ...state, sessionUserId: null, users: [], shifts: [] })
}

export function getState() {
  return state
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function commit(next) {
  state = next
  const { config, holidays, attendances, requests, auditLog } = next
  try {
    localStorage.setItem(KEY, JSON.stringify({ config, holidays, attendances, requests, auditLog }))
  } catch {
    // Un fallo de almacenamiento local no invalida el estado de la sesión en memoria.
  }
  listeners.forEach((fn) => fn(state))
}

export function patch(updater) {
  commit(updater({ ...state }))
}

export function localISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')

  return `${y}-${m}-${d}`
}

export function formatTime(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export function hm(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function hoursBetween(startHm, endHm) {
  let diff = minutesOf(endHm) - minutesOf(startHm)

  if (diff < 0) diff += 24 * 60

  return Math.round((diff / 60) * 100) / 100
}

function uid(prefix) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

function createInitialState() {
  return {
    sessionUserId: null,
    users: [],
    shifts: [],
    config: {
      company: 'Macaron & Bakery',
      graceMinutes: 10,
      extraHourMultiplier: 1.5,
      holidayHourMultiplier: 2,
      monthlyHours: 192,
    },
    holidays: [
      { id: uid('hol'), date: '2026-09-16', name: 'Día de la Independencia' },
      { id: uid('hol'), date: '2026-11-02', name: 'Día de Muertos' },
      { id: uid('hol'), date: '2026-12-25', name: 'Navidad' },
      { id: uid('hol'), date: '2026-10-16', name: 'Aniversario Macaron & Bakery' },
    ],
    attendances: [],
    requests: [],
    auditLog: [],
  }
}

function withoutDemoUsers(items) {
  return Array.isArray(items)
    ? items.filter(item => item && !String(item.userId).startsWith('usr_'))
    : []
}

function readLocalState() {
  const initial = createInitialState()
  try {
    const stored = JSON.parse(localStorage.getItem(KEY))
    if (!stored) return initial
    return {
      ...initial,
      config: { ...initial.config, ...stored.config },
      holidays: Array.isArray(stored.holidays) ? stored.holidays : initial.holidays,
      attendances: withoutDemoUsers(stored.attendances),
      requests: withoutDemoUsers(stored.requests),
      auditLog: withoutDemoUsers(stored.auditLog),
    }
  } catch {
    return initial
  }
}

async function restoreSession() {
  commit(readLocalState())
  const version = sessionVersion
  const result = await authRequest('/me')
  if (version === sessionVersion && result.ok && result.employee) await openSession(result)
  return state
}

export function bootstrap() {
  bootstrapPromise ??= restoreSession()
  return bootstrapPromise
}

function addAudit(draft, {
  userId,
  action,
  entity,
  previousValue,
  newValue,
}) {
  draft.auditLog.unshift({
    id: uid('log'),
    userId,
    action,
    entity,
    previousValue: String(previousValue ?? ''),
    newValue: String(newValue ?? ''),
    at: new Date().toISOString(),
  })
}

export function getUser(id = state?.sessionUserId) {
  return state?.users.find((u) => u.id === id) || null
}

export function getShift(shiftId) {
  return state.shifts.find((s) => s.id === shiftId)
}


export async function loadShifts() {
  const version = sessionVersion
  const result = await shiftRequest('')
  const shifts = result.ok ? result.shifts ?? [] : []
  if (version === sessionVersion) commit({ ...state, shifts })
  return result.ok ? { ok: true, shifts } : result
}

export function isHoliday(date) {
  return state.holidays.some((h) => h.date === date)
}

export function holidayName(date) {
  return state.holidays.find((h) => h.date === date)?.name
}


// =====================================================
// ASISTENCIA CONECTADA A MYSQL
// =====================================================

export async function loadMyAttendance() {
  const user = getUser()

  if (!user) {
    return {
      ok: false,
      message: 'No hay un empleado con sesión activa.',
    }
  }

  const result = await attendanceRequest('/history')

  if (!result.ok) {
    return result
  }

  const records = (result.attendances || []).map((row) =>
    mapAttendanceRow(row, user),
  )

  patch((draft) => {
    // Eliminamos los registros simulados de este empleado.
    draft.attendances = draft.attendances.filter(
      (record) =>
        String(record.userId) !== String(user.id),
    )

    // Incorporamos los registros obtenidos desde MySQL.
    draft.attendances.push(...records)

    return draft
  })

  return {
    ok: true,
    attendances: records,
  }
}


// =====================================================
// AUTENTICACIÓN CON EL BACKEND
// =====================================================

async function openSession({ employee, canViewEmployees }) {
  const version = ++sessionVersion
  const user = mapEmployeeToUser(employee)
  const [directory, shifts] = await Promise.all([
    canViewEmployees ? requestEmployeeDirectory() : null,
    shiftRequest(''),
  ])

  if (version !== sessionVersion) return null
  if (shifts.status === 401 || directory?.status === 401) {
    clearSession()
    return null
  }

  commit({
    ...state,
    sessionUserId: user.id,
    users: directory?.ok ? usersFromDirectory(directory.employees, user) : [user],
    shifts: shifts.ok ? shifts.shifts ?? [] : [],
  })
  return getUser()
}

export async function login(username, password) {
  const result = await authRequest('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  if (!result.ok) return result

  if (!result.employee) return { ok: false, message: 'El servidor no devolvió los datos del empleado.' }
  const user = await openSession(result)
  if (!user) return { ok: false, message: 'La sesión no está disponible. Vuelve a iniciar sesión.' }
  return { ok: true, user }
}

export async function getCurrentUser() {
  const version = sessionVersion
  const result = await authRequest('/me')
  if (version !== sessionVersion || !result.ok) return null
  if (!result.employee) {
    clearSession()
    return null
  }
  if (getUser()?.id !== result.employee.id) return openSession(result)

  const user = mapEmployeeToUser(result.employee)
  commit({
    ...state,
    users: result.canViewEmployees ? upsertUser(state.users, user) : [user],
  })
  return user
}

export async function logout() {
  clearSession()
  await authRequest('/logout', { method: 'POST' })
}

export function homePathFor(role) {
  if (role === ROLES.ADMIN) return '/admin/empleados'
  if (role === ROLES.RH) return '/rh/solicitudes'
  if (role === ROLES.SUPERVISOR) return '/rh/solicitudes'

  return '/empleado'
}

export function canAccess(role, area) {
  if (role === ROLES.ADMIN) return true
  if (role === ROLES.RH) return ['rh', 'empleado'].includes(area)
  if (role === ROLES.SUPERVISOR) return ['rh-inbox', 'empleado'].includes(area)

  return area === 'empleado'
}


export async function clockIn(userId) {
  const user = getUser(userId)

  if (!user?.active) {
    return {
      ok: false,
      message: 'No se puede registrar asistencia de una cuenta inactiva.',
    }
  }

  // Solicita al backend registrar la entrada.
  const result = await attendanceRequest('/clock-in', {
    method: 'POST',
  })

  if (!result.ok) {
    return result
  }

  // Convertimos la respuesta de MySQL.
  const record = mapAttendanceRow(result.attendance, user)

  // Actualizamos la copia local para refrescar la interfaz.
  patch((draft) => {
    draft.attendances = draft.attendances.filter(
      (a) =>
        !(
          String(a.userId) === String(userId) &&
          a.date === record.date
        ),
    )

    draft.attendances.unshift(record)

    return draft
  })

  const now = new Date()
  const holiday = isHoliday(record.date)

  return {
    ok: true,
    late: record.late,
    lateMinutes: record.lateMinutes,
    checkIn: record.checkIn,
    clock: formatTime(now),
    holiday,
    message: record.late
      ? `Entrada registrada a las ${record.checkIn} (${record.lateMinutes} min de retardo).`
      : `Entrada registrada a las ${record.checkIn} correctamente.`,
  }
}



export async function clockOut(userId) {
  const user = getUser(userId)

  if (!user?.active) {
    return {
      ok: false,
      message: 'No se puede registrar asistencia de una cuenta inactiva.',
    }
  }

  // Solicita al backend registrar la salida.
  const result = await attendanceRequest('/clock-out', {
    method: 'POST',
  })

  if (!result.ok) {
    return result
  }

  const record = mapAttendanceRow(result.attendance, user)

  // Actualizamos el registro local correspondiente.
  patch((draft) => {
    const index = draft.attendances.findIndex(
      (a) =>
        String(a.userId) === String(userId) &&
        a.date === record.date,
    )

    if (index >= 0) {
      draft.attendances[index] = {
        ...draft.attendances[index],
        ...record,
      }
    } else {
      draft.attendances.unshift(record)
    }

    return draft
  })

  const now = new Date()

  return {
    ok: true,
    checkOut: record.checkOut,
    clock: formatTime(now),
    message: `Salida registrada a las ${record.checkOut}. Las horas se calcularán automáticamente para nómina.`,
  }
}


export function createRequest({
  userId,
  type,
  date,
  reason,
}) {
  if (!reason?.trim()) {
    return {
      ok: false,
      message: 'Describe el motivo. RH necesita el detalle para autorizar o rechazar.',
    }
  }

  if (!date) {
    return {
      ok: false,
      message: 'Selecciona la fecha de la incidencia o permiso.',
    }
  }

  patch((draft) => {
    draft.requests.unshift({
      id: uid('req'),
      userId,
      type,
      date,
      reason: reason.trim(),
      status: 'pendiente',
      createdAt: new Date().toISOString(),
      reviewerId: null,
      reviewNote: '',
    })

    return draft
  })

  return {
    ok: true,
    message: 'Solicitud enviada a la bandeja de Recursos Humanos / Supervisor.',
  }
}

export function reviewRequest({
  requestId,
  status,
  reviewerId,
  reviewNote,
}) {
  const req = state.requests.find(
    (r) => r.id === requestId,
  )

  if (!req) {
    return {
      ok: false,
      message: 'No se encontró la solicitud.',
    }
  }

  patch((draft) => {
    const target = draft.requests.find(
      (r) => r.id === requestId,
    )

    const previous = target.status

    target.status = status
    target.reviewerId = reviewerId
    target.reviewNote = reviewNote?.trim() || ''

    addAudit(draft, {
      userId: reviewerId,
      action:
        status === 'aprobada'
          ? 'Autorizar permiso/falta'
          : 'Rechazar permiso/falta',
      entity: requestId,
      previousValue: previous,
      newValue: status,
    })

    return draft
  })

  return {
    ok: true,
    message:
      status === 'aprobada'
        ? 'Solicitud autorizada.'
        : 'Solicitud rechazada.',
  }
}

export function upsertHoliday({
  id,
  date,
  name,
  actorId,
}) {
  if (!date || !name?.trim()) {
    return {
      ok: false,
      message: 'Indica fecha y nombre del día festivo.',
    }
  }

  patch((draft) => {
    if (id) {
      const current = draft.holidays.find(
        (h) => h.id === id,
      )

      const previous = `${current.date} ${current.name}`

      current.date = date
      current.name = name.trim()

      addAudit(draft, {
        userId: actorId,
        action: 'Editar día festivo',
        entity: id,
        previousValue: previous,
        newValue: `${date} ${name}`,
      })
    } else {
      const newId = uid('hol')

      draft.holidays.push({
        id: newId,
        date,
        name: name.trim(),
      })

      addAudit(draft, {
        userId: actorId,
        action: 'Alta de día festivo',
        entity: newId,
        previousValue: '',
        newValue: `${date} ${name}`,
      })
    }

    return draft
  })

  return {
    ok: true,
    message: 'Calendario de festivos actualizado.',
  }
}

export function removeHoliday(id, actorId) {
  const current = state.holidays.find(
    (h) => h.id === id,
  )

  patch((draft) => {
    draft.holidays = draft.holidays.filter(
      (h) => h.id !== id,
    )

    addAudit(draft, {
      userId: actorId,
      action: 'Baja lógica de día festivo',
      entity: id,
      previousValue: `${current?.date} ${current?.name}`,
      newValue: 'eliminado',
    })

    return draft
  })

  return {
    ok: true,
    message: 'Festivo eliminado del calendario.',
  }
}

async function requestEmployeeDirectory() {
  const result = await employeeRequest('')
  if (result.ok && (!Array.isArray(result.employees) || !Array.isArray(result.roles))) {
    return { ok: false, message: 'El servidor devolvió un directorio incompleto.' }
  }
  return result
}

export async function loadEmployees() {
  const version = sessionVersion
  const result = await requestEmployeeDirectory()
  const user = getUser()
  if (version === sessionVersion && user) {
    if (result.status === 401) clearSession()
    else if (result.status === 403) commit({ ...state, users: [user] })
    else if (result.ok) commit({ ...state, users: usersFromDirectory(result.employees, user) })
  }
  return result
}

async function employeeMutation(path, options) {
  const version = sessionVersion
  const result = await employeeRequest(path, options)
  if (!result.ok) return result
  if (!Number.isInteger(result.employee?.id)) {
    return { ok: false, message: 'El servidor devolvió una respuesta incompleta. Recarga el directorio para comprobar el cambio.' }
  }

  const current = getUser()
  if (version === sessionVersion && current) {
    const user = mapEmployeeToUser(result.employee)
    if (user.id === current.id && user.salary === null) user.salary = current.salary
    commit({ ...state, users: upsertUser(state.users, user) })
  }
  return result
}

export function saveEmployee({ id, name, username, position, salary, roleId, shiftId, password }) {
  return employeeMutation(id ? `/${id}` : '', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({ name, username, position, salary, roleId, shiftId, password }),
  })
}

export function deactivateEmployee(id) {
  return employeeMutation(`/${id}/deactivate`, { method: 'PATCH' })
}

export function activateEmployee(id) {
  return employeeMutation(`/${id}/activate`, { method: 'PATCH' })
}


export async function saveShift(payload, actorId) {
  const {
    id,
    name,
    start,
    end,
    breakMinutes,
    weeklyDays,
  } = payload

  if (!name?.trim() || !start || !end) {
    return {
      ok: false,
      message: 'Completa nombre, hora de inicio y hora de fin.',
    }
  }

  const editing = id != null

  const result = await shiftRequest(
    editing ? `/${id}` : '',
    {
      method: editing ? 'PUT' : 'POST',
      body: JSON.stringify({
        name: name.trim(),
        start,
        end,
        breakMinutes: Number(breakMinutes),
        weeklyDays,
      }),
    }
  )

  if (!result.ok) {
    return result
  }

  const reloadResult = await loadShifts()

  if (!reloadResult.ok) {
    return {
      ok: true,
      message: 'Los cambios se guardaron en MariaDB, pero no se pudo actualizar la lista. Recarga la página.',
      shift: result.shift,
    }
  }

  return {
    ok: true,
    message: result.message || (
      editing
        ? 'Turno actualizado correctamente.'
        : 'Turno registrado correctamente.'
    ),
    shift: result.shift,
  }
}


export async function deactivateShift(shiftId) {
  if (!Number.isSafeInteger(Number(shiftId)) || Number(shiftId) <= 0) {
    return {
      ok: false,
      message: 'El ID del turno no es válido.',
    }
  }

  const result = await shiftRequest(
    `/${shiftId}/deactivate`,
    { method: 'PATCH' }
  )

  if (!result.ok) {
    return result
  }

  const reloadResult = await loadShifts()

  if (!reloadResult.ok) {
    return {
      ok: true,
      message: 'El turno se desactivó, pero no se pudo actualizar la lista. Recarga la página.',
    }
  }

  return {
    ok: true,
    message: result.message || 'Turno desactivado correctamente.',
  }
}


export async function activateShift(shiftId) {
  const id = Number(shiftId)

  if (!Number.isSafeInteger(id) || id <= 0) {
    return {
      ok: false,
      message: 'El ID del turno no es válido.',
    }
  }

  const result = await shiftRequest(
    `/${id}/activate`,
    { method: 'PATCH' }
  )

  if (!result.ok) {
    return result
  }

  const reloadResult = await loadShifts()

  if (!reloadResult.ok) {
    return {
      ok: true,
      message:
        'El turno se reactivó, pero no se pudo actualizar la lista. Recarga la página.',
    }
  }

  return {
    ok: true,
    message: result.message || 'Turno reactivado correctamente.',
  }
}


export function saveConfig(partial, actorId) {
  patch((draft) => {
    const previous = JSON.stringify(draft.config)

    draft.config = {
      ...draft.config,
      ...partial,
    }

    addAudit(draft, {
      userId: actorId,
      action: 'Actualizar configuración de nómina',
      entity: 'config',
      previousValue: previous,
      newValue: JSON.stringify(draft.config),
    })

    return draft
  })
}

export function adjustAttendance({
  attendanceId,
  extraHoursOverride,
  holidayHoursOverride,
  notes,
  actorId,
  checkIn,
  checkOut,
}) {
  const rec = state.attendances.find(
    (a) => a.id === attendanceId,
  )

  if (!rec) {
    return {
      ok: false,
      message: 'No se encontró el registro de asistencia.',
    }
  }

  patch((draft) => {
    const target = draft.attendances.find(
      (a) => a.id === attendanceId,
    )

    const previous = JSON.stringify({
      extra: target.extraHoursOverride,
      holiday: target.holidayHoursOverride,
      in: target.checkIn,
      out: target.checkOut,
    })

    if (checkIn != null) target.checkIn = checkIn
    if (checkOut != null) target.checkOut = checkOut

    target.extraHoursOverride =
      extraHoursOverride === '' || extraHoursOverride == null
        ? null
        : Number(extraHoursOverride)

    target.holidayHoursOverride =
      holidayHoursOverride === '' || holidayHoursOverride == null
        ? null
        : Number(holidayHoursOverride)

    target.notes = notes ?? target.notes

    addAudit(draft, {
      userId: actorId,
      action: 'Modificar reporte / horas extras o festivas',
      entity: attendanceId,
      previousValue: previous,
      newValue: JSON.stringify({
        extra: target.extraHoursOverride,
        holiday: target.holidayHoursOverride,
        in: target.checkIn,
        out: target.checkOut,
      }),
    })

    return draft
  })

  return {
    ok: true,
    message: 'Ajuste guardado en el reporte y en la bitácora.',
  }
}

export function computeDay(record, user) {
  const shift = getShift(user.shiftId)
  const holiday = isHoliday(record.date)

  if (!record.checkIn || !record.checkOut || !shift) {
    return {
      worked: 0,
      normal: 0,
      extra: 0,
      holidayHours: 0,
      holiday,
    }
  }

  const raw = hoursBetween(record.checkIn, record.checkOut)
  const breakH = (shift.breakMinutes || 0) / 60

  const worked = Math.max(
    0,
    Math.round((raw - breakH) * 100) / 100,
  )

  const jornada = Math.max(
    0,
    hoursBetween(shift.start, shift.end) - breakH,
  )

  let extra = Math.max(
    0,
    Math.round((worked - jornada) * 100) / 100,
  )

  let holidayHours = holiday ? worked : 0
  let normal = holiday ? 0 : Math.min(worked, jornada)

  if (record.extraHoursOverride != null) {
    extra = Number(record.extraHoursOverride)
  }

  if (record.holidayHoursOverride != null) {
    holidayHours = Number(record.holidayHoursOverride)
  }

  return {
    worked,
    normal,
    extra,
    holidayHours,
    holiday,
    jornada,
  }
}

export function hourlyRate(user) {
  return user.salary / state.config.monthlyHours
}

export function estimatePay(calc, user) {
  if (user.salary === null) return null
  const hour = hourlyRate(user)

  const normalPay = calc.normal * hour
  const extraPay = calc.extra * hour * state.config.extraHourMultiplier
  const holidayPay = calc.holidayHours * hour * state.config.holidayHourMultiplier

  return {
    hour,
    normalPay,
    extraPay,
    holidayPay,
    total: normalPay + extraPay + holidayPay,
  }
}

export function buildReport({
  userId,
  from,
  to,
}) {
  const users = state.users.filter(
(u) => (userId ? u.id === Number(userId) : u.role !== ROLES.ADMIN),
  )

  return users.map((user) => {
    const records = state.attendances.filter(
      (a) =>
        a.userId === user.id &&
        a.date >= from &&
        a.date <= to,
    )

    const reqs = state.requests.filter(
      (r) =>
        r.userId === user.id &&
        r.date >= from &&
        r.date <= to,
    )

    let lateCount = 0
    let extra = 0
    let holidayHours = 0
    let normal = 0
    let workedDays = 0

    records.forEach((rec) => {
      const calc = computeDay(rec, user)

      if (rec.late) lateCount += 1

      extra += calc.extra
      holidayHours += calc.holidayHours
      normal += calc.normal

      if (rec.checkIn) workedDays += 1
    })

    const authorizedAbsences = reqs.filter(
      (r) =>
        ['falta', 'permiso'].includes(r.type) &&
        r.status === 'aprobada',
    ).length

    const pending = reqs.filter(
      (r) => r.status === 'pendiente',
    ).length

    const rejected = reqs.filter(
      (r) => r.status === 'rechazada',
    ).length

    const pay = estimatePay(
      { normal, extra, holidayHours },
      user,
    )

    return {
      user,
      records,
      lateCount,
      extra: round2(extra),
      holidayHours: round2(holidayHours),
      normal: round2(normal),
      workedDays,
      authorizedAbsences,
      pending,
      rejected,
      pay,
    }
  })
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export function money(n) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(n || 0)
}

export function formatDateTime(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
