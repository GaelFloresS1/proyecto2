
import { Router } from 'express'
import { listShifts, createShift } from '../controllers/shiftController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

router.use(requireAuth)

router.get('/', listShifts)

router.post(
  '/',
  requirePermission('TURNO_GESTIONAR'),
  createShift
)

export default router