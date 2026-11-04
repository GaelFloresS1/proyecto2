import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import session from 'express-session'
import { rateLimit } from 'express-rate-limit'
import authRoutes from './routes/authRoutes.js'
import attendanceRoutes from './routes/attendanceRoutes.js'
import { testDatabaseConnection } from './config/database.js'

const app = express()
const port = Number(process.env.PORT || 3000)
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173'

if (!process.env.SESSION_SECRET) {
  throw new Error('Falta SESSION_SECRET en el archivo .env')
}

app.use(helmet())
app.use(cors({ origin: frontendOrigin, credentials: true }))
app.use(express.json({ limit: '20kb' }))
app.use(session({
  name: 'mb.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false, // En desarrollo local HTTP. Activar HTTPS/secure al publicar.
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
  },
}))

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
})

app.get('/api/health', async (_req, res, next) => {
  try {
    const database = await testDatabaseConnection()
    res.json({ ok: true, api: 'online', database: database.database_name, serverTime: database.server_time })
  } catch (error) {
    next(error)
  }
})
app.use('/api/auth/login', loginLimiter)
app.use('/api/auth', authRoutes)
app.use('/api/attendance', attendanceRoutes)

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ ok: false, message: 'Ocurrió un error interno en el servidor.' })
})

try {
  const database = await testDatabaseConnection()
  console.log(`MariaDB conectada: ${database.database_name}`)
  console.log(`Hora del servidor de base de datos: ${database.server_time}`)
  app.listen(port, () => console.log(`API disponible en http://localhost:${port}`))
} catch (error) {
  console.error('No se pudo conectar con MariaDB. Revisa XAMPP y backend/.env.')
  console.error(error.message)
  process.exit(1)
}
