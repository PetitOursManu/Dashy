import type { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  hint?: string;
}

export function StatCard({ icon, label, value, hint }: StatCardProps) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ember-100 text-ember-600 dark:bg-ember-500/15 dark:text-ember-400">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm text-sand-500 dark:text-sand-400">{label}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {hint && <p className="text-xs text-sand-400">{hint}</p>}
      </div>
    </div>
  );
}
