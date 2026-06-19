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
};
