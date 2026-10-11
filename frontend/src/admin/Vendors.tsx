import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr } from '../lib/format';
import { Loading, EmptyState, ErrorState, StatusBadge, ConfirmDialog } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { ExportButton } from '../components/data';

export default function Vendors() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { can } = useAuth();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/vendors', { params: { search, status } });
      setRows(data.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/vendors/${toDelete.id}`);
      toast.success(`${toDelete.vendor_name} deleted`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not delete this vendor', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="page-sub">
            Each vendor carries its own invoice template, tax rules, billing cycle and numbering.
          </p>
        </div>
        <div className="page-actions">
          <ExportButton url="/vendors/export" params={{ search, status }} />
          {can('vendors.create') && <Link to="/admin/vendors/new" className="btn-primary btn-sm">+ Add Vendor</Link>}
        </div>
      </div>

      <div className="filters animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="label">Search</label>
            <input className="input" placeholder="Vendor name, company or code…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No vendors yet"
            body="Add the companies and aggregators that send you bookings. Each one can have its own invoice format."
            action={can('vendors.create') ? <Link to="/admin/vendors/new" className="btn-primary btn-sm">+ Add Vendor</Link> : undefined}
          />
        </div>
      ) : (
        <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((v) => (
            <div key={v.id} className="card flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-900 text-xs font-bold text-gold-400">
                  {v.code?.slice(0, 4)}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-ink-900">{v.vendor_name}</h3>
                  <p className="truncate text-xs text-ink-500">{v.company_name}</p>
                </div>
                <StatusBadge value={v.status} />
              </div>

              <dl className="mt-4 space-y-1.5 text-xs">
                {v.gst_number && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-ink-500">GSTIN</dt>
                    <dd className="font-mono text-ink-700">{v.gst_number}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">Tax</dt>
                  <dd className="text-ink-700">
                    {v.tax_mode === 'NONE' ? 'Exempt' : `${v.tax_mode.replace('_', ' + ')} ${v.tax_rate}%`}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">Template</dt>
                  <dd className={`truncate text-right ${v.template_name ? 'text-ink-700' : 'text-warn-600'}`}>
                    {v.template_name ?? 'Not assigned'}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-500">Billing</dt>
                  <dd className="text-ink-700">
                    {v.billing_cycle?.replace('_', ' ').toLowerCase()}
                    {v.consolidation_allowed ? ' · consolidated' : ''}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-100 pt-4 text-center">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-400">Bookings</p>
                  <p className="text-sm font-bold text-ink-900">{v.booking_count}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-400">Invoiced</p>
                  <p className="text-sm font-bold text-ink-900">{inr(v.total_invoiced)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-ink-400">Outstanding</p>
                  <p className={`text-sm font-bold ${Number(v.outstanding) > 0 ? 'text-danger-600' : 'text-ink-400'}`}>
                    {inr(v.outstanding)}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <Link to={`/admin/billing?vendorId=${v.id}`} className="btn-outline btn-sm flex-1">Billing</Link>
                {can('vendors.update') && (
                  <Link to={`/admin/vendors/${v.id}/edit`} className="btn-primary btn-sm flex-1">Edit</Link>
                )}
                {can('vendors.delete') && (
                  <button onClick={() => setToDelete(v)} className="btn-ghost btn-sm text-danger-600">🗑</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} busy={busy} danger
        title="Delete this vendor?" confirmLabel="Delete vendor"
        body={
          <>
            <p><strong>{toDelete?.vendor_name}</strong> will be removed permanently.</p>
            <p className="mt-2 text-ink-500">
              Vendors with existing bookings cannot be deleted — set them to Inactive instead.
            </p>
          </>
        }
      />
    </div>
  );
}
