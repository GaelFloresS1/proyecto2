import { Router } from 'express'
import {
  activateEmployee,
  createEmployee,
  deactivateEmployee,
  listEmployees,
  updateEmployee,
} from '../controllers/employeeController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
router.use(requireAuth)
router.get('/', requirePermission('EMPLEADO_VER'), listEmployees)
router.post('/', createEmployee)
router.put('/:id', updateEmployee)
router.patch('/:id/deactivate', deactivateEmployee)
router.patch('/:id/activate', activateEmployee)

export default router
