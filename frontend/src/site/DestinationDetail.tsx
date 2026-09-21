/**
 * Destination details.
 *
 * Everything needed to decide on a place and then book the drive to it, on one
 * page: what it is, how long it takes, what to see, a day-by-day plan, the
 * vehicles we would send, and a live estimate for the round trip.
 *
 * The "Plan this trip" button carries the destination, the nights and the
 * recommended vehicle straight into the trip builder, so nothing is re-typed.
 */
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { VEHICLES, vehicleBySlug } from './catalog';
import { DESTINATIONS, destinationBySlug, THEMES } from './places';
import { planFor, planHeading } from './itinerary';
import { tripQuery } from './tripParams';
import { DestinationCard, PlacePhoto } from './PlaceCards';
import { VehicleCard } from './VehicleCard';
import {
  BackLink, Callout, Chip, CompareProvider, EstimatePanel, SectionHead, TrustRow,
  estimateFor, useRates,
} from './kit';
import { CompareTray } from './VehicleCard';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck, IconClock, IconPhone, IconPin } from '../components/icons';

export default function DestinationDetail() {
  const { slug } = useParams();
  const d = destinationBySlug(slug);
  const book = useRates();

  const [nights, setNights] = useState<number | null>(null);

  if (!d) return <Navigate to="/weekend-trips" replace />;

  const chosenNights = nights ?? d.nights[Math.min(1, d.nights.length - 1)] ?? 0;
  const days = chosenNights + 1;

  /* The plan follows the nights chosen in the rail, rather than the one
     length the destination happens to have prose for. */
  const plan = planFor(d, days);

  const vehicles = d.vehicles.map((s) => vehicleBySlug(s)).filter(Boolean) as ReturnType<typeof vehicleBySlug>[];
  const lead = vehicles[0]!;

  const est = estimateFor(book, lead, { plan: 'OUTSTATION', days, distanceKm: d.km * 2 });

  const similar = d.similar
    .map((s) => destinationBySlug(s))
    .filter((x): x is (typeof DESTINATIONS)[number] => Boolean(x))
    .slice(0, 3);

  const q = tripQuery({
    tab: 'OUTSTATION',
    from: 'Mumbai',
    to: d.name,
    returnDate: chosenNights > 0 ? 'x' : '',
    pax: lead.seats > 7 ? 10 : 4,
  });

  return (
    <CompareProvider>
      <div className="page-bg pb-28">
        {/* =============================== HERO =============================== */}
        <section className="pt-24 sm:pt-28">
          <div className="shell">
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
              <BackLink to="/weekend-trips" />
              <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
                <Link to="/" className="hover:text-brand-700">Home</Link>
                <span className="text-ink-300">/</span>
                <Link to="/weekend-trips" className="hover:text-brand-700">Weekend trips</Link>
                <span className="text-ink-300">/</span>
                <span className="font-medium text-ink-700">{d.name}</span>
              </nav>
            </div>

            <div className="relative overflow-hidden rounded-[2rem]">
              <PlacePhoto photo={d.photo} name={d.name} className="aspect-[16/9] w-full object-cover sm:aspect-[21/9]" />
              {/* CC BY-SA requires the photographer credited wherever the
                  photograph appears, so it rides on the hero itself. */}
              <a
                href="/assets/places/CREDITS.txt"
                className="absolute right-3 top-3 z-10 rounded-full bg-ink-950/45 px-2.5 py-1 text-2xs
                           font-medium text-white/85 backdrop-blur transition-colors hover:bg-ink-950/65 hover:text-white"
              >
                Photo credit
              </a>
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-transparent" />

              <div className="absolute inset-x-5 bottom-5 sm:inset-x-10 sm:bottom-8">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-brand-700 backdrop-blur">
                  <IconPin className="h-3 w-3" /> {d.state}
                </span>
                <h1 className="mt-3 font-display text-[2rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-white sm:text-[3rem]">
                  {d.name}
                </h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-white/85">
                  <span>{d.km} km from Mumbai</span>
                  <span className="text-white/40">·</span>
                  <span className="inline-flex items-center gap-1.5"><IconClock className="h-3.5 w-3.5" /> {d.hours}</span>
                  <span className="text-white/40">·</span>
                  <span>
                    {d.nights.map((n) => (n === 0 ? 'day trip' : `${n} night${n > 1 ? 's' : ''}`)).join(' or ')}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============================== CONTENT ============================== */}
        <section className="shell pt-10">
          <div className="grid gap-8 lg:grid-cols-[1fr,21rem] lg:gap-10">
            <div className="min-w-0">
              <p className="text-md leading-[1.8] text-ink-700 sm:text-lg">{d.blurb}</p>

              <div className="mt-6 flex flex-wrap gap-2">
                {d.themes.map((t) => {
                  const theme = THEMES.find((x) => x.key === t);
                  return (
                    <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-card">
                      <span aria-hidden="true">{theme?.emoji}</span> {theme?.label}
                    </span>
                  );
                })}
              </div>

              {/* -------------------------- best for -------------------------- */}
              <div className="tile mt-8 p-6">
                <h2 className="font-display text-md font-bold text-ink-900">Best for</h2>
                <ul className="mt-3.5 grid gap-2 sm:grid-cols-3">
                  {d.bestFor.map((b) => (
                    <li key={b} className="flex gap-2 text-sm text-ink-600">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {b}
                    </li>
                  ))}
                </ul>
              </div>

              {/* ------------------------ places to visit ------------------------ */}
              <div className="mt-10">
                <SectionHead eyebrow="While you are there" title="Places to visit" className="mb-6" />
                <div className="grid gap-3 sm:grid-cols-2">
                  {d.seeThere.map((p, i) => (
                    <Reveal key={p} delay={(i % 2) * 60}>
                      <div className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card">
                        <span className="grad-soft grid h-9 w-9 shrink-0 place-items-center rounded-xl text-brand-600">
                          <IconPin className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 text-sm font-semibold text-ink-800">{p}</span>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>

              {/* -------------------------- itinerary -------------------------- */}
              <div className="mt-10">
                <SectionHead
                  eyebrow="Suggested itinerary"
                  title={planHeading(d, days)}
                  sub="What we would drive, in this order. Change any of it in the trip builder — this is a starting point, not a package."
                  className="mb-6"
                />
                <ol className="space-y-1">
                  {plan.map((leg, i) => {
                    const last = i === plan.length - 1;
                    return (
                      <li key={leg.day} className="flex gap-4">
                        <span className="relative flex w-6 shrink-0 justify-center">
                          <span className="grad-brand z-10 mt-1 grid h-6 w-6 place-items-center rounded-full font-display text-2xs font-bold text-white ring-4 ring-[#F5F8FC]">
                            {i + 1}
                          </span>
                          {!last && <span className="absolute bottom-0 top-7 w-0.5 rounded-full bg-ink-200" />}
                        </span>
                        <span className="min-w-0 flex-1 pb-6">
                          <span className="block text-sm font-bold text-ink-900">{leg.day}</span>
                          <span className="mt-1 block text-sm leading-relaxed text-ink-600">{leg.plan}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>

              {/* ---------------------- recommended vehicles ---------------------- */}
              <div className="mt-6">
                <SectionHead
                  eyebrow="Getting there"
                  title="Vehicles we send to this route"
                  sub={`${d.km} km each way. On a run like this the seat matters more than the badge, which is why the order below is not the cheapest first.`}
                  className="mb-6"
                />
                <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
                  {vehicles.map((v, i) => (
                    <Reveal key={v!.slug} delay={i * 70}>
                      <VehicleCard
                        vehicle={v!}
                        index={i}
                        best={i === 0}
                        estimateInput={{ plan: 'OUTSTATION', days, distanceKm: d.km * 2 }}
                        to={`/vehicles/${v!.slug}?${q}`}
                        compact
                      />
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>

            {/* ------------------------------- rail ------------------------------- */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="tile p-5">
                <h2 className="font-display text-md font-bold text-ink-900">How many nights?</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {d.nights.map((n) => (
                    <Chip key={n} on={chosenNights === n} onClick={() => setNights(n)}>
                      {n === 0 ? 'Day trip' : `${n} night${n > 1 ? 's' : ''}`}
                    </Chip>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-ink-500">
                  {days} {days === 1 ? 'day' : 'days'} of vehicle, {d.km * 2} km return, in a {lead.name}.
                </p>
              </div>

              <EstimatePanel
                className="mt-5"
                estimate={est.estimate}
                planLabel={est.planLabel}
                reason={est.reason}
              />

              <div className="mt-5">
                <Link
                  to={`/enquiry?${q}&vehicle=${lead.slug}`}
                  className="grad-brand btn h-12 w-full rounded-full text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                >
                  Plan this trip <IconArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href={`tel:+91${COMPANY.mobile}`}
                  className="btn mt-2.5 h-11 w-full rounded-full bg-white text-md text-ink-800 shadow-card hover:shadow-raised"
                >
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>

              <TrustRow compact className="mt-6" />

              <Callout className="mt-5">
                Distances and drive times are approximate and vary with the route taken on the day. Toll, parking and
                the driver's night allowance are itemised on top of the estimate.
              </Callout>
            </aside>
          </div>
        </section>

        {/* ============================== SIMILAR ============================== */}
        {similar.length > 0 && (
          <section className="shell pt-16 sm:pt-24">
            <SectionHead
              eyebrow="Also consider"
              title="Similar destinations"
              action={
                <Link to="/weekend-trips" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  All destinations <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
              className="mb-7"
            />
            <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
              {similar.map((s, i) => (
                <Reveal key={s.slug} delay={i * 70}>
                  <DestinationCard d={s} index={i + 1} />
                </Reveal>
              ))}
            </div>
          </section>
        )}

        <CompareTray />
      </div>
    </CompareProvider>
  );
}
