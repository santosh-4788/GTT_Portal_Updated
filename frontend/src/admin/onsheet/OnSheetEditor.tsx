import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Modal, Spinner, Loading, ErrorState } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/api';
import { dmyTime } from '../../lib/format';
import { IconChevron, IconDownload, IconUsers, IconWarning, IconRefresh, IconCheck, IconEye } from '../../components/icons';
import { onsheetApi, OpenedFile, Access, canEdit, canShare, nameError, NAME_MAX, ACCESS_LABEL } from './onsheetApi';
import ShareDialog from './ShareDialog';
import RowMenu from './RowMenu';
import type { MountedSheet } from './univerSetup';

type Status = 'loading' | 'saved' | 'dirty' | 'saving' | 'offline' | 'conflict' | 'error' | 'readonly';

interface Backup { data: any; baseVersion: number; savedAt: number; name: string }
const backupKey = (uid: string) => `onsheet.backup.${uid}`;
function readBackup(uid: string): Backup | null {
  try {
    const raw = localStorage.getItem(backupKey(uid));
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup;
    return b && b.data && typeof b.baseVersion === 'number' ? b : null;
  } catch { return null; }
}
function writeBackup(uid: string, b: Backup): boolean {
  try { localStorage.setItem(backupKey(uid), JSON.stringify(b)); return true; } catch { return false; }
}
function clearBackup(uid: string) {
  try { localStorage.removeItem(backupKey(uid)); } catch { /* storage blocked */ }
}
/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> epoch ms. */
const serverTime = (s?: string | null) => (s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')).getTime() : 0);

const AUTOSAVE_MS = 2000;
const PRESENCE_MS = 20_000;

const FUNCTIONS: { name: string; example: string; note: string }[] = [
  { name: 'SUM', example: '=SUM(B2:B20)', note: 'Adds numbers' },
  { name: 'AVERAGE', example: '=AVERAGE(C2:C50)', note: 'Mean of numbers' },
  { name: 'MIN / MAX', example: '=MAX(D2:D99)', note: 'Smallest / largest' },
  { name: 'COUNT / COUNTA', example: '=COUNTA(A2:A500)', note: 'Count numbers / non-empty cells' },
  { name: 'IF', example: '=IF(E2>5000,"High","Normal")', note: 'Choose by a condition' },
  { name: 'SUMIF / SUMIFS', example: '=SUMIFS(F:F,A:A,"Mumbai",B:B,">=100")', note: 'Add where conditions match' },
  { name: 'COUNTIF / COUNTIFS', example: '=COUNTIF(C:C,"Innova")', note: 'Count where conditions match' },
  { name: 'ROUND', example: '=ROUND(G2*1.05,2)', note: 'Round to n decimals' },
  { name: 'TODAY / NOW', example: '=TODAY()', note: "Today's date" },
  { name: 'Date arithmetic', example: '=B2-A2   or   =A2+30', note: 'Days between / date plus days' },
  { name: 'VLOOKUP / XLOOKUP', example: '=VLOOKUP(A2,Rates!A:C,3,FALSE)', note: 'Look up a value' },
  { name: 'Cross-sheet', example: '=Sheet2!A1', note: "Another sheet's cell" },
  { name: 'Absolute refs', example: '=B2*$H$1', note: '$ keeps a reference fixed when copied' },
];

export default function OnSheetEditor() {
  const { uid = '' } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const [file, setFile] = useState<OpenedFile | null>(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<Status>('loading');
  const [statusDetail, setStatusDetail] = useState('');
  const [engineError, setEngineError] = useState('');
  const [engineReady, setEngineReady] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const [restoreOffer, setRestoreOffer] = useState<{ backup: Backup; server: OpenedFile } | null>(null);
  const [conflict, setConflict] = useState<{ currentVersion: number; updatedBy: string | null; updatedAt: string; data: any } | null>(null);
  const [resolving, setResolving] = useState<'' | 'reload' | 'force' | 'copy'>('');
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [others, setOthers] = useState<{ userId: number; name: string; editing: boolean }[]>([]);
  const [newerBy, setNewerBy] = useState<{ version: number; by: string | null } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedSheet | null>(null);
  const initialData = useRef<any>(null);
  const version = useRef(0);
  const dirty = useRef(false);
  const saving = useRef(false);
  const again = useRef(false);
  const blocked = useRef(false);            // conflict / fatal error: no autosave
  const timer = useRef<number | null>(null);
  const retryDelay = useRef(5000);
  const access = useRef<Access>('VIEW');
  const fileName = useRef('');

  const editable = canEdit(file?.access);

  /* ------------------------------------------------------------------ load */
  const startEditor = useCallback((data: any, baseVersion: number, startDirty: boolean) => {
    initialData.current = data;
    version.current = baseVersion;
    dirty.current = startDirty;
    blocked.current = false;
    setConflict(null);
    setNewerBy(null);
    setStatus(canEdit(access.current) ? (startDirty ? 'dirty' : 'saved') : 'readonly');
    setMountKey((k) => k + 1);
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    setStatus('loading');
    try {
      const f = await onsheetApi.open(uid);
      access.current = f.access;
      fileName.current = f.name;
      setFile(f);
      setNameDraft(f.name);
      const b = canEdit(f.access) ? readBackup(uid) : null;
      if (b && (b.baseVersion >= f.version || b.savedAt > serverTime(f.updatedAt))) {
        setRestoreOffer({ backup: b, server: f });
        return;
      }
      if (b) clearBackup(uid);            // older than what the server has: nothing to offer
      startEditor(f.data, f.version, false);
    } catch (e) {
      setLoadError(errorMessage(e));
      setStatus('error');
    }
  }, [uid, startEditor]);

  useEffect(() => { void load(); }, [load]);

  /* ----------------------------------------------------------------- save */
  const schedule = useCallback((ms = AUTOSAVE_MS) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; void saveRef.current(); }, ms);
  }, []);

  const save = useCallback(async (opts: { force?: boolean; data?: any } = {}): Promise<boolean> => {
    const m = mounted.current;
    if (!m || !canEdit(access.current)) return false;
    if (blocked.current && !opts.force) return false;
    if (!dirty.current && !opts.force) return true;
    if (saving.current) { again.current = true; return false; }
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }

    let snap: any;
    try {
      snap = opts.data ?? m.snapshot();
    } catch (e) {
      setStatus('error');
      setStatusDetail('Could not read the sheet to save it.');
      return false;
    }
    saving.current = true;
    dirty.current = false;
    setStatus('saving');
    writeBackup(uid, { data: snap, baseVersion: version.current, savedAt: Date.now(), name: fileName.current });

    try {
      const r = await onsheetApi.save(uid, snap, version.current, !!opts.force);
      version.current = r.version;
      retryDelay.current = 5000;
      blocked.current = false;
      setNewerBy(null);
      setFile((f) => (f ? { ...f, version: r.version, updatedAt: r.updatedAt, sizeBytes: r.sizeBytes, sheetCount: r.sheetCount } : f));
      if (dirty.current) {
        setStatus('dirty');
        schedule();
      } else {
        clearBackup(uid);
        setStatus('saved');
        setStatusDetail(`Saved at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
      }
      return true;
    } catch (e: any) {
      dirty.current = true;
      const res = e?.response;
      if (res?.status === 409 && res.data?.code === 'VERSION_CONFLICT') {
        blocked.current = true;
        setStatus('conflict');
        setConflict({ currentVersion: res.data.currentVersion, updatedBy: res.data.updatedBy, updatedAt: res.data.updatedAt, data: snap });
      } else if (!res) {
        // No answer at all: offline, or the server is restarting. Keep trying.
        setStatus('offline');
        setStatusDetail('Your changes are kept on this computer and will be saved when the connection is back.');
        schedule(retryDelay.current);
        retryDelay.current = Math.min(60_000, retryDelay.current * 2);
      } else if (res.status === 403 || res.status === 404) {
        blocked.current = true;
        setStatus('error');
        setStatusDetail(errorMessage(e));
        toast.error('Cannot save', errorMessage(e));
      } else if (res.status >= 500) {
        setStatus('offline');
        setStatusDetail(errorMessage(e));
        schedule(retryDelay.current);
        retryDelay.current = Math.min(60_000, retryDelay.current * 2);
      } else {
        blocked.current = true;
        setStatus('error');
        setStatusDetail(errorMessage(e));
        toast.error('Could not save', errorMessage(e));
      }
      return false;
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        if (dirty.current && !blocked.current) schedule(300);
      }
    }
  }, [uid, schedule, toast]);

  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  const onChange = useCallback(() => {
    dirty.current = true;
    if (blocked.current) return;
    setStatus((s) => (s === 'saving' ? s : 'dirty'));
    schedule();
  }, [schedule]);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  /* ---------------------------------------------------------------- mount */
  useEffect(() => {
    if (!mountKey) return;
    let cancelled = false;
    let instance: MountedSheet | null = null;
    setEngineReady(false);
    setEngineError('');
    (async () => {
      try {
        const { mountUniver } = await import('./univerSetup');
        if (cancelled || !containerRef.current) return;
        instance = mountUniver(containerRef.current, initialData.current, {
          readOnly: !canEdit(access.current),
          onChange: () => onChangeRef.current(),
        });
        mounted.current = instance;
        setEngineReady(true);
        if (dirty.current) schedule();
      } catch (e: any) {
        if (!cancelled) setEngineError(`The spreadsheet engine could not start: ${e?.message ?? e}. Reload the page to try again.`);
      }
    })();
    return () => {
      cancelled = true;
      if (instance) {
        instance.dispose();
        if (mounted.current === instance) mounted.current = null;
      }
    };
  }, [mountKey, schedule]);

  /* ---------------------------------------------- Ctrl+S, leave, online */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (!canEdit(access.current)) { toast.info('View only', 'You can download a copy, but not save changes to this file.'); return; }
        if (blocked.current) return;
        dirty.current = true;            // an explicit save always goes through
        void saveRef.current();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (!dirty.current && !saving.current) return;
      const m = mounted.current;
      if (m) {
        try { writeBackup(uid, { data: m.snapshot(), baseVersion: version.current, savedAt: Date.now(), name: fileName.current }); } catch { /* best effort */ }
      }
      e.preventDefault();
      e.returnValue = '';
    };
    const onOnline = () => { if (dirty.current && !blocked.current) { retryDelay.current = 5000; schedule(200); } };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('beforeunload', onLeave);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('online', onOnline);
    };
  }, [uid, schedule, toast]);

  // Leaving the page inside the portal: keep a backup and make one last save.
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    const m = mounted.current;
    if (m && dirty.current && canEdit(access.current)) {
      try {
        const snap = m.snapshot();
        writeBackup(uid, { data: snap, baseVersion: version.current, savedAt: Date.now(), name: fileName.current });
        if (!blocked.current) {
          onsheetApi.save(uid, snap, version.current).then(() => clearBackup(uid)).catch(() => { /* backup stays for next open */ });
        }
      } catch { /* best effort */ }
    }
  }, [uid]);

  /* ------------------------------------------------------------- presence */
  useEffect(() => {
    if (!file) return;
    let stop = false;
    const beat = async () => {
      try {
        const p = await onsheetApi.presence(uid);
        if (stop) return;
        setOthers(p.others);
        if (p.version > version.current && !saving.current) setNewerBy({ version: p.version, by: p.updatedBy ?? null });
      } catch { /* presence is a nicety */ }
    };
    void beat();
    const t = window.setInterval(beat, PRESENCE_MS);
    return () => {
      stop = true;
      window.clearInterval(t);
      onsheetApi.presence(uid, true).catch(() => {});
    };
  }, [uid, !!file]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------- actions */
  const commitRename = async () => {
    if (!file) return;
    const name = nameDraft.replace(/\s+/g, ' ').trim();
    if (name === file.name) { setNameDraft(file.name); return; }
    const err = nameError(name);
    if (err) { toast.error('Name not changed', err); setNameDraft(file.name); return; }
    setRenaming(true);
    try {
      await onsheetApi.rename(uid, name);
      fileName.current = name;
      setFile((f) => (f ? { ...f, name } : f));
      setNameDraft(name);
      toast.success('Renamed', `Now called “${name}”.`);
    } catch (e) {
      toast.error('Could not rename', errorMessage(e));
      setNameDraft(file.name);
    } finally {
      setRenaming(false);
    }
  };

  const download = async (format: 'xlsx' | 'csv') => {
    try {
      if (dirty.current && canEdit(access.current) && !blocked.current) {
        const ok = await save();
        if (!ok) toast.warning('Downloading the last saved version', 'Your latest changes are not saved yet.');
      } else if (dirty.current || blocked.current) {
        toast.warning('Downloading the last saved version', 'Changes that are not saved are not in the download.');
      }
      const sheetId = format === 'csv' ? mounted.current?.activeSheetId() ?? undefined : undefined;
      await onsheetApi.download(uid, format, sheetId);
    } catch (e) {
      toast.error('Download failed', errorMessage(e));
    }
  };

  const reloadTheirs = async () => {
    setResolving('reload');
    try {
      const f = await onsheetApi.open(uid);
      access.current = f.access;
      fileName.current = f.name;
      setFile(f);
      setNameDraft(f.name);
      clearBackup(uid);
      startEditor(f.data, f.version, false);
      toast.info('Reloaded', 'You are now looking at the latest saved version.');
    } catch (e) {
      toast.error('Could not reload', errorMessage(e));
    } finally {
      setResolving('');
    }
  };

  const overwrite = async () => {
    if (!conflict) return;
    setResolving('force');
    blocked.current = false;
    const m = mounted.current;
    const data = m ? m.snapshot() : conflict.data;
    const ok = await save({ force: true, data });
    setResolving('');
    if (ok) {
      setConflict(null);
      toast.success('Saved', 'Your version replaced the other one.');
    }
  };

  const saveAsCopy = async () => {
    if (!conflict || !file) return;
    setResolving('copy');
    try {
      const data = mounted.current ? mounted.current.snapshot() : conflict.data;
      const name = `${file.name} (my copy)`.slice(0, NAME_MAX);
      const r = await onsheetApi.create(name, data);
      dirty.current = false;
      blocked.current = true;
      clearBackup(uid);
      setConflict(null);
      toast.success('Saved as a copy', `Your changes are in “${r.name}”.`);
      navigate(`/admin/onsheet/${r.uid}`);
    } catch (e) {
      toast.error('Could not save a copy', errorMessage(e));
    } finally {
      setResolving('');
    }
  };

  const restore = (useBackup: boolean) => {
    if (!restoreOffer) return;
    const { backup, server } = restoreOffer;
    setRestoreOffer(null);
    if (useBackup) {
      // Saved against the version it was edited from, so if somebody else has
      // saved since, the normal conflict dialog takes over.
      startEditor(backup.data, backup.baseVersion, true);
      toast.info('Unsaved changes restored', 'They will be saved in a moment.');
    } else {
      clearBackup(uid);
      startEditor(server.data, server.version, false);
    }
  };

  /* ---------------------------------------------------------------- render */
  if (loadError) {
    return (
      <div className="page">
        <Link to="/admin/onsheet" className="btn-ghost btn-sm w-fit"><IconChevron className="h-4 w-4 rotate-180" /> All spreadsheets</Link>
        <div className="card"><ErrorState message={loadError} onRetry={load} /></div>
      </div>
    );
  }

  const statusView: Record<Status, { text: string; cls: string; icon?: JSX.Element }> = {
    loading: { text: 'Loading…', cls: 'text-ink-500', icon: <Spinner className="h-3.5 w-3.5" /> },
    saved: { text: 'Saved', cls: 'text-ok-700', icon: <IconCheck className="h-3.5 w-3.5" /> },
    dirty: { text: 'Unsaved changes', cls: 'text-warn-700' },
    saving: { text: 'Saving…', cls: 'text-ink-600', icon: <Spinner className="h-3.5 w-3.5" /> },
    offline: { text: 'Offline — will retry', cls: 'text-danger-700', icon: <IconWarning className="h-3.5 w-3.5" /> },
    conflict: { text: 'Conflict', cls: 'text-danger-700', icon: <IconWarning className="h-3.5 w-3.5" /> },
    error: { text: 'Not saved', cls: 'text-danger-700', icon: <IconWarning className="h-3.5 w-3.5" /> },
    readonly: { text: '', cls: '' },
  };
  const sv = statusView[status];

  return (
    <div className="flex h-[calc(100dvh-var(--header-h)-2rem)] min-h-[26rem] flex-col gap-2 sm:h-[calc(100dvh-var(--header-h)-3rem)]">
      {/* Toolbar */}
      <div className="card flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <Link to="/admin/onsheet" className="btn-ghost btn-icon" aria-label="Back to all spreadsheets" title="All spreadsheets">
          <IconChevron className="h-4 w-4 rotate-180" />
        </Link>
        <div className="min-w-0 flex-1">
          {file ? (
            editable ? (
              <input
                className="w-full min-w-[8rem] max-w-xl truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-md font-semibold text-ink-900 hover:border-ink-200 focus:border-brand-500 focus:outline-none"
                value={nameDraft} maxLength={NAME_MAX + 20} disabled={renaming} aria-label="Spreadsheet name"
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') { setNameDraft(file.name); (e.target as HTMLInputElement).blur(); }
                }}
              />
            ) : <h1 className="truncate px-1.5 text-md font-semibold text-ink-900">{file.name}</h1>
          ) : <div className="skeleton h-5 w-48" />}
          {file && (
            <p className="truncate px-1.5 text-xs text-ink-500">
              {file.ownerName ? `Owner: ${file.access === 'OWNER' ? 'you' : file.ownerName} · ` : ''}
              Last saved {dmyTime(file.updatedAt)}{file.updatedByName ? ` by ${file.updatedByName}` : ''}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {file && !editable && <span className="badge-neutral inline-flex items-center gap-1"><IconEye className="h-3.5 w-3.5" /> View only</span>}
          {file && editable && sv.text && (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${sv.cls}`} title={statusDetail || undefined} role="status" aria-live="polite">
              {sv.icon}{sv.text}
            </span>
          )}
          {file && editable && (status === 'dirty' || status === 'offline' || status === 'error') && (
            <button className="btn-outline btn-sm" onClick={() => { dirty.current = true; blocked.current = status === 'error' ? false : blocked.current; void save(); }}>
              Save now
            </button>
          )}
          {others.length > 0 && (
            <span className="badge-warn" title={others.map((o) => `${o.name}${o.editing ? ' (can edit)' : ' (viewing)'}`).join(', ')}>
              Also open: {others.map((o) => o.name).join(', ')}
            </span>
          )}

          <div className="relative">
            <button className="btn-ghost btn-sm" onClick={() => setHelpOpen((o) => !o)} aria-expanded={helpOpen}>Supported functions</button>
            {helpOpen && (
              <div className="absolute right-0 top-full z-40 mt-1 w-[min(92vw,28rem)] rounded-xl border border-ink-200 bg-white p-4 shadow-pop">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">Formulas you can use</p>
                  <button className="btn-ghost btn-sm" onClick={() => setHelpOpen(false)}>Close</button>
                </div>
                <div className="max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {FUNCTIONS.map((f) => (
                        <tr key={f.name} className="border-b border-ink-100 last:border-0">
                          <td className="py-1.5 pr-2 font-semibold text-ink-800">{f.name}</td>
                          <td className="py-1.5 pr-2 font-mono text-[11px] text-brand-700">{f.example}</td>
                          <td className="py-1.5 text-ink-500">{f.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs leading-relaxed text-ink-600">
                    Start a formula with <b>=</b>. OnSheet’s engine covers several hundred Excel functions (maths, text,
                    date, lookup, logical, statistical), but it is not 100% Excel-compatible: a few functions and edge
                    cases calculate differently or are missing. Charts, pivot tables, macros (VBA), pictures and comments
                    are not supported. Filters, sorting, conditional formatting, data validation and find &amp; replace
                    (Ctrl+F) are available but are kept only inside OnSheet — they are not written into downloaded .xlsx files.
                  </p>
                </div>
              </div>
            )}
          </div>

          {file && canShare(file.access) && (
            <button className="btn-outline btn-sm" onClick={() => setShareOpen(true)}><IconUsers className="h-4 w-4" /> Share</button>
          )}
          {file && (
            <RowMenu label="Download" buttonClass="btn-outline btn-sm"
              trigger={<><IconDownload className="h-4 w-4" /> Download</>}
              items={[
                { label: 'Excel workbook (.xlsx)', onSelect: () => void download('xlsx') },
                { label: 'This sheet as .csv', onSelect: () => void download('csv') },
              ]} />
          )}
        </div>
      </div>

      {file && !editable && (
        <p className="notice-info px-3 py-2 text-sm">
          You have view-only access ({ACCESS_LABEL[file.access].toLowerCase()}). You can look around, filter and download, but
          changes cannot be saved. Ask the owner for edit access if you need it.
        </p>
      )}
      {newerBy && status !== 'conflict' && (
        <div className="notice-warn flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="flex-1">{newerBy.by ?? 'Someone'} saved a newer version of this file.{editable ? ' Your next save will ask what to do.' : ''}</span>
          {!dirty.current && <button className="btn-outline btn-sm" onClick={() => void reloadTheirs()}><IconRefresh className="h-4 w-4" /> Load it</button>}
        </div>
      )}
      <p className="notice-info px-3 py-2 text-xs sm:hidden">Editing works best on a tablet or computer. On a phone you can view and make small changes.</p>

      {/* Univer */}
      <div className="card relative min-h-0 flex-1 overflow-hidden">
        <div key={mountKey} ref={containerRef} className="absolute inset-0" />
        {(!engineReady || status === 'loading') && !engineError && !restoreOffer && (
          <div className="absolute inset-0 grid place-items-center bg-white/80"><Loading label="Opening spreadsheet…" /></div>
        )}
        {engineError && <div className="absolute inset-0 grid place-items-center bg-white"><ErrorState message={engineError} onRetry={() => window.location.reload()} /></div>}
      </div>

      {/* Restore unsaved changes */}
      <Modal open={!!restoreOffer} onClose={() => restore(false)} size="sm" title="Restore unsaved changes?"
        footer={
          <>
            <button className="btn-outline" onClick={() => restore(false)}>Discard them</button>
            <button className="btn-primary" onClick={() => restore(true)}>Restore my changes</button>
          </>
        }>
        <div className="space-y-2 text-sm text-ink-700">
          <p>This computer has changes to “{restoreOffer?.server.name}” from {restoreOffer ? new Date(restoreOffer.backup.savedAt).toLocaleString('en-IN') : ''} that were never saved.</p>
          {restoreOffer && restoreOffer.backup.baseVersion < restoreOffer.server.version && (
            <p className="notice-warn px-3 py-2">The file has been saved since then (by {restoreOffer.server.updatedByName ?? 'someone'}). If you restore, you will be asked whether to keep their version, overwrite it, or save yours as a copy.</p>
          )}
          <p>“Discard them” opens the version saved on the server.</p>
        </div>
      </Modal>

      {/* Version conflict */}
      <Modal open={!!conflict} onClose={() => { /* must choose */ }} size="sm" title="Someone else saved this file"
        footer={
          <>
            <button className="btn-outline" onClick={reloadTheirs} disabled={!!resolving}>
              {resolving === 'reload' && <Spinner />} Reload their version
            </button>
            {can('onsheet.create') && (
              <button className="btn-outline" onClick={saveAsCopy} disabled={!!resolving}>
                {resolving === 'copy' && <Spinner />} Save mine as a copy
              </button>
            )}
            {editable && (
              <button className="btn-danger" onClick={overwrite} disabled={!!resolving}>
                {resolving === 'force' && <Spinner />} Overwrite with mine
              </button>
            )}
          </>
        }>
        <div className="space-y-2 text-sm leading-relaxed text-ink-700">
          <p>
            {conflict?.updatedBy ?? 'Someone'} saved a newer version{conflict?.updatedAt ? ` at ${dmyTime(conflict.updatedAt)}` : ''} while you were editing.
            Your changes have not been saved yet.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>Reload their version</b> — discard your unsaved changes.</li>
            {can('onsheet.create') && <li><b>Save mine as a copy</b> — keep both; your version becomes a new file.</li>}
            {editable && <li><b>Overwrite with mine</b> — replace their changes with yours (recorded in the audit log).</li>}
          </ul>
        </div>
      </Modal>

      {file && shareOpen && (
        <ShareDialog uid={uid} fileName={file.name} open={shareOpen} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
