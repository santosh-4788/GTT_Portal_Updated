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
 * Every answer is derived from siteData, so the widget cannot drift away from
 * the page it is sitting on.
 */
import { COMPANY, SERVICES, FLEET, ROUTES, FAQS, MORE_FAQS, INCLUDED, CHARGED_SEPARATELY } from './siteData';

export interface Topic {
  id: string;
  /** Shown as a suggestion chip, and as the heading of a "did you mean". */
  title: string;
  /** Words a visitor might use. Matching is on stems, so 'book' catches 'booking'. */
  keywords: string[];
  answer: string;
  /** Optional in-app link offered under the answer. */
  link?: { label: string; to: string };
}

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
    });
  });

  // --- one topic per service, straight from the service pages ---------------
  SERVICES.forEach((svc) => {
    topics.push({
      id: `service-${svc.slug}`,
      title: svc.name,
      keywords: [...tokenise(svc.name), ...tokenise(svc.short), ...svc.idealFor.flatMap(tokenise)],
      answer: `${svc.blurb}\n\n${list(svc.points.slice(0, 4))}`,
      link: { label: `More on ${svc.name.toLowerCase()}`, to: `/services/${svc.slug}` },
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
  topics.push({
    id: 'routes',
    title: 'Which outstation routes do you run?',
    keywords: ['route', 'outstation', 'distance', 'far', 'long', 'km', 'kilometre', 'destination', 'drop',
      ...ROUTES.flatMap((r) => tokenise(r.to))],
    answer:
      'These are the runs we do most weeks from Mumbai:\n\n' +
      ROUTES.map((r) => `• ${r.to} — ${r.km}, ${r.time}`).join('\n') +
      '\n\nAnywhere else in Maharashtra or the neighbouring states is a normal outstation booking — just ask.',
    link: { label: 'Outstation travel', to: '/services/outstation-travel' },
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
      CHARGED_SEPARATELY.map(([label, note]) => `• ${label} — ${note}`).join('\n'),
  });

  // --- the fare calculator --------------------------------------------------
  topics.push({
    id: 'calculator',
    title: 'Can I work out the fare myself?',
    keywords: ['calculator', 'calculate', 'estimate', 'work', 'out', 'myself', 'tool', 'tariff', 'quote',
      'approximate', 'rough', 'idea', 'ballpark'],
    answer:
      'Yes — there is a fare calculator further down this page. Choose local, airport or outstation, pick the ' +
      'vehicle, and it works out an indicative total including GST.\n\nToll, parking and any state permit are ' +
      'added at actuals on top, and the figure is an estimate rather than a quotation: the rate is confirmed ' +
      'with you before the vehicle is assigned.',
  });

  // --- reaching a person ----------------------------------------------------
  topics.push({
    id: 'contact',
    title: 'How do I reach you?',
    keywords: ['phone', 'reach', 'speak', 'talk', 'person', 'human', 'agent', 'someone', 'email', 'address',
      'office', 'where', 'located', 'owner', 'manager'],
    answer:
      `Tap Call to reach ${COMPANY.owner} — ${COMPANY.serviceHours.toLowerCase()}, and there is no call-centre queue in between.\n\n` +
      `Email: ${COMPANY.email}\nOffice: ${COMPANY.address}`,
    link: { label: 'Send an enquiry', to: '/contact' },
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
      'kilometres is billed at the rate agreed before the trip, on its own line of the invoice.',
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
      'The fleet is standard sedans, MPVs, Travellers and a coach \u2014 there is no wheelchair-lift vehicle in ' +
      'it. A sedan is the lowest step up; the Travellers and the coach are the highest.\n\nTell the office who ' +
      'is travelling when you book and they will tell you what can be arranged. Better to settle it on the ' +
      'phone than leave the chauffeur to work it out on the morning.',
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
  // Not handled as out-of-scope like hotels and air tickets, because the answer
  // is "not that, but here is what you do get" rather than "wrong desk".
  topics.push({
    id: 'guide',
    title: 'Do you provide a tour guide?',
    keywords: ['guide', 'commentary', 'explain', 'history', 'escort', 'licensed', 'narrate'],
    answer:
      'We provide the vehicle and a chauffeur who knows the route and the usual stops \u2014 not a licensed ' +
      'guide, and we would rather say so than let you find out on the day.\n\nFor Mumbai Darshan and the ' +
      'weekend routes the itinerary is planned with you in advance, so the day is worked out before you set ' +
      'off even though nobody is narrating it.',
    link: { label: 'Mumbai Darshan', to: '/tours/mumbai' },
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
    link: { label: 'My trips', to: '/my-trips' },
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
  'Which areas do you cover?',
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

/**
 * "How much to Pune?" is the single most common question a travel desk gets,
 * and it names a place. Answering with the distance, the run time and how the
 * rate is set beats sending back a shortlist of topics.
 */
function destinationTopic(asked: string[]): Topic | null {
  const route = ROUTES.find((r) => asked.includes(stem(r.to.toLowerCase())));
  if (!route) return null;

  return {
    id: 'route-' + route.to.toLowerCase(),
    title: 'Mumbai to ' + route.to,
    keywords: [],
    answer:
      `Mumbai to ${route.to} is about ${route.km}, roughly ${route.time} on the road. It is one of the runs we do ` +
      `most weeks, as a one-way drop or a round trip.\n\nThe rate depends on the vehicle and which of those two you ` +
      'need, so it is quoted for your requirement — tap Call and you get a firm number, with ' +
      `toll, parking and any state permit shown separately at actuals.`,
    link: { label: 'Outstation travel', to: '/services/outstation-travel' },
  };
}

/**
 * Asks we should decline by name rather than approximate.
 *
 * A visitor asking about hotels or air tickets has come to the wrong desk, and
 * a shortlist of car questions does not tell them that. These run ahead of
 * everything else, including the destination shortcut — otherwise "book my
 * hotel in Lonavala" comes back with a road distance.
 */
const OUT_OF_SCOPE: Array<[RegExp, string]> = [
  [/\bhotels?\b|\baccommodation\b|\bresorts?\b|\bhomestays?\b|\bguest ?houses?\b|\brooms? booking\b/i,
    'accommodation'],
  [/\b(air|flight|train|rail|railway)\s*tickets?\b|\bticket\s*booking\b|\bbook (a )?(flight|train)\b/i,
    'air and rail tickets'],
  [/\bvisas?\b|\bpassports?\b/i, 'visas and passports'],
  [/\bweather\b|\bforecast\b/i, 'weather forecasts'],
  [/\bforeign exchange\b|\bforex\b|\bcurrency\b/i, 'foreign exchange'],
];

export function outOfScope(question: string): string | null {
  for (const [re, what] of OUT_OF_SCOPE) if (re.test(question)) return what;
  return null;
}

/** Short exchanges that deserve a reply but are not questions about the business. */
const PLEASANTRIES: Array<[RegExp, string]> = [
  [/^(hi|hey|hello|hii+|namaste|good (morning|afternoon|evening))\b/i,
    'Hello. Ask me about rates, vehicles, routes, airport transfers or how billing works — or tell me what you need and I will point you the right way.'],
  [/\b(thanks|thank you|thankyou|ty|great|nice|good|ok|okay)\b\s*[!.]*$/i,
    'Glad to help. If you would like a quote, tap "Talk to a person" below and leave your number — Vinay will call you back.'],
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
export function findAnswer(question: string): Match {
  const asked = tokenise(question);
  if (asked.length === 0) return { kind: 'none', options: suggestionsFor([]) };

  const destination = destinationTopic(asked);
  if (destination) return { kind: 'answer', topic: destination };

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

export function topicById(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}
