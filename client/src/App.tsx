import { useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme, THEMES, type Theme } from './context/ThemeContext';
import { LanguageProvider, useI18n } from './context/LanguageContext';
import { backgroundUrl } from './api/auth';
import type { Lang } from './i18n/translations';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { StaffRoute } from './components/StaffRoute';
import { Layout } from './components/Layout';
import { FullPageSpinner } from './components/Spinner';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { AppEditPage } from './pages/AppEditPage';
import { SecurityPage } from './pages/SecurityPage';
import { SettingsPage } from './pages/SettingsPage';
import { UsersPage } from './pages/UsersPage';
import { RequestsPage } from './pages/RequestsPage';
import { StorePage } from './pages/StorePage';

const VALID_LANGS: Lang[] = ['en', 'fr', 'es', 'de', 'it', 'zh', 'ru'];

/** Apply the logged-in user's saved preferences once per login. */
function PreferencesSync() {
  const { user } = useAuth();
  const { setTheme } = useTheme();
  const { setLang } = useI18n();
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!user) {
      lastId.current = null;
      return;
    }
    if (user.id === lastId.current) return;
    lastId.current = user.id;
    if (user.theme && THEMES.includes(user.theme as Theme)) setTheme(user.theme as Theme);
    if (user.language && VALID_LANGS.includes(user.language as Lang)) setLang(user.language as Lang);
  }, [user, setTheme, setLang]);

  return null;
}

/** Applies the user's background image + glass toggle for the "image" theme. */
function ThemeBackground() {
  const { theme } = useTheme();
  const { user } = useAuth();

  useEffect(() => {
    const el = document.documentElement;
    const isImage = theme === 'image';
    if (isImage && user?.hasBackground) {
      el.style.setProperty('--user-bg', `url("${backgroundUrl()}?t=${user.updatedAt}")`);
    } else {
      el.style.removeProperty('--user-bg');
    }
    el.classList.toggle('glass', isImage && (user?.glass ?? true));
    // The image theme's light/dark tint is user-chosen (light by default).
    if (isImage) {
      el.classList.toggle('dark', user?.glassDark === true);
    }
  }, [theme, user?.hasBackground, user?.glass, user?.glassDark, user?.updatedAt]);

  return null;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <AuthProvider>
            <PreferencesSync />
            <ThemeBackground />
            <Routes>
              <Route path="/login" element={<LoginRoute />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<Layout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/security" element={<SecurityPage />} />
                  <Route element={<StaffRoute />}>
                    <Route path="/users" element={<UsersPage />} />
                    <Route path="/requests" element={<RequestsPage />} />
                  </Route>
                  <Route element={<AdminRoute />}>
                    <Route path="/apps/:id/edit" element={<AppEditPage />} />
                    <Route path="/store" element={<StorePage />} />
                  </Route>
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}
