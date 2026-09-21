/**
 * Addresses and road distance.
 *
 * WHY NOT GOOGLE MAPS
 * Google Maps Platform will not answer a single request until a billing
 * account with a card on it is attached to the Cloud project — that is true
 * inside the free monthly allowance as well as outside it. Google also offers
 * no hard spend cap, only budget *alerts*. So "use it only while it is free,
 * and never configure a paid service" cannot both be honoured with Google, and
 * the brief says not to configure one. This uses two services that need no
 * account, no key and no card at all:
 *
 *   · Nominatim (OpenStreetMap) to turn typed text into a place with
 *     coordinates.
 *   · OSRM to measure the road distance between two of them.
 *
 * Both are free and both are run as a public good, which means the usage
 * policy is the price. This file pays it:
 *
 *   1. EVERYTHING IS CACHED. The same address, and the same pair of points,
 *      is fetched once and then served from our own tables for ever. A route
 *      the office quotes fifty times costs one request.
 *   2. A HARD MONTHLY CAP WE ENFORCE OURSELVES. Every outbound call is counted
 *      against the calendar month. At the limit the service stops dead and
 *      makes no further call — it does not slow down, it stops. Because the
 *      counter is ours rather than the provider's, this is a guarantee and not
 *      a hope.
 *   3. ONE REQUEST AT A TIME, a second apart, with a User-Agent that says who
 *      we are. That is what Nominatim asks of anyone using it.
 *   4. IT FAILS SOFT. No network, a slow provider, a cap reached — the caller
 *      gets nothing back and the form carries on working by hand. Distance is
 *      a convenience here, never a dependency.
 */
import { q } from '../db';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org/route/v1/driving';

/*
 * INDIA ONLY, AND MAHARASHTRA FIRST.
 *
 * Every trip this business runs starts in Mumbai, so the search is restricted
 * to India outright and then biased towards Maharashtra and the states around
 * it. The bias is a preference, not a fence — somebody asking for Goa, Gujarat
 * or Delhi still finds it, but "station", "airport" and "MG Road" stop
 * offering the wrong half of the country first.
 *
 * The box is west/north/east/south, and `bounded=0` is what makes it a
 * preference rather than a restriction.
 */
const INDIA_ONLY = 'in';
const HOME_VIEWBOX = '72.5,21.5,80.9,15.5';   // Maharashtra and its neighbours

/** Nominatim requires a real identifier. An anonymous caller gets blocked. */
const USER_AGENT = 'GuptaToursAndTravelsPortal/1.0 (booking portal; contact via the website)';

/** Nothing is free if it is slow enough to hold an HTTP request open. */
const TIMEOUT_MS = 6000;
/** Nominatim's published policy: no more than one request a second. */
const MIN_GAP_MS = 1100;

export interface GeoPlace {
  label: string;
  city: string;
  lat: number;
  lon: number;
}

export interface GeoConfig {
  enabled: boolean;
  /** Outbound calls allowed per calendar month, across both services. */
  monthlyLimit: number;
}

function settingsMap(): Record<string, string> {
  try {
    return Object.fromEntries(
      q.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE category = 'maps'")
        .map((r) => [r.key, r.value ?? ''])
    );
  } catch {
    return {};
  }
}

export function geoConfig(): GeoConfig {
  const s = settingsMap();
  const limit = Number(s['maps.monthlyLimit'] ?? '');
  return {
    enabled: (s['maps.enabled'] ?? 'true').toLowerCase() !== 'false',
    // Deliberately well under what either service would tolerate. The office
    // can raise it in Settings; it can never turn into a bill.
    monthlyLimit: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 2000,
  };
}

/** 'YYYY-MM' in local time — the month the office is actually living in. */
function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export interface GeoUsage {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  enabled: boolean;
  /** True when nothing further will be fetched this month. */
  capped: boolean;
}

export function geoUsage(): GeoUsage {
  const cfg = geoConfig();
  const month = monthKey();
  const row = q.get<{ searches: number; routes: number }>(
    'SELECT searches, routes FROM geo_usage WHERE month = @m',
    { m: month }
  );
  const used = (row?.searches ?? 0) + (row?.routes ?? 0);
  const remaining = Math.max(0, cfg.monthlyLimit - used);
  return {
    month,
    used,
    limit: cfg.monthlyLimit,
    remaining,
    enabled: cfg.enabled,
    capped: !cfg.enabled || remaining <= 0,
  };
}

/**
 * Take one unit of the month's allowance.
 *
 * Returns false when there is none left, and the caller must then make no
 * request at all. The row is written before the call goes out, so a crash
 * mid-request cannot leak an uncounted one.
 */
function takeAllowance(kind: 'searches' | 'routes'): boolean {
  const cfg = geoConfig();
  if (!cfg.enabled) return false;

  const month = monthKey();
  q.run(
    `INSERT INTO geo_usage (month, searches, routes) VALUES (@m, 0, 0)
     ON CONFLICT(month) DO NOTHING`,
    { m: month }
  );
  const row = q.get<{ searches: number; routes: number }>(
    'SELECT searches, routes FROM geo_usage WHERE month = @m',
    { m: month }
  )!;
  if ((row.searches ?? 0) + (row.routes ?? 0) >= cfg.monthlyLimit) return false;

  q.run(
    `UPDATE geo_usage SET ${kind} = ${kind} + 1, updated_at = datetime('now') WHERE month = @m`,
    { m: month }
  );
  return true;
}

/* --------------------------------------------------------------------------
   One outbound call at a time, a second apart.
   -------------------------------------------------------------------------- */
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function serialise<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await job();
    } finally {
      lastCall = Date.now();
    }
  });
  // Keep the chain alive even when a job rejects.
  queue = run.catch(() => undefined);
  return run;
}

async function getJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;   // offline, blocked, slow — the caller carries on without it
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------------
   Searching for a place
   -------------------------------------------------------------------------- */

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Places matching what the customer typed.
 *
 * Answers from our own cache for ever after the first time. India only — this
 * business does not run trips anywhere else, and restricting it makes the
 * short queries people actually type ("andheri") far more accurate.
 */
export async function searchPlaces(term: string): Promise<{ places: GeoPlace[]; capped: boolean }> {
  const key = normalise(term);
  if (key.length < 3) return { places: [], capped: false };

  const hit = q.get<{ payload: string }>('SELECT payload FROM geo_places WHERE query = @k', { k: key });
  if (hit) {
    try { return { places: JSON.parse(hit.payload) as GeoPlace[], capped: false }; } catch { /* refetch */ }
  }

  if (!takeAllowance('searches')) return { places: [], capped: true };

  const url = `${NOMINATIM}?q=${encodeURIComponent(term)}&format=jsonv2&limit=8`
    + `&countrycodes=${INDIA_ONLY}&addressdetails=1`
    + `&viewbox=${HOME_VIEWBOX}&bounded=0`
    // Indian places carry names in several scripts. Asking for en-IN keeps the
    // list in one alphabet instead of mixing Devanagari into it.
    + '&accept-language=en-IN';
  const raw = await serialise(() => getJson(url));
  if (!Array.isArray(raw)) return { places: [], capped: false };

  /*
   * An Indian display_name runs to eight or nine parts:
   *
   *   "Andheri East, K/E Ward, Mumbai Zone 3, Mumbai, Mumbai Suburban
   *    District, Maharashtra, 400069, India"
   *
   * Taking the first three of those gave "Andheri East, K/E Ward, Mumbai Zone
   * 3" — two administrative divisions nobody says out loud, and no city. So
   * the label is built from the parts that a person would actually use to
   * describe where they are, and the state and PIN code go on the second line
   * where they settle which Shivaji Nagar this is.
   */
  const places: GeoPlace[] = raw
    .map((r: any) => {
      const a = r.address ?? {};
      const first = String(r.name ?? '').trim()
        || String(r.display_name ?? '').split(',')[0].trim();

      const area = a.suburb || a.neighbourhood || a.village || a.town || a.city_district || '';
      const city = a.city || a.town || a.municipality || a.state_district || '';
      const road = a.road || '';

      // In order, skipping anything already said and anything empty.
      const parts: string[] = [];
      for (const part of [first, road, area, city]) {
        const t = String(part).trim();
        if (t && !parts.some((x) => x.toLowerCase() === t.toLowerCase())) parts.push(t);
      }

      const state = String(a.state ?? '').trim();
      const pin = String(a.postcode ?? '').trim();

      return {
        label: parts.slice(0, 3).join(', '),
        city: [state, pin].filter(Boolean).join(' '),
        lat: Number(r.lat),
        lon: Number(r.lon),
      };
    })
    .filter((p) => p.label && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    // Two entries reading identically help nobody choose.
    .filter((p, i, all) => all.findIndex((x) => x.label.toLowerCase() === p.label.toLowerCase()) === i)
    .slice(0, 6);

  q.run(
    'INSERT INTO geo_places (query, payload) VALUES (@k, @p) ON CONFLICT(query) DO UPDATE SET payload = @p',
    { k: key, p: JSON.stringify(places) }
  );
  return { places, capped: false };
}

/**
 * The single best point for a piece of typed text.
 *
 * Customers type an address and move on without touching the suggestions, and
 * the portal's own saved locations have no coordinates of their own. Both end
 * up here, and because the search itself is cached, resolving the same address
 * again is free.
 */
export async function resolvePoint(
  text: string
): Promise<{ point: GeoPlace | null; capped: boolean }> {
  const { places, capped } = await searchPlaces(text);
  return { point: places[0] ?? null, capped };
}

/* --------------------------------------------------------------------------
   Measuring the road between two of them
   -------------------------------------------------------------------------- */

export interface RouteResult {
  distanceKm: number;
  durationMin: number;
}

/** Five decimal places is about a metre — far finer than any address needs. */
const coord = (n: number) => n.toFixed(5);

export async function routeDistance(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<{ route: RouteResult | null; capped: boolean }> {
  const key = `${coord(from.lat)},${coord(from.lon)}>${coord(to.lat)},${coord(to.lon)}`;

  const hit = q.get<{ distance_km: number; duration_min: number }>(
    'SELECT distance_km, duration_min FROM geo_routes WHERE route_key = @k',
    { k: key }
  );
  if (hit) {
    return { route: { distanceKm: hit.distance_km, durationMin: hit.duration_min }, capped: false };
  }

  if (!takeAllowance('routes')) return { route: null, capped: true };

  const url = `${OSRM}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const raw = await serialise(() => getJson(url));
  const leg = raw?.routes?.[0];
  if (!leg || !Number.isFinite(leg.distance)) return { route: null, capped: false };

  const route: RouteResult = {
    distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
    durationMin: Math.round(leg.duration / 60),
  };

  q.run(
    `INSERT INTO geo_routes (route_key, distance_km, duration_min)
     VALUES (@k, @d, @m) ON CONFLICT(route_key) DO NOTHING`,
    { k: key, d: route.distanceKm, m: route.durationMin }
  );
  return { route, capped: false };
}
