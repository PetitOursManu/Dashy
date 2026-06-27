import { http } from './client';
import type { User, UserHistory, UserRole } from '../types';

export interface CreateUserPayload {
  email: string;
  password: string;
  role: UserRole;
  allowedApps: string[];
  chatEnabled?: boolean;
  durationHours?: number;
}

export interface UpdateUserPayload {
  role?: UserRole;
  password?: string;
  allowedApps?: string[];
  chatEnabled?: boolean;
  durationHours?: number;
}

export const usersApi = {
  list: () => http.get<{ users: User[] }>('/api/users'),
  create: (payload: CreateUserPayload) => http.post<{ user: User }>('/api/users', payload),
  update: (id: string, payload: UpdateUserPayload) =>
    http.patch<{ user: User }>(`/api/users/${id}`, payload),
  remove: (id: string) => http.del<{ ok: true }>(`/api/users/${id}`),
  history: (id: string) => http.get<UserHistory>(`/api/users/${id}/history`),
  setChatTimeout: (id: string, minutes: number | null) =>
    http.post<{ chatTimeoutUntil: string | null }>(`/api/users/${id}/chat-timeout`, { minutes }),
};
