import { useEffect, type ReactNode } from 'react';
import { useI18n } from '../context/LanguageContext';
import { CloseIcon } from './Icons';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, title, onClose, children, maxWidth = 'max-w-lg' }: ModalProps) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Dialogs are kept opaque (even under the frosted image theme) so the page
          behind them doesn't bleed through when windows overlap. */}
      <div
        className={`card w-full ${maxWidth} max-h-[90vh] animate-pop-in overflow-y-auto !bg-white !backdrop-blur-none dark:!bg-sand-900`}
      >
        <div className="flex items-center justify-between border-b border-sand-200 px-5 py-4 dark:border-sand-800">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost !px-2"
            aria-label={t('common.close')}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
