import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, dmy, todayIso } from '../lib/format';
import { Loading, EmptyState, ErrorState, StatusBadge, Modal, Spinner, StatCard, Field, Tabs } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';

type Tab = 'pending' | 'vendors' | 'outstanding';

export default function Billing() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>('pending');
  const [vendorId, setVendorId] = useState(params.get('vendorId') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');

  const [pending, setPending] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [vendorRows, setVendorRows] = useState<any[]>([]);
  const [vendorTotals, setVendorTotals] = useState<any>(null);
  const [outstanding, setOutstanding] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [genOpen, setGenOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState<any>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [separate, setSeparate] = useState(false);
  const [notes, setNotes] = useState('');

  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'pending') {
        const { data } = await api.get('/billing/pending', { params: { vendorId, from, to, search } });
        setPending(data.data ?? []);
        setSummary(data.summary);
        setSelected(new Set());
      } else if (tab === 'vendors') {
        const { data } = await api.get('/billing/vendor-summary', { params: { from, to } });
        setVendorRows(data.data ?? []);
        setVendorTotals(data.totals);
      } else {
        const { data } = await api.get('/billing/outstanding');
        setOutstanding(data);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, vendorId, from, to, search]);

  useEffect(() => { load(); }, [load]);

  // group pending bookings by vendor — invoices can only cover one vendor
  const grouped = useMemo(() => {
    const map = new Map<number, { vendor: any; rows: any[] }>();
    for (const r of pending) {
      if (!map.has(r.vendor_id)) {
        map.set(r.vendor_id, {
          vendor: {
            id: r.vendor_id, name: r.vendor_name, code: r.vendor_code,
            company: r.company_name, consolidation: !!r.consolidation_allowed,
            templateId: r.invoice_template_id, taxMode: r.tax_mode, taxRate: r.tax_rate,
          },
          rows: [],
        });
      }
      map.get(r.vendor_id)!.rows.push(r);
    }
    return [...map.values()];
  }, [pending]);

  const selectedRows = pending.filter((r) => selected.has(r.id));
  const selectedVendorIds = new Set(selectedRows.map((r) => r.vendor_id));
  const selectedVendor = selectedVendorIds.size === 1
    ? grouped.find((g) => g.vendor.id === [...selectedVendorIds][0])?.vendor
    : null;
  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);

  const toggle = (id: number) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleVendor = (rows: any[]) => setSelected((s) => {
    const ids = rows.map((r) => r.id);
    const allOn = ids.every((i) => s.has(i));
    const n = new Set(s);
    ids.forEach((i) => (allOn ? n.delete(i) : n.add(i)));
    return n;
  });

  const openGenerate = () => {
    if (!selectedVendor) {
      toast.warning('Select bookings from one vendor',
        'An invoice can only cover a single vendor. Clear the selection and pick bookings from one vendor at a time.');
      return;
    }
    setSeparate(!selectedVendor.consolidation && selectedRows.length > 1);
    setGenResult(null);
    setNotes('');
    setInvoiceDate(todayIso());
    setGenOpen(true);
  };

  const generate = async () => {
    if (!selectedVendor) return;
    setGenBusy(true);
    try {
      const { data } = await api.post('/invoices/generate', {
        vendorId: selectedVendor.id,
        bookingIds: [...selected],
        invoiceDate,
        notes,
        separateInvoices: separate,
      });
      setGenResult(data);
      toast.success(data.message, data.warnings?.length ? data.warnings.join('\n') : undefined);
      load();
    } catch (err) {
      toast.error('Invoice could not be generated', errorMessage(err));
    } finally {
      setGenBusy(false);
    }
  };

  const TABS: { key: Tab; label: string; count?: number }[] = [
    { key: 'pending', label: 'Pending Billing', count: summary?.count },
    { key: 'vendors', label: 'Vendor-wise Billing' },
    { key: 'outstanding', label: 'Outstanding & Ageing', count: outstanding?.data?.length },
  ];

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Billing</h1>
          <p className="page-sub">
            Select bookings, generate the vendor's invoice in their own format, and track what is still owed.
          </p>
        </div>
        <Link to="/admin/invoices" className="btn-outline btn-sm">View all invoices →</Link>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {/* ------------------------------ PENDING ------------------------------ */}
      {tab === 'pending' && (
        <>
          {summary && (
            <div className="stagger grid gap-4 sm:grid-cols-3">
              <StatCard label="Bookings awaiting invoice" value={summary.count} tone="warning" />
              <StatCard label="Value awaiting invoice" value={inr(summary.amount)} tone="brand" />
              <StatCard label="Vendors involved" value={grouped.length} />
            </div>
          )}

          <div className="filters animate-fade-up">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="label">Vendor</label>
                <select className="input" value={vendorId} onChange={(e) => { setVendorId(e.target.value); setParams(e.target.value ? { vendorId: e.target.value } : {}); }}>
                  <option value="">All vendors</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Travel from</label>
                <DateField value={from} onChange={setFrom} placeholder="Any" />
              </div>
              <div>
                <label className="label">Travel to</label>
                <DateField value={to} onChange={setTo} placeholder="Any" />
              </div>
              <div>
                <label className="label">Search</label>
                <input className="input" placeholder="Booking, passenger, vendor ref…"
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
          </div>

          {selected.size > 0 && (
            <div className="below-header sticky z-20 flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-card">
              <div className="mr-auto">
                <p className="text-sm font-semibold text-brand-900">
                  {selected.size} booking{selected.size === 1 ? '' : 's'} selected · {inr(selectedTotal)}
                </p>
                <p className="text-xs text-brand-700">
                  {selectedVendor
                    ? `${selectedVendor.name} · ${selectedVendor.consolidation ? 'consolidation allowed' : 'one invoice per booking'}`
                    : `${selectedVendorIds.size} different vendors selected — narrow it to one`}
                </p>
              </div>
              <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear</button>
              {can('invoices.create') && (
                <button onClick={openGenerate} className="btn-primary btn-sm" disabled={!selectedVendor}>
                  🧾 Generate Invoice
                </button>
              )}
            </div>
          )}

          {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : grouped.length === 0 ? (
            <div className="card">
              <EmptyState title="Nothing pending"
                body="Every completed booking has been invoiced. New bookings appear here as soon as they are saved with an amount."
                action={<Link to="/admin/bookings/new" className="btn-primary btn-sm">+ New Booking</Link>} />
            </div>
          ) : (
            <div className="page">
              {grouped.map(({ vendor, rows }) => {
                const vTotal = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
                const allOn = rows.every((r) => selected.has(r.id));
                return (
                  <div key={vendor.id} className="table-wrap table-scroll">
                    <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
                      <input type="checkbox" className="check"
                        checked={allOn} onChange={() => toggleVendor(rows)} />
                      <div className="mr-auto min-w-0">
                        <p className="truncate font-semibold text-ink-900">{vendor.name}</p>
                        <p className="text-xs text-ink-500">
                          {vendor.company} · {rows.length} booking{rows.length === 1 ? '' : 's'} ·{' '}
                          {vendor.taxMode === 'NONE' ? 'no tax' : `${vendor.taxMode.replace('_', '+')} ${vendor.taxRate}%`}
                        </p>
                      </div>
                      {!vendor.templateId && (
                        <span className="badge-warn" title="A standard PDF will be used instead">
                          No template assigned
                        </span>
                      )}
                      <span className="badge-neutral">
                        {vendor.consolidation ? 'Consolidation allowed' : 'One invoice per booking'}
                      </span>
                      <p className="font-bold tabular-nums text-ink-900">{inr(vTotal)}</p>
                    </div>

                    <table className="tbl">
                      <thead>
                        <tr>
                          <th className="w-10"></th>
                          <th>Booking</th>
                          <th>Travel</th>
                          <th>Passenger</th>
                          <th>Route</th>
                          <th>Vehicle</th>
                          <th className="text-right">Taxable</th>
                          <th className="text-right">Tax</th>
                          <th className="text-right">Toll/Parking</th>
                          <th className="text-right">Total</th>
                          <th>Status</th>
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
                              <Link to={`/admin/bookings/${r.id}/edit`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                                {r.booking_code}
                              </Link>
                            </td>
                            <td className="whitespace-nowrap text-sm text-ink-700">{dmy(r.travel_date)}</td>
                            <td className="max-w-[10rem] truncate text-sm text-ink-800">{r.passenger_name}</td>
                            <td className="max-w-[16rem] truncate text-xs text-ink-600" title={`${r.pickup_location} → ${r.drop_location}`}>
                              {r.pickup_location}{r.drop_location ? ` → ${r.drop_location}` : ''}
                            </td>
                            <td className="whitespace-nowrap text-xs text-ink-600">{r.vehicle_number || r.vehicle_type || '—'}</td>
                            <td className="text-right tabular-nums text-ink-700">{inr(r.taxable_amount)}</td>
                            <td className="text-right tabular-nums text-ink-700">{inr(r.tax_amount)}</td>
                            <td className="text-right tabular-nums text-ink-700">{inr(r.non_taxable_amount)}</td>
                            <td className="text-right font-semibold tabular-nums text-ink-900">{inr(r.total_amount)}</td>
                            <td><StatusBadge value={r.billing_status} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* --------------------------- VENDOR SUMMARY -------------------------- */}
      {tab === 'vendors' && (
        <>
          <div className="filters animate-fade-up">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">From</label>
                <DateField value={from} onChange={setFrom} placeholder="Any" />
              </div>
              <div>
                <label className="label">To</label>
                <DateField value={to} onChange={setTo} placeholder="Any" />
              </div>
              <div className="flex items-end">
                <button className="btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); }}>Clear dates</button>
              </div>
            </div>
          </div>

          {vendorTotals && (
            <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Bookings" value={vendorTotals.bookings} />
              <StatCard label="Pending billing" value={inr(vendorTotals.pending)} tone="warning" />
              <StatCard label="Invoiced" value={inr(vendorTotals.invoiced)} tone="brand" />
              <StatCard label="Paid" value={inr(vendorTotals.paid)} tone="success" />
              <StatCard label="Outstanding" value={inr(vendorTotals.outstanding)} tone="danger" />
            </div>
          )}

          {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
            <div className="table-wrap table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Template</th>
                    <th>Cycle</th>
                    <th className="text-right">Bookings</th>
                    <th className="text-right">Pending</th>
                    <th className="text-right">Total billing</th>
                    <th className="text-right">Invoiced</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {vendorRows.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <p className="font-medium text-ink-900">{v.vendor_name}</p>
                        <p className="text-[11px] text-ink-400">{v.code} · {v.company_name}</p>
                      </td>
                      <td className="max-w-[12rem] truncate text-xs text-ink-600">
                        {v.template_name ?? <span className="text-warn-600">Not assigned</span>}
                      </td>
                      <td className="text-xs text-ink-600">{v.billing_cycle?.replace('_', ' ')}</td>
                      <td className="text-right tabular-nums text-ink-700">{v.total_bookings}</td>
                      <td className="text-right tabular-nums">
                        {Number(v.pending_amount) > 0 ? (
                          <button onClick={() => { setTab('pending'); setVendorId(String(v.id)); }}
                            className="font-semibold text-warn-600 hover:underline">
                            {inr(v.pending_amount)}
                          </button>
                        ) : <span className="text-ink-400">—</span>}
                      </td>
                      <td className="text-right tabular-nums text-ink-700">{inr(v.total_billing)}</td>
                      <td className="text-right tabular-nums text-ink-800">{inr(v.total_invoiced)}</td>
                      <td className="text-right tabular-nums text-ok-600">{inr(v.total_paid)}</td>
                      <td className={`text-right font-semibold tabular-nums ${Number(v.outstanding) > 0 ? 'text-danger-600' : 'text-ink-400'}`}>
                        {inr(v.outstanding)}
                      </td>
                      <td className="text-right">
                        <Link to={`/admin/invoices?vendorId=${v.id}`} className="btn-ghost btn-sm">View →</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ---------------------------- OUTSTANDING ---------------------------- */}
      {tab === 'outstanding' && (
        loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : outstanding && (
          <>
            <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Total outstanding" value={inr(outstanding.total)} tone="danger" />
              {outstanding.buckets.map((b: any) => (
                <StatCard key={b.bucket} label={`${b.bucket} days`} value={inr(b.amount)}
                  sub={`${b.count} invoice${b.count === 1 ? '' : 's'}`}
                  tone={b.bucket === '90+' ? 'danger' : b.bucket === '61-90' ? 'warning' : 'default'} />
              ))}
            </div>

            {outstanding.data.length === 0 ? (
              <div className="card">
                <EmptyState title="Nothing outstanding" body="Every invoice raised has been fully paid." />
              </div>
            ) : (
              <div className="table-wrap table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Invoice</th><th>Vendor</th><th>Date</th><th>Due</th>
                      <th className="text-right">Total</th><th className="text-right">Paid</th>
                      <th className="text-right">Outstanding</th><th>Age</th><th>Status</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {outstanding.data.map((i: any) => (
                      <tr key={i.id}>
                        <td>
                          <Link to={`/admin/invoices/${i.id}`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                            {i.invoice_number}
                          </Link>
                        </td>
                        <td className="text-sm text-ink-800">{i.vendor_name}</td>
                        <td className="whitespace-nowrap text-sm text-ink-600">{dmy(i.invoice_date)}</td>
                        <td className="whitespace-nowrap text-sm text-ink-600">{dmy(i.due_date)}</td>
                        <td className="text-right tabular-nums text-ink-700">{inr(i.total_amount)}</td>
                        <td className="text-right tabular-nums text-ok-600">{inr(i.paid_amount)}</td>
                        <td className="text-right font-semibold tabular-nums text-danger-600">{inr(i.outstanding_amount)}</td>
                        <td>
                          <span className={`badge ${
                            i.bucket === '90+' ? 'bg-danger-100 text-danger-600'
                            : i.bucket === '61-90' ? 'bg-warn-100 text-warn-600'
                            : i.bucket === '31-60' ? 'bg-warn-100 text-warn-600'
                            : 'bg-ink-100 text-ink-600'}`}>
                            {i.age_days}d
                          </span>
                        </td>
                        <td><StatusBadge value={i.status} /></td>
                        <td className="text-right">
                          <Link to={`/admin/invoices/${i.id}`} className="btn-ghost btn-sm">Open →</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      )}

      {/* ------------------------- GENERATE MODAL --------------------------- */}
      <Modal
        open={genOpen}
        onClose={() => { setGenOpen(false); setGenResult(null); }}
        title={genResult ? 'Invoice generated' : 'Generate invoice'}
        subtitle={genResult ? undefined : selectedVendor
          ? `${selectedVendor.name} · ${selected.size} booking${selected.size === 1 ? '' : 's'} · ${inr(selectedTotal)}`
          : undefined}
        size="md"
        footer={
          genResult ? (
            <>
              <button className="btn-outline" onClick={() => { setGenOpen(false); setGenResult(null); }}>Close</button>
              <button className="btn-primary" onClick={() => navigate('/admin/invoices')}>Go to invoices</button>
            </>
          ) : (
            <>
              <button className="btn-outline" onClick={() => setGenOpen(false)} disabled={genBusy}>Cancel</button>
              <button className="btn-primary" onClick={generate} disabled={genBusy}>
                {genBusy && <Spinner className="h-4 w-4" />}
                {genBusy ? 'Generating…' : 'Generate invoice'}
              </button>
            </>
          )
        }
      >
        {genResult ? (
          <div className="space-y-4">
            <div className="notice-ok">
              <p className="font-semibold">{genResult.message}</p>
            </div>

            {genResult.warnings?.length > 0 && (
              <ul className="space-y-1.5 rounded-lg border border-warn-100 bg-warn-50 p-3.5 text-xs text-warn-600">
                {genResult.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            )}

            <div className="space-y-2">
              {genResult.invoices.map((inv: any) => (
                <div key={inv.invoiceId} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 p-3.5">
                  <div className="mr-auto min-w-0">
                    <p className="font-mono text-sm font-semibold text-brand-700">{inv.invoiceNumber}</p>
                    <p className="text-xs text-ink-500">{inr(inv.total)} · {inv.fileType.toUpperCase()}</p>
                  </div>
                  <Link to={`/admin/invoices/${inv.invoiceId}`} className="btn-outline btn-sm">Preview</Link>
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => downloadFile(`/invoices/${inv.invoiceId}/download`)
                      .catch((e) => toast.error('Download failed', errorMessage(e)))}
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedVendor && !selectedVendor.templateId && (
              <div className="rounded-lg border border-warn-100 bg-warn-50 p-3.5 text-sm text-warn-600">
                <strong>{selectedVendor.name} has no invoice template assigned.</strong> The portal's standard PDF layout
                will be used. To match this vendor's own format, assign a template under{' '}
                <Link to="/admin/settings/templates" className="underline">Settings → Invoice Templates</Link>.
              </div>
            )}

            <div className="stagger grid gap-4 sm:grid-cols-2">
              <Field label="Invoice date">
                <DateField value={invoiceDate} onChange={setInvoiceDate} />
              </Field>
              <Field label="Bookings selected">
                <input className="input" value={`${selected.size} · ${inr(selectedTotal)}`} readOnly disabled />
              </Field>
            </div>

            {selected.size > 1 && (
              <label className={`option ${separate ? 'option-on' : ''}`}>
                <input type="checkbox" className="check mt-0.5"
                  checked={separate} onChange={(e) => setSeparate(e.target.checked)}
                  disabled={!selectedVendor?.consolidation} />
                <span className="text-sm">
                  <span className="font-semibold text-ink-900">Separate invoice per booking</span>
                  <span className="mt-0.5 block text-xs text-ink-600">
                    {selectedVendor?.consolidation
                      ? `Leave unticked to raise one consolidated invoice covering all ${selected.size} bookings.`
                      : `${selectedVendor?.name} is not configured for consolidated invoices, so ${selected.size} separate invoices will be raised.`}
                  </span>
                </span>
              </label>
            )}

            <Field label="Notes on the invoice">
              <textarea className="input min-h-[70px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — appears on the invoice record" />
            </Field>

            <p className="rounded-lg bg-ink-50 p-3.5 text-xs leading-relaxed text-ink-600">
              The system picks the vendor's template, allocates the next invoice number, fills the mapped fields,
              saves the file under <span className="font-mono">data/invoices</span>, links the bookings and marks them
              Invoiced. The vendor's original template file is never modified.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
