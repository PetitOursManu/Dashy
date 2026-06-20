import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { z } from 'zod';
import { HostedApp, type HostedAppDoc } from '../models/HostedApp.js';
import { ApiError } from '../middleware/error.js';
import { isProduction } from '../config/env.js';
import { recordOpen } from '../services/opens.js';
import { resolveWithinApp } from '../utils/appServe.js';
import { signShareUnlock, verifyShareUnlock } from '../utils/jwt.js';
import { serializeApp } from './appsController.js';

export const shareSchema = z.object({
  // Empty string = no password.
  password: z.string().max(200).optional().default(''),
  // Days until expiry; null = never.
  expiresInDays: z.number().int().min(1).max(365).nullable().optional().default(null),
});

// --------------------------------- admin -------------------------------------

/** Enable (or update) a public share link for an app. Admin-only. */
export async function createShare(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');

  const { password, expiresInDays } = req.body as z.infer<typeof shareSchema>;

  app.share = {
    token: app.share?.token || crypto.randomBytes(16).toString('base64url'),
    passwordHash: password ? await argon2.hash(password) : null,
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null,
    createdAt: app.share?.createdAt || new Date(),
  };
  await app.save();
  res.json({ app: serializeApp(app) });
}

/** Revoke an app's public share link. Admin-only. */
export async function revokeShare(req: Request, res: Response): Promise<void> {
  const app = await HostedApp.findById(req.params.id);
  if (!app) throw new ApiError(404, 'App not found');
  app.share = { token: null, passwordHash: null, expiresAt: null, createdAt: null };
  await app.save();
  res.json({ app: serializeApp(app) });
}

// -------------------------------- public -------------------------------------

function shareCookieName(token: string): string {
  return `dashy_share_${token}`;
}

function isExpired(app: HostedAppDoc): boolean {
  return Boolean(app.share?.expiresAt && app.share.expiresAt.getTime() < Date.now());
}

/** Minimal self-contained password gate page (no app account needed). */
function passwordPage(token: string, error: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected — Dashy</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,Segoe UI,Roboto,sans-serif;
    background:radial-gradient(1100px 620px at 0% -5%,#f8ddc8,transparent 55%),linear-gradient(180deg,#f8f1e9,#f3ebe1);color:#272320}
  .card{background:#fff;border:1px solid #eee;border-radius:20px;padding:28px;width:320px;box-shadow:0 10px 30px -12px rgba(95,60,35,.22);text-align:center}
  h1{font-size:18px;margin:0 0 4px}p{color:#79675a;font-size:14px;margin:0 0 18px}
  input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #e8ddd1;border-radius:12px;font-size:14px;margin-bottom:12px}
  button{width:100%;padding:11px;border:0;border-radius:12px;background:linear-gradient(135deg,#f6824a,#db5421);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
  .err{color:#db2424;font-size:13px;margin-bottom:10px}
</style></head><body>
<form class="card" method="post" action="/share/${token}">
  <h1>🔒 Protected</h1>
  <p>This shared app is password-protected.</p>
  ${error ? '<div class="err">Incorrect password.</div>' : ''}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Unlock</button>
</form></body></html>`;
}

/** Handle the password form submission. */
export async function unlockShare(req: Request, res: Response): Promise<void> {
  const token = req.params.token;
  const app = await HostedApp.findOne({ 'share.token': token });
  if (!app || !app.share?.token || isExpired(app)) throw new ApiError(404, 'Share not found');
  if (!app.share.passwordHash) {
    res.redirect(`/share/${token}/`);
    return;
  }

  const password = String((req.body as { password?: unknown })?.password ?? '');
  if (!(await argon2.verify(app.share.passwordHash, password))) {
    res.status(401).type('html').send(passwordPage(token, true));
    return;
  }

  res.cookie(shareCookieName(token), signShareUnlock(token), {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: `/share/${token}`,
    maxAge: 6 * 60 * 60 * 1000,
  });
  res.redirect(`/share/${token}/`);
}

/** Serve a shared app's files publicly (no Dashy account required). */
export async function serveShare(req: Request, res: Response): Promise<void> {
  const token = req.params.token;
  const app = await HostedApp.findOne({ 'share.token': token });
  if (!app || !app.share?.token) throw new ApiError(404, 'Share not found');
  if (isExpired(app)) throw new ApiError(410, 'This share link has expired');

  // Password gate.
  if (app.share.passwordHash) {
    const cookie = req.cookies?.[shareCookieName(token)];
    if (!cookie || !verifyShareUnlock(cookie, token)) {
      res.type('html').send(passwordPage(token, false));
      return;
    }
  }

  let requested = (req.params[0] ?? '').trim();
  const isEntryOpen = requested === '';
  if (requested === '' || requested.endsWith('/')) {
    requested = path.posix.join(requested, app.entryFile || 'index.html');
  }

  const target = resolveWithinApp(app.id, requested);
  if (!target) throw new ApiError(400, 'Invalid path');
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new ApiError(404, 'File not found');
  }

  if (isEntryOpen) recordOpen(app._id, null);

  res.set('X-Content-Type-Options', 'nosniff');
  res.sendFile(target);
}
