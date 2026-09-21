/**
 * The trip, carried in the URL.
 *
 * Keeping pickup, drop, date and group size in the query string means a search
 * is a link: the person planning the trip can send it to the person paying for
 * it, and both see the same vehicles and the same estimate. It also means the
 * back button behaves, and a reload does not lose the requirement.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { PlanType } from './catalog';
import { lookupDistance } from './places';
import { dmySlash } from '../lib/format';
import { HOURLY_PACKAGES, isBookTab, type BookTab } from './QuickBook';
import type { EstimateInput } from './kit';

export interface TripParams {
  tab: BookTab;
  from: string;
  to: string;
  date: string;
  time: string;
  returnDate: string;
  pax: number;
  plan: string;
  flight: string;
  /** OUTSTATION: whether the trip comes back. */
  leg: 'ONE_WAY' | 'RETURN';
  /** Extra pickups or drops on the way, in the order they were added. */
  stops: string[];
  /** AIRPORT: which airport, and which way. */
  airport: string;
  direction: 'TO' | 'FROM';
}

export function readTrip(params: URLSearchParams): TripParams {
  const tab = params.get('tab');
  return {
    tab: isBookTab(tab) ? tab : 'LOCAL',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    date: params.get('date') ?? '',
    time: params.get('time') ?? '',
    returnDate: params.get('return') ?? '',
    pax: Math.max(1, Number(params.get('pax') ?? 2) || 2),
    plan: params.get('plan') ?? '',
    flight: params.get('flight') ?? '',
    leg: params.get('leg') === 'RETURN' ? 'RETURN' : 'ONE_WAY',
    stops: (params.get('stops') ?? '').split('|').map((s) => s.trim()).filter(Boolean),
    airport: params.get('airport') ?? '',
    direction: params.get('dir') === 'FROM' ? 'FROM' : 'TO',
  };
}

export function useTripParams(): TripParams {
  const [params] = useSearchParams();
  return useMemo(() => readTrip(params), [params.toString()]);
}

export function tripQuery(t: Partial<TripParams>): string {
  const q = new URLSearchParams();
  if (t.tab) q.set('tab', t.tab);
  if (t.from) q.set('from', t.from);
  if (t.to) q.set('to', t.to);
  if (t.date) q.set('date', t.date);
  if (t.time) q.set('time', t.time);
  if (t.returnDate) q.set('return', t.returnDate);
  if (t.pax) q.set('pax', String(t.pax));
  if (t.plan) q.set('plan', t.plan);
  if (t.flight) q.set('flight', t.flight);
  if (t.leg === 'RETURN') q.set('leg', 'RETURN');
  if (t.stops?.length) q.set('stops', t.stops.join(' | '));
  if (t.airport) q.set('airport', t.airport);
  if (t.direction === 'FROM') q.set('dir', 'FROM');
  return q.toString();
}

export const PLAN_FOR: Record<BookTab, PlanType> = {
  LOCAL: 'LOCAL',
  HOURLY: 'LOCAL',
  AIRPORT: 'AIRPORT',
  OUTSTATION: 'OUTSTATION',
};

export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 1;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/**
 * What the estimate is worked out against.
 *
 * Distance is looked up from the destinations we publish, and doubled for a
 * round trip. Anywhere not on that list returns no distance, and the estimate
 * then falls back to the daily minimum rather than guessing a number.
 */
export function estimateInputFor(
  trip: Pick<TripParams, 'tab' | 'to' | 'date' | 'returnDate' | 'plan'>
): EstimateInput {
  const plan = PLAN_FOR[trip.tab];

  if (plan === 'OUTSTATION') {
    const oneWay = lookupDistance(trip.to);
    const days = daysBetween(trip.date, trip.returnDate);
    return { plan, days, distanceKm: oneWay ? oneWay * (trip.returnDate ? 2 : 1) : undefined };
  }

  if (trip.tab === 'HOURLY') {
    const pkg = HOURLY_PACKAGES.find((p) => p.key === trip.plan);
    // The 12-hour package is quoted as the 8-hour one plus the extra hours.
    return { plan, extraHours: pkg && pkg.hours > 8 ? pkg.hours - 8 : 0 };
  }

  return { plan };
}

/** The one-line trip summary used in headers and requirement text. */
export function tripSummary(t: TripParams): string[] {
  const pkg = HOURLY_PACKAGES.find((p) => p.key === t.plan);
  return [
    t.date || '',
    t.time || '',
    t.returnDate ? `Return ${t.returnDate}` : '',
    `${t.pax} ${t.pax === 1 ? 'passenger' : 'passengers'}`,
    pkg?.label ?? '',
    t.flight ? `Flight ${t.flight}` : '',
    t.stops?.length ? `${t.stops.length} extra ${t.stops.length === 1 ? 'stop' : 'stops'}` : '',
  ].filter(Boolean);
}

/**
 * The same trip, as fields for the WhatsApp enquiry sheet.
 *
 * `tripMessage` writes the chat text; this fills the short form that now runs
 * in front of it, so a customer who has already told the site where and when
 * does not answer those questions twice.
 */
export function tripPrefill(t: TripParams, vehicle?: string) {
  // Only what the sheet has no field of its own for. The passenger count used
  // to be listed here too and then appeared twice — once in its own box and
  // once as a note saying the same thing.
  const extras = [
    t.stops.length ? `Also stopping at: ${t.stops.join(', ')}` : '',
    t.flight ? `Flight ${t.flight}` : '',
    t.plan ? HOURLY_PACKAGES.find((p) => p.key === t.plan)?.label ?? '' : '',
    t.returnDate ? `Returning ${dmySlash(t.returnDate)}` : '',
  ].filter(Boolean);

  return {
    pickup: t.from,
    drop: t.to,
    date: t.date,
    time: t.time,
    vehicleType: vehicle,
    passengers: t.pax,
    message: extras.join('\n'),
  };
}
