/**
 * What a customer means - the assistant's understanding layer.
 *
 *   message -> language -> clean-up (synonyms, spelling) -> normalise
 *           -> entities (route, trip type, passengers, date, Trip ID ...)
 *           -> intent (rules first, then the office's example questions)
 *
 * It decides what was asked, never what the answer is. The answer is read
 * from the portal's live data by the widget (Assistant.tsx): fares from the
 * fare master, vehicles from the catalogue, a booking from its trip page.
 *
 * All of it runs in the browser: rules, a small edit-distance matcher for
 * spelling, and the example questions and synonyms kept under Admin > Chatbot
 * Knowledge (/api/public/chatbot/knowledge). No AI, NLP or translation
 * service, so it costs nothing to run.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { todayLocalIso } from '../lib/format';
import { KNOWN_PLACES, detectLang, normalise, type Lang } from './assistantLang';
import { outOfScope } from './assistantKnowledge';
import { VEHICLES } from './catalog';
import { type FareCategory, type Leg, type OutstationRoute } from './outstation';

export type Intent =
  | 'GREETING' | 'GOODBYE' | 'THANKS' | 'HELP' | 'AFFIRM' | 'DENY'
  | 'SERVICE_INFORMATION'
  | 'LOCAL_BOOKING' | 'AIRPORT_BOOKING' | 'AIRPORT_TO' | 'AIRPORT_FROM' | 'OUTSTATION_BOOKING' | 'HOURLY_BOOKING'
  | 'ONE_WAY_BOOKING' | 'RETURN_BOOKING' | 'CUSTOM_ROUTE' | 'BOOKING_CREATE'
  | 'FARE_INQUIRY' | 'FARE_BREAKDOWN' | 'TOLL_INFORMATION' | 'EXTRA_CHARGES'
  | 'VEHICLE_INFORMATION' | 'STANDARD_VEHICLE' | 'SUV_MUV' | 'PREMIUM_VEHICLE' | 'VEHICLE_CAPACITY' | 'PASSENGER_INFORMATION'
  | 'PICKUP_INFORMATION' | 'DROP_INFORMATION' | 'MULTI_STOP' | 'DATE_SELECTION' | 'TIME_SELECTION'
  | 'BOOKING_MODIFY' | 'BOOKING_CANCEL' | 'BOOKING_STATUS' | 'BOOKING_CONFIRMATION'
  | 'DRIVER_INFORMATION' | 'VEHICLE_ASSIGNMENT'
  | 'PAYMENT_INFORMATION' | 'INVOICE_INFORMATION'
  | 'WHATSAPP_REQUEST' | 'CONTACT_SUPPORT' | 'CORPORATE_BOOKING' | 'BULK_BOOKING' | 'INQUIRY_CREATE' | 'INQUIRY_STATUS'
  | 'FEEDBACK' | 'DRIVER_RATING' | 'SERVICE_RATING' | 'CAB_RATING' | 'COMPLAINT' | 'SUGGESTION' | 'TRIP_COMPLETED'
  | 'PLACE_ONLY' | 'UNKNOWN_INTENT' | 'OUT_OF_SCOPE';

export type Kind = 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'HOURLY';

export interface Entities {
  /** A fixed-fare route the message names (always from Mumbai). */
  route?: OutstationRoute;
  /** The message names the route backwards: "Pune se Mumbai". */
  reversed?: boolean;
  /** A place that is not a fixed-fare route ("Goa", "Nagpur"). */
  place?: string;
  from?: string;
  to?: string;
  leg?: Leg;
  kind?: Kind;
  airportWay?: 'TO' | 'FROM';
  hours?: number;
  pax?: number;
  date?: string;
  time?: string;
  category?: FareCategory;
  model?: string;
  tripId?: string;
  /** Four digits, or a 10-digit mobile - to check a Trip ID. */
  digits?: string;
  fareWord?: boolean;
  bookWord?: boolean;
}

export interface Understanding {
  lang: Lang | null;
  /** The message as the rules read it: synonyms applied, spelling fixed, normalised to English. */
  text: string;
  /** Before normalising - what the booking parser is given. */
  cleaned: string;
  intent: Intent;
  confidence: number;
  entities: Entities;
}

/* ==========================================================================
   The office's knowledge base
   ========================================================================== */

export interface KnowledgeBase {
  intents: { code: string; category: string; dynamic: boolean; templates: Record<string, string> | null }[];
  examples: { intent: string; lang: string; text: string }[];
  entities: { type: string; value: string; display: string; synonyms: string[] }[];
}

interface Prepared {
  examples: { intent: Intent; words: Set<string> }[];
  /** Spelling / name variants rewritten before anything else reads the message. */
  rewrites: [RegExp, string][];
  /** Extra words that mean a vehicle category. */
  vehicleWords: [RegExp, FareCategory][];
  fareWords: RegExp | null;
  places: string[];
  templates: Map<string, Record<string, string>>;
  inactive: Set<string>;
}

let cache: Promise<KnowledgeBase | null> | null = null;

/** The knowledge base, fetched once. The assistant works without it - on its rules alone. */
export function useChatbotKnowledge(): Prepared {
  const [kb, setKb] = useState<Prepared>(EMPTY);
  useEffect(() => {
    let live = true;
    if (!cache) {
      cache = api.get('/public/chatbot/knowledge')
        .then(({ data }) => (data?.data ?? null) as KnowledgeBase | null)
        .catch(() => { cache = null; return null; });
    }
    cache.then((k) => { if (live && k) setKb(prepare(k)); });
    return () => { live = false; };
  }, []);
  return kb;
}

const EMPTY: Prepared = {
  examples: [], rewrites: [], vehicleWords: [], fareWords: null, places: [], templates: new Map(), inactive: new Set(),
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole word or phrase, in either script (\b does not work on Devanagari). */
const phraseRe = (s: string) => new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${escapeRe(s.toLowerCase())}(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'gu');

const CATEGORY_OF: Record<string, FareCategory> = { sedan: 'STANDARD', standard: 'STANDARD', suv: 'SUV_MUV', muv: 'SUV_MUV', premium: 'PREMIUM_SEDAN' };

export function prepare(k: KnowledgeBase): Prepared {
  const active = new Set(k.intents.map((i) => i.code));
  const rewrites: [RegExp, string][] = [];
  const vehicleWords: [RegExp, FareCategory][] = [];
  const fare: string[] = [];
  const places: string[] = [];
  for (const e of k.entities) {
    if (e.type === 'LOCATION') places.push(e.value);
    for (const syn of e.synonyms) {
      if (!syn || syn === e.value) continue;
      // Places and trip types are rewritten, so every rule downstream sees
      // "pune" whether the customer wrote Poona, Puna or पुणे.
      if (e.type === 'LOCATION' || e.type === 'TRIP_TYPE') rewrites.push([phraseRe(syn), `$1${e.value}`]);
      else if (e.type === 'VEHICLE' && CATEGORY_OF[e.value]) vehicleWords.push([phraseRe(syn), CATEGORY_OF[e.value]]);
      else if (e.type === 'FARE_TERM') fare.push(escapeRe(syn.toLowerCase()));
    }
  }
  // Longest first, so "round trip" is rewritten before "trip" could be.
  rewrites.sort((a, b) => b[0].source.length - a[0].source.length);
  return {
    examples: k.examples
      .filter((x) => active.has(x.intent))
      .map((x) => ({ intent: x.intent as Intent, words: wordSet(normalise(x.text)) }))
      .filter((x) => x.words.size > 0),
    rewrites,
    vehicleWords,
    fareWords: fare.length ? new RegExp(`\\b(${fare.join('|')})\\b`, 'i') : null,
    places,
    templates: new Map(k.intents.filter((i) => i.templates).map((i) => [i.code, i.templates!])),
    inactive: new Set(),
  };
}

/* ==========================================================================
   Spelling
   ========================================================================== */

/** Optimal string alignment distance: Levenshtein plus a swapped pair ("mumabi"). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/*
 * Places are only corrected when the misspelling is long enough to be
 * unambiguous: "puna" is a synonym (exact), but a four-letter guess would turn
 * "june" into Pune. Thane is left out because "thank" is one letter away.
 */
const FUZZY_PLACES = new Set([
  ...KNOWN_PLACES,
  'lonavala', 'mahabaleshwar', 'ahmedabad', 'kolhapur', 'alibaug', 'satara', 'nashik', 'shirdi', 'surat', 'mumbai',
  'andheri', 'bandra', 'borivali', 'goregaon', 'kandivali', 'ghatkopar', 'dombivli', 'chembur', 'santacruz', 'kharghar',
].filter((p) => p.length >= 5 && p !== 'thane'));

/** Areas inside Mumbai, Thane and Navi Mumbai: a trip between two of them is local. */
export const LOCAL_AREAS = new Set([
  'andheri', 'bandra', 'powai', 'dadar', 'borivali', 'goregaon', 'malad', 'kandivali', 'juhu', 'colaba', 'churchgate',
  'worli', 'chembur', 'ghatkopar', 'mulund', 'kurla', 'santacruz', 'vile parle', 'thane', 'navi mumbai', 'vashi', 'belapur',
  'kharghar', 'panvel', 'kalyan', 'dombivli', 'bhiwandi', 'mira road', 'bhayandar', 'vasai', 'virar', 'lower parel',
  'prabhadevi', 'sion', 'wadala', 'byculla', 'fort', 'nariman point', 'bkc', 'airoli', 'ghansoli', 'nerul', 'sanpada',
  'ulwe', 'dahisar', 'jogeshwari', 'versova', 'lokhandwala', 'marol', 'saki naka', 'vikhroli', 'bhandup', 'matunga',
  'mahim', 'khar', 'parel', 'cst', 'mumbai central', 'home',
]);

/** Words the rules key on, so "cancle", "bookng" and "airprot" are still read. */
const FUZZY_WORDS = [
  'booking', 'cancel', 'cancellation', 'airport', 'return', 'invoice', 'receipt', 'payment', 'vehicle', 'vehicles',
  'passenger', 'passengers', 'outstation', 'hourly', 'feedback', 'complaint', 'available', 'whatsapp', 'corporate',
  'premium', 'confirm', 'confirmed', 'status', 'driver', 'charges', 'price', 'taxi', 'ertiga', 'innova', 'crysta',
];

/** Words that look like a place or keyword but are not - never "corrected". */
const NOT_A_TYPO = new Set([
  'thank', 'thanks', 'share', 'shared', 'where', 'there', 'these', 'those', 'please', 'prize', 'drive', 'arrive',
  'status', 'statue', 'return', 'retune', 'surety', 'sure', 'sunday', 'monday', 'friday', 'saturday', 'january',
  'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'price',
  'prime', 'taxes', 'avail', 'cancer', 'booked', 'books', 'people', 'purpose', 'summer',
]);

function fixToken(w: string, places: string[]): string {
  if (!/^[a-z]+$/.test(w) || NOT_A_TYPO.has(w)) return w;
  // "cabb", "hiii", "pleaseee"
  const squeezed = w.replace(/(.)\1{2,}/g, '$1');
  if (squeezed === 'cabb' || squeezed === 'carr') return squeezed.slice(0, -1);
  if (w.length < 5) return squeezed;
  const pool = new Set([...FUZZY_PLACES, ...places.filter((p) => p.length >= 5 && p !== 'thane')]);
  if (pool.has(w) || FUZZY_WORDS.includes(w)) return w;
  const limit = w.length >= 8 ? 2 : 1;
  let best = w;
  let bestD = limit + 1;
  for (const cand of [...pool, ...FUZZY_WORDS]) {
    if (Math.abs(cand.length - w.length) > limit) continue;
    const dist = editDistance(w, cand);
    if (dist < bestD) { best = cand; bestD = dist; }
  }
  return bestD <= limit ? best : squeezed;
}

/**
 * Synonyms from the knowledge base, then spelling. Kept close to what was
 * typed (case aside) so addresses and names survive for the booking parser.
 */
export function clean(raw: string, kb: Prepared): string {
  let s = ` ${raw.toLowerCase()} `;
  for (const [re, to] of kb.rewrites) s = s.replace(re, to);
  s = s.replace(/[a-z]+/g, (w) => fixToken(w, kb.places));
  // "one side" / "one-side" / "single side" mean one way.
  s = s.replace(/\b(one|single)[\s-]?side\b/g, 'one way').replace(/\bboth[\s-]?sides?\b/g, 'return');
  return s.replace(/\s+/g, ' ').trim();
}

/* ==========================================================================
   Entities
   ========================================================================== */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function readDate(n: string): string | undefined {
  const now = new Date();
  if (/\bday after tomorrow\b/.test(n)) return iso(new Date(now.getTime() + 2 * 864e5));
  if (/\btomorrow\b/.test(n)) return iso(new Date(now.getTime() + 864e5));
  if (/\btoday\b|\btonight\b/.test(n)) return todayLocalIso();
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(n));
  if (wd >= 0) {
    const ahead = (wd - now.getDay() + 7) % 7 || 7;
    return iso(new Date(now.getTime() + ahead * 864e5));
  }
  // "28 september", "28 sep", "28 tarikh"
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})\b/.exec(n);
  if (dm) {
    const day = Number(dm[1]);
    const mi = MONTHS.indexOf(dm[2].slice(0, 3));
    const tarikh = /^(tarikh|tareekh|tarik|date)$/.test(dm[2]);
    if (day >= 1 && day <= 31 && (mi >= 0 || tarikh)) {
      const month = mi >= 0 ? mi : now.getMonth();
      let d = new Date(now.getFullYear(), month, day);
      if (d.getTime() < new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
        d = mi >= 0 ? new Date(now.getFullYear() + 1, month, day) : new Date(now.getFullYear(), now.getMonth() + 1, day);
      }
      return iso(d);
    }
  }
  return undefined;
}

function readTime(n: string): string | undefined {
  const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(n);
  if (!m) return undefined;
  let h = Number(m[1]) % 12;
  if (m[3] === 'pm') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

const VEHICLE_CATEGORY: [RegExp, FareCategory][] = [
  [/\b(premium|luxury)\s+(suv|muv|mpv)\b|\binnova\b|\bcrysta\b|\bcarens\b/, 'PREMIUM_MUV'],
  [/\b(premium|luxury)\s+sedan\b|\bhonda city\b|\bciaz\b|\bpremium\b|\bluxury\b/, 'PREMIUM_SEDAN'],
  // Ertiga and XL6 are SUV / MUV - never premium.
  [/\b(suv|suvs|muv|mpv|ertiga|xl6|xl 6|6[\s-]?seater|7[\s-]?seater)\b/, 'SUV_MUV'],
  [/\b(sedan|sedans|standard|normal|dzire|desire|aura|small car|4[\s-]?seater)\b/, 'STANDARD'],
];

export function readEntities(n: string, raw: string, routes: OutstationRoute[] | null, kb: Prepared): Entities {
  const e: Entities = {};

  // The route. A fixed-fare route is always from Mumbai; "Pune se Mumbai"
  // names it backwards, and the fare list does not price that direction.
  const known = new Set(['mumbai', ...KNOWN_PLACES, ...kb.places, ...LOCAL_AREAS]);
  const pair = /\bfrom ([a-z][a-z ]{1,30}?) to ([a-z][a-z ]{1,30}?)(?=\s(?:one|return|cab|car|taxi|for|on|at|tomorrow|today|and|with|ka|ki|ke|cha|chi|che|fare|rate|price|cost|how|what|go|come|want|need|i|we|please|hai|aahe|ahe|kiti|drop|pickup|jaake|jaun)\b|\s\d|\s*$)/.exec(n)
    // "mumbai to goa fare" - only from a place we know, so "want to change" is no route.
    ?? ((m) => (m && known.has(m[1]) ? m : null))(/\b([a-z]{3,}) to ([a-z]{3,})\b/.exec(n));
  if (pair) { e.from = pair[1].trim(); e.to = pair[2].trim(); }
  const isLocal = (s?: string) => !!s && (LOCAL_AREAS.has(s) || [...LOCAL_AREAS].some((a) => s.endsWith(` ${a}`) || s.startsWith(`${a} `)));
  if (routes?.length) {
    const byName = (s: string) => routes.find((r) => new RegExp(`\\b${escapeRe(r.destination.toLowerCase())}\\b`).test(s));
    if (e.to && e.from && /\bmumbai\b/.test(e.to) && byName(e.from)) { e.route = byName(e.from); e.reversed = true; }
    else e.route = byName(n.replace(/\bmumbai\b/g, ' '));
  }
  if (!e.route) {
    const placeNames = [...new Set([...KNOWN_PLACES, ...kb.places])].filter((p) => p !== 'mumbai');
    // A place named outright, or the far end of a route from somewhere we know
    // ("Mumbai to Indore") - never a word that merely follows "to".
    const hit = placeNames.find((p) => new RegExp(`\\b${escapeRe(p)}\\b`).test(n))
      ?? (e.to && e.from && known.has(e.from) && !isLocal(e.to) && !/\b(airport|mumbai|the|my|me|you|book|go|come|home)\b/.test(e.to) && e.to.split(' ').length <= 2
        ? e.to : undefined);
    if (hit) e.place = hit.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (/\b(return|round ?trips?|come back|coming back|both ways|two ?way|2 ?way|up ?and ?down|and back|wapas)\b/.test(n)) e.leg = 'RETURN';
  else if (/\bone[\s-]?way\b|\bsingle (trip|journey)\b|\bdrop only\b|\bonly (go|going)\b|\bsirf\b.*\bgo\b/.test(n)) e.leg = 'ONE_WAY';
  if (/\breturn no\b|\bno return\b|\breturn (not|nahi) (want|needed)\b|\breturn not want\b/.test(n)) e.leg = 'ONE_WAY';

  const hrs = /\b(\d{1,2})\s*(?:hours?|hrs?|h)\b/.exec(n);
  if (hrs) e.hours = Number(hrs[1]);
  else if (/\bfull day\b|\bpura din\b|\bpoora din\b/.test(n)) e.hours = 8;
  else if (/\bhalf day\b|\baadha din\b/.test(n)) e.hours = 4;

  if (/\bairport\b|\bflight\b|\bterminal\b|\bt1\b|\bt2\b/.test(n)) {
    e.kind = 'AIRPORT';
    if (/\bto (the )?airport\b|\bairport drop\b|\bdrop (me )?(at|to) (the )?airport\b|\bcatch (a |my |the )?flight\b|\bairport (go|to go)\b|\bgo (to )?(the )?airport\b|\bto airport\b/.test(n)) e.airportWay = 'TO';
    else if (/\bfrom (the )?airport\b|\bairport pick ?up\b|\bpick ?(me )?up from (the )?airport\b|\blanding\b|\barriv(al|ing)\b|\bairport come\b/.test(n)) e.airportWay = 'FROM';
  } else if (/\bhourly\b|\bper hour\b|\bpackage\b/.test(n) || e.hours) e.kind = 'HOURLY';
  else if (isLocal(e.from) && isLocal(e.to)) e.kind = 'LOCAL';
  else if (e.route || e.place || /\boutstation\b|\boutside mumbai\b/.test(n)) e.kind = 'OUTSTATION';
  else if (/\blocal\b|\bwithin mumbai\b|\bin mumbai\b|\bcity ride\b|\bmumbai (city|ke andar|madhye)\b/.test(n)) e.kind = 'LOCAL';

  const pax = /\b(\d{1,2})\s*(?:people|persons?|passengers?|pax|adults|of us|members|seater|guests)\b/.exec(n)
    ?? /\bwe are (\d{1,2})\b/.exec(n) ?? /\bcan (\d{1,2}) (?:people|persons?|passengers?)\b/.exec(n);
  if (pax) e.pax = Number(pax[1]);

  e.date = readDate(n);
  e.time = readTime(n);

  for (const [re, cat] of [...kb.vehicleWords, ...VEHICLE_CATEGORY]) if (re.test(n)) { e.category = cat; break; }
  const model = VEHICLES.find((v) => new RegExp(`\\b${escapeRe(v.name.toLowerCase().replace(/^(toyota|hyundai|kia|force|maruti)\s+/, ''))}\\b`).test(n));
  if (model) e.model = model.slug;

  const trip = /\b(GTT-[A-Z]{2,4}-\d{4}-\d{3,5})\b/i.exec(raw);
  if (trip) e.tripId = trip[1].toUpperCase();
  const digits = raw.replace(/GTT-[A-Z]{2,4}-\d{4}-\d{3,5}/gi, ' ').match(/(?:^|\D)((?:\+?91[\s-]?)?[6-9]\d{9}|\d{4})(?=\D|$)/);
  if (digits) e.digits = digits[1].replace(/\D/g, '').slice(-4);

  e.fareWord = /\b(fare|fares|rate|rates|price|prices|pricing|cost|costs|charges?|tariff|fee|amount|how much|kiraya|bhada|bhade)\b/.test(n)
    || !!kb.fareWords?.test(n);
  e.bookWord = /\b(book|booking|hire|rent|reserve|need|want|looking for|arrange|require)\b/.test(n);
  return e;
}

/* ==========================================================================
   Intent
   ========================================================================== */

const R = (re: RegExp, intent: Intent) => [re, intent] as const;

/** Ordered: the first that matches wins. Each is a way of asking, not a sentence. */
const RULES: (readonly [RegExp, Intent])[] = [
  R(/\b(complain|complaint|complaints|behaved badly|misbehav|rude|dirty|not clean|clean no|was late|came late|late (tha|thi|aaya|aayi|hua)|report (a )?problem|service issue|bad (service|experience|driver))\b/, 'COMPLAINT'),
  R(/\b(suggestion|suggest)\b/, 'SUGGESTION'),
  R(/\b(rate|rating|ratings|stars?) (to |for |the |my )?driver\b|\bdriver (ko |la )?(rating|stars?)\b/, 'DRIVER_RATING'),
  R(/\b(rate|rating) (to |for |the |my )?(cab|car|vehicle)\b/, 'CAB_RATING'),
  R(/\b(rate|rating) (to |for |the |my )?service\b/, 'SERVICE_RATING'),
  R(/\b(feedback|review|rating|ratings)\b/, 'FEEDBACK'),
  R(/\b(cancel|cancellation|cancelled|cancelling)\b/, 'BOOKING_CANCEL'),
  R(/\b(change|modify|reschedule|postpone|prepone|update|edit)\b.*\b(booking|pickup|drop|date|time|passengers?|trip|cab)\b|\b(booking|pickup|drop|date|time|trip)\b.*\b(change|modify|reschedule)\b/, 'BOOKING_MODIFY'),
  R(/\b(whats ?app|wa)\b.*\b(send|share|bhej|bhejo|bhejna|bhej do|pathva|forward)\b|\b(send|share|bhej\w*)\b.*\b(whats ?app)\b/, 'WHATSAPP_REQUEST'),
  R(/\b(my|meri|mera|mazi|majhi)\b.*\bdriver\b|\bdriver\b.*\b(name|number|contact|mobile|details?|assign\w*|where|who)\b|\bwho\b.*\bdriver\b|\bdriver\b.*\b(information|info)\b/, 'DRIVER_INFORMATION'),
  R(/\b(car|cab|vehicle|gaadi|gadi) (number|no)\b|\bwhich (car|cab|vehicle)\b.*\b(come|arrive|coming|assigned)\b|\bvehicle assign\w*|\bassigned (car|vehicle|cab)\b/, 'VEHICLE_ASSIGNMENT'),
  R(/\b(booking|trip|enquiry|inquiry)\b.*\b(status|confirm|confirmed|update)\b|\b(status|where)\b.*\b(my|meri|mera)\b.*\b(booking|trip|enquiry)\b|\bmy booking\b|\bbooking status\b|\bmeri booking\b|\btrack\b/, 'BOOKING_STATUS'),
  R(/\b(invoice|invoices|receipt|bill|billing|gst bill)\b/, 'INVOICE_INFORMATION'),
  R(/\b(pay|payment|payments|upi|gpay|google pay|phonepe|paytm|cash|card|credit card|debit card|net banking)\b/, 'PAYMENT_INFORMATION'),
  R(/\b(corporate|company|companies|employee|employees|office staff|staff transport|monthly|regular basis|regularly)\b/, 'CORPORATE_BOOKING'),
  R(/\b(bulk|several (cars|cabs|vehicles)|many (cars|cabs)|\d+ (cars|cabs|vehicles))\b/, 'BULK_BOOKING'),
  R(/\btoll\b/, 'TOLL_INFORMATION'),
  R(/\b(hidden|extra) (charge|charges|cost|costs|fee|fees)\b|\bany extra\b|\bextra charge\b|\bextra fare\b/, 'EXTRA_CHARGES'),
  R(/\b(include|included|includes|inclusive|breakup|break up|breakdown|break down)\b/, 'FARE_BREAKDOWN'),
  R(/\b(another|one more|second|multiple|two|2|extra|more) (pickups?|drops?|stops?|locations?|places)\b|\bstops?\b.*\b(way|between)\b|\bmultiple stops\b|\bek aur (pickup|drop)\b|\bdo jagah\b/, 'MULTI_STOP'),
  R(/\b(other|another|different) (destination|place|city|location|jagah)\b|\bsomewhere else\b|\bnot listed\b|\bnot in (the )?list\b|\blist (mein|madhe) (no|nahi)\b|\bcustom route\b|\bmy own destination\b|\bdusri jagah\b|\bkisi (aur|and) jagah\b|\b(some|any) other (place|city)\b|\bother location\b/, 'CUSTOM_ROUTE'),
];

const HELP_RE = /\b(help|support|customer care|helpline|contact|phone number|mobile number|your number|number what|email|e-mail|address|office|located|location of (your|the) office|call you|reach you|who are you|speak to|talk to|baat)\b/;
const SERVICES_RE = /\b(services?|options|offer|provide|what can i book|what do you (do|have)|this website|type of (cab|booking)s?|kind of (cab|booking)s?)\b/;
const VEHICLE_RE = /\b(vehicles?|cars|cabs|fleet|models?|gaadi|cars available|which car|what car|kind of car|type of car)\b/;
const AVAILABLE_RE = /\b(available|availability|provide|do you have|have you got|do you do|offer)\b|\?\s*$/;
const CAPACITY_RE = /\b(how many (people|persons|passengers|seats)|how many can|capacity|seats?|seater|fit)\b|\bcan \d{1,2} (people|persons|passengers)\b/;

const WORDS = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
const STOP = new Set(['i', 'a', 'an', 'the', 'is', 'are', 'to', 'for', 'of', 'me', 'my', 'we', 'you', 'your', 'do', 'can', 'please', 'hai', 'hain', 'ka', 'ki', 'ke', 'se', 'aahe', 'ahe', 'la', 'what', 'how']);
const wordSet = (s: string) => new Set(WORDS(s).filter((w) => !STOP.has(w)));

/** Closest example question the office has taught it. */
function byExample(n: string, kb: Prepared): { intent: Intent; score: number } | null {
  const mine = wordSet(n);
  if (!mine.size || !kb.examples.length) return null;
  let best: { intent: Intent; score: number } | null = null;
  for (const ex of kb.examples) {
    let common = 0;
    for (const w of mine) if (ex.words.has(w)) common++;
    if (!common) continue;
    const score = common / Math.sqrt(mine.size * ex.words.size);
    if (!best || score > best.score) best = { intent: ex.intent, score };
  }
  return best;
}

const YES = /^(yes|yeah|yep|yup|ya|yah|ok|okay|okk|sure|haan|han|ha|haa|ji|ji haan|hoy|ho|kara|confirm|go ahead|please do|yes please|of course|done|chalega|thik hai|theek hai|right|correct)$/;
const NO = /^(no|nope|nah|not now|nahi|nahin|nako|nai|na|no thanks|not really|later|baad mein|nantar)$/;

export function understand(raw: string, routes: OutstationRoute[] | null, kb: Prepared = EMPTY): Understanding {
  const lang = detectLang(raw);
  const cleaned = clean(raw, kb);
  const n = normalise(cleaned);
  const e = readEntities(n, raw, routes, kb);
  const out = (intent: Intent, confidence: number): Understanding => ({ lang, text: n, cleaned, intent, confidence, entities: e });
  const bare = n.replace(/[.!?]+$/g, '').trim();

  if (outOfScope(n)) return out('OUT_OF_SCOPE', 0.9);
  if (YES.test(bare)) return out('AFFIRM', 0.95);
  if (NO.test(bare)) return out('DENY', 0.95);
  if (/^(hi+|hey+|hello+|hlo|helo|namaste|namaskar|good (morning|afternoon|evening|night))( (sir|madam|mam|ji|there|team))?$/.test(bare)) return out('GREETING', 0.95);
  if (/^(ok )?(thanks?|thank you|thankyou|thx|ty|thanks a lot|thank you so much|thank you bhai|thanks bhai)( (a lot|so much|bhai|ji|sir))?$/.test(bare)) return out('THANKS', 0.95);
  if (/^(bye|goodbye|good bye|see you|tata|chalo bye)$/.test(bare)) return out('GOODBYE', 0.95);

  // A Trip ID on its own, or with "status", is a lookup.
  if (e.tripId && !/\b(cancel|change|modify|feedback|complaint)\b/.test(n)) return out('BOOKING_STATUS', 0.95);

  for (const [re, intent] of RULES) if (re.test(n)) return out(intent, 0.9);

  // "How much for Pune", "Nashik ka rate", "Mumbai to Nashik fare".
  if (e.fareWord) return out('FARE_INQUIRY', 0.9);

  if (CAPACITY_RE.test(n) && !e.bookWord) return out('VEHICLE_CAPACITY', 0.85);
  if (/^(we are|hum|amhi)\b/.test(bare) && e.pax) return out('PASSENGER_INFORMATION', 0.85);

  // The kinds of trip. With a booking word (or a route and nothing else to
  // say) this is a booking the widget starts; without one it is a question
  // about the service ("airport cab milti hai?").
  if (e.kind === 'AIRPORT') return out(e.airportWay === 'TO' ? 'AIRPORT_TO' : e.airportWay === 'FROM' ? 'AIRPORT_FROM' : 'AIRPORT_BOOKING', 0.85);
  if (e.kind === 'HOURLY') return out('HOURLY_BOOKING', 0.85);
  if (e.leg === 'RETURN' && (e.route || e.place || e.bookWord || /\b(cab|car|taxi)\b/.test(n))) return out('RETURN_BOOKING', 0.85);
  if (e.leg === 'ONE_WAY' && (e.route || e.place || e.bookWord || /\b(cab|car|taxi)\b/.test(n))) return out('ONE_WAY_BOOKING', 0.85);
  if (e.kind === 'OUTSTATION') {
    // "Pune?", "Mumbai to Pune", "bhai Pune ka kya scene hai" - a place, and
    // nothing that says what about it. The reply asks.
    const says = e.bookWord || e.leg || e.date || e.time || e.pax
      || /\b(cab|car|taxi|go|come|trip|travel|drop|pickup|visit|tour)\b/.test(n);
    if (!says) return out('PLACE_ONLY', 0.8);
    return out('OUTSTATION_BOOKING', 0.85);
  }
  if (e.kind === 'LOCAL') return out('LOCAL_BOOKING', 0.85);

  if (e.model || e.category) return out(e.category === 'SUV_MUV' ? 'SUV_MUV' : e.category === 'STANDARD' ? 'STANDARD_VEHICLE' : e.category ? 'PREMIUM_VEHICLE' : 'VEHICLE_INFORMATION', 0.8);
  if (VEHICLE_RE.test(n) && !e.bookWord) return out('VEHICLE_INFORMATION', 0.8);
  if (/\bpick ?up\b/.test(n) && !e.bookWord) return out('PICKUP_INFORMATION', 0.75);
  if (/\bdrop\b/.test(n) && !e.bookWord) return out('DROP_INFORMATION', 0.75);

  if (e.bookWord && /\b(cab|car|taxi|vehicle|ride|gaadi|booking|book)\b/.test(n)) return out('BOOKING_CREATE', 0.85);
  if ((e.date || e.time || /\b(morning|evening|night|afternoon)\b/.test(n)) && /\b(cab|car|taxi|book)\b/.test(n)) {
    return out(e.date ? 'DATE_SELECTION' : 'TIME_SELECTION', 0.75);
  }
  if (SERVICES_RE.test(n)) return out('SERVICE_INFORMATION', 0.75);
  if (HELP_RE.test(n)) return out(/\bhelp\b/.test(n) && !/\b(number|contact|email|address|call)\b/.test(n) ? 'HELP' : 'CONTACT_SUPPORT', 0.75);
  if (/\b(trip|journey) (is )?(completed|complete|over|done|finished)\b/.test(n)) return out('TRIP_COMPLETED', 0.8);
  if (/\b(enquiry|inquiry|call ?back|call me)\b/.test(n)) return out('INQUIRY_CREATE', 0.75);

  // The office's example questions, for everything the rules do not cover.
  const ex = byExample(n, kb);
  if (ex && ex.score >= 0.55) return out(ex.intent, Math.min(0.85, ex.score));

  void AVAILABLE_RE;
  return out('UNKNOWN_INTENT', ex?.score ?? 0);
}

/** The office's wording for a static answer, when it has written one. */
export function templateFor(kb: Prepared, intent: Intent, lang: Lang): string | null {
  const t = kb.templates.get(intent);
  if (!t) return null;
  return t[lang] ?? (lang === 'hi-Latn' ? t.hi : lang === 'mr-Latn' ? t.mr : undefined) ?? t.en ?? null;
}

export type { Prepared as PreparedKnowledge };
export { EMPTY as NO_KNOWLEDGE };
