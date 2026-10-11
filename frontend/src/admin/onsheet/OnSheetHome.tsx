import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, Modal, ConfirmDialog, Spinner, Loading, EmptyState, ErrorState, Field, Tabs } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/api';
import { dmyTime } from '../../lib/format';
import { IconPlus, IconSearch, IconDownload, IconTrash, IconEdit, IconDuplicate, IconUsers, IconExternal, IconRefresh } from '../../components/icons';
import {
  onsheetApi, SheetFile, Scope, SortKey, ACCESS_BADGE, ACCESS_LABEL, canEdit, canShare, isOwner,
  formatBytes, nameError, importFileError, NAME_MAX,
} from './onsheetApi';
import ShareDialog from './ShareDialog';
import RowMenu from './RowMenu';

const IconUpload = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
);
const IconSheet = (p: { className?: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17" />
  </svg>
);

const TABS: { key: Exclude<Scope, 'all'>; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'mine', label: 'My spreadsheets' },
  { key: 'shared', label: 'Shared with me' },
];
const TAB_KEY = 'onsheet.tab';

type NameDialog = { mode: 'new' | 'rename' | 'duplicate'; file?: SheetFile; value: string };

export default function OnSheetHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const mayCreate = can('onsheet.create');

  const [tab, setTab] = useState<Exclude<Scope, 'all'>>(() => {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t === 'recent' || t === 'mine' || t === 'shared') return t;
    } catch { /* storage blocked */ }
    return 'recent';
  });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey | ''>('');
  const [files, setFiles] = useState<SheetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [nameDlg, setNameDlg] = useState<NameDialog | null>(null);
  const [nameErr, setNameErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<SheetFile | null>(null);
  const [sharing, setSharing] = useState<SheetFile | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ uid: string; name: string; warnings: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);
  const [params, setParams] = useSearchParams();

  // The portal's quick action "New spreadsheet" links here with ?new=1.
  useEffect(() => {
    if (params.get('new') !== '1') return;
    if (mayCreate) { setNameErr(''); setNameDlg({ mode: 'new', value: '' }); }
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [params, setParams, mayCreate]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked */ }
  }, [tab]);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const rows = await onsheetApi.list(tab, query, sort);
      if (seq === loadSeq.current) setFiles(rows);
    } catch (e) {
      if (seq === loadSeq.current) setError(errorMessage(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [tab, query, sort]);

  useEffect(() => { void load(); }, [load]);

  const open = (f: SheetFile) => navigate(`/admin/onsheet/${f.uid}`);

  /* ---------------- name dialog: new / rename / duplicate ---------------- */
  const submitName = async () => {
    if (!nameDlg) return;
    const name = nameDlg.value.replace(/\s+/g, ' ').trim();
    const err = nameError(name);
    if (err) { setNameErr(err); return; }
    setBusy(true);
    try {
      if (nameDlg.mode === 'new') {
        const r = await onsheetApi.create(name);
        setNameDlg(null);
        navigate(`/admin/onsheet/${r.uid}`);
        return;
      }
      if (nameDlg.mode === 'rename' && nameDlg.file) {
        await onsheetApi.rename(nameDlg.file.uid, name);
        toast.success('Renamed', `Now called “${name}”.`);
      }
      if (nameDlg.mode === 'duplicate' && nameDlg.file) {
        const r = await onsheetApi.duplicate(nameDlg.file.uid, name);
        toast.success('Copy made', `“${r.name}” is in My spreadsheets.`);
      }
      setNameDlg(null);
      void load();
    } catch (e) {
      setNameErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  /* ---------------- import ---------------- */
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const err = importFileError(f);
    if (err) { toast.error('Cannot import that file', err); return; }
    setImporting(true);
    try {
      const r = await onsheetApi.importFile(f);
      if (r.warnings.length) setImportResult(r);
      else {
        toast.success('Imported', `“${r.name}” is ready.`);
        navigate(`/admin/onsheet/${r.uid}`);
      }
    } catch (e2) {
      toast.error('Import failed', errorMessage(e2));
    } finally {
      setImporting(false);
    }
  };

  /* ---------------- delete / download ---------------- */
  const doDelete = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await onsheetApi.remove(toDelete.uid);
      toast.success('Deleted', `“${toDelete.name}” was deleted.`);
      setToDelete(null);
      void load();
    } catch (e) {
      toast.error('Could not delete', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (f: SheetFile, format: 'xlsx' | 'csv') => {
    try {
      await onsheetApi.download(f.uid, format);
    } catch (e) {
      toast.error('Download failed', errorMessage(e));
    }
  };

  const emptyText: Record<typeof tab, { title: string; body: string }> = {
    recent: { title: 'Nothing opened yet', body: 'Spreadsheets you open appear here, most recent first.' },
    mine: { title: 'No spreadsheets yet', body: 'Create a new spreadsheet, or import an Excel or CSV file to get started.' },
    shared: { title: 'Nothing shared with you', body: 'When a colleague shares a spreadsheet with you, it shows up here.' },
  };

  return (
    <div className="page">
      <PageHeader
        title="OnSheet"
        subtitle="Spreadsheets kept inside the portal — create, import from Excel, share with colleagues and download again."
        actions={mayCreate ? (
          <>
            <button className="btn-outline btn-sm" onClick={() => fileInput.current?.click()} disabled={importing}>
              {importing ? <Spinner /> : <IconUpload className="h-4 w-4" />} {importing ? 'Importing…' : 'Import Excel / CSV'}
            </button>
            <button className="btn-primary btn-sm" onClick={() => { setNameErr(''); setNameDlg({ mode: 'new', value: '' }); }}>
              <IconPlus className="h-3.5 w-3.5" /> New spreadsheet
            </button>
            <input ref={fileInput} type="file" className="hidden" onChange={onPick}
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />
          </>
        ) : undefined}
      />

      <div className="card">
        <div className="px-2 pt-1 sm:px-4">
          <Tabs tabs={TABS} active={tab} onChange={(k) => setTab(k)} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-3">
          <div className="relative min-w-[12rem] flex-1 sm:max-w-sm">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <input className="input pl-9" placeholder="Search by name" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search spreadsheets" />
          </div>
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey | '')} aria-label="Sort">
            {tab === 'recent' ? <option value="">Last opened</option> : <option value="">Last modified (newest)</option>}
            {tab === 'recent' && <option value="updated_desc">Last modified (newest)</option>}
            <option value="updated_asc">Last modified (oldest)</option>
            <option value="name_asc">Name A–Z</option>
            <option value="name_desc">Name Z–A</option>
          </select>
          <button className="btn-ghost btn-icon" onClick={() => void load()} aria-label="Refresh" title="Refresh"><IconRefresh className="h-4 w-4" /></button>
        </div>

        {loading && !files.length ? <div className="p-4"><Loading variant="table" /></div>
          : error ? <ErrorState message={error} onRetry={load} />
          : !files.length ? (
            <EmptyState
              icon={<IconSheet />}
              title={query ? 'No spreadsheet matches that search' : emptyText[tab].title}
              body={query ? 'Try a different name, or clear the search.' : emptyText[tab].body}
              action={!query && mayCreate && tab !== 'shared' ? (
                <button className="btn-primary btn-sm" onClick={() => { setNameErr(''); setNameDlg({ mode: 'new', value: '' }); }}>
                  <IconPlus className="h-3.5 w-3.5" /> New spreadsheet
                </button>
              ) : undefined}
            />
          ) : (
            <div className={`table-scroll overflow-x-auto ${loading ? 'opacity-60' : ''}`}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="hidden md:table-cell">Owner</th>
                    <th>Access</th>
                    <th>Last modified</th>
                    <th className="hidden lg:table-cell">Size</th>
                    <th className="w-12"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.uid} className="cursor-pointer" onClick={() => open(f)}>
                      <td className="max-w-[22rem]">
                        <Link to={`/admin/onsheet/${f.uid}`} onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-2.5 font-medium text-ink-900 hover:text-brand-700">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ok-50 text-ok-600"><IconSheet className="h-4 w-4" /></span>
                          <span className="min-w-0">
                            <span className="block truncate">{f.name}</span>
                            {f.shareCount > 0 && isOwner(f.access) && (
                              <span className="block text-xs font-normal text-ink-500">Shared with {f.shareCount}</span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="hidden text-sm text-ink-700 md:table-cell">{isOwner(f.access) ? 'You' : f.ownerName}</td>
                      <td><span className={ACCESS_BADGE[f.access]}>{ACCESS_LABEL[f.access]}</span></td>
                      <td className="whitespace-nowrap text-xs text-ink-600">
                        {dmyTime(f.updatedAt)}
                        {f.updatedByName && <span className="block text-ink-500">by {f.updatedByName}</span>}
                      </td>
                      <td className="hidden whitespace-nowrap text-xs text-ink-600 lg:table-cell">
                        {formatBytes(f.sizeBytes)} · {f.sheetCount} sheet{f.sheetCount === 1 ? '' : 's'}
                      </td>
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        <RowMenu label={`Actions for ${f.name}`} items={[
                          { label: 'Open', icon: <IconExternal className="h-4 w-4" />, onSelect: () => open(f) },
                          { label: 'Rename', icon: <IconEdit className="h-4 w-4" />, hidden: !canEdit(f.access),
                            onSelect: () => { setNameErr(''); setNameDlg({ mode: 'rename', file: f, value: f.name }); } },
                          { label: 'Duplicate', icon: <IconDuplicate className="h-4 w-4" />, hidden: !mayCreate,
                            onSelect: () => { setNameErr(''); setNameDlg({ mode: 'duplicate', file: f, value: `Copy of ${f.name}`.slice(0, NAME_MAX) }); } },
                          { label: 'Share', icon: <IconUsers className="h-4 w-4" />, hidden: !canShare(f.access), onSelect: () => setSharing(f) },
                          { label: 'Download .xlsx', icon: <IconDownload className="h-4 w-4" />, divider: true, onSelect: () => void download(f, 'xlsx') },
                          { label: 'Download .csv (first sheet)', icon: <IconDownload className="h-4 w-4" />, onSelect: () => void download(f, 'csv') },
                          { label: 'Delete', icon: <IconTrash className="h-4 w-4" />, danger: true, divider: true,
                            hidden: !isOwner(f.access) || !can('onsheet.delete'), onSelect: () => setToDelete(f) },
                        ]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {/* New / rename / duplicate */}
      <Modal
        open={!!nameDlg}
        onClose={() => !busy && setNameDlg(null)}
        size="sm"
        title={nameDlg?.mode === 'new' ? 'New spreadsheet' : nameDlg?.mode === 'rename' ? 'Rename spreadsheet' : 'Make a copy'}
        subtitle={nameDlg?.mode === 'duplicate' ? 'The copy is yours; sharing is not copied.' : undefined}
        footer={
          <>
            <button className="btn-outline" onClick={() => setNameDlg(null)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={submitName} disabled={busy}>
              {busy && <Spinner />}{nameDlg?.mode === 'new' ? 'Create and open' : nameDlg?.mode === 'rename' ? 'Rename' : 'Make copy'}
            </button>
          </>
        }
      >
        <form onSubmit={(e) => { e.preventDefault(); void submitName(); }}>
          <Field label="Name" required error={nameErr} hint={`Up to ${NAME_MAX} characters.`}>
            <input className="input" autoFocus maxLength={NAME_MAX + 20} value={nameDlg?.value ?? ''}
              onChange={(e) => { setNameErr(''); setNameDlg((d) => (d ? { ...d, value: e.target.value } : d)); }}
              placeholder="e.g. Fleet fuel log — October" />
          </Field>
        </form>
      </Modal>

      {/* Import warnings */}
      <Modal
        open={!!importResult}
        onClose={() => { setImportResult(null); void load(); }}
        title="Imported — please check these notes"
        subtitle={importResult ? `“${importResult.name}” was created. Some things in the original file could not be brought across:` : undefined}
        footer={
          <>
            <button className="btn-outline" onClick={() => { setImportResult(null); void load(); }}>Back to the list</button>
            <button className="btn-primary" onClick={() => importResult && navigate(`/admin/onsheet/${importResult.uid}`)}>Open spreadsheet</button>
          </>
        }
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-700">
          {importResult?.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
        <p className="notice-info mt-4 text-sm">The original file is unchanged. Keep it if you need the items listed above.</p>
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={doDelete}
        busy={busy}
        danger
        title="Delete this spreadsheet?"
        body={<>
          <p>“{toDelete?.name}” will be deleted for you and for everyone it is shared with.</p>
          {!!toDelete?.shareCount && <p>It is currently shared with {toDelete.shareCount} {toDelete.shareCount === 1 ? 'person' : 'people'}.</p>}
          <p>Download a copy first if you might need it.</p>
        </>}
        confirmLabel="Delete"
        cancelLabel="Keep it"
      />

      {sharing && (
        <ShareDialog uid={sharing.uid} fileName={sharing.name} open={!!sharing}
          onClose={() => setSharing(null)} onChanged={() => void load()} />
      )}
    </div>
  );
}
