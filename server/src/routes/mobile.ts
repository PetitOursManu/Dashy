import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as mobileAuth from '../controllers/mobileAuthController.js';
import * as mobile from '../controllers/mobileController.js';
import * as auth from '../controllers/authController.js';
import * as apps from '../controllers/appsController.js';
import * as notif from '../controllers/notificationsController.js';
import * as requests from '../controllers/requestsController.js';
import * as store from '../controllers/storeController.js';
import * as stats from '../controllers/statsController.js';

/**
 * Versioned API for the Dashy Mobile app. Authentication is Bearer-token based
 * (tokens returned in the JSON body), so this surface works for native clients
 * that cannot use cookies. Most data endpoints are thin reuses of the existing
 * web controllers, which are Bearer-aware via `requireAuth`.
 */
const router = Router();

// --- Discovery (public) ---
router.get('/info', asyncHandler(mobile.info));

// --- Auth (Bearer) ---
router.post(
  '/auth/login',
  authLimiter,
  validateBody(mobileAuth.mobileLoginSchema),
  asyncHandler(mobileAuth.login),
);
router.post(
  '/auth/2fa/verify',
  authLimiter,
  validateBody(mobileAuth.mobileTwoFactorSchema),
  asyncHandler(mobileAuth.verifyTwoFactor),
);
router.post('/auth/logout', requireAuth, asyncHandler(mobileAuth.logout));
router.get('/auth/me', requireAuth, asyncHandler(auth.me));

// Device/session management (reuses the web session list).
router.get('/auth/sessions', requireAuth, asyncHandler(auth.listSessions));
router.delete('/auth/sessions/:id', requireAuth, asyncHandler(auth.revokeSession));

// --- Aggregated snapshot ---
router.get('/sync', requireAuth, asyncHandler(mobile.sync));

// --- Apps ---
router.get('/apps', requireAuth, asyncHandler(apps.listApps));
router.get('/apps/:id', requireAuth, asyncHandler(apps.getApp));
router.post('/apps/:id/favorite', requireAuth, asyncHandler(apps.toggleFavorite));

// --- Notifications ---
router.get('/notifications', requireAuth, asyncHandler(notif.listMyNotifications));
router.post('/notifications/:id/read', requireAuth, asyncHandler(notif.readNotification));

// --- Project requests ---
router.get('/requests', requireAuth, asyncHandler(requests.listMyRequests));
router.post(
  '/requests',
  requireAuth,
  validateBody(requests.createRequestSchema),
  asyncHandler(requests.createRequest),
);

// --- Profile + personal note ---
router.patch(
  '/profile',
  requireAuth,
  validateBody(auth.profileSchema),
  asyncHandler(auth.updateProfile),
);
router.get('/note', requireAuth, asyncHandler(auth.getNote));
router.put('/note', requireAuth, validateBody(auth.noteSchema), asyncHandler(auth.updateNote));

// --- Admin read-only surfaces (Store catalogues + analytics) ---
router.get('/store/installed', requireAuth, requireAdmin, asyncHandler(store.listInstalled));
router.get('/store/catalog', requireAuth, requireAdmin, asyncHandler(store.listCatalog));
router.get('/store/config', requireAuth, requireAdmin, asyncHandler(store.getConfig));
router.get('/stats/overview', requireAuth, requireAdmin, asyncHandler(stats.overview));

export default router;
