const hidden = '[Oculto]'

const confidentialLabels = [
  /password|passwd|passphrase|contrasen|credential|credencial|secret|cookie|session|sesion|token/i,
  /authorization|autorizacion\s*[:=]|bearer|api[\s_-]*key|private[\s_-]*key|clave(?: (?:privada|de acceso)|\s*[:=])/i,
  /\b(?:pwd|jwt|mb\.sid|connect\.sid|sueldo|salario|telefono|domicilio|rfc|curp|nss|clabe)\b/i,
]
const confidentialFormats = [
  /[^\s@]+@[^\s@]+\.[^\s@]+|:\/\/[^\s:/]+:[^\s@/]+@/,
  /\b(?:gh[pousr]_|github_pat_|sk-[A-Za-z0-9])|\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /[0-9A-Fa-f]{32,}|\b[A-Za-z0-9+/=_-]{32,}\b|\$2[aby]\$|-----BEGIN|(?:^|\s)[A-Z][A-Z0-9_]+=[^\s]/,
]

function publicText(value) {
  if (typeof value !== 'string' || /^[{["]/.test(value.trimStart())) return false
  const normalized = value.normalize('NFD').replace(/\p{M}/gu, '')
  return !confidentialLabels.some(pattern => pattern.test(normalized)) &&
    !confidentialFormats.some(pattern => pattern.test(value))
}

const numeric = value => (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && /^-?\d{1,12}(?:\.\d{1,4})?$/.test(value))
const flag = value => [true, false, 0, 1, '0', '1'].includes(value)
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const time = value => typeof value === 'string' && /^\d{2}:\d{2}(?::\d{2})?$/.test(value)
const dateTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/.test(value)
const weekdayList = value => Array.isArray(value) && value.length <= 7 && value.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
const states = new Set([
  'pendiente', 'aprobada', 'rechazada', 'abierto', 'cerrado', 'incompleto', 'calculado',
  'sin_turno', 'sin_contexto', 'fecha_sin_contexto', 'turno_invalido', 'turno_no_aplicable',
  'festivo_pendiente', 'descanso_pendiente', 'horas_pendientes', 'historico_sin_calculo', 'historico',
  'PENDIENTE', 'AUTORIZADA', 'RECHAZADA', 'ACEPTADO', 'RECHAZADO',
])
const state = value => states.has(value)
const type = value => ['permiso', 'falta', 'justificacion', 'PERMISO_SALIDA', 'FALTA'].includes(value)

const employee = {
  nombre_completo: publicText, puesto: publicText, id_empleado: numeric, id_rol: numeric, id_turno: numeric,
  fecha_alta: date, fecha_baja: date, fecha_ultima_modificacion: date, activo: flag, bloqueado: flag,
}
const shift = {
  nombre: publicText, id_turno: numeric, hora_inicio: time, hora_fin: time, horas_jornada: numeric,
  minutos_descanso: numeric, dias_laborales: [weekdayList], activo: flag,
}
const holiday = { id_festivo: numeric, fecha: date, descripcion: publicText }
const attendance = {
  fecha: date, fecha_hora_entrada: dateTime, fecha_hora_salida: dateTime,
  horas_normales: numeric, horas_extra: numeric, horas_festiva: numeric, retardo: flag,
  contexto_jornada: {
    version: numeric, date, enteredAt: numeric, closeThrough: date, status: state, shiftId: numeric,
    startsAt: dateTime, rest: numeric, scheduledSeconds: numeric, tolerance: numeric, lateMinutes: numeric,
  },
  calculo_jornada: {
    version: numeric, status: state, festivo: flag, elapsedSeconds: numeric, workedSeconds: numeric,
    fecha: date, entrada: dateTime, salida: dateTime, retardo: flag, normales: numeric,
    extra: numeric, festivas: numeric, lateMinutes: numeric,
  },
}
const request = {
  estado: state, tipo: type, fecha_permiso: date, hora_salida: time, fecha_resolucion: dateTime,
  id_resuelto_por: numeric,
  solicitud: { tipo: type, fecha: date, horaSalida: time, idAsistencia: numeric, estado: state },
  resolucion: { estado: state, fecha_resolucion: dateTime, id_resuelto_por: numeric },
}
const absence = {
  fecha: date, autorizada: flag, id_solicitud: numeric, id_validada_por: numeric,
  autorizacion: { id_falta: numeric, fecha: date, id_empleado: numeric, autorizada: flag, id_solicitud: numeric, id_validada_por: numeric },
}

const schemas = new Map([
  ['empleado', employee], ['turno', shift], ['festivo', holiday], ['asistencia', attendance],
  ['solicitud_permiso', request], ['justificante', request], ['falta', absence],
])

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function project(value, schema) {
  if (value === null) return null
  if (typeof schema === 'function') return schema(value) ? value : hidden
  if (Array.isArray(schema)) return schema[0](value) ? value : hidden
  if (!isObject(value)) return hidden
  const fields = Object.entries(schema).filter(([key]) => Object.hasOwn(value, key))
  if (fields.length === 0) return hidden
  return Object.fromEntries(fields.map(([key, rule]) => [key, project(value[key], rule)]))
}

function publicValue(value, schema) {
  if (value === null) return null
  if (!schema) return hidden
  if (typeof schema === 'function') {
    return schema(value) ? value : hidden
  }
  try {
    const visible = project(JSON.parse(value), schema)
    return visible === hidden ? hidden : JSON.stringify(visible)
  } catch {
    return hidden
  }
}

function identifier(value) {
  if (value === null) return null
  return /^[\p{L}\p{N}_ -]{1,50}$/u.test(value) ? value : hidden
}

export function publicAuditMovement(row) {
  const entity = schemas.get(row.entity)
  const schema = entity && (row.field === null ? entity : Object.hasOwn(entity, row.field) ? entity[row.field] : undefined)
  return {
    id: row.id,
    at: row.at,
    employeeId: row.employeeId,
    employeeName: publicText(row.employeeName) ? row.employeeName : null,
    action: row.action,
    entity: identifier(row.entity),
    recordId: row.recordId,
    field: identifier(row.field),
    previousValue: publicValue(row.previousValue, schema),
    newValue: publicValue(row.newValue, schema),
    reason: row.reason === null ? null : schema && publicText(row.reason) ? row.reason : hidden,
  }
}
