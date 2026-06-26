import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../Modal';
import { Spinner } from '../Spinner';
import { storeApi } from '../../api/store';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import type { StoreInstalled } from '../../types';

interface Props {
  open: boolean;
  app: StoreInstalled | null;
  onClose: () => void;
  onDone: () => void;
}

/** Bump the patch component of a dotted version (1.2.3 → 1.2.4). */
function bumpPatch(version: string): string {
  const parts = (version || '1.0.0').split('.');
  const last = Number(parts[parts.length - 1]);
  if (Number.isFinite(last)) parts[parts.length - 1] = String(last + 1);
  return parts.join('.');
}

export function UpdateContentModal({ open, app, onClose, onDone }: Props) {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && app) {
      setFile(null);
      setVersion(bumpPatch(app.installedVersion));
      setError(null);
    }
  }, [open, app]);

  if (!app) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError(t('store.contentFileRequired'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await storeApi.updateInstalledContent(app.id, file, version.trim() || bumpPatch(app.installedVersion));
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('store.installError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={t('store.updateContentTitle', { name: app.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('store.updateContentIntro')}</p>

        <div>
          <label className="label">{t('store.contentFile')}</label>
          <input
            type="file"
            accept=".html,.htm,.zip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-sand-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ember-500 file:px-3 file:py-1.5 file:text-white dark:text-sand-300"
          />
        </div>

        <div className="w-40">
          <label className="label">{t('store.newVersion')}</label>
          <input
            className="input"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.1"
          />
          <p className="mt-1 text-xs text-sand-400">
            {t('store.currentVersion')}: {app.installedVersion}
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {t('store.updateContentConfirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
