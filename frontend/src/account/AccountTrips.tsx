/**
 * My trips — every trip on the account, in the office's table layout.
 *
 * A row opens a drawer with the full record: the allotted car and chauffeur,
 * the fare, the status history, and the invoice once it exists. ?open=<TripID>
 * opens a trip straight away (the dashboard links here that way), and ?tab=
 * picks the starting filter.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { inr, dmy, dmyTime, hm12, humanise } from '../lib/format';
import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, Spinner } from '../components/ui';
import { DataTable, Detail, Drawer, Kpi, SearchBox, Segmented } from '../components/data';
import { IconDownload, IconEye, IconPhone, IconPlus, IconRoute, IconCalendar, IconCheck, IconWarning, IconMap } from '../components/icons';
import { stageBucket, useTrip, type ServerTrip } from '../site/accountApi';
import { ClaimTripCard } from '../site/ClaimTrip';
import { useAccount } from './AccountLayout';
import { TripRoute, TripStatus, TripWhen, useInvoiceActions } from './shared';

type Tab = '' | 'upcoming' | 'active' | 'completed' | 'cancelled';
const TABS: { value: Tab; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'On trip' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function AccountTrips() {
  const { trips, tripsLoading, tripsError, reloadTrips, reloadInvoices } = useAccount();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? '');
  const [search, setSearch] = useState('');
  const [claimOpen, setClaimOpen] = useState(false);
  const inv = useInvoiceActions();

  const openId = params.get('open');
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('open', id); else next.delete('open');
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': trips.length };
    for (const t of trips) c[stageBucket(t)] = (c[stageBucket(t)] ?? 0) + 1;
    return c;
  }, [trips]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return trips.filter((t) => {
      if (tab && stageBucket(t) !== tab) return false;
      if (!s) return true;
      return [t.tripId, t.pickup, t.drop, t.passengerName, t.vehicleType, t.vehicleNumber, t.driverName, t.invoice?.number]
        .some((v) => String(v ?? '').toLowerCase().includes(s));
    });
  }, [trips, tab, search]);

  const billed = trips.reduce((s, t) => s + (t.invoice?.total ?? 0), 0);

  return (
    <div className="page">
      <PageHeader
        title="My trips"
        subtitle="Every trip on your account with its live status, car and driver, and invoice."
        actions={
          <>
            <button onClick={() => setClaimOpen(true)} className="btn-outline btn-sm">Add a trip by ID</button>
            <Link to="/book" className="btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Book a trip</Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="All trips" value={tripsLoading ? '…' : trips.length} tone="brand" icon={<IconRoute className="h-4 w-4" />} onClick={() => setTab('')} />
        <Kpi label="Upcoming" value={tripsLoading ? '…' : counts.upcoming ?? 0} tone="warning"
          icon={<IconCalendar className="h-4 w-4" />} onClick={() => setTab('upcoming')} />
        <Kpi label="Completed" value={tripsLoading ? '…' : counts.completed ?? 0} tone="success"
          icon={<IconCheck className="h-4 w-4" />} sub={billed > 0 ? `${inr(billed)} invoiced` : undefined} onClick={() => setTab('completed')} />
        <Kpi label="Cancelled" value={tripsLoading ? '…' : counts.cancelled ?? 0} tone="default"
          icon={<IconWarning className="h-4 w-4" />} onClick={() => setTab('cancelled')} />
      </div>

      <section className="card p-3">
        <Segmented value={tab} onChange={setTab}
          options={TABS.map((t) => ({ value: t.value, label: t.label, count: counts[t.value] ?? 0 }))} />
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Trip ID, place, passenger, car, invoice no.…" className="min-w-[14rem] flex-1" />
        </div>
      </section>

      {tripsError ? <ErrorState message={tripsError} onRetry={reloadTrips} /> : (
        <section className="table-wrap">
          <DataTable
            rows={rows} rowKey={(t) => t.tripId} loading={tripsLoading}
            onRowClick={(t) => setOpen(t.tripId)}
            empty={<EmptyState title={trips.length ? 'No trips match' : 'No trips yet'}
              body={trips.length ? 'Clear the search or pick another tab.' : 'Book a trip, or add one you booked over the phone with its Trip ID.'}
              action={<Link to="/book" className="btn-primary btn-sm">Book a trip</Link>} />}
            columns={[
              { key: 'tripId', header: 'Trip ID', render: (t) => (
                <div className="whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-brand-700">{t.tripId}</span>
                  <span className="cell-meta block">{t.tripType ? humanise(t.tripType) : t.sourceLabel}</span>
                </div>
              ) },
              { key: 'travelDate', header: 'Date', sortValue: (t) => `${t.travelDate} ${t.journeyTime ?? ''}`, render: (t) => <TripWhen t={t} /> },
              { key: 'pickup', header: 'Route', render: (t) => <TripRoute t={t} /> },
              { key: 'vehicleType', header: 'Car & driver', render: (t) => (
                <div className="max-w-[12rem]" data-no-i18n>
                  <p className="truncate text-sm text-ink-800">{t.vehicleType || '—'}{t.vehicleNumber && ` · ${t.vehicleNumber}`}</p>
                  {t.driverName && <p className="cell-meta truncate">{t.driverName}</p>}
                </div>
              ) },
              { key: 'fare', header: 'Fare', align: 'right', sortValue: (t) => t.invoice?.total ?? t.fare ?? 0,
                render: (t) => (t.invoice?.total ?? t.fare) ? <span className="font-semibold text-ink-900">{inr(t.invoice?.total ?? t.fare)}</span> : <span className="text-ink-400">—</span> },
              { key: 'status', header: 'Status', render: (t) => <TripStatus t={t} /> },
              { key: 'invoice', header: 'Invoice', sortable: false, sticky: true, render: (t) => t.invoice ? (
                <button type="button" className="btn-ghost btn-sm" disabled={!t.invoice.downloadable || inv.busy === t.invoice.id}
                  onClick={(e) => { e.stopPropagation(); inv.download({ id: t.invoice!.id, number: t.invoice!.number }); }}
                  title={t.invoice.downloadable ? 'Download the invoice' : 'The document is still being prepared'}>
                  {inv.busy === t.invoice.id ? <Spinner /> : <IconDownload className="h-3.5 w-3.5" />}
                  <span className="font-mono text-2xs">{t.invoice.number}</span>
                </button>
              ) : <span className="text-ink-400">—</span> },
            ]}
          />
        </section>
      )}

      {openId && <TripDrawer tripId={openId} onClose={() => setOpen(null)} />}

      <Modal open={claimOpen} onClose={() => setClaimOpen(false)} size="sm" title="Add a trip by its Trip ID"
        subtitle="For a trip booked over the phone or WhatsApp before you had an account.">
        <ClaimTripCard onClaimed={() => { reloadTrips(); reloadInvoices(); }} />
      </Modal>
    </div>
  );
}

/* ==========================================================================
   One trip, in a drawer
   ========================================================================== */

function TripDrawer({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const { trips, invoices } = useAccount();
  const listed = trips.find((t) => t.tripId === tripId) ?? null;
  const { trip: loaded, timeline, loading, error } = useTrip(tripId, true);
  const t: ServerTrip | null = loaded ?? listed;
  const inv = useInvoiceActions();
  const trackable = t && (t.status === 'ASSIGNED' || t.status === 'ONTRIP');
  // The invoice register's status (it knows about overdue), not the raw one on the trip.
  const invoiceStatus = t?.invoice ? invoices.find((i) => i.id === t.invoice!.id)?.status ?? t.invoice.status : null;

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={<span className="font-mono">{tripId}</span>}
      subtitle={t ? <span className="flex flex-wrap items-center gap-2"><TripStatus t={t} /> {t.sourceLabel}</span> : undefined}
      footer={t && (
        <>
          {trackable && <Link to={`/trips/${t.tripId}/track`} className="btn-outline btn-sm"><IconMap className="h-3.5 w-3.5" /> Track</Link>}
          {t.invoice?.downloadable && (
            <>
              <button className="btn-outline btn-sm" onClick={() => inv.view({ id: t.invoice!.id, number: t.invoice!.number })} disabled={!!inv.busy}>
                <IconEye className="h-3.5 w-3.5" /> View invoice
              </button>
              <button className="btn-primary btn-sm" onClick={() => inv.download({ id: t.invoice!.id, number: t.invoice!.number })} disabled={!!inv.busy}>
                {inv.busy ? <Spinner /> : <IconDownload className="h-3.5 w-3.5" />} Download invoice
              </button>
            </>
          )}
        </>
      )}
    >
      {!t && loading && <div className="grid place-items-center py-16"><Spinner className="h-6 w-6" /></div>}
      {!t && !loading && <ErrorState message={error || 'That trip is not on your account.'} />}
      {t && (
        <div className="space-y-6">
          <section>
            <h3 className="eyebrow mb-3">Journey</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Date">{dmy(t.travelDate)}{t.travelDateTo && t.travelDateTo !== t.travelDate && ` – ${dmy(t.travelDateTo)}`}</Detail>
              <Detail label="Pickup time">{t.journeyTime ? hm12(t.journeyTime) : null}</Detail>
              <Detail label="Pickup" className="sm:col-span-2"><span data-no-i18n>{t.pickup}</span></Detail>
              {t.drop && <Detail label="Drop" className="sm:col-span-2"><span data-no-i18n>{t.drop}</span></Detail>}
              <Detail label="Trip type">{t.tripType ? humanise(t.tripType) : null}</Detail>
              <Detail label="Passengers">{t.passengers ?? null}</Detail>
              {t.passengerName && <Detail label="Passenger"><span data-no-i18n>{t.passengerName}</span></Detail>}
            </dl>
          </section>

          <section>
            <h3 className="eyebrow mb-3">Car &amp; driver</h3>
            {t.driverName || t.vehicleNumber ? (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail label="Vehicle"><span data-no-i18n>{t.vehicleType}{t.vehicleNumber && ` · ${t.vehicleNumber}`}</span></Detail>
                <Detail label="Driver">
                  <span data-no-i18n>{t.driverName}</span>
                  {t.driverMobile && (
                    <a href={`tel:${t.driverMobile}`} className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
                      <IconPhone className="h-3.5 w-3.5" /> {t.driverMobile}
                    </a>
                  )}
                </Detail>
              </dl>
            ) : (
              <p className="rounded-lg bg-ink-50 p-3 text-sm text-ink-600">
                {t.vehicleType && <span data-no-i18n>{t.vehicleType} · </span>}
                The car and driver will show here once the office assigns them.
              </p>
            )}
          </section>

          <section>
            <h3 className="eyebrow mb-3">Fare &amp; invoice</h3>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Fare">{t.fare ? inr(t.fare) : 'To be confirmed by the office'}</Detail>
              {t.invoice ? (
                <>
                  <Detail label="Invoice"><span className="font-mono">{t.invoice.number}</span> · {dmy(t.invoice.date)}</Detail>
                  <Detail label="Invoice total">{inr(t.invoice.total)}{t.invoice.gst && <span className="cell-meta"> incl. GST {inr(t.invoice.taxAmount)}</span>}</Detail>
                  <Detail label="Invoice status"><StatusBadge value={invoiceStatus} /></Detail>
                </>
              ) : (
                <Detail label="Invoice">Issued once the trip is completed and billed.</Detail>
              )}
            </dl>
          </section>

          {timeline.length > 0 && (
            <section>
              <h3 className="eyebrow mb-3">History</h3>
              <ol className="relative space-y-4 border-l border-ink-200 pl-5">
                {timeline.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                    <p className="text-sm font-semibold text-ink-900">{e.title}</p>
                    {e.detail && <p className="text-sm text-ink-600" data-no-i18n>{e.detail}</p>}
                    <p className="text-2xs text-ink-400">{dmyTime(e.created_at)}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {t.message && (
            <section>
              <h3 className="eyebrow mb-2">Your note</h3>
              <p className="whitespace-pre-line rounded-lg bg-ink-50 p-3 text-sm text-ink-700" data-no-i18n>{t.message}</p>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
