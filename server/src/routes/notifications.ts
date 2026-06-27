import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireStaff } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as notif from '../controllers/notificationsController.js';

const router = Router();

router.use(requireAuth);

// --- User: own dashboard notifications ---
router.get('/', asyncHandler(notif.listMyNotifications));
router.post('/:id/read', asyncHandler(notif.readNotification));

// --- Staff (admin + semi-admin): send + manage notifications ---
router.get('/admin', requireStaff, asyncHandler(notif.listAdminNotifications));
router.post(
  '/',
  requireStaff,
  validateBody(notif.createNotificationSchema),
  asyncHandler(notif.createNotification),
);
router.delete('/:id', requireStaff, asyncHandler(notif.dismissNotification));

export default router;
