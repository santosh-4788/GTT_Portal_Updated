/**
 * One landing page per fixed-fare outstation route: /cabs/mumbai-to-pune.
 *
 * These exist so someone searching "Mumbai to Pune cab" lands on a page about
 * exactly that, rather than on the outstation picker. The page itself does not
 * book anything - it explains the route, shows the office's current fares and
 * sends the visitor into the outstation flow with the route already chosen.
 *
 * Every price comes from the admin's Outstation fares master through
 * useOutstationRoutes(). Nothing here knows a number: a fare the office has not
 * set is shown as Fare on request, and the FAQ answers are written from the
 * same data so the page never says something the fare list does not.
 *
 * The words about the route itself - the road, the distance, what people go
 * for - come from seo/routeInfo.ts, so a route the website knows but the office
 * has not priced is still a real page, quoted on request.
 *
 * An unknown destination (a removed route, a typo) is not an error page: it
 * says there is no fixed fare for it, links to /outstation and the enquiry,
 * and is kept out of the search index.
 */
import { Link, useParams } from 'react-router-dom';
import PageHero from './PageHero';
import { CallButton, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck } from '../components/icons';
import { ROUTES } from './siteData';
import {
  CATEGORY_META, cheapest, routeBookingPath, routeLandingPath, rupees, useOutstationRoutes,
  type OutstationRoute, type RouteFare,
} from './outstation';
import { absUrl, breadcrumbLd, faqLd, useSeo } from './Seo';
import { routeInfo, ROUTE_INFO } from './seo/routeInfo';
import { LANG_NAME, alternatesFor, landingByPath, landingJsonLd } from './seo/landings';

/** "mahabaleshwar" -> "Mahabaleshwar", for the heading before the fares arrive. */
const titleCase = (key: string) =>
  key.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const sortFares = (fares: RouteFare[]) =>
  [...fares].sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order);

/** Question and answer pairs, written only from what the fare list says. */
function faqsFor(r: OutstationRoute) {
  const dest = r.destination;
  const oneWay = cheapest(r, 'ONE_WAY');
  const ret = cheapest(r, 'RETURN');
  const fares = sortFares(r.fares);
  const allToll = fares.length > 0 && fares.every((f) => f.tollIncluded);
  const someToll = fares.some((f) => f.tollIncluded);
  const distance = ROUTES.find((x) => x.to.toLowerCase() === dest.toLowerCase());

  const out: { q: string; a: string }[] = [
    {
      q: `How much is a cab from ${r.origin} to ${dest}?`,
      a: oneWay != null
        ? `One-way fares from ${r.origin} to ${dest} start at ${rupees(oneWay)} for a ${CATEGORY_META[fares.find((f) => f.oneWay === oneWay)!.category].label.toLowerCase()} cab. The fare for each vehicle category is listed on this page and is fixed for the route.`
        : `The office quotes this route on request. Send an enquiry with your date and pickup and we confirm the fare before the trip.`,
    },
    {
      q: `Is toll included in the ${dest} fare?`,
      a: allToll
        ? 'Yes. Every fare listed for this route includes toll.'
        : someToll
          ? 'Toll is included for the vehicle categories marked "toll included" on this page. For the others it is billed at actuals.'
          : 'Toll is billed at actuals on this route, on top of the fare.',
    },
    {
      q: `Can I book a return trip from ${r.origin} to ${dest}?`,
      a: ret != null
        ? `Yes. Choose Return when you book - return fares on this route start at ${rupees(ret)}.`
        : 'Yes. Choose Return when you book and send the dates; the office confirms the return fare for your trip.',
    },
    {
      q: `Which cars can I book for ${dest}?`,
      a: `${fares.map((f) => `${CATEGORY_META[f.category].label} (${f.vehicles})`).join(', ')}. Every car comes with a chauffeur.`,
    },
  ];
  if (distance) {
    out.splice(1, 0, {
      q: `How long does the drive from ${r.origin} to ${dest} take?`,
      a: `${dest} is about ${distance.km} from ${r.origin} by road, roughly ${distance.time.replace('≈', '')} depending on traffic and where in the city you are picked up.`,
    });
  }
  return out;
}

export default function RouteLanding() {
  // React Router 6 has no partial segments, so the route is /cabs/:slug and
  // the "mumbai-to-" prefix is taken off here.
  const { slug = '' } = useParams();
  const key = slug.toLowerCase().replace(/^mumbai-to-/, '');
  const { routes, failed } = useOutstationRoutes();
  const route = routes?.find((r) => r.key === key);
  const loading = routes === null;
  const path = routeLandingPath(key);
  const info = routeInfo(key);
  const landing = landingByPath(path);
  // No fixed fare and nothing known about the place: a removed route or a typo.
  const unknown = !loading && !route && !info;
  // A place the site knows, without a fixed fare (or the fares did not load): quoted on request.
  const onRequest = !loading && !route && !!info;

  const dest = route?.destination ?? info?.name.en ?? titleCase(key);
  const shortDest = dest.replace(/ \(.*\)$/, '');
  const oneWay = route ? cheapest(route, 'ONE_WAY') : null;
  const faqs = route ? faqsFor(route) : landing?.faqs ?? [];

  useSeo({
    title: landing ? landing.title : `Mumbai to ${dest} Cab - One Way and Return Fares`,
    rawTitle: !!landing,
    path,
    description: route
      ? `Book a Mumbai to ${shortDest} cab with a chauffeur, one way or return.${oneWay != null ? ` Fixed fares from ${rupees(oneWay)}.` : ''} ${sortFares(route.fares).map((f) => f.vehicles).join(', ')} - 24x7 from anywhere in Mumbai.`
      : landing?.description ?? `Outstation cab from Mumbai to ${dest}, one way or return, with a chauffeur. 24x7.`,
    // A key nobody knows (removed, or a typo) is kept out of the index.
    noindex: unknown && !failed,
    jsonLd: route || landing
      ? [
          ...(landing ? landingJsonLd(landing, absUrl).slice(0, 1) : []),
          breadcrumbLd([['Home', '/'], ['Outstation cabs', '/outstation'], [`Mumbai to ${shortDest}`, path]]),
          ...(faqs.length ? [faqLd(faqs)] : []),
        ]
      : undefined,
  });

  // Every route with a fixed fare first, then the ones the site knows without one.
  const others = [
    ...(routes ?? []).map((r) => ({ key: r.key, destination: r.destination })),
    ...ROUTE_INFO.map((r) => ({ key: r.key, destination: r.name.en.replace(/ \(.*\)$/, '') })),
  ].filter((r, i, all) => r.key !== key && all.findIndex((x) => x.key === r.key) === i);
  const listed = ROUTES.find((x) => x.to.toLowerCase() === dest.toLowerCase());
  const distance = listed ?? (info ? { km: `${info.km} km`, time: `≈${info.hours.en}` } : undefined);
  const otherLangs = alternatesFor(path).filter(([l]) => l === 'hi' || l === 'mr');

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Outstation cab from Mumbai"
        title={`Mumbai to ${shortDest} Cab`}
        crumbs={[{ label: 'Outstation', to: '/outstation' }, { label: `Mumbai to ${shortDest}` }]}
        sub={
          unknown
            ? `We do not have a fixed fare for ${dest} on the website yet - the office quotes it for your date and vehicle.`
            : <>
                A private, chauffeur-driven cab from anywhere in Mumbai, Navi Mumbai or Thane to {dest}, one way or return.
                {distance && <> It is about {distance.km} by road{info && <> via {info.via.en}</>}, {distance.time.replace('≈', 'roughly ')}.</>}
                {' '}{onRequest ? 'The office quotes the fare for your date and vehicle before you travel.' : 'The fare is fixed for the route and confirmed before you travel.'}
                {info && <> {info.note.en}</>}
              </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to={unknown ? '/outstation?tab=OUTSTATION' : onRequest ? '/enquire/outstation' : routeBookingPath(key)}
              className="grad-brand btn h-11 rounded-full px-6 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:brightness-[1.06]"
            >
              {unknown ? 'See outstation routes' : onRequest ? 'Ask for a quote' : 'See cabs and fares'} <IconArrowRight className="h-4 w-4" />
            </Link>
            <CallButton className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-800" />
          </div>
        }
      />

      <div className="shell">
        <div className="mx-auto max-w-4xl">
          {loading && <div className="tile p-10 text-center text-sm text-ink-500">Loading fares…</div>}

          {unknown && (
            <Reveal className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">
                {failed ? 'We could not load the fares just now' : `Going to ${dest}?`}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {failed
                  ? 'Please try again in a moment, or send the trip to us and the office will quote it.'
                  : 'Send the trip details and the office will come back with the fare and vehicle options. Or pick one of our fixed-fare routes.'}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/enquire/outstation" className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white hover:bg-ink-800">
                  Ask for a quote <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link to="/outstation?tab=OUTSTATION" className="btn h-11 rounded-full bg-white px-5 text-sm text-ink-700 shadow-card hover:shadow-raised">
                  All outstation routes
                </Link>
              </div>
            </Reveal>
          )}

          {route && (
            <>
              {/* ------------------------------ fares ------------------------------ */}
              <Reveal>
                <h2 className="font-display text-xl font-bold text-ink-900">Mumbai to {dest} cab fares</h2>
                <p className="mt-1 text-sm text-ink-500">Per vehicle, not per person. Pick a category to see the cars and send the booking.</p>
              </Reveal>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {sortFares(route.fares).map((f, i) => (
                  <Reveal key={f.category} delay={(i % 2) * 60} className="tile p-5">
                    <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">{CATEGORY_META[f.category].group}</p>
                    <h3 className="mt-1 font-display text-md font-bold text-ink-900">{CATEGORY_META[f.category].label}</h3>
                    <p className="text-xs text-ink-500">{f.vehicles} · {CATEGORY_META[f.category].blurb}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-3">
                      {([['One way', f.oneWay], ['Return', f.return]] as const).map(([label, n]) => (
                        <div key={label} className="rounded-2xl bg-ink-50 px-3.5 py-3">
                          <dt className="text-2xs font-semibold uppercase tracking-[0.1em] text-ink-400">{label}</dt>
                          <dd className={`mt-0.5 font-display font-bold ${n != null ? 'text-lg text-ink-900' : 'text-sm text-ink-600'}`}>
                            {n != null ? rupees(n) : 'Fare on request'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {f.tollIncluded && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                        <IconCheck className="h-3.5 w-3.5 text-ok-500" /> Toll included
                      </p>
                    )}
                  </Reveal>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <Link to={routeBookingPath(key)} className="font-semibold text-brand-700 hover:text-brand-800">
                  Book one way <IconArrowRight className="inline h-3.5 w-3.5" />
                </Link>
                <Link to={routeBookingPath(key, 'RETURN')} className="font-semibold text-brand-700 hover:text-brand-800">
                  Book a return trip <IconArrowRight className="inline h-3.5 w-3.5" />
                </Link>
                <Link to="/policies" className="text-ink-500 hover:text-brand-700">What a fare covers</Link>
              </div>

              {/* ------------------------------- FAQ ------------------------------- */}
              <Reveal className="mt-12">
                <h2 className="font-display text-xl font-bold text-ink-900">Mumbai to {dest} cab: common questions</h2>
                <div className="mt-4 space-y-3">
                  {faqs.map((f) => (
                    <div key={f.q} className="tile p-5">
                      <h3 className="font-display text-md font-bold text-ink-900">{f.q}</h3>
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.a}</p>
                    </div>
                  ))}
                </div>
              </Reveal>
            </>
          )}

          {onRequest && (
            <Reveal className="tile p-6 sm:p-8">
              <h2 className="font-display text-lg font-bold text-ink-900">Mumbai to {shortDest} cab fare</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                {failed
                  ? 'We could not load the fixed fares just now. Send the trip and the office will quote it, or try again in a moment.'
                  : `There is no fixed fare for ${shortDest} on the website yet. Send your date, pickup and the number of people, and the office comes back with the fare for each vehicle - one way or return, with toll and permits shown.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link to="/enquire/outstation" className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white hover:bg-ink-800">
                  Ask for a quote <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link to="/outstation?tab=OUTSTATION" className="btn h-11 rounded-full bg-white px-5 text-sm text-ink-700 shadow-card hover:shadow-raised">
                  Fixed-fare routes
                </Link>
              </div>
            </Reveal>
          )}

          {/* --------------------------- about the route --------------------------- */}
          {info && (
            <Reveal className="mt-12 grid gap-4 sm:grid-cols-2">
              <div className="tile p-5 sm:p-6">
                <h2 className="font-display text-lg font-bold text-ink-900">Places to see in and around {shortDest}</h2>
                <ul className="mt-3 space-y-1.5">
                  {info.seeThere.en.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-ink-700"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {p}</li>
                  ))}
                </ul>
                {info.destination && (
                  <Link to={`/destinations/${info.destination}`} className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:text-brand-800">
                    Trip ideas for {shortDest} <IconArrowRight className="inline h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
              <div className="tile p-5 sm:p-6">
                <h2 className="font-display text-lg font-bold text-ink-900">Good for</h2>
                <ul className="mt-3 space-y-1.5">
                  {info.goodFor.map((p) => (
                    <li key={p} className="flex gap-2 text-sm text-ink-700"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {p}</li>
                  ))}
                </ul>
                {otherLangs.length > 0 && (
                  <p className="mt-4 text-sm text-ink-500">
                    Read this in:{' '}
                    {otherLangs.map(([lang, to], i) => (
                      <span key={lang}>
                        {i > 0 && ' · '}
                        <Link to={to} hrefLang={lang} lang={lang} className="font-semibold text-brand-700 hover:text-brand-800">{LANG_NAME[lang as 'hi']}</Link>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </Reveal>
          )}

          {onRequest && faqs.length > 0 && (
            <Reveal className="mt-12">
              <h2 className="font-display text-xl font-bold text-ink-900">Mumbai to {shortDest} cab: common questions</h2>
              <div className="mt-4 space-y-3">
                {faqs.map((f) => (
                  <div key={f.q} className="tile p-5">
                    <h3 className="font-display text-md font-bold text-ink-900">{f.q}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.a}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          )}

          {/* ---------------------------- other routes --------------------------- */}
          {others.length > 0 && (
            <Reveal className="mt-12">
              <h2 className="font-display text-xl font-bold text-ink-900">Other outstation cabs from Mumbai</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {others.map((r) => (
                  <Link
                    key={r.key}
                    to={routeLandingPath(r.key)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-ink-700 shadow-card transition-shadow hover:shadow-raised"
                  >
                    Mumbai to {r.destination} cab
                  </Link>
                ))}
              </div>
            </Reveal>
          )}

          <div className="mt-9">
            <TrustRow compact />
          </div>
        </div>
      </div>
    </div>
  );
}
