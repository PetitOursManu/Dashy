import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import { ApiError } from '../api/client';
import { Spinner } from '../components/Spinner';
import { ShieldIcon } from '../components/Icons';

/**
 * Only allow a same-origin absolute path as a post-login redirect target, so the
 * `next` param (used by the SSO flow) can never turn login into an open redirect.
 * Rejects full URLs and protocol-relative `//host` paths.
 */
export function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  // After login, return to `next` (a server route like /api/sso/authorize needs a
  // full navigation), otherwise go to the dashboard.
  const finish = () => {
    if (next) window.location.assign(next);
    else navigate('/', { replace: true });
  };

  const [step, setStep] = useState<'credentials' | '2fa'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitCredentials = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { twoFactorRequired } = await login(email, password);
      if (twoFactorRequired) {
        setStep('2fa');
      } else {
        finish();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitToken = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyTwoFactor(token.trim());
      finish();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          {/* Full logo + wordmark; inverted to white in dark theme for legibility. */}
          <img
            src="/dashy-wordmark.png"
            alt="Dashy"
            className="h-12 w-auto dark:brightness-0 dark:invert"
          />
          <p className="mt-3 text-sm text-sand-500 dark:text-sand-400">{t('login.subtitle')}</p>
        </div>

        <div className="card p-6 sm:p-7">
          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">
                  {t('login.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  {t('login.password')}
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting && <Spinner className="h-4 w-4" />}
                {t('login.signIn')}
              </button>
            </form>
          ) : (
            <form onSubmit={submitToken} className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <ShieldIcon className="h-8 w-8 text-ember-400" />
                <h2 className="mt-2 font-medium">{t('login.twoFaTitle')}</h2>
                <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">
                  {t('login.twoFaPrompt')}
                </p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input text-center text-lg tracking-widest"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456"
                required
                autoFocus
              />

              {error && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting && <Spinner className="h-4 w-4" />}
                {t('login.verify')}
              </button>
              <button
                type="button"
                className="btn-ghost w-full"
                onClick={() => {
                  setStep('credentials');
                  setToken('');
                  setError(null);
                }}
              >
                {t('login.back')}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
