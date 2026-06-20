import { useState } from 'react';
import { useI18n } from '../context/LanguageContext';

export function BackupCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const text = codes.join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    const blob = new Blob([`Dashy backup codes\n\n${text}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dashy-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-lg border border-sand-200 bg-sand-50 p-3 dark:border-sand-700 dark:bg-sand-800/50">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-2">
        {codes.map((c) => (
          <li key={c} className="tabular-nums">
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary !py-1 !text-xs" onClick={copy}>
          {copied ? t('backup.copied') : t('backup.copy')}
        </button>
        <button type="button" className="btn-secondary !py-1 !text-xs" onClick={download}>
          {t('backup.download')}
        </button>
      </div>
      <p className="mt-2 text-xs text-sand-400">{t('backup.hint')}</p>
    </div>
  );
}
