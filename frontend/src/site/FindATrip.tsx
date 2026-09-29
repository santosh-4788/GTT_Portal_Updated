/**
 * Help me find a trip.
 *
 * Discovery rather than search. A customer who does not yet know where they
 * want to go cannot use a "from / to" box, and every travel site in this market
 * gives them one anyway. This asks what they like and answers with places.
 *
 * The matching is transparent: each destination is scored on how many of the
 * chosen interests it carries and whether the nights fit, and the card says why
 * it came up.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DESTINATIONS, THEMES, type Destination, type Theme } from './places';
import { fleetPlan } from './recommend';
import { tripQuery } from './tripParams';
import { DestinationCard } from './PlaceCards';
import {
  BackLink, Callout, ChoiceCard, Counter, PlaceInput, SectionHead, SiteEmpty,
  Stepper, TrustRow, estimateFor, useRates,
} from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck } from '../components/icons';
import { useSeo } from './Seo';

const STEPS = ['Start', 'People', 'Days', 'Budget', 'Interests'];

const BUDGETS = [
  { key: 'ANY', label: 'No fixed budget', sub: 'Show me everything' },
  { key: 'LOW', label: 'Up to ₹15,000', sub: 'Keep the vehicle cost tight' },
  { key: 'MID', label: '₹15,000 – ₹35,000', sub: 'A comfortable weekend' },
  { key: 'HIGH', label: 'Above ₹35,000', sub: 'Distance or a bigger vehicle' },
];

const CAP: Record<string, number> = { ANY: Infinity, LOW: 15_000, MID: 35_000, HIGH: Infinity };
const FLOOR: Record<string, number> = { ANY: 0, LOW: 0, MID: 15_000, HIGH: 35_000 };

export default function FindATrip() {
  useSeo({
    title: 'Find a Trip from Mumbai',
    path: '/find-a-trip',
    description: 'Tell us where you start, how many are travelling, the days and budget, and we suggest road trips from Mumbai that fit.',
  });
  const book = useRates();

  const [at, setAt] = useState(0);
  const [done, setDone] = useState(false);

  const [from, setFrom] = useState('Mumbai');
  const [pax, setPax] = useState(4);
  const [days, setDays] = useState(2);
  const [budget, setBudget] = useState('ANY');
  const [themes, setThemes] = useState<Theme[]>([]);

  const plan = useMemo(() => fleetPlan(pax, 'medium'), [pax]);
  const lead = plan?.legs[0]?.vehicle;

  /** Cost of the drive for this destination, at the group's vehicle. */
  const costOf = (d: Destination) => {
    if (!lead) return undefined;
    const e = estimateFor(book, lead, {
      plan: 'OUTSTATION',
      days,
      distanceKm: d.km * 2,
      vehicles: plan?.legs.reduce((s, l) => s + l.count, 0) ?? 1,
    });
    return e.estimate?.total;
  };

  const matches = useMemo(() => {
    const nights = Math.max(0, days - 1);

    const scored = DESTINATIONS.map((d) => {
      const hits = themes.filter((t) => d.themes.includes(t));
      let score = hits.length * 10;

      // Nights that suit the place matter more than anything else.
      if (d.nights.includes(nights)) score += 14;
      else if (d.nights.some((n) => Math.abs(n - nights) === 1)) score += 5;
      else score -= 12;

      // Shorter drives win a tie on a short trip, and lose one on a long trip.
      score += nights <= 1 ? Math.max(0, 8 - d.km / 40) : Math.min(8, d.km / 60);

      const cost = costOf(d);
      let priced = true;
      if (cost !== undefined && budget !== 'ANY') {
        if (cost > CAP[budget] || cost < FLOOR[budget]) priced = false;
      }

      const why = [
        ...hits.map((h) => THEMES.find((t) => t.key === h)?.label ?? h),
        d.nights.includes(nights) ? (nights === 0 ? 'works as a day trip' : `suits ${nights} night${nights > 1 ? 's' : ''}`) : '',
      ].filter(Boolean);

      return { d, score, why, cost, priced };
    });

    return scored
      .filter((s) => s.priced && (themes.length === 0 || s.why.length > 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [themes, days, pax, budget, book.loaded]);

  const toggleTheme = (t: Theme) =>
    setThemes((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]));

  /** Results → questions → previous question → leave. */
  const stepBack = (): boolean => {
    if (done) { setDone(false); return true; }
    if (at > 0) { setAt((i) => i - 1); return true; }
    return false;
  };

  /* ======================================================================
     Results
     ====================================================================== */
  if (done) {
    return (
      <div className="page-bg pb-24 pt-28 sm:pt-32">
        <div className="shell">
          <BackLink to="/weekend-trips" className="mb-4" onBack={stepBack} label="Back to the questions" />
          <p className="lead">Recommended trips for you</p>
          <h1 className="font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.6rem]">
            {matches.length ? `${matches.length} places that fit` : 'Nothing quite fits that'}
          </h1>
          <p className="mt-3 max-w-2xl text-md leading-[1.7] text-ink-600">
            From {from || 'Mumbai'} · {pax} {pax === 1 ? 'person' : 'people'} · {days} {days === 1 ? 'day' : 'days'}
            {themes.length > 0 && ` · ${themes.map((t) => THEMES.find((x) => x.key === t)?.label).join(', ')}`}
            {plan && ` · ${plan.headline.toLowerCase()}`}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => { setDone(false); setAt(0); }}
              className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised"
            >
              Change my answers
            </button>
            <Link to="/weekend-trips" className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-white">
              Browse everything <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {matches.length === 0 ? (
            <div className="mt-9">
              <SiteEmpty
                emoji="🧭"
                title="That combination is a little tight"
                body="Widening the budget or adding a night usually opens it up. Or tell us what you had in mind and we will suggest something ourselves."
                action={
                  <>
                    <button onClick={() => { setBudget('ANY'); }} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                      Drop the budget filter
                    </button>
                    <Link to="/enquiry" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                      Ask us instead
                    </Link>
                  </>
                }
              />
            </div>
          ) : (
            <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((m, i) => (
                <Reveal key={m.d.slug} delay={(i % 3) * 60}>
                  <div className="flex h-full flex-col gap-3">
                    <DestinationCard d={m.d} index={i} nights={Math.max(0, days - 1)} />
                    <div className="tile p-4">
                      <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Why this one</p>
                      <ul className="mt-2 space-y-1.5">
                        {m.why.slice(0, 3).map((w) => (
                          <li key={w} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                            <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" /> {w}
                          </li>
                        ))}
                      </ul>
                      {m.cost !== undefined && (
                        <p className="mt-3 border-t border-ink-100 pt-3 text-sm font-semibold text-ink-900">
                          ₹{Math.round(m.cost).toLocaleString('en-IN')}
                          <span className="ml-1 text-2xs font-semibold uppercase tracking-[0.1em] text-warn-700">est. vehicle</span>
                        </p>
                      )}
                      <Link
                        to={`/enquiry?${tripQuery({ tab: 'OUTSTATION', from, to: m.d.name, pax, returnDate: days > 1 ? 'x' : '' })}${lead ? `&vehicle=${lead.slug}` : ''}`}
                        className="grad-brand btn mt-3.5 h-10 w-full rounded-full text-sm font-semibold text-white hover:brightness-[1.06]"
                      >
                        Plan this trip
                      </Link>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          )}

          {!book.rates.length && (
            <Callout className="mt-7">
              Vehicle costs appear here once the walk-in rate card is filled in. The matching by interest, nights and
              group size works either way.
            </Callout>
          )}

          <div className="mt-10">
            <TrustRow />
          </div>
        </div>
      </div>
    );
  }

  /* ======================================================================
     Questions
     ====================================================================== */
  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mx-auto max-w-2xl">
          <BackLink to="/weekend-trips" className="mb-4" onBack={stepBack} />
          <p className="lead">Help me find a trip</p>
          <h1 className="font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
            Do not know where yet? Start from what you like.
          </h1>

          <div className="mt-7">
            <Stepper steps={STEPS} at={at} onJump={setAt} />
          </div>

          <div className="tile mt-6 p-6 sm:p-8">
            {at === 0 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">Where are you starting from?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Most trips start in Mumbai, but we pick up from Thane, Navi Mumbai and Pune too.</p>
                <div className="mt-6 max-w-sm">
                  <PlaceInput label="Starting point" value={from} onChange={setFrom} placeholder="Andheri East" />
                </div>
              </div>
            )}

            {at === 1 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">How many people?</h2>
                <p className="mt-1.5 text-sm text-ink-500">This decides the vehicle, and the vehicle decides most of the cost.</p>
                <div className="mt-6 max-w-sm">
                  <Counter label="Travelling" value={pax} onChange={setPax} min={1} max={60} />
                </div>
                {plan && (
                  <div className="mt-5 rounded-2xl bg-brand-50/70 p-4">
                    <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-700">That is</p>
                    <p className="mt-1 font-display text-md font-bold text-ink-900">{plan.headline}</p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{plan.note}</p>
                  </div>
                )}
              </div>
            )}

            {at === 2 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">How many days?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Counting the travel days. Two days means one night away.</p>
                <div className="mt-6 max-w-sm">
                  <Counter label="Days" value={days} onChange={setDays} min={1} max={10} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n} onClick={() => setDays(n)}
                      className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors ${
                        days === n ? 'grad-brand text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                      }`}
                    >
                      {n} {n === 1 ? 'day' : 'days'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {at === 3 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">Roughly what budget?</h2>
                <p className="mt-1.5 text-sm text-ink-500">
                  For the vehicle only — hotels, food and entries are separate. Skip it if you would rather see
                  everything.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {BUDGETS.map((b) => (
                    <ChoiceCard key={b.key} on={budget === b.key} title={b.label} sub={b.sub} onClick={() => setBudget(b.key)} />
                  ))}
                </div>
              </div>
            )}

            {at === 4 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">What do you prefer?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Pick as many as you like. Leave it blank and we will show the closest options for your dates.</p>
                <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {THEMES.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => toggleTheme(t.key)}
                      aria-pressed={themes.includes(t.key)}
                      className={`flex flex-col items-center gap-2 rounded-2xl p-4 transition-all duration-300 ${
                        themes.includes(t.key) ? 'grad-soft shadow-raised ring-2 ring-brand-400' : 'bg-ink-50/70 hover:bg-ink-100/70'
                      }`}
                    >
                      <span className="text-2xl" aria-hidden="true">{t.emoji}</span>
                      <span className="text-xs font-bold text-ink-800">{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* One Back only: the one at the top steps back through the questions. */}
            <div className="mt-8 flex items-center justify-end gap-3">
              <button
                onClick={() => (at === STEPS.length - 1 ? setDone(true) : setAt((i) => i + 1))}
                className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
              >
                {at === STEPS.length - 1 ? 'Show my trips' : 'Next'} <IconArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <SectionHead
            className="mt-14"
            eyebrow="Or just browse"
            title="Every destination we drive to"
            sub="Twelve places within a day's drive of Mumbai, sorted by distance."
            action={
              <Link to="/weekend-trips" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                Weekend escapes <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
        </div>
      </div>
    </div>
  );
}
