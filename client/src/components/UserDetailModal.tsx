import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { usersApi } from '../api/users';
import { notificationsApi } from '../api/notifications';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { User, UserHistory } from '../types';
import { ChartIcon, ShieldIcon, SparkleIcon } from './Icons';

interface Props {
  open: boolean;
  user: User | null;
  onClose: () => void;
}

const TIMEOUT_OPTIONS: { minutes: number; key: string }[] = [
  { minutes: 15, key: 'userdetail.to15m' },
  { minutes: 60, key: 'userdetail.to1h' },
  { minutes: 1440, key: 'userdetail.to24h' },
  { minutes: 10080, key: 'userdetail.to7d' },
];

export function UserDetailModal({ open, user, onClose }: Props) {
  const { t } = useI18n();
  const [history, setHistory] = useState<UserHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [timeoutBusy, setTimeoutBusy] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setHistory(null);
    setError(null);
    setMessage('');
    setSent(false);
    setLoading(true);
    usersApi
      .history(user.id)
      .then(setHistory)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load history.'))
      .finally(() => setLoading(false));
  }, [open, user]);

  const applyTimeout = async (minutes: number | null) => {
    if (!user) return;
    setTimeoutBusy(true);
    try {
      const { chatTimeoutUntil } = await usersApi.setChatTimeout(user.id, minutes);
      setHistory((h) => (h ? { ...h, chatTimeoutUntil } : h));
    } catch {
      /* ignore */
    } finally {
      setTimeoutBusy(false);
    }
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !message.trim()) return;
    setSending(true);
    setSent(false);
    setError(null);
    try {
      await notificationsApi.createForUser(user.id, message.trim());
      setMessage('');
      setSent(true);
      // Reflect it in the in-modal notification list immediately.
      const fresh = await usersApi.history(user.id);
      setHistory(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the notification.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal open={open} title={t('userdetail.title', { email: user?.email ?? '' })} onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-7 w-7 text-ember-500" />
        </div>
      ) : !history ? (
        <p className="py-6 text-center text-sm text-sand-400">{error ?? '—'}</p>
      ) : (
        <div className="space-y-5">
          {/* Status badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1 text-xs font-medium dark:bg-sand-800">
              <ShieldIcon className="h-3.5 w-3.5" />
              {t('userdetail.twofa')}:{' '}
              <span className={history.twoFactorEnabled ? 'text-green-600 dark:text-green-400' : 'text-sand-400'}>
                {history.twoFactorEnabled ? t('dash.on') : t('dash.off')}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1 text-xs font-medium dark:bg-sand-800">
              <SparkleIcon className="h-3.5 w-3.5" />
              {t('userdetail.botAlerts', { n: history.botAlertCount })}
            </span>
          </div>

          {/* Most-used apps */}
          <section>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ChartIcon className="h-4 w-4 text-ember-500" />
              {t('userdetail.topApps')}
            </h3>
            {history.topApps.length === 0 ? (
              <p className="mt-2 text-sm text-sand-400">{t('userdetail.noOpens')}</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {history.topApps.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{a.name}</span>
                    <span className="shrink-0 text-sand-400">{t('userdetail.opens', { n: a.opens })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* DashyBot: alerts + time-out */}
          <section className="rounded-xl border border-sand-200 p-3 dark:border-sand-700">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <SparkleIcon className="h-4 w-4 text-ember-500" />
              {t('userdetail.botSection')}
            </h3>
            {history.recentBotMessages.length > 0 && (
              <ul className="mt-2 space-y-1">
                {history.recentBotMessages.map((m, i) => (
                  <li
                    key={i}
                    className="truncate rounded-md bg-sand-100 px-2.5 py-1.5 text-xs text-sand-600 dark:bg-sand-800 dark:text-sand-300"
                    title={m}
                  >
                    “{m}”
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <span className="label">{t('userdetail.timeout')}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {TIMEOUT_OPTIONS.map((o) => (
                  <button
                    key={o.minutes}
                    type="button"
                    disabled={timeoutBusy}
                    onClick={() => void applyTimeout(o.minutes)}
                    className="rounded-full border border-sand-200 px-3 py-1 text-xs font-medium hover:bg-sand-100 disabled:opacity-50 dark:border-sand-700 dark:hover:bg-sand-800"
                  >
                    {t(o.key)}
                  </button>
                ))}
                {history.chatTimeoutUntil && (
                  <button
                    type="button"
                    disabled={timeoutBusy}
                    onClick={() => void applyTimeout(null)}
                    className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-500 hover:bg-red-500/10 disabled:opacity-50 dark:border-red-500/40"
                  >
                    {t('userdetail.toClear')}
                  </button>
                )}
                {timeoutBusy && <Spinner className="h-4 w-4 text-ember-500" />}
              </div>
              <p className="mt-1 text-xs text-sand-400">
                {history.chatTimeoutUntil
                  ? t('userdetail.timeoutActive', {
                      time: new Date(history.chatTimeoutUntil).toLocaleString(),
                    })
                  : t('userdetail.timeoutNone')}
              </p>
            </div>
          </section>

          {/* Send a dashboard notification */}
          <section>
            <h3 className="text-sm font-semibold">{t('userdetail.sendTitle')}</h3>
            <form onSubmit={send} className="mt-2 space-y-2">
              <textarea
                className="input min-h-[72px] resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('userdetail.sendPlaceholder')}
                maxLength={1000}
              />
              {sent && (
                <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
                  {t('userdetail.sent')}
                </p>
              )}
              {error && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
              <button type="submit" className="btn-primary" disabled={sending || !message.trim()}>
                {sending && <Spinner className="h-4 w-4" />}
                {t('userdetail.send')}
              </button>
            </form>
          </section>

          {/* Notifications already sent to this user */}
          {history.notifications.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold">{t('userdetail.notifications')}</h3>
              <ul className="mt-2 space-y-1.5">
                {history.notifications.map((n) => (
                  <li key={n.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate" title={n.message}>
                      {n.message}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        n.readAt
                          ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : 'bg-sand-200 text-sand-500 dark:bg-sand-800'
                      }`}
                    >
                      {n.readAt ? t('userdetail.read') : t('userdetail.unread')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
