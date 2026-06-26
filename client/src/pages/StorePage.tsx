import { useEffect, useMemo, useState } from 'react';
import { storeApi } from '../api/store';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type {
  StoreCatalogApp,
  StoreConfig,
  StoreDriver,
  StoreInstalled,
} from '../types';
import { InstallModal } from '../components/store/InstallModal';
import { UpdateContentModal } from '../components/store/UpdateContentModal';
import { Spinner } from '../components/Spinner';
import { DownloadIcon, SearchIcon } from '../components/Icons';

const TYPE_BADGE: Record<string, string> = {
  tile: 'bg-sky-500/15 text-sky-600 dark:text-sky-300',
  static: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  deploy: 'bg-ember-500/15 text-ember-600 dark:text-ember-300',
};

function AppIcon({ icon, name }: { icon: string; name: string }) {
  const isUrl = /^(https?:)?\/\//.test(icon) || icon.startsWith('/');
  if (isUrl) {
    return <img src={icon} alt="" className="h-9 w-9 rounded-lg object-cover" />;
  }
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sand-100 text-lg dark:bg-sand-800">
      {icon || name.charAt(0).toUpperCase()}
    </span>
  );
}

export function StorePage() {
  const { t } = useI18n();
  const [apps, setApps] = useState<StoreCatalogApp[]>([]);
  const [installed, setInstalled] = useState<StoreInstalled[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [drivers, setDrivers] = useState<StoreDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [installApp, setInstallApp] = useState<StoreCatalogApp | null>(null);
  const [contentApp, setContentApp] = useState<StoreInstalled | null>(null);

  const load = async () => {
    try {
      const [c, i, cfg] = await Promise.all([
        storeApi.catalog(),
        storeApi.installed(),
        storeApi.getConfig(),
      ]);
      setApps(c.apps);
      setInstalled(i.installed);
      setConfig(cfg.config);
      setDrivers(cfg.drivers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the store.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await storeApi.refresh();
      await load();
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((a) =>
      `${a.name} ${a.description} ${a.author} ${a.source}`.toLowerCase().includes(q),
    );
  }, [apps, search]);

  const onUninstall = async (id: string) => {
    setInstalled((prev) => prev.filter((i) => i.id !== id));
    try {
      await storeApi.uninstall(id);
      await load();
    } catch {
      void load();
    }
  };

  const onUpdate = async (id: string) => {
    try {
      await storeApi.updateInstalled(id);
      await load();
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="h-8 w-8 text-ember-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('store.subtitle')}</p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('store.search')}
              className="input w-48 pl-9 sm:w-64"
            />
          </div>
          <button type="button" className="btn-secondary" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner className="h-4 w-4" /> : <DownloadIcon className="h-4 w-4" />}
            {t('store.refresh')}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Catalogue */}
      {apps.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-sand-500 dark:text-sand-400">
          {t('store.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((a) => (
            <div key={`${a.source}:${a.id}`} className="card flex flex-col p-4">
              <div className="flex items-start gap-3">
                <AppIcon icon={a.icon} name={a.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold" title={a.name}>
                      {a.name}
                    </h3>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[a.type]}`}>
                      {a.type}
                    </span>
                  </div>
                  <p className="truncate text-xs text-sand-400">
                    {a.author || t('store.unknownAuthor')} · v{a.version} · {a.source}
                  </p>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-sand-500 dark:text-sand-400">
                {a.description}
              </p>
              <div className="mt-3">
                {a.installed && !a.updateAvailable ? (
                  <button type="button" className="btn-secondary w-full justify-center" disabled>
                    {t('store.installed')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary w-full justify-center"
                    onClick={() => setInstallApp(a)}
                  >
                    {a.updateAvailable ? t('store.reinstall') : t('store.install')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Installed apps */}
      {installed.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('store.installedTitle')}</h2>
          <div className="card divide-y divide-sand-100 dark:divide-sand-800">
            {installed.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{i.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_BADGE[i.type]}`}>
                      {i.type}
                    </span>
                    {i.updateAvailable && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                        {t('store.updateAvailable')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-sand-400">
                    v{i.installedVersion}
                    {i.servingMode ? ` · ${i.servingMode}` : ''}
                    {i.deployDriver ? ` · ${i.deployDriver}` : ''} · {i.sourceName}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {i.type === 'static' && i.updateAvailable && (
                    <button
                      type="button"
                      className="btn-secondary !py-1.5 !text-xs"
                      onClick={() => void onUpdate(i.id)}
                    >
                      {t('store.update')}
                    </button>
                  )}
                  {i.type === 'static' && i.managedSource && (
                    <button
                      type="button"
                      className="btn-ghost !py-1.5 !text-xs"
                      onClick={() => setContentApp(i)}
                    >
                      {t('store.updateContent')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost !py-1.5 !text-xs text-red-500"
                    onClick={() => void onUninstall(i.id)}
                  >
                    {t('store.uninstall')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <InstallModal
        open={installApp !== null}
        app={installApp}
        config={config}
        drivers={drivers}
        onClose={() => setInstallApp(null)}
        onInstalled={() => {
          void load();
        }}
      />

      <UpdateContentModal
        open={contentApp !== null}
        app={contentApp}
        onClose={() => setContentApp(null)}
        onDone={() => {
          void load();
        }}
      />
    </div>
  );
}
