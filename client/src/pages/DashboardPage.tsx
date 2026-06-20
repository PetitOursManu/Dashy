import { useEffect, useMemo, useState } from 'react';
import { appsApi } from '../api/apps';
import { usersApi } from '../api/users';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp, User } from '../types';
import { AppCard } from '../components/AppCard';
import { ImportModal } from '../components/ImportModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { StatCard } from '../components/StatCard';
import { AdminAnalytics } from '../components/AdminAnalytics';
import { ChatAlerts } from '../components/ChatAlerts';
import { UserNotifications } from '../components/UserNotifications';
import { Spinner } from '../components/Spinner';
import {
  LayersIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  StarIcon,
  UsersIcon,
} from '../components/Icons';

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-ember-500 text-white shadow-sm'
          : 'border border-sand-200 bg-white/60 text-sand-600 hover:bg-white dark:border-sand-700 dark:bg-sand-800/60 dark:text-sand-300'
      }`}
    >
      {children}
    </button>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const isAdmin = user?.role === 'admin';

  const [apps, setApps] = useState<HostedApp[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<HostedApp | null>(null);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { apps } = await appsApi.list();
        setApps(apps);
        if (isAdmin) {
          const { users } = await usersApi.list();
          setUsers(users);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.');
      } finally {
        setLoading(false);
      }
    })();
  }, [isAdmin]);

  const onImported = (app: HostedApp) => {
    setApps((prev) => [app, ...prev]);
    setImportOpen(false);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    await appsApi.remove(toDelete.id);
    setApps((prev) => prev.filter((a) => a.id !== toDelete.id));
    setToDelete(null);
  };

  const toggleFavorite = async (app: HostedApp) => {
    setApps((prev) =>
      prev.map((a) => (a.id === app.id ? { ...a, isFavorite: !a.isFavorite } : a)),
    );
    try {
      await appsApi.toggleFavorite(app.id);
    } catch {
      // revert on failure
      setApps((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, isFavorite: app.isFavorite } : a)),
      );
    }
  };

  const categories = useMemo(
    () => [...new Set(apps.map((a) => a.category).filter((c): c is string => !!c))].sort(),
    [apps],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps
      .filter((a) => {
        if (favoritesOnly && !a.isFavorite) return false;
        if (category && a.category !== category) return false;
        if (q && !`${a.name} ${a.description} ${a.category ?? ''}`.toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite));
  }, [apps, search, category, favoritesOnly]);

  const stats = isAdmin
    ? [
        {
          icon: <LayersIcon className="h-5 w-5" />,
          label: t('dash.hostedApps'),
          value: apps.length,
          decor: 'rings' as const,
        },
        {
          icon: <UsersIcon className="h-5 w-5" />,
          label: t('dash.teamMembers'),
          value: users.length,
          decor: 'dots' as const,
        },
        {
          icon: <ShieldIcon className="h-5 w-5" />,
          label: t('dash.twoFaEnabled'),
          value: users.filter((u) => u.twoFactorEnabled).length,
          decor: 'waves' as const,
        },
      ]
    : [
        {
          icon: <LayersIcon className="h-5 w-5" />,
          label: t('dash.appsAvailable'),
          value: apps.length,
          decor: 'rings' as const,
        },
        {
          icon: <StarIcon className="h-5 w-5" />,
          label: t('dash.favorites'),
          value: apps.filter((a) => a.isFavorite).length,
          decor: 'dots' as const,
        },
        {
          icon: <ShieldIcon className="h-5 w-5" />,
          label: t('dash.twoFactor'),
          value: user?.twoFactorEnabled ? t('dash.on') : t('dash.off'),
          decor: 'waves' as const,
        },
      ];

  const greetingName = user?.nickname || user?.fullName || user?.email.split('@')[0] || '';

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-8 w-8 text-ember-500" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <UserNotifications />
      <section>
        <p className="text-sm text-sand-500 dark:text-sand-400">
          {t('dash.welcome', { name: greetingName })}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} decor={s.decor} />
          ))}
        </div>
      </section>

      {isAdmin && <ChatAlerts />}
      {isAdmin && <AdminAnalytics />}

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {isAdmin ? t('dash.allApps') : t('dash.yourApps')}
            <span className="ml-2 text-sm font-normal text-sand-400">{apps.length}</span>
          </h2>
          {isAdmin && (
            <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
              <PlusIcon className="h-5 w-5" />
              <span className="hidden sm:inline">{t('dash.importApp')}</span>
              <span className="sm:hidden">{t('dash.import')}</span>
            </button>
          )}
        </div>

        {apps.length > 0 && (
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('dash.searchPlaceholder')}
                className="input pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterPill
                active={!category && !favoritesOnly}
                onClick={() => {
                  setCategory(null);
                  setFavoritesOnly(false);
                }}
              >
                {t('dash.filterAll')}
              </FilterPill>
              <FilterPill active={favoritesOnly} onClick={() => setFavoritesOnly((v) => !v)}>
                <StarIcon
                  className="h-3.5 w-3.5"
                  fill={favoritesOnly ? 'currentColor' : 'none'}
                />
                {t('dash.favorites')}
              </FilterPill>
              {categories.map((c) => (
                <FilterPill
                  key={c}
                  active={category === c}
                  onClick={() => setCategory((cur) => (cur === c ? null : c))}
                >
                  {c}
                </FilterPill>
              ))}
            </div>
          </div>
        )}

        {error ? (
          <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : apps.length === 0 ? (
          <div className="card flex flex-col items-center justify-center px-6 py-20 text-center">
            <LayersIcon className="h-12 w-12 text-sand-300 dark:text-sand-600" />
            <h3 className="mt-4 text-lg font-medium">{t('dash.noAppsTitle')}</h3>
            <p className="mt-1 max-w-sm text-sm text-sand-500 dark:text-sand-400">
              {isAdmin ? t('dash.noAppsAdmin') : t('dash.noAppsUser')}
            </p>
            {isAdmin && (
              <button
                type="button"
                className="btn-primary mt-6"
                onClick={() => setImportOpen(true)}
              >
                <PlusIcon className="h-5 w-5" />
                {t('dash.importApp')}
              </button>
            )}
          </div>
        ) : visible.length === 0 ? (
          <p className="card px-4 py-12 text-center text-sm text-sand-500 dark:text-sand-400">
            {t('dash.noMatch')}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((app) => (
              <AppCard
                key={app.id}
                app={app}
                onDelete={setToDelete}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        )}
      </section>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={onImported} />
      <ConfirmDialog
        open={toDelete !== null}
        title={t('dash.deleteTitle')}
        message={t('dash.deleteMsg', { name: toDelete?.name ?? '' })}
        confirmLabel={t('edit.delete')}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
