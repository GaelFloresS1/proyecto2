/**
 * Componentes visuales compartidos: marca, layout por rol, formularios y avisos.
 * La navegación se filtra según Administrador, RH, Supervisor o Empleado.
 */
import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Bell,
  CalendarDays,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  LogOut,
  Menu,
  ScrollText,
  Settings2,
  Users,
  X,
} from 'lucide-react'
import { getUser, logout, ROLE_LABEL, ROLES } from './store'

export function MacaronMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="40" rx="20" ry="11" fill="#E8B4B8" />
      <ellipse cx="32" cy="31" rx="17" ry="10" fill="#F4D0D4" />
      <ellipse cx="32" cy="24" rx="15" ry="9" fill="#C45C7A" />
      <circle cx="25" cy="22" r="1.5" fill="#F7F1E8" />
      <circle cx="32" cy="20" r="1.5" fill="#F7F1E8" />
      <circle cx="39" cy="22" r="1.5" fill="#F7F1E8" />
    </svg>
  )
}

export function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-1.5 text-sm text-cocoa shadow-sm ring-1 ring-black/5">
      <Clock3 className="h-4 w-4 text-berry" />
      <span className="font-medium tabular-nums">
        {now.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })} · {now.toLocaleTimeString('es-MX')}
      </span>
    </div>
  )
}

export function Toast({ toast, onClose }) {
  if (!toast) return null
  const tone = toast.type === 'error' ? 'bg-rose-50 text-rose-900 ring-rose-200' : toast.type === 'warn' ? 'bg-amber-50 text-amber-950 ring-amber-200' : 'bg-emerald-50 text-emerald-950 ring-emerald-200'
  return (
    <div className={`fixed bottom-5 right-5 z-50 max-w-md rounded-2xl px-4 py-3 shadow-lg ring-1 ${tone}`}>
      <div className="flex items-start gap-3">
        <p className="text-sm leading-5">{toast.message}</p>
        <button type="button" className="shrink-0 text-current/60" onClick={onClose} aria-label="Cerrar aviso">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-cocoa-soft">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-cocoa/10 bg-white px-3.5 py-2.5 text-sm text-ink outline-none ring-berry/30 transition focus:ring-2'

export function Button({ children, variant = 'primary', className = '', type = 'button', ...props }) {
  const styles = {
    primary: 'bg-berry text-white hover:bg-berry-dark',
    cocoa: 'bg-cocoa text-cream hover:bg-cocoa-soft',
    ghost: 'bg-white text-cocoa ring-1 ring-cocoa/10 hover:bg-cream',
    danger: 'bg-white text-berry ring-1 ring-berry/30 hover:bg-berry/10',
  }
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-cocoa/40 p-4 sm:items-center">
      <div className="w-full max-w-lg rounded-3xl bg-cream p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="font-display text-xl text-cocoa">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1 hover:bg-white" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }) {
  const map = {
    ok: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-900',
    bad: 'bg-rose-100 text-rose-800',
    info: 'bg-sky-100 text-sky-900',
    neutral: 'bg-white text-cocoa ring-1 ring-cocoa/10',
  }
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>
}

function navFor(role) {
  const employee = [
    { to: '/empleado', label: 'Mi jornada', icon: Clock3 },
    { to: '/empleado/solicitudes', label: 'Permisos y justificaciones', icon: ClipboardList },
  ]
  const rh = [
    { to: '/rh/solicitudes', label: 'Bandeja de solicitudes', icon: Bell },
    { to: '/rh/festivos', label: 'Días festivos', icon: CalendarDays },
    { to: '/rh/reportes', label: 'Reportes y nómina', icon: FileSpreadsheet },
    { to: '/rh/bitacora', label: 'Bitácora', icon: ScrollText },
  ]
  const admin = [
    { to: '/admin/empleados', label: 'Empleados', icon: Users },
    { to: '/admin/turnos', label: 'Horarios y turnos', icon: Settings2 },
  ]
  if (role === ROLES.ADMIN) return [...admin, ...rh, ...employee]
  if (role === ROLES.RH) return [...rh, ...employee]
  if (role === ROLES.SUPERVISOR) return [rh[0], ...employee]
  return employee
}

export function AppShell() {
  const navigate = useNavigate()
  const user = getUser()
  const [open, setOpen] = useState(false)
  const items = useMemo(() => navFor(user?.role), [user?.role])

  if (!user) return <Outlet />

  return (
    <div className="min-h-screen bg-bakery">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className={`fixed inset-y-0 left-0 z-30 w-72 transform bg-cocoa text-cream shadow-xl transition lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 px-5 py-6">
              <MacaronMark size={42} />
              <div>
                <p className="font-display text-lg leading-tight">Macaron & Bakery</p>
                <p className="text-xs text-macaron">Asistencia y nómina</p>
              </div>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-6">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-white/15 text-white' : 'text-cream/75 hover:bg-white/10 hover:text-white'}`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="border-t border-white/10 p-4">
              <p className="text-sm font-semibold">{user.name}</p>
              <p className="text-xs text-macaron">{ROLE_LABEL[user.role]} · {user.position}</p>
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-2 text-sm text-cream/80 hover:text-white"
                onClick={() => {
                  logout()
                  navigate('/')
                }}
              >
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </div>
          </div>
        </aside>
        {open ? <button className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-label="Cerrar menú" /> : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
            <button type="button" className="rounded-xl bg-white/80 p-2 shadow-sm lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú">
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden lg:block">
              <p className="text-sm text-cocoa-soft">Sucursal centro · prototipo de demostración</p>
            </div>
            <LiveClock />
          </header>
          <main className="flex-1 px-4 pb-10 sm:px-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}

export function PageHeader({ kicker, title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {kicker ? <p className="text-xs font-semibold uppercase tracking-[0.2em] text-berry">{kicker}</p> : null}
        <h1 className="font-display text-3xl text-cocoa sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-cocoa-soft">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  )
}

export function Card({ className = '', children }) {
  return <section className={`rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-cocoa/5 backdrop-blur ${className}`}>{children}</section>
}
