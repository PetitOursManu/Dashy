import { useEffect, useRef, useState, type ReactNode } from 'react';
import { notesApi } from '../api/notes';
import { useI18n } from '../context/LanguageContext';
import { NoteIcon } from './Icons';
import { TileDecor } from './TileDecor';

/**
 * A personal rich-text note (bold / italic / underline) that auto-saves to the
 * server, so it survives logout and refresh. Uses a contentEditable surface and
 * the browser's built-in formatting commands; the server sanitizes on save.
 */
export function NotesTile() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const [empty, setEmpty] = useState(true);
  const [status, setStatus] = useState<'saved' | 'saving'>('saved');

  useEffect(() => {
    notesApi
      .get()
      .then(({ content }) => {
        if (ref.current) ref.current.innerHTML = content || '';
        setEmpty(!(ref.current?.textContent ?? '').trim());
      })
      .catch(() => {});
    return () => window.clearTimeout(saveTimer.current);
  }, []);

  const save = async () => {
    if (!ref.current) return;
    try {
      await notesApi.save(ref.current.innerHTML);
      setStatus('saved');
    } catch {
      /* will retry on next edit */
    }
  };

  const scheduleSave = () => {
    setStatus('saving');
    setEmpty(!(ref.current?.textContent ?? '').trim());
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(save, 800);
  };

  const exec = (command: 'bold' | 'italic' | 'underline') => {
    document.execCommand(command);
    ref.current?.focus();
    scheduleSave();
  };

  const ToolbarButton = ({ cmd, label, children }: { cmd: 'bold' | 'italic' | 'underline'; label: string; children: ReactNode }) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => {
        e.preventDefault();
        exec(cmd);
      }}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand-200 text-sm hover:bg-sand-100 dark:border-sand-700 dark:hover:bg-sand-800"
    >
      {children}
    </button>
  );

  return (
    <div className="card relative flex flex-col overflow-hidden p-5">
      <TileDecor variant="dots" />
      <div className="relative mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-semibold">
          <span className="text-ember-500">
            <NoteIcon className="h-5 w-5" />
          </span>
          {t('notes.title')}
        </h3>
        <span className="text-xs text-sand-400">
          {status === 'saving' ? t('notes.saving') : t('notes.saved')}
        </span>
      </div>

      <div className="relative mb-2 flex items-center gap-1.5">
        <ToolbarButton cmd="bold" label={t('notes.bold')}>
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton cmd="italic" label={t('notes.italic')}>
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton cmd="underline" label={t('notes.underline')}>
          <span className="underline">U</span>
        </ToolbarButton>
      </div>

      <div className="relative flex-1">
        {empty && (
          <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-sand-400">
            {t('notes.placeholder')}
          </span>
        )}
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={scheduleSave}
          onBlur={save}
          className="note-editor min-h-[140px] w-full rounded-xl border border-sand-200 px-3 py-2.5 text-sm leading-relaxed focus:border-ember-400 focus:outline-none focus:ring-2 focus:ring-ember-400/30 dark:border-sand-700"
        />
      </div>
    </div>
  );
}
