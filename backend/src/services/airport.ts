/**
 * Which way an airport transfer goes.
 *
 * An airport booking is two different jobs. Going TO the airport the car
 * starts at the customer's door and the airport is the drop; coming FROM it the
 * car waits at arrivals and the address is the drop. Every screen asks this
 * first, before any address, and the answer is stored on the booking so the
 * office, the emails and the invoice never have to guess it from the text.
 */
import { z } from 'zod';

export type AirportDirection = 'TO' | 'FROM';

export const DIRECTION_LABEL: Record<AirportDirection, string> = {
  TO: 'To airport (drop)',
  FROM: 'From airport (pickup)',
};

/** What the forms send. Blank means "not an airport trip" or "not chosen". */
export const airportDirectionField = z.enum(['TO', 'FROM', '']).optional().default('');

/** Terminal and airport words, as vendors and customers actually write them. */
export const AIRPORT_HINT = /\bairport\b|\bterminal\s*[t]?[123]\b|\bT[123]\b|\bCSMIA\b|\bNMIA\b|\bvimantal\b|विमानतळ|हवाई अड्डा|एयरपोर्ट/i;

/** Read the direction from which end mentions the airport. */
export function inferAirportDirection(pickup?: string | null, drop?: string | null): AirportDirection | null {
  const p = AIRPORT_HINT.test(pickup ?? '');
  const d = AIRPORT_HINT.test(drop ?? '');
  if (d && !p) return 'TO';
  if (p && !d) return 'FROM';
  return null;
}

/**
 * The direction to store: what the form said, else what the addresses imply,
 * and nothing at all for a trip that is not an airport transfer.
 */
export function resolveAirportDirection(
  tripType: string | undefined | null,
  given: string | undefined | null,
  pickup?: string | null,
  drop?: string | null,
): AirportDirection | null {
  if (tripType !== 'AIRPORT') return null;
  if (given === 'TO' || given === 'FROM') return given;
  return inferAirportDirection(pickup, drop);
}
