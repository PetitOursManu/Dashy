import { http } from './client';
import type { HostedApp } from '../types';

export interface ImportPayload {
  name: string;
  description?: string;
  category?: string;
  content: File;
  preview?: File | null;
}

export interface UpdatePayload {
  name?: string;
  description?: string;
  category?: string;
  entryFile?: string;
  preview?: File | null;
}

export const appsApi = {
  list: () => http.get<{ apps: HostedApp[] }>('/api/apps'),

  get: (id: string) => http.get<{ app: HostedApp }>(`/api/apps/${id}`),

  import: (payload: ImportPayload) => {
    const form = new FormData();
    form.set('name', payload.name);
    if (payload.description) form.set('description', payload.description);
    if (payload.category) form.set('category', payload.category);
    form.set('content', payload.content);
    if (payload.preview) form.set('preview', payload.preview);
    return http.postForm<{ app: HostedApp }>('/api/apps', form);
  },

  update: (id: string, payload: UpdatePayload) => {
    const form = new FormData();
    if (payload.name !== undefined) form.set('name', payload.name);
    if (payload.description !== undefined) form.set('description', payload.description);
    if (payload.category !== undefined) form.set('category', payload.category);
    if (payload.entryFile !== undefined) form.set('entryFile', payload.entryFile);
    if (payload.preview) form.set('preview', payload.preview);
    return http.patchForm<{ app: HostedApp }>(`/api/apps/${id}`, form);
  },

  toggleFavorite: (id: string) =>
    http.post<{ id: string; isFavorite: boolean }>(`/api/apps/${id}/favorite`),

  createShare: (id: string, payload: { password: string; expiresInDays: number | null }) =>
    http.post<{ app: HostedApp }>(`/api/apps/${id}/share`, payload),

  revokeShare: (id: string) => http.del<{ app: HostedApp }>(`/api/apps/${id}/share`),

  updateContent: (id: string, content: File) => {
    const form = new FormData();
    form.set('content', content);
    return http.postForm<{ app: HostedApp }>(`/api/apps/${id}/content`, form);
  },

  rollback: (id: string, vid: string) =>
    http.post<{ app: HostedApp }>(`/api/apps/${id}/versions/${vid}/rollback`),

  remove: (id: string) => http.del<{ ok: true }>(`/api/apps/${id}`),
};
