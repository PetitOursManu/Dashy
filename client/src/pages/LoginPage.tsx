import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Spinner } from '../components/Spinner';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo, ShieldIcon } from '../components/Icons';

export function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const navigate = useNavigate();

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
        navigate('/', { replace: true });
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
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-14 w-14 drop-shadow-[0_8px_16px_rgba(219,84,33,0.35)]" />
          <h1 className="mt-3 text-2xl font-bold tracking-tight">Dashy</h1>
          <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">
            Self-hosted app dashboard
          </p>
        </div>

        <div className="card p-6 sm:p-7">
          {step === 'credentials' ? (
            <form onSubmit={submitCredentials} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">
                  Email
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
                  Password
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
                Sign in
              </button>
            </form>
          ) : (
            <form onSubmit={submitToken} className="space-y-4">
              <div className="flex flex-col items-center text-center">
                <ShieldIcon className="h-8 w-8 text-ember-400" />
                <h2 className="mt-2 font-medium">Two-factor authentication</h2>
                <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">
                  Enter the 6-digit code from your authenticator app, or a backup code.
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
                Verify
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
                Back
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
