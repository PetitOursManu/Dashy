import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from './ThemeToggle';
import { ProfileMenu } from './ProfileMenu';
import {
  ChevronDownIcon,
  CloseIcon,
  GridIcon,
  Logo,
  MenuIcon,
  ShieldIcon,
  UsersIcon,
} from './Icons';

interface NavItem {
  to: string;
  label: string;
  icon: typeof GridIcon;
  end?: boolean;
  adminOnly?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Main Menu',
    items: [{ to: '/', label: 'Dashboard', icon: GridIcon, end: true }],
  },
  {
    title: 'Management',
    items: [
      { to: '/users', label: 'Users', icon: UsersIcon, adminOnly: true },
      { to: '/security', label: 'Security', icon: ShieldIcon },
    ],
  },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <NavLink to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-3 py-2">
        <Logo className="h-9 w-9" />
        <span className="text-xl font-bold tracking-tight">Dashy</span>
      </NavLink>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || user?.role === 'admin');
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              <p className="nav-section">{group.title}</p>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-ember-500 to-ember-700 p-4 text-white shadow-glow">
        <p className="text-sm font-semibold">Host an app</p>
        <p className="mt-1 text-xs text-white/80">
          Drop a standalone HTML file or a zipped static site from the dashboard.
        </p>
      </div>
    </div>
  );
}

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/users': 'Users',
  '/security': 'Security',
};

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = location.pathname.startsWith('/apps/')
    ? 'Edit app'
    : (PAGE_TITLES[location.pathname] ?? 'Dashy');

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-4 lg:flex">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 animate-fade-in border-r border-white/40 bg-sand-50/95 p-4 shadow-soft backdrop-blur dark:border-white/10 dark:bg-sand-950/95">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="btn-ghost absolute right-3 top-3 !px-2"
              aria-label="Close menu"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="btn-ghost !px-2 lg:hidden"
              aria-label="Open menu"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
            <ChevronDownIcon className="hidden h-5 w-5 text-sand-400 sm:block" />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ProfileMenu />
          </div>
        </header>

        <main className="flex-1 px-4 pb-10 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
