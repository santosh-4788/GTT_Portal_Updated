/**
 * Payments & Ledger — money in, and money out, never mixed.
 *
 *   Overview        receivables and payables totals, side by side but separate
 *   Register        every receipt (received) and payout (paid), one list
 *   Record receipt  money from a company, split across its open invoices
 *                   (oldest first, editable); anything left is held unallocated
 *   Unallocated     receipts with money not yet matched to invoices
 *   Company ledger  opening, invoices, receipts, adjustments, running balance
 *   Reconcile       compare a company's statement with the receipts recorded
 *   Payables        what is owed to vehicle owners and partners, and paid out
 *
 * A mistaken entry is reversed, not deleted: it stays on the list, marked, with
 * who reversed it and why. All amounts are worked in paise so totals are exact.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr, dmy, dmyTime, humanise, todayLocalIso } from '../lib/format';
import { EmptyState, ErrorState, Field, Modal, PageHeader, Pagination, Spinner, StatusBadge } from '../components/ui';
import { DataTable, DateRange, Drawer, ExportButton, Kpi, Menu, SearchBox, Segmented, presetRange } from '../components/data';
import { DateField } from '../components/DateTimeField';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { IconPlus, IconRupee, IconWarning, IconPayments, IconInvoices, IconCar, IconInbox, IconBook } from '../components/icons';
import { CompanyLedger, Reconcile } from './PaymentsLedger';

type Tab = 'overview' | 'register' | 'record' | 'unallocated' | 'ledger' | 'reconcile' | 'payables';
const LIMIT = 100;

export type Mode = { code: string; label: string };
export type Company = { id: number; code: string; vendor_name: string; status?: string; outstanding?: number };
export interface ReceiptPrefill {
  vendorId?: number | string; amount?: number | string; txnDate?: string; referenceNo?: string;
  remarks?: string; invoiceId?: number | string | null; source?: 'MANUAL' | 'IMPORT';
}

/** Rupees → integer paise. Every sum on this screen is done in paise. */
export const P = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(Number((n * 100).toFixed(4))) : 0;
};
export const R = (p: number) => Math.round(p) / 100;
export const companyName = (c?: { code?: string; vendor_name?: string } | null) => (c?.code === 'DIRECT' ? 'Walk-in customers' : c?.vendor_name ?? '');

/** Allocation status — always words, colour only as a second cue. */
export const RECEIPT_STATUS: Record<string, { label: string; cls: string }> = {
  ALLOCATED: { label: 'Fully allocated', cls: 'badge-ok' },
  PARTLY_ALLOCATED: { label: 'Partly allocated', cls: 'badge-warn' },
  UNALLOCATED: { label: 'Unallocated', cls: 'badge-violet' },
  REVERSED: { label: 'Reversed', cls: 'badge-neutral' },
  PAID_OUT: { label: 'Paid out', cls: 'badge-brand' },
};
export function ReceiptStatus({ value }: { value: string }) {
  const s = RECEIPT_STATUS[value] ?? { label: humanise(value), cls: 'badge-neutral' };
  return <span className={s.cls}>{s.label}</span>;
}

const OLD_TABS: Record<string, Tab> = { received: 'register', vendors: 'overview' };

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? '';
  const tab: Tab = (OLD_TABS[raw] ?? (raw as Tab)) || (params.get('new') === '1' ? 'record' : 'overview');
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setParams(() => {
    const n = new URLSearchParams();
    n.set('tab', t);
    Object.entries(extra).forEach(([k, v]) => v && n.set(k, v));
    return n;
  }, { replace: true });
  const [modes, setModes] = useState<Mode[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [recordModal, setRecordModal] = useState<ReceiptPrefill | null>(null);
  const [bump, setBump] = useState(0);
  const { can } = useAuth();

  useEffect(() => {
    api.get('/masters/lists/PAYMENT_MODE/options').then((r) => setModes(r.data.data ?? [])).catch(() => {});
    api.get('/payments/companies').then((r) => setCompanies(r.data.data ?? [])).catch(() => {});
  }, [bump]);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'register', label: 'Register' },
    ...(can('payments.create') ? [{ value: 'record' as Tab, label: 'Record receipt' }] : []),
    { value: 'unallocated', label: 'Unallocated' },
    { value: 'ledger', label: 'Company ledger' },
    { value: 'reconcile', label: 'Reconcile' },
    { value: 'payables', label: 'Payables' },
  ];

  return (
    <div className="page">
      <PageHeader
        title="Payments & Ledger"
        subtitle="Money received from companies and money paid out to vehicle owners and partners — kept apart, so a receivable is never netted against a payable."
        actions={can('payments.create') && tab !== 'record' && tab !== 'payables' ? (
          <button className="btn-primary btn-sm no-print" onClick={() => setTab('record')}><IconPlus className="h-3.5 w-3.5" /> Record receipt</button>
        ) : undefined}
      />
      <div className="no-print"><Segmented<Tab> value={tab} onChange={(t) => setTab(t)} options={tabs} /></div>
      {tab === 'overview' && <Overview companies={companies} go={setTab} />}
      {tab === 'register' && <Register key={`r${bump}`} modes={modes} companies={companies} onChanged={() => setBump((b) => b + 1)} />}
      {tab === 'record' && (
        <section className="card p-4">
          <RecordReceipt
            key={`rec${params.get('invoiceId') ?? ''}${bump}`}
            modes={modes} companies={companies}
            prefill={{ invoiceId: params.get('invoiceId'), vendorId: params.get('vendorId') ?? undefined }}
            onSaved={() => { setBump((b) => b + 1); setTab('register'); }}
          />
        </section>
      )}
      {tab === 'unallocated' && <Register key={`u${bump}`} modes={modes} companies={companies} onlyOpen onChanged={() => setBump((b) => b + 1)} />}
      {tab === 'ledger' && <CompanyLedger key={`l${bump}`} companies={companies} />}
      {tab === 'reconcile' && <Reconcile companies={companies} onRecord={(p) => setRecordModal(p)} refreshKey={bump} />}
      {tab === 'payables' && <Payables modes={modes} />}

      {recordModal && (
        <Modal open size="xl" title="Record receipt" subtitle="From the statement line. Check the allocation before saving." onClose={() => setRecordModal(null)}>
          <RecordReceipt modes={modes} companies={companies} prefill={recordModal}
            onSaved={() => { setRecordModal(null); setBump((b) => b + 1); }} onCancel={() => setRecordModal(null)} />
        </Modal>
      )}
    </div>
  );
}

/* ==========================================================================
   Overview
   ========================================================================== */

function Overview({ companies, go }: { companies: Company[]; go: (t: Tab, extra?: Record<string, string>) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [range, setRange] = useState(presetRange('fy'));
  const [vendorId, setVendorId] = useState('');
  const [d, setD] = useState<any>(null);
  const [byVendor, setByVendor] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get('/payments/overview', { params: { ...range, vendorId } }),
      api.get('/payments/summary', { params: range }),
    ]).then(([o, s]) => { setD(o.data); setByVendor(s.data.byVendor ?? []); })
      .catch((err) => toast.error('Could not load the overview', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, vendorId]);

  const r = d?.receivables ?? {};
  const p = d?.payables ?? {};
  const rows = vendorId ? byVendor.filter((v) => String(v.id) === vendorId) : byVendor;

  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <DateRange from={range.from} to={range.to} onChange={setRange} label="Period" />
        <select className="input h-9 w-auto text-[13px]" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Company">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
        </select>
        {loading && <Spinner />}
      </div>

      <section className="space-y-3">
        <h2 className="eyebrow">Receivables — what companies owe us</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Invoiced in the period" value={inr(r.invoiced)} icon={<IconInvoices className="h-4 w-4" />} sub={`${r.invoices ?? 0} invoice(s)`}
            onClick={() => navigate(`/admin/invoices?from=${range.from}&to=${range.to}${vendorId ? `&vendorId=${vendorId}` : ''}`)} />
          <Kpi label="Received in the period" value={inr(r.received)} tone="success" icon={<IconRupee className="h-4 w-4" />} sub={`${r.receipts ?? 0} receipt(s), incl. advances`}
            onClick={() => go('register', { from: range.from, to: range.to, direction: 'IN', vendorId })} />
          <Kpi label="Outstanding now" value={inr(r.outstanding)} tone="warning" icon={<IconPayments className="h-4 w-4" />} sub={`${r.outstandingCount ?? 0} unpaid invoice(s)`}
            onClick={() => navigate(`/admin/invoices?status=UNPAID${vendorId ? `&vendorId=${vendorId}` : ''}`)} />
          <Kpi label="Overdue now" value={inr(r.overdue)} tone={Number(r.overdue) > 0 ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />} sub={`${r.overdueCount ?? 0} past the due date`}
            onClick={() => navigate(`/admin/invoices?status=OVERDUE${vendorId ? `&vendorId=${vendorId}` : ''}`)} />
          <Kpi label="Unallocated receipts" value={inr(r.unallocated)} tone="violet" icon={<IconInbox className="h-4 w-4" />} sub={`${r.unallocatedCount ?? 0} receipt(s) with money to allocate`}
            onClick={() => go('unallocated', { vendorId })} />
          <Kpi label="Net receivable" value={inr(r.netReceivable)} tone="brand" icon={<IconBook className="h-4 w-4" />} sub="Outstanding less unallocated advances"
            onClick={() => (vendorId ? go('ledger', { vendorId }) : undefined)} />
          <Kpi label="Adjustments in the period" value={inr(r.adjusted)} icon={<IconBook className="h-4 w-4" />} sub={`${r.adjustments ?? 0} TDS / write-off / other`} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="eyebrow">Payables — what we owe vehicle owners and partners</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Paid to suppliers in the period" value={inr(p.paidOut)} tone="success" icon={<IconCar className="h-4 w-4" />} sub={`${p.payouts ?? 0} payout(s)`}
            onClick={() => go('register', { from: range.from, to: range.to, direction: 'OUT' })} />
          <Kpi label="Payables outstanding now" value={inr(p.outstanding)} tone={Number(p.outstanding) > 0 ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />}
            sub={`${p.payees ?? 0} payee(s) with a balance`} onClick={() => go('payables')} />
        </div>
        {vendorId && <p className="text-xs text-ink-500">{p.note}</p>}
      </section>

      <section className="table-wrap">
        <div className="card-head"><h2 className="card-title">By company</h2><p className="text-xs text-ink-500">Open a row for its ledger.</p></div>
        <DataTable
          rows={rows} rowKey={(x: any) => x.id} loading={loading}
          onRowClick={(x: any) => go('ledger', { vendorId: String(x.id), from: range.from, to: range.to })}
          empty={<EmptyState title="No invoices yet" />}
          columns={[
            { key: 'vendor_name', header: 'Company', render: (x: any) => <span className="font-medium text-ink-900">{companyName(x)}</span> },
            { key: 'invoiced', header: 'Invoiced (to date)', align: 'right', render: (x: any) => inr(x.invoiced) },
            { key: 'received', header: 'Received (to date)', align: 'right', render: (x: any) => <span className="text-ok-700">{inr(x.received)}</span> },
            { key: 'received_in_period', header: 'Received in period', align: 'right', render: (x: any) => inr(x.received_in_period) },
            { key: 'outstanding', header: 'Outstanding', align: 'right', render: (x: any) => <span className="font-semibold">{inr(x.outstanding)}</span> },
            { key: 'overdue', header: 'Overdue', align: 'right', render: (x: any) => (Number(x.overdue) > 0 ? <span className="font-semibold text-danger-600">{inr(x.overdue)}</span> : '—') },
            { key: 'last_payment', header: 'Last payment', render: (x: any) => (x.last_payment ? dmy(x.last_payment) : '—') },
          ]}
        />
      </section>
    </>
  );
}

/* ==========================================================================
   Register (and the Unallocated tab, which is the register filtered)
   ========================================================================== */

function Register({ modes, companies, onlyOpen = false, onChanged }: { modes: Mode[]; companies: Company[]; onlyOpen?: boolean; onChanged: () => void }) {
  const [params] = useSearchParams();
  const [f, setF] = useState(() => ({
    search: '', vendorId: params.get('vendorId') ?? '', mode: '',
    direction: onlyOpen ? 'IN' : (params.get('direction') ?? ''),
    status: onlyOpen ? 'OPEN' : (params.get('status') ?? ''),
    from: onlyOpen ? '' : (params.get('from') ?? presetRange('month').from),
    to: onlyOpen ? '' : (params.get('to') ?? presetRange('month').to),
  }));
  const [offset, setOffset] = useState(0);
  const [d, setD] = useState<any>({ data: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [payout, setPayout] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await api.get('/payments/register', { params: { ...f, limit: LIMIT, offset } });
      setD(r.data);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [f, offset]);
  useEffect(() => { load(); }, [load]);
  const set = (patch: Partial<typeof f>) => { setOffset(0); setF((p) => ({ ...p, ...patch })); };

  return (
    <>
      {onlyOpen && (
        <p className="notice-info text-sm">
          Money received but not yet matched to an invoice — an advance, or a transfer that covered more than was billed.
          Open a receipt to allocate or split it across the company&apos;s open invoices.
        </p>
      )}
      <section className="card p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={f.search} onChange={(v) => set({ search: v })} placeholder="Receipt ID, party, UTR, invoice, trip, remarks…" className="min-w-[14rem] flex-1" />
          <select className="input h-9 w-auto text-[13px]" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label="Party">
            <option value="">All parties</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
          </select>
          {!onlyOpen && (
            <>
              <select className="input h-9 w-auto text-[13px]" value={f.direction} onChange={(e) => set({ direction: e.target.value })} aria-label="Direction">
                <option value="">Received and paid</option><option value="IN">Received</option><option value="OUT">Paid (to suppliers)</option>
              </select>
              <select className="input h-9 w-auto text-[13px]" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
                <option value="">Any status</option>
                <option value="LIVE">Not reversed</option>
                <option value="ALLOCATED">Fully allocated</option>
                <option value="PARTLY_ALLOCATED">Partly allocated</option>
                <option value="UNALLOCATED">Unallocated</option>
                <option value="OPEN">Has unallocated money</option>
                <option value="REVERSED">Reversed</option>
              </select>
            </>
          )}
          <select className="input h-9 w-auto text-[13px]" value={f.mode} onChange={(e) => set({ mode: e.target.value })} aria-label="Method">
            <option value="">Any method</option>
            {modes.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
          <DateRange from={f.from} to={f.to} onChange={(r) => set(r)} label="Date" />
          <ExportButton url="/payments/register/export" params={f} />
        </div>
      </section>

      {error ? <ErrorState message={error} onRetry={load} /> : (
        <section className="table-wrap">
          <div className="card-head flex-wrap gap-2">
            <h2 className="card-title">{d.total ?? 0} entr{d.total === 1 ? 'y' : 'ies'}</h2>
            <p className="text-xs text-ink-500">
              Received {inr(d.received)} · Paid out {inr(d.paidOut)} · Unallocated {inr(d.unallocated)}
              <span className="ml-1 text-ink-400">(reversed entries excluded from totals)</span>
            </p>
          </div>
          <DataTable
            rows={d.data ?? []} rowKey={(r: any) => `${r.direction}${r.txn_id ?? r.payout_id}`} loading={loading}
            rowClassName={(r: any) => (r.is_reversed ? 'opacity-60' : '')}
            onRowClick={(r: any) => (r.direction === 'IN' ? setOpen(r.txn_id) : setPayout(r))}
            empty={<EmptyState title={onlyOpen ? 'Nothing unallocated' : 'No payments match'} body={onlyOpen ? 'Every receipt is fully allocated to invoices.' : 'Change the filters, or record a receipt.'} icon={<IconRupee className="h-5 w-5" />} />}
            columns={[
              { key: 'code', header: 'ID', render: (r: any) => <span className="cell-code whitespace-nowrap">{r.code}</span> },
              { key: 'date', header: 'Date', render: (r: any) => <span className="whitespace-nowrap">{dmy(r.date)}</span> },
              { key: 'party', header: 'Party', render: (r: any) => <span className="block max-w-[12rem] truncate">{r.party}</span> },
              { key: 'direction', header: 'Direction', render: (r: any) => (r.direction === 'IN' ? <span className="badge-ok">Received</span> : <span className="badge-brand">Paid</span>) },
              { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => <span className={`font-semibold tabular-nums ${r.is_reversed ? 'text-ink-400 line-through' : ''}`}>{inr(r.amount)}</span> },
              { key: 'mode', header: 'Method', render: (r: any) => humanise(r.mode) },
              { key: 'reference_no', header: 'Reference / UTR', render: (r: any) => <span className="font-mono text-xs">{r.reference_no || '—'}</span> },
              { key: 'invoices', header: 'Invoices / trips', render: (r: any) => (
                <div className="max-w-[14rem] text-xs"><p className="truncate">{r.invoices || '—'}</p>{r.trips && <p className="cell-meta truncate">{r.trips}</p>}</div>
              ) },
              { key: 'allocated', header: 'Allocated', align: 'right', render: (r: any) => (r.direction === 'IN' ? inr(r.allocated) : '—') },
              { key: 'unallocated', header: 'Unallocated', align: 'right', render: (r: any) => (r.direction === 'IN' && Number(r.unallocated) > 0 ? <span className="font-semibold text-violet-700">{inr(r.unallocated)}</span> : '—') },
              { key: 'status', header: 'Status', render: (r: any) => <ReceiptStatus value={r.status} /> },
              { key: 'created_by_name', header: 'Recorded by', render: (r: any) => (
                <span className="text-xs">{r.created_by_name ?? (r.source === 'MIGRATED' ? 'Migrated' : '—')}{r.remarks ? <span className="block max-w-[12rem] truncate text-ink-500">{r.remarks}</span> : null}
                  {r.is_reversed ? <span className="block text-danger-600">Reversed: {r.reversal_reason}</span> : null}</span>
              ) },
            ]}
          />
          <Pagination offset={offset} limit={LIMIT} total={d.total ?? 0} onChange={setOffset} />
        </section>
      )}
      {open && <TransactionDrawer id={open} onClose={() => setOpen(null)} onChanged={() => { load(); onChanged(); }} />}
      {payout && (
        <Modal open size="sm" title={`Payout ${payout.code}`} subtitle={`${inr(payout.amount)} to ${payout.party}`} onClose={() => setPayout(null)}
          footer={<button className="btn-outline" onClick={() => setPayout(null)}>Close</button>}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-ink-500">Date</dt><dd>{dmy(payout.date)}</dd>
            <dt className="text-ink-500">Method</dt><dd>{humanise(payout.mode)}</dd>
            <dt className="text-ink-500">Reference</dt><dd>{payout.reference_no || '—'}</dd>
            <dt className="text-ink-500">Trip</dt><dd>{payout.trips || 'Settlement of balance'}</dd>
            <dt className="text-ink-500">Status</dt><dd><ReceiptStatus value={payout.status} /></dd>
          </dl>
          <p className="mt-3 text-xs text-ink-500">Payouts are managed (and reversed) on the Payables tab.</p>
        </Modal>
      )}
    </>
  );
}

/* ==========================================================================
   One receipt: allocations, allocate the rest, take back, reverse
   ========================================================================== */

function TransactionDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [t, setT] = useState<any>(null);
  const [error, setError] = useState('');
  const [openInv, setOpenInv] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [reverse, setReverse] = useState<{ title: string; subtitle: string; endpoint: string; note: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/payments/transactions/${id}`);
      setT(r.data.data);
      setAlloc({});
      if (r.data.data.vendor_id && !r.data.data.is_reversed && Number(r.data.data.unallocated) > 0) {
        const o = await api.get('/payments/open-invoices', { params: { vendorId: r.data.data.vendor_id } });
        setOpenInv(o.data.data ?? []);
      } else setOpenInv([]);
    } catch (err) { setError(errorMessage(err)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const freeP = t ? P(t.unallocated) : 0;
  const enteredP = Object.values(alloc).reduce((s, v) => s + P(v), 0);
  const overInv = openInv.find((i) => P(alloc[i.id]) > P(i.outstanding_amount));
  const autoFill = () => {
    let left = freeP;
    const next: Record<number, string> = {};
    for (const i of openInv) { if (left <= 0) break; const take = Math.min(left, P(i.outstanding_amount)); if (take > 0) { next[i.id] = String(R(take)); left -= take; } }
    setAlloc(next);
  };
  const save = async () => {
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => P(v) > 0).map(([invoiceId, v]) => ({ invoiceId: Number(invoiceId), amount: R(P(v)) }));
      const { data } = await api.post(`/payments/transactions/${id}/allocate`, { allocations });
      toast.success('Allocated', data.message);
      onChanged(); load();
    } catch (err) { toast.error('Not allocated', errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Drawer open onClose={onClose} title={t ? `Receipt ${t.txn_code}` : 'Receipt'} width="max-w-3xl"
      subtitle={t ? `${inr(t.amount)} from ${companyName({ code: t.vendor_code, vendor_name: t.vendor_name ?? t.party_name })} on ${dmy(t.txn_date)}` : ''}
      headerExtra={t && <ReceiptStatus value={t.allocation_status} />}
      footer={t && !t.is_reversed && can('payments.delete', 'payments.update') ? (
        <button className="btn-danger btn-sm" onClick={() => setReverse({
          title: `Reverse receipt ${t.txn_code}?`, subtitle: `${inr(t.amount)} and its ${t.allocations.filter((a: any) => !a.is_reversed).length} allocation(s)`,
          endpoint: `/payments/transactions/${id}/reverse`, note: 'The receipt and every allocation stay on record, marked reversed, and each invoice balance is worked out again. Use this when the money was not actually received (bounced, entered twice).',
        })}>Reverse receipt…</button>
      ) : undefined}>
      {error ? <ErrorState message={error} onRetry={load} /> : !t ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi label="Amount" value={inr(t.amount)} />
            <Kpi label="Allocated" value={inr(t.allocated)} tone="success" />
            <Kpi label="Unallocated" value={inr(t.unallocated)} tone={Number(t.unallocated) > 0 ? 'violet' : 'default'} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
            <dt className="text-ink-500">Method</dt><dd>{humanise(t.mode)}</dd>
            <dt className="text-ink-500">Reference / UTR</dt><dd className="font-mono text-xs">{t.reference_no || '—'}</dd>
            <dt className="text-ink-500">Bank</dt><dd>{t.bank || '—'}</dd>
            <dt className="text-ink-500">Source</dt><dd>{humanise(t.source)}</dd>
            <dt className="text-ink-500">Recorded</dt><dd>{t.created_by_name ?? '—'} · {dmyTime(t.created_at)}</dd>
            <dt className="text-ink-500">Remarks</dt><dd>{t.remarks || '—'}</dd>
            {t.is_reversed ? <><dt className="text-danger-600">Reversed</dt><dd className="text-danger-600">{t.reversed_by_name} · {dmyTime(t.reversed_at)} — {t.reversal_reason}</dd></> : null}
          </dl>

          <section>
            <h3 className="mb-2 font-semibold text-ink-900">Allocations</h3>
            {t.allocations.length === 0 ? <p className="text-sm text-ink-500">Not allocated to any invoice yet.</p> : (
              <div className="overflow-x-auto rounded-lg border border-ink-200">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-xs text-ink-500"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2 text-right">Allocated</th><th className="px-3 py-2 text-right">Invoice balance now</th><th className="px-3 py-2">State</th><th /></tr></thead>
                  <tbody className="divide-y divide-ink-100">
                    {t.allocations.map((a: any) => (
                      <tr key={a.id} className={a.is_reversed ? 'opacity-60' : ''}>
                        <td className="px-3 py-2"><button className="cell-code hover:underline" onClick={() => navigate(`/admin/invoices/${a.invoice_id}`)}>{a.invoice_number}</button></td>
                        <td className={`px-3 py-2 text-right tabular-nums ${a.is_reversed ? 'line-through' : 'font-semibold'}`}>{inr(a.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inr(a.outstanding_amount)}</td>
                        <td className="px-3 py-2 text-xs">{a.is_reversed ? <span className="text-danger-600">Taken back: {a.reversal_reason}</span> : <span className="badge-ok">Live</span>}</td>
                        <td className="px-3 py-2 text-right">
                          {!a.is_reversed && !t.is_reversed && can('payments.delete', 'payments.update') && (
                            <button className="btn-ghost btn-sm text-danger-600" onClick={() => setReverse({
                              title: 'Take this allocation back?', subtitle: `${inr(a.amount)} on ${a.invoice_number}`,
                              endpoint: `/payments/allocations/${a.id}/unallocate`,
                              note: `The amount returns to ${t.txn_code}'s unallocated balance, ready to allocate elsewhere. The invoice balance goes back up.`,
                            })}>Take back</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {!t.is_reversed && freeP > 0 && can('payments.create', 'payments.update') && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-ink-900">Allocate {inr(t.unallocated)}</h3>
                {openInv.length > 0 && <button className="btn-outline btn-sm ml-auto" onClick={autoFill}>Fill oldest first</button>}
              </div>
              {openInv.length === 0 ? <p className="text-sm text-ink-500">This company has no open invoices. The money stays as an advance until an invoice is raised.</p> : (
                <AllocationTable invoices={openInv} values={alloc} onChange={setAlloc} />
              )}
              {openInv.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span>Entered {inr(R(enteredP))} of {inr(t.unallocated)}{enteredP > freeP && <strong className="ml-1 text-danger-600">— more than is unallocated</strong>}</span>
                  {overInv && <span className="text-danger-600">More than outstanding on {overInv.invoice_number}</span>}
                  <button className="btn-primary btn-sm ml-auto" disabled={busy || enteredP <= 0 || enteredP > freeP || !!overInv} onClick={save}>{busy && <Spinner />} Allocate {inr(R(enteredP))}</button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {reverse && <ReverseModal {...reverse} onClose={() => setReverse(null)} onDone={() => { setReverse(null); load(); onChanged(); }} />}
    </Drawer>
  );
}

/** Open invoices with an editable amount per invoice. */
function AllocationTable({ invoices, values, onChange }: { invoices: any[]; values: Record<number, string>; onChange: (v: Record<number, string>) => void }) {
  return (
    <div className="max-h-96 overflow-auto rounded-lg border border-ink-200">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-ink-50 text-left text-xs text-ink-500">
          <tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Outstanding</th><th className="px-3 py-2 text-right">Allocate</th><th className="px-3 py-2 text-right">Left after</th></tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {invoices.map((i) => {
            const v = values[i.id] ?? '';
            const over = P(v) > P(i.outstanding_amount);
            const left = P(i.outstanding_amount) - P(v);
            return (
              <tr key={i.id}>
                <td className="px-3 py-1.5"><span className="cell-code">{i.invoice_number}</span>{i.bill_to_name && <span className="cell-meta block max-w-[10rem] truncate">{i.bill_to_name}</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{dmy(i.invoice_date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{dmy(i.due_date)}{i.is_overdue ? <span className="ml-1 text-2xs font-semibold text-danger-600">Overdue</span> : null}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{inr(i.total_amount)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{inr(i.outstanding_amount)}</td>
                <td className="px-3 py-1.5 text-right">
                  <input className={`input h-8 w-28 text-right tabular-nums ${over ? 'input-error' : ''}`} inputMode="decimal" value={v} placeholder="0.00"
                    aria-label={`Allocate to ${i.invoice_number}`} onChange={(e) => onChange({ ...values, [i.id]: e.target.value })} />
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular-nums">{over ? <span className="font-semibold text-danger-600">Too much</span> : P(v) > 0 ? (left <= 0 ? <span className="badge-ok">Paid</span> : inr(R(left))) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReverseModal({ title, subtitle, endpoint, note, onClose, onDone }: { title: string; subtitle: string; endpoint: string; note?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const { data } = await api.post(endpoint, { reason }); toast.success('Reversed', data.message); onDone(); }
    catch (err) { toast.error('Not reversed', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={title} subtitle={subtitle}
      footer={<><button className="btn-outline" onClick={onClose} disabled={busy}>Keep it</button><button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={go}>{busy && <Spinner />} Reverse</button></>}>
      <p className="text-sm text-ink-700">{note ?? 'The entry stays on record, marked reversed, and the balance is worked out again.'}</p>
      <Field label="Why" required className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Cheque bounced / entered twice" autoFocus /></Field>
    </Modal>
  );
}

/* ==========================================================================
   Record receipt
   ========================================================================== */

export function RecordReceipt({ modes, companies, prefill = {}, onSaved, onCancel }: {
  modes: Mode[]; companies: Company[]; prefill?: ReceiptPrefill; onSaved: () => void; onCancel?: () => void;
}) {
  const toast = useToast();
  const [vendorId, setVendorId] = useState(prefill.vendorId ? String(prefill.vendorId) : '');
  const [form, setForm] = useState({
    amount: prefill.amount != null ? String(prefill.amount) : '', txnDate: prefill.txnDate || todayLocalIso(), mode: 'BANK_TRANSFER',
    referenceNo: prefill.referenceNo ?? '', bank: '', remarks: prefill.remarks ?? '',
  });
  const [invoices, setInvoices] = useState<any[]>([]);
  const [alloc, setAlloc] = useState<Record<number, string>>({});
  const [loadingInv, setLoadingInv] = useState(false);
  const [dup, setDup] = useState('');
  const [dupReason, setDupReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);

  // Coming from an invoice: find its company first.
  useEffect(() => {
    if (vendorId || !prefill.invoiceId) return;
    api.get(`/invoices/${prefill.invoiceId}`).then((r) => {
      const inv = r.data.data;
      setVendorId(String(inv.vendor_id));
      setForm((f) => ({ ...f, amount: f.amount || String(inv.outstanding_amount) }));
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setInvoices([]); setAlloc({}); setDup('');
    if (!vendorId) return;
    setLoadingInv(true);
    api.get('/payments/open-invoices', { params: { vendorId } }).then((r) => setInvoices(r.data.data ?? []))
      .catch((err) => toast.error('Could not load open invoices', errorMessage(err))).finally(() => setLoadingInv(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  const amountP = P(form.amount);
  /** Oldest first: each invoice takes up to its outstanding until the money runs out. */
  const autoAllocate = useCallback((totalP: number, list: any[]) => {
    const next: Record<number, string> = {};
    const preferred = prefill.invoiceId ? list.find((i) => String(i.id) === String(prefill.invoiceId)) : null;
    let left = totalP;
    for (const i of preferred ? [preferred, ...list.filter((x) => x !== preferred)] : list) {
      if (left <= 0) break;
      const take = Math.min(left, P(i.outstanding_amount));
      if (take > 0) { next[i.id] = String(R(take)); left -= take; }
    }
    setAlloc(next);
  }, [prefill.invoiceId]);

  // Re-run the automatic split while the user has not edited it by hand.
  useEffect(() => { if (!touched) autoAllocate(amountP, invoices); }, [amountP, invoices, touched, autoAllocate]);

  const allocatedP = Object.values(alloc).reduce((s, v) => s + P(v), 0);
  const unallocatedP = amountP - allocatedP;
  const overInv = invoices.find((i) => P(alloc[i.id]) > P(i.outstanding_amount));
  const totalOutstandingP = invoices.reduce((s, i) => s + P(i.outstanding_amount), 0);
  const problem = !vendorId ? 'Choose the company.' : amountP <= 0 ? 'Enter the amount received.'
    : unallocatedP < 0 ? `The allocations are ${inr(R(-unallocatedP))} more than the amount received.`
      : overInv ? `More than the outstanding on ${overInv.invoice_number}.` : '';

  const save = async (allowDuplicate = false) => {
    setBusy(true);
    try {
      const allocations = Object.entries(alloc).filter(([, v]) => P(v) > 0).map(([invoiceId, v]) => ({ invoiceId: Number(invoiceId), amount: R(P(v)) }));
      const { data } = await api.post('/payments/receipts', {
        vendorId: Number(vendorId), ...form, amount: R(amountP), allocations, source: prefill.source ?? 'MANUAL',
        allowDuplicate, duplicateReason: allowDuplicate ? dupReason : '',
      });
      toast.success('Receipt recorded', data.message);
      onSaved();
    } catch (err: any) {
      if (err?.response?.data?.code === 'POSSIBLE_DUPLICATE') setDup(err.response.data.error);
      else toast.error('Receipt not recorded', errorMessage(err));
    } finally { setBusy(false); }
  };

  const company = companies.find((c) => String(c.id) === vendorId);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Company (received from)" required>
          <select className="input" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setTouched(false); }}>
            <option value="">Choose…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{companyName(c)}{Number(c.outstanding) > 0 ? ` — ${inr(c.outstanding)} due` : ''}</option>)}
          </select>
        </Field>
        <Field label="Amount received" required hint={company && totalOutstandingP > 0 ? `${inr(R(totalOutstandingP))} outstanding on ${invoices.length} invoice(s)` : undefined}>
          <input className="input text-right tabular-nums" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
        </Field>
        <Field label="Date received" required><DateField value={form.txnDate} onChange={(v) => setForm({ ...form, txnDate: v })} max={todayLocalIso()} clearable={false} /></Field>
        <Field label="Method">
          <select className="input" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
            {(modes.length ? modes : [{ code: 'BANK_TRANSFER', label: 'Bank transfer' }]).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Reference / UTR" hint="UTR, UPI ref or cheque no."><input className="input font-mono" value={form.referenceNo} onChange={(e) => { setForm({ ...form, referenceNo: e.target.value }); setDup(''); }} /></Field>
        <Field label="Bank"><input className="input" value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} /></Field>
        <Field label="Remarks" className="sm:col-span-2 lg:col-span-3"><input className="input" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></Field>
      </div>

      {vendorId && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink-900">Allocate to open invoices</h3>
            <span className="text-xs text-ink-500">Oldest first by default — change any amount. Whatever is left is held as unallocated.</span>
            <div className="ml-auto flex gap-2">
              <button className="btn-outline btn-sm" onClick={() => { setTouched(false); autoAllocate(amountP, invoices); }} disabled={!invoices.length}>Fill oldest first</button>
              <button className="btn-ghost btn-sm" onClick={() => { setTouched(true); setAlloc({}); }} disabled={!invoices.length}>Clear</button>
            </div>
          </div>
          {loadingInv ? <Spinner /> : invoices.length === 0 ? (
            <p className="notice-info text-sm">No open invoices for this company. The whole amount will be held as unallocated (an advance) until it is allocated.</p>
          ) : <AllocationTable invoices={invoices} values={alloc} onChange={(v) => { setTouched(true); setAlloc(v); }} />}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-sm">
        <span>Received <strong className="tabular-nums">{inr(R(amountP))}</strong></span>
        <span>Allocated <strong className="tabular-nums text-ok-700">{inr(R(allocatedP))}</strong></span>
        <span>Unallocated <strong className={`tabular-nums ${unallocatedP < 0 ? 'text-danger-600' : 'text-violet-700'}`}>{inr(R(unallocatedP))}</strong>{unallocatedP > 0 && <span className="ml-1 text-xs text-ink-500">(held as advance)</span>}</span>
        {problem && vendorId && amountP > 0 && <span className="text-danger-600">{problem}</span>}
      </div>

      {dup && (
        <div className="notice-warn flex-col items-stretch gap-2 text-sm">
          <p className="flex gap-2"><IconWarning className="h-4 w-4 shrink-0" /> {dup}</p>
          <Field label="Why is this a separate payment?" required>
            <input className="input" value={dupReason} onChange={(e) => setDupReason(e.target.value)} placeholder="e.g. Bank reused the UTR for a second transfer" />
          </Field>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <button className="btn-outline" onClick={onCancel} disabled={busy}>Cancel</button>}
        {dup
          ? <button className="btn-primary" disabled={busy || dupReason.trim().length < 3 || !!problem} onClick={() => save(true)}>{busy && <Spinner />} Record as a separate payment</button>
          : <button className="btn-primary" disabled={busy || !!problem} onClick={() => save(false)}>{busy && <Spinner />} Record {amountP > 0 ? inr(R(amountP)) : 'receipt'}</button>}
      </div>
    </div>
  );
}

/* ==========================================================================
   Payables
   ========================================================================== */

function Payables({ modes }: { modes: Mode[] }) {
  const toast = useToast();
  const { can } = useAuth();
  const [range, setRange] = useState({ from: '', to: '' });
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pay, setPay] = useState<any>(null);
  const [toReverse, setToReverse] = useState<any>(null);
  const [view, setView] = useState<'payees' | 'trips' | 'payouts'>('payees');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/payments/payables', { params: range }).then((r) => setD(r.data))
      .catch((err) => toast.error('Could not load payables', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const savePayout = async () => {
    try {
      const { data } = await api.post('/payments/payables', { ...pay, amount: Number(pay.amount), bookingId: pay.bookingId ? Number(pay.bookingId) : null });
      toast.success('Payout recorded', data.message);
      setPay(null); load();
    } catch (err) { toast.error('Payout not recorded', errorMessage(err)); }
  };

  const tripsForPayee = useMemo(() => (d?.trips ?? []).filter((t: any) => pay && t.supplier_name?.toLowerCase() === String(pay.payeeName).toLowerCase()), [d, pay]);

  return (
    <>
      <p className="notice-info text-sm">
        Payables come from the <strong>supplier cost</strong> recorded on a trip (Trips → Fare → What this trip costs us) for vehicles that are not your own.
        They are what you owe, and never appear on an invoice or in receivables.
      </p>
      {d && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi label="Payable" value={inr(d.totals.payable)} tone="warning" icon={<IconCar className="h-4 w-4" />} sub="Supplier cost on trips" />
          <Kpi label="Paid out" value={inr(d.totals.paid)} tone="success" icon={<IconRupee className="h-4 w-4" />} sub="Recorded payouts" />
          <Kpi label="Balance due" value={inr(d.totals.balance)} tone={d.totals.balance > 0 ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />} sub="Still to pay" />
        </div>
      )}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <Segmented size="sm" value={view} onChange={setView} options={[
          { value: 'payees', label: 'By payee' }, { value: 'trips', label: 'Trips with a cost' }, { value: 'payouts', label: 'Payouts' },
        ]} />
        <DateRange from={range.from} to={range.to} onChange={setRange} label="Period" />
        <ExportButton url="/payments/payables/export" params={range} />
      </div>
      <section className="table-wrap">
        {view === 'payees' && (
          <DataTable rows={d?.data ?? []} rowKey={(r: any) => r.payee} loading={loading}
            empty={<EmptyState title="Nothing payable" body="Record a supplier cost on trips run with attached or partner vehicles, and the amounts owed appear here." />}
            columns={[
              { key: 'payee', header: 'Payee', render: (r: any) => <span className="font-medium text-ink-900">{r.payee}</span> },
              { key: 'trips', header: 'Trips', align: 'right' },
              { key: 'payable', header: 'Payable', align: 'right', render: (r: any) => inr(r.payable) },
              { key: 'paid', header: 'Paid', align: 'right', render: (r: any) => <span className="text-ok-700">{inr(r.paid)}</span> },
              { key: 'balance', header: 'Balance due', align: 'right', render: (r: any) => <span className={r.balance > 0 ? 'font-semibold text-danger-600' : 'text-ink-400'}>{inr(r.balance)}</span> },
              { key: 'last_paid', header: 'Last paid', render: (r: any) => (r.last_paid ? dmy(r.last_paid) : '—') },
              { key: 'a', header: '', sortable: false, align: 'right', render: (r: any) => (can('payments.create') && r.balance > 0 ? (
                <button className="btn-outline btn-sm" onClick={() => setPay({ payeeName: r.payee, amount: String(r.balance), paymentDate: todayLocalIso(), mode: 'BANK_TRANSFER', referenceNo: '', notes: '', bookingId: '' })}>Pay</button>
              ) : null) },
            ]} />
        )}
        {view === 'trips' && (
          <DataTable rows={d?.trips ?? []} rowKey={(r: any) => r.id} loading={loading} pageSize={50}
            empty={<EmptyState title="No trip has a supplier cost yet" />}
            columns={[
              { key: 'trip_id', header: 'Trip', render: (r: any) => <Link to={`/admin/trips?open=${r.id}`} className="cell-code hover:underline">{r.trip_id}</Link> },
              { key: 'travel_date', header: 'Date', render: (r: any) => dmy(r.travel_date) },
              { key: 'supplier_name', header: 'Payee' },
              { key: 'vehicle_number', header: 'Vehicle', render: (r: any) => <span className="font-mono text-xs">{r.vehicle_number || '—'}</span> },
              { key: 'billed', header: 'Billed to customer', align: 'right', render: (r: any) => inr(r.billed) },
              { key: 'supplier_cost', header: 'Cost (payable)', align: 'right', render: (r: any) => inr(r.supplier_cost) },
              { key: 'booking_status', header: 'Status', render: (r: any) => <StatusBadge value={r.booking_status} /> },
            ]} />
        )}
        {view === 'payouts' && (
          <DataTable rows={d?.payments ?? []} rowKey={(r: any) => r.id} loading={loading} pageSize={50}
            rowClassName={(r: any) => (r.is_reversed ? 'opacity-60' : '')}
            empty={<EmptyState title="No payouts recorded" />}
            columns={[
              { key: 'payment_date', header: 'Date', render: (r: any) => dmy(r.payment_date) },
              { key: 'payee_name', header: 'Payee' },
              { key: 'trip_id', header: 'Trip', render: (r: any) => (r.trip_id ? <span className="cell-code">{r.trip_id}</span> : '—') },
              { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => <span className={r.is_reversed ? 'line-through' : 'font-semibold'}>{inr(r.amount)}</span> },
              { key: 'mode', header: 'Method', render: (r: any) => humanise(r.mode) },
              { key: 'reference_no', header: 'Reference', render: (r: any) => r.reference_no || '—' },
              { key: 'created_by_name', header: 'By', render: (r: any) => <span className="text-xs">{r.created_by_name} · {dmyTime(r.created_at)}{r.is_reversed ? <span className="block text-danger-600">Reversed: {r.reversal_reason}</span> : null}</span> },
              { key: 'a', header: '', sortable: false, align: 'right', render: (r: any) => (!r.is_reversed && can('payments.delete', 'payments.update') ? (
                <Menu items={[{ label: 'Reverse…', danger: true, onClick: () => setToReverse(r) }]} />
              ) : null) },
            ]} />
        )}
      </section>

      {pay && (
        <Modal open onClose={() => setPay(null)} title={`Pay ${pay.payeeName}`} subtitle="Records money paid out to a vehicle owner or partner."
          footer={<><button className="btn-outline" onClick={() => setPay(null)}>Cancel</button><button className="btn-primary" disabled={!(Number(pay.amount) > 0)} onClick={savePayout}>Record payout</button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" required><input className="input text-right tabular-nums" inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
            <Field label="Date paid" required><DateField value={pay.paymentDate} onChange={(v) => setPay({ ...pay, paymentDate: v })} max={todayLocalIso()} /></Field>
            <Field label="Method">
              <select className="input" value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                {(modes.length ? modes : [{ code: 'BANK_TRANSFER', label: 'Bank transfer' }]).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="Reference"><input className="input" value={pay.referenceNo} onChange={(e) => setPay({ ...pay, referenceNo: e.target.value })} /></Field>
            <Field label="For trip" hint="Optional" className="sm:col-span-2">
              <select className="input" value={pay.bookingId} onChange={(e) => setPay({ ...pay, bookingId: e.target.value })}>
                <option value="">Settlement of the balance</option>
                {tripsForPayee.map((t: any) => <option key={t.id} value={t.id}>{t.trip_id} · {dmy(t.travel_date)} · {inr(t.supplier_cost)}</option>)}
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2"><input className="input" value={pay.notes} onChange={(e) => setPay({ ...pay, notes: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
      {toReverse && <ReverseModal title="Reverse this payout?" subtitle={`${inr(toReverse.amount)} to ${toReverse.payee_name}`}
        endpoint={`/payments/payables/${toReverse.id}/reverse`} onClose={() => setToReverse(null)} onDone={() => { setToReverse(null); load(); }} />}
    </>
  );
}
