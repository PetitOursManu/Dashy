import express, { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/kosmyBoardAdminController.js';
import * as users from '../controllers/kosmyBoardUsersController.js';

/**
 * "Users managed by the Board" (kosmy.board-users.v1), mounted at
 * /api/kosmy-board/users ahead of the dashboard middleware, like the admin in
 * the Board: the Board's server authenticates with its own Bearer token (same
 * checks, same rights), so no session cookie, no CORS, no API rate limiter and
 * never the SPA fallback. Answers are always JSON and no-store.
 */
const router = Router();

router.use(admin.noStore);
router.use(asyncHandler(admin.authenticate));

router.get('/', asyncHandler(users.describe));
router.put(
  '/:sub',
  // Parsed only once the token is verified; any content type is read as JSON.
  express.json({ limit: '100kb', type: () => true }),
  asyncHandler(users.put),
);
router.delete('/:sub', asyncHandler(users.remove));
router.all('/', users.methodNotAllowed);
router.all('/:sub', users.methodNotAllowed);
router.use(users.notFound);
router.use(users.errorHandler);

export default router;
