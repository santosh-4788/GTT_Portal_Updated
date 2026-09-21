/**
 * Vehicle search.
 *
 * The screen the customer lands on after telling us the trip. It answers three
 * questions at once — what fits, what it costs, and which one we would send —
 * where the usual cab site answers only the first and hides the second until
 * you have entered your phone number.
 *
 * The trip itself lives in the URL, so a search is a link the customer can send
 * to whoever is paying for the trip.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { dmy } from '../lib/format';
import { VEHICLES, ON_REQUEST_CLASSES, capacityOf, type CatalogVehicle } from './catalog';
import { recommend, type Bags, type Priority } from './recommend';
import { HOURLY_PACKAGES, QuickBook } from './QuickBook';
import { estimateInputFor, tripPrefill, tripQuery, useTripParams } from './tripParams';
import { WhatsAppButton } from './EnquirySheet';
import { VehicleCard, CompareTray } from './VehicleCard';
import {
  BackLink, BottomSheet, Callout, CompareProvider, SectionHead, SiteEmpty,
  SkeletonGrid, TrustRow, estimateFor, useRates,
} from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck, IconChevron, IconEdit, IconSettings } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

/* ==========================================================================
   Filters
   ========================================================================== */

interface Filters {
  /** Keys from TYPES below, not raw rate-card categories. */
  types: string[];
  /** Exact seat counts, as the fleet actually offers them. */
  seats: number[];
  minBags: number;
}

const NO_FILTERS: Filters = { types: [], seats: [], minBags: 0 };

/** The capacities the fleet actually has — not invented brackets. */
const SEAT_OPTIONS = [...new Set(VEHICLES.map((v) => v.seats))].sort((a, b) => a - b);

/**
 * Vehicle types in the words a customer uses.
 *
 * The rate card distinguishes "Sedan" from "Premium sedan" because they are
 * priced differently; a customer choosing between them is choosing a car. The
 * premium ones are still marked on every card by their comfort band, so
 * nothing is hidden by folding the two together here.
 */
const TYPES: { key: string; label: string; has: (category: string) => boolean }[] = [
  { key: 'car', label: 'Sedan', has: (c) => c.toLowerCase().includes('sedan') },
  { key: 'suv', label: 'SUV', has: (c) => c.toLowerCase().includes('suv') },
  { key: 'traveller', label: 'Tempo Travellers', has: (c) => c === 'Group' },
  { key: 'coach', label: 'Coaches', has: (c) => c === 'Coach' },
];

const typeOf = (category: string) => TYPES.find((t) => t.has(category))?.key ?? '';

/**
 * Luggage thresholds that actually narrow something.
 *
 * Showing the count behind each option made it obvious that "2 or more bags"
 * matched every vehicle — every car in the fleet takes two. An option
 * that cannot change the result is noise, so the no-ops are dropped rather
 * than left there to be clicked.
 */
const BAG_STEPS = [2, 3, 4, 10].filter((n) => {
  const hits = VEHICLES.filter((v) => v.bags >= n).length;
  return hits > 0 && hits < VEHICLES.length;
});

function activeCount(f: Filters): number {
  return (
    f.types.length + f.seats.length + (f.minBags ? 1 : 0)
  );
}

/**
 * One filter option: a control, a label, and how many vehicles are behind it.
 *
 * The count is what a chip could not show, and it is the difference between
 * guessing and knowing whether ticking something will empty the page.
 */
function FilterRow({
  type, name, on, onChange, label, count,
}: {
  type: 'checkbox' | 'radio'; name?: string; on: boolean;
  onChange: () => void; label: string; count: number;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors
                  hover:bg-white ${on ? 'font-semibold text-ink-900' : 'text-ink-700'}`}
    >
      <input type={type} name={name} checked={on} onChange={onChange} className="check" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-2xs font-semibold tabular-nums text-ink-400">{count}</span>
    </label>
  );
}

function FilterPanel({ f, set }: { f: Filters; set: (p: Partial<Filters>) => void }) {
  const toggleType = (k: string) =>
    set({ types: f.types.includes(k) ? f.types.filter((x) => x !== k) : [...f.types, k] });
  const toggleSeats = (n: number) =>
    set({ seats: f.seats.includes(n) ? f.seats.filter((x) => x !== n) : [...f.seats, n] });

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Vehicle type</p>
        <div className="-mx-2">
          {TYPES.map((t) => (
            <FilterRow
              key={t.key} type="checkbox" label={t.label}
              on={f.types.includes(t.key)} onChange={() => toggleType(t.key)}
              count={VEHICLES.filter((v) => t.has(v.category)).length}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Seating</p>
        <div className="-mx-2">
          {SEAT_OPTIONS.map((n) => (
            <FilterRow
              key={n} type="checkbox" label={`${n} seats`}
              on={f.seats.includes(n)} onChange={() => toggleSeats(n)}
              count={VEHICLES.filter((v) => v.seats === n).length}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Luggage</p>
        <div className="-mx-2">
          <FilterRow
            type="radio" name="bags" label="Any"
            on={f.minBags === 0} onChange={() => set({ minBags: 0 })}
            count={VEHICLES.length}
          />
          {BAG_STEPS.map((n) => (
            <FilterRow
              key={n} type="radio" name="bags" label={`${n} or more bags`}
              on={f.minBags === n} onChange={() => set({ minBags: n })}
              count={VEHICLES.filter((v) => v.bags >= n).length}
            />
          ))}
        </div>
      </div>

    </div>
  );
}

/* ==========================================================================
   The page
   ========================================================================== */

/**
 * The header's Vehicles menu links straight to a filtered list — `?cat=Sedan`,
 * or `?cat=Premium` for both premium classes — so a menu item lands on a
 * filtered page rather than the whole fleet with the customer left to narrow it
 * themselves.
 */
function filtersFromUrl(params: URLSearchParams): Filters {
  const cat = (params.get('cat') ?? '').toLowerCase();
  return {
    ...NO_FILTERS,
    types: cat
      ? TYPES.filter((t) => t.key === cat || t.label.toLowerCase().includes(cat)).map((t) => t.key)
      : [],
  };
}

export default function Vehicles() {
  const trip = useTripParams();
  const book = useRates();
  const [params] = useSearchParams();

  const [f, setF] = useState<Filters>(() => filtersFromUrl(params));
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState(false);

  const set = (p: Partial<Filters>) => setF((v) => ({ ...v, ...p }));

  const estInput = useMemo(() => estimateInputFor(trip), [trip.tab, trip.to, trip.date, trip.returnDate, trip.plan]);

  /**
   * Our own ranking, and how many of each vehicle this group needs.
   *
   * WHAT "BEST MATCH" OPTIMISES FOR IS DERIVED FROM THE TRIP, NOT ASSERTED.
   *
   * This page used to pass `priority: 'comfort'` for every search, and that is
   * why two passengers going from Andheri to Bandra Terminus were answered
   * with a six-seat Innova: the comfort term in `recommend` is worth up to 32
   * points and it outweighed the size and value terms that should decide a
   * twenty-minute drop. Nobody had asked for comfort — they had said two
   * people and a short hop.
   *
   * So the priority now comes from what the customer actually told us. A long
   * or multi-day trip is hours in the vehicle and comfort is the right answer;
   * a local or hourly run is better served by the smallest car that genuinely
   * fits, which is what `price` means here.
   *
   * Luggage is inferred the same way rather than assumed light: people fly
   * with suitcases, and a night away means a bag each.
   */
  const ranked = useMemo(() => {
    // 'medium' is a bag each. 'heavy' means large suitcases, and inferring it
    // from a return date was too strong: usableSeats discounts an Innova to
    // three seats at that load, so four people on a weekend away were told
    // they needed TWO of them. A night away is a bag each, not a suitcase each.
    const bags: Bags =
      trip.returnDate || trip.tab === 'AIRPORT' || trip.tab === 'OUTSTATION' || trip.pax > 6
        ? 'medium'
        : 'light';

    const priority: Priority =
      trip.tab === 'OUTSTATION' || trip.returnDate ? 'comfort' : 'price';

    const list = recommend({
      passengers: trip.pax,
      bags,
      scope: trip.tab === 'OUTSTATION' ? 'outstation' : 'local',
      length: trip.returnDate ? 'multi-day' : trip.tab === 'HOURLY' ? 'few-hours' : 'full-day',
      priority,
    });
    const order = new Map(list.map((s, i) => [s.vehicle.slug, i]));
    const counts = new Map(list.map((s) => [s.vehicle.slug, s.count]));
    return { order, counts, top: list[0]?.vehicle.slug };
  }, [trip.pax, trip.tab, trip.returnDate]);

  const priceOf = (v: CatalogVehicle) =>
    estimateFor(book, v, { ...estInput, vehicles: ranked.counts.get(v.slug) ?? 1 }).estimate?.total ?? Number.POSITIVE_INFINITY;

  const results = useMemo(() => {
    let list = VEHICLES.filter((v) => {
      if (f.types.length && !f.types.includes(typeOf(v.category))) return false;
      if (f.seats.length && !f.seats.includes(v.seats)) return false;
      if (f.minBags && v.bags < f.minBags) return false;
      if (trip.tab === 'OUTSTATION' && !v.plans.includes('OUTSTATION')) return false;
      if (trip.tab === 'AIRPORT' && !v.plans.includes('AIRPORT')) return false;
      return true;
    });

    list = [...list].sort(
      (a, b) => (ranked.order.get(a.slug) ?? 99) - (ranked.order.get(b.slug) ?? 99)
    );

    return list;
  }, [f, ranked, book.loaded, trip.tab]);

  /**
   * The size of vehicle this group actually needs.
   *
   * The fleet comes in five sizes — 4, 6, 12, 17 and 45 seats — and the honest
   * answer to "we are six" is "the six-seaters", not "anything from a Dzire to
   * a coach". So the rule is: take the SMALLEST size that seats everybody, and
   * offer that size. Nothing smaller, because it does not fit; nothing larger,
   * because the customer is then paying for empty seats.
   *
   * This replaces a tolerance band (`seats >= pax` up to `pax + 4`) that was
   * wrong at both ends:
   *
   *  - Too wide for small groups. Four passengers allowed anything up to eight
   *    seats, so every six-seater ranked as an equally good answer alongside
   *    the sedans and the customer got nine vehicles across four categories.
   *
   *  - Empty for others. Seven passengers allowed 7 to 11 seats, and the fleet
   *    has nothing between 6 and 12 — so NOTHING qualified, the split was
   *    dropped, and the page fell back to showing the entire fleet with the
   *    four-seaters at the top. A group of seven was being offered a Dzire.
   *
   * Availability is taken into account before the size is chosen, so an
   * outstation trip never lands on a size whose vehicles cannot do outstation.
   */
  const availableForTrip = useCallback(
    (v: CatalogVehicle) =>
      (trip.tab !== 'OUTSTATION' || v.plans.includes('OUTSTATION')) &&
      (trip.tab !== 'AIRPORT' || v.plans.includes('AIRPORT')),
    [trip.tab]
  );

  /**
   * The class of vehicle, by its seat count — 4, 6, 12, 17 or 45.
   *
   * The class is chosen on the smallest one that CAN carry the group, and a
   * vehicle then qualifies if it personally can. Those are two different tests
   * and both are needed, because capacity varies inside a class: the 2+3+2
   * six-seaters take seven, the XL6's captain seats do not.
   *
   * Matching on capacity alone looked simpler and was wrong — it split the
   * six-seaters into a "6" group and a "7" group, so a family of five was shown
   * the XL6 on its own and the Ertiga, Rumion, Innova and Carens disappeared.
   * The class holds them together; the per-vehicle check drops only the one
   * that genuinely cannot seat the extra passenger.
   *
   * Undefined when nothing is big enough — then the answer is a set of vehicles.
   */
  const requiredSeats = useMemo(() => {
    const eligible = VEHICLES.filter(availableForTrip);
    return [...new Set(eligible.map((v) => v.seats))]
      .sort((a, b) => a - b)
      .find((tier) => eligible.some((v) => v.seats === tier && capacityOf(v) >= trip.pax));
  }, [trip.pax, availableForTrip]);

  const suits = (v: CatalogVehicle) =>
    requiredSeats !== undefined && v.seats === requiredSeats && capacityOf(v) >= trip.pax;

  const fitting = results.filter(suits);
  const others = results.filter((v) => !suits(v));
  const split = fitting.length > 0 && others.length > 0;

  /**
   * The right-sized vehicles, under the category each belongs to.
   *
   * Six seats is two categories — SUV and Premium SUV — and they are a real
   * choice, not a ranking accident: one is the Ertiga class, the other the
   * Innova class. Naming them lets the customer choose on comfort once the
   * size question is already settled. `results` is ranked best-first and a Map
   * keeps insertion order, so the strongest category stays at the top.
   */
  const fittingGroups = useMemo(() => {
    const groups = new Map<string, CatalogVehicle[]>();
    for (const v of fitting) {
      const g = groups.get(v.category);
      if (g) g.push(v);
      else groups.set(v.category, [v]);
    }
    return [...groups.entries()];
  }, [fitting]);

  /**
   * Does ANY vehicle suit this group, filters aside?
   *
   * Without this the headings lie. The capacity filter used to be able to empty
   * the top section while the line underneath still read "No single vehicle
   * seats 2" — but something did seat them; a filter had hidden it. This tells
   * the two cases apart.
   */
  const anySuits = VEHICLES.some((v) => availableForTrip(v) && suits(v));

  /**
   * Which card wears "Best match".
   *
   * It has to be one of the vehicles at the top, and the ranking alone does
   * not guarantee that: for a single passenger the recommender's comfort
   * priority names the Innova, which the sizing rule above has just moved into
   * "Other vehicles" for carrying five empty seats. Badging it there told the
   * customer the best match was the one we had visibly demoted. So the badge
   * falls to the ranking's pick when it is in the top group, and to the head of
   * that group when it is not.
   */
  const shownFirst = split ? fitting : results;
  const bestSlug = shownFirst.some((v) => v.slug === ranked.top)
    ? ranked.top
    : shownFirst[0]?.slug;

  /** One card grid, so the two lists cannot drift apart. `offset` keeps the
      reveal stagger and the card tints running on across the break. */
  const grid = (list: CatalogVehicle[], offset: number) => (
    <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2">
      {list.map((v, i) => (
        <Reveal key={v.slug} delay={(i % 3) * 60}>
          <VehicleCard
            vehicle={v}
            index={offset + i}
            best={v.slug === bestSlug}
            count={ranked.counts.get(v.slug) ?? 1}
            estimateInput={estInput}
            to={`/vehicles/${v.slug}?${tripQuery(trip)}`}
            compact
            contact={tripPrefill(trip, `${v.name}${(ranked.counts.get(v.slug) ?? 1) > 1 ? ` x ${ranked.counts.get(v.slug)}` : ''}`)}
          />
        </Reveal>
      ))}
    </div>
  );

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); }, []);

  // Arriving from the header's Vehicles menu while already on this page.
  const catParam = params.get('cat');
  useEffect(() => {
    if (catParam) setF(filtersFromUrl(params));
  }, [catParam]);

  const routeLabel = [trip.from, trip.to].filter(Boolean).join('  →  ') || 'Choose a vehicle';
  const pkg = HOURLY_PACKAGES.find((p) => p.key === trip.plan);

  const meta = [
    trip.date ? dmy(trip.date) : null,
    trip.time || null,
    trip.returnDate ? `Return ${dmy(trip.returnDate)}` : null,
    `${trip.pax} ${trip.pax === 1 ? 'passenger' : 'passengers'}`,
    pkg?.label ?? null,
    trip.flight ? `Flight ${trip.flight}` : null,
  ].filter(Boolean) as string[];

  return (
    <CompareProvider>
      <div className="page-bg pb-28">
        {/* ============================ TRIP HEADER ============================ */}
        <section className="relative overflow-hidden pb-6 pt-24 sm:pt-28">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -left-40 -top-56 h-[32rem] w-[32rem] rounded-full bg-brand-200/30 blur-[120px]" />
            <div className="absolute right-[-10rem] top-[-8rem] h-[26rem] w-[26rem] rounded-full bg-[#C7D2FE]/30 blur-[120px]" />
            {/* Fleet page, so the drawing is on topic — but this is a working
                screen, so it stays a texture at 8% and only on wide viewports. */}
            <img
              src="/assets/art-car-line.svg"
              alt=""
              className="pointer-events-none absolute right-2 top-14 hidden w-[28rem] max-w-none select-none opacity-[0.11] xl:block"
            />
          </div>

          <div className="shell relative">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <BackLink to="/book" />
              <nav className="flex items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
                <Link to="/" className="hover:text-brand-700">Home</Link>
                <span className="text-ink-300">/</span>
                <span className="font-medium text-ink-700">Vehicles</span>
              </nav>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-[1.45rem] font-extrabold leading-[1.15] tracking-[-0.03em] text-ink-900 sm:text-[1.85rem]">
                  {routeLabel}
                </h1>
                <ul className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-ink-600">
                  {meta.map((m, i) => (
                    <li key={m} className="flex items-center gap-2">
                      {i > 0 && <span className="text-ink-300">·</span>}
                      {m}
                    </li>
                  ))}
                </ul>
              </div>

              <button
                onClick={() => setEditing((v) => !v)}
                className="btn h-10 shrink-0 rounded-full bg-white px-5 text-sm text-ink-700 shadow-card hover:shadow-raised"
              >
                <IconEdit className="h-4 w-4" /> {editing ? 'Close' : 'Change trip'}
              </button>
            </div>

            {editing && (
              <div className="mt-5 animate-fade-up">
                <QuickBook initialTab={trip.tab} />
              </div>
            )}

            <TrustRow compact className="mt-6" />
          </div>
        </section>

        {/* ============================== RESULTS ============================== */}
        <section className="shell">
          <div className="grid gap-8 lg:grid-cols-[14rem,1fr] lg:gap-10">
            {/* filters — a rail on desktop, a sheet on a phone */}
            <aside className="hidden lg:block">
              <div className="sticky top-24 max-h-[calc(100vh-7.5rem)] overflow-y-auto pr-2">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-display text-md font-bold text-ink-900">Filters</h2>
                  {activeCount(f) > 0 && (
                    <button onClick={() => setF(NO_FILTERS)} className="text-xs font-bold text-brand-700 hover:text-brand-800">
                      Clear all
                    </button>
                  )}
                </div>
                <FilterPanel f={f} set={set} />
              </div>
            </aside>

            <div className="min-w-0">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">
                    {anySuits
                      ? `For ${trip.pax} ${trip.pax === 1 ? 'passenger' : 'passengers'}`
                      : `${trip.pax} passengers — travelling as a set`}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {!anySuits
                      ? `No single vehicle seats ${trip.pax}`
                      : fitting.length
                        ? `${fitting.length} ${fitting.length === 1 ? 'vehicle' : 'vehicles'} this size`
                        : `Nothing matching your filters seats ${trip.pax}`}
                    {ranked.top ? ' · best match first' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSheet(true)}
                    className="btn h-10 rounded-full bg-white px-4 text-sm text-ink-700 shadow-card lg:hidden"
                  >
                    <IconSettings className="h-4 w-4" /> Filter
                    {activeCount(f) > 0 && (
                      <span className="grad-brand ml-0.5 grid h-5 min-w-5 place-items-center rounded-full px-1 text-2xs font-bold text-white">
                        {activeCount(f)}
                      </span>
                    )}
                  </button>

                </div>
              </div>

              {!book.loaded ? (
                <SkeletonGrid count={6} />
              ) : results.length === 0 ? (
                <SiteEmpty
                  emoji="🚗"
                  title="Nothing matches those filters"
                  body="Loosen one of them — the fleet is twelve vehicles, so a narrow filter can rule all of them out."
                  action={
                    <button onClick={() => setF(NO_FILTERS)} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                      Clear all filters
                    </button>
                  }
                />
              ) : (
                <>
                  {/* The right size, split into the categories that size comes
                      in. One category renders as a plain grid — a single
                      heading over the only thing on screen says nothing. */}
                  {fitting.length > 0 ? (
                    fittingGroups.length > 1 ? (
                      fittingGroups.map(([category, list], gi) => (
                        <div key={category} className={gi ? 'mt-9' : ''}>
                          <div className="mb-3.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                            <h3 className="font-display text-md font-bold text-ink-900">{category}</h3>
                            {/* No seat count here. Every category in this list is
                                the same size — the line above already said what
                                that is — and repeating it as "6 seats" under a
                                search for seven contradicts itself. */}
                            <span className="text-xs text-ink-500">
                              {list.length} {list.length === 1 ? 'vehicle' : 'vehicles'}
                            </span>
                          </div>
                          {grid(
                            list,
                            fittingGroups.slice(0, gi).reduce((n, [, l]) => n + l.length, 0)
                          )}
                        </div>
                      ))
                    ) : (
                      grid(fitting, 0)
                    )
                  ) : (
                    grid(results, 0)
                  )}

                  {/* Everything the wrong size. Reachable, because four people
                      with four suitcases do sometimes want the bigger car — but
                      closed, because they are not an answer to the question the
                      customer asked. */}
                  {split && (
                    <details className="group mt-10">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-ink-700 hover:text-brand-700">
                        <IconChevron className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
                        Other sizes ({others.length})
                        <span className="font-normal text-ink-500">
                          — smaller or larger than {trip.pax}{' '}
                          {trip.pax === 1 ? 'passenger needs' : 'passengers need'}
                        </span>
                      </summary>
                      <div className="mt-4">{grid(others, fitting.length)}</div>
                    </details>
                  )}
                </>
              )}

              {!book.rates.length && book.loaded && (
                <Callout className="mt-6">
                  Estimates appear here once the walk-in rate card is filled in. Until then send the requirement through
                  and you get the rate by phone — usually within the hour.
                </Callout>
              )}

              {/* Neither list is a dead end: a customer who does not want to
                  pick a vehicle can hand the trip over as it stands. */}
              <Reveal className="tile mt-8 p-6">
                <h3 className="font-display text-md font-bold text-ink-900">
                  Rather have us pick, or send it as it stands?
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                  The trip above goes across with it — pickup, drop, date, time and group size. You get the rate back
                  before anything is assigned.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link
                    to={`/enquiry?${tripQuery(trip)}`}
                    className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800"
                  >
                    Send enquiry <IconArrowRight className="h-4 w-4" />
                  </Link>
                  <WhatsAppButton
                    prefill={tripPrefill(trip)}
                    className="btn h-11 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
                  >
                    <IconWhatsApp className="h-4 w-4" /> Send on WhatsApp
                  </WhatsAppButton>
                </div>
              </Reveal>

              {/* Larger or special vehicles */}
              <Reveal className="tile mt-8 p-6">
                <h3 className="font-display text-md font-bold text-ink-900">Something not in this list?</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                  These classes are arranged per booking rather than kept on the road, so they are quoted to the
                  requirement:
                </p>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {ON_REQUEST_CLASSES.map((c) => (
                    <li key={c} className="flex gap-2 text-sm text-ink-600">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {c}
                    </li>
                  ))}
                </ul>
                <Link to="/enquiry" className="btn mt-5 h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                  Tell us what you need <IconArrowRight className="h-4 w-4" />
                </Link>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ========================== HELP ME CHOOSE ========================== */}
        <section className="shell pt-16 sm:pt-20">
          <Reveal className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-12 sm:px-10">
            <SectionHead
              eyebrow="Still deciding"
              title="Let us pick for you"
              sub="Four questions about the group, the luggage, the distance and how long — and we will name the vehicle we would send, with the reasoning shown, not hidden."
            />
            <Link to="/help-me-choose" className="btn mt-7 h-12 rounded-full bg-ink-900 px-7 text-md text-white hover:bg-ink-800">
              Help me choose <IconArrowRight className="h-4 w-4" />
            </Link>
          </Reveal>
        </section>

        <BottomSheet
          open={sheet}
          onClose={() => setSheet(false)}
          title="Filter vehicles"
          footer={
            <div className="flex gap-2.5">
              <button onClick={() => setF(NO_FILTERS)} className="btn h-11 flex-1 rounded-full bg-ink-50 text-md text-ink-700">
                Clear
              </button>
              <button onClick={() => setSheet(false)} className="grad-brand btn h-11 flex-1 rounded-full text-md font-semibold text-white">
                Show {results.length} vehicles
              </button>
            </div>
          }
        >
          <FilterPanel f={f} set={set} />
        </BottomSheet>

        <CompareTray />
      </div>
    </CompareProvider>
  );
}
