/**
 * My account — the dashboard.
 *
 * The four numbers a customer actually asks the office about (what is coming
 * up, what has been done, what has been billed, what is still owed), the next
 * journey, and the latest trips and unpaid invoices.
 */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { inr, dmy, hm12 } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '../components/ui';
import { DataTable, Kpi } from '../components/data';
import { IconCalendar, IconCheck, IconInvoices, IconRupee, IconArrowRight, IconCar, IconPhone } from '../components/icons';
import { stageBucket } from '../site/accountApi';
import { useAccount } from './AccountLayout';
import { TripRoute, TripStatus, TripWhen, useInvoiceActions } from './shared';

export default function AccountDashboard() {
  const { user, trips, tripsLoading, tripsError, reloadTrips, invoices, invoicesLoading } = useAccount();
  const navigate = useNavigate();
  const inv = useInvoiceActions();

  const stats = useMemo(() => {
    const upcoming = trips.filter((t) => ['upcoming', 'active'].includes(stageBucket(t)));
    const completed = trips.filter((t) => stageBucket(t) === 'completed');
    const billed = invoices.reduce((s, i) => s + i.total, 0);
    const outstanding = invoices.reduce((s, i) => s + i.outstanding, 0);
    const overdue = invoices.filter((i) => i.status === 'OVERDUE').length;
    // The soonest journey still ahead.
    const next = [...upcoming].sort((a, b) =>
      `${a.travelDate} ${a.journeyTime ?? ''}`.localeCompare(`${b.travelDate} ${b.journeyTime ?? ''}`))[0] ?? null;
    return { upcoming: upcoming.length, completed: completed.length, billed, outstanding, overdue, next };
  }, [trips, invoices]);

  const unpaid = invoices.filter((i) => i.outstanding > 0.009);
  const first = user.fullName.split(' ')[0];

  return (
    <div className="page">
      <PageHeader
        title={`Hello, ${first}`}
        subtitle="Your trips, their status and your invoices — the same record the office works from."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Upcoming trips" value={tripsLoading ? '…' : stats.upcoming} tone="brand"
          icon={<IconCalendar className="h-4 w-4" />} sub="Booked and not yet completed" onClick={() => navigate('/my/trips?tab=upcoming')} />
        <Kpi label="Completed trips" value={tripsLoading ? '…' : stats.completed} tone="success"
          icon={<IconCheck className="h-4 w-4" />} sub={`${trips.length} trip(s) in all`} onClick={() => navigate('/my/trips?tab=completed')} />
        <Kpi label="Invoiced" value={invoicesLoading ? '…' : inr(stats.billed)} tone="default"
          icon={<IconInvoices className="h-4 w-4" />} sub={`${invoices.length} invoice(s)`} onClick={() => navigate('/my/invoices')} />
        <Kpi label="Outstanding" value={invoicesLoading ? '…' : inr(stats.outstanding)}
          tone={stats.overdue > 0 ? 'danger' : stats.outstanding > 0 ? 'warning' : 'default'}
          icon={<IconRupee className="h-4 w-4" />}
          sub={stats.overdue > 0 ? `${stats.overdue} invoice(s) overdue` : 'Still to be paid'}
          onClick={() => navigate('/my/invoices?status=UNPAID')} />
      </div>

      {stats.next && (
        <section className="card flex flex-wrap items-center gap-4 p-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600"><IconCar className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Next trip</p>
            <p className="mt-1 text-sm font-semibold text-ink-900">
              {dmy(stats.next.travelDate)}{stats.next.journeyTime && ` · ${hm12(stats.next.journeyTime)}`}
              <span className="ml-2 font-mono text-xs text-brand-700">{stats.next.tripId}</span>
            </p>
            <p className="truncate text-sm text-ink-600" data-no-i18n>
              {stats.next.pickup}{stats.next.drop && ` → ${stats.next.drop}`}
            </p>
            {stats.next.driverName && (
              <p className="mt-1 text-xs text-ink-500">
                <span data-no-i18n>{stats.next.vehicleType} {stats.next.vehicleNumber && `· ${stats.next.vehicleNumber}`} · {stats.next.driverName}</span>
                {stats.next.driverMobile && (
                  <a href={`tel:${stats.next.driverMobile}`} className="ml-2 inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline">
                    <IconPhone className="h-3.5 w-3.5" /> Call driver
                  </a>
                )}
              </p>
            )}
          </div>
          <TripStatus t={stats.next} />
          <Link to={`/my/trips?open=${stats.next.tripId}`} className="btn-outline btn-sm">Details <IconArrowRight className="h-3.5 w-3.5" /></Link>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-5">
        <section className="table-wrap xl:col-span-3">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="card-title">Recent trips</h2>
            <Link to="/my/trips" className="text-xs font-semibold text-brand-700 hover:underline">All trips</Link>
          </div>
          {tripsError ? <ErrorState message={tripsError} onRetry={reloadTrips} /> : (
            <DataTable
              rows={trips.slice(0, 6)} rowKey={(t) => t.tripId} loading={tripsLoading} clientSort={false}
              onRowClick={(t) => navigate(`/my/trips?open=${t.tripId}`)}
              empty={<EmptyState title="No trips yet" body="Book your first trip, or add one you booked over the phone from My trips."
                action={<Link to="/book" className="btn-primary btn-sm">Book a trip</Link>} />}
              columns={[
                { key: 'tripId', header: 'Trip ID', sortable: false, render: (t) => <span className="font-mono text-xs font-semibold text-brand-700">{t.tripId}</span> },
                { key: 'travelDate', header: 'Date', sortable: false, render: (t) => <TripWhen t={t} /> },
                { key: 'pickup', header: 'Route', sortable: false, render: (t) => <TripRoute t={t} className="max-w-[14rem]" /> },
                { key: 'status', header: 'Status', sortable: false, render: (t) => <TripStatus t={t} /> },
              ]}
            />
          )}
        </section>

        <section className="table-wrap xl:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="card-title">Unpaid invoices</h2>
            <Link to="/my/invoices" className="text-xs font-semibold text-brand-700 hover:underline">All invoices</Link>
          </div>
          <DataTable
            rows={unpaid.slice(0, 6)} rowKey={(i) => i.id} loading={invoicesLoading} clientSort={false}
            onRowClick={(i) => i.downloadable && inv.view(i)}
            empty={<EmptyState title="Nothing to pay" body="Every invoice on your account is settled." />}
            columns={[
              { key: 'number', header: 'Invoice', sortable: false, render: (i) => (
                <div>
                  <span className="font-mono text-xs font-semibold text-brand-700">{i.number}</span>
                  <span className="cell-meta block">{dmy(i.date)}</span>
                </div>
              ) },
              { key: 'outstanding', header: 'Due', align: 'right', sortable: false, render: (i) => <span className="font-semibold text-ink-900">{inr(i.outstanding)}</span> },
              { key: 'status', header: 'Status', sortable: false, render: (i) => <StatusBadge value={i.status} /> },
            ]}
          />
        </section>
      </div>
    </div>
  );
}
