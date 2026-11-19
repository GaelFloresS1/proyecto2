import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import pool from '../src/config/database.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import holidayRoutes from '../src/routes/holidayRoutes.js'

// Ejecutar desde backend con ATTENDANCE_TEST_MARIADB=1. Los marcajes y el
// calendario de prueba solo existen en tablas temporales de esta conexión.
test('calendario festivo y asistencia con MariaDB', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    await db.query('SET timestamp = DEFAULT')
    db.release()
    await pool.end()
  })
  for (const table of ['turno', 'empleado', 'asistencia', 'bitacora', 'config_nomina', 'festivo']) {
    const [[definition]] = await db.query(`SHOW CREATE TABLE ${table}`)
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function addShift(name, start, end, dailyHours) {
    const [result] = await db.execute(
      `INSERT INTO turno (nombre,hora_inicio,hora_fin,horas_jornada,minutos_descanso,dias_laborales)
       VALUES (?,?,?,?,30,'[1,2,3,4,5,6]')`,
      [name, start, end, dailyHours],
    )
    return result.insertId
  }

  async function addEmployee(name, roleName, shiftId = null) {
    const [[role]] = await db.execute('SELECT id_rol FROM rol WHERE nombre = ?', [roleName])
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario,nombre_completo,contrasena,puesto,sueldo_base,id_rol,id_turno,fecha_alta)
       VALUES (?,?,'prueba','Pruebas',1000,?,?,CURDATE())`,
      [name, name, role.id_rol, shiftId],
    )
    return result.insertId
  }

  const dayShift = await addShift('Diurno de prueba', '08:00', '17:00', 8.5)
  const nightShift = await addShift('Nocturno de prueba', '22:00', '06:00', 7.5)
  const hr = await addEmployee('festivos_rh', 'Recursos Humanos')
  const admin = await addEmployee('festivos_admin', 'Administrador')
  const supervisor = await addEmployee('festivos_supervisor', 'Supervisor')
  const worker = await addEmployee('festivos_diurno', 'Empleado', dayShift)
  const nightWorker = await addEmployee('festivos_nocturno', 'Empleado', nightShift)

  let failAudit = false
  const adapter = {
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
    query: db.query.bind(db),
    release() {},
    async execute(sql, args) {
      if (failAudit && sql.trimStart().startsWith('INSERT INTO bitacora')) {
        throw new Error('Fallo de bitácora de prueba')
      }
      return db.execute(sql, args)
    },
  }
  t.mock.method(pool, 'getConnection', async () => adapter)
  t.mock.method(pool, 'execute', db.execute.bind(db))
  t.mock.method(pool, 'query', db.query.bind(db))

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const employeeId = Number(req.get('x-test-employee'))
    req.session = employeeId ? { employee: { id: employeeId } } : {}
    next()
  })
  app.use('/api/holidays', holidayRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())))

  async function request(path, { actor = hr, method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'x-test-employee': String(actor),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body && JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }

  async function setClock(value) {
    await db.execute('SET timestamp = UNIX_TIMESTAMP(?)', [value])
    const [[clock]] = await db.query('SELECT CAST(NOW() AS CHAR) AS local')
    assert.equal(clock.local, value)
  }

  async function mark(actor, action, at, status) {
    await setClock(at)
    const result = await request('/api/attendance/' + action, { actor, method: 'POST' })
    assert.equal(result.status, status, result.data.message)
    return result.data.attendance
  }

  async function audit(holidayId) {
    const [rows] = await db.execute(
      `SELECT id_usuario, fecha_hora, accion, campo, valor_anterior, valor_nuevo
         FROM bitacora WHERE entidad = 'festivo' AND id_registro_afectado = ?
         ORDER BY id_bitacora`,
      [holidayId],
    )
    return rows
  }

  const path = '/api/holidays'
  const createdValues = { date: '2026-11-16', description: 'Festivo de prueba' }
  const updatedValues = { date: '2026-11-17', description: 'Fecha festiva corregida' }
  let first
  let second
  let festiveDay

  await t.test('consulta autenticada y escrituras con FESTIVO_GESTIONAR', async () => {
    assert.equal((await request(path, { actor: 0 })).status, 401)
    const list = await request(path, { actor: worker })
    assert.deepEqual(list.data, { ok: true, holidays: [], canManage: false })
    assert.equal((await request(path, { actor: supervisor })).data.canManage, false)
    assert.equal((await request(path, { actor: hr })).data.canManage, true)
    assert.equal((await request(path, { actor: admin })).data.canManage, true)
    assert.equal((await request(path, { actor: worker, method: 'POST', body: createdValues })).status, 403)
    assert.equal((await request(`${path}/1`, { actor: supervisor, method: 'PUT', body: createdValues })).status, 403)
    assert.equal((await request(`${path}/1`, { actor: worker, method: 'DELETE' })).status, 403)
  })

  await t.test('alta válida y rechazo de fecha imposible, descripción inválida o fecha duplicada', async () => {
    for (const body of [
      { ...createdValues, date: '2026-02-29' },
      { ...createdValues, description: '   ' },
      { ...createdValues, description: 'x'.repeat(101) },
    ]) assert.equal((await request(path, { method: 'POST', body })).status, 400)
    const created = await request(path, { method: 'POST', body: createdValues })
    assert.equal(created.status, 201, created.data.message)
    first = created.data.holiday
    assert.deepEqual(first, { id: first.id, ...createdValues })
    assert.equal((await request(path, { actor: admin, method: 'POST', body: createdValues })).status, 409)
    assert.equal((await audit(first.id)).length, 2)
  })

  await t.test('las funciones usadas por React consultan y editan y una recarga lee MariaDB', async browser => {
    const fetchHttp = globalThis.fetch
    browser.mock.method(globalThis, 'fetch', (url, options) => fetchHttp(base + url, {
      ...options, headers: { ...options.headers, 'x-test-employee': String(admin) },
    }))
    const { loadHolidays, upsertHoliday } = await import('../../src/store.js')
    assert.deepEqual((await loadHolidays()).holidays, [first])
    const changed = await upsertHoliday({ id: first.id, ...updatedValues })
    assert.equal(changed.ok, true, changed.message)
    assert.deepEqual(changed.holiday, { id: first.id, ...updatedValues })
    const reloaded = await import('../../src/store.js?calendarReload')
    assert.deepEqual((await reloaded.loadHolidays()).holidays, [changed.holiday])
  })

  await t.test('edición duplicada rechazada y reversión si falla bitácora', async () => {
    const other = await request(path, { method: 'POST', body: { date: '2026-11-18', description: 'Segundo festivo' } })
    assert.equal(other.status, 201)
    second = other.data.holiday
    const selected = `${path}/${first.id}`
    assert.equal((await request(selected, { method: 'PUT', body: second })).status, 400)
    const duplicate = { date: second.date, description: updatedValues.description }
    assert.equal((await request(selected, { method: 'PUT', body: duplicate })).status, 409)
    failAudit = true
    try {
      const failed = await request(selected, { method: 'PUT', body: { ...updatedValues, description: 'Cambio revertido' } })
      assert.equal(failed.status, 500)
      assert.equal(failed.data.message, 'Fallo de bitácora de prueba')
    } finally {
      failAudit = false
    }
    assert.deepEqual((await request(path)).data.holidays[0], { id: first.id, ...updatedValues })
    const events = await audit(first.id)
    assert.equal(events.length, 4)
    assert(events.every(event => event.fecha_hora instanceof Date))
    assert.deepEqual(events.map(({ id_usuario, accion, campo, valor_anterior, valor_nuevo }) =>
      [id_usuario, accion, campo, valor_anterior, valor_nuevo]), [
      [hr, 'ALTA', 'fecha', null, createdValues.date],
      [hr, 'ALTA', 'descripcion', null, createdValues.description],
      [admin, 'CAMBIO', 'fecha', createdValues.date, updatedValues.date],
      [admin, 'CAMBIO', 'descripcion', createdValues.description, updatedValues.description],
    ])
  })

  function assertFestivePending(row) {
    assert.equal(row.estado_calculo, 'festivo_pendiente')
    assert.equal(row.es_festivo, true)
    assert.deepEqual([row.horas_normales, row.horas_extra, row.horas_festiva], [0, 0, 0])
  }

  await t.test('una jornada festiva se identifica y queda sin clasificar horas', async () => {
    await mark(worker, 'clock-in', '2026-11-17 08:00:00', 201)
    festiveDay = await mark(worker, 'clock-out', '2026-11-17 18:30:00', 200)
    assertFestivePending(festiveDay)
  })

  await t.test('baja auditada y recarga del historial conservan la detección del festivo original', async () => {
    const deleted = await request(`${path}/${first.id}`, { actor: admin, method: 'DELETE' })
    assert.equal(deleted.status, 200, deleted.data.message)
    assert.deepEqual((await request(path, { actor: worker })).data.holidays, [second])
    assert.equal((await request(`${path}/${first.id}`, { method: 'DELETE' })).status, 404)
    const events = await audit(first.id)
    assert.deepEqual(events.slice(-2).map(({ id_usuario, accion, campo, valor_anterior, valor_nuevo }) =>
      [id_usuario, accion, campo, valor_anterior, valor_nuevo]), [
      [admin, 'BAJA', 'fecha', updatedValues.date, null],
      [admin, 'BAJA', 'descripcion', updatedValues.description, null],
    ])
    const history = await request('/api/attendance/history', { actor: worker })
    assert.equal(history.data.attendances[0].id_asistencia, festiveDay.id_asistencia)
    assertFestivePending(history.data.attendances[0])
  })

  await t.test('un turno nocturno identifica la coincidencia en ambos sentidos', async () => {
    for (const [entry, exit] of [
      ['2026-11-17 22:00:00', '2026-11-18 06:00:00'],
      ['2026-11-18 22:00:00', '2026-11-19 06:00:00'],
    ]) {
      const opened = await mark(nightWorker, 'clock-in', entry, 201)
      const closed = await mark(nightWorker, 'clock-out', exit, 200)
      assert.equal(closed.id_asistencia, opened.id_asistencia)
      assert.equal(closed.fecha_local, entry.slice(0, 10))
      assertFestivePending(closed)
    }
  })

  await t.test('salir justo a medianoche anterior al festivo no incluye tiempo del festivo', async () => {
    const created = await request(path, { method: 'POST', body: { date: '2026-11-20', description: 'Festivo posterior' } })
    assert.equal(created.status, 201)
    await mark(nightWorker, 'clock-in', '2026-11-19 22:00:00', 201)
    const closed = await mark(nightWorker, 'clock-out', '2026-11-20 00:00:00', 200)
    assert.equal(closed.estado_calculo, 'calculado')
    assert.equal(closed.es_festivo, false)
    assert.deepEqual([closed.horas_normales, closed.horas_extra, closed.horas_festiva], [1.5, 0, 0])
  })
})
