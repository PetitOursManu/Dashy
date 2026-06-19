import { useEffect, useState, type ReactNode } from 'react';
import { statsApi } from '../api/stats';
import type { ActivityItem, OverviewStats, StorageStats } from '../types';
import { formatBytes, relativeTime } from '../utils/format';
import { Spinner } from './Spinner';
import {
  ActivityIcon,
  ChartIcon,
  HardDriveIcon,
  ShieldIcon,
  TrashIcon,
  TrophyIcon,
  UploadIcon,
  UsersIcon,
} from './Icons';

export function AdminAnalytics() {
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [o, a, s] = await Promise.all([
          statsApi.overview(),
          statsApi.activity(),
          statsApi.storage(),
        ]);
        setOverview(o);
        setActivity(a.activities);
        setStorage(s);
      } catch {
        /* analytics are best-effort; the grid below still works */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6 text-ember-500" />
      </div>
    );
  }
  if (!overview) return null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <OpensChart data={overview.opensByMonth} total={overview.totalOpens} />
        <TopApps apps={overview.topApps} />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ActivityFeed items={activity} />
        {storage && <StoragePanel data={storage} />}
      </div>
    </div>
  );
}

function PanelHeader({ icon, title, right }: { icon: ReactNode; title: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h3 className="flex items-center gap-2 font-semibold">
        <span className="text-ember-500">{icon}</span>
        {title}
      </h3>
      {right}
    </div>
  );
}

function OpensChart({ data, total }: { data: OverviewStats['opensByMonth']; total: number }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="card p-5 lg:col-span-2">
      <PanelHeader icon={<ChartIcon className="h-5 w-5" />} title="App opens" />
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-tight">{total}</span>
        <span className="text-sm text-sand-400">opens over 6 months</span>
      </div>
      <div className="mt-5 flex h-40 items-end gap-3">
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-2">
            <div className="flex w-full flex-1 items-end overflow-hidden rounded-lg bg-sand-100 dark:bg-sand-800/60">
              <div
                className="w-full rounded-lg bg-gradient-to-t from-ember-600 to-ember-300 transition-all"
                style={{ height: `${Math.max(2, (d.count / max) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-sand-400">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TopApps({ apps }: { apps: OverviewStats['topApps'] }) {
  const max = Math.max(1, ...apps.map((a) => a.openCount));
  return (
    <div className="card p-5">
      <PanelHeader icon={<TrophyIcon className="h-5 w-5" />} title="Most opened" />
      {apps.length === 0 || apps.every((a) => a.openCount === 0) ? (
        <p className="py-6 text-center text-sm text-sand-400">No opens recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {apps.map((a, i) => (
            <li key={a.id} className="flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sand-100 text-xs font-semibold text-sand-500 dark:bg-sand-800">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="shrink-0 text-sand-400">{a.openCount}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand-100 dark:bg-sand-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-ember-400 to-ember-600"
                    style={{ width: `${(a.openCount / max) * 100}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const ACTIVITY_ICON: Record<string, ReactNode> = {
  'app.imported': <UploadIcon className="h-4 w-4" />,
  'app.deleted': <TrashIcon className="h-4 w-4" />,
  'user.created': <UsersIcon className="h-4 w-4" />,
  'user.deleted': <UsersIcon className="h-4 w-4" />,
  'twofactor.enabled': <ShieldIcon className="h-4 w-4" />,
};

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  return (
    <div className="rounded-3xl bg-sand-900 p-5 text-sand-100 shadow-soft dark:bg-black/40">
      <div className="mb-4 flex items-center gap-2">
        <ActivityIcon className="h-5 w-5 text-ember-400" />
        <h3 className="font-semibold">Recent activity</h3>
      </div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-sand-400">Nothing yet.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id} className="flex items-start gap-3 border-b border-white/5 py-2.5 last:border-0">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-ember-300">
                {ACTIVITY_ICON[it.type] ?? <ActivityIcon className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm">{it.message}</p>
                <p className="truncate text-xs text-sand-400">
                  {it.actorEmail} · {relativeTime(it.at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StoragePanel({ data }: { data: StorageStats }) {
  const top = data.apps.slice(0, 6);
  const max = Math.max(1, ...top.map((a) => a.size));
  return (
    <div className="card p-5">
      <PanelHeader
        icon={<HardDriveIcon className="h-5 w-5" />}
        title="Storage usage"
        right={<span className="text-sm font-semibold">{formatBytes(data.total)}</span>}
      />
      {top.length === 0 ? (
        <p className="py-6 text-center text-sm text-sand-400">No apps yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {top.map((a) => (
            <li key={a.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 text-sand-400">{formatBytes(a.size)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sand-100 dark:bg-sand-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-ember-400 to-ember-600"
                  style={{ width: `${(a.size / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
