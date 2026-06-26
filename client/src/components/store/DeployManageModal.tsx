import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../Modal';
import { Spinner } from '../Spinner';
import { VolumesEditor } from './VolumesEditor';
import { storeApi, type VolumeMount } from '../../api/store';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import type { StoreInstalled } from '../../types';
import { PlusIcon, TrashIcon } from '../Icons';

interface Props {
  open: boolean;
  app: StoreInstalled | null;
  onClose: () => void;
  onDone: () => void;
}

interface EnvRow {
  key: string;
  value: string;
}

export function DeployManageModal({ open, app, onClose, onDone }: Props) {
  const { t } = useI18n();
  const [compose, setCompose] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [volumes, setVolumes] = useState<VolumeMount[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open && app) {
      setCompose(app.compose ?? '');
      setServiceName(app.serviceName ?? '');
      setEnv(Object.entries(app.deployEnv ?? {}).map(([key, value]) => ({ key, value })));
      setVolumes(app.volumes ?? []);
      setError(null);
      setMessage(null);
    }
  }, [open, app]);

  if (!app) return null;

  const setEnvRow = (i: number, patch: Partial<EnvRow>) => {
    const copy = env.slice();
    copy[i] = { ...copy[i], ...patch };
    setEnv(copy);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const envObj: Record<string, string> = {};
      for (const row of env) if (row.key.trim()) envObj[row.key.trim()] = row.value;
      const res = await storeApi.redeploy(app.id, {
        compose,
        env: envObj,
        volumes: volumes.filter((v) => v.name.trim() && v.mountPath.trim()),
        serviceName: serviceName.trim(),
      });
      setMessage(res.message);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('store.redeployError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={t('store.manageTitle', { name: app.name })} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('store.manageIntro')}</p>

        <div>
          <label className="label">{t('store.composePreview')}</label>
          <textarea
            className="input h-44 resize-none font-mono text-xs"
            value={compose}
            onChange={(e) => setCompose(e.target.value)}
          />
        </div>

        <div className="w-56">
          <label className="label">{t('store.serviceName')}</label>
          <input
            className="input"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder={t('store.serviceNameHint')}
          />
        </div>

        <VolumesEditor volumes={volumes} onChange={setVolumes} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">{t('store.env')}</span>
            <button
              type="button"
              className="btn-ghost !px-2 !py-1 text-xs"
              onClick={() => setEnv([...env, { key: '', value: '' }])}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {t('manifest.envAdd')}
            </button>
          </div>
          {env.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="input flex-1"
                value={row.key}
                onChange={(e) => setEnvRow(i, { key: e.target.value })}
                placeholder="KEY"
              />
              <span className="text-sand-400">=</span>
              <input
                className="input flex-1"
                value={row.value}
                onChange={(e) => setEnvRow(i, { value: e.target.value })}
                placeholder="value"
              />
              <button
                type="button"
                className="btn-ghost !px-1.5 !py-1 text-red-500"
                onClick={() => setEnv(env.filter((_, j) => j !== i))}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        {message && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            {t('common.close')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {t('store.redeploy')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
