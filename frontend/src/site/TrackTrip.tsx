/**
 * Live trip tracking.
 *
 * The map area is a drawn plan of the route, not a live feed. This portal has no
 * vehicle telemetry and does not pay a map provider, so the screen says so
 * above the map in one line and gives the customer what actually helps at that
 * moment instead: the chauffeur's number, the registration, and the office on
 * one tap.
 *
 * A fake dot creeping along a road would test better in a demo and be worse
 * for the person standing outside at 5am.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dmy } from '../lib/format';
import { COMPANY, whatsappLink } from './siteData';
import { KIND_LABEL, trailState, useCustomer } from './tripStore';
import { BackLink, Callout, CopyChip, MapCanvas, SiteEmpty, StatusTrail, SampleTag } from './kit';
import { DriverCard } from './DriverCard';
import { ShareSheet } from './ShareTrip';
import { IconArrowRight, IconClock, IconPhone, IconPin } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

export default function TrackTrip() {
  const { ref } = useParams();
  const { trips } = useCustomer();
  const [sharing, setSharing] = useState(false);

  const trip = trips.find((t) => t.ref === ref);

  if (!trip) {
    return (
      <div className="page-bg min-h-screen pb-24 pt-28 sm:pt-32">
        <div className="shell">
          <BackLink to="/trips" className="mb-6" />
          <SiteEmpty
            emoji="📍"
            title="Nothing to track under that reference"
            body="Tracking opens once a chauffeur has been assigned to a trip on this device."
            action={<Link to="/trips" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">My trips</Link>}
          />
        </div>
      </div>
    );
  }

  const live = trip.status === 'ONTRIP';
  const assigned = trip.status === 'ASSIGNED' || live;
  const trail = trailState(trip);
  const driverNumber = trip.driver?.mobile || COMPANY.mobile;

  return (
    <div className="page-bg pb-32 pt-24 sm:pt-28 lg:pb-24">
      <div className="shell">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BackLink to={`/trips/${trip.ref}`} />
          <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
            <Link to="/trips" className="hover:text-brand-700">My trips</Link>
            <span className="text-ink-300">/</span>
            <Link to={`/trips/${trip.ref}`} className="font-mono hover:text-brand-700">{trip.ref}</Link>
            <span className="text-ink-300">/</span>
            <span className="font-medium text-ink-700">Track</span>
          </nav>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <CopyChip value={trip.ref} />
              <span className="text-2xs font-bold uppercase tracking-[0.12em] text-brand-600">Your trip</span>
              {trip.sample && <SampleTag />}
            </p>
            <h1 className="mt-2 font-display text-[1.8rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.2rem]">
              {trip.route || KIND_LABEL[trip.kind]}
            </h1>
            <p className="mt-2 text-sm text-ink-500">
              {[trip.date ? dmy(trip.date) : '', trip.time].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold ${
              live ? 'bg-ok-50 text-ok-700' : assigned ? 'bg-brand-50 text-brand-700' : 'bg-warn-50 text-warn-700'
            }`}
          >
            {live ? 'On trip' : assigned ? 'Chauffeur assigned' : 'Awaiting confirmation'}
          </span>
        </div>

        {/* ================================= MAP ================================= */}
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr,22rem] lg:gap-8">
          <div className="min-w-0">
            <MapCanvas from={trip.from} to={trip.to} live={live} className="aspect-[4/3] w-full sm:aspect-[16/10]" />

            <Callout tone="warn" className="mt-3">
              This is a plan of the route, not a live vehicle position. We do not run GPS telemetry on the fleet, and we
              would rather say so than animate something that is not real. For where the car is right now, call the
              chauffeur — the number is on this page and he answers.
            </Callout>

            {/* ---------------------------- status ---------------------------- */}
            <div className="tile mt-5 p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Trip status</h2>
              <div className="mt-5">
                <StatusTrail steps={trail} />
              </div>
            </div>

            {/* ------------------------------- eta ------------------------------- */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="tile mt-5 p-5">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Reporting time</p>
                <p className="mt-1.5 flex items-center gap-2 font-display text-xl font-bold text-ink-900">
                  <IconClock className="h-5 w-5 text-brand-500" /> {trip.time || 'To be confirmed'}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">
                  The chauffeur reports before this time, not at it. He calls you when he is outside.
                </p>
              </div>
              <div className="tile mt-5 p-5">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Pickup</p>
                <p className="mt-1.5 flex items-start gap-2 text-sm font-semibold text-ink-900">
                  <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> {trip.from || 'To be confirmed'}
                </p>
                {trip.eta && (
                  <p className="mt-2 text-xs leading-relaxed text-ink-500">
                    Last told to us: about {trip.eta} away.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* =============================== RAIL =============================== */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <DriverCard
              driver={trip.driver}
              vehicleNumber={trip.vehicleNumber}
              vehicleName={trip.vehicleName}
              sample={trip.sample}
            />

            <div className="tile p-5">
              <h2 className="font-display text-md font-bold text-ink-900">Anything wrong?</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                Car late, wrong vehicle, or a change of plan — one call to the office settles all three.
              </p>
              <div className="mt-4 space-y-2.5">
                <a href={`tel:+91${COMPANY.mobile}`} className="btn h-11 w-full rounded-full bg-ink-900 text-md text-white hover:bg-ink-800">
                  <IconPhone className="h-4 w-4" /> Call the office
                </a>
                <button onClick={() => setSharing(true)} className="btn h-11 w-full rounded-full bg-white text-md text-ink-800 shadow-card hover:shadow-raised">
                  Share trip
                </button>
                <Link to="/support?topic=driver" className="btn h-11 w-full rounded-full bg-ink-50 text-md text-ink-700 hover:bg-ink-100">
                  Support <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            <Link to={`/trips/${trip.ref}`} className="block text-center text-sm font-bold text-brand-700 hover:text-brand-800">
              Full trip details →
            </Link>
          </aside>
        </div>
      </div>

      {/* ---------- phones: the actions that matter, always reachable ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="flex gap-2">
          <a href={`tel:+91${driverNumber}`} className="btn h-11 flex-1 rounded-full bg-ink-900 text-sm text-white">
            <IconPhone className="h-4 w-4" /> Call
          </a>
          <a
            href={whatsappLink('Hello, this is about my booked trip.')}
            target="_blank" rel="noreferrer"
            className="btn h-11 flex-1 rounded-full bg-[#25D366] text-sm font-semibold text-white"
          >
            <IconWhatsApp className="h-4 w-4" /> WhatsApp
          </a>
          <button onClick={() => setSharing(true)} className="btn h-11 shrink-0 rounded-full bg-ink-50 px-5 text-sm text-ink-700">
            Share
          </button>
        </div>
      </div>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} trip={trip} />
    </div>
  );
}
