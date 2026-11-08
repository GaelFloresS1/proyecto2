/**
 * Módulo de persistencia simulada (localStorage).
 * Sustituye a BD_M&B para este prototipo visual: empleados, turnos,
 * asistencia, solicitudes, festivos, ajustes de nómina y bitácora.
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

  if (!response.ok || data.ok === false) {
    return {
      ok: false,
      message: data.message || `Error de autenticación (${response.status}).`,
    }
  }

  return { ok: true, ...data }
}

function mapEmployeeToUser(employee) {
  return {
    id: employee.id,
    username: employee.username,
    name: employee.name,
    role: employee.role,
    position: employee.position,

    // Estos datos todavía no vienen en publicEmployee del backend.
    salary: 0,
    shiftId: null,
    failedAttempts: 0,
    locked: false,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function applyAuthenticatedEmployee(employee) {
  const user = mapEmployeeToUser(employee)

  const existingIndex = state.users.findIndex(
    (item) =>
      String(item.id) === String(user.id) ||
      item.username?.toLowerCase() === user.username?.toLowerCase(),
  )

  if (existingIndex >= 0) {
    state.users.splice(existingIndex, 1)
  }

  state.users.push(user)
  state.sessionUserId = user.id

  commit({
    ...state,
    users: [...state.users],
  })

  return user
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
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach((fn) => fn(state))
}

export function patch(updater) {
  commit(updater({ ...state }))
}

export async function hashPassword(password) {
  const data = new TextEncoder().encode(password)
  const buffer = await crypto.subtle.digest('SHA-256', data)

  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
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

async function seedUser({ username, password, ...rest }) {
  return {
    id: uid('usr'),
    username,
    passwordHash: await hashPassword(password),
    failedAttempts: 0,
    locked: false,
    active: true,
    createdAt: '2026-09-01T10:00:00',
    updatedAt: '2026-09-01T10:00:00',
    ...rest,
  }
}

async function createSeed() {
  const admin = await seedUser({
    username: 'admin',
    password: 'Admin123!',
    name: 'Laura Méndez',
    role: ROLES.ADMIN,
    position: 'Administrador',
    salary: 22000,
    shiftId: 'shift_completo',
  })

  const rh = await seedUser({
    username: 'rh',
    password: 'Rh123456!',
    name: 'Patricia Soto',
    role: ROLES.RH,
    position: 'Recursos Humanos',
    salary: 18000,
    shiftId: 'shift_matutino',
  })

  const supervisor = await seedUser({
    username: 'supervisor',
    password: 'Super123!',
    name: 'Diego Navarro',
    role: ROLES.SUPERVISOR,
    position: 'Supervisor de área',
    salary: 16000,
    shiftId: 'shift_matutino',
  })

  const barista = await seedUser({
    username: 'barista',
    password: 'Barista1!',
    name: 'Camila Reyes',
    role: ROLES.EMPLEADO,
    position: 'Barista',
    salary: 9800,
    shiftId: 'shift_matutino',
  })

  const cajero = await seedUser({
    username: 'cajero',
    password: 'Cajero12!',
    name: 'Andrés Molina',
    role: ROLES.EMPLEADO,
    position: 'Cajero',
    salary: 10200,
    shiftId: 'shift_vespertino',
  })

  const capacitador = await seedUser({
    username: 'capacitador',
    password: 'Capacit1!',
    name: 'Sofía Herrera',
    role: ROLES.EMPLEADO,
    position: 'Capacitador',
    salary: 14000,
    shiftId: 'shift_completo',
  })

  const baja = await seedUser({
    username: 'martin',
    password: 'Martin12!',
    name: 'Martín Paz',
    role: ROLES.EMPLEADO,
    position: 'Barista',
    salary: 9500,
    shiftId: 'shift_matutino',
    active: false,
  })

  const shifts = [
    {
      id: 'shift_matutino',
      name: 'Matutino',
      start: '07:00',
      end: '15:00',
      breakMinutes: 30,
      weeklyDays: [1, 2, 3, 4, 5, 6],
    },
    {
      id: 'shift_vespertino',
      name: 'Vespertino',
      start: '14:00',
      end: '22:00',
      breakMinutes: 30,
      weeklyDays: [1, 2, 3, 4, 5, 6],
    },
    {
      id: 'shift_completo',
      name: 'Administrativo',
      start: '09:00',
      end: '18:00',
      breakMinutes: 60,
      weeklyDays: [1, 2, 3, 4, 5],
    },
  ]

  const holidays = [
    { id: uid('hol'), date: '2026-09-16', name: 'Día de la Independencia' },
    { id: uid('hol'), date: '2026-11-02', name: 'Día de Muertos' },
    { id: uid('hol'), date: '2026-12-25', name: 'Navidad' },
    { id: uid('hol'), date: '2026-10-16', name: 'Aniversario Macaron & Bakery' },
  ]

  const attendances = [
    attendance(barista.id, '2026-10-13', '07:02', '15:05', shifts[0]),
    attendance(barista.id, '2026-10-14', '07:18', '15:01', shifts[0]),
    attendance(barista.id, '2026-10-15', '06:58', '16:10', shifts[0]),
    attendance(barista.id, '2026-10-16', '07:04', '15:00', shifts[0]),
    attendance(barista.id, '2026-10-17', '07:41', '15:12', shifts[0]),
    attendance(cajero.id, '2026-10-13', '14:00', '22:04', shifts[1]),
    attendance(cajero.id, '2026-10-14', '14:22', '22:00', shifts[1]),
    attendance(cajero.id, '2026-10-15', '13:55', '23:05', shifts[1]),
    attendance(cajero.id, '2026-10-16', '14:03', '22:10', shifts[1]),
    attendance(capacitador.id, '2026-10-13', '08:58', '18:02', shifts[2]),
    attendance(capacitador.id, '2026-10-14', '09:00', '18:40', shifts[2]),
    attendance(capacitador.id, '2026-10-15', '09:12', '18:05', shifts[2]),
    attendance(supervisor.id, '2026-10-13', '06:50', '15:00', shifts[0]),
    attendance(supervisor.id, '2026-10-14', '06:55', '15:20', shifts[0]),
  ]

  const requests = [
    {
      id: uid('req'),
      userId: barista.id,
      type: 'justificacion',
      date: '2026-10-14',
      reason: 'Retraso por cierre vial en Av. Universidad. Adjunto captura del reporte de tráfico.',
      status: 'pendiente',
      createdAt: '2026-10-14T07:25:00',
      reviewerId: null,
      reviewNote: '',
    },
    {
      id: uid('req'),
      userId: cajero.id,
      type: 'permiso',
      date: '2026-10-20',
      reason: 'Cita médica de 16:00 a 18:00. Puedo cubrir apertura del turno.',
      status: 'pendiente',
      createdAt: '2026-10-18T11:10:00',
      reviewerId: null,
      reviewNote: '',
    },
    {
      id: uid('req'),
      userId: capacitador.id,
      type: 'falta',
      date: '2026-10-21',
      reason: 'Capacitación externa de proveedores de harina en Monterrey.',
      status: 'aprobada',
      createdAt: '2026-10-10T09:00:00',
      reviewerId: rh.id,
      reviewNote: 'Autorizado. Se considera falta justificada.',
    },
  ]

  return {
    sessionUserId: null,
    config: {
      company: 'Macaron & Bakery',
      graceMinutes: 10,
      extraHourMultiplier: 1.5,
      holidayHourMultiplier: 2,
      monthlyHours: 192,
    },
    users: [admin, rh, supervisor, barista, cajero, capacitador, baja],
    shifts,
    holidays,
    attendances,
    requests,
    auditLog: [
      {
        id: uid('log'),
        userId: rh.id,
        action: 'Aprobación de falta',
        entity: 'solicitud',
        previousValue: 'pendiente',
        newValue: 'aprobada',
        at: '2026-10-10T09:40:00',
      },
    ],
  }
}

function attendance(userId, date, checkIn, checkOut, shift) {
  const lateMinutes = Math.max(
    0,
    minutesOf(checkIn) - minutesOf(shift.start) - 10,
  )

  return {
    id: uid('att'),
    userId,
    date,
    checkIn,
    checkOut,
    source: 'sistema',
    late: lateMinutes > 0,
    lateMinutes,
    extraHoursOverride: null,
    holidayHoursOverride: null,
    notes: '',
  }
}
export async function bootstrap() {
  const raw = localStorage.getItem(KEY)

  if (raw) {
    try {
      state = JSON.parse(raw)
    } catch {
      state = await createSeed()
      localStorage.setItem(KEY, JSON.stringify(state))
    }
  } else {
    state = await createSeed()
    localStorage.setItem(KEY, JSON.stringify(state))
  }

  // La sesión válida proviene del backend, no de localStorage.
  state.sessionUserId = null

  const sessionResult = await authRequest('/me')

  if (sessionResult.ok && sessionResult.employee) {
    applyAuthenticatedEmployee(sessionResult.employee)
  } else {
    localStorage.setItem(KEY, JSON.stringify(state))
    listeners.forEach((fn) => fn(state))
  }

  return state
}

export async function resetDemo() {
  localStorage.removeItem(KEY)
  state = await createSeed()
  localStorage.setItem(KEY, JSON.stringify(state))
  listeners.forEach((fn) => fn(state))
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

export function isHoliday(date) {
  return state.holidays.some((h) => h.date === date)
}

export function holidayName(date) {
  return state.holidays.find((h) => h.date === date)?.name
}

// =====================================================
// AUTENTICACIÓN CON EL BACKEND
// =====================================================

export async function login(username, password) {
  const result = await authRequest('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
    }
  }

  if (!result.employee) {
    return {
      ok: false,
      message: 'El servidor no devolvió los datos del empleado.',
    }
  }

  const user = applyAuthenticatedEmployee(result.employee)

  return {
    ok: true,
    user,
  }
}

export async function getCurrentUser() {
  const result = await authRequest('/me')

  if (!result.ok || !result.employee) {
    if (state) {
      state.sessionUserId = null
      commit({ ...state })
    }

    return null
  }

  return applyAuthenticatedEmployee(result.employee)
}

export async function logout() {
  // Se limpia el estado local aunque el servidor no responda.
  if (state) {
    state.sessionUserId = null
    commit({ ...state })
  }

  await authRequest('/logout', {
    method: 'POST',
  })
}

// =====================================================
// RECUPERACIÓN SIMULADA DE CONTRASEÑA
// Todavía no está conectada con MySQL.
// =====================================================

export async function startPasswordRecovery(username) {
  const user = state.users.find(
    (u) =>
      u.username.toLowerCase() === username.trim().toLowerCase() &&
      u.active,
  )

  if (!user) {
    return {
      ok: false,
      message: 'No encontramos un usuario activo con ese nombre. Revisa la captura o acude con el administrador.',
    }
  }

  const code = String(
    Math.floor(100000 + Math.random() * 900000),
  )

  patch((draft) => {
    const target = draft.users.find((u) => u.id === user.id)

    target.recoveryCode = code
    target.recoveryExpires = Date.now() + 15 * 60 * 1000

    return draft
  })

  return {
    ok: true,
    code,
    message: 'Código de recuperación generado (simulación de correo). Caduca en 15 minutos.',
  }
}

export async function completePasswordRecovery({
  username,
  code,
  password,
}) {
  if (!password || password.length < 8) {
    return {
      ok: false,
      message: 'La nueva contraseña debe tener al menos 8 caracteres.',
    }
  }

  const user = state.users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
  )

  if (!user?.recoveryCode) {
    return {
      ok: false,
      message: 'Primero solicita un código de recuperación para este usuario.',
    }
  }

  if (user.recoveryExpires < Date.now()) {
    return {
      ok: false,
      message: 'El código caducó. Solicita uno nuevo.',
    }
  }

  if (user.recoveryCode !== code.trim()) {
    return {
      ok: false,
      message: 'El código no coincide. Revisa el número de 6 dígitos mostrado en la simulación.',
    }
  }

  const passwordHash = await hashPassword(password)

  patch((draft) => {
    const target = draft.users.find((u) => u.id === user.id)

    target.passwordHash = passwordHash
    target.locked = false
    target.failedAttempts = 0
    target.recoveryCode = null
    target.recoveryExpires = null

    addAudit(draft, {
      userId: user.id,
      action: 'Recuperación de contraseña',
      entity: 'usuario',
      previousValue: 'bloqueado/olvidado',
      newValue: 'contraseña restablecida',
    })

    return draft
  })

  return {
    ok: true,
    message: 'Contraseña actualizada. Ya puedes iniciar sesión.',
  }
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
export function clockIn(userId) {
  const user = getUser(userId)

  if (!user?.active) {
    return {
      ok: false,
      message: 'No se puede registrar asistencia de una cuenta inactiva.',
    }
  }

  const date = localISO()

  const existing = state.attendances.find(
    (a) => a.userId === userId && a.date === date,
  )

  if (existing?.checkIn) {
    return {
      ok: false,
      message: 'Ya registraste tu hora de entrada hoy. Si hay un error, RH puede corregirlo en reportes.',
    }
  }

  const now = new Date()
  const checkIn = hm(now)
  const shift = getShift(user.shiftId)

  const lateMinutes = shift
    ? Math.max(
        0,
        minutesOf(checkIn) -
          minutesOf(shift.start) -
          state.config.graceMinutes,
      )
    : 0

  patch((draft) => {
    draft.attendances.unshift({
      id: uid('att'),
      userId,
      date,
      checkIn,
      checkOut: null,
      source: 'sistema',
      late: lateMinutes > 0,
      lateMinutes,
      extraHoursOverride: null,
      holidayHoursOverride: null,
      notes: '',
    })

    return draft
  })

  const holiday = isHoliday(date)

  return {
    ok: true,
    late: lateMinutes > 0,
    lateMinutes,
    checkIn,
    clock: formatTime(now),
    holiday,
    message:
      lateMinutes > 0
        ? `Entrada registrada a las ${checkIn} (${lateMinutes} min de retardo). Puedes justificar el retardo.`
        : `Entrada registrada a las ${checkIn} con el reloj del sistema.`,
  }
}

export function clockOut(userId) {
  const date = localISO()

  const existing = state.attendances.find(
    (a) => a.userId === userId && a.date === date,
  )

  if (!existing?.checkIn) {
    return {
      ok: false,
      message: 'No hay una entrada abierta hoy. Primero registra la hora de entrada.',
    }
  }

  if (existing.checkOut) {
    return {
      ok: false,
      message: 'La salida de hoy ya está cerrada. RH puede ajustar el registro desde reportes si hace falta.',
    }
  }

  const now = new Date()
  const checkOut = hm(now)

  patch((draft) => {
    const rec = draft.attendances.find(
      (a) => a.id === existing.id,
    )

    rec.checkOut = checkOut

    return draft
  })

  return {
    ok: true,
    checkOut,
    clock: formatTime(now),
    message: `Salida registrada a las ${checkOut}. Las horas se calcularán automáticamente para nómina.`,
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

export async function saveEmployee(payload, actorId) {
  const {
    id,
    name,
    username,
    position,
    salary,
    password,
    shiftId,
    role,
    active,
  } = payload

  if (!name?.trim() || !username?.trim()) {
    return {
      ok: false,
      message: 'Nombre y usuario son obligatorios.',
    }
  }

  if (!id && (!password || password.length < 8)) {
    return {
      ok: false,
      message: 'La contraseña inicial debe tener mínimo 8 caracteres.',
    }
  }

  if (password && password.length < 8) {
    return {
      ok: false,
      message: 'La contraseña debe tener mínimo 8 caracteres.',
    }
  }

  const duplicate = state.users.find(
    (u) =>
      u.username.toLowerCase() === username.trim().toLowerCase() &&
      u.id !== id,
  )

  if (duplicate) {
    return {
      ok: false,
      message: 'Ese nombre de usuario ya está en uso. Elige otro.',
    }
  }

  const passwordHash = password
    ? await hashPassword(password)
    : null

  patch((draft) => {
    if (id) {
      const user = draft.users.find(
        (u) => u.id === id,
      )

      const previous = `${user.name} | ${user.position} | $${user.salary}`

      user.name = name.trim()
      user.username = username.trim()
      user.position = position
      user.role = role
      user.salary = Number(salary) || 0
      user.shiftId = shiftId
      user.active = active
      user.updatedAt = new Date().toISOString()

      if (passwordHash) {
        user.passwordHash = passwordHash
        user.locked = false
        user.failedAttempts = 0
      }

      addAudit(draft, {
        userId: actorId,
        action: 'Modificar empleado',
        entity: id,
        previousValue: previous,
        newValue: `${user.name} | ${user.position} | $${user.salary}`,
      })
    } else {
      const newId = uid('usr')

      draft.users.push({
        id: newId,
        username: username.trim(),
        passwordHash,
        name: name.trim(),
        role,
        position,
        salary: Number(salary) || 0,
        shiftId,
        failedAttempts: 0,
        locked: false,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })

      addAudit(draft, {
        userId: actorId,
        action: 'Alta de empleado',
        entity: newId,
        previousValue: '',
        newValue: name,
      })
    }

    return draft
  })

  return {
    ok: true,
    message: id
      ? 'Datos del personal actualizados.'
      : 'Empleado dado de alta.',
  }
}

export function deactivateEmployee(id, actorId) {
  const user = getUser(id)

  patch((draft) => {
    const target = draft.users.find(
      (u) => u.id === id,
    )

    target.active = false
    target.updatedAt = new Date().toISOString()

    addAudit(draft, {
      userId: actorId,
      action: 'Baja lógica de empleado',
      entity: id,
      previousValue: 'activo',
      newValue: 'inactivo',
    })

    return draft
  })

  return {
    ok: true,
    message: `${user.name} queda inactivo. Se conserva su historial de asistencia.`,
  }
}

export function saveShift(payload, actorId) {
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

  patch((draft) => {
    if (id) {
      const shift = draft.shifts.find(
        (s) => s.id === id,
      )

      const previous = `${shift.name} ${shift.start}-${shift.end}`

      Object.assign(shift, {
        name: name.trim(),
        start,
        end,
        breakMinutes: Number(breakMinutes) || 0,
        weeklyDays,
      })

      addAudit(draft, {
        userId: actorId,
        action: 'Modificar turno',
        entity: id,
        previousValue: previous,
        newValue: `${name} ${start}-${end}`,
      })
    } else {
      const newId = uid('shift')

      draft.shifts.push({
        id: newId,
        name: name.trim(),
        start,
        end,
        breakMinutes: Number(breakMinutes) || 0,
        weeklyDays,
      })

      addAudit(draft, {
        userId: actorId,
        action: 'Alta de turno',
        entity: newId,
        previousValue: '',
        newValue: `${name} ${start}-${end}`,
      })
    }

    return draft
  })

  return {
    ok: true,
    message: 'Horario / turno guardado.',
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
    (u) => (userId ? u.id === userId : u.role !== ROLES.ADMIN),
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

export function roleFromPosition(position) {
  if (position === 'Administrador') return ROLES.ADMIN
  if (position === 'Recursos Humanos') return ROLES.RH
  if (position === 'Supervisor de área') return ROLES.SUPERVISOR

  return ROLES.EMPLEADO
}