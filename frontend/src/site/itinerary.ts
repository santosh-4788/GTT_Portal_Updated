/**
 * The day-by-day plan for a destination, for the number of days actually chosen.
 *
 * WHY THIS EXISTS
 *
 * Each destination carries one hand-written itinerary, and the detail page lets
 * the customer pick how many nights they have. Those two things disagreed for
 * every destination we publish: Shirdi offers a day trip but its written plan
 * runs to two days, Goa offers two nights but its plan runs to four. So a
 * customer choosing "Day trip" was shown a plan that told them to check into a
 * hotel — the fare, the vehicle and the day count all updated, and the one part
 * that described their actual trip did not.
 *
 * WHAT IT DOES
 *
 * The author's own plan is used whenever it fits the chosen length, because
 * prose written by somebody who knows the road is better than anything
 * generated. When it does not fit, a plan is built from the parts the
 * destination already carries — the drive time, the distance and the list of
 * places worth seeing — spread across the days available.
 *
 * It is a starting point, which is what the page says it is. It is not
 * pretending to know opening hours.
 */
import type { Destination } from './places';

export interface ItineraryLeg {
  day: string;
  plan: string;
}

/** Join a list the way a person writes one: "a, b and c". */
function sentence(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Share the places to see across the days that have room for sightseeing.
 *
 * Front-loaded deliberately: the first full day is the one with the most energy
 * and the fewest surprises, and the last day loses hours to checkout and the
 * drive home. An even split reads fairer on paper and runs worse on the road.
 */
function spreadAcross(spots: string[], buckets: number): string[][] {
  if (buckets <= 0) return [];
  const out: string[][] = Array.from({ length: buckets }, () => []);
  spots.forEach((spot, i) => out[i % buckets].push(spot));
  return out;
}

/**
 * Build a plan for `days` days at this destination.
 *
 * `days` counts days on the road, not nights: a day trip is 1, one night is 2.
 */
export function planFor(d: Destination, days: number): ItineraryLeg[] {
  const wanted = Math.max(1, Math.round(days));

  // The author's plan, when it is the right length. Nothing beats it.
  if (d.itinerary.length === wanted) return d.itinerary;

  const spots = d.seeThere.length ? d.seeThere : ['the main sights'];
  const drive = d.hours.replace(/^≈\s*/, '');

  // ---- a day trip: out and back, no hotel ---------------------------------
  if (wanted === 1) {
    const doable = spots.slice(0, 3);
    return [
      {
        day: 'Day trip',
        plan:
          `Leave Mumbai by 6–7am to clear the city, roughly ${drive} on the road each way ` +
          `(${d.km} km). That leaves the middle of the day for ${sentence(doable)}. ` +
          `Late lunch, then back the same evening — the driver stays with you throughout.`,
      },
    ];
  }

  // ---- overnight and longer ------------------------------------------------
  // Day 1 loses its morning to the drive; the last loses its afternoon to it.
  // Everything between is a full day, which is where most of the list belongs.
  const middleDays = wanted - 2;
  const firstDayShare = Math.min(2, Math.max(1, Math.ceil(spots.length / wanted)));
  const firstDaySpots = spots.slice(0, firstDayShare);
  const rest = spots.slice(firstDayShare);

  const legs: ItineraryLeg[] = [
    {
      day: 'Day 1',
      plan:
        `Leave Mumbai in the morning — about ${drive} for the ${d.km} km. Check in and settle, ` +
        `then ${sentence(firstDaySpots)} in the afternoon, close to where you are staying.`,
    },
  ];

  if (middleDays > 0) {
    const share = spreadAcross(rest.slice(0, Math.max(0, rest.length - 1)), middleDays);
    for (let i = 0; i < middleDays; i++) {
      const forToday = share[i]?.length ? share[i] : ['whatever you did not reach yesterday'];
      legs.push({
        day: `Day ${i + 2}`,
        plan:
          `A full day out. ${sentence(forToday)} — the vehicle is with you all day, so the ` +
          `order is yours to change on the morning.`,
      });
    }
  }

  const lastSpots = rest.slice(Math.max(0, rest.length - 1));
  legs.push({
    day: `Day ${wanted}`,
    plan:
      (lastSpots.length
        ? `${sentence(lastSpots)} in the morning, then checkout. `
        : 'A slow morning, then checkout. ') +
      `Back on the road after lunch — about ${drive} — into Mumbai by evening.`,
  });

  return legs;
}

/**
 * The heading above the plan. Says whose plan it is, because a customer is
 * owed the difference between a route we drive often and one worked out from
 * the distance and the list of sights.
 */
export function planHeading(d: Destination, days: number): string {
  const authored = d.itinerary.length === Math.max(1, Math.round(days));
  if (days === 1) return authored ? 'A day trip that works' : 'A day trip, hour by hour';
  return authored ? `A ${days}-day plan that works` : `A ${days}-day plan, built round your dates`;
}
