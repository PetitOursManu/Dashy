import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '../Modal';
import { Spinner } from '../Spinner';
import { VolumesEditor } from './VolumesEditor';
import { storeApi, type VolumeMount } from '../../api/store';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import type { StoreCatalogApp, StoreConfig, StoreDriver } from '../../types';

interface Props {
  open: boolean;
  app: StoreCatalogApp | null;
  config: StoreConfig | null;
  drivers: StoreDriver[];
  onClose: () => void;
  onInstalled: () => void;
}

export function InstallModal({ open, app, config, drivers, onClose, onInstalled }: Props) {
  const { t } = useI18n();
  const [servingMode, setServingMode] = useState<'path' | 'subdomain'>('path');
  const [driver, setDriver] = useState('manual');
  const [env, setEnv] = useState<Record<string, string>>({});
  const [finalUrl, setFinalUrl] = useState('');
  const [compose, setCompose] = useState('');
  const [volumes, setVolumes] = useState<VolumeMount[]>([]);
  const [serviceName, setServiceName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canSubdomain = Boolean(config?.wildcardEnabled && config?.baseDomain);

  useEffect(() => {
    if (!open || !app) return;
    setServingMode('path');
    setDriver(config?.defaultDriver || drivers[0]?.id || 'manual');
    setFinalUrl('');
    setCompose(app.deploy?.docker_compose ?? '');
    setVolumes([]);
    setServiceName('');
    setError(null);
    setMessage(null);
    const initial: Record<string, string> = {};
    for (const e of app.deploy?.required_env ?? []) initial[e.key] = e.default ?? '';
    setEnv(initial);
  }, [open, app, config, drivers]);

  if (!app) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const res = await storeApi.install({
        source: app.source,
        manifestId: app.id,
        ...(app.type === 'static' ? { servingMode } : {}),
        ...(app.type === 'deploy'
          ? {
              driver,
              env,
              finalUrl,
              compose,
              ...(driver === 'docker'
                ? {
                    volumes: volumes.filter((v) => v.name.trim() && v.mountPath.trim()),
                    serviceName: serviceName.trim(),
                  }
                : {}),
            }
          : {}),
      });
      if (res.driverMessage) setMessage(res.driverMessage);
      onInstalled();
      if (!res.driverMessage) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('store.installError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={t('store.installTitle', { name: app.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-sand-500 dark:text-sand-400">{app.description}</p>

        {/* static: serving mode */}
        {app.type === 'static' && (
          <div>
            <span className="label">{t('store.serving')}</span>
            <div className="inline-flex rounded-xl border border-sand-200 p-1 dark:border-sand-700">
              <button
                type="button"
                onClick={() => setServingMode('path')}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${servingMode === 'path' ? 'bg-ember-500 text-white' : ''}`}
              >
                {t('store.servingPath')}
              </button>
              {canSubdomain && (
                <button
                  type="button"
                  onClick={() => setServingMode('subdomain')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${servingMode === 'subdomain' ? 'bg-ember-500 text-white' : ''}`}
                >
                  {t('store.servingSubdomain')}
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-sand-400">{t('store.servingHint')}</p>
          </div>
        )}

        {/* deploy: compose preview, env, driver, final URL */}
        {app.type === 'deploy' && (
          <>
            <div>
              <span className="label">{t('store.composePreview')}</span>
              <textarea
                value={compose}
                onChange={(e) => setCompose(e.target.value)}
                className="input h-40 resize-none font-mono text-xs"
              />
            </div>

            {(app.deploy?.required_env?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <span className="label">{t('store.env')}</span>
                {app.deploy!.required_env.map((e) => (
                  <div key={e.key}>
                    <label className="mb-1 block text-xs text-sand-500">{e.label || e.key}</label>
                    <input
                      className="input"
                      type={e.secret ? 'password' : 'text'}
                      value={env[e.key] ?? ''}
                      onChange={(ev) => setEnv((p) => ({ ...p, [e.key]: ev.target.value }))}
                      placeholder={e.key}
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="label" htmlFor="store-driver">
                {t('store.driver')}
              </label>
              <select
                id="store-driver"
                className="input"
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
              >
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {driver === 'docker' && (
              <>
                <VolumesEditor volumes={volumes} onChange={setVolumes} />
                <div className="w-56">
                  <label className="label" htmlFor="store-service">
                    {t('store.serviceName')}
                  </label>
                  <input
                    id="store-service"
                    className="input"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder={t('store.serviceNameHint')}
                  />
                </div>
              </>
            )}

            <div>
              <label className="label" htmlFor="store-url">
                {t('store.finalUrl')}
              </label>
              <input
                id="store-url"
                className="input"
                type="url"
                value={finalUrl}
                onChange={(e) => setFinalUrl(e.target.value)}
                placeholder="https://app.example.com"
                required
              />
              <p className="mt-1 text-xs text-sand-400">{t('store.finalUrlHint')}</p>
            </div>
          </>
        )}

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
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {t('store.install')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
