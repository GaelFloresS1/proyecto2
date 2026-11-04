import pool from '../config/database.js'

export async function today(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id_asistencia, fecha, fecha_hora_entrada, fecha_hora_salida,
              retardo, horas_normales, horas_extra, horas_festiva
         FROM asistencia
        WHERE id_empleado = ? AND fecha = CURDATE()
        LIMIT 1`,
      [req.session.employee.id],
    )
    res.json({ ok: true, attendance: rows[0] || null })
  } catch (error) {
    next(error)
  }
}

export async function clockIn(req, res, next) {
  const connection = await pool.getConnection()
  try {
    const employeeId = req.session.employee.id
    await connection.beginTransaction()

    const [existing] = await connection.execute(
      'SELECT id_asistencia, fecha_hora_entrada, fecha_hora_salida FROM asistencia WHERE id_empleado = ? AND fecha = CURDATE() FOR UPDATE',
      [employeeId],
    )

    if (existing.length && existing[0].fecha_hora_entrada) {
      await connection.rollback()
      return res.status(409).json({ ok: false, message: 'Ya registraste tu entrada hoy.' })
    }

    if (existing.length) {
      await connection.execute(
        'UPDATE asistencia SET fecha_hora_entrada = NOW() WHERE id_asistencia = ?',
        [existing[0].id_asistencia],
      )
    } else {
      await connection.execute(
        `INSERT INTO asistencia
          (fecha, fecha_hora_entrada, id_empleado)
         VALUES (CURDATE(), NOW(), ?)`,
        [employeeId],
      )
    }

    const [rows] = await connection.execute(
      `SELECT id_asistencia, fecha, fecha_hora_entrada, fecha_hora_salida
         FROM asistencia WHERE id_empleado = ? AND fecha = CURDATE() LIMIT 1`,
      [employeeId],
    )
    await connection.commit()
    res.status(201).json({ ok: true, message: 'Entrada registrada correctamente.', attendance: rows[0] })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, message: 'Ya existe una asistencia para hoy.' })
    }
    next(error)
  } finally {
    connection.release()
  }
}

export async function clockOut(req, res, next) {
  try {
    const employeeId = req.session.employee.id
    const [result] = await pool.execute(
      `UPDATE asistencia
          SET fecha_hora_salida = NOW()
        WHERE id_empleado = ?
          AND fecha = CURDATE()
          AND fecha_hora_entrada IS NOT NULL
          AND fecha_hora_salida IS NULL`,
      [employeeId],
    )

    if (result.affectedRows !== 1) {
      return res.status(409).json({ ok: false, message: 'No hay una entrada pendiente de salida para hoy.' })
    }

    const [rows] = await pool.execute(
      `SELECT id_asistencia, fecha, fecha_hora_entrada, fecha_hora_salida
         FROM asistencia WHERE id_empleado = ? AND fecha = CURDATE() LIMIT 1`,
      [employeeId],
    )
    res.json({ ok: true, message: 'Salida registrada correctamente.', attendance: rows[0] })
  } catch (error) {
    next(error)
  }
}

export async function history(req, res, next) {
  try {
    const [rows] = await pool.execute(
      `SELECT id_asistencia, fecha, fecha_hora_entrada, fecha_hora_salida,
              retardo, horas_normales, horas_extra, horas_festiva
         FROM asistencia
        WHERE id_empleado = ?
        ORDER BY fecha DESC
        LIMIT 30`,
      [req.session.employee.id],
    )
    res.json({ ok: true, attendances: rows })
  } catch (error) {
    next(error)
  }
}
