import { useEffect, useMemo, useState } from 'react';
import { appsApi } from '../api/apps';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp } from '../types';
import { FullPageSpinner } from '../components/Spinner';
import { AppDatabasePanel } from '../components/database/AppDatabasePanel';
import { DatabaseIcon, SearchIcon } from '../components/Icons';

/** Top-level Database hub (admin): pick an app, then browse/manage its database. */
export function DatabasePage() {
  const { t } = useI18n();
  const [apps, setApps] = useState<HostedApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { apps } = await appsApi.list();
        setApps(apps);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('db.loadError'));
        setApps([]);
      }
    })();
  }, [t]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    const q = query.trim().toLowerCase();
    return q ? apps.filter((a) => a.name.toLowerCase().includes(q)) : apps;
  }, [apps, query]);

  const selectedApp = apps?.find((a) => a.id === selected) ?? null;

  if (apps === null) return <FullPageSpinner />;

  return (
    <div className="mx-auto max-w-6xl">
      <p className="mb-5 text-sm text-sand-500 dark:text-sand-400">{t('db.hubDesc')}</p>

      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[280px_1fr]">
        {/* Left: app picker */}
        <aside className="card h-fit p-3">
          <div className="relative mb-3">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
            <input
              className="input !py-1.5 pl-8 text-sm"
              value={query}
              placeholder={t('db.searchApps')}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-sand-400">
              {apps.length === 0 ? t('db.hubNoApps') : t('dash.noMatch')}
            </p>
          ) : (
            <ul className="max-h-[65vh] space-y-0.5 overflow-y-auto">
              {filtered.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(a.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                      selected === a.id
                        ? 'bg-ember-500/15 text-ember-700 dark:text-ember-300'
                        : 'hover:bg-sand-100 dark:hover:bg-sand-800'
                    }`}
                  >
                    <DatabaseIcon className="h-4 w-4 shrink-0 text-sand-400" />
                    <span className="truncate">{a.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Right: the selected app's database */}
        <div className="min-w-0">
          {!selectedApp ? (
            <div className="card flex min-h-[240px] flex-col items-center justify-center gap-3 p-6 text-center text-sm text-sand-400">
              <DatabaseIcon className="h-10 w-10 text-sand-300 dark:text-sand-600" />
              {t('db.hubPick')}
            </div>
          ) : (
            <div>
              <h2 className="mb-4 text-lg font-semibold">{selectedApp.name}</h2>
              <AppDatabasePanel key={selectedApp.id} appId={selectedApp.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
