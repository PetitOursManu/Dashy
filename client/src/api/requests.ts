import { http } from './client';
import type { ProjectRequest, ProjectRequestKind, ProjectRequestStatus } from '../types';

export const requestsApi = {
  // User
  mine: () => http.get<{ requests: ProjectRequest[] }>('/api/requests'),
  create: (kind: ProjectRequestKind, message: string) =>
    http.post<{ request: ProjectRequest }>('/api/requests', { kind, message }),

  // Admin
  adminList: (status?: 'all' | 'archived' | ProjectRequestStatus) =>
    http.get<{ requests: ProjectRequest[] }>(
      `/api/requests/admin${status ? `?status=${status}` : ''}`,
    ),
  setStatus: (id: string, status: ProjectRequestStatus) =>
    http.post<{ request: ProjectRequest }>(`/api/requests/${id}/status`, { status }),
  reply: (id: string, message: string) =>
    http.post<{ request: ProjectRequest }>(`/api/requests/${id}/reply`, { message }),
  archive: (id: string, archived: boolean) =>
    http.post<{ request: ProjectRequest }>(`/api/requests/${id}/archive`, { archived }),
  relay: (id: string) => http.post<{ ok: true; relayed: number }>(`/api/requests/${id}/relay`),
};
