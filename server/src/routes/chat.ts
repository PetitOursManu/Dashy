import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { chatLimiter } from '../middleware/rateLimit.js';
import * as chat from '../controllers/chatController.js';

const router = Router();

router.use(requireAuth);

// --- User-facing assistant ---
router.get('/status', asyncHandler(chat.status));
router.post('/', chatLimiter, validateBody(chat.chatSchema), asyncHandler(chat.chat));

// --- Admin: execute an assistant-proposed Store action (after confirmation) ---
router.post('/action', requireAdmin, validateBody(chat.actionSchema), asyncHandler(chat.runAction));

// --- Admin configuration ---
router.get('/config', requireAdmin, asyncHandler(chat.getConfig));
router.put(
  '/config',
  requireAdmin,
  validateBody(chat.updateConfigSchema),
  asyncHandler(chat.updateConfig),
);
router.post('/config/test', requireAdmin, asyncHandler(chat.testConfig));

// --- Admin: assistant-misuse alerts ---
router.get('/alerts', requireAdmin, asyncHandler(chat.listAlerts));
router.post('/alerts/:id/ack', requireAdmin, asyncHandler(chat.ackAlert));

export default router;
