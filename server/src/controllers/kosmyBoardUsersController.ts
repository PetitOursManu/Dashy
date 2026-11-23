import type { NextFunction, Request, Response } from 'express';
import { t, type Lang } from '../services/kosmyBoard/adminI18n.js';
import {
  DEFAULT_ROLE,
  SUB_RE,
  USERS_PROTOCOL,
  UsersApiError,
  disableBoardUser,
  exposedApps,
  fields,
  linkedAccounts,
  provisionBoardUser,
  roles,
  type ProvisionInput,
} from '../services/kosmyBoard/users.js';
import { AdminError, type AdminContext } from './kosmyBoardAdminSections.js';
import { errorHandler as adminErrorHandler } from './kosmyBoardAdminController.js';

/**
 * "Users managed by the Board" — protocol kosmy.board-users.v1 (Kosmy Board
 * `docs/users-api.md`). The Board's SERVER calls, with the same one-request
 * token as the admin in the Board (`kb-admin+jwt`, bound to method and path):
 *
 * - GET    /api/kosmy-board/users         roles, restrictions, linked accounts
 * - PUT    /api/kosmy-board/users/:sub    create / link / update that person's account
 * - DELETE /api/kosmy-board/users/:sub    disable it
 *
 * The token's `sub` is the person who acts: authenticated by the admin API's
 * `authenticate` (linked, active Dashy administrator). The `sub` of the
 * address is only the person managed: it grants nothing.
 */

function lang(res: Response): Lang {
  return (res.locals.kbLang as Lang | undefined) ?? 'en';
}

function actorSub(res: Response): string {
  // The admin's own Board `sub`: `authenticate` found the account by it.
  return (res.locals.kbAdmin as AdminContext).user.kosmySub as string;
}

function targetSub(req: Request, res: Response): string {
  const sub = req.params.sub;
  if (!SUB_RE.test(sub)) throw new AdminError(404, 'not_found', t(lang(res), 'usersApi.notFound'));
  return sub;
}

/** GET /api/kosmy-board/users */
export async function describe(_req: Request, res: Response): Promise<void> {
  const l = lang(res);
  const apps = await exposedApps();
  res.json({
    protocol: USERS_PROTOCOL,
    roles: roles(l),
    defaultRole: DEFAULT_ROLE,
    fields: fields(l, apps),
    users: await linkedAccounts(apps),
  });
}

/** PUT /api/kosmy-board/users/:sub */
export async function put(req: Request, res: Response): Promise<void> {
  const l = lang(res);
  const sub = targetSub(req, res);
  const body = req.body as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AdminError(400, 'invalid', t(l, 'error.badRequest'));
  }
  const { status, user } = await provisionBoardUser(sub, body as ProvisionInput, {
    actorSub: actorSub(res),
    atLogin: false,
    lang: l,
  });
  console.info(`[kosmy-board] users: ${status} ${user.email} (${user.role})`);
  res.json({
    ok: true,
    status,
    account: user.email,
    message: t(l, `usersApi.${status}`, { account: user.email }),
  });
}

/** DELETE /api/kosmy-board/users/:sub */
export async function remove(req: Request, res: Response): Promise<void> {
  const l = lang(res);
  const sub = targetSub(req, res);
  const done = await disableBoardUser(sub, actorSub(res));
  res.json({ ok: true, message: t(l, done ? 'usersApi.disabled' : 'usersApi.nothing') });
}

export function methodNotAllowed(_req: Request, res: Response): void {
  res.status(405).json({ error: 'method_not_allowed', message: t(lang(res), 'error.method') });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', message: t(lang(res), 'usersApi.notFound') });
}

/** The admin API's error format, plus this API's own refusals (409, 422). */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof UsersApiError) {
    res.status(err.status).json({ error: err.code, message: t(lang(res), err.key, err.vars) });
    return;
  }
  adminErrorHandler(err, req, res, next);
}
