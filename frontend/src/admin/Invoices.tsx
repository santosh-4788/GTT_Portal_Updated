import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, dmy, todayIso } from '../lib/format';
import { Loading, EmptyState, ErrorState, StatusBadge, Pagination, StatCard, Modal, Spinner, Field } from '../components/ui';
import { IconEye, IconDownload } from '../components/icons';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';

const LIMIT = 50;

export default function Invoices() {
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({
    search: '', vendorId: params.get('vendorId') ?? '', from: '', to: '', status: '',
  });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [agg, setAgg] = useState<any>({});
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleDate, setSettleDate] = useState(todayIso());
  const [settleMode, setSettleMode] = useState('BANK_TRANSFER');
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
      const { data } = await api.get('/invoices', { params: { ...filters, limit: LIMIT, offset } });
      setRows(data.data ?? []);
      setAgg(data);
      setSelected(new Set());
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

  const download = async (inv: any, format?: string) => {
    try {
      await downloadFile(`/invoices/${inv.id}/download${format ? `?format=${format}` : ''}`);
    } catch (err) {
      toast.error('Download failed', errorMessage(err));
    }
  };

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const settle = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/payments/bulk-settle', {
        invoiceIds: [...selected], paymentDate: settleDate, mode: settleMode,
      });
      toast.success(data.message, data.skipped?.length ? `Skipped: ${data.skipped.join(', ')}` : undefined);
      setSettleOpen(false);
      load();
    } catch (err) {
      toast.error('Could not record the payments', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const unpaidSelected = rows.filter((r) => selected.has(r.id) && Number(r.outstanding_amount) > 0);

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-sub">
            Every invoice generated, with its file, revision history and payment status.
          </p>
        </div>
        <Link to="/admin/billing" className="btn-primary btn-sm">+ Generate Invoice</Link>
      </div>

      <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Invoices" value={agg.total ?? 0} />
        <StatCard label="Invoiced value" value={inr(agg.amount)} tone="brand" />
        <StatCard label="Received" value={inr(agg.paid)} tone="success" />
        <StatCard label="Outstanding" value={inr(agg.outstanding)} tone="danger" />
      </div>

      <div className="filters animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <input className="input" placeholder="Invoice number or vendor…" value={filters.search} onChange={set('search')} />
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
            <label className="label">Status</label>
            <select className="input" value={filters.status} onChange={set('status')}>
              <option value="">Any status</option>
              {['GENERATED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'].map((s) =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn-ghost btn-sm"
              onClick={() => setFilters({ search: '', vendorId: '', from: '', to: '', status: '' })}>
              Clear filters
            </button>
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3">
          <p className="mr-auto text-sm font-semibold text-brand-900">
            {selected.size} selected · {inr(unpaidSelected.reduce((s, r) => s + Number(r.outstanding_amount), 0))} outstanding
          </p>
          <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear</button>
          {can('payments.create') && (
            <button onClick={() => setSettleOpen(true)} className="btn-primary btn-sm" disabled={!unpaidSelected.length}>
              Mark paid in full
            </button>
          )}
        </div>
      )}

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No invoices yet"
            body="Generate your first invoice from the Billing screen by selecting bookings for a vendor."
            action={<Link to="/admin/billing" className="btn-primary btn-sm">Go to Billing</Link>} />
        </div>
      ) : (
        <div className="table-wrap table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10"></th>
                <th>Invoice</th><th>Vendor</th><th>Date</th><th>Period</th>
                <th className="text-right">Bookings</th><th className="text-right">Taxable</th>
                <th className="text-right">Tax</th><th className="text-right">Total</th>
                <th className="text-right">Outstanding</th><th>Status</th><th>By</th>
                <th className="sticky-end text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'bg-brand-50/60' : ''}>
                  <td>
                    <input type="checkbox" className="check"
                      checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    <Link to={`/admin/invoices/${r.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                      {r.invoice_number}
                    </Link>
                    {r.revision > 1 && <span className="ml-1.5 badge-neutral">rev {r.revision}</span>}
                  </td>
                  <td>
                    <p className="max-w-[11rem] truncate text-sm text-ink-800">{r.vendor_name}</p>
                    <p className="text-[11px] text-ink-400">{r.vendor_code}</p>
                  </td>
                  <td className="whitespace-nowrap text-sm text-ink-600">{dmy(r.invoice_date)}</td>
                  <td className="whitespace-nowrap text-[11px] text-ink-500">
                    {r.period_from ? `${dmy(r.period_from)} – ${dmy(r.period_to)}` : '—'}
                  </td>
                  <td className="text-right tabular-nums text-ink-700">{r.booking_count}</td>
                  <td className="text-right tabular-nums text-ink-600">{inr(r.taxable_amount)}</td>
                  <td className="text-right tabular-nums text-ink-600">{inr(r.tax_amount)}</td>
                  <td className="text-right font-semibold tabular-nums text-ink-900">{inr(r.total_amount)}</td>
                  <td className={`text-right tabular-nums ${Number(r.outstanding_amount) > 0 ? 'font-semibold text-danger-600' : 'text-ok-600'}`}>
                    {inr(r.outstanding_amount)}
                  </td>
                  <td><StatusBadge value={r.status} /></td>
                  <td className="max-w-[7rem] truncate text-[11px] text-ink-500">{r.generated_by_name ?? '—'}</td>
                  <td className="sticky-end">
                    <div className="row-actions">
                      <Link to={`/admin/invoices/${r.id}`} className="btn-ghost btn-icon" title="Preview" aria-label="Preview"><IconEye className="h-4 w-4" /></Link>
                      {r.file_path && (
                        <button onClick={() => download(r)} className="btn-ghost btn-icon" title="Download" aria-label="Download"><IconDownload className="h-4 w-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination offset={offset} limit={LIMIT} total={agg.total ?? 0} onChange={setOffset} />
        </div>
      )}

      <Modal
        open={settleOpen} onClose={() => setSettleOpen(false)}
        title="Mark selected invoices as paid" size="sm"
        subtitle={`${unpaidSelected.length} invoice(s) · ${inr(unpaidSelected.reduce((s, r) => s + Number(r.outstanding_amount), 0))}`}
        footer={
          <>
            <button className="btn-outline" onClick={() => setSettleOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={settle} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Record payments
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Payment date">
            <DateField value={settleDate} onChange={setSettleDate} />
          </Field>
          <Field label="Payment mode">
            <select className="input" value={settleMode} onChange={(e) => setSettleMode(e.target.value)}>
              {['BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CASH', 'OTHER'].map((m) =>
                <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            A payment equal to the full outstanding amount is recorded against each selected invoice.
            Cancelled and already-paid invoices are skipped.
          </p>
        </div>
      </Modal>
    </div>
  );
}
