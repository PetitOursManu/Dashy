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
import hostedRoutes from './routes/hosted.js';
import shareRoutes from './routes/share.js';

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

  app.use(
    cors({
      origin: env.APP_ORIGIN,
      credentials: true,
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Strict CSP for the dashboard (API + SPA). Skipped for /hosted so imported
  // apps can run their own inline scripts/styles.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/hosted/') || req.path.startsWith('/share/')) return next();
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
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

  // Hosted static apps (authenticated) and public share links (token-gated).
  app.use('/hosted', hostedRoutes);
  app.use('/share', shareRoutes);

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
