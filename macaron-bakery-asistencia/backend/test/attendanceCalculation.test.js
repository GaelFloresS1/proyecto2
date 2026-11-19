import assert from 'node:assert/strict'
import test from 'node:test'
import { publicAttendance } from '../src/controllers/attendanceController.js'
import { attendanceState, closeCalculation, entryContext, withLateness } from '../src/services/attendanceCalculation.js'

const dayShift = {
  id_turno: 1,
  activo: 1,
  hora_inicio: '08:00:00',
  hora_fin: '17:00:00',
  minutos_descanso: 0,
  dias_laborales: '[1,2,3,4,5,6]',
}

function clock(local) {
  return { local, epoch: Date.parse(local.replace(' ', 'T') + 'Z') / 1000 }
}

test('un turno sin descanso programado distribuye las horas sin superposición', () => {
  const entry = entryContext(clock('2026-11-16 08:00:00'), dayShift)
  for (const [time, normal, extra] of [
    ['17:00:00', 9, 0],
    ['15:00:00', 7, 0],
    ['18:30:00', 9, 1.5],
    ['08:15:00', 0.25, 0],
    ['08:00:01', 0, 0],
  ]) {
    const result = closeCalculation(entry, clock(`2026-11-16 ${time}`), false)
    assert.deepEqual([result.status, result.normal, result.extra, result.holiday], ['calculado', normal, extra, 0])
    assert.equal(Math.round((result.normal + result.extra + result.holiday) * 100), Math.round(result.workedSeconds * 100 / 3600))
  }
})

test('una jornada con descanso previsto queda pendiente si solo hay marcajes de entrada y salida', () => {
  const entry = entryContext(clock('2026-11-16 08:00:00'), { ...dayShift, minutos_descanso: 30 })
  for (const time of ['08:15:00', '08:30:00', '08:45:00', '17:00:00']) {
    const result = closeCalculation(entry, clock(`2026-11-16 ${time}`), false)
    assert.deepEqual(result, { status: 'descanso_pendiente' })
  }
  assert.equal(closeCalculation(entry, clock('2026-11-16 08:00:00'), false).status, 'incompleto')
})

test('el retardo usa la tolerancia del marcaje y detecta segundos fuera del límite', () => {
  const onTime = clock('2026-11-16 08:10:00')
  assert.equal(withLateness(entryContext(onTime, dayShift), onTime, 10).lateMinutes, 0)
  const late = clock('2026-11-16 08:12:01')
  assert.equal(withLateness(entryContext(late, dayShift), late, 10).lateMinutes, 3)
  assert.equal(withLateness(entryContext(late, dayShift), late, 15).lateMinutes, 0)
})

test('un turno nocturno conserva su fecha de referencia y admite salida al día siguiente', () => {
  const nightShift = { ...dayShift, hora_inicio: '22:00:00', hora_fin: '06:00:00' }
  const entryClock = clock('2026-11-16 22:00:00')
  const entry = entryContext(entryClock, nightShift)
  const row = { entrada_local: entryClock.local, fecha_local: entry.date, entry, salida_local: null }
  const exit = clock('2026-11-17 06:30:00')
  assert.equal(attendanceState(row, exit), 'abierto')
  const result = closeCalculation(entry, exit, false)
  assert.deepEqual([result.normal, result.extra, result.holiday], [8, 0.5, 0])
  assert.equal(attendanceState(row, clock('2026-11-17 22:00:00')), 'incompleto')
})

test('una entrada nocturna de madrugada usa el día anterior cuando estaba programado', () => {
  const nightShift = { ...dayShift, hora_inicio: '22:00:00', hora_fin: '06:00:00' }
  const entryClock = clock('2026-11-17 00:30:00')
  const entry = withLateness(entryContext(entryClock, nightShift), entryClock, 10)
  assert.equal(entry.date, '2026-11-16')
  assert.equal(entry.lateMinutes, 140)
})

test('sin turno, con día fuera de jornada o con festivo pendiente se preserva el marcaje sin inventar horas', () => {
  const start = clock('2026-11-16 08:00:00')
  const end = clock('2026-11-16 17:00:00')
  assert.deepEqual(closeCalculation(entryContext(start, null), end, false), { status: 'sin_turno' })
  assert.deepEqual(closeCalculation(entryContext(start, { ...dayShift, dias_laborales: '[0]' }), end, false), { status: 'turno_no_aplicable' })
  assert.deepEqual(closeCalculation(entryContext(start, dayShift), end, true), { status: 'festivo_pendiente' })
  assert.deepEqual(closeCalculation(null, end, false), { status: 'sin_contexto' })
})

test('un marcaje histórico abierto pasa a incompleto al terminar su fecha', () => {
  const row = { entrada_local: '2026-11-16 08:00:00', fecha_local: '2026-11-16', salida_local: null }
  assert.equal(attendanceState(row, clock('2026-11-16 17:00:00')), 'abierto')
  assert.equal(attendanceState(row, clock('2026-11-17 08:00:00')), 'incompleto')
  assert.equal(attendanceState({ ...row, salida_local: row.entrada_local }, clock('2026-11-17 08:00:00')), 'incompleto')
})

const closedRow = {
  fecha_local: '2026-11-16',
  entrada_local: '2026-11-16 08:00:00',
  salida_local: '2026-11-16 17:00:00',
  horas_normales: '0.00',
  horas_extra: '0.00',
  horas_festiva: '0.00',
}

test('DECIMAL como texto no confunde ceros con horas históricas guardadas', () => {
  const now = clock('2026-11-17 08:00:00')
  const uncalculated = publicAttendance(closedRow, now)
  assert.deepEqual([uncalculated.horas_normales, uncalculated.horas_extra, uncalculated.horas_festiva], [0, 0, 0])
  assert.equal(uncalculated.estado_calculo, 'historico_sin_calculo')

  const historical = publicAttendance({ ...closedRow, horas_normales: '7.50', horas_extra: 1.25 }, now)
  assert.deepEqual([historical.horas_normales, historical.horas_extra, historical.estado_calculo], [7.5, 1.25, 'historico'])
})

test('NULL se conserva y evita presentar horas parciales como calculadas', () => {
  const now = clock('2026-11-17 08:00:00')
  const row = { ...closedRow, horas_normales: '7.50', horas_extra: null }
  assert.equal(publicAttendance(row, now).estado_calculo, 'historico_sin_calculo')
  const result = publicAttendance({ ...row, result: { status: 'calculado' } }, now)
  assert.equal(result.horas_extra, null)
  assert.equal(result.estado_calculo, 'horas_pendientes')
  assert.equal(publicAttendance({ ...closedRow, result: { status: 'calculado' } }, now).estado_calculo, 'calculado')
})

test('un cierre conserva el motivo pendiente y una duración inválida prevalece sobre la bitácora anterior', () => {
  const now = clock('2026-11-17 08:00:00')
  for (const status of ['sin_turno', 'festivo_pendiente', 'descanso_pendiente']) {
    const row = publicAttendance({ ...closedRow, result: { status } }, now)
    assert.deepEqual([row.estado, row.estado_calculo], ['cerrado', status])
  }
  const invalid = publicAttendance({
    ...closedRow, salida_local: closedRow.entrada_local, result: { status: 'calculado' },
  }, now)
  assert.deepEqual([invalid.estado, invalid.estado_calculo], ['incompleto', 'incompleto'])
  const observed = publicAttendance({
    ...closedRow, salida_local: closedRow.entrada_local, result: { status: 'descanso_pendiente', elapsedSeconds: 3600 },
  }, now)
  assert.deepEqual([observed.estado, observed.estado_calculo], ['cerrado', 'descanso_pendiente'])
})
