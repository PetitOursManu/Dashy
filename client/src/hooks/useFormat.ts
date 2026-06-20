import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';

/**
 * Date/time formatters that respect the user's timezone and date-format
 * preferences (set in Settings) and the active language.
 */
export function useFormat() {
  const { user } = useAuth();
  const { t } = useI18n();
  const tz = user?.timezone || undefined;
  const fmt = user?.dateFormat || '';

  const parts = (iso: string): Record<string, string> => {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const out: Record<string, string> = {};
    for (const p of f.formatToParts(new Date(iso))) out[p.type] = p.value;
    return out;
  };

  const formatDate = (iso: string): string => {
    if (fmt === 'iso' || fmt === 'dmy' || fmt === 'mdy') {
      const p = parts(iso);
      if (fmt === 'iso') return `${p.year}-${p.month}-${p.day}`;
      if (fmt === 'dmy') return `${p.day}/${p.month}/${p.year}`;
      return `${p.month}/${p.day}/${p.year}`;
    }
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  };

  const relativeTime = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const s = Math.round(diff / 1000);
    if (s < 60) return t('time.justNow');
    const m = Math.round(s / 60);
    if (m < 60) return t('time.minAgo', { n: m });
    const h = Math.round(m / 60);
    if (h < 24) return t('time.hourAgo', { n: h });
    const d = Math.round(h / 24);
    if (d < 7) return t('time.dayAgo', { n: d });
    return formatDate(iso);
  };

  return { formatDate, relativeTime };
}
