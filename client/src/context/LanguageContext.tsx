import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translations, type Lang } from '../i18n/translations';

type Vars = Record<string, string | number>;

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Vars) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const VALID: Lang[] = ['en', 'fr', 'es', 'de', 'it', 'zh', 'ru'];

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem('dashy-lang');
    if (stored && VALID.includes(stored as Lang)) return stored as Lang;
  } catch {
    /* ignore */
  }
  return 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem('dashy-lang', lang);
    } catch {
      /* ignore */
    }
  }, [lang]);

  const value = useMemo<LanguageContextValue>(() => {
    const t = (key: string, vars?: Vars): string => {
      let str = translations[lang][key] ?? translations.en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return str;
    };
    return { lang, setLang: setLangState, t };
  }, [lang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useI18n must be used within LanguageProvider');
  return ctx;
}
