import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { importUpload, previewUpload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import * as apps from '../controllers/appsController.js';

const router = Router();

// All app routes require authentication.
router.use(requireAuth);

router.get('/', asyncHandler(apps.listApps));
router.get('/:id', asyncHandler(apps.getApp));
router.get('/:id/preview', asyncHandler(apps.getPreview));

// Toggle the current user's favorite for an app they can access.
router.post('/:id/favorite', asyncHandler(apps.toggleFavorite));

// Mutations are admin-only.
router.post('/', requireAdmin, uploadLimiter, importUpload, asyncHandler(apps.importApp));
router.patch('/:id', requireAdmin, previewUpload, asyncHandler(apps.updateApp));
router.delete('/:id', requireAdmin, asyncHandler(apps.deleteApp));

export default router;
