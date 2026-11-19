import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import session from 'express-session'
import pool from '../src/config/database.js'
import authRoutes from '../src/routes/authRoutes.js'
import requestRoutes from '../src/routes/requestRoutes.js'

// Las escrituras de prueba se limitan a tablas temporales de una conexión.
test('resolución de solicitudes con MariaDB, sesiones y permisos reales', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    db.release()
    await pool.end()
  })
  for (const table of ['empleado', 'asistencia', 'solicitud_permiso', 'justificante', 'falta', 'bitacora']) {
    const [[definition]] = await db.query(`SHOW CREATE TABLE ${table}`)
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function addEmployee(username, name, roleName) {
    const [[role]] = await db.execute('SELECT id_rol FROM rol WHERE nombre = ?', [roleName])
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario,nombre_completo,contrasena,puesto,sueldo_base,id_rol,fecha_alta)
       VALUES (?,?,?,'Pruebas',1000,?,CURDATE())`,
      [username, name, 'ResolucionPrueba123', role.id_rol],
    )
    return result.insertId
  }

  const workerId = await addEmployee('review_worker', 'Empleado de prueba', 'Empleado')
  const hrId = await addEmployee('review_hr', 'RH de prueba', 'Recursos Humanos')
  const adminId = await addEmployee('review_admin', 'Administrador de prueba', 'Administrador')
  await addEmployee('review_supervisor', 'Supervisor de prueba', 'Supervisor')
  const [attendance] = await db.execute(
    `INSERT INTO asistencia (fecha,fecha_hora_entrada,retardo,id_empleado,id_registro_entrada)
     VALUES ('2026-11-16','2026-11-16 08:20:00',1,?,?)`,
    [workerId, workerId],
  )

  let failAudit = false
  const adapter = {
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
    query: db.query.bind(db),
    release() {},
    async execute(sql, params) {
      if (failAudit && sql.trimStart().startsWith('INSERT INTO bitacora') && params[4] === 'resolucion') {
        throw new Error('Fallo de bitácora de prueba')
      }
      return db.execute(sql, params)
    },
  }
  t.mock.method(pool, 'getConnection', async () => adapter)
  t.mock.method(pool, 'execute', db.execute.bind(db))

  const app = express()
  app.use(express.json())
  app.use(session({ secret: 'pruebas-resolucion-macaron', resave: false, saveUninitialized: false }))
  app.use('/api/auth', authRoutes)
  app.use('/api/requests', requestRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const base = `http://127.0.0.1:${server.address().port}`

  async function request(path, cookie, method = 'GET', body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cookie && { Cookie: cookie }),
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body && JSON.stringify(body),
    })
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    }
  }

  async function login(username) {
    const result = await request('/api/auth/login', null, 'POST', { username, password: 'ResolucionPrueba123' })
    assert.equal(result.status, 200, result.data.message)
    assert(result.cookie)
    return result.cookie
  }

  const worker = await login('review_worker')
  const hr = await login('review_hr')
  const admin = await login('review_admin')
  const supervisor = await login('review_supervisor')
  const inbox = '/api/requests/review'
  const own = '/api/requests'
  const resolve = (item, decision, cookie = hr, note = '') =>
    request(`${inbox}/${item.type}/${item.id}`, cookie, 'PATCH', { decision, note })

  async function addRequest(type, date, cookie = worker) {
    const result = await request(own, cookie, 'POST', { type, date, reason: 'Motivo de prueba' })
    assert.equal(result.status, 201, result.data.message)
    return result.data.request
  }

  const permission = await addRequest('permiso', '2026-11-20')
  const rejected = await addRequest('permiso', '2026-11-21')
  const absence = await addRequest('falta', '2026-11-22')
  const reusable = await addRequest('falta', '2026-11-23')
  const rollback = await addRequest('falta', '2026-11-24')
  const conflict = await addRequest('falta', '2026-11-25')
  const withAttendance = await addRequest('falta', '2026-11-16')
  const ownAdmin = await addRequest('permiso', '2026-11-20', admin)
  const justificationResult = await request(`${own}/justifications`, worker, 'POST', {
    attendanceId: attendance.insertId,
    reason: 'Motivo de retardo de prueba',
  })
  assert.equal(justificationResult.status, 201, justificationResult.data.message)
  const justification = justificationResult.data.request

  await t.test('RH consulta los tres tipos de solicitudes y filtra por estado', async () => {
    const result = await request(`${inbox}?status=pendiente`, hr)
    assert.equal(result.status, 200, result.data.message)
    assert.deepEqual(new Set(result.data.requests.map(item => item.type)), new Set(['permiso', 'falta', 'justificacion']))
    const item = result.data.requests.find(item => item.type === 'permiso' && item.id === permission.id)
    assert.equal(item.employeeName, 'Empleado de prueba')
    assert.equal(item.date, '2026-11-20')
    assert.equal(item.reason, 'Motivo de prueba')
    assert.equal(item.status, 'pendiente')
    assert.equal(item.canResolve, true)
    assert(item.createdAt)
    assert.equal((await request(`${inbox}?status=inválido`, hr)).status, 400)
    assert.deepEqual((await request(`${inbox}?status=aprobada`, hr)).data.requests, [])
  })

  await t.test('requiere sesión y permiso actual, e impide resolver solicitudes propias', async () => {
    assert.equal((await request(inbox)).status, 401)
    for (const cookie of [worker, supervisor]) {
      assert.equal((await request(inbox, cookie)).status, 403)
      assert.equal((await resolve(permission, 'aprobar', cookie)).status, 403)
    }
    const result = await request(inbox, admin)
    assert.equal(result.status, 200, result.data.message)
    assert.equal(result.data.requests.find(item => item.type === ownAdmin.type && item.id === ownAdmin.id).canResolve, false)
    assert.equal((await resolve(ownAdmin, 'aprobar', admin)).status, 403)
    assert.equal((await request(`${inbox}/permiso/${permission.id}`, hr, 'PATCH', {
      decision: 'aprobar', reviewerId: adminId,
    })).status, 400)
  })

  await t.test('aprueba un permiso desde el store, guarda auditoría y actualiza la consulta del empleado', async subtest => {
    const { loadReviewRequests, reviewRequest, loadMyRequests } = await import('../../src/store.js')
    const fetchHttp = globalThis.fetch
    let cookie = hr
    subtest.mock.method(globalThis, 'fetch', (url, options) => url.startsWith('/api/')
      ? fetchHttp(base + url, { ...options, headers: { ...options.headers, Cookie: cookie } })
      : fetchHttp(url, options))

    const pending = await loadReviewRequests('pendiente')
    assert.equal(pending.ok, true, pending.message)
    assert(pending.requests.some(item => item.type === 'permiso' && item.id === permission.id))
    const result = await reviewRequest({
      requestId: permission.id, type: permission.type, decision: 'aprobar', note: '  Aprobada por RH  ',
    })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.request.status, 'aprobada')
    assert(result.request.resolvedAt)
    cookie = worker
    const mine = await loadMyRequests()
    assert.equal(mine.ok, true, mine.message)
    const updated = mine.requests.find(item => item.type === 'permiso' && item.id === permission.id)
    assert.equal(updated.status, 'aprobada')
    assert.equal(updated.resolvedAt, result.request.resolvedAt)
    const [[stored]] = await db.execute('SELECT estado, id_resuelto_por FROM solicitud_permiso WHERE id_solicitud = ?', [permission.id])
    assert.deepEqual(stored, { estado: 'AUTORIZADA', id_resuelto_por: hrId })
    assert.equal((await resolve(permission, 'aprobar', admin)).status, 409)
    const [audit] = await db.execute(
      `SELECT id_usuario, fecha_hora, motivo, valor_anterior, valor_nuevo
         FROM bitacora WHERE entidad = 'solicitud_permiso' AND id_registro_afectado = ? AND campo = 'resolucion'`,
      [permission.id],
    )
    assert.equal(audit.length, 1)
    assert.equal(audit[0].id_usuario, hrId)
    assert(audit[0].fecha_hora)
    assert.equal(audit[0].motivo, 'Aprobada por RH')
    assert.equal(JSON.parse(audit[0].valor_anterior).estado, 'PENDIENTE')
    assert.equal(JSON.parse(audit[0].valor_nuevo).estado, 'AUTORIZADA')
  })

  await t.test('rechaza con observación y la expone en el filtro correspondiente', async () => {
    assert.equal((await resolve(rejected, 'rechazar')).status, 400)
    assert.equal((await resolve(rejected, 'rechazar', admin, '🙂'.repeat(256))).status, 400)
    const result = await resolve(rejected, 'rechazar', admin, 'Falta cobertura')
    assert.equal(result.status, 200, result.data.message)
    assert.equal(result.data.request.status, 'rechazada')
    const listed = await request(`${inbox}?status=rechazada`, hr)
    assert.deepEqual(listed.data.requests.map(item => item.id), [rejected.id])
    assert.equal(listed.data.requests[0].reviewNote, 'Falta cobertura')
  })

  await t.test('una falta aprobada crea o reutiliza una sola fila y preserva la validación previa', async () => {
    await db.execute(
      `INSERT INTO falta (fecha,autorizada,observaciones,id_empleado,id_validada_por)
       VALUES ('2026-11-23',1,'Validación anterior',?,?)`,
      [workerId, adminId],
    )
    for (const item of [absence, reusable]) {
      const result = await resolve(item, 'aprobar')
      assert.equal(result.status, 200, result.data.message)
      const [rows] = await db.execute(
        'SELECT autorizada, observaciones, id_solicitud, id_validada_por FROM falta WHERE id_empleado = ? AND fecha = ?',
        [workerId, item.date],
      )
      assert.equal(rows.length, 1)
      assert.equal(rows[0].autorizada, 1)
      assert.equal(rows[0].id_solicitud, item.id)
      assert.equal(rows[0].id_validada_por, item === reusable ? adminId : hrId)
      if (item === reusable) assert.equal(rows[0].observaciones, 'Validación anterior')
    }
  })

  await t.test('una falta en conflicto queda pendiente sin duplicar o reemplazar registros', async () => {
    await db.execute(
      'INSERT INTO falta (fecha,autorizada,id_empleado,id_solicitud) VALUES (?,1,?,?)',
      [conflict.date, workerId, reusable.id],
    )
    assert.equal((await resolve(conflict, 'aprobar')).status, 409)
    const [[stored]] = await db.execute('SELECT estado FROM solicitud_permiso WHERE id_solicitud = ?', [conflict.id])
    assert.equal(stored.estado, 'PENDIENTE')
    const [rows] = await db.execute('SELECT id_solicitud FROM falta WHERE id_empleado = ? AND fecha = ?', [workerId, conflict.date])
    assert.deepEqual(rows, [{ id_solicitud: reusable.id }])
    const withMark = await resolve(withAttendance, 'aprobar')
    assert.equal(withMark.status, 409)
    assert.match(withMark.data.message, /marcaje/)
    const denied = await resolve(withAttendance, 'rechazar', hr, 'Asistencia registrada')
    assert.equal(denied.status, 200, denied.data.message)
    const [absenceRows] = await db.execute('SELECT id_falta FROM falta WHERE id_empleado = ? AND fecha = ?', [workerId, withAttendance.date])
    assert.deepEqual(absenceRows, [])
  })

  await t.test('resuelve el justificante sin modificar su asistencia', async () => {
    const [before] = await db.execute('SELECT * FROM asistencia WHERE id_asistencia = ?', [attendance.insertId])
    const result = await resolve(justification, 'aprobar')
    assert.equal(result.status, 200, result.data.message)
    const [[stored]] = await db.execute('SELECT estado, id_resuelto_por FROM justificante WHERE id_justificante = ?', [justification.id])
    assert.deepEqual(stored, { estado: 'ACEPTADO', id_resuelto_por: hrId })
    const [after] = await db.execute('SELECT * FROM asistencia WHERE id_asistencia = ?', [attendance.insertId])
    assert.deepEqual(after, before)
  })

  await t.test('si falla la auditoría revierte la resolución, la falta y su auditoría', async () => {
    const [[before]] = await db.execute("SELECT COUNT(*) AS total FROM bitacora WHERE entidad = 'falta'")
    failAudit = true
    try {
      const result = await resolve(rollback, 'aprobar')
      assert.equal(result.status, 500)
      assert.match(result.data.message, /Fallo de bitácora/)
    } finally {
      failAudit = false
    }
    const [[stored]] = await db.execute('SELECT estado, id_resuelto_por FROM solicitud_permiso WHERE id_solicitud = ?', [rollback.id])
    assert.deepEqual(stored, { estado: 'PENDIENTE', id_resuelto_por: null })
    const [rows] = await db.execute('SELECT id_falta FROM falta WHERE id_empleado = ? AND fecha = ?', [workerId, rollback.date])
    assert.deepEqual(rows, [])
    const [[after]] = await db.execute("SELECT COUNT(*) AS total FROM bitacora WHERE entidad = 'falta'")
    assert.equal(after.total, before.total)
  })
})
