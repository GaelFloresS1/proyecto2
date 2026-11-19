import { Router } from 'express'
import {
  adjustAttendance,
  attendanceAdjustmentPermission,
  clockIn,
  clockOut,
  history,
  listAdjustableAttendance,
  today,
} from '../controllers/attendanceController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
const requireAdjustmentPermission = requirePermission(attendanceAdjustmentPermission)
router.use(requireAuth)
router.get('/today', today)
router.get('/history', history)
router.post('/clock-in', clockIn)
router.post('/clock-out', clockOut)
router.get('/adjustments', requireAdjustmentPermission, listAdjustableAttendance)
router.patch('/adjustments/:id', requireAdjustmentPermission, adjustAttendance)
export default router
