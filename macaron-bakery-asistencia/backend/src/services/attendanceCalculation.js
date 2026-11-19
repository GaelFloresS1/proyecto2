const secondsPerDay = 24 * 60 * 60

// Las fechas del horario son civiles y provienen de MariaDB. La duración
// real se calcula con los segundos Unix del reloj de la misma conexión.
function civilSeconds(dateTime) {
  return Date.parse(dateTime.replace(' ', 'T') + 'Z') / 1000
}

export function addDays(date, count) {
  return new Date((civilSeconds(`${date} 00:00:00`) + secondsPerDay * count) * 1000)
    .toISOString().slice(0, 10)
}

function timeSeconds(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) return NaN
  const [hours, minutes, seconds] = time.split(':').map(Number)
  return hours * 3600 + minutes * 60 + seconds
}

function workingDays(value) {
  try {
    const days = Array.isArray(value) ? value : JSON.parse(value)
    if (Array.isArray(days) && days.length && days.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
      return days
    }
  } catch {
    // Un horario sin días verificables queda pendiente de clasificación.
  }
  return []
}

function weekday(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay()
}

export function entryContext(clock, shift) {
  const date = clock.local.slice(0, 10)
  const context = { version: 1, date, enteredAt: clock.epoch, closeThrough: date, status: 'sin_turno' }
  if (!shift?.activo) return context

  const start = timeSeconds(shift.hora_inicio)
  const end = timeSeconds(shift.hora_fin)
  const rest = shift.minutos_descanso * 60
  const duration = (end - start + secondsPerDay) % secondsPerDay
  const days = workingDays(shift.dias_laborales)
  if (!Number.isInteger(shift.minutos_descanso) || rest < 0 || !(duration > rest) || !days.length) {
    return { ...context, status: 'turno_invalido' }
  }

  const overnight = end < start
  const yesterday = addDays(date, -1)
  const scheduledDate = overnight && timeSeconds(clock.local.slice(11)) < end && days.includes(weekday(yesterday))
    ? yesterday
    : date

  if (!days.includes(weekday(scheduledDate))) return { ...context, status: 'turno_no_aplicable' }

  return {
    ...context,
    date: scheduledDate,
    closeThrough: overnight ? addDays(scheduledDate, 1) : scheduledDate,
    status: 'pendiente',
    shiftId: shift.id_turno,
    startsAt: `${scheduledDate} ${shift.hora_inicio}`,
    rest,
    scheduledSeconds: duration - rest,
  }
}

export function withLateness(context, clock, tolerance) {
  if (!context.startsAt) return context
  const overTolerance = civilSeconds(clock.local) - civilSeconds(context.startsAt) - tolerance * 60
  return { ...context, tolerance, lateMinutes: Math.max(0, Math.ceil(overTolerance / 60)) }
}

export function adjustmentContext(entry, clock) {
  const date = clock.local.slice(0, 10)
  if (!entry) return { date, context: null }

  // El contexto solo acredita el horario de la jornada original. Una
  // madrugada anterior al fin programado sigue siendo parte de ese turno.
  const start = entry.startsAt ? civilSeconds(entry.startsAt) : NaN
  const end = start + entry.scheduledSeconds + entry.rest
  const sameOvernight = entry.status === 'pendiente' && entry.closeThrough !== entry.date &&
    date === entry.closeThrough && civilSeconds(clock.local) < end
  if (date !== entry.date && !sameOvernight) return { date, context: null }

  return { date: entry.date, context: { ...entry, enteredAt: clock.epoch } }
}

export function attendanceState(row, clock) {
  if (!row.entrada_local || !Number.isFinite(civilSeconds(row.entrada_local))) return 'incompleto'
  const context = row.entry
  if (row.salida_local) {
    const civilElapsed = civilSeconds(row.salida_local) - civilSeconds(row.entrada_local)
    const observedElapsed = row.result?.elapsedSeconds
    const elapsed = Number.isInteger(observedElapsed) ? observedElapsed : civilElapsed
    return Number.isFinite(civilElapsed) && elapsed > 0 ? 'cerrado' : 'incompleto'
  }

  const date = clock.local.slice(0, 10)
  const withinDates = date >= row.entrada_local.slice(0, 10) && date <= (context?.closeThrough ?? row.fecha_local)
  const elapsed = context ? clock.epoch - context.enteredAt : civilSeconds(clock.local) - civilSeconds(row.entrada_local)
  const withinDuration = elapsed >= 0 && elapsed < secondsPerDay
  return withinDates && withinDuration ? 'abierto' : 'incompleto'
}

export function closeCalculation(entry, clock, hasHoliday) {
  if (!entry) return { status: 'sin_contexto' }
  const elapsed = clock.epoch - entry.enteredAt
  if (!Number.isInteger(elapsed) || elapsed <= 0 || elapsed >= secondsPerDay) return { status: 'incompleto' }
  if (entry.status !== 'pendiente') return { status: entry.status }
  if (hasHoliday) return { status: 'festivo_pendiente' }
  if (!Number.isInteger(entry.rest) || entry.rest < 0) return { status: 'descanso_pendiente' }
  if (!Number.isInteger(entry.scheduledSeconds) || entry.scheduledSeconds <= 0 || entry.scheduledSeconds >= secondsPerDay) {
    return { status: 'turno_invalido' }
  }

  const deductedRest = Math.min(entry.rest, elapsed)
  const workedSeconds = elapsed - deductedRest
  const hundredths = seconds => Math.round(seconds * 100 / 3600)
  const normalHundredths = hundredths(Math.min(workedSeconds, entry.scheduledSeconds))
  return {
    status: 'calculado',
    workedSeconds,
    normal: normalHundredths / 100,
    extra: (hundredths(workedSeconds) - normalHundredths) / 100,
    holiday: 0,
  }
}
