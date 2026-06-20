import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { asyncHandler } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { HostedApp } from '../models/HostedApp.js';
import { ApiError } from '../middleware/error.js';
import { assertCanAccessApp } from '../services/access.js';
import { recordOpen } from '../services/opens.js';
import { resolveWithinApp } from '../utils/appServe.js';

const router = Router();

// Hosted apps are private: a request must be authenticated, and access is
// further restricted per-user (admins see all; regular users only their
// assigned apps — enforced in `serve`).
router.use(requireAuth);

async function serve(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findOne({ slug: req.params.slug });
  if (!app) throw new ApiError(404, 'Hosted app not found');

  // Only admins and users this app is shared with may open it.
  await assertCanAccessApp(req.user!, app._id);

  let requested = (req.params[0] ?? '').trim();
  // An empty path is a fresh "open" of the app root (not a sub-asset request).
  const isEntryOpen = requested === '';
  if (requested === '' || requested.endsWith('/')) {
    requested = path.posix.join(requested, app.entryFile || 'index.html');
  }

  const target = resolveWithinApp(app.id, requested);
  if (!target) throw new ApiError(400, 'Invalid path');

  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ApiError(404, 'File not found');
  }

  if (isEntryOpen) recordOpen(app._id, req.user!.sub);

  // Hosted content is user-supplied: forbid sniffing and framing from outside.
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(target);
}

// Ensure a trailing slash on the bare slug so relative asset URLs resolve.
router.get('/:slug', (req, res, next) => {
  if (!req.originalUrl.endsWith('/')) {
    res.redirect(301, req.originalUrl + '/');
    return;
  }
  next();
}, asyncHandler(serve));

router.get('/:slug/*', asyncHandler(serve));

export default router;
