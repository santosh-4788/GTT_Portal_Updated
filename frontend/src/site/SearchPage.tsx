/**
 * Global search.
 *
 * One box over everything the site holds — destinations, sightseeing stops,
 * vehicles, services, event types and the pages themselves. The index lives in
 * `searchIndex.ts` because the header search box uses it on every page.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DESTINATIONS } from './places';
import { POPULAR_SEARCHES, searchSite, type SearchEntry, type SearchKind } from './searchIndex';
import { clearSearches, rememberSearch, useCustomer } from './tripStore';
import { SearchField, SectionHead, SiteEmpty, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconChevron, IconPin, IconSearch } from '../components/icons';
import { IconSeat } from './SiteIcons';

const KIND_TONE: Record<SearchKind, string> = {
  Destination: 'bg-brand-50 text-brand-700',
  'In Mumbai': 'grad-mint text-ok-600',
  Vehicle: 'bg-ink-100 text-ink-600',
  Service: 'grad-soft text-brand-700',
  Event: 'grad-warm text-warn-700',
  Page: 'bg-ink-50 text-ink-500',
};

function Row({ e }: { e: SearchEntry }) {
  return (
    <Link
      to={e.to}
      onClick={() => rememberSearch(e.label)}
      className="flex items-center gap-3.5 rounded-2xl bg-white p-4 shadow-card transition-shadow hover:shadow-raised"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${KIND_TONE[e.kind]}`}>
        {e.kind === 'Vehicle' ? <IconSeat className="h-4 w-4" /> : <IconPin className="h-4 w-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink-900">{e.label}</span>
          <span className="rounded-full bg-ink-50 px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">
            {e.kind}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-500">{e.sub}</span>
      </span>
      <IconChevron className="h-4 w-4 shrink-0 -rotate-90 text-ink-300" />
    </Link>
  );
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { searches } = useCustomer();
  const [term, setTerm] = useState(params.get('q') ?? '');

  const results = useMemo(() => searchSite(term), [term]);
  const searching = term.trim().length >= 2;

  const set = (v: string) => {
    setTerm(v);
    if (v.trim()) params.set('q', v); else params.delete('q');
    setParams(params, { replace: true });
  };

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Search"
        title="Find anything on the site"
        sub="Destinations, vehicles, services, tours and event options — all in one box."
        crumbs={[{ label: 'Search' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          <SearchField value={term} onChange={set} autoFocus placeholder="Lonavala, Innova, airport, wedding…" />

          {searching ? (
            <div className="mt-7">
              <p className="mb-4 text-xs text-ink-500">
                {results.length} {results.length === 1 ? 'result' : 'results'} for "{term.trim()}"
              </p>
              {results.length === 0 ? (
                <SiteEmpty
                  emoji="🔍"
                  title="Nothing matches that"
                  body="Try a place, a vehicle name or the kind of trip — Lonavala, Crysta, airport, wedding. Or describe it to the assistant in a sentence."
                  action={
                    <>
                      <Link to="/assistant" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                        Ask the assistant
                      </Link>
                      <Link to="/enquiry" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                        Tell us what you need
                      </Link>
                    </>
                  }
                />
              ) : (
                <ul className="space-y-2.5">
                  {results.map((e, i) => (
                    <Reveal as="li" key={`${e.kind}-${e.label}`} delay={Math.min(i, 8) * 30}>
                      <Row e={e} />
                    </Reveal>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="mt-8 space-y-9">
              {searches.length > 0 && (
                <div>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Recent searches</p>
                    <button onClick={clearSearches} className="text-xs font-bold text-ink-400 hover:text-danger-600">Clear</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {searches.map((s) => (
                      <button
                        key={s} onClick={() => set(s)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-card hover:text-ink-900"
                      >
                        <IconSearch className="h-3.5 w-3.5 text-ink-400" /> {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-3 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Popular searches</p>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_SEARCHES.map((s) => (
                    <button
                      key={s} onClick={() => set(s)}
                      className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-card hover:text-ink-900"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <SectionHead
                  eyebrow="Suggested"
                  title="Places we drive to most"
                  action={
                    <Link to="/weekend-trips" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                      All destinations <IconArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                  className="mb-5"
                />
                <ul className="space-y-2.5">
                  {DESTINATIONS.slice(0, 6).map((d) => (
                    <li key={d.slug}>
                      <Row
                        e={{
                          kind: 'Destination',
                          label: d.name,
                          sub: `${d.km} km · ${d.hours} · ${d.bestFor[0]}`,
                          to: `/destinations/${d.slug}`,
                          words: [],
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </div>

              <TrustRow />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
