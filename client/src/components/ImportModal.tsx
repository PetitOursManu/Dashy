import { useRef, useState, type FormEvent } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { UploadIcon } from './Icons';
import { appsApi } from '../api/apps';
import { ApiError } from '../api/client';
import { useI18n } from '../context/LanguageContext';
import type { HostedApp } from '../types';

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: (app: HostedApp) => void;
}

const CONTENT_ACCEPT = '.html,.htm,.zip';
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

export function ImportModal({ open, onClose, onImported }: ImportModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState<File | null>(null);
  const [preview, setPreview] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName('');
    setDescription('');
    setCategory('');
    setContent(null);
    setPreview(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setError(null);
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const onPreviewSelected = (file: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(file);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!content) {
      setError(t('import.errChoose'));
      return;
    }
    setSubmitting(true);
    try {
      const { app } = await appsApi.import({
        name,
        description,
        category: category.trim() || undefined,
        content,
        preview,
      });
      reset();
      onImported(app);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('import.errFail'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title={t('import.title')} onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="app-name">
            {t('import.name')}
          </label>
          <input
            id="app-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('import.namePlaceholder')}
            maxLength={120}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="app-desc">
            {t('import.description')}{' '}
            <span className="font-normal text-sand-400">({t('common.optional')})</span>
          </label>
          <textarea
            id="app-desc"
            className="input min-h-[72px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('import.descPlaceholder')}
            maxLength={2000}
          />
        </div>

        <div>
          <label className="label" htmlFor="app-category">
            {t('import.category')}{' '}
            <span className="font-normal text-sand-400">({t('common.optional')})</span>
          </label>
          <input
            id="app-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('import.categoryPlaceholder')}
            maxLength={40}
          />
        </div>

        <div>
          <label className="label">{t('import.content')}</label>
          <button
            type="button"
            onClick={() => contentInput.current?.click()}
            className="flex w-full items-center gap-3 rounded-lg border border-dashed border-sand-300 px-4 py-4 text-left text-sm transition-colors hover:border-ember-400 hover:bg-ember-50/50 dark:border-sand-700 dark:hover:bg-sand-800/50"
          >
            <UploadIcon className="h-5 w-5 shrink-0 text-ember-500" />
            <span className="min-w-0">
              {content ? (
                <span className="font-medium">{content.name}</span>
              ) : (
                <>
                  <span className="font-medium">{t('import.chooseFile')}</span>
                  <span className="block text-sand-400">{t('import.chooseHint')}</span>
                </>
              )}
            </span>
          </button>
          <input
            ref={contentInput}
            type="file"
            accept={CONTENT_ACCEPT}
            className="hidden"
            onChange={(e) => setContent(e.target.files?.[0] ?? null)}
          />
        </div>

        <div>
          <label className="label">
            {t('import.preview')}{' '}
            <span className="font-normal text-sand-400">({t('common.optional')})</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-sand-200 bg-sand-100 dark:border-sand-700 dark:bg-sand-800">
              {previewUrl ? (
                <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-sand-400">{t('import.previewAuto')}</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                onChange={(e) => onPreviewSelected(e.target.files?.[0] ?? null)}
                className="text-sm text-sand-500 file:mr-3 file:rounded-md file:border-0 file:bg-sand-200 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-sand-300 dark:file:bg-sand-700 dark:hover:file:bg-sand-600"
              />
              <span className="text-xs text-sand-400">{t('import.previewHint')}</span>
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={close} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting && <Spinner className="h-4 w-4" />}
            {t('import.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
