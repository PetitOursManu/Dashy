import { useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/LanguageContext';
import { useTheme, THEMES, type Theme } from '../context/ThemeContext';
import { authApi, avatarUrl } from '../api/auth';
import { ApiError } from '../api/client';
import { LANGUAGES, type Lang } from '../i18n/translations';
import { Spinner } from '../components/Spinner';
import { Avatar } from '../components/Avatar';

const DATE_FORMATS = [
  { value: '', sample: '' },
  { value: 'dmy', sample: '31/12/2026' },
  { value: 'mdy', sample: '12/31/2026' },
  { value: 'iso', sample: '2026-12-31' },
] as const;

function timezoneList(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof fn === 'function') return fn('timeZone');
  } catch {
    /* ignore */
  }
  return ['UTC', 'Europe/Paris', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Shanghai'];
}

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();

  const [nickname, setNickname] = useState(user?.nickname ?? '');
  const [fullName, setFullName] = useState(user?.fullName ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setProfileSaved(false);
    setSavingProfile(true);
    try {
      const { user: updated } = await authApi.updateProfile({ nickname, fullName, jobTitle });
      setUser(updated);
      setProfileSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const onAvatarSelected = async (file: File | null) => {
    if (!file) return;
    setError(null);
    try {
      const { user: updated } = await authApi.uploadAvatar(file);
      setUser(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the image.');
    }
  };

  const removeAvatar = async () => {
    try {
      const { user: updated } = await authApi.removeAvatar();
      setUser(updated);
    } catch {
      /* ignore */
    }
  };

  const savePref = async (patch: Parameters<typeof authApi.updateProfile>[0]) => {
    try {
      const { user: updated } = await authApi.updateProfile(patch);
      setUser(updated);
    } catch {
      /* preference still applies locally */
    }
  };

  const chooseLanguage = (code: Lang) => {
    setLang(code);
    void savePref({ language: code });
  };
  const chooseTheme = (value: Theme) => {
    setTheme(value);
    void savePref({ theme: value });
  };

  const themeSwatch: Record<Theme, string> = {
    light: 'linear-gradient(135deg,#f8ddc8,#ef6a2e)',
    dark: 'linear-gradient(135deg,#3f3631,#ef6a2e)',
    violet: 'linear-gradient(135deg,#e6def7,#8b5cf6)',
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-sm text-sand-500 dark:text-sand-400">{t('settings.subtitle')}</p>

      {/* Profile */}
      <section className="card p-6">
        <h2 className="font-semibold">{t('settings.profileTitle')}</h2>
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('settings.profileDesc')}</p>

        <div className="mt-4 flex items-center gap-4">
          {user && (
            <Avatar
              email={user.email}
              src={user.hasAvatar ? `${avatarUrl(user.id)}?t=${user.updatedAt}` : undefined}
              className="h-16 w-16 text-lg"
            />
          )}
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !py-1.5 !text-xs"
                onClick={() => avatarInput.current?.click()}
              >
                {t('settings.uploadAvatar')}
              </button>
              {user?.hasAvatar && (
                <button
                  type="button"
                  className="btn-ghost !py-1.5 !text-xs text-red-500"
                  onClick={removeAvatar}
                >
                  {t('settings.removeAvatar')}
                </button>
              )}
            </div>
            <span className="text-xs text-sand-400">{t('settings.avatarHint')}</span>
          </div>
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => onAvatarSelected(e.target.files?.[0] ?? null)}
          />
        </div>

        <form onSubmit={saveProfile} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="nickname">
                {t('settings.nickname')}
              </label>
              <input
                id="nickname"
                className="input"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t('settings.nicknamePlaceholder')}
                maxLength={60}
              />
            </div>
            <div>
              <label className="label" htmlFor="jobTitle">
                {t('settings.jobTitle')}
              </label>
              <input
                id="jobTitle"
                className="input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder={t('settings.jobTitlePlaceholder')}
                maxLength={120}
              />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="fullName">
              {t('settings.fullName')}
            </label>
            <input
              id="fullName"
              className="input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('settings.fullNamePlaceholder')}
              maxLength={120}
            />
          </div>
          <div>
            <label className="label">{t('settings.emailLabel')}</label>
            <input className="input opacity-60" value={user?.email ?? ''} disabled readOnly />
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {profileSaved && (
            <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
              {t('settings.profileSaved')}
            </p>
          )}

          <button type="submit" className="btn-primary" disabled={savingProfile}>
            {savingProfile && <Spinner className="h-4 w-4" />}
            {t('settings.saveProfile')}
          </button>
        </form>
      </section>

      {/* Language */}
      <section className="card p-6">
        <h2 className="font-semibold">{t('settings.languageTitle')}</h2>
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('settings.languageDesc')}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => chooseLanguage(l.code)}
              className={`rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                lang === l.code
                  ? 'border-ember-400 bg-ember-50 text-ember-700 dark:bg-ember-500/10 dark:text-ember-300'
                  : 'border-sand-200 hover:bg-sand-100 dark:border-sand-700 dark:hover:bg-sand-800'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {/* Appearance */}
      <section className="card p-6">
        <h2 className="font-semibold">{t('settings.appearanceTitle')}</h2>
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('settings.appearanceDesc')}</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {THEMES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => chooseTheme(value)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                theme === value
                  ? 'border-ember-400 ring-2 ring-ember-400/40'
                  : 'border-sand-200 hover:bg-sand-100 dark:border-sand-700 dark:hover:bg-sand-800'
              }`}
            >
              <span
                className="h-12 w-full rounded-lg"
                style={{ backgroundImage: themeSwatch[value] }}
              />
              <span className="text-sm font-medium">{t(`theme.${value}`)}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Date & time */}
      <section className="card p-6">
        <h2 className="font-semibold">{t('settings.regionalTitle')}</h2>
        <p className="text-sm text-sand-500 dark:text-sand-400">{t('settings.regionalDesc')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="timezone">
              {t('settings.timezone')}
            </label>
            <select
              id="timezone"
              className="input"
              value={user?.timezone ?? ''}
              onChange={(e) => savePref({ timezone: e.target.value })}
            >
              <option value="">{t('settings.timezoneAuto')}</option>
              {timezoneList().map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="dateFormat">
              {t('settings.dateFormat')}
            </label>
            <select
              id="dateFormat"
              className="input"
              value={user?.dateFormat ?? ''}
              onChange={(e) => savePref({ dateFormat: e.target.value })}
            >
              {DATE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value === '' ? t('settings.dateFormatLocale') : f.sample}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>
    </div>
  );
}
