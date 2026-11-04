import { Router } from 'express'
import { clockIn, clockOut, history, today } from '../controllers/attendanceController.js'
import { requireAuth } from '../middleware/requireAuth.js'

const router = Router()
router.use(requireAuth)
router.get('/today', today)
router.get('/history', history)
router.post('/clock-in', clockIn)
router.post('/clock-out', clockOut)
export default router
