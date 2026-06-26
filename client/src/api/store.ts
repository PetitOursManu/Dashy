import { http } from './client';
import type {
  DockerDiagnostics,
  HostedApp,
  ManifestInput,
  StoreCatalogApp,
  StoreConfig,
  StoreDriver,
  StoreInstalled,
  StoreSource,
} from '../types';

export interface VolumeMount {
  name: string;
  mountPath: string;
}

export interface InstallPayload {
  source: string;
  manifestId: string;
  servingMode?: 'path' | 'subdomain';
  driver?: string;
  env?: Record<string, string>;
  finalUrl?: string;
  compose?: string;
  volumes?: VolumeMount[];
  serviceName?: string;
}

export interface RedeployPayload {
  compose?: string;
  env?: Record<string, string>;
  volumes?: VolumeMount[];
  serviceName?: string;
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

  uploadStatic: (file: File) => {
    const form = new FormData();
    form.set('content', file);
    return http.postForm<{ ref: string; filename: string }>('/api/store/uploads', form);
  },

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
    http.get<{ config: StoreConfig; drivers: StoreDriver[]; docker: DockerDiagnostics }>(
      '/api/store/config',
    ),
  updateConfig: (payload: Record<string, unknown>) =>
    http.put<{ config: StoreConfig; drivers: StoreDriver[]; docker: DockerDiagnostics }>(
      '/api/store/config',
      payload,
    ),

  installed: () => http.get<{ installed: StoreInstalled[] }>('/api/store/installed'),
  install: (payload: InstallPayload) =>
    http.post<{ ok: true; driverMessage?: string; app: HostedApp | null }>(
      '/api/store/install',
      payload,
    ),
  updateInstalled: (id: string) =>
    http.post<{ ok: true; installed: StoreInstalled }>(`/api/store/installed/${id}/update`),
  updateInstalledContent: (id: string, file: File, version: string) => {
    const form = new FormData();
    form.set('content', file);
    form.set('version', version);
    return http.postForm<{ ok: true; installed: StoreInstalled }>(
      `/api/store/installed/${id}/content`,
      form,
    );
  },
  redeploy: (id: string, payload: RedeployPayload) =>
    http.post<{ ok: true; message: string; installed: StoreInstalled }>(
      `/api/store/installed/${id}/redeploy`,
      payload,
    ),
  restart: (id: string) =>
    http.post<{ ok: true; message: string }>(`/api/store/installed/${id}/restart`),
  uninstall: (id: string) => http.del<{ ok: true }>(`/api/store/installed/${id}`),
};
