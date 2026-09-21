/**
 * "Tell us what you need" — the arithmetic behind the recommendation.
 *
 * Given a group size, a luggage load, a trip shape and what the customer cares
 * about, this picks the vehicle we would actually send, and says why. It is a
 * scoring function over the twelve vehicles in the catalogue, not a model: the
 * reasoning is inspectable, it gives the same answer twice, and it can be
 * argued with over the phone.
 *
 * It also works out when one vehicle stops being the right answer — twenty-five
 * people is two Travellers, not a bigger Traveller — which is the question the
 * office is asked most often and the one no competitor's website answers.
 */
import { VEHICLES, capacityOf, type CatalogVehicle, type PlanType } from './catalog';
import type { RateOption } from './fare';

/* ==========================================================================
   What the customer told us
   ========================================================================== */

export type Bags = 'light' | 'medium' | 'heavy';
export type Scope = 'local' | 'outstation';
export type Length = 'few-hours' | 'full-day' | 'overnight' | 'multi-day';
export type Priority = 'price' | 'comfort' | 'premium' | 'space';

export interface Requirement {
  passengers: number;
  bags: Bags;
  scope: Scope;
  length: Length;
  priority: Priority;
}

export const BAG_LABEL: Record<Bags, string> = {
  light: 'Hand baggage only',
  medium: 'A bag each',
  heavy: 'Large suitcases',
};

/** Large bags per head, by how much the group said they are carrying. */
const BAGS_PER_HEAD: Record<Bags, number> = { light: 0.35, medium: 0.75, heavy: 1.15 };

export const PRIORITY_LABEL: Record<Priority, string> = {
  price: 'Lowest price',
  comfort: 'Comfort',
  premium: 'Premium',
  space: 'Maximum space',
};

/* ==========================================================================
   One vehicle, or several
   ========================================================================== */

export interface Suggestion {
  vehicle: CatalogVehicle;
  /** How many of this vehicle the group needs. */
  count: number;
  /** Seats left over once everyone is in. Negative never happens. */
  spare: number;
  /** Plain-language reasons, shown under the recommendation. */
  why: string[];
  score: number;
  /**
   * In the smallest class of vehicle that carries this group.
   *
   * Sorted on before the score, so the headline answer is always the right size
   * and the score only decides which of the right-sized vehicles leads.
   */
  rightSize: boolean;
}

/**
 * Comfortable capacity. A 6-seat Innova takes six people, but six people with a
 * suitcase each do not fit in it — so seats are discounted when the luggage
 * needs the last row. This is the judgement the phone makes and the reason a
 * seat count alone gives the wrong answer.
 */
function usableSeats(v: CatalogVehicle, bags: Bags): number {
  const max = capacityOf(v);
  const need = BAGS_PER_HEAD[bags];
  const perHead = v.bags / max;
  if (perHead >= need) return max;
  // Every head of luggage beyond the boot costs roughly one seat of space.
  const short = (need - perHead) * max;
  return Math.max(1, Math.floor(max - short * 0.8));
}

function fits(v: CatalogVehicle, req: Requirement): boolean {
  if (req.scope === 'outstation' && !v.plans.includes('OUTSTATION')) return false;
  return true;
}

/**
 * Rank the fleet against a requirement.
 *
 * Returns the best answer first. Where a group needs more than one vehicle, the
 * count says how many, and single-vehicle answers are preferred while one
 * still exists — two cars is always more coordination than one.
 */
export function recommend(req: Requirement): Suggestion[] {
  const pax = Math.max(1, Math.round(req.passengers || 1));
  const eligible = VEHICLES.filter((v) => fits(v, req));

  /**
   * The size of vehicle the group needs, decided before anything is scored.
   *
   * Group size is a fact; comfort, luggage and price are preferences. Scoring
   * them together let a preference overrule the fact — seven people with
   * suitcases were recommended a twelve-seat Tempo Traveller, because its boot
   * scored better than the SUVs', on a site that had already established seven
   * people fit in an SUV. Size is settled first now, and the score only picks
   * between the vehicles that are the right size.
   *
   * Undefined when no single vehicle carries the group; the ranking then falls
   * back to pure score and the counts describe the set.
   */
  const tier = [...new Set(eligible.map((v) => v.seats))]
    .sort((a, b) => a - b)
    .find((t) => eligible.some((v) => v.seats === t && capacityOf(v) >= pax));

  const isRightSize = (v: CatalogVehicle) =>
    tier !== undefined && v.seats === tier && capacityOf(v) >= pax;

  const out: Suggestion[] = [];

  for (const v of eligible) {
    const capacity = capacityOf(v);
    const seats = usableSeats(v, req.bags);

    /**
     * One vehicle whenever it seats everybody.
     *
     * The luggage discount above says how COMFORTABLE the trip is, not how many
     * vehicles it takes, and treating it as capacity produced a visibly silly
     * answer: seven people were quoted "2 × Ertiga" on a screen that had just
     * told them an Ertiga seats seven. The tightness is still accounted for —
     * it costs the vehicle points below, and says so in `why`.
     */
    const count = capacity >= pax ? 1 : Math.ceil(pax / seats);
    const spare = Math.max(0, count * capacity - pax);

    // A single sedan for twelve people is not an option worth showing.
    if (count > 3) continue;

    let score = 0;
    const why: string[] = [];

    // --- the right size ----------------------------------------------------
    // Full is efficient; nearly empty is a bigger vehicle than the trip needs.
    const fill = pax / (count * capacity);
    score += fill * 26;
    if (count === 1) {
      score += 16;
      why.push(`${pax} ${pax === 1 ? 'passenger' : 'passengers'} in one vehicle — nothing to coordinate`);
    } else {
      score -= (count - 1) * 12;
      why.push(`${count} vehicles for ${pax} passengers, travelling together`);
    }
    if (spare >= 1 && spare <= 2 && count === 1) why.push(`${spare} spare ${spare === 1 ? 'seat' : 'seats'} for comfort`);

    // --- luggage -----------------------------------------------------------
    const bagsNeeded = Math.ceil(pax * BAGS_PER_HEAD[req.bags]);
    const bagCapacity = v.bags * count;
    if (bagCapacity >= bagsNeeded) {
      score += 12;
      if (req.bags === 'heavy') why.push(`Takes ${bagCapacity} large bags — enough for a suitcase each`);
    } else {
      score -= 18;
      // Said out loud rather than only priced in. Filling the last row leaves
      // the boot short, and the customer should hear that from us before the
      // morning of the trip rather than discover it at the kerb.
      if (count === 1 && pax > seats) {
        why.push(`Seats ${pax}, but boot space is tight at that load — ${bagCapacity} large ${bagCapacity === 1 ? 'bag' : 'bags'}`);
      }
    }

    // --- what they said they cared about -----------------------------------
    if (req.priority === 'price') score += v.score.value * 3.2;
    if (req.priority === 'comfort') score += v.score.comfort * 3.2;
    if (req.priority === 'space') score += v.score.space * 3.2;
    if (req.priority === 'premium') {
      score += (v.tags.includes('premium') ? 22 : 0) + v.score.comfort * 2;
    }

    // --- the shape of the trip ---------------------------------------------
    if (req.scope === 'outstation') {
      score += v.score.comfort * 1.6;
      if (v.slug === 'innova-crysta') why.push('The long-distance vehicle we send most often');
      if (v.slug === 'dzire' && (req.length === 'multi-day' || req.length === 'overnight')) score -= 8;
    } else {
      score += v.score.value * 1.2;
      if (v.slug === 'bus') score -= 20;
    }
    if (req.length === 'multi-day') score += v.score.comfort * 1.4;
    if (req.length === 'few-hours') score += v.score.value * 1.4;

    // A coach for eight people is never the answer, whatever the maths says.
    if (v.seats >= 30 && pax < 25) score -= 55;
    if (v.seats >= 12 && pax <= 6) score -= 30;

    if (req.priority === 'comfort' && v.score.comfort >= 8) why.push('Highest comfort in the fleet for this size');
    if (req.priority === 'price' && v.score.value >= 8) why.push('Lowest running cost of the vehicles that fit');

    out.push({ vehicle: v, count, spare, why: why.slice(0, 3), score, rightSize: isRightSize(v) });
  }

  // Right size first, then the best of those. Everything else keeps its order
  // below, so the alternatives list still offers the bigger and smaller options.
  return out.sort((a, b) => Number(b.rightSize) - Number(a.rightSize) || b.score - a.score);
}

/**
 * The group-travel answer in one sentence: one vehicle, or several, and which.
 *
 * Deliberately separate from `recommend` — a group organiser is not choosing
 * between a Dzire and a City, they are asking "does this fit in one bus".
 */
export interface FleetPlan {
  headline: string;
  mode: 'single' | 'multiple';
  legs: { vehicle: CatalogVehicle; count: number }[];
  seats: number;
  note: string;
}

export function fleetPlan(passengers: number, bags: Bags = 'medium'): FleetPlan | null {
  const pax = Math.max(1, Math.round(passengers || 1));
  const byId = (slug: string) => VEHICLES.find((v) => v.slug === slug)!;

  const pick = (slug: string, count: number) => ({ vehicle: byId(slug), count });

  let legs: { vehicle: CatalogVehicle; count: number }[];

  if (pax <= 4) legs = [pick(bags === 'heavy' ? 'ertiga' : 'dzire', 1)];
  else if (pax <= 6) legs = [pick(bags === 'heavy' ? 'innova-crysta' : 'ertiga', 1)];
  else if (pax <= 12) legs = [pick('tempo-traveller-12', 1)];
  else if (pax <= 17) legs = [pick('tempo-traveller-17', 1)];
  else if (pax <= 34) {
    const large = Math.floor(pax / 17);
    const rest = pax - large * 17;
    legs = [pick('tempo-traveller-17', large)];
    if (rest > 0 && rest <= 6) legs.push(pick('ertiga', 1));
    else if (rest > 6) legs.push(pick('tempo-traveller-12', 1));
  } else {
    const coaches = Math.ceil(pax / 45);
    legs = [pick('bus', coaches)];
    const rest = pax - coaches * 45;
    if (rest > 0) legs.push(pick('tempo-traveller-17', Math.ceil(rest / 17)));
  }

  const vehicles = legs.reduce((s, l) => s + l.count, 0);
  const seats = legs.reduce((s, l) => s + l.vehicle.seats * l.count, 0);

  return {
    mode: vehicles === 1 ? 'single' : 'multiple',
    legs,
    seats,
    headline: vehicles === 1 ? '1 Vehicle' : `${vehicles} Vehicles`,
    note:
      vehicles === 1
        ? `${pax} passengers fit in one ${legs[0].vehicle.name} with ${seats - pax} ${seats - pax === 1 ? 'seat' : 'seats'} spare.`
        : `${pax} passengers across ${vehicles} vehicles, ${seats} seats in total, all under one point of contact.`,
  };
}

/** The worked examples shown on the group page — the same function, run ahead. */
export const GROUP_EXAMPLES = [12, 25, 50].map((n) => ({ pax: n, plan: fleetPlan(n)! }));

/* ==========================================================================
   Turning a vehicle into a number
   ========================================================================== */

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Find the rate row that belongs to a vehicle.
 *
 * The rate cards are maintained in the Master under whatever category names the
 * business uses, which are not our slugs. Matching on the vehicle's aliases
 * means a new row called "Premium Sedan" or "Crysta" lands on the right card
 * without anyone editing code — and when nothing matches we return nothing, so
 * the screen says "estimate on request" instead of inventing a figure.
 */
export function findRate(
  rates: RateOption[],
  vehicle: CatalogVehicle,
  plan: PlanType
): RateOption | undefined {
  const pool = rates.filter((r) => r.plan_type === plan);
  if (!pool.length) return undefined;

  const aliases = [...vehicle.rateAliases, ...words(vehicle.name), ...words(vehicle.category)];

  let best: { row: RateOption; hits: number } | undefined;
  for (const row of pool) {
    const cat = row.vehicle_category.toLowerCase();
    const hits = aliases.reduce((n, a) => (a.length > 2 && cat.includes(a) ? n + a.length : n), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { row, hits };
  }
  return best?.row;
}

/** Cheapest plan row for a vehicle, used for the "from" figure on a card. */
export function cheapestPlan(rates: RateOption[], vehicle: CatalogVehicle, plan: PlanType) {
  const pool = rates.filter((r) => r.plan_type === plan);
  const aliases = [...vehicle.rateAliases, ...words(vehicle.name)];
  const mine = pool.filter((r) => {
    const cat = r.vehicle_category.toLowerCase();
    return aliases.some((a) => a.length > 2 && cat.includes(a));
  });
  if (!mine.length) return undefined;
  return mine.sort((a, b) => (a.base_fare || a.per_km_rate) - (b.base_fare || b.per_km_rate))[0];
}
