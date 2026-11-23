/**
 * "Users managed by the Board" (protocol kosmy.board-users.v1) — Dashy's side.
 *
 * From Kosmy Board, an administrator chooses who may use this Dashy, with a
 * role and Dashy's own restrictions; the Board then creates, updates or
 * disables the Dashy account linked to that person's Board `sub`. Dashy stays
 * the judge: it describes its roles and restrictions, re-checks every value
 * and applies them with its own rules.
 *
 * - Roles: Dashy's own (administrator, semi-admin, user). Temporary accounts
 *   stay a Dashy-only tool (a lifetime is not something to resend on every
 *   synchronisation): a linked temporary account shows as role `null`.
 * - Restrictions, each one enforced by Dashy already:
 *     `chatEnabled`  the AI assistant and requests to the admins (chatController)
 *     `app_<id>`     may open that app (services/access.ts, the dashboard list);
 *                    regular users only — staff see every app.
 * - Disabling sets `disabled`, bumps the token version and deletes the
 *   sessions: no sign-in anywhere, every open session refused at once.
 *
 * Used by the users API (controllers/kosmyBoardUsersController.ts) and by the
 * Board sign-in when the ID token carries `kosmy_board_access`.
 * Spec: Kosmy Board `docs/users-api.md`.
 */
import crypto from 'node:crypto';
import argon2 from 'argon2';
import mongoose, { type Types } from 'mongoose';
import { z } from 'zod';
import { User, type UserDoc, type UserRole } from '../../models/User.js';
import { HostedApp } from '../../models/HostedApp.js';
import { Session } from '../../models/Session.js';
import { logActivity } from '../activity.js';
import { countActiveAdmins } from '../../controllers/usersController.js';
import { t, type Lang } from './adminI18n.js';

export const USERS_PROTOCOL = 'kosmy.board-users.v1';
export const USERS_API_PATH = '/api/kosmy-board/users';
/** The Board's `sub` in the address. */
export const SUB_RE = /^[A-Za-z0-9-]{1,64}$/;

/** The roles the Board may give, in display order. */
export const BOARD_ROLES = ['admin', 'subadmin', 'user'] as const;
export type BoardRole = (typeof BOARD_ROLES)[number];
export const DEFAULT_ROLE: BoardRole = 'user';

const MAX_FIELDS = 30;
const CHAT_FIELD = 'chatEnabled';
const APP_PREFIX = 'app_';
/** One field per app, after the assistant: the protocol allows 30 fields. */
export const MAX_APP_FIELDS = MAX_FIELDS - 1;
export const MAX_USERS = 500;

/** Dashy's interface languages (the Board sends `locale`). */
const LANGUAGES = ['en', 'fr', 'es', 'de', 'it', 'zh', 'ru'];

const emailSchema = z.string().email().max(254);

/** A refusal with a translatable message (`409`, `422`…). */
export class UsersApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public key: string,
    public vars: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

const invalid = (key: string, vars?: Record<string, string | number>) =>
  new UsersApiError(422, 'invalid', key, vars);
const conflict = (key: string) => new UsersApiError(409, 'conflict', key);

/* ------------------------------- description ------------------------------- */

interface AppRef {
  id: string;
  name: string;
}

/** The apps offered as restrictions (by name), at most MAX_APP_FIELDS. */
export async function exposedApps(): Promise<AppRef[]> {
  const apps = await HostedApp.find()
    .sort({ name: 1, _id: 1 })
    .limit(MAX_APP_FIELDS)
    .select('name');
  return apps.map((a) => ({ id: String(a._id), name: a.name }));
}

export function roles(lang: Lang) {
  return BOARD_ROLES.map((r) => ({
    value: r,
    label: t(lang, `role.${r}`),
    description: t(lang, `usersApi.role.${r}`),
    ...(r === 'admin' ? { admin: true } : {}),
  }));
}

export function fields(lang: Lang, apps: AppRef[]) {
  return [
    {
      name: CHAT_FIELD,
      label: t(lang, 'usersApi.field.chat'),
      type: 'checkbox' as const,
      value: true,
      help: t(lang, 'usersApi.field.chatHelp'),
    },
    ...apps.map((a, i) => ({
      name: `${APP_PREFIX}${a.id}`,
      label: t(lang, 'usersApi.field.app', { name: a.name }).slice(0, 120),
      type: 'checkbox' as const,
      value: false,
      // Staff (administrators, semi-admins) see every app.
      roles: ['user'],
      ...(i === 0 ? { help: t(lang, 'usersApi.field.appHelp') } : {}),
    })),
  ];
}

type AccountView = Pick<
  UserDoc,
  'kosmySub' | 'role' | 'chatEnabled' | 'allowedApps' | 'disabled' | 'expiresAt' | 'email'
>;

export function boardRoleOf(role: UserRole): BoardRole | null {
  return (BOARD_ROLES as readonly string[]).includes(role) ? (role as BoardRole) : null;
}

/** Whether the account can sign in at all. */
export function isActive(u: Pick<UserDoc, 'disabled' | 'role' | 'expiresAt'>): boolean {
  if (u.disabled === true) return false;
  if (u.role === 'temp' && u.expiresAt && u.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

export function valuesOf(u: AccountView, apps: AppRef[]): Record<string, boolean> {
  const allowed = new Set(u.allowedApps.map(String));
  return {
    [CHAT_FIELD]: u.chatEnabled !== false,
    ...Object.fromEntries(apps.map((a) => [`${APP_PREFIX}${a.id}`, allowed.has(a.id)])),
  };
}

/** The Dashy accounts linked to a Board account (500 at most). */
export async function linkedAccounts(apps: AppRef[]) {
  const list = await User.find({ kosmySub: { $type: 'string' } })
    .sort({ createdAt: 1 })
    .limit(MAX_USERS)
    .select('kosmySub role chatEnabled allowedApps disabled expiresAt email');
  return list.map((u) => ({
    sub: u.kosmySub as string,
    role: boardRoleOf(u.role),
    values: valuesOf(u, apps),
    active: isActive(u),
    account: u.email,
  }));
}

/* ----------------------------- create / update ----------------------------- */

export interface ProvisionInput {
  name?: unknown;
  email?: unknown;
  locale?: unknown;
  role?: unknown;
  values?: unknown;
}

interface CleanValues {
  chatEnabled?: boolean;
  /** app id → may open it (only the apps the Board sent). */
  apps: Map<string, boolean>;
}

/** Re-check every value: a field the Board did not send keeps its current value. */
async function cleanValues(raw: unknown, lang: Lang): Promise<CleanValues> {
  const out: CleanValues = { apps: new Map() };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid('usersApi.badValues');
  const v = raw as Record<string, unknown>;

  if (CHAT_FIELD in v) {
    if (typeof v[CHAT_FIELD] !== 'boolean') {
      throw invalid('usersApi.badCheckbox', { label: t(lang, 'usersApi.field.chat') });
    }
    out.chatEnabled = v[CHAT_FIELD] as boolean;
  }

  const appKeys = Object.keys(v).filter((k) => k.startsWith(APP_PREFIX));
  if (appKeys.length > 0) {
    const ids = appKeys.map((k) => k.slice(APP_PREFIX.length)).filter((id) => mongoose.isValidObjectId(id));
    const existing = await HostedApp.find({ _id: { $in: ids } }).select('name');
    const byId = new Map(existing.map((a) => [String(a._id), a.name]));
    for (const key of appKeys) {
      const id = key.slice(APP_PREFIX.length);
      // An app removed since the Board last read the fields: nothing to apply.
      if (!byId.has(id)) continue;
      if (typeof v[key] !== 'boolean') {
        throw invalid('usersApi.badCheckbox', { label: t(lang, 'usersApi.field.app', { name: byId.get(id)! }) });
      }
      out.apps.set(id, v[key] as boolean);
    }
  }
  // Other names are not Dashy's restrictions (any more): ignored.
  return out;
}

function cleanText(raw: unknown, max: number): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, max) : null;
}

function cleanEmail(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!emailSchema.safeParse(email).success) throw invalid('usersApi.badEmail');
  return email;
}

export type ProvisionStatus = 'created' | 'linked' | 'updated';

/**
 * Create, link or update the Dashy account of the Board person `sub`.
 *
 * - `actorSub`: the Board administrator who acts (a PUT); null at sign-in.
 * - `atLogin`: from the `kosmy_board_access` claim of a sign-in — never links
 *   an existing account by its email (only a Dashy administrator may, in a
 *   PUT), and never refuses the sign-in to keep Dashy's last administrator:
 *   the demotion is skipped instead.
 */
export async function provisionBoardUser(
  sub: string,
  input: ProvisionInput,
  opts: { actorSub: string | null; atLogin: boolean; lang: Lang },
): Promise<{ status: ProvisionStatus; user: UserDoc }> {
  const { lang } = opts;
  if (typeof input.role !== 'string' || !(BOARD_ROLES as readonly string[]).includes(input.role)) {
    throw invalid('usersApi.unknownRole');
  }
  const role = input.role as BoardRole;
  const values = await cleanValues(input.values, lang);
  const name = cleanText(input.name, 120);
  const email = cleanEmail(input.email);

  let user = await User.findOne({ kosmySub: sub });
  let status: ProvisionStatus = 'updated';

  if (!user && email) {
    const sameEmail = await User.findOne({ email });
    if (sameEmail) {
      if (typeof sameEmail.kosmySub === 'string' && sameEmail.kosmySub) {
        throw conflict('usersApi.emailLinkedElsewhere');
      }
      // Linking by email is a Dashy administrator's decision (a PUT), never a sign-in's.
      if (opts.atLogin) throw conflict('usersApi.emailTaken');
      user = sameEmail;
      status = 'linked';
    }
  }

  if (!user) {
    if (!email) throw invalid('usersApi.emailNeeded');
    const locale = typeof input.locale === 'string' ? input.locale.slice(0, 2).toLowerCase() : '';
    user = new User({
      email,
      // No usable password: this account signs in through the Board.
      passwordHash: await argon2.hash(crypto.randomBytes(32).toString('base64url'), {
        type: argon2.argon2id,
      }),
      role: DEFAULT_ROLE,
      fullName: name ?? '',
      language: LANGUAGES.includes(locale) ? locale : 'en',
      chatEnabled: true,
      allowedApps: [],
    });
    status = 'created';
  }

  // Never cut Dashy off from its administrators.
  let newRole: UserRole = role;
  const losesAdmin = status !== 'created' && user.role === 'admin' && user.disabled !== true && role !== 'admin';
  if (losesAdmin) {
    if (opts.actorSub !== null && sub === opts.actorSub) throw conflict('usersApi.selfDemote');
    if ((await countActiveAdmins()) <= 1) {
      if (!opts.atLogin) throw conflict('usersApi.lastAdmin');
      console.warn('[kosmy-board] sign-in: kept the last administrator of Dashy as administrator');
      newRole = 'admin';
    }
  }

  // The name and email shown for the person follow the Board.
  if (status !== 'created') {
    if (name) user.fullName = name;
    if (email && email !== user.email) {
      if (await User.exists({ email, _id: { $ne: user._id } })) throw conflict('usersApi.emailTaken');
      user.email = email;
    }
  }

  user.kosmySub = sub;
  user.role = newRole;
  user.expiresAt = null; // never a temporary account from the Board
  if (values.chatEnabled !== undefined) user.chatEnabled = values.chatEnabled;
  if (values.apps.size > 0) {
    const allowed = new Map<string, Types.ObjectId>(user.allowedApps.map((id) => [String(id), id]));
    for (const [id, can] of values.apps) {
      if (can) allowed.set(id, allowed.get(id) ?? new mongoose.Types.ObjectId(id));
      else allowed.delete(id);
    }
    user.allowedApps = [...allowed.values()];
  }
  user.disabled = false; // given access again: re-enabled

  try {
    await user.save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('usersApi.emailTaken');
    throw err;
  }

  const by = opts.atLogin ? 'a Kosmy Board sign-in' : 'Kosmy Board';
  if (status === 'created') logActivity('user.created', user.email, `account created by ${by} (${role})`);
  else logActivity('user.updated', user.email, `account ${status} by ${by} (${user.role})`);
  return { status, user };
}

/* --------------------------------- disable --------------------------------- */

/**
 * Withdraw the access of the Board person `sub`: the linked account is
 * disabled (its data stays) and every session is closed at once. Nothing
 * linked, or already disabled: nothing to do.
 */
export async function disableBoardUser(sub: string, actorSub: string): Promise<boolean> {
  if (sub === actorSub) throw conflict('usersApi.selfDisable');
  const user = await User.findOne({ kosmySub: sub });
  if (!user || user.disabled === true) return false;
  if (user.role === 'admin' && (await countActiveAdmins()) <= 1) throw conflict('usersApi.lastAdmin');

  await User.updateOne({ _id: user._id }, { $set: { disabled: true }, $inc: { tokenVersion: 1 } });
  await Session.deleteMany({ user: user._id });
  logActivity('user.disabled', user.email, 'access withdrawn in Kosmy Board: account disabled');
  return true;
}
