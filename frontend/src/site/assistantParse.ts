/**
 * Reading a trip out of a sentence.
 *
 * "We are 8 people and want to go to Mahabaleshwar for two nights" carries
 * everything needed to recommend a vehicle, sketch an itinerary and put a
 * number on it. This pulls those pieces out.
 *
 * It is a parser, not a language model. It runs in the browser, costs nothing,
 * works with no internet connection and — the part that matters for a travel
 * desk — cannot invent a destination, a rate or a cancellation policy. When it
 * does not understand, it says so and hands over to a person, which is exactly
 * what the existing site assistant does (see assistantKnowledge.ts for the
 * reasoning behind that trade).
 */
import { DESTINATIONS, MUMBAI_SPOTS, type Destination } from './places';
import type { Bags, Length, Priority, Requirement, Scope } from './recommend';

export interface ParsedTrip {
  /** Everything the recommender needs, with sensible defaults filled in. */
  requirement: Requirement;
  /** Which of the fields we actually found in the sentence. */
  found: {
    passengers: boolean;
    destination: boolean;
    nights: boolean;
    priority: boolean;
    kind: boolean;
  };
  destination?: Destination;
  /** A Mumbai sightseeing stop, when that is what they asked about. */
  spot?: string;
  nights: number;
  days: number;
  kind: 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'TOUR' | 'CORPORATE' | 'EVENT' | 'WEDDING';
  /** Enough signal to be worth answering with a trip plan at all. */
  usable: boolean;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, sixteen: 16, seventeen: 17, twenty: 20,
  'twenty five': 25, thirty: 30, forty: 40, fifty: 50,
};

function numberNear(text: string, units: string[]): number | undefined {
  for (const u of units) {
    const digits = new RegExp(`(\\d{1,3})\\s*(?:-|\\s)?\\s*${u}`, 'i').exec(text);
    if (digits) return Number(digits[1]);

    for (const [word, value] of Object.entries(WORD_NUMBERS)) {
      if (new RegExp(`${word}\\s+${u}`, 'i').test(text)) return value;
    }
  }
  return undefined;
}

/** "we are 8", "8 of us", "group of 12". */
function headcount(text: string): number | undefined {
  const direct = numberNear(text, ['people', 'persons?', 'pax', 'passengers?', 'adults?', 'guests?', 'members?', 'seaters?']);
  if (direct) return direct;

  const weAre = /\bwe\s+(?:are|will be)\s+(\d{1,3})\b/i.exec(text);
  if (weAre) return Number(weAre[1]);

  const ofUs = /\b(\d{1,3})\s+of\s+us\b/i.exec(text);
  if (ofUs) return Number(ofUs[1]);

  const groupOf = /\bgroup\s+of\s+(\d{1,3})\b/i.exec(text);
  if (groupOf) return Number(groupOf[1]);

  for (const [word, value] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\bwe\\s+are\\s+${word}\\b`, 'i').test(text)) return value;
    if (new RegExp(`\\b${word}\\s+of\\s+us\\b`, 'i').test(text)) return value;
  }
  return undefined;
}

export function parseRequirement(input: string): ParsedTrip {
  const text = ` ${input.toLowerCase().replace(/[.,!?]/g, ' ')} `;

  /* -------------------------------------------------------- destination */
  const destination = DESTINATIONS.find((d) => text.includes(` ${d.name.toLowerCase()}`));
  const spot = MUMBAI_SPOTS.find((s) => text.includes(s.name.toLowerCase()) || text.includes(s.slug.replace(/-/g, ' ')));

  /* ------------------------------------------------------------ people */
  const pax = headcount(text);

  /* ------------------------------------------------------------ nights */
  const nightsFound = numberNear(text, ['nights?']);
  const daysFound = numberNear(text, ['days?']);
  const weekend = /\bweekend\b/.test(text);

  let nights = nightsFound ?? (daysFound ? Math.max(0, daysFound - 1) : weekend ? 1 : 0);
  if (!nightsFound && !daysFound && !weekend && destination && destination.km > 200) nights = 1;

  /* -------------------------------------------------------------- kind */
  let kind: ParsedTrip['kind'] = 'LOCAL';
  let kindFound = true;
  if (/\bairport|terminal|flight|t1|t2\b/.test(text)) kind = 'AIRPORT';
  else if (/\bwedding|shaadi|baraat|marriage\b/.test(text)) kind = 'WEDDING';
  else if (/\bconference|event|exhibition|concert|offsite|town hall\b/.test(text)) kind = 'EVENT';
  else if (/\bcorporate|company|employees?|staff|client visit\b/.test(text)) kind = 'CORPORATE';
  else if (/\bsightseeing|tour|darshan|city tour\b/.test(text) || spot) kind = 'TOUR';
  else if (destination || nights > 0 || /\boutstation|out of (the )?city|road trip\b/.test(text)) kind = 'OUTSTATION';
  else kindFound = false;

  /* ---------------------------------------------------------- priority */
  let priority: Priority = 'comfort';
  let priorityFound = false;
  if (/\bcheap|budget|economical|lowest|affordable|save\b/.test(text)) { priority = 'price'; priorityFound = true; }
  else if (/\bluxury|luxurious|premium|executive|vip|best car\b/.test(text)) { priority = 'premium'; priorityFound = true; }
  else if (/\bspace|luggage|bags|suitcases|room\b/.test(text)) { priority = 'space'; priorityFound = true; }
  else if (/\bcomfort|comfortable|relax\b/.test(text)) { priority = 'comfort'; priorityFound = true; }

  /* -------------------------------------------------------------- bags */
  let bags: Bags = 'medium';
  if (/\blight|hand baggage|no luggage|cabin\b/.test(text)) bags = 'light';
  else if (/\bsuitcases?|heavy luggage|lots of (luggage|bags)|trolley\b/.test(text)) bags = 'heavy';

  /* ------------------------------------------------------------- shape */
  const scope: Scope = kind === 'OUTSTATION' || nights > 0 ? 'outstation' : 'local';
  const days = nights + 1;
  const length: Length =
    nights >= 2 ? 'multi-day' : nights === 1 ? 'overnight' : /\bfew hours|couple of hours|half day\b/.test(text) ? 'few-hours' : 'full-day';

  const requirement: Requirement = {
    passengers: pax ?? 4,
    bags,
    scope,
    length,
    priority,
  };

  return {
    requirement,
    found: {
      passengers: pax !== undefined,
      destination: Boolean(destination),
      nights: nightsFound !== undefined || daysFound !== undefined || weekend,
      priority: priorityFound,
      kind: kindFound,
    },
    destination,
    spot: spot?.name,
    nights,
    days,
    kind,
    // One concrete fact is enough to be worth answering with a plan.
    usable: pax !== undefined || Boolean(destination) || Boolean(spot) || nights > 0,
  };
}

/** What to show as example prompts on an empty assistant screen. */
export const ASSISTANT_EXAMPLES = [
  'We are 8 people and want to go to Mahabaleshwar for two nights',
  '4 of us to Lonavala for the weekend, keep it economical',
  'Airport drop from Powai to T2 on Friday morning',
  '25 guests from a hotel in Andheri to a wedding venue',
  'A full day of Mumbai sightseeing for a family of five',
  'Two executives to Pune and back the same day',
];
