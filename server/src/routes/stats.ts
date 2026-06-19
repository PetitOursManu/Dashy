import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as stats from '../controllers/statsController.js';

const router = Router();

// Analytics are admin-only.
router.use(requireAuth, requireAdmin);

router.get('/overview', asyncHandler(stats.overview));
router.get('/activity', asyncHandler(stats.recentActivity));
router.get('/storage', asyncHandler(stats.storage));

export default router;
