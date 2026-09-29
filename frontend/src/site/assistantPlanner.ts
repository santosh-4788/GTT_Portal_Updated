/**
 * Planning a trip in the assistant - "we are 4 people and want to go somewhere
 * for 2 days, suggest something".
 *
 * It asks only what the customer has not already said (days, people, the kind
 * of trip, a rough cab budget), suggests destinations from the portal's own
 * list (places.ts: distance, drive time, famous places, itinerary, the nights
 * each place suits), listens to "no, we've been there" / "I don't like this",
 * and once the customer is happy hands a prepared booking to the booking
 * conversation (assistantBooking.ts), which shows the vehicles and fares.
 *
 * It never invents a place, a price or a timing: everything it says is read
 * from DESTINATIONS and planFor(), and a place the portal has no page for is
 * sent to the office as a quote request instead of being described.
 */
import { DESTINATIONS, THEMES, type Destination, type Theme } from './places';
import { planFor } from './itinerary';
import { VEHICLES } from './catalog';
import { estimateFor } from './kit';
import type { Draft, RateBook } from './assistantBooking';
import type { OutstationRoute } from './outstation';

export interface Plan {
  pax?: number;
  days?: number;
  from?: string;
  themes: Theme[];
  /** Who is going, when they said - family, couple, friends. */
  party?: 'family' | 'couple' | 'friends';
  /** Cab budget for the whole trip, in rupees. 0 = no limit. */
  budget?: number;
  /** Keep it within this many hours' drive. */
  maxHours?: number;
  rejected: string[];
  shown: string[];
  current?: string;
  /** The type question has been asked (answered "anything" counts). */
  typeAsked?: boolean;
}

export type PlanStep = 'days' | 'pax' | 'type' | 'budget' | 'suggest';

const THEME_WORDS: [RegExp, Theme[]][] = [
  [/\b(beach|beaches|sea|coast|konkan)\b/, ['beach']],
  [/\b(hill|hills|hill station|mountain|mountains|ghat)\b/, ['hills']],
  [/\b(nature|waterfall|greenery|green|lake|forest|trek|monsoon)\b/, ['nature']],
  [/\b(religious|temple|temples|darshan|pilgrim|pilgrimage|jyotirlinga|spiritual)\b/, ['religious']],
  [/\b(historical|history|heritage|fort|forts|caves|monument)\b/, ['heritage']],
  [/\b(adventure|trekking|camping|thrill|paragliding|water sports)\b/, ['adventure']],
  [/\b(food|wine|vineyard|vineyards)\b/, ['food']],
  [/\b(sightseeing|photography|photo|scenic)\b/, ['photo']],
  [/\b(romantic|honeymoon)\b/, ['romantic']],
];

export const TYPE_CHIPS = ['Family', 'Couple', 'Friends', 'Hills & nature', 'Beach', 'Religious', 'Historical', 'Adventure', 'Anything'];
export const BUDGET_CHIPS = ['Under ₹6,000', '₹6,000 - ₹12,000', 'Above ₹12,000', 'No fixed budget'];
export const CHANGE_CHIPS = ['Destination', 'Places to visit', 'Number of days', 'Budget', 'Type of trip', 'Travel distance'];

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const num = (s: string) => (NUM[s] ?? Number(s));

const destIn = (text: string) => DESTINATIONS.filter((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(text));

/** Read whatever a message says about the trip into the plan. */
export function readPlan(raw: string, p: Plan): Plan {
  const text = ` ${raw.toLowerCase().replace(/[^\w\s₹,-]/g, ' ')} `;
  const next: Plan = { ...p, themes: [...p.themes], rejected: [...p.rejected] };

  const pax = /\b(?:we are|we're|group of|party of)\s+(\d{1,2}|\w+)\b/.exec(text)
    ?? /\b(\d{1,2}|\w+)\s+(?:people|persons|pax|adults|members|friends|of us|travellers|travelers)\b/.exec(text);
  if (pax && num(pax[1]) > 0) next.pax = num(pax[1]);

  const days = /\b(\d{1,2}|\w+)[\s-]*days?\b/.exec(text);
  const nights = /\b(\d{1,2}|\w+)[\s-]*nights?\b/.exec(text);
  if (days && num(days[1]) > 0) next.days = num(days[1]);
  else if (nights && num(nights[1]) >= 0) next.days = num(nights[1]) + 1;
  else if (/\bday trip\b|\bsame day\b|\bone day\b/.test(text)) next.days = 1;
  else if (/\bweekend\b/.test(text) && !p.days) next.days = 2;

  if (/\bfamily|kids|children|parents\b/.test(text)) next.party = 'family';
  else if (/\bcouple|wife|husband|honeymoon|partner\b/.test(text)) next.party = 'couple';
  else if (/\bfriends|gang|colleagues|group\b/.test(text)) next.party = 'friends';

  for (const [re, th] of THEME_WORDS) if (re.test(text)) for (const t of th) if (!next.themes.includes(t)) next.themes.push(t);
  if (next.themes.length || next.party || /\banything|any type|no preference|surprise\b/.test(text)) next.typeAsked = true;

  const from = /\bfrom ([a-z][a-z ]{2,30}?)(?: to|,|\.| for| and|$)/.exec(text);
  if (from && !destIn(from[1]).length) next.from = from[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());

  const rupees = /(?:₹|rs\.?|inr|budget(?: of| is)?)\s*([\d,]{3,7})/.exec(text);
  if (rupees) next.budget = Number(rupees[1].replace(/,/g, ''));
  else if (/\bno (fixed )?budget|any budget|budget is not\b/.test(text)) next.budget = 0;
  else if (/under ₹?6,?000|cheap|low budget/.test(text)) next.budget = 6000;
  else if (/6,?000 - ₹?12,?000|mid/.test(text)) next.budget = 12000;
  else if (/above ₹?12,?000/.test(text)) next.budget = 0;

  if (/\b(closer|nearby|near mumbai|not too far|short drive|close by)\b/.test(text)) next.maxHours = 3;
  else if (/\bfar is fine|further is fine|long drive is fine\b/.test(text)) next.maxHours = undefined;

  // "already visited Lonavala", "not Lonavala", "except Alibaug"
  const negative = /\b(already|been to|visited|seen|not|don'?t|dont|except|other than|no\b)/.test(text);
  if (negative) for (const d of destIn(text)) if (!next.rejected.includes(d.slug)) next.rejected.push(d.slug);

  return next;
}

/** Is this the start of a trip-planning conversation? */
export function planIntent(raw: string): boolean {
  const t = raw.toLowerCase();
  if (/\b(airport|flight|terminal|hourly|per hour)\b/.test(t)) return false;
  return /\b(plan|planning|suggest|recommend|getaway|holiday|vacation|weekend|picnic|outing|places to visit|where (should|can|to) (we|i) go|somewhere|tour package|trip idea)\b/.test(t)
    || (/\b\d+\s*(day|days|night|nights)\b|\bone day\b|\btwo days?\b|\bthree days?\b/.test(t) && /\b(travel|go|trip|visit|tour|explore)\b/.test(t));
}

export function nextPlanStep(p: Plan): PlanStep {
  if (!p.days) return 'days';
  if (!p.pax) return 'pax';
  if (!p.typeAsked) return 'type';
  if (p.budget === undefined) return 'budget';
  return 'suggest';
}

export function planPrompt(step: PlanStep, p: Plan): { text: string; chips?: string[] } {
  const known = [p.pax && `${p.pax} people`, p.days && `${p.days} ${p.days === 1 ? 'day' : 'days'}`].filter(Boolean).join(', ');
  const lead = known ? `Lovely - ${known}. ` : 'Happy to help plan it. ';
  switch (step) {
    case 'days': return { text: `${lead}How many days is the trip?`, chips: ['Day trip', '2 days', '3 days', '4 days'] };
    case 'pax': return { text: `${lead}How many people are travelling?`, chips: ['2', '3', '4', '5', '6', '8', '12'] };
    case 'type': return { text: `${lead}What kind of trip are you after?`, chips: TYPE_CHIPS };
    case 'budget': return { text: 'Roughly what is your budget for the cab, for the whole trip? (Stay and food are separate.)', chips: BUDGET_CHIPS };
    default: return { text: '' };
  }
}

/* ==========================================================================
   Suggesting places
   ========================================================================== */

/** The cheapest cab for the group on this trip, from the portal's rate card. */
export function cabEstimate(d: Destination, p: Plan, book: RateBook): { amount: number; vehicle: string } | null {
  const days = Math.max(1, p.days ?? 1);
  let best: { amount: number; vehicle: string } | null = null;
  for (const v of VEHICLES) {
    if (!v.plans.includes('OUTSTATION') || (p.pax ?? 1) > (v.maxPax ?? v.seats)) continue;
    const est = estimateFor(book, v, { plan: 'OUTSTATION', distanceKm: d.km * 2, days });
    if (est.estimate && (!best || est.estimate.total < best.amount)) best = { amount: est.estimate.total, vehicle: v.name };
  }
  return best;
}

const hoursOf = (d: Destination) => Number(/([\d.]+)/.exec(d.hours)?.[1] ?? 99);

export function suggest(p: Plan, book: RateBook, count = 3): Destination[] {
  const nights = Math.max(0, (p.days ?? 1) - 1);
  const scored = DESTINATIONS
    .filter((d) => !p.rejected.includes(d.slug))
    .filter((d) => !p.maxHours || hoursOf(d) <= p.maxHours)
    .map((d) => {
      let score = 0;
      score += 3 * d.themes.filter((t) => p.themes.includes(t)).length;
      if (p.party === 'family' && (d.themes.includes('family') || d.bestFor.some((b) => /famil/i.test(b)))) score += 2;
      if (p.party === 'couple' && (d.themes.includes('romantic') || d.bestFor.some((b) => /couple/i.test(b)))) score += 2;
      if (p.party === 'friends' && (d.themes.includes('adventure') || d.bestFor.some((b) => /friend|group/i.test(b)))) score += 2;
      score += d.nights.includes(nights) ? 3 : -4;
      if (p.shown.includes(d.slug)) score -= 6;
      if (p.budget) {
        const est = cabEstimate(d, p, book);
        if (est && est.amount > p.budget) score -= 8;
      }
      return { d, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map((x) => x.d);
}

export function placeCard(d: Destination, p: Plan, book: RateBook) {
  const est = cabEstimate(d, p, book);
  return {
    slug: d.slug,
    name: d.name,
    line: `≈${d.km} km from Mumbai · ${d.hours.replace('≈', '')} by road`,
    blurb: d.blurb,
    famous: d.seeThere.slice(0, 4),
    estimate: est ? `Cab from about ₹${Math.round(est.amount).toLocaleString('en-IN')} (${est.vehicle}, return, ${p.days ?? 1} ${(p.days ?? 1) === 1 ? 'day' : 'days'})` : null,
  };
}

/** The full plan for one destination, in words. */
export function planText(d: Destination, p: Plan): string {
  const days = Math.max(1, p.days ?? 1);
  const fits = d.nights.includes(days - 1);
  const range = `${Math.min(...d.nights) + 1}-${Math.max(...d.nights) + 1}`;
  const legs = planFor(d, days).map((l) => `${l.day}: ${l.plan}`).join('\n');
  return [
    `${d.name} - ${days}-day plan${p.pax ? ` for ${p.pax}` : ''}`,
    `≈${d.km} km from Mumbai, about ${d.hours.replace('≈', '')} each way.${fits ? '' : ` Most people take ${range} days here.`}`,
    `Famous places: ${d.seeThere.join(', ')}.`,
    `Best for: ${d.bestFor.join(', ')}.`,
    '',
    'Suggested itinerary:',
    legs,
    '',
    'Timings are approximate - the road on the day decides.',
  ].join('\n');
}

export const themeLabel = (t: Theme) => THEMES.find((x) => x.key === t)?.label ?? t;

/** The booking the accepted plan turns into. */
export function draftFromPlan(p: Plan, d: Destination, routes: OutstationRoute[]): Draft {
  const route = routes.find((r) => r.destination.toLowerCase() === d.name.toLowerCase());
  const days = Math.max(1, p.days ?? 1);
  const rejected = p.rejected.map((s) => DESTINATIONS.find((x) => x.slug === s)?.name).filter(Boolean);
  const note = [
    `Trip planned in the chat: ${days} ${days === 1 ? 'day' : 'days'} to ${d.name}${p.pax ? ` for ${p.pax}` : ''}.`,
    [p.party, ...p.themes.map(themeLabel)].filter(Boolean).length ? `Preferences: ${[p.party, ...p.themes.map(themeLabel)].filter(Boolean).join(', ')}.` : '',
    p.budget ? `Cab budget about ₹${p.budget.toLocaleString('en-IN')}.` : '',
    `Places: ${d.seeThere.join(', ')}.`,
    `Itinerary: ${planFor(d, days).map((l) => `${l.day} - ${l.plan}`).join(' | ')}`,
    rejected.length ? `Not interested in: ${rejected.join(', ')}.` : '',
    p.from && p.from.toLowerCase() !== 'mumbai' ? `Starting from ${p.from}.` : '',
  ].filter(Boolean).join('\n');
  return {
    kind: 'OUTSTATION',
    routeKey: route ? route.key : 'other',
    otherDestination: route ? undefined : d.name,
    leg: days > 1 ? 'RETURN' : undefined,
    pax: p.pax,
    days,
    km: d.km,
    planNote: note,
  };
}
