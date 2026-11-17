import { http } from './client';
import type { KosmyBoardAdmin } from '../types';

/** "Sign in with Kosmy Board" (OpenID Connect). */
export const kosmyBoardApi = {
  /** Public: whether the login page shows the button. */
  status: () => http.get<{ enabled: boolean }>('/api/auth/kosmy-board'),

  /** Start linking the signed-in account; navigate to the returned URL. */
  startLink: () => http.post<{ url: string }>('/api/auth/kosmy-board/link'),

  unlink: (password: string) => http.del<{ ok: true }>('/api/auth/kosmy-board', { password }),

  getConfig: () => http.get<KosmyBoardAdmin>('/api/admin/kosmy-board'),

  updateConfig: (payload: {
    issuer?: string;
    clientId?: string;
    clientSecret?: string;
    clearClientSecret?: boolean;
    autoCreate?: boolean;
    requireDashy2fa?: boolean;
  }) => http.put<KosmyBoardAdmin>('/api/admin/kosmy-board', payload),
};

/** Browser route that starts the sign-in flow (full navigation, not fetch). */
export function kosmyLoginUrl(next?: string | null): string {
  return next
    ? `/auth/kosmy-board/login?target_link_uri=${encodeURIComponent(next)}`
    : '/auth/kosmy-board/login';
}

/** Error codes the server puts in `?kosmy_error=` → translation keys. */
export function kosmyErrorKey(code: string): string {
  const known = [
    'not_configured',
    'issuer',
    'expired',
    'denied',
    'failed',
    'unreachable',
    'exchange',
    'token',
    'not_linked',
    'account_expired',
    'email_taken',
    'no_email',
    'session',
    'already_linked',
  ];
  return `kosmy.err.${known.includes(code) ? code : 'failed'}`;
}
