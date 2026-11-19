/**
 * Módulo del empleado (Barista, Cajero, Capacitador y también Supervisor).
 * - Registrar hora de entrada/salida con el reloj de MariaDB.
 * - Justificar un retardo vinculado a una asistencia.
 * - Solicitar permiso o falta.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LogIn, LogOut } from 'lucide-react'
import { Badge, Button, Card, Field, inputClass, PageHeader, Toast } from '../components'
import {
  clockIn,
  clockOut,
  loadMyAttendance,
  createRequest,
  formatDateTime,
  getShift,
  getState,
  getUser,
  loadMyRequests,
  localISO,
  REQUEST_LABEL,
} from '../store'

function attendanceBadge(record) {
  if (!record) return { tone: 'neutral', label: 'Sin marcar' }
  if (record.status === 'incompleto') return { tone: 'warn', label: 'Incompleto' }
  if (record.calculationStatus === 'sin_turno') {
    return { tone: 'warn', label: record.status === 'abierto' ? 'Abierto · sin turno' : 'Sin turno' }
  }
  if (record.status === 'abierto') return { tone: 'info', label: 'Abierto' }
  if (record.calculationStatus === 'festivo_pendiente') return { tone: 'warn', label: 'Festivo pendiente' }
  if (!['calculado', 'historico'].includes(record.calculationStatus)) {
    return { tone: 'warn', label: 'Horas pendientes' }
  }
  return record.late ? { tone: 'warn', label: 'Retardo' } : { tone: 'ok', label: 'Jornada cerrada' }
}

export function EmployeeClock() {
  const user = getUser()
  const data = getState()
  const [toast, setToast] = useState(null)
  const [marking, setMarking] = useState(false)

  useEffect(() => {
    loadMyAttendance().then((result) => {
      if (!result.ok) {
        setToast({
          type: 'error',
          message: result.message,
        })
      }
    })
  }, [])

  const today = localISO()
  const shift = getShift(user.shiftId)
  const records = data.attendances.filter(record => record.userId === user.id)
  const todayRec = records.find(record => record.status === 'abierto') ??
    records.find(record => [record.date, record.entryDate, record.exitDate].includes(today))
  const history = records.slice(0, 8)
  const badge = attendanceBadge(todayRec)

  async function mark(register) {
    if (marking) return
    setMarking(true)
    try {
      const result = await register(user.id)
      const pending = result.record?.status === 'cerrado' && result.record.calculationStatus !== 'calculado'
      setToast({
        type: result.ok ? (result.late || pending ? 'warn' : 'ok') : 'error',
        message: result.message,
      })
    } catch {
      setToast({ type: 'error', message: 'No se pudo completar el marcaje. Comprueba el historial antes de volver a intentar.' })
    } finally {
      setMarking(false)
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Módulo empleado"
        title={`Hola, ${user.name.split(' ')[0]}`}
        subtitle="Registra tu entrada y salida con la hora de MariaDB."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-cocoa-soft">Turno asignado</p>
              <p className="font-display text-2xl text-cocoa">
                {shift ? `${shift.name} · ${shift.start} a ${shift.end}` : user.shiftId === null ? 'Sin turno asignado' : 'Turno no disponible'}
              </p>
            </div>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => mark(clockIn)}
              disabled={marking}
              className="rounded-3xl bg-cocoa p-5 text-left text-cream transition hover:bg-cocoa-soft"
            >
              <LogIn className="mb-3 h-6 w-6 text-macaron" />
              <p className="font-display text-2xl">Hora de entrada</p>
              <p className="mt-1 text-sm text-cream/70">Paso 1 de 1. Se guarda fecha y hora actuales.</p>
              {todayRec?.checkIn ? <p className="mt-3 text-sm">Entrada: {todayRec.checkIn}</p> : null}
            </button>
            <button
              type="button"
              onClick={() => mark(clockOut)}
              disabled={marking}
              className="rounded-3xl bg-berry p-5 text-left text-white transition hover:bg-berry-dark"
            >
              <LogOut className="mb-3 h-6 w-6 text-macaron" />
              <p className="font-display text-2xl">Hora de salida</p>
              <p className="mt-1 text-sm text-white/80">Solo si ya existe una entrada sin cerrar.</p>
              {todayRec?.checkOut ? <p className="mt-3 text-sm">Salida: {todayRec.checkOut}</p> : null}
            </button>
          </div>
          {todayRec?.late ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              {todayRec.lateMinutes == null
                ? 'Retardo registrado.'
                : `${todayRec.lateMinutes} min de retardo después de ${todayRec.graceMinutes} min de tolerancia.`}
            </div>
          ) : null}
        </Card>
        <Card>
          <h2 className="font-display text-xl text-cocoa">Últimos marcajes</h2>
          <ul className="mt-4 space-y-3">
            {history.map((row) => {
              const status = attendanceBadge(row)
              return (
                <li key={row.id} className="flex items-center justify-between gap-2 rounded-2xl bg-cream px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{row.date}</p>
                    <p className="text-cocoa-soft">{row.checkIn || '—'} → {row.checkOut || '—'}</p>
                  </div>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

function initialRequestForm() {
  return { type: 'permiso', date: localISO(), exitTime: '', attendanceId: '', reason: '' }
}

export function EmployeeRequests() {
  const [form, setForm] = useState(initialRequestForm)
  const [inbox, setInbox] = useState(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [toast, setToast] = useState(null)
  const revision = useRef(0)

  useEffect(() => {
    let active = true
    let loading = false
    async function refresh(showError = false) {
      if (loading || (!showError && document.hidden)) return
      loading = true
      const started = revision.current
      try {
        const result = await loadMyRequests()
        if (active && started === revision.current && (result.ok || showError)) setInbox(result)
      } catch {
        if (active && showError && started === revision.current) {
          setInbox({ ok: false, message: 'No se pudieron consultar tus solicitudes.' })
        }
      } finally {
        loading = false
      }
    }
    refresh(true)
    const refreshVisible = () => refresh()
    const timer = window.setInterval(refreshVisible, 30000)
    window.addEventListener('focus', refreshVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
    }
  }, [loadAttempt])

  async function submit(event) {
    event.preventDefault()
    if (saving || !inbox?.canCreate) return
    setSaving(true)
    setFormError('')
    try {
      const result = await createRequest({
        ...form,
        exitTime: form.type === 'permiso' ? form.exitTime : undefined,
        attendanceId: Number(form.attendanceId),
      })
      if (!result.ok) {
        setFormError(result.message)
        return
      }

      revision.current += 1
      setInbox(current => ({
        ...current,
        requests: [result.request, ...current.requests.filter(row =>
          row.id !== result.request.id || row.type !== result.request.type)],
        lateAttendances: current.lateAttendances.filter(row => row.id !== result.request.attendanceId),
      }))
      setForm(current => ({ ...current, attendanceId: '', reason: '' }))
      setToast({ type: 'ok', message: result.message })
    } catch {
      setFormError('No se pudo completar el envío. Consulta tus solicitudes antes de volver a intentar.')
    } finally {
      setSaving(false)
    }
  }

  const justifying = form.type === 'justificacion'
  const lateAttendances = inbox?.lateAttendances ?? []

  return (
    <div>
      <PageHeader
        kicker="Incidencias"
        title="Permisos, faltas y justificantes"
        subtitle="Envía una solicitud y consulta su estado."
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          {inbox?.canCreate ? (
            <form className="space-y-4" onSubmit={submit}>
              <Field label="Tipo">
                <select className={inputClass} value={form.type} onChange={e => {
                  setForm({ ...form, type: e.target.value, attendanceId: '' })
                  setFormError('')
                }} disabled={saving}>
                  <option value="permiso">Solicitar permiso de salida</option>
                  <option value="falta">Solicitar falta</option>
                  <option value="justificacion">Justificar retardo</option>
                </select>
              </Field>
              {justifying ? (
                <Field label="Asistencia con retardo">
                  <select className={inputClass} value={form.attendanceId} onChange={e => setForm({ ...form, attendanceId: e.target.value })} required disabled={saving || !lateAttendances.length}>
                    <option value="">{lateAttendances.length ? 'Selecciona una asistencia' : 'No hay retardos disponibles para justificar'}</option>
                    {lateAttendances.map(row => (
                      <option key={row.id} value={row.id}>{row.date} · Entrada {row.entryAt.slice(11, 16)}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label="Fecha">
                  <input type="date" className={inputClass} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required disabled={saving} />
                </Field>
              )}
              {form.type === 'permiso' ? (
                <Field label="Hora de salida (opcional)">
                  <input type="time" className={inputClass} value={form.exitTime} onChange={e => setForm({ ...form, exitTime: e.target.value })} disabled={saving} />
                </Field>
              ) : null}
              <Field label="Motivo">
                <textarea className={inputClass} rows={5} maxLength={255} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="Describe el motivo con claridad…" required disabled={saving} />
              </Field>
              {formError ? <p role="alert" className="text-sm text-berry">{formError}</p> : null}
              <Button type="submit" className="w-full" disabled={saving || (justifying && !lateAttendances.length)}>
                {saving ? 'Enviando…' : 'Enviar a RH'}
              </Button>
            </form>
          ) : inbox?.ok ? <p className="text-sm text-cocoa-soft">Tu cuenta tiene acceso de consulta.</p> : null}
        </Card>
        <Card className="lg:col-span-3">
          <h2 className="font-display text-xl text-cocoa">Mis solicitudes</h2>
          <div className="mt-4 space-y-3">
            {!inbox ? <p role="status" className="text-sm text-cocoa-soft">Cargando solicitudes…</p> : null}
            {inbox?.ok === false ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p role="alert" className="text-sm text-berry">{inbox.message}</p>
                <Button variant="ghost" onClick={() => {
                  setInbox(null)
                  setLoadAttempt(attempt => attempt + 1)
                }}>Reintentar</Button>
              </div>
            ) : null}
            {inbox?.ok && !inbox.requests.length ? <p className="text-sm text-cocoa-soft">Aún no has enviado solicitudes.</p> : null}
            {inbox?.ok ? inbox.requests.map(row => (
              <article key={`${row.type}/${row.id}`} className="rounded-2xl bg-cream p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-cocoa">{REQUEST_LABEL[row.type]} · {row.date}{row.exitTime ? ` · ${row.exitTime}` : ''}</p>
                  <Badge tone={row.status === 'aprobada' ? 'ok' : row.status === 'rechazada' ? 'bad' : 'warn'}>{row.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-cocoa-soft">{row.reason}</p>
                <p className="mt-2 text-xs text-cocoa-soft">Enviada: {formatDateTime(row.createdAt)}</p>
                {row.resolvedAt ? <p className="mt-1 text-xs text-cocoa-soft">Resuelta: {formatDateTime(row.resolvedAt)}</p> : null}
              </article>
            )) : null}
          </div>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
