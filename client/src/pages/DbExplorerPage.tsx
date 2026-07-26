import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { appsApi } from '../api/apps';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp } from '../types';
import { FullPageSpinner } from '../components/Spinner';
import { AppDatabasePanel } from '../components/database/AppDatabasePanel';
import { DatabaseIcon } from '../components/Icons';

/** Per-app DB Explorer page, reached from the 🗄️ action on an app card. */
export function DbExplorerPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [app, setApp] = useState<HostedApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { app } = await appsApi.get(id);
        setApp(app);
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

      <AppDatabasePanel appId={id} />
    </div>
  );
}
