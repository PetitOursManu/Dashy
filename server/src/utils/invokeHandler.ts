import type { Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import type { JwtPayload } from './jwt.js';

type Handler = (req: Request, res: Response) => Promise<void> | void;

export interface InvokeOptions {
  /** The acting user, as `requireAuth` would set it (DB role). */
  user: JwtPayload;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** The schema the route validates the body with (`validateBody`). */
  schema?: ZodTypeAny;
}

export interface InvokeResult<T> {
  status: number;
  body: T;
}

/**
 * Run an existing JSON route handler in-process, as its route would: the body
 * goes through the same Zod schema as `validateBody`, the handler keeps its own
 * rules, side effects and activity log, and its errors (ApiError, ZodError…)
 * propagate unchanged. Used by the Kosmy Board admin API so that every action
 * taken from the Board runs exactly the code of Dashy's own admin.
 *
 * Only handlers that answer with `res.json()` are supported.
 */
export async function invokeHandler<T = Record<string, unknown>>(
  handler: Handler,
  opts: InvokeOptions,
): Promise<InvokeResult<T>> {
  const req = {
    user: opts.user,
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.schema ? opts.schema.parse(opts.body ?? {}) : (opts.body ?? {}),
    headers: {},
    cookies: {},
  } as unknown as Request;

  let status = 200;
  let sent = false;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      sent = true;
      return res;
    },
    set() {
      return res;
    },
    setHeader() {
      return res;
    },
  };

  await handler(req, res as unknown as Response);
  if (!sent) throw new Error('invokeHandler: the handler did not answer with JSON');
  return { status, body: body as T };
}
