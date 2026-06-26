import type { VolumeMount } from '../../api/store';
import { useI18n } from '../../context/LanguageContext';
import { PlusIcon, TrashIcon } from '../Icons';

interface Props {
  volumes: VolumeMount[];
  onChange: (next: VolumeMount[]) => void;
}

/** Editor for named persistent volumes (volume name → container mount path). */
export function VolumesEditor({ volumes, onChange }: Props) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<VolumeMount>) => {
    const copy = volumes.slice();
    copy[i] = { ...copy[i], ...patch };
    onChange(copy);
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="label !mb-0">{t('store.volumes')}</span>
        <button
          type="button"
          className="btn-ghost !px-2 !py-1 text-xs"
          onClick={() => onChange([...volumes, { name: '', mountPath: '' }])}
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {t('store.volumeAdd')}
        </button>
      </div>
      {volumes.length === 0 ? (
        <p className="text-xs text-sand-400">{t('store.volumesHint')}</p>
      ) : (
        volumes.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className="input flex-1"
              value={v.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder={t('store.volumeName')}
            />
            <span className="text-sand-400">:</span>
            <input
              className="input flex-1"
              value={v.mountPath}
              onChange={(e) => set(i, { mountPath: e.target.value })}
              placeholder="/data"
            />
            <button
              type="button"
              className="btn-ghost !px-1.5 !py-1 text-red-500"
              onClick={() => onChange(volumes.filter((_, j) => j !== i))}
              aria-label={t('store.volumeRemove')}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
