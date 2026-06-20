import { http } from './client';
import type { TwoFactorSetup, User } from '../types';

export const authApi = {
  me: () => http.get<{ user: User }>('/api/auth/me'),

  login: (email: string, password: string) =>
    http.post<{ user?: User; twoFactorRequired?: boolean }>('/api/auth/login', {
      email,
      password,
    }),

  verifyTwoFactor: (token: string) =>
    http.post<{ user: User }>('/api/auth/2fa/verify', { token }),

  register: (email: string, password: string) =>
    http.post<{ user: User }>('/api/auth/register', { email, password }),

  logout: () => http.post<{ ok: true }>('/api/auth/logout'),

  setupTwoFactor: () => http.post<TwoFactorSetup>('/api/auth/2fa/setup'),

  enableTwoFactor: (token: string) =>
    http.post<{ ok: true }>('/api/auth/2fa/enable', { token }),

  disableTwoFactor: (password: string) =>
    http.post<{ ok: true }>('/api/auth/2fa/disable', { password }),

  regenerateBackupCodes: () =>
    http.post<{ backupCodes: string[] }>('/api/auth/2fa/backup-codes'),

  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),

  updateProfile: (payload: {
    nickname?: string;
    fullName?: string;
    jobTitle?: string;
    language?: string;
    theme?: string;
    timezone?: string;
    dateFormat?: string;
  }) => http.patch<{ user: User }>('/api/auth/profile', payload),

  logoutAll: () => http.post<{ ok: true }>('/api/auth/logout-all'),

  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.set('avatar', file);
    return http.postForm<{ user: User }>('/api/auth/avatar', form);
  },

  removeAvatar: () => http.del<{ user: User }>('/api/auth/avatar'),
};

/** URL for a user's avatar image (only meaningful when hasAvatar is true). */
export function avatarUrl(userId: string): string {
  return `/api/auth/avatar/${userId}`;
}
