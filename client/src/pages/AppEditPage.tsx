import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { appsApi } from '../api/apps';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp } from '../types';
import { Spinner, FullPageSpinner } from '../components/Spinner';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ExternalIcon, TrashIcon } from '../components/Icons';

export function AppEditPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [app, setApp] = useState<HostedApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [entryFile, setEntryFile] = useState('');
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { app } = await appsApi.get(id);
        setApp(app);
        setName(app.name);
        setDescription(app.description);
        setCategory(app.category ?? '');
        setEntryFile(app.entryFile);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load this app.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const onPreviewSelected = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const { app } = await appsApi.update(id, {
        name,
        description,
        category: category.trim(),
        entryFile,
        preview,
      });
      setApp(app);
      setPreview(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    await appsApi.remove(id);
    navigate('/', { replace: true });
  };

  if (loading) return <FullPageSpinner />;
  if (!app) {
    return (
      <div className="card p-6">
        <p className="text-sm text-red-600 dark:text-red-400">{error ?? t('edit.notFound')}</p>
        <Link to="/" className="btn-secondary mt-4">
          {t('edit.back')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link to="/" className="text-sm font-medium text-ember-500 hover:underline">
            ← {t('edit.back')}
          </Link>
          <p className="mt-1 truncate text-sm text-sand-500 dark:text-sand-400">{app.name}</p>
        </div>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary shrink-0"
        >
          <ExternalIcon className="h-4 w-4" />
          {t('edit.open')}
        </a>
      </div>

      <form onSubmit={save} className="card space-y-4 p-6">
        <div>
          <label className="label" htmlFor="name">
            {t('edit.name')}
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="description">
            {t('edit.description')}
          </label>
          <textarea
            id="description"
            className="input min-h-[80px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </div>

        <div>
          <label className="label" htmlFor="category">
            {t('edit.category')}
          </label>
          <input
            id="category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('import.categoryPlaceholder')}
            maxLength={40}
          />
        </div>

        <div>
          <label className="label" htmlFor="entry">
            {t('edit.entryFile')}
          </label>
          <input
            id="entry"
            className="input font-mono text-sm"
            value={entryFile}
            onChange={(e) => setEntryFile(e.target.value)}
          />
          <p className="mt-1 text-xs text-sand-400">{t('edit.entryHint', { url: app.url })}</p>
        </div>

        <div>
          <label className="label">{t('edit.preview')}</label>
          <div className="flex items-center gap-3">
            <div className="h-20 w-32 shrink-0 overflow-hidden rounded-lg border border-sand-200 bg-sand-100 dark:border-sand-700 dark:bg-sand-800">
              <img
                src={previewUrl ?? `${app.previewUrl}?t=${app.updatedAt}`}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              onChange={(e) => onPreviewSelected(e.target.files?.[0] ?? null)}
              className="text-sm text-sand-500 file:mr-3 file:rounded-md file:border-0 file:bg-sand-200 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-sand-300 dark:file:bg-sand-700 dark:hover:file:bg-sand-600"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {saved && (
          <p className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
            {t('edit.saved')}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <TrashIcon className="h-4 w-4" />
            {t('edit.delete')}
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            {t('edit.save')}
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title={t('dash.deleteTitle')}
        message={t('dash.deleteMsg', { name: app.name })}
        confirmLabel={t('edit.delete')}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
