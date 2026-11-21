import express, { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as admin from '../controllers/kosmyBoardAdminController.js';

/**
 * "Admin in Kosmy Board" (kosmy.board-admin.v1), mounted at
 * /api/kosmy-board/admin ahead of the dashboard middleware: the Board's server
 * authenticates with its own Bearer token, so there is no session cookie, no
 * CORS (no browser calls these routes), no API rate limiter (one Board server
 * makes every call) and never the SPA fallback. Errors are always JSON.
 */
const router = Router();

router.use(admin.noStore);
router.use(asyncHandler(admin.authenticate));

router.get('/', asyncHandler(admin.manifest));
router.get('/:section', asyncHandler(admin.getSection));
router.post(
  '/:section',
  // Parsed only once the token is verified; any content type is read as JSON.
  express.json({ limit: '1mb', type: () => true }),
  asyncHandler(admin.postAction),
);
router.all('/', admin.methodNotAllowed);
router.all('/:section', admin.methodNotAllowed);
router.use(admin.notFound);
router.use(admin.errorHandler);

export default router;
