
import pool from '../config/database.js'

// Convierte un horario HH:mm a minutos.
function toMinutes(time) {
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return null
  }

  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// Prepara y valida la información del formulario.
function validateShift(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const start = body.start
  const end = body.end
  const breakMinutes = body.breakMinutes
  const weeklyDays = body.weeklyDays

  if (!name || name.length > 50) {
    return { error: 'El nombre del turno debe tener entre 1 y 50 caracteres.' }
  }

  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)

  if (startMinutes === null || endMinutes === null) {
    return { error: 'Las horas deben tener formato HH:mm.' }
  }

  if (startMinutes === endMinutes) {
    return { error: 'La hora de inicio y fin no pueden ser iguales.' }
  }

  if (!Number.isInteger(breakMinutes) || breakMinutes < 0) {
    return { error: 'Los minutos de descanso no son válidos.' }
  }

  if (
    !Array.isArray(weeklyDays) ||
    weeklyDays.length === 0 ||
    weeklyDays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(weeklyDays).size !== weeklyDays.length
  ) {
    return { error: 'Selecciona días laborales válidos y sin repetir.' }
  }

  // Permite turnos que terminan al día siguiente.
  const duration = (endMinutes - startMinutes + 1440) % 1440
  const effectiveMinutes = duration - breakMinutes

  if (effectiveMinutes <= 0) {
    return { error: 'El descanso debe ser menor que la duración del turno.' }
  }

  return {
    data: {
      name,
      start,
      end,
      breakMinutes,
      weeklyDays: [...weeklyDays].sort((a, b) => a - b),
      hours: Number((effectiveMinutes / 60).toFixed(2)),
    },
  }
}

// Convierte los campos de MariaDB al formato usado por React.
function mapShift(row) {
  let weeklyDays = []

  try {
    weeklyDays = Array.isArray(row.dias_laborales)
      ? row.dias_laborales
      : JSON.parse(row.dias_laborales || '[]')
  } catch {
    weeklyDays = []
  }

  return {
    id: row.id_turno,
    name: row.nombre,
    start: String(row.hora_inicio).slice(0, 5),
    end: String(row.hora_fin).slice(0, 5),
    hours: Number(row.horas_jornada),
    breakMinutes: row.minutos_descanso,
    weeklyDays,
    active: Boolean(row.activo),
  }
}

// GET /api/shifts
export async function listShifts(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id_turno, nombre, hora_inicio, hora_fin,
              horas_jornada, minutos_descanso,
              dias_laborales, activo
       FROM turno
       ORDER BY id_turno ASC`
    )

    res.json({
      ok: true,
      shifts: rows.map(mapShift),
    })
  } catch (error) {
    next(error)
  }
}

// POST /api/shifts
export async function createShift(req, res, next) {
  try {
    const validation = validateShift(req.body)

    if (validation.error) {
      return res.status(400).json({
        ok: false,
        message: validation.error,
      })
    }

    const shift = validation.data

    const [result] = await pool.execute(
      `INSERT INTO turno
       (nombre, hora_inicio, hora_fin, horas_jornada,
        activo, minutos_descanso, dias_laborales)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [
        shift.name,
        shift.start,
        shift.end,
        shift.hours,
        shift.breakMinutes,
        JSON.stringify(shift.weeklyDays),
      ]
    )

    const [rows] = await pool.execute(
      `SELECT id_turno, nombre, hora_inicio, hora_fin,
              horas_jornada, minutos_descanso,
              dias_laborales, activo
       FROM turno
       WHERE id_turno = ?`,
      [result.insertId]
    )

    res.status(201).json({
      ok: true,
      message: 'Turno registrado correctamente.',
      shift: mapShift(rows[0]),
    })
  } catch (error) {
    next(error)
  }
}