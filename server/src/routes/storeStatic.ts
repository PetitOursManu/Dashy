import { Router, type NextFunction, type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../middleware/error.js';
import { StoreConfig } from '../models/StoreConfig.js';
import { StoreInstalledApp } from '../models/StoreInstalledApp.js';
import { resolveStoreFile } from '../store/install.js';

// --- Path-mode serving: /store-apps/<slug>/... (public, no Dashy auth) ---

function serveFile(slug: string, requested: string, res: Response): void {
  const target = resolveStoreFile(slug, requested);
  if (!target) throw new ApiError(404, 'Not found');
  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(target);
}

async function serve(req: Request, res: Response): Promise<void> {
  serveFile(req.params.slug, req.params[0] ?? '', res);
}

const router = Router();
router.get(
  '/:slug',
  (req, res, next) => {
    if (!req.originalUrl.endsWith('/')) {
      res.redirect(301, req.originalUrl + '/');
      return;
    }
    next();
  },
  asyncHandler(serve),
);
router.get('/:slug/*', asyncHandler(serve));

export default router;

// --- Subdomain-mode serving: <slug>.<baseDomain>/... ---

// The wildcard config is cached briefly so the common case (no wildcard) costs
// at most one query per 30s instead of one per request.
let wcCache: { baseDomain: string; enabled: boolean; at: number } = {
  baseDomain: '',
  enabled: false,
  at: 0,
};

async function wildcard(): Promise<{ baseDomain: string; enabled: boolean }> {
  if (Date.now() - wcCache.at < 30_000) return wcCache;
  const cfg = await StoreConfig.findOne({ singleton: true }).select('wildcardEnabled baseDomain');
  wcCache = {
    baseDomain: (cfg?.baseDomain ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, ''),
    enabled: Boolean(cfg?.wildcardEnabled),
    at: Date.now(),
  };
  return wcCache;
}

/** Serve a static Store app when the request host is `<slug>.<baseDomain>`. */
export async function storeSubdomain(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const wc = await wildcard();
    if (!wc.enabled || !wc.baseDomain) return next();
    const host = (req.hostname || '').toLowerCase();
    if (host === wc.baseDomain || !host.endsWith('.' + wc.baseDomain)) return next();
    const label = host.slice(0, host.length - wc.baseDomain.length - 1);
    if (!/^[a-z0-9-]+$/.test(label)) return next();
    const installed = await StoreInstalledApp.findOne({
      slug: label,
      type: 'static',
      servingMode: 'subdomain',
    }).select('_id');
    if (!installed) return next();
    serveFile(label, (req.path || '').replace(/^\/+/, ''), res);
  } catch {
    next();
  }
}
