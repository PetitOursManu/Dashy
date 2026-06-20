import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { usersApi } from '../api/users';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp, User } from '../types';

interface UserFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  user?: User | null;
  apps: HostedApp[];
  onClose: () => void;
  onSaved: (user: User) => void;
}

export function UserFormModal({ open, mode, user, apps, onClose, onSaved }: UserFormModalProps) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [chatEnabled, setChatEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the form whenever it is (re)opened.
  useEffect(() => {
    if (!open) return;
    setEmail(user?.email ?? '');
    setPassword('');
    setRole(user?.role ?? 'user');
    setAllowed(new Set(user?.allowedApps ?? []));
    setChatEnabled(user?.chatEnabled ?? true);
    setError(null);
  }, [open, user]);

  const toggleApp = (id: string) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const allowedApps = role === 'admin' ? [] : [...allowed];
      if (mode === 'create') {
        const { user } = await usersApi.create({
          email,
          password,
          role,
          allowedApps,
          chatEnabled,
        });
        onSaved(user);
      } else if (user) {
        const { user: updated } = await usersApi.update(user.id, {
          role,
          allowedApps,
          chatEnabled,
          ...(password ? { password } : {}),
        });
        onSaved(updated);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the user.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={mode === 'create' ? t('form.addTitle') : t('form.editTitle', { email: user?.email ?? '' })}
      onClose={submitting ? () => {} : onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="user-email">
            {t('form.email')}
          </label>
          <input
            id="user-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={mode === 'edit'}
            autoComplete="off"
          />
        </div>

        <div>
          <label className="label" htmlFor="user-password">
            {mode === 'create' ? t('form.password') : t('form.newPassword')}
            {mode === 'edit' && (
              <span className="font-normal text-sand-400"> {t('form.keepBlank')}</span>
            )}
          </label>
          <input
            id="user-password"
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required={mode === 'create'}
            autoComplete="new-password"
          />
        </div>

        <div>
          <label className="label" htmlFor="user-role">
            {t('form.role')}
          </label>
          <select
            id="user-role"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'user')}
          >
            <option value="user">{t('form.roleUserOpt')}</option>
            <option value="admin">{t('form.roleAdminOpt')}</option>
          </select>
        </div>

        <div>
          <span className="label">{t('form.appAccess')}</span>
          {role === 'admin' ? (
            <p className="rounded-lg bg-sand-100 px-3 py-2 text-sm text-sand-500 dark:bg-sand-800 dark:text-sand-400">
              {t('form.adminAll')}
            </p>
          ) : apps.length === 0 ? (
            <p className="text-sm text-sand-400">{t('form.noApps')}</p>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-sand-200 p-2 dark:border-sand-700">
              {apps.map((app) => (
                <label
                  key={app.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sand-100 dark:hover:bg-sand-800"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-sand-300 text-ember-500 focus:ring-ember-400"
                    checked={allowed.has(app.id)}
                    onChange={() => toggleApp(app.id)}
                  />
                  <span className="truncate">{app.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-sand-200 px-3 py-2.5 dark:border-sand-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-sand-300 text-ember-500 focus:ring-ember-400"
            checked={chatEnabled}
            onChange={(e) => setChatEnabled(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium">{t('form.chatAccess')}</span>
            <span className="block text-xs text-sand-400">{t('form.chatAccessHint')}</span>
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting && <Spinner className="h-4 w-4" />}
            {mode === 'create' ? t('form.create') : t('form.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
