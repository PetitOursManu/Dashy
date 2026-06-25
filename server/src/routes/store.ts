import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as store from '../controllers/storeController.js';

const router = Router();

// The whole Store admin surface is admin-only.
router.use(requireAuth, requireAdmin);

// Catalogue
router.get('/catalog', asyncHandler(store.listCatalog));
router.post('/catalog/refresh', asyncHandler(store.refreshCatalog));

// Sources
router.get('/sources', asyncHandler(store.listSources));
router.post('/sources', validateBody(store.createSourceSchema), asyncHandler(store.createSource));
router.patch('/sources/:id', validateBody(store.updateSourceSchema), asyncHandler(store.updateSource));
router.delete('/sources/:id', asyncHandler(store.deleteSource));

// Config (deploy drivers + wildcard DNS)
router.get('/config', asyncHandler(store.getConfig));
router.put('/config', validateBody(store.updateConfigSchema), asyncHandler(store.updateConfig));

// Installed apps
router.get('/installed', asyncHandler(store.listInstalled));
router.post('/install', validateBody(store.installSchema), asyncHandler(store.install));
router.post('/installed/:id/update', asyncHandler(store.updateInstalled));
router.delete('/installed/:id', asyncHandler(store.uninstallApp));

export default router;
