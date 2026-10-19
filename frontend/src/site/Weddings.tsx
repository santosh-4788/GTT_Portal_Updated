/**
 * Wedding transportation.
 *
 * A wedding is not one booking, it is a schedule — four days, six functions and
 * a guest list arriving from three cities. So the planner here is a schedule
 * builder: add a day, add the movements on it, and the whole thing goes across
 * as one requirement.
 *
 * Every other travel site treats a wedding as "enquire for group booking". That
 * is the gap this page closes.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { WEDDING_SERVICES, ON_REQUEST_CLASSES, VEHICLES } from './catalog';
import { fleetPlan } from './recommend';
import {
  BackLink, Callout, ContactFields, Counter, PlaceInput, SectionHead, SubmitButton,
  TrustRow, useContactDetails, useSendRequirement, emailError,
} from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone, IconPlus, IconTrash } from '../components/icons';
import { IconSeat } from './SiteIcons';
import { DateField, TimeField } from '../components/DateTimeField';
import { useSeo } from './Seo';

interface Movement {
  id: number;
  day: string;
  date: string;
  time: string;
  from: string;
  to: string;
  vehicles: string;
}

let seq = 1;
const blank = (day: string, from = '', to = ''): Movement =>
  ({ id: seq++, day, date: '', time: '', from, to, vehicles: '' });

/** A starting schedule that matches how most weddings actually run. */
const TEMPLATE: Movement[] = [
  blank('Day 1', 'Airport', 'Hotel'),
  blank('Day 2', 'Hotel', 'Mehendi venue'),
  blank('Day 3', 'Hotel', 'Wedding venue'),
  blank('Day 4', 'Hotel', 'Airport'),
];

export default function Weddings() {
  useSeo({
    title: 'Wedding Car Rental in Mumbai - Bride and Groom Car, Guest Cabs',
    path: '/weddings',
    description: 'Wedding cars and guest transport in Mumbai: the bride and groom car, baraat vehicles, hotel-to-venue shuttles and airport pickups for family, planned as one fleet.',
  });
  const { send, busy, error } = useSendRequirement();

  const [moves, setMoves] = useState<Movement[]>(TEMPLATE);
  const [guests, setGuests] = useState(60);
  const [family, setFamily] = useState(12);
  const [coupleCar, setCoupleCar] = useState(true);
  const [baraat, setBaraat] = useState(false);
  const [city, setCity] = useState('');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const plan = fleetPlan(guests + family, 'medium');

  const patch = (id: number, p: Partial<Movement>) =>
    setMoves((l) => l.map((m) => (m.id === id ? { ...m, ...p } : m)));

  const days = [...new Set(moves.map((m) => m.day))];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    const used = moves.filter((m) => m.from.trim() || m.to.trim());

    send({
      kind: 'WEDDING',
      from: used[0]?.from ?? '',
      to: city || (used[used.length - 1]?.to ?? ''),
      date: used.find((m) => m.date)?.date ?? '',
      passengers: guests + family,
      vehicleCount: plan?.legs.reduce((s, l) => s + l.count, 0) ?? 1,
      vehicleName: plan?.legs.map((l) => `${l.count} × ${l.vehicle.name}`).join(' + '),
      legs: used.map((m) => ({
        label: `${m.day}${m.date ? ` (${m.date})` : ''}${m.time ? ` ${m.time}` : ''}`,
        detail: `${m.from || '—'} → ${m.to || '—'}${m.vehicles ? ` · ${m.vehicles}` : ''}`,
      })),
      notes: [
        `Guests needing transport: ${guests}`,
        `Immediate family: ${family}`,
        coupleCar ? 'Dedicated bride and groom car required' : '',
        baraat ? 'Baraat procession vehicles required' : '',
        city ? `City: ${city}` : '',
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
      {/* ================================ HERO ================================ */}
      <section className="relative overflow-hidden pb-12 pt-28 sm:pt-36">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -left-40 -top-56 h-[36rem] w-[36rem] rounded-full bg-[#FFE9E3]/70 blur-[120px]" />
          <div className="absolute right-[-12rem] top-[-8rem] h-[30rem] w-[30rem] rounded-full bg-brand-200/35 blur-[120px]" />
        </div>

        <div className="shell relative">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <BackLink to="/events" />
            <nav className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
              <Link to="/" className="hover:text-brand-700">Home</Link>
              <span className="text-ink-300">/</span>
              <Link to="/events" className="hover:text-brand-700">Events</Link>
              <span className="text-ink-300">/</span>
              <span className="font-medium text-ink-700">Weddings</span>
            </nav>
          </div>

          <span className="pill">{'\u{1F48D}'} Wedding transportation</span>

          <h1 className="mt-6 max-w-3xl font-display text-[2.3rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink-900 sm:text-[3.1rem]">
            Make every wedding journey <span className="grad-text">special.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-md leading-[1.75] text-ink-600 sm:text-lg">
            The couple's car, the family, the guests arriving from three cities, the baraat and the airport runs at both
            ends — planned as one schedule, run by one coordinator, billed on one invoice.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#planner" className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]">
              Open the wedding planner <IconArrowRight className="h-4 w-4" />
            </a>
            <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
              <IconPhone className="h-4 w-4" /> Call
            </a>
          </div>

          <TrustRow compact className="mt-8" />
        </div>
      </section>

      {/* ============================== SERVICES ============================== */}
      <section className="shell pt-6">
        <SectionHead
          eyebrow="What we cover"
          title="Every journey on the invitation"
          sub="Each of these is a movement with its own timing and its own vehicle. Tell us which ones you need and we will build the rest around them."
          className="mb-9"
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {WEDDING_SERVICES.map((s, i) => (
            <Reveal key={s.label} delay={(i % 4) * 60}>
              <div className="tile tile-lift h-full p-5">
                <span className="grad-warm grid h-12 w-12 place-items-center rounded-2xl text-xl" aria-hidden="true">{s.emoji}</span>
                <h3 className="mt-4 font-display text-sm font-bold text-ink-900">{s.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Callout className="mt-6">
          Decorated cars, luxury sedans and vintage vehicles are arranged for the day rather than kept on the road —{' '}
          {ON_REQUEST_CLASSES.slice(0, 3).join(', ').toLowerCase()}. Tell us the look you want and we will come back with
          what is available for your dates.
        </Callout>
      </section>

      {/* ============================== PLANNER ============================== */}
      <section id="planner" className="shell scroll-mt-24 pt-16 sm:pt-24">
        <SectionHead
          eyebrow="Wedding transportation planner"
          title="Build the schedule, day by day"
          sub="Start from the usual four-day shape and change it to match your functions. Empty rows are ignored."
          className="mb-9"
        />

        <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr,20rem] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {/* ---------------------------- the schedule ---------------------------- */}
            <div className="tile p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-md font-bold text-ink-900">The schedule</h3>
                <button
                  type="button"
                  onClick={() => setMoves((l) => [...l, blank(`Day ${days.length + 1}`)])}
                  className="btn h-9 rounded-full bg-ink-50 px-4 text-xs font-bold text-ink-700 hover:bg-ink-100"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Add a day
                </button>
              </div>

              <ol className="mt-5 space-y-4">
                {moves.map((m, i) => (
                  <li key={m.id} className="relative rounded-2xl bg-ink-50/70 p-4">
                    <span className="absolute -left-px top-4 hidden h-[calc(100%-2rem)] w-0.5 rounded-full bg-brand-200 sm:block" />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        value={m.day}
                        onChange={(e) => patch(m.id, { day: e.target.value })}
                        aria-label={`Label for movement ${i + 1}`}
                        className="w-32 rounded-lg border-0 bg-transparent px-0 py-0 font-display text-sm font-bold text-ink-900 outline-none focus:bg-white focus:px-2 focus:shadow-focus"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setMoves((l) => [...l.slice(0, i + 1), blank(m.day), ...l.slice(i + 1)])}
                          className="-my-2 py-2 text-2xs font-bold text-brand-700 hover:text-brand-800"
                        >
                          + movement on this day
                        </button>
                        {moves.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setMoves((l) => l.filter((x) => x.id !== m.id))}
                            className="btn btn-icon rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                            aria-label={`Remove ${m.day} movement`}
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <PlaceInput label="From" value={m.from} onChange={(v) => patch(m.id, { from: v })} placeholder="Hotel" />
                      <PlaceInput label="To" value={m.to} onChange={(v) => patch(m.id, { to: v })} placeholder="Venue" />
                      <div>
                        <label className="label">Date</label>
                        <DateField min={todayIso()} value={m.date} onChange={(v) => patch(m.id, { date: v })} />
                      </div>
                      <div>
                        <label className="label">Time</label>
                        <TimeField value={m.time} onChange={(v) => patch(m.id, { time: v })} />
                      </div>
                      <div className="sm:col-span-2 lg:col-span-4">
                        <label className="label">Vehicles for this movement</label>
                        <input
                          className="input" value={m.vehicles} onChange={(e) => patch(m.id, { vehicles: e.target.value })}
                          placeholder="e.g. 1 Crysta for family, 2 Travellers for guests"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* ------------------------------ the party ------------------------------ */}
            <div className="tile p-5 sm:p-7">
              <h3 className="font-display text-md font-bold text-ink-900">Who is travelling</h3>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Counter label="Guests needing transport" value={guests} onChange={setGuests} min={0} max={1000} />
                <Counter label="Immediate family" value={family} onChange={setFamily} min={0} max={200} />
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-ink-50/70 p-4">
                  <input type="checkbox" className="check mt-0.5" checked={coupleCar} onChange={(e) => setCoupleCar(e.target.checked)} />
                  <span>
                    <span className="block text-sm font-bold text-ink-900">A dedicated car for the couple</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                      Held aside for the day, not shared with any other movement.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-ink-50/70 p-4">
                  <input type="checkbox" className="check mt-0.5" checked={baraat} onChange={(e) => setBaraat(e.target.checked)} />
                  <span>
                    <span className="block text-sm font-bold text-ink-900">Baraat procession vehicles</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                      Slow-moving, with a chauffeur who has done a procession before.
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-4">
                <PlaceInput label="City or area of the wedding" value={city} onChange={setCity} placeholder="Mumbai, Alibaug, Nashik…" />
              </div>
            </div>

            {/* ------------------------------- contact ------------------------------- */}
            <div className="tile p-5 sm:p-7">
              <h3 className="font-display text-md font-bold text-ink-900">Who should we coordinate with?</h3>
              <div className="mt-5">
                <ContactFields value={contact} onChange={setContact} error={fieldErrors} />
              </div>
              <div className="mt-4">
                <label className="label" htmlFor="w-notes">Anything else we should know?</label>
                <textarea
                  id="w-notes" className="input min-h-[100px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Elderly guests, a decorated car brief, name boards at the airport, a wedding planner we should report to…"
                />
              </div>

              {error && <p className="error-text mt-3">{error}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton busy={busy}>Send the wedding schedule</SubmitButton>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-ink-400">
                Wedding dates get held provisionally as soon as we have spoken, so the vehicles are not promised
                elsewhere while you finalise.
              </p>
            </div>
          </div>

          {/* -------------------------------- summary -------------------------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="tile p-5">
              <h3 className="font-display text-md font-bold text-ink-900">Your wedding at a glance</h3>

              <dl className="mt-4 space-y-2.5 text-sm">
                {[
                  ['Days', String(days.length)],
                  ['Movements', String(moves.filter((m) => m.from || m.to).length)],
                  ['People to move', String(guests + family)],
                  ['Couple car', coupleCar ? 'Yes' : 'Not needed'],
                  ['Baraat', baraat ? 'Yes' : 'Not needed'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="text-ink-500">{k}</dt>
                    <dd className="font-semibold text-ink-900">{v}</dd>
                  </div>
                ))}
              </dl>

              {plan && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Indicative fleet</p>
                  <p className="mt-1 font-display text-md font-bold text-ink-900">{plan.headline}</p>
                  <ul className="mt-2 space-y-1.5">
                    {plan.legs.map((l) => (
                      <li key={l.vehicle.slug} className="flex gap-2 text-xs text-ink-600">
                        <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" />
                        {l.count > 1 && `${l.count} × `}{l.vehicle.name}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 flex items-center gap-1.5 text-2xs text-ink-400">
                    <IconSeat className="h-3.5 w-3.5" /> {plan.seats} seats in one wave. Shuttles that run twice need
                    fewer vehicles — we will work that out with you.
                  </p>
                </div>
              )}

              <p className="mt-4 border-t border-ink-100 pt-4 text-2xs leading-relaxed text-ink-400">
                Weddings are quoted per schedule rather than off the standard card, so there is no estimate here. You
                get one written quote covering every movement.
              </p>
            </div>

            <div className="tile mt-5 p-5">
              <h3 className="font-display text-sm font-bold text-ink-900">Also useful</h3>
              <ul className="mt-3 space-y-2.5 text-sm">
                <li><Link to="/group-travel" className="link">Work out vehicles for a guest count</Link></li>
                <li><Link to="/fleet-request" className="link">Plan a fleet for one date</Link></li>
                <li><Link to="/events/planner" className="link">Plan a reception or a sangeet as an event</Link></li>
              </ul>
            </div>
          </aside>
        </form>
      </section>
    </div>
  );
}
