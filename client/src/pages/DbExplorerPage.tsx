import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { appsApi } from '../api/apps';
import { databaseApi, type ConnectionStatus } from '../api/database';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp } from '../types';
import { FullPageSpinner } from '../components/Spinner';
import { ConnectionWizard } from '../components/database/ConnectionWizard';
import { DbExplorer } from '../components/database/DbExplorer';
import { DatabaseIcon } from '../components/Icons';

/** Per-app DB Explorer page (admin-only): wizard when unconfigured, else grid. */
export function DbExplorerPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [app, setApp] = useState<HostedApp | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconfig, setReconfig] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!id) return;
    setStatus(await databaseApi.getConnection(id));
    setReconfig(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const [appRes, statusRes] = await Promise.all([
          appsApi.get(id),
          databaseApi.getConnection(id),
        ]);
        setApp(appRes.app);
        setStatus(statusRes);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('db.loadError'));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, t]);

  if (loading) return <FullPageSpinner />;
  if (!id || error) {
    return (
      <div className="card p-6">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? t('edit.notFound')}</p>
        <Link to="/" className="btn-secondary mt-4">
          {t('edit.back')}
        </Link>
      </div>
    );
  }

  const configured = status?.status === 'configured';

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <Link to="/" className="text-sm font-medium text-ember-500 hover:underline">
          ← {t('edit.back')}
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
          <DatabaseIcon className="h-6 w-6 text-ember-500" />
          {t('db.title')}
        </h1>
        {app && <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">{app.name}</p>}
      </div>

      {configured && !reconfig ? (
        status.engineSupported ? (
          <DbExplorer
            appId={id}
            connection={status.connection}
            onDisconnect={loadStatus}
            onReconfigure={() => setReconfig(true)}
          />
        ) : (
          <div className="card p-6">
            <p className="text-sm text-amber-700 dark:text-amber-300">{t('db.engineNotYet')}</p>
            <button type="button" className="btn-secondary mt-4" onClick={() => setReconfig(true)}>
              {t('db.reconfigure')}
            </button>
          </div>
        )
      ) : (
        <ConnectionWizard
          appId={id}
          initial={
            configured
              ? { type: status.connection.type, sslMode: status.connection.sslMode }
              : undefined
          }
          onConnected={loadStatus}
          onCancel={reconfig ? () => setReconfig(false) : undefined}
        />
      )}
    </div>
  );
}
