import { useCallback, useEffect, useState } from 'react';
import { databaseApi, type ConnectionStatus } from '../../api/database';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import { Loader } from '../Spinner';
import { ConnectionWizard } from './ConnectionWizard';
import { DetectedConnectionCard } from './DetectedConnectionCard';
import { DbExplorer } from './DbExplorer';

/**
 * The DB surface for a single app: fetches the connection status and shows the
 * connection wizard (when none/reconfiguring) or the explorer (when configured).
 * Shared by the per-app page (card icon) and the Database hub page. Remount it
 * with a `key={appId}` to reset all inner state when switching apps.
 */
export function AppDatabasePanel({ appId }: { appId: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconfig, setReconfig] = useState(false);
  // Set when the user picks manual entry over an auto-detected connection.
  const [manual, setManual] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatus(await databaseApi.getConnection(appId));
    setReconfig(false);
    setManual(false);
  }, [appId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setReconfig(false);
    setManual(false);
    (async () => {
      try {
        const s = await databaseApi.getConnection(appId);
        if (active) setStatus(s);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : t('db.loadError'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [appId, t]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="h-16 w-16" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="card p-6">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  const configured = status?.status === 'configured';

  if (configured && !reconfig) {
    return status.engineSupported ? (
      <DbExplorer
        appId={appId}
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
    );
  }

  // Auto-detected from the app's deploy env — offer one-click connect, with a
  // manual fallback (credentials pre-filled, password excluded).
  if (status?.status === 'detected' && !manual) {
    return (
      <DetectedConnectionCard
        appId={appId}
        detected={status.detected}
        onConnected={loadStatus}
        onManual={() => setManual(true)}
      />
    );
  }

  const initial =
    configured
      ? { type: status.connection.type, sslMode: status.connection.sslMode }
      : status?.status === 'detected'
        ? {
            type: status.detected.type,
            host: status.detected.host,
            port: status.detected.port || undefined,
            user: status.detected.user,
            database: status.detected.database,
          }
        : undefined;

  return (
    <ConnectionWizard
      appId={appId}
      initial={initial}
      onConnected={loadStatus}
      onCancel={
        manual ? () => setManual(false) : reconfig ? () => setReconfig(false) : undefined
      }
    />
  );
}
