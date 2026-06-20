import { http } from './client';

export const adminApi = {
  restore: (file: File) => {
    const form = new FormData();
    form.set('backup', file);
    return http.postForm<{ restored: number }>('/api/admin/restore', form);
  },
};

/** Download the full backup archive (authenticated GET → file). */
export async function downloadBackup(): Promise<void> {
  const res = await fetch('/api/admin/backup', { credentials: 'include' });
  if (!res.ok) throw new Error(`Backup failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dashy-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
