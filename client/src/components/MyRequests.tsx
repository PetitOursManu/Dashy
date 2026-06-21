import { useCallback, useEffect, useState } from 'react';
import { requestsApi } from '../api/requests';
import { useI18n } from '../context/LanguageContext';
import { useFormat } from '../hooks/useFormat';
import type { ProjectRequest, ProjectRequestStatus } from '../types';
import { InboxIcon } from './Icons';
import { TileDecor } from './TileDecor';

const STATUS_STYLES: Record<ProjectRequestStatus, string> = {
  pending: 'bg-sand-200 text-sand-600 dark:bg-sand-800 dark:text-sand-300',
  resolved: 'bg-green-500/15 text-green-600 dark:text-green-400',
  dismissed: 'bg-red-500/10 text-red-500',
};

/** A user's history of project requests sent to the admins. */
export function MyRequests() {
  const { t } = useI18n();
  const { relativeTime } = useFormat();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);

  const load = useCallback(() => {
    requestsApi
      .mine()
      .then((r) => setRequests(r.requests))
      .catch(() => setRequests([]));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener('dashy:requests-changed', load);
    return () => window.removeEventListener('dashy:requests-changed', load);
  }, [load]);

  const statusLabel = (s: ProjectRequestStatus) =>
    s === 'resolved'
      ? t('req.statusResolved')
      : s === 'dismissed'
        ? t('req.statusDismissed')
        : t('req.statusPending');

  return (
    <div className="card relative flex flex-col overflow-hidden p-5">
      <TileDecor variant="waves" />
      <h3 className="relative mb-3 flex items-center gap-2 font-semibold">
        <span className="text-ember-500">
          <InboxIcon className="h-5 w-5" />
        </span>
        {t('myreq.title')}
      </h3>
      {requests.length === 0 ? (
        <p className="py-6 text-center text-sm text-sand-400">{t('myreq.empty')}</p>
      ) : (
        <ul className="relative space-y-2">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl border border-sand-200 px-3 py-2 dark:border-sand-700">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-ember-600 dark:text-ember-300">
                  {r.kind === 'file' ? t('req.kindFile') : t('req.kindIdea')}
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[r.status]}`}
                >
                  {statusLabel(r.status)}
                </span>
              </div>
              <p className="mt-1 text-sm">{r.message}</p>
              <p className="mt-1 text-[11px] text-sand-400">{relativeTime(r.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
