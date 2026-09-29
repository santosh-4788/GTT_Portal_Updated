/**
 * Weekend escapes from Mumbai.
 *
 * Filtered by the two things that actually decide a weekend — how many nights
 * you have and what you want out of it — rather than by price bands nobody
 * shops in.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DESTINATIONS, THEMES, type Theme } from './places';
import { DestinationCard } from './PlaceCards';
import { Chip, SectionHead, SiteEmpty, TrustRow, ContactRow } from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight } from '../components/icons';
import { useSeo } from './Seo';

const NIGHTS = [
  { value: 0, label: 'Day trip' },
  { value: 1, label: '1 night' },
  { value: 2, label: '2 nights' },
  { value: 3, label: '3 nights' },
];

export default function WeekendTrips() {
  useSeo({
    title: 'Weekend Trips from Mumbai by Cab',
    path: '/weekend-trips',
    description: 'Weekend getaways from Mumbai by private cab - hill stations, beaches and pilgrim towns within a few hours, with suggested plans and the right vehicle for your group.',
  });
  // The header's "Maharashtra tours" link arrives as ?state=Maharashtra.
  const [params] = useSearchParams();
  const state = params.get('state') ?? '';

  const [nights, setNights] = useState<number | null>(null);
  const [themes, setThemes] = useState<Theme[]>([]);

  const shown = useMemo(
    () =>
      DESTINATIONS.filter((d) => {
        if (state && d.state.toLowerCase() !== state.toLowerCase()) return false;
        if (nights !== null && !d.nights.includes(nights)) return false;
        if (themes.length && !themes.some((t) => d.themes.includes(t))) return false;
        return true;
      }).sort((a, b) => a.km - b.km),
    [nights, themes, state]
  );

  const toggleTheme = (t: Theme) =>
    setThemes((l) => (l.includes(t) ? l.filter((x) => x !== t) : [...l, t]));

  const filtered = nights !== null || themes.length > 0;

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Weekend travel"
        title={state ? `${state} from Mumbai` : 'Weekend escapes from Mumbai'}
        sub="Everything within a day's drive, sorted by how far it actually is. Pick the number of nights you have and we will show you what fits."
        crumbs={[{ label: 'Weekend trips' }]}
      />

      <section className="shell">
        {/* ------------------------------- filters ------------------------------- */}
        <div className="tile p-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            <div>
              <p className="mb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">How long have you got?</p>
              <div className="flex flex-wrap gap-2">
                <Chip on={nights === null} onClick={() => setNights(null)}>Any</Chip>
                {NIGHTS.map((n) => (
                  <Chip key={n.value} on={nights === n.value} onClick={() => setNights(n.value)}>{n.label}</Chip>
                ))}
              </div>
            </div>

            <div className="min-w-0">
              <p className="mb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">What are you after?</p>
              <div className="flex flex-wrap gap-2">
                {THEMES.filter((t) => DESTINATIONS.some((d) => d.themes.includes(t.key))).map((t) => (
                  <Chip key={t.key} on={themes.includes(t.key)} onClick={() => toggleTheme(t.key)}>
                    <span aria-hidden="true">{t.emoji}</span> {t.label}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          {(filtered || state) && (
            <div className="mt-4 flex flex-wrap items-center gap-4">
              {filtered && (
                <button
                  onClick={() => { setNights(null); setThemes([]); }}
                  className="text-xs font-bold text-brand-700 hover:text-brand-800"
                >
                  Clear filters
                </button>
              )}
              {state && (
                <Link to="/weekend-trips" className="text-xs font-bold text-ink-500 hover:text-ink-800">
                  Showing {state} only — show everywhere
                </Link>
              )}
            </div>
          )}
        </div>

        {/* ------------------------------- results ------------------------------- */}
        <div className="mt-7">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold text-ink-900">
              {shown.length} {shown.length === 1 ? 'destination' : 'destinations'}
              {nights !== null && ` for ${NIGHTS.find((n) => n.value === nights)!.label.toLowerCase()}`}
            </h2>
            <p className="text-xs text-ink-500">Nearest first · distances approximate</p>
          </div>

          {shown.length === 0 ? (
            <SiteEmpty
              emoji="🧭"
              title="Nothing matches that combination"
              body="Try one filter at a time — a three-night beach trip and a day trip to the hills are looking for different things."
              action={
                <button
                  onClick={() => { setNights(null); setThemes([]); }}
                  className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800"
                >
                  Show everything
                </button>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((d, i) => (
                <Reveal key={d.slug} delay={(i % 3) * 60}>
                  <DestinationCard d={d} index={i} nights={nights ?? undefined} />
                </Reveal>
              ))}
            </div>
          )}

        </div>

        <p className="mt-6 text-xs leading-relaxed text-ink-400">
          Somewhere not on this list? We drive across Maharashtra, Gujarat and Goa —{' '}
          <Link to="/enquiry" className="link">tell us the route</Link> and we will quote it.
        </p>
      </section>

      {/* ============================ DISCOVERY ============================ */}
      <section className="shell pt-16 sm:pt-24">
        <Reveal className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-12 sm:px-10">
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr,auto]">
            <div>
              <span className="lead">Not sure where</span>
              <h2 className="font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-ink-900 sm:text-[2.1rem]">
                Tell us who is going and what you like, and we will suggest the trip.
              </h2>
              <p className="mt-4 max-w-xl text-md leading-[1.7] text-ink-600">
                Six questions — where you are starting from, how many of you, how many days, roughly what budget, and
                what kind of place you enjoy.
              </p>
            </div>
            <Link
              to="/find-a-trip"
              className="grad-brand btn h-12 shrink-0 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
            >
              Help me find a trip <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ============================== CLOSING ============================== */}
      <section className="shell pt-16 sm:pt-24">
        <SectionHead
          eyebrow="Before you book"
          title="What an outstation trip includes"
          sub="The vehicle for the days agreed, fuel, and a chauffeur who knows the ghat sections. Toll, parking, permits and the driver's night allowance are itemised on top at what they cost."
          className="mb-8"
        />
        <TrustRow />
        <ContactRow className="mt-8" message="Hello, I would like to plan a weekend trip from Mumbai." />
      </section>
    </div>
  );
}
