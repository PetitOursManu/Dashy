import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as requests from '../controllers/requestsController.js';

const router = Router();

router.use(requireAuth);

// --- User: send + track project requests ---
router.get('/', asyncHandler(requests.listMyRequests));
router.post('/', validateBody(requests.createRequestSchema), asyncHandler(requests.createRequest));

// --- Staff (admin + semi-admin): review + resolve requests ---
router.get('/admin', requireStaff, asyncHandler(requests.listAdminRequests));
router.post(
  '/:id/status',
  requireStaff,
  validateBody(requests.requestStatusSchema),
  asyncHandler(requests.setRequestStatus),
);
router.post(
  '/:id/reply',
  requireStaff,
  validateBody(requests.replyRequestSchema),
  asyncHandler(requests.replyToRequest),
);
router.post(
  '/:id/archive',
  requireStaff,
  validateBody(requests.archiveRequestSchema),
  asyncHandler(requests.archiveRequest),
);
// Semi-admin (or admin) escalates a request to the administrators.
router.post('/:id/relay', requireStaff, asyncHandler(requests.relayRequest));

export default router;
