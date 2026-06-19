import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
import { ChevronDownIcon, LogoutIcon, ShieldIcon } from './Icons';

export function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-white/60 bg-white/70 py-1 pl-1 pr-2.5 shadow-card transition-colors hover:bg-white dark:border-white/10 dark:bg-sand-800/70 dark:hover:bg-sand-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar email={user.email} className="h-8 w-8 text-xs" />
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {user.email}
        </span>
        <ChevronDownIcon className="h-4 w-4 text-sand-400" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-60 origin-top-right animate-fade-in overflow-hidden rounded-2xl border border-white/60 bg-white/95 shadow-soft backdrop-blur dark:border-white/10 dark:bg-sand-900/95"
        >
          <div className="border-b border-sand-100 px-4 py-3 dark:border-sand-800">
            <p className="truncate text-sm font-semibold">{user.email}</p>
            <p className="mt-0.5 text-xs capitalize text-sand-500 dark:text-sand-400">
              {user.role}
            </p>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/security');
              }}
              className="nav-link w-full"
            >
              <ShieldIcon className="h-4 w-4" />
              Security
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={onLogout}
              className="nav-link w-full text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <LogoutIcon className="h-4 w-4" />
              Log out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
