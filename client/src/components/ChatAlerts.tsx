import { useEffect, useState } from 'react';
import { chatApi } from '../api/chat';
import { useI18n } from '../context/LanguageContext';
import type { ChatAlert } from '../types';
import { AlertTriangleIcon, CloseIcon } from './Icons';

/**
 * Admin-only banner shown on the dashboard when users have repeatedly tried to
 * use the assistant for things unrelated to Dashy.
 */
export function ChatAlerts() {
  const { t } = useI18n();
  const [alerts, setAlerts] = useState<ChatAlert[]>([]);

  useEffect(() => {
    chatApi
      .alerts()
      .then((r) => setAlerts(r.alerts))
      .catch(() => setAlerts([]));
  }, []);

  const dismiss = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    try {
      await chatApi.ackAlert(id);
    } catch {
      /* best effort */
    }
  };

  if (alerts.length === 0) return null;

  return (
    <section className="card border border-amber-300/60 bg-amber-50/60 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h2 className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
        <AlertTriangleIcon className="h-5 w-5" />
        {t('chatalert.heading')}
      </h2>
      <div className="mt-3 space-y-3">
        {alerts.map((a) => (
          <div
            key={a.id}
            className="rounded-xl border border-amber-200/70 bg-white/70 p-3 dark:border-amber-500/20 dark:bg-sand-900/50"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm">
                {t('chatalert.intro', { email: a.userEmail })}
              </p>
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                className="btn-ghost !px-1.5 !py-1"
                aria-label={t('chatalert.dismiss')}
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <ul className="mt-2 space-y-1">
              {a.messages.map((m, i) => (
                <li
                  key={i}
                  className="truncate rounded-md bg-sand-100 px-2.5 py-1.5 text-xs text-sand-600 dark:bg-sand-800 dark:text-sand-300"
                  title={m}
                >
                  “{m}”
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11px] text-sand-400">
              {new Date(a.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
