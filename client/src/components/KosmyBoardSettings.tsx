import { useEffect, useState } from 'react';
import { useI18n } from '../context/LanguageContext';
import { kosmyBoardApi } from '../api/kosmyBoard';
import { ApiError } from '../api/client';
import { Spinner } from './Spinner';
import { GridIcon } from './Icons';
import type { KosmyBoardAdmin } from '../types';

/** One read-only address with a copy button. */
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (http): the field stays selectable */
    }
  };
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="input font-mono text-xs"
          value={value}
          readOnly
          onFocus={(e) => e.target.select()}
        />
        <button type="button" className="btn-secondary shrink-0" onClick={copy}>
          {copied ? t('kosmy.copied') : t('kosmy.copy')}
        </button>
      </div>
    </div>
  );
}

/** Admin settings for "Sign in with Kosmy Board" (Settings page). */
export function KosmyBoardSettings() {
  const { t } = useI18n();
  const [data, setData] = useState<KosmyBoardAdmin | null>(null);
  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [autoCreate, setAutoCreate] = useState(false);
  const [requireDashy2fa, setRequireDashy2fa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (d: KosmyBoardAdmin) => {
    setData(d);
    setIssuer(d.config.issuer);
    setClientId(d.config.clientId);
    setAutoCreate(d.config.autoCreate);
    setRequireDashy2fa(d.config.requireDashy2fa);
  };

  useEffect(() => {
    kosmyBoardApi
      .getConfig()
      .then(apply)
      .catch(() => setError(t('kosmy.cfg.loadError')));
  }, [t]);

  const save = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const d = await kosmyBoardApi.updateConfig({
        issuer,
        clientId,
        autoCreate,
        requireDashy2fa,
        ...(clientSecret ? { clientSecret } : {}),
      });
      apply(d);
      setClientSecret('');
      setMessage(t('kosmy.cfg.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kosmy.cfg.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      apply(await kosmyBoardApi.updateConfig({ clearClientSecret: true }));
      setClientSecret('');
      setMessage(t('kosmy.cfg.disabled'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('kosmy.cfg.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const checkbox = 'h-4 w-4 rounded border-sand-300 text-ember-500 focus:ring-ember-400';

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <GridIcon className="h-5 w-5 text-ember-500" />
            {t('kosmy.cfg.title')}
          </h2>
          <p className="text-sm text-sand-500 dark:text-sand-400">{t('kosmy.cfg.desc')}</p>
        </div>
        {data && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              data.enabled
                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                : 'bg-sand-200 text-sand-600 dark:bg-sand-800 dark:text-sand-300'
            }`}
          >
            {data.enabled ? t('kosmy.cfg.on') : t('kosmy.cfg.off')}
          </span>
        )}
      </div>

      {data && (
        <div className="mt-4 space-y-4">
          <p className="text-xs text-sand-500 dark:text-sand-400">{t('kosmy.cfg.urlsHint')}</p>
          <div className="grid gap-4">
            <CopyField
              id="kosmy-redirect"
              label={t('kosmy.cfg.redirectUri')}
              value={data.redirectUri}
            />
            <CopyField
              id="kosmy-initiate"
              label={t('kosmy.cfg.initiateUri')}
              value={data.initiateLoginUri}
            />
          </div>

          <div>
            <label className="label" htmlFor="kosmy-issuer">
              {t('kosmy.cfg.issuer')}
            </label>
            <input
              id="kosmy-issuer"
              className="input"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://board.example.com/oidc"
              autoComplete="off"
              name="kosmy-issuer"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="kosmy-client-id">
                {t('kosmy.cfg.clientId')}
              </label>
              <input
                id="kosmy-client-id"
                className="input"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
                name="kosmy-client-id"
              />
            </div>
            <div>
              <label className="label" htmlFor="kosmy-client-secret">
                {t('kosmy.cfg.clientSecret')}
              </label>
              <input
                id="kosmy-client-secret"
                type="password"
                className="input"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                autoComplete="new-password"
                name="kosmy-client-secret"
                placeholder={
                  data.config.hasClientSecret
                    ? t('kosmy.cfg.secretSet')
                    : t('kosmy.cfg.secretPlaceholder')
                }
              />
              <p className="mt-1 text-xs text-sand-400">{t('kosmy.cfg.secretHint')}</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className={`${checkbox} mt-0.5`}
              checked={autoCreate}
              onChange={(e) => setAutoCreate(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('kosmy.cfg.autoCreate')}</span>
              <span className="block text-xs text-sand-500 dark:text-sand-400">
                {t('kosmy.cfg.autoCreateHint')}
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              className={`${checkbox} mt-0.5`}
              checked={requireDashy2fa}
              onChange={(e) => setRequireDashy2fa(e.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">{t('kosmy.cfg.require2fa')}</span>
              <span className="block text-xs text-sand-500 dark:text-sand-400">
                {t('kosmy.cfg.require2faHint')}
              </span>
            </span>
          </label>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          {message}
        </p>
      )}

      {data && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>
            {busy && <Spinner className="h-4 w-4" />}
            {t('kosmy.cfg.save')}
          </button>
          {data.config.hasClientSecret && (
            <button
              type="button"
              className="btn-ghost text-red-500"
              onClick={disable}
              disabled={busy}
            >
              {t('kosmy.cfg.disable')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
