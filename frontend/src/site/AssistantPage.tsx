/**
 * Travel assistant.
 *
 * A conversation that answers with a trip rather than a paragraph. Type "we are
 * 8 people and want to go to Mahabaleshwar for two nights" and you get the
 * vehicle we would send, an itinerary, the duration, an estimate and the extras
 * worth adding — as cards you can act on, not as text you have to re-type into
 * a form.
 *
 * It is deliberately a parser plus this site's own answers, not a language
 * model: nothing here can invent a rate, a route or a cancellation policy, and
 * it costs nothing to run (no AI API; the only requests are to this portal's
 * own /api/public endpoints). When it cannot work out what you mean it falls
 * back to the prepared answers and then to a person.
 *
 * Money shown here comes from two live sources only: the outstation fare
 * master (/api/public/outstation-fares) for outstation trips, and the
 * published rate card (/api/public/fare-options) for local and airport trips.
 * An outstation trip is never priced off a per-km rate: a route the office has
 * not priced says "fare on request" and offers the enquiry.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY } from './siteData';
import {
  ENQUIRY_LINK, NOT_FOUND_REPLY, findAnswer, outOfScope, outOfScopeReply, pleasantry, topicById, type LiveData,
} from './assistantKnowledge';
import {
  CATEGORY_META, fareOf, matchRoute, rupees, routeLabel, useOutstationRoutes, type Leg, type OutstationRoute,
} from './outstation';
import { ADDONS } from './catalog';
import { recommend, BAG_LABEL, PRIORITY_LABEL } from './recommend';
import { ASSISTANT_EXAMPLES, parseRequirement, type ParsedTrip } from './assistantParse';
import { tripQuery } from './tripParams';
import { VehicleCard } from './VehicleCard';
import {
  Callout, CompareProvider, EstimatePanel, SectionHead, TrustRow, estimateFor, useRates,
} from './kit';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconClock, IconPhone, IconPin, IconSearch } from '../components/icons';
import { IconWhatsApp, IconSeat } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';

interface Chip {
  label: string;
  topicId: string;
}

interface Turn {
  id: number;
  from: 'you' | 'assistant';
  text: string;
  /** A parsed trip turns the reply into cards instead of a paragraph. */
  trip?: ParsedTrip;
  link?: { label: string; to: string };
  also?: { label: string; to: string };
  /** Tappable follow-ups when we are not sure which answer was wanted. */
  chips?: Chip[];
}

let seq = 1;

/**
 * Turn a lookup against the site's prepared answers into a reply.
 *
 * Out-of-scope asks are declined by name — a visitor after a hotel has come to
 * the wrong desk, and a shortlist of car questions does not tell them that.
 */
function replyFor(said: string, live: LiveData): Omit<Turn, 'id' | 'from'> {
  const social = pleasantry(said);
  if (social) return { text: social };

  const away = outOfScope(said);
  if (away) return { text: outOfScopeReply(away), link: ENQUIRY_LINK };

  const match = findAnswer(said, live);

  if (match.kind === 'answer') {
    return { text: match.topic.answer, link: match.topic.link, also: match.topic.also };
  }

  return {
    text:
      match.kind === 'unsure'
        ? 'I am not certain which one you mean. Is it one of these?'
        : `${NOT_FOUND_REPLY} Or pick one of these.`,
    link: match.kind === 'none' ? ENQUIRY_LINK : undefined,
    chips: match.options.slice(0, 4).map((t) => ({ label: t.title, topicId: t.id })),
  };
}

/** Which enquiry form a parsed trip belongs on. */
const ENQUIRY_CATEGORY: Record<ParsedTrip['kind'], string> = {
  LOCAL: 'local', AIRPORT: 'airport', OUTSTATION: 'outstation', TOUR: 'darshan',
  CORPORATE: 'corporate', EVENT: 'event', WEDDING: 'wedding',
};

const OPENING =
  `Tell me the trip in your own words — how many of you, where you are going and for how long. ` +
  `I will come back with the vehicle we would send, roughly what it costs, and an itinerary you can change.`;

/* ==========================================================================
   The rich reply
   ========================================================================== */

/**
 * Which of our vehicles sit in each outstation fare category. Mirrors the
 * outstation page (OutstationPage.tsx), so the recommended car is priced off
 * the same row there. A vehicle in no category has no fixed fare.
 */
const FARE_CATEGORY_OF: Record<string, OutstationRoute['fares'][number]['category']> = {
  dzire: 'STANDARD', aura: 'STANDARD',
  ertiga: 'SUV_MUV', xl6: 'SUV_MUV',
  'honda-city': 'PREMIUM_SEDAN', ciaz: 'PREMIUM_SEDAN',
  'innova-crysta': 'PREMIUM_MUV', carens: 'PREMIUM_MUV',
};

function outstationHref(route: OutstationRoute | undefined, leg: Leg, to: string, pax: number) {
  const q = new URLSearchParams({ tab: 'OUTSTATION', leg, route: route?.key ?? 'other', pax: String(pax) });
  if (!route && to) q.set('to', to);
  return `/outstation?${q.toString()}`;
}

/**
 * The outstation price, from the fare master and nothing else. No per-km
 * arithmetic: a route or cab the office has not priced says so.
 */
function OutstationFares({
  trip, routes, failed, route, onlyLeg,
}: {
  trip: ParsedTrip; routes: OutstationRoute[] | null; failed: boolean;
  route: OutstationRoute | undefined; onlyLeg?: Leg;
}) {
  const place = trip.destination?.name ?? '';
  const leg: Leg = onlyLeg ?? 'ONE_WAY';
  const legs: Leg[] = onlyLeg ? [onlyLeg] : ['ONE_WAY', 'RETURN'];
  const enquire = `/enquire/outstation?${tripQuery({ tab: 'OUTSTATION', from: 'Mumbai', to: place, pax: trip.requirement.passengers, leg })}`;

  return (
    <div className="tile p-5">
      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">Outstation fare</p>
      {routes === null && !failed ? (
        <p className="mt-2 text-sm text-ink-500">Loading the current outstation fares…</p>
      ) : failed ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          The outstation fare list could not be loaded just now, so no fare is shown. Open the outstation page, or
          send an enquiry and the office will quote it.
        </p>
      ) : route ? (
        <>
          <p className="mt-1.5 font-display text-md font-bold text-ink-900">{routeLabel(route)}</p>
          {legs.map((l) => (
            <div key={l} className="mt-3">
              <p className="text-xs font-bold text-ink-700">{l === 'RETURN' ? 'Return' : 'One way'}</p>
              <ul className="mt-1.5 space-y-1">
                {[...route.fares]
                  .sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
                  .map((f) => {
                    const n = fareOf(f, l);
                    return (
                      <li key={f.category} className="flex flex-wrap justify-between gap-x-3 text-sm text-ink-600">
                        <span>{CATEGORY_META[f.category].label} <span className="text-ink-400">({f.vehicles})</span></span>
                        <span className="font-semibold text-ink-900">
                          {n == null ? 'Fare on request' : `${rupees(n)}${f.tollIncluded ? ' · toll included' : ' · toll extra'}`}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
          {!onlyLeg && (
            <p className="mt-3 text-2xs leading-relaxed text-ink-400">
              You did not say one way or return, so both are shown.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          {place
            ? `There is no fixed fare for ${place} on the portal — it is quoted on request.`
            : 'Outstation fares are fixed per destination. Tell me where you are going, or pick it on the outstation page.'}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        <Link to={outstationHref(route, leg, place, trip.requirement.passengers)} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800">
          {route ? `Book ${routeLabel(route)}` : place ? `Request a quote to ${place}` : 'Outstation fares'} <IconArrowRight className="h-3 w-3" />
        </Link>
        <Link to={enquire} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800">
          Send an outstation enquiry <IconArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

function TripAnswer({ trip }: { trip: ParsedTrip }) {
  const book = useRates();
  const { routes, failed } = useOutstationRoutes();
  const suggestions = recommend(trip.requirement);
  const top = suggestions[0];
  const alt = suggestions[1];

  const outstation = trip.requirement.scope === 'outstation';
  const route = outstation && routes && trip.destination ? matchRoute(routes, trip.destination.name) : undefined;
  const leg: Leg = trip.leg ?? 'ONE_WAY';

  // Local and airport trips are estimated from the published rate card.
  // Outstation trips are not: they are priced from the fare master below.
  const estInput = {
    plan: (trip.kind === 'AIRPORT' ? 'AIRPORT' : 'LOCAL') as 'AIRPORT' | 'LOCAL',
    days: trip.days,
  };

  const est = top && !outstation ? estimateFor(book, top.vehicle, { ...estInput, vehicles: top.count }) : null;

  /** The fixed fare for a card, or "fare on request" — never an estimate. */
  const fixedFareFor = (slug: string, count: number) => {
    if (!outstation) return undefined;
    const cat = FARE_CATEGORY_OF[slug];
    const f = route && cat ? route.fares.find((x) => x.category === cat) : undefined;
    return {
      amount: f ? fareOf(f, leg) : null,
      tollIncluded: f?.tollIncluded ?? false,
      legLabel: `${leg === 'RETURN' ? 'Return' : 'One way'}${count > 1 ? ' · per cab' : ''}`,
    };
  };

  const q = tripQuery({
    tab: outstation ? 'OUTSTATION' : trip.kind === 'AIRPORT' ? 'AIRPORT' : 'LOCAL',
    from: 'Mumbai',
    to: trip.destination?.name ?? trip.spot ?? '',
    pax: trip.requirement.passengers,
    leg: outstation ? leg : undefined,
  });

  if (!top) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* ------------------------- recommended vehicle ------------------------- */}
      <div>
        <p className="mb-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">Recommended vehicle</p>
        <div className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2">
          <VehicleCard
            vehicle={top.vehicle} best count={top.count}
            estimateInput={outstation ? undefined : estInput}
            fixedFare={fixedFareFor(top.vehicle.slug, top.count)}
            to={`/vehicles/${top.vehicle.slug}?${q}`} compact
          />
          <div className="tile flex flex-col p-5">
            <h4 className="font-display text-sm font-bold text-ink-900">Why</h4>
            <ul className="mt-3 flex-1 space-y-2">
              {top.why.map((w) => (
                <li key={w} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                  <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" /> {w}
                </li>
              ))}
            </ul>
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-ink-100 pt-3.5 text-xs">
              <div>
                <dt className="text-ink-400">Group</dt>
                <dd className="font-bold text-ink-900">{trip.requirement.passengers}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Luggage</dt>
                <dd className="font-bold text-ink-900">{BAG_LABEL[trip.requirement.bags]}</dd>
              </div>
              <div>
                <dt className="text-ink-400">Priority</dt>
                <dd className="font-bold text-ink-900">{PRIORITY_LABEL[trip.requirement.priority]}</dd>
              </div>
            </dl>
            {alt && (
              <p className="mt-3.5 text-xs leading-relaxed text-ink-500">
                Alternative:{' '}
                <Link to={`/vehicles/${alt.vehicle.slug}?${q}`} className="link">
                  {alt.count > 1 && `${alt.count} × `}{alt.vehicle.name}
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------- duration ------------------------------- */}
      <div className="tile p-5">
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">Suggested trip duration</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-display text-md font-bold text-ink-900">
          <span className="inline-flex items-center gap-1.5">
            <IconClock className="h-4 w-4 text-brand-500" />
            {trip.nights === 0 ? 'Single day' : `${trip.days} days, ${trip.nights} ${trip.nights === 1 ? 'night' : 'nights'}`}
          </span>
          {trip.destination && (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600">
              <IconPin className="h-4 w-4 text-brand-500" />
              {trip.destination.km} km each way · {trip.destination.hours}
            </span>
          )}
        </p>
        {!trip.found.nights && trip.destination && (
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            You did not say how long, so this assumes{' '}
            {trip.nights === 0 ? 'a day trip' : `${trip.nights} night${trip.nights === 1 ? '' : 's'}`} — which is what
            most people do for {trip.destination.name}. Change it in the trip builder.
          </p>
        )}
      </div>

      {/* ------------------------------ itinerary ------------------------------ */}
      {trip.destination && (
        <div className="tile p-5">
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">Suggested itinerary</p>
          <ol className="mt-4 space-y-0">
            {trip.destination.itinerary.slice(0, Math.max(1, trip.days)).map((leg, i, arr) => (
              <li key={leg.day} className="flex gap-3.5">
                <span className="relative flex w-5 shrink-0 justify-center">
                  <span className="grad-brand z-10 mt-0.5 grid h-5 w-5 place-items-center rounded-full font-display text-[10px] font-bold text-white ring-4 ring-white">
                    {i + 1}
                  </span>
                  {i < arr.length - 1 && <span className="absolute bottom-0 top-6 w-0.5 rounded-full bg-ink-200" />}
                </span>
                <span className="min-w-0 flex-1 pb-4">
                  <span className="block text-sm font-bold text-ink-900">{leg.day}</span>
                  <span className="mt-0.5 block text-sm leading-relaxed text-ink-600">{leg.plan}</span>
                </span>
              </li>
            ))}
          </ol>
          <Link to={`/destinations/${trip.destination.slug}`} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800">
            More about {trip.destination.name} <IconArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* ------------------------------- estimate ------------------------------- */}
      {outstation ? (
        <OutstationFares trip={trip} routes={routes} failed={failed} route={route} onlyLeg={trip.leg} />
      ) : est && (
        <EstimatePanel estimate={est.estimate} planLabel={est.planLabel} reason={est.reason} vehicles={top.count} />
      )}

      {/* ---------------------------- optional extras ---------------------------- */}
      <div className="tile p-5">
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-600">Optional services</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ADDONS.slice(0, 6).map((a) => (
            <li key={a.key} className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-600">
              <span aria-hidden="true">{a.emoji}</span> {a.label}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-2xs leading-relaxed text-ink-400">
          Each is quoted separately from the vehicle and none of them is in the estimate above.
        </p>
      </div>

      {/* -------------------------------- actions -------------------------------- */}
      <div className="flex flex-wrap gap-2.5">
        <Link
          to={`/enquiry?${q}&vehicle=${top.vehicle.slug}`}
          className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
        >
          Customise <IconArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to={outstation ? outstationHref(route, leg, trip.destination?.name ?? '', trip.requirement.passengers) : `/vehicles?${q}`}
          className="btn h-11 rounded-full bg-white px-5 text-md text-ink-800 shadow-card hover:shadow-raised"
        >
          View options
        </Link>
        <Link to={`/enquire/${ENQUIRY_CATEGORY[trip.kind]}?${q}`} className="btn h-11 rounded-full bg-ink-900 px-5 text-md text-white hover:bg-ink-800">
          Get a quote
        </Link>
      </div>
    </div>
  );
}

/* ==========================================================================
   The page
   ========================================================================== */

export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([{ id: seq++, from: 'assistant', text: OPENING }]);
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const { routes, failed } = useOutstationRoutes();
  const live: LiveData = { routes, failed };

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  const ask = (text: string) => {
    const said = text.trim();
    if (!said) return;

    const parsed = parseRequirement(said);
    const next: Turn[] = [{ id: seq++, from: 'you', text: said }];

    // A trip plan only when the sentence describes a trip. "Weather in Goa" or
    // "hotel in Lonavala" names a place but is not a trip to plan, and "can I
    // cancel a Pune trip" is a policy question, not a request for a car.
    const beside = pleasantry(said) || outOfScope(said) ? null : findAnswer(said, live);
    const policyQuestion =
      beside?.kind === 'answer' && !beside.topic.id.startsWith('route-') &&
      !parsed.found.passengers && !parsed.found.nights;
    const planIt = parsed.usable && !pleasantry(said) && !outOfScope(said) && !policyQuestion;

    if (planIt) {
      const bits = [
        parsed.found.passengers ? `${parsed.requirement.passengers} travelling` : null,
        parsed.destination ? `to ${parsed.destination.name}` : parsed.spot ? `around ${parsed.spot}` : null,
        parsed.nights > 0 ? `${parsed.nights} ${parsed.nights === 1 ? 'night' : 'nights'}` : null,
      ].filter(Boolean);

      next.push({
        id: seq++,
        from: 'assistant',
        text: bits.length
          ? `Got it — ${bits.join(', ')}. Here is what we would send, and the fare where the portal has one.`
          : 'Here is what we would send for that, and the fare where the portal has one.',
        trip: parsed,
      });
    } else {
      next.push({ id: seq++, from: 'assistant', ...replyFor(said, live) });
    }

    setTurns((t) => [...t, ...next]);
    setDraft('');
  };

  /** A chip resolves to the answer it names rather than being re-matched. */
  const openTopic = (chip: Chip) => {
    const topic = topicById(chip.topicId, live);
    setTurns((t) => [
      ...t,
      { id: seq++, from: 'you', text: chip.label },
      topic
        ? { id: seq++, from: 'assistant', text: topic.answer, link: topic.link, also: topic.also }
        : { id: seq++, from: 'assistant', ...replyFor(chip.label, live) },
    ]);
  };

  return (
    <CompareProvider>
      <div className="page-bg pb-24">
        <PageHero
          eyebrow="Travel assistant"
          title="Tell us what you need"
          sub="In your own words. It works out the vehicle, the duration and the itinerary, shows the fare where the portal has one — and hands you straight into booking or an enquiry."
          crumbs={[{ label: 'Travel assistant' }]}
        />

        <section className="shell">
          <div className="mx-auto max-w-3xl">
            {/* ------------------------------ the thread ------------------------------ */}
            <div className="space-y-5">
              {turns.map((t) =>
                t.from === 'you' ? (
                  <div key={t.id} className="flex justify-end">
                    <p className="grad-brand max-w-[85%] rounded-[1.25rem] rounded-br-md px-4 py-3 text-sm font-medium leading-relaxed text-white shadow-sm shadow-brand-500/20">
                      {t.text}
                    </p>
                  </div>
                ) : (
                  <div key={t.id} className="animate-fade-up">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-600 shadow-card">
                        <IconSearch className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-line rounded-[1.25rem] rounded-tl-md bg-white px-4 py-3 text-sm leading-[1.7] text-ink-700 shadow-card">
                          {t.text}
                        </p>
                        {t.chips && t.chips.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {t.chips.map((c) => (
                              <button
                                key={c.topicId}
                                onClick={() => openTopic(c)}
                                className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-card transition-colors hover:text-brand-700"
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {t.link && (
                          <Link
                            to={t.link.to}
                            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:text-brand-800"
                          >
                            {t.link.label} <IconArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                        {t.also && (
                          <Link
                            to={t.also.to}
                            className="ml-4 mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:text-brand-800"
                          >
                            {t.also.label} <IconArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                        {t.trip && <TripAnswer trip={t.trip} />}
                      </div>
                    </div>
                  </div>
                )
              )}
              <div ref={end} />
            </div>

            {/* ------------------------------ examples ------------------------------ */}
            {turns.length === 1 && (
              <div className="mt-6">
                <p className="mb-2.5 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Try one of these</p>
                <div className="flex flex-wrap gap-2">
                  {ASSISTANT_EXAMPLES.map((e) => (
                    <button
                      key={e}
                      onClick={() => ask(e)}
                      className="rounded-full bg-white px-3.5 py-2 text-left text-xs font-medium text-ink-600 shadow-card transition-colors hover:text-ink-900"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* -------------------------------- input -------------------------------- */}
            <form
              onSubmit={(e) => { e.preventDefault(); ask(draft); }}
              className="sticky bottom-4 mt-7 flex gap-2 rounded-full bg-white p-2 shadow-pop"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. 6 of us to Lonavala on Saturday"
                aria-label="Describe your trip"
                className="min-w-0 flex-1 border-0 bg-transparent px-3.5 text-sm font-medium text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-400"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="grad-brand btn h-10 shrink-0 rounded-full px-5 text-sm font-semibold text-white disabled:opacity-40"
              >
                Ask
              </button>
            </form>

            <Callout className="mt-6">
              This assistant reads your sentence and answers only from this website's own fares, vehicles, routes and
              policies. It is not an AI chatbot — it cannot make up a price or a policy. A fare the office has not set
              shows as "fare on request", and anything the site does not cover is handed to Enquire, WhatsApp or Call.
            </Callout>

            <div className="mt-6 flex flex-wrap gap-3">
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <WhatsAppButton
                className="btn h-11 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
              >
                <IconWhatsApp className="h-4 w-4" /> WhatsApp
              </WhatsAppButton>
              <Link to="/help-me-choose" className="btn h-11 rounded-full bg-white px-5 text-md text-ink-800 shadow-card hover:shadow-raised">
                <IconSeat className="h-4 w-4" /> Rather answer four questions?
              </Link>
            </div>

            <SectionHead
              className="mt-14"
              eyebrow="Also"
              title="Everything the assistant knows, as a page"
              sub="The written answers it draws on, grouped and searchable."
              action={
                <Link to="/faq" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  Open the FAQ <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />

            <TrustRow className="mt-8" />
          </div>
        </section>
      </div>
    </CompareProvider>
  );
}
