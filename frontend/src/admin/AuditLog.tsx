import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmyTime, humanise } from '../lib/format';
import { Loading, EmptyState, ErrorState, Pagination } from '../components/ui';
import { DateField } from '../components/DateTimeField';

const LIMIT = 100;

const TONE = (action: string) => {
  if (action.includes('DELETE') || action.includes('CANCEL') || action === 'LOGIN_FAILED') return 'bg-danger-100 text-danger-600';
  if (action.includes('CREATE') || action.includes('GENERATED') || action.includes('ADDED')) return 'bg-ok-100 text-ok-600';
  if (action.includes('UPDATE') || action.includes('CHANGED') || action.includes('REGENERATED')) return 'bg-warn-100 text-warn-600';
  if (action === 'LOGIN' || action === 'LOGOUT') return 'bg-brand-100 text-brand-800';
  return 'bg-ink-100 text-ink-600';
};

export default function AuditLog() {
  const [filters, setFilters] = useState({ search: '', action: '', from: '', to: '' });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/audit', { params: { ...filters, limit: LIMIT, offset } });
      setRows(data.data ?? []);
      setActions(data.actions ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const set = (k: keyof typeof filters) => (e: any) => {
    setOffset(0);
    setFilters((f) => ({ ...f, [k]: e.target.value }));
  };
  const setVal = (k: keyof typeof filters) => (v: string) => set(k)({ target: { value: v } });

  return (
    <div className="page">
      <div>
        <h1 className="page-title">Audit log</h1>
        <p className="page-sub">
          Every sign-in, booking, invoice, payment and settings change, with who did it and from where.
        </p>
      </div>

      <div className="filters animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <input className="input" placeholder="Description or user email…" value={filters.search} onChange={set('search')} />
          </div>
          <div>
            <label className="label">Action</label>
            <select className="input" value={filters.action} onChange={set('action')}>
              <option value="">All actions</option>
              {actions.map((a) => <option key={a} value={a}>{humanise(a)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <DateField value={filters.from} onChange={setVal('from')} placeholder="Any" />
          </div>
          <div>
            <label className="label">To</label>
            <DateField value={filters.to} onChange={setVal('to')} placeholder="Any" />
          </div>
        </div>
        <button className="btn-ghost btn-sm mt-3"
          onClick={() => setFilters({ search: '', action: '', from: '', to: '' })}>
          Clear filters
        </button>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card"><EmptyState title="No matching activity" body="Try widening the filters." /></div>
      ) : (
        <div className="table-wrap table-scroll">
          <table className="tbl">
            <thead>
              <tr><th>When</th><th>User</th><th>Action</th><th>Description</th><th>Record</th><th>IP</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-ink-600">{dmyTime(r.created_at)}</td>
                  <td>
                    <p className="text-sm text-ink-800">{r.user_name ?? '—'}</p>
                    <p className="text-[11px] text-ink-400">{r.user_email ?? ''}</p>
                  </td>
                  <td><span className={`badge ${TONE(r.action)}`}>{humanise(r.action)}</span></td>
                  <td className="max-w-md text-sm text-ink-700">{r.description ?? '—'}</td>
                  <td className="whitespace-nowrap text-xs text-ink-500">
                    {r.entity_type ? `${r.entity_type} #${r.entity_id ?? ''}` : '—'}
                  </td>
                  <td className="whitespace-nowrap font-mono text-[11px] text-ink-400">{r.ip_address || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
        </div>
      )}
    </div>
  );
}
