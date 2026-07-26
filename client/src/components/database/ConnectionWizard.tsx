import { useState } from 'react';
import { databaseApi, type ConnectionInput, type DbEngine, type SslMode } from '../../api/database';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import { Spinner } from '../Spinner';
import { DatabaseIcon } from '../Icons';

const ENGINES: { value: DbEngine; labelKey: string; defaultPort: number; supported: boolean }[] = [
  { value: 'postgresql', labelKey: 'db.enginePostgres', defaultPort: 5432, supported: true },
  { value: 'mysql', labelKey: 'db.engineMysql', defaultPort: 3306, supported: true },
  { value: 'mongodb', labelKey: 'db.engineMongo', defaultPort: 27017, supported: false },
  { value: 'sqlite', labelKey: 'db.engineSqlite', defaultPort: 0, supported: false },
  { value: 'redis', labelKey: 'db.engineRedis', defaultPort: 6379, supported: false },
];

interface Props {
  appId: string;
  initial?: Partial<ConnectionInput>;
  onConnected: () => void;
  onCancel?: () => void;
}

/**
 * Manual connection form (the universal fallback that works for any app, even a
 * `tile` card Dashy knows nothing about). Enforces the "test before save"
 * contract: a successful test is required to enable Save, and any edit clears a
 * prior test result.
 */
export function ConnectionWizard({ appId, initial, onConnected, onCancel }: Props) {
  const { t } = useI18n();
  const [type, setType] = useState<DbEngine>(initial?.type ?? 'postgresql');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '');
  const [user, setUser] = useState(initial?.user ?? '');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState(initial?.database ?? '');
  const [sslMode, setSslMode] = useState<SslMode>(initial?.sslMode ?? 'disable');

  const [test, setTest] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const engine = ENGINES.find((e) => e.value === type)!;

  /** Any edit invalidates a prior successful test. */
  const dirty = () => {
    setTest('idle');
    setTestMsg(null);
  };

  const payload = (): ConnectionInput => ({
    type,
    host: host.trim(),
    port: port ? Number(port) : undefined,
    user: user.trim(),
    password,
    database: database.trim(),
    sslMode,
  });

  const runTest = async () => {
    setTest('testing');
    setTestMsg(null);
    setSaveErr(null);
    try {
      const res = await databaseApi.test(appId, payload());
      if (res.ok) {
        setTest('ok');
      } else {
        setTest('fail');
        setTestMsg(res.error ?? t('db.testFail'));
      }
    } catch (err) {
      setTest('fail');
      setTestMsg(err instanceof ApiError ? err.message : t('db.testFail'));
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    try {
      await databaseApi.save(appId, payload());
      onConnected();
    } catch (err) {
      setSaveErr(err instanceof ApiError ? err.message : t('db.testFail'));
    } finally {
      setSaving(false);
    }
  };

  const canTest = engine.supported && host.trim().length > 0 && test !== 'testing';

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <DatabaseIcon className="h-5 w-5 text-ember-500" />
        {t('db.manualTitle')}
      </h2>
      <p className="mt-1 text-sm text-sand-500 dark:text-sand-400">{t('db.manualDesc')}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">{t('db.engine')}</label>
          <select
            className="input"
            value={type}
            onChange={(e) => {
              setType(e.target.value as DbEngine);
              dirty();
            }}
          >
            {ENGINES.map((e) => (
              <option key={e.value} value={e.value} disabled={!e.supported}>
                {t(e.labelKey)}
                {e.supported ? '' : ` — ${t('db.engineSoon')}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">{t('db.host')}</label>
          <input
            className="input"
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              dirty();
            }}
            placeholder="db.internal"
          />
        </div>
        <div>
          <label className="label">{t('db.port')}</label>
          <input
            className="input"
            type="number"
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              dirty();
            }}
            placeholder={String(engine.defaultPort)}
          />
        </div>
        <div>
          <label className="label">{t('db.user')}</label>
          <input
            className="input"
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              dirty();
            }}
            autoComplete="off"
          />
        </div>
        <div>
          <label className="label">{t('db.password')}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              dirty();
            }}
            autoComplete="new-password"
          />
        </div>
        <div>
          <label className="label">{t('db.database')}</label>
          <input
            className="input"
            value={database}
            onChange={(e) => {
              setDatabase(e.target.value);
              dirty();
            }}
          />
        </div>
        <div>
          <label className="label">{t('db.ssl')}</label>
          <select
            className="input"
            value={sslMode}
            onChange={(e) => {
              setSslMode(e.target.value as SslMode);
              dirty();
            }}
          >
            <option value="disable">{t('db.sslDisable')}</option>
            <option value="require">{t('db.sslRequire')}</option>
          </select>
        </div>
      </div>

      {!engine.supported && (
        <p className="mt-4 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {t('db.engineNotYet')}
        </p>
      )}
      {test === 'ok' && (
        <p className="mt-4 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          {t('db.testOk')}
        </p>
      )}
      {test === 'fail' && testMsg && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {testMsg}
        </p>
      )}
      {saveErr && (
        <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {saveErr}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={runTest} disabled={!canTest}>
          {test === 'testing' && <Spinner className="h-4 w-4" />}
          {t('db.test')}
        </button>
        <button type="button" className="btn-primary" onClick={save} disabled={test !== 'ok' || saving}>
          {saving && <Spinner className="h-4 w-4" />}
          {t('db.save')}
        </button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        )}
        {test !== 'ok' && <span className="text-xs text-sand-400">{t('db.testFirst')}</span>}
      </div>
    </section>
  );
}
