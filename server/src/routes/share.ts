import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as share from '../controllers/shareController.js';

// Public router — NO authentication. Access is gated only by the unguessable
// share token (and an optional password / expiry).
const router = Router();

// Password form submission.
router.post('/:token', asyncHandler(share.unlockShare));

// Ensure a trailing slash on the bare token so relative asset URLs resolve.
router.get(
  '/:token',
  (req, res, next) => {
    if (!req.originalUrl.endsWith('/')) {
      res.redirect(301, req.originalUrl + '/');
      return;
    }
    next();
  },
  asyncHandler(share.serveShare),
);
router.get('/:token/*', asyncHandler(share.serveShare));

export default router;
