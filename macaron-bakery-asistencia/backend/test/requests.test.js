import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import session from 'express-session'
import pool from '../src/config/database.js'
import authRoutes from '../src/routes/authRoutes.js'
import requestRoutes from '../src/routes/requestRoutes.js'

// Ejecutar desde backend con ATTENDANCE_TEST_MARIADB=1. Las escrituras
// de las pruebas se limitan a las tablas temporales de esta conexión.
test('solicitudes propias de empleados con MariaDB y sesiones', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    db.release()
    await pool.end()
  })
  const [foreignKeys] = await db.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS target
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('solicitud_permiso', 'falta', 'justificante')
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
  )
  for (const [tableName, columnName, target] of [
    ['solicitud_permiso', 'id_solicitante', 'empleado'],
    ['justificante', 'id_asistencia', 'asistencia'],
    ['falta', 'id_solicitud', 'solicitud_permiso'],
  ]) assert(foreignKeys.some(key => key.tableName === tableName && key.columnName === columnName && key.target === target))

  for (const table of ['empleado', 'asistencia', 'solicitud_permiso', 'falta', 'justificante', 'bitacora']) {
    const [[definition]] = await db.query(`SHOW CREATE TABLE ${table}`)
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function addEmployee(username, roleName) {
    const [[role]] = await db.execute('SELECT id_rol FROM rol WHERE nombre = ?', [roleName])
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario,nombre_completo,contrasena,puesto,sueldo_base,id_rol,fecha_alta)
       VALUES (?,?,'SolicitudPrueba123','Pruebas',1000,?,CURDATE())`,
      [username, username, role.id_rol],
    )
    return result.insertId
  }

  async function addAttendance(employeeId, date, late) {
    const [result] = await db.execute(
      `INSERT INTO asistencia (fecha,fecha_hora_entrada,retardo,id_empleado,id_registro_entrada)
       VALUES (?,?,?,?,?)`,
      [date, `${date} 08:20:00`, late, employeeId, employeeId],
    )
    return result.insertId
  }

  const worker = await addEmployee('solicitudes_empleado', 'Empleado')
  const other = await addEmployee('solicitudes_otro', 'Empleado')
  const hr = await addEmployee('solicitudes_rh', 'Recursos Humanos')
  const attendance = await addAttendance(worker, '2026-11-16', 1)
  const punctual = await addAttendance(worker, '2026-11-17', 0)
  const foreignAttendance = await addAttendance(other, '2026-11-16', 1)

  let failAudit = false
  const adapter = {
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
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

  const app = express()
  app.use(express.json())
  app.use(session({ secret: 'pruebas-solicitudes-macaron', resave: false, saveUninitialized: false }))
  app.use('/api/auth', authRoutes)
  app.use('/api/requests', requestRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())))

  async function request(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body && JSON.stringify(body),
    })
    return {
      status: response.status,
      data: await response.json().catch(() => null),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    }
  }

  async function login(username) {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: { username, password: 'SolicitudPrueba123' },
    })
    assert.equal(result.status, 200)
    assert(result.cookie)
    return result.cookie
  }

  const workerCookie = await login('solicitudes_empleado')
  const otherCookie = await login('solicitudes_otro')
  const hrCookie = await login('solicitudes_rh')
  const path = '/api/requests'
  const permit = { type: 'permiso', date: '2026-11-19', exitTime: '14:30', reason: 'Motivo de permiso de prueba' }
  const absence = { type: 'falta', date: '2026-11-20', reason: 'Motivo de falta de prueba' }
  const justification = { attendanceId: attendance, reason: 'Motivo de retardo de prueba' }
  const post = (body, cookie = workerCookie, suffix = '') => request(path + suffix, { cookie, method: 'POST', body })
  const list = (cookie = workerCookie) => request(path, { cookie })
  let permitId
  let absenceId
  let justificationId

  await t.test('exige sesión y el permiso real para presentar solicitudes', async () => {
    assert.equal((await request(path)).status, 401)
    assert.equal((await request(path, { method: 'POST', body: permit })).status, 401)
    assert.equal((await post(permit, hrCookie)).status, 403)
    assert.equal((await post(justification, hrCookie, '/justifications')).status, 403)
    assert.deepEqual((await list(hrCookie)).data, { ok: true, requests: [], lateAttendances: [], canCreate: false })
  })

  await t.test('rechaza fechas, motivos, horas e identidad enviados fuera del contrato', async () => {
    for (const body of [
      { ...permit, date: '2026-02-29' },
      { ...permit, reason: ' ' },
      { ...permit, reason: 'x'.repeat(256) },
      { ...permit, exitTime: '26:00' },
      { ...absence, exitTime: '08:00' },
      { ...permit, userId: other },
      { ...permit, status: 'aprobada' },
    ]) assert.equal((await post(body)).status, 400)
  })

  await t.test('guarda permiso de salida pendiente y evita duplicados activos', async () => {
    const result = await post(permit)
    assert.equal(result.status, 201, result.data.message)
    permitId = result.data.request.id
    assert.deepEqual([result.data.request.type, result.data.request.exitTime, result.data.request.status, result.data.request.resolvedAt],
      ['permiso', '14:30', 'pendiente', null])
    assert(result.data.request.createdAt.includes('T'))
    assert.equal((await post({ ...permit, exitTime: '15:00' })).status, 409)
    const [[stored]] = await db.execute('SELECT tipo, id_solicitante, estado FROM solicitud_permiso WHERE id_solicitud = ?', [permitId])
    assert.deepEqual(stored, { tipo: 'PERMISO_SALIDA', id_solicitante: worker, estado: 'PENDIENTE' })
  })

  await t.test('registra una solicitud de falta sin registrar una falta validada', async () => {
    const result = await post(absence)
    assert.equal(result.status, 201, result.data.message)
    absenceId = result.data.request.id
    assert.equal(result.data.request.type, 'falta')
    assert.equal(result.data.request.exitTime, null)
    const [[row]] = await db.execute('SELECT tipo, id_solicitante FROM solicitud_permiso WHERE id_solicitud = ?', [absenceId])
    assert.deepEqual(row, { tipo: 'FALTA', id_solicitante: worker })
    assert.equal((await post(absence)).status, 409)
    const [[count]] = await db.query('SELECT COUNT(*) AS total FROM falta')
    assert.equal(count.total, 0)
  })

  await t.test('solo justifica un retardo de la sesión y conserva la asistencia original', async () => {
    assert.deepEqual((await list()).data.lateAttendances.map(row => row.id), [attendance])
    assert.equal((await post({ ...justification, attendanceId: foreignAttendance }, workerCookie, '/justifications')).status, 404)
    assert.equal((await post({ ...justification, attendanceId: 2147483647 }, workerCookie, '/justifications')).status, 404)
    assert.equal((await post({ ...justification, attendanceId: punctual }, workerCookie, '/justifications')).status, 400)
    assert.equal((await post({ ...justification, reason: '' }, workerCookie, '/justifications')).status, 400)
    const result = await post(justification, workerCookie, '/justifications')
    assert.equal(result.status, 201, result.data.message)
    justificationId = result.data.request.id
    assert.deepEqual([result.data.request.type, result.data.request.attendanceId, result.data.request.date],
      ['justificacion', attendance, '2026-11-16'])
    assert.equal((await post(justification, workerCookie, '/justifications')).status, 409)
    assert.deepEqual((await list()).data.lateAttendances, [])
    const [[row]] = await db.execute(
      `SELECT a.id_empleado, a.retardo, a.fecha_hora_salida
         FROM justificante j JOIN asistencia a USING (id_asistencia) WHERE j.id_justificante = ?`,
      [justificationId],
    )
    assert.deepEqual(row, { id_empleado: worker, retardo: 1, fecha_hora_salida: null })
  })

  await t.test('lista solo las solicitudes propias y no expone mutaciones ni resolución', async () => {
    const foreign = await post(permit, otherCookie)
    assert.equal(foreign.status, 201)
    const own = await request(`${path}?userId=${other}`, { cookie: workerCookie })
    assert.equal(own.data.requests.length, 3)
    assert(own.data.requests.every(row => row.type !== 'permiso' || row.id === permitId))
    assert.deepEqual((await list(otherCookie)).data.requests, [foreign.data.request])
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal((await request(`${path}/${permitId}`, {
        cookie: otherCookie, method, body: { status: 'aprobada' },
      })).status, 404)
    }
    assert.equal((await request(`${path}/${permitId}`, {
      cookie: workerCookie, method: 'PATCH', body: { status: 'aprobada' },
    })).status, 404)
    assert.equal((await list()).data.requests.find(row => row.type === 'permiso').status, 'pendiente')
  })

  await t.test('traduce resoluciones reales y permite volver a solicitar después del rechazo', async () => {
    await db.execute("UPDATE solicitud_permiso SET estado='AUTORIZADA',fecha_resolucion=NOW(),id_resuelto_por=? WHERE id_solicitud=?", [hr, permitId])
    await db.execute("UPDATE solicitud_permiso SET estado='RECHAZADA',fecha_resolucion=NOW(),id_resuelto_por=? WHERE id_solicitud=?", [hr, absenceId])
    await db.execute("UPDATE justificante SET estado='ACEPTADO',fecha_resolucion=NOW(),id_resuelto_por=? WHERE id_justificante=?", [hr, justificationId])
    const { data } = await list()
    assert.deepEqual(Object.fromEntries(data.requests.map(row => [row.type, row.status])),
      { permiso: 'aprobada', falta: 'rechazada', justificacion: 'aprobada' })
    assert(data.requests.every(row => row.resolvedAt.includes('T')))
    assert.equal((await post(permit)).status, 409)
    assert.equal((await post(absence)).status, 201)
  })

  await t.test('audita el motivo y revierte la solicitud si falla la bitácora', async () => {
    const [events] = await db.execute(
      'SELECT entidad, id_usuario, motivo, valor_nuevo, fecha_hora FROM bitacora WHERE id_usuario = ? ORDER BY id_bitacora',
      [worker],
    )
    const event = events.find(row => row.entidad === 'justificante')
    assert.equal(event.motivo, justification.reason)
    assert.equal(JSON.parse(event.valor_nuevo).idAsistencia, attendance)
    assert(event.fecha_hora instanceof Date)
    const before = (await list()).data.requests.length
    failAudit = true
    try {
      const failed = await post({ ...permit, date: '2026-11-23' })
      assert.equal(failed.status, 500)
      assert.equal(failed.data.message, 'Fallo de bitácora de prueba')
    } finally {
      failAudit = false
    }
    assert.equal((await list()).data.requests.length, before)
  })

  await t.test('las funciones de React consultan de nuevo el servidor después de recargar', async browser => {
    const network = globalThis.fetch
    browser.mock.method(globalThis, 'fetch', (url, options) => network(base + url, {
      ...options, headers: { ...options.headers, Cookie: workerCookie },
    }))
    const { createRequest } = await import('../../src/store.js')
    const response = await createRequest({ ...permit, date: '2026-11-24' })
    assert.equal(response.ok, true, response.message)
    const reloaded = await import('../../src/store.js?reloadRequests')
    const result = await reloaded.loadMyRequests()
    assert.deepEqual(result.requests.find(row => row.type === 'permiso' && row.id === response.request.id), response.request)
  })
})
