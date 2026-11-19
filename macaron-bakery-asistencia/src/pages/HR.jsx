/**
 * Módulo de Recursos Humanos (el Administrador hereda estas pantallas).
 * Bandeja de permisos/faltas, calendario de festivos, reportes, Excel y bitácora.
 */
import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { Badge, Button, Card, Field, inputClass, Modal, PageHeader, Toast } from '../components'
import {
  adjustAttendance,
  buildReport,
  computeDay,
  formatDateTime,
  getState,
  loadAdjustableAttendance,
  loadAuditMovements,
  loadHolidays,
  loadReviewRequests,
  localISO,
  money,
  removeHoliday,
  REQUEST_LABEL,
  reviewRequest,
  saveAttendanceReport,
  upsertHoliday,
} from '../store'
import HrReportHistory from './HrReportHistory'

function monthRange() {
  const now = new Date()
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { from, to: localISO(last) }
}

export function HrInbox() {
  const [filter, setFilter] = useState('pendiente')
  const [inbox, setInbox] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let active = true
    loadReviewRequests(filter).then(result => {
      if (active) setInbox({ ...result, filter })
    }).catch(() => {
      if (active) setInbox({ ok: false, filter, message: 'No se pudo cargar la bandeja.' })
    })
    return () => { active = false }
  }, [filter, loadAttempt])

  const loaded = inbox?.filter === filter ? inbox : null

  function openReview(row) {
    setNote('')
    setReviewError('')
    setCurrent(row)
  }

  async function decide(decision) {
    if (saving) return
    setSaving(true)
    setReviewError('')
    try {
      const result = await reviewRequest({ requestId: current.id, type: current.type, decision, note })
      if (!result.ok) {
        setReviewError(result.message)
        if (result.status === 409) setLoadAttempt(attempt => attempt + 1)
        return
      }
      setLoadAttempt(attempt => attempt + 1)
      setCurrent(null)
      setToast({ type: 'ok', message: result.message })
    } catch {
      setReviewError('No se pudo completar la resolución. Consulta la bandeja antes de volver a intentar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Recursos Humanos"
        title="Bandeja de permisos y faltas"
        subtitle="Autoriza o rechaza permisos, faltas y justificantes. Cada decisión queda en bitácora."
        actions={
          <select aria-label="Estado de solicitudes" className={`${inputClass} w-auto`} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="pendiente">Pendientes</option>
            <option value="aprobada">Aprobadas</option>
            <option value="rechazada">Rechazadas</option>
            <option value="todas">Todas</option>
          </select>
        }
      />
      <div className="space-y-3">
        {!loaded ? <Card><p role="status" className="text-sm text-cocoa-soft">Cargando solicitudes…</p></Card> : null}
        {loaded?.ok === false ? (
          <Card className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-sm text-berry">{loaded.message}</p>
            {loaded.status !== 403 ? <Button variant="ghost" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Reintentar</Button> : null}
          </Card>
        ) : null}
        {loaded?.ok && !loaded.requests.length ? <Card><p className="text-sm text-cocoa-soft">No hay solicitudes en este filtro.</p></Card> : null}
        {loaded?.ok ? loaded.requests.map(row => (
          <Card key={`${row.type}/${row.id}`} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-cocoa">{row.employeeName}</p>
                <Badge tone="neutral">{row.employeePosition}</Badge>
                <Badge tone={row.status === 'aprobada' ? 'ok' : row.status === 'rechazada' ? 'bad' : 'warn'}>{row.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-cocoa-soft">
                {REQUEST_LABEL[row.type]} · {row.date}{row.exitTime ? ` · ${row.exitTime}` : ''}
              </p>
              <p className="mt-2 max-w-3xl text-sm">{row.reason}</p>
              <p className="mt-2 text-xs text-cocoa-soft">Enviada el {formatDateTime(row.createdAt)}</p>
              {row.resolvedAt ? <p className="mt-1 text-xs text-cocoa-soft">Resuelta el {formatDateTime(row.resolvedAt)}</p> : null}
              {row.reviewNote ? <p className="mt-2 text-sm text-cocoa-soft">Observación · {row.reviewNote}</p> : null}
            </div>
            {row.canResolve ? <Button onClick={() => openReview(row)}>Revisar</Button> : null}
            {row.status === 'pendiente' && !row.canResolve
              ? <p className="text-sm text-cocoa-soft">Otra persona con permiso debe resolverla.</p>
              : null}
          </Card>
        )) : null}
      </div>
      {current ? (
        <Modal title="Autorizar o rechazar" onClose={() => { if (!saving) setCurrent(null) }}>
          <p className="text-sm text-cocoa-soft">{current.employeeName} · {REQUEST_LABEL[current.type]} · {current.date}</p>
          <p className="mt-2 text-sm text-cocoa-soft">{current.reason}</p>
          <Field label="Observación (obligatoria al rechazar)">
            <textarea className={inputClass} rows={3} maxLength={255} value={note} onChange={e => setNote(e.target.value)} disabled={saving} />
          </Field>
          {reviewError ? <p role="alert" className="mt-2 text-sm text-berry">{reviewError}</p> : null}
          <div className="mt-4 flex gap-2">
            <Button variant="danger" className="flex-1" disabled={saving} onClick={() => decide('rechazar')}>Rechazar</Button>
            <Button className="flex-1" disabled={saving} onClick={() => decide('aprobar')}>{saving ? 'Guardando…' : 'Autorizar'}</Button>
          </div>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

const emptyHoliday = { id: null, date: '', description: '' }

export function HrHolidays() {
  const [form, setForm] = useState(emptyHoliday)
  const [calendar, setCalendar] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [pending, setPending] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    let active = true
    loadHolidays().then(result => {
      if (active) setCalendar(result)
    }).catch(() => {
      if (active) setCalendar({ ok: false, message: 'No se pudo cargar el calendario.' })
    })
    return () => { active = false }
  }, [loadAttempt])

  function replaceHoliday(holiday, remove = false) {
    setCalendar(current => {
      const holidays = current.holidays.filter(row => row.id !== holiday.id)
      if (!remove) holidays.push(holiday)
      return { ...current, holidays: holidays.sort((a, b) => a.date.localeCompare(b.date)) }
    })
  }

  async function save(event) {
    event.preventDefault()
    if (pending) return
    setPending(true)
    try {
      const result = await upsertHoliday(form)
      setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
      if (result.ok) {
        replaceHoliday(result.holiday)
        setForm(emptyHoliday)
      }
    } finally {
      setPending(false)
    }
  }

  async function remove(holiday) {
    if (pending || !window.confirm(`¿Eliminar el día festivo «${holiday.description}»?`)) return
    setPending(true)
    try {
      const result = await removeHoliday(holiday.id)
      setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
      if (result.ok) {
        replaceHoliday(result.holiday, true)
        if (form.id === holiday.id) setForm(emptyHoliday)
      }
    } finally {
      setPending(false)
    }
  }

  const canManage = calendar?.canManage === true

  return (
    <div>
      <PageHeader
        kicker="Calendario"
        title="Días festivos"
        subtitle="Asistencia usa estas fechas para identificar las jornadas que coinciden con un festivo."
      />
      <div className={canManage ? 'grid gap-5 lg:grid-cols-2' : 'grid gap-5'}>
        {canManage ? (
          <Card>
            <form className="space-y-4" onSubmit={save}>
              <Field label="Fecha">
                <input type="date" className={inputClass} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required disabled={pending} />
              </Field>
              <Field label="Descripción">
                <input className={inputClass} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Ej. Día de Muertos" maxLength={100} required disabled={pending} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={pending}>{form.id ? 'Guardar cambios' : 'Agregar al calendario'}</Button>
                {form.id ? <Button variant="ghost" onClick={() => setForm(emptyHoliday)} disabled={pending}>Cancelar</Button> : null}
              </div>
            </form>
          </Card>
        ) : null}
        <Card>
          {!calendar ? <p role="status" className="text-sm text-cocoa-soft">Cargando festivos…</p> : null}
          {calendar?.ok === false ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="alert" className="text-sm text-berry">{calendar.message}</p>
              <Button variant="ghost" onClick={() => {
                setCalendar(null)
                setLoadAttempt(attempt => attempt + 1)
              }}>Reintentar</Button>
            </div>
          ) : null}
          {calendar?.ok ? (
            calendar.holidays.length ? (
              <ul className="space-y-3">
                {calendar.holidays.map(holiday => (
                  <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2">
                    <div>
                      <p className="font-medium">{holiday.description}</p>
                      <p className="text-sm text-cocoa-soft">{holiday.date}</p>
                    </div>
                    {canManage ? (
                      <div className="flex gap-2">
                        <Button variant="ghost" onClick={() => setForm(holiday)} disabled={pending}>Editar</Button>
                        <Button variant="danger" onClick={() => remove(holiday)} disabled={pending}>Eliminar</Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-cocoa-soft">No hay días festivos registrados.</p>
          ) : null}
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export function HrReports() {
  const data = getState()
  const initial = monthRange()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [userId, setUserId] = useState('')
  const [edit, setEdit] = useState(null)
  const [editError, setEditError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attendance, setAttendance] = useState(null)
  const [requestResult, setRequestResult] = useState(null)
  const [savingReport, setSavingReport] = useState(false)
  const [savedReportId, setSavedReportId] = useState(null)
  const [toast, setToast] = useState(null)

  const rangeKey = `${from}/${to}/${userId}`
  const validRange = from && to && from <= to
  const current = attendance?.key === rangeKey ? attendance : null
  const requests = requestResult?.ok && Array.isArray(requestResult.requests) ? requestResult.requests : undefined
  const report = current?.ok ? buildReport({ userId, from, to, attendances: current.records, requests }) : []

  useEffect(() => {
    let active = true
    loadReviewRequests('todas')
      .then(result => {
        if (active) setRequestResult(result)
      })
      .catch(() => {
        if (active) setRequestResult({ ok: false })
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!validRange) return
    let active = true
    loadAdjustableAttendance({ from, to, userId })
      .then(result => {
        if (active) setAttendance({ ...result, key: rangeKey })
      })
      .catch(() => {
        if (active) setAttendance({ key: rangeKey, ok: false, message: 'No se pudieron cargar las asistencias.' })
      })
    return () => { active = false }
  }, [from, to, userId, validRange, rangeKey])

  async function saveReport() {
    if (!validRange || savingReport) return
    setSavingReport(true)
    try {
      const result = await saveAttendanceReport({ from, to, userId })
      if (!result.ok) {
        setToast({ type: 'error', message: result.message })
        return
      }
      setSavedReportId(result.reportId)
      setToast({ type: 'ok', message: `Reporte de asistencia #${result.reportId} guardado en el historial.` })
    } catch {
      setToast({ type: 'error', message: 'No se pudo confirmar el guardado. Consulta el historial antes de reintentar.' })
    } finally {
      setSavingReport(false)
    }
  }

  function exportExcel() {
    const requestStatus = requestResult ? 'No disponible' : 'Consulta pendiente'
    const rows = report.map((block) => ({
      Empleado: block.user.name,
      Puesto: block.user.position,
      Periodo: `${from} a ${to}`,
      'Sueldo mensual contratado': block.user.salary,
      'Horas normales': block.normal,
      'Horas extra': block.extra,
      'Horas festivas': block.holidayHours,
      Retardos: block.lateCount,
      'Faltas/permisos autorizados': block.authorizedAbsences ?? requestStatus,
      'Solicitudes pendientes': block.pending ?? requestStatus,
      'Solicitudes rechazadas': block.rejected ?? requestStatus,
      'Pago estimado del período': block.pay ? Number(block.pay.total.toFixed(2)) : null,
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Nomina')
    XLSX.writeFile(book, `Macaron-reporte-nomina-${from}-a-${to}.xlsx`)
    setToast({ type: 'ok', message: 'Se descargó el archivo .xlsx con el mismo filtro del reporte en pantalla.' })
  }

  function openEdit(record) {
    setEditError('')
    setEdit({
      attendanceId: record.id,
      entryAt: record.entryAt.replace(' ', 'T'),
      exitAt: record.exitAt.replace(' ', 'T'),
      reason: '',
    })
  }

  async function saveEdit(event) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setEditError('')
    try {
      const result = await adjustAttendance(edit)
      if (!result.ok) {
        setEditError(result.message)
        return
      }
      const corrected = result.attendance
      setAttendance(latest => latest?.ok ? {
        ...latest,
        records: latest.records.map(record => record.id === corrected.id ? corrected : record)
          .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
      } : latest)
      setToast({ type: corrected.calculationStatus === 'calculado' ? 'ok' : 'warn', message: result.message })
      setEdit(null)
    } catch {
      setEditError('No se pudo completar el ajuste. Recarga el reporte para comprobar el registro.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Reportes"
        title="Asistencia, puntualidad y apoyo a nómina"
        subtitle="El pago del período se estima a partir de las horas trabajadas y el sueldo mensual contratado."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={saveReport} disabled={!validRange || savingReport}>{savingReport ? 'Guardando…' : 'Guardar reporte'}</Button>
            <Button variant="ghost" onClick={exportExcel} disabled={!current?.ok}>Exportar Excel (.xlsx)</Button>
          </div>
        }
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

      {!validRange ? <p role="alert" className="text-sm text-berry">Selecciona un rango de fechas válido.</p> : null}
      {validRange && !current ? <p role="status" className="text-sm text-cocoa-soft">Cargando asistencias…</p> : null}
      {current?.ok === false ? <p role="alert" className="text-sm text-berry">{current.message}</p> : null}
      {current?.ok && !requests ? (
        <p role="status" className="mb-3 text-sm text-cocoa-soft">
          {requestResult ? 'Contadores de solicitudes no disponibles.' : 'Consultando solicitudes…'}
        </p>
      ) : null}

      <HrReportHistory key={savedReportId} />

      <div className="space-y-5">
        {report.map((block) => (
          <Card key={block.user.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-cocoa">{block.user.name}</h2>
                <p className="text-sm text-cocoa-soft">
                  {block.user.position} · Sueldo mensual contratado {block.user.salary === null ? 'no disponible' : money(block.user.salary)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-4">
                <Stat label="Horas normales" value={`${block.normal} h`} />
                <Stat label="Horas extra" value={`${block.extra} h`} />
                <Stat label="Horas festivas" value={`${block.holidayHours} h`} />
                <Stat label="Pago estimado del período" value={block.pay ? money(block.pay.total) : 'No disponible'} />
              </div>
            </div>
            {requests ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-cocoa-soft">
                <span>Faltas/permisos autorizados <strong>{block.authorizedAbsences}</strong></span>
                <span>Solicitudes pendientes <strong>{block.pending}</strong></span>
                <span>Solicitudes rechazadas <strong>{block.rejected}</strong></span>
              </div>
            ) : null}
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
                    const calc = computeDay(rec)
                    const pending = rec.status !== 'cerrado' || !['calculado', 'historico'].includes(rec.calculationStatus)
                    return (
                      <tr key={rec.id} className="border-t border-cocoa/10">
                        <td className="py-2">
                          {rec.date}
                          {rec.isHoliday || calc.holiday ? <span className="ml-2 text-xs text-berry">Coincide con festivo</span> : null}
                          {rec.late ? <span className="ml-2 text-xs text-amber-700">retardo{rec.lateMinutes == null ? '' : ` ${rec.lateMinutes}’`}</span> : null}
                          {pending ? <span className="ml-2 text-xs text-amber-700">{rec.status === 'abierto' ? 'Jornada abierta' : 'Horas por revisar'}</span> : null}
                        </td>
                        <td>{rec.checkIn || '—'}</td>
                        <td>{rec.checkOut || '—'}</td>
                        <td>{pending ? '—' : calc.normal}</td>
                        <td>{pending ? '—' : calc.extra}</td>
                        <td>{pending ? '—' : calc.holidayHours}</td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="text-berry hover:underline"
                            onClick={() => openEdit(rec)}
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
        <Modal title="Ajustar asistencia" onClose={() => { if (!saving) setEdit(null) }}>
          <form className="space-y-3" onSubmit={saveEdit}>
            <p className="text-sm text-cocoa-soft">La bitácora conserva los valores anteriores y el motivo. Para una salida de madrugada, selecciona la fecha del día siguiente.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fecha y hora de entrada">
                <input type="datetime-local" step="1" className={inputClass} value={edit.entryAt} onChange={(e) => setEdit({ ...edit, entryAt: e.target.value })} required disabled={saving} />
              </Field>
              <Field label="Fecha y hora de salida">
                <input type="datetime-local" step="1" className={inputClass} value={edit.exitAt} onChange={(e) => setEdit({ ...edit, exitAt: e.target.value })} required disabled={saving} />
              </Field>
            </div>
            <Field label="Motivo del ajuste">
              <textarea className={inputClass} rows={2} maxLength={255} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} required disabled={saving} />
            </Field>
            {editError ? <p role="alert" className="text-sm text-berry">{editError}</p> : null}
            <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar ajuste'}</Button>
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

const auditActions = { ALTA: 'Alta', BAJA: 'Baja', CAMBIO: 'Cambio', CORRECCION: 'Corrección' }
const auditEntities = {
  empleado: 'Empleados',
  turno: 'Turnos',
  asistencia: 'Asistencias y ajustes',
  festivo: 'Festivos',
  solicitud_permiso: 'Permisos y solicitudes de falta',
  justificante: 'Justificantes',
  falta: 'Faltas',
}

export function HrAudit() {
  const [query, setQuery] = useState({ page: 1 })
  const [result, setResult] = useState(null)
  const current = result?.query === query ? result : null

  useEffect(() => {
    let active = true
    loadAuditMovements(query).then(data => {
      if (active) setResult({ query, ...data })
    }).catch(() => {
      if (active) setResult({ query, ok: false, message: 'No se pudo cargar la bitácora.' })
    })
    return () => { active = false }
  }, [query])

  function applyFilters(event) {
    event.preventDefault()
    setQuery({ ...Object.fromEntries(new FormData(event.currentTarget)), page: 1 })
  }

  return (
    <div>
      <PageHeader
        kicker="Trazabilidad"
        title="Bitácora de cambios"
        subtitle="Consulta los movimientos registrados y quién los realizó."
      />
      <Card>
        <form className="mb-4 space-y-3" onSubmit={applyFilters} onReset={() => setQuery({ page: 1 })}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Desde"><input className={inputClass} type="date" name="from" /></Field>
            <Field label="Hasta"><input className={inputClass} type="date" name="to" /></Field>
            <Field label="Responsable"><input className={inputClass} name="actor" placeholder="Nombre o ID" maxLength={100} /></Field>
            <Field label="Entidad">
              <input className={inputClass} name="entity" list="audit-entities" maxLength={50} />
              <datalist id="audit-entities">
                {Object.entries(auditEntities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </datalist>
            </Field>
            <Field label="Acción">
              <select className={inputClass} name="action">
                <option value="">Todas</option>
                {Object.entries(auditActions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit">Filtrar</Button>
            <Button type="reset" variant="ghost">Limpiar</Button>
          </div>
        </form>
        {!current && <p role="status" className="text-sm text-cocoa-soft">Cargando movimientos…</p>}
        {current?.ok === false && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-sm text-berry">{current.message}</p>
            {current.status !== 400 && current.status !== 403 && (
              <Button variant="ghost" onClick={() => setQuery({ ...query })}>Reintentar</Button>
            )}
          </div>
        )}
        {current?.ok && current.movements.length === 0 && (
          <p className="text-sm text-cocoa-soft">No hay movimientos en esta página.</p>
        )}
        <div className="space-y-3">
          {current?.ok && current.movements.map(row => (
            <article key={row.id} className="break-words rounded-2xl bg-cream p-4 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <p className="font-semibold text-cocoa">{auditActions[row.action] ?? row.action}</p>
                <time dateTime={row.at} className="text-cocoa-soft">{formatDateTime(row.at)}</time>
              </div>
              <p className="mt-1 text-cocoa-soft">{row.employeeName ?? `Empleado #${row.employeeId}`} · {row.entity} #{row.recordId}</p>
              <dl className="mt-2 space-y-1">
                <div><dt className="inline text-cocoa-soft">Campo</dt><dd className="ml-2 inline">{row.field ?? '—'}</dd></div>
                <div><dt className="inline text-cocoa-soft">Antes</dt><dd className="ml-2 inline">{row.previousValue ?? '—'}</dd></div>
                <div><dt className="inline text-cocoa-soft">Después</dt><dd className="ml-2 inline">{row.newValue ?? '—'}</dd></div>
                <div><dt className="inline text-cocoa-soft">Motivo</dt><dd className="ml-2 inline">{row.reason ?? '—'}</dd></div>
              </dl>
            </article>
          ))}
        </div>
        {current?.ok && (current.page > 1 || current.hasNext) && (
          <nav aria-label="Páginas de bitácora" className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" disabled={current.page === 1} onClick={() => setQuery({ ...query, page: current.page - 1 })}>Anterior</Button>
            <span className="text-sm text-cocoa-soft">Página {current.page}</span>
            <Button variant="ghost" disabled={!current.hasNext} onClick={() => setQuery({ ...query, page: current.page + 1 })}>Siguiente</Button>
          </nav>
        )}
      </Card>
    </div>
  )
}
