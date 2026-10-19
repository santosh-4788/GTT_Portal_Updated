/**
 * Group travel.
 *
 * The question the office is asked most: "we are twenty-five, what do we need?"
 * Every competitor's site makes the customer answer that themselves by reading
 * seat counts. This page answers it out loud, live, as the number is typed —
 * one vehicle or several, which ones, and how many seats spare.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { fleetPlan, GROUP_EXAMPLES, BAG_LABEL, type Bags } from './recommend';
import { estimateFor, useRates, PlaceInput, Counter, ChoiceCard, ContactFields, EstimatePanel, SectionHead, SubmitButton, TrustRow, Callout, useContactDetails, useSendRequirement, emailError } from './kit';
import { lookupDistance } from './places';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone, IconPlus, IconTrash } from '../components/icons';
import { IconSeat, IconLuggage } from './SiteIcons';
import { DateField } from '../components/DateTimeField';
import { useSeo } from './Seo';

export default function GroupTravel() {
  useSeo({
    title: 'Tempo Traveller on Rent in Mumbai - 12, 17 Seater and Bus Hire',
    path: '/group-travel',
    description: 'Group travel from Mumbai in Force Traveller, Urbania and full-size coaches. Tell us the head count and luggage and we plan the right mix of vehicles.',
  });
  const book = useRates();
  const { send, busy, error } = useSendRequirement();

  const [pax, setPax] = useState(12);
  const [bags, setBags] = useState<Bags>('medium');
  const [pickups, setPickups] = useState<string[]>(['']);
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const plan = useMemo(() => fleetPlan(pax, bags), [pax, bags]);

  const days = useMemo(() => {
    if (!date || !returnDate) return 1;
    const ms = new Date(returnDate).getTime() - new Date(date).getTime();
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) + 1 : 1;
  }, [date, returnDate]);

  const km = lookupDistance(to);
  const outstation = Boolean(km);

  /** The estimate is the sum of the legs, because a fleet is priced per vehicle. */
  const total = useMemo(() => {
    if (!plan) return null;
    let sum = 0;
    for (const leg of plan.legs) {
      const e = estimateFor(book, leg.vehicle, {
        plan: outstation ? 'OUTSTATION' : 'LOCAL',
        days,
        distanceKm: km ? km * (returnDate ? 2 : 1) : undefined,
        vehicles: leg.count,
      });
      if (!e.estimate) return null;
      sum += e.estimate.total;
    }
    return sum;
  }, [plan, book, outstation, days, km, returnDate]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    send({
      kind: 'GROUP',
      from: pickups.filter(Boolean).join(' + '),
      to,
      date,
      returnDate,
      passengers: pax,
      bags: BAG_LABEL[bags],
      vehicleName: plan?.legs.map((l) => `${l.count} × ${l.vehicle.name}`).join(' + '),
      vehicleCount: plan?.legs.reduce((s, l) => s + l.count, 0) ?? 1,
      estimate: total,
      legs: plan?.legs.map((l) => ({ label: `${l.count} × ${l.vehicle.name}`, detail: `${l.vehicle.seats * l.count} seats` })),
      notes: [
        pickups.filter(Boolean).length > 1 ? `Multiple pickup points: ${pickups.filter(Boolean).join('; ')}` : '',
        days > 1 ? `${days} days` : '',
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
        eyebrow="Group travel"
        title="Travelling as a group?"
        sub="Tell us how many of you there are and we will tell you straight away whether that is one vehicle or several — and which ones, before you have to ask anybody."
        crumbs={[{ label: 'Group travel' }]}
        compact
      />

      <section className="shell">
        <div className="grid gap-6 lg:grid-cols-[1fr,22rem] lg:gap-8">
          {/* ------------------------------- the form ------------------------------- */}
          <form onSubmit={submit} className="min-w-0 space-y-5">
            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">Your group</h2>

              <div className="mt-5 max-w-sm">
                <Counter label="Passengers" value={pax} onChange={setPax} min={1} max={200} sub="Everyone who needs a seat" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[6, 12, 17, 25, 35, 50, 90].map((n) => (
                  <button
                    key={n} type="button" onClick={() => setPax(n)}
                    className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                      pax === n ? 'grad-brand text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <p className="mb-2.5 mt-6 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Luggage per person</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {(['light', 'medium', 'heavy'] as Bags[]).map((b) => (
                  <ChoiceCard
                    key={b} on={bags === b}
                    emoji={b === 'light' ? '\u{1F45D}' : b === 'medium' ? '\u{1F392}' : '\u{1F9F3}'}
                    title={BAG_LABEL[b]} onClick={() => setBags(b)}
                  />
                ))}
              </div>
            </div>

            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">The journey</h2>
              <p className="mt-1.5 text-sm text-ink-500">
                Groups rarely start in one place. Add every pickup point and we will build the run around them.
              </p>

              <div className="mt-5 space-y-4">
                {pickups.map((p, i) => (
                  <div key={i} className="flex items-end gap-2">
                    <PlaceInput
                      label={pickups.length > 1 ? `Pickup ${i + 1}` : 'Pickup'}
                      value={p}
                      onChange={(v) => setPickups((l) => l.map((x, j) => (j === i ? v : x)))}
                      placeholder="Andheri East"
                    />
                    {pickups.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPickups((l) => l.filter((_, j) => j !== i))}
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

                <PlaceInput label="Destination" value={to} onChange={setTo} placeholder="Mahabaleshwar" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="g-date">Travel date</label>
                    <DateField id="g-date" min={todayIso()} value={date} onChange={setDate} />
                  </div>
                  <div>
                    <label className="label" htmlFor="g-return">Return date</label>
                    <DateField id="g-return" min={date || todayIso()} value={returnDate} onChange={setReturnDate} placeholder="Single day" />
                    <p className="hint">Leave blank for a single day.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">Who should we call?</h2>
              <div className="mt-5">
                <ContactFields value={contact} onChange={setContact} error={fieldErrors} company />
              </div>
              <div className="mt-4">
                <label className="label" htmlFor="g-notes">Anything else about the group?</label>
                <textarea
                  id="g-notes" className="input min-h-[100px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="School group with two teachers, elderly passengers, musical instruments, a wheelchair…"
                />
              </div>

              {error && <p className="error-text mt-3">{error}</p>}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <SubmitButton busy={busy}>Get group options</SubmitButton>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
            </div>
          </form>

          {/* ---------------------------- the live answer ---------------------------- */}
          <aside className="lg:sticky lg:top-24 lg:self-start">
            {plan && (
              <div className="tile overflow-hidden">
                <div className="grad-soft px-5 py-5">
                  <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-700">Our recommendation</p>
                  <p className="mt-1.5 font-display text-[1.75rem] font-extrabold leading-none tracking-tight text-ink-900">
                    {plan.headline}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">{plan.note}</p>
                </div>

                <ul className="divide-y divide-ink-100">
                  {plan.legs.map((leg) => (
                    <li key={leg.vehicle.slug} className="flex items-center gap-3.5 p-4">
                      <span className="grad-soft h-14 w-20 shrink-0 overflow-hidden rounded-xl">
                        <VehiclePhoto
                          photo={leg.vehicle.photo} art={leg.vehicle.art}
                          name={leg.vehicle.name} alt={leg.vehicle.name}
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-ink-900">
                          {leg.count > 1 && `${leg.count} × `}{leg.vehicle.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-500">
                          <span className="inline-flex items-center gap-1"><IconSeat className="h-3.5 w-3.5" />{leg.vehicle.seats * leg.count} seats</span>
                          <span className="inline-flex items-center gap-1"><IconLuggage className="h-3.5 w-3.5" />{leg.vehicle.bags * leg.count} bags</span>
                        </span>
                      </span>
                      <Link
                        to={`/vehicles/${leg.vehicle.slug}`}
                        className="btn btn-sm shrink-0 rounded-full bg-ink-50 text-ink-700 hover:bg-ink-100"
                      >
                        View
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="p-4">
                  <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Estimated total</p>
                  {total ? (
                    <p className="mt-1 font-display text-xl font-bold text-ink-900">
                      ₹{Math.round(total).toLocaleString('en-IN')}
                      <span className="ml-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-warn-700">estimate</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-ink-500">Quoted on request</p>
                  )}
                  <p className="mt-1.5 text-2xs leading-relaxed text-ink-400">
                    All vehicles together, before toll, parking and permits. Group movements are usually quoted below the
                    sum of the individual vehicles — send the requirement and we will show you.
                  </p>
                </div>
              </div>
            )}

            <TrustRow compact className="mt-5" />
          </aside>
        </div>
      </section>

      {/* ============================== EXAMPLES ============================== */}
      <section className="shell pt-16 sm:pt-20">
        <SectionHead
          eyebrow="How it usually works out"
          title="Worked examples"
          sub="The same calculation, run for the group sizes we are asked about most."
          className="mb-8"
        />
        <div className="grid gap-5 sm:grid-cols-3">
          {GROUP_EXAMPLES.map((ex, i) => (
            <Reveal key={ex.pax} delay={i * 70}>
              <button
                onClick={() => setPax(ex.pax)}
                className="tile tile-lift h-full w-full p-6 text-left"
              >
                <p className="font-display text-[1.6rem] font-extrabold leading-none text-ink-900">{ex.pax}</p>
                <p className="mt-1 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">passengers</p>
                <p className="mt-4 inline-flex rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
                  {ex.plan.headline}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {ex.plan.legs.map((l) => (
                    <li key={l.vehicle.slug} className="flex gap-2 text-sm text-ink-600">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" />
                      {l.count > 1 && `${l.count} × `}{l.vehicle.name}
                    </li>
                  ))}
                </ul>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                  Use this size <IconArrowRight className="h-3 w-3" />
                </span>
              </button>
            </Reveal>
          ))}
        </div>

        <Callout className="mt-6">
          Over fifty people, or several vehicles on different timings, is a fleet rather than a group —{' '}
          <Link to="/fleet-request" className="font-bold underline">plan a fleet</Link> instead, and you can set the
          categories and the timings per vehicle.
        </Callout>
      </section>
    </div>
  );
}
