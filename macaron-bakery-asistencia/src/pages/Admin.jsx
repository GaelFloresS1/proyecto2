/**
 * Módulo del Administrador.
 * RF-01 a RF-03: altas, baja lógica y cambios de personal.
 * CU Configurar Horario/Turno y tarifas de extra/festivo (RI-008, RI-009).
 */
import { useState } from 'react'
import { Badge, Button, Card, Field, inputClass, Modal, PageHeader, Toast } from '../components'
import {
  deactivateEmployee,
  getState,
  getUser,
  money,
  POSITIONS,
  resetDemo,
  ROLE_LABEL,
  roleFromPosition,
  saveConfig,
  saveEmployee,
  saveShift,
} from '../store'

const emptyEmployee = {
  id: null,
  name: '',
  username: '',
  position: 'Barista',
  salary: 9500,
  password: '',
  shiftId: 'shift_matutino',
  active: true,
}

export function AdminEmployees() {
  const actor = getUser()
  const data = getState()
  const [form, setForm] = useState(null)
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    const result = await saveEmployee(
      { ...form, role: roleFromPosition(form.position) },
      actor.id,
    )
    setSaving(false)
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    if (result.ok) setForm(null)
  }

  return (
    <div>
      <PageHeader
        kicker="Administración"
        title="Gestión de empleados"
        subtitle="Altas, baja lógica (se conserva historial) y cambios de puesto, sueldo o contraseña."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={async () => {
              await resetDemo()
              setToast({ type: 'ok', message: 'Se restauraron los datos de demostración.' })
            }}>Restaurar demo</Button>
            <Button onClick={() => setForm({ ...emptyEmployee, shiftId: data.shifts[0]?.id })}>Dar de alta</Button>
          </div>
        }
      />
      <div className="grid gap-3">
        {data.users.map((user) => (
          <Card key={user.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-cocoa">{user.name}</p>
                <Badge tone={user.active ? 'ok' : 'bad'}>{user.active ? 'Activo' : 'Baja lógica'}</Badge>
                {user.locked ? <Badge tone="warn">Bloqueado</Badge> : null}
              </div>
              <p className="text-sm text-cocoa-soft">
                @{user.username} · {user.position} · {ROLE_LABEL[user.role]} · {money(user.salary)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setForm({
                id: user.id,
                name: user.name,
                username: user.username,
                position: user.position,
                salary: user.salary,
                password: '',
                shiftId: user.shiftId,
                active: user.active,
              })}>Editar</Button>
              {user.active && user.id !== actor.id ? (
                <Button variant="danger" onClick={() => {
                  const result = deactivateEmployee(user.id, actor.id)
                  setToast({ type: 'ok', message: result.message })
                }}>Baja</Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {form ? (
        <Modal title={form.id ? 'Modificar personal' : 'Alta de empleado'} onClose={() => setForm(null)}>
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Nombre completo">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Usuario">
              <input className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Puesto">
                <select className={inputClass} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })}>
                  {POSITIONS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Sueldo mensual">
                <input type="number" className={inputClass} value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
              </Field>
            </div>
            <Field label="Turno">
              <select className={inputClass} value={form.shiftId} onChange={(e) => setForm({ ...form, shiftId: e.target.value })}>
                {data.shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.start}-{s.end})</option>)}
              </select>
            </Field>
            <Field label={form.id ? 'Nueva contraseña (opcional, mín. 8)' : 'Contraseña inicial (mín. 8)'}>
              <input type="password" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            {form.id ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Cuenta activa
              </label>
            ) : null}
            <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
          </form>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

const DAYS = [
  { id: 1, label: 'Lun' },
  { id: 2, label: 'Mar' },
  { id: 3, label: 'Mié' },
  { id: 4, label: 'Jue' },
  { id: 5, label: 'Vie' },
  { id: 6, label: 'Sáb' },
  { id: 0, label: 'Dom' },
]

export function AdminShifts() {
  const actor = getUser()
  const data = getState()
  const [form, setForm] = useState(null)
  const [toast, setToast] = useState(null)
  const [rates, setRates] = useState({
    extraHourMultiplier: data.config.extraHourMultiplier,
    holidayHourMultiplier: data.config.holidayHourMultiplier,
    graceMinutes: data.config.graceMinutes,
  })

  function submit(event) {
    event.preventDefault()
    const result = saveShift(form, actor.id)
    setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
    if (result.ok) setForm(null)
  }

  function toggleDay(id) {
    const has = form.weeklyDays.includes(id)
    setForm({
      ...form,
      weeklyDays: has ? form.weeklyDays.filter((d) => d !== id) : [...form.weeklyDays, id],
    })
  }

  return (
    <div>
      <PageHeader
        kicker="Configuración"
        title="Horarios, turnos y tarifas"
        subtitle="La jornada del turno define horas normales; el excedente es extra. Festivos usan el multiplicador de RH."
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setForm({ id: null, name: '', start: '08:00', end: '16:00', breakMinutes: 30, weeklyDays: [1, 2, 3, 4, 5, 6] })}>
              Nuevo turno
            </Button>
          </div>
          <div className="space-y-3">
            {data.shifts.map((shift) => (
              <article key={shift.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream p-4">
                <div>
                  <p className="font-semibold text-cocoa">{shift.name}</p>
                  <p className="text-sm text-cocoa-soft">
                    {shift.start} – {shift.end} · descanso {shift.breakMinutes} min · {shift.weeklyDays.map((d) => DAYS.find((x) => x.id === d)?.label).join(' ')}
                  </p>
                </div>
                <Button variant="ghost" onClick={() => setForm({ ...shift })}>Editar</Button>
              </article>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="font-display text-xl text-cocoa">Tarifas de cálculo</h2>
          <div className="mt-4 space-y-3">
            <Field label="Multiplicador hora extra (RI-008)">
              <input type="number" step="0.1" className={inputClass} value={rates.extraHourMultiplier} onChange={(e) => setRates({ ...rates, extraHourMultiplier: Number(e.target.value) })} />
            </Field>
            <Field label="Multiplicador hora festiva (RI-009)">
              <input type="number" step="0.1" className={inputClass} value={rates.holidayHourMultiplier} onChange={(e) => setRates({ ...rates, holidayHourMultiplier: Number(e.target.value) })} />
            </Field>
            <Field label="Tolerancia de retardo (min)">
              <input type="number" className={inputClass} value={rates.graceMinutes} onChange={(e) => setRates({ ...rates, graceMinutes: Number(e.target.value) })} />
            </Field>
            <Button className="w-full" onClick={() => {
              saveConfig(rates, actor.id)
              setToast({ type: 'ok', message: 'Tarifas actualizadas. El siguiente reporte usará estos valores.' })
            }}>Guardar tarifas</Button>
          </div>
        </Card>
      </div>

      {form ? (
        <Modal title={form.id ? 'Editar turno' : 'Nuevo turno'} onClose={() => setForm(null)}>
          <form className="space-y-3" onSubmit={submit}>
            <Field label="Nombre">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Inicio">
                <input type="time" className={inputClass} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </Field>
              <Field label="Fin">
                <input type="time" className={inputClass} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </Field>
            </div>
            <Field label="Minutos de descanso">
              <input type="number" className={inputClass} value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
            </Field>
            <div>
              <p className="mb-2 text-sm font-medium text-cocoa-soft">Días laborales</p>
              <div className="flex flex-wrap gap-2">
                {DAYS.map((day) => (
                  <button
                    key={day.id}
                    type="button"
                    onClick={() => toggleDay(day.id)}
                    className={`rounded-full px-3 py-1 text-sm ${form.weeklyDays.includes(day.id) ? 'bg-cocoa text-cream' : 'bg-white ring-1 ring-cocoa/10'}`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" className="w-full">Guardar turno</Button>
          </form>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
