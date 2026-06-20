import { useState } from 'react';
import { Modal } from './Modal';
import { Spinner } from './Spinner';
import { useI18n } from '../context/LanguageContext';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title={title} onClose={busy ? () => {} : onCancel} maxWidth="max-w-md">
      <p className="text-sm text-sand-600 dark:text-sand-300">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn-danger" onClick={confirm} disabled={busy}>
          {busy && <Spinner className="h-4 w-4" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
