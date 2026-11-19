import { Router } from 'express'
import { createAttendanceReport, getAttendanceReport, listAttendanceReports } from '../controllers/reportController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
router.use(requireAuth, requirePermission('REPORTE_GENERAR'))
router.post('/', createAttendanceReport)
router.get('/', listAttendanceReports)
router.get('/:id', getAttendanceReport)

export default router
