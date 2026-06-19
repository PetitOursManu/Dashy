import { http } from './client';
import type { User } from '../types';

export interface CreateUserPayload {
  email: string;
  password: string;
  role: 'admin' | 'user';
  allowedApps: string[];
}

export interface UpdateUserPayload {
  role?: 'admin' | 'user';
  password?: string;
  allowedApps?: string[];
}

export const usersApi = {
  list: () => http.get<{ users: User[] }>('/api/users'),
  create: (payload: CreateUserPayload) => http.post<{ user: User }>('/api/users', payload),
  update: (id: string, payload: UpdateUserPayload) =>
    http.patch<{ user: User }>(`/api/users/${id}`, payload),
  remove: (id: string) => http.del<{ ok: true }>(`/api/users/${id}`),
};
