/**
 * Outstation fixed fares, as the website reads them.
 *
 * The prices are not here. They come from the admin's Outstation fares master
 * through /public/outstation-fares; this file only knows the shape, the order
 * the categories are shown in, and how to talk about each one.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export type FareCategory = 'STANDARD' | 'SUV_MUV' | 'PREMIUM_SEDAN' | 'PREMIUM_MUV';
export type Leg = 'ONE_WAY' | 'RETURN';

export interface RouteFare {
  category: FareCategory;
  vehicles: string;
  /** null = not priced yet, shown as Fare on request. */
  oneWay: number | null;
  return: number | null;
  tollIncluded: boolean;
}

export interface OutstationRoute {
  key: string;
  origin: string;
  destination: string;
  fares: RouteFare[];
}

/**
 * Standard before SUV / MUV before Premium, always. Ertiga and XL6 are SUV /
 * MUV, not premium - the office was explicit about that.
 */
export const CATEGORY_META: Record<FareCategory, {
  group: string; label: string; blurb: string; seats: number; order: number;
}> = {
  STANDARD: { group: 'Standard Cab', label: 'Standard', blurb: 'Comfortable sedan for up to 4', seats: 4, order: 0 },
  SUV_MUV: { group: 'SUV / MUV', label: 'SUV / MUV', blurb: 'Room for 6, with luggage', seats: 6, order: 1 },
  PREMIUM_SEDAN: { group: 'Premium Cab', label: 'Premium sedan', blurb: 'A roomier, quieter sedan for up to 4', seats: 4, order: 2 },
  PREMIUM_MUV: { group: 'Premium Cab', label: 'Premium MUV', blurb: 'Captain seats and space for 6', seats: 6, order: 3 },
};

/** Which of our vehicles sit in each fare category, in the order shown. */
export const CATEGORY_VEHICLES: Record<FareCategory, string[]> = {
  STANDARD: ['dzire', 'aura'],
  SUV_MUV: ['ertiga', 'xl6'],
  PREMIUM_SEDAN: ['honda-city', 'ciaz'],
  PREMIUM_MUV: ['innova-crysta', 'carens'],
};

/** A vehicle's fare category, or undefined when it has no fixed route fare. */
export const fareCategoryOf = (slug: string): FareCategory | undefined =>
  (Object.keys(CATEGORY_VEHICLES) as FareCategory[]).find((c) => CATEGORY_VEHICLES[c].includes(slug));

export const legLabel = (leg: Leg) => (leg === 'RETURN' ? 'Return' : 'One way');

export const fareOf = (f: RouteFare, leg: Leg) => (leg === 'RETURN' ? f.return : f.oneWay);

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

export const routeLabel = (r: Pick<OutstationRoute, 'origin' | 'destination'>) => `${r.origin} → ${r.destination}`;

/** The landing page for one fixed-fare route, e.g. /cabs/mumbai-to-pune. */
export const routeLandingPath = (key: string) => `/cabs/mumbai-to-${key}`;

/** Where the landing page's "see cabs" button goes: that route, straight to the cabs. */
export const routeBookingPath = (key: string, leg: Leg = 'ONE_WAY') =>
  `/outstation?tab=OUTSTATION&leg=${leg}&route=${encodeURIComponent(key)}`;

/**
 * The routes linked from the footer. Only names and keys - no prices - so the
 * footer does not have to fetch the fares on every page. A route the office
 * later removes still lands on a page that says so and links to /outstation.
 */
export const POPULAR_ROUTES: { key: string; destination: string }[] = [
  { key: 'pune', destination: 'Pune' },
  { key: 'lonavala', destination: 'Lonavala' },
  { key: 'nashik', destination: 'Nashik' },
  { key: 'alibaug', destination: 'Alibaug' },
  { key: 'shirdi', destination: 'Shirdi' },
  { key: 'mahabaleshwar', destination: 'Mahabaleshwar' },
  { key: 'surat', destination: 'Surat' },
  { key: 'ahmedabad', destination: 'Ahmedabad' },
];

let cache: Promise<OutstationRoute[]> | null = null;

function fetchRoutes(): Promise<OutstationRoute[]> {
  if (!cache) {
    cache = api.get('/public/outstation-fares')
      .then(({ data }) => (data?.data ?? []) as OutstationRoute[])
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export function useOutstationRoutes() {
  const [routes, setRoutes] = useState<OutstationRoute[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchRoutes()
      .then((r) => { if (alive) setRoutes(r); })
      .catch(() => { if (alive) { setFailed(true); setRoutes([]); } });
    return () => { alive = false; };
  }, []);
  return { routes, failed };
}

/** The lowest priced fare on a route for this leg, or null when none is priced. */
export function cheapest(r: OutstationRoute, leg: Leg): number | null {
  const nums = r.fares.map((f) => fareOf(f, leg)).filter((n): n is number => n != null);
  return nums.length ? Math.min(...nums) : null;
}

/** The route whose destination the customer already typed as their drop, if any. */
export function matchRoute(routes: OutstationRoute[], drop: string): OutstationRoute | undefined {
  const d = drop.trim().toLowerCase();
  if (!d) return undefined;
  return routes.find((r) => d.includes(r.destination.toLowerCase()));
}
