import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from 'recharts';
import { api, errorMessage } from '../lib/api';
import { inr, inrShort, dmy, monthLabel, humanise } from '../lib/format';
import { useCountUp } from '../lib/animate';
import { Loading, ErrorState, StatCard, StatusBadge, EmptyState, SectionCard } from '../components/ui';
import {
  IconVendors, IconBookings, IconReports, IconBilling,
  IconInvoices, IconPayments, IconAudit, IconPlus,
  IconMail, IconPhone, IconRoad, IconUsers,
} from '../components/icons';
import { useAuth } from '../lib/auth';

/* One accent, stepped in lightness. Categorical charts previously mixed the
   accent with gold, which read as two meanings where there was only one. */
const SERIES = ['#1CA3DE', '#0E82B8', '#0C6791', '#37ACDD', '#72C6EA', '#0F5474', '#A9DCF4', '#0F4560'];

const TOOLTIP = {
  contentStyle: {
    borderRadius: 10,
    border: '1px solid #E3E8EF',
    fontSize: 12,
    padding: '8px 10px',
    boxShadow: '0 8px 28px -14px rgba(16,28,43,.32)',
  },
  labelStyle: { color: '#46586C', fontWeight: 600, marginBottom: 2 },
  cursor: { fill: 'rgba(28,163,222,.06)' },
};

const AXIS = { tick: { fontSize: 11, fill: '#7A8CA0' }, axisLine: false, tickLine: false } as const;

/* --------------------------------------------------------------------------
   The customer journey, on the dashboard.

   How a job reached us matters operationally: a WhatsApp enquiry is answered
   in the chat, an email enquiry gets a reply, a walk-in is already agreed. So
   the sources are shown as their own row rather than folded into one "new
   bookings" figure.
   -------------------------------------------------------------------------- */

const SOURCE_LABEL: Record<string, string> = {
  EMAIL: 'Email enquiries',
  WHATSAPP: 'WhatsApp enquiries',
  PORTAL: 'Portal bookings',
  WALKIN: 'Walk-in / phone',
  VENDOR: 'Vendor bookings',
};

const SOURCE_ICON: Record<string, JSX.Element> = {
  EMAIL: <IconMail />,
  WHATSAPP: <IconPhone />,
  PORTAL: <IconUsers />,
  WALKIN: <IconRoad />,
  VENDOR: <IconVendors />,
};

/** One line of "n things are waiting on you", linked to the list that has them. */
function WaitingRow({
  label, value, to, tone,
}: {
  label: string; value: number; to: string; tone: 'warn' | 'brand' | 'ok' | 'danger';
}) {
  const dot: Record<string, string> = {
    warn: 'bg-warn-500', brand: 'bg-brand-500', ok: 'bg-ok-500', danger: 'bg-danger-500',
  };
  return (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
        value > 0 ? 'bg-ink-50 hover:bg-ink-100' : 'opacity-55'
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${value > 0 ? dot[tone] : 'bg-ink-300'}`} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{label}</span>
      <span className="shrink-0 text-lg font-bold tabular-nums text-ink-900">{value}</span>
    </Link>
  );
}

/** A stat whose number animates up on load. */
function CountStat(props: Parameters<typeof StatCard>[0] & { count?: number; money?: boolean }) {
  const { count, money, value, ...rest } = props;
  const animated = useCountUp(count ?? 0);
  if (count === undefined) return <StatCard {...rest} value={value} />;
  return <StatCard {...rest} value={money ? inrShort(animated) : Math.round(animated).toLocaleString('en-IN')} />;
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();

  const load = async () => {
    setError('');
    try {
      const res = await api.get('/dashboard');
      setData(res.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => { load(); }, []);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Loading variant="cards" label="Loading your dashboard…" />;

  const c = data.cards;
  const trend = (data.monthlyTrend ?? []).map((r: any) => ({ ...r, label: monthLabel(r.month) }));
  const invoiced = (data.monthlyInvoiced ?? []).map((r: any) => ({ ...r, label: monthLabel(r.month) }));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page">
      {/* ---------------- header ---------------- */}
      <header className="page-head animate-fade-down">
        <div>
          <p className="eyebrow">{today}</p>
          <h1 className="page-title mt-1">{greeting}, {user?.fullName?.split(' ')[0]}</h1>
          <p className="page-sub">
            {c.todays_travel > 0
              ? `${c.todays_travel} trip${c.todays_travel === 1 ? '' : 's'} travelling today.`
              : 'No trips scheduled for today.'}
            {c.pending_billing_count > 0 &&
              ` ${c.pending_billing_count} booking${c.pending_billing_count === 1 ? '' : 's'} waiting to be billed.`}
          </p>
        </div>
        <div className="page-actions">
          <Link to="/admin/bookings/new" className="btn-primary">
            <IconPlus className="h-4 w-4" /> New Booking
          </Link>
          <Link to="/admin/billing" className="btn-outline">Billing</Link>
        </div>
      </header>

      {/* ---------------- what is waiting on somebody ---------------- */}
      {data.journey?.new_inquiries > 0 && (
        <Link
          to="/admin/trips?status=INQUIRY"
          className="animate-fade-up group flex flex-wrap items-center gap-4 rounded-xl border border-warn-200 bg-warn-50 p-4 transition-all duration-200 ease-smooth hover:border-warn-300 hover:shadow-raised sm:p-5"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-warn-500 text-white">
            <IconMail className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-md font-semibold text-ink-900">
              {data.journey.new_inquiries} customer enquir{data.journey.new_inquiries === 1 ? 'y' : 'ies'} waiting
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              Nobody has picked {data.journey.new_inquiries === 1 ? 'it' : 'them'} up yet. Each already has a Trip ID.
            </p>
          </div>
          <span className="btn-dark btn-sm shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
            Open Trips →
          </span>
        </Link>
      )}

      {/* ---------------- the one thing to act on ---------------- */}
      {c.pending_billing_count > 0 && (
        <Link
          to="/admin/billing"
          className="animate-fade-up group flex flex-wrap items-center gap-4 rounded-xl border border-brand-200 bg-brand-50 p-4 transition-all duration-200 ease-smooth hover:border-brand-300 hover:shadow-raised sm:p-5"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
            <IconBilling className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-md font-semibold text-ink-900">
              {c.pending_billing_count} booking{c.pending_billing_count === 1 ? '' : 's'} ready for billing
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              {inr(c.pending_billing_amount)} across {data.pendingByVendor?.length ?? 0} vendor
              {data.pendingByVendor?.length === 1 ? '' : 's'} — select and generate in one step.
            </p>
          </div>
          <span className="btn-primary btn-sm shrink-0 transition-transform duration-200 group-hover:translate-x-0.5">
            Generate invoices →
          </span>
        </Link>
      )}

      {/* ---------------- money ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">Money</h2>
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CountStat label="Billed this month" count={Number(c.month_billing)} money value=""
            icon={<IconReports />} sub={`${c.month_bookings} booking${c.month_bookings === 1 ? '' : 's'}`} />
          <CountStat label="Total invoiced" count={Number(c.total_invoiced_amount)} money value=""
            tone="brand" icon={<IconInvoices />} sub={`${c.total_invoices} invoices raised`}
            onClick={() => navigate('/admin/invoices')} />
          <CountStat label="Received" count={Number(c.paid_amount)} money value=""
            tone="success" icon={<IconPayments />} sub="Paid to date"
            onClick={() => navigate('/admin/payments')} />
          <CountStat label="Outstanding" count={Number(c.outstanding_amount)} money value=""
            tone={Number(c.outstanding_amount) > 0 ? 'danger' : 'default'} icon={<IconAudit />}
            sub={`${c.pending_payment_count} invoice${c.pending_payment_count === 1 ? '' : 's'} unpaid`}
            onClick={() => navigate('/admin/billing')} />
        </div>
      </section>

      {/* ---------------- operations ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">Operations</h2>
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CountStat label="Active vendors" count={Number(c.total_vendors)} value=""
            icon={<IconVendors />} sub="Currently billable" onClick={() => navigate('/admin/vendors')} />
          <CountStat label="Booked today" count={Number(c.todays_bookings)} value=""
            icon={<IconBookings />} sub={`${c.todays_travel} travelling today`}
            onClick={() => navigate('/admin/bookings')} />
          <CountStat label="Awaiting billing" count={Number(c.pending_billing_count)} value=""
            tone={c.pending_billing_count > 0 ? 'warning' : 'default'} icon={<IconBilling />}
            sub={inr(c.pending_billing_amount)} onClick={() => navigate('/admin/billing')} />
          <CountStat label="Invoiced bookings" count={Number(c.invoiced_bookings)} value=""
            tone="success" icon={<IconInvoices />} sub="Closed out"
            onClick={() => navigate('/admin/bookings?billingStatus=INVOICED')} />
        </div>
      </section>

      {/* ---------------- where the work came from ---------------- */}
      {data.journey && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="eyebrow">Customer enquiries</h2>
            <Link to="/admin/trips" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
              Open Trips →
            </Link>
          </div>

          <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.journey.bySource.map((s: any) => (
              <StatCard
                key={s.source}
                label={SOURCE_LABEL[s.source] ?? s.source}
                value={Number(s.count).toLocaleString('en-IN')}
                tone={s.openInquiries > 0 ? 'warning' : 'default'}
                icon={SOURCE_ICON[s.source]}
                sub={
                  s.openInquiries > 0
                    ? `${s.openInquiries} not picked up · ${s.last7} in the last 7 days`
                    : `${s.last7} in the last 7 days`
                }
                onClick={() => navigate(`/admin/trips?source=${s.source}`)}
              />
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.4fr,1fr]">
            <SectionCard
              title="Latest enquiries"
              subtitle="Every channel, newest first"
              actions={<Link to="/admin/trips" className="btn-outline btn-sm">All trips</Link>}
              bodyClass=""
            >
              {data.journey.recent.length === 0 ? (
                <EmptyState
                  title="No customer enquiries yet"
                  body="Enquiries from the website and WhatsApp will appear here the moment they arrive."
                />
              ) : (
                <div className="table-wrap">
                  <table className="tbl">
                    <thead>
                      <tr><th>Trip ID</th><th>From</th><th>Customer</th><th>Journey</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {data.journey.recent.map((t: any) => (
                        <tr
                          key={t.id}
                          className="cursor-pointer"
                          onClick={() => navigate(`/admin/trips?search=${encodeURIComponent(t.trip_id)}`)}
                        >
                          <td className="font-mono text-[11px] font-semibold text-brand-700">{t.trip_id}</td>
                          <td className="text-xs text-ink-600">{SOURCE_LABEL[t.inquiry_source] ?? t.inquiry_source}</td>
                          <td className="max-w-[10rem] truncate text-sm text-ink-800">{t.customer_name || '—'}</td>
                          <td className="max-w-[14rem] truncate text-xs text-ink-600">
                            {[t.pickup_location, t.drop_location].filter(Boolean).join('  →  ') || '—'}
                            <span className="block text-2xs text-ink-400">{dmy(t.travel_date)}</span>
                          </td>
                          <td><StatusBadge value={t.booking_status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Waiting on us" subtitle="The journey, from enquiry to invoice">
              <div className="space-y-2.5">
                <WaitingRow
                  label="Enquiries not picked up" value={data.journey.new_inquiries}
                  to="/admin/trips?status=INQUIRY" tone="warn"
                />
                <WaitingRow
                  label="Confirmed, no vehicle allotted" value={data.journey.awaiting_vehicle}
                  to="/admin/trips?status=CONFIRMED" tone="brand"
                />
                <WaitingRow
                  label="Completed, not yet invoiced" value={data.journey.awaiting_invoice}
                  to="/admin/trips?status=COMPLETED" tone="ok"
                />
                <WaitingRow
                  label="Emails not yet delivered" value={data.journey.undelivered_emails}
                  to="/admin/settings" tone="danger"
                />
              </div>
              <p className="mt-4 border-t border-ink-200 pt-3 text-xs text-ink-500">
                {data.journey.customer_accounts} customer{data.journey.customer_accounts === 1 ? '' : 's'} can sign
                in to the website to follow their own trips and download invoices.
              </p>
            </SectionCard>
          </div>
        </section>
      )}

      {/* ---------------- performance ratios ---------------- */}
      {data.ratios && data.ratios.total > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="eyebrow">Performance</h2>

          <div className="grid gap-5 xl:grid-cols-[1fr,1.4fr]">
            <SectionCard title="Booking outcomes" subtitle={`${data.ratios.total} bookings, excluding drafts`}>
              {/* one stacked bar reads faster than four separate numbers */}
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-ink-100">
                {data.ratios.byStatus.filter((s: any) => s.count > 0).map((s: any) => (
                  <div
                    key={s.status}
                    title={`${humanise(s.status)} — ${s.count} (${s.percent}%)`}
                    style={{ width: `${s.percent}%` }}
                    className={
                      s.status === 'COMPLETED' ? 'bg-ok-500'
                      : s.status === 'CONFIRMED' ? 'bg-brand-500'
                      : s.status === 'CANCELLED' ? 'bg-danger-500'
                      : 'bg-warn-500'
                    }
                  />
                ))}
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
                {data.ratios.byStatus.map((s: any) => (
                  <div key={s.status} className="flex items-baseline gap-2.5">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                      s.status === 'COMPLETED' ? 'bg-ok-500'
                      : s.status === 'CONFIRMED' ? 'bg-brand-500'
                      : s.status === 'CANCELLED' ? 'bg-danger-500'
                      : 'bg-warn-500'}`} />
                    <div className="min-w-0">
                      <dt className="truncate text-xs text-ink-500">{humanise(s.status)}</dt>
                      <dd className="text-md font-bold tabular-nums text-ink-900">
                        {s.percent}% <span className="text-xs font-medium text-ink-400">({s.count})</span>
                      </dd>
                    </div>
                  </div>
                ))}
              </dl>

              <div className="mt-5 grid grid-cols-3 gap-3">
                {[
                  ['Completed', data.ratios.completionRate, 'text-ok-600'],
                  ['Lost', data.ratios.cancellationRate, 'text-danger-600'],
                  ['Collected', data.ratios.collectionRate, 'text-brand-700'],
                ].map(([label, value, tone]) => (
                  <div key={String(label)} className="rounded-xl bg-ink-50 p-3">
                    <p className="text-2xs uppercase tracking-wide text-ink-500">{label}</p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}%</p>
                  </div>
                ))}
              </div>

              {data.ratios.drafts > 0 && (
                <p className="mt-4 text-xs text-ink-500">
                  {data.ratios.drafts} draft{data.ratios.drafts === 1 ? '' : 's'} excluded — drafts are not counted as work.
                </p>
              )}
            </SectionCard>

            <SectionCard
              title="Vendor-wise ratio"
              subtitle="Share of all bookings, and how each account actually performs"
              bodyClass="p-0"
            >
              <div className="table-wrap !rounded-none !border-0 !shadow-none">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th className="text-right">Bookings</th>
                      <th className="w-40">Share</th>
                      <th className="text-right">Completed</th>
                      <th className="text-right">Cancelled</th>
                      <th className="text-right">Unbilled</th>
                      <th className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ratios.vendorRatio.map((v: any) => (
                      <tr key={v.id}>
                        <td>
                          <p className="font-medium text-ink-900">{v.name}</p>
                          <p className="cell-meta">{v.code}</p>
                        </td>
                        <td className="td-num td-strong">{v.bookings}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                              <div className="grad-brand h-full rounded-full transition-all duration-700 ease-smooth"
                                style={{ width: `${Math.max(3, v.share)}%` }} />
                            </div>
                            <span className="w-11 shrink-0 text-right text-xs tabular-nums text-ink-600">{v.share}%</span>
                          </div>
                        </td>
                        <td className="td-num text-ok-600">{v.completionRate}%</td>
                        <td className={`td-num ${v.cancellationRate > 0 ? 'text-danger-600' : 'text-ink-400'}`}>
                          {v.cancellationRate}%
                        </td>
                        <td className={`td-num ${v.uninvoiced > 0 ? 'text-warn-600' : 'text-ink-400'}`}>
                          {v.uninvoiced}
                        </td>
                        <td className="td-num td-strong">{inrShort(v.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Billing pipeline" subtitle="Where confirmed bookings currently sit">
            <div className="grid gap-4 sm:grid-cols-3">
              {data.ratios.byBilling.map((b: any) => (
                <div key={b.status} className="rounded-xl bg-ink-50 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-semibold text-ink-600">{humanise(b.status)}</p>
                    <p className="text-lg font-bold tabular-nums text-ink-900">{b.percent}%</p>
                  </div>
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-smooth ${
                        b.status === 'INVOICED' ? 'bg-ok-500' : b.status === 'READY' ? 'bg-brand-500' : 'bg-warn-500'
                      }`}
                      style={{ width: `${b.percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-2xs text-ink-500">{b.count} booking{b.count === 1 ? '' : 's'}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>
      )}

      {/* ---------------- charts ---------------- */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard title="Booking trend" subtitle="Bookings per month over the last year">
          {trend.length === 0 ? (
            <EmptyState title="No booking history yet" body="Create your first booking to see the trend." />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trend} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="gBookings" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1CA3DE" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#1CA3DE" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" vertical={false} />
                <XAxis dataKey="label" {...AXIS} />
                {/* wide enough for two-digit counts — 34px clipped "12" to "2" */}
                <YAxis {...AXIS} allowDecimals={false} width={44} />
                <Tooltip {...TOOLTIP} formatter={(v: any) => [v, 'Bookings']} />
                <Area
                  type="monotone" dataKey="bookings" stroke="#0E82B8" strokeWidth={2.25}
                  fill="url(#gBookings)"
                  dot={{ r: 0 }} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }}
                  animationDuration={700}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Invoiced vs. received" subtitle="Monthly invoice value against payments collected">
          {invoiced.length === 0 ? (
            <EmptyState title="No invoices yet" body="Generate an invoice from the Billing screen." />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={invoiced} margin={{ top: 6, right: 6, left: -8, bottom: 0 }} barGap={3}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" vertical={false} />
                  <XAxis dataKey="label" {...AXIS} />
                  <YAxis {...AXIS} tickFormatter={(v) => inrShort(v)} width={54} />
                  <Tooltip {...TOOLTIP} formatter={(v: any, n: any) => [inr(v), n === 'amount' ? 'Invoiced' : 'Received']} />
                  <Bar dataKey="amount" fill="#0E82B8" radius={[3, 3, 0, 0]} maxBarSize={26} animationDuration={600} />
                  <Bar dataKey="paid" fill="#A9DCF4" radius={[3, 3, 0, 0]} maxBarSize={26} animationDuration={600} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 flex items-center gap-5 text-xs text-ink-600">
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-brand-600" /> Invoiced
                </span>
                <span className="flex items-center gap-1.5">
                  <i className="h-2.5 w-2.5 rounded-sm bg-brand-200" /> Received
                </span>
              </div>
            </>
          )}
        </SectionCard>

        <SectionCard title="Top vendors" subtitle="By billed value">
          {data.vendorBookings?.length === 0 ? (
            <EmptyState title="No vendor activity yet" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.vendorBookings} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDF1F6" horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(v) => inrShort(v)} />
                <YAxis type="category" dataKey="name" width={116}
                  tick={{ fontSize: 11, fill: '#46586C' }} axisLine={false} tickLine={false} />
                <Tooltip {...TOOLTIP} formatter={(v: any) => [inr(v), 'Billed']} />
                <Bar dataKey="amount" radius={[0, 4, 4, 0]} maxBarSize={22} animationDuration={650}>
                  {data.vendorBookings.map((_: any, i: number) => (
                    <Cell key={i} fill={SERIES[i % SERIES.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard
          title="Awaiting billing"
          subtitle="Grouped by vendor — an invoice covers one vendor"
          actions={<Link to="/admin/billing" className="btn-outline btn-sm">Open billing</Link>}
          bodyClass="p-2.5"
        >
          {data.pendingByVendor?.length === 0 ? (
            <EmptyState title="Nothing pending" body="Every completed booking has been invoiced." />
          ) : (
            <div className="stagger flex flex-col gap-1">
              {data.pendingByVendor.map((v: any) => (
                <Link
                  key={v.vendor_id}
                  to={`/admin/billing?vendorId=${v.vendor_id}`}
                  className="group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-150 hover:bg-brand-50"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 font-mono text-2xs font-bold text-white">
                    {v.code?.slice(0, 3)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-900">{v.vendor_name}</p>
                    <p className="text-xs text-ink-500">
                      {v.count} booking{v.count === 1 ? '' : 's'}
                      {v.consolidation_allowed ? ' · can consolidate' : ' · one invoice each'}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-ink-900">{inr(v.amount)}</span>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ---------------- activity ---------------- */}
      <div className="grid gap-5 xl:grid-cols-2">
        <SectionCard
          title="Recent bookings"
          actions={<Link to="/admin/bookings" className="link text-xs">View all →</Link>}
          bodyClass="p-0"
        >
          {data.recentBookings?.length === 0 ? (
            <EmptyState title="No bookings yet"
              action={<Link to="/admin/bookings/new" className="btn-primary btn-sm">Create the first booking</Link>} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.recentBookings.map((b: any) => (
                <li key={b.id}>
                  <Link to={`/admin/bookings/${b.id}/edit`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-ink-50">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="cell-code">{b.booking_code}</span>
                        <span className="truncate text-sm font-medium text-ink-900">{b.passenger_name}</span>
                      </p>
                      <p className="cell-meta truncate">
                        {b.vendor_name} · {dmy(b.travel_date)} · {b.pickup_location}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-ink-900">{inr(b.total_amount)}</p>
                      <StatusBadge value={b.billing_status} className="mt-1" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={data.overdue?.length > 0 ? 'Overdue payments' : 'Recent invoices'}
          subtitle={data.overdue?.length > 0 ? 'Past their due date' : undefined}
          actions={
            <Link to={data.overdue?.length > 0 ? '/admin/payments' : '/admin/invoices'} className="link text-xs">
              View all →
            </Link>
          }
          bodyClass="p-0"
        >
          {data.overdue?.length > 0 ? (
            <ul className="divide-y divide-ink-100">
              {data.overdue.map((i: any) => (
                <li key={i.id}>
                  <Link to={`/admin/invoices/${i.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-danger-50/50">
                    <div className="min-w-0 flex-1">
                      <p className="cell-code truncate">{i.invoice_number}</p>
                      <p className="cell-meta truncate">{i.vendor_name} · due {dmy(i.due_date)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-danger-600">{inr(i.outstanding_amount)}</p>
                      <p className="text-2xs text-danger-600">{i.days_overdue} days overdue</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : data.recentInvoices?.length === 0 ? (
            <EmptyState title="No invoices yet" body="Invoices appear here once you generate them from Billing." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {data.recentInvoices.map((i: any) => (
                <li key={i.id}>
                  <Link to={`/admin/invoices/${i.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors duration-150 hover:bg-ink-50">
                    <div className="min-w-0 flex-1">
                      <p className="cell-code truncate">{i.invoice_number}</p>
                      <p className="cell-meta truncate">
                        {i.vendor_name} · {dmy(i.invoice_date)} · {i.booking_count} booking{i.booking_count === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums text-ink-900">{inr(i.total_amount)}</p>
                      <StatusBadge value={i.status} className="mt-1" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
