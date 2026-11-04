/**
 * Módulo de Recursos Humanos (el Administrador hereda estas pantallas).
 * Bandeja de permisos/faltas, calendario de festivos, reportes, Excel y bitácora.
 */
import { useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { Badge, Button, Card, Field, inputClass, Modal, PageHeader, Toast } from '../components'
import {
  adjustAttendance,
  buildReport,
  computeDay,
  estimatePay,
  formatDateTime,
  getState,
  getUser,
  holidayName,
  localISO,
  money,
  removeHoliday,
  reviewRequest,
  upsertHoliday,
} from '../store'

function monthRange() {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from, to: localISO(last) }
}

export function HrInbox() {
  const actor = getUser()
  const data = getState()
  const [filter, setFilter] = useState('pendiente')
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState(null)
  const [toast, setToast] = useState(null)

  const rows = data.requests.filter((r) => (filter === 'todas' ? true : r.status === filter))

  function decide(status) {
    const result = reviewRequest({ requestId: current.id, status, reviewerId: actor.id, reviewNote: note })
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    setCurrent(null)
    setNote('')
  }

  return (
    <div>
      <PageHeader
        kicker="Recursos Humanos"
        title="Bandeja de permisos y faltas"
        subtitle="Autoriza o rechaza incidencias. Cada decisión queda en bitácora con usuario, fecha y valor anterior."
        actions={
          <select className={`${inputClass} w-auto`} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="pendiente">Pendientes</option>
            <option value="aprobada">Aprobadas</option>
            <option value="rechazada">Rechazadas</option>
            <option value="todas">Todas</option>
          </select>
        }
      />
      <div className="space-y-3">
        {rows.length === 0 ? <Card><p className="text-sm text-cocoa-soft">No hay solicitudes en este filtro.</p></Card> : null}
        {rows.map((row) => {
          const emp = data.users.find((u) => u.id === row.userId)
          return (
            <Card key={row.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-cocoa">{emp?.name}</p>
                  <Badge tone="neutral">{emp?.position}</Badge>
                  <Badge tone={row.status === 'aprobada' ? 'ok' : row.status === 'rechazada' ? 'bad' : 'warn'}>{row.status}</Badge>
                </div>
                <p className="mt-1 text-sm capitalize text-cocoa-soft">{row.type} · {row.date} · {formatDateTime(row.createdAt)}</p>
                <p className="mt-2 max-w-3xl text-sm">{row.reason}</p>
                {row.reviewNote ? <p className="mt-2 text-sm text-cocoa-soft">Nota: {row.reviewNote}</p> : null}
              </div>
              {row.status === 'pendiente' ? (
                <Button onClick={() => setCurrent(row)}>Revisar</Button>
              ) : null}
            </Card>
          )
        })}
      </div>
      {current ? (
        <Modal title="Autorizar o rechazar" onClose={() => setCurrent(null)}>
          <p className="text-sm text-cocoa-soft">{current.reason}</p>
          <Field label="Nota para el expediente">
            <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="mt-4 flex gap-2">
            <Button variant="danger" className="flex-1" onClick={() => decide('rechazada')}>Rechazar</Button>
            <Button className="flex-1" onClick={() => decide('aprobada')}>Autorizar</Button>
          </div>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export function HrHolidays() {
  const actor = getUser()
  const data = getState()
  const [form, setForm] = useState({ date: '', name: '' })
  const [toast, setToast] = useState(null)

  function save(event) {
    event.preventDefault()
    const result = upsertHoliday({ ...form, actorId: actor.id })
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    if (result.ok) setForm({ date: '', name: '' })
  }

  return (
    <div>
      <PageHeader
        kicker="Calendario"
        title="Días festivos"
        subtitle="Estos días alimentan el cálculo de horas festivas (incluido por el reporte de nómina)."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <form className="space-y-4" onSubmit={save}>
            <Field label="Fecha">
              <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Nombre">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Día de Muertos" />
            </Field>
            <Button type="submit">Agregar al calendario</Button>
          </form>
        </Card>
        <Card>
          <ul className="space-y-3">
            {[...data.holidays].sort((a, b) => a.date.localeCompare(b.date)).map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-2xl bg-cream px-3 py-2">
                <div>
                  <p className="font-medium">{h.name}</p>
                  <p className="text-sm text-cocoa-soft">{h.date}</p>
                </div>
                <Button variant="danger" onClick={() => {
                  const result = removeHoliday(h.id, actor.id)
                  setToast({ type: 'ok', message: result.message })
                }}>Quitar</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export function HrReports() {
  const actor = getUser()
  const data = getState()
  const initial = monthRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [userId, setUserId] = useState('')
  const [edit, setEdit] = useState(null)
  const [toast, setToast] = useState(null)

  const report = useMemo(() => buildReport({ userId: userId || null, from, to }), [data, userId, from, to])

  function exportExcel() {
    const rows = report.flatMap((block) => {
      if (block.records.length === 0) {
        return [{
          Empleado: block.user.name,
          Puesto: block.user.position,
          Periodo: `${from} a ${to}`,
          'Horas normales': block.normal,
          'Horas extras': block.extra,
          'Horas festivas': block.holidayHours,
          Retardos: block.lateCount,
          'Faltas/permisos autorizados': block.authorizedAbsences,
          'Sueldo base': block.user.salary,
          'Importe estimado': Number(block.pay.total.toFixed(2)),
        }]
      }
      return [
        {
          Empleado: block.user.name,
          Puesto: block.user.position,
          Periodo: `${from} a ${to}`,
          'Horas normales': block.normal,
          'Horas extras': block.extra,
          'Horas festivas': block.holidayHours,
          Retardos: block.lateCount,
          'Faltas/permisos autorizados': block.authorizedAbsences,
          'Sueldo base': block.user.salary,
          'Importe estimado': Number(block.pay.total.toFixed(2)),
        },
      ]
    })
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Nomina')
    XLSX.writeFile(book, `Macaron-reporte-nomina-${from}-a-${to}.xlsx`)
    setToast({ type: 'ok', message: 'Se descargó el archivo .xlsx con el mismo filtro del reporte en pantalla.' })
  }

  function saveEdit(event) {
    event.preventDefault()
    const result = adjustAttendance({ ...edit, actorId: actor.id })
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    if (result.ok) setEdit(null)
  }

  return (
    <div>
      <PageHeader
        kicker="Reportes"
        title="Asistencia, puntualidad y apoyo a nómina"
        subtitle="No se conecta a bancos ni a contabilidad. El importe es una estimación interna a partir de horas y sueldo base."
        actions={<Button onClick={exportExcel}>Exportar Excel (.xlsx)</Button>}
      />
      <Card className="mb-5 grid gap-3 md:grid-cols-4">
        <Field label="Desde">
          <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Hasta">
          <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Empleado">
          <select className={inputClass} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Todo el personal</option>
            {data.users.filter((u) => u.role !== 'administrador').map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex items-end text-sm text-cocoa-soft">
          Extra ×{data.config.extraHourMultiplier} · Festivo ×{data.config.holidayHourMultiplier}
        </div>
      </Card>

      <div className="space-y-5">
        {report.map((block) => (
          <Card key={block.user.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-cocoa">{block.user.name}</h2>
                <p className="text-sm text-cocoa-soft">{block.user.position} · base {money(block.user.salary)}</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
                <Stat label="Normales" value={`${block.normal} h`} />
                <Stat label="Extras" value={`${block.extra} h`} />
                <Stat label="Festivas" value={`${block.holidayHours} h`} />
                <Stat label="Estimado" value={money(block.pay.total)} />
              </div>
            </div>
            <p className="mt-2 text-sm text-cocoa-soft">
              {block.workedDays} días con entrada · {block.lateCount} retardo(s) · {block.authorizedAbsences} falta/permiso autorizado(s)
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-cocoa-soft">
                  <tr>
                    <th className="py-2">Fecha</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Normal</th>
                    <th>Extra</th>
                    <th>Festivo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {block.records.map((rec) => {
                    const calc = computeDay(rec, block.user)
                    const pay = estimatePay(calc, block.user)
                    return (
                      <tr key={rec.id} className="border-t border-cocoa/10">
                        <td className="py-2">
                          {rec.date}
                          {calc.holiday ? <span className="ml-2 text-xs text-berry">{holidayName(rec.date)}</span> : null}
                          {rec.late ? <span className="ml-2 text-xs text-amber-700">retardo {rec.lateMinutes}’</span> : null}
                        </td>
                        <td>{rec.checkIn || '—'}</td>
                        <td>{rec.checkOut || '—'}</td>
                        <td>{calc.normal}</td>
                        <td>{calc.extra}</td>
                        <td>{calc.holidayHours}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="text-berry hover:underline"
                            onClick={() => setEdit({
                              attendanceId: rec.id,
                              extraHoursOverride: rec.extraHoursOverride ?? calc.extra,
                              holidayHoursOverride: rec.holidayHoursOverride ?? calc.holidayHours,
                              checkIn: rec.checkIn || '',
                              checkOut: rec.checkOut || '',
                              notes: rec.notes || '',
                              previewPay: pay.total,
                            })}
                          >
                            Ajustar
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {edit ? (
        <Modal title="Modificar reporte / horas extras o festivas" onClose={() => setEdit(null)}>
          <form className="space-y-3" onSubmit={saveEdit}>
            <p className="text-sm text-cocoa-soft">El empleado no edita marcajes. RH sí puede corregir inconsistencias; el valor anterior queda en bitácora.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Entrada">
                <input className={inputClass} value={edit.checkIn} onChange={(e) => setEdit({ ...edit, checkIn: e.target.value })} />
              </Field>
              <Field label="Salida">
                <input className={inputClass} value={edit.checkOut} onChange={(e) => setEdit({ ...edit, checkOut: e.target.value })} />
              </Field>
              <Field label="Horas extras">
                <input type="number" step="0.25" className={inputClass} value={edit.extraHoursOverride} onChange={(e) => setEdit({ ...edit, extraHoursOverride: e.target.value })} />
              </Field>
              <Field label="Horas festivas">
                <input type="number" step="0.25" className={inputClass} value={edit.holidayHoursOverride} onChange={(e) => setEdit({ ...edit, holidayHoursOverride: e.target.value })} />
              </Field>
            </div>
            <Field label="Nota">
              <textarea className={inputClass} rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            <Button type="submit" className="w-full">Guardar ajuste</Button>
          </form>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-cocoa-soft">{label}</p>
      <p className="font-semibold text-cocoa">{value}</p>
    </div>
  )
}

export function HrAudit() {
  const data = getState()
  return (
    <div>
      <PageHeader
        kicker="Trazabilidad"
        title="Bitácora de cambios"
        subtitle="RNF-009: usuario, fecha/hora y valor anterior de cada corrección a reportes, festivos o personal."
      />
      <Card>
        <div className="space-y-3">
          {data.auditLog.map((row) => {
            const who = data.users.find((u) => u.id === row.userId)
            return (
              <article key={row.id} className="rounded-2xl bg-cream p-4 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-semibold text-cocoa">{row.action}</p>
                  <span className="text-cocoa-soft">{formatDateTime(row.at)}</span>
                </div>
                <p className="mt-1 text-cocoa-soft">{who?.name || 'Sistema'} · {row.entity}</p>
                <p className="mt-2"><span className="text-cocoa-soft">Antes:</span> {row.previousValue || '—'}</p>
                <p><span className="text-cocoa-soft">Después:</span> {row.newValue}</p>
              </article>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
