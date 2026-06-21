import { useCallback, useEffect, useState } from 'react';
import { requestsApi } from '../api/requests';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import { useFormat } from '../hooks/useFormat';
import type { ProjectRequest, ProjectRequestStatus } from '../types';
import { Avatar } from '../components/Avatar';
import { Spinner } from '../components/Spinner';
import { SendIcon } from '../components/Icons';

type Filter = 'all' | 'archived' | ProjectRequestStatus;

const FILTERS: Filter[] = ['all', 'pending', 'resolved', 'dismissed', 'archived'];

const STATUS_STYLES: Record<ProjectRequestStatus, string> = {
  pending: 'bg-sand-200 text-sand-600 dark:bg-sand-800 dark:text-sand-300',
  resolved: 'bg-green-500/15 text-green-600 dark:text-green-400',
  dismissed: 'bg-red-500/10 text-red-500',
};

export function RequestsPage() {
  const { t } = useI18n();
  const { relativeTime } = useFormat();
  const [requests, setRequests] = useState<ProjectRequest[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    try {
      const { requests } = await requestsApi.adminList(f);
      setRequests(requests);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const update = (updated: ProjectRequest) =>
    setRequests((prev) => {
      // Drop it if it no longer matches the active filter.
      if (filter !== 'all' && updated.status !== filter) {
        return prev.filter((r) => r.id !== updated.id);
      }
      return prev.map((r) => (r.id === updated.id ? updated : r));
    });

  const statusLabel = (s: ProjectRequestStatus) =>
    s === 'resolved'
      ? t('req.statusResolved')
      : s === 'dismissed'
        ? t('req.statusDismissed')
        : t('req.statusPending');

  const setStatus = async (id: string, status: ProjectRequestStatus) => {
    try {
      const { request } = await requestsApi.setStatus(id, status);
      update(request);
    } catch {
      /* ignore */
    }
  };

  const archive = async (id: string, archived: boolean) => {
    try {
      await requestsApi.archive(id, archived);
      await load(filter);
      window.dispatchEvent(new Event('dashy:requests-changed'));
    } catch {
      /* ignore */
    }
  };

  const sendReply = async (id: string) => {
    if (!replyText.trim()) return;
    setReplyBusy(true);
    try {
      const { request } = await requestsApi.reply(id, replyText.trim());
      update(request);
      setReplyingId(null);
      setReplyText('');
      window.dispatchEvent(new Event('dashy:requests-changed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('req.error'));
    } finally {
      setReplyBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('requests.subtitle')}</p>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-ember-500 text-white shadow-sm'
                  : 'border border-sand-200 bg-white/60 text-sand-600 hover:bg-white dark:border-sand-700 dark:bg-sand-800/60 dark:text-sand-300'
              }`}
            >
              {f === 'all'
                ? t('requests.filterAll')
                : f === 'archived'
                  ? t('requests.filterArchived')
                  : statusLabel(f)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-ember-500" />
        </div>
      ) : requests.length === 0 ? (
        <div className="card px-6 py-16 text-center text-sm text-sand-500 dark:text-sand-400">
          {t('requests.empty')}
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((r) => (
            <div key={r.id} className="card animate-slide-in p-5">
              <div className="flex items-start gap-3">
                <Avatar email={r.userEmail} className="h-9 w-9 text-xs" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.userEmail}</span>
                    <span className="rounded-full bg-ember-500/15 px-2 py-0.5 text-xs font-medium text-ember-600 dark:text-ember-300">
                      {r.kind === 'file' ? t('req.kindFile') : t('req.kindIdea')}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                    <span className="text-xs text-sand-400">{relativeTime(r.createdAt)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{r.message}</p>

                  {/* Reply box */}
                  {replyingId === r.id ? (
                    <div className="mt-3">
                      <textarea
                        className="input min-h-[70px] resize-none"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder={t('requests.replyPlaceholder')}
                        maxLength={1000}
                        autoFocus
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="btn-primary !py-1.5 !text-xs"
                          onClick={() => void sendReply(r.id)}
                          disabled={replyBusy || !replyText.trim()}
                        >
                          {replyBusy ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
                          {t('requests.sendReply')}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !text-xs"
                          onClick={() => {
                            setReplyingId(null);
                            setReplyText('');
                          }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-primary !py-1.5 !text-xs"
                        onClick={() => {
                          setReplyingId(r.id);
                          setReplyText('');
                        }}
                      >
                        {t('requests.reply')}
                      </button>
                      {r.status !== 'resolved' && (
                        <button
                          type="button"
                          className="btn-secondary !py-1.5 !text-xs"
                          onClick={() => void setStatus(r.id, 'resolved')}
                        >
                          {t('notif.markDone')}
                        </button>
                      )}
                      {!r.archived && r.status !== 'dismissed' && (
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !text-xs text-red-500"
                          onClick={() => void setStatus(r.id, 'dismissed')}
                        >
                          {t('notif.dismiss')}
                        </button>
                      )}
                      {r.archived ? (
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !text-xs"
                          onClick={() => void archive(r.id, false)}
                        >
                          {t('requests.unarchive')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-ghost !py-1.5 !text-xs"
                          onClick={() => void archive(r.id, true)}
                        >
                          {t('requests.archive')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
