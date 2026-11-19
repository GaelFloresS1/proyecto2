import { Router } from 'express'
import { listOwnRequests, requestCreationPermission, submitJustification, submitRequest } from '../controllers/requestController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
const requireCreation = requirePermission(requestCreationPermission)
router.use(requireAuth)
router.get('/', listOwnRequests)
router.post('/', requireCreation, submitRequest)
router.post('/justifications', requireCreation, submitJustification)
export default router
