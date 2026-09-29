/**
 * Build my trip.
 *
 * Six steps, a live summary that updates as you change anything, and a real
 * multi-stop route — Mumbai → Lonavala → Mahabaleshwar → Mumbai is one trip
 * here, not three enquiries.
 *
 * The estimate re-runs on every change and stays visible throughout, because
 * the thing customers hate most about booking travel is finding out the price
 * only at the end.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { ADDONS, addonByKey, vehicleBySlug, type PlanType } from './catalog';
import { DESTINATIONS, lookupDistance } from './places';
import { recommend, type Bags } from './recommend';
import { BAG_LABEL } from './recommend';
import { readTrip, tripQuery } from './tripParams';
import { VehicleCard } from './VehicleCard';
import {
  BackLink, BottomSheet, Callout, ChoiceCard, ContactFields, Counter, EstimatePanel, JourneyLine,
  PlaceInput, SegTabs, Stepper, SubmitButton, TrustRow, estimateFor, useContactDetails,
  useRates, useSendRequirement, CompareProvider, CallButton,
  DistanceNote, useRouteDistance, type PlacePick, emailError,
} from './kit';
import { IconArrowRight, IconCheck, IconChevron, IconPin, IconPlus, IconTrash } from '../components/icons';
import { IconSeat, IconLuggage } from './SiteIcons';
import { DateField, TimeField } from '../components/DateTimeField';

const STEPS = ['Where', 'When', 'Who', 'Vehicle', 'Extras', 'Review'];

/**
 * Approximate route distance.
 *
 * Built from the published distances of the destinations we advertise, treated
 * as points along a corridor out of Mumbai. It is close for the routes people
 * actually chain together — Lonavala then Mahabaleshwar, say — and wrong for
 * two places in opposite directions, so it is labelled approximate everywhere
 * it appears and the real figure is confirmed on the quote.
 *
 * The pickup is the exception: it is a Mumbai address, which is not in the
 * destination list and never will be, so an unresolved FIRST point counts as
 * the origin. An unresolved point anywhere else means we genuinely do not know
 * the distance, and the screen says so instead of guessing.
 */
function routeDistance(points: string[]): number | undefined {
  if (points.length < 2) return undefined;

  const resolved = points.map((p, i) => {
    const km = lookupDistance(p);
    return km === undefined ? (i === 0 ? 0 : undefined) : km;
  });
  if (resolved.some((k) => k === undefined)) return undefined;

  const d = resolved as number[];
  let total = d[0];
  for (let i = 1; i < d.length; i++) total += Math.abs(d[i] - d[i - 1]);
  return Math.round(total);
}

function hoursFor(km: number, stops: number): string {
  const h = km / 45 + stops * 0.5;
  if (h < 1) return 'under an hour';
  return `≈${h < 10 ? h.toFixed(1) : Math.round(h)} hrs of driving`;
}

export default function BuildTrip() {
  const [params] = useSearchParams();
  const initial = readTrip(params);
  const book = useRates();
  const { send, busy, error, setError } = useSendRequirement();

  const [at, setAt] = useState(0);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const [scope, setScope] = useState<'LOCAL' | 'OUTSTATION'>(
    initial.tab === 'OUTSTATION' || lookupDistance(initial.to) ? 'OUTSTATION' : 'LOCAL'
  );
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [stops, setStops] = useState<string[]>([]);

  // Coordinates for the two ends, when the customer picked from the list.
  const [fromPt, setFromPt] = useState<PlacePick | null>(null);
  const [toPt, setToPt] = useState<PlacePick | null>(null);
  const route = useRouteDistance(
    { text: from, lat: fromPt?.lat, lon: fromPt?.lon },
    { text: to, lat: toPt?.lat, lon: toPt?.lon },
  );
  const [roundTrip, setRoundTrip] = useState(true);

  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [returnDate, setReturnDate] = useState(initial.returnDate);

  const [pax, setPax] = useState(initial.pax);
  const [bags, setBags] = useState<Bags>('medium');

  const [vehicleSlug, setVehicleSlug] = useState(params.get('vehicle') ?? '');
  const [addons, setAddons] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, [at]);

  /* ---------------------------------------------------------------- route */
  const points = useMemo(
    () => [from, ...stops, to, ...(roundTrip && scope === 'OUTSTATION' && from ? [from] : [])].filter(Boolean),
    [from, stops, to, roundTrip, scope]
  );
  const km = useMemo(() => routeDistance(points), [points]);

  const days = useMemo(() => {
    if (!date || !returnDate) return 1;
    const ms = new Date(returnDate).getTime() - new Date(date).getTime();
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) + 1 : 1;
  }, [date, returnDate]);

  /* ------------------------------------------------------------- vehicles */
  const suggestions = useMemo(
    () =>
      recommend({
        passengers: pax,
        bags,
        scope: scope === 'OUTSTATION' ? 'outstation' : 'local',
        length: days > 2 ? 'multi-day' : days === 2 ? 'overnight' : 'full-day',
        priority: 'comfort',
      }).slice(0, 4),
    [pax, bags, scope, days]
  );

  const chosen = vehicleBySlug(vehicleSlug) ?? suggestions[0]?.vehicle;
  const chosenCount = suggestions.find((s) => s.vehicle.slug === chosen?.slug)?.count ?? 1;

  const plan: PlanType = scope === 'OUTSTATION' ? 'OUTSTATION' : 'LOCAL';
  const est = chosen
    ? estimateFor(book, chosen, { plan, days, distanceKm: km, vehicles: chosenCount })
    : { estimate: null, planLabel: '', reason: 'no-rate' as string | undefined };

  /* --------------------------------------------------------------- submit */
  const canAdvance = (): string => {
    if (at === 0) {
      if (!from.trim()) return 'Where should the vehicle report?';
      if (!to.trim()) return 'Where are you going?';
    }
    if (at === 1 && !date) return 'Please pick the travel date.';
    return '';
  };

  const next = () => {
    const problem = canAdvance();
    if (problem) { setError(problem); return; }
    setError('');
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  };

  /** One step back means the previous step of the trip, not the previous page. */
  const stepBack = (): boolean => {
    if (at > 0) { setError(''); setAt((i) => i - 1); return true; }
    return false;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    send({
      kind: scope === 'OUTSTATION' ? 'OUTSTATION' : 'LOCAL',
      from, to, stops,
      date, time, returnDate,
      passengers: pax,
      bags: BAG_LABEL[bags],
      vehicleSlug: chosen?.slug,
      vehicleName: chosen?.name,
      vehicleCount: chosenCount,
      addons: addons.map((k) => addonByKey(k)?.label ?? k),
      estimate: est.estimate?.total ?? null,
      notes: [
        notes,
        km ? `Approximate route distance ${km} km (${hoursFor(km, stops.length)})` : '',
        roundTrip && scope === 'OUTSTATION' ? 'Round trip' : '',
      ].filter(Boolean).join('. '),
      name: contact.name,
      mobile: contact.mobile,
      email: contact.noEmail ? '' : contact.email,
      company: contact.company,
    });
  };

  /* ======================================================================
     The live summary — a rail on desktop, a sheet on a phone
     ====================================================================== */
  const Summary = (
    <div className="space-y-5">
      <EstimatePanel estimate={est.estimate} planLabel={est.planLabel} reason={est.reason} vehicles={chosenCount} />

      <div className="tile p-5">
        <h2 className="font-display text-md font-bold text-ink-900">Your trip</h2>

        {points.length >= 2 ? (
          <div className="mt-4">
            <JourneyLine stops={points.map((p, i) => ({ label: p, note: i === 0 ? 'Pickup' : i === points.length - 1 ? 'Final drop' : 'Stop' }))} />
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">Add a pickup and a destination and the route will draw here.</p>
        )}

        <dl className="mt-5 space-y-2.5 border-t border-ink-100 pt-4 text-sm">
          {[
            ['Trip type', scope === 'OUTSTATION' ? 'Outstation' : 'Within Mumbai'],
            ['Stops', String(Math.max(0, points.length - 2))],
            ['Approx. distance', km ? `${km} km` : 'Confirmed on the quote'],
            ['Approx. driving', km ? hoursFor(km, stops.length) : '—'],
            ['Date', date || 'Not set'],
            ['Reporting time', time || 'Not set'],
            ['Days', days > 1 ? `${days} days` : 'Single day'],
            ['Passengers', String(pax)],
            ['Luggage', BAG_LABEL[bags]],
            ['Vehicle', chosen ? `${chosenCount > 1 ? `${chosenCount} × ` : ''}${chosen.name}` : 'Not chosen'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-ink-500">{k}</dt>
              <dd className="min-w-0 text-right font-semibold text-ink-900">{v}</dd>
            </div>
          ))}
        </dl>

        {addons.length > 0 && (
          <div className="mt-4 border-t border-ink-100 pt-4">
            <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Also wanted</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {addons.map((k) => (
                <li key={k} className="rounded-full bg-brand-50 px-2.5 py-1 text-2xs font-semibold text-brand-700">
                  {addonByKey(k)?.label ?? k}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-2xs leading-relaxed text-ink-400">
              Extras are quoted separately and are not part of the estimate above.
            </p>
          </div>
        )}
      </div>

      <TrustRow compact />
    </div>
  );

  return (
    <CompareProvider>
      <div className="page-bg pb-32 pt-28 sm:pt-32 lg:pb-24">
        <div className="shell">
          <BackLink to="/book" className="mb-4" onBack={stepBack} />
          <p className="lead">Build my trip</p>
          <h1 className="font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
            Put the whole journey together, then send it in one go.
          </h1>

          <div className="mt-7">
            <Stepper steps={STEPS} at={at} onJump={setAt} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr,21rem] lg:gap-8">
            {/* ================================ STEPS ================================ */}
            <form onSubmit={submit} className="min-w-0">
              <div className="tile p-6 sm:p-8">
                {/* ------------------------------------------------ 1 · WHERE */}
                {at === 0 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">Where are you going?</h2>
                    <p className="mt-1.5 text-sm text-ink-500">Add as many stops as the trip needs — they travel as one booking.</p>

                    <SegTabs
                      className="mt-5 max-w-xs"
                      value={scope}
                      onChange={setScope}
                      options={[
                        { value: 'LOCAL', label: 'Within Mumbai' },
                        { value: 'OUTSTATION', label: 'Outstation' },
                      ]}
                    />

                    <div className="mt-6 space-y-4">
                      <PlaceInput label="Pickup" value={from} onChange={setFrom} onPick={setFromPt} placeholder="Andheri East" icon={<IconPin className="h-4 w-4" />} />

                      {stops.map((s, i) => (
                        <div key={i} className="flex items-end gap-2">
                          <PlaceInput
                            label={`Stop ${i + 1}`}
                            value={s}
                            onChange={(v) => setStops((list) => list.map((x, j) => (j === i ? v : x)))}
                            placeholder="Lonavala"
                          />
                          <button
                            type="button"
                            onClick={() => setStops((list) => list.filter((_, j) => j !== i))}
                            className="btn btn-icon mb-1 shrink-0 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                            aria-label={`Remove stop ${i + 1}`}
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                          <div className="mb-1 flex shrink-0 flex-col gap-0.5">
                            <button
                              type="button" disabled={i === 0}
                              onClick={() => setStops((l) => { const c = [...l]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}
                              className="grid h-5 w-6 place-items-center rounded text-ink-400 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30"
                              aria-label="Move stop earlier"
                            >
                              <IconChevron className="h-3 w-3 rotate-180" />
                            </button>
                            <button
                              type="button" disabled={i === stops.length - 1}
                              onClick={() => setStops((l) => { const c = [...l]; [c[i + 1], c[i]] = [c[i], c[i + 1]]; return c; })}
                              className="grid h-5 w-6 place-items-center rounded text-ink-400 hover:bg-ink-50 hover:text-ink-700 disabled:opacity-30"
                              aria-label="Move stop later"
                            >
                              <IconChevron className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}

                      <PlaceInput label="Destination" value={to} onChange={setTo} onPick={setToPt} placeholder="Mahabaleshwar" icon={<IconPin className="h-4 w-4" />} />

                      <DistanceNote info={route} />

                      <button
                        type="button"
                        onClick={() => setStops((l) => [...l, ''])}
                        className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800"
                      >
                        <IconPlus className="h-4 w-4" /> Add stop
                      </button>

                      {scope === 'OUTSTATION' && (
                        <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-sm text-ink-700">
                          <input type="checkbox" className="check" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
                          Return to the pickup point at the end
                        </label>
                      )}
                    </div>

                    {scope === 'OUTSTATION' && (
                      <div className="mt-6">
                        <p className="mb-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Popular destinations</p>
                        <div className="flex flex-wrap gap-2">
                          {DESTINATIONS.slice(0, 8).map((d) => (
                            <button
                              key={d.slug} type="button"
                              onClick={() => (to.trim() ? setStops((l) => [...l, d.name]) : setTo(d.name))}
                              className="rounded-full bg-ink-50 px-3.5 py-2 text-xs font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                            >
                              {d.name} · {d.km} km
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ------------------------------------------------- 2 · WHEN */}
                {at === 1 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">When are you travelling?</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Reporting time is when the vehicle should be at the pickup, not when you want to leave.
                    </p>
                    <div className="mt-6 grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="label" htmlFor="bt-date">Travel date</label>
                        <DateField id="bt-date" min={todayIso()} value={date} onChange={setDate} />
                      </div>
                      <div>
                        <label className="label" htmlFor="bt-time">Reporting time</label>
                        <TimeField id="bt-time" value={time} onChange={setTime} />
                      </div>
                      <div>
                        <label className="label" htmlFor="bt-return">Return date</label>
                        <DateField id="bt-return" min={date || todayIso()} value={returnDate} onChange={setReturnDate} placeholder="Single-day trip" />
                        <p className="hint">Leave blank for a single-day trip.</p>
                      </div>
                    </div>

                    {days > 1 && (
                      <Callout className="mt-5">
                        {days} days. On a multi-day duty the driver allowance for each night away is shown as its own
                        line on the estimate and the invoice — never folded into the fare.
                      </Callout>
                    )}
                  </div>
                )}

                {/* -------------------------------------------------- 3 · WHO */}
                {at === 2 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">How many people?</h2>
                    <p className="mt-1.5 text-sm text-ink-500">And how much they are carrying, which changes the vehicle more than the head count does.</p>

                    <div className="mt-6 max-w-sm">
                      <Counter label="Passengers" value={pax} onChange={setPax} min={1} max={60} sub="Everyone who needs a seat" />
                    </div>

                    <p className="mb-2.5 mt-6 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Luggage</p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {(['light', 'medium', 'heavy'] as Bags[]).map((b) => (
                        <ChoiceCard
                          key={b}
                          on={bags === b}
                          emoji={b === 'light' ? '\u{1F45D}' : b === 'medium' ? '\u{1F392}' : '\u{1F9F3}'}
                          title={BAG_LABEL[b]}
                          onClick={() => setBags(b)}
                        />
                      ))}
                    </div>

                    {pax > 17 && (
                      <Callout tone="warn" className="mt-5">
                        Over seventeen passengers usually means more than one vehicle. The{' '}
                        <Link to="/group-travel" className="font-bold underline">group travel planner</Link> works out the
                        split, or carry on here and we will do it when we quote.
                      </Callout>
                    )}
                  </div>
                )}

                {/* ---------------------------------------------- 4 · VEHICLE */}
                {at === 3 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">Choose a vehicle</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Ordered by what we would send for {pax} {pax === 1 ? 'passenger' : 'passengers'} with{' '}
                      {BAG_LABEL[bags].toLowerCase()}.
                    </p>

                    <div className="mt-6 grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
                      {suggestions.map((s, i) => (
                        <div key={s.vehicle.slug} className={s.vehicle.slug === chosen?.slug ? 'rounded-2xl ring-2 ring-brand-400' : ''}>
                          <VehicleCard
                            vehicle={s.vehicle}
                            index={i}
                            best={i === 0}
                            count={s.count}
                            estimateInput={{ plan, days, distanceKm: km }}
                            onSelect={() => setVehicleSlug(s.vehicle.slug)}
                            selectLabel={s.vehicle.slug === chosen?.slug ? 'Selected' : 'Select'}
                            compact
                          />
                        </div>
                      ))}
                    </div>

                    <Link to={`/vehicles?${tripQuery({ tab: scope === 'OUTSTATION' ? 'OUTSTATION' : 'LOCAL', from, to, date, time, returnDate, pax })}`}
                      className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800">
                      See the whole fleet and filter it <IconArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                )}

                {/* ----------------------------------------------- 5 · EXTRAS */}
                {at === 4 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">Enhance your trip</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Optional. Each is quoted separately from the vehicle, so nothing here changes the estimate until we
                      confirm it with you.
                    </p>

                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      {ADDONS.map((a) => (
                        <ChoiceCard
                          key={a.key}
                          on={addons.includes(a.key)}
                          emoji={a.emoji}
                          title={a.label}
                          sub={`${a.note} · ${a.basis}`}
                          onClick={() => setAddons((l) => (l.includes(a.key) ? l.filter((k) => k !== a.key) : [...l, a.key]))}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* ----------------------------------------------- 6 · REVIEW */}
                {at === 5 && (
                  <div className="animate-fade-up">
                    <h2 className="font-display text-lg font-bold text-ink-900">Review your trip</h2>
                    <p className="mt-1.5 text-sm text-ink-500">
                      Check it over, then tell us who to call back. Nothing is charged and no vehicle is assigned until
                      you have the rate.
                    </p>

                    <div className="mt-6 space-y-5">
                      <div className="rounded-2xl bg-ink-50/70 p-5">
                        <JourneyLine stops={points.map((p, i) => ({ label: p, note: i === 0 ? 'Pickup' : i === points.length - 1 ? 'Final drop' : 'Stop' }))} />
                        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-ink-200 pt-4 sm:grid-cols-4">
                          <div>
                            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Date</dt>
                            <dd className="mt-1 text-sm font-semibold text-ink-900">{date || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Reporting</dt>
                            <dd className="mt-1 text-sm font-semibold text-ink-900">{time || '—'}</dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Passengers</dt>
                            <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                              <IconSeat className="h-4 w-4 text-brand-500" />{pax}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Luggage</dt>
                            <dd className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                              <IconLuggage className="h-4 w-4 text-brand-500" />{BAG_LABEL[bags]}
                            </dd>
                          </div>
                        </dl>
                      </div>

                      <ContactFields value={contact} onChange={setContact} error={fieldErrors} company />

                      <div>
                        <label className="label" htmlFor="bt-notes">Anything else we should know?</label>
                        <textarea
                          id="bt-notes" className="input min-h-[100px] resize-y" value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Child seat, a flight to meet, an early darshan slot, a second pickup on the way…"
                        />
                      </div>

                      {error && <p className="error-text">{error}</p>}

                      <div className="flex flex-wrap items-center gap-3">
                        <SubmitButton busy={busy}>Send this trip</SubmitButton>
                        <CallButton
                          className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised"
                          label="Or call us"
                        />
                      </div>
                      <p className="text-xs leading-relaxed text-ink-400">
                        You will get a reference and a summary on the next screen, and a call back on the number above.
                      </p>
                    </div>
                  </div>
                )}

                {/* ---------------------------------------------- navigation */}
                {at < 5 && (
                  <div className="mt-8 flex items-center justify-between gap-3">
                    <button
                      type="button" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}
                      className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-ink-50 disabled:opacity-40"
                    >
                      Back
                    </button>
                    <div className="flex items-center gap-3">
                      {error && <p className="error-text mt-0 hidden sm:block">{error}</p>}
                      <button
                        type="button" onClick={next}
                        className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                      >
                        Next <IconArrowRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
                {at < 5 && error && <p className="error-text mt-3 sm:hidden">{error}</p>}
              </div>
            </form>

            {/* ============================= SUMMARY RAIL ============================= */}
            <aside className="hidden lg:block">
              <div className="sticky top-24">{Summary}</div>
            </aside>
          </div>
        </div>

        {/* -------- mobile: the summary as a docked bar plus a sheet -------- */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setSummaryOpen(true)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="min-w-0">
              <span className="block text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Trip summary</span>
              <span className="block truncate text-sm font-bold text-ink-900">
                {est.estimate
                  ? `Est. ₹${Math.round(est.estimate.total).toLocaleString('en-IN')}`
                  : chosen ? chosen.name : 'Build your trip'}
              </span>
            </span>
            <span className="btn h-10 shrink-0 rounded-full bg-ink-900 px-5 text-sm text-white">
              View <IconChevron className="h-3.5 w-3.5 rotate-180" />
            </span>
          </button>
        </div>

        <BottomSheet open={summaryOpen} onClose={() => setSummaryOpen(false)} title="Trip summary">
          {Summary}
        </BottomSheet>
      </div>
    </CompareProvider>
  );
}
