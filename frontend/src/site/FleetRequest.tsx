/**
 * Plan my fleet.
 *
 * For weddings, conferences and anything else that needs more than one vehicle
 * on the same day. Built as a small list you add rows to — tap a vehicle, set
 * how many — rather than the thirty-field corporate form every competitor
 * hides this behind.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { VEHICLES, ON_REQUEST_CLASSES } from './catalog';
import { lookupDistance } from './places';
import {
  Callout, ContactFields, PlaceInput, SectionHead, SubmitButton, TrustRow,
  estimateFor, useContactDetails, useRates, useSendRequirement, emailError,
} from './kit';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone, IconPlus, IconTrash } from '../components/icons';
import { IconSeat } from './SiteIcons';
import { DateField } from '../components/DateTimeField';
import { useSeo } from './Seo';

type Line = { slug: string; count: number };

const DURATIONS = [
  { key: 'HALF', label: 'Half day', note: 'Up to 4 hours' },
  { key: 'FULL', label: 'Full day', note: '8 to 12 hours' },
  { key: 'MULTI', label: 'Several days', note: 'A wedding or a conference run' },
  { key: 'TRANSFER', label: 'Transfers only', note: 'Airport or venue runs, no standby' },
];

export default function FleetRequest() {
  useSeo({
    title: 'Request Multiple Vehicles',
    path: '/fleet-request',
    description: 'Need several cars, tempo travellers or coaches from Mumbai at once? Send the requirement and we plan the fleet.',
  });
  const book = useRates();
  const { send, busy, error } = useSendRequirement();

  const [lines, setLines] = useState<Line[]>([{ slug: 'innova-crysta', count: 2 }]);
  const [pickups, setPickups] = useState<string[]>(['']);
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [duration, setDuration] = useState('FULL');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const vehicles = lines.reduce((s, l) => s + l.count, 0);
  const seats = useMemo(
    () => lines.reduce((s, l) => s + (VEHICLES.find((v) => v.slug === l.slug)?.seats ?? 0) * l.count, 0),
    [lines]
  );

  const km = lookupDistance(venue);

  const total = useMemo(() => {
    let sum = 0;
    for (const l of lines) {
      const v = VEHICLES.find((x) => x.slug === l.slug);
      if (!v) continue;
      const e = estimateFor(book, v, {
        plan: km ? 'OUTSTATION' : 'LOCAL',
        days: duration === 'MULTI' ? 2 : 1,
        distanceKm: km,
        vehicles: l.count,
      });
      if (!e.estimate) return null;
      sum += e.estimate.total;
    }
    return sum || null;
  }, [lines, book, km, duration]);

  const addLine = (slug: string) =>
    setLines((l) => (l.some((x) => x.slug === slug) ? l.map((x) => (x.slug === slug ? { ...x, count: x.count + 1 } : x)) : [...l, { slug, count: 1 }]));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    send({
      kind: 'FLEET',
      from: pickups.filter(Boolean).join(' + '),
      to: venue,
      date,
      passengers: seats,
      vehicleCount: vehicles,
      vehicleName: lines.map((l) => `${l.count} × ${VEHICLES.find((v) => v.slug === l.slug)?.name}`).join(' + '),
      estimate: total,
      legs: lines.map((l) => {
        const v = VEHICLES.find((x) => x.slug === l.slug);
        return { label: `${l.count} × ${v?.name ?? l.slug}`, detail: `${(v?.seats ?? 0) * l.count} seats` };
      }),
      notes: [
        `Duration: ${DURATIONS.find((d) => d.key === duration)?.label}`,
        pickups.filter(Boolean).length > 1 ? `Pickup points: ${pickups.filter(Boolean).join('; ')}` : '',
        notes,
      ].filter(Boolean).join('. '),
      name: contact.name,
      mobile: contact.mobile,
      email: contact.noEmail ? '' : contact.email,
      company: contact.company,
    });
  };

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Multiple vehicles"
        title="Need more than one vehicle?"
        sub="Perfect for weddings, corporate events, conferences and large groups. Build the fleet here in a minute — tap a vehicle, set how many — and we will come back with one quote and one point of contact."
        crumbs={[{ label: 'Plan a fleet' }]}
        compact
      />

      <section className="shell">
        <div className="grid gap-6 lg:grid-cols-[1fr,22rem] lg:gap-8">
          <form onSubmit={submit} className="min-w-0 space-y-5">
            {/* ------------------------------ the fleet ------------------------------ */}
            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">What do you need on the road?</h2>
              <p className="mt-1.5 text-sm text-ink-500">Tap to add. Adjust the numbers with the plus and minus.</p>

              <div className="mt-5 flex flex-wrap gap-2">
                {VEHICLES.map((v) => (
                  <button
                    key={v.slug} type="button" onClick={() => addLine(v.slug)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3.5 py-2 text-xs font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                  >
                    <IconPlus className="h-3.5 w-3.5" /> {v.name}
                  </button>
                ))}
              </div>

              {lines.length === 0 ? (
                <p className="mt-6 rounded-2xl bg-ink-50/70 px-4 py-6 text-center text-sm text-ink-500">
                  Nothing added yet. Pick a vehicle above, or just describe the requirement at the bottom and we will
                  work out the fleet.
                </p>
              ) : (
                <ul className="mt-6 space-y-3">
                  {lines.map((l) => {
                    const v = VEHICLES.find((x) => x.slug === l.slug);
                    if (!v) return null;
                    return (
                      <li key={l.slug} className="flex items-center gap-3.5 rounded-2xl bg-ink-50/70 p-3">
                        <span className="grad-soft h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                          <VehiclePhoto photo={v.photo} art={v.art} name={v.name} alt={v.name} className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink-900">{v.name}</span>
                          <span className="block text-xs text-ink-500">
                            {v.category} · {v.seats} seats each · {v.seats * l.count} seats total
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.map((x) => (x.slug === l.slug ? { ...x, count: Math.max(1, x.count - 1) } : x)))}
                            className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-bold text-ink-700 shadow-card"
                            aria-label={`Fewer ${v.name}`}
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-display font-bold tabular-nums text-ink-900">{l.count}</span>
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.map((x) => (x.slug === l.slug ? { ...x, count: Math.min(40, x.count + 1) } : x)))}
                            className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-bold text-ink-700 shadow-card"
                            aria-label={`More ${v.name}`}
                          >
                            +
                          </button>
                          <button
                            type="button"
                            onClick={() => setLines((ls) => ls.filter((x) => x.slug !== l.slug))}
                            className="btn btn-icon ml-1 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                            aria-label={`Remove ${v.name}`}
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ------------------------------ when, where ------------------------------ */}
            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">When and where</h2>

              <div className="mt-5 space-y-4">
                {pickups.map((p, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <PlaceInput
                      label={pickups.length > 1 ? `Pickup ${i + 1}` : 'Pickup point'}
                      value={p}
                      onChange={(v) => setPickups((l) => l.map((x, j) => (j === i ? v : x)))}
                      placeholder="Hotel, office or residence"
                    />
                    {pickups.length > 1 && (
                      <button
                        type="button" onClick={() => setPickups((l) => l.filter((_, j) => j !== i))}
                        className="btn btn-icon mb-1 shrink-0 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                        aria-label={`Remove pickup ${i + 1}`}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button" onClick={() => setPickups((l) => [...l, ''])}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800"
                >
                  <IconPlus className="h-4 w-4" /> Add another pickup point
                </button>

                <PlaceInput label="Venue or destination" value={venue} onChange={setVenue} placeholder="Venue, hall or city" />

                <div>
                  <label className="label" htmlFor="fr-date">Date</label>
                  <DateField id="fr-date" className="sm:max-w-xs" min={todayIso()} value={date} onChange={setDate} />
                </div>

                <div>
                  <p className="label">How long do you need them?</p>
                  <div className="flex flex-wrap gap-2">
                    {DURATIONS.map((d) => (
                      <button
                        key={d.key} type="button" onClick={() => setDuration(d.key)}
                        title={d.note}
                        className={`rounded-full px-4 py-2.5 text-xs font-semibold transition-all ${
                          duration === d.key ? 'grad-brand text-white shadow-sm shadow-brand-500/25' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                  <p className="hint">{DURATIONS.find((d) => d.key === duration)?.note}</p>
                </div>
              </div>
            </div>

            {/* ------------------------------- contact ------------------------------- */}
            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">Who is coordinating this?</h2>
              <div className="mt-5">
                <ContactFields value={contact} onChange={setContact} error={fieldErrors} company />
              </div>
              <div className="mt-4">
                <label className="label" htmlFor="fr-notes">Tell us about the movement</label>
                <textarea
                  id="fr-notes" className="input min-h-[110px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Timings per vehicle, whether they stay on standby, decorated cars, name boards at the airport, a coordinator we should report to…"
                />
              </div>

              {error && <p className="error-text mt-3">{error}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton busy={busy}>Plan my fleet</SubmitButton>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
            </div>
          </form>

          {/* -------------------------------- summary -------------------------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="tile p-5">
              <h2 className="font-display text-md font-bold text-ink-900">Your fleet</h2>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Vehicles</p>
                  <p className="mt-1 font-display text-xl font-bold text-ink-900">{vehicles}</p>
                </div>
                <div>
                  <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Seats</p>
                  <p className="mt-1 flex items-center gap-1.5 font-display text-xl font-bold text-ink-900">
                    <IconSeat className="h-4 w-4 text-brand-500" />{seats}
                  </p>
                </div>
              </div>

              <ul className="mt-4 space-y-1.5 border-t border-ink-100 pt-4">
                {lines.map((l) => {
                  const v = VEHICLES.find((x) => x.slug === l.slug);
                  return (
                    <li key={l.slug} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-ink-600">{v?.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-ink-900">× {l.count}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-4 border-t border-ink-100 pt-4">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Estimated total</p>
                {total ? (
                  <p className="mt-1 font-display text-xl font-bold text-ink-900">
                    ₹{Math.round(total).toLocaleString('en-IN')}
                    <span className="ml-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-warn-700">estimate</span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm font-semibold text-ink-500">Quoted on request</p>
                )}
                <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
                  The sum of the vehicles at published rates, before toll, parking and permits. A fleet on one date is
                  normally quoted below this.
                </p>
              </div>
            </div>

            <TrustRow compact className="mt-5" />

            <div className="tile mt-5 p-5">
              <h3 className="font-display text-sm font-bold text-ink-900">Also arranged on request</h3>
              <ul className="mt-3 space-y-2">
                {ON_REQUEST_CLASSES.map((c) => (
                  <li key={c} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                    <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" />{c}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

      {/* ============================ WHERE THIS GOES ============================ */}
      <section className="shell pt-16 sm:pt-20">
        <SectionHead
          eyebrow="Also useful"
          title="Planning something bigger than a fleet?"
          sub="Weddings and events run to a timetable rather than a single pickup. These planners build the schedule with you."
          className="mb-8"
        />
        <div className="grid gap-5 sm:grid-cols-3">
          {[
            { to: '/weddings', emoji: '\u{1F48D}', title: 'Wedding transportation', sub: 'Every function, day by day' },
            { to: '/events/planner', emoji: '\u{1F3AA}', title: 'Event planner', sub: 'Hotel, venue and return loops' },
            { to: '/corporate/request', emoji: '\u{1F3E2}', title: 'Corporate travel', sub: 'Employee and executive movement' },
          ].map((c, i) => (
            <Reveal key={c.to} delay={i * 70}>
              <Link to={c.to} className="tile tile-lift flex h-full items-start gap-3.5 p-5">
                <span className="grad-soft grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl">{c.emoji}</span>
                <span className="min-w-0">
                  <span className="block font-display text-sm font-bold text-ink-900">{c.title}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-500">{c.sub}</span>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                    Open <IconArrowRight className="h-3 w-3" />
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
