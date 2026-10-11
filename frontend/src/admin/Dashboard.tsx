/**
 * Dashboard — the business at a glance, for a chosen period.
 *
 * Every figure comes from GET /api/dashboard/overview, which counts each one
 * the way its own module does, so a tile's number is the number of rows the
 * tile opens. "Period" figures follow the date range; backlog figures (what is
 * waiting, what is owed) are always as of now.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import { inr, inrShort, dmy, dmyTime, monthLabel } from '../lib/format';
import { useCountUp } from '../lib/animate';
import { useAuth } from '../lib/auth';
import { ErrorState, StatusBadge, EmptyState } from '../components/ui';
import { DateRange, Kpi, presetRange, DataTable } from '../components/data';
import {
  IconInbox, IconRoute, IconCheck, IconClose, IconInvoices, IconPayments, IconRupee, IconWarning,
  IconBilling, IconCar, IconIdCard, IconVendors, IconSparkle, IconArrowRight, IconPlus, IconReports,
  IconCalendar,
} from '../components/icons';

const C = {
  invoiced: '#2A5698', collected: '#12996A', outstanding: '#C1810E', trips: '#3465AD',
  cancelled: '#DC3A2B', grid: '#E3E8EF', axis: '#7A8CA0', converted: '#12996A', received: '#9DB7DD',
};
const TOOLTIP = {
  contentStyle: { borderRadius: 10, border: '1px solid #E3E8EF', fontSize: 12, padding: '8px 10px', boxShadow: '0 8px 28px -14px rgba(16,28,43,.32)' },
  labelStyle: { color: '#46586C', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'rgba(52,101,173,.06)' },
};
const AXIS = { tick: { fontSize: 11, fill: C.axis }, axisLine: false, tickLine: false } as const;

const SOURCE_LABEL: Record<string, string> = {
  EMAIL: 'Email', WHATSAPP: 'WhatsApp', PORTAL: 'Portal', WALKIN: 'Walk-in / phone', VENDOR: 'Vendor',
};
const PHASE_TONE: Record<string, string> = {
  Enquiry: 'border-warn-100 bg-warn-50/60', Booking: 'border-brand-100 bg-brand-50/60',
  Billing: 'border-ok-100 bg-ok-50/50', Closed: 'border-ink-200 bg-ink-50',
};

function Count({ value, money }: { value: number; money?: boolean }) {
  const v = useCountUp(Number(value) || 0);
  return <>{money ? inrShort(v) : Math.round(v).toLocaleString('en-IN')}</>;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const [range, setRange] = useState(() => presetRange('month'));
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/dashboard/overview', { params: { ...range, vendorId: vendorId || undefined } });
      setD(data);
    } catch (err) {
      setError(errorMessage(err, 'The dashboard could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [range, vendorId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const trend = useMemo(() => (d?.trend ?? []).map((t: any) => ({ ...t, label: monthLabel(t.month) })), [d]);
  const conversion = useMemo(() => (d?.conversion ?? []).map((c: any) => ({ ...c, label: SOURCE_LABEL[c.source] ?? c.source })), [d]);
  const phases = useMemo(() => {
    const out: Record<string, any[]> = {};
    for (const s of d?.stages ?? []) (out[s.phase] ??= []).push(s);
    return out;
  }, [d]);

  if (error && !d) return <ErrorState message={error} onRetry={load} />;

  const t = d?.totals ?? {};
  const n = d?.now ?? {};
  const go = (to: string) => () => navigate(to);
  const rq = `from=${range.from}&to=${range.to}`;

  return (
    <div className="page">
      {/* --------------------------------------------------------- header */}
      <header className="page-head animate-fade-down">
        <div className="min-w-0">
          <p className="eyebrow">{today}</p>
          <h1 className="page-title mt-1">{greeting}, {user?.fullName?.split(' ')[0]}</h1>
          <p className="page-sub">
            {d
              ? `${n.new_enquiries} new enquir${n.new_enquiries === 1 ? 'y' : 'ies'} waiting · ${n.awaiting_assignment} trip(s) need a vehicle · ${inr(n.outstanding)} outstanding.`
              : 'Loading the latest figures…'}
          </p>
        </div>
        <div className="page-actions">
          {can('bookings.create') && <button className="btn-primary btn-sm" onClick={go('/admin/trips?new=1')}><IconPlus className="h-3.5 w-3.5" /> New trip</button>}
          {can('bookings.view') && <button className="btn-outline btn-sm" onClick={go('/admin/trips')}><IconRoute className="h-3.5 w-3.5" /> Manage trips</button>}
          {can('billing.view') && <button className="btn-outline btn-sm" onClick={go('/admin/billing')}><IconBilling className="h-3.5 w-3.5" /> Generate invoices</button>}
          {can('payments.create') && <button className="btn-outline btn-sm" onClick={go('/admin/payments?new=1')}><IconPayments className="h-3.5 w-3.5" /> Record payment</button>}
          {can('reports.view') && <button className="btn-outline btn-sm" onClick={go(`/admin/reports?report=monthly-summary&${rq}`)}><IconReports className="h-3.5 w-3.5" /> Reports</button>}
        </div>
      </header>

      {/* ---------------------------------------------------------- filters */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <DateRange from={range.from} to={range.to} onChange={setRange} allowAll={false} label="Period" />
        <select className="input h-9 w-auto text-[13px]" value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Vendor">
          <option value="">All vendors &amp; customers</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
        </select>
        {loading && <span className="text-xs text-ink-400">Updating…</span>}
        <p className="ml-auto text-xs text-ink-400">Period figures follow the dates; backlog figures are as of now.</p>
      </div>

      {/* ---------------------------------------------------------- insights */}
      {d?.insights?.length > 0 && (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {d.insights.map((x: any) => (
            <Link key={x.title} to={x.link}
              className={`card card-hover flex items-start gap-3 p-4 ${x.tone === 'danger' ? 'border-danger-100' : x.tone === 'warn' ? 'border-warn-100' : ''}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                x.tone === 'danger' ? 'bg-danger-50 text-danger-600' : x.tone === 'warn' ? 'bg-warn-50 text-warn-600' : 'bg-brand-50 text-brand-600'}`}>
                {x.tone === 'info' ? <IconSparkle className="h-4 w-4" /> : <IconWarning className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-900">{x.title}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{x.body}</span>
              </span>
              <IconArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-300" />
            </Link>
          ))}
        </section>
      )}

      {d && (
        <>
          {/* ------------------------------------------------- operations KPIs */}
          <section>
            <p className="eyebrow mb-2.5">Operations · this period</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <Kpi label="Enquiries received" value={<Count value={t.enquiries} />} tone="warning" icon={<IconInbox className="h-4 w-4" />}
                sub={`${t.enquiries_converted} converted · ${t.conversion_rate}%`} onClick={go(`/admin/trips?createdFrom=${range.from}&createdTo=${range.to}`)} />
              <Kpi label="Trips" value={<Count value={t.trips} />} tone="brand" icon={<IconRoute className="h-4 w-4" />}
                sub={`Travel dates in the period`} onClick={go(`/admin/trips?from=${range.from}&to=${range.to}`)} />
              <Kpi label="Confirmed (open)" value={<Count value={t.confirmed} />} tone="violet" icon={<IconCalendar className="h-4 w-4" />}
                sub="Confirmed, allotted or on trip" onClick={go(`/admin/trips?stage=CONFIRMED_ALL&from=${range.from}&to=${range.to}`)} />
              <Kpi label="Completed" value={<Count value={t.completed} />} tone="success" icon={<IconCheck className="h-4 w-4" />}
                sub={`Trip value ${inrShort(t.trip_value)}`} onClick={go(`/admin/trips?status=COMPLETED&from=${range.from}&to=${range.to}`)} />
              <Kpi label="Cancelled" value={<Count value={t.cancelled} />} tone="danger" icon={<IconClose className="h-4 w-4" />}
                sub="Cancelled or no-show" onClick={go(`/admin/trips?stage=CANCELLED&from=${range.from}&to=${range.to}`)} />
              <Kpi label="Need a vehicle" value={<Count value={n.awaiting_assignment} />} tone={n.awaiting_assignment ? 'warning' : 'default'} icon={<IconCar className="h-4 w-4" />}
                sub={n.unallotted_soon ? `${n.unallotted_soon} travel today or tomorrow` : 'Confirmed, not allotted (now)'} onClick={go('/admin/trips?stage=AWAITING_ASSIGNMENT&sort=travel_asc')} />
            </div>
          </section>

          {/* ------------------------------------------------------ money KPIs */}
          <section>
            <p className="eyebrow mb-2.5">Money</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <Kpi label="Invoiced" value={<Count value={t.invoiced} money />} tone="brand" icon={<IconInvoices className="h-4 w-4" />}
                sub={`${t.invoices} invoice(s) in the period`} footnote={inr(t.invoiced)} onClick={go(`/admin/invoices?from=${range.from}&to=${range.to}`)} />
              <Kpi label="Received" value={<Count value={t.received} money />} tone="success" icon={<IconRupee className="h-4 w-4" />}
                sub={`${t.receipts} payment(s) in the period`} footnote={inr(t.received)} onClick={go(`/admin/payments?from=${range.from}&to=${range.to}`)} />
              <Kpi label="Outstanding" value={<Count value={n.outstanding} money />} tone="warning" icon={<IconPayments className="h-4 w-4" />}
                sub={`${n.unpaid_invoices} unpaid invoice(s), now`} footnote={inr(n.outstanding)} onClick={go('/admin/invoices?status=UNPAID')} />
              <Kpi label="Overdue" value={<Count value={n.overdue} money />} tone={n.overdue ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />}
                sub={`${n.overdue_invoices} past the due date`} footnote={inr(n.overdue)} onClick={go('/admin/invoices?status=OVERDUE')} />
              <Kpi label="Ready to bill" value={<Count value={n.billing_queue} />} tone="teal" icon={<IconBilling className="h-4 w-4" />}
                sub={`${inrShort(n.billing_queue_amount)} in the billing queue`} onClick={go('/admin/billing')} />
              <Kpi label="Fleet available" value={`${n.available_vehicles}/${n.active_vehicles}`} tone="violet" icon={<IconIdCard className="h-4 w-4" />}
                sub={`${n.available_drivers}/${n.active_drivers} drivers · ${n.active_vendors} vendors`} onClick={go('/admin/fleet?tab=availability')} />
            </div>
          </section>

          {/* ------------------------------------------------- workflow backlog */}
          <section>
            <p className="eyebrow mb-2.5">Waiting on the office · now</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <Kpi label="Pending allocation" value={<Count value={n.awaiting_assignment} />} tone={n.awaiting_assignment ? 'warning' : 'default'} icon={<IconCar className="h-4 w-4" />}
                sub="Confirmed, no vehicle / driver" onClick={go('/admin/trips?stage=AWAITING_ASSIGNMENT&sort=travel_asc')} />
              <Kpi label="Pending completion" value={<Count value={n.awaiting_completion ?? 0} />} tone={n.awaiting_completion ? 'warning' : 'default'} icon={<IconCheck className="h-4 w-4" />}
                sub="Travel day over, not completed" onClick={go(`/admin/trips?stage=CONFIRMED_ALL&to=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}&sort=travel_asc`)} />
              <Kpi label="Pending billing" value={<Count value={n.awaiting_billing ?? 0} />} tone={n.awaiting_billing ? 'warning' : 'default'} icon={<IconBilling className="h-4 w-4" />}
                sub="Completed, billing not confirmed" onClick={go('/admin/trips?stage=AWAITING_BILLING')} />
              <Kpi label="Pending invoice" value={<Count value={n.awaiting_invoice ?? 0} />} tone="teal" icon={<IconInvoices className="h-4 w-4" />}
                sub="Billing confirmed, no invoice" onClick={go('/admin/trips?stage=AWAITING_INVOICE')} />
              <Kpi label="Unallocated receipts" value={<Count value={n.unallocated_receipts ?? 0} money />} tone={n.unallocated_receipts ? 'violet' : 'default'} icon={<IconRupee className="h-4 w-4" />}
                sub="Received, not set against invoices" footnote={inr(n.unallocated_receipts ?? 0)} onClick={go('/admin/payments?tab=unallocated')} />
              <Kpi label="Open events" value={<Count value={n.open_events ?? 0} />} tone="brand" icon={<IconCalendar className="h-4 w-4" />}
                sub="Planned, confirmed or running" onClick={go('/admin/events')} />
            </div>
          </section>

          {/* -------------------------------------------------- trip pipeline */}
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="card-title">Trip pipeline</h2>
                <p className="card-sub">Every open trip, by the stage it is in now. Click a stage to work its list.</p>
              </div>
              <Link to="/admin/trips" className="text-sm font-semibold text-brand-700 hover:underline">Open Trips →</Link>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              {['Enquiry', 'Booking', 'Billing', 'Closed'].map((ph) => (
                <div key={ph} className={`rounded-xl border p-2.5 ${PHASE_TONE[ph]}`}>
                  <p className="px-1.5 pb-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-ink-500">{ph}</p>
                  <div className="space-y-1">
                    {(phases[ph] ?? []).map((s: any) => (
                      <Link key={s.key} to={`/admin/trips?stage=${s.key}`}
                        className={`flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-sm shadow-xs transition hover:bg-white ${s.count ? '' : 'opacity-60'}`}>
                        <span className="truncate text-ink-700">{s.label}</span>
                        <span className="ml-2 font-display text-base font-bold tabular-nums text-ink-900">{s.count}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* --------------------------------------------------------- charts */}
          <div className="grid gap-4 xl:grid-cols-3">
            <section className="card p-4 xl:col-span-2">
              <h2 className="card-title">Revenue, collections and outstanding</h2>
              <p className="card-sub">Last 12 months · invoiced and collected per month, and what was owed at each month end.</p>
              <div className="mt-3 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke={C.grid} />
                    <XAxis dataKey="label" {...AXIS} />
                    <YAxis {...AXIS} tickFormatter={(v) => inrShort(v)} width={56} />
                    <Tooltip {...TOOLTIP} formatter={(v: any, name: any) => [inr(v), name]} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="invoiced" name="Invoiced" fill={C.invoiced} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Bar dataKey="collected" name="Collected" fill={C.collected} radius={[4, 4, 0, 0]} maxBarSize={22} />
                    <Line type="linear" dataKey="outstanding" name="Outstanding at month end" stroke={C.outstanding} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="card p-4">
              <h2 className="card-title">Enquiry conversion by channel</h2>
              <p className="card-sub">Enquiries received in the period, and how many became bookings.</p>
              {conversion.length === 0 ? (
                <EmptyState title="No enquiries in this period" />
              ) : (
                <div className="mt-3 h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={conversion} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke={C.grid} />
                      <XAxis type="number" {...AXIS} allowDecimals={false} />
                      <YAxis type="category" dataKey="label" {...AXIS} width={96} />
                      <Tooltip {...TOOLTIP} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="received" name="Received" fill={C.received} radius={[0, 4, 4, 0]} maxBarSize={16} />
                      <Bar dataKey="converted" name="Converted" fill={C.converted} radius={[0, 4, 4, 0]} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>

          <section className="card p-4">
            <h2 className="card-title">Trips per month</h2>
            <p className="card-sub">Trips run (by travel date) and cancellations, last 12 months.</p>
            <div className="mt-3 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="label" {...AXIS} />
                  <YAxis {...AXIS} allowDecimals={false} width={36} />
                  <Tooltip {...TOOLTIP} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="trips" name="Trips" stackId="t" fill={C.trips} maxBarSize={26} />
                  <Bar dataKey="cancelled" name="Cancelled" stackId="t" fill={C.cancelled} radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ------------------------------------------------ today & upcoming */}
          <div className="grid gap-4 xl:grid-cols-2">
            <TripList title="Today's trips" empty="No trips today." rows={d.todaysTrips} link="/admin/trips?stage=CONFIRMED_ALL&sort=travel_asc" />
            <TripList title="Next 7 days" empty="Nothing booked for the coming week." rows={d.upcoming} link="/admin/trips?stage=CONFIRMED_ALL&sort=travel_asc" showDate />
          </div>

          {/* -------------------------------------------------- vendor money */}
          <section className="table-wrap">
            <div className="card-head">
              <div>
                <h2 className="card-title">Vendor-wise summary</h2>
                <p className="card-sub">Receivables only. Trips and invoiced/received follow the period; unbilled and outstanding are as of now.</p>
              </div>
              <Link to={`/admin/reports?report=vendor-billing&${rq}`} className="text-sm font-semibold text-brand-700 hover:underline">Vendor reports →</Link>
            </div>
            <DataTable
              rows={d.vendors} rowKey={(r: any) => r.id}
              onRowClick={(r: any) => navigate(`/admin/invoices?vendorId=${r.id}`)}
              empty={<EmptyState title="No vendor activity" icon={<IconVendors className="h-5 w-5" />} />}
              columns={[
                { key: 'vendor_name', header: 'Vendor', render: (r: any) => <span className="font-medium text-ink-900">{r.code === 'DIRECT' ? 'Walk-in customers' : r.vendor_name}</span> },
                { key: 'trips', header: 'Trips', align: 'right' },
                { key: 'unbilled', header: 'Unbilled', align: 'right', render: (r: any) => inr(r.unbilled) },
                { key: 'invoiced', header: 'Invoiced', align: 'right', render: (r: any) => inr(r.invoiced) },
                { key: 'received', header: 'Received', align: 'right', render: (r: any) => <span className="text-ok-700">{inr(r.received)}</span> },
                { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r: any) => <span className="font-semibold text-ink-900">{inr(r.outstanding)}</span> },
                { key: 'overdue', header: 'Overdue', align: 'right', render: (r: any) => r.overdue > 0 ? <span className="font-semibold text-danger-600">{inr(r.overdue)}</span> : '—' },
              ]}
            />
          </section>

          {/* ---------------------------------------------- recent activity */}
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Latest enquiries</h2>
                <Link to="/admin/trips?stage=NEW" className="text-sm font-semibold text-brand-700 hover:underline">All new →</Link>
              </div>
              <ul className="divide-y divide-ink-100">
                {d.recentEnquiries.length === 0 && <li className="px-5 py-6 text-sm text-ink-500">No enquiries yet.</li>}
                {d.recentEnquiries.map((e: any) => (
                  <li key={e.id}>
                    <Link to={`/admin/trips?open=${e.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-ink-50">
                      <span className="cell-code w-36 shrink-0">{e.trip_id}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-800">{e.customer}</span>
                        <span className="block truncate text-xs text-ink-500">{SOURCE_LABEL[e.inquiry_source]} · {[e.pickup_location, e.drop_location].filter(Boolean).join(' → ')}</span>
                      </span>
                      <span className="hidden shrink-0 text-xs text-ink-400 sm:block">{dmyTime(e.created_at)}</span>
                      <StatusBadge value={e.booking_status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">Latest invoices</h2>
                <Link to="/admin/invoices" className="text-sm font-semibold text-brand-700 hover:underline">All invoices →</Link>
              </div>
              <ul className="divide-y divide-ink-100">
                {d.recentInvoices.length === 0 && <li className="px-5 py-6 text-sm text-ink-500">No invoices yet.</li>}
                {d.recentInvoices.map((i: any) => {
                  const overdue = i.status !== 'PAID' && i.status !== 'CANCELLED' && i.outstanding_amount > 0 && i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
                  return (
                    <li key={i.id}>
                      <Link to={`/admin/invoices/${i.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-ink-50">
                        <span className="cell-code w-36 shrink-0">{i.invoice_number}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{i.billed_to}</span>
                        <span className="shrink-0 text-xs text-ink-400">{dmy(i.invoice_date)}</span>
                        <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-ink-900">{inr(i.total_amount)}</span>
                        <StatusBadge value={overdue ? 'OVERDUE' : i.status} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>

        </>
      )}
    </div>
  );
}

function TripList({ title, rows, empty, link, showDate }: { title: string; rows: any[]; empty: string; link: string; showDate?: boolean }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">{title} <span className="ml-1 text-sm font-normal text-ink-400">{rows.length}</span></h2>
        <Link to={link} className="text-sm font-semibold text-brand-700 hover:underline">Open →</Link>
      </div>
      <ul className="divide-y divide-ink-100">
        {rows.length === 0 && <li className="px-5 py-6 text-sm text-ink-500">{empty}</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <Link to={`/admin/trips?open=${r.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-ink-50">
              <span className="w-16 shrink-0 text-center">
                <span className="block font-display text-sm font-bold tabular-nums text-ink-900">{r.reporting_time || '—'}</span>
                {showDate && <span className="block text-2xs text-ink-500">{dmy(r.travel_date)}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-800">{r.customer} <span className="text-ink-400">· {r.trip_id}</span></span>
                <span className="block truncate text-xs text-ink-500">{[r.pickup_location, r.drop_location].filter(Boolean).join(' → ')}</span>
              </span>
              <span className="hidden min-w-[7rem] shrink-0 text-right text-xs sm:block">
                {r.vehicle_number
                  ? <><span className="block font-mono text-ink-700">{r.vehicle_number}</span><span className="block text-ink-400">{r.driver_name}</span></>
                  : <span className="font-semibold text-warn-700">No vehicle yet</span>}
              </span>
              <StatusBadge value={r.booking_status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

