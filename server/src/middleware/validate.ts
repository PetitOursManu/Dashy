import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validate `req.body` against a Zod schema, replacing it with the parsed
 * (and coerced) result. Throws ZodError which the error handler maps to 400.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body) as z.infer<T>;
    next();
  };
}
