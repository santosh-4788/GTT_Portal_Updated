/**
 * Billing — from "the trip has run" to "the invoice is issued".
 *
 *   Ready to bill   the queue, grouped by vendor; select, review the totals, bill
 *   Batches         the controlled route: draft → submitted → approved → billed
 *   Vendor-wise     receivables per vendor
 *   Ageing          what is still owed, by age
 *
 * Nothing is issued without the totals being shown first: "Review" asks the
 * server for a dry run of exactly the invoice(s) that would be produced.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, dmy, dmyTime, todayIso, statusLabel } from '../lib/format';
import { EmptyState, ErrorState, StatusBadge, Modal, Spinner, Field, PageHeader, ConfirmDialog } from '../components/ui';
import { DataTable, Drawer, ExportButton, Kpi, Menu, SearchBox, Segmented, DateRange, Detail } from '../components/data';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';
import { IconBilling, IconInvoices, IconWarning, IconCheck, IconFilter, IconRupee, IconVendors } from '../components/icons';

type Tab = 'pending' | 'batches' | 'vendors' | 'outstanding';

export default function Billing() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'pending';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [vendors, setVendors] = useState<any[]>([]);
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);
  const refreshCounts = useCallback(() => {
    api.get('/billing/batches', { params: { status: 'OPEN' } })
      .then((r) => setBatchCounts(Object.fromEntries((r.data.counts ?? []).map((c: any) => [c.status, c.count]))))
      .catch(() => {});
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts, tab]);

  const openBatches = (batchCounts.DRAFT ?? 0) + (batchCounts.PENDING_APPROVAL ?? 0) + (batchCounts.APPROVED ?? 0);

  return (
    <div className="page">
      <PageHeader
        title="Billing"
        subtitle="Trips that have run, waiting to be invoiced. Select them, check the totals the invoice will carry, then bill straight away or send a batch for approval."
        actions={<Link to="/admin/invoices" className="btn-outline btn-sm"><IconInvoices className="h-3.5 w-3.5" /> All invoices</Link>}
      />
      <Segmented<Tab>
        value={tab} onChange={setTab}
        options={[
          { value: 'pending', label: 'Ready to bill' },
          { value: 'batches', label: 'Billing batches', count: openBatches || undefined, alert: (batchCounts.PENDING_APPROVAL ?? 0) > 0 },
          { value: 'vendors', label: 'Vendor-wise' },
          { value: 'outstanding', label: 'Outstanding & ageing' },
        ]}
      />
      {tab === 'pending' && <Pending vendors={vendors} onBatchCreated={() => { refreshCounts(); setTab('batches'); }} />}
      {tab === 'batches' && <Batches onChanged={refreshCounts} />}
      {tab === 'vendors' && <VendorSummary />}
      {tab === 'outstanding' && <Outstanding vendors={vendors} />}
    </div>
  );
}

/* ==========================================================================
   Ready to bill
   ========================================================================== */

function Pending({ vendors, onBatchCreated }: { vendors: any[]; onBatchCreated: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [f, setF] = useState({
    vendorId: params.get('vendorId') ?? '', search: '', from: '', to: '', completedFrom: '', completedTo: '',
    bookedFrom: '', bookedTo: '', status: '', tripStatus: '', inBatch: 'no', confirmed: params.get('confirmed') ?? '',
  });
  const [confirming, setConfirming] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [requireApproval, setRequireApproval] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [review, setReview] = useState<any>(null);
  const [adjust, setAdjust] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/billing/pending', { params: f });
      setRows(data.data ?? []);
      setSummary(data.summary);
      setRequireApproval(!!data.requireApproval);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<number, { vendor: any; rows: any[] }>();
    for (const r of rows) {
      if (!map.has(r.vendor_id)) {
        map.set(r.vendor_id, {
          vendor: { id: r.vendor_id, name: r.vendor_code === 'DIRECT' ? 'Walk-in customers' : r.vendor_name, code: r.vendor_code, company: r.company_name,
            consolidation: !!r.consolidation_allowed, templateId: r.invoice_template_id, taxMode: r.vendor_tax_mode, taxRate: r.vendor_tax_rate },
          rows: [],
        });
      }
      map.get(r.vendor_id)!.rows.push(r);
    }
    return [...map.values()];
  }, [rows]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const vendorIds = new Set(selectedRows.map((r) => r.vendor_id));
  const selectedVendor = vendorIds.size === 1 ? grouped.find((g) => g.vendor.id === [...vendorIds][0])?.vendor : null;
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const unconfirmedSelected = selectedRows.filter((r) => !r.billing_confirmed_at);

  /** Trip completed → billing confirmed → invoice: confirm the checked charges in one go. */
  const confirmSelected = async () => {
    setConfirming(true);
    try {
      const { data } = await api.post('/trips/confirm-billing', { ids: unconfirmedSelected.map((r) => r.id) });
      toast.success('Billing confirmed', data.message);
      load();
    } catch (err) { toast.error('Could not confirm billing', errorMessage(err)); } finally { setConfirming(false); }
  };

  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));
  const canBill = (r: any) => Number(r.total_amount ?? 0) > 0 && !r.batch_id;

  return (
    <>
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Trips waiting to be billed" value={summary.count} tone="warning" icon={<IconBilling className="h-4 w-4" />} sub={`${summary.ready} priced and ready`} />
          <Kpi label="Value waiting" value={inr(summary.amount)} tone="brand" icon={<IconRupee className="h-4 w-4" />} sub="Including GST and reimbursables" />
          <Kpi label="Need final charges" value={summary.unpriced} tone={summary.unpriced ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />} sub="No amount entered yet" />
          <Kpi label="Shown with these filters" value={rows.length} icon={<IconFilter className="h-4 w-4" />} sub={inr(rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0))} />
        </div>
      )}

      {requireApproval && (
        <p className="notice-info text-sm">Approval is switched on (Settings → Invoices &amp; billing): selected trips go into a billing batch, which somebody else approves before invoices are issued.</p>
      )}

      <section className="card p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={f.search} onChange={(v) => set({ search: v })} placeholder="Trip ID, booking, passenger, vendor ref, vehicle…" className="min-w-[14rem] flex-1" />
          <select className="input h-9 w-auto text-[13px]" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label="Vendor">
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
          </select>
          <DateRange from={f.from} to={f.to} onChange={(r) => set(r)} label="Travel" />
          <button className={`btn-sm ${moreFilters ? 'btn-dark' : 'btn-outline'}`} onClick={() => setMoreFilters((v) => !v)}><IconFilter className="h-3.5 w-3.5" /> More</button>
          <ExportButton url="/billing/export/pending" params={f} />
        </div>
        {moreFilters && (
          <div className="mt-3 grid gap-2.5 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <select className="input h-9 text-[13px]" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Billing status">
              <option value="">Priced or not</option><option value="READY">Ready (priced)</option><option value="PENDING">Pending (needs charges)</option>
            </select>
            <select className="input h-9 text-[13px]" value={f.tripStatus} onChange={(e) => set({ tripStatus: e.target.value })} aria-label="Trip status">
              <option value="">Any trip status</option><option value="COMPLETED">Completed</option><option value="CONFIRMED">Confirmed</option><option value="ASSIGNED">Allotted</option><option value="ONTRIP">On trip</option>
            </select>
            <select className="input h-9 text-[13px]" value={f.confirmed} onChange={(e) => set({ confirmed: e.target.value })} aria-label="Billing confirmed">
              <option value="">Confirmed or not</option><option value="no">Billing not confirmed</option><option value="yes">Billing confirmed</option>
            </select>
            <select className="input h-9 text-[13px]" value={f.inBatch} onChange={(e) => set({ inBatch: e.target.value })} aria-label="Batch">
              <option value="no">Not in a batch</option><option value="yes">In a batch</option><option value="">Either</option>
            </select>
            <div className="flex items-center gap-1.5">
              <DateField className="h-9 w-full text-[13px]" value={f.completedFrom} placeholder="Completed from" onChange={(v) => set({ completedFrom: v })} />
              <DateField className="h-9 w-full text-[13px]" value={f.completedTo} placeholder="to" onChange={(v) => set({ completedTo: v })} />
            </div>
            <div className="flex items-center gap-1.5">
              <DateField className="h-9 w-full text-[13px]" value={f.bookedFrom} placeholder="Booked from" onChange={(v) => set({ bookedFrom: v })} />
              <DateField className="h-9 w-full text-[13px]" value={f.bookedTo} placeholder="to" onChange={(v) => set({ bookedTo: v })} />
            </div>
          </div>
        )}
      </section>

      {selected.size > 0 && (
        <div className="below-header sticky z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-card">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-brand-900">{selected.size} trip{selected.size === 1 ? '' : 's'} selected · {inr(selectedTotal)}</p>
            <p className="text-xs text-brand-700">
              {selectedVendor
                ? `${selectedVendor.name} · ${selectedVendor.consolidation ? 'consolidation allowed' : 'one invoice per trip'}`
                : `${vendorIds.size} different vendors selected — an invoice covers one vendor`}
            </p>
          </div>
          <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear</button>
          {unconfirmedSelected.length > 0 && can('billing.create', 'billing.update', 'invoices.create') && (
            <button onClick={confirmSelected} className="btn-dark btn-sm" disabled={confirming}>
              {confirming ? <Spinner /> : <IconCheck className="h-3.5 w-3.5" />} Confirm billing ({unconfirmedSelected.length})
            </button>
          )}
          {can('invoices.create', 'billing.create') && (
            <button onClick={() => setReview({ vendor: selectedVendor, ids: [...selected] })} className="btn-primary btn-sm" disabled={!selectedVendor || unconfirmedSelected.length > 0}
              title={unconfirmedSelected.length ? 'Confirm billing for the selected trips first' : undefined}>
              <IconCheck className="h-3.5 w-3.5" /> Review totals &amp; bill
            </button>
          )}
        </div>
      )}

      {error ? <ErrorState message={error} onRetry={load} /> : loading && !rows.length ? (
        <div className="card p-6"><Spinner /></div>
      ) : grouped.length === 0 ? (
        <div className="card">
          <EmptyState title="Nothing waiting to be billed"
            body="Trips appear here once they have run and are not yet invoiced. Trips in a billing batch are listed under Billing batches."
            action={<Link to="/admin/trips?stage=AWAITING_BILLING" className="btn-outline btn-sm">Completed trips needing charges</Link>} />
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ vendor, rows: vr }) => {
            const vTotal = vr.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
            return (
              <section key={vendor.id} className="table-wrap">
                <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
                  <div className="mr-auto min-w-0">
                    <p className="truncate font-semibold text-ink-900">{vendor.name}</p>
                    <p className="text-xs text-ink-500">
                      {vr.length} trip{vr.length === 1 ? '' : 's'} · {vendor.taxMode === 'NONE' ? 'no tax' : `${String(vendor.taxMode).replace('_', '+')} ${vendor.taxRate}%`} default
                    </p>
                  </div>
                  {!vendor.templateId && vendor.code !== 'DIRECT' && <span className="badge-warn" title="The portal's standard PDF will be used">No template — standard PDF</span>}
                  <span className="badge-neutral">{vendor.consolidation ? 'Consolidation allowed' : 'One invoice per trip'}</span>
                  <p className="font-display font-bold tabular-nums text-ink-900">{inr(vTotal)}</p>
                </div>
                <DataTable
                  rows={vr} rowKey={(r) => r.id}
                  selectable selected={selected} onSelectedChange={setSelected} isSelectable={canBill}
                  onRowClick={(r) => navigate(`/admin/trips?open=${r.id}`)}
                  columns={[
                    { key: 'trip_id', header: 'Trip', render: (r) => (
                      <div>
                        <span className="cell-code">{r.trip_id ?? r.booking_code}</span>
                        <span className="cell-meta block">{r.booking_code}{r.vendor_booking_ref ? ` · ${r.vendor_booking_ref}` : ''}</span>
                      </div>
                    ) },
                    { key: 'travel_date', header: 'Travel', render: (r) => <span className="whitespace-nowrap">{dmy(r.travel_date)}{r.completed_at && <span className="cell-meta block">done {dmyTime(r.completed_at)}</span>}</span> },
                    { key: 'passenger_name', header: 'Passenger', render: (r) => <span className="block max-w-[10rem] truncate">{r.passenger_name || r.customer_name}</span> },
                    { key: 'route', header: 'Route', sortable: false, render: (r) => <span className="block max-w-[15rem] truncate text-xs text-ink-600">{[r.pickup_location, r.drop_location].filter(Boolean).join(' → ')}</span> },
                    { key: 'vehicle_number', header: 'Vehicle', render: (r) => <span className="whitespace-nowrap font-mono text-xs">{r.vehicle_number || r.vehicle_type || '—'}</span> },
                    { key: 'taxable_amount', header: 'Taxable', align: 'right', render: (r) => inr(r.taxable_amount) },
                    { key: 'tax_amount', header: 'Tax', align: 'right', render: (r) => inr(r.tax_amount) },
                    { key: 'non_taxable_amount', header: 'Toll/parking', align: 'right', render: (r) => inr(r.non_taxable_amount) },
                    { key: 'total_amount', header: 'Total', align: 'right', render: (r) => <span className="font-semibold text-ink-900">{inr(r.total_amount)}</span> },
                    { key: 'billing_status', header: 'Status', render: (r) => (
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge value={Number(r.total_amount) > 0 ? r.billing_status : 'AWAITING_BILLING'} />
                        {r.billing_confirmed_at
                          ? <span className="text-2xs font-semibold text-ok-700">Billing confirmed</span>
                          : <span className="text-2xs font-semibold text-warn-700">Not confirmed</span>}
                        {r.booking_status !== 'COMPLETED' && <span className="text-2xs text-ink-400">{statusLabel(r.booking_status)}</span>}
                        {r.batch_code && <span className="badge-violet">{r.batch_code}</span>}
                      </div>
                    ) },
                    { key: 'a', header: '', sortable: false, sticky: true, align: 'right', render: (r) => (
                      <Menu items={[
                        { label: 'Open trip', onClick: () => navigate(`/admin/trips?open=${r.id}`) },
                        can('billing.update', 'bookings.update') && { label: 'Correct charges…', hint: 'Audited adjustment before billing', onClick: () => setAdjust(r) },
                      ]} />
                    ) },
                  ]}
                />
              </section>
            );
          })}
        </div>
      )}

      {review && (
        <ReviewModal
          vendor={review.vendor} ids={review.ids} requireApproval={requireApproval}
          onClose={() => setReview(null)}
          onDone={(kind) => { setReview(null); load(); if (kind === 'batch') onBatchCreated(); }}
        />
      )}
      {adjust && <AdjustModal row={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); load(); }} />}
    </>
  );
}

/** The dry run — every line, every total, every problem — before anything is issued. */
function ReviewModal({ vendor, ids, requireApproval, onClose, onDone }: {
  vendor: any; ids: (string | number)[]; requireApproval: boolean; onClose: () => void; onDone: (kind: 'invoice' | 'batch') => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [separate, setSeparate] = useState(!vendor.consolidation && ids.length > 1);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [p, setP] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    api.post('/billing/preview', { vendorId: vendor.id, bookingIds: ids.map(Number), separateInvoices: separate })
      .then((r) => setP(r.data.data)).catch((err) => toast.error('Could not work out the totals', errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [separate]);

  const generate = async () => {
    setBusy('invoice');
    try {
      const { data } = await api.post('/invoices/generate', { vendorId: vendor.id, bookingIds: ids.map(Number), invoiceDate, notes, separateInvoices: separate });
      setResult(data);
      toast.success(data.message, data.warnings?.length ? data.warnings.join('\n') : undefined);
    } catch (err) { toast.error('Invoice not generated', errorMessage(err)); } finally { setBusy(''); }
  };
  const draft = async () => {
    setBusy('batch');
    try {
      const { data } = await api.post('/billing/batches', { vendorId: vendor.id, bookingIds: ids.map(Number), invoiceDate, notes, separateInvoices: separate });
      toast.success(data.message, 'Submit it for approval from Billing batches.');
      onDone('batch');
    } catch (err) { toast.error('Batch not created', errorMessage(err)); } finally { setBusy(''); }
  };

  if (result) {
    return (
      <Modal open onClose={() => onDone('invoice')} title="Invoices generated" size="md"
        footer={<><button className="btn-outline" onClick={() => onDone('invoice')}>Close</button><button className="btn-primary" onClick={() => navigate('/admin/invoices')}>Go to invoices</button></>}>
        <div className="space-y-3">
          <p className="notice-ok font-semibold">{result.message}</p>
          {result.warnings?.length > 0 && <ul className="space-y-1 rounded-lg bg-warn-50 p-3 text-xs text-warn-700">{result.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}</ul>}
          {result.invoices.map((inv: any) => (
            <div key={inv.invoiceId} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 p-3">
              <div className="mr-auto"><p className="font-mono text-sm font-semibold text-brand-700">{inv.invoiceNumber}</p><p className="text-xs text-ink-500">{inr(inv.total)} · {String(inv.fileType).toUpperCase()}</p></div>
              <Link to={`/admin/invoices/${inv.invoiceId}`} className="btn-outline btn-sm">Open</Link>
              <button className="btn-primary btn-sm" onClick={() => downloadFile(`/invoices/${inv.invoiceId}/download`).catch((e) => toast.error('Download failed', errorMessage(e)))}>Download</button>
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} size="xl" title={`Review — ${vendor.name}`}
      subtitle="Exactly what the invoice(s) will carry. Nothing is issued until you confirm."
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={!!busy}>Cancel</button>
          {can('billing.create', 'invoices.create') && (
            <button className={requireApproval ? 'btn-primary' : 'btn-outline'} onClick={draft} disabled={!!busy || !p?.ok}>
              {busy === 'batch' && <Spinner />} Save as billing batch
            </button>
          )}
          {!requireApproval && can('invoices.create') && (
            <button className="btn-primary" onClick={generate} disabled={!!busy || !p?.ok}>
              {busy === 'invoice' && <Spinner />} Generate {p?.groups?.length > 1 ? `${p.groups.length} invoices` : 'invoice'} now
            </button>
          )}
        </>
      }
    >
      {!p ? <div className="py-6"><Spinner /></div> : (
        <div className="space-y-4">
          {p.problems.length > 0 && (
            <div className="notice-danger flex-col">
              <p className="font-semibold">These must be fixed first</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">{p.problems.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {p.warnings.length > 0 && (
            <div className="notice-warn flex-col">
              <p className="font-semibold">Check before billing</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">{p.warnings.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Invoice date"><DateField value={invoiceDate} onChange={setInvoiceDate} /></Field>
            <Field label="Notes on the invoice" className="sm:col-span-2"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
          </div>
          {ids.length > 1 && (
            <label className={`option ${separate ? 'option-on' : ''}`}>
              <input type="checkbox" className="check mt-0.5" checked={separate} onChange={(e) => setSeparate(e.target.checked)} disabled={!vendor.consolidation} />
              <span className="text-sm">
                <span className="font-semibold text-ink-900">One invoice per trip</span>
                <span className="mt-0.5 block text-xs text-ink-600">{vendor.consolidation ? `Untick to raise one consolidated invoice for all ${ids.length} trips.` : `${vendor.name} is not set up for consolidated invoices.`}</span>
              </span>
            </label>
          )}

          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Trip</th><th>Date</th><th>Route</th><th className="td-num">Fare</th><th className="td-num">Extras</th><th className="td-num">Allowances</th><th className="td-num">Discount</th><th className="td-num">Taxable</th><th className="td-num">Tax</th><th className="td-num">Reimb.</th><th className="td-num">Total</th></tr></thead>
              <tbody>
                {p.lines.map((l: any) => (
                  <tr key={l.bookingId} className={l.problems.length ? 'bg-danger-50/60' : ''}>
                    <td><span className="cell-code">{l.tripId ?? l.bookingCode}</span><span className="cell-meta block">{l.passenger}</span></td>
                    <td className="whitespace-nowrap">{dmy(l.travelDate)}</td>
                    <td className="max-w-[12rem] truncate text-xs">{l.route}</td>
                    <td className="td-num">{inr(l.baseFare)}</td>
                    <td className="td-num">{inr(l.extras)}</td>
                    <td className="td-num">{inr(l.allowances)}</td>
                    <td className="td-num">{l.discount ? `−${inr(l.discount)}` : '—'}</td>
                    <td className="td-num">{inr(l.taxable)}</td>
                    <td className="td-num">{inr(l.tax)}</td>
                    <td className="td-num">{inr(l.reimbursables)}</td>
                    <td className="td-num td-strong">{inr(l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {p.groups.map((g: any, i: number) => (
              <div key={i} className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
                <p className="eyebrow mb-2">Invoice {p.groups.length > 1 ? `${i + 1} of ${p.groups.length}` : ''} · {g.bookingIds.length} trip(s)</p>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-ink-500">Taxable value</dt><dd className="tabular-nums">{inr(g.taxableAmount)}</dd></div>
                  {g.taxMode === 'CGST_SGST' ? (
                    <>
                      <div className="flex justify-between"><dt className="text-ink-500">CGST {g.taxRate / 2}%</dt><dd className="tabular-nums">{inr(g.cgst)}</dd></div>
                      <div className="flex justify-between"><dt className="text-ink-500">SGST {g.taxRate / 2}%</dt><dd className="tabular-nums">{inr(g.sgst)}</dd></div>
                    </>
                  ) : g.taxMode === 'IGST' ? (
                    <div className="flex justify-between"><dt className="text-ink-500">IGST {g.taxRate}%</dt><dd className="tabular-nums">{inr(g.igst)}</dd></div>
                  ) : <div className="flex justify-between"><dt className="text-ink-500">No GST</dt><dd>—</dd></div>}
                  <div className="flex justify-between"><dt className="text-ink-500">Toll, parking &amp; state tax</dt><dd className="tabular-nums">{inr(g.nonTaxableAmount)}</dd></div>
                  <div className="flex justify-between border-t border-ink-200 pt-1.5"><dt className="font-semibold text-ink-900">Invoice total</dt><dd className="font-display text-lg font-bold tabular-nums">{inr(g.totalAmount)}</dd></div>
                </dl>
              </div>
            ))}
          </div>
          <p className="text-right text-sm text-ink-600">Grand total <strong className="font-display text-xl text-ink-900">{inr(p.totals.total)}</strong></p>
        </div>
      )}
    </Modal>
  );
}

function AdjustModal({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const fields: [string, string][] = [
    ['baseFare', 'Fare'], ['extraKm', 'Extra km'], ['extraKmRate', 'Extra km rate'], ['extraHours', 'Extra hours'],
    ['extraHourRate', 'Extra hour rate'], ['driverAllowance', 'Driver allowance'], ['nightCharge', 'Night charge'],
    ['waitingCharge', 'Waiting'], ['permit', 'Permit'], ['otherCharges', 'Other charges'], ['discount', 'Discount'],
    ['toll', 'Toll'], ['parking', 'Parking'], ['stateTax', 'State tax'],
  ];
  const col: Record<string, string> = {
    baseFare: 'base_fare', extraKm: 'extra_km', extraKmRate: 'extra_km_rate', extraHours: 'extra_hours', extraHourRate: 'extra_hour_rate',
    driverAllowance: 'driver_allowance', nightCharge: 'night_charge', waitingCharge: 'waiting_charge', permit: 'permit',
    otherCharges: 'other_charges', discount: 'discount', toll: 'toll', parking: 'parking', stateTax: 'state_tax',
  };
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(([k]) => [k, String(Number(row[col[k]] ?? 0))])));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const body: Record<string, any> = { reason };
      for (const [k] of fields) body[k] = Number(v[k]) || 0;
      const { data } = await api.post(`/billing/bookings/${row.id}/adjust`, body);
      toast.success('Charges corrected', data.message);
      onSaved();
    } catch (err) { toast.error('Not corrected', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Correct charges — ${row.trip_id ?? row.booking_code}`}
      subtitle="Recorded on the trip's timeline and in the audit log, with the reason, before and after."
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || reason.trim().length < 3} onClick={save}>{busy && <Spinner />} Save correction</button></>}>
      <div className="grid gap-3 sm:grid-cols-4">
        {fields.map(([k, label]) => (
          <Field key={k} label={label}><input className="input text-right tabular-nums" inputMode="decimal" value={v[k]} onChange={(e) => setV((p) => ({ ...p, [k]: e.target.value }))} /></Field>
        ))}
        <Field label="Why" required className="sm:col-span-4"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duty slip shows 46 extra km, not 40" /></Field>
      </div>
      <p className="mt-3 text-xs text-ink-500">Current total {inr(row.total_amount)}. The tax treatment stays as priced.</p>
    </Modal>
  );
}

/* ==========================================================================
   Batches
   ========================================================================== */

function Batches({ onChanged }: { onChanged: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState('OPEN');
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/billing/batches', { params: { status } });
      setRows(data.data ?? []);
      setCounts(Object.fromEntries((data.counts ?? []).map((c: any) => [c.status, c.count])));
    } catch (err) { toast.error('Could not load batches', errorMessage(err)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 p-3">
        <Segmented size="sm" value={status} onChange={setStatus} options={[
          { value: 'OPEN', label: 'Open' },
          { value: 'DRAFT', label: 'Draft', count: counts.DRAFT ?? 0 },
          { value: 'PENDING_APPROVAL', label: 'Awaiting approval', count: counts.PENDING_APPROVAL ?? 0, alert: true },
          { value: 'APPROVED', label: 'Approved', count: counts.APPROVED ?? 0 },
          { value: 'BILLED', label: 'Billed', count: counts.BILLED ?? 0 },
          { value: 'CANCELLED', label: 'Cancelled', count: counts.CANCELLED ?? 0 },
        ]} />
        <p className="ml-auto text-xs text-ink-500">Draft → submitted → approved (by someone else) → billed.</p>
      </div>
      <DataTable
        rows={rows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setOpenId(r.id)}
        empty={<EmptyState title="No batches here" body="Select trips under Ready to bill and choose “Save as billing batch”." icon={<IconBilling className="h-5 w-5" />} />}
        columns={[
          { key: 'batch_code', header: 'Batch', render: (r) => <span className="cell-code">{r.batch_code}</span> },
          { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_code === 'DIRECT' ? 'Walk-in customers' : r.vendor_name },
          { key: 'booking_count', header: 'Trips', align: 'right' },
          { key: 'total_amount', header: 'Total', align: 'right', render: (r) => <span className="font-semibold">{inr(r.total_amount)}</span> },
          { key: 'status', header: 'Status', render: (r) => <StatusBadge value={r.status} /> },
          { key: 'created_by_name', header: 'Prepared by', render: (r) => <span className="text-xs">{r.created_by_name}<br /><span className="text-ink-400">{dmyTime(r.created_at)}</span></span> },
          { key: 'approved_by_name', header: 'Approved by', render: (r) => r.approved_by_name ? <span className="text-xs">{r.approved_by_name}<br /><span className="text-ink-400">{dmyTime(r.approved_at)}</span></span> : '—' },
        ]}
      />
      {openId && <BatchDrawer id={openId} onClose={() => setOpenId(null)} onChanged={() => { load(); onChanged(); }} />}
    </section>
  );
}

function BatchDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [ask, setAsk] = useState<null | 'reject' | 'cancel'>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try { const { data } = await api.get(`/billing/batches/${id}`); setD(data); }
    catch (err) { toast.error('Could not open the batch', errorMessage(err)); onClose(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (path: string, body: any = {}, title = 'Done') => {
    setBusy(path);
    try {
      const { data } = await api.post(`/billing/batches/${id}/${path}`, body);
      toast.success(title, data.message);
      setAsk(null); setReason('');
      await load(); onChanged();
    } catch (err) { toast.error('Not done', errorMessage(err)); } finally { setBusy(''); }
  };
  const removeLine = async (bookingId: number) => {
    const b = d.batch;
    const ids = d.preview.lines.map((l: any) => l.bookingId).filter((x: number) => x !== bookingId);
    if (!ids.length) return toast.warning('A batch needs at least one trip', 'Cancel the batch instead.');
    try {
      await api.put(`/billing/batches/${id}`, { vendorId: b.vendor_id, bookingIds: ids, separateInvoices: !!b.separate_invoices, invoiceDate: b.invoice_date ?? '', notes: b.notes ?? '' });
      toast.success('Trip taken out of the batch');
      await load(); onChanged();
    } catch (err) { toast.error('Not changed', errorMessage(err)); }
  };

  const b = d?.batch;
  const mine = b && b.created_by === user?.id && user?.roleCode !== 'SUPER_ADMIN';

  return (
    <Drawer open onClose={onClose} width="max-w-4xl" title={b?.batch_code ?? 'Billing batch'}
      subtitle={b ? <span className="flex flex-wrap items-center gap-2">{b.vendor_code === 'DIRECT' ? 'Walk-in customers' : b.vendor_name} · {b.booking_count} trip(s) · {inr(b.total_amount)} <StatusBadge value={b.status} /></span> : undefined}
      footer={b && (
        <>
          {b.status === 'DRAFT' && can('billing.create', 'invoices.create') && <button className="btn-primary" disabled={!!busy || !d.preview.ok} onClick={() => act('submit', {}, 'Sent for approval')}>{busy === 'submit' && <Spinner />} Submit for approval</button>}
          {b.status === 'PENDING_APPROVAL' && can('billing.update', 'invoices.create') && (
            <>
              <button className="btn-outline" disabled={!!busy} onClick={() => setAsk('reject')}>Send back</button>
              <button className="btn-primary" disabled={!!busy || mine} title={mine ? 'Somebody other than the preparer approves' : undefined} onClick={() => act('approve', {}, 'Approved')}>{busy === 'approve' && <Spinner />} Approve</button>
            </>
          )}
          {b.status === 'APPROVED' && can('invoices.create') && <button className="btn-primary" disabled={!!busy} onClick={() => act('bill', {}, 'Invoices issued')}>{busy === 'bill' && <Spinner />} Generate invoices</button>}
          {['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(b.status) && can('billing.create', 'invoices.create') && <button className="btn-ghost text-danger-600" disabled={!!busy} onClick={() => setAsk('cancel')}>Cancel batch</button>}
        </>
      )}>
      {!d ? <Spinner /> : (
        <div className="space-y-4">
          {mine && b.status === 'PENDING_APPROVAL' && <p className="notice-info text-sm">You prepared this batch, so someone else must approve it.</p>}
          {!d.preview.ok && b.status !== 'BILLED' && b.status !== 'CANCELLED' && (
            <div className="notice-danger flex-col"><p className="font-semibold">Something changed since this batch was saved</p><ul className="list-disc pl-5 text-xs">{d.preview.problems.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></div>
          )}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Detail label="Invoice date">{b.invoice_date ? dmy(b.invoice_date) : 'Day of billing'}</Detail>
            <Detail label="Invoices">{d.preview.groups.length} {b.separate_invoices ? '(one per trip)' : ''}</Detail>
            <Detail label="Taxable">{inr(d.preview.totals.taxable)}</Detail>
            <Detail label="Total">{inr(d.preview.totals.total)}</Detail>
          </dl>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Trip</th><th>Date</th><th>Route</th><th className="td-num">Taxable</th><th className="td-num">Tax</th><th className="td-num">Reimb.</th><th className="td-num">Total</th>{b.status === 'DRAFT' && <th />}</tr></thead>
              <tbody>
                {d.preview.lines.map((l: any) => (
                  <tr key={l.bookingId}>
                    <td><Link to={`/admin/trips?open=${l.bookingId}`} className="cell-code hover:underline">{l.tripId ?? l.bookingCode}</Link><span className="cell-meta block">{l.passenger}</span></td>
                    <td>{dmy(l.travelDate)}</td>
                    <td className="max-w-[14rem] truncate text-xs">{l.route}</td>
                    <td className="td-num">{inr(l.taxable)}</td><td className="td-num">{inr(l.tax)}</td><td className="td-num">{inr(l.reimbursables)}</td>
                    <td className="td-num td-strong">{inr(l.total)}</td>
                    {b.status === 'DRAFT' && <td className="text-right"><button className="btn-ghost btn-sm text-danger-600" onClick={() => removeLine(l.bookingId)}>Remove</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.invoices.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Invoices issued</p>
              <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                {d.invoices.map((i: any) => (
                  <li key={i.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <Link to={`/admin/invoices/${i.id}`} className="cell-code hover:underline">{i.invoice_number}</Link>
                    <span>{dmy(i.invoice_date)}</span><span className="font-semibold">{inr(i.total_amount)}</span><StatusBadge value={i.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="eyebrow mb-2">History</p>
            <ol className="space-y-1.5 text-sm">
              {d.history.map((h: any, i: number) => (
                <li key={i} className="flex gap-3"><span className="w-40 shrink-0 text-xs text-ink-400">{dmyTime(h.created_at)}</span><span className="text-ink-700">{h.description} <span className="text-xs text-ink-400">— {h.user_email}</span></span></li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!ask} onClose={() => { setAsk(null); setReason(''); }} danger={ask === 'cancel'}
        title={ask === 'reject' ? 'Send back to draft?' : 'Cancel this batch?'}
        confirmLabel={ask === 'reject' ? 'Send back' : 'Cancel batch'}
        busy={!!busy}
        onConfirm={() => act(ask === 'reject' ? 'reject' : 'cancel', { reason }, ask === 'reject' ? 'Sent back' : 'Batch cancelled')}
        body={<Field label={ask === 'reject' ? 'What needs fixing' : 'Reason'} required><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>}
      />
    </Drawer>
  );
}

/* ==========================================================================
   Vendor-wise and ageing
   ========================================================================== */

function VendorSummary() {
  const toast = useToast();
  const [range, setRange] = useState({ from: '', to: '' });
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get('/billing/vendor-summary', { params: range }).then((r) => { setRows(r.data.data ?? []); setTotals(r.data.totals); })
      .catch((err) => toast.error('Could not load the summary', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);
  const shown = rows.filter((v) => Number(v.total_bookings) || Number(v.total_invoiced) || Number(v.outstanding));
  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <DateRange from={range.from} to={range.to} onChange={setRange} label="Period" />
        <ExportButton url="/billing/export/vendor-summary" params={range} />
        <p className="ml-auto text-xs text-ink-500">Receivables only — what vendors and customers owe the business.</p>
      </div>
      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Unbilled" value={inr(totals.pending)} tone="warning" sub="Ready to bill, now" />
          <Kpi label="Invoiced" value={inr(totals.invoiced)} tone="brand" sub="In the period" />
          <Kpi label="Received" value={inr(totals.paid)} tone="success" sub="Against those invoices" />
          <Kpi label="Outstanding" value={inr(totals.outstanding)} tone="danger" sub="Unpaid balance" />
          <Kpi label="Overdue" value={inr(totals.overdue)} tone={totals.overdue ? 'danger' : 'default'} sub="Past the due date" />
        </div>
      )}
      <section className="table-wrap">
        <DataTable
          rows={shown} rowKey={(r) => r.id} loading={loading}
          empty={<EmptyState title="No vendor activity" icon={<IconVendors className="h-5 w-5" />} />}
          columns={[
            { key: 'vendor_name', header: 'Vendor', render: (v) => <div><p className="font-medium text-ink-900">{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</p><p className="cell-meta">{v.code} · {v.template_name ?? 'standard PDF'} · {String(v.billing_cycle ?? '').replace('_', ' ').toLowerCase()}</p></div> },
            { key: 'total_bookings', header: 'Trips', align: 'right' },
            { key: 'pending_amount', header: 'Unbilled', align: 'right', render: (v) => Number(v.pending_amount) > 0 ? <Link to={`/admin/billing?vendorId=${v.id}`} className="font-semibold text-warn-700 hover:underline">{inr(v.pending_amount)}</Link> : '—' },
            { key: 'invoice_count', header: 'Invoices', align: 'right' },
            { key: 'total_invoiced', header: 'Invoiced', align: 'right', render: (v) => inr(v.total_invoiced) },
            { key: 'total_paid', header: 'Received', align: 'right', render: (v) => <span className="text-ok-700">{inr(v.total_paid)}</span> },
            { key: 'outstanding', header: 'Outstanding', align: 'right', render: (v) => <span className={Number(v.outstanding) > 0 ? 'font-semibold text-ink-900' : 'text-ink-400'}>{inr(v.outstanding)}</span> },
            { key: 'overdue', header: 'Overdue', align: 'right', render: (v) => Number(v.overdue) > 0 ? <span className="font-semibold text-danger-600">{inr(v.overdue)}</span> : '—' },
            { key: 'a', header: '', sortable: false, align: 'right', render: (v) => <Link to={`/admin/invoices?vendorId=${v.id}`} className="btn-ghost btn-sm">Invoices →</Link> },
          ]}
        />
      </section>
    </>
  );
}

function Outstanding({ vendors }: { vendors: any[] }) {
  const toast = useToast();
  const [vendorId, setVendorId] = useState('');
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get('/billing/outstanding', { params: { vendorId: vendorId || undefined } }).then((r) => setD(r.data))
      .catch((err) => toast.error('Could not load ageing', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);
  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <select className="input h-9 w-auto text-[13px]" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Vendor">
          <option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
        </select>
        <ExportButton url="/billing/export/outstanding" params={{ vendorId }} />
        <Link to="/admin/payments?new=1" className="btn-primary btn-sm ml-auto"><IconRupee className="h-3.5 w-3.5" /> Record a payment</Link>
      </div>
      {d && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Total outstanding" value={inr(d.total)} tone="danger" sub={`${d.data.length} invoice(s)`} />
          {d.buckets.map((b: any) => (
            <Kpi key={b.bucket} label={`${b.bucket} days`} value={inr(b.amount)} sub={`${b.count} invoice${b.count === 1 ? '' : 's'}`}
              tone={b.bucket === '90+' ? 'danger' : b.bucket === '61-90' || b.bucket === '31-60' ? 'warning' : 'default'} />
          ))}
        </div>
      )}
      <section className="table-wrap">
        <DataTable
          rows={(d?.data ?? []) as any[]} rowKey={(r: any) => r.id} loading={loading} pageSize={50}
          empty={<EmptyState title="Nothing outstanding" body="Every invoice raised has been fully paid." />}
          columns={[
            { key: 'invoice_number', header: 'Invoice', render: (i) => <Link to={`/admin/invoices/${i.id}`} className="cell-code hover:underline">{i.invoice_number}</Link> },
            { key: 'vendor_name', header: 'Vendor' },
            { key: 'invoice_date', header: 'Date', render: (i) => dmy(i.invoice_date) },
            { key: 'due_date', header: 'Due', render: (i) => dmy(i.due_date) },
            { key: 'total_amount', header: 'Total', align: 'right', render: (i) => inr(i.total_amount) },
            { key: 'paid_amount', header: 'Received', align: 'right', render: (i) => <span className="text-ok-700">{inr(i.paid_amount)}</span> },
            { key: 'outstanding_amount', header: 'Outstanding', align: 'right', render: (i) => <span className="font-semibold text-danger-600">{inr(i.outstanding_amount)}</span> },
            { key: 'age_days', header: 'Age', align: 'right', render: (i) => `${i.age_days}d` },
            { key: 'days_overdue', header: 'Status', render: (i) => <StatusBadge value={i.days_overdue > 0 ? 'OVERDUE' : i.status} /> },
          ]}
        />
      </section>
    </>
  );
}
