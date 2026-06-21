import { useEffect, useState } from 'react';
import { notificationsApi } from '../api/notifications';
import { useI18n } from '../context/LanguageContext';
import type { UserNotification } from '../types';
import { Spinner } from './Spinner';
import { ChatIcon } from './Icons';

/**
 * Shows admin notifications to the current user as a blocking card they can
 * only dismiss by acknowledging (which marks it read — the admin then sees the
 * read receipt). Notifications are shown one at a time.
 */
export function UserNotifications() {
  const { t } = useI18n();
  const [queue, setQueue] = useState<UserNotification[]>([]);
  const [acking, setAcking] = useState(false);

  useEffect(() => {
    notificationsApi
      .mine()
      .then((r) => setQueue(r.notifications))
      .catch(() => setQueue([]));
  }, []);

  const current = queue[0];
  if (!current) return null;

  const acknowledge = async () => {
    setAcking(true);
    try {
      await notificationsApi.read(current.id);
      setQueue((q) => q.slice(1));
    } catch {
      /* keep it in the queue so it can be retried */
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="card w-full max-w-md animate-pop-in p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 animate-wiggle items-center justify-center rounded-full bg-gradient-to-br from-ember-500 to-ember-700 text-white">
            <ChatIcon className="h-5 w-5" />
          </span>
          <h2 className="text-lg font-semibold">{t('usernotif.title')}</h2>
        </div>

        {/* If this is a reply to a project request, show the original request. */}
        {current.requestMessage && (
          <div className="mt-4 rounded-xl border-l-2 border-ember-400 bg-sand-100 px-3 py-2 dark:bg-sand-800">
            <p className="text-xs font-medium text-sand-500 dark:text-sand-400">
              {t('usernotif.yourRequest')}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-sand-600 dark:text-sand-300">
              {current.requestMessage}
            </p>
          </div>
        )}

        <p className="mt-4 whitespace-pre-wrap text-sm text-sand-700 dark:text-sand-200">
          {current.message}
        </p>
        {queue.length > 1 && (
          <p className="mt-2 text-xs text-sand-400">{t('usernotif.more', { n: queue.length - 1 })}</p>
        )}
        <button
          type="button"
          className="btn-primary mt-6 w-full justify-center"
          onClick={acknowledge}
          disabled={acking}
        >
          {acking && <Spinner className="h-4 w-4" />}
          {t('usernotif.ack')}
        </button>
      </div>
    </div>
  );
}
