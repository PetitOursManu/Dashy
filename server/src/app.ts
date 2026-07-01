import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env } from './config/env.js';
import { CLIENT_DIST_DIR } from './config/paths.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import appsRoutes from './routes/apps.js';
import usersRoutes from './routes/users.js';
import statsRoutes from './routes/stats.js';
import adminRoutes from './routes/admin.js';
import chatRoutes from './routes/chat.js';
import notificationsRoutes from './routes/notifications.js';
import requestsRoutes from './routes/requests.js';
import storeRoutes from './routes/store.js';
import storeStaticRoutes, { storeSubdomain } from './routes/storeStatic.js';
import hostedRoutes from './routes/hosted.js';
import shareRoutes from './routes/share.js';
import mobileRoutes from './routes/mobile.js';

export function createApp(): Express {
  const app = express();

  // Behind Coolify/Nginx we sit behind a reverse proxy — trust it for secure
  // cookies and rate-limit client IPs.
  app.set('trust proxy', 1);

  // Baseline security headers. CSP is applied separately so it does not break
  // user-supplied hosted content.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // The dashboard (SPA + cookie auth) is locked to its own origin and sends
  // credentials. The mobile API authenticates with Bearer tokens (no ambient
  // cookies, so no CSRF surface), so it may be called from any origin without
  // credentials — native apps and future web wrappers alike.
  const strictCors = cors({ origin: env.APP_ORIGIN, credentials: true });
  const mobileCors = cors({ origin: true, credentials: false });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/mobile/')) return mobileCors(req, res, next);
    return strictCors(req, res, next);
  });

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Serve Store `static` apps published on a dedicated subdomain (<slug>.<base>),
  // before the dashboard routing/CSP. No-ops unless wildcard DNS is configured.
  app.use(storeSubdomain);

  // Strict CSP for the dashboard (API + SPA). Skipped for /hosted so imported
  // apps can run their own inline scripts/styles.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (
      req.path.startsWith('/hosted/') ||
      req.path.startsWith('/share/') ||
      req.path.startsWith('/store-apps/')
    )
      return next();
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        // Allow remote https images so Store catalogue/app icons load.
        "img-src 'self' data: https:",
        // Google Fonts stylesheet (index.css @imports Inter from Google).
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        // Self scripts + the inline theme-flash-prevention script in index.html.
        "script-src 'self' 'sha256-wofaH4sXL5cH2l1Llj1NnOG+xJYK17j7g00HRdH/YBY='",
        "connect-src 'self'",
        // Google Fonts webfont files.
        "font-src 'self' data: https://fonts.gstatic.com",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
    );
    next();
  });

  // Health check (useful for Coolify/Docker healthchecks).
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

  // API.
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/apps', appsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/stats', statsRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/requests', requestsRoutes);
  app.use('/api/store', storeRoutes);

  // Versioned API for the Dashy Mobile app (Bearer-token auth).
  app.use('/api/mobile/v1', mobileRoutes);

  // Hosted static apps (authenticated) and public share links (token-gated).
  app.use('/hosted', hostedRoutes);
  app.use('/share', shareRoutes);

  // Store `static` apps served in path mode (public, CSP-exempt above).
  app.use('/store-apps', storeStaticRoutes);

  // Unknown API routes → JSON 404 (never fall through to the SPA).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // --- Frontend (production) ---
  if (fs.existsSync(CLIENT_DIST_DIR)) {
    app.use(express.static(CLIENT_DIST_DIR));
    // SPA fallback for client-side routing.
    app.get('*', (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'));
    });
  }

  // Normalize multer errors into clean API responses before the generic handler.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File too large (max ${env.MAX_UPLOAD_MB} MB)`
          : err.message;
      res.status(413).json({ error: message });
      return;
    }
    next(err);
  });

  app.use(errorHandler);

  return app;
}
