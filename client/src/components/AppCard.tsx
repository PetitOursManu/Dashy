import { useNavigate } from 'react-router-dom';
import type { HostedApp } from '../types';
import { useAuth } from '../context/AuthContext';
import { EditIcon, ExternalIcon, StarIcon, TrashIcon } from './Icons';

interface AppCardProps {
  app: HostedApp;
  onDelete: (app: HostedApp) => void;
  onToggleFavorite: (app: HostedApp) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function AppCard({ app, onDelete, onToggleFavorite }: AppCardProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const open = () => window.open(app.url, '_blank', 'noopener,noreferrer');

  return (
    <div className="card group flex flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 hover:shadow-soft">
      <button
        type="button"
        onClick={open}
        className="relative block aspect-video w-full overflow-hidden bg-sand-100 dark:bg-sand-800"
        aria-label={`Open ${app.name}`}
      >
        <img
          src={app.previewUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-sand-900">
            <ExternalIcon className="h-4 w-4" /> Open
          </span>
        </span>

        {/* Category badge */}
        {app.category && (
          <span className="absolute left-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {app.category}
          </span>
        )}

        {/* Favorite toggle */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(app);
          }}
          className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
            app.isFavorite
              ? 'bg-white/90 text-amber-500'
              : 'bg-black/35 text-white hover:bg-black/55'
          }`}
          title={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={app.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={app.isFavorite}
        >
          <StarIcon className="h-4 w-4" fill={app.isFavorite ? 'currentColor' : 'none'} />
        </button>
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold" title={app.name}>
            {app.name}
          </h3>
          {app.openCount > 0 && (
            <span
              className="shrink-0 rounded-full bg-ember-100 px-2 py-0.5 text-[11px] font-medium text-ember-700 dark:bg-ember-500/15 dark:text-ember-300"
              title={`Opened ${app.openCount} ${app.openCount === 1 ? 'time' : 'times'}`}
            >
              {app.openCount} {app.openCount === 1 ? 'open' : 'opens'}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-sand-500 dark:text-sand-400">
          {app.description || 'No description'}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-sand-400">{formatDate(app.createdAt)}</span>
          {isAdmin && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigate(`/apps/${app.id}/edit`)}
                className="btn-ghost !px-2 !py-1"
                title="Edit"
                aria-label={`Edit ${app.name}`}
              >
                <EditIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(app)}
                className="btn-ghost !px-2 !py-1 text-red-500 hover:bg-red-500/10"
                title="Delete"
                aria-label={`Delete ${app.name}`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
