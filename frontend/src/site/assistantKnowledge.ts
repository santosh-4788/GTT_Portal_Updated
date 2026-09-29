/**
 * The site assistant's brain.
 *
 * It runs entirely in the visitor's browser. There is no API key, no request to
 * a model provider and no per-message cost — the whole thing is a keyword
 * matcher over answers written for this business, exactly like the rest of the
 * portal is built to work with no internet connection and nothing to pay for.
 *
 * The trade for that is honesty about what it is: it retrieves the closest
 * prepared answer and says so when nothing is close, rather than inventing an
 * answer the way a language model would. For a travel desk that is the right
 * trade — a made-up cancellation policy or a guessed rate is worse than
 * "let me take your number".
 *
 * Every answer is derived from the portal's own data — siteData, the enquiry
 * categories, the places list and, for outstation fares, the LIVE fare master
 * served by /api/public/outstation-fares (passed in as `LiveData`). No price is
 * ever written into this file: a fare the office has not set is "fare on
 * request", never a guess.
 */
import { COMPANY, SERVICES, FLEET, ROUTES, FAQS, MORE_FAQS, INCLUDED, CHARGED_SEPARATELY } from './siteData';
import { AIRPORTS, HOURLY_PLANS } from './enquiryCategories';
import { DESTINATIONS } from './places';
import { CATEGORY_META, cheapest, fareOf, rupees, routeLabel, type Leg, type OutstationRoute } from './outstation';

export interface Topic {
  id: string;
  /** Shown as a suggestion chip, and as the heading of a "did you mean". */
  title: string;
  /** Words a visitor might use. Matching is on stems, so 'book' catches 'booking'. */
  keywords: string[];
  answer: string;
  /** Optional in-app link offered under the answer. */
  link?: { label: string; to: string };
  /** A second link, e.g. the enquiry form when a fare is on request. */
  also?: { label: string; to: string };
}

/**
 * What the assistant knows that changes without a deploy: the outstation fare
 * master. `routes` is null while it is loading; `failed` when it could not be
 * fetched. Either way the assistant says so rather than quoting from memory.
 */
export interface LiveData {
  routes: OutstationRoute[] | null;
  failed?: boolean;
}

const NO_LIVE: LiveData = { routes: null };

const OUTSTATION_LINK = { label: 'Outstation fares and booking', to: '/outstation' };
const OUTSTATION_QUOTE = { label: 'Request an outstation quote', to: '/enquire/outstation' };
const ENQUIRY_LINK = { label: 'Send an enquiry', to: '/enquiry' };

// ---------------------------------------------------------------------------
// Language handling
// ---------------------------------------------------------------------------

/** Words that carry no signal in a question of this kind. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'am', 'do', 'does', 'did', 'can', 'could',
  'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'have', 'has', 'had', 'i', 'me', 'my', 'we',
  'our', 'us', 'you', 'your', 'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
  'to', 'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'about', 'as', 'and', 'or', 'but', 'if',
  'so', 'there', 'here', 'please', 'kindly', 'want', 'need', 'get', 'give', 'tell', 'know', 'like',
  'any', 'some', 'also', 'just', 'very', 'pls', 'plz', 'sir', 'madam',
  // Question words. 'where' and 'which' are left in, because answers use them
  // as real keywords ("where are you", "which areas").
  'what', 'how', 'when', 'why', 'who', 'whom', 'whose',
]);

/**
 * Words Indian callers use that are not the words the answers are written in.
 * Without this, "how much for a cab to Pune" matches nothing.
 */
const SYNONYMS: Record<string, string> = {
  cab: 'vehicle', taxi: 'vehicle', car: 'vehicle', cars: 'vehicle', gaadi: 'vehicle',
  vehicles: 'vehicle', transport: 'vehicle', ride: 'trip', trips: 'trip', journey: 'trip',
  tour: 'trip', tours: 'trip', travel: 'trip', travelling: 'trip', traveling: 'trip',
  cost: 'rate', costs: 'rate', price: 'rate', prices: 'rate', pricing: 'rate', rates: 'rate',
  charge: 'rate', charges: 'rate', fare: 'rate', fares: 'rate', quotation: 'quote',
  bill: 'invoice', billing: 'invoice', invoices: 'invoice', receipt: 'invoice',
  booking: 'book', bookings: 'book', reserve: 'book', reservation: 'book', hire: 'book',
  driver: 'driver', drivers: 'driver', chauffeur: 'driver', chauffeurs: 'driver',
  aeroplane: 'flight', plane: 'flight', airplane: 'flight', flights: 'flight',
  seater: 'seat', seats: 'seat', seating: 'seat', capacity: 'seat', people: 'seat',
  passengers: 'seat', persons: 'seat', pax: 'seat',
  contact: 'phone', call: 'phone', number: 'phone', mobile: 'phone', whatsapp: 'phone',
  timing: 'time', timings: 'time', hours: 'time', hour: 'time',
  outstation: 'outstation', outside: 'outstation',
  wedding: 'event', marriage: 'event', weddings: 'event', function: 'event',
  cancellation: 'cancel', cancelled: 'cancel', refund: 'cancel',
  tempo: 'traveller', bus: 'coach',
  // Added after probing the widget with real questions. Each of these is a word
  // a caller uses that no answer was written in, so the question either matched
  // nothing or matched the wrong answer confidently.
  rating: 'review', ratings: 'review', reviews: 'review', testimonial: 'review',
  testimonials: 'review', feedback: 'review',
  tracking: 'track', gps: 'track', trace: 'track',
  guides: 'guide', guided: 'guide',
  languages: 'language', speaks: 'speak', speaking: 'speak',
  disabled: 'wheelchair', handicapped: 'wheelchair',
  deposit: 'advance', token: 'advance',
};

/** 'bookings' -> 'book', 'vehicles' -> 'vehicle'. Crude, but the same rule is */
/** applied to the keywords, so both sides land in the same place.            */
function stem(word: string): string {
  const mapped = SYNONYMS[word] ?? word;
  if (mapped.length > 4 && mapped.endsWith('ies')) return mapped.slice(0, -3) + 'y';
  if (mapped.length > 4 && mapped.endsWith('es')) return mapped.slice(0, -2);
  if (mapped.length > 3 && mapped.endsWith('s') && !mapped.endsWith('ss')) return mapped.slice(0, -1);
  if (mapped.length > 5 && mapped.endsWith('ing')) return mapped.slice(0, -3);
  return mapped;
}

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// ---------------------------------------------------------------------------
// The knowledge base
// ---------------------------------------------------------------------------

const list = (items: readonly string[]) => items.map((i) => `• ${i}`).join('\n');

/** "a, b and c" */
const joinAnd = (items: readonly string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * Where a written FAQ in siteData has fallen behind what the portal now does,
 * the assistant answers with the corrected version below (same facts, brought
 * up to date from the booking bar, the enquiry categories and the outstation
 * flow). Keyed by the FAQ's question text; a question that is reworded in
 * siteData simply falls back to its own answer.
 */
const FAQ_OVERRIDES: Record<string, Partial<Pick<Topic, 'answer' | 'link' | 'also'>>> = {
  'What do you charge?': {
    answer:
      'It depends on the kind of trip:\n\n' +
      '• Local, airport and hourly — search from the booking bar and each vehicle shows an indicative estimate ' +
      'worked out from the published rate card, where the rate card has one. There is also a fare calculator on ' +
      'the home page. Toll, parking and any state permit are extra at actuals.\n' +
      '• Outstation one way — set routes from Mumbai have a fixed fare on the outstation page. A route or cab ' +
      'the office has not priced shows "fare on request".\n' +
      '• Corporate accounts — a negotiated rate card agreed before the first trip.\n\n' +
      'An estimate is never binding: the rate is confirmed with you before the vehicle is assigned.',
    link: { label: 'Open the booking bar', to: '/book' },
    also: OUTSTATION_LINK,
  },
  'How do I book a vehicle?': {
    answer:
      'Use the booking bar — choose Local, Airport, Outstation or Hourly, fill in the trip and send the request. ' +
      'For corporate, event, wedding, group or sightseeing trips there is an enquiry form for each. Or call ' +
      `${COMPANY.owner}, or WhatsApp the same number.\n\nThe package and the rate are confirmed with you before ` +
      'the car is assigned.',
    link: { label: 'Open the booking bar', to: '/book' },
    also: ENQUIRY_LINK,
  },
  'Do you handle airport pickups with flight tracking?': {
    answer:
      `Yes — pickups and drops at ${joinAnd(AIRPORTS)}. Give us the flight number and the chauffeur adjusts to ` +
      'the actual landing time, so a delayed flight does not cost you the car. Meet-and-greet at arrivals is ' +
      'available on request.',
    link: { label: 'Book an airport transfer', to: '/book?tab=AIRPORT' },
    also: { label: 'Airport enquiry form', to: '/enquire/airport' },
  },
  'Where does the driver meet me at the airport?': {
    answer:
      'At the pickup point outside arrivals at your terminal, and the chauffeur calls you as you land. ' +
      'Meet-and-greet inside the arrivals hall with a name board is available on request.',
    link: { label: 'Airport enquiry form', to: '/enquire/airport' },
  },
  'Can I get a vehicle for a full day, or only point to point?': {
    answer:
      `Both. The hourly packages are ${joinAnd(HOURLY_PLANS)}, with the car and chauffeur with you throughout ` +
      'and as many stops as you need. Anything past the package is charged at the published rate. Airport ' +
      'transfers are priced point to point instead.',
    link: { label: 'Book an hourly package', to: '/book?tab=HOURLY' },
  },
  'Do you do one-way drops to another city?': {
    answer:
      'Yes. Set routes from Mumbai have a fixed one-way fare on the outstation page — pick the destination and ' +
      'the cab. For anywhere else choose Other and the office quotes it. A return trip is priced separately.',
    link: OUTSTATION_LINK,
    also: OUTSTATION_QUOTE,
  },
  'Is there a minimum booking, or a minimum number of hours?': {
    answer:
      `No minimum for a city transfer — a single airport drop is a normal booking. The hourly packages are ` +
      `${joinAnd(HOURLY_PLANS)}. On outstation, set routes have a fixed one-way fare; return and multi-day ` +
      'trips are quoted for the requirement.',
    link: OUTSTATION_LINK,
  },
};

function buildTopics(): Topic[] {
  const topics: Topic[] = [];

  // --- the written FAQs -----------------------------------------------------
  // Both lists: the page shows FAQS, the assistant searches those plus the
  // longer tail in MORE_FAQS, so it answers a good deal more than is printed.
  [...FAQS, ...MORE_FAQS].forEach((f, i) => {
    topics.push({
      id: `faq-${i}`,
      title: f.q,
      keywords: [...tokenise(f.q), ...(f.keywords ?? []).map(stem)],
      answer: f.a,
      ...FAQ_OVERRIDES[f.q],
    });
  });

  // --- one topic per service, straight from the service pages ---------------
  // Outstation is answered live from the fare master (see `resolve`), so its
  // static text here is only the fallback while nothing has loaded.
  SERVICES.forEach((svc) => {
    const outstation = svc.slug === 'outstation-travel';
    const airport = svc.slug === 'airport-transfers';
    topics.push({
      id: `service-${svc.slug}`,
      title: svc.name,
      keywords: [...tokenise(svc.name), ...tokenise(svc.short), ...svc.idealFor.flatMap(tokenise)],
      answer: `${svc.blurb}\n\n${list(svc.points.slice(0, 4))}`,
      link: outstation ? OUTSTATION_LINK : { label: `More on ${svc.name.toLowerCase()}`, to: `/services/${svc.slug}` },
      also: outstation ? OUTSTATION_QUOTE : airport ? { label: 'Airport enquiry form', to: '/enquire/airport' } : undefined,
    });
  });

  // --- the fleet ------------------------------------------------------------
  topics.push({
    id: 'fleet',
    title: 'What vehicles do you have?',
    keywords: ['vehicle', 'fleet', 'seat', 'model', 'sedan', 'suv', 'mpv', 'traveller', 'coach', 'luggage',
      'bag', 'big', 'small', 'available', 'dzire', 'swift', 'ertiga', 'innova', 'crysta', 'honda', 'city',
      'toyota', 'maruti', 'suzuki', 'force', 'tempo', 'option', 'type', 'kind', 'which'],
    answer:
      'The fleet runs from sedans to a 45-seat coach:\n\n' +
      FLEET.map((v) => `• ${v.name} — ${v.seats} seats, ${v.luggage.toLowerCase()}. Best for ${v.best.toLowerCase()}.`).join('\n'),
    link: { label: 'See the full fleet', to: '/fleet' },
  });

  // --- outstation routes ----------------------------------------------------
  // The answer text is replaced at reply time with the live fare master (see
  // `resolve`); what is written here only says where to look.
  topics.push({
    id: 'routes',
    title: 'Which outstation routes do you run?',
    keywords: ['route', 'outstation', 'distance', 'far', 'long', 'km', 'kilometre', 'destination', 'drop',
      'fixed', 'intercity', ...ROUTES.flatMap((r) => tokenise(r.to))],
    answer:
      'The outstation page lists every route from Mumbai that has a fixed fare, with the current fare for each ' +
      'cab. For anywhere else, choose Other there and the office quotes it.',
    link: OUTSTATION_LINK,
    also: OUTSTATION_QUOTE,
  });

  // --- what a fare covers ---------------------------------------------------
  topics.push({
    id: 'inclusions',
    title: 'What is included in the fare?',
    keywords: ['include', 'included', 'inclusion', 'cover', 'fuel', 'petrol', 'diesel', 'cng', 'extra',
      'hidden', 'exclude', 'excluded', 'rate', 'contain', 'comprise', 'part', 'inclusive', 'exclusive',
      'surcharge', 'markup', 'commission'],
    answer:
      'The quoted fare covers:\n\n' + list(INCLUDED) +
      '\n\nBilled separately, at actuals:\n\n' +
      CHARGED_SEPARATELY.map(([label, note]) => `• ${label} — ${note}`).join('\n') +
      '\n\nThe fixed one-way outstation fares are the exception: each one on the outstation page says whether ' +
      'toll is already included.',
    link: { label: 'Terms in plain words', to: '/policies' },
  });

  // --- the fare calculator --------------------------------------------------
  topics.push({
    id: 'calculator',
    title: 'Can I work out the fare myself?',
    keywords: ['calculator', 'calculate', 'estimate', 'work', 'out', 'myself', 'tool', 'tariff', 'quote',
      'approximate', 'rough', 'idea', 'ballpark'],
    answer:
      'Yes — the home page has a fare calculator, and a search from the booking bar shows an estimate against ' +
      'each vehicle. Both work from the published rate card and include GST.\n\nToll, parking and any state ' +
      'permit are added at actuals on top, and the figure is an estimate rather than a quotation: the rate is ' +
      'confirmed with you before the vehicle is assigned. For outstation one-way trips, go by the fixed fares ' +
      'on the outstation page.',
    link: { label: 'Home page fare calculator', to: '/' },
    also: OUTSTATION_LINK,
  });

  // --- reaching a person ----------------------------------------------------
  topics.push({
    id: 'contact',
    title: 'How do I reach you?',
    keywords: ['phone', 'reach', 'speak', 'talk', 'person', 'human', 'agent', 'someone', 'email', 'address',
      'office', 'where', 'located', 'owner', 'manager'],
    answer:
      `Tap Call to reach ${COMPANY.owner} — ${COMPANY.serviceHours.toLowerCase()}, and there is no call-centre queue in between. ` +
      `WhatsApp goes to the same number, +91 ${COMPANY.whatsapp}.\n\n` +
      `Email: ${COMPANY.email}\nOffice: ${COMPANY.address}`,
    link: ENQUIRY_LINK,
    also: { label: 'Contact page', to: '/contact' },
  });

  /* ------------------------------------------------------------------------
     Answers added after probing the widget with the questions a travel desk
     actually gets. Each fixes a case where it was previously CONFIDENTLY
     WRONG - "do you have a wheelchair accessible vehicle" came back with the
     air-conditioning answer, "do you provide a tour guide" with the duty-slip
     answer - which is worse than answering nothing at all.

     Every sentence is assembled from siteData: FLEET, INCLUDED,
     CHARGED_SEPARATELY and the written FAQs. Where the site does not say, the
     answer hands over to the office rather than inventing one.
     ------------------------------------------------------------------------ */

  // --- how many people fit --------------------------------------------------
  // "do you have a 17 seater" used to return the child-seat answer, because
  // 'seat' is the only content word the two share. The number is the real
  // signal, so the numbers are keywords.
  topics.push({
    id: 'seats',
    title: 'How many people can travel?',
    keywords: ['seat', 'seater', 'people', 'person', 'passenger', 'fit', 'capacity', 'group', 'family',
      'many', 'accommodate', 'headcount',
      ...[...new Set(FLEET.map((v) => String(v.seats)))]],
    answer:
      'By seats, not counting the chauffeur:\n\n' +
      [...new Set(FLEET.map((v) => v.seats))]
        .sort((a, b) => a - b)
        .map((n) => `\u2022 ${n} \u2014 ${FLEET.filter((v) => v.seats === n).map((v) => v.name).join(', ')}`)
        .join('\n') +
      '\n\nFor a movement larger than one coach we run several vehicles together, which is a normal booking ' +
      'rather than a special case.',
    link: { label: 'See the full fleet', to: '/fleet' },
  });

  // --- night running, allowance, waiting ------------------------------------
  // Three questions that all mean "what will appear on the bill that nobody
  // told me about". The answers exist, spread across the FAQs and
  // CHARGED_SEPARATELY; this puts them in one place.
  topics.push({
    id: 'extras',
    title: 'Is there a night charge or a driver allowance?',
    // Stems, not words: a question's terms are stemmed before matching, so
    // 'waiting charges' arrives here as 'wait rate'.
    keywords: ['night', 'allowance', 'batta', 'wait', 'halt', 'idle', 'surcharge', 'hidden',
      'midnight', 'permit', 'border', 'exceed', 'overtime', 'extra', 'rate'],
    answer:
      'There is no night surcharge \u2014 the desk runs 24\u00d77, and early-morning or late-night duties are ' +
      'part of the normal schedule rather than an exception we charge to arrange.\n\nWhat is billed on top of ' +
      'the quoted fare, at actuals:\n\n' +
      CHARGED_SEPARATELY.map(([label, note]) => `\u2022 ${label} \u2014 ${note}`).join('\n') +
      '\n\nWaiting inside a round trip is part of the duty, not an extra. Anything beyond the agreed hours or ' +
      'kilometres is billed at the rate agreed before the trip, on its own line of the invoice. The fixed ' +
      'one-way outstation fares say on the outstation page whether toll is already included.',
    link: { label: 'Terms in plain words', to: '/policies' },
  });

  // --- advance ---------------------------------------------------------------
  // Used to match "Do you take airport pickups at odd hours?" on the word 'take'.
  topics.push({
    id: 'advance',
    title: 'Do you need an advance?',
    // 'take' earns its place: "do you take advance" is how the question is
    // actually asked, and without it the airport-pickup answer won on that word.
    keywords: ['advance', 'upfront', 'front', 'amount', 'settle', 'confirm', 'prepay', 'take'],
    answer:
      'For a one-off booking the amount is confirmed before the trip and settled on completion. Corporate ' +
      'accounts are invoiced on the agreed cycle \u2014 per trip, fortnightly or monthly \u2014 with the terms ' +
      'set when the account opens.\n\nIf an advance is needed for a particular booking, the office will say so ' +
      'when the rate is confirmed. Tap Call for a firm number.',
  });

  // --- a passenger who needs help boarding -----------------------------------
  // This was answering with the air-conditioning topic. It is the answer in the
  // base most worth getting right and least worth guessing at, so it says what
  // the fleet is and then hands over to a person.
  topics.push({
    id: 'access',
    title: 'Can you help a passenger who cannot climb in easily?',
    keywords: ['wheelchair', 'accessible', 'elderly', 'senior', 'mother', 'father', 'walker', 'stick',
      'crutch', 'injured', 'patient', 'hospital', 'climb', 'board', 'ramp', 'assistance'],
    answer:
      'The fleet listed on this site is sedans, SUVs / MUVs, Travellers and a coach \u2014 none of them is listed ' +
      'as a wheelchair-lift vehicle.\n\nTell the office who is travelling when you book and they will tell you ' +
      'what can be arranged. Better to settle it on the phone than leave the chauffeur to work it out on the ' +
      'morning.',
    link: { label: 'Talk to the office', to: '/contact' },
  });

  // --- what the chauffeur speaks ---------------------------------------------
  topics.push({
    id: 'language',
    title: 'What language do the chauffeurs speak?',
    keywords: ['language', 'speak', 'english', 'hindi', 'marathi', 'gujarati', 'communicate',
      'understand', 'converse', 'interpreter'],
    answer:
      'Say which language you need when you book and the office will confirm who is available \u2014 not ' +
      'something to leave to chance with a guest arriving at the airport.\n\nThe vehicle number, the chauffeur ' +
      'name and the chauffeur mobile are sent to you before the reporting time, so you can speak to them ahead ' +
      'of the trip if it matters.',
    link: { label: 'Talk to the office', to: '/contact' },
  });

  // --- guide vs chauffeur ----------------------------------------------------
  // The Terms page and the add-ons list (catalog ADDONS) both say a guide can
  // be arranged alongside a trip, quoted and billed separately \u2014 so that is
  // the answer, not "we do not do guides".
  topics.push({
    id: 'guide',
    title: 'Do you provide a tour guide?',
    keywords: ['guide', 'commentary', 'explain', 'history', 'escort', 'licensed', 'narrate'],
    answer:
      'The chauffeur knows the route and the usual stops, but is not a guide. A local tour guide for the ' +
      'sightseeing part of the day can be arranged alongside the trip \u2014 quoted per day and billed ' +
      'separately from the vehicle. Mention it in your enquiry.',
    link: { label: 'Mumbai sightseeing', to: '/tours/mumbai' },
    also: { label: 'Sightseeing enquiry', to: '/enquire/darshan' },
  });

  // --- hotels ----------------------------------------------------------------
  // Same basis as the guide: Terms and ADDONS say hotels can be arranged
  // alongside a trip and are billed by the hotel.
  topics.push({
    id: 'hotel',
    title: 'Can you book a hotel as well?',
    keywords: ['hotel', 'accommodation', 'resort', 'room', 'homestay', 'lodge', 'lodging', 'guesthouse'],
    answer:
      'Hotel rooms can be arranged alongside a trip through the hotels we work with. They are billed by the ' +
      'hotel, separately from the vehicle, and no vehicle fare or estimate on this site includes them. Mention ' +
      'it in your enquiry and the office will come back to you.',
    link: { label: 'Outstation enquiry', to: '/enquire/outstation' },
  });

  // --- tracking --------------------------------------------------------------
  // Both "can I track the vehicle" and "is there live gps tracking" used to
  // return the flight-tracking answer, which implies a live map this portal
  // does not have. TrackTrip.tsx says so in its own header; so does this.
  topics.push({
    id: 'tracking',
    title: 'Can I track the vehicle?',
    keywords: ['track', 'live', 'map', 'location', 'coming', 'status', 'eta', 'follow', 'telemetry'],
    answer:
      'Not on a live map \u2014 there is no vehicle telemetry behind this portal, and a dot that is guessing is ' +
      'worse than no dot.\n\nWhat you get instead: the vehicle number, the chauffeur name and the chauffeur ' +
      'mobile before the reporting time, the trip page for your booking, and the office on one tap. On an ' +
      'airport pickup the chauffeur tracks the flight, so a delayed landing does not mean a missed car.',
    link: { label: 'Look up a trip', to: '/track' },
    also: { label: 'My trips', to: '/trips' },
  });

  // --- what customers say ----------------------------------------------------
  topics.push({
    id: 'reviews',
    title: 'What do customers say?',
    keywords: ['review', 'star', 'experience', 'reputation', 'trust', 'reliable', 'recommend',
      'others'],
    answer:
      'There is a reviews page with what customers have written about their trips \u2014 the route they took, ' +
      'the vehicle, and how the day went.\n\nIf you would rather speak to someone about a particular kind of ' +
      `booking, tap Call and ask for ${COMPANY.owner}.`,
    link: { label: 'Read the reviews', to: '/reviews' },
  });

  return topics;
}

export const TOPICS = buildTopics();

/** The chips offered when the panel opens. Ordered by what people ask most. */
export const OPENING_SUGGESTIONS = [
  'What do you charge?',
  'Which outstation routes do you run?',
  'What vehicles do you have?',
  'What is included in the fare?',
  'How do I book a vehicle?',
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * How many topics use each keyword. A word only one answer claims is a far
 * stronger signal than one half the answers share, and without this the common
 * word drowns the distinctive one.
 */
const DOC_FREQ: Map<string, number> = (() => {
  const df = new Map<string, number>();
  for (const t of TOPICS) for (const k of new Set(t.keywords)) df.set(k, (df.get(k) ?? 0) + 1);
  return df;
})();

const idf = (k: string) => Math.log(1 + TOPICS.length / (DOC_FREQ.get(k) ?? TOPICS.length));

/** Title + answer, lowercased, so a phrase the visitor typed can be spotted. */
const HAYSTACK = new Map(TOPICS.map((t) => [t.id, (t.title + ' ' + t.answer).toLowerCase()]));

export type Match =
  | { kind: 'answer'; topic: Topic }
  | { kind: 'unsure'; options: Topic[] }
  | { kind: 'none'; options: Topic[] };

/* ---------------------------------------------------------------------------
   Live outstation answers
   --------------------------------------------------------------------------- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameRe = (name: string) => new RegExp(`\\b${escapeRe(name.toLowerCase())}\\b`, 'i');

const routeBookLink = (r: OutstationRoute) => ({
  label: `Book ${routeLabel(r)}`,
  to: `/outstation?${new URLSearchParams({ tab: 'OUTSTATION', leg: 'ONE_WAY', route: r.key }).toString()}`,
});

const otherRouteLink = (to: string) => ({
  label: `Request a quote to ${to}`,
  to: `/outstation?${new URLSearchParams({ tab: 'OUTSTATION', leg: 'ONE_WAY', route: 'other', to }).toString()}`,
});

/** Approximate road distance, only where the portal itself publishes one. */
function approxDistance(place: string): string | null {
  const d = DESTINATIONS.find((x) => x.name.toLowerCase() === place.toLowerCase());
  if (d) return `about ${d.km} km, ${d.hours} on the road`;
  const r = ROUTES.find((x) => x.to.toLowerCase() === place.toLowerCase());
  return r ? `about ${r.km}, ${r.time} on the road` : null;
}

/** One line per cab for one leg, straight off the fare master. */
function fareLines(r: OutstationRoute, leg: Leg): string {
  return [...r.fares]
    .sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
    .map((f) => {
      const n = fareOf(f, leg);
      const price = n == null
        ? 'fare on request'
        : `${rupees(n)}${f.tollIncluded ? ', toll included' : ', toll not included'}`;
      return `• ${CATEGORY_META[f.category].label} (${f.vehicles}) — ${price}`;
    })
    .join('\n');
}

/** A reply for a named route in the fare master. */
function routeAnswer(r: OutstationRoute): Topic {
  const priced = (leg: Leg) => r.fares.some((f) => fareOf(f, leg) != null);
  const dist = approxDistance(r.destination);
  const anyOnRequest = r.fares.some((f) => f.oneWay == null || f.return == null);
  return {
    id: `route-${r.key}`,
    title: routeLabel(r),
    keywords: [],
    answer:
      `${routeLabel(r)}${dist ? ` is ${dist} (approximate)` : ''}. Fixed fares from the outstation fare list:\n\n` +
      `One way:\n${priced('ONE_WAY') ? fareLines(r, 'ONE_WAY') : '• Fare on request for every cab'}\n\n` +
      `Return:\n${priced('RETURN') ? fareLines(r, 'RETURN') : '• Fare on request for every cab'}` +
      (anyOnRequest
        ? '\n\nWhere it says fare on request, the office quotes it for your trip — send an enquiry, WhatsApp or call.'
        : ''),
    link: routeBookLink(r),
    also: anyOnRequest ? OUTSTATION_QUOTE : undefined,
  };
}

/** A place the portal knows but has no fixed fare for. */
function unpricedPlaceAnswer(place: string): Topic {
  const dist = approxDistance(place);
  return {
    id: `route-other-${place.toLowerCase()}`,
    title: `Mumbai → ${place}`,
    keywords: [],
    answer:
      `There is no fixed fare for ${place} on the portal${dist ? ` (it is ${dist}, approximately)` : ''}, so I ` +
      'will not guess one. Choose Other on the outstation page, or send an outstation enquiry, and the office ' +
      'quotes it for your trip. WhatsApp and Call work too.',
    link: otherRouteLink(place),
    also: OUTSTATION_QUOTE,
  };
}

/** The answer when the fare list has not arrived (yet, or at all). */
function faresUnavailable(live: LiveData, place?: string): Topic {
  return {
    id: 'route-unavailable',
    title: place ? `Mumbai → ${place}` : 'Outstation fares',
    keywords: [],
    answer: live.failed
      ? 'I could not load the outstation fare list just now, so I will not quote a fare from memory. The ' +
        'outstation page shows the current fares, or send an enquiry, WhatsApp or call.'
      : live.routes
        // Loaded, and the office has no fixed-fare routes listed at the moment.
        ? 'There are no fixed-fare outstation routes listed on the portal right now, so every outstation trip ' +
          'is quoted for the requirement. Send an outstation enquiry, WhatsApp or call.'
        : 'The outstation fare list is still loading. Ask again in a moment, or open the outstation page to see ' +
          'the current fare for each route and cab.',
    link: OUTSTATION_LINK,
    also: OUTSTATION_QUOTE,
  };
}

/** "Which routes do you run?", answered from the fare master. */
function routesSummary(live: LiveData, intro = ''): Topic | null {
  if (!live.routes || live.routes.length === 0) return null;
  const lines = live.routes.map((r) => {
    const from = cheapest(r, 'ONE_WAY');
    return `• ${routeLabel(r)} — ${from == null ? 'fare on request' : `one way from ${rupees(from)}`}`;
  });
  const anyReturn = live.routes.some((r) => cheapest(r, 'RETURN') != null);
  return {
    id: 'routes',
    title: 'Which outstation routes do you run?',
    keywords: [],
    answer:
      `${intro}Routes with a fixed fare, lowest-priced cab shown:\n\n${lines.join('\n')}\n\n` +
      (anyReturn ? 'Return fares are on the outstation page. ' : 'Return trips: fare on request. ') +
      'For any other destination, choose Other on the outstation page and the office quotes it.',
    link: OUTSTATION_LINK,
    also: OUTSTATION_QUOTE,
  };
}

/**
 * Swap a prepared topic for its live version where one exists. Every UI calls
 * this (through findAnswer and topicById), so a chip and a typed question get
 * the same, current answer.
 */
export function resolve(topic: Topic, live: LiveData = NO_LIVE): Topic {
  if (topic.id === 'routes') {
    return routesSummary(live) ?? { ...faresUnavailable(live), id: topic.id, title: topic.title };
  }
  if (topic.id === 'service-outstation-travel') {
    const summary = routesSummary(live, 'One-way drops and return trips from Mumbai, with experienced highway drivers.\n\n');
    return summary ? { ...summary, id: topic.id, title: topic.title } : { ...topic, answer:
      'One-way drops and return trips from Mumbai, with experienced highway drivers. The outstation page lists ' +
      'the routes with a fixed fare; for anywhere else choose Other and the office quotes it.' };
  }
  return topic;
}

/**
 * "How much to Pune?" is the single most common question a travel desk gets,
 * and it names a place. Answer it from the live fare master: the fixed fares
 * where the office has set them, "fare on request" where it has not.
 */
function destinationTopic(question: string, live: LiveData): { topic: Topic; name: string } | null {
  // "Pune airport" is an airport transfer, not an outstation run.
  if (/\bairports?\b|\bterminal\b|\bflight\b/i.test(question)) return null;

  const route = live.routes?.find((r) => nameRe(r.destination).test(question));
  if (route) return { topic: routeAnswer(route), name: route.destination };

  const place =
    DESTINATIONS.find((d) => nameRe(d.name).test(question))?.name ??
    ROUTES.find((r) => nameRe(r.to).test(question))?.to;
  if (!place) {
    // "Mumbai to Nagpur fare": a fare question for a place the portal does
    // not know at all. Say there is no fixed fare rather than offering a
    // shortlist of unrelated topics.
    const fareWords = /\b(fare|fares|rate|rates|price|cost|charges?|how much|taxi|cab|drop)\b/i;
    const to = /\b(?:mumbai\s+)?to\s+([a-z]{3,})\b/i.exec(question)?.[1]?.toLowerCase();
    const notPlaces = new Set(['the', 'you', 'your', 'our', 'book', 'go', 'get', 'reach', 'pay', 'cancel', 'change',
      'travel', 'contact', 'speak', 'talk', 'call', 'know', 'see', 'take', 'come', 'pick', 'drop', 'work', 'find',
      'check', 'track', 'share', 'make', 'send', 'ask', 'carry', 'bring', 'wait', 'hire', 'rent', 'mumbai',
      'airport', 'station', 'terminal', 'office', 'home', 'hotel', 'city', 'town', 'outstation', 'any', 'another']);
    if (!to || notPlaces.has(to) || !fareWords.test(question)) return null;
    const name = to[0].toUpperCase() + to.slice(1);
    return {
      name,
      topic: {
        id: `route-unknown-${to}`,
        title: `Fare to ${name}`,
        keywords: [],
        answer:
          `I do not have a fare for ${name} on the portal, so I will not guess one.\n\n` +
          '• If it is within Mumbai, Thane or Navi Mumbai, search from the booking bar (Local, Airport or Hourly) ' +
          'and each vehicle shows an estimate from the published rate card.\n' +
          '• If it is an outstation trip, choose Other on the outstation page, or send an outstation enquiry, and ' +
          'the office quotes it.',
        link: otherRouteLink(name),
        also: { label: 'Open the booking bar', to: '/book' },
      },
    };
  }
  // Not in the fare list — but the list may simply not have arrived.
  if (!live.routes || live.routes.length === 0) return { topic: faresUnavailable(live, place), name: place };
  return { topic: unpricedPlaceAnswer(place), name: place };
}

/**
 * Asks we should decline by name rather than approximate.
 *
 * Two kinds. Some are things the Terms page says we do not arrange. The rest
 * are questions this portal simply has no information about — weather, other
 * companies, general knowledge — where any answer would be a guess. These run
 * ahead of everything else, including the destination shortcut, so "weather
 * in Lonavala" does not come back with a fare.
 */
const NOT_ARRANGED: Array<[RegExp, string]> = [
  [/\b(air|flight|plane|train|rail|railway)\s*tickets?\b|\bticket\s*booking\b|\bbook (a |my )?(flight|train)\b/i,
    'air and rail tickets'],
  [/\bvisas?\b|\bpassports?\b/i, 'visas and passports'],
  [/\bforeign exchange\b|\bforex\b|\bcurrency exchange\b/i, 'foreign exchange'],
];

const NOT_ON_PORTAL: Array<[RegExp, string]> = [
  [/\bweather\b|\bforecast\b|\btemperature\b|\braining\b|\bmonsoon (update|alert)\b/i, 'the weather'],
  [/\b(uber|ola|rapido|meru|savaari|blablacar|zoomcar|redbus|makemytrip|goibibo|cleartrip|yatra|indigo|air india|vistara|irctc)\b/i,
    'other companies'],
  [/\btraffic (update|jam|status|now|today)\b|\broad (closed|closure|condition)s?\b|\bghat (closed|open)\b/i,
    'live traffic or road conditions'],
  [/\b(news|politics|election|cricket|ipl|football|stock market|sensex|nifty|bitcoin|crypto|horoscope|recipe|joke|lottery)\b/i,
    'that topic'],
  [/\b(capital of|prime minister|chief minister|president of|population of|who won|meaning of|define|translate|homework)\b/i,
    'general knowledge'],
  [/\b(petrol|diesel|fuel) (price|rate)s?\b/i, 'fuel prices'],
];

export type OutOfScope = { kind: 'not-arranged' | 'not-on-portal'; what: string };

export function outOfScope(question: string): OutOfScope | null {
  for (const [re, what] of NOT_ARRANGED) if (re.test(question)) return { kind: 'not-arranged', what };
  for (const [re, what] of NOT_ON_PORTAL) if (re.test(question)) return { kind: 'not-on-portal', what };
  return null;
}

/** The words to say for an out-of-scope ask. Shared by both assistant UIs. */
export function outOfScopeReply(o: OutOfScope): string {
  return o.kind === 'not-arranged'
    ? `We do not arrange ${o.what} — the Terms page says so, and anything I said about it would be a guess. ` +
      'We arrange the vehicle and the chauffeur.'
    : `This portal has no information about ${o.what}, so I will not guess. I can only answer from what this ` +
      `site says about our own vehicles, fares, routes and bookings. For anything else, send an enquiry, ` +
      `WhatsApp us or call ${COMPANY.owner}.`;
}

/** What to say when nothing on the portal answers the question. */
export const NOT_FOUND_REPLY =
  'I could not find that in the information on this portal, so I will not guess. Send an enquiry, WhatsApp us ' +
  `or call ${COMPANY.owner} and you will get a straight answer.`;

export { ENQUIRY_LINK };

/** Short exchanges that deserve a reply but are not questions about the business. */
const PLEASANTRIES: Array<[RegExp, string]> = [
  [/^(hi+|hey|hello|namaste|good (morning|afternoon|evening))\b/i,
    'Hello. Ask me about fares, vehicles, outstation routes, airport transfers or how billing works — or tell me what you need and I will point you the right way.'],
  // Anchored: "ok" or "thanks" on its own, not "is the Pune rate ok".
  [/^(ok(ay)?|thanks?|thank you|thankyou|ty|great|nice|good|cool)( (thanks|thank you|a lot|so much))?[\s!.]*$/i,
    `Glad to help. For a firm quote, send an enquiry, WhatsApp us or call ${COMPANY.owner}.`],
  [/\b(bye|goodbye|see you)\b/i, 'Thanks for stopping by. Safe travels.'],
];

export function pleasantry(question: string): string | null {
  const q = question.trim();
  if (q.length > 40) return null;         // a real question that happens to start with "hi"
  for (const [re, reply] of PLEASANTRIES) if (re.test(q)) return reply;
  return null;
}

/**
 * Score every topic against the question and return the best, if it is good
 * enough to be worth showing.
 *
 * Scoring is deliberately blunt: an exact stem hit counts double a prefix hit,
 * and the total is divided by the square root of the keyword count so a topic
 * with a long keyword list cannot win on sheer surface area.
 */
/**
 * Topics that are only a general version of "what does a trip to X cost".
 * When a question names a destination and otherwise lands on one of these,
 * the destination's own fare answer is the better reply.
 */
const FARE_TOPIC_IDS = new Set(['routes', 'calculator', 'inclusions', 'extras', 'fleet', 'seats',
  'service-outstation-travel', 'service-tour-packages']);
const FARE_FAQS = new Set(['What do you charge?', 'Which areas do you cover?', 'Do you do one-way drops to another city?',
  'Is there a minimum booking, or a minimum number of hours?', 'Can the same vehicle wait and bring us back?',
  'Do you provide vehicles for a multi-day trip?', 'Are toll and parking extra?', 'Do you do sightseeing or tour packages?']);
const FARE_WORDS = /\b(fares?|fairs?|rates?|prices?|pricing|cost|costs|charges?|tariff|how much|kitna|kiti|kitne|bhada|bhade|kiraya)\b/i;
const isFareTopic = (t: Topic) => FARE_TOPIC_IDS.has(t.id) || FARE_FAQS.has(t.title);

export function findAnswer(question: string, live: LiveData = NO_LIVE): Match {
  const withLive = (m: Match): Match =>
    m.kind === 'answer' ? { kind: 'answer', topic: resolve(m.topic, live) } : m;

  const destination = destinationTopic(question, live);
  if (destination) {
    // "Cancellation on a Pune trip" is a cancellation question that happens to
    // name a place. Match what is left once the place is taken out; only if
    // that is another fare question does the destination's fare answer win.
    // A question that asks for the fare in so many words ("please share fare
    // for Mumbai to Nashik") is a fare question, whatever else it says:
    // "share" alone once matched the answer about sharing driver details.
    if (FARE_WORDS.test(question)) return { kind: 'answer', topic: destination.topic };
    const rest = scoreMatch(question.replace(new RegExp(nameRe(destination.name).source, 'gi'), ' '));
    if (rest.kind === 'answer' && !isFareTopic(rest.topic)) return withLive(rest);
    return { kind: 'answer', topic: destination.topic };
  }
  return withLive(scoreMatch(question));
}

function scoreMatch(question: string): Match {
  const asked = tokenise(question);
  if (asked.length === 0) return { kind: 'none', options: suggestionsFor([]) };

  // If what they typed reduces to exactly a question we hold, answer it.
  // Scoring alone cannot: "what vehicles do you have" is one content word once
  // the question words are stripped, and 'vehicle' is too common to win on its
  // own — even though it is word for word one of our own headings.
  const key = asked.join(' ');
  const titled = TOPICS.find((t) => tokenise(t.title).join(' ') === key);
  if (titled) return { kind: 'answer', topic: titled };

  // Kept unstemmed and unfiltered, for spotting phrases the visitor typed.
  const raw = question.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  const scored = TOPICS.map((topic) => {
    const keys = new Set(topic.keywords);
    let score = 0;
    let hits = 0;
    for (const word of asked) {
      if (keys.has(word)) { score += idf(word); hits++; continue; }
      // A prefix hit catches 'airport' against 'airports', 'invoic' against 'invoice'.
      if (word.length >= 4) {
        const near = [...keys].find((k) => k.startsWith(word) || word.startsWith(k));
        if (near) { score += idf(near) * 0.5; hits++; }
      }
    }

    // "8 hours", "one way", "child seat" — two words in the order they were
    // typed, found in the answer itself, beats any amount of keyword overlap.
    const hay = HAYSTACK.get(topic.id) ?? '';
    for (let i = 0; i < raw.length - 1; i++) {
      // Both halves have to carry meaning. Without this, "do you have wifi"
      // scored the pair "you have" against a topic titled "What vehicles do you
      // have?" and beat the answer that actually mentions wifi.
      if (STOPWORDS.has(raw[i]) || STOPWORDS.has(raw[i + 1])) continue;
      const pair = raw[i] + ' ' + raw[i + 1];
      // A phrase found word for word is at least as good as a keyword hit, so
      // it counts toward coverage too — "8 hours package" should not be turned
      // away for only matching one keyword when the answer says "8 hours".
      if (pair.length > 6 && hay.includes(pair)) { score += 2; hits++; }
    }

    return { topic, hits, score: score / Math.sqrt(Math.max(6, keys.size)) };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];

  /**
   * How much of the question the winner actually accounts for.
   *
   * Score alone is not enough: "do you sell air tickets" hits 'air' in the
   * air-conditioning answer and nothing else, and a high-scoring single word
   * would have answered it confidently and wrongly. A real answer has to cover
   * the question, not one word of it.
   */
  const covered = best.hits / asked.length;
  const uniqueHit = asked.some((w) => DOC_FREQ.get(w) === 1 && new Set(best.topic.keywords).has(w));
  const enough =
    asked.length <= 1
      ? best.hits >= 1
      // A word only one answer in the whole base uses is strong enough on its
      // own, so it needs less of the question behind it than a common one.
      : (best.hits >= 2 && covered >= 0.34) || (uniqueHit && covered >= 0.3);

  // A strong hit answers on its own; a moderate one has to be ahead of the next.
  if (enough && (best.score >= 1.1 || (best.score >= 0.55 && best.score >= runnerUp.score * 1.15))) {
    return { kind: 'answer', topic: best.topic };
  }
  // Genuinely ambiguous — offer the shortlist rather than guessing. Only topics
  // close to the leader, so the third chip is a real alternative and not noise.
  if (best.score >= 0.35) {
    return {
      kind: 'unsure',
      options: scored.slice(0, 3).filter((x) => x.score >= best.score * 0.6).map((x) => x.topic),
    };
  }
  return { kind: 'none', options: suggestionsFor(scored.slice(0, 3).map((x) => x.topic)) };
}

function suggestionsFor(fallback: Topic[]): Topic[] {
  const byTitle = new Map(TOPICS.map((t) => [t.title, t]));
  const opening = OPENING_SUGGESTIONS.map((t) => byTitle.get(t)).filter((t): t is Topic => !!t);
  return opening.length ? opening : fallback;
}

export function topicById(id: string, live: LiveData = NO_LIVE): Topic | undefined {
  const t = TOPICS.find((x) => x.id === id);
  return t && resolve(t, live);
}
