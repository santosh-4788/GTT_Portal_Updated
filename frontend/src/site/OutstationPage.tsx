/**
 * Outstation booking - one way or return, at a fixed route fare.
 *
 * THE FLOW
 *   1. Trip details, then pick a destination from the popular routes (or Other).
 *      The drop typed in the booking bar only pre-selects a route; it is never
 *      priced on its own, because a free-text place has no published fare.
 *   2. Cab selection for that route: Standard, then SUV / MUV, then Premium,
 *      each with its fare for the chosen leg, toll included.
 *   3. Enquire on a vehicle: the sheet carries the route, vehicle and fare,
 *      records the trip and hands back a Trip ID.
 *   Other -> no price at all: the enquiry form, and the office quotes.
 *
 * Every step lives in the URL (?route=lonavala), so the browser's
 * Back button walks back through the steps and a link can be shared.
 *
 * The prices are the admin's Outstation fares master; nothing here knows one.
 * A category the office has not priced for this leg shows Fare on request and
 * leads to the enquiry form instead of a made-up number.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { nowLocalHm, todayLocalIso, dmy } from '../lib/format';
import {
  BackLink, Callout, CallButton, DmyDateField, PlaceInput, SegTabs, SoftField, SoftStepper,
  SOFT_INPUT_MUTED, TrustRow,
} from './kit';
import { EnquiryForm, type EnquiryPrefill } from './EnquirySheet';
import { VehicleCard } from './VehicleCard';
import { vehicleBySlug, type CatalogVehicle } from './catalog';
import {
  CATEGORY_META, CATEGORY_VEHICLES, fareOf, legLabel, matchRoute, routeLabel, useOutstationRoutes,
  type FareCategory, type Leg, type OutstationRoute, type RouteFare,
} from './outstation';
import { TimeField } from '../components/DateTimeField';
import { Reveal } from '../components/Reveal';
import {
  IconArrowRight, IconCalendar, IconCheck, IconClock, IconPin, IconUsers,
} from '../components/icons';
import { useSeo } from './Seo';

const FIELD_ICON = 'h-3 w-3';

/** "17:46" as "5:46 pm". */
function hm12(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hm;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

interface Trip {
  leg: Leg;
  from: string;
  to: string;
  date: string;
  time: string;
  returnDate: string;
  returnTime: string;
  pax: number;
  stops: string;
}

export default function OutstationPage() {
  useSeo({
    title: 'Outstation Cabs from Mumbai at Fixed Fares',
    path: '/outstation',
    description: 'Outstation taxi from Mumbai at fixed route fares, one way or return: Pune, Lonavala, Nashik, Alibaug, Shirdi, Mahabaleshwar, Surat, Ahmedabad and more. Toll included where the fare says so.',
  });
  const [params, setParams] = useSearchParams();
  const { routes, failed } = useOutstationRoutes();

  const trip: Trip = {
    leg: params.get('leg') === 'RETURN' ? 'RETURN' : 'ONE_WAY',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    date: params.get('date') || todayLocalIso(),
    time: params.get('time') || nowLocalHm(),
    returnDate: params.get('return') ?? '',
    returnTime: params.get('returnTime') ?? '',
    pax: Math.max(1, Number(params.get('pax')) || 2),
    stops: params.get('stops') ?? '',
  };

  const routeKey = params.get('route') ?? '';
  const route = routes?.find((r) => r.key === routeKey);

  /** Change the URL. `step` pushes a history entry so Back returns to it. */
  const update = (patch: Record<string, string | null>, step = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k); else next.set(k, v);
    }
    setParams(next, { replace: !step });
    if (step) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const onBack = () => {
    if (params.get('route')) { update({ route: null }); return true; }
    return false;
  };

  const step = routeKey === 'other' ? 'other' : route ? 'vehicle' : 'destination';

  return (
    <div className="page-bg pb-24 pt-24 sm:pt-28">
      <div className="shell">
        <div className="mx-auto max-w-4xl">
          <BackLink to="/" className="mb-4" onBack={onBack} />

          <Reveal>
            <p className="lead">Outstation cabs from Mumbai</p>
            <h1 className="mt-1 font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
              {step === 'destination' && 'Where are you headed?'}
              {step === 'vehicle' && route && routeLabel(route)}
              {step === 'other' && 'Request a quote'}
            </h1>
            {step === 'destination' && (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
                One way or return from anywhere in Mumbai, at a fixed fare for each route and vehicle, with a chauffeur.
              </p>
            )}
          </Reveal>

          {routes === null ? (
            <div className="tile mt-7 p-10 text-center text-sm text-ink-500">Loading routes and fares…</div>
          ) : (
            <>
              {step === 'destination' && (
                <DestinationStep
                  trip={trip} routes={routes} failed={failed} legChosen={params.has('leg')}
                  onTrip={(patch) => update(patch)}
                  onPick={(key) => update({ route: key }, true)}
                />
              )}
              {step === 'vehicle' && route && (
                <VehicleStep
                  trip={trip} route={route}
                  onEdit={() => update({ route: null }, true)}
                  onSwitchReturn={() => update({ route: null, leg: 'RETURN', to: route.destination }, true)}
                />
              )}
              {step === 'other' && <OtherStep trip={trip} />}
            </>
          )}

          <div className="mt-9 flex flex-wrap items-center justify-between gap-4">
            <TrustRow compact />
            <p className="flex items-center gap-1.5 text-xs text-ink-400">
              <IconCheck className="h-3.5 w-3.5 text-ok-500" /> Fares include toll unless marked otherwise
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Step 1 - One way: destination names only. Return: the full form.
   ========================================================================== */

function DestinationStep({
  trip, routes, failed, legChosen, onTrip, onPick,
}: {
  trip: Trip; routes: OutstationRoute[]; failed: boolean;
  /** Nothing is pre-selected: One way or Return decides what is shown. */
  legChosen: boolean;
  onTrip: (patch: Record<string, string | null>) => void;
  onPick: (key: string) => void;
}) {
  const [error, setError] = useState('');
  const today = todayLocalIso();

  /** Return: search the fixed-fare routes for the drop; anywhere else is quoted. */
  const searchReturn = () => {
    if (!trip.from.trim()) return setError('Please tell us the pickup point.');
    if (!trip.to.trim()) return setError('Where are you travelling to?');
    if (!trip.date) return setError('Please choose the departure date.');
    if (!trip.time) return setError('Please choose the departure time.');
    if (!trip.returnDate) return setError('Which day are you coming back?');
    if (trip.returnDate < trip.date) return setError('The return date is before the departure.');
    setError('');
    onPick(matchRoute(routes, trip.to)?.key ?? 'other');
  };

  return (
    <>
      <Reveal delay={60} className="tile mt-7 p-4 sm:p-6">
        <SegTabs
          value={(legChosen ? trip.leg : '') as Leg}
          onChange={(v) => { onTrip({ leg: v, ...(v === 'ONE_WAY' ? { return: null, returnTime: null } : {}) }); setError(''); }}
          options={[{ value: 'ONE_WAY', label: 'One way' }, { value: 'RETURN', label: 'Return' }]}
          className="w-full sm:max-w-[15rem]"
        />

        {!legChosen && (
          <p className="mt-4 px-1 text-sm text-ink-500">
            Choose <span className="font-semibold text-ink-700">One way</span> or{' '}
            <span className="font-semibold text-ink-700">Return</span>.
          </p>
        )}

        {/* One way: only the places. Prices and cars are on the next page;
            trip details are asked on the summary, or straight away for Other. */}
        {legChosen && trip.leg === 'ONE_WAY' && (
          <div className="mt-5">
            <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Select destination</p>
            {failed && (
              <Callout tone="warn" className="mt-3">
                We could not load the destinations just now. Choose Other and we will quote you, or call us.
              </Callout>
            )}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {[...routes.map((r) => ({ key: r.key, label: routeLabel(r) })), { key: 'other', label: 'Other' }].map((d) => (
                <button
                  key={d.key} type="button" onClick={() => onPick(d.key)}
                  className="group flex items-center justify-between gap-3 rounded-2xl bg-ink-50 px-4 py-4 text-left transition-colors hover:bg-ink-900"
                >
                  <span className="truncate text-sm font-bold text-ink-900 group-hover:text-white">{d.label}</span>
                  <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-white" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Return: the full outstation form. */}
        {legChosen && trip.leg === 'RETURN' && (
          <>
            <div className="mt-4 grid gap-2 rounded-[1.4rem] bg-ink-50/80 p-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0 sm:col-span-2">
                <PlaceInput
                  label="Pickup" variant="soft" value={trip.from} id="os-from"
                  onChange={(v) => { onTrip({ from: v }); setError(''); }}
                  placeholder="Andheri East" icon={<IconPin className={FIELD_ICON} />}
                />
              </div>
              <div className="min-w-0 sm:col-span-2">
                <PlaceInput
                  label="Drop" variant="soft" value={trip.to} id="os-to"
                  onChange={(v) => { onTrip({ to: v }); setError(''); }}
                  placeholder="Lonavala" icon={<IconPin className={FIELD_ICON} />}
                />
              </div>
              <SoftField label="Departure" htmlFor="os-date" icon={<IconCalendar className={FIELD_ICON} />}>
                <DmyDateField id="os-date" value={trip.date} min={today} muted onChange={(v) => onTrip({ date: v })} />
              </SoftField>
              <SoftField label="Departs at" htmlFor="os-time" icon={<IconClock className={FIELD_ICON} />}>
                <TimeField
                  id="os-time" value={trip.time} onChange={(v) => onTrip({ time: v })} placeholder="Pick a time"
                  baseClass={SOFT_INPUT_MUTED} chevron={false} showIcon={false}
                />
              </SoftField>
              <SoftField label="Return date" htmlFor="os-return" icon={<IconCalendar className={FIELD_ICON} />}>
                <DmyDateField
                  id="os-return" value={trip.returnDate} min={trip.date || today} muted
                  onChange={(v) => { onTrip({ return: v }); setError(''); }}
                />
              </SoftField>
              <SoftField label="Return time" htmlFor="os-return-time" icon={<IconClock className={FIELD_ICON} />}>
                <TimeField
                  id="os-return-time" value={trip.returnTime} onChange={(v) => onTrip({ returnTime: v })}
                  placeholder="Select time" baseClass={SOFT_INPUT_MUTED} chevron={false} showIcon={false}
                />
              </SoftField>
              <SoftField label="Passengers" htmlFor="os-pax" icon={<IconUsers className={FIELD_ICON} />}>
                <SoftStepper id="os-pax" value={trip.pax} onChange={(n) => onTrip({ pax: String(n) })} min={1} max={60} />
              </SoftField>
            </div>
            {error && <p className="error-text mt-3">{error}</p>}
            <div className="mt-4 flex justify-end">
              <button
                type="button" onClick={searchReturn}
                className="grad-brand btn h-11 rounded-full px-8 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:brightness-[1.06]"
              >
                Search <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </Reveal>
    </>
  );
}

/* ==========================================================================
   Trip line shown above steps 2 and 3
   ========================================================================== */

function TripLine({ trip, route, onEdit }: { trip: Trip; route: OutstationRoute; onEdit?: () => void }) {
  // A one-way customer has only picked the destination so far; the rest is
  // asked on the summary, so it is not shown here as if they had said it.
  const given = !!trip.from.trim();
  const bits = [
    legLabel(trip.leg),
    given ? `${trip.pax} ${trip.pax === 1 ? 'passenger' : 'passengers'}` : '',
    given ? `${dmy(trip.date)}, ${hm12(trip.time)}` : '',
    trip.leg === 'RETURN' && trip.returnDate
      ? `back ${dmy(trip.returnDate)}${trip.returnTime ? `, ${hm12(trip.returnTime)}` : ''}`
      : '',
  ].filter(Boolean);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card">
      <p className="min-w-0 text-sm text-ink-600">
        <span className="font-semibold text-ink-900">{given ? trip.from : route.origin} → {route.destination}</span>
        <span className="text-ink-400"> · {bits.join(' · ')}</span>
      </p>
      {onEdit && (
        <button type="button" onClick={onEdit} className="-my-2.5 px-1 py-2.5 text-xs font-bold text-brand-700 hover:text-brand-800">
          Change
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
   Step 2 - the vehicles for this route, at its fixed fares
   ==========================================================================
   Laid out like the vehicle search results - the same cards, photos and
   Enquire / WhatsApp / Call - but priced from the route's fare master rather
   than the per-km rate card. Enquire opens the sheet with the route, vehicle
   and fare already on it; the server prices it again from the master.
   ========================================================================== */

function VehicleStep({
  trip, route, onEdit, onSwitchReturn,
}: {
  trip: Trip; route: OutstationRoute;
  onEdit: () => void; onSwitchReturn: () => void;
}) {
  const fares = [...route.fares].sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order);
  const groups = fares.reduce<{ name: string; items: { fare: RouteFare; vehicle: CatalogVehicle }[] }[]>((acc, f) => {
    const name = CATEGORY_META[f.category].group;
    let g = acc.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; acc.push(g); }
    for (const slug of CATEGORY_VEHICLES[f.category]) {
      const vehicle = vehicleBySlug(slug);
      if (vehicle) g.items.push({ fare: f, vehicle });
    }
    return acc;
  }, []);

  const drop = trip.to.toLowerCase().includes(route.destination.toLowerCase()) ? trip.to : route.destination;
  const given = !!trip.from.trim();

  const prefillFor = (fare: RouteFare, vehicle: CatalogVehicle): EnquiryPrefill => {
    const amount = fareOf(fare, trip.leg);
    return {
      pickup: trip.from || undefined,
      drop,
      date: given ? trip.date : undefined,
      time: given ? trip.time : undefined,
      vehicleType: vehicle.name,
      passengers: given ? trip.pax : undefined,
      fields: trip.leg === 'RETURN'
        ? { tripLeg: 'Round trip', returnDate: trip.returnDate }
        : { tripLeg: 'One way' },
      message: [
        trip.leg === 'RETURN' && trip.returnTime ? `Return time: ${hm12(trip.returnTime)}` : '',
        trip.stops ? `Extra stops: ${trip.stops}` : '',
      ].filter(Boolean).join('. ') || undefined,
      // Only a priced fare is sent as one; an unpriced category is a plain enquiry.
      outstation: amount != null ? { routeKey: route.key, category: fare.category, leg: trip.leg } : undefined,
      fareText: amount != null
        ? `₹${amount.toLocaleString('en-IN')} · ${fare.tollIncluded ? 'toll included' : 'toll extra'} · ${legLabel(trip.leg).toLowerCase()}`
        : undefined,
    };
  };

  return (
    <>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card">
        <p className="min-w-0 text-sm text-ink-600">
          <span className="font-semibold text-ink-900">{given ? trip.from : route.origin} → {route.destination}</span>
          <span className="text-ink-400">
            {' · '}{legLabel(trip.leg)}
            {given && ` · ${trip.pax} ${trip.pax === 1 ? 'passenger' : 'passengers'} · ${dmy(trip.date)}, ${hm12(trip.time)}`}
            {trip.leg === 'RETURN' && trip.returnDate && ` · back ${dmy(trip.returnDate)}`}
          </span>
        </p>
        <button type="button" onClick={onEdit} className="-my-2.5 px-1 py-2.5 text-xs font-bold text-brand-700 hover:text-brand-800">
          Change
        </button>
      </div>
      {trip.leg === 'ONE_WAY' && (
        <p className="mt-3 px-1 text-xs text-ink-500">
          Coming back too?{' '}
          <button type="button" onClick={onSwitchReturn} className="-my-2.5 py-2.5 font-semibold text-brand-700 hover:text-brand-800">
            Switch to Return
          </button>{' '}
          for return fares.
        </p>
      )}

      <div className="mt-6 space-y-9">
        {groups.map((g, gi) => (
          <div key={g.name}>
            <div className="mb-3 flex items-baseline gap-2">
              <h3 className="font-display text-md font-bold text-ink-900">{g.name}</h3>
              <span className="text-xs text-ink-400">{g.items.length} vehicles</span>
            </div>
            <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
              {g.items.map(({ fare, vehicle }, i) => (
                <Reveal key={vehicle.slug} delay={(i % 3) * 60}>
                  <VehicleCard
                    vehicle={vehicle}
                    index={gi * 2 + i}
                    compact
                    fixedFare={{ amount: fareOf(fare, trip.leg), tollIncluded: fare.tollIncluded, legLabel: legLabel(trip.leg) }}
                    contact={prefillFor(fare, vehicle)}
                  />
                </Reveal>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/* ==========================================================================
   Other - no price, a quote request
   ========================================================================== */

function OtherStep({ trip }: { trip: Trip }) {
  return (
    <>
      <Reveal delay={60} className="mt-7 rounded-2xl bg-brand-50 px-5 py-4 text-brand-900">
        <p className="font-bold">Fare on request</p>
        <p className="mt-1 text-sm leading-relaxed">
          Our team will review your route and provide the applicable fare and vehicle options. Send the details
          below and you get an enquiry ID straight away.
        </p>
      </Reveal>
      <Reveal delay={100} className="tile mt-5 p-5 sm:p-7">
        <EnquiryForm
          variant="page"
          category="outstation"
          prefill={{
            pickup: trip.from || undefined,
            drop: trip.to || undefined,
            date: trip.date,
            time: trip.time,
            passengers: trip.pax,
            fields: trip.leg === 'RETURN'
              ? { tripLeg: 'Round trip', returnDate: trip.returnDate }
              : { tripLeg: 'One way' },
            message: trip.stops ? `Extra stops: ${trip.stops}` : undefined,
          }}
        />
      </Reveal>
      <p className="mt-4 text-center text-xs text-ink-400">
        Rather talk it through? <CallButton className="font-semibold text-brand-700" iconClass="hidden" label="Call us" />
      </p>
    </>
  );
}
