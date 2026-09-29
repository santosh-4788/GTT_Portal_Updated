/**
 * Booking a cab through the assistant.
 *
 * "I want to book a sedan" used to fall through to the FAQ matcher, which
 * offered "How do I book a vehicle?" - an answer about booking instead of a
 * booking. This is the conversation that actually books:
 *
 *   what kind of trip -> (route, one way / return / package / airport)
 *   -> pickup, drop, date, time, (return date and time), passengers
 *   -> which vehicle, priced - with the group size known, so a car too small
 *      for it is marked - -> name, mobile, email, notes
 *   -> summary -> "Are you sure?" -> Confirm -> Trip ID
 *
 * Anything the customer has already said is kept and never asked again.
 *
 * One way and return are two different conversations, not one with an
 * optional extra. A one-way trip is shown one-way fares and is never asked
 * about coming back; a return trip is shown return fares and is asked the
 * return date and time. Switching between them from the summary clears the
 * car, so a fare for one can never ride along on the other.
 *
 * An airport transfer asks its direction first - to the airport or from it -
 * and only then which airport, because the direction decides which end the
 * airport is.
 *
 * Messages can be in English, Hindi or Marathi (assistantLang.ts): they are
 * normalised before they are read, and every question is asked back in the
 * customer's language.
 *
 * Everything it offers comes from the portal itself: the vehicles from the
 * catalogue, fixed outstation fares from the admin's fare master, local /
 * airport / hourly figures from the public rate card. Nothing is sent until the
 * customer presses Confirm, and the server prices a fixed fare again from the
 * master rather than trusting this file.
 *
 * Pure logic - no React. The widget (Assistant.tsx) keeps the state and draws it.
 */
import { VEHICLES, type CatalogVehicle } from './catalog';
import { estimateFor, useRates } from './kit';
import {
  CATEGORY_META, fareCategoryOf, fareOf, matchRoute, routeLabel, rupees,
  type Leg, type OutstationRoute,
} from './outstation';
import { AIRPORTS, AIRPORT_DIRECTION, AIRPORT_FROM, AIRPORT_TO, AIRPORT_WAYS, type AirportWay } from './enquiryCategories';
import { dmy, todayLocalIso } from '../lib/format';
import { normalise, t, type Lang } from './assistantLang';

export type RateBook = ReturnType<typeof useRates>;
export type Kind = 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'HOURLY';

export const KIND_LABEL: Record<Kind, string> = {
  LOCAL: 'Local (within Mumbai)',
  AIRPORT: 'Airport transfer',
  OUTSTATION: 'Outstation',
  HOURLY: 'Hourly rental',
};

export const HOURLY = [
  { key: '4H40', label: '4 hrs / 40 km', hours: 4, km: 40 },
  { key: '8H80', label: '8 hrs / 80 km', hours: 8, km: 80 },
  { key: '12H120', label: '12 hrs / 120 km', hours: 12, km: 120 },
];

/** Vehicle families a customer names, and the catalogue categories they mean. */
const FAMILIES: { key: string; words: RegExp; categories: string[]; label: string }[] = [
  { key: 'premium-sedan', words: /\b(premium|luxury)\s+sedan\b/, categories: ['Premium sedan'], label: 'premium sedan' },
  { key: 'premium-suv', words: /\b(premium|luxury)\s+(suv|muv|mpv)\b/, categories: ['Premium SUV'], label: 'premium SUV / MUV' },
  { key: 'sedan', words: /\bsedans?\b/, categories: ['Sedan', 'Premium sedan'], label: 'sedan' },
  { key: 'suv', words: /\b(suv|suvs|muv|mpv|7[\s-]?seater|6[\s-]?seater)\b/, categories: ['SUV', 'Premium SUV'], label: 'SUV / MUV' },
  { key: 'group', words: /\b(tempo|traveller|traveler|urbania|mini ?bus|bus|coach|12[\s-]?seater|17[\s-]?seater)\b/, categories: ['Group', 'Coach'], label: 'group vehicle' },
  { key: 'premium', words: /\b(premium|luxury)\b/, categories: ['Premium sedan', 'Premium SUV'], label: 'premium car' },
];

export interface Draft {
  kind?: Kind;
  family?: string;
  familyLabel?: string;
  /** Outstation: a fixed-fare route key, or 'other'. */
  routeKey?: string;
  otherDestination?: string;
  leg?: Leg;
  hourly?: string;
  airportWay?: AirportWay;
  airport?: string;
  vehicleSlug?: string;
  pickup?: string;
  drop?: string;
  date?: string;
  time?: string;
  returnDate?: string;
  /** Return trips only: when the car starts back. */
  returnTime?: string;
  pax?: number;
  name?: string;
  mobile?: string;
  email?: string;
  noEmail?: boolean;
  notes?: string;
  /** Set once the customer has seen the summary, so a changed field goes back there. */
  reviewed?: boolean;
  /** A planned multi-day trip: days on the road and the one-way distance. */
  days?: number;
  km?: number;
  /** What the trip planner agreed with the customer, for the office. */
  planNote?: string;
}

export type Step =
  | 'kind' | 'route' | 'otherDestination' | 'leg' | 'hourly' | 'airportWay' | 'airport' | 'vehicle'
  | 'pickup' | 'drop' | 'date' | 'time' | 'returnDate' | 'returnTime' | 'pax'
  | 'name' | 'mobile' | 'email' | 'notes' | 'summary';

/* ==========================================================================
   Understanding the first message
   ========================================================================== */

// "go" and "come" because "Airport jaana hai" (normalised to "airport go")
// is a booking in all but word.
const BOOK_WORDS = /\b(book|booking|hire|rent|reserve|need|want|looking for|get me|arrange|require|go|come|drop me|pick me)\b/;
const CAB_WORDS = /\b(cab|car|taxi|vehicle|ride|drop|pickup|pick up|transfer)\b/;

/**
 * Is this someone asking to book, and what did they already say? `null` when
 * it is a question ("how do I book?", "what does a sedan cost?") - those still
 * go to the answers.
 */
export function bookingIntent(raw: string, routes: OutstationRoute[] | null): Draft | null {
  // Hindi and Marathi are read through the same rules once normalised.
  const text = ` ${normalise(raw).replace(/[^\w\s/:-]/g, ' ').replace(/\s+/g, ' ')} `;
  if (/^\s*(how|what|which|is|are|can you tell|do you|does|why|when)\b/.test(text) && !/\b(i want|i need|book me)\b/.test(text)) return null;

  const family = FAMILIES.find((f) => f.words.test(text));
  const model = VEHICLES.find((v) => new RegExp(`\\b${v.name.toLowerCase().replace(/^(toyota|hyundai|kia|force|maruti)\s+/, '')}\\b`).test(text));
  // "go" / "come" alone only count with an airport or a from-to route, so
  // "can the car come at 5?" stays a question.
  const onlyMotion = !/\b(book|booking|hire|rent|reserve|need|want|looking for|get me|arrange|require|drop me|pick me)\b/.test(text);
  const wantsBooking = BOOK_WORDS.test(text)
    && (!onlyMotion || /\bairport\b|\bfrom [a-z]+ to [a-z]+/.test(text))
    && (CAB_WORDS.test(text) || !!family || !!model || /\b(airport|outstation|local|hourly|trip)\b/.test(text) || /\bfrom [a-z]+ to [a-z]+/.test(text));
  if (!wantsBooking) return null;

  const d: Draft = {};
  if (model) d.vehicleSlug = model.slug;
  if (family) { d.family = family.key; d.familyLabel = family.label; }

  // what kind of trip
  const route = routes ? matchRoute(routes, text.replace(/\bmumbai\b/g, '')) : undefined;
  if (/\bairport\b|\bflight\b|\bt1\b|\bt2\b/.test(text)) d.kind = 'AIRPORT';
  else if (/\b(hourly|per hour|hours?\b.*\bkm|full day|half day|4 ?h|8 ?h|12 ?h)\b|\b\d{1,2} ?(?:hours?|hrs?)\b/.test(text)) d.kind = 'HOURLY';
  else if (route || /\boutstation\b/.test(text)) d.kind = 'OUTSTATION';
  else if (/\blocal\b|\bwithin mumbai\b|\bin mumbai\b/.test(text)) d.kind = 'LOCAL';

  if (route) d.routeKey = route.key;
  // "one-way" arrives with its hyphen: the old /one ?way/ never matched it,
  // so "book a one-way cab to Pune" was asked "one way or return?" again.
  if (/\b(return|round ?trips?|come back|coming back|both ways|two ?way|2 ?way|up ?and ?down)\b/.test(text)) d.leg = 'RETURN';
  else if (/\bone[\s-]?way\b|\bsingle (trip|journey)\b|\bdrop only\b/.test(text)) d.leg = 'ONE_WAY';

  // "8 hours", "8 hrs", "8h", "full day": the package. Any other length
  // (6 hours) is asked, with the three packages offered.
  const pkg = /\b12 ?(?:h|hrs?|hours?)\b/.test(text) ? '12H120'
    : /\b8 ?(?:h|hrs?|hours?)\b|full day/.test(text) ? '8H80'
      : /\b4 ?(?:h|hrs?|hours?)\b|half day/.test(text) ? '4H40' : undefined;
  if (d.kind === 'HOURLY' && pkg) d.hourly = pkg;

  // "from A to B". On an airport trip, whichever end is the airport also says
  // which way it goes, and the other end is the address.
  const pair = /\bfrom ([a-z][a-z ]{1,40}?) to ([a-z][a-z ]{1,40}?)(?= (?:one|return|cab|car|taxi|for|on|at|tomorrow|today|with|i|we|want|need|book|by|in|go|come|hai|hain|aahe|ahe|drop|pickup|please|morning|evening|night)\b| \d|\s*$)/.exec(text);
  const isAirport = (s: string) => /\b(airport|terminal|t1|t2)\b/.test(s);
  if (d.kind === 'AIRPORT') {
    if (/\bto (the )?(airport|terminal)\b|\bairport drop\b|\bdrop (me )?(at|to) (the )?airport\b|\bcatch (a |my |the )?flight\b|\bairport go\b|\bgo (to )?(the )?airport\b/.test(text)) d.airportWay = AIRPORT_TO;
    else if (/\bfrom (the )?(airport|terminal)\b|\bairport pick ?up\b|\bpick ?up (me )?from (the )?airport\b|\blanding\b|\barriv(al|ing)\b|\bairport come\b/.test(text)) d.airportWay = AIRPORT_FROM;
    if (pair) {
      if (isAirport(pair[2]) && !isAirport(pair[1])) d.pickup = titleCase(pair[1].trim());
      else if (isAirport(pair[1]) && !isAirport(pair[2])) d.drop = titleCase(pair[2].trim());
    } else if (d.airportWay === AIRPORT_TO) {
      // "Airport jaana hai Powai se" - the one place named is where we start.
      const start = /\bfrom ([a-z]+(?: (?!tomorrow|today|morning|evening|night|go|hai)[a-z]+)?)\b/.exec(text);
      if (start && !isAirport(start[1])) d.pickup = titleCase(start[1].trim());
    }
  } else if (pair) {
    d.pickup = titleCase(pair[1].trim());
    // A trip that names its way (one way / return) and goes somewhere with no
    // fixed fare is still an outstation trip - it is quoted by the office.
    if (!d.kind && d.leg) d.kind = 'OUTSTATION';
    if (d.kind === 'OUTSTATION' && !d.routeKey) {
      d.routeKey = 'other';
      d.otherDestination = titleCase(pair[2].trim());
    }
  }
  if (d.leg === 'ONE_WAY') { d.returnDate = undefined; d.returnTime = undefined; }

  const pax = /\b(\d{1,2}) (people|persons|person|passengers|pax|adults|of us|log|members)\b/.exec(text);
  if (pax) d.pax = Number(pax[1]);

  if (/\bday after tomorrow\b/.test(text)) d.date = addDays(2);
  else if (/\btomorrow\b/.test(text)) d.date = addDays(1);
  else if (/\btoday\b/.test(text)) d.date = todayLocalIso();
  // "kal subah 6 baje" arrives as "tomorrow 6:00 am".
  const at = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/.exec(text);
  if (at) d.time = parseTime(at[0]) ?? undefined;

  return d;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
function addDays(n: number): string {
  const d = new Date(Date.now() + n * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ==========================================================================
   What to ask next
   ========================================================================== */

export function nextStep(d: Draft): Step {
  if (!d.kind) return 'kind';
  if (d.kind === 'OUTSTATION') {
    if (!d.routeKey) return 'route';
    if (d.routeKey === 'other' && !d.otherDestination) return 'otherDestination';
    if (!d.leg) return 'leg';
  }
  if (d.kind === 'HOURLY' && !d.hourly) return 'hourly';
  if (d.kind === 'AIRPORT') {
    if (!d.airportWay) return 'airportWay';
    if (!d.airport) return 'airport';
  }
  // Going TO the airport the car starts at an address; coming FROM it, the
  // car ends at one. The airport itself is the other end.
  if (!(d.kind === 'AIRPORT' && d.airportWay === AIRPORT_FROM) && !d.pickup) return 'pickup';
  if (d.kind !== 'HOURLY' && !(d.kind === 'AIRPORT' && d.airportWay === AIRPORT_TO) && !d.drop) return 'drop';
  if (!d.date) return 'date';
  if (!d.time) return 'time';
  if (d.kind === 'OUTSTATION' && d.leg === 'RETURN') {
    if (!d.returnDate) return 'returnDate';
    if (!d.returnTime) return 'returnTime';
  }
  if (!d.pax) return 'pax';
  // The car last: by now the group size is known, and every option is priced
  // for exactly this trip.
  if (!d.vehicleSlug) return 'vehicle';
  if (!d.name) return 'name';
  if (!d.mobile) return 'mobile';
  if (!d.email && !d.noEmail) return 'email';
  if (d.notes === undefined) return 'notes';
  return 'summary';
}

/** The question for a step, and the quick answers offered with it. */
/**
 * The question for a step, and the quick answers offered with it. Chips are
 * English values - the widget draws them in the customer's language.
 */
export function prompt(step: Step, d: Draft, routes: OutstationRoute[], lang: Lang = 'en'): { text: string; chips?: string[] } {
  const route = routes.find((r) => r.key === d.routeKey);
  switch (step) {
    case 'kind':
      return { text: t(lang, 'kind'), chips: Object.values(KIND_LABEL) };
    case 'route':
      return { text: t(lang, 'route'), chips: [...routes.map((r) => r.destination), 'Other'] };
    case 'otherDestination':
      return { text: t(lang, 'otherDestination') };
    case 'leg':
      return { text: t(lang, 'leg', { route: route ? routeLabel(route) : d.otherDestination ? `Mumbai → ${d.otherDestination}` : 'Outstation' }), chips: ['One way', 'Return'] };
    case 'hourly':
      return { text: t(lang, 'hourly'), chips: HOURLY.map((h) => h.label) };
    case 'airportWay':
      return { text: t(lang, 'airportWay'), chips: [...AIRPORT_WAYS] };
    case 'airport':
      return { text: t(lang, d.airportWay === AIRPORT_FROM ? 'airport.from' : 'airport.to'), chips: AIRPORTS };
    case 'vehicle':
      return { text: '' };
    case 'pickup':
      return { text: t(lang, d.kind === 'AIRPORT' ? 'pickup.airport' : 'pickup') };
    case 'drop': {
      if (d.kind === 'AIRPORT') return { text: t(lang, 'drop.airport') };
      const city = route?.destination ?? d.otherDestination;
      return city
        ? { text: t(lang, 'drop.city', { city }), chips: [`${city} (address later)`] }
        : { text: t(lang, 'drop') };
    }
    case 'date':
      return { text: t(lang, d.leg === 'RETURN' && d.kind === 'OUTSTATION' ? 'date.return' : 'date'), chips: ['Today', 'Tomorrow'] };
    case 'time':
      return { text: t(lang, d.kind === 'AIRPORT' && d.airportWay === AIRPORT_FROM ? 'time.landing' : 'time') };
    case 'returnDate':
      return { text: t(lang, 'returnDate') };
    case 'returnTime':
      return { text: t(lang, 'returnTime') };
    case 'pax':
      return { text: t(lang, 'pax'), chips: ['1', '2', '3', '4', '5', '6'] };
    case 'name':
      return { text: t(lang, 'name') };
    case 'mobile':
      return { text: t(lang, 'mobile') };
    case 'email':
      return { text: t(lang, 'email'), chips: ["I don't have an email ID"] };
    case 'notes':
      return { text: t(lang, 'notes'), chips: ['No, nothing else'] };
    case 'summary':
      return { text: '' };
  }
}

/**
 * What the assistant says it understood, before the first question - so a
 * customer who asked for a one-way cab reads "one-way" back, and one who asked
 * for a return reads "return", before anything is priced.
 */
export function acknowledge(d: Draft, routes: OutstationRoute[], lang: Lang = 'en'): string {
  const route = routes.find((r) => r.key === d.routeKey);
  const to = route?.destination ?? d.otherDestination;
  const from = d.pickup || (to ? 'Mumbai' : '');
  const where = to ? t(lang, from ? 'route.pair' : 'route.to', { from, to }) : '';
  if (d.kind === 'OUTSTATION' || d.leg) {
    return t(lang, d.leg === 'RETURN' ? 'ack.return' : d.leg === 'ONE_WAY' ? 'ack.oneWay' : 'ack.outstation', { route: where });
  }
  if (d.kind === 'AIRPORT') {
    return t(lang, d.airportWay === AIRPORT_TO ? 'ack.airportTo' : d.airportWay === AIRPORT_FROM ? 'ack.airportFrom' : 'ack.airport');
  }
  return t(lang, 'ack.generic', { fam: d.familyLabel ? ` ${d.familyLabel}` : '' });
}

/** Which input the chat bar should become for a step. */
export function inputFor(step: Step | null): { type: string; placeholder: string } {
  switch (step) {
    case 'date': case 'returnDate': return { type: 'date', placeholder: '' };
    case 'time': case 'returnTime': return { type: 'time', placeholder: '' };
    case 'pax': return { type: 'number', placeholder: 'Number of passengers' };
    case 'mobile': return { type: 'tel', placeholder: '10-digit mobile' };
    case 'email': return { type: 'email', placeholder: 'you@example.com' };
    case 'name': return { type: 'text', placeholder: 'Your full name' };
    case 'pickup': return { type: 'text', placeholder: 'Pickup address' };
    case 'drop': return { type: 'text', placeholder: 'Drop address' };
    case 'otherDestination': return { type: 'text', placeholder: 'e.g. Goa, Nagpur' };
    case 'notes': return { type: 'text', placeholder: 'Anything else (optional)' };
    default: return { type: 'text', placeholder: 'Ask about rates, routes, vehicles…' };
  }
}

/**
 * Apply an answer to the step it answers. Returns the updated draft, or an
 * error to say back to the customer when the answer will not do.
 */
export function answer(
  step: Step, raw: string, d: Draft, routes: OutstationRoute[], lang: Lang = 'en',
): { draft?: Draft; error?: string } {
  const v = raw.trim();
  // Matched against the normalised text, so "kal", "उद्या" and "Tomorrow"
  // are the same answer; free text (addresses, names, notes) is kept as typed.
  const low = normalise(v);
  const err = (key: Parameters<typeof t>[1]) => ({ error: t(lang, key) });
  const next = { ...d };
  switch (step) {
    case 'kind': {
      const k = (Object.keys(KIND_LABEL) as Kind[]).find((x) =>
        low === KIND_LABEL[x].toLowerCase() || low.includes(x.toLowerCase())
        || (x === 'LOCAL' && /within|city/.test(low)) || (x === 'HOURLY' && /\bhours?\b/.test(low)));
      if (!k) return err('err.kind');
      next.kind = k;
      return { draft: next };
    }
    case 'route': {
      if (low === 'other') { next.routeKey = 'other'; return { draft: next }; }
      const r = routes.find((x) => x.destination.toLowerCase() === low) ?? matchRoute(routes, low);
      if (r) { next.routeKey = r.key; return { draft: next }; }
      next.routeKey = 'other'; next.otherDestination = titleCase(v);
      return { draft: next };
    }
    case 'otherDestination':
      if (v.length < 2) return err('err.place');
      next.otherDestination = titleCase(v);
      return { draft: next };
    case 'leg':
      if (/return|round|back|two ?way/.test(low)) next.leg = 'RETURN';
      else if (/one|single/.test(low)) {
        next.leg = 'ONE_WAY';
        // Nothing about coming back survives on a one-way trip.
        next.returnDate = undefined;
        next.returnTime = undefined;
      } else return err('err.leg');
      return { draft: next };
    case 'hourly': {
      const h = HOURLY.find((x) => low.startsWith(String(x.hours)) || low === x.label.toLowerCase());
      if (!h) return err('err.hourly');
      next.hourly = h.key;
      return { draft: next };
    }
    case 'airportWay': {
      const w = AIRPORT_WAYS.find((x) => x.toLowerCase() === low)
        ?? (/\bto (the )?airport\b|\bairport go\b|\bgo\b|\bdrop\b|\bcatch|\bdepart|\bflying\b|^to\b/.test(low) ? AIRPORT_TO
          : /\bfrom (the )?airport\b|\bairport come\b|\bcome\b|\bpick|\bland|\barriv|^from\b/.test(low) ? AIRPORT_FROM
            : undefined);
      if (!w) return err('err.airportWay');
      if (w !== d.airportWay) {
        // The other direction swaps which end is the address.
        next.pickup = undefined;
        next.drop = undefined;
      }
      next.airportWay = w;
      return { draft: next };
    }
    case 'airport': {
      const a = AIRPORTS.find((x) => x.toLowerCase() === low)
        ?? AIRPORTS.find((x) => x.toLowerCase().includes(low))
        ?? (/\b(t1|terminal 1|domestic)\b/.test(low) ? AIRPORTS.find((x) => /terminal 1/i.test(x))
          : /\b(t2|terminal 2|international)\b/.test(low) ? AIRPORTS.find((x) => /terminal 2/i.test(x))
            : /\bnavi\b|\bnmia\b/.test(low) ? AIRPORTS.find((x) => /navi/i.test(x))
              : /\bpune\b/.test(low) ? AIRPORTS.find((x) => /pune/i.test(x)) : undefined);
      if (!a) return err('err.airport');
      next.airport = a;
      return { draft: next };
    }
    case 'pickup': case 'drop':
      if (v.length < 3) return err('err.address');
      next[step] = v.replace(/ \(address later\)$/, '');
      return { draft: next };
    case 'date': case 'returnDate': {
      const iso = parseDate(low);
      if (!iso) return err('err.date');
      if (iso < todayLocalIso()) return err('err.datePast');
      if (step === 'returnDate' && d.date && iso < d.date) return err('err.returnBefore');
      next[step] = iso;
      // A planned trip already knows its length, so the return day follows.
      if (step === 'date' && d.leg === 'RETURN' && d.days && d.days > 1 && !d.returnDate) {
        const back = new Date(`${iso}T00:00:00`);
        back.setDate(back.getDate() + d.days - 1);
        next.returnDate = `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, '0')}-${String(back.getDate()).padStart(2, '0')}`;
      }
      return { draft: next };
    }
    case 'time': case 'returnTime': {
      const hm = parseTime(low);
      if (!hm) return err('err.time');
      next[step] = hm;
      return { draft: next };
    }
    case 'pax': {
      const n = Number((/\d{1,3}/.exec(low) ?? [''])[0]);
      if (!n || n > 60) return err('err.pax');
      next.pax = n;
      return { draft: next };
    }
    case 'name':
      if (v.length < 2) return err('err.name');
      next.name = v;
      return { draft: next };
    case 'mobile': {
      const m = low.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      if (!/^[6-9]\d{9}$/.test(m)) return err('err.mobile');
      next.mobile = m;
      return { draft: next };
    }
    case 'email':
      if (/don.?t have|no email|none|skip|^no$|\bno\b.*\bemail\b|\bemail\b.*\bno\b/.test(low)) { next.noEmail = true; next.email = ''; return { draft: next }; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return err('err.email');
      next.email = v; next.noEmail = false;
      return { draft: next };
    case 'notes':
      // "No, nothing else", "Nahi, aur kuch nahi", "नाही, आणखी काही नाही" - all a no.
      next.notes = low.split(' ').every((w) => NOTHING.has(w)) ? '' : v;
      return { draft: next };
    default:
      return { draft: next };
  }
}

const NOTHING = new Set(['no', 'none', 'nothing', 'nope', 'and', 'anything', 'else', 'thanks', 'ok', 'okay', '']);

function parseDate(low: string): string | null {
  if (/\bday after tomorrow\b/.test(low)) return addDays(2);
  if (/\btomorrow\b/.test(low)) return addDays(1);
  if (/\btoday\b/.test(low)) return todayLocalIso();
  if (/^\d{4}-\d{2}-\d{2}$/.test(low)) return low;
  const m = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(low);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function parseTime(low: string): string | null {
  const s = low.replace(/\./g, ':').trim();
  // The whole answer ("17:30", "5 pm"), else a time inside a sentence
  // ("around 5:00 pm please", "sham 5 baje" once normalised).
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s)
    ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(s)
    ?? /\b(\d{1,2}):(\d{2})()\b/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/* ==========================================================================
   The vehicles, priced from the portal
   ========================================================================== */

export interface VehicleOption {
  slug: string;
  name: string;
  category: string;
  seats: number;
  bags: number;
  /** "₹3,199" or "from ₹1,500", or null when the office quotes it. */
  price: string | null;
  amount: number | null;
  /** Included hours/km, extra charges, toll. Only what the portal states. */
  details: string[];
  /** A fixed route fare the server will re-price, when there is one. */
  fixed?: { routeKey: string; category: string; leg: Leg };
  tooSmall: boolean;
  /** How the price was worked out, for the office's record of the chat. */
  basis: string;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export function vehicleOptions(d: Draft, routes: OutstationRoute[], book: RateBook): VehicleOption[] {
  const route = routes.find((r) => r.key === d.routeKey);
  const fam = FAMILIES.find((f) => f.key === d.family);
  const plan = d.kind === 'OUTSTATION' ? 'OUTSTATION' : d.kind === 'AIRPORT' ? 'AIRPORT' : 'LOCAL';

  let list = VEHICLES.filter((v) => v.plans.includes(plan));
  // A fixed-fare route is sold only in the four categories it has fares for -
  // unless this is a planned multi-day trip, which is priced off the per-km
  // card and can go in anything, a Tempo Traveller included.
  const perKm = d.kind === 'OUTSTATION' && !!d.km && (d.leg === 'RETURN' || d.routeKey === 'other');
  if (route && !perKm) list = list.filter((v) => fareCategoryOf(v.slug));
  if (fam) list = list.filter((v) => fam.categories.includes(v.category));
  if (d.vehicleSlug && !list.some((v) => v.slug === d.vehicleSlug)) {
    const named = VEHICLES.find((v) => v.slug === d.vehicleSlug);
    if (named) list = [named, ...list];
  }

  return list.map((v): VehicleOption => {
    const base = {
      slug: v.slug, name: v.name, category: v.category, seats: v.seats, bags: v.bags,
      tooSmall: !!d.pax && d.pax > (v.maxPax ?? v.seats),
    };
    if (d.kind === 'OUTSTATION') {
      const cat = fareCategoryOf(v.slug);
      const fare = route && cat ? route.fares.find((f) => f.category === cat) : undefined;
      const amount = fare ? fareOf(fare, d.leg ?? 'ONE_WAY') : null;
      if (fare && amount != null) {
        return {
          ...base, price: rupees(amount), amount,
          details: [`${fare.tollIncluded ? 'Toll included' : 'Toll extra'} · ${d.leg === 'RETURN' ? 'return' : 'one way'}`, `${CATEGORY_META[fare.category].label} · fixed fare`],
          fixed: { routeKey: route!.key, category: fare.category, leg: d.leg ?? 'ONE_WAY' },
          basis: `fixed fare, ${route!.key} ${fare.category} ${d.leg ?? 'ONE_WAY'}`,
        };
      }
      // No fixed fare for this: a planned trip with a known distance is
      // estimated from the per-km card; anything else is quoted.
      if (perKm) {
        const days = Math.max(1, d.days ?? 1);
        const km = d.km! * (d.leg === 'RETURN' ? 2 : 1);
        const est = estimateFor(book, v, { plan: 'OUTSTATION', distanceKm: km, days });
        const row = est.row;
        if (est.estimate && row) {
          return {
            ...base, price: `about ${inr(est.estimate.total)}`, amount: est.estimate.total,
            details: [
              `≈${km} km over ${days} ${days === 1 ? 'day' : 'days'} at ${inr(row.per_km_rate)}/km (min ${row.min_km_per_day} km/day)`,
              row.driver_allowance > 0 ? `Driver allowance ${inr(row.driver_allowance)}/day included` : '',
              'Toll, parking & state tax extra at actuals',
            ].filter(Boolean),
            basis: `per-km estimate: ${km} km, ${days} days, ${row.vehicle_category} ${row.plan_label} @ ${row.per_km_rate}/km, min ${row.min_km_per_day}/day, DA ${row.driver_allowance}`,
          };
        }
      }
      return { ...base, price: null, amount: null, details: ['Fare on request - the office quotes this trip'], basis: 'no fare configured - on request' };
    }
    const pkg = HOURLY.find((h) => h.key === d.hourly);
    const est = estimateFor(book, v, { plan, hours: pkg?.hours, km: pkg?.km });
    const row = est.row;
    if (!est.estimate || !row) {
      return { ...base, price: null, amount: null, details: [book.loaded ? 'Rate on request' : 'Loading the rate…'], basis: 'no rate-card row - on request' };
    }
    const details: string[] = [];
    if (row.included_hours > 0 || row.included_km > 0) details.push(`${row.included_hours} hrs / ${row.included_km} km included`);
    const extra = [row.extra_hour_rate > 0 && `${inr(row.extra_hour_rate)}/hr`, row.extra_km_rate > 0 && `${inr(row.extra_km_rate)}/km`].filter(Boolean);
    if (extra.length) details.push(`After that ${extra.join(' · ')}`);
    details.push('Toll, parking & state tax extra at actuals');
    return {
      ...base, price: `from ${inr(est.estimate.total)}`, amount: est.estimate.total, details,
      basis: `rate card: ${row.vehicle_category} ${row.plan_type} ${row.plan_label}, base ${row.base_fare}`,
    };
  })
    // The ones that seat the group first.
    .sort((a, b) => Number(a.tooSmall) - Number(b.tooSmall));
}

/* ==========================================================================
   Summary and the request that goes to the office
   ========================================================================== */

export function vehicleOf(d: Draft): CatalogVehicle | undefined {
  return VEHICLES.find((v) => v.slug === d.vehicleSlug);
}

export function serviceLabel(d: Draft, routes: OutstationRoute[]): string {
  const route = routes.find((r) => r.key === d.routeKey);
  switch (d.kind) {
    case 'OUTSTATION':
      return `Outstation ${d.leg === 'RETURN' ? 'return' : 'one way'} - ${route ? routeLabel(route) : `Mumbai → ${d.otherDestination ?? 'other'}`}`;
    case 'AIRPORT': return `Airport transfer - ${d.airportWay === AIRPORT_FROM ? 'from the airport' : 'to the airport'}`;
    case 'HOURLY': return `Hourly rental - ${HOURLY.find((h) => h.key === d.hourly)?.label ?? ''}`;
    default: return 'Local travel';
  }
}

/** Where the car starts and ends, with the airport filled in for a transfer. */
export function ends(d: Draft): { pickup: string; drop: string } {
  if (d.kind === 'AIRPORT') {
    return d.airportWay === AIRPORT_FROM
      ? { pickup: d.airport ?? '', drop: d.drop ?? '' }
      : { pickup: d.pickup ?? '', drop: d.airport ?? '' };
  }
  const route = d.kind === 'OUTSTATION' ? d.drop || d.otherDestination || '' : d.drop ?? '';
  return { pickup: d.pickup ?? '', drop: route };
}

const hm12 = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

export function summaryRows(d: Draft, routes: OutstationRoute[], opt: VehicleOption | undefined): [string, string][] {
  const e = ends(d);
  const rows: [string, string][] = [
    ['Service', `${serviceLabel(d, routes)}${d.days && d.days > 1 ? ` (${d.days} days)` : ''}`],
    ['Vehicle', opt ? `${opt.name} (${opt.category})` : vehicleOf(d)?.name ?? ''],
    ['Pickup', e.pickup],
  ];
  if (e.drop) rows.push(['Drop', e.drop]);
  rows.push(['Date', d.date ? dmy(d.date) : '']);
  rows.push(['Pickup time', d.time ? hm12(d.time) : '']);
  // Only a return trip has a return row; a one-way summary never shows one.
  if (d.kind === 'OUTSTATION' && d.leg === 'RETURN' && d.returnDate) {
    rows.push(['Return', `${dmy(d.returnDate)}${d.returnTime ? `, ${hm12(d.returnTime)}` : ''}`]);
  }
  rows.push(['Passengers', String(d.pax ?? '')]);
  rows.push(['Name', d.name ?? '']);
  rows.push(['Mobile', d.mobile ?? '']);
  rows.push(['Email', d.noEmail ? 'Not given' : d.email ?? '']);
  if (d.notes) rows.push(['Notes', d.notes]);
  rows.push([opt?.fixed ? 'Fare' : 'Estimated fare', opt?.price
    ? `${opt.price}${opt.fixed ? ` (${opt.details[0].split(' · ')[0].toLowerCase()})` : ' + toll, parking & state tax'}`
    : 'Quoted by the office']);
  if (d.planNote) rows.push(['Trip plan', d.planNote.split('\n')[0]]);
  return rows;
}

/** The fields a customer may go back and change from the summary. */
export const EDITABLE: { label: string; step: Step; clear: (d: Draft) => Draft; when?: (d: Draft) => boolean }[] = [
  // Changing the way changes the fare, so the car is chosen again at the new price.
  {
    label: 'One way / return', step: 'leg', when: (d) => d.kind === 'OUTSTATION',
    clear: (d) => ({ ...d, leg: undefined, returnDate: undefined, returnTime: undefined, vehicleSlug: undefined }),
  },
  {
    label: 'Direction', step: 'airportWay', when: (d) => d.kind === 'AIRPORT',
    clear: (d) => ({ ...d, airportWay: undefined, airport: undefined, pickup: undefined, drop: undefined }),
  },
  { label: 'Vehicle', step: 'vehicle', clear: (d) => ({ ...d, vehicleSlug: undefined }) },
  { label: 'Pickup', step: 'pickup', clear: (d) => ({ ...d, pickup: undefined }) },
  { label: 'Drop', step: 'drop', clear: (d) => ({ ...d, drop: undefined }) },
  { label: 'Date', step: 'date', clear: (d) => ({ ...d, date: undefined }) },
  { label: 'Time', step: 'time', clear: (d) => ({ ...d, time: undefined }) },
  { label: 'Return date', step: 'returnDate', when: (d) => d.leg === 'RETURN', clear: (d) => ({ ...d, returnDate: undefined }) },
  { label: 'Return time', step: 'returnTime', when: (d) => d.leg === 'RETURN', clear: (d) => ({ ...d, returnTime: undefined }) },
  { label: 'Passengers', step: 'pax', clear: (d) => ({ ...d, pax: undefined }) },
  { label: 'Name', step: 'name', clear: (d) => ({ ...d, name: undefined }) },
  { label: 'Mobile', step: 'mobile', clear: (d) => ({ ...d, mobile: undefined }) },
  { label: 'Email', step: 'email', clear: (d) => ({ ...d, email: undefined, noEmail: false }) },
  { label: 'Notes', step: 'notes', clear: (d) => ({ ...d, notes: undefined }) },
];

/** The body of /public/whatsapp-enquiry. The server re-prices a fixed fare. */
export function requestBody(d: Draft, routes: OutstationRoute[], opt: VehicleOption | undefined, chatSessionId = '') {
  const e = ends(d);
  const lines = [
    'Booked through the website assistant - the customer confirmed this summary.',
    opt && !opt.fixed && opt.price ? `Estimate shown: ${opt.price} + toll, parking & state tax (${opt.basis})` : '',
    d.planNote ?? '',
    d.kind === 'AIRPORT' && d.airportWay ? `${d.airportWay}: ${d.airport}` : '',
    d.notes ?? '',
  ].filter(Boolean);
  return {
    name: d.name,
    mobile: d.mobile,
    whatsappMobile: '',
    sameAsContact: true,
    email: d.noEmail ? '' : d.email ?? '',
    pickup: e.pickup || 'To be confirmed',
    dropOff: e.drop,
    travelDate: d.date ?? '',
    travelTime: d.time ?? '',
    vehicleType: opt ? `${opt.name} (${opt.category})` : '',
    passengers: d.pax ?? 0,
    message: lines.join('\n'),
    category: serviceLabel(d, routes),
    tripType: d.kind === 'OUTSTATION' ? (d.leg === 'RETURN' ? 'ROUND_TRIP' : 'OUTSTATION') : d.kind === 'AIRPORT' ? 'AIRPORT' : 'LOCAL',
    source: d.noEmail || !d.email ? 'WHATSAPP' : 'EMAIL',
    outstation: opt?.fixed,
    airportDirection: d.kind === 'AIRPORT' && d.airportWay ? AIRPORT_DIRECTION[d.airportWay] : '',
    // Return details only ever travel with a return trip.
    returnDate: d.leg === 'RETURN' ? d.returnDate ?? '' : '',
    returnTime: d.leg === 'RETURN' ? d.returnTime ?? '' : '',
    chatSessionId,
  };
}
