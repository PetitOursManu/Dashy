import { http } from './client';
import type { ProjectRequest, ProjectRequestKind, ProjectRequestStatus } from '../types';

export const requestsApi = {
  // User
  mine: () => http.get<{ requests: ProjectRequest[] }>('/api/requests'),
  create: (kind: ProjectRequestKind, message: string) =>
    http.post<{ request: ProjectRequest }>('/api/requests', { kind, message }),

  // Admin
  adminList: () => http.get<{ requests: ProjectRequest[] }>('/api/requests/admin'),
  setStatus: (id: string, status: ProjectRequestStatus) =>
    http.post<{ request: ProjectRequest }>(`/api/requests/${id}/status`, { status }),
};
