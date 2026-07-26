import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { dbLimiter } from '../middleware/rateLimit.js';
import * as db from '../controllers/databaseController.js';

// Mounted at /api/apps/:appId/database — mergeParams keeps :appId available.
const router = Router({ mergeParams: true });

// The whole DB Explorer surface is admin-only (admin + subadmin, like the Store).
router.use(requireAuth, requireAdmin);

// --- Connection lifecycle ---
router.get('/connection', asyncHandler(db.getConnection));
router.post(
  '/connection/test',
  dbLimiter,
  validateBody(db.connectionInputSchema),
  asyncHandler(db.testConnection),
);
router.post(
  '/connection',
  dbLimiter,
  validateBody(db.connectionInputSchema),
  asyncHandler(db.saveConnection),
);
router.delete(
  '/connection',
  dbLimiter,
  validateBody(db.deleteConnectionSchema),
  asyncHandler(db.deleteConnection),
);

// --- Read-only exploration ---
router.get('/schemas', asyncHandler(db.listSchemas));
router.get('/schemas/:schema/collections', asyncHandler(db.listCollections));
router.get('/schemas/:schema/collections/:name/fields', asyncHandler(db.getCollectionFields));
router.get('/schemas/:schema/collections/:name/rows', asyncHandler(db.listRows));

export default router;
