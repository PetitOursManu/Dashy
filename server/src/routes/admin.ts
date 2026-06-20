import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { backupUpload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import * as admin from '../controllers/adminController.js';

const router = Router();

// All admin/backup operations require an authenticated admin.
router.use(requireAuth, requireAdmin);

router.get('/backup', asyncHandler(admin.exportBackup));
router.post('/restore', uploadLimiter, backupUpload, asyncHandler(admin.importBackup));

export default router;
