import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr, dmy } from '../lib/format';
import { Loading, EmptyState, ErrorState, Pagination, StatCard, ConfirmDialog } from '../components/ui';
import { IconTrash } from '../components/icons';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';

const LIMIT = 100;
const MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'OTHER'];

export default function Payments() {
  const [filters, setFilters] = useState({ search: '', vendorId: '', from: '', to: '', mode: '' });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [agg, setAgg] = useState<any>({});
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { can } = useAuth();

  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/payments', { params: { ...filters, limit: LIMIT, offset } });
      setRows(data.data ?? []);
      setAgg(data);
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

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/payments/${toDelete.id}`);
      toast.success('Payment reversed', 'The invoice outstanding amount has been recalculated.');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not reverse the payment', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Payments</h1>
          <p className="page-sub">
            Every receipt against an invoice. Partial payments are supported — the outstanding amount updates automatically.
          </p>
        </div>
        <Link to="/admin/invoices" className="btn-outline btn-sm">Record from an invoice →</Link>
      </div>

      <div className="stagger grid gap-4 sm:grid-cols-2">
        <StatCard label="Payments recorded" value={agg.total ?? 0} />
        <StatCard label="Total received" value={inr(agg.amount)} tone="success" />
      </div>

      <div className="filters animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <input className="input" placeholder="Invoice number, reference or vendor…"
              value={filters.search} onChange={set('search')} />
          </div>
          <div>
            <label className="label">Vendor</label>
            <select className="input" value={filters.vendorId} onChange={set('vendorId')}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
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
          <div>
            <label className="label">Mode</label>
            <select className="input" value={filters.mode} onChange={set('mode')}>
              <option value="">Any mode</option>
              {MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-ghost btn-sm"
              onClick={() => setFilters({ search: '', vendorId: '', from: '', to: '', mode: '' })}>
              Clear filters
            </button>
          </div>
        </div>
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No payments recorded"
            body="Open an invoice and use “Record payment” to log a receipt."
            action={<Link to="/admin/invoices" className="btn-primary btn-sm">Go to invoices</Link>} />
        </div>
      ) : (
        <div className="table-wrap table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th><th>Invoice</th><th>Vendor</th>
                <th className="text-right">Amount</th><th>Mode</th><th>Reference</th>
                <th>Bank</th><th className="text-right">Invoice total</th>
                <th className="text-right">Still due</th><th>Recorded by</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap text-sm text-ink-700">{dmy(p.payment_date)}</td>
                  <td>
                    <Link to={`/admin/invoices/${p.invoice_id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                      {p.invoice_number}
                    </Link>
                  </td>
                  <td className="max-w-[11rem] truncate text-sm text-ink-800">{p.vendor_name}</td>
                  <td className="text-right font-semibold tabular-nums text-ok-600">{inr(p.amount)}</td>
                  <td><span className="badge-neutral">{p.mode.replace('_', ' ')}</span></td>
                  <td className="max-w-[10rem] truncate text-xs text-ink-600">{p.reference_no || '—'}</td>
                  <td className="max-w-[9rem] truncate text-xs text-ink-600">{p.bank || '—'}</td>
                  <td className="text-right tabular-nums text-ink-600">{inr(p.invoice_total)}</td>
                  <td className={`text-right tabular-nums ${Number(p.outstanding_amount) > 0 ? 'text-danger-600' : 'text-ok-600'}`}>
                    {inr(p.outstanding_amount)}
                  </td>
                  <td className="max-w-[8rem] truncate text-[11px] text-ink-500">{p.created_by_name ?? '—'}</td>
                  <td className="text-right">
                    {can('payments.delete') && (
                      <button onClick={() => setToDelete(p)} className="btn-ghost btn-icon text-danger-600" title="Reverse payment" aria-label="Reverse payment"><IconTrash className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination offset={offset} limit={LIMIT} total={agg.total ?? 0} onChange={setOffset} />
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} busy={busy} danger
        title="Reverse this payment?" confirmLabel="Reverse payment"
        body={
          <>
            <p>{inr(toDelete?.amount)} recorded against <strong>{toDelete?.invoice_number}</strong> on {dmy(toDelete?.payment_date)}.</p>
            <p className="mt-2 text-ink-500">
              The payment entry is deleted and the invoice's paid and outstanding amounts are recalculated.
            </p>
          </>
        }
      />
    </div>
  );
}
