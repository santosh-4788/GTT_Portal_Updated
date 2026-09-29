/**
 * "We've got your request."
 *
 * The screen after any of the journeys on this site. It does three things the
 * usual "thank you, we will get back to you" page does not: it gives a
 * reference, it repeats the requirement back so the customer can check we heard
 * it right, and it says what happens next and by when.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dmy } from '../lib/format';
import { COMPANY, whatsappLink } from './siteData';
import { addonByKey } from './catalog';
import { KIND_LABEL, useCustomer } from './tripStore';
import { BackLink, Callout, CopyChip, SiteEmpty, TrustRow } from './kit';
import { ShareSheet, tripText } from './ShareTrip';
import { Reveal } from '../components/Reveal';
import { useCustomerAuth } from '../lib/customerAuth';
import { IconArrowRight, IconCheck, IconClock, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { useSeo } from './Seo';

export default function RequestSubmitted() {
  useSeo({ title: 'Request received', noindex: true });
  const { ref } = useParams();
  const { trips } = useCustomer();
  const [sharing, setSharing] = useState(false);

  const trip = trips.find((t) => t.ref === ref || t.tripId === ref);

  if (!trip) {
    return (
      <div className="page-bg min-h-screen pb-24 pt-28 sm:pt-32">
        <div className="shell">
          <BackLink to="/trips" className="mb-6" />
          <SiteEmpty
            emoji="📄"
            title="We cannot find that reference on this device"
            body="References are kept in the browser you sent the request from. If you sent it from your phone, open it there — or call us with your travel date and we will find it."
            action={
              <>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
                <Link to="/trips" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  My trips
                </Link>
              </>
            }
          />
        </div>
      </div>
    );
  }

  const rows: [string, string][] = [
    ['Service', KIND_LABEL[trip.kind]],
    ['Route', trip.route || '—'],
    ['Date', trip.date ? dmy(trip.date) : 'Flexible'],
    ['Reporting time', trip.time || 'To be confirmed'],
    ['Return', trip.returnDate ? dmy(trip.returnDate) : 'One way'],
    ['Passengers', trip.passengers ? String(trip.passengers) : '—'],
    ['Luggage', trip.bags || '—'],
    ['Vehicle', trip.vehicleName ? `${trip.vehicleCount > 1 ? `${trip.vehicleCount} × ` : ''}${trip.vehicleName}` : 'We will recommend one'],
  ];

  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mx-auto max-w-3xl">
          <BackLink to="/trips" className="mb-6" />

          {/* ============================== HEADLINE ============================== */}
          <Reveal className="text-center">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok-50 text-ok-600">
              <IconCheck className="h-10 w-10" />
            </span>
            <h1 className="mt-6 font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.6rem]">
              We&rsquo;ve got your request.
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-md leading-[1.7] text-ink-600">
              It is with the office now. {COMPANY.owner} or one of the desk will call you
              {trip.date ? ` about ${dmy(trip.date)}` : ''} — usually within the hour, and always the same day.
            </p>

{/* The office's own Trip ID when the enquiry reached them, this device's
                reference when it did not. Never both: two numbers on this panel
                is two numbers to read out wrong. */}
            <div className="mx-auto mt-7 inline-flex animate-pop-in flex-col items-center rounded-2xl bg-white px-7 py-4 shadow-card">
              <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">
                {trip.tripId ? 'Your Trip ID' : 'Your reference'}
              </span>
              <span className="mt-1 font-mono text-lg font-bold tracking-tight text-brand-700">
                {trip.tripId ?? trip.ref}
              </span>
              <CopyChip value={trip.tripId ?? trip.ref} className="mt-2.5" />
              <span className="mt-2 text-2xs text-ink-400">
                {trip.tripId ? 'Quote this on any call or message' : 'Saved here — call us to confirm we received it'}
              </span>
            </div>

            <AccountNudge tripId={trip.tripId} />
          </Reveal>

          {/* ============================= WHAT WE HEARD ============================= */}
          <Reveal delay={80} className="tile mt-9 p-6 sm:p-8">
            <h2 className="font-display text-md font-bold text-ink-900">What we heard</h2>
            <p className="mt-1.5 text-sm text-ink-500">Read it over. If anything is wrong, call and we will change it before the vehicle is assigned.</p>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {rows.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
                  <dd className="mt-1 text-sm font-semibold text-ink-900">{v}</dd>
                </div>
              ))}
            </dl>

            {trip.stops.length > 0 && (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Stops</p>
                <p className="mt-1 text-sm font-semibold text-ink-900">{trip.stops.filter(Boolean).join('  →  ')}</p>
              </div>
            )}

            {trip.legs && trip.legs.length > 0 && (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Requirement</p>
                <ul className="mt-2 space-y-1.5">
                  {trip.legs.map((l, i) => (
                    <li key={`${l.label}-${i}`} className="flex gap-2 text-sm text-ink-600">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" />
                      <span><span className="font-semibold text-ink-800">{l.label}</span>{l.detail ? ` — ${l.detail}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {trip.addons.length > 0 && (
              <div className="mt-5 border-t border-ink-100 pt-4">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Also asked for</p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {trip.addons.map((a) => (
                    <li key={a} className="rounded-full bg-brand-50 px-2.5 py-1 text-2xs font-semibold text-brand-700">
                      {addonByKey(a)?.label ?? a}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {typeof trip.estimate === 'number' && (
              <div className="mt-5 rounded-2xl bg-ink-50/70 p-4">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Estimate you were shown</p>
                <p className="mt-1 font-display text-lg font-bold text-ink-900">
                  ₹{Math.round(trip.estimate).toLocaleString('en-IN')}
                  <span className="ml-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-warn-700">estimate</span>
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                  Indicative only. The confirmed rate comes back on the call, and toll, parking and any permit are
                  itemised on top at actuals.
                </p>
              </div>
            )}
          </Reveal>

          {/* ============================== WHAT NEXT ============================== */}
          <Reveal delay={140} className="tile mt-5 p-6 sm:p-8">
            <h2 className="font-display text-md font-bold text-ink-900">What happens next</h2>
            <ol className="mt-5 space-y-0">
              {[
                ['We check availability', 'The vehicle class you asked for, for that date and reporting time.'],
                ['You get the rate', 'By phone, with what is included and what is billed on top spelled out.'],
                ['You confirm', 'Nothing is charged and no vehicle is held until you say yes.'],
                ['Vehicle and chauffeur details', 'Registration, name and mobile sent to you before the reporting time.'],
              ].map(([t, b], i, arr) => (
                <li key={t} className="flex gap-3.5">
                  <span className="relative flex w-5 shrink-0 justify-center">
                    <span className={`z-10 mt-1 grid h-4 w-4 place-items-center rounded-full ring-4 ring-white ${i === 0 ? 'bg-brand-500' : 'bg-ink-200'}`}>
                      {i === 0 && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </span>
                    {i < arr.length - 1 && <span className="absolute bottom-0 top-4 w-0.5 rounded-full bg-ink-200" />}
                  </span>
                  <span className="min-w-0 flex-1 pb-5">
                    <span className="block text-sm font-semibold text-ink-900">{t}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{b}</span>
                  </span>
                </li>
              ))}
            </ol>

            <Callout className="mt-1">
              <IconClock className="mr-1 inline h-3.5 w-3.5" />
              Travelling in the next few hours? Call the office instead of waiting for the call back —
              the desk is answered {COMPANY.serviceHours.toLowerCase()}.
            </Callout>
          </Reveal>

          {/* ============================== ACTIONS ============================== */}
          <Reveal delay={200} className="mt-7 flex flex-wrap gap-3">
            <Link
              to={`/trips/${trip.ref}`}
              className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
            >
              View trip <IconArrowRight className="h-4 w-4" />
            </Link>
            <button onClick={() => setSharing(true)} className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
              Share trip
            </button>
            <a
              href={whatsappLink(tripText(trip))}
              target="_blank" rel="noreferrer"
              className="btn h-12 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white hover:bg-[#1FB855]"
            >
              <IconWhatsApp className="h-4 w-4" /> Send on WhatsApp
            </a>
            <Link to="/support" className="btn h-12 rounded-full px-5 text-md text-ink-600 hover:bg-white">
              Contact support
            </Link>
          </Reveal>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
            <TrustRow compact />
            <Link to="/" className="text-sm font-bold text-brand-700 hover:text-brand-800">Back to home →</Link>
          </div>

          <p className="mt-8 text-xs leading-relaxed text-ink-400">
            Your reference and this summary are kept in this browser so you can find them again under My Trips. Clearing
            your browser data removes them — the office's copy of the request is not affected.
          </p>
        </div>
      </div>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} trip={trip} />
    </div>
  );
}

/* ==========================================================================
   Where the trip goes next
   ========================================================================== */

/**
 * Offered once, right after the enquiry lands, because this is the moment the
 * customer cares most about being able to follow it. Hidden entirely for
 * somebody already signed in — they can simply open My trips.
 */
function AccountNudge({ tripId }: { tripId?: string }) {
  const { user, loading } = useCustomerAuth();
  if (loading || !tripId) return null;

  if (user) {
    return (
      <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed text-ink-500">
        This trip is on your account. Follow its status, the allotted vehicle and driver, and the invoice
        from{' '}
        <Link to={`/trips/${tripId}`} className="font-bold text-brand-700 hover:text-brand-800">My trips</Link>.
      </p>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-md rounded-2xl bg-brand-50/70 px-5 py-4 text-center ring-1 ring-inset ring-brand-100">
      <p className="text-sm leading-relaxed text-ink-700">
        <strong className="font-semibold text-ink-900">Want to follow this trip?</strong> Create a free account
        with the same email address and it appears there with live status, the allotted car and chauffeur, and
        your invoice once the journey is done.
      </p>
      <Link
        to="/account?mode=signup"
        className="grad-brand btn mt-3.5 h-10 rounded-full px-5 text-sm font-semibold text-white transition-[filter] hover:brightness-[1.06]"
      >
        Create my account <IconArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
