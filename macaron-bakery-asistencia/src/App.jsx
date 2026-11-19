/**
 * Enrutamiento del prototipo Macaron & Bakery.
 * Cada rol aterriza en su menú; el administrador hereda RH y empleado.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components'
import { AdminEmployees, AdminShifts } from './pages/Admin'
import { EmployeeClock, EmployeeRequests } from './pages/Employee'
import { HrAudit, HrHolidays, HrInbox, HrReports } from './pages/HR'
import Login from './pages/Login'
import { bootstrap, getState, getUser, homePathFor, ROLES, subscribe } from './store'

function Guard({ roles, children }) {
  const user = getUser()
  if (!user) return <Navigate to="/" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />
  return children
}

function Boot({ initialized, children }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true

    bootstrap()
      .then(() => {
        if (active) setReady(true)
      })
      .catch((error) => {
        console.error('Error al iniciar la aplicación:', error)
        if (active) setReady(true)
      })

    return () => {
      active = false
    }
  }, [])

  if (!ready || !initialized) {
    return (
      <div className="bg-bakery grid min-h-screen place-items-center text-cocoa">
        <p className="font-display text-2xl">Preparando la sucursal…</p>
      </div>
    )
  }
  return children
}

function GuestOnly({ children }) {
  const user = getUser()
  if (user) return <Navigate to={homePathFor(user.role)} replace />
  return children
}

export default function App() {
  const state = useSyncExternalStore(subscribe, getState)

  return (
    <Boot initialized={state !== null}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<GuestOnly><Login /></GuestOnly>} />
          <Route element={<Guard><AppShell /></Guard>}>
            <Route path="/empleado" element={<EmployeeClock />} />
            <Route path="/empleado/solicitudes" element={<EmployeeRequests />} />
            <Route
              path="/rh/solicitudes"
              element={<Guard roles={[ROLES.ADMIN, ROLES.RH]}><HrInbox /></Guard>}
            />
            <Route path="/rh/festivos" element={<HrHolidays />} />
            <Route path="/rh/reportes" element={<Guard roles={[ROLES.ADMIN, ROLES.RH]}><HrReports /></Guard>} />
            <Route path="/rh/bitacora" element={<Guard roles={[ROLES.ADMIN, ROLES.RH]}><HrAudit /></Guard>} />
            <Route path="/admin/empleados" element={<Guard roles={[ROLES.ADMIN]}><AdminEmployees /></Guard>} />
            <Route path="/admin/turnos" element={<Guard roles={[ROLES.ADMIN]}><AdminShifts /></Guard>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Boot>
  )
}
