import { http } from './client';
import type { AdminNotification, UserNotification } from '../types';

export const notificationsApi = {
  // User
  mine: () => http.get<{ notifications: UserNotification[] }>('/api/notifications'),
  read: (id: string) => http.post<{ ok: true }>(`/api/notifications/${id}/read`),

  // Admin
  adminList: () => http.get<{ notifications: AdminNotification[] }>('/api/notifications/admin'),
  createForUser: (userId: string, message: string) =>
    http.post<{ notification: AdminNotification }>('/api/notifications', { userId, message }),
  dismiss: (id: string) => http.del<{ ok: true }>(`/api/notifications/${id}`),
};
