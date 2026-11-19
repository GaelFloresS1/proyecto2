import { Router } from 'express'
import { listAuditMovements } from '../controllers/auditController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
router.get('/', requireAuth, requirePermission('REPORTE_GENERAR'), listAuditMovements)

export default router
