/**
 * Address lookup and road distance, for the public booking forms.
 *
 * Open to the internet, so everything here is rate limited per address on top
 * of the monthly cap in the service. The cap is the thing that guarantees no
 * spend; the limiter is what stops one visitor burning it in an afternoon.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { limiter } from '../utils/limiter';
import { validateBody } from '../utils/validate';
import { geoUsage, resolvePoint, routeDistance, searchPlaces, type GeoPlace } from '../services/geo';

const router = Router();

const lookupLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 30,
  message: { error: 'Too many address lookups. Please slow down a moment.' },
});

/**
 * Suggestions for what has been typed.
 *
 * The portal's own pickup and drop points come first and always: they are the
 * addresses this office actually uses, they cost nothing, and they work with
 * no internet at all. The map service is only asked for what our own list
 * could not answer.
 */
router.get('/search', lookupLimiter, async (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 2) return res.json({ places: [], capped: false });

  const own = q.all<{ label: string; city: string }>(
    `SELECT label, city FROM locations
      WHERE label LIKE @like COLLATE NOCASE
      ORDER BY use_count DESC, label LIMIT 5`,
    { like: `%${term}%` }
  ).map((r) => ({ label: r.label, city: r.city ?? '', lat: null, lon: null, own: true }));

  // Our own list is enough for a short or obviously local query.
  if (term.length < 3) return res.json({ places: own, capped: false });

  const { places, capped } = await searchPlaces(term);
  const seen = new Set(own.map((o) => o.label.toLowerCase()));
  const remote = (places as GeoPlace[])
    .filter((p) => !seen.has(p.label.toLowerCase()))
    .map((p) => ({ label: p.label, city: p.city, lat: p.lat, lon: p.lon, own: false }));

  res.json({ places: [...own, ...remote].slice(0, 8), capped });
});

/**
 * Either end may be given as coordinates (the customer picked a suggestion) or
 * as plain text (they typed an address and carried on). Text is resolved here,
 * out of the same cache the suggestions come from.
 */
const endSchema = z.object({
  lat: z.number().optional(),
  lon: z.number().optional(),
  text: z.string().trim().optional(),
});

const distanceSchema = z.object({ from: endSchema, to: endSchema });

router.post('/distance', lookupLimiter, validateBody(distanceSchema), async (req, res) => {
  const { from, to } = req.body as z.infer<typeof distanceSchema>;

  let capped = false;
  const resolve = async (e: z.infer<typeof endSchema>) => {
    if (Number.isFinite(e.lat) && Number.isFinite(e.lon)) {
      return { lat: e.lat as number, lon: e.lon as number };
    }
    if (!e.text || e.text.length < 3) return null;
    const r = await resolvePoint(e.text);
    if (r.capped) capped = true;
    return r.point ? { lat: r.point.lat, lon: r.point.lon } : null;
  };

  const a = await resolve(from);
  const b = await resolve(to);
  if (!a || !b) {
    return res.json({ distanceKm: null, durationMin: null, capped, resolved: false });
  }

  const { route, capped: routeCapped } = await routeDistance(a, b);
  res.json({
    distanceKm: route?.distanceKm ?? null,
    durationMin: route?.durationMin ?? null,
    capped: capped || routeCapped,
    resolved: true,
  });
});

/** What is left of this month's allowance. Shown in Settings. */
router.get('/status', (_req, res) => {
  const u = geoUsage();
  res.json({
    ...u,
    cached: {
      places: q.get<{ c: number }>('SELECT COUNT(*) c FROM geo_places')?.c ?? 0,
      routes: q.get<{ c: number }>('SELECT COUNT(*) c FROM geo_routes')?.c ?? 0,
    },
  });
});

export default router;
