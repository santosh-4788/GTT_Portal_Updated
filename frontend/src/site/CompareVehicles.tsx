/**
 * Compare vehicles.
 *
 * Up to three side by side. On a phone the "table" becomes one card per
 * vehicle with the same rows in the same order — a four-column table squeezed
 * onto a 375px screen is the single worst pattern on every travel site we
 * looked at, and horizontal scrolling a table is not a fix.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { inr } from '../lib/format';
import { VEHICLES, vehicleBySlug, type CatalogVehicle } from './catalog';
import { estimateInputFor, readTrip, tripQuery } from './tripParams';
import { recommend } from './recommend';
import { BackLink, estimateFor, SiteEmpty, useRates, Callout } from './kit';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { IconSeat, IconLuggage } from './SiteIcons';
import { IconArrowRight, IconCheck, IconClose } from '../components/icons';
import { useSeo } from './Seo';

type RowValue = (v: CatalogVehicle) => React.ReactNode;

export default function CompareVehicles() {
  useSeo({ title: 'Compare vehicles', noindex: true });
  const [params, setParams] = useSearchParams();
  const book = useRates();
  const trip = readTrip(params);
  const q = tripQuery(trip);

  const picked = (params.get('ids') ?? '')
    .split(',')
    .map((s) => vehicleBySlug(s.trim()))
    .filter((v): v is CatalogVehicle => Boolean(v))
    .slice(0, 3);

  const estInput = estimateInputFor(trip);
  const knownTrip = Boolean(trip.from || trip.to);

  /** Which of the picked vehicles we would actually send for this trip. */
  const best = (() => {
    if (!picked.length) return undefined;
    const ranked = recommend({
      passengers: trip.pax,
      bags: trip.pax > 6 ? 'medium' : 'light',
      scope: trip.tab === 'OUTSTATION' ? 'outstation' : 'local',
      length: trip.returnDate ? 'multi-day' : 'full-day',
      priority: 'comfort',
    });
    const order = ranked.map((r) => r.vehicle.slug);
    return [...picked].sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug))[0]?.slug;
  })();

  const drop = (slug: string) => {
    const next = picked.filter((v) => v.slug !== slug).map((v) => v.slug);
    params.set('ids', next.join(','));
    setParams(params, { replace: true });
  };

  const add = (slug: string) => {
    if (picked.length >= 3) return;
    params.set('ids', [...picked.map((v) => v.slug), slug].join(','));
    setParams(params, { replace: true });
  };

  const money = (v: CatalogVehicle) => {
    const e = estimateFor(book, v, estInput);
    if (!e.estimate) return <span className="text-ink-500">On request</span>;
    return (
      <span className="font-display text-md font-bold text-ink-900">
        {inr(e.estimate.total, true).replace('.00', '')}
        <span className="ml-1 text-2xs font-semibold uppercase text-warn-700">est.</span>
      </span>
    );
  };

  const ROWS: { label: string; value: RowValue }[] = [
    { label: 'Seats', value: (v) => <span className="inline-flex items-center gap-1.5"><IconSeat className="h-4 w-4 text-brand-500" />{v.seats}</span> },
    { label: 'Large bags', value: (v) => <span className="inline-flex items-center gap-1.5"><IconLuggage className="h-4 w-4 text-brand-500" />{v.bags}</span> },
    { label: 'Air conditioned', value: (v) => (v.ac ? <IconCheck className="h-4 w-4 text-ok-500" /> : '—') },
    { label: 'Comfort band', value: (v) => v.comfort },
    { label: 'Category', value: (v) => v.category },
    { label: 'Available for', value: (v) => v.plans.map((p) => p[0] + p.slice(1).toLowerCase()).join(', ') },
    { label: 'Ideal for', value: (v) => <span className="text-sm leading-relaxed text-ink-600">{v.bestFor.slice(0, 3).join(' · ')}</span> },
    { label: 'Key features', value: (v) => (
      <ul className="space-y-1 text-left">
        {v.features.slice(0, 4).map((f) => (
          <li key={f} className="flex gap-1.5 text-xs leading-relaxed text-ink-600">
            <IconCheck className="mt-0.5 h-3 w-3 shrink-0 text-ok-500" />{f}
          </li>
        ))}
      </ul>
    ) },
    { label: 'Customer rating', value: () => <span className="text-xs text-ink-400">Not published yet</span> },
    { label: knownTrip ? 'Estimated fare' : 'Fare', value: money },
  ];

  if (!picked.length) {
    return (
      <div className="page-bg min-h-screen pb-24 pt-28 sm:pt-32">
        <div className="shell">
          <BackLink to={`/vehicles?${q}`} className="mb-4" />
          <h1 className="font-display text-[2rem] font-extrabold tracking-[-0.03em] text-ink-900">Compare vehicles</h1>
          <div className="mt-8">
            <SiteEmpty
              emoji="⚖️"
              title="Nothing to compare yet"
              body="Pick two or three vehicles from the list and they will line up here, side by side, with the same rows in the same order."
              action={
                <Link to={`/vehicles?${q}`} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                  Browse vehicles <IconArrowRight className="h-4 w-4" />
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  const spare = VEHICLES.filter((v) => !picked.some((p) => p.slug === v.slug));

  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <BackLink to={`/vehicles?${q}`} />
          <nav className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
            <Link to="/" className="hover:text-brand-700">Home</Link>
            <span className="text-ink-300">/</span>
            <Link to={`/vehicles?${q}`} className="hover:text-brand-700">Vehicles</Link>
            <span className="text-ink-300">/</span>
            <span className="font-medium text-ink-700">Compare</span>
          </nav>
        </div>

        <h1 className="font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.5rem]">
          Compare vehicles
        </h1>
        <p className="mt-3 max-w-2xl text-md leading-[1.7] text-ink-600">
          {knownTrip
            ? `For ${[trip.from, trip.to].filter(Boolean).join(' → ')}, ${trip.pax} ${trip.pax === 1 ? 'passenger' : 'passengers'}. Estimates are indicative and exclude toll and parking.`
            : 'Pick a trip first and each column also shows what it would cost for that trip.'}
        </p>

        {/* ====================== phones: one card each ====================== */}
        <div className="mt-8 space-y-5 lg:hidden">
          {picked.map((v) => (
            <article key={v.slug} className={`tile overflow-hidden ${v.slug === best ? 'ring-2 ring-brand-400' : ''}`}>
              <div className="grad-soft relative">
                <VehiclePhoto
                  photo={v.photo} art={v.art} name={v.name} alt={v.name}
                  className="aspect-[16/9] w-full object-cover"
                />
                {v.slug === best && (
                  <span className="grad-brand absolute left-3.5 top-3.5 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-white">
                    Best match
                  </span>
                )}
                <button
                  onClick={() => drop(v.slug)}
                  className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink-600 backdrop-blur"
                  aria-label={`Remove ${v.name}`}
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
              <div className="p-5">
                <h2 className="font-display text-lg font-bold text-ink-900">{v.name}</h2>
                <dl className="mt-4 divide-y divide-ink-100">
                  {ROWS.map((r) => (
                    <div key={r.label} className="flex items-start justify-between gap-4 py-2.5">
                      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-400">{r.label}</dt>
                      <dd className="min-w-0 text-right text-sm font-semibold text-ink-800">{r.value(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </article>
          ))}
        </div>

        {/* ==================== desktop: aligned columns ==================== */}
        <div className="mt-8 hidden lg:block">
          <div className="tile overflow-hidden">
            <div className="grid" style={{ gridTemplateColumns: `11rem repeat(${picked.length}, minmax(0, 1fr))` }}>
              {/* header row */}
              <div className="bg-ink-50/60 p-5" />
              {picked.map((v) => (
                <div key={v.slug} className={`relative p-5 ${v.slug === best ? 'bg-brand-50/50' : ''}`}>
                  {v.slug === best && (
                    <span className="grad-brand absolute right-4 top-4 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-white">
                      Best match
                    </span>
                  )}
                  <div className="grad-soft overflow-hidden rounded-xl">
                    <VehiclePhoto
                      photo={v.photo} art={v.art} name={v.name} alt={v.name}
                      className="aspect-[16/10] w-full object-cover"
                    />
                  </div>
                  <h2 className="mt-3.5 font-display text-md font-bold text-ink-900">{v.name}</h2>
                  <button
                    onClick={() => drop(v.slug)}
                    className="mt-2 inline-flex items-center gap-1 text-2xs font-bold text-ink-400 hover:text-danger-600"
                  >
                    <IconClose className="h-3 w-3" /> Remove
                  </button>
                </div>
              ))}

              {/* value rows */}
              {ROWS.map((r, i) => (
                <div key={r.label} className="contents">
                  <div className={`bg-ink-50/60 px-5 py-3.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-500 ${i === 0 ? 'border-t border-ink-100' : ''}`}>
                    {r.label}
                  </div>
                  {picked.map((v) => (
                    <div
                      key={v.slug + r.label}
                      className={`border-t border-ink-100 px-5 py-3.5 text-sm font-semibold text-ink-800 ${v.slug === best ? 'bg-brand-50/40' : ''}`}
                    >
                      {r.value(v)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* add another */}
        {picked.length < 3 && spare.length > 0 && (
          <div className="mt-7">
            <p className="mb-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">
              Add another ({3 - picked.length} more possible)
            </p>
            <div className="flex flex-wrap gap-2">
              {spare.map((v) => (
                <button
                  key={v.slug}
                  onClick={() => add(v.slug)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-card transition-colors hover:text-ink-900"
                >
                  + {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <Callout className="mt-7">
          Rating rows are left blank on purpose. We do not hold enough verified reviews per vehicle to publish an
          average, and a decorative 4.8 next to a real fare estimate would make the honest number look invented too.
        </Callout>
      </div>
    </div>
  );
}
