import type { Request, Response } from 'express';
import { ssoEnabled, ssoRedirects } from '../config/env.js';
import { ApiError } from '../middleware/error.js';
import { resolveSessionUser } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { signSsoToken } from '../utils/sso.js';

/**
 * SSO authorize endpoint — Dashy acting as identity provider for other
 * self-hosted apps ("Sign in with Dashy").
 *
 * GET /api/sso/authorize?redirect_uri=<callback>&state=<opaque>
 *
 * Read-only: it never creates or mutates Dashy data, it only proves identity.
 * An authenticated Dashy session (cookie) is required; if absent the browser is
 * sent through the normal Dashy login (so 2FA is respected) and returns here.
 */
export async function authorize(req: Request, res: Response): Promise<void> {
  if (!ssoEnabled) throw new ApiError(404, 'SSO is not enabled');

  const redirectUri = typeof req.query.redirect_uri === 'string' ? req.query.redirect_uri : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';

  // Validate the callback against the exact-match allow-list BEFORE doing
  // anything else — we must never redirect to an unvetted URL (open-redirect).
  if (!redirectUri || !ssoRedirects.includes(redirectUri)) {
    throw new ApiError(400, 'Invalid or unregistered redirect_uri');
  }
  let callback: URL;
  try {
    callback = new URL(redirectUri);
  } catch {
    throw new ApiError(400, 'Invalid redirect_uri');
  }

  // Require a live Dashy session. On failure, bounce through the normal login
  // and come back to this exact URL (the SPA honours `next`).
  let session;
  try {
    session = await resolveSessionUser(req);
  } catch {
    const next = encodeURIComponent(req.originalUrl);
    res.redirect(302, `/login?next=${next}`);
    return;
  }

  const user = await User.findById(session.sub).select('email nickname fullName role');
  if (!user) {
    // Session valid but user gone — treat as unauthenticated.
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
    return;
  }

  const name = (user.nickname || user.fullName || '').trim();
  const token = signSsoToken(
    { sub: user.id, email: user.email, role: user.role, ...(name ? { name } : {}) },
    callback.origin,
  );

  callback.searchParams.set('token', token);
  if (state) callback.searchParams.set('state', state);
  res.redirect(302, callback.toString());
}
