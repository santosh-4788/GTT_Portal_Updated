/**
 * "Help me choose."
 *
 * Four questions, one screen at a time, and then the answer we would give on
 * the phone — with the reasoning shown. This is the feature none of the Indian
 * mobility sites have: they all assume the customer already knows whether they
 * want a Dzire or an Ertiga, and the customer usually does not.
 *
 * The recommendation is arithmetic, not a black box (see recommend.ts), so the
 * "why" lines under the answer are the actual reasons it won.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BAG_LABEL, recommend,
  type Bags, type Length, type Priority, type Requirement, type Scope,
} from './recommend';
import { estimateInputFor, tripPrefill, tripQuery, readTrip } from './tripParams';
import { DESTINATIONS, MUMBAI_SPOTS } from './places';
import { DestinationCard, SpotCard } from './PlaceCards';
import { HOURLY_PACKAGES } from './QuickBook';
import { VehicleCard } from './VehicleCard';
import {
  BackLink, ChoiceCard, Counter, EstimatePanel, SectionHead, Stepper, TrustRow,
  estimateFor, useRates, CompareProvider,
} from './kit';
import { CompareTray } from './VehicleCard';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck } from '../components/icons';
import { IconSeat, IconLuggage } from './SiteIcons';

const STEPS = ['People', 'Luggage', 'Where', 'How long'];

const SCOPES: { key: Scope; emoji: string; label: string; sub: string }[] = [
  { key: 'local', emoji: '\u{1F3D9}️', label: 'Within Mumbai', sub: 'City, Thane and Navi Mumbai' },
  { key: 'outstation', emoji: '\u{1F6E4}️', label: 'Outstation', sub: 'Out of the city, and back' },
];

/**
 * How long the trip runs for — asked differently for a city trip and an
 * outstation one, because they are not sold the same way.
 *
 * A city day IS an hourly package: 4 hrs / 40 km or 8 hrs / 80 km are rows on
 * the rate card, so naming them means the answer here and the package quoted
 * later are the same thing rather than two separate questions.
 *
 * An outstation trip is not. Offering "4 hrs / 40 km" for a run to Pune was
 * nonsense — the package does not exist for that trip and the distance alone
 * exceeds it. Outstation is sold by whether the car comes back, and on how many
 * days it is away, so that is what it asks.
 *
 * Both lists use the same four keys, so the scoring behind them is unchanged.
 */
type LengthOption = { key: Length; emoji: string; label: string; sub: string };

const LENGTHS_BY_SCOPE: Record<Scope, LengthOption[]> = {
  local: [
    { key: 'few-hours', emoji: '\u{23F1}\uFE0F', label: 'Half day', sub: '4 hrs / 40 km package' },
    { key: 'full-day', emoji: '\u{2600}\uFE0F', label: 'Full day', sub: '8 hrs / 80 km, back the same night' },
    { key: 'overnight', emoji: '\u{1F319}', label: '2 days, 1 night', sub: 'Out today, back tomorrow' },
    { key: 'multi-day', emoji: '\u{1F5D3}\uFE0F', label: '3 days or more', sub: 'Two nights away or more' },
  ],
  outstation: [
    { key: 'few-hours', emoji: '\u{27A1}\uFE0F', label: 'One-way drop', sub: 'Dropped there, the car does not wait' },
    { key: 'full-day', emoji: '\u{2600}\uFE0F', label: 'Same day return', sub: 'Out and back within the day' },
    { key: 'overnight', emoji: '\u{1F319}', label: '2 days, 1 night', sub: 'One night away' },
    { key: 'multi-day', emoji: '\u{1F5D3}\uFE0F', label: '3 days or more', sub: 'Two nights away or more' },
  ],
};

const lengthLabel = (scope: Scope, key: Length) =>
  LENGTHS_BY_SCOPE[scope].find((l) => l.key === key)?.label ?? key;

export default function HelpMeChoose() {
  const [at, setAt] = useState(0);
  const [done, setDone] = useState(false);
  const book = useRates();

  const [req, setReq] = useState<Requirement>({
    passengers: 4,
    bags: 'medium',
    scope: 'local',
    length: 'full-day',
    // The wizard used to ask this as a fifth step. It was the only question
    // that changed nothing but a tie-break, and it asked the customer to do
    // the arithmetic's job. It is now DERIVED from the four answers instead
    // — see `priority` below — and this stored value is never read.
    priority: 'comfort',
  });

  const set = (p: Partial<Requirement>) => setReq((v) => ({ ...v, ...p }));

  /**
   * What the recommendation optimises for, from the answers rather than fixed.
   *
   * Passing 'comfort' for everything is why this screen answered a Mumbai day
   * for four with an Innova: comfort is worth up to 32 points in the scoring
   * and it outweighed the size and value terms that should decide a city trip.
   * A night away or a trip out of Mumbai is hours in the seat and comfort is
   * right; a few hours or a day in town is not.
   */
  const priority: Priority =
    req.scope === 'outstation' || req.length === 'overnight' || req.length === 'multi-day'
      ? 'comfort'
      : 'price';

  const results = useMemo(() => recommend({ ...req, priority }), [req, priority]);
  const top = results[0];
  const alternatives = results.slice(1, 4);

  const estInput = useMemo(
    () =>
      // Only the fields the estimate actually reads. The wizard has no
      // addresses or times to give it — it has a group size and a trip shape.
      estimateInputFor({
        tab: req.scope === 'outstation' ? 'OUTSTATION' : req.length === 'few-hours' ? 'HOURLY' : 'LOCAL',
        to: '',
        date: '',
        returnDate: req.length === 'multi-day' ? 'x' : '',
        plan: '',
      }),
    [req]
  );

  const next = () => (at === STEPS.length - 1 ? setDone(true) : setAt((i) => i + 1));
  const back = () => (at === 0 ? undefined : setAt((i) => i - 1));

  /** One step back means the previous question, not the previous page. */
  const stepBack = (): boolean => {
    if (done) { setDone(false); return true; }
    if (at > 0) { setAt((i) => i - 1); return true; }
    return false;
  };

  /* ======================================================================
     The answer
     ====================================================================== */
  if (done && top) {
    const est = estimateFor(book, top.vehicle, { ...estInput, vehicles: top.count });
    const q = tripQuery({
      tab: req.scope === 'outstation' ? 'OUTSTATION' : req.length === 'few-hours' ? 'HOURLY' : 'LOCAL',
      pax: req.passengers,
      // "One-way drop" is the outstation answer to how long, so carry it
      // through — otherwise the vehicles page prices a return the customer
      // just said they did not want.
      leg: req.scope === 'outstation' && req.length !== 'few-hours' ? 'RETURN' : 'ONE_WAY',
    });
    /**
     * Where to go, from the same answers.
     *
     * An outstation trip is matched on the nights available; a city trip on
     * whether a stop fits inside the hours. Nothing is invented — both lists
     * are the ones the weekend and Mumbai pages already publish.
     */
    const nights = req.length === 'multi-day' ? 2 : req.length === 'overnight' ? 1 : 0;
    const places = DESTINATIONS.filter((d) => d.nights.includes(nights)).slice(0, 3);

    const hours = req.length === 'few-hours' ? 4 : 10;
    const spots = MUMBAI_SPOTS.filter((sp) => sp.minutes <= hours * 60 * 0.45).slice(0, 4);

    /** The package a city day is actually sold as. */
    const pkg = req.scope === 'local'
      ? HOURLY_PACKAGES[req.length === 'few-hours' ? 0 : 1]
      : null;

    /** The trip, ready to prefill the enquiry sheet behind all three buttons. */
    const contactFor = (_slug: string, name: string, count: number) =>
      tripPrefill(
        readTrip(new URLSearchParams(q)),
        count > 1 ? `${count} x ${name}` : name,
      );


    return (
      <CompareProvider>
        <div className="page-bg pb-28 pt-28 sm:pt-32">
          <div className="shell">
            <BackLink to="/book" className="mb-4" onBack={stepBack} label="Back to the questions" />
            <p className="lead">Our recommendation</p>
            <h1 className="font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.6rem]">
              {top.count > 1 ? `${top.count} × ${top.vehicle.name}` : top.vehicle.name}
            </h1>
            <p className="mt-3 max-w-2xl text-md leading-[1.7] text-ink-600">
              Best match for {req.passengers} {req.passengers === 1 ? 'passenger' : 'passengers'} ·{' '}
              {BAG_LABEL[req.bags].toLowerCase()} · {req.scope === 'outstation' ? 'outstation' : 'within Mumbai'}.
            </p>

            <div className="mt-9 grid gap-6 lg:grid-cols-[1fr,20rem] lg:gap-8">
              <div>
                <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
                  <VehicleCard
                    vehicle={top.vehicle} best count={top.count} estimateInput={estInput}
                    to={`/vehicles/${top.vehicle.slug}?${q}`}
                    contact={contactFor(top.vehicle.slug, top.vehicle.name, top.count)}
                  />

                  <div className="tile flex flex-col p-6">
                    <h2 className="font-display text-md font-bold text-ink-900">Why this one</h2>
                    <ul className="mt-4 space-y-3">
                      {top.why.map((w) => (
                        <li key={w} className="flex gap-2.5 text-sm leading-relaxed text-ink-600">
                          <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {w}
                        </li>
                      ))}
                    </ul>

                    <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-ink-100 pt-5">
                      <div>
                        <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Seats</dt>
                        <dd className="mt-1 flex items-center gap-1.5 font-display text-md font-bold text-ink-900">
                          <IconSeat className="h-4 w-4 text-brand-500" /> {top.vehicle.seats * top.count}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Large bags</dt>
                        <dd className="mt-1 flex items-center gap-1.5 font-display text-md font-bold text-ink-900">
                          <IconLuggage className="h-4 w-4 text-brand-500" /> {top.vehicle.bags * top.count}
                        </dd>
                      </div>
                    </dl>

                    {/* The package a city day is sold as. Outstation is
                        priced per kilometre, so there is nothing to show. */}
                    {pkg && (
                      <div className="mt-6 rounded-xl bg-brand-50/70 p-4">
                        <p className="text-2xs font-bold uppercase tracking-[0.12em] text-brand-700">
                          Suggested package
                        </p>
                        <p className="mt-1 font-display text-md font-bold text-ink-900">{pkg.label}</p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-500">
                          Extra hours and kilometres beyond the package are charged at the card rate,
                          told to you before the car is sent.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {alternatives.length > 0 && (
                  <div className="mt-10">
                    <SectionHead
                      eyebrow="Also worth a look"
                      title="Alternatives"
                      sub="The next best answers for the same requirement, so you can see what a step up or down changes."
                      className="mb-7"
                    />
                    {/* Two across at most. The vehicle card is a horizontal
                        layout - text beside a fixed 9.5rem photo - so it needs
                        about 350px to hold together. Three of them in a column
                        that already gives space to the summary rail left roughly
                        200px each: the spec line broke to "6-7 / seater / AC cab"
                        and the three buttons spilled out of the card. */}
                    <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
                      {alternatives.map((s, i) => (
                        <Reveal key={s.vehicle.slug} delay={i * 70}>
                          <VehicleCard
                            vehicle={s.vehicle} index={i + 1} count={s.count}
                            estimateInput={estInput} to={`/vehicles/${s.vehicle.slug}?${q}`} compact
                            contact={contactFor(s.vehicle.slug, s.vehicle.name, s.count)}
                          />
                        </Reveal>
                      ))}
                    </div>
                  </div>
                )}

                {/* ------------------------------------------------------
                    Where to go, matched to the same answers.
                    ------------------------------------------------------ */}
                {req.scope === 'outstation' && places.length > 0 && (
                  <div className="mt-10">
                    <SectionHead
                      eyebrow="Where people go"
                      title={nights === 0 ? 'Day trips that fit' : `Places that suit ${nights === 1 ? 'one night' : 'two nights or more'}`}
                      sub="From the routes we run most weeks, filtered to the time you said you have."
                      className="mb-7"
                    />
                    <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
                      {places.map((d, i) => (
                        <Reveal key={d.slug} delay={i * 70}>
                          <DestinationCard d={d} index={i} nights={nights || undefined} />
                        </Reveal>
                      ))}
                    </div>
                  </div>
                )}

                {req.scope === 'local' && spots.length > 0 && (
                  <div className="mt-10">
                    <SectionHead
                      eyebrow="Worth the drive"
                      title="Stops that fit the hours"
                      sub="Each of these sits comfortably inside the time you said you have, with the driving allowed for."
                      className="mb-7"
                    />
                    <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
                      {spots.map((sp, i) => (
                        <Reveal key={sp.slug} delay={i * 70}>
                          <SpotCard s={sp} index={i} />
                        </Reveal>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* -------- your answers, and the estimate -------- */}
              <aside className="lg:sticky lg:top-24 lg:self-start">
                <EstimatePanel estimate={est.estimate} planLabel={est.planLabel} reason={est.reason} vehicles={top.count} />

                <div className="tile mt-5 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-display text-md font-bold text-ink-900">What you told us</h2>
                    <button onClick={() => { setDone(false); setAt(0); }} className="text-xs font-bold text-brand-700 hover:text-brand-800">
                      Change
                    </button>
                  </div>
                  <dl className="mt-4 space-y-3 text-sm">
                    {[
                      ['Passengers', String(req.passengers)],
                      ['Luggage', BAG_LABEL[req.bags]],
                      ['Where', req.scope === 'outstation' ? 'Outstation' : 'Within Mumbai'],
                      ['How long', lengthLabel(req.scope, req.length)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-baseline justify-between gap-4">
                        <dt className="text-ink-500">{k}</dt>
                        <dd className="text-right font-semibold text-ink-900">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>

                <div className="mt-5">
                  <Link
                    to={`/enquiry?${q}&vehicle=${top.vehicle.slug}`}
                    className="grad-brand btn h-12 w-full rounded-full text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                  >
                    Send the requirement <IconArrowRight className="h-4 w-4" />
                  </Link>
                  <Link to={`/vehicles?${q}`} className="btn mt-2.5 h-11 w-full rounded-full bg-white text-md text-ink-800 shadow-card hover:shadow-raised">
                    See all vehicles
                  </Link>
                </div>

                <TrustRow compact className="mt-6" />
              </aside>
            </div>
          </div>

          <CompareTray />
        </div>
      </CompareProvider>
    );
  }

  /* ======================================================================
     The questions
     ====================================================================== */
  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mx-auto max-w-2xl">
          <BackLink to="/book" className="mb-4" onBack={stepBack} />
          <p className="lead">Help me choose</p>
          <h1 className="font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
            Four questions, then we will tell you what we would send.
          </h1>

          <div className="mt-7">
            <Stepper steps={STEPS} at={at} onJump={setAt} />
          </div>

          <div className="tile mt-6 p-6 sm:p-8">
            {at === 0 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">How many people are travelling?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Count everyone who needs a seat, including children.</p>
                <div className="mt-6">
                  <Counter label="Passengers" value={req.passengers} onChange={(v) => set({ passengers: v })} min={1} max={60} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[2, 4, 6, 12, 17, 25, 45].map((n) => (
                    <button
                      key={n}
                      onClick={() => set({ passengers: n })}
                      className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-colors ${
                        req.passengers === n ? 'grad-brand text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {at === 1 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">How much luggage?</h2>
                <p className="mt-1.5 text-sm text-ink-500">
                  This is the question that changes the answer most. Six people with a suitcase each do not fit in a
                  six-seater.
                </p>
                <div className="mt-6 grid gap-3">
                  {(['light', 'medium', 'heavy'] as Bags[]).map((b) => (
                    <ChoiceCard
                      key={b}
                      on={req.bags === b}
                      emoji={b === 'light' ? '\u{1F45D}' : b === 'medium' ? '\u{1F392}' : '\u{1F9F3}'}
                      title={BAG_LABEL[b]}
                      sub={
                        b === 'light' ? 'Cabin bags and laptop bags only'
                          : b === 'medium' ? 'One bag per person, boot-sized'
                          : 'Full-size suitcases, or gear'
                      }
                      onClick={() => set({ bags: b })}
                    />
                  ))}
                </div>
              </div>
            )}

            {at === 2 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">Local or outstation?</h2>
                <p className="mt-1.5 text-sm text-ink-500">A highway run and a day of city meetings need different vehicles.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {SCOPES.map((s) => (
                    <ChoiceCard key={s.key} on={req.scope === s.key} emoji={s.emoji} title={s.label} sub={s.sub} onClick={() => set({ scope: s.key })} />
                  ))}
                </div>
              </div>
            )}

            {at === 3 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">How long is the trip?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Longer trips weight comfort over price — the seat matters more at hour five.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {LENGTHS_BY_SCOPE[req.scope].map((l) => (
                    <ChoiceCard key={l.key} on={req.length === l.key} emoji={l.emoji} title={l.label} sub={l.sub} onClick={() => set({ length: l.key })} />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 flex items-center justify-between gap-3">
              <button
                onClick={back}
                disabled={at === 0}
                className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-ink-50 disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={next}
                className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
              >
                {at === STEPS.length - 1 ? 'Show my recommendation' : 'Next'} <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <p className="mt-5 text-center text-xs text-ink-400">
            Nothing is booked at the end of this. You get a recommendation, an estimate and the option to change it.
          </p>
        </div>
      </div>
    </div>
  );
}
