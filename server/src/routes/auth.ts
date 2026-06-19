import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import * as auth from '../controllers/authController.js';

const router = Router();

// --- Public / login flow ---
router.post(
  '/register',
  authLimiter,
  validateBody(auth.credentialsSchema),
  asyncHandler(auth.register),
);
router.post('/login', authLimiter, validateBody(auth.credentialsSchema), asyncHandler(auth.login));
router.post(
  '/2fa/verify',
  authLimiter,
  validateBody(auth.twoFactorVerifySchema),
  asyncHandler(auth.verifyTwoFactorLogin),
);
router.post('/logout', auth.logout);

// --- Authenticated session ---
router.get('/me', requireAuth, asyncHandler(auth.me));

// --- 2FA management ---
router.post('/2fa/setup', requireAuth, asyncHandler(auth.setupTwoFactor));
router.post(
  '/2fa/enable',
  requireAuth,
  validateBody(auth.twoFactorVerifySchema),
  asyncHandler(auth.enableTwoFactor),
);
router.post(
  '/2fa/disable',
  requireAuth,
  validateBody(auth.disable2faSchema),
  asyncHandler(auth.disableTwoFactor),
);
router.post(
  '/2fa/backup-codes',
  requireAuth,
  asyncHandler(auth.regenerateBackupCodes),
);

// --- Password ---
router.post(
  '/password',
  requireAuth,
  validateBody(auth.passwordChangeSchema),
  asyncHandler(auth.changePassword),
);

export default router;
