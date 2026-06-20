import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/auth';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import type { TwoFactorSetup } from '../types';
import { Spinner } from '../components/Spinner';
import { ShieldIcon } from '../components/Icons';
import { BackupCodes } from '../components/BackupCodes';

export function SecurityPage() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-sm text-sand-500 dark:text-sand-400">{t('sec.subtitle')}</p>
      <TwoFactorSection enabled={user?.twoFactorEnabled ?? false} onChange={refresh} />
      <PasswordSection />
      <SignOutAllSection />
    </div>
  );
}

// --------------------------- sign out everywhere ----------------------------

function SignOutAllSection() {
  const { t } = useI18n();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const signOutAll = async () => {
    setBusy(true);
    try {
      await authApi.logoutAll();
    } catch {
      /* even on error, drop the local session below */
    } finally {
      setUser(null);
      navigate('/login', { replace: true });
    }
  };

  return (
    <section className="card p-6">
      <h2 className="font-semibold">{t('sec.signOutAllTitle')}</h2>
      <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">{t('sec.signOutAllDesc')}</p>
      <button type="button" className="btn-secondary mt-4" onClick={signOutAll} disabled={busy}>
        {busy && <Spinner className="h-4 w-4" />}
        {t('sec.signOutAll')}
      </button>
    </section>
  );
}

// ------------------------------- 2FA section --------------------------------

function TwoFactorSection({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const startSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      setSetup(await authApi.setupTwoFactor());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start setup.');
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.enableTwoFactor(token.trim());
      setSetup(null);
      setToken('');
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await authApi.disableTwoFactor(password);
      setPassword('');
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not disable 2FA.');
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setError(null);
    setBusy(true);
    try {
      const { backupCodes } = await authApi.regenerateBackupCodes();
      setNewCodes(backupCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not regenerate codes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldIcon className="mt-0.5 h-6 w-6 text-ember-400" />
          <div>
            <h2 className="font-semibold">{t('sec.twoFaTitle')}</h2>
            <p className="text-sm text-sand-500 dark:text-sand-400">
              {enabled ? t('sec.twoFaOn') : t('sec.twoFaOff')}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
            enabled
              ? 'bg-green-500/15 text-green-600 dark:text-green-400'
              : 'bg-sand-200 text-sand-600 dark:bg-sand-800 dark:text-sand-300'
          }`}
        >
          {enabled ? t('sec.statusOn') : t('sec.statusOff')}
        </span>
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {!enabled && !setup && (
        <button type="button" className="btn-primary mt-5" onClick={startSetup} disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          {t('sec.enable')}
        </button>
      )}

      {!enabled && setup && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <img
              src={setup.qrDataUrl}
              alt="2FA QR code"
              className="h-44 w-44 shrink-0 rounded-lg bg-white p-2"
            />
            <div className="space-y-2 text-sm">
              <p className="text-sand-600 dark:text-sand-300">{t('sec.step1')}</p>
              <p className="text-sand-600 dark:text-sand-300">{t('sec.step2')}</p>
              <code className="block break-all rounded-md bg-sand-100 px-2 py-1.5 font-mono text-xs dark:bg-sand-800">
                {setup.secret}
              </code>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-sand-700 dark:text-sand-300">
              {t('sec.saveBackup')}
            </p>
            <BackupCodes codes={setup.backupCodes} />
          </div>

          <form onSubmit={confirmEnable} className="space-y-3">
            <label className="label" htmlFor="enable-token">
              {t('sec.step3')}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="enable-token"
                className="input max-w-[12rem] text-center tracking-widest"
                inputMode="numeric"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456"
                required
              />
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy && <Spinner className="h-4 w-4" />}
                {t('sec.confirmEnable')}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setSetup(null);
                  setToken('');
                  setError(null);
                }}
              >
                {t('sec.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {enabled && (
        <div className="mt-5 space-y-5">
          {newCodes && (
            <div>
              <p className="mb-2 text-sm font-medium text-sand-700 dark:text-sand-300">
                {t('sec.newBackup')}
              </p>
              <BackupCodes codes={newCodes} />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={regenerate} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {t('sec.regenerate')}
            </button>
          </div>

          <form
            onSubmit={disable}
            className="space-y-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4"
          >
            <p className="text-sm font-medium text-sand-700 dark:text-sand-300">
              {t('sec.disableTitle')}
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                className="input max-w-xs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('sec.confirmPw')}
                autoComplete="current-password"
                required
              />
              <button type="submit" className="btn-danger" disabled={busy}>
                {busy && <Spinner className="h-4 w-4" />}
                {t('sec.disable')}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

// ----------------------------- password section -----------------------------

function PasswordSection() {
  const { t } = useI18n();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword !== confirm) {
      setError(t('sec.pwMismatch'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('sec.pwShort'));
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-6">
      <h2 className="font-semibold">{t('sec.changePw')}</h2>
      <form onSubmit={submit} className="mt-4 space-y-4">
        <div>
          <label className="label" htmlFor="current">
            {t('sec.currentPw')}
          </label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            className="input max-w-sm"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="new">
            {t('sec.newPw')}
          </label>
          <input
            id="new"
            type="password"
            autoComplete="new-password"
            className="input max-w-sm"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="confirm">
            {t('sec.confirmNewPw')}
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="input max-w-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {done && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {t('sec.pwUpdated')}
          </p>
        )}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          {t('sec.updatePw')}
        </button>
      </form>
    </section>
  );
}
