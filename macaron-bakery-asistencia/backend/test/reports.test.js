import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import pool from '../src/config/database.js'
import reportRoutes from '../src/routes/reportRoutes.js'
import { loadAttendanceReport, loadAttendanceReports, saveAttendanceReport } from '../../src/store.js'

test('reportes históricos de asistencia con MariaDB', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    db.release()
    await pool.end()
  })
  // Las escrituras se limitan a tablas temporales de esta conexión.
  for (const table of ['empleado', 'asistencia', 'solicitud_permiso', 'justificante', 'falta', 'bitacora', 'reporte', 'detalle_reporte']) {
    const [[definition]] = await db.query('SHOW CREATE TABLE ??', [table])
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function addEmployee(username, role) {
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario, nombre_completo, contrasena, puesto, sueldo_base, id_rol, fecha_alta)
       SELECT ?, ?, 'prueba', 'Pruebas', 1000, id_rol, '2020-01-01' FROM rol WHERE nombre = ?`,
      [username, username, role],
    )
    assert.equal(result.affectedRows, 1)
    return result.insertId
  }
  const hr = await addEmployee('rh_reporte', 'Recursos Humanos')
  const worker = await addEmployee('empleado_reporte', 'Empleado')
  const supervisor = await addEmployee('supervisor_reporte', 'Supervisor')
  const admin = await addEmployee('admin_reporte', 'Administrador')
  const period = { from: '2024-01-01', to: '2024-01-20' }

  async function attendance(id, date, { normal = 0, extra = 0, holiday = 0, late = 0, open = false } = {}) {
    const [result] = await db.execute(
      `INSERT INTO asistencia (fecha, fecha_hora_entrada, fecha_hora_salida, horas_normales, horas_extra,
                               horas_festiva, retardo, id_empleado, id_registro_entrada, id_registro_salida)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [date, date + ' 08:00:00', open ? null : date + ' 17:00:00',
        normal, extra, holiday, late, id, id, open ? null : id],
    )
    return result.insertId
  }
  const correctedLater = await attendance(worker, period.from, { normal: 8.25, extra: 1.5, late: 1 })
  await attendance(worker, '2024-01-02', { holiday: 6.5 })
  const unclassified = await attendance(worker, '2024-01-03', { normal: 9, extra: 9, holiday: 9 })
  await attendance(worker, '2024-01-04', { normal: 5, open: true })
  await attendance(worker, '2024-01-05')
  const zeroClassified = await attendance(worker, '2024-01-06')
  await attendance(worker, '2024-01-21', { normal: 5 })
  await attendance(supervisor, period.to, { normal: 4 })
  await attendance(admin, period.to, { normal: 3 })
  await db.execute(`
    INSERT INTO bitacora (fecha_hora, accion, entidad, id_registro_afectado, campo, valor_nuevo, id_usuario)
    VALUES (NOW(), 'CORRECCION', 'asistencia', ?, 'calculo_jornada', '{"version":1,"status":"festivo_pendiente"}', ?),
           (NOW(), 'CORRECCION', 'asistencia', ?, 'calculo_jornada', '{"version":1,"status":"calculado"}', ?)`,
  [unclassified, hr, zeroClassified, hr])
  await db.execute(`
    INSERT INTO justificante (fecha_creacion, motivo, estado, id_asistencia, id_resuelto_por)
    VALUES (NOW(), 'Motivo', 'ACEPTADO', ?, ?)`, [correctedLater, hr])

  async function requestRecord(type, status, date) {
    const [result] = await db.execute(
      `INSERT INTO solicitud_permiso (tipo, estado, fecha_solicitud, fecha_permiso, motivo, id_solicitante)
       VALUES (?, ?, NOW(), ?, 'Motivo', ?)`, [type, status, date, worker],
    )
    return result.insertId
  }
  const approved = await requestRecord('FALTA', 'AUTORIZADA', '2024-01-07')
  await requestRecord('FALTA', 'PENDIENTE', '2024-01-10')
  const pending = await requestRecord('FALTA', 'PENDIENTE', '2024-01-11')
  await requestRecord('PERMISO_SALIDA', 'AUTORIZADA', '2024-01-12')
  await requestRecord('PERMISO_SALIDA', 'PENDIENTE', '2024-01-13')
  await requestRecord('PERMISO_SALIDA', 'RECHAZADA', '2024-01-14')
  await db.execute(`
    INSERT INTO falta (fecha, autorizada, id_empleado, id_solicitud, id_validada_por)
    VALUES ('2024-01-07', 1, ?, ?, ?), ('2024-01-08', 0, ?, NULL, ?),
           ('2024-01-09', 0, ?, NULL, NULL), ('2024-01-11', 1, ?, ?, ?),
           ('2024-01-05', 1, ?, NULL, ?)`, [worker, approved, hr, worker, hr, worker, worker, pending, hr, worker, hr])

  let writesUntilFailure = Infinity
  const adapter = {
    query: db.query.bind(db),
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
    release() {},
    execute(sql, values) {
      if (sql.trimStart().startsWith('INSERT INTO bitacora') && --writesUntilFailure === 0) {
        throw new Error('Escritura de clasificación fallida')
      }
      return db.execute(sql, values)
    },
  }
  t.mock.method(pool, 'execute', db.execute.bind(db))
  t.mock.method(pool, 'getConnection', async () => adapter)

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const actor = Number(req.get('x-test-actor'))
    req.session = actor ? { employee: { id: actor } } : {}
    next()
  })
  app.use('/api/reports', reportRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())))
  const api = `http://127.0.0.1:${server.address().port}/api/reports`

  async function request(path = '', { actor = hr, body } = {}) {
    const response = await fetch(api + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-test-actor': String(actor), ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }

  let singleId
  let savedSnapshot

  await t.test('consulta el historial vacío sin guardar y valida permisos y parámetros', async () => {
    assert.deepEqual((await request()).data.reports, [])
    for (const actor of [0, worker, supervisor]) {
      for (const call of [request('', { actor }), request('/1', { actor }), request('', { actor, body: period })]) {
        assert.equal((await call).status, actor ? 403 : 401)
      }
    }
    assert.equal((await request('', { body: { ...period, normal: 900 } })).status, 400)
    assert.equal((await request('', { body: { ...period, from: '2024-02-30' } })).status, 400)
    assert.equal((await request('', { body: { ...period, employeeId: '1' } })).status, 400)
    assert.equal((await request('', { body: { ...period, employeeId: admin } })).status, 404)
    assert.equal((await request('/2147483647')).status, 404)
    assert.deepEqual((await request()).data.reports, [])
  })

  await t.test('guarda y consulta un empleado con horas clasificadas y faltas validadas', async () => {
    const created = await request('', { body: { ...period, employeeId: worker } })
    assert.equal(created.status, 201, created.data.message)
    singleId = created.data.reportId
    const [[header]] = await db.execute(
      'SELECT tipo, id_generado_por, CAST(fecha_generacion AS CHAR) AS generatedAt FROM reporte WHERE id_reporte = ?', [singleId],
    )
    assert.equal(header.tipo, 'ASISTENCIA_PUNTUALIDAD')
    assert.equal(header.id_generado_por, hr)
    assert.match(header.generatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    const [details] = await db.execute(
      'SELECT id_empleado, importe_estimado FROM detalle_reporte WHERE id_reporte = ?', [singleId],
    )
    assert.deepEqual(details, [{ id_empleado: worker, importe_estimado: 0 }])

    const result = await request(`/${singleId}`)
    assert.equal(result.status, 200, result.data.message)
    savedSnapshot = result.data.report
    assert.equal(savedSnapshot.periodStart, period.from)
    assert.equal(savedSnapshot.periodEnd, period.to)
    assert.equal(savedSnapshot.generatedBy, 'rh_reporte')
    assert.deepEqual(savedSnapshot.details, [{
      employeeId: worker, employeeName: 'empleado_reporte', attendances: 6, late: 1,
      authorizedAbsences: 1, unauthorizedAbsences: 1, authorizedExits: 1,
      normal: 8.25, extra: 1.5, holiday: 6.5, pendingHours: 3, pendingAbsences: 3,
    }])
  })

  await t.test('guarda varios empleados sin duplicarlos y conserva un reporte anterior tras correcciones', async () => {
    await db.execute('UPDATE asistencia SET horas_normales = 7, retardo = 0 WHERE id_asistencia = ?', [correctedLater])
    await db.execute("UPDATE falta SET id_validada_por = ? WHERE fecha = '2024-01-09' AND id_empleado = ?", [hr, worker])
    const created = await request('', { actor: admin, body: period })
    assert.equal(created.status, 201, created.data.message)
    const id = created.data.reportId
    const result = await request(`/${id}`)
    const { details } = result.data.report
    assert.deepEqual(details.map(detail => detail.employeeId), [hr, worker, supervisor])
    assert.equal(details[0].attendances, 0)
    assert.equal(details[0].normal, 0)
    assert.equal(details[1].normal, 7)
    assert.equal(details[1].late, 0)
    assert.equal(details[1].pendingAbsences, 2)
    assert.equal(details[2].normal, 4)
    assert.deepEqual((await request(`/${singleId}`)).data.report, savedSnapshot)
    assert.deepEqual((await request()).data.reports.map(report => report.id), [id, singleId])
    await assert.rejects(
      db.execute('INSERT INTO detalle_reporte (id_reporte, id_empleado) VALUES (?, ?)', [id, worker]),
      { code: 'ER_DUP_ENTRY' },
    )
  })

  await t.test('revierte encabezado, detalles y clasificación al fallar una escritura', async () => {
    async function counts() {
      const [rows] = await db.query(`
        SELECT (SELECT COUNT(*) FROM reporte) AS reports,
               (SELECT COUNT(*) FROM detalle_reporte) AS details,
               (SELECT COUNT(*) FROM bitacora WHERE entidad = 'detalle_reporte') AS snapshots`)
      return rows[0]
    }
    const before = await counts()
    writesUntilFailure = 2
    const result = await request('', { body: period })
    assert.equal(result.status, 500)
    assert.equal(result.data.message, 'Escritura de clasificación fallida')
    assert.deepEqual(await counts(), before)
  })

  await t.test('los métodos de la pantalla guardan el filtro y consultan el histórico', async subtest => {
    const originalFetch = globalThis.fetch
    subtest.mock.method(globalThis, 'fetch', (path, options) => originalFetch(api + path.slice('/api/reports'.length), {
      ...options, headers: { ...options.headers, 'x-test-actor': String(hr) },
    }))
    const created = await saveAttendanceReport({ ...period, userId: String(supervisor) })
    assert.equal(created.ok, true, created.message)
    const history = await loadAttendanceReports(1)
    assert.equal(history.reports[0].id, created.reportId)
    const result = await loadAttendanceReport(created.reportId)
    assert.deepEqual(result.report.details.map(detail => detail.employeeId), [supervisor])
  })
})
