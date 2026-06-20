import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as notif from '../controllers/notificationsController.js';

const router = Router();

router.use(requireAuth);

// --- User: own dashboard notifications ---
router.get('/', asyncHandler(notif.listMyNotifications));
router.post('/:id/read', asyncHandler(notif.readNotification));

// --- Admin: send + manage notifications ---
router.get('/admin', requireAdmin, asyncHandler(notif.listAdminNotifications));
router.post(
  '/',
  requireAdmin,
  validateBody(notif.createNotificationSchema),
  asyncHandler(notif.createNotification),
);
router.delete('/:id', requireAdmin, asyncHandler(notif.dismissNotification));

export default router;
