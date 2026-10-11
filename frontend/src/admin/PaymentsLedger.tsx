/**
 * Payments & Ledger — the company ledger, receipts by trip, and statement
 * reconciliation. Rules are the server's (services/ledger.ts); this screen
 * only shows them.
 *
 *   Ledger     opening (everything before the range, incl. earlier invoices),
 *              then invoices (debit), receipts incl. advances and adjustments
 *              (credit), reversals as their own lines, running balance, closing.
 *   Trips      an invoice's received amount spread over its trips, oldest first.
 *   Reconcile  upload a statement, map its columns, compare. Nothing is
 *              recorded automatically; missing receipts are recorded one by one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr, dmy, humanise, todayLocalIso } from '../lib/format';
import { EmptyState, ErrorState, Field, Modal, Spinner } from '../components/ui';
import { DataTable, DateRange, ExportButton, Kpi, SearchBox, Segmented, presetRange } from '../components/data';
import { DateField } from '../components/DateTimeField';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { IconPrint, IconUpload, IconBook, IconWarning } from '../components/icons';
import type { Company, ReceiptPrefill } from './Payments';

const companyLabel = (c?: Company | null) => (c?.code === 'DIRECT' ? 'Walk-in customers' : c?.vendor_name ?? '');

const KIND_TEXT: Record<string, string> = {
  OPENING: 'Opening balance', INVOICE: 'Invoice', RECEIPT: 'Receipt', RECEIPT_REVERSAL: 'Receipt reversed',
  ADJUSTMENT: 'Adjustment', ADJUSTMENT_REVERSAL: 'Adjustment reversed',
};
const ADJ_KINDS = [
  { code: 'TDS', label: 'TDS deducted' }, { code: 'WRITE_OFF', label: 'Write-off' }, { code: 'ROUNDING', label: 'Rounding' },
  { code: 'CREDIT_NOTE', label: 'Credit note' }, { code: 'OTHER', label: 'Other' },
];
/** Balance with its side in words: positive = the company owes us. */
const bal = (v: number) => (Math.abs(Number(v)) < 0.005 ? inr(0) : `${inr(Math.abs(Number(v)))} ${Number(v) > 0 ? 'Dr' : 'Cr'}`);

/* ==========================================================================
   Company ledger (+ receipts by trip)
   ========================================================================== */

export function CompanyLedger({ companies }: { companies: Company[] }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [vendorId, setVendorId] = useState(params.get('vendorId') ?? '');
  const [range, setRange] = useState({ from: params.get('from') ?? presetRange('fy').from, to: params.get('to') ?? presetRange('fy').to });
  const [view, setView] = useState<'ledger' | 'trips' | 'adjustments'>('ledger');
  const [d, setD] = useState<any>(null);
  const [trips, setTrips] = useState<any>(null);
  const [tripSearch, setTripSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openingOpen, setOpeningOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [toReverse, setToReverse] = useState<any>(null);

  const load = useCallback(async () => {
    if (!vendorId) { setD(null); setTrips(null); return; }
    setLoading(true); setError('');
    try {
      const [l, t] = await Promise.all([
        api.get(`/payments/ledger/${vendorId}`, { params: range }),
        api.get('/payments/trip-allocation', { params: { vendorId, ...range } }),
      ]);
      setD(l.data); setTrips(t.data);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [vendorId, range]);
  useEffect(() => { load(); }, [load]);

  const company = companies.find((c) => String(c.id) === vendorId);
  const tripRows = useMemo(() => {
    const s = tripSearch.trim().toLowerCase();
    return (trips?.data ?? []).filter((r: any) => !s || [r.invoice_number, r.trip_id, r.booking_code, r.reference, r.passenger].some((x) => String(x ?? '').toLowerCase().includes(s)));
  }, [trips, tripSearch]);

  return (
    <>
      <div className="card flex flex-wrap items-center gap-3 p-3 no-print">
        <select className="input h-9 w-auto min-w-[14rem] text-[13px]" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Company">
          <option value="">Choose a company…</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{companyLabel(c)}</option>)}
        </select>
        <DateRange from={range.from} to={range.to} onChange={setRange} label="Period" />
        {vendorId && (
          <div className="ml-auto flex flex-wrap gap-2">
            {can('payments.update') && <button className="btn-outline btn-sm" onClick={() => setOpeningOpen(true)}>Opening balance</button>}
            {can('payments.update') && <button className="btn-outline btn-sm" onClick={() => setAdjOpen(true)}>Add adjustment</button>}
            <button className="btn-outline btn-sm" onClick={() => window.print()}><IconPrint className="h-3.5 w-3.5" /> Print</button>
            <ExportButton url={view === 'trips' ? '/payments/trip-allocation/export' : `/payments/ledger/${vendorId}/export`} params={view === 'trips' ? { vendorId, ...range } : range} />
          </div>
        )}
      </div>

      {!vendorId ? <EmptyState title="Choose a company" body="Its ledger shows the opening balance, every invoice, receipt and adjustment, and the running balance." icon={<IconBook className="h-5 w-5" />} />
        : error ? <ErrorState message={error} onRetry={load} />
          : !d ? <Spinner /> : (
            <>
              <div className="hidden print:block">
                <h1 className="text-xl font-bold">Ledger — {d.vendor.vendor_name}</h1>
                <p className="text-sm">{d.from ? dmy(d.from) : 'Beginning'} to {d.to ? dmy(d.to) : 'today'} · printed {dmy(todayLocalIso())}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <Kpi label="Opening balance" value={bal(d.opening)} sub={d.from ? `Before ${dmy(d.from)}, incl. earlier invoices` : 'From the beginning'} />
                <Kpi label="Debits in period" value={inr(d.totals.debit)} tone="warning" sub="Invoices, reversals" />
                <Kpi label="Credits in period" value={inr(d.totals.credit)} tone="success" sub="Receipts, adjustments" />
                <Kpi label="Closing balance" value={bal(d.closing)} tone={d.closing > 0 ? 'danger' : 'default'} sub="Dr = the company owes us" />
                <Kpi label="Unallocated now" value={inr(d.position.unallocated)} tone="violet" sub={`${d.position.openInvoices} open invoice(s), ${inr(d.position.invoiceOutstanding)} due`} />
              </div>
              <div className="no-print"><Segmented size="sm" value={view} onChange={setView} options={[
                { value: 'ledger', label: 'Ledger' }, { value: 'trips', label: 'Receipts by trip' },
                { value: 'adjustments', label: 'Opening & adjustments', count: d.adjustments.length },
              ]} /></div>

              {view === 'ledger' && (
                <section className="table-wrap print-sheet">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-ink-50 text-left text-xs text-ink-500">
                        <tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Particulars</th>
                          <th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        <tr className="bg-ink-50/60 font-medium"><td className="px-3 py-2">{d.from ? dmy(d.from) : '—'}</td><td className="px-3 py-2" colSpan={3}>Opening balance{d.from ? ' (brought forward)' : ''}</td><td /><td /><td className="px-3 py-2 text-right tabular-nums">{bal(d.opening)}</td></tr>
                        {d.lines.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-500">No entries in this period.</td></tr>}
                        {d.lines.map((l: any, i: number) => (
                          <tr key={i} className={l.kind.endsWith('REVERSAL') ? 'bg-danger-50/40' : ''}>
                            <td className="px-3 py-1.5 whitespace-nowrap">{dmy(l.date)}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap text-xs">{KIND_TEXT[l.kind] ?? l.kind}</td>
                            <td className="px-3 py-1.5">
                              {l.linkType === 'invoice'
                                ? <button className="cell-code hover:underline" onClick={() => navigate(`/admin/invoices/${l.linkId}`)}>{l.ref}</button>
                                : <span className="cell-code">{l.ref}</span>}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-ink-700">{l.description}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{l.debit ? inr(l.debit) : ''}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-ok-700">{l.credit ? inr(l.credit) : ''}</td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums">{bal(l.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="border-t-2 border-ink-200 font-semibold">
                        <tr><td className="px-3 py-2" colSpan={4}>Totals for the period · Closing balance</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(d.totals.debit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(d.totals.credit)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{bal(d.closing)}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="px-3 py-2 text-xs text-ink-500">Dr = the company owes us; Cr = we hold more than is billed (an advance). Receipts are shown in full, including any amount not yet allocated to an invoice. Cancelled invoices are left out.</p>
                </section>
              )}

              {view === 'trips' && (
                <section className="table-wrap">
                  <div className="card-head flex-wrap gap-2">
                    <SearchBox value={tripSearch} onChange={setTripSearch} placeholder="Invoice, trip, booking, passenger…" className="max-w-sm" />
                    <p className="text-xs text-ink-500">Invoices dated in the period. {trips?.rule}</p>
                  </div>
                  <DataTable rows={tripRows} rowKey={(r: any) => `${r.invoice_id}-${r.booking_id}`} loading={loading} pageSize={50}
                    onRowClick={(r: any) => navigate(`/admin/invoices/${r.invoice_id}`)}
                    empty={<EmptyState title="No invoiced trips in this period" />}
                    columns={[
                      { key: 'invoice_number', header: 'Invoice', render: (r: any) => <span className="cell-code">{r.invoice_number}</span> },
                      { key: 'trip_id', header: 'Trip / booking', render: (r: any) => <div><span className="cell-code">{r.trip_id || r.booking_code}</span>{r.trip_id && <span className="cell-meta block">{r.booking_code}</span>}</div> },
                      { key: 'reference', header: 'Company ref', render: (r: any) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
                      { key: 'passenger', header: 'Passenger', render: (r: any) => r.passenger || '—' },
                      { key: 'travel_date', header: 'Date', render: (r: any) => dmy(r.travel_date) },
                      { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => inr(r.amount) },
                      { key: 'allocated', header: 'Received', align: 'right', render: (r: any) => <span className="text-ok-700">{inr(r.allocated)}</span> },
                      { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r: any) => <span className={r.outstanding > 0 ? 'font-semibold' : 'text-ink-400'}>{inr(r.outstanding)}</span> },
                      { key: 'status', header: 'Status', render: (r: any) => <span className={r.status === 'PAID' ? 'badge-ok' : r.status === 'PARTIALLY_PAID' ? 'badge-warn' : 'badge-neutral'}>{r.status === 'PAID' ? 'Settled' : r.status === 'PARTIALLY_PAID' ? 'Part settled' : 'Unpaid'}</span> },
                    ]} />
                  {trips && <p className="px-3 py-2 text-right text-sm font-semibold">Total {inr(trips.totals.amount)} · Received {inr(trips.totals.allocated)} · Outstanding {inr(trips.totals.outstanding)}</p>}
                </section>
              )}

              {view === 'adjustments' && (
                <section className="space-y-3">
                  <div className="card p-4 text-sm">
                    <h3 className="font-semibold text-ink-900">Opening balance</h3>
                    {d.openingBalance
                      ? <p className="mt-1">{bal(d.openingBalance.amount)} as of {dmy(d.openingBalance.as_of_date)}{d.openingBalance.notes ? ` — ${d.openingBalance.notes}` : ''} <span className="text-xs text-ink-500">(set by {d.openingBalance.updated_by_name ?? '—'})</span></p>
                      : <p className="mt-1 text-ink-500">None set. Set one when the company owed money before its first invoice in the portal.</p>}
                  </div>
                  <section className="table-wrap">
                    <DataTable rows={d.adjustments} rowKey={(r: any) => r.id}
                      rowClassName={(r: any) => (r.is_reversed ? 'opacity-60' : '')}
                      empty={<EmptyState title="No adjustments" body="TDS deducted, write-offs, rounding and credit notes are recorded here, never by editing an invoice." />}
                      columns={[
                        { key: 'adj_date', header: 'Date', render: (r: any) => dmy(r.adj_date) },
                        { key: 'kind', header: 'Kind', render: (r: any) => ADJ_KINDS.find((k) => k.code === r.kind)?.label ?? humanise(r.kind) },
                        { key: 'invoice_number', header: 'Invoice', render: (r: any) => (r.invoice_number ? <span className="cell-code">{r.invoice_number}</span> : '—') },
                        { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => <span className={r.is_reversed ? 'line-through' : 'font-semibold'}>{inr(r.amount)}</span> },
                        { key: 'remarks', header: 'Remarks', render: (r: any) => <span className="text-xs">{r.remarks}</span> },
                        { key: 'created_by_name', header: 'By', render: (r: any) => <span className="text-xs">{r.created_by_name ?? '—'}</span> },
                        { key: 'state', header: 'State', render: (r: any) => (r.is_reversed ? <span className="badge-neutral">Reversed</span> : <span className="badge-ok">Live</span>) },
                        { key: 'a', header: '', sortable: false, align: 'right', render: (r: any) => (!r.is_reversed && can('payments.update', 'payments.delete') ? (
                          <button className="btn-ghost btn-sm text-danger-600" onClick={() => setToReverse(r)}>Reverse</button>
                        ) : null) },
                      ]} />
                  </section>
                </section>
              )}
            </>
          )}

      {openingOpen && d && <OpeningModal vendorId={vendorId} current={d.openingBalance} name={companyLabel(company) || d.vendor.vendor_name}
        onClose={() => setOpeningOpen(false)} onSaved={() => { setOpeningOpen(false); load(); }} />}
      {adjOpen && d && <AdjustmentModal vendorId={vendorId} name={companyLabel(company) || d.vendor.vendor_name}
        onClose={() => setAdjOpen(false)} onSaved={() => { setAdjOpen(false); load(); }} />}
      {toReverse && (
        <ReasonModal title="Reverse this adjustment?" subtitle={`${humanise(toReverse.kind)} ${inr(toReverse.amount)}`}
          onClose={() => setToReverse(null)}
          onConfirm={async (reason) => {
            try {
              const { data } = await api.post(`/payments/adjustments/${toReverse.id}/reverse`, { reason });
              toast.success('Reversed', data.message); setToReverse(null); load();
            } catch (err) { toast.error('Not reversed', errorMessage(err)); }
          }} />
      )}
    </>
  );
}

function ReasonModal({ title, subtitle, onClose, onConfirm }: { title: string; subtitle: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open size="sm" title={title} subtitle={subtitle} onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose} disabled={busy}>Keep it</button>
        <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); }}>{busy && <Spinner />} Reverse</button></>}>
      <p className="text-sm text-ink-700">It stays on record, marked reversed, and a reversing line appears in the ledger.</p>
      <Field label="Why" required className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

function OpeningModal({ vendorId, current, name, onClose, onSaved }: { vendorId: string; current: any; name: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ asOfDate: current?.as_of_date ?? `${presetRange('fy').from}`, amount: current ? String(current.amount) : '', notes: current?.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put(`/payments/ledger/${vendorId}/opening`, { ...f, amount: Number(f.amount || 0) });
      toast.success('Saved', data.message); onSaved();
    } catch (err) { toast.error('Not saved', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="md" title={`Opening balance — ${name}`} subtitle="What the company owed before the portal's records begin. Positive = they owe us; negative = we hold an advance." onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy || f.amount === '' || !Number.isFinite(Number(f.amount))}>{busy && <Spinner />} Save</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="As of" required><DateField value={f.asOfDate} onChange={(v) => setF({ ...f, asOfDate: v })} clearable={false} /></Field>
        <Field label="Amount" required hint="Use a minus sign for an advance held"><input className="input text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Balance as per Tally on 31-Mar" /></Field>
      </div>
      {current && <p className="mt-3 text-xs text-ink-500">Currently {bal(current.amount)} as of {dmy(current.as_of_date)}. The change is recorded in the audit log.</p>}
    </Modal>
  );
}

function AdjustmentModal({ vendorId, name, onClose, onSaved }: { vendorId: string; name: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ adjDate: todayLocalIso(), amount: '', kind: 'TDS', invoiceId: '', remarks: '' });
  const [invoices, setInvoices] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/payments/open-invoices', { params: { vendorId } }).then((r) => setInvoices(r.data.data ?? [])).catch(() => {}); }, [vendorId]);
  const inv = invoices.find((i) => String(i.id) === f.invoiceId);
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/payments/ledger/${vendorId}/adjustments`, { ...f, amount: Number(f.amount), invoiceId: f.invoiceId ? Number(f.invoiceId) : null });
      toast.success('Recorded', data.message); onSaved();
    } catch (err) { toast.error('Not recorded', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open size="md" title={`Adjustment — ${name}`} subtitle="A positive amount reduces what the company owes. Against an invoice, it also reduces that invoice's balance." onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy || !Number(f.amount) || f.remarks.trim().length < 3}>{busy && <Spinner />} Record adjustment</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kind" required>
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{ADJ_KINDS.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}</select>
        </Field>
        <Field label="Date" required><DateField value={f.adjDate} onChange={(v) => setF({ ...f, adjDate: v })} max={todayLocalIso()} clearable={false} /></Field>
        <Field label="Against invoice" hint="Optional" className="sm:col-span-2">
          <select className="input" value={f.invoiceId} onChange={(e) => setF({ ...f, invoiceId: e.target.value })}>
            <option value="">Not against a specific invoice</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {dmy(i.invoice_date)} · {inr(i.outstanding_amount)} outstanding</option>)}
          </select>
        </Field>
        <Field label="Amount" required hint={inv ? `At most ${inr(inv.outstanding_amount)}` : 'Negative only for a charge that increases what is owed'}>
          <input className="input text-right tabular-nums" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        <Field label="Remarks" required><input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="e.g. TDS u/s 194C, Q2" /></Field>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   Statement import & reconciliation
   ========================================================================== */

type MapKey = 'date' | 'reference' | 'amount' | 'invoiceNo' | 'narration';
const MAP_FIELDS: { key: MapKey; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true }, { key: 'reference', label: 'Reference / UTR' }, { key: 'amount', label: 'Amount (credit)', required: true },
  { key: 'invoiceNo', label: 'Invoice no.' }, { key: 'narration', label: 'Narration' },
];
type Group = 'missingInPortal' | 'mismatched' | 'duplicates' | 'missingInStatement' | 'matched' | 'invalid';

export function Reconcile({ companies, onRecord, refreshKey }: { companies: Company[]; onRecord: (p: ReceiptPrefill) => void; refreshKey: number }) {
  const toast = useToast();
  const { can } = useAuth();
  const [vendorId, setVendorId] = useState('');
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: string[][] } | null>(null);
  const [map, setMap] = useState<Record<MapKey, number>>({ date: -1, reference: -1, amount: -1, invoiceNo: -1, narration: -1 });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [group, setGroup] = useState<Group>('missingInPortal');

  const upload = async (f: File) => {
    setBusy(true); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await api.post('/payments/reconcile/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setFile({ name: data.fileName, headers: data.headers, rows: data.rows });
      setMap(data.mapping);
    } catch (err) { toast.error('Could not read the statement', errorMessage(err)); } finally { setBusy(false); }
  };

  const mappedRows = useMemo(() => (file?.rows ?? []).map((r, i) => {
    const pick = (k: MapKey) => (map[k] >= 0 ? r[map[k]] ?? '' : '');
    return { row: i + 1, date: pick('date'), reference: pick('reference'), amount: pick('amount'), invoiceNo: pick('invoiceNo'), narration: pick('narration') };
  }), [file, map]);

  const compare = useCallback(async (quiet = false) => {
    if (!vendorId || !file) return;
    setBusy(true);
    try {
      const { data } = await api.post('/payments/reconcile/match', { vendorId: Number(vendorId), rows: mappedRows });
      setResult(data);
    } catch (err) { if (!quiet) toast.error('Could not compare', errorMessage(err)); } finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, file, mappedRows]);

  // After a receipt is recorded from a statement line, compare again.
  useEffect(() => { if (result) compare(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [refreshKey]);

  const s = result?.summary;
  const counts: Record<Group, number> = {
    missingInPortal: s?.missingInPortal ?? 0, mismatched: s?.mismatched ?? 0, duplicates: s?.duplicates ?? 0,
    missingInStatement: s?.missingInStatement ?? 0, matched: s?.matched ?? 0, invalid: s?.invalid ?? 0,
  };
  const ready = vendorId && file && map.date >= 0 && map.amount >= 0;

  return (
    <>
      <p className="notice-info text-sm">
        Upload the statement a company sent (or your bank statement filtered to them), say which column is which, and compare it with the receipts recorded for that company.
        Lines match on reference/UTR first, then on the same amount within 3 days. <strong>Nothing is recorded automatically</strong> — record any missing receipt yourself, one by one.
      </p>
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Company" required>
            <select className="input h-9 min-w-[14rem] text-[13px]" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setResult(null); }}>
              <option value="">Choose…</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{companyLabel(c)}</option>)}
            </select>
          </Field>
          <label className="btn-outline btn-sm cursor-pointer">
            <IconUpload className="h-3.5 w-3.5" /> {file ? 'Choose another file' : 'Choose statement (.xlsx / .csv)'}
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          </label>
          {file && <span className="text-sm text-ink-600">{file.name} · {file.rows.length} row(s)</span>}
          {busy && <Spinner />}
        </div>

        {file && (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {MAP_FIELDS.map((m) => (
                <Field key={m.key} label={m.label} required={m.required}>
                  <select className="input h-9 text-[13px]" value={map[m.key]} onChange={(e) => setMap({ ...map, [m.key]: Number(e.target.value) })}>
                    <option value={-1}>{m.required ? 'Choose a column…' : 'Not in the file'}</option>
                    {file.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-ink-200">
              <table className="w-full text-xs">
                <thead className="bg-ink-50 text-left text-ink-500"><tr>{MAP_FIELDS.map((m) => <th key={m.key} className="px-2 py-1.5">{m.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-ink-100">
                  {mappedRows.slice(0, 5).map((r) => <tr key={r.row}>{MAP_FIELDS.map((m) => <td key={m.key} className="px-2 py-1">{String(r[m.key] ?? '')}</td>)}</tr>)}
                </tbody>
              </table>
              <p className="px-2 py-1 text-2xs text-ink-500">First 5 rows as mapped.</p>
            </div>
            <div className="flex justify-end">
              <button className="btn-primary btn-sm" disabled={!ready || busy} onClick={() => compare()}>{busy && <Spinner />} Compare with the portal</button>
            </div>
          </>
        )}
      </section>

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Matched" value={counts.matched} tone="success" sub={inr(s.matchedAmount)} onClick={() => setGroup('matched')} />
            <Kpi label="Amount mismatch" value={counts.mismatched} tone={counts.mismatched ? 'warning' : 'default'} sub="Same reference, different amount" onClick={() => setGroup('mismatched')} />
            <Kpi label="Duplicates in statement" value={counts.duplicates} tone={counts.duplicates ? 'warning' : 'default'} sub="Listed more than once" onClick={() => setGroup('duplicates')} />
            <Kpi label="Not in portal" value={counts.missingInPortal} tone={counts.missingInPortal ? 'danger' : 'default'} sub={inr(s.missingInPortalAmount)} onClick={() => setGroup('missingInPortal')} />
            <Kpi label="Not in statement" value={counts.missingInStatement} tone={counts.missingInStatement ? 'danger' : 'default'} sub={inr(s.missingInStatementAmount)} onClick={() => setGroup('missingInStatement')} />
            <Kpi label="Unreadable rows" value={counts.invalid} sub="Bad date or amount" onClick={() => setGroup('invalid')} />
          </div>
          <p className="text-xs text-ink-500">Period compared: {dmy(result.period.from)} to {dmy(result.period.to)} (statement dates ± 3 days).</p>
          <Segmented size="sm" value={group} onChange={setGroup} options={[
            { value: 'missingInPortal', label: 'In statement, not in portal', count: counts.missingInPortal, alert: true },
            { value: 'mismatched', label: 'Amount mismatch', count: counts.mismatched, alert: true },
            { value: 'duplicates', label: 'Duplicates', count: counts.duplicates, alert: true },
            { value: 'missingInStatement', label: 'In portal, not in statement', count: counts.missingInStatement, alert: true },
            { value: 'matched', label: 'Matched', count: counts.matched },
            { value: 'invalid', label: 'Unreadable', count: counts.invalid },
          ]} />
          <section className="table-wrap">
            {group === 'missingInPortal' && (
              <DataTable rows={result.missingInPortal} rowKey={(r: any) => r.row}
                empty={<EmptyState title="Every statement line is in the portal" />}
                columns={[
                  { key: 'row', header: 'Line', align: 'right' },
                  { key: 'date', header: 'Date', render: (r: any) => dmy(r.date) },
                  { key: 'reference', header: 'Reference', render: (r: any) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
                  { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => <span className="font-semibold">{inr(r.amount)}</span> },
                  { key: 'narration', header: 'Narration', render: (r: any) => <span className="text-xs">{r.narration || '—'}</span> },
                  { key: 'invoiceNo', header: 'Invoice', render: (r: any) => (r.suggestedInvoice ? <span className="cell-code">{r.suggestedInvoice.invoice_number}</span> : r.invoiceNo ? <span className="text-xs text-ink-500">{r.invoiceNo} (not found)</span> : '—') },
                  { key: 'a', header: '', sortable: false, align: 'right', render: (r: any) => (can('payments.create') ? (
                    <button className="btn-outline btn-sm" onClick={() => onRecord({
                      vendorId, amount: r.amount, txnDate: r.date > todayLocalIso() ? todayLocalIso() : r.date, referenceNo: r.reference,
                      remarks: [r.narration, 'From statement'].filter(Boolean).join(' · '), invoiceId: r.suggestedInvoice?.id ?? null, source: 'IMPORT',
                    })}>Record as receipt…</button>
                  ) : null) },
                ]} />
            )}
            {(group === 'matched' || group === 'mismatched') && (
              <DataTable rows={result[group]} rowKey={(r: any) => r.statement.row}
                empty={<EmptyState title={group === 'matched' ? 'Nothing matched' : 'No amount mismatches'} />}
                columns={[
                  { key: 'row', header: 'Line', align: 'right', render: (r: any) => r.statement.row },
                  { key: 'sdate', header: 'Statement date', render: (r: any) => dmy(r.statement.date) },
                  { key: 'sref', header: 'Statement ref', render: (r: any) => <span className="font-mono text-xs">{r.statement.reference || '—'}</span> },
                  { key: 'samt', header: 'Statement amount', align: 'right', render: (r: any) => inr(r.statement.amount) },
                  { key: 'code', header: 'Portal receipt', render: (r: any) => <span className="cell-code">{r.portal.txn_code}</span> },
                  { key: 'pdate', header: 'Portal date', render: (r: any) => dmy(r.portal.txn_date) },
                  { key: 'pamt', header: 'Portal amount', align: 'right', render: (r: any) => inr(r.portal.amount) },
                  { key: 'by', header: group === 'matched' ? 'Matched on' : 'Difference', render: (r: any) => (group === 'matched'
                    ? (r.matchedBy === 'REFERENCE' ? 'Reference' : 'Amount and date')
                    : <span className="font-semibold text-danger-600"><IconWarning className="mr-1 inline h-3.5 w-3.5" />{inr(r.difference)}</span>) },
                ]} />
            )}
            {group === 'duplicates' && (
              <DataTable rows={result.duplicates} rowKey={(r: any) => r.row} empty={<EmptyState title="No duplicates in the statement" />}
                columns={[
                  { key: 'row', header: 'Line', align: 'right' }, { key: 'duplicateOfRow', header: 'Same as line', align: 'right' },
                  { key: 'date', header: 'Date', render: (r: any) => dmy(r.date) },
                  { key: 'reference', header: 'Reference', render: (r: any) => <span className="font-mono text-xs">{r.reference || '—'}</span> },
                  { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => inr(r.amount) },
                  { key: 'narration', header: 'Narration' },
                ]} />
            )}
            {group === 'missingInStatement' && (
              <DataTable rows={result.missingInStatement} rowKey={(r: any) => r.id} empty={<EmptyState title="Every receipt in the period is on the statement" />}
                columns={[
                  { key: 'txn_code', header: 'Receipt', render: (r: any) => <span className="cell-code">{r.txn_code}</span> },
                  { key: 'txn_date', header: 'Date', render: (r: any) => dmy(r.txn_date) },
                  { key: 'reference_no', header: 'Reference', render: (r: any) => <span className="font-mono text-xs">{r.reference_no || '—'}</span> },
                  { key: 'amount', header: 'Amount', align: 'right', render: (r: any) => inr(r.amount) },
                  { key: 'mode', header: 'Method', render: (r: any) => humanise(r.mode) },
                  { key: 'invoices', header: 'Invoices', render: (r: any) => <span className="text-xs">{r.invoices || 'Unallocated'}</span> },
                ]} />
            )}
            {group === 'invalid' && (
              <DataTable rows={result.invalid} rowKey={(r: any) => r.row} empty={<EmptyState title="Every row could be read" />}
                columns={[
                  { key: 'row', header: 'Line', align: 'right' }, { key: 'reason', header: 'Problem' },
                  { key: 'reference', header: 'Reference' }, { key: 'narration', header: 'Narration' },
                ]} />
            )}
          </section>
        </>
      )}
    </>
  );
}
