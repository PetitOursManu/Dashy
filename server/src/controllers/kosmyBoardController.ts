import type { Request, Response } from 'express';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { env, isProduction } from '../config/env.js';
import { User, type UserDoc } from '../models/User.js';
import { KosmyFlow, type KosmyFlowDoc } from '../models/KosmyFlow.js';
import { getKosmyBoardConfig } from '../models/KosmyBoardConfig.js';
import { ApiError } from '../middleware/error.js';
import { resolveSessionUser } from '../middleware/auth.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { COOKIE_NAME, cookieOptions, signPendingToken } from '../utils/jwt.js';
import { logActivity } from '../services/activity.js';
import { setAuthCookie } from './authController.js';
import { provisionBoardUser, UsersApiError } from '../services/kosmyBoard/users.js';
import {
  DEFAULT_TARGET,
  FLOW_COOKIE,
  FLOW_COOKIE_PATH,
  FLOW_TTL_MS,
  LINK_FINISH_PATH,
  OidcError,
  baseUrl,
  bouncePage,
  buildAuthorizationUrl,
  clearOidcCaches,
  discover,
  exchangeCode,
  initiateLoginUri,
  normalizeIssuer,
  randomToken,
  redirectUri,
  safeEqual,
  safeTarget,
  verifyIdToken,
  type KosmyClaims,
} from '../services/kosmyBoard/oidc.js';

/**
 * "Sign in with Kosmy Board" (OpenID Connect).
 *
 * - GET  /auth/kosmy-board/login        launch (button, or "Open" in the Board)
 * - GET  /auth/kosmy-board/callback     return from the Board
 * - GET  /auth/kosmy-board/link/finish  second half of "Link to Kosmy Board"
 * - GET  /api/auth/kosmy-board          is it configured? (login page button)
 * - POST /api/auth/kosmy-board/link     start linking the signed-in account
 * - DELETE /api/auth/kosmy-board        unlink (asks for the Dashy password)
 * - GET/PUT /api/admin/kosmy-board      admin settings
 *
 * Accounts are matched on the Kosmy Board `sub` only, never on the email
 * (which the Board does not verify). Admin rights are never granted here.
 */

const PENDING_2FA_MAX_AGE = 5 * 60 * 1000;

export interface KosmySettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  autoCreate: boolean;
  requireDashy2fa: boolean;
}

/** Settings, or null when the admin has not (fully) configured Kosmy Board sign-in. */
export async function getSettings(): Promise<KosmySettings | null> {
  const cfg = await getKosmyBoardConfig();
  if (!cfg.issuer || !cfg.clientId || !cfg.clientSecretEnc) return null;
  let clientSecret: string;
  try {
    clientSecret = decrypt(cfg.clientSecretEnc);
  } catch {
    return null; // ENCRYPTION_KEY changed: the secret must be entered again.
  }
  return {
    issuer: cfg.issuer,
    clientId: cfg.clientId,
    clientSecret,
    autoCreate: cfg.autoCreate,
    requireDashy2fa: cfg.requireDashy2fa,
  };
}

function base(): string {
  return baseUrl(env.APP_ORIGIN);
}

/**
 * The flow cookie must survive the cross-site return from the Board, so it is
 * SameSite=Lax (sent on top-level GET navigations). It only holds the random
 * `state`; everything else stays server-side.
 */
function flowCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: FLOW_COOKIE_PATH,
    ...(maxAge ? { maxAge } : {}),
  };
}

function clearFlowCookie(res: Response): void {
  res.clearCookie(FLOW_COOKIE, flowCookieOptions());
}

function redirectWithError(res: Response, page: '/login' | '/security', code: string): void {
  res.redirect(303, `${page}?kosmy_error=${encodeURIComponent(code)}`);
}

/** Send the meta-refresh page that lands on `path` with the new (Strict) cookie. */
function sendBounce(res: Response, path: string): void {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(bouncePage(path));
}

function isExpired(flow: KosmyFlowDoc): boolean {
  return Date.now() - flow.createdAt.getTime() > FLOW_TTL_MS;
}

/** Create the server-side flow, set the browser cookie and return the Board URL. */
async function startFlow(
  res: Response,
  settings: KosmySettings,
  p: { target: string; mode: 'login' | 'link'; uid?: string },
): Promise<string> {
  const doc = await discover(settings.issuer);
  const flow = await KosmyFlow.create({
    state: randomToken(32),
    nonce: randomToken(32),
    verifier: randomToken(32),
    iss: settings.issuer,
    target: p.target,
    mode: p.mode,
    uid: p.uid ?? null,
  });
  res.cookie(FLOW_COOKIE, flow.state, flowCookieOptions(FLOW_TTL_MS));
  return buildAuthorizationUrl(doc, {
    clientId: settings.clientId,
    redirectUri: redirectUri(base()),
    state: flow.state,
    nonce: flow.nonce,
    verifier: flow.verifier,
  });
}

/* ------------------------------- accounts ---------------------------------- */

type ResolveResult =
  | { ok: true; user: UserDoc }
  | {
      ok: false;
      error: 'not_linked' | 'account_expired' | 'account_disabled' | 'email_taken' | 'no_email';
    };

const emailSchema = z.string().email().max(254);

/** Find the Dashy account linked to this Board account, or (optionally) create one. */
export async function resolveKosmyAccount(
  claims: KosmyClaims,
  autoCreate: boolean,
): Promise<ResolveResult> {
  const linked = await User.findOne({ kosmySub: claims.sub });
  if (linked) {
    if (linked.role === 'temp' && linked.expiresAt && linked.expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: 'account_expired' };
    }
    // Access withdrawn in the Board: no sign-in, no admin in the Board.
    if (linked.disabled === true) return { ok: false, error: 'account_disabled' };
    return { ok: true, user: linked };
  }

  if (!autoCreate) return { ok: false, error: 'not_linked' };

  const email = (claims.email || claims.preferred_username || '').trim().toLowerCase();
  if (!emailSchema.safeParse(email).success) return { ok: false, error: 'no_email' };
  // Never attach to (or take over) an existing account with the same email:
  // its owner signs in with their password and links from the Security page.
  if (await User.exists({ email })) return { ok: false, error: 'email_taken' };

  try {
    const user = await User.create({
      email,
      // Unusable random password: this account signs in through the Board.
      passwordHash: await argon2.hash(crypto.randomBytes(32).toString('base64url'), {
        type: argon2.argon2id,
      }),
      // Never an administrator, whatever the claims say.
      role: 'user',
      fullName: (claims.name ?? '').slice(0, 120),
      language: claims.locale === 'fr' ? 'fr' : 'en',
      kosmySub: claims.sub,
    });
    logActivity('user.created', email, 'account created by a Kosmy Board sign-in');
    return { ok: true, user };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return { ok: false, error: 'email_taken' };
    throw err;
  }
}

/**
 * The `kosmy_board_access` claim of a sign-in: apply it like the Board's PUT.
 * A refusal becomes a `kosmy_error` code for the login page.
 */
async function applyBoardAccess(
  claims: KosmyClaims,
): Promise<{ ok: true; user: UserDoc } | { ok: false; error: string }> {
  const access = claims.kosmy_board_access!;
  try {
    const { user } = await provisionBoardUser(
      claims.sub,
      {
        name: claims.name,
        email: claims.email || claims.preferred_username,
        locale: claims.locale,
        role: access.role,
        values: access.values,
      },
      { actorSub: null, atLogin: true, lang: 'en' },
    );
    return { ok: true, user };
  } catch (e) {
    if (!(e instanceof UsersApiError)) throw e;
    console.warn(`[kosmy-board] sign-in: kosmy_board_access refused (${e.key})`);
    if (e.key === 'usersApi.emailNeeded' || e.key === 'usersApi.badEmail') {
      return { ok: false, error: 'no_email' };
    }
    if (e.status === 409) return { ok: false, error: 'email_taken' };
    return { ok: false, error: 'access_invalid' };
  }
}

/* ------------------------------ public flow -------------------------------- */

/** GET /auth/kosmy-board/login — launch (also third-party initiated by the Board). */
export async function login(req: Request, res: Response): Promise<void> {
  const settings = await getSettings();
  if (!settings) return redirectWithError(res, '/login', 'not_configured');

  // Third-party initiated login: refuse an issuer other than the configured one.
  const iss = typeof req.query.iss === 'string' ? req.query.iss : undefined;
  if (iss !== undefined && normalizeIssuer(iss) !== settings.issuer) {
    return redirectWithError(res, '/login', 'issuer');
  }

  // Only a page of this instance (same origin) — never an open redirect.
  const rawTarget = typeof req.query.target_link_uri === 'string' ? req.query.target_link_uri : '';
  const target = safeTarget(rawTarget, base());

  try {
    const url = await startFlow(res, settings, { target, mode: 'login' });
    res.redirect(303, url);
  } catch (e) {
    console.error('[kosmy-board] login start failed:', (e as Error).message);
    redirectWithError(res, '/login', e instanceof OidcError ? e.code : 'unreachable');
  }
}

/** GET /auth/kosmy-board/callback — return from the Board. */
export async function callback(req: Request, res: Response): Promise<void> {
  const q = (k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string) : null);
  const state = q('state');
  const cookieState = req.cookies?.[FLOW_COOKIE] as string | undefined;

  // The state must match the one this browser holds, and is consumed at once.
  if (!state || !cookieState || !safeEqual(state, cookieState)) {
    clearFlowCookie(res);
    return redirectWithError(res, '/login', 'expired');
  }
  const flow = await KosmyFlow.findOneAndUpdate(
    { state, used: false },
    { $set: { used: true } },
    { new: true },
  );
  if (!flow || isExpired(flow)) {
    clearFlowCookie(res);
    return redirectWithError(res, '/login', 'expired');
  }
  const errorPage = flow.mode === 'link' ? '/security' : '/login';
  const fail = async (code: string) => {
    clearFlowCookie(res);
    await KosmyFlow.deleteOne({ _id: flow._id });
    redirectWithError(res, errorPage, code);
  };

  const error = q('error');
  if (error) return fail(error === 'access_denied' ? 'denied' : 'failed');

  const settings = await getSettings();
  if (!settings) return fail('not_configured');
  // Settings changed while the flow was running.
  if (flow.iss !== settings.issuer) return fail('issuer');

  try {
    const doc = await discover(settings.issuer);

    // RFC 9207: the response must come from the expected issuer.
    const iss = q('iss');
    if (iss !== null && iss !== doc.issuer) return fail('issuer');

    const code = q('code');
    if (!code) return fail('failed');

    const idToken = await exchangeCode(doc, {
      code,
      redirectUri: redirectUri(base()),
      verifier: flow.verifier,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    });
    const claims = await verifyIdToken(idToken, {
      issuer: doc.issuer,
      clientId: settings.clientId,
      nonce: flow.nonce,
      jwksUri: doc.jwks_uri,
    });

    if (flow.mode === 'link') {
      // The Dashy session cookie (SameSite=Strict) is not sent on this
      // cross-site return, so the signed-in user is checked on a same-site
      // follow-up request: keep the verified `sub` and bounce there.
      flow.sub = claims.sub;
      await flow.save();
      return sendBounce(res, LINK_FINISH_PATH);
    }

    clearFlowCookie(res);
    await KosmyFlow.deleteOne({ _id: flow._id });

    let user: UserDoc;
    if (claims.kosmy_board_access) {
      // Access managed by the Board (kosmy.board-users.v1): same rules as its
      // PUT, the account is created if needed (never linked by email).
      const access = await applyBoardAccess(claims);
      if (!access.ok) return redirectWithError(res, '/login', access.error);
      user = access.user;
    } else {
      const result = await resolveKosmyAccount(claims, settings.autoCreate);
      if (!result.ok) return redirectWithError(res, '/login', result.error);
      user = result.user;
    }

    if (settings.requireDashy2fa && user.twoFactorEnabled) {
      // Admin asked for Dashy's own 2FA on top of the Board's: hand over to
      // the regular second step of the login page.
      res.cookie(COOKIE_NAME, signPendingToken(user.id), cookieOptions(PENDING_2FA_MAX_AGE));
      const next = flow.target === DEFAULT_TARGET ? '' : `&next=${encodeURIComponent(flow.target)}`;
      return sendBounce(res, `/login?kosmy_2fa=1${next}`);
    }

    // The Board sign-in (with the Board's own 2FA) replaces Dashy's password + 2FA.
    await setAuthCookie(req, res, user);
    sendBounce(res, flow.target);
  } catch (e) {
    console.error('[kosmy-board] callback failed:', (e as Error).message);
    await fail(e instanceof OidcError ? e.code : 'unreachable');
  }
}

/** GET /auth/kosmy-board/link/finish — attach the verified `sub` to the signed-in user. */
export async function linkFinish(req: Request, res: Response): Promise<void> {
  const cookieState = req.cookies?.[FLOW_COOKIE] as string | undefined;
  clearFlowCookie(res);
  if (!cookieState) return redirectWithError(res, '/security', 'expired');

  const flow = await KosmyFlow.findOneAndDelete({
    state: cookieState,
    mode: 'link',
    used: true,
    sub: { $type: 'string' },
  });
  if (!flow || !flow.sub || !flow.uid || isExpired(flow)) {
    return redirectWithError(res, '/security', 'expired');
  }

  // The account to link is the one that started the flow, still signed in.
  let current;
  try {
    current = await resolveSessionUser(req);
  } catch {
    return redirectWithError(res, '/security', 'session');
  }
  if (current.sub !== String(flow.uid)) return redirectWithError(res, '/security', 'session');

  const owner = await User.findOne({ kosmySub: flow.sub }).select('_id');
  if (owner && String(owner._id) !== current.sub) {
    return redirectWithError(res, '/security', 'already_linked');
  }
  try {
    await User.updateOne({ _id: current.sub }, { $set: { kosmySub: flow.sub } });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      return redirectWithError(res, '/security', 'already_linked');
    }
    throw err;
  }
  res.redirect(303, '/security?kosmy=linked');
}

/* --------------------------------- API ------------------------------------- */

/** GET /api/auth/kosmy-board — whether the login page shows the button. */
export async function status(_req: Request, res: Response): Promise<void> {
  res.json({ enabled: (await getSettings()) !== null });
}

/** POST /api/auth/kosmy-board/link — start "Link to Kosmy Board" for the signed-in user. */
export async function startLink(req: Request, res: Response): Promise<void> {
  const settings = await getSettings();
  if (!settings) throw new ApiError(400, 'Kosmy Board sign-in is not configured');
  try {
    const url = await startFlow(res, settings, {
      target: '/security',
      mode: 'link',
      uid: req.user!.sub,
    });
    res.json({ url });
  } catch (e) {
    console.error('[kosmy-board] link start failed:', (e as Error).message);
    throw new ApiError(502, 'Kosmy Board is unreachable');
  }
}

export const unlinkSchema = z.object({ password: z.string().min(1).max(200) });

/**
 * DELETE /api/auth/kosmy-board — unlink. Asking for the Dashy password makes
 * sure the user can still sign in afterwards.
 */
export async function unlink(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.user!.sub);
  if (!user) throw new ApiError(404, 'User not found');
  const { password } = req.body as z.infer<typeof unlinkSchema>;
  if (!(await argon2.verify(user.passwordHash, password))) {
    throw new ApiError(401, 'Incorrect password');
  }
  await User.updateOne({ _id: user._id }, { $unset: { kosmySub: 1 } });
  res.json({ ok: true });
}

/* -------------------------------- admin ------------------------------------ */

async function configPayload() {
  const cfg = await getKosmyBoardConfig();
  return {
    config: cfg.toJSON(),
    enabled: (await getSettings()) !== null,
    redirectUri: redirectUri(base()),
    initiateLoginUri: initiateLoginUri(base()),
  };
}

/** GET /api/admin/kosmy-board */
export async function getConfig(_req: Request, res: Response): Promise<void> {
  res.json(await configPayload());
}

export const updateConfigSchema = z.object({
  issuer: z.string().max(500).optional(),
  clientId: z.string().max(200).optional(),
  // Write-only: a non-empty value replaces the stored secret.
  clientSecret: z.string().max(500).optional(),
  clearClientSecret: z.boolean().optional(),
  autoCreate: z.boolean().optional(),
  requireDashy2fa: z.boolean().optional(),
});

/** PUT /api/admin/kosmy-board */
export async function updateConfig(req: Request, res: Response): Promise<void> {
  const body = req.body as z.infer<typeof updateConfigSchema>;
  const cfg = await getKosmyBoardConfig();

  if (body.issuer !== undefined) {
    const trimmed = body.issuer.trim();
    const issuer = trimmed ? normalizeIssuer(trimmed) : '';
    if (issuer === null) throw new ApiError(400, 'Invalid issuer URL');
    cfg.issuer = issuer;
  }
  if (body.clientId !== undefined) cfg.clientId = body.clientId.trim();
  if (body.clearClientSecret) cfg.clientSecretEnc = null;
  if (body.clientSecret && body.clientSecret.trim()) {
    cfg.clientSecretEnc = encrypt(body.clientSecret.trim());
  }
  if (body.autoCreate !== undefined) cfg.autoCreate = body.autoCreate;
  if (body.requireDashy2fa !== undefined) cfg.requireDashy2fa = body.requireDashy2fa;
  await cfg.save();
  clearOidcCaches();

  res.json(await configPayload());
}
