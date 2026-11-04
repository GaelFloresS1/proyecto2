export function requireAuth(req, res, next) {
  if (!req.session?.employee) {
    return res.status(401).json({ ok: false, message: 'Debes iniciar sesión.' })
  }
  next()
}
