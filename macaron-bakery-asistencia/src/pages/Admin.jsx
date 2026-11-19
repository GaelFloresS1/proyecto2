/**
 * Módulo del Administrador.
 * RF-01 a RF-03: altas, baja lógica y cambios de personal.
 * CU Configurar Horario/Turno y tarifas de extra/festivo (RI-008, RI-009).
 */
import { useEffect, useState } from 'react'
import { Badge, Button, Card, Field, inputClass, Modal, PageHeader, Toast } from '../components'
import {
  activateEmployee,
  activateShift,
  deactivateEmployee,
  deactivateShift,
  getCurrentUser,
  getState,
  getUser,
  loadEmployees,
  loadShifts,
  money,
  POSITIONS,
  saveConfig,
  saveEmployee,
  saveShift,
} from '../store'


const emptyEmployee = {
  id: null,
  name: '',
  username: '',
  position: 'Barista',
  salary: '',
  password: '',
  roleId: '',
  shiftId: null,
}

export function AdminEmployees() {
  const actor = getUser()
  const [employees, setEmployees] = useState([])
  const [roles, setRoles] = useState([])
  const [shifts, setShifts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [shiftError, setShiftError] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [form, setForm] = useState(null)
  const [toast, setToast] = useState(null)
  const [saving, setSaving] = useState(false)
  const [changingId, setChangingId] = useState(null)

  useEffect(() => {
    let mounted = true
    Promise.all([loadEmployees(), loadShifts()]).then(([directory, shiftResult]) => {
      if (!mounted) return
      setEmployees(directory.employees ?? [])
      setRoles(directory.roles ?? [])
      setShifts(shiftResult.shifts ?? [])
      setLoadError(directory.ok ? '' : directory.message)
      setShiftError(shiftResult.ok ? '' : shiftResult.message)
      setLoading(false)
    })
    return () => { mounted = false }
  }, [loadAttempt])

  function retry() {
    setLoading(true)
    setLoadAttempt(attempt => attempt + 1)
  }

  function replaceEmployee(employee) {
    setEmployees(current => [...current.filter(row => row.id !== employee.id), employee]
      .sort((a, b) => a.name.localeCompare(b.name, 'es-MX') || a.id - b.id))
  }

  async function submit(event) {
    event.preventDefault()
    if (saving) return

    setSaving(true)
    try {
      const result = await saveEmployee({ ...form, roleId: Number(form.roleId) })
      setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
      if (result.ok) {
        replaceEmployee(result.employee)
        setForm(null)
        if (result.employee.id === actor.id) await getCurrentUser()
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(employee) {
    if (changingId !== null) return
    if (employee.active && !window.confirm(`¿Deseas dar de baja a ${employee.name}?`)) return

    setChangingId(employee.id)
    try {
      const result = await (employee.active ? deactivateEmployee(employee.id) : activateEmployee(employee.id))
      setToast({ type: result.ok ? 'ok' : 'error', message: result.message })
      if (result.ok) replaceEmployee(result.employee)
    } finally {
      setChangingId(null)
    }
  }

  const canOpenForm = !loading && !loadError && !shiftError && roles.length > 0

  return (
    <div>
      <PageHeader
        kicker="Administración"
        title="Gestión de empleados"
        subtitle="Gestiona las cuentas del personal, sus roles y turnos."
        actions={
          <Button
            disabled={!canOpenForm || changingId !== null}
            onClick={() => setForm({ ...emptyEmployee, roleId: roles.find(role => role.name === 'Empleado')?.id ?? '' })}
          >
            Dar de alta
          </Button>
        }
      />
      {loading ? <Card><p role="status">Cargando empleados…</p></Card> : null}
      {!loading && (loadError || shiftError) ? (
        <Card className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p role="alert" className="text-sm text-berry">{loadError || shiftError}</p>
          <Button variant="ghost" onClick={retry}>Reintentar</Button>
        </Card>
      ) : null}
      {!loading && !loadError && employees.length === 0 ? (
        <Card><p className="text-sm text-cocoa-soft">No hay empleados registrados.</p></Card>
      ) : null}
      <div className="grid gap-3">
        {!loading && !loadError && employees.map((user) => (
          <Card key={user.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-cocoa">{user.name}</p>
                <Badge tone={user.active ? 'ok' : 'bad'}>{user.active ? 'Activo' : 'Baja lógica'}</Badge>
                {user.locked ? <Badge tone="warn">Bloqueado</Badge> : null}
              </div>
              <p className="text-sm text-cocoa-soft">
                @{user.username} · {user.position} · {user.roleName}{user.salary === null ? '' : ` · ${money(user.salary)}`}
              </p>
              <p className="text-sm text-cocoa-soft">Turno: {user.shiftName ?? 'Sin asignar'}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={!canOpenForm || changingId !== null}
                onClick={() => setForm({ ...user, password: '' })}
              >Editar</Button>
              {user.id !== actor.id ? (
                <Button
                  variant={user.active ? 'danger' : 'ghost'}
                  disabled={changingId !== null}
                  onClick={() => toggleActive(user)}
                >
                  {changingId === user.id ? 'Guardando…' : user.active ? 'Dar de baja' : 'Reactivar'}
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {form ? (
        <Modal title={form.id ? 'Modificar personal' : 'Alta de empleado'} onClose={() => { if (!saving) setForm(null) }}>
          <form onSubmit={submit}>
            <fieldset className="space-y-3" disabled={saving}>
              <Field label="Nombre completo">
                <input className={inputClass} required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Usuario">
                <input className={inputClass} required maxLength={30} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Puesto">
                  <input className={inputClass} list="employee-positions" required maxLength={50} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
                  <datalist id="employee-positions">
                    {POSITIONS.map(position => <option key={position} value={position} />)}
                  </datalist>
                </Field>
                <Field label="Sueldo mensual">
                  <input type="number" className={inputClass} required min="0" max="99999999.99" step="0.01" value={form.salary} onChange={(e) => setForm({ ...form, salary: e.target.value })} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rol">
                  <select className={inputClass} required disabled={form.id === actor.id} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                    <option value="" disabled>Selecciona un rol</option>
                    {roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
                  </select>
                </Field>
                <Field label="Turno">
                  <select className={inputClass} value={form.shiftId ?? ''} onChange={(e) => setForm({ ...form, shiftId: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">Sin asignar</option>
                    {shifts.filter(shift => shift.active || shift.id === form.shiftId).map(shift => (
                      <option key={shift.id} value={shift.id} disabled={!shift.active}>
                        {shift.name} ({shift.start}–{shift.end}){shift.active ? '' : ' · inactivo'}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={form.id ? 'Nueva contraseña (opcional, mín. 8)' : 'Contraseña inicial (mín. 8)'}>
                <input type="password" autoComplete="new-password" className={inputClass} required={!form.id} minLength={8} maxLength={255} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </Field>
              <Button type="submit" className="w-full" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</Button>
            </fieldset>
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
  const [saving, setSaving] = useState(false)
  const [deactivatingId, setDeactivatingId] = useState(null)
  const [rates, setRates] = useState({
    extraHourMultiplier: data.config.extraHourMultiplier,
    holidayHourMultiplier: data.config.holidayHourMultiplier,
    graceMinutes: data.config.graceMinutes,
  })

  
  async function submit(event) {
    event.preventDefault()

    if (saving) return

    setSaving(true)

    try {
      const result = await saveShift(form, actor.id)

      setToast({
        type: result.ok ? 'ok' : 'error',
        message: result.message,
      })

      if (result.ok) {
        setForm(null)
      }
    } catch (error) {
      console.error('Error al guardar turno:', error)

      setToast({
        type: 'error',
        message: 'Ocurrió un error al guardar el turno.',
      })
    } finally {
      setSaving(false)
    }
  }


  async function handleDeactivate(shift) {
    const confirmed = window.confirm(
      `¿Deseas desactivar el turno "${shift.name}"?`
    )

    if (!confirmed) return

    setDeactivatingId(shift.id)

    try {
      const result = await deactivateShift(shift.id)

      setToast({
        type: result.ok ? 'ok' : 'error',
        message: result.message,
      })
    } catch (error) {
      console.error('Error al desactivar turno:', error)

      setToast({
        type: 'error',
        message: 'Ocurrió un error al desactivar el turno.',
      })
    } finally {
      setDeactivatingId(null)
    }
  }


  async function handleActivate(shift) {
    if (deactivatingId !== null) return

    setDeactivatingId(shift.id)

    try {
      const result = await activateShift(shift.id)

      setToast({
        type: result.ok ? 'ok' : 'error',
        message: result.message,
      })
    } catch (error) {
      console.error('Error al reactivar turno:', error)

      setToast({
        type: 'error',
        message: 'Ocurrió un error al reactivar el turno.',
      })
    } finally {
      setDeactivatingId(null)
    }
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
                
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={shift.active ? 'ok' : 'bad'}>
                      {shift.active ? 'Activo' : 'Inactivo'}
                    </Badge>

                    
                  {shift.active ? (
                    <>
                      <Button
                        variant="ghost"
                        disabled={deactivatingId !== null}
                        onClick={() => setForm({ ...shift })}
                      >
                        Editar
                      </Button>

                      <Button
                        variant="danger"
                        disabled={deactivatingId !== null}
                        onClick={() => handleDeactivate(shift)}
                      >
                        {deactivatingId === shift.id
                          ? 'Desactivando…'
                          : 'Desactivar'}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={deactivatingId !== null}
                      onClick={() => handleActivate(shift)}
                    >
                      {deactivatingId === shift.id
                        ? 'Reactivando…'
                        : 'Reactivar'}
                    </Button>
                  )}

                  </div>

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
            <Button
              type="submit"
              className="w-full"
              disabled={saving}
            >
              {saving ? 'Guardando…' : 'Guardar turno'}
            </Button>
          </form>
        </Modal>
      ) : null}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
