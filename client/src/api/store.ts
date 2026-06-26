import { http } from './client';
import type {
  HostedApp,
  ManifestInput,
  StoreCatalogApp,
  StoreConfig,
  StoreDriver,
  StoreInstalled,
  StoreSource,
} from '../types';

export interface InstallPayload {
  source: string;
  manifestId: string;
  servingMode?: 'path' | 'subdomain';
  driver?: string;
  env?: Record<string, string>;
  finalUrl?: string;
}

export interface CreateSourcePayload {
  name: string;
  type: 'local' | 'remote';
  location: string;
  enabled?: boolean;
  ttlMinutes?: number;
}

export const storeApi = {
  catalog: (refresh = false) =>
    http.get<{ apps: StoreCatalogApp[] }>(`/api/store/catalog${refresh ? '?refresh=1' : ''}`),
  refresh: () => http.post<{ ok: true }>('/api/store/catalog/refresh'),

  sources: () => http.get<{ sources: StoreSource[] }>('/api/store/sources'),
  createSource: (payload: CreateSourcePayload) =>
    http.post<{ source: StoreSource }>('/api/store/sources', payload),
  createManagedSource: (name: string) =>
    http.post<{ source: StoreSource }>('/api/store/sources/managed', { name }),
  updateSource: (id: string, payload: Partial<CreateSourcePayload>) =>
    http.patch<{ source: StoreSource }>(`/api/store/sources/${id}`, payload),
  deleteSource: (id: string) => http.del<{ ok: true }>(`/api/store/sources/${id}`),

  addApp: (sourceId: string, manifest: ManifestInput) =>
    http.post<{ app: ManifestInput }>(`/api/store/sources/${sourceId}/apps`, manifest),
  updateApp: (sourceId: string, appId: string, manifest: ManifestInput) =>
    http.patch<{ app: ManifestInput }>(
      `/api/store/sources/${sourceId}/apps/${appId}`,
      manifest,
    ),
  deleteApp: (sourceId: string, appId: string) =>
    http.del<{ ok: true }>(`/api/store/sources/${sourceId}/apps/${appId}`),

  getConfig: () =>
    http.get<{ config: StoreConfig; drivers: StoreDriver[] }>('/api/store/config'),
  updateConfig: (payload: Record<string, unknown>) =>
    http.put<{ config: StoreConfig; drivers: StoreDriver[] }>('/api/store/config', payload),

  installed: () => http.get<{ installed: StoreInstalled[] }>('/api/store/installed'),
  install: (payload: InstallPayload) =>
    http.post<{ ok: true; driverMessage?: string; app: HostedApp | null }>(
      '/api/store/install',
      payload,
    ),
  updateInstalled: (id: string) =>
    http.post<{ ok: true; installed: StoreInstalled }>(`/api/store/installed/${id}/update`),
  uninstall: (id: string) => http.del<{ ok: true }>(`/api/store/installed/${id}`),
};
