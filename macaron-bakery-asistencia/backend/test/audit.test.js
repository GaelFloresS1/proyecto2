import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import session from 'express-session'
import pool from '../src/config/database.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import auditRoutes from '../src/routes/auditRoutes.js'
import authRoutes from '../src/routes/authRoutes.js'
import holidayRoutes from '../src/routes/holidayRoutes.js'
import requestRoutes from '../src/routes/requestRoutes.js'
import { publicAuditMovement } from '../src/services/auditVisibility.js'

test('la proyección pública conserva datos esperados y oculta campos privados o desconocidos', () => {
  const row = {
    entity: 'empleado', field: null, employeeName: 'RH de prueba',
    previousValue: '{"activo":0,"puesto":"Barista","password":"dato-prueba","sueldo_base":1000}',
    newValue: '{"activo":1,"puesto":{"cookie":"dato-prueba"},"correo":"correo@example.test"}',
    reason: 'Reactivación',
  }
  const movement = publicAuditMovement(row)
  assert.deepEqual(JSON.parse(movement.previousValue), { puesto: 'Barista', activo: 0 })
  assert.deepEqual(JSON.parse(movement.newValue), { puesto: '[Oculto]', activo: 1 })
  assert.equal(movement.reason, 'Reactivación')
  assert.match(row.newValue, /dato-prueba/)

  const hidden = publicAuditMovement({
    ...row, entity: 'festivo', field: 'descripcion', previousValue: 'Día festivo',
    newValue: '{"contrasena":"dato-prueba"', reason: 'Autorización: Bearer dato-prueba',
  })
  assert.equal(hidden.previousValue, 'Día festivo')
  assert.equal(hidden.newValue, '[Oculto]')
  assert.equal(hidden.reason, '[Oculto]')
})

// Los movimientos de prueba se escriben en tablas temporales de una conexión.
test('bitácora general con MariaDB y sesiones', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    db.release()
    await pool.end()
  })
  const tables = ['empleado', 'asistencia', 'festivo', 'solicitud_permiso', 'justificante', 'falta', 'bitacora']
  for (const table of tables) {
    const [[definition]] = await db.query(`SHOW CREATE TABLE ${table}`)
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function addEmployee(login, name, role) {
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario,nombre_completo,contrasena,puesto,sueldo_base,id_rol,fecha_alta)
       SELECT ?,?,?,'Prueba',1000,id_rol,CURDATE() FROM rol WHERE nombre = ?`,
      [login, name, 'AuditoriaPrueba123', role],
    )
    assert.equal(result.affectedRows, 1)
    return result.insertId
  }

  const hrId = await addEmployee('audit_hr', 'RH Auditoría', 'Recursos Humanos')
  const adminId = await addEmployee('audit_admin', 'Admin Auditoría', 'Administrador')
  const workerId = await addEmployee('audit_worker', 'Empleado Auditoría', 'Empleado')
  await addEmployee('audit_supervisor', 'Supervisor Auditoría', 'Supervisor')

  t.mock.method(pool, 'getConnection', async () => ({
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
    query: db.query.bind(db),
    execute: db.execute.bind(db),
    release() {},
  }))
  t.mock.method(pool, 'execute', db.execute.bind(db))
  t.mock.method(pool, 'query', db.query.bind(db))

  const app = express()
  app.use(express.json())
  app.use(session({ secret: 'prueba-bitacora-macaron', resave: false, saveUninitialized: false }))
  app.use('/api/auth', authRoutes)
  app.use('/api/audit', auditRoutes)
  app.use('/api/holidays', holidayRoutes)
  app.use('/api/attendance', attendanceRoutes)
  app.use('/api/requests', requestRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(path, cookie, method = 'GET', body) {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: { ...(cookie && { Cookie: cookie }), ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    })
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      cache: response.headers.get('cache-control'),
    }
  }

  async function login(username) {
    const result = await request('/auth/login', null, 'POST', { username, password: 'AuditoriaPrueba123' })
    assert.equal(result.status, 200, result.data.message)
    return result.cookie
  }
  const hr = await login('audit_hr')
  const admin = await login('audit_admin')
  const worker = await login('audit_worker')
  const supervisor = await login('audit_supervisor')

  async function addAudit(at, action, entity, field, oldValue, newValue, reason, employeeId = hrId) {
    const [result] = await db.execute(
      `INSERT INTO bitacora (fecha_hora,accion,entidad,id_registro_afectado,campo,valor_anterior,valor_nuevo,motivo,id_usuario)
       VALUES (?,?,?,55,?,?,?,?,?)`, [at, action, entity, field, oldValue, newValue, reason, employeeId],
    )
    return result.insertId
  }

  const first = await addAudit('2026-01-02 12:00:00', 'ALTA', 'empleado', 'activo', null, '1', null)
  const second = await addAudit('2026-01-02 12:00:00', 'CAMBIO', 'empleado', 'activo', '1', '0', 'Baja programada', adminId)
  const third = await addAudit('2026-01-02 23:59:59', 'CAMBIO', 'turno', 'hora_fin', '15:00:00', '16:00:00', 'Cambio de horario')
  const fourth = await addAudit('2026-01-03 00:00:00', 'ALTA', 'turno', 'nombre', null, 'Apertura', null)

  await t.test('solo RH y Administración pueden consultar y el endpoint es de lectura', async () => {
    for (const cookie of [hr, admin]) {
      const result = await request('/audit', cookie)
      assert.equal(result.status, 200, result.data.message)
      assert.equal(result.cache, 'no-store')
    }
    for (const cookie of [worker, supervisor]) assert.equal((await request('/audit', cookie)).status, 403)
    assert.equal((await request('/audit')).status, 401)
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request('/audit', hr, method)).status, 404)
  })

  await t.test('filtra por fechas inclusivas, entidad, responsable y acción', async () => {
    const date = 'from=2026-01-02&to=2026-01-02'
    const result = await request(`/audit?${date}&entity=empleado`, hr)
    assert.deepEqual(result.data.movements.map(row => row.id), [second, first])
    const filtered = await request(`/audit?${date}&action=CAMBIO&actor=${adminId}`, hr)
    assert.deepEqual(filtered.data.movements.map(row => row.id), [second])
    assert.equal(filtered.data.movements[0].employeeName, 'Admin Auditoría')
    assert.equal(filtered.data.movements[0].newValue, '0')
    assert.equal(filtered.data.movements[0].reason, 'Baja programada')
    const byName = await request(`/audit?${date}&actor=RH%20Auditor`, hr)
    assert.deepEqual(byName.data.movements.map(row => row.id), [third, first])
    assert.deepEqual((await request('/audit?actor=%25', hr)).data.movements, [])
    const endOfDay = await request(`/audit?${date}&entity=turno`, hr)
    assert.deepEqual(endOfDay.data.movements.map(row => row.id), [third])
    for (const query of ['from=2026-02-30', 'from=2026-01-03&to=2026-01-01', 'action=EDITAR', 'entity=%27', 'page=0', 'pageSize=101', 'actor=uno&actor=dos']) {
      assert.equal((await request('/audit?' + query, hr)).status, 400, query)
    }
  })

  await t.test('ordena por fecha y luego por ID y limita el tamaño de cada página', async () => {
    const page1 = await request('/audit?page=1&pageSize=2', hr)
    const page2 = await request('/audit?page=2&pageSize=2', hr)
    assert.deepEqual(page1.data.movements.map(row => row.id), [fourth, third])
    assert.deepEqual(page2.data.movements.map(row => row.id), [second, first])
    assert.equal(page1.data.hasNext, true)
    assert.equal(page2.data.hasNext, false)
  })

  await t.test('oculta credenciales de valores y motivos sin modificar el original', async () => {
    const secret = 'credencial-ficticia-privada'
    const reason = `Token de sesión: ${secret}`
    const credential = await addAudit('2026-01-04 12:00:00', 'CAMBIO', 'empleado', 'contrasena', 'previo-ficticio', secret, reason)
    const result = await request('/audit?from=2026-01-04&to=2026-01-04', hr)
    assert.equal(result.status, 200, result.data.message)
    const [row] = result.data.movements
    assert.deepEqual([row.id, row.previousValue, row.newValue, row.reason], [credential, '[Oculto]', '[Oculto]', '[Oculto]'])
    assert(!JSON.stringify(result.data).includes(secret))
    const [[stored]] = await db.execute('SELECT valor_nuevo, motivo FROM bitacora WHERE id_bitacora = ?', [credential])
    assert.deepEqual(stored, { valor_nuevo: secret, motivo: reason })
  })

  await t.test('lee los movimientos de los módulos y vuelve a leer MariaDB desde el store', async subtest => {
    const holiday = await request('/holidays', hr, 'POST', { date: '2026-11-27', description: 'Festivo de prueba' })
    assert.equal(holiday.status, 201, holiday.data.message)
    const clock = await request('/attendance/clock-in', worker, 'POST')
    assert.equal(clock.status, 201, clock.data.message)
    const [late] = await db.execute(
      `INSERT INTO asistencia (fecha,fecha_hora_entrada,retardo,id_empleado,id_registro_entrada)
       VALUES ('2026-11-16','2026-11-16 08:20:00',1,?,?)`, [workerId, workerId],
    )
    const adjustment = await request(`/attendance/adjustments/${late.insertId}`, hr, 'PATCH', {
      entryAt: '2026-11-16T08:20', exitAt: '2026-11-16T17:00', reason: 'Completar salida',
    })
    assert.equal(adjustment.status, 200, adjustment.data.message)
    const absence = await request('/requests', worker, 'POST', { type: 'falta', date: '2026-11-26', reason: 'Ausencia prevista' })
    assert.equal(absence.status, 201, absence.data.message)
    const approval = await request(`/requests/review/falta/${absence.data.request.id}`, hr, 'PATCH', { decision: 'aprobar' })
    assert.equal(approval.status, 200, approval.data.message)

    const { loadAuditMovements } = await import('../../src/store.js')
    const fetchHttp = globalThis.fetch
    subtest.mock.method(globalThis, 'fetch', (url, options) => url.startsWith('/api/')
      ? fetchHttp(base + url, { ...options, headers: { ...options.headers, Cookie: hr } })
      : fetchHttp(url, options))
    const initial = await loadAuditMovements()
    assert.equal(initial.ok, true, initial.message)
    for (const [entity, field, action] of [
      ['festivo', 'descripcion', 'ALTA'], ['asistencia', 'contexto_jornada', 'ALTA'], ['asistencia', 'calculo_jornada', 'CORRECCION'],
      ['solicitud_permiso', 'solicitud', 'ALTA'], ['solicitud_permiso', 'resolucion', 'CAMBIO'], ['falta', 'autorizacion', 'ALTA'],
    ]) {
      const movement = initial.movements.find(row => row.entity === entity && row.field === field && row.action === action)
      assert(movement, entity + '/' + field)
      assert.notEqual(movement.newValue, '[Oculto]')
    }

    const [toJustify] = await db.execute(
      `INSERT INTO asistencia (fecha,fecha_hora_entrada,retardo,id_empleado,id_registro_entrada)
       VALUES ('2026-11-17','2026-11-17 08:20:00',1,?,?)`, [workerId, workerId],
    )
    const justification = await request('/requests/justifications', worker, 'POST', {
      attendanceId: toJustify.insertId, reason: 'Justificación de prueba',
    })
    assert.equal(justification.status, 201, justification.data.message)
    const reloaded = await loadAuditMovements({ entity: 'justificante', page: 1 })
    assert.equal(reloaded.ok, true, reloaded.message)
    assert.equal(reloaded.movements.length, 1)
    assert.equal(reloaded.movements[0].recordId, justification.data.request.id)
  })
})
