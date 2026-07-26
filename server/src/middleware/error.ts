import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** A controlled, client-safe error carrying an HTTP status code. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * A deploy/redeploy/restart driver failure (the stack couldn't be brought up).
 * Rendered as HTTP 200 with `{ ok: false, error }` — NOT a 5xx — so a reverse
 * proxy in front of Dashy (Coolify/Traefik) can't swap the body of a 502 for
 * its own generic error page and hide the real reason from the admin. The
 * failure is always logged server-side too.
 */
export class DeployError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeployError';
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof DeployError) {
    // Always surface the reason in the container logs, and return it in a 200
    // body a reverse proxy won't rewrite. The client keys off `ok: false`.
    console.error('[deploy]', err.message);
    res.status(200).json({ ok: false, error: err.message });
    return;
  }

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Mongo duplicate-key (e.g. email/slug already exists).
  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    res.status(409).json({ error: 'Resource already exists' });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
