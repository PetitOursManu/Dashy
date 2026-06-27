import { useEffect, useState } from 'react';
import { useI18n } from '../context/LanguageContext';
import { ClockIcon } from './Icons';

/** Dashboard banner for temporary accounts: time left before expiry. */
export function TempCountdown({ expiresAt }: { expiresAt?: string | null }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!expiresAt) return null;

  const remaining = Math.max(0, new Date(expiresAt).getTime() - now);
  const totalMin = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  // Light-red warning when under 12 hours remain.
  const urgent = remaining <= 12 * 3_600_000;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}${t('temp.d')}`);
  if (days > 0 || hours > 0) parts.push(`${hours}${t('temp.h')}`);
  parts.push(`${minutes}${t('temp.m')}`);

  return (
    <div
      className={`card flex items-center gap-3 p-4 ${
        urgent ? 'border-red-300 bg-red-500/10 dark:border-red-500/40' : ''
      }`}
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-xl ${
          urgent ? 'bg-red-500/15 text-red-500' : 'bg-ember-500/15 text-ember-500'
        }`}
      >
        <ClockIcon className="h-5 w-5" />
      </span>
      <div className={urgent ? 'text-red-600 dark:text-red-400' : ''}>
        <p className="text-sm font-semibold">{t('temp.timeLeft')}</p>
        <p className="text-xs">
          {remaining <= 0 ? t('temp.expired') : t('temp.expiresIn', { time: parts.join(' ') })}
        </p>
      </div>
    </div>
  );
}
