import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { backupUpload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import * as admin from '../controllers/adminController.js';
import * as kosmy from '../controllers/kosmyBoardController.js';

const router = Router();

// All admin/backup operations require an authenticated admin.
router.use(requireAuth, requireAdmin);

router.get('/backup', asyncHandler(admin.exportBackup));
router.post('/restore', uploadLimiter, backupUpload, asyncHandler(admin.importBackup));

// Sign in with Kosmy Board — settings (the client secret is write-only).
router.get('/kosmy-board', asyncHandler(kosmy.getConfig));
router.put(
  '/kosmy-board',
  validateBody(kosmy.updateConfigSchema),
  asyncHandler(kosmy.updateConfig),
);

export default router;
