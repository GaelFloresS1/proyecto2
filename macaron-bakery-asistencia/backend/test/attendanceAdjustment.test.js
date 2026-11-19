import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import express from 'express'
import pool from '../src/config/database.js'
import attendanceRoutes from '../src/routes/attendanceRoutes.js'
import { entryContext } from '../src/services/attendanceCalculation.js'

// Ejecutar desde backend con ATTENDANCE_TEST_MARIADB=1. Las tablas son
// temporales y las únicas lecturas permanentes son de esquema y catálogos.
test('ajustes de asistencia con los permisos y transacciones de MariaDB', {
  skip: process.env.ATTENDANCE_TEST_MARIADB !== '1',
}, async t => {
  const db = await pool.getConnection()
  t.after(async () => {
    db.release()
    await pool.end()
  })
  for (const table of ['turno', 'empleado', 'asistencia', 'bitacora', 'festivo']) {
    const [[definition]] = await db.query(`SHOW CREATE TABLE ${table}`)
    await db.query(definition['Create Table']
      .replace('CREATE TABLE', 'CREATE TEMPORARY TABLE')
      .replace(/^  CONSTRAINT [^\n]+ FOREIGN KEY [^\n]+\n/gm, '')
      .replace(/,\n\)/g, '\n)'))
  }

  async function employee(username, roleName) {
    const [[role]] = await db.execute('SELECT id_rol FROM rol WHERE nombre = ?', [roleName])
    const [result] = await db.execute(
      `INSERT INTO empleado (usuario,nombre_completo,contrasena,puesto,sueldo_base,id_rol,fecha_alta)
       VALUES (?,?,'prueba','Pruebas',1000,?,CURDATE())`,
      [username, username, role.id_rol],
    )
    return result.insertId
  }

  const hr = await employee('ajustes_rh', 'Recursos Humanos')
  const admin = await employee('ajustes_admin', 'Administrador')
  const worker = await employee('ajustes_empleado', 'Empleado')
  const day = { id_turno: 1, activo: 1, hora_inicio: '08:00:00', hora_fin: '17:00:00', minutos_descanso: 30, dias_laborales: '[1,2,3,4,5,6]' }
  const night = { ...day, hora_inicio: '22:00:00', hora_fin: '06:00:00', id_turno: 2 }

  async function attendance(date, start, end, shift, normal = 0) {
    const [result] = await db.execute(
      `INSERT INTO asistencia (fecha,fecha_hora_entrada,fecha_hora_salida,id_empleado,
                               id_registro_entrada,id_registro_salida,horas_normales)
       VALUES (?,?,?,?,?,?,?)`,
      [date, start, end, worker, worker, worker, normal],
    )
    if (shift) {
      const [[instant]] = await db.execute('SELECT UNIX_TIMESTAMP(?) AS epoch', [start])
      const context = { ...entryContext({ local: start, epoch: Number(instant.epoch) }, shift), tolerance: 10 }
      await db.execute(
        `INSERT INTO bitacora (fecha_hora,accion,entidad,id_registro_afectado,campo,valor_nuevo,id_usuario)
         VALUES (?,'ALTA','asistencia',?,'contexto_jornada',?,?)`,
        [start, result.insertId, JSON.stringify(context), worker],
      )
    }
    return result.insertId
  }

  const shortId = await attendance('2026-11-16', '2026-11-16 08:03:00', '2026-11-16 08:07:00', day)
  await attendance('2026-11-17', '2026-11-17 08:00:00', '2026-11-17 09:00:00', day)
  const oldId = await attendance('2026-11-18', '2026-11-18 08:00:00', '2026-11-18 12:00:00', null, 4)
  const nightId = await attendance('2026-11-19', '2026-11-19 22:05:00', '2026-11-20 05:45:00', night)

  let failAudit = false
  const adapter = {
    beginTransaction: db.beginTransaction.bind(db),
    commit: db.commit.bind(db),
    rollback: db.rollback.bind(db),
    query: db.query.bind(db),
    release() {},
    async execute(sql, values) {
      if (failAudit && /^INSERT INTO bitacora/.test(sql.trim())) throw new Error('Fallo de bitácora simulado')
      return db.execute(sql, values)
    },
  }
  t.mock.method(pool, 'getConnection', async () => adapter)
  t.mock.method(pool, 'query', db.query.bind(db))
  t.mock.method(pool, 'execute', db.execute.bind(db))

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    const id = Number(req.get('x-test-employee'))
    req.session = id ? { employee: { id } } : {}
    next()
  })
  app.use('/api/attendance', attendanceRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ ok: false, message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())))
  const base = `http://127.0.0.1:${server.address().port}/api/attendance`

  async function request(path, actor, body) {
    const response = await fetch(base + path, {
      method: body ? 'PATCH' : 'GET',
      headers: { 'x-test-employee': String(actor), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body && JSON.stringify(body),
    })
    return { status: response.status, data: await response.json() }
  }
  const edit = { entryAt: '2026-11-16T08:00', exitAt: '2026-11-16T17:00', reason: 'Corrección de los marcajes' }
  const patch = (id, actor, body) => request(`/adjustments/${id}`, actor, body)
  const range = `/adjustments?from=2026-11-16&to=2026-11-16&employeeId=${worker}`
  const counts = row => [row.horas_normales, row.horas_extra, row.horas_festiva]

  async function audit(id) {
    const [rows] = await db.execute(
      `SELECT fecha_hora, id_usuario, motivo, valor_anterior, valor_nuevo
         FROM bitacora WHERE id_registro_afectado = ? AND entidad = 'asistencia' AND accion = 'CORRECCION'
         ORDER BY id_bitacora`,
      [id],
    )
    return rows
  }

  await t.test('el propio empleado recibe 403 aunque conozca el identificador', async () => {
    assert.equal((await patch(shortId, worker, edit)).status, 403)
    assert.equal((await request(range, worker)).status, 403)
    assert.equal((await audit(shortId)).length, 0)
  })
  await t.test('rechaza motivo vacío, fecha imposible y escrituras directas de horas', async () => {
    for (const body of [
      { ...edit, reason: '  ' },
      { ...edit, entryAt: '2026-02-30T08:00' },
      { ...edit, horas_normales: 9 },
    ]) assert.equal((await patch(shortId, hr, body)).status, 400)
  })
  await t.test('RH corrige ambas marcas y recalcula 8.50 horas con el contexto histórico', async () => {
    const result = await patch(shortId, hr, edit)
    assert.equal(result.status, 200, result.data.message)
    assert.equal(result.data.attendance.id_asistencia, shortId)
    assert.equal(result.data.attendance.entrada_local, '2026-11-16 08:00:00')
    assert.equal(result.data.attendance.salida_local, '2026-11-16 17:00:00')
    assert.deepEqual(counts(result.data.attendance), [8.5, 0, 0])
    const report = await request(range, hr)
    assert.equal(report.status, 200)
    assert.deepEqual(report.data.attendances.map(row => row.id_asistencia), [shortId])
    assert.deepEqual(counts(report.data.attendances[0]), [8.5, 0, 0])
  })
  await t.test('la bitácora conserva quién corrigió, cuándo, el motivo y los valores de ambas marcas', async () => {
    const [event] = await audit(shortId)
    assert.equal(event.id_usuario, hr)
    assert(event.fecha_hora)
    assert.equal(event.motivo, edit.reason)
    assert.equal(JSON.parse(event.valor_anterior).entrada, '2026-11-16 08:03:00')
    assert.equal(JSON.parse(event.valor_anterior).salida, '2026-11-16 08:07:00')
    assert.equal(JSON.parse(event.valor_nuevo).normales, 8.5)
  })
  await t.test('Administración genera horas extra sin repetir ni sumar horas festivas', async () => {
    const result = await patch(shortId, admin, { ...edit, exitAt: '2026-11-16T18:30' })
    assert.equal(result.status, 200, result.data.message)
    assert.deepEqual(counts(result.data.attendance), [8.5, 1.5, 0])
    const audits = await audit(shortId)
    assert.equal(audits.length, 2)
    assert.equal(audits[1].id_usuario, admin)
    assert.equal(JSON.parse(audits[1].valor_anterior).salida, '2026-11-16 17:00:00')
  })
  await t.test('rechaza una salida anterior y acepta el turno nocturno con fecha siguiente explícita', async () => {
    const overnight = { entryAt: '2026-11-19T22:00', exitAt: '2026-11-19T06:00', reason: 'Corrección nocturna' }
    assert.equal((await patch(nightId, hr, overnight)).status, 400)
    const accepted = await patch(nightId, hr, { ...overnight, exitAt: '2026-11-20T06:00' })
    assert.equal(accepted.status, 200, accepted.data.message)
    assert.equal(accepted.data.attendance.fecha_local, '2026-11-19')
    assert.deepEqual(counts(accepted.data.attendance), [7.5, 0, 0])
  })
  await t.test('una corrección de fecha duplicada devuelve 409', async () => {
    const result = await patch(shortId, hr, { ...edit, entryAt: '2026-11-17T08:00', exitAt: '2026-11-17T17:00' })
    assert.equal(result.status, 409)
    assert.equal((await audit(shortId)).length, 2)
  })
  await t.test('si falla la escritura de bitácora, se revierten las marcas y las horas', async () => {
    failAudit = true
    try {
      const failed = await patch(shortId, hr, { ...edit, exitAt: '2026-11-16T16:00' })
      assert.equal(failed.status, 500)
      assert.equal(failed.data.message, 'Fallo de bitácora simulado')
    } finally {
      failAudit = false
    }
    const { data } = await request(range, hr)
    assert.equal(data.attendances[0].salida_local, '2026-11-16 18:30:00')
    assert.deepEqual(counts(data.attendances[0]), [8.5, 1.5, 0])
    assert.equal((await audit(shortId)).length, 2)
  })
  await t.test('un registro antiguo sin contexto conserva el ajuste y queda para revisión', async () => {
    const result = await patch(oldId, hr, { ...edit, entryAt: '2026-11-18T08:00', exitAt: '2026-11-18T17:00' })
    assert.equal(result.status, 200, result.data.message)
    assert.equal(result.data.attendance.estado_calculo, 'sin_contexto')
    assert.deepEqual(counts(result.data.attendance), [0, 0, 0])
    assert.equal(JSON.parse((await audit(oldId))[0].valor_anterior).normales, 4)
  })
  await t.test('mover una jornada conserva el mismo ID y deja las horas pendientes de contexto', async () => {
    const result = await patch(shortId, hr, { ...edit, entryAt: '2026-11-21T08:00', exitAt: '2026-11-21T17:00' })
    assert.equal(result.status, 200, result.data.message)
    assert.equal(result.data.attendance.id_asistencia, shortId)
    assert.equal(result.data.attendance.fecha_local, '2026-11-21')
    assert.equal(result.data.attendance.estado_calculo, 'fecha_sin_contexto')
    assert.equal((await request(range, hr)).data.attendances.length, 0)
  })
  await t.test('el flujo del frontend obtiene la corrección y sus horas desde la API', async frontend => {
    const { adjustAttendance, loadAdjustableAttendance } = await import('../../src/store.js')
    const network = globalThis.fetch
    frontend.mock.method(globalThis, 'fetch', (path, options) => network(new URL(path, base), {
      ...options,
      headers: { ...options.headers, 'x-test-employee': String(hr) },
    }))
    const corrected = await adjustAttendance({ attendanceId: shortId, ...edit })
    assert.equal(corrected.ok, true, corrected.message)
    assert.equal(corrected.attendance.entryAt, '2026-11-16 08:00:00')
    assert.equal(corrected.attendance.exitAt, '2026-11-16 17:00:00')
    assert.equal(corrected.attendance.normalHours, 8.5)
    const loaded = await loadAdjustableAttendance({ from: '2026-11-16', to: '2026-11-16', userId: worker })
    assert.deepEqual(loaded.records, [corrected.attendance])
  })
})
