import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError, DeployError } from '../middleware/error.js';
import { discover, OidcError } from '../services/kosmyBoard/oidc.js';
import { verifyAdminToken } from '../services/kosmyBoard/adminToken.js';
import {
  langFromHeader,
  t,
  translateApiError,
  type Lang,
} from '../services/kosmyBoard/adminI18n.js';
import { getSettings, resolveKosmyAccount } from './kosmyBoardController.js';
import {
  AdminError,
  DASHY_VERSION,
  SECTIONS,
  findSection,
  type ActionBody,
  type AdminContext,
} from './kosmyBoardAdminSections.js';

/**
 * "Admin in Kosmy Board" — protocol kosmy.board-admin.v1 (Kosmy Board
 * `docs/admin-api.md`). The Board's SERVER calls, with its own short-lived
 * Bearer token (never a browser, never Dashy's session cookie):
 *
 * - GET  /api/kosmy-board/admin             the app and its sections
 * - GET  /api/kosmy-board/admin/:section    one section
 * - POST /api/kosmy-board/admin/:section    an action in that section
 *
 * The Board only says who the person is (`sub`); the Dashy account linked to
 * that `sub` (same link as the sign-in) must be an administrator. Every action
 * then runs Dashy's own admin handler, with that account as the actor.
 */

export const ADMIN_API_PATH = '/api/kosmy-board/admin';
export const ADMIN_PROTOCOL = 'kosmy.board-admin.v1';

const SECTION_RE = /^[a-z0-9-]{1,40}$/;
const ACTION_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_ROW_ID = 512;

function lang(res: Response): Lang {
  return (res.locals.kbLang as Lang | undefined) ?? 'en';
}

function context(res: Response): AdminContext {
  return res.locals.kbAdmin as AdminContext;
}

/** Answers are never cached, errors included. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.set('Cache-Control', 'no-store');
  next();
}

/**
 * Bearer token → verified claims → linked Dashy account → administrator.
 * Sets `res.locals.kbAdmin` (the context of every handler below).
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = langFromHeader(req.get('accept-language'));
  res.locals.kbLang = header ?? 'en';
  const l = lang(res);

  const settings = await getSettings();
  if (!settings) throw new AdminError(401, 'invalid_token', t(l, 'error.notConfigured'));

  const m = /^Bearer\s+([A-Za-z0-9_\-.]+)$/i.exec(req.get('authorization') ?? '');
  if (!m) throw new AdminError(401, 'invalid_token', t(l, 'error.invalidToken'));

  // The path exactly as received (the htu must end with it).
  const path = new URL(req.originalUrl, 'http://localhost').pathname;
  let claims;
  try {
    const doc = await discover(settings.issuer);
    claims = await verifyAdminToken(m[1], {
      issuer: doc.issuer,
      clientId: settings.clientId,
      jwksUri: doc.jwks_uri,
      method: req.method,
      path,
    });
  } catch (e) {
    if (!(e instanceof OidcError)) throw e;
    console.warn(`[kosmy-board] admin API: ${e.message}`);
    const key = e.code === 'unreachable' ? 'error.unreachable' : 'error.invalidToken';
    throw new AdminError(401, 'invalid_token', t(l, key));
  }

  // Same link as the sign-in (by `sub` only), never creating an account.
  const result = await resolveKosmyAccount({ sub: claims.sub }, false);
  if (!result.ok) {
    if (result.error === 'account_expired') throw new AdminError(403, 'forbidden', t(l, 'error.expired'));
    throw new AdminError(403, 'not_linked', t(l, 'error.notLinked'));
  }
  const user = result.user;
  // The Board grants nothing: the rights are Dashy's.
  if (user.role !== 'admin') throw new AdminError(403, 'forbidden', t(l, 'error.forbidden'));

  if (!header) res.locals.kbLang = user.language === 'fr' ? 'fr' : 'en';
  const ctx: AdminContext = {
    user,
    actor: { sub: String(user.id), role: user.role, tv: user.tokenVersion ?? 0 },
    lang: lang(res),
  };
  res.locals.kbAdmin = ctx;
  next();
}

/** GET /api/kosmy-board/admin — the app and its sections. */
export async function manifest(_req: Request, res: Response): Promise<void> {
  const ctx = context(res);
  res.json({
    protocol: ADMIN_PROTOCOL,
    app: { name: 'Dashy', ...(DASHY_VERSION ? { version: DASHY_VERSION } : {}) },
    user: {
      name: ctx.user.fullName || ctx.user.nickname || ctx.user.email,
      role: t(ctx.lang, 'role.admin'),
    },
    sections: SECTIONS.map((s) => ({ id: s.id, title: t(ctx.lang, s.titleKey) })),
  });
}

function sectionFor(req: Request, res: Response) {
  const id = req.params.section;
  const def = SECTION_RE.test(id) ? findSection(id) : undefined;
  if (!def) throw new AdminError(404, 'not_found', t(lang(res), 'error.unknownSection'));
  return def;
}

/** GET /api/kosmy-board/admin/:section */
export async function getSection(req: Request, res: Response): Promise<void> {
  const def = sectionFor(req, res);
  res.json(await def.build(context(res)));
}

function parseActionBody(raw: unknown, l: Lang): ActionBody {
  const bad = () => new AdminError(400, 'invalid', t(l, 'error.badRequest'));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad();
  const b = raw as Record<string, unknown>;
  if (typeof b.action !== 'string' || !ACTION_RE.test(b.action)) throw bad();
  if (b.row !== undefined && (typeof b.row !== 'string' || b.row.length > MAX_ROW_ID)) throw bad();
  if (b.values !== undefined && (!b.values || typeof b.values !== 'object' || Array.isArray(b.values))) {
    throw bad();
  }
  return {
    action: b.action,
    row: b.row as string | undefined,
    values: (b.values as Record<string, unknown> | undefined) ?? {},
  };
}

/** POST /api/kosmy-board/admin/:section — run an action, answer with the fresh section. */
export async function postAction(req: Request, res: Response): Promise<void> {
  const def = sectionFor(req, res);
  const ctx = context(res);
  const body = parseActionBody(req.body, ctx.lang);

  const result = await def.act(ctx, body);
  console.info(`[kosmy-board] admin action ${def.id}/${body.action} by ${ctx.user.email}`);

  // The action is done: a failure to redraw the section must not hide that.
  let section;
  try {
    section = await def.build(ctx);
  } catch (e) {
    console.error('[kosmy-board] admin section refresh failed:', e);
  }
  res.json({ ok: true, ...result, ...(section ? { section } : {}) });
}

/** Known path, other method. */
export function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({ error: 'method_not_allowed', message: t(lang(res), 'error.method') });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', message: t(lang(res), 'error.unknownSection') });
}

function codeForStatus(status: number): string {
  if (status === 401) return 'invalid_token';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'upstream_error';
  return 'invalid';
}

/** Every error in the protocol's shape: `{ error, message }`, plain text. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const l = lang(res);
  const send = (status: number, error: string, message?: string) =>
    res.status(status).json({ error, ...(message ? { message } : {}) });

  if (err instanceof AdminError) return void send(err.status, err.code, err.userMessage);
  if (err instanceof ApiError) {
    return void send(err.status, codeForStatus(err.status), translateApiError(l, err.message));
  }
  if (err instanceof ZodError) {
    const details = err.issues
      .map((i) => {
        const message = translateApiError(l, i.message);
        return i.path.length ? `${i.path.join('.')}: ${message}` : message;
      })
      .join('; ');
    return void send(422, 'invalid', t(l, 'error.invalidInput', { details }));
  }
  if (err instanceof DeployError) return void send(422, 'deploy_failed', err.message);

  const e = err as { type?: string; code?: number };
  if (e?.type === 'entity.parse.failed') return void send(400, 'invalid', t(l, 'error.badRequest'));
  if (e?.type === 'entity.too.large') return void send(413, 'too_large', t(l, 'error.tooLarge'));
  if (e?.code === 11000) return void send(409, 'conflict', t(l, 'error.conflict'));

  console.error('[kosmy-board] admin API error:', err);
  send(500, 'server_error', t(l, 'error.server'));
}
