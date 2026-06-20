import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { importUpload, previewUpload, contentUpload } from '../middleware/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import * as apps from '../controllers/appsController.js';
import * as share from '../controllers/shareController.js';

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

// Content update + version rollback (admin-only).
router.post(
  '/:id/content',
  requireAdmin,
  uploadLimiter,
  contentUpload,
  asyncHandler(apps.updateContent),
);
router.post('/:id/versions/:vid/rollback', requireAdmin, asyncHandler(apps.rollbackVersion));

// Public-share management is admin-only.
router.post(
  '/:id/share',
  requireAdmin,
  validateBody(share.shareSchema),
  asyncHandler(share.createShare),
);
router.delete('/:id/share', requireAdmin, asyncHandler(share.revokeShare));

export default router;
