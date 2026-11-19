import { Router } from 'express'
import {
  createHoliday,
  deleteHoliday,
  holidayManagementPermission,
  listHolidays,
  updateHoliday,
} from '../controllers/holidayController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
const requireManagement = requirePermission(holidayManagementPermission)
router.use(requireAuth)
router.get('/', listHolidays)
router.post('/', requireManagement, createHoliday)
router.put('/:id', requireManagement, updateHoliday)
router.delete('/:id', requireManagement, deleteHoliday)
export default router
