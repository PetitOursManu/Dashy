import { useCallback, useEffect, useState } from 'react';
import {
  databaseApi,
  type CellValue,
  type CollectionInfo,
  type ConnectionMeta,
  type FieldDef,
  type Row,
  type SchemaInfo,
} from '../../api/database';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import { Loader, Spinner } from '../Spinner';
import { ConfirmDialog } from '../ConfirmDialog';
import { DatabaseIcon, SearchIcon } from '../Icons';

const PAGE_SIZE = 50;

function renderCell(v: CellValue): { text: string; muted?: boolean } {
  if (v === null || v === undefined) return { text: 'NULL', muted: true };
  if (typeof v === 'object') return { text: JSON.stringify(v) };
  if (typeof v === 'boolean') return { text: v ? 'true' : 'false' };
  return { text: String(v) };
}

interface Props {
  appId: string;
  connection: ConnectionMeta;
  onDisconnect: () => void;
  onReconfigure: () => void;
}

/** Read-only visual browser: schema → collection → paginated, sortable grid. */
export function DbExplorer({ appId, connection, onDisconnect, onReconfigure }: Props) {
  const { t } = useI18n();
  const [schemas, setSchemas] = useState<SchemaInfo[] | null>(null);
  const [schema, setSchema] = useState<string | null>(null);
  const [collections, setCollections] = useState<CollectionInfo[] | null>(null);
  const [collection, setCollection] = useState<string | null>(null);

  const [fields, setFields] = useState<FieldDef[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' } | null>(null);
  const [filterField, setFilterField] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [appliedFilter, setAppliedFilter] = useState<{ field: string; value: string } | null>(null);

  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisc, setConfirmDisc] = useState(false);

  // Schemas: load once.
  useEffect(() => {
    (async () => {
      try {
        const { schemas } = await databaseApi.schemas(appId);
        setSchemas(schemas);
        if (schemas.length > 0) setSchema(schemas[0].name);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('db.loadError'));
        setSchemas([]);
      }
    })();
  }, [appId, t]);

  // Collections: reload when the schema changes.
  useEffect(() => {
    if (!schema) return;
    setCollections(null);
    setCollection(null);
    setRows([]);
    setFields([]);
    setTotal(0);
    (async () => {
      try {
        const { collections } = await databaseApi.collections(appId, schema);
        setCollections(collections);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('db.loadError'));
        setCollections([]);
      }
    })();
  }, [appId, schema, t]);

  const loadRows = useCallback(async () => {
    if (!schema || !collection) return;
    setLoadingRows(true);
    setError(null);
    try {
      const res = await databaseApi.rows(appId, schema, collection, {
        page,
        pageSize: PAGE_SIZE,
        sortField: sort?.field,
        sortDir: sort?.dir,
        filterField: appliedFilter?.field,
        filterOp: 'contains',
        filterValue: appliedFilter?.value,
      });
      setRows(res.rows);
      setTotal(res.total);
      setFields(res.fields);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('db.loadError'));
      setRows([]);
    } finally {
      setLoadingRows(false);
    }
  }, [appId, schema, collection, page, sort, appliedFilter, t]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const selectCollection = (name: string) => {
    setCollection(name);
    setPage(1);
    setSort(null);
    setFilterField('');
    setFilterValue('');
    setAppliedFilter(null);
  };

  const toggleSort = (field: string) => {
    setPage(1);
    setSort((s) =>
      s && s.field === field
        ? s.dir === 'asc'
          ? { field, dir: 'desc' }
          : null
        : { field, dir: 'asc' },
    );
  };

  const applyFilter = () => {
    setPage(1);
    setAppliedFilter(filterField && filterValue ? { field: filterField, value: filterValue } : null);
  };

  const clearFilter = () => {
    setFilterField('');
    setFilterValue('');
    setAppliedFilter(null);
    setPage(1);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const disconnect = async () => {
    await databaseApi.remove(appId);
    onDisconnect();
  };

  if (schemas === null) {
    return (
      <div className="flex justify-center py-16">
        <Loader className="h-16 w-16" />
      </div>
    );
  }

  return (
    <div>
      {/* Connection header (non-sensitive metadata only) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 dark:border-sand-700 dark:bg-sand-800/50">
        <div className="flex items-center gap-2 text-sm">
          <DatabaseIcon className="h-5 w-5 text-ember-500" />
          <span className="font-medium">{connection.type}</span>
          {connection.hostHint && <span className="text-sand-400">· …{connection.hostHint}</span>}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost !py-1 !text-xs" onClick={onReconfigure}>
            {t('db.reconfigure')}
          </button>
          <button
            type="button"
            className="btn-ghost !py-1 !text-xs text-red-500 hover:bg-red-500/10"
            onClick={() => setConfirmDisc(true)}
          >
            {t('db.disconnect')}
          </button>
        </div>
      </div>

      <p className="mb-3 inline-block rounded-full bg-sand-100 px-3 py-1 text-xs text-sand-500 dark:bg-sand-800 dark:text-sand-400">
        {t('db.readonly')}
      </p>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        {/* Left: schema select + collection list */}
        <aside className="card h-fit p-3">
          <label className="label">{t('db.schemas')}</label>
          <select
            className="input mb-3"
            value={schema ?? ''}
            onChange={(e) => setSchema(e.target.value)}
          >
            {schemas.length === 0 && <option value="">{t('db.noSchemas')}</option>}
            {schemas.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>

          <label className="label">{t('db.collections')}</label>
          {collections === null ? (
            <div className="py-4 text-center">
              <Spinner className="mx-auto h-5 w-5 text-ember-500" />
            </div>
          ) : collections.length === 0 ? (
            <p className="py-2 text-xs text-sand-400">{t('db.noCollections')}</p>
          ) : (
            <ul className="max-h-[50vh] space-y-0.5 overflow-y-auto">
              {collections.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => selectCollection(c.name)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      collection === c.name
                        ? 'bg-ember-500/15 text-ember-700 dark:text-ember-300'
                        : 'hover:bg-sand-100 dark:hover:bg-sand-800'
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {c.rowCount !== null && (
                      <span className="shrink-0 text-[10px] text-sand-400">{c.rowCount}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Right: data grid */}
        <div className="min-w-0">
          {!collection ? (
            <div className="card flex min-h-[200px] items-center justify-center p-6 text-sm text-sand-400">
              {t('db.selectCollection')}
            </div>
          ) : (
            <div className="card overflow-hidden">
              {/* Filter bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 p-3 dark:border-sand-800">
                <select
                  className="input !w-auto !py-1.5 text-sm"
                  value={filterField}
                  onChange={(e) => setFilterField(e.target.value)}
                >
                  <option value="">{t('db.filterField')}</option>
                  {fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div className="relative min-w-[140px] flex-1">
                  <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-sand-400" />
                  <input
                    className="input !py-1.5 pl-8 text-sm"
                    value={filterValue}
                    placeholder={t('db.filterValue')}
                    onChange={(e) => setFilterValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyFilter();
                    }}
                  />
                </div>
                <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={applyFilter}>
                  {t('db.apply')}
                </button>
                {appliedFilter && (
                  <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={clearFilter}>
                    {t('db.clear')}
                  </button>
                )}
              </div>

              {error && (
                <p className="m-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                {loadingRows ? (
                  <div className="flex justify-center py-16">
                    <Spinner className="h-6 w-6 text-ember-500" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="py-16 text-center text-sm text-sand-400">{t('db.empty')}</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-sand-200 bg-sand-50 dark:border-sand-800 dark:bg-sand-800/50">
                        {fields.map((f) => (
                          <th
                            key={f.name}
                            className="whitespace-nowrap px-3 py-2 text-left font-medium"
                          >
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:text-ember-600"
                              onClick={() => toggleSort(f.name)}
                              title={f.rawType}
                            >
                              {f.name}
                              {f.primaryKey && (
                                <span className="rounded bg-ember-500/15 px-1 text-[9px] text-ember-600 dark:text-ember-300">
                                  {t('db.pk')}
                                </span>
                              )}
                              {sort?.field === f.name && <span>{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-sand-100 last:border-0 hover:bg-sand-50 dark:border-sand-800/60 dark:hover:bg-sand-800/40"
                        >
                          {fields.map((f) => {
                            const cell = renderCell(r[f.name] ?? null);
                            return (
                              <td
                                key={f.name}
                                className={`max-w-[280px] truncate px-3 py-1.5 ${
                                  cell.muted ? 'italic text-sand-400' : ''
                                }`}
                                title={cell.text}
                              >
                                {cell.text}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between gap-3 border-t border-sand-200 p-3 text-sm dark:border-sand-800">
                <span className="text-sand-500 dark:text-sand-400">
                  {t('db.totalRows', { n: total })}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost !py-1 !text-xs"
                    disabled={page <= 1 || loadingRows}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t('db.prev')}
                  </button>
                  <span className="text-xs text-sand-500">{t('db.pageOf', { page, pages })}</span>
                  <button
                    type="button"
                    className="btn-ghost !py-1 !text-xs"
                    disabled={page >= pages || loadingRows}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('db.next')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisc}
        title={t('db.disconnectTitle')}
        message={t('db.disconnectMsg')}
        confirmLabel={t('db.disconnect')}
        onConfirm={disconnect}
        onCancel={() => setConfirmDisc(false)}
      />
    </div>
  );
}
