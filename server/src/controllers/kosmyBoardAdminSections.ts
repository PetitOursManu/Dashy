import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env, ssoEnabled } from '../config/env.js';
import { User, type UserDoc, type UserRole } from '../models/User.js';
import { HostedApp } from '../models/HostedApp.js';
import { ProjectRequest } from '../models/ProjectRequest.js';
import { ChatAlert } from '../models/ChatAlert.js';
import { getKosmyBoardConfig } from '../models/KosmyBoardConfig.js';
import type { JwtPayload } from '../utils/jwt.js';
import { invokeHandler } from '../utils/invokeHandler.js';
import { baseUrl, initiateLoginUri, redirectUri } from '../services/kosmyBoard/oidc.js';
import { DEFAULT_MODELS } from '../services/chatProvider.js';
import type { ChatProvider } from '../models/ChatConfig.js';
import { t, type Lang } from '../services/kosmyBoard/adminI18n.js';
import * as users from './usersController.js';
import * as stats from './statsController.js';
import * as apps from './appsController.js';
import * as share from './shareController.js';
import * as requests from './requestsController.js';
import * as notifications from './notificationsController.js';
import * as chat from './chatController.js';
import * as store from './storeController.js';
import * as kosmy from './kosmyBoardController.js';

/**
 * "Admin in Kosmy Board" (kosmy.board-admin.v1) — the sections Dashy shows in
 * the Board, and the actions the Board sends back.
 *
 * Every action runs the very handler of Dashy's own admin API (through
 * `invokeHandler`: same Zod schema, same rules, same side effects, same
 * activity log). This file only describes screens and maps form values to
 * those handlers' bodies. Existing secrets (passwords, API keys, tokens,
 * client secret) are never returned: password fields are write-only, and a
 * new secret is shown once with `reveal`.
 */

/* ------------------------------ protocol types ----------------------------- */

type NoticeTone = 'info' | 'success' | 'warning' | 'danger';
type CellTone = 'success' | 'warning' | 'danger' | 'muted';
type Cell = string | number | boolean | null | { text: string; tone?: CellTone; href?: string };

interface Option {
  value: string;
  label: string;
}

interface Field {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'url' | 'number' | 'password' | 'select' | 'checkbox';
  value?: string | number | boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: Option[];
}

interface ActionDef {
  id: string;
  label: string;
  description?: string;
  danger?: boolean;
  confirm?: string;
  fields?: Field[];
}

interface Row {
  id: string;
  cells: Record<string, Cell>;
  actions?: string[];
}

type Block =
  | { type: 'notice'; tone?: NoticeTone; title?: string; text: string }
  | { type: 'stats'; title?: string; items: { label: string; value: string | number; hint?: string }[] }
  | { type: 'fields'; title?: string; items: { label: string; value: string | number }[] }
  | {
      type: 'form';
      id: string;
      title?: string;
      description?: string;
      action: string;
      submit?: string;
      fields: Field[];
    }
  | {
      type: 'table';
      id: string;
      title?: string;
      columns: { key: string; label: string }[];
      rows: Row[];
      rowActions?: ActionDef[];
      actions?: ActionDef[];
      empty?: string;
    }
  | { type: 'actions'; title?: string; items: ActionDef[] };

export interface Section {
  id: string;
  title: string;
  description?: string;
  blocks: Block[];
}

export interface ActionBody {
  action: string;
  row?: string;
  values: Record<string, unknown>;
}

export interface ActionResult {
  message?: string;
  reveal?: { label: string; value: string };
}

/** A protocol error: `{ error: code, message }` with this HTTP status. */
export class AdminError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage?: string,
  ) {
    super(userMessage ?? code);
    this.name = 'AdminError';
  }
}

export interface AdminContext {
  /** The Dashy account linked to the Board account (an administrator). */
  user: UserDoc;
  /** `req.user` as Dashy's own admin routes see it. */
  actor: JwtPayload;
  lang: Lang;
}

interface SectionDef {
  id: string;
  titleKey: string;
  build(ctx: AdminContext): Promise<Section>;
  act(ctx: AdminContext, body: ActionBody): Promise<ActionResult>;
}

/* --------------------------------- helpers --------------------------------- */

const MAX_ROWS = 500;
const MAX_OPTIONS = 200;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Dashy's version, from server/package.json (same depth from src/ and dist/). */
export const DASHY_VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
})();

function base(): string {
  return baseUrl(env.APP_ORIGIN);
}

function locale(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : 'en-GB';
}

function fmtDate(lang: Lang, d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale(lang), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function fmtBytes(lang: Lang, bytes: number): string {
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go', 'To'] : ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v);
  return `${n} ${units[i]}`;
}

function yesNo(lang: Lang, v: boolean): string {
  return t(lang, v ? 'common.yes' : 'common.no');
}

/** Keep only what identifies a remote catalogue (drop any credentials/query). */
function displayLocation(type: string, location: string): string {
  if (type !== 'remote') return location;
  try {
    const u = new URL(location);
    return `${u.origin}${u.pathname}`;
  } catch {
    return location;
  }
}

/** A random password shown once to the admin (passes Dashy's 8+ chars rule). */
function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

function str(values: Record<string, unknown>, name: string): string {
  const v = values[name];
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

/** A number field: a number, or a numeric string. Empty → undefined. */
function num(values: Record<string, unknown>, name: string): number | undefined {
  const v = values[name];
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.NaN;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.trim());
  return undefined;
}

function bool(values: Record<string, unknown>, name: string): boolean {
  return values[name] === true || values[name] === 'true';
}

function invalid(lang: Lang, key: string): never {
  throw new AdminError(422, 'invalid', t(lang, key));
}

function requireRow(ctx: AdminContext, body: ActionBody): string {
  if (!body.row || !mongoose.isValidObjectId(body.row)) {
    throw new AdminError(404, 'not_found', t(ctx.lang, 'error.rowNotFound'));
  }
  return body.row;
}

function unknownAction(ctx: AdminContext): never {
  throw new AdminError(404, 'not_found', t(ctx.lang, 'error.unknownAction'));
}

/** The row exists but this action is not offered for it (any more). */
function notAvailable(ctx: AdminContext): never {
  throw new AdminError(409, 'not_available', t(ctx.lang, 'error.notAvailable'));
}

const call = <T = Record<string, unknown>>(
  ctx: AdminContext,
  handler: Parameters<typeof invokeHandler>[0],
  opts: Omit<Parameters<typeof invokeHandler>[1], 'user'> = {},
) => invokeHandler<T>(handler, { ...opts, user: ctx.actor }).then((r) => r.body);

/* --------------------------------- overview -------------------------------- */

interface OverviewBody {
  totalApps: number;
  totalUsers: number;
  totalOpens: number;
  opensByMonth: { label: string; count: number }[];
  topApps: { id: string; name: string; slug: string; openCount: number }[];
}

const overview: SectionDef = {
  id: 'overview',
  titleKey: 'section.overview',
  async build(ctx) {
    const { lang } = ctx;
    const [ov, storage, activity, pendingRequests, openAlerts, kosmyCfg] = await Promise.all([
      call<OverviewBody>(ctx, stats.overview),
      call<{ total: number }>(ctx, stats.storage),
      call<{ activities: { id: string; actorEmail: string; message: string; at: string }[] }>(
        ctx,
        stats.recentActivity,
      ),
      ProjectRequest.countDocuments({ status: 'pending', archived: { $ne: true } }),
      ChatAlert.countDocuments({ acknowledged: false }),
      getKosmyBoardConfig(),
    ]);

    const blocks: Block[] = [];
    if (openAlerts > 0) {
      blocks.push({
        type: 'notice',
        tone: 'warning',
        title: t(lang, 'overview.alertsTitle'),
        text: t(lang, 'overview.alertsText', { n: openAlerts }),
      });
    }
    if (pendingRequests > 0) {
      blocks.push({
        type: 'notice',
        tone: 'info',
        title: t(lang, 'overview.requestsTitle'),
        text: t(lang, 'overview.requestsText', { n: pendingRequests }),
      });
    }

    blocks.push({
      type: 'stats',
      title: t(lang, 'overview.glance'),
      items: [
        { label: t(lang, 'overview.apps'), value: ov.totalApps },
        { label: t(lang, 'overview.users'), value: ov.totalUsers },
        { label: t(lang, 'overview.opens'), value: ov.totalOpens },
        { label: t(lang, 'overview.storage'), value: fmtBytes(lang, storage.total) },
        { label: t(lang, 'overview.pendingRequests'), value: pendingRequests },
      ],
    });

    // The handler returns the last 6 months, oldest first, ending this month.
    const month = new Intl.DateTimeFormat(locale(lang), { month: 'short', year: 'numeric' });
    const first = new Date();
    first.setDate(1);
    first.setMonth(first.getMonth() - (ov.opensByMonth.length - 1));
    blocks.push({
      type: 'stats',
      title: t(lang, 'overview.opensByMonth'),
      items: ov.opensByMonth.map((m, i) => {
        const d = new Date(first);
        d.setMonth(first.getMonth() + i);
        return { label: month.format(d), value: m.count };
      }),
    });

    blocks.push({
      type: 'fields',
      title: t(lang, 'overview.instance'),
      items: [
        { label: t(lang, 'overview.address'), value: base() },
        { label: t(lang, 'overview.version'), value: DASHY_VERSION || '—' },
        { label: 'Node.js', value: process.version },
        { label: t(lang, 'overview.registration'), value: yesNo(lang, env.ALLOW_REGISTRATION) },
        { label: t(lang, 'overview.maxUpload'), value: fmtBytes(lang, env.MAX_UPLOAD_MB * 1024 * 1024) },
        { label: t(lang, 'overview.dashySso'), value: yesNo(lang, ssoEnabled) },
        { label: t(lang, 'overview.kosmyIssuer'), value: kosmyCfg.issuer || '—' },
      ],
    });

    blocks.push({
      type: 'table',
      id: 'top-apps',
      title: t(lang, 'overview.topApps'),
      columns: [
        { key: 'name', label: t(lang, 'col.app') },
        { key: 'opens', label: t(lang, 'col.opens') },
      ],
      rows: ov.topApps.map((a) => ({
        id: a.id,
        cells: { name: { text: a.name, href: `${base()}/hosted/${a.slug}/` }, opens: a.openCount },
      })),
      empty: t(lang, 'apps.empty'),
    });

    blocks.push({
      type: 'table',
      id: 'activity',
      title: t(lang, 'overview.activity'),
      columns: [
        { key: 'at', label: t(lang, 'col.when') },
        { key: 'who', label: t(lang, 'col.who') },
        { key: 'what', label: t(lang, 'col.what') },
      ],
      rows: activity.activities.map((a) => ({
        id: a.id,
        cells: { at: fmtDate(lang, a.at), who: a.actorEmail, what: a.message },
      })),
      empty: t(lang, 'overview.noActivity'),
    });

    return { id: this.id, title: t(lang, this.titleKey), blocks };
  },
  async act(ctx) {
    unknownAction(ctx);
  },
};

/* ---------------------------------- users ---------------------------------- */

type UserRow = Pick<
  UserDoc,
  | 'id'
  | 'email'
  | 'fullName'
  | 'nickname'
  | 'role'
  | 'expiresAt'
  | 'twoFactorEnabled'
  | 'kosmySub'
  | 'chatEnabled'
  | 'chatTimeoutUntil'
  | 'allowedApps'
  | 'createdAt'
>;

const USER_FIELDS =
  'email fullName nickname role expiresAt twoFactorEnabled kosmySub chatEnabled chatTimeoutUntil allowedApps createdAt';
const ROLES: UserRole[] = ['admin', 'subadmin', 'user', 'temp'];

function isTimedOut(u: UserRow): boolean {
  return Boolean(u.chatTimeoutUntil && u.chatTimeoutUntil.getTime() > Date.now());
}

/** What the Board offers for a user — rechecked when an action comes back. */
function userRowActions(ctx: AdminContext, u: UserRow, hasApps: boolean): string[] {
  const self = String(u.id) === ctx.actor.sub;
  const out: string[] = [];
  if (!self) {
    for (const r of ['admin', 'subadmin', 'user'] as const) if (u.role !== r) out.push(`make-${r}`);
    out.push(u.role === 'temp' ? 'extend' : 'make-temp');
    if ((u.role === 'user' || u.role === 'temp') && hasApps) {
      out.push('grant-app');
      if (u.allowedApps.length > 0) out.push('revoke-app');
    }
    out.push('reset-password');
  }
  out.push(u.chatEnabled === false ? 'assistant-on' : 'assistant-off');
  out.push(isTimedOut(u) ? 'assistant-clear-timeout' : 'assistant-timeout');
  if (!self) out.push('notify', 'delete');
  return out;
}

function roleOptions(lang: Lang): Option[] {
  return ROLES.map((r) => ({ value: r, label: t(lang, `role.${r}`) }));
}

const usersSection: SectionDef = {
  id: 'users',
  titleKey: 'section.users',
  async build(ctx) {
    const { lang } = ctx;
    const [list, total, appList] = await Promise.all([
      User.find().sort({ createdAt: 1 }).limit(MAX_ROWS).select(USER_FIELDS),
      User.estimatedDocumentCount(),
      HostedApp.find().sort({ name: 1 }).limit(MAX_OPTIONS).select('name'),
    ]);
    const appOptions = appList.map((a) => ({ value: a.id as string, label: a.name }));
    const hasApps = appOptions.length > 0;
    const roleTone: Record<UserRole, CellTone> = {
      admin: 'success',
      subadmin: 'warning',
      user: 'muted',
      temp: 'muted',
    };

    const blocks: Block[] = [];
    if (total > MAX_ROWS) {
      blocks.push({ type: 'notice', tone: 'info', text: t(lang, 'common.truncated', { n: MAX_ROWS }) });
    }
    blocks.push({
      type: 'table',
      id: 'users',
      title: t(lang, 'users.accounts'),
      columns: [
        { key: 'email', label: t(lang, 'col.email') },
        { key: 'name', label: t(lang, 'col.name') },
        { key: 'role', label: t(lang, 'col.role') },
        { key: 'apps', label: t(lang, 'col.apps') },
        { key: 'twoFactor', label: t(lang, 'col.twoFactor') },
        { key: 'kosmy', label: t(lang, 'col.kosmy') },
        { key: 'assistant', label: t(lang, 'col.assistant') },
        { key: 'expires', label: t(lang, 'col.expires') },
        { key: 'created', label: t(lang, 'col.created') },
      ],
      rows: list.map((u) => {
        const self = String(u.id) === ctx.actor.sub;
        const name = u.fullName || u.nickname || '';
        const staff = u.role === 'admin' || u.role === 'subadmin';
        let assistant: Cell;
        if (u.chatEnabled === false) assistant = { text: t(lang, 'users.assistantOff'), tone: 'muted' };
        else if (isTimedOut(u)) {
          assistant = {
            text: t(lang, 'users.assistantTimedOut', { date: fmtDate(lang, u.chatTimeoutUntil) }),
            tone: 'warning',
          };
        } else assistant = { text: t(lang, 'users.assistantOn'), tone: 'success' };
        return {
          id: String(u.id),
          cells: {
            email: u.email,
            name: self ? `${name || u.email} (${t(lang, 'common.you')})` : name,
            role: { text: t(lang, `role.${u.role}`), tone: roleTone[u.role] },
            apps: staff ? t(lang, 'users.allApps') : u.allowedApps.length,
            twoFactor: u.twoFactorEnabled,
            kosmy: typeof u.kosmySub === 'string' && u.kosmySub.length > 0,
            assistant,
            expires: u.role === 'temp' ? fmtDate(lang, u.expiresAt) : '',
            created: fmtDate(lang, u.createdAt),
          },
          actions: userRowActions(ctx, u, hasApps),
        };
      }),
      rowActions: [
        { id: 'make-admin', label: t(lang, 'users.makeAdmin'), confirm: t(lang, 'users.makeAdminConfirm') },
        { id: 'make-subadmin', label: t(lang, 'users.makeSubadmin') },
        { id: 'make-user', label: t(lang, 'users.makeUser') },
        {
          id: 'make-temp',
          label: t(lang, 'users.makeTemp'),
          fields: [durationField(lang)],
        },
        { id: 'extend', label: t(lang, 'users.extend'), fields: [durationField(lang)] },
        {
          id: 'grant-app',
          label: t(lang, 'users.grantApp'),
          fields: [{ name: 'app', label: t(lang, 'col.app'), type: 'select', required: true, options: appOptions }],
        },
        {
          id: 'revoke-app',
          label: t(lang, 'users.revokeApp'),
          fields: [{ name: 'app', label: t(lang, 'col.app'), type: 'select', required: true, options: appOptions }],
        },
        {
          id: 'reset-password',
          label: t(lang, 'users.resetPassword'),
          confirm: t(lang, 'users.resetPasswordConfirm'),
        },
        { id: 'assistant-on', label: t(lang, 'users.assistantEnable') },
        { id: 'assistant-off', label: t(lang, 'users.assistantDisable') },
        {
          id: 'assistant-timeout',
          label: t(lang, 'users.assistantTimeout'),
          fields: [
            {
              name: 'minutes',
              label: t(lang, 'users.minutes'),
              type: 'number',
              value: 60,
              required: true,
              min: 1,
              max: 60 * 24 * 30,
              step: 1,
            },
          ],
        },
        { id: 'assistant-clear-timeout', label: t(lang, 'users.assistantClearTimeout') },
        {
          id: 'notify',
          label: t(lang, 'users.notify'),
          fields: [messageField(lang)],
        },
        {
          id: 'delete',
          label: t(lang, 'common.delete'),
          danger: true,
          confirm: t(lang, 'users.deleteConfirm'),
        },
      ],
      actions: [
        {
          id: 'create',
          label: t(lang, 'users.create'),
          description: t(lang, 'users.createHelp'),
          fields: [
            { name: 'email', label: t(lang, 'col.email'), type: 'email', required: true, maxLength: 254 },
            { name: 'role', label: t(lang, 'col.role'), type: 'select', value: 'user', options: roleOptions(lang) },
            { ...durationField(lang), required: false, help: t(lang, 'users.durationHelp') },
            { name: 'chatEnabled', label: t(lang, 'users.assistantAccess'), type: 'checkbox', value: true },
          ],
        },
      ],
      empty: t(lang, 'users.empty'),
    });
    blocks.push({ type: 'notice', tone: 'info', text: t(lang, 'users.elsewhere') });
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      description: t(lang, 'users.description'),
      blocks,
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const v = body.values;

    if (body.action === 'create') {
      const role = str(v, 'role') || 'user';
      const password = generatePassword();
      const hours = num(v, 'durationHours');
      const { user } = await call<{ user: { email: string } }>(ctx, users.createUser, {
        schema: users.createUserSchema,
        body: {
          email: str(v, 'email').toLowerCase(),
          password,
          role,
          chatEnabled: v.chatEnabled === undefined ? true : bool(v, 'chatEnabled'),
          ...(role === 'temp' && hours !== undefined ? { durationHours: hours } : {}),
        },
      });
      return {
        message: t(lang, 'users.created', { email: user.email }),
        reveal: { label: t(lang, 'users.passwordFor', { email: user.email }), value: password },
      };
    }

    const id = requireRow(ctx, body);
    const target = await User.findById(id).select(USER_FIELDS);
    if (!target) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
    const hasApps = (await HostedApp.estimatedDocumentCount()) > 0;
    if (!userRowActions(ctx, target, hasApps).includes(body.action)) {
      if (!KNOWN_USER_ACTIONS.has(body.action)) unknownAction(ctx);
      notAvailable(ctx);
    }

    const update = (data: Record<string, unknown>) =>
      call(ctx, users.updateUser, { params: { id }, body: data, schema: users.updateUserSchema });

    switch (body.action) {
      case 'make-admin':
      case 'make-subadmin':
      case 'make-user': {
        const role = body.action.slice('make-'.length);
        await update({ role });
        return { message: t(lang, 'users.roleChanged', { email: target.email, role: t(lang, `role.${role}`) }) };
      }
      case 'make-temp':
        await update({ role: 'temp', durationHours: num(v, 'durationHours') });
        return { message: t(lang, 'users.roleChanged', { email: target.email, role: t(lang, 'role.temp') }) };
      case 'extend':
        await update({ durationHours: num(v, 'durationHours') });
        return { message: t(lang, 'users.extended', { email: target.email }) };
      case 'grant-app':
      case 'revoke-app': {
        const appId = str(v, 'app');
        if (!mongoose.isValidObjectId(appId) || !(await HostedApp.exists({ _id: appId }))) {
          invalid(lang, 'users.unknownApp');
        }
        const current = target.allowedApps.map(String);
        const has = current.includes(appId);
        if (body.action === 'grant-app' && has) invalid(lang, 'users.alreadyHasApp');
        if (body.action === 'revoke-app' && !has) invalid(lang, 'users.doesNotHaveApp');
        const allowedApps =
          body.action === 'grant-app' ? [...current, appId] : current.filter((a) => a !== appId);
        await update({ allowedApps });
        return { message: t(lang, 'users.appsUpdated', { email: target.email }) };
      }
      case 'reset-password': {
        const password = generatePassword();
        await update({ password });
        return {
          message: t(lang, 'users.passwordReset', { email: target.email }),
          reveal: { label: t(lang, 'users.passwordFor', { email: target.email }), value: password },
        };
      }
      case 'assistant-on':
      case 'assistant-off':
        await update({ chatEnabled: body.action === 'assistant-on' });
        return { message: t(lang, 'users.assistantUpdated', { email: target.email }) };
      case 'assistant-timeout':
      case 'assistant-clear-timeout':
        await call(ctx, users.setChatTimeout, {
          params: { id },
          schema: users.chatTimeoutSchema,
          body: { minutes: body.action === 'assistant-timeout' ? num(v, 'minutes') : null },
        });
        return { message: t(lang, 'users.assistantUpdated', { email: target.email }) };
      case 'notify':
        await call(ctx, notifications.createNotification, {
          schema: notifications.createNotificationSchema,
          body: { userId: id, message: str(v, 'message') },
        });
        return { message: t(lang, 'users.notified', { email: target.email }) };
      case 'delete':
        await call(ctx, users.deleteUser, { params: { id } });
        return { message: t(lang, 'users.deleted', { email: target.email }) };
      default:
        unknownAction(ctx);
    }
  },
};

const KNOWN_USER_ACTIONS = new Set([
  'make-admin',
  'make-subadmin',
  'make-user',
  'make-temp',
  'extend',
  'grant-app',
  'revoke-app',
  'reset-password',
  'assistant-on',
  'assistant-off',
  'assistant-timeout',
  'assistant-clear-timeout',
  'notify',
  'delete',
]);

function durationField(lang: Lang): Field {
  return {
    name: 'durationHours',
    label: t(lang, 'users.durationHours'),
    type: 'number',
    value: 24,
    required: true,
    min: 1,
    max: 24 * 365,
    step: 1,
  };
}

function messageField(lang: Lang): Field {
  return { name: 'message', label: t(lang, 'col.message'), type: 'textarea', required: true, maxLength: 1000 };
}

/* ----------------------------------- apps ---------------------------------- */

type AppRow = InstanceType<typeof HostedApp>;

function shareState(app: AppRow): 'none' | 'active' | 'expired' {
  if (!app.share?.token) return 'none';
  if (app.share.expiresAt && app.share.expiresAt.getTime() < Date.now()) return 'expired';
  return 'active';
}

function appRowActions(app: AppRow): string[] {
  const out = ['rename', 'describe', 'set-category'];
  out.push(shareState(app) === 'none' ? 'share' : 'unshare');
  if (app.versions.length > 0) out.push('rollback');
  out.push('delete');
  return out;
}

const appsSection: SectionDef = {
  id: 'apps',
  titleKey: 'section.apps',
  async build(ctx) {
    const { lang } = ctx;
    const [list, total] = await Promise.all([
      HostedApp.find().sort({ createdAt: -1 }).limit(MAX_ROWS),
      HostedApp.estimatedDocumentCount(),
    ]);
    const blocks: Block[] = [{ type: 'notice', tone: 'info', text: t(lang, 'apps.elsewhere') }];
    if (total > MAX_ROWS) {
      blocks.push({ type: 'notice', tone: 'info', text: t(lang, 'common.truncated', { n: MAX_ROWS }) });
    }
    blocks.push({
      type: 'table',
      id: 'apps',
      title: t(lang, 'apps.title'),
      columns: [
        { key: 'name', label: t(lang, 'col.name') },
        { key: 'category', label: t(lang, 'col.category') },
        { key: 'opens', label: t(lang, 'col.opens') },
        { key: 'lastOpened', label: t(lang, 'col.lastOpened') },
        { key: 'share', label: t(lang, 'col.share') },
        { key: 'versions', label: t(lang, 'col.versions') },
        { key: 'created', label: t(lang, 'col.created') },
      ],
      rows: list.map((a) => {
        const state = shareState(a);
        const shareCell: Cell =
          state === 'none'
            ? { text: t(lang, 'apps.notShared'), tone: 'muted' }
            : state === 'expired'
              ? { text: t(lang, 'apps.shareExpired'), tone: 'warning' }
              : {
                  text: a.share.expiresAt
                    ? t(lang, 'apps.sharedUntil', { date: fmtDate(lang, a.share.expiresAt) })
                    : t(lang, 'apps.shared'),
                  tone: 'success',
                };
        return {
          id: a.id as string,
          cells: {
            // External cards (Store installs) point elsewhere: same-origin links only.
            name: a.externalUrl ? a.name : { text: a.name, href: `${base()}/hosted/${a.slug}/` },
            category: a.category ?? '',
            opens: a.openCount,
            lastOpened: fmtDate(lang, a.lastOpenedAt),
            share: shareCell,
            versions: a.versions.length,
            created: fmtDate(lang, a.createdAt),
          },
          actions: appRowActions(a),
        };
      }),
      rowActions: [
        {
          id: 'rename',
          label: t(lang, 'apps.rename'),
          fields: [{ name: 'name', label: t(lang, 'col.name'), type: 'text', required: true, maxLength: 120 }],
        },
        {
          id: 'describe',
          label: t(lang, 'apps.describe'),
          fields: [
            {
              name: 'description',
              label: t(lang, 'col.description'),
              type: 'textarea',
              maxLength: 2000,
              help: t(lang, 'apps.describeHelp'),
            },
          ],
        },
        {
          id: 'set-category',
          label: t(lang, 'apps.setCategory'),
          fields: [
            {
              name: 'category',
              label: t(lang, 'col.category'),
              type: 'text',
              maxLength: 40,
              help: t(lang, 'apps.categoryHelp'),
            },
          ],
        },
        {
          id: 'share',
          label: t(lang, 'apps.share'),
          fields: [
            {
              name: 'password',
              label: t(lang, 'apps.sharePassword'),
              type: 'password',
              help: t(lang, 'apps.sharePasswordHelp'),
            },
            {
              name: 'expiresInDays',
              label: t(lang, 'apps.shareDays'),
              type: 'number',
              min: 1,
              max: 365,
              step: 1,
              help: t(lang, 'apps.shareDaysHelp'),
            },
          ],
        },
        { id: 'unshare', label: t(lang, 'apps.unshare'), confirm: t(lang, 'apps.unshareConfirm') },
        { id: 'rollback', label: t(lang, 'apps.rollback'), confirm: t(lang, 'apps.rollbackConfirm') },
        { id: 'delete', label: t(lang, 'common.delete'), danger: true, confirm: t(lang, 'apps.deleteConfirm') },
      ],
      empty: t(lang, 'apps.empty'),
    });
    return { id: this.id, title: t(lang, this.titleKey), blocks };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const v = body.values;
    const id = requireRow(ctx, body);
    const app = await HostedApp.findById(id);
    if (!app) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
    if (!appRowActions(app).includes(body.action)) {
      if (!['rename', 'describe', 'set-category', 'share', 'unshare', 'rollback', 'delete'].includes(body.action)) {
        unknownAction(ctx);
      }
      notAvailable(ctx);
    }
    const update = (data: Record<string, unknown>) =>
      call(ctx, apps.updateApp, { params: { id }, body: data });

    switch (body.action) {
      case 'rename':
        await update({ name: str(v, 'name') });
        return { message: t(lang, 'apps.saved') };
      case 'describe':
        await update({ description: str(v, 'description') });
        return { message: t(lang, 'apps.saved') };
      case 'set-category':
        await update({ category: str(v, 'category') });
        return { message: t(lang, 'apps.saved') };
      case 'share': {
        const days = num(v, 'expiresInDays');
        const { app: shared } = await call<{ app: { share: { url: string } | null } }>(ctx, share.createShare, {
          params: { id },
          schema: share.shareSchema,
          body: { password: typeof v.password === 'string' ? v.password : '', expiresInDays: days ?? null },
        });
        const url = shared.share ? `${base()}${shared.share.url}` : '';
        return {
          message: t(lang, 'apps.sharedOk', { name: app.name }),
          ...(url ? { reveal: { label: t(lang, 'apps.shareLink'), value: url } } : {}),
        };
      }
      case 'unshare':
        await call(ctx, share.revokeShare, { params: { id } });
        return { message: t(lang, 'apps.unshared', { name: app.name }) };
      case 'rollback':
        await call(ctx, apps.rollbackVersion, { params: { id, vid: app.versions[0].vid } });
        return { message: t(lang, 'apps.rolledBack', { name: app.name }) };
      case 'delete':
        await call(ctx, apps.deleteApp, { params: { id } });
        return { message: t(lang, 'apps.deleted', { name: app.name }) };
      default:
        unknownAction(ctx);
    }
  },
};

/* --------------------------------- requests -------------------------------- */

interface RequestJson {
  id: string;
  userEmail: string;
  kind: 'idea' | 'file';
  message: string;
  status: 'pending' | 'resolved' | 'dismissed';
  archived?: boolean;
  createdAt: string;
}

function requestRowActions(r: Pick<RequestJson, 'status' | 'archived'>): string[] {
  if (r.archived) return ['unarchive'];
  const out = ['reply'];
  if (r.status !== 'resolved') out.push('resolve');
  if (r.status === 'pending') out.push('dismiss');
  if (r.status !== 'pending') out.push('reopen');
  out.push('archive');
  return out;
}

const requestsSection: SectionDef = {
  id: 'requests',
  titleKey: 'section.requests',
  async build(ctx) {
    const { lang } = ctx;
    const [open, archived] = await Promise.all([
      call<{ requests: RequestJson[] }>(ctx, requests.listAdminRequests, { query: { status: 'all' } }),
      call<{ requests: RequestJson[] }>(ctx, requests.listAdminRequests, { query: { status: 'archived' } }),
    ]);
    const statusTone: Record<RequestJson['status'], CellTone> = {
      pending: 'warning',
      resolved: 'success',
      dismissed: 'muted',
    };
    const columns = [
      { key: 'from', label: t(lang, 'col.from') },
      { key: 'kind', label: t(lang, 'col.kind') },
      { key: 'message', label: t(lang, 'col.message') },
      { key: 'status', label: t(lang, 'col.status') },
      { key: 'date', label: t(lang, 'col.date') },
    ];
    const toRow = (r: RequestJson): Row => ({
      id: r.id,
      cells: {
        from: r.userEmail,
        kind: t(lang, `requests.kind.${r.kind}`),
        message: r.message,
        status: { text: t(lang, `requests.status.${r.status}`), tone: statusTone[r.status] },
        date: fmtDate(lang, r.createdAt),
      },
      actions: requestRowActions(r),
    });
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      description: t(lang, 'requests.description'),
      blocks: [
        {
          type: 'table',
          id: 'requests',
          title: t(lang, 'requests.open'),
          columns,
          rows: open.requests.map(toRow),
          rowActions: [
            {
              id: 'reply',
              label: t(lang, 'requests.reply'),
              description: t(lang, 'requests.replyHelp'),
              fields: [messageField(lang)],
            },
            { id: 'resolve', label: t(lang, 'requests.resolve') },
            { id: 'dismiss', label: t(lang, 'requests.dismiss') },
            { id: 'reopen', label: t(lang, 'requests.reopen') },
            { id: 'archive', label: t(lang, 'requests.archive') },
          ],
          empty: t(lang, 'requests.empty'),
        },
        {
          type: 'table',
          id: 'archived',
          title: t(lang, 'requests.archived'),
          columns,
          rows: archived.requests.map(toRow),
          rowActions: [{ id: 'unarchive', label: t(lang, 'requests.unarchive') }],
          empty: t(lang, 'requests.emptyArchived'),
        },
      ],
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const id = requireRow(ctx, body);
    const request = await ProjectRequest.findById(id).select('status archived');
    if (!request) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
    if (!requestRowActions(request).includes(body.action)) {
      if (!['reply', 'resolve', 'dismiss', 'reopen', 'archive', 'unarchive'].includes(body.action)) {
        unknownAction(ctx);
      }
      notAvailable(ctx);
    }
    const params = { id };
    switch (body.action) {
      case 'reply':
        await call(ctx, requests.replyToRequest, {
          params,
          schema: requests.replyRequestSchema,
          body: { message: str(body.values, 'message') },
        });
        return { message: t(lang, 'requests.replied') };
      case 'resolve':
      case 'dismiss':
      case 'reopen': {
        const status = { resolve: 'resolved', dismiss: 'dismissed', reopen: 'pending' }[body.action];
        await call(ctx, requests.setRequestStatus, { params, schema: requests.requestStatusSchema, body: { status } });
        return { message: t(lang, 'requests.updated') };
      }
      case 'archive':
      case 'unarchive':
        await call(ctx, requests.archiveRequest, {
          params,
          schema: requests.archiveRequestSchema,
          body: { archived: body.action === 'archive' },
        });
        return { message: t(lang, 'requests.updated') };
      default:
        unknownAction(ctx);
    }
  },
};

/* ------------------------------ notifications ------------------------------ */

interface NotificationJson {
  id: string;
  userEmail: string;
  kind: string;
  message: string;
  createdByEmail: string;
  readAt: string | null;
  createdAt: string;
}

const notificationsSection: SectionDef = {
  id: 'notifications',
  titleKey: 'section.notifications',
  async build(ctx) {
    const { lang } = ctx;
    const [{ notifications: list }, recipients] = await Promise.all([
      call<{ notifications: NotificationJson[] }>(ctx, notifications.listAdminNotifications),
      User.find().sort({ email: 1 }).limit(MAX_OPTIONS).select('email'),
    ]);
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      description: t(lang, 'notifications.description'),
      blocks: [
        {
          type: 'table',
          id: 'notifications',
          title: t(lang, 'notifications.sent'),
          columns: [
            { key: 'to', label: t(lang, 'col.to') },
            { key: 'message', label: t(lang, 'col.message') },
            { key: 'by', label: t(lang, 'col.who') },
            { key: 'sent', label: t(lang, 'col.date') },
            { key: 'read', label: t(lang, 'col.read') },
          ],
          rows: list.map((n) => ({
            id: n.id,
            cells: {
              to: n.userEmail,
              message: n.message,
              by: n.createdByEmail,
              sent: fmtDate(lang, n.createdAt),
              read: n.readAt
                ? { text: fmtDate(lang, n.readAt), tone: 'success' }
                : { text: t(lang, 'notifications.unread'), tone: 'muted' },
            },
            actions: ['dismiss'],
          })),
          rowActions: [{ id: 'dismiss', label: t(lang, 'notifications.dismiss') }],
          actions: [
            {
              id: 'send',
              label: t(lang, 'notifications.send'),
              fields: [
                {
                  name: 'user',
                  label: t(lang, 'col.to'),
                  type: 'select',
                  required: true,
                  options: recipients.map((u) => ({ value: u.id as string, label: u.email })),
                },
                messageField(lang),
              ],
            },
          ],
          empty: t(lang, 'notifications.empty'),
        },
      ],
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    if (body.action === 'send') {
      await call(ctx, notifications.createNotification, {
        schema: notifications.createNotificationSchema,
        body: { userId: str(body.values, 'user'), message: str(body.values, 'message') },
      });
      return { message: t(lang, 'notifications.sentOk') };
    }
    if (body.action === 'dismiss') {
      await call(ctx, notifications.dismissNotification, { params: { id: requireRow(ctx, body) } });
      return { message: t(lang, 'notifications.dismissed') };
    }
    unknownAction(ctx);
  },
};

/* -------------------------------- assistant -------------------------------- */

const PROVIDER_LABELS: Record<ChatProvider, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  claude: 'Claude (Anthropic)',
  ollama: 'Ollama Cloud',
};

interface ChatConfigJson {
  config: { enabled: boolean; provider: ChatProvider; model: string; hasApiKey: boolean };
  providers: ChatProvider[];
}

const assistantSection: SectionDef = {
  id: 'assistant',
  titleKey: 'section.assistant',
  async build(ctx) {
    const { lang } = ctx;
    const [{ config, providers }, { alerts }] = await Promise.all([
      call<ChatConfigJson>(ctx, chat.getConfig),
      call<{ alerts: { id: string; userEmail: string; messages: string[]; createdAt: string }[] }>(
        ctx,
        chat.listAlerts,
      ),
    ]);
    const blocks: Block[] = [];
    if (!config.enabled) {
      blocks.push({ type: 'notice', tone: 'info', text: t(lang, 'assistant.off') });
    }
    blocks.push({
      type: 'form',
      id: 'assistant',
      title: t(lang, 'assistant.settings'),
      description: t(lang, 'assistant.settingsHelp'),
      action: 'save-assistant',
      submit: t(lang, 'common.save'),
      fields: [
        { name: 'enabled', label: t(lang, 'assistant.enabled'), type: 'checkbox', value: config.enabled },
        {
          name: 'provider',
          label: t(lang, 'assistant.provider'),
          type: 'select',
          value: config.provider,
          options: providers.map((p) => ({ value: p, label: PROVIDER_LABELS[p] ?? p })),
        },
        {
          name: 'model',
          label: t(lang, 'assistant.model'),
          type: 'text',
          value: config.model,
          maxLength: 120,
          help: t(lang, 'assistant.modelHelp', {
            models: providers.map((p) => `${PROVIDER_LABELS[p] ?? p}: ${DEFAULT_MODELS[p]}`).join(', '),
          }),
        },
        {
          name: 'apiKey',
          label: t(lang, 'assistant.apiKey'),
          type: 'password',
          placeholder: t(lang, config.hasApiKey ? 'common.unchanged' : 'common.notSet'),
          help: t(lang, 'assistant.apiKeyHelp'),
        },
      ],
    });
    blocks.push({
      type: 'actions',
      title: t(lang, 'assistant.tools'),
      items: [
        { id: 'test', label: t(lang, 'assistant.test'), description: t(lang, 'assistant.testHelp') },
        ...(config.hasApiKey
          ? [
              {
                id: 'clear-key',
                label: t(lang, 'assistant.clearKey'),
                danger: true,
                confirm: t(lang, 'assistant.clearKeyConfirm'),
              },
            ]
          : []),
      ],
    });
    blocks.push({
      type: 'table',
      id: 'alerts',
      title: t(lang, 'assistant.alerts'),
      columns: [
        { key: 'user', label: t(lang, 'col.who') },
        { key: 'messages', label: t(lang, 'assistant.flagged') },
        { key: 'date', label: t(lang, 'col.date') },
      ],
      rows: alerts.map((a) => ({
        id: a.id,
        cells: { user: a.userEmail, messages: a.messages.join(' · '), date: fmtDate(lang, a.createdAt) },
        actions: ['ack'],
      })),
      rowActions: [{ id: 'ack', label: t(lang, 'assistant.ack') }],
      empty: t(lang, 'assistant.noAlerts'),
    });
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      description: t(lang, 'assistant.description'),
      blocks,
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const v = body.values;
    switch (body.action) {
      case 'save-assistant': {
        const apiKey = typeof v.apiKey === 'string' ? v.apiKey.trim() : '';
        await call(ctx, chat.updateConfig, {
          schema: chat.updateConfigSchema,
          body: {
            enabled: bool(v, 'enabled'),
            provider: str(v, 'provider'),
            model: str(v, 'model'),
            // Write-only: empty means "keep the current key".
            ...(apiKey ? { apiKey } : {}),
          },
        });
        return { message: t(lang, 'common.saved') };
      }
      case 'clear-key':
        await call(ctx, chat.updateConfig, {
          schema: chat.updateConfigSchema,
          body: { enabled: false, apiKey: '' },
        });
        return { message: t(lang, 'assistant.keyCleared') };
      case 'test': {
        const r = await call<{ ok: boolean; reply?: string; error?: string }>(ctx, chat.testConfig);
        if (!r.ok) {
          throw new AdminError(422, 'test_failed', t(lang, 'assistant.testFailed', { error: r.error ?? '' }));
        }
        return { message: t(lang, 'assistant.testOk', { reply: (r.reply ?? '').slice(0, 200) }) };
      }
      case 'ack':
        await call(ctx, chat.ackAlert, { params: { id: requireRow(ctx, body) } });
        return { message: t(lang, 'assistant.acked') };
      default:
        unknownAction(ctx);
    }
  },
};

/* ---------------------------------- store ---------------------------------- */

interface InstalledJson {
  id: string;
  name: string;
  type: 'tile' | 'deploy' | 'static';
  sourceName: string;
  installedVersion: string;
  deployDriver: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

interface CatalogJson {
  id: string;
  name: string;
  type: 'tile' | 'deploy' | 'static';
  version: string;
  source: string;
  installed: boolean;
  updateAvailable: boolean;
}

interface SourceJson {
  id: string;
  name: string;
  type: 'local' | 'remote';
  location: string;
  managed: boolean;
  enabled: boolean;
  lastError: string | null;
  cachedApps?: unknown[];
}

function installedRowActions(i: Pick<InstalledJson, 'type' | 'updateAvailable'>): string[] {
  const out: string[] = [];
  if (i.type === 'static' && i.updateAvailable) out.push('update');
  if (i.type === 'deploy') out.push('restart', 'redeploy');
  out.push('uninstall');
  return out;
}

/** Catalogue rows are keyed by (source, manifest id): pack both in the row id. */
function catalogRowId(source: string, id: string): string {
  return Buffer.from(JSON.stringify([source, id])).toString('base64url');
}

function parseCatalogRowId(row: string | undefined): [string, string] | null {
  if (!row) return null;
  try {
    const v = JSON.parse(Buffer.from(row, 'base64url').toString('utf8'));
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string')
      ? [v[0], v[1]]
      : null;
  } catch {
    return null;
  }
}

/** Only tile and static apps install in one click; deploys need the full form in Dashy. */
function catalogRowActions(a: Pick<CatalogJson, 'type' | 'installed'>): string[] {
  return !a.installed && (a.type === 'tile' || a.type === 'static') ? ['install'] : [];
}

const storeSection: SectionDef = {
  id: 'store',
  titleKey: 'section.store',
  async build(ctx) {
    const { lang } = ctx;
    const [{ installed }, { apps: catalog }, { sources }] = await Promise.all([
      call<{ installed: InstalledJson[] }>(ctx, store.listInstalled),
      call<{ apps: CatalogJson[] }>(ctx, store.listCatalog),
      call<{ sources: SourceJson[] }>(ctx, store.listSources),
    ]);
    const typeLabel = (type: string) => t(lang, `store.type.${type}`);
    const updates = installed.filter((i) => i.updateAvailable).length;

    const blocks: Block[] = [{ type: 'notice', tone: 'info', text: t(lang, 'store.elsewhere') }];
    if (updates > 0) {
      blocks.push({ type: 'notice', tone: 'warning', text: t(lang, 'store.updates', { n: updates }) });
    }
    blocks.push({
      type: 'table',
      id: 'installed',
      title: t(lang, 'store.installed'),
      columns: [
        { key: 'name', label: t(lang, 'col.name') },
        { key: 'type', label: t(lang, 'col.type') },
        { key: 'source', label: t(lang, 'col.source') },
        { key: 'version', label: t(lang, 'col.version') },
        { key: 'latest', label: t(lang, 'store.latest') },
        { key: 'driver', label: t(lang, 'store.driver') },
      ],
      rows: installed.slice(0, MAX_ROWS).map((i) => ({
        id: i.id,
        cells: {
          name: i.name,
          type: typeLabel(i.type),
          source: i.sourceName,
          version: i.installedVersion,
          latest: i.updateAvailable
            ? { text: i.latestVersion ?? '', tone: 'warning' }
            : (i.latestVersion ?? ''),
          driver: i.deployDriver ?? '',
        },
        actions: installedRowActions(i),
      })),
      rowActions: [
        { id: 'update', label: t(lang, 'store.update') },
        { id: 'restart', label: t(lang, 'store.restart'), description: t(lang, 'store.slowHelp') },
        {
          id: 'redeploy',
          label: t(lang, 'store.redeploy'),
          confirm: t(lang, 'store.redeployConfirm'),
          description: t(lang, 'store.slowHelp'),
        },
        { id: 'uninstall', label: t(lang, 'store.uninstall'), danger: true, confirm: t(lang, 'store.uninstallConfirm') },
      ],
      empty: t(lang, 'store.noInstalled'),
    });
    blocks.push({
      type: 'table',
      id: 'catalog',
      title: t(lang, 'store.catalog'),
      columns: [
        { key: 'name', label: t(lang, 'col.name') },
        { key: 'type', label: t(lang, 'col.type') },
        { key: 'source', label: t(lang, 'col.source') },
        { key: 'version', label: t(lang, 'col.version') },
        { key: 'state', label: t(lang, 'col.status') },
      ],
      rows: catalog.slice(0, MAX_ROWS).map((a) => ({
        id: catalogRowId(a.source, a.id),
        cells: {
          name: a.name,
          type: typeLabel(a.type),
          source: a.source,
          version: a.version,
          state: a.installed
            ? a.updateAvailable
              ? { text: t(lang, 'store.updateAvailable'), tone: 'warning' }
              : { text: t(lang, 'store.isInstalled'), tone: 'success' }
            : { text: t(lang, 'store.notInstalled'), tone: 'muted' },
        },
        actions: catalogRowActions(a),
      })),
      rowActions: [{ id: 'install', label: t(lang, 'store.install'), description: t(lang, 'store.installHelp') }],
      empty: t(lang, 'store.emptyCatalog'),
    });
    blocks.push({
      type: 'table',
      id: 'sources',
      title: t(lang, 'store.sources'),
      columns: [
        { key: 'name', label: t(lang, 'col.name') },
        { key: 'type', label: t(lang, 'col.type') },
        { key: 'location', label: t(lang, 'store.location') },
        { key: 'apps', label: t(lang, 'col.apps') },
        { key: 'enabled', label: t(lang, 'store.enabled') },
        { key: 'error', label: t(lang, 'store.lastError') },
      ],
      rows: sources.slice(0, MAX_ROWS).map((s) => ({
        id: s.id,
        cells: {
          name: s.managed ? `${s.name} (${t(lang, 'store.managed')})` : s.name,
          type: t(lang, `store.sourceType.${s.type}`),
          location: displayLocation(s.type, s.location),
          apps: s.cachedApps?.length ?? 0,
          enabled: s.enabled,
          error: s.lastError ? { text: s.lastError, tone: 'danger' } : '',
        },
        actions: [s.enabled ? 'disable-source' : 'enable-source', 'delete-source'],
      })),
      rowActions: [
        { id: 'enable-source', label: t(lang, 'store.enable') },
        { id: 'disable-source', label: t(lang, 'store.disable') },
        {
          id: 'delete-source',
          label: t(lang, 'common.delete'),
          danger: true,
          confirm: t(lang, 'store.deleteSourceConfirm'),
        },
      ],
      actions: [
        {
          id: 'add-source',
          label: t(lang, 'store.addSource'),
          fields: [
            { name: 'name', label: t(lang, 'col.name'), type: 'text', required: true, maxLength: 80 },
            {
              name: 'type',
              label: t(lang, 'col.type'),
              type: 'select',
              value: 'remote',
              options: [
                { value: 'remote', label: t(lang, 'store.sourceType.remote') },
                { value: 'local', label: t(lang, 'store.sourceType.local') },
              ],
            },
            {
              name: 'location',
              label: t(lang, 'store.location'),
              type: 'text',
              required: true,
              maxLength: 2000,
              help: t(lang, 'store.locationHelp'),
            },
            {
              name: 'ttlMinutes',
              label: t(lang, 'store.ttl'),
              type: 'number',
              value: 60,
              min: 0,
              max: 7 * 24 * 60,
              step: 1,
            },
          ],
        },
        {
          id: 'add-catalogue',
          label: t(lang, 'store.addCatalogue'),
          description: t(lang, 'store.addCatalogueHelp'),
          fields: [{ name: 'name', label: t(lang, 'col.name'), type: 'text', required: true, maxLength: 80 }],
        },
      ],
      empty: t(lang, 'store.noSources'),
    });
    blocks.push({
      type: 'actions',
      items: [
        { id: 'refresh-catalog', label: t(lang, 'store.refresh'), description: t(lang, 'store.refreshHelp') },
      ],
    });
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      description: t(lang, 'store.description'),
      blocks,
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const v = body.values;
    switch (body.action) {
      case 'update':
      case 'restart':
      case 'redeploy':
      case 'uninstall': {
        const id = requireRow(ctx, body);
        const { installed } = await call<{ installed: InstalledJson[] }>(ctx, store.listInstalled);
        const item = installed.find((i) => i.id === id);
        if (!item) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
        if (!installedRowActions(item).includes(body.action)) notAvailable(ctx);
        const params = { id };
        if (body.action === 'update') {
          await call(ctx, store.updateInstalled, { params });
          return { message: t(lang, 'store.updated', { name: item.name }) };
        }
        if (body.action === 'restart') {
          const r = await call<{ message?: string }>(ctx, store.restartApp, { params });
          return { message: r.message || t(lang, 'store.restarted', { name: item.name }) };
        }
        if (body.action === 'redeploy') {
          const r = await call<{ message?: string }>(ctx, store.redeployApp, {
            params,
            schema: store.redeploySchema,
            body: {},
          });
          return { message: r.message || t(lang, 'store.redeployed', { name: item.name }) };
        }
        await call(ctx, store.uninstallApp, { params });
        return { message: t(lang, 'store.uninstalled', { name: item.name }) };
      }
      case 'install': {
        const key = parseCatalogRowId(body.row);
        if (!key) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
        const { apps: catalog } = await call<{ apps: CatalogJson[] }>(ctx, store.listCatalog);
        const entry = catalog.find((a) => a.source === key[0] && a.id === key[1]);
        if (!entry) throw new AdminError(404, 'not_found', t(lang, 'error.rowNotFound'));
        if (!catalogRowActions(entry).includes('install')) notAvailable(ctx);
        await call(ctx, store.install, {
          schema: store.installSchema,
          body: { source: entry.source, manifestId: entry.id },
        });
        return { message: t(lang, 'store.installed.ok', { name: entry.name }) };
      }
      case 'enable-source':
      case 'disable-source':
        await call(ctx, store.updateSource, {
          params: { id: requireRow(ctx, body) },
          schema: store.updateSourceSchema,
          body: { enabled: body.action === 'enable-source' },
        });
        return { message: t(lang, 'common.saved') };
      case 'delete-source':
        await call(ctx, store.deleteSource, { params: { id: requireRow(ctx, body) } });
        return { message: t(lang, 'store.sourceDeleted') };
      case 'add-source': {
        const ttl = num(v, 'ttlMinutes');
        await call(ctx, store.createSource, {
          schema: store.createSourceSchema,
          body: {
            name: str(v, 'name'),
            type: str(v, 'type'),
            location: str(v, 'location'),
            ...(ttl !== undefined ? { ttlMinutes: ttl } : {}),
          },
        });
        return { message: t(lang, 'store.sourceAdded') };
      }
      case 'add-catalogue':
        await call(ctx, store.createManagedSource, {
          schema: store.createManagedSchema,
          body: { name: str(v, 'name') },
        });
        return { message: t(lang, 'store.sourceAdded') };
      case 'refresh-catalog':
        await call(ctx, store.refreshCatalog);
        return { message: t(lang, 'store.refreshed') };
      default:
        unknownAction(ctx);
    }
  },
};

/* --------------------------------- settings -------------------------------- */

interface StoreConfigJson {
  config: {
    coolifyEnabled: boolean;
    coolifyBaseUrl: string;
    hasCoolifyToken: boolean;
    coolifyProjectUuid: string;
    coolifyServerUuid: string;
    coolifyDestinationUuid: string;
    coolifyEnvUuid: string;
    portainerEnabled: boolean;
    portainerUrl: string;
    hasPortainerKey: boolean;
    portainerEndpointId: string;
    dockerEnabled: boolean;
    defaultDriver: string;
    wildcardEnabled: boolean;
    baseDomain: string;
  };
  drivers: { id: string; label: string }[];
}

interface KosmyConfigJson {
  config: { issuer: string; clientId: string; hasClientSecret: boolean; autoCreate: boolean; requireDashy2fa: boolean };
}

const settingsSection: SectionDef = {
  id: 'settings',
  titleKey: 'section.settings',
  async build(ctx) {
    const { lang } = ctx;
    const [{ config: s, drivers }, { config: k }] = await Promise.all([
      call<StoreConfigJson>(ctx, store.getConfig),
      call<KosmyConfigJson>(ctx, kosmy.getConfig),
    ]);
    const secret = (has: boolean) => t(lang, has ? 'common.unchanged' : 'common.notSet');
    const driverOptions: Option[] = [{ value: '', label: t(lang, 'settings.driverAuto') }];
    for (const d of drivers) driverOptions.push({ value: d.id, label: d.label });
    if (s.defaultDriver && !drivers.some((d) => d.id === s.defaultDriver)) {
      driverOptions.push({ value: s.defaultDriver, label: s.defaultDriver });
    }
    return {
      id: this.id,
      title: t(lang, this.titleKey),
      blocks: [
        {
          type: 'form',
          id: 'deploy',
          title: t(lang, 'settings.deploy'),
          description: t(lang, 'settings.deployHelp'),
          action: 'save-deploy',
          submit: t(lang, 'common.save'),
          fields: [
            { name: 'dockerEnabled', label: t(lang, 'settings.dockerEnabled'), type: 'checkbox', value: s.dockerEnabled },
            {
              name: 'defaultDriver',
              label: t(lang, 'settings.defaultDriver'),
              type: 'select',
              value: s.defaultDriver,
              options: driverOptions,
            },
            {
              name: 'wildcardEnabled',
              label: t(lang, 'settings.wildcardEnabled'),
              type: 'checkbox',
              value: s.wildcardEnabled,
            },
            {
              name: 'baseDomain',
              label: t(lang, 'settings.baseDomain'),
              type: 'text',
              value: s.baseDomain,
              maxLength: 255,
              placeholder: 'apps.example.com',
              help: t(lang, 'settings.baseDomainHelp'),
            },
          ],
        },
        {
          type: 'form',
          id: 'coolify',
          title: 'Coolify',
          action: 'save-coolify',
          submit: t(lang, 'common.save'),
          fields: [
            { name: 'coolifyEnabled', label: t(lang, 'settings.enabled'), type: 'checkbox', value: s.coolifyEnabled },
            { name: 'coolifyBaseUrl', label: t(lang, 'settings.url'), type: 'url', value: s.coolifyBaseUrl, maxLength: 2000 },
            {
              name: 'coolifyToken',
              label: t(lang, 'settings.apiToken'),
              type: 'password',
              placeholder: secret(s.hasCoolifyToken),
              help: t(lang, 'settings.secretHelp'),
            },
            { name: 'coolifyProjectUuid', label: t(lang, 'settings.projectUuid'), type: 'text', value: s.coolifyProjectUuid, maxLength: 200 },
            { name: 'coolifyServerUuid', label: t(lang, 'settings.serverUuid'), type: 'text', value: s.coolifyServerUuid, maxLength: 200 },
            {
              name: 'coolifyDestinationUuid',
              label: t(lang, 'settings.destinationUuid'),
              type: 'text',
              value: s.coolifyDestinationUuid,
              maxLength: 200,
            },
            { name: 'coolifyEnvUuid', label: t(lang, 'settings.envUuid'), type: 'text', value: s.coolifyEnvUuid, maxLength: 200 },
          ],
        },
        {
          type: 'form',
          id: 'portainer',
          title: 'Portainer',
          action: 'save-portainer',
          submit: t(lang, 'common.save'),
          fields: [
            { name: 'portainerEnabled', label: t(lang, 'settings.enabled'), type: 'checkbox', value: s.portainerEnabled },
            { name: 'portainerUrl', label: t(lang, 'settings.url'), type: 'url', value: s.portainerUrl, maxLength: 2000 },
            {
              name: 'portainerKey',
              label: t(lang, 'settings.apiKey'),
              type: 'password',
              placeholder: secret(s.hasPortainerKey),
              help: t(lang, 'settings.secretHelp'),
            },
            {
              name: 'portainerEndpointId',
              label: t(lang, 'settings.endpointId'),
              type: 'text',
              value: s.portainerEndpointId,
              maxLength: 200,
            },
          ],
        },
        {
          type: 'fields',
          title: t(lang, 'settings.kosmy'),
          items: [
            { label: t(lang, 'settings.issuer'), value: k.issuer || '—' },
            { label: t(lang, 'settings.clientId'), value: k.clientId || '—' },
            { label: t(lang, 'settings.clientSecret'), value: t(lang, k.hasClientSecret ? 'common.set' : 'common.notSet') },
            { label: t(lang, 'settings.redirectUri'), value: redirectUri(base()) },
            { label: t(lang, 'settings.initiateUri'), value: initiateLoginUri(base()) },
          ],
        },
        {
          type: 'form',
          id: 'kosmy',
          action: 'save-kosmy',
          submit: t(lang, 'common.save'),
          description: t(lang, 'settings.kosmyHelp'),
          fields: [
            {
              name: 'autoCreate',
              label: t(lang, 'settings.autoCreate'),
              type: 'checkbox',
              value: k.autoCreate,
              help: t(lang, 'settings.autoCreateHelp'),
            },
            {
              name: 'requireDashy2fa',
              label: t(lang, 'settings.require2fa'),
              type: 'checkbox',
              value: k.requireDashy2fa,
              help: t(lang, 'settings.require2faHelp'),
            },
          ],
        },
      ],
    };
  },

  async act(ctx, body) {
    const { lang } = ctx;
    const v = body.values;
    const saveStore = (data: Record<string, unknown>) =>
      call(ctx, store.updateConfig, { schema: store.updateConfigSchema, body: data });
    /** Write-only secrets: empty means "keep the current one". */
    const secret = (name: string) => {
      const s = typeof v[name] === 'string' ? (v[name] as string).trim() : '';
      return s ? { [name]: s } : {};
    };
    switch (body.action) {
      case 'save-deploy':
        await saveStore({
          dockerEnabled: bool(v, 'dockerEnabled'),
          defaultDriver: str(v, 'defaultDriver'),
          wildcardEnabled: bool(v, 'wildcardEnabled'),
          baseDomain: str(v, 'baseDomain'),
        });
        return { message: t(lang, 'common.saved') };
      case 'save-coolify':
        await saveStore({
          coolifyEnabled: bool(v, 'coolifyEnabled'),
          coolifyBaseUrl: str(v, 'coolifyBaseUrl'),
          ...secret('coolifyToken'),
          coolifyProjectUuid: str(v, 'coolifyProjectUuid'),
          coolifyServerUuid: str(v, 'coolifyServerUuid'),
          coolifyDestinationUuid: str(v, 'coolifyDestinationUuid'),
          coolifyEnvUuid: str(v, 'coolifyEnvUuid'),
        });
        return { message: t(lang, 'common.saved') };
      case 'save-portainer':
        await saveStore({
          portainerEnabled: bool(v, 'portainerEnabled'),
          portainerUrl: str(v, 'portainerUrl'),
          ...secret('portainerKey'),
          portainerEndpointId: str(v, 'portainerEndpointId'),
        });
        return { message: t(lang, 'common.saved') };
      case 'save-kosmy':
        // Only the account options: issuer, client ID and secret carry this
        // very connection, so they are changed in Dashy.
        await call(ctx, kosmy.updateConfig, {
          schema: kosmy.updateConfigSchema,
          body: { autoCreate: bool(v, 'autoCreate'), requireDashy2fa: bool(v, 'requireDashy2fa') },
        });
        return { message: t(lang, 'common.saved') };
      default:
        unknownAction(ctx);
    }
  },
};

/* --------------------------------- registry -------------------------------- */

export const SECTIONS: SectionDef[] = [
  overview,
  usersSection,
  appsSection,
  requestsSection,
  notificationsSection,
  assistantSection,
  storeSection,
  settingsSection,
];

export function findSection(id: string): SectionDef | undefined {
  return SECTIONS.find((s) => s.id === id);
}
