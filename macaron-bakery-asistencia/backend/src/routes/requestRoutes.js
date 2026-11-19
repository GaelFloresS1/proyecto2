import { Router } from 'express'
import {
  listOwnRequests,
  listReviewRequests,
  requestCreationPermission,
  requestReviewPermission,
  resolveRequest,
  submitJustification,
  submitRequest,
} from '../controllers/requestController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()
const requireCreation = requirePermission(requestCreationPermission)
const requireReview = requirePermission(requestReviewPermission)
router.use(requireAuth)
router.get('/', listOwnRequests)
router.post('/', requireCreation, submitRequest)
router.post('/justifications', requireCreation, submitJustification)
router.get('/review', requireReview, listReviewRequests)
router.patch('/review/:type/:id', requireReview, resolveRequest)
export default router
