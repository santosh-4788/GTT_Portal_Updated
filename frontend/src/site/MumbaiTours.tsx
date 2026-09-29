/**
 * Explore Mumbai, and the tour builder.
 *
 * Two halves of one page: the places, and a builder that turns a selection of
 * them into a timed route. The builder adds up the time at each stop against
 * the hours you have booked and tells you when the day is over-filled — which
 * is the mistake every self-planned Mumbai tour makes, and something no
 * sightseeing page we looked at bothers to catch.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { VEHICLES } from './catalog';
import { MUMBAI_SPOTS, TOUR_DURATIONS, THEMES, type Theme, type TourDurationKey } from './places';
import {
  Callout, Chip, ContactFields, Counter, EstimatePanel, PlaceInput, SectionHead,
  SubmitButton, TrustRow, estimateFor, useContactDetails, useRates, useSendRequirement, emailError,
} from './kit';
import { SpotCard } from './PlaceCards';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconClock, IconPhone } from '../components/icons';
import { IconSeat } from './SiteIcons';
import { DateField, TimeField } from '../components/DateTimeField';
import { useSeo } from './Seo';

/** The vehicles offered for a city tour, in the order the builder shows them. */
const TOUR_VEHICLES = ['dzire', 'ertiga', 'innova-crysta', 'tempo-traveller-12'];

export default function MumbaiTours() {
  useSeo({
    title: 'Mumbai Sightseeing Tour by Car',
    path: '/tours/mumbai',
    description: 'A Mumbai city tour by private car with a chauffeur who knows the city: Gateway of India, Marine Drive, Bandra and more, at your pace, for half a day or a full day.',
  });
  const book = useRates();
  const { send, busy, error } = useSendRequirement();

  const [theme, setTheme] = useState<Theme | 'all'>('all');
  const [duration, setDuration] = useState<TourDurationKey>('8H');
  const [vehicleSlug, setVehicleSlug] = useState('ertiga');
  const [picked, setPicked] = useState<string[]>(['gateway-of-india', 'marine-drive', 'siddhivinayak']);
  const [pax, setPax] = useState(4);
  const [pickup, setPickup] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const shown = useMemo(
    () => (theme === 'all' ? MUMBAI_SPOTS : MUMBAI_SPOTS.filter((s) => s.themes.includes(theme))),
    [theme]
  );

  const chosen = picked
    .map((slug) => MUMBAI_SPOTS.find((s) => s.slug === slug))
    .filter((s): s is (typeof MUMBAI_SPOTS)[number] => Boolean(s));

  const plan = TOUR_DURATIONS.find((d) => d.key === duration)!;
  /** Time at the stops, plus twenty minutes of Mumbai traffic between each. */
  const usedMinutes = chosen.reduce((s, c) => s + c.minutes, 0) + Math.max(0, chosen.length - 1) * 20;
  const over = usedMinutes > plan.minutes;

  const vehicle = VEHICLES.find((v) => v.slug === vehicleSlug) ?? VEHICLES[0];
  const est = estimateFor(book, vehicle, {
    plan: 'LOCAL',
    extraHours: duration === 'FD' ? 3 : duration === '4H' ? 0 : 0,
  });

  const toggle = (slug: string) =>
    setPicked((l) => (l.includes(slug) ? l.filter((s) => s !== slug) : [...l, slug]));

  /** Running clock down the itinerary, so each stop shows when it happens. */
  const schedule = useMemo(() => {
    const [h, m] = (time || '09:00').split(':').map(Number);
    let clock = (h || 9) * 60 + (m || 0);
    return chosen.map((c, i) => {
      if (i > 0) clock += 20;
      const at = clock;
      clock += c.minutes;
      const hh = Math.floor(at / 60) % 24;
      const mm = at % 60;
      return { spot: c, at: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
    });
  }, [chosen, time]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    send({
      kind: 'TOUR',
      from: pickup,
      to: 'Mumbai sightseeing',
      stops: chosen.map((c) => c.name),
      date,
      time,
      passengers: pax,
      vehicleSlug: vehicle.slug,
      vehicleName: vehicle.name,
      estimate: est.estimate?.total ?? null,
      notes: [
        `Tour length: ${plan.label}`,
        `Stops: ${chosen.map((c) => c.name).join(' → ') || 'to be decided with us'}`,
        `Time at stops plus travel: about ${Math.round(usedMinutes / 60)} hrs`,
        over ? 'Customer was warned the itinerary is longer than the booked hours' : '',
        notes,
      ].filter(Boolean).join('. '),
      name: contact.name,
      mobile: contact.mobile,
      email: contact.noEmail ? '' : contact.email,
    });
  };

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Mumbai tours"
        title="Explore Mumbai"
        sub="The city in a morning, a day or a long day — with a chauffeur who knows which order to do it in and when each place is worth seeing."
        crumbs={[{ label: 'Mumbai tours' }]}
      />

      {/* ============================== THE PLACES ============================== */}
      <section className="shell">
        <SectionHead
          eyebrow="Where to go"
          title="Places worth the drive"
          sub="Tap any of them to put it in your tour. The builder below works out whether the day holds together."
          className="mb-6"
        />

        <div className="mb-7 flex flex-wrap gap-2">
          <Chip on={theme === 'all'} onClick={() => setTheme('all')}>All</Chip>
          {THEMES.filter((t) => MUMBAI_SPOTS.some((s) => s.themes.includes(t.key))).map((t) => (
            <Chip key={t.key} on={theme === t.key} onClick={() => setTheme(t.key)}>
              <span aria-hidden="true">{t.emoji}</span> {t.label}
            </Chip>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {shown.map((s, i) => (
            <Reveal key={s.slug} delay={(i % 4) * 55}>
              <SpotCard s={s} index={i} on={picked.includes(s.slug)} onToggle={() => toggle(s.slug)} />
            </Reveal>
          ))}
        </div>

        {/* The photo-credit line moved to the footer, where one link now covers
            every photograph on the site instead of repeating on five pages.
            The timings note went with it: the builder already says Elephanta
            needs the ferry timings and Film City an entry pass, and Film City's
            own card repeats it, so this was the third telling. */}
      </section>

      {/* ============================== THE BUILDER ============================== */}
      <section id="builder" className="shell scroll-mt-24 pt-16 sm:pt-24">
        <SectionHead
          eyebrow="Mumbai tour builder"
          title="Your Mumbai tour"
          sub="Pick how long you have, the vehicle and the stops. The route below is the order we would drive them in."
          className="mb-9"
        />

        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr,21rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {/* ---------------------------- duration ---------------------------- */}
            <div className="tile p-5 sm:p-7">
              <h3 className="font-display text-md font-bold text-ink-900">How long do you have?</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {TOUR_DURATIONS.map((d) => (
                  <button
                    key={d.key} type="button" onClick={() => setDuration(d.key)}
                    className={`rounded-2xl p-4 text-left transition-all duration-300 ${
                      duration === d.key ? 'grad-soft shadow-raised ring-2 ring-brand-400' : 'bg-ink-50/70 hover:bg-ink-100/70'
                    }`}
                  >
                    <span className="block font-display text-md font-bold text-ink-900">{d.label}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-ink-500">{d.note}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* ----------------------------- vehicle ----------------------------- */}
            <div className="tile p-5 sm:p-7">
              <h3 className="font-display text-md font-bold text-ink-900">Which vehicle?</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {TOUR_VEHICLES.map((slug) => {
                  const v = VEHICLES.find((x) => x.slug === slug);
                  if (!v) return null;
                  const on = vehicleSlug === slug;
                  return (
                    <button
                      key={slug} type="button" onClick={() => setVehicleSlug(slug)}
                      className={`flex items-center gap-3.5 rounded-2xl p-3 text-left transition-all duration-300 ${
                        on ? 'shadow-raised ring-2 ring-brand-400' : 'bg-ink-50/70 hover:bg-ink-100/70'
                      }`}
                    >
                      <span className="grad-soft h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                        <VehiclePhoto photo={v.photo} art={v.art} name={v.name} alt={v.name} className="h-full w-full object-cover" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-ink-900">{v.name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-xs text-ink-500">
                          <IconSeat className="h-3.5 w-3.5" /> {v.seats} seats · {v.comfort}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---------------------------- the route ---------------------------- */}
            <div className="tile p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-md font-bold text-ink-900">Your route</h3>
                {chosen.length > 0 && (
                  <button type="button" onClick={() => setPicked([])} className="text-xs font-bold text-brand-700 hover:text-brand-800">
                    Clear all
                  </button>
                )}
              </div>

              {chosen.length === 0 ? (
                <p className="mt-4 rounded-2xl bg-ink-50/70 px-4 py-6 text-center text-sm text-ink-500">
                  No stops picked yet. Choose from the places above, or leave it to us and say what kind of day you
                  want in the notes.
                </p>
              ) : (
                <ol className="mt-5 space-y-1">
                  {schedule.map(({ spot, at }, i) => {
                    const last = i === schedule.length - 1;
                    return (
                      <li key={spot.slug} className="flex gap-3.5">
                        <span className="relative flex w-5 shrink-0 justify-center">
                          <span className={`z-10 mt-1.5 h-3 w-3 rounded-full ring-4 ring-white ${i === 0 ? 'bg-brand-500' : last ? 'bg-ok-500' : 'bg-ink-300'}`} />
                          {!last && <span className="absolute bottom-0 top-4 w-0.5 rounded-full bg-ink-200" />}
                        </span>
                        <span className="min-w-0 flex-1 pb-4">
                          <span className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-xs font-bold text-brand-700">{at}</span>
                            <span className="text-sm font-semibold text-ink-900">{spot.name}</span>
                          </span>
                          <span className="mt-0.5 block text-xs text-ink-500">
                            {spot.area} · about {spot.minutes >= 60 ? `${(spot.minutes / 60).toFixed(spot.minutes % 60 ? 1 : 0)} hrs` : `${spot.minutes} min`} here
                          </span>
                        </span>
                        <button
                          type="button" onClick={() => toggle(spot.slug)}
                          className="btn btn-sm shrink-0 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}

              {chosen.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ink-100 pt-4 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-ink-600">
                    <IconCheck className="h-4 w-4 text-ok-500" /> {chosen.length} stops
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-ink-600">
                    <IconClock className="h-4 w-4 text-brand-500" /> about {Math.floor(usedMinutes / 60)} hrs {usedMinutes % 60} min
                    including traffic
                  </span>
                  <span className="text-ink-400">of {plan.label.toLowerCase()} booked</span>
                </div>
              )}

              {over && (
                <Callout tone="warn" className="mt-4">
                  That is more than {plan.label.toLowerCase()} allows once traffic is counted. Either drop a stop, or
                  move up to the next package — we would rather tell you now than have the chauffeur rushing you
                  through Marine Drive at six o'clock.
                </Callout>
              )}

              {chosen.some((c) => c.slug === 'elephanta' || c.slug === 'film-city') && (
                <Callout className="mt-4">
                  Elephanta needs the ferry timings and Film City needs an entry pass — both are arranged a day ahead.
                  Tell us when you book and we will set it up.
                </Callout>
              )}
            </div>

            {/* ------------------------------ details ------------------------------ */}
            <div className="tile p-5 sm:p-7">
              <h3 className="font-display text-md font-bold text-ink-900">Pickup and party</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <PlaceInput label="Pickup" value={pickup} onChange={setPickup} placeholder="Hotel or residence" />
                <div>
                  <label className="label" htmlFor="mt-date">Date</label>
                  <DateField id="mt-date" min={todayIso()} value={date} onChange={setDate} />
                </div>
                <div>
                  <label className="label" htmlFor="mt-time">Start time</label>
                  <TimeField id="mt-time" value={time} onChange={setTime} />
                </div>
                <div className="sm:pt-6">
                  <Counter label="Passengers" value={pax} onChange={setPax} min={1} max={vehicle.seats} />
                </div>
              </div>

              {pax > vehicle.seats && (
                <Callout tone="warn" className="mt-4">
                  {pax} passengers will not fit in the {vehicle.name}. Pick a larger vehicle above.
                </Callout>
              )}

              <div className="mt-5">
                <ContactFields value={contact} onChange={setContact} error={fieldErrors} />
              </div>

              <div className="mt-4">
                <label className="label" htmlFor="mt-notes">Anything else?</label>
                <textarea
                  id="mt-notes" className="input min-h-[92px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="A lunch stop, a temple we should reach before it closes, someone who cannot walk far…"
                />
              </div>

              {error && <p className="error-text mt-3">{error}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton busy={busy}>Plan this tour</SubmitButton>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
            </div>
          </div>

          {/* -------------------------------- summary -------------------------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <EstimatePanel
              estimate={est.estimate}
              planLabel={est.planLabel}
              reason={est.reason}
              note={
                <p className="mt-2 text-xs leading-relaxed text-ink-500">
                  Entry tickets, the Elephanta ferry and meals are not included and are paid on the day.
                </p>
              }
            />

            <div className="tile mt-5 p-5">
              <h3 className="font-display text-md font-bold text-ink-900">Your tour</h3>
              <dl className="mt-4 space-y-2.5 text-sm">
                {[
                  ['Length', plan.label],
                  ['Vehicle', vehicle.name],
                  ['Stops', String(chosen.length)],
                  ['Time needed', `${Math.floor(usedMinutes / 60)} hrs ${usedMinutes % 60} min`],
                  ['Passengers', String(pax)],
                  ['Date', date || 'Not set'],
                  ['Start', time || 'Not set'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-500">{k}</dt>
                    <dd className="text-right font-semibold text-ink-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <TrustRow compact className="mt-5" />

            <div className="tile mt-5 p-5">
              <h3 className="font-display text-sm font-bold text-ink-900">Going further?</h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">
                Mumbai is a day. The hills and the coast are a weekend.
              </p>
              <Link to="/weekend-trips" className="btn mt-3.5 h-10 w-full rounded-full bg-ink-50 text-sm text-ink-800 hover:bg-ink-100">
                Weekend escapes <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </aside>
        </form>
      </section>
    </div>
  );
}
