/**
 * Admin - the outstation fixed-fare master.
 *
 * One route (Mumbai -> Lonavala) carries four category rows. The admin page
 * edits a whole route at a time, so the API does too: save a route, add a
 * route, remove a route. Leaving a fare empty stores NULL, which the website
 * shows as Fare on request.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import {
  CATEGORIES, CATEGORY_VEHICLES, groupedRoutes, routeKeyFor,
} from '../services/outstationFares';

const router = Router();
router.use(requireAuth);

/** Blank means "not priced yet"; anything else must be a sensible amount. */
const fare = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? null : v),
  z.coerce.number({ invalid_type_error: 'Fares must be numbers.' })
    .min(0, 'A fare cannot be negative.')
    .max(999_999, 'That fare looks unrealistically large - please check it.')
    .nullable(),
);

const rowSchema = z.object({
  category: z.enum(CATEGORIES),
  vehicles: z.string().trim().min(2, 'Name the vehicles in this category.').max(80),
  oneWay: fare,
  return: fare,
  tollIncluded: z.coerce.boolean().default(true),
  isActive: z.coerce.boolean().default(true),
});

const routeSchema = z.object({
  origin: z.string().trim().min(2).max(60).default('Mumbai'),
  destination: z.string().trim().min(2, 'Enter the destination, e.g. Lonavala.').max(60),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
  fares: z.array(rowSchema).max(CATEGORIES.length).default([]),
});

router.get('/', requirePermission('vendors.view'), (_req, res) => {
  res.json({ data: groupedRoutes(false) });
});

function saveRoute(key: string, b: z.infer<typeof routeSchema>) {
  q.tx(() => {
    for (const category of CATEGORIES) {
      const row = b.fares.find((f) => f.category === category);
      q.run(
        `INSERT INTO outstation_fares
           (route_key, origin, destination, category, vehicles, one_way_fare, return_fare,
            toll_included, is_active, display_order)
         VALUES (@key, @origin, @destination, @category, @vehicles, @oneWay, @ret, @toll, @active, @order)
         ON CONFLICT(route_key, category) DO UPDATE SET
           origin = excluded.origin, destination = excluded.destination,
           vehicles = excluded.vehicles, one_way_fare = excluded.one_way_fare,
           return_fare = excluded.return_fare, toll_included = excluded.toll_included,
           is_active = excluded.is_active, display_order = excluded.display_order,
           updated_at = datetime('now')`,
        {
          key, origin: b.origin, destination: b.destination, category,
          vehicles: row?.vehicles ?? CATEGORY_VEHICLES[category],
          oneWay: row?.oneWay ?? null,
          ret: row?.return ?? null,
          toll: row ? (row.tollIncluded ? 1 : 0) : 1,
          active: row ? (row.isActive ? 1 : 0) : 1,
          order: b.displayOrder,
        }
      );
    }
  });
}

// --- add a route -------------------------------------------------------------
router.post('/', requirePermission('vendors.update'), validateBody(routeSchema), (req, res) => {
  const b = req.body as z.infer<typeof routeSchema>;
  const key = routeKeyFor(b.destination);
  if (!key) return res.status(400).json({ error: 'Enter a destination name.' });
  if (q.get('SELECT 1 FROM outstation_fares WHERE route_key = @key', { key })) {
    return res.status(409).json({ error: `A route to ${b.destination} already exists.` });
  }
  if (!b.displayOrder) {
    b.displayOrder = (q.get<{ m: number }>('SELECT MAX(display_order) AS m FROM outstation_fares')?.m ?? 0) + 10;
  }
  saveRoute(key, b);
  audit(req, 'OUTSTATION_FARE_UPDATED', { entityType: 'outstation_route', description: `Added route ${b.origin} -> ${b.destination}` });
  res.status(201).json({ ok: true, key });
});

// --- save a route -------------------------------------------------------------
router.put('/:key', requirePermission('vendors.update'), validateBody(routeSchema), (req, res) => {
  const key = String(req.params.key);
  if (!q.get('SELECT 1 FROM outstation_fares WHERE route_key = @key', { key })) {
    return res.status(404).json({ error: 'That route no longer exists.' });
  }
  const b = req.body as z.infer<typeof routeSchema>;
  saveRoute(key, b);
  audit(req, 'OUTSTATION_FARE_UPDATED', {
    entityType: 'outstation_route',
    description: `Updated fares for ${b.origin} -> ${b.destination}`,
    meta: b.fares,
  });
  res.json({ ok: true });
});

// --- remove a route -----------------------------------------------------------
router.delete('/:key', requirePermission('vendors.delete'), (req, res) => {
  const key = String(req.params.key);
  const info = q.run('DELETE FROM outstation_fares WHERE route_key = @key', { key });
  if (!info.changes) return res.status(404).json({ error: 'That route no longer exists.' });
  audit(req, 'OUTSTATION_FARE_UPDATED', { entityType: 'outstation_route', description: `Removed route ${key}` });
  res.json({ ok: true });
});

export default router;
