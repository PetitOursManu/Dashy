import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { kosmyLimiter } from '../middleware/rateLimit.js';
import * as kosmy from '../controllers/kosmyBoardController.js';

/**
 * "Sign in with Kosmy Board" browser routes, mounted at /auth/kosmy-board
 * (Kosmy convention: {base}/auth/kosmy-board/login and /callback).
 */
const router = Router();

router.use(kosmyLimiter);
router.get('/login', asyncHandler(kosmy.login));
router.get('/callback', asyncHandler(kosmy.callback));
router.get('/link/finish', asyncHandler(kosmy.linkFinish));

export default router;
