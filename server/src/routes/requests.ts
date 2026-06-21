import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as requests from '../controllers/requestsController.js';

const router = Router();

router.use(requireAuth);

// --- User: send + track project requests ---
router.get('/', asyncHandler(requests.listMyRequests));
router.post('/', validateBody(requests.createRequestSchema), asyncHandler(requests.createRequest));

// --- Admin: review + resolve requests ---
router.get('/admin', requireAdmin, asyncHandler(requests.listAdminRequests));
router.post(
  '/:id/status',
  requireAdmin,
  validateBody(requests.requestStatusSchema),
  asyncHandler(requests.setRequestStatus),
);
router.post(
  '/:id/reply',
  requireAdmin,
  validateBody(requests.replyRequestSchema),
  asyncHandler(requests.replyToRequest),
);

export default router;
