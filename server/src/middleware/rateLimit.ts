import rateLimit from 'express-rate-limit';

// Rate limiting would otherwise make the e2e suite (many logins/requests in a
// few seconds) flaky, so it is disabled under NODE_ENV=test.
const skipInTest = (): boolean => process.env.NODE_ENV === 'test';

/** Strict limiter for authentication endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many attempts, please try again later' },
});

/** Looser limiter for general API traffic. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many requests, please slow down' },
});

/** Limiter for AI assistant calls (each one hits a paid upstream provider). */
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Too many messages, please slow down' },
});

/** Limiter for uploads (resource-intensive). */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: 'Upload limit reached, please try again later' },
});
