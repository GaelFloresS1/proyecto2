import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { Button, Card, Field, inputClass, MacaronMark, Toast } from '../components'
import { homePathFor, login } from '../store'

export default function Login() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [toast, setToast] = useState(null)
  const [loading, setLoading] = useState(false)

  async function onLogin(event) {
    event.preventDefault()
    setLoading(true)
    try {
      const result = await login(username, password)
      if (!result.ok) {
        setToast({ type: 'error', message: result.message })
        return
      }
      navigate(homePathFor(result.user.role))
    } catch {
      setToast({ type: 'error', message: 'No se pudo iniciar sesión. Intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
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

          <form className="space-y-4" onSubmit={onLogin}>
            <Field label="Usuario">
              <input className={inputClass} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
            </Field>
            <Field label="Contraseña">
              <div className="relative">
                <input
                  className={`${inputClass} pr-10`}
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="absolute top-1/2 right-3 -translate-y-1/2 text-cocoa-soft" onClick={() => setShow((v) => !v)}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <p className="text-sm text-cocoa-soft">Si olvidaste tu contraseña, solicita al administrador que la restablezca.</p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Validando…' : 'Iniciar sesión'}
            </Button>
          </form>
        </Card>
      </div>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}
