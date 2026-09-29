/**
 * Trip details.
 *
 * One route, two sources. When the visitor is signed in and the reference is a
 * Trip ID on their account, the office's own record is shown — live status, the
 * allotted car and chauffeur, the invoice (see AccountTripDetail.tsx). Otherwise
 * this device's copy of the request is shown, which is what a visitor without an
 * account has.
 *
 * In both views the status trail only marks a step done once the office has
 * actually confirmed it. Nothing advances on its own with the passage of time —
 * a trail that quietly ticks over to "driver assigned" because two days have
 * gone by is the kind of thing that gets someone standing on a pavement at 4am.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { dmy } from '../lib/format';
import { COMPANY } from './siteData';
import { addonByKey, vehicleBySlug } from './catalog';
import { cancelTrip, KIND_LABEL, removeTrip, trailState, useCustomer } from './tripStore';
import {
  BackLink, Callout, CopyChip, JourneyLine, MapCanvas, since, SiteEmpty, StatusTrail,
  TrustRow, SampleTag,
} from './kit';
import { DriverCard } from './DriverCard';
import { ShareSheet } from './ShareTrip';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { IconArrowRight, IconCheck, IconPhone, IconPin, IconTrash } from '../components/icons';
import { IconSeat, IconLuggage } from './SiteIcons';
import { useCustomerAuth } from '../lib/customerAuth';
import { useTrip } from './accountApi';
import AccountTripDetail from './AccountTripDetail';
import { Loading } from '../components/ui';
import { useSeo } from './Seo';

export default function TripDetail() {
  useSeo({ title: 'Trip details', noindex: true });
  const { ref } = useParams();
  const { user, loading: authLoading } = useCustomerAuth();

  // Ask the account first. A signed-in customer's own record beats this
  // device's copy of the same journey, and the local copy has no status.
  const { trip: accountTrip, timeline, loading: tripLoading } = useTrip(ref, !!user);

  if (authLoading || (user && tripLoading)) {
    return (
      <div className="page-bg grid min-h-[70vh] place-items-center">
        <Loading label="Loading your trip…" variant="inline" />
      </div>
    );
  }

  if (accountTrip) return <AccountTripDetail trip={accountTrip} timeline={timeline} />;

  return <DeviceTripDetail refId={ref} signedIn={!!user} />;
}

/** The trip as this browser remembers it — no account, so no live status. */
function DeviceTripDetail({ refId, signedIn }: { refId?: string; signedIn: boolean }) {
  const { trips } = useCustomer();
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // A Trip ID and this device's own reference both resolve here, because a
  // link in an email quotes the Trip ID and a link from My Trips may not.
  const trip = trips.find((t) => t.ref === refId || t.tripId === refId);

  if (!trip) {
    return (
      <div className="page-bg min-h-screen pb-24 pt-28 sm:pt-32">
        <div className="shell">
          <BackLink to="/trips" className="mb-6" />
          <SiteEmpty
            emoji="📄"
            title={signedIn ? 'That trip is not on your account' : 'That trip is not on this device'}
            body={signedIn
              ? 'It may have been booked with a different email address. Add it from My trips using its Trip ID and the mobile number on the booking, or call us and we will link it for you.'
              : 'Without an account, trips are kept in the browser you booked from. Sign in, open it on that device, or call us with the travel date and we will pull up the request.'}
            action={
              <>
                <Link to="/trips" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">My trips</Link>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </>
            }
          />
        </div>
      </div>
    );
  }

  const vehicle = vehicleBySlug(trip.vehicleSlug);
  const trail = trailState(trip);
  const points = [trip.from, ...trip.stops.filter(Boolean), trip.to].filter(Boolean);
  const trackable = trip.status === 'ASSIGNED' || trip.status === 'ONTRIP';

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
            <span className="font-mono font-medium text-ink-700">{trip.ref}</span>
          </nav>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <CopyChip value={trip.ref} />
              <span className="text-2xs font-bold uppercase tracking-[0.12em] text-brand-600">{KIND_LABEL[trip.kind]}</span>
              {trip.sample && <SampleTag />}
            </p>
            <h1 className="mt-2.5 font-display text-[1.7rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.2rem]">
              {trip.route || KIND_LABEL[trip.kind]}
            </h1>
            <p className="mt-2 text-sm text-ink-500">
              {[trip.date ? dmy(trip.date) : 'Date flexible', trip.time, trip.returnDate ? `return ${dmy(trip.returnDate)}` : '']
                .filter(Boolean).join(' · ')}
              <span className="text-ink-300"> · </span>sent {since(trip.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {trackable && (
              <Link
                to={`/trips/${trip.ref}/track`}
                className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white hover:brightness-[1.06]"
              >
                <IconPin className="h-4 w-4" /> Track
              </Link>
            )}
            <button onClick={() => setSharing(true)} className="btn h-11 rounded-full bg-white px-5 text-md text-ink-800 shadow-card hover:shadow-raised">
              Share trip
            </button>
            <Link to="/support" className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-white">
              Support
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr,21rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {/* ---------------------------- status trail ---------------------------- */}
            <div className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Trip status</h2>
              <div className="mt-5">
                <StatusTrail steps={trail} />
              </div>

              {trip.status === 'SENT' && (
                <Callout className="mt-4">
                  Your requirement is with the office. The steps below it are marked as still to come until we have
                  actually confirmed them with you — this page never guesses.
                </Callout>
              )}
              {trip.status === 'CANCELLED' && (
                <Callout tone="warn" className="mt-4">
                  Marked cancelled on this device. If you have not spoken to us yet, call the office so the
                  vehicle is released.
                </Callout>
              )}
            </div>

            {/* ------------------------------- route ------------------------------- */}
            <div className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Route</h2>
              {points.length >= 2 ? (
                <>
                  <div className="mt-4">
                    <JourneyLine
                      stops={points.map((p, i) => ({
                        label: p,
                        note: i === 0 ? 'Pickup' : i === points.length - 1 ? 'Final drop' : 'Stop',
                      }))}
                    />
                  </div>
                  <MapCanvas from={trip.from} to={trip.to} className="mt-4 aspect-[16/9]" />
                  <p className="mt-2.5 text-2xs leading-relaxed text-ink-400">
                    A plan of the route, not a live map. Live position is on the tracking screen once a chauffeur is on
                    the way.
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-ink-500">
                  This requirement has no fixed route — the office will confirm the itinerary with you.
                </p>
              )}
            </div>

            {/* ------------------------------ details ------------------------------ */}
            <div className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Trip information</h2>
              <dl className="mt-4 grid gap-4 sm:grid-cols-3">
                {[
                  ['Service', KIND_LABEL[trip.kind]],
                  ['Requested on', dmy(trip.createdAt.slice(0, 10))],
                  ['Date', trip.date ? dmy(trip.date) : 'Flexible'],
                  ['Reporting time', trip.time || 'To be confirmed'],
                  ['Return', trip.returnDate ? dmy(trip.returnDate) : 'One way'],
                ].map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
                    <dd className={`mt-1 truncate text-sm font-semibold text-ink-900 ${k === 'Reference' ? 'font-mono' : ''}`}>{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-100 pt-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-ink-800">
                  <IconSeat className="h-4 w-4 text-brand-500" /> {trip.passengers || '—'} passengers
                </span>
                {trip.bags && (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-ink-800">
                    <IconLuggage className="h-4 w-4 text-brand-500" /> {trip.bags}
                  </span>
                )}
              </div>

              {trip.addons.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Additional services asked for</p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {trip.addons.map((a) => (
                      <li key={a} className="rounded-full bg-brand-50 px-2.5 py-1 text-2xs font-semibold text-brand-700">
                        {addonByKey(a)?.label ?? a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {trip.legs && trip.legs.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-4">
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

              {trip.notes && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Notes sent with the request</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{trip.notes}</p>
                </div>
              )}
            </div>

            {/* ------------------------------ manage ------------------------------ */}
            <div className="tile p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Change or cancel</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                Tell us as early as you can and we will move the booking rather than cancel it wherever possible. A
                change close to the reporting time is told to you at the time if it attracts anything — it is never
                added quietly to the invoice.
              </p>
              <div className="mt-4 flex flex-wrap gap-2.5">
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                  <IconPhone className="h-4 w-4" /> Call to change
                </a>
                <Link to="/support?topic=change" className="btn h-11 rounded-full bg-white px-5 text-md text-ink-800 shadow-card hover:shadow-raised">
                  Support options
                </Link>
                {trip.status !== 'CANCELLED' && trip.status !== 'COMPLETED' && (
                  <button
                    onClick={() => setConfirming(true)}
                    className="btn h-11 rounded-full px-5 text-md text-danger-600 hover:bg-danger-50"
                  >
                    Mark as cancelled
                  </button>
                )}
                {trip.sample && (
                  <button
                    onClick={() => removeTrip(trip.ref)}
                    className="btn h-11 rounded-full px-5 text-md text-ink-500 hover:bg-ink-50"
                  >
                    <IconTrash className="h-4 w-4" /> Delete the example trip
                  </button>
                )}
              </div>

              {confirming && (
                <div className="mt-4 animate-fade-up rounded-2xl bg-danger-50 p-4">
                  <p className="text-sm font-semibold text-danger-700">Mark this trip cancelled on this device?</p>
                  <p className="mt-1 text-xs leading-relaxed text-danger-700/80">
                    This only changes your copy. Please also call the office so it releases the
                    vehicle — otherwise a chauffeur may still report.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => { cancelTrip(trip.ref); setConfirming(false); }}
                      className="btn h-10 rounded-full bg-danger-600 px-5 text-sm font-semibold text-white hover:bg-danger-700"
                    >
                      Yes, mark cancelled
                    </button>
                    <button onClick={() => setConfirming(false)} className="btn h-10 rounded-full bg-white px-5 text-sm text-ink-700">
                      Keep it
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* -------------------------------- rail -------------------------------- */}
          <aside className="space-y-5">
            {vehicle && (
              <div className="tile overflow-hidden">
                <div className="grad-soft">
                  <VehiclePhoto
                    photo={vehicle.photo} art={vehicle.art} name={vehicle.name} alt={vehicle.name}
                    className="aspect-[16/9] w-full object-cover"
                  />
                </div>
                <div className="p-5">
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Vehicle</p>
                  <p className="mt-1 font-display text-md font-bold text-ink-900">
                    {trip.vehicleCount > 1 && `${trip.vehicleCount} × `}{vehicle.name}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">{vehicle.seats} seats · {vehicle.bags} bags · {vehicle.comfort}</p>
                  <Link to={`/vehicles/${vehicle.slug}`} className="btn mt-3.5 h-10 w-full rounded-full bg-ink-50 text-sm text-ink-700 hover:bg-ink-100">
                    View vehicle <IconArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}

            <DriverCard
              driver={trip.driver}
              vehicleNumber={trip.vehicleNumber}
              vehicleName={trip.vehicleName}
              sample={trip.sample}
            />

            {typeof trip.estimate === 'number' && (
              <div className="tile p-5">
                <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Estimate at the time</p>
                <p className="mt-1.5 font-display text-xl font-bold text-ink-900">
                  ₹{Math.round(trip.estimate).toLocaleString('en-IN')}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-ink-500">
                  What the website worked out when you sent this. It is not a quote and not an invoice — the confirmed
                  rate is the one the office gives you, and toll, parking and permits are itemised on top at actuals.
                </p>
              </div>
            )}

            <TrustRow compact />
          </aside>
        </div>
      </div>

      <ShareSheet open={sharing} onClose={() => setSharing(false)} trip={trip} />
    </div>
  );
}
