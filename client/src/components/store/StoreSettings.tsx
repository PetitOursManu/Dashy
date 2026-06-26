import { useEffect, useState } from 'react';
import { storeApi } from '../../api/store';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import type { DockerDiagnostics, StoreConfig, StoreSource } from '../../types';
import { Spinner } from '../Spinner';
import { PlusIcon, StoreIcon, TrashIcon } from '../Icons';
import { CatalogManagerModal } from './CatalogManagerModal';

export function StoreSettings() {
  const { t } = useI18n();
  const [sources, setSources] = useState<StoreSource[]>([]);
  const [cfg, setCfg] = useState<StoreConfig | null>(null);
  const [docker, setDocker] = useState<DockerDiagnostics | null>(null);
  const [coolifyToken, setCoolifyToken] = useState('');
  const [portainerKey, setPortainerKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New source form
  const [sName, setSName] = useState('');
  const [sType, setSType] = useState<'local' | 'remote'>('remote');
  const [sLocation, setSLocation] = useState('');

  // Managed catalogue (Dashy-owned, editable from the UI)
  const [mName, setMName] = useState('');
  const [manageSource, setManageSource] = useState<StoreSource | null>(null);

  const load = async () => {
    try {
      const [s, c] = await Promise.all([storeApi.sources(), storeApi.getConfig()]);
      setSources(s.sources);
      setCfg(c.config);
      setDocker(c.docker);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load store settings.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addSource = async () => {
    if (!sName.trim() || !sLocation.trim()) return;
    setError(null);
    try {
      await storeApi.createSource({ name: sName.trim(), type: sType, location: sLocation.trim() });
      setSName('');
      setSLocation('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the source.');
    }
  };

  const addManaged = async () => {
    if (!mName.trim()) return;
    setError(null);
    try {
      await storeApi.createManagedSource(mName.trim());
      setMName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the catalogue.');
    }
  };

  const removeSource = async (id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    try {
      await storeApi.deleteSource(id);
    } catch {
      void load();
    }
  };

  const toggleSource = async (s: StoreSource) => {
    try {
      await storeApi.updateSource(s.id, { enabled: !s.enabled });
      await load();
    } catch {
      /* ignore */
    }
  };

  const set = <K extends keyof StoreConfig>(key: K, value: StoreConfig[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const saveConfig = async () => {
    if (!cfg) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        coolifyEnabled: cfg.coolifyEnabled,
        coolifyBaseUrl: cfg.coolifyBaseUrl,
        coolifyProjectUuid: cfg.coolifyProjectUuid,
        coolifyServerUuid: cfg.coolifyServerUuid,
        coolifyDestinationUuid: cfg.coolifyDestinationUuid,
        coolifyEnvUuid: cfg.coolifyEnvUuid,
        portainerEnabled: cfg.portainerEnabled,
        portainerUrl: cfg.portainerUrl,
        portainerEndpointId: cfg.portainerEndpointId,
        dockerEnabled: cfg.dockerEnabled,
        defaultDriver: cfg.defaultDriver,
        wildcardEnabled: cfg.wildcardEnabled,
        baseDomain: cfg.baseDomain,
      };
      if (coolifyToken) payload.coolifyToken = coolifyToken;
      if (portainerKey) payload.portainerKey = portainerKey;
      const res = await storeApi.updateConfig(payload);
      setCfg(res.config);
      setDocker(res.docker);
      setCoolifyToken('');
      setPortainerKey('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the configuration.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <StoreIcon className="h-5 w-5 text-ember-500" />
        {t('storecfg.title')}
      </h2>
      <p className="text-sm text-sand-500 dark:text-sand-400">{t('storecfg.desc')}</p>

      {/* Catalogue sources */}
      <div className="mt-5">
        <h3 className="text-sm font-semibold">{t('storecfg.sources')}</h3>
        {sources.length > 0 && (
          <ul className="mt-2 space-y-2">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-sand-200 px-3 py-2 dark:border-sand-700"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {s.name}{' '}
                    <span className="text-xs font-normal text-sand-400">
                      ({s.type}) · {s.appCount} {t('storecfg.apps')}
                    </span>
                    {s.managed && (
                      <span className="ml-1 rounded-full bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-medium text-ember-600 dark:text-ember-300">
                        {t('storecfg.managedBadge')}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-sand-400" title={s.location}>
                    {s.location}
                  </p>
                  {s.lastError && (
                    <p className="truncate text-xs text-red-500">{s.lastError}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {s.managed && (
                    <button
                      type="button"
                      onClick={() => setManageSource(s)}
                      className="btn-ghost !px-2 !py-1 text-xs"
                    >
                      {t('storecfg.manageApps')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void toggleSource(s)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      s.enabled
                        ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                        : 'bg-sand-200 text-sand-500 dark:bg-sand-800'
                    }`}
                  >
                    {s.enabled ? t('storecfg.on') : t('storecfg.off')}
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeSource(s.id)}
                    className="btn-ghost !px-1.5 !py-1 text-red-500"
                    aria-label={t('storecfg.removeSource')}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_2fr_auto]">
          <input
            className="input"
            value={sName}
            onChange={(e) => setSName(e.target.value)}
            placeholder={t('storecfg.sourceName')}
          />
          <select
            className="input"
            value={sType}
            onChange={(e) => setSType(e.target.value as 'local' | 'remote')}
          >
            <option value="remote">{t('storecfg.remote')}</option>
            <option value="local">{t('storecfg.local')}</option>
          </select>
          <input
            className="input"
            value={sLocation}
            onChange={(e) => setSLocation(e.target.value)}
            placeholder={sType === 'remote' ? 'https://…/catalog.json' : '/data/catalog'}
          />
          <button type="button" className="btn-secondary" onClick={() => void addSource()}>
            <PlusIcon className="h-4 w-4" />
            {t('storecfg.addSource')}
          </button>
        </div>

        {/* Managed catalogue — edited from the UI, no JSON file to maintain */}
        <div className="mt-4 rounded-xl border border-dashed border-sand-300 p-3 dark:border-sand-700">
          <p className="text-sm font-medium">{t('storecfg.managedTitle')}</p>
          <p className="text-xs text-sand-400">{t('storecfg.managedHint')}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              className="input"
              value={mName}
              onChange={(e) => setMName(e.target.value)}
              placeholder={t('storecfg.catalogName')}
            />
            <button type="button" className="btn-secondary" onClick={() => void addManaged()}>
              <PlusIcon className="h-4 w-4" />
              {t('storecfg.createCatalog')}
            </button>
          </div>
        </div>
      </div>

      {cfg && (
        <>
          {/* Deploy drivers */}
          <div className="mt-6 border-t border-sand-200 pt-5 dark:border-sand-700">
            <h3 className="text-sm font-semibold">{t('storecfg.drivers')}</h3>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sand-300 text-ember-500"
                checked={cfg.dockerEnabled}
                onChange={(e) => set('dockerEnabled', e.target.checked)}
              />
              {t('storecfg.dockerEnabled')}
            </label>

            {docker && (!docker.socketPresent || !docker.cliPresent) && (
              <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                <p className="font-medium">{t('storecfg.dockerDiagTitle')}</p>
                <p className="mt-1">
                  {!docker.socketPresent
                    ? docker.inContainer
                      ? t('storecfg.dockerNoSocketContainer')
                      : t('storecfg.dockerNoSocket')
                    : t('storecfg.dockerNoCli')}
                </p>
              </div>
            )}

            {/* Coolify */}
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sand-300 text-ember-500"
                checked={cfg.coolifyEnabled}
                onChange={(e) => set('coolifyEnabled', e.target.checked)}
              />
              Coolify
            </label>
            {cfg.coolifyEnabled && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="Base URL" value={cfg.coolifyBaseUrl} onChange={(e) => set('coolifyBaseUrl', e.target.value)} />
                <input className="input" type="password" placeholder={cfg.hasCoolifyToken ? '•••• (set)' : 'API token'} value={coolifyToken} onChange={(e) => setCoolifyToken(e.target.value)} autoComplete="off" />
                <input className="input" placeholder="Project UUID" value={cfg.coolifyProjectUuid} onChange={(e) => set('coolifyProjectUuid', e.target.value)} />
                <input className="input" placeholder="Server UUID" value={cfg.coolifyServerUuid} onChange={(e) => set('coolifyServerUuid', e.target.value)} />
                <input className="input" placeholder="Destination UUID" value={cfg.coolifyDestinationUuid} onChange={(e) => set('coolifyDestinationUuid', e.target.value)} />
                <input className="input" placeholder="Environment UUID (optional)" value={cfg.coolifyEnvUuid} onChange={(e) => set('coolifyEnvUuid', e.target.value)} />
              </div>
            )}

            {/* Portainer */}
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sand-300 text-ember-500"
                checked={cfg.portainerEnabled}
                onChange={(e) => set('portainerEnabled', e.target.checked)}
              />
              Portainer
            </label>
            {cfg.portainerEnabled && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input className="input" placeholder="URL" value={cfg.portainerUrl} onChange={(e) => set('portainerUrl', e.target.value)} />
                <input className="input" type="password" placeholder={cfg.hasPortainerKey ? '•••• (set)' : 'API key'} value={portainerKey} onChange={(e) => setPortainerKey(e.target.value)} autoComplete="off" />
                <input className="input" placeholder="Endpoint ID" value={cfg.portainerEndpointId} onChange={(e) => set('portainerEndpointId', e.target.value)} />
              </div>
            )}

            <p className="mt-3 text-xs text-sand-400">{t('storecfg.tokensHint')}</p>
          </div>

          {/* Wildcard DNS */}
          <div className="mt-6 border-t border-sand-200 pt-5 dark:border-sand-700">
            <h3 className="text-sm font-semibold">{t('storecfg.wildcard')}</h3>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-sand-300 text-ember-500"
                checked={cfg.wildcardEnabled}
                onChange={(e) => set('wildcardEnabled', e.target.checked)}
              />
              {t('storecfg.wildcardEnabled')}
            </label>
            {cfg.wildcardEnabled && (
              <input
                className="input mt-2"
                placeholder="apps.example.com"
                value={cfg.baseDomain}
                onChange={(e) => set('baseDomain', e.target.value)}
              />
            )}
            <p className="mt-1 text-xs text-sand-400">{t('storecfg.wildcardHint')}</p>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {saved && (
            <p className="mt-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
              {t('storecfg.saved')}
            </p>
          )}

          <button type="button" className="btn-primary mt-4" onClick={() => void saveConfig()} disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {t('storecfg.save')}
          </button>
        </>
      )}

      <CatalogManagerModal
        open={manageSource !== null}
        source={manageSource}
        onClose={() => setManageSource(null)}
        onChanged={() => void load()}
      />
    </section>
  );
}
