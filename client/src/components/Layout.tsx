import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import { isStaff } from '../types';
import { ProfileMenu } from './ProfileMenu';
import { ChatWidget } from './ChatWidget';
import {
  CloseIcon,
  GridIcon,
  InboxIcon,
  Logo,
  MenuIcon,
  SettingsIcon,
  ShieldIcon,
  StoreIcon,
  UsersIcon,
} from './Icons';

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof GridIcon;
  end?: boolean;
  adminOnly?: boolean;
  staffOnly?: boolean;
}

const NAV_GROUPS: { titleKey: string; items: NavItem[] }[] = [
  {
    titleKey: 'nav.mainMenu',
    items: [
      { to: '/', labelKey: 'nav.dashboard', icon: GridIcon, end: true },
      { to: '/store', labelKey: 'nav.store', icon: StoreIcon, adminOnly: true },
    ],
  },
  {
    titleKey: 'nav.management',
    items: [
      { to: '/users', labelKey: 'nav.users', icon: UsersIcon, staffOnly: true },
      { to: '/requests', labelKey: 'nav.requests', icon: InboxIcon, staffOnly: true },
    ],
  },
  {
    titleKey: 'nav.account',
    items: [
      { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon },
      { to: '/security', labelKey: 'nav.security', icon: ShieldIcon },
    ],
  },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col">
      <NavLink to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-3 py-2">
        <Logo className="h-9 w-9" />
        <span className="text-xl font-bold tracking-tight">Dashy</span>
      </NavLink>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (i) =>
              (!i.adminOnly || user?.role === 'admin') &&
              (!i.staffOnly || isStaff(user?.role)),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.titleKey}>
              <p className="nav-section">{t(group.titleKey)}</p>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  {t(item.labelKey)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-ember-500 to-ember-700 p-4 text-white shadow-glow">
        <p className="text-sm font-semibold">{t('nav.hostTitle')}</p>
        <p className="mt-1 text-xs text-white/80">{t('nav.hostDesc')}</p>
      </div>
    </div>
  );
}

const TITLE_KEYS: Record<string, string> = {
  '/': 'nav.dashboard',
  '/store': 'nav.store',
  '/users': 'nav.users',
  '/requests': 'nav.requests',
  '/security': 'nav.security',
  '/settings': 'nav.settings',
};

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useI18n();
  const location = useLocation();
  const title = location.pathname.startsWith('/apps/')
    ? t('edit.back')
    : t(TITLE_KEYS[location.pathname] ?? 'nav.dashboard');

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-4 lg:flex">
        <SidebarContent />
      </aside>

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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 px-4 pt-4 sm:px-6 lg:px-8">
          <div className="card flex items-center justify-between gap-4 px-4 py-2.5 sm:px-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                className="btn-ghost !px-2 lg:hidden"
                aria-label="Open menu"
              >
                <MenuIcon className="h-5 w-5" />
              </button>
              <h1
                key={location.pathname}
                className="page-title animate-slide-in text-2xl font-bold tracking-tight sm:text-[26px]"
              >
                {title}
              </h1>
            </div>
            <ProfileMenu />
          </div>
        </header>

        <main className="flex-1 px-4 pb-10 pt-4 sm:px-6 lg:px-8">
          {/* Re-keyed on navigation so each sub-menu animates in. */}
          <div key={location.pathname} className="animate-page">
            <Outlet />
          </div>
        </main>
      </div>

      <ChatWidget />
    </div>
  );
}
