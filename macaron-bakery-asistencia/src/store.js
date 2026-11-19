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

export const REQUEST_LABEL = {
  permiso: 'Permiso de salida',
  falta: 'Solicitud de falta',
  justificacion: 'Justificación de retardo',
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
let attendanceRevision = 0

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

  if (!response.ok || data?.ok !== true) {
    return {
      ok: false,
      message: data?.message || `Error de asistencia (${response.status}).`,
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
function mapAttendanceRow(row, userId = row.id_empleado) {
  const entry = row.entrada_local ?? row.fecha_hora_entrada
  const exit = row.salida_local ?? row.fecha_hora_salida

  return {
    id: row.id_asistencia,
    userId,
    date: row.fecha_local ?? dbDateToISO(row.fecha),
    entryAt: row.entrada_local ?? '',
    exitAt: row.salida_local ?? '',
    entryDate: dbDateToISO(entry),
    exitDate: dbDateToISO(exit),
    checkIn: dbTimeToHM(entry),
    checkOut: dbTimeToHM(exit),
    source: 'sistema',
    status: row.estado,
    calculationStatus: row.estado_calculo,
    normalHours: row.horas_normales,
    extraHours: row.horas_extra,
    holidayHours: row.horas_festiva,
    isHoliday: row.es_festivo === true,
    late: Boolean(row.retardo),
    lateMinutes: row.minutos_retardo ?? null,
    graceMinutes: row.minutos_tolerancia ?? null,
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
  const { config, attendances, auditLog } = next
  try {
    localStorage.setItem(KEY, JSON.stringify({ config, attendances, auditLog }))
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

export function hm(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
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
    attendances: [],
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
      attendances: withoutDemoUsers(stored.attendances),
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

// =====================================================
// ASISTENCIA CONECTADA A MYSQL
// =====================================================

export async function loadMyAttendance() {
  const user = getUser()
  if (!user) return { ok: false, message: 'No hay un empleado con sesión activa.' }

  const version = sessionVersion
  const revision = attendanceRevision
  const result = await attendanceRequest('/history')
  if (!result.ok) return result

  const records = (result.attendances || []).map(row => mapAttendanceRow(row, user.id))
  if (version === sessionVersion && revision === attendanceRevision) {
    patch(draft => ({
      ...draft,
      attendances: [...records, ...draft.attendances.filter(record => record.userId !== user.id)],
    }))
  }
  return { ok: true, attendances: records }
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

  return '/empleado'
}

export function canAccess(role, area) {
  if (role === ROLES.ADMIN) return true
  if (role === ROLES.RH) return ['rh', 'rh-inbox', 'empleado'].includes(area)

  return area === 'empleado'
}


async function registerAttendance(userId, path) {
  const user = getUser(userId)
  if (!user?.active || user.id !== getUser()?.id) {
    return { ok: false, message: 'El marcaje requiere una sesión activa del empleado.' }
  }

  const version = sessionVersion
  const result = await attendanceRequest(path, { method: 'POST' })
  if (!result.ok) return result

  const record = mapAttendanceRow(result.attendance, user.id)
  if (version === sessionVersion) {
    attendanceRevision += 1
    patch(draft => ({
      ...draft,
      attendances: [record, ...draft.attendances.filter(row => row.id !== record.id)],
    }))
  }
  return { ok: true, record, message: result.message }
}

export async function clockIn(userId) {
  const result = await registerAttendance(userId, '/clock-in')
  if (!result.ok) return result

  const { checkIn, late, lateMinutes } = result.record
  return {
    ...result,
    checkIn,
    late,
    lateMinutes,
    message: late && lateMinutes !== null
      ? `Entrada registrada a las ${checkIn} (${lateMinutes} min después de la tolerancia).`
      : result.message,
  }
}

export async function clockOut(userId) {
  const result = await registerAttendance(userId, '/clock-out')
  return result.ok ? { ...result, checkOut: result.record.checkOut } : result
}

export function loadMyRequests() {
  return adminRequest('requests', 'solicitudes', '')
}

export function createRequest({ type, date, exitTime, attendanceId, reason }) {
  const justification = type === 'justificacion'
  const body = justification ? { attendanceId, reason } : { type, date, exitTime, reason }
  return adminRequest('requests', 'solicitudes', justification ? '/justifications' : '', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function loadReviewRequests(status) {
  const query = new URLSearchParams({ status })
  return adminRequest('requests', 'solicitudes', `/review?${query}`)
}

export function reviewRequest({ requestId, type, decision, note }) {
  return adminRequest('requests', 'solicitudes',
    `/review/${encodeURIComponent(type)}/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ decision, note }),
    })
}

export function loadHolidays() {
  return adminRequest('holidays', 'festivos', '')
}

export function upsertHoliday({ id, date, description }) {
  return adminRequest('holidays', 'festivos', id ? `/${encodeURIComponent(id)}` : '', {
    method: id ? 'PUT' : 'POST',
    body: JSON.stringify({ date, description }),
  })
}

export function removeHoliday(id) {
  return adminRequest('holidays', 'festivos', `/${encodeURIComponent(id)}`, { method: 'DELETE' })
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

export async function loadAdjustableAttendance({ from, to, userId }) {
  const query = new URLSearchParams({ from, to })
  if (userId) query.set('employeeId', userId)
  const result = await attendanceRequest(`/adjustments?${query}`)
  if (!result.ok) return result
  return { ok: true, records: result.attendances.map(row => mapAttendanceRow(row)) }
}

export async function adjustAttendance({ attendanceId, entryAt, exitAt, reason }) {
  const result = await attendanceRequest(`/adjustments/${encodeURIComponent(attendanceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ entryAt, exitAt, reason }),
  })
  if (!result.ok) return result
  return { ...result, attendance: mapAttendanceRow(result.attendance) }
}

export function computeDay(record) {
  // Las horas de MariaDB representan el turno que regía en el marcaje.
  const available = record.status === 'cerrado' && ['calculado', 'historico'].includes(record.calculationStatus)
  const normal = available ? Number(record.normalHours) : 0
  const extra = available ? Number(record.extraHours) : 0
  const holidayHours = available ? Number(record.holidayHours) : 0
  return { worked: round2(normal + extra + holidayHours), normal, extra, holidayHours, holiday: holidayHours > 0 }
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
  attendances = state.attendances,
}) {
  const users = state.users.filter(
(u) => (userId ? u.id === Number(userId) : u.role !== ROLES.ADMIN),
  )

  return users.map((user) => {
    const records = attendances.filter(
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
      const calc = computeDay(rec)

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
