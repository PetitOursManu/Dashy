import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { authLimiter } from '../middleware/rateLimit.js';
import * as sso from '../controllers/ssoController.js';

const router = Router();

// "Sign in with Dashy" — a redirect flow, rate-limited like the auth routes.
// Auth is handled inside the controller (redirect to login when absent) rather
// than via requireAuth, so an unauthenticated visitor is bounced through login
// instead of getting a JSON 401.
router.get('/authorize', authLimiter, asyncHandler(sso.authorize));

export default router;
