import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireAuth, blockTemp } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { avatarUpload, backgroundUpload } from '../middleware/upload.js';
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
router.post('/logout', asyncHandler(auth.logout));

// --- Authenticated session ---
router.get('/me', requireAuth, asyncHandler(auth.me));
router.get('/sessions', requireAuth, asyncHandler(auth.listSessions));
router.delete('/sessions/:id', requireAuth, asyncHandler(auth.revokeSession));
router.patch(
  '/profile',
  requireAuth,
  validateBody(auth.profileSchema),
  asyncHandler(auth.updateProfile),
);
router.post('/logout-all', requireAuth, asyncHandler(auth.logoutAll));

// --- Personal note ---
router.get('/note', requireAuth, asyncHandler(auth.getNote));
router.put('/note', requireAuth, validateBody(auth.noteSchema), asyncHandler(auth.updateNote));

// --- Avatar ---
router.post('/avatar', requireAuth, avatarUpload, asyncHandler(auth.uploadAvatar));
router.delete('/avatar', requireAuth, asyncHandler(auth.deleteAvatar));
router.get('/avatar/:id', requireAuth, asyncHandler(auth.getAvatar));

// --- Background image (image theme) ---
router.post('/background', requireAuth, backgroundUpload, asyncHandler(auth.uploadBackground));
router.delete('/background', requireAuth, asyncHandler(auth.deleteBackground));
router.get('/background', requireAuth, asyncHandler(auth.getBackground));

// --- 2FA management (not available to temporary accounts) ---
router.post('/2fa/setup', requireAuth, blockTemp, asyncHandler(auth.setupTwoFactor));
router.post(
  '/2fa/enable',
  requireAuth,
  blockTemp,
  validateBody(auth.twoFactorVerifySchema),
  asyncHandler(auth.enableTwoFactor),
);
router.post(
  '/2fa/disable',
  requireAuth,
  blockTemp,
  validateBody(auth.disable2faSchema),
  asyncHandler(auth.disableTwoFactor),
);
router.post(
  '/2fa/backup-codes',
  requireAuth,
  blockTemp,
  asyncHandler(auth.regenerateBackupCodes),
);

// --- Password (not available to temporary accounts) ---
router.post(
  '/password',
  requireAuth,
  blockTemp,
  validateBody(auth.passwordChangeSchema),
  asyncHandler(auth.changePassword),
);

export default router;
