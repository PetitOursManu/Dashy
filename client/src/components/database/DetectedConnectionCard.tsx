import { useState } from 'react';
import { databaseApi, type DetectedMeta, type SslMode } from '../../api/database';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import { Spinner } from '../Spinner';
import { DatabaseIcon } from '../Icons';

const ENGINE_LABEL: Record<string, string> = {
  postgresql: 'db.enginePostgres',
  mysql: 'db.engineMysql',
  mongodb: 'db.engineMongo',
  sqlite: 'db.engineSqlite',
  redis: 'db.engineRedis',
};

interface Props {
  appId: string;
  detected: DetectedMeta;
  onConnected: () => void;
  onManual: () => void;
}

/**
 * One-click connect for a connection Dashy detected in the app's deploy env.
 * The password is never shown or sent — it's applied server-side. The admin
 * only confirms the host/port reachable from Dashy (often different from the
 * internal compose service name the app itself uses).
 */
export function DetectedConnectionCard({ appId, detected, onConnected, onManual }: Props) {
  const { t } = useI18n();
  const [host, setHost] = useState(detected.host);
  const [port, setPort] = useState(detected.port ? String(detected.port) : '');
  const [sslMode, setSslMode] = useState<SslMode>('disable');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await databaseApi.saveDetected(appId, {
        host: host.trim(),
        port: port ? Number(port) : undefined,
        sslMode,
      });
      if (res.ok === false) {
        setError(res.error || t('db.testFail'));
        return;
      }
      onConnected();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('db.testFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <DatabaseIcon className="h-5 w-5 text-ember-500" />
        {t('db.detectedTitle')}
      </h2>
      <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">{t('db.detectedDesc')}</p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-sand-200 bg-sand-50 p-4 text-sm dark:border-sand-700 dark:bg-sand-800/50 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-sand-400">{t('db.engine')}</dt>
          <dd className="font-medium">{t(ENGINE_LABEL[detected.type] ?? 'db.engine')}</dd>
        </div>
        {detected.user && (
          <div>
            <dt className="text-xs text-sand-400">{t('db.user')}</dt>
            <dd className="truncate font-medium" title={detected.user}>
              {detected.user}
            </dd>
          </div>
        )}
        {detected.database && (
          <div>
            <dt className="text-xs text-sand-400">{t('db.database')}</dt>
            <dd className="truncate font-medium" title={detected.database}>
              {detected.database}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-sand-400">{t('db.password')}</dt>
          <dd className="font-medium">{detected.hasPassword ? t('db.detectedPassword') : '—'}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">{t('db.host')}</label>
          <input
            className="input"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="host.docker.internal"
          />
        </div>
        <div>
          <label className="label">{t('db.port')}</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-sand-400">{t('db.detectedHostHint')}</p>

      <div className="mt-3">
        <label className="label">{t('db.ssl')}</label>
        <select
          className="input sm:w-56"
          value={sslMode}
          onChange={(e) => setSslMode(e.target.value as SslMode)}
        >
          <option value="disable">{t('db.sslDisable')}</option>
          <option value="require">{t('db.sslRequire')}</option>
        </select>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={connect}
          disabled={busy || host.trim().length === 0}
        >
          {busy && <Spinner className="h-4 w-4" />}
          {t('db.connect')}
        </button>
        <button type="button" className="btn-ghost" onClick={onManual}>
          {t('db.enterManually')}
        </button>
      </div>
    </section>
  );
}
