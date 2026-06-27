import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Modal } from '../Modal';
import { Spinner } from '../Spinner';
import { VolumesEditor } from './VolumesEditor';
import { storeApi } from '../../api/store';
import { ApiError } from '../../api/client';
import { useI18n } from '../../context/LanguageContext';
import type { ManifestInput, StoreAppType, StoreCatalogApp, StoreSource } from '../../types';
import { EditIcon, PlusIcon, TrashIcon } from '../Icons';

interface Props {
  open: boolean;
  source: StoreSource | null;
  onClose: () => void;
  onChanged: () => void;
}

function emptyManifest(): ManifestInput {
  return {
    id: '',
    name: '',
    description: '',
    icon: '',
    author: '',
    version: '1.0.0',
    type: 'tile',
    tile: { url: '' },
  };
}

/** Auto-slug a name into a safe manifest id. */
function slugify(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Keep only the block matching the chosen type when sending to the server. */
function toPayload(m: ManifestInput): ManifestInput {
  const base: ManifestInput = {
    id: m.id.trim(),
    name: m.name.trim(),
    description: m.description.trim(),
    icon: m.icon.trim(),
    author: m.author.trim(),
    version: m.version.trim() || '1.0.0',
    type: m.type,
  };
  if (m.type === 'tile') return { ...base, tile: { url: m.tile?.url.trim() ?? '' } };
  if (m.type === 'static') {
    const entrypoint = m.static?.entrypoint.trim() || 'index.html';
    // Send exactly one of upload / source_url (whichever the author chose).
    if (m.static?.upload) return { ...base, static: { upload: m.static.upload, entrypoint } };
    return { ...base, static: { source_url: m.static?.source_url?.trim() ?? '', entrypoint } };
  }
  return {
    ...base,
    deploy: {
      docker_compose: m.deploy?.docker_compose ?? '',
      required_env: (m.deploy?.required_env ?? []).filter((e) => e.key.trim()),
      volumes: (m.deploy?.volumes ?? []).filter((v) => v.name.trim() && v.mountPath.trim()),
      default_port: m.deploy?.default_port || 8080,
    },
  };
}

export function CatalogManagerModal({ open, source, onClose, onChanged }: Props) {
  const { t } = useI18n();
  const [apps, setApps] = useState<StoreCatalogApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<ManifestInput | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // original id when editing
  const [idTouched, setIdTouched] = useState(false);
  const [staticKind, setStaticKind] = useState<'url' | 'upload'>('url');
  const [uploadName, setUploadName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [composeSource, setComposeSource] = useState<'paste' | 'repo' | 'image'>('paste');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoLoading, setRepoLoading] = useState(false);
  const [image, setImage] = useState('');
  const [containerPort, setContainerPort] = useState('80');
  const [hostPort, setHostPort] = useState('8080');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApps = async () => {
    if (!source) return;
    setLoading(true);
    try {
      const { apps: all } = await storeApi.catalog(true);
      setApps(all.filter((a) => a.source === source.name));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manifest.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && source) {
      setForm(null);
      setEditingId(null);
      setError(null);
      void loadApps();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  if (!source) return null;

  const startAdd = () => {
    setForm(emptyManifest());
    setEditingId(null);
    setIdTouched(false);
    setStaticKind('url');
    setUploadName('');
    setComposeSource('paste');
    setRepoUrl('');
    setImage('');
    setContainerPort('80');
    setHostPort('8080');
    setError(null);
  };

  const startEdit = (a: StoreCatalogApp) => {
    setForm({
      id: a.id,
      name: a.name,
      description: a.description,
      icon: a.icon,
      author: a.author,
      version: a.version,
      type: a.type,
      tile: a.tile ? { url: a.tile.url } : { url: '' },
      static: a.static
        ? { source_url: a.static.source_url ?? '', upload: a.static.upload, entrypoint: a.static.entrypoint }
        : { source_url: '', entrypoint: 'index.html' },
      deploy: a.deploy
        ? {
            docker_compose: a.deploy.docker_compose,
            required_env: a.deploy.required_env,
            volumes: a.deploy.volumes ?? [],
            default_port: a.deploy.default_port,
          }
        : { docker_compose: '', required_env: [], volumes: [], default_port: 8080 },
    });
    setEditingId(a.id);
    setIdTouched(true);
    setStaticKind(a.static?.upload ? 'upload' : 'url');
    setUploadName(a.static?.upload ? t('manifest.uploaded') : '');
    setComposeSource('paste');
    setRepoUrl('');
    setImage('');
    setContainerPort('80');
    setHostPort('8080');
    setError(null);
  };

  const remove = async (id: string) => {
    if (!confirm(t('manifest.confirmDelete'))) return;
    try {
      await storeApi.deleteApp(source.id, id);
      await loadApps();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manifest.saveError'));
    }
  };

  const patch = (p: Partial<ManifestInput>) => setForm((f) => (f ? { ...f, ...p } : f));

  const chooseType = (ty: StoreAppType) => {
    if (ty === 'static') {
      setStaticKind(form?.static?.upload ? 'upload' : 'url');
      patch({ type: ty, static: form?.static ?? { source_url: '', entrypoint: 'index.html' } });
    } else {
      patch({ type: ty });
    }
  };

  const useUrlSource = () => {
    setStaticKind('url');
    setUploadName('');
    patch({
      static: { source_url: form?.static?.source_url ?? '', entrypoint: form?.static?.entrypoint || 'index.html' },
    });
  };

  const useUploadSource = () => {
    setStaticKind('upload');
    patch({
      static: { upload: form?.static?.upload, entrypoint: form?.static?.entrypoint || 'index.html' },
    });
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { ref, filename } = await storeApi.uploadStatic(file);
      setUploadName(filename);
      patch({ static: { upload: ref, entrypoint: form?.static?.entrypoint || 'index.html' } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manifest.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const loadFromRepo = async () => {
    if (!repoUrl.trim() || repoLoading) return;
    setRepoLoading(true);
    setError(null);
    try {
      const { compose } = await storeApi.composeFromRepo(repoUrl.trim());
      patch({
        deploy: {
          docker_compose: compose,
          required_env: form?.deploy?.required_env ?? [],
          default_port: form?.deploy?.default_port ?? 8080,
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manifest.repoError'));
    } finally {
      setRepoLoading(false);
    }
  };

  /** Generate a minimal docker-compose for a Docker Hub image. */
  const generateFromImage = () => {
    const img = image.trim();
    if (!img) {
      setError(t('manifest.imageRequired'));
      return;
    }
    const cport = Number(containerPort) || 80;
    const hport = Number(hostPort) || cport;
    const compose =
      'services:\n' +
      '  app:\n' +
      `    image: ${img}\n` +
      '    restart: unless-stopped\n' +
      '    ports:\n' +
      `      - "${hport}:${cport}"\n` +
      '    env_file:\n' +
      '      - .env\n';
    setError(null);
    patch({
      deploy: {
        docker_compose: compose,
        required_env: form?.deploy?.required_env ?? [],
        volumes: form?.deploy?.volumes ?? [],
        default_port: hport,
      },
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (form.type === 'static' && staticKind === 'upload' && !form.static?.upload) {
      setError(t('manifest.uploadFile'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const payload = toPayload(form);
      if (editingId) await storeApi.updateApp(source.id, editingId, payload);
      else await storeApi.addApp(source.id, payload);
      setForm(null);
      setEditingId(null);
      await loadApps();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manifest.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const TYPES: StoreAppType[] = ['tile', 'static', 'deploy'];

  return (
    <Modal
      open={open}
      title={t('manifest.title', { name: source.name })}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      {!form ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-sand-500 dark:text-sand-400">{t('manifest.intro')}</p>
            <button type="button" className="btn-primary shrink-0" onClick={startAdd}>
              <PlusIcon className="h-4 w-4" />
              {t('manifest.add')}
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-ember-500" />
            </div>
          ) : apps.length === 0 ? (
            <p className="rounded-xl border border-dashed border-sand-300 px-4 py-8 text-center text-sm text-sand-400 dark:border-sand-700">
              {t('manifest.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-sand-100 dark:divide-sand-800">
              {apps.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {a.name}{' '}
                      <span className="text-xs font-normal text-sand-400">
                        ({a.type}) · v{a.version}
                      </span>
                    </p>
                    <p className="truncate text-xs text-sand-400">{a.id}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn-ghost !px-1.5 !py-1"
                      onClick={() => startEdit(a)}
                      aria-label={t('manifest.edit')}
                    >
                      <EditIcon className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost !px-1.5 !py-1 text-red-500"
                      onClick={() => void remove(a.id)}
                      aria-label={t('manifest.delete')}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button type="button" className="btn-secondary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('manifest.name')}</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  patch({
                    name,
                    ...(!editingId && !idTouched ? { id: slugify(name) } : {}),
                  });
                }}
                required
              />
            </div>
            <div>
              <label className="label">{t('manifest.id')}</label>
              <input
                className="input"
                value={form.id}
                onChange={(e) => {
                  setIdTouched(true);
                  patch({ id: e.target.value });
                }}
                placeholder="my-app"
                pattern="[a-z0-9][a-z0-9-]*"
                title={t('manifest.idHint')}
                required
              />
            </div>
          </div>

          <div>
            <label className="label">{t('manifest.description')}</label>
            <textarea
              className="input h-16 resize-none"
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">{t('manifest.icon')}</label>
              <input
                className="input"
                value={form.icon}
                onChange={(e) => patch({ icon: e.target.value })}
                placeholder="https://…"
              />
            </div>
            <div>
              <label className="label">{t('manifest.author')}</label>
              <input
                className="input"
                value={form.author}
                onChange={(e) => patch({ author: e.target.value })}
              />
            </div>
            <div>
              <label className="label">{t('manifest.version')}</label>
              <input
                className="input"
                value={form.version}
                onChange={(e) => patch({ version: e.target.value })}
                placeholder="1.0.0"
              />
            </div>
          </div>

          {/* Type selector */}
          <div>
            <span className="label">{t('manifest.type')}</span>
            <div className="inline-flex rounded-xl border border-sand-200 p-1 dark:border-sand-700">
              {TYPES.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  onClick={() => chooseType(ty)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                    form.type === ty ? 'bg-ember-500 text-white' : ''
                  }`}
                >
                  {ty}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-sand-400">{t(`manifest.type.${form.type}`)}</p>
          </div>

          {/* tile */}
          {form.type === 'tile' && (
            <div>
              <label className="label">{t('manifest.tileUrl')}</label>
              <input
                className="input"
                type="url"
                value={form.tile?.url ?? ''}
                onChange={(e) => patch({ tile: { url: e.target.value } })}
                placeholder="https://example.com"
                required
              />
            </div>
          )}

          {/* static */}
          {form.type === 'static' && (
            <div className="space-y-3">
              <div>
                <span className="label">{t('manifest.sourceKind')}</span>
                <div className="inline-flex rounded-xl border border-sand-200 p-1 dark:border-sand-700">
                  <button
                    type="button"
                    onClick={useUrlSource}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      staticKind === 'url' ? 'bg-ember-500 text-white' : ''
                    }`}
                  >
                    {t('manifest.fromUrl')}
                  </button>
                  <button
                    type="button"
                    onClick={useUploadSource}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      staticKind === 'upload' ? 'bg-ember-500 text-white' : ''
                    }`}
                  >
                    {t('manifest.fromComputer')}
                  </button>
                </div>
              </div>

              {staticKind === 'url' ? (
                <div>
                  <label className="label">{t('manifest.sourceUrl')}</label>
                  <input
                    className="input"
                    type="url"
                    value={form.static?.source_url ?? ''}
                    onChange={(e) =>
                      patch({
                        static: {
                          source_url: e.target.value,
                          entrypoint: form.static?.entrypoint ?? 'index.html',
                        },
                      })
                    }
                    placeholder="https://…/site.zip"
                    required
                  />
                </div>
              ) : (
                <div>
                  <label className="label">{t('manifest.uploadFile')}</label>
                  <input
                    type="file"
                    accept=".html,.htm,.zip"
                    onChange={(e) => void onPickFile(e)}
                    className="block w-full text-sm text-sand-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ember-500 file:px-3 file:py-1.5 file:text-white dark:text-sand-300"
                  />
                  {uploading && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-sand-400">
                      <Spinner className="h-3 w-3" />
                      {t('manifest.uploading')}
                    </p>
                  )}
                  {!uploading && form.static?.upload && (
                    <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                      {t('manifest.uploaded')}
                      {uploadName ? `: ${uploadName}` : ''}
                    </p>
                  )}
                </div>
              )}

              <div className="w-56">
                <label className="label">{t('manifest.entrypoint')}</label>
                <input
                  className="input"
                  value={form.static?.entrypoint ?? 'index.html'}
                  onChange={(e) =>
                    patch({ static: { ...(form.static ?? {}), entrypoint: e.target.value } })
                  }
                  placeholder="index.html"
                />
              </div>
            </div>
          )}

          {/* deploy */}
          {form.type === 'deploy' && (
            <div className="space-y-3">
              <div>
                <span className="label">{t('manifest.composeSource')}</span>
                <div className="inline-flex rounded-xl border border-sand-200 p-1 dark:border-sand-700">
                  <button
                    type="button"
                    onClick={() => setComposeSource('paste')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      composeSource === 'paste' ? 'bg-ember-500 text-white' : ''
                    }`}
                  >
                    {t('manifest.composePaste')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeSource('repo')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      composeSource === 'repo' ? 'bg-ember-500 text-white' : ''
                    }`}
                  >
                    {t('manifest.composeRepo')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setComposeSource('image')}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      composeSource === 'image' ? 'bg-ember-500 text-white' : ''
                    }`}
                  >
                    {t('manifest.composeImage')}
                  </button>
                </div>
              </div>

              {composeSource === 'image' && (
                <div className="space-y-2">
                  <div>
                    <label className="label">{t('manifest.imageName')}</label>
                    <input
                      className="input"
                      value={image}
                      onChange={(e) => setImage(e.target.value)}
                      placeholder="nginx:latest"
                    />
                    <p className="mt-1 text-xs text-sand-400">{t('manifest.imageHint')}</p>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="w-32">
                      <label className="label">{t('manifest.containerPort')}</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={65535}
                        value={containerPort}
                        onChange={(e) => setContainerPort(e.target.value)}
                      />
                    </div>
                    <div className="w-32">
                      <label className="label">{t('manifest.hostPort')}</label>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={65535}
                        value={hostPort}
                        onChange={(e) => setHostPort(e.target.value)}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={generateFromImage}
                      disabled={!image.trim()}
                    >
                      {t('manifest.imageGenerate')}
                    </button>
                  </div>
                </div>
              )}

              {composeSource === 'repo' && (
                <div>
                  <label className="label">{t('manifest.repoUrl')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      className="input flex-1"
                      type="url"
                      value={repoUrl}
                      onChange={(e) => setRepoUrl(e.target.value)}
                      placeholder="https://github.com/owner/repo"
                    />
                    <button
                      type="button"
                      className="btn-secondary shrink-0"
                      onClick={() => void loadFromRepo()}
                      disabled={repoLoading || !repoUrl.trim()}
                    >
                      {repoLoading && <Spinner className="h-4 w-4" />}
                      {t('manifest.repoLoad')}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-sand-400">{t('manifest.repoHint')}</p>
                </div>
              )}

              <div>
                <label className="label">
                  {composeSource === 'paste' ? t('manifest.compose') : t('manifest.composeLoaded')}
                </label>
                <textarea
                  className="input h-40 resize-none font-mono text-xs"
                  value={form.deploy?.docker_compose ?? ''}
                  onChange={(e) =>
                    patch({
                      deploy: {
                        docker_compose: e.target.value,
                        required_env: form.deploy?.required_env ?? [],
                        default_port: form.deploy?.default_port ?? 8080,
                      },
                    })
                  }
                  placeholder={'services:\n  app:\n    image: …'}
                  required
                />
              </div>
              <div className="w-40">
                <label className="label">{t('manifest.defaultPort')}</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={65535}
                  value={form.deploy?.default_port ?? 8080}
                  onChange={(e) =>
                    patch({
                      deploy: {
                        docker_compose: form.deploy?.docker_compose ?? '',
                        required_env: form.deploy?.required_env ?? [],
                        default_port: Number(e.target.value) || 8080,
                      },
                    })
                  }
                />
              </div>

              {/* volumes editor */}
              <VolumesEditor
                volumes={form.deploy?.volumes ?? []}
                onChange={(vols) =>
                  patch({
                    deploy: {
                      docker_compose: form.deploy?.docker_compose ?? '',
                      required_env: form.deploy?.required_env ?? [],
                      default_port: form.deploy?.default_port ?? 8080,
                      volumes: vols,
                    },
                  })
                }
              />

              {/* required_env editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="label !mb-0">{t('manifest.env')}</span>
                  <button
                    type="button"
                    className="btn-ghost !px-2 !py-1 text-xs"
                    onClick={() =>
                      patch({
                        deploy: {
                          docker_compose: form.deploy?.docker_compose ?? '',
                          default_port: form.deploy?.default_port ?? 8080,
                          required_env: [
                            ...(form.deploy?.required_env ?? []),
                            { key: '', label: '', default: '', secret: false },
                          ],
                        },
                      })
                    }
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    {t('manifest.envAdd')}
                  </button>
                </div>
                {(form.deploy?.required_env ?? []).map((row, i) => {
                  const env = form.deploy?.required_env ?? [];
                  const setRow = (next: Partial<typeof row>) => {
                    const copy = env.slice();
                    copy[i] = { ...row, ...next };
                    patch({
                      deploy: {
                        docker_compose: form.deploy?.docker_compose ?? '',
                        default_port: form.deploy?.default_port ?? 8080,
                        required_env: copy,
                      },
                    });
                  };
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        className="input flex-1"
                        value={row.key}
                        onChange={(e) => setRow({ key: e.target.value })}
                        placeholder="KEY"
                      />
                      <input
                        className="input flex-1"
                        value={row.label}
                        onChange={(e) => setRow({ label: e.target.value })}
                        placeholder={t('manifest.envLabel')}
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-sand-500">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-sand-300 text-ember-500"
                          checked={row.secret}
                          onChange={(e) => setRow({ secret: e.target.checked })}
                        />
                        {t('manifest.envSecret')}
                      </label>
                      <button
                        type="button"
                        className="btn-ghost !px-1.5 !py-1 text-red-500"
                        onClick={() =>
                          patch({
                            deploy: {
                              docker_compose: form.deploy?.docker_compose ?? '',
                              default_port: form.deploy?.default_port ?? 8080,
                              required_env: env.filter((_, j) => j !== i),
                            },
                          })
                        }
                        aria-label={t('manifest.delete')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setForm(null)}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />}
              {editingId ? t('manifest.save') : t('manifest.add')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
