
import { Router } from 'express'

import {
  listShifts,
  createShift,
  updateShift,
  deactivateShift,
} from '../controllers/shiftController.js'

import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

// Todas las rutas requieren iniciar sesión.
router.use(requireAuth)

// Consultar turnos.
router.get('/', listShifts)

// Registrar un nuevo turno.
router.post(
  '/',
  requirePermission('TURNO_GESTIONAR'),
  createShift
)

// Editar un turno existente.
router.put(
  '/:id',
  requirePermission('TURNO_GESTIONAR'),
  updateShift
)

// Desactivar un turno sin eliminarlo.
router.patch(
  '/:id/deactivate',
  requirePermission('TURNO_GESTIONAR'),
  deactivateShift
)

export default router
