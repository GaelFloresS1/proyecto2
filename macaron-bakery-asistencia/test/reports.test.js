import assert from 'node:assert/strict'
import { before, test } from 'node:test'
import { buildReport, getState, money, patch, ROLES, roundEstimatedPay } from '../src/store.js'

const period = { from: '2026-11-01', to: '2026-11-30' }
const employee = { id: 2, role: ROLES.EMPLEADO, salary: 19200 }
const otherEmployee = { id: 3, role: ROLES.EMPLEADO, salary: null }
const regularDay = {
  userId: employee.id,
  date: period.from,
  checkIn: '08:15',
  status: 'cerrado',
  calculationStatus: 'calculado',
  normalHours: '8.25',
  extraHours: '1.50',
  holidayHours: '0.00',
  late: true,
}
const holiday = {
  ...regularDay,
  date: period.to,
  calculationStatus: 'historico',
  normalHours: '0.00',
  extraHours: '0.00',
  holidayHours: '6.50',
  late: false,
}
const openDay = {
  ...regularDay,
  date: '2026-11-20',
  status: 'abierto',
  late: false,
}

before(() => {
  patch(() => ({
    users: [{ id: 1, role: ROLES.ADMIN }, employee, otherEmployee],
    config: { monthlyHours: 192, extraHourMultiplier: 1.5, holidayHourMultiplier: 2 },
    attendances: [
      regularDay,
      holiday,
      openDay,
      { ...regularDay, date: '2026-10-31' },
      { ...regularDay, userId: otherEmployee.id },
    ],
  }))
})

test('calcula asistencias, horas, retardos y nómina sin requests en el estado', () => {
  assert.equal(Object.hasOwn(getState(), 'requests'), false)

  const report = buildReport(period)
  assert.deepEqual(report.map(block => block.user.id), [employee.id, otherEmployee.id])
  assert.deepEqual(report[0], {
    user: employee,
    records: [regularDay, holiday, openDay],
    lateCount: 1,
    extra: 1.5,
    holidayHours: 6.5,
    normal: 8.25,
    workedDays: 3,
    authorizedAbsences: null,
    pending: null,
    rejected: null,
    pay: { hour: 100, normalPay: 825, extraPay: 225, holidayPay: 1300, total: 2350 },
  })
  assert.equal(report[1].pay, null)
})

test('muestra el reporte de la API y ceros confirmados cuando no hay solicitudes', () => {
  const [block] = buildReport({ ...period, userId: String(employee.id), attendances: [holiday], requests: [] })
  assert.deepEqual(block.records, [holiday])
  assert.equal(block.holidayHours, 6.5)
  assert.equal(block.authorizedAbsences, 0)
  assert.equal(block.pending, 0)
  assert.equal(block.rejected, 0)
})

test('cuenta las solicitudes de la API por empleado y dentro del período', () => {
  const request = { employeeId: employee.id, date: period.from, type: 'permiso', status: 'aprobada' }
  const requests = [
    request,
    { ...request, date: period.to, type: 'falta' },
    { ...request, type: 'justificacion' },
    { ...request, type: 'justificacion', status: 'pendiente' },
    { ...request, status: 'rechazada' },
    { ...request, employeeId: otherEmployee.id, status: 'pendiente' },
    { ...request, date: '2026-12-01', status: 'rechazada' },
  ]
  const [block] = buildReport({ ...period, userId: String(employee.id), requests })

  assert.equal(block.authorizedAbsences, 2)
  assert.equal(block.pending, 1)
  assert.equal(block.rejected, 1)
})

test('redondea el importe a los centavos que muestra la vista del reporte', () => {
  const [block] = buildReport({
    ...period, userId: String(employee.id), attendances: [
      { ...regularDay, normalHours: '0.01', extraHours: '0.00' },
    ],
  })
  assert.equal(roundEstimatedPay(block.pay.total), 1)
  assert.equal(roundEstimatedPay(1.005), 1.01)
  assert.equal(money(roundEstimatedPay(1.005)), money(1.005))
})
