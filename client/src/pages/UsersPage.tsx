import { useEffect, useState } from 'react';
import { usersApi } from '../api/users';
import { appsApi } from '../api/apps';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { HostedApp, User } from '../types';
import { Spinner } from '../components/Spinner';
import { UserFormModal } from '../components/UserFormModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EditIcon, PlusIcon, TrashIcon, UsersIcon } from '../components/Icons';

export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [apps, setApps] = useState<HostedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<User | null>(null);
  const [toDelete, setToDelete] = useState<User | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [u, a] = await Promise.all([usersApi.list(), appsApi.list()]);
        setUsers(u.users);
        setApps(a.apps);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load users.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const appName = (id: string) => apps.find((a) => a.id === id)?.name ?? '(deleted)';

  const openCreate = () => {
    setFormMode('create');
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (u: User) => {
    setFormMode('edit');
    setEditing(u);
    setFormOpen(true);
  };

  const onSaved = (saved: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === saved.id);
      return exists ? prev.map((u) => (u.id === saved.id ? saved : u)) : [...prev, saved];
    });
    setFormOpen(false);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setActionError(null);
    try {
      await usersApi.remove(toDelete.id);
      setUsers((prev) => prev.filter((u) => u.id !== toDelete.id));
      setToDelete(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete the user.');
      setToDelete(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-sand-500 dark:text-sand-400">
          Create users and choose which apps they can access.
        </p>
        <button type="button" className="btn-primary" onClick={openCreate}>
          <PlusIcon className="h-5 w-5" />
          <span className="hidden sm:inline">Add user</span>
          <span className="sm:hidden">Add</span>
        </button>
      </div>

      {actionError && (
        <p className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {actionError}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-ember-500" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-sand-400 dark:border-sand-800">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="hidden px-4 py-3 font-medium sm:table-cell">2FA</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">App access</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100 dark:divide-sand-800">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-sand-50 dark:hover:bg-sand-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <UsersIcon className="h-4 w-4 shrink-0 text-sand-400" />
                      <span className="truncate font-medium">{u.email}</span>
                      {u.id === me?.id && (
                        <span className="rounded-full bg-ember-500/15 px-1.5 py-0.5 text-[10px] font-medium text-ember-500">
                          you
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-ember-500/15 text-ember-500'
                          : 'bg-sand-200 text-sand-600 dark:bg-sand-800 dark:text-sand-300'
                      }`}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {u.twoFactorEnabled ? (
                      <span className="text-green-600 dark:text-green-400">On</span>
                    ) : (
                      <span className="text-sand-400">Off</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-sand-500 dark:text-sand-400 md:table-cell">
                    {u.role === 'admin'
                      ? 'All apps'
                      : (u.allowedApps?.length ?? 0) === 0
                        ? '—'
                        : (u.allowedApps ?? [])
                            .map(appName)
                            .slice(0, 3)
                            .join(', ') + ((u.allowedApps?.length ?? 0) > 3 ? '…' : '')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(u)}
                        className="btn-ghost !px-2 !py-1"
                        title="Edit"
                        aria-label={`Edit ${u.email}`}
                      >
                        <EditIcon className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setToDelete(u)}
                        disabled={u.id === me?.id}
                        className="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-500/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        title={u.id === me?.id ? 'You cannot delete yourself' : 'Delete'}
                        aria-label={`Delete ${u.email}`}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UserFormModal
        open={formOpen}
        mode={formMode}
        user={editing}
        apps={apps}
        onClose={() => setFormOpen(false)}
        onSaved={onSaved}
      />
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete user"
        message={`Delete "${toDelete?.email}"? They will lose access immediately. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
