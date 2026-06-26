import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { storeContentUpload } from '../middleware/upload.js';
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
router.post('/sources/managed', validateBody(store.createManagedSchema), asyncHandler(store.createManagedSource));
router.patch('/sources/:id', validateBody(store.updateSourceSchema), asyncHandler(store.updateSource));
router.delete('/sources/:id', asyncHandler(store.deleteSource));

// Import a static bundle from the admin's machine → returns an upload reference.
router.post('/uploads', storeContentUpload, asyncHandler(store.uploadStaticBundle));

// Resolve a GitHub repo URL to its docker-compose content (deploy authoring).
router.post(
  '/compose-from-repo',
  validateBody(store.composeFromRepoSchema),
  asyncHandler(store.composeFromRepo),
);

// Apps inside a Dashy-managed catalogue. The manifest body is validated in the
// controller (via parseManifest) so authors get field-level 422 messages.
router.post('/sources/:id/apps', asyncHandler(store.addCatalogApp));
router.patch('/sources/:id/apps/:appId', asyncHandler(store.updateCatalogApp));
router.delete('/sources/:id/apps/:appId', asyncHandler(store.deleteCatalogApp));

// Config (deploy drivers + wildcard DNS)
router.get('/config', asyncHandler(store.getConfig));
router.put('/config', validateBody(store.updateConfigSchema), asyncHandler(store.updateConfig));

// Installed apps
router.get('/installed', asyncHandler(store.listInstalled));
router.post('/install', validateBody(store.installSchema), asyncHandler(store.install));
router.post('/installed/:id/update', asyncHandler(store.updateInstalled));
router.post('/installed/:id/content', storeContentUpload, asyncHandler(store.updateInstalledContent));
router.post('/installed/:id/redeploy', validateBody(store.redeploySchema), asyncHandler(store.redeployApp));
router.post('/installed/:id/restart', asyncHandler(store.restartApp));
router.delete('/installed/:id', asyncHandler(store.uninstallApp));

export default router;
