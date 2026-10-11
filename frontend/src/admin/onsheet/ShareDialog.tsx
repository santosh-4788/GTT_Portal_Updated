import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Spinner, Loading, ErrorState, ConfirmDialog } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/api';
import { IconSearch, IconTrash } from '../../components/icons';
import { onsheetApi, PortalUser, SharePermission, SharesInfo, ShareRow } from './onsheetApi';

const PERMS: { value: SharePermission; label: string; hint: string }[] = [
  { value: 'VIEW', label: 'View', hint: 'Open and download only' },
  { value: 'EDIT', label: 'Edit', hint: 'Change cells, sheets and the name' },
  { value: 'MANAGE', label: 'Manage', hint: 'Edit, and share with others' },
];

/**
 * Who a spreadsheet is shared with. Used from the OnSheet list and the editor.
 * Owners can grant any level; Manage users can grant View and Edit only (the
 * server enforces the same rule).
 */
export default function ShareDialog({
  uid, fileName, open, onClose, onChanged,
}: { uid: string; fileName: string; open: boolean; onClose: () => void; onChanged?: () => void }) {
  const toast = useToast();
  const { user: me } = useAuth();
  const [info, setInfo] = useState<SharesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PortalUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<PortalUser | null>(null);
  const [perm, setPerm] = useState<SharePermission>('VIEW');
  const [busy, setBusy] = useState<number | 'add' | null>(null);
  const [toRemove, setToRemove] = useState<ShareRow | null>(null);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setInfo(await onsheetApi.shares(uid));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!open) return;
    setPicked(null); setSearch(''); setResults([]); setPerm('VIEW');
    void load();
  }, [open, load]);

  // Debounced people search.
  useEffect(() => {
    if (!open || picked) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const users = await onsheetApi.users(search.trim());
        if (seq === searchSeq.current) setResults(users);
      } catch (e) {
        if (seq === searchSeq.current) setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [search, open, picked]);

  const sharedIds = new Set([...(info?.shares ?? []).map((s) => s.userId), info?.owner?.userId ?? -1]);
  const candidates = results.filter((u) => !sharedIds.has(u.id));
  const canGrantManage = !!info?.canGrantManage;
  const permsFor = (current?: SharePermission) =>
    PERMS.filter((p) => canGrantManage || p.value !== 'MANAGE' || current === 'MANAGE');

  const add = async () => {
    if (!picked) return;
    setBusy('add');
    try {
      const r = await onsheetApi.setShare(uid, picked.id, perm);
      setInfo((i) => (i ? { ...i, shares: r.shares } : i));
      toast.success('Shared', `${picked.fullName} can now ${perm === 'VIEW' ? 'view' : perm === 'EDIT' ? 'edit' : 'manage'} "${fileName}".`);
      setPicked(null); setSearch('');
      onChanged?.();
    } catch (e) {
      toast.error('Could not share', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const change = async (row: ShareRow, p: SharePermission) => {
    if (p === row.permission) return;
    setBusy(row.userId);
    try {
      const r = await onsheetApi.setShare(uid, row.userId, p);
      setInfo((i) => (i ? { ...i, shares: r.shares } : i));
      onChanged?.();
    } catch (e) {
      toast.error('Could not change access', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const row = toRemove;
    if (!row) return;
    setBusy(row.userId);
    try {
      const r = await onsheetApi.removeShare(uid, row.userId);
      setInfo((i) => (i ? { ...i, shares: r.shares } : i));
      toast.success('Access removed', `${row.fullName} can no longer open "${fileName}".`);
      onChanged?.();
    } catch (e) {
      toast.error('Could not remove access', errorMessage(e));
    } finally {
      setBusy(null);
      setToRemove(null);
    }
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title={`Share "${fileName}"`} subtitle="People in the portal you choose can open this spreadsheet." size="md"
        footer={<button className="btn-outline" onClick={onClose}>Done</button>}>
        {loading ? <Loading variant="inline" label="Loading who has access…" /> : error ? <ErrorState message={error} onRetry={load} /> : (
          <div className="space-y-5">
            {/* Add a person */}
            <div>
              <label className="label" htmlFor="share-search">Add a person</label>
              {picked ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">{picked.fullName}</p>
                    <p className="truncate text-xs text-ink-500">{picked.email}</p>
                  </div>
                  <select className="input w-auto" value={perm} onChange={(e) => setPerm(e.target.value as SharePermission)} aria-label="Access level">
                    {permsFor().map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <button className="btn-primary btn-sm" onClick={add} disabled={busy === 'add'}>
                    {busy === 'add' && <Spinner />} Share
                  </button>
                  <button className="btn-ghost btn-sm" onClick={() => setPicked(null)} disabled={busy === 'add'}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                    <input id="share-search" className="input pl-9" placeholder="Search by name or email" value={search}
                      onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
                  </div>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-ink-200">
                    {searching && !candidates.length ? (
                      <div className="px-3"><Loading variant="inline" label="Searching…" /></div>
                    ) : candidates.length ? (
                      <ul className="divide-y divide-ink-100">
                        {candidates.map((u) => (
                          <li key={u.id}>
                            <button className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50/50" onClick={() => setPicked(u)}>
                              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-100 text-xs font-bold text-ink-600">
                                {u.fullName.slice(0, 1).toUpperCase()}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-ink-900">{u.fullName}</span>
                                <span className="block truncate text-xs text-ink-500">{u.email}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="px-3 py-3 text-sm text-ink-500">
                        {search.trim() ? 'No active user matches that search (or they already have access).' : 'Everyone active already has access.'}
                      </p>
                    )}
                  </div>
                </>
              )}
              <p className="hint mt-1.5">
                {PERMS.filter((p) => canGrantManage || p.value !== 'MANAGE').map((p) => `${p.label}: ${p.hint.toLowerCase()}`).join(' · ')}
                {!canGrantManage && ' · Only the owner can give Manage access.'}
              </p>
            </div>

            {/* Who has access */}
            <div>
              <p className="eyebrow mb-2">Who has access</p>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {info?.owner && (
                  <li className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {info.owner.fullName}{info.owner.userId === me?.id && <span className="ml-1.5 text-xs font-normal text-brand-600">(you)</span>}
                      </p>
                      <p className="truncate text-xs text-ink-500">{info.owner.email}</p>
                    </div>
                    <span className="badge-brand">Owner</span>
                  </li>
                )}
                {info?.shares.map((s) => {
                  const lockedManage = s.permission === 'MANAGE' && !canGrantManage;
                  const self = s.userId === me?.id;
                  return (
                    <li key={s.userId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">
                          {s.fullName}{self && <span className="ml-1.5 text-xs font-normal text-brand-600">(you)</span>}
                          {!s.isActive && <span className="badge-neutral ml-2">Inactive</span>}
                        </p>
                        <p className="truncate text-xs text-ink-500">{s.email}</p>
                      </div>
                      {busy === s.userId && <Spinner className="h-4 w-4 text-brand-600" />}
                      <select className="input h-8 w-auto text-xs" value={s.permission} disabled={lockedManage || self || busy === s.userId}
                        onChange={(e) => change(s, e.target.value as SharePermission)} aria-label={`Access for ${s.fullName}`}>
                        {permsFor(s.permission).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                      <button className="btn-ghost btn-icon text-danger-600" disabled={(lockedManage && !self) || busy === s.userId}
                        onClick={() => setToRemove(s)} aria-label={`Remove ${s.fullName}`} title={lockedManage && !self ? 'Only the owner can remove Manage access' : 'Remove access'}>
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
                {!info?.shares.length && <li className="px-3 py-3 text-sm text-ink-500">Not shared with anyone yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={remove}
        busy={typeof busy === 'number'}
        danger
        title={toRemove?.userId === me?.id ? 'Leave this spreadsheet?' : 'Remove access?'}
        body={toRemove?.userId === me?.id
          ? <p>You will no longer be able to open “{fileName}”.</p>
          : <p>{toRemove?.fullName} will no longer be able to open “{fileName}”.</p>}
        confirmLabel="Remove access"
        cancelLabel="Keep access"
      />
    </>
  );
}
