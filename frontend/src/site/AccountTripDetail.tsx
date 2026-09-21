/**
 * One trip, read from the office's own record.
 *
 * This is the signed-in view: the status the office set, the car and chauffeur
 * they allotted, the fare they agreed and the invoice they raised. Nothing on
 * this page is inferred — a step is done because somebody in the office marked
 * it done, and the timeline below says when and what.
 *
 * The device-only view of a trip lives in TripDetail.tsx and is what a visitor
 * without an account still sees.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { dmy, inr } from '../lib/format';
import { COMPANY } from './siteData';
import {
  downloadInvoice, invoiceStep, trailFor, viewInvoice,
  SOURCE_TONE, STAGE_TONE, type ServerTrip, type TimelineEvent,
} from './accountApi';
import { BackLink, CallButton, CopyChip, JourneyLine, KeyValue, StatusTrail, TrustRow, since } from './kit';
import { WhatsAppButton } from './EnquirySheet';
import { Reveal } from '../components/Reveal';
import { useToast } from '../components/Toast';
import {
  IconArrowRight, IconCheck, IconDownload, IconExternal, IconInvoices,
  IconPhone, IconPin, IconUsers,
} from '../components/icons';
import { IconSeat, IconWhatsApp } from './SiteIcons';

export default function AccountTripDetail({
  trip, timeline,
}: {
  trip: ServerTrip;
  timeline: TimelineEvent[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'download' | 'view'>('');

  const trail = trailFor(trip);
  const extra = invoiceStep(trip);
  const steps = [
    ...trail.map((s) => ({ label: s.label, state: s.state })),
    ...(extra ? [extra] : []),
  ];

  const cancelled = trip.status === 'CANCELLED' || trip.status === 'NO_SHOW';
  const trackable = trip.status === 'ASSIGNED' || trip.status === 'ONTRIP';
  const stops = [trip.pickup, trip.drop].filter(Boolean) as string[];

  async function invoiceAction(kind: 'download' | 'view') {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'download') {
        await downloadInvoice(trip.tripId, trip.invoice?.number);
        toast.success('Invoice downloaded', `${trip.invoice?.number} saved to your device.`);
      } else {
        await viewInvoice(trip.tripId);
      }
    } catch {
      toast.error(
        'The invoice would not open',
        'Please try again, or call the office and we will email it to you.'
      );
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BackLink to="/trips" />
          <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-brand-700">Home</Link>
            <span className="text-ink-300">/</span>
            <Link to="/trips" className="hover:text-brand-700">My trips</Link>
            <span className="text-ink-300">/</span>
            <span className="font-mono font-medium text-ink-700">{trip.tripId}</span>
          </nav>
        </div>

        {/* ------------------------------ header ------------------------------ */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <CopyChip value={trip.tripId} />
              <span className={`rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${SOURCE_TONE[trip.source] ?? 'bg-ink-100 text-ink-700'}`}>
                {trip.sourceLabel}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${STAGE_TONE[trip.status]}`}>
                {trip.statusLabel}
              </span>
            </p>
            <h1 className="mt-3 font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-ink-900 sm:text-[2.2rem]">
              {stops.join('  →  ') || 'Your trip'}
            </h1>
            <p className="mt-2 text-md text-ink-600">
              {trip.travelDate ? dmy(trip.travelDate) : 'Date to be confirmed'}
              {trip.journeyTime && <> · {trip.journeyTime}</>}
              {trip.passengers ? <> · {trip.passengers} {trip.passengers === 1 ? 'passenger' : 'passengers'}</> : null}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {trackable && (
              <Link
                to={`/trips/${trip.tripId}/track`}
                className="btn h-11 rounded-full bg-brand-50 px-5 text-md font-semibold text-brand-700 transition-colors hover:bg-brand-100"
              >
                <IconPin className="h-4 w-4" /> Track
              </Link>
            )}
            <a
              href={`tel:+91${COMPANY.mobile}`}
              className="btn h-11 rounded-full bg-ink-900 px-5 text-md text-white transition-colors hover:bg-ink-800"
            >
              <IconPhone className="h-4 w-4" /> Call the office
            </a>
          </div>
        </div>

        {cancelled && (
          <p className="animate-fade-up mt-6 rounded-2xl bg-danger-50 px-5 py-4 text-sm leading-relaxed text-danger-700">
            <strong>This trip is marked {trip.statusLabel.toLowerCase()}.</strong> If that is not right, call the
            office and quote {trip.tripId} — we can reopen it.
          </p>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr,21rem] lg:items-start lg:gap-8">
          {/* ------------------------------ left ------------------------------ */}
          <div className="space-y-6">

            {/* Where the journey has got to. */}
            <Reveal className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Where your trip has got to</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                A step is ticked only once our desk has actually done it. Nothing here moves on its own.
              </p>
              <div className="mt-5">
                <StatusTrail steps={steps} />
              </div>
            </Reveal>

            {/* The route. */}
            <Reveal delay={60} className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Your journey</h2>
              <div className="mt-4">
                <JourneyLine
                  stops={[
                    { label: trip.pickup || 'Pickup to be confirmed', note: 'Pickup' },
                    { label: trip.drop || 'Drop to be confirmed', note: 'Drop' },
                  ]}
                />
              </div>
              <dl className="mt-5 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-2">
                <KeyValue label="Journey date" value={trip.travelDate ? dmy(trip.travelDate) : '—'} />
                <KeyValue label="Journey time" value={trip.journeyTime || 'To be confirmed'} />
                <KeyValue label="Vehicle type" value={trip.vehicleType || 'To be confirmed'} />
                <KeyValue
                  label="Passengers"
                  value={trip.passengers ? String(trip.passengers) : '—'}
                />
              </dl>
              {trip.message && (
                <div className="mt-5 border-t border-ink-100 pt-5">
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">What you told us</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{trip.message}</p>
                </div>
              )}
            </Reveal>

            {/* Vehicle and chauffeur, once allotted. */}
            <Reveal delay={100} className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Vehicle and chauffeur</h2>
              {trip.vehicleNumber || trip.driverName ? (
                <>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="animate-fade-up rounded-2xl bg-brand-50/70 p-4">
                      <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-brand-700">
                        <IconSeat className="h-3.5 w-3.5" /> Vehicle
                      </p>
                      <p className="mt-1.5 font-display text-md font-bold text-ink-900">
                        {trip.vehicleType || 'Vehicle'}
                      </p>
                      {trip.vehicleNumber && (
                        <p className="mt-0.5 font-mono text-sm font-semibold tracking-wide text-ink-700">
                          {trip.vehicleNumber}
                        </p>
                      )}
                    </div>
                    <div className="animate-fade-up rounded-2xl bg-ink-50 p-4" style={{ animationDelay: '70ms' }}>
                      <p className="flex items-center gap-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">
                        <IconUsers className="h-3.5 w-3.5" /> Chauffeur
                      </p>
                      <p className="mt-1.5 font-display text-md font-bold text-ink-900">
                        {trip.driverName || 'To be allotted'}
                      </p>
                      {trip.driverMobile && (
                        <a
                          href={`tel:+91${trip.driverMobile}`}
                          aria-label="Call the chauffeur"
                          className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700 hover:text-brand-800"
                        >
                          <IconPhone className="h-3.5 w-3.5" /> Call the chauffeur
                        </a>
                      )}
                    </div>
                  </div>
                  {trip.assignedAt && (
                    <p className="mt-3 text-2xs text-ink-400">Allotted {since(trip.assignedAt)}</p>
                  )}
                </>
              ) : (
                <p className="mt-3 rounded-2xl bg-ink-50 px-4 py-3.5 text-sm leading-relaxed text-ink-500">
                  Not allotted yet. The car and chauffeur are assigned closer to the journey, and you will get an
                  email from {COMPANY.email} with the registration number and the driver's mobile the moment they are.
                </p>
              )}
            </Reveal>

            {/* What actually happened, in order. */}
            {timeline.length > 0 && (
              <Reveal delay={140} className="tile p-6">
                <h2 className="font-display text-md font-bold text-ink-900">Activity</h2>
                <ol className="mt-4 space-y-0">
                  {timeline.map((e, i) => (
                    <li key={e.id} className="flex gap-3.5">
                      <span className="relative flex w-4 shrink-0 justify-center">
                        <span className="z-10 mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-300 ring-4 ring-white" />
                        {i < timeline.length - 1 && (
                          <span className="absolute bottom-0 top-4 w-0.5 origin-top animate-trail-grow rounded-full bg-ink-200" />
                        )}
                      </span>
                      <span className={`min-w-0 flex-1 ${i < timeline.length - 1 ? 'pb-4' : ''}`}>
                        <span className="block text-sm font-semibold text-ink-900">{e.title}</span>
                        {e.detail && <span className="block text-xs leading-relaxed text-ink-500">{e.detail}</span>}
                        <span className="mt-0.5 block text-2xs text-ink-400">{since(e.created_at)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </Reveal>
            )}
          </div>

          {/* ------------------------------ right ----------------------------- */}
          <div className="space-y-5">
            <InvoicePanel trip={trip} busy={busy} onAction={invoiceAction} />

            <Reveal delay={80} className="tile p-5">
              <h3 className="font-display text-md font-bold text-ink-900">Need to change something?</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                Quote <span className="font-mono font-semibold text-ink-700">{trip.tripId}</span> and the desk will
                find this trip straight away. We answer {COMPANY.serviceHours.toLowerCase()}.
              </p>
              <div className="mt-4 grid gap-2">
                <CallButton
                  className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-800"
                  label="Call the office"
                />
                <WhatsAppButton
                  prefill={{
                    pickup: trip.pickup ?? '',
                    drop: trip.drop ?? '',
                    date: trip.travelDate ?? '',
                    time: trip.journeyTime ?? '',
                    vehicleType: trip.vehicleType ?? '',
                    message: `About my existing trip ${trip.tripId}.`,
                  }}
                  className="btn h-11 w-full rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
                >
                  <IconWhatsApp className="h-4 w-4" /> WhatsApp us
                </WhatsAppButton>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <TrustRow compact />
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   The invoice
   ========================================================================== */

function InvoicePanel({
  trip, busy, onAction,
}: {
  trip: ServerTrip;
  busy: '' | 'download' | 'view';
  onAction: (kind: 'download' | 'view') => void;
}) {
  if (!trip.invoice) {
    return (
      <Reveal className="tile p-5">
        <h3 className="flex items-center gap-2 font-display text-md font-bold text-ink-900">
          <IconInvoices className="h-4 w-4 text-ink-400" /> Invoice
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          {trip.status === 'COMPLETED'
            ? 'Your trip is finished. The invoice appears here — and lands in your inbox — as soon as the office raises it.'
            : 'The invoice is raised once the journey is completed. It will appear here, and be emailed to you, automatically.'}
        </p>
        {trip.fare ? (
          <p className="mt-4 border-t border-ink-100 pt-4 text-sm text-ink-600">
            Agreed fare <span className="font-display text-lg font-bold text-ink-900">{inr(trip.fare)}</span>
          </p>
        ) : null}
      </Reveal>
    );
  }

  const inv = trip.invoice;
  return (
    <Reveal className="tile animate-pop-in overflow-hidden">
      <div className="bg-ok-50 px-5 py-4">
        <p className="flex items-center gap-2 text-2xs font-bold uppercase tracking-[0.12em] text-ok-700">
          <IconCheck className="h-3.5 w-3.5" /> {inv.gst ? 'GST invoice' : 'Invoice'} ready
        </p>
        <p className="mt-1.5 font-mono text-md font-bold text-ink-900">{inv.number}</p>
        <p className="mt-0.5 text-xs text-ink-500">{dmy(inv.date)}</p>
      </div>

      <div className="p-5">
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-500">Trip</dt>
            <dd className="font-mono text-xs font-semibold text-ink-700">{trip.tripId}</dd>
          </div>
          {inv.gst && inv.taxAmount > 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">
                {inv.taxMode === 'CGST_SGST' ? 'CGST + SGST' : 'IGST'} @ {inv.taxRate}%
              </dt>
              <dd className="font-semibold text-ink-800">{inr(inv.taxAmount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-2.5">
            <dt className="font-semibold text-ink-700">Total</dt>
            <dd className="font-display text-lg font-bold text-ink-900">{inr(inv.total)}</dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-2">
          <button
            onClick={() => onAction('download')} disabled={!!busy}
            className="grad-brand btn h-11 rounded-full text-sm font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99] disabled:opacity-70"
          >
            <IconDownload className="h-4 w-4" />
            {busy === 'download' ? 'Fetching…' : 'Download PDF'}
          </button>
          <button
            onClick={() => onAction('view')} disabled={!!busy}
            className="btn h-11 rounded-full bg-ink-50 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-70"
          >
            <IconExternal className="h-4 w-4" />
            {busy === 'view' ? 'Opening…' : 'View & print'}
          </button>
        </div>

        <p className="mt-3 text-2xs leading-relaxed text-ink-400">
          {inv.sentAt
            ? `Also emailed to you from ${COMPANY.email}.`
            : `This invoice stays in your account. Call us if you would like it emailed as well.`}
        </p>
      </div>
    </Reveal>
  );
}
