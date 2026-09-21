/**
 * The event planner.
 *
 * Six steps that end in a movement timetable rather than a message in a box.
 * The timeline across the top is the point: an organiser thinks in legs — hotel,
 * pickup, venue, return — and this is the only travel form we have seen that
 * shows them the shape of the day as they fill it in.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { EVENT_TYPES, eventBySlug, VEHICLES } from './catalog';
import { fleetPlan } from './recommend';
import {
  Callout, ChoiceCard, ContactFields, Counter, PlaceInput, Stepper, SubmitButton,
  TrustRow, useContactDetails, useSendRequirement,
} from './kit';
import { VehiclePhoto } from '../components/VehiclePhoto';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone, IconPin, IconPlus, IconTrash } from '../components/icons';
import { IconSeat } from './SiteIcons';
import { DateField } from '../components/DateTimeField';

const STEPS = ['Event', 'Stays', 'Venue', 'Guests', 'Vehicles', 'Review'];

const LEGS = [
  { key: 'airport', label: 'Airport transfers', sub: 'Arrivals and departures, tracked by flight' },
  { key: 'hotel', label: 'Hotel to venue', sub: 'The main shuttle loop' },
  { key: 'venue', label: 'Between venues', sub: 'Where the event moves during the day' },
  { key: 'return', label: 'Return drops', sub: 'End of the night, back to the hotels' },
  { key: 'standby', label: 'Standby vehicles', sub: 'Held on site for the organisers' },
];

/** The shape of the day, drawn from what has been filled in so far. */
function Timeline({ hotels, venue, legs }: { hotels: string[]; venue: string; legs: string[] }) {
  const nodes = [
    legs.includes('airport') ? 'Airport' : null,
    hotels.filter(Boolean)[0] ? `Hotel${hotels.filter(Boolean).length > 1 ? `s (${hotels.filter(Boolean).length})` : ''}` : 'Hotel',
    'Pickup',
    venue || 'Event venue',
    legs.includes('return') ? 'Return' : null,
  ].filter(Boolean) as string[];

  return (
    <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
      <ol className="flex min-w-max items-center gap-2">
        {nodes.map((n, i) => (
          <li key={`${n}-${i}`} className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 shadow-card">
              <span className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-brand-500' : i === nodes.length - 1 ? 'bg-ok-500' : 'bg-ink-300'}`} />
              <span className="whitespace-nowrap text-xs font-semibold text-ink-800">{n}</span>
            </span>
            {i < nodes.length - 1 && <span className="h-0.5 w-6 rounded-full bg-ink-200" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function EventPlanner() {
  const [params] = useSearchParams();
  const { send, busy, error, setError } = useSendRequirement();

  const [at, setAt] = useState(0);
  const [type, setType] = useState(params.get('type') ?? 'conference');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [hotels, setHotels] = useState<string[]>(['']);
  const [venue, setVenue] = useState('');
  const [guests, setGuests] = useState(50);
  const [legs, setLegs] = useState<string[]>(['hotel', 'return']);
  const [lines, setLines] = useState<{ slug: string; count: number }[]>([]);
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const event = eventBySlug(type);
  const plan = useMemo(() => fleetPlan(guests, 'light'), [guests]);

  /** The suggested fleet becomes the starting list, which can then be edited. */
  const effective = lines.length ? lines : (plan?.legs.map((l) => ({ slug: l.vehicle.slug, count: l.count })) ?? []);
  const seats = effective.reduce((s, l) => s + (VEHICLES.find((v) => v.slug === l.slug)?.seats ?? 0) * l.count, 0);
  const vehicles = effective.reduce((s, l) => s + l.count, 0);

  const editLines = (next: { slug: string; count: number }[]) => setLines(next);

  const next = () => {
    if (at === 2 && !venue.trim()) { setError('Where is the event happening?'); return; }
    setError('');
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const stepBack = (): boolean => {
    if (at > 0) { setError(''); setAt((i) => i - 1); return true; }
    return false;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    send({
      kind: 'EVENT',
      from: hotels.filter(Boolean).join(' + '),
      to: venue,
      date,
      returnDate: endDate,
      passengers: guests,
      vehicleCount: vehicles,
      vehicleName: effective.map((l) => `${l.count} × ${VEHICLES.find((v) => v.slug === l.slug)?.name}`).join(' + '),
      legs: [
        ...effective.map((l) => {
          const v = VEHICLES.find((x) => x.slug === l.slug);
          return { label: `${l.count} × ${v?.name ?? l.slug}`, detail: `${(v?.seats ?? 0) * l.count} seats` };
        }),
        ...legs.map((k) => ({ label: LEGS.find((l) => l.key === k)?.label ?? k, detail: 'movement leg' })),
      ],
      notes: [
        `Event type: ${event?.label ?? type}`,
        name ? `Event name: ${name}` : '',
        hotels.filter(Boolean).length > 1 ? `Guest hotels: ${hotels.filter(Boolean).join('; ')}` : '',
        endDate ? `Runs to ${endDate}` : '',
        notes,
      ].filter(Boolean).join('. '),
      name: contact.name,
      mobile: contact.mobile,
      email: contact.email,
      company: contact.company,
    });
  };

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Event planner"
        title={`Plan the movement for your ${event ? event.label.toLowerCase() : 'event'}`}
        sub="Six steps. You will see the shape of the day build up as you go, and end with a timetable we can quote against."
        crumbs={[{ label: 'Events', to: '/events' }, { label: 'Planner' }]}
        compact
        onBack={stepBack}
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          <div className="tile p-5">
            <p className="mb-3 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">The shape of the day</p>
            <Timeline hotels={hotels} venue={venue} legs={legs} />
          </div>

          <div className="mt-6">
            <Stepper steps={STEPS} at={at} onJump={setAt} />
          </div>

          <form onSubmit={submit} className="tile mt-6 p-6 sm:p-8">
            {/* ------------------------------------------------ 1 · EVENT */}
            {at === 0 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">Tell us about your event</h2>
                  <p className="mt-1.5 text-sm text-ink-500">The type sets the questions; the dates set the fleet.</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {EVENT_TYPES.map((e) => (
                    <ChoiceCard key={e.slug} on={type === e.slug} emoji={e.emoji} title={e.label} sub={e.sub} onClick={() => setType(e.slug)} />
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label className="label" htmlFor="ep-name">Event name</label>
                    <input id="ep-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Annual sales conference" />
                  </div>
                  <div>
                    <label className="label" htmlFor="ep-date">First day</label>
                    <DateField id="ep-date" min={todayIso()} value={date} onChange={setDate} />
                  </div>
                  <div>
                    <label className="label" htmlFor="ep-end">Last day</label>
                    <DateField id="ep-end" min={date || todayIso()} value={endDate} onChange={setEndDate} placeholder="One-day event" />
                    <p className="hint">Leave blank for a one-day event.</p>
                  </div>
                </div>

                {event && (
                  <div className="rounded-2xl bg-ink-50/70 p-4">
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Usually needed for a {event.label.toLowerCase()}</p>
                    <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                      {event.needs.map((n) => (
                        <li key={n} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                          <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" /> {n}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* ------------------------------------------------ 2 · STAYS */}
            {at === 1 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">Where are guests staying?</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Add every hotel. Vehicles are routed per hotel so nobody waits for a bus that started somewhere else.
                  </p>
                </div>

                <div className="space-y-4">
                  {hotels.map((h, i) => (
                    <div key={i} className="flex items-end gap-2">
                      <PlaceInput
                        label={hotels.length > 1 ? `Hotel ${i + 1}` : 'Hotel or guest house'}
                        value={h}
                        onChange={(v) => setHotels((l) => l.map((x, j) => (j === i ? v : x)))}
                        placeholder="Hotel name and area"
                        icon={<IconPin className="h-4 w-4" />}
                      />
                      {hotels.length > 1 && (
                        <button
                          type="button" onClick={() => setHotels((l) => l.filter((_, j) => j !== i))}
                          className="btn btn-icon mb-1 shrink-0 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                          aria-label={`Remove hotel ${i + 1}`}
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button" onClick={() => setHotels((l) => [...l, ''])}
                    className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800"
                  >
                    <IconPlus className="h-4 w-4" /> Add another hotel
                  </button>
                </div>

                <Callout>
                  Not booked the hotels yet? Skip this — we will plan around one collection point and revise it once the
                  rooms are confirmed.
                </Callout>
              </div>
            )}

            {/* ------------------------------------------------ 3 · VENUE */}
            {at === 2 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">Where is the event?</h2>
                  <p className="mt-1.5 text-sm text-ink-500">The venue, and which legs of the day you need us for.</p>
                </div>

                <PlaceInput label="Venue" value={venue} onChange={setVenue} placeholder="Hall, hotel or ground" icon={<IconPin className="h-4 w-4" />} />

                <div>
                  <p className="label">Which movements do you need?</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {LEGS.map((l) => (
                      <ChoiceCard
                        key={l.key}
                        on={legs.includes(l.key)}
                        title={l.label}
                        sub={l.sub}
                        onClick={() => setLegs((v) => (v.includes(l.key) ? v.filter((k) => k !== l.key) : [...v, l.key]))}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ----------------------------------------------- 4 · GUESTS */}
            {at === 3 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">How many guests need transport?</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Not the whole guest list — just the ones you are moving. Locals who drive themselves do not count.
                  </p>
                </div>

                <div className="max-w-sm">
                  <Counter label="Guests to move" value={guests} onChange={setGuests} min={1} max={1000} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {[20, 50, 100, 200, 400].map((n) => (
                    <button
                      key={n} type="button" onClick={() => setGuests(n)}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                        guests === n ? 'grad-brand text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                {plan && (
                  <div className="rounded-2xl bg-brand-50/70 p-4">
                    <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-700">That works out to</p>
                    <p className="mt-1 font-display text-lg font-bold text-ink-900">{plan.headline}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{plan.note}</p>
                  </div>
                )}
              </div>
            )}

            {/* --------------------------------------------- 5 · VEHICLES */}
            {at === 4 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">What vehicles do you need?</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    We have started with what {guests} guests would normally take. Change anything — shuttles that run
                    twice will need fewer vehicles than the seat count suggests.
                  </p>
                </div>

                <ul className="space-y-3">
                  {effective.map((l) => {
                    const v = VEHICLES.find((x) => x.slug === l.slug);
                    if (!v) return null;
                    return (
                      <li key={l.slug} className="flex items-center gap-3.5 rounded-2xl bg-ink-50/70 p-3">
                        <span className="grad-soft h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                          <VehiclePhoto photo={v.photo} art={v.art} name={v.name} alt={v.name} className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink-900">{v.name}</span>
                          <span className="block text-xs text-ink-500">{v.seats} seats each · {v.seats * l.count} total</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => editLines(effective.map((x) => (x.slug === l.slug ? { ...x, count: Math.max(1, x.count - 1) } : x)))}
                            className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-bold text-ink-700 shadow-card"
                            aria-label={`Fewer ${v.name}`}
                          >−</button>
                          <span className="w-8 text-center font-display font-bold tabular-nums text-ink-900">{l.count}</span>
                          <button
                            type="button"
                            onClick={() => editLines(effective.map((x) => (x.slug === l.slug ? { ...x, count: Math.min(60, x.count + 1) } : x)))}
                            className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg font-bold text-ink-700 shadow-card"
                            aria-label={`More ${v.name}`}
                          >+</button>
                          <button
                            type="button"
                            onClick={() => editLines(effective.filter((x) => x.slug !== l.slug))}
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

                <div>
                  <p className="mb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Add a vehicle</p>
                  <div className="flex flex-wrap gap-2">
                    {VEHICLES.map((v) => (
                      <button
                        key={v.slug} type="button"
                        onClick={() =>
                          editLines(
                            effective.some((x) => x.slug === v.slug)
                              ? effective.map((x) => (x.slug === v.slug ? { ...x, count: x.count + 1 } : x))
                              : [...effective, { slug: v.slug, count: 1 }]
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3.5 py-2 text-xs font-semibold text-ink-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
                      >
                        <IconPlus className="h-3.5 w-3.5" /> {v.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap gap-6 rounded-2xl bg-ink-50/70 p-4">
                  <div>
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Vehicles</p>
                    <p className="mt-0.5 font-display text-lg font-bold text-ink-900">{vehicles}</p>
                  </div>
                  <div>
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Seats</p>
                    <p className="mt-0.5 flex items-center gap-1.5 font-display text-lg font-bold text-ink-900">
                      <IconSeat className="h-4 w-4 text-brand-500" />{seats}
                    </p>
                  </div>
                  <div>
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Guests</p>
                    <p className="mt-0.5 font-display text-lg font-bold text-ink-900">{guests}</p>
                  </div>
                </div>
              </div>
            )}

            {/* ----------------------------------------------- 6 · REVIEW */}
            {at === 5 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">Review the requirement</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    We will come back with a timetable and one quote covering the whole movement.
                  </p>
                </div>

                <dl className="grid gap-4 rounded-2xl bg-ink-50/70 p-5 sm:grid-cols-2">
                  {[
                    ['Event', `${event?.label ?? type}${name ? ` — ${name}` : ''}`],
                    ['Dates', [date, endDate].filter(Boolean).join(' to ') || 'Not set'],
                    ['Guest hotels', hotels.filter(Boolean).join(', ') || 'Not set'],
                    ['Venue', venue || 'Not set'],
                    ['Guests to move', String(guests)],
                    ['Vehicles', `${vehicles} · ${seats} seats`],
                    ['Movements', legs.map((k) => LEGS.find((l) => l.key === k)?.label).filter(Boolean).join(', ') || 'Not set'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">{k}</dt>
                      <dd className="mt-1 text-sm font-semibold text-ink-900">{v}</dd>
                    </div>
                  ))}
                </dl>

                <ContactFields value={contact} onChange={setContact} error={fieldErrors} company />

                <div>
                  <label className="label" htmlFor="ep-notes">Anything else about the movement?</label>
                  <textarea
                    id="ep-notes" className="input min-h-[100px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="Timings per leg, name boards at the airport, a coordinator on site, VIP cars, parking constraints at the venue…"
                  />
                </div>

                {error && <p className="error-text">{error}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton busy={busy}>Send the requirement</SubmitButton>
                  <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                    <IconPhone className="h-4 w-4" /> Call
                  </a>
                </div>
              </div>
            )}

            {at < 5 && (
              <div className="mt-8 flex items-center justify-between gap-3">
                <button
                  type="button" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}
                  className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-ink-50 disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  type="button" onClick={next}
                  className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                >
                  Next <IconArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {at < 5 && error && <p className="error-text mt-3">{error}</p>}
          </form>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <TrustRow compact />
            <Link to="/weddings" className="text-sm font-bold text-brand-700 hover:text-brand-800">
              Planning a wedding? Use the wedding planner →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
