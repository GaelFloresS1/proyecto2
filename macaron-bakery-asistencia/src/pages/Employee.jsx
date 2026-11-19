/**
 * Módulo del empleado (Barista, Cajero, Capacitador y también Supervisor).
 * - Registrar hora de entrada/salida con el reloj de MariaDB.
 * - Justificar retardo (extiende el marcaje de entrada).
 * - Solicitar permiso o falta.
 */
import { useEffect, useMemo, useState } from 'react'
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
  localISO,
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

export function EmployeeRequests() {
  const user = getUser()
  const data = getState()
  const [type, setType] = useState('justificacion')
  const [date, setDate] = useState(localISO())
  const [reason, setReason] = useState('')
  const [toast, setToast] = useState(null)

  const mine = useMemo(
    () => data.requests.filter((r) => r.userId === user.id),
    [data.requests, user.id],
  )

  function submit(event) {
    event.preventDefault()
    const result = createRequest({ userId: user.id, type, date, reason })
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    if (result.ok) setReason('')
  }

  return (
    <div>
      <PageHeader
        kicker="Incidencias"
        title="Justificar retardo o solicitar permiso"
        subtitle="Estas solicitudes sustituyen el mensaje de texto informal. RH o el supervisor autorizan o rechazan con folio."
      />
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <form className="space-y-4" onSubmit={submit}>
            <Field label="Tipo">
              <select className={inputClass} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="justificacion">Justificar retardo</option>
                <option value="permiso">Solicitar permiso</option>
                <option value="falta">Solicitar falta</option>
              </select>
            </Field>
            <Field label="Fecha">
              <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Motivo">
              <textarea className={inputClass} rows={5} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe el motivo con claridad…" />
            </Field>
            <Button type="submit" className="w-full">Enviar a RH</Button>
          </form>
        </Card>
        <Card className="lg:col-span-3">
          <h2 className="font-display text-xl text-cocoa">Mis solicitudes</h2>
          <div className="mt-4 space-y-3">
            {mine.length === 0 ? <p className="text-sm text-cocoa-soft">Aún no has enviado solicitudes.</p> : null}
            {mine.map((row) => (
              <article key={row.id} className="rounded-2xl bg-cream p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold capitalize text-cocoa">{row.type} · {row.date}</p>
                  <Badge tone={row.status === 'aprobada' ? 'ok' : row.status === 'rechazada' ? 'bad' : 'warn'}>{row.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-cocoa-soft">{row.reason}</p>
                <p className="mt-2 text-xs text-cocoa-soft">Enviada: {formatDateTime(row.createdAt)}</p>
                {row.reviewNote ? <p className="mt-2 text-sm">Nota de RH: {row.reviewNote}</p> : null}
              </article>
            ))}
          </div>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
