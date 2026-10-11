/**
 * Invoices — the register.
 *
 * Status is shown as the office thinks of it: Issued, Partially paid, Paid,
 * Overdue, Cancelled. Overdue is worked out from the due date on the server,
 * so it is never stale. Every figure excludes cancelled invoices.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, dmy, todayLocalIso } from '../lib/format';
import { EmptyState, ErrorState, StatusBadge, Pagination, Modal, Spinner, Field, PageHeader } from '../components/ui';
import { DataTable, DateRange, ExportButton, Kpi, Menu, SearchBox, Segmented, type SortState } from '../components/data';
import { IconDownload, IconInvoices, IconRupee, IconWarning, IconCheck, IconEye } from '../components/icons';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';

const LIMIT = 50;
const STATUS_TABS = [
  { value: '', label: 'All' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'ISSUED', label: 'Issued', keys: ['GENERATED', 'SENT'] },
  { value: 'PARTIALLY_PAID', label: 'Partially paid' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PAID', label: 'Paid' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const COLUMN_SORT: Record<string, [string, string]> = {
  invoice_number: ['number_asc', 'number_desc'], invoice_date: ['date_asc', 'date_desc'],
  total_amount: ['total_desc', 'total_desc'], outstanding_amount: ['outstanding_desc', 'outstanding_desc'],
  due_date: ['due_asc', 'due_asc'], vendor_name: ['vendor_asc', 'vendor_asc'],
};

export default function Invoices() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    search: '', vendorId: params.get('vendorId') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '',
    status: params.get('status') ?? '', dueFrom: '', dueTo: '', taxMode: '', sort: '',
  });
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [agg, setAgg] = useState<any>({});
  const [vendors, setVendors] = useState<any[]>([]);
  const [modes, setModes] = useState<{ code: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [settleOpen, setSettleOpen] = useState(false);
  const [settle, setSettle] = useState({ date: todayLocalIso(), mode: 'BANK_TRANSFER', reference: '' });
  const [busy, setBusy] = useState('');

  const toast = useToast();
  const { can } = useAuth();

  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
    api.get('/masters/lists/PAYMENT_MODE/options').then((r) => setModes(r.data.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/invoices', { params: { ...filters, limit: LIMIT, offset } });
      setRows(data.data ?? []);
      setAgg(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filters, offset]);
  useEffect(() => { load(); }, [load]);

  const set = (patch: Partial<typeof filters>) => { setOffset(0); setSelected(new Set()); setFilters((f) => ({ ...f, ...patch })); };
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of agg.counts ?? []) c[r.status] = (c[r.status] ?? 0) + Number(r.count);
    return {
      '': Object.values(c).reduce((s, n) => s + n, 0),
      ISSUED: (c.GENERATED ?? 0) + (c.SENT ?? 0),
      UNPAID: (c.GENERATED ?? 0) + (c.SENT ?? 0) + (c.PARTIALLY_PAID ?? 0) + (c.OVERDUE ?? 0),
      PARTIALLY_PAID: c.PARTIALLY_PAID ?? 0, OVERDUE: c.OVERDUE ?? 0, PAID: c.PAID ?? 0, CANCELLED: c.CANCELLED ?? 0,
    } as Record<string, number>;
  }, [agg]);

  const sortState: SortState = (() => {
    const e = Object.entries(COLUMN_SORT).find(([, [a, d]]) => filters.sort === a || filters.sort === d);
    return e ? { key: e[0], dir: filters.sort === e[1][1] && e[1][0] !== e[1][1] ? 'desc' : 'asc' } : null;
  })();

  const download = async (inv: any, format?: string) => {
    try { await downloadFile(`/invoices/${inv.id}/download${format ? `?format=${format}` : ''}`); }
    catch (err) { toast.error('Download failed', errorMessage(err)); }
  };

  const zip = async () => {
    setBusy('zip');
    try {
      const res = await api.post('/invoices/bulk-download', { invoiceIds: [...selected] }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = `invoices_${todayLocalIso()}.zip`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      let msg = errorMessage(err);
      try { if (err?.response?.data instanceof Blob) msg = JSON.parse(await err.response.data.text()).error ?? msg; } catch { /* keep msg */ }
      toast.error('Download failed', msg);
    } finally { setBusy(''); }
  };

  const doSettle = async () => {
    setBusy('settle');
    try {
      const { data } = await api.post('/payments/bulk-settle', {
        invoiceIds: [...selected], paymentDate: settle.date, mode: settle.mode, referenceNo: settle.reference,
      });
      toast.success(data.message, data.skipped?.length ? `Skipped: ${data.skipped.join(', ')}` : undefined);
      setSettleOpen(false);
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error('Could not record the payments', errorMessage(err));
    } finally { setBusy(''); }
  };

  const unpaidSelected = rows.filter((r) => selected.has(r.id) && Number(r.outstanding_amount) > 0 && r.status !== 'CANCELLED');
  const exportParams = { ...filters };

  return (
    <div className="page">
      <PageHeader
        title="Invoices"
        subtitle="Every invoice raised, with its document, revisions and payment status. Overdue is worked out from each invoice's due date."
        actions={
          <>
            <ExportButton url="/invoices/export" params={exportParams} label="Export register" />
            {can('invoices.create') && <Link to="/admin/billing" className="btn-primary btn-sm"><IconInvoices className="h-3.5 w-3.5" /> Generate invoices</Link>}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Invoiced value" value={inr(agg.amount)} tone="brand" icon={<IconInvoices className="h-4 w-4" />} sub={`${agg.total ?? 0} invoice(s) match`} />
        <Kpi label="Received" value={inr(agg.paid)} tone="success" icon={<IconRupee className="h-4 w-4" />} sub="Against these invoices" />
        <Kpi label="Outstanding" value={inr(agg.outstanding)} tone="warning" icon={<IconCheck className="h-4 w-4" />} sub="Still to be received" />
        <Kpi label="Overdue" value={inr(agg.overdue)} tone={Number(agg.overdue) > 0 ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />} sub="Past the due date"
          onClick={() => set({ status: 'OVERDUE' })} />
      </div>

      <section className="card p-3">
        <Segmented value={filters.status} onChange={(v) => set({ status: v })}
          options={STATUS_TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value], alert: t.value === 'OVERDUE' }))} />
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-3">
          <SearchBox value={filters.search} onChange={(v) => set({ search: v })} placeholder="Invoice no., vendor, billed to, Trip ID, passenger…" className="min-w-[14rem] flex-1" />
          <select className="input h-9 w-auto text-[13px]" value={filters.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
          </select>
          <select className="input h-9 w-auto text-[13px]" value={filters.taxMode} onChange={(e) => set({ taxMode: e.target.value })} aria-label="GST">
            <option value="">GST or not</option><option value="GST">With GST</option><option value="IGST">IGST</option><option value="CGST_SGST">CGST + SGST</option><option value="NONE">No GST</option>
          </select>
          <DateRange from={filters.from} to={filters.to} onChange={(r) => set(r)} label="Dated" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-ink-500">Due</span>
            <DateField className="h-9 w-auto text-[13px]" value={filters.dueFrom} placeholder="From" onChange={(v) => set({ dueFrom: v })} />
            <DateField className="h-9 w-auto text-[13px]" value={filters.dueTo} placeholder="To" onChange={(v) => set({ dueTo: v })} />
          </div>
        </div>
      </section>

      {selected.size > 0 && (
        <div className="below-header sticky z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-card">
          <p className="mr-auto text-sm font-semibold text-brand-900">
            {selected.size} selected · {inr(unpaidSelected.reduce((s, r) => s + Number(r.outstanding_amount), 0))} outstanding
          </p>
          <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear</button>
          <button onClick={zip} className="btn-outline btn-sm" disabled={!!busy}>{busy === 'zip' ? <Spinner /> : <IconDownload className="h-3.5 w-3.5" />} Download as ZIP</button>
          {can('payments.create') && (
            <button onClick={() => setSettleOpen(true)} className="btn-primary btn-sm" disabled={!unpaidSelected.length}>Mark paid in full</button>
          )}
        </div>
      )}

      {error ? <ErrorState message={error} onRetry={load} /> : (
        <section className="table-wrap">
          <DataTable
            rows={rows} rowKey={(r) => r.id} loading={loading}
            selectable selected={selected} onSelectedChange={setSelected}
            clientSort={false} sort={sortState}
            onSortChange={(s) => {
              if (!s) return set({ sort: '' });
              const pair = COLUMN_SORT[s.key];
              if (pair) set({ sort: s.dir === 'asc' ? pair[0] : pair[1] });
            }}
            onRowClick={(r) => navigate(`/admin/invoices/${r.id}`)}
            empty={<EmptyState title="No invoices match" body="Clear the filters, or generate invoices from Billing." action={<Link to="/admin/billing" className="btn-primary btn-sm">Go to Billing</Link>} />}
            columns={[
              { key: 'invoice_number', header: 'Invoice', render: (r) => (
                <div>
                  <span className="font-mono text-xs font-semibold text-brand-700">{r.invoice_number}</span>
                  {r.revision > 1 && <span className="ml-1.5 badge-neutral">rev {r.revision}</span>}
                  <span className="cell-meta block max-w-[12rem] truncate" title={r.trip_ids}>{r.trip_ids || `${r.booking_count} trip(s)`}</span>
                </div>
              ) },
              { key: 'vendor_name', header: 'Billed to', render: (r) => (
                <div className="max-w-[12rem]">
                  <p className="truncate text-sm text-ink-800">{r.bill_to_name || r.vendor_name}</p>
                  <p className="cell-meta truncate">{r.vendor_code === 'DIRECT' ? 'Walk-in customer' : r.vendor_name}</p>
                </div>
              ) },
              { key: 'invoice_date', header: 'Date', render: (r) => <span className="whitespace-nowrap">{dmy(r.invoice_date)}</span> },
              { key: 'due_date', header: 'Due', render: (r) => (
                <span className="whitespace-nowrap">{dmy(r.due_date)}{r.days_overdue > 0 && <span className="block text-2xs font-semibold text-danger-600">{r.days_overdue} days late</span>}</span>
              ) },
              { key: 'taxable_amount', header: 'Taxable', align: 'right', sortable: false, render: (r) => inr(r.taxable_amount) },
              { key: 'tax_amount', header: 'GST', align: 'right', sortable: false, render: (r) => r.tax_mode === 'NONE' ? <span className="text-ink-400">—</span> : inr(r.tax_amount) },
              { key: 'total_amount', header: 'Total', align: 'right', render: (r) => <span className="font-semibold text-ink-900">{inr(r.total_amount)}</span> },
              { key: 'outstanding_amount', header: 'Outstanding', align: 'right', render: (r) => (
                <span className={Number(r.outstanding_amount) > 0 && r.status !== 'CANCELLED' ? 'font-semibold text-ink-900' : 'text-ink-400'}>{r.status === 'CANCELLED' ? '—' : inr(r.outstanding_amount)}</span>
              ) },
              { key: 'display_status', header: 'Status', sortable: false, render: (r) => <StatusBadge value={r.display_status} /> },
              { key: 'a', header: '', sortable: false, sticky: true, align: 'right', render: (r) => (
                <Menu items={[
                  { label: 'Open', icon: <IconEye className="h-4 w-4" />, onClick: () => navigate(`/admin/invoices/${r.id}`) },
                  r.file_path && { label: 'Download', icon: <IconDownload className="h-4 w-4" />, onClick: () => download(r) },
                  r.file_path && r.file_type !== 'pdf' && { label: 'Download as PDF', hint: 'If a PDF copy was produced', onClick: () => download(r, 'pdf') },
                  can('payments.create') && Number(r.outstanding_amount) > 0 && r.status !== 'CANCELLED' && { label: 'Record payment', icon: <IconRupee className="h-4 w-4" />, onClick: () => navigate(`/admin/payments?new=1&invoiceId=${r.id}`) },
                ]} />
              ) },
            ]}
          />
          <Pagination offset={offset} limit={LIMIT} total={agg.total ?? 0} onChange={setOffset} />
        </section>
      )}

      <Modal
        open={settleOpen} onClose={() => setSettleOpen(false)} size="sm"
        title="Mark selected invoices as paid"
        subtitle={`${unpaidSelected.length} invoice(s) · ${inr(unpaidSelected.reduce((s, r) => s + Number(r.outstanding_amount), 0))}`}
        footer={
          <>
            <button className="btn-outline" onClick={() => setSettleOpen(false)} disabled={!!busy}>Cancel</button>
            <button className="btn-primary" onClick={doSettle} disabled={!!busy}>{busy === 'settle' && <Spinner />} Record payments</button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Payment date"><DateField value={settle.date} onChange={(v) => setSettle((s) => ({ ...s, date: v }))} max={todayLocalIso()} /></Field>
          <Field label="Payment method">
            <select className="input" value={settle.mode} onChange={(e) => setSettle((s) => ({ ...s, mode: e.target.value }))}>
              {(modes.length ? modes : [{ code: 'BANK_TRANSFER', label: 'Bank transfer' }]).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Reference" hint="UTR / cheque number — recorded on each payment"><input className="input" value={settle.reference} onChange={(e) => setSettle((s) => ({ ...s, reference: e.target.value }))} /></Field>
          <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            A payment equal to the full outstanding amount is recorded against each selected invoice. Cancelled and already-paid invoices are skipped.
          </p>
        </div>
      </Modal>
    </div>
  );
}
