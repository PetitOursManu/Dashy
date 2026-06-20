import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'violet';
export const THEMES: Theme[] = ['light', 'dark', 'violet'];

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyTheme(theme: Theme): void {
  const el = document.documentElement;
  el.classList.toggle('dark', theme === 'dark');
  el.classList.toggle('violet', theme === 'violet');
}

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('dashy-theme');
    if (stored && THEMES.includes(stored as Theme)) return stored as Theme;
  } catch {
    /* ignore */
  }
  return 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem('dashy-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = (t: Theme) => setThemeState(t);
  const toggle = () =>
    setThemeState((t) => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
