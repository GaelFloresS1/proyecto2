/**
 * Módulo de autenticación (CU Iniciar Sesión + Recuperar Contraseña).
 * Simula bloqueo a 5 intentos y restablecimiento con código de 6 dígitos.
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { Button, Card, Field, inputClass, MacaronMark, Toast } from '../components'
import { completePasswordRecovery, homePathFor, login, startPasswordRecovery } from '../store'

const DEMO = [
  { user: 'admin', pass: 'Admin123!', role: 'Administrador' },
  { user: 'rh', pass: 'Rh123456!', role: 'Recursos Humanos' },
  { user: 'supervisor', pass: 'Super123!', role: 'Supervisor' },
  { user: 'barista', pass: 'Barista1!', role: 'Barista' },
  { user: 'cajero', pass: 'Cajero12!', role: 'Cajero' },
  { user: 'capacitador', pass: 'Capacit1!', role: 'Capacitador' },
]

export default function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('barista')
  const [password, setPassword] = useState('Barista1!')
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [simulatedCode, setSimulatedCode] = useState('')
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(false)

  const hint = useMemo(() => DEMO, [])

  async function onLogin(event) {
    event.preventDefault()
    setLoading(true)
    const result = await login(username, password)
    setLoading(false)
    if (!result.ok) {
      setToast({ type: 'error', message: result.message })
      return
    }
    navigate(homePathFor(result.user.role))
  }

  async function onRecoverRequest(event) {
    event.preventDefault()
    const result = await startPasswordRecovery(username)
    if (!result.ok) {
      setToast({ type: 'error', message: result.message })
      return
    }
    setSimulatedCode(result.code)
    setMode('reset')
    setToast({ type: 'ok', message: `${result.message} Código (simulado): ${result.code}` })
  }

  async function onReset(event) {
    event.preventDefault()
    const result = await completePasswordRecovery({ username, code, password: newPassword })
    if (!result.ok) {
      setToast({ type: 'error', message: result.message })
      return
    }
    setMode('login')
    setPassword(newPassword)
    setToast({ type: 'ok', message: result.message })
  }

  return (
    <div className="bg-bakery min-h-screen">
      <div className="bg-dots mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-berry">Macaron & Bakery</p>
          <h1 className="mt-3 font-display text-5xl leading-tight text-cocoa">Control de asistencia y apoyo a nómina</h1>
          <p className="mt-4 max-w-md text-cocoa-soft">
            Prototipo ilustrativo: el marcaje usa el reloj del sistema, las solicitudes llegan a RH y los reportes se pueden exportar a Excel.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3">
            {['Entrada en 1 clic', 'Permisos con folio', 'Nómina estimada'].map((item) => (
              <div key={item} className="rounded-2xl bg-white/70 px-3 py-4 text-center text-sm font-medium text-cocoa shadow-sm">
                {item}
              </div>
            ))}
          </div>
        </div>

        <Card className="mx-auto w-full max-w-md p-7">
          <div className="mb-6 flex items-center gap-3">
            <MacaronMark />
            <div>
              <p className="font-display text-2xl text-cocoa">Bienvenida</p>
              <p className="text-sm text-cocoa-soft">Ingresa con tu usuario de sucursal</p>
            </div>
          </div>

          {mode === 'login' ? (
            <form className="space-y-4" onSubmit={onLogin}>
              <Field label="Usuario">
                <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </Field>
              <Field label="Contraseña">
                <div className="relative">
                  <input
                    className={`${inputClass} pr-10`}
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-cocoa-soft" onClick={() => setShow((v) => !v)}>
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <button type="button" className="text-sm font-medium text-berry hover:underline" onClick={() => setMode('recover')}>
                ¿Olvidaste tu contraseña?
              </button>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Validando…' : 'Iniciar sesión'}
              </Button>
            </form>
          ) : null}

          {mode === 'recover' ? (
            <form className="space-y-4" onSubmit={onRecoverRequest}>
              <p className="text-sm text-cocoa-soft">Escribe tu usuario. Simularemos el envío de un código de 6 dígitos.</p>
              <Field label="Usuario">
                <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setMode('login')}>Volver</Button>
                <Button type="submit" className="flex-1">Enviar código</Button>
              </div>
            </form>
          ) : null}

          {mode === 'reset' ? (
            <form className="space-y-4" onSubmit={onReset}>
              <div className="flex items-center gap-2 rounded-2xl bg-cream-dark px-3 py-2 text-sm text-cocoa">
                <KeyRound className="h-4 w-4" /> Código simulado: <strong className="tabular-nums">{simulatedCode}</strong>
              </div>
              <Field label="Código">
                <input className={inputClass} value={code} onChange={(e) => setCode(e.target.value)} />
              </Field>
              <Field label="Nueva contraseña (mín. 8)">
                <input className={inputClass} type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </Field>
              <Button type="submit" className="w-full">Restablecer acceso</Button>
            </form>
          ) : null}

          <div className="mt-6 rounded-2xl bg-cream p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-cocoa-soft">Cuentas de demostración</p>
            <div className="grid gap-1.5 text-xs text-cocoa">
              {hint.map((row) => (
                <button
                  key={row.user}
                  type="button"
                  className="flex justify-between rounded-lg px-2 py-1 text-left hover:bg-white"
                  onClick={() => {
                    setUsername(row.user)
                    setPassword(row.pass)
                    setMode('login')
                  }}
                >
                  <span>{row.role}</span>
                  <span className="font-mono">{row.user} / {row.pass}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
