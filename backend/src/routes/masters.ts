/**
 * Masters — the configurable reference data the rest of the portal reads.
 *
 *   /api/masters/categories   vehicle / cab categories
 *   /api/masters/lists        reusable lists (trip types, payment methods, ...)
 *   /api/masters/export/...   Excel exports of the above and of the fare rules
 *
 * A master row that is already used by trips, fare rules, vehicles or invoices
 * is never deleted: removing it is refused with the reason, and deactivating
 * it is offered instead, so history keeps pointing at something real.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import { sendTable } from '../utils/exportSheet';
import { LIST_TYPES } from '../services/bootstrap';

const router = Router();
router.use(requireAuth);

// The rate master and its lists used to sit behind the vendor permissions.
// Both are accepted so no existing account loses access.
const canView = requirePermission('masters.view', 'vendors.view');
const canCreate = requirePermission('masters.create', 'vendors.update');
const canUpdate = requirePermission('masters.update', 'vendors.update');
const canDelete = requirePermission('masters.delete', 'vendors.delete');

/* ==========================================================================
   Vehicle categories
   ========================================================================== */

function categoryUsage(id: number) {
  return q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM vehicles WHERE category_id = @id) AS vehicles,
       (SELECT COUNT(*) FROM vehicles WHERE category_id = @id AND is_active = 1) AS active_vehicles,
       (SELECT COUNT(*) FROM rate_cards WHERE category_id = @id) AS fare_rules,
       (SELECT COUNT(*) FROM bookings WHERE vehicle_category_id = @id) AS trips,
       (SELECT COUNT(*) FROM bookings WHERE vehicle_category_id = @id AND booking_status = 'INQUIRY') AS enquiries,
       (SELECT COUNT(DISTINCT ii.invoice_id) FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
         JOIN invoices i ON i.id = ii.invoice_id
        WHERE b.vehicle_category_id = @id AND i.status <> 'CANCELLED') AS invoices`,
    { id }
  )!;
}

router.get('/categories', canView, (req, res) => {
  const includeInactive = String(req.query.all ?? '1') === '1';
  const rows = q.all<any>(
    `SELECT vc.*,
            (SELECT COUNT(*) FROM vehicles v WHERE v.category_id = vc.id) AS vehicle_count,
            (SELECT COUNT(*) FROM rate_cards r WHERE r.category_id = vc.id AND r.is_active = 1) AS rule_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_category_id = vc.id) AS trip_count
       FROM vehicle_categories vc
      ${includeInactive ? '' : 'WHERE vc.is_active = 1'}
      ORDER BY vc.is_active DESC, vc.display_order, vc.name`
  );
  res.json({ data: rows });
});

router.get('/categories/:id', canView, (req, res) => {
  const id = Number(req.params.id);
  const cat = q.get<any>('SELECT * FROM vehicle_categories WHERE id = @id', { id });
  if (!cat) return res.status(404).json({ error: 'That category does not exist.' });
  res.json({
    data: cat,
    usage: categoryUsage(id),
    vehicles: q.all<any>(
      `SELECT v.id, v.vehicle_number, v.model, v.ownership_type, v.is_active, v.availability_status, vd.vendor_name
         FROM vehicles v LEFT JOIN vendors vd ON vd.id = v.vendor_id
        WHERE v.category_id = @id ORDER BY v.is_active DESC, v.vehicle_number`, { id }
    ),
    rules: q.all<any>(
      `SELECT r.id, r.plan_type, r.plan_label, r.base_fare, r.per_km_rate, r.is_active, v.vendor_name
         FROM rate_cards r JOIN vendors v ON v.id = r.vendor_id
        WHERE r.category_id = @id ORDER BY v.vendor_name, r.plan_type, r.plan_label`, { id }
    ),
    recentTrips: q.all<any>(
      `SELECT b.id, b.trip_id, b.travel_date, b.booking_status, b.customer_name, b.passenger_name
         FROM bookings b WHERE b.vehicle_category_id = @id ORDER BY b.travel_date DESC LIMIT 10`, { id }
    ),
  });
});

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Enter the category name.').max(60),
  code: z.string().trim().max(30).optional().default(''),
  segment: z.string().trim().max(40).optional().default(''),
  seating: z.coerce.number().int().min(1, 'Seating must be at least 1.').max(80).nullable().optional(),
  luggage: z.coerce.number().int().min(0).max(80).nullable().optional(),
  exampleModels: z.string().trim().max(200).optional().default(''),
  aliases: z.string().trim().max(400).optional().default(''),
  outstationGroup: z.enum(['', 'STANDARD', 'SUV_MUV', 'PREMIUM_SEDAN', 'PREMIUM_MUV']).optional().default(''),
  description: z.string().trim().max(400).optional().default(''),
  isActive: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

const toCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
/** Aliases are typed one per line or comma separated; stored pipe-separated and lower-case. */
const aliasList = (s: string) =>
  Array.from(new Set(s.split(/[,|\n]/).map((a) => a.trim().toLowerCase()).filter(Boolean))).join('|');

router.post('/categories', canCreate, validateBody(categorySchema), (req, res) => {
  const b = req.body as z.infer<typeof categorySchema>;
  const code = toCode(b.code || b.name);
  const dup = q.get<any>(
    'SELECT name FROM vehicle_categories WHERE lower(name) = lower(@n) OR code = @c', { n: b.name, c: code }
  );
  if (dup) return res.status(409).json({ error: `A category called "${dup.name}" already exists.` });

  const info = q.run(
    `INSERT INTO vehicle_categories (code, name, segment, seating, luggage, example_models, aliases,
        outstation_group, description, is_active, display_order)
     VALUES (@code, @name, @segment, @seating, @luggage, @models, @aliases, @group, @desc, @active, @order)`,
    {
      code, name: b.name, segment: b.segment || null, seating: b.seating ?? null, luggage: b.luggage ?? null,
      models: b.exampleModels || null, aliases: aliasList(b.aliases) || null,
      group: b.outstationGroup || null, desc: b.description || null,
      active: b.isActive ? 1 : 0, order: b.displayOrder,
    }
  );
  audit(req, 'MASTER_CREATED', { entityType: 'vehicle_category', entityId: Number(info.lastInsertRowid), description: b.name });
  res.status(201).json({ data: q.get('SELECT * FROM vehicle_categories WHERE id = @id', { id: info.lastInsertRowid }) });
});

router.put('/categories/:id', canUpdate, validateBody(categorySchema), (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM vehicle_categories WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That category does not exist.' });
  const b = req.body as z.infer<typeof categorySchema>;

  const dup = q.get<any>(
    'SELECT name FROM vehicle_categories WHERE lower(name) = lower(@n) AND id <> @id', { n: b.name, id }
  );
  if (dup) return res.status(409).json({ error: `Another category is already called "${dup.name}".` });

  // The code is what links rate cards and the outstation fares; once a category
  // is in use it keeps its code even if renamed.
  const used = categoryUsage(id);
  const inUse = used.trips + used.fare_rules + used.vehicles > 0;
  const code = inUse ? existing.code : toCode(b.code || b.name);

  q.run(
    `UPDATE vehicle_categories SET code=@code, name=@name, segment=@segment, seating=@seating, luggage=@luggage,
        example_models=@models, aliases=@aliases, outstation_group=@group, description=@desc,
        is_active=@active, display_order=@order, updated_at=datetime('now')
      WHERE id=@id`,
    {
      id, code, name: b.name, segment: b.segment || null, seating: b.seating ?? null, luggage: b.luggage ?? null,
      models: b.exampleModels || null, aliases: aliasList(b.aliases) || null,
      group: b.outstationGroup || null, desc: b.description || null,
      active: b.isActive ? 1 : 0, order: b.displayOrder,
    }
  );
  // Historic text on bookings and invoices is deliberately NOT renamed. Fare
  // rules show the category name, so those follow a rename.
  if (existing.name !== b.name) {
    q.run(`UPDATE rate_cards SET vehicle_category = @n, updated_at = datetime('now') WHERE category_id = @id`, { n: b.name, id });
  }
  audit(req, 'MASTER_UPDATED', {
    entityType: 'vehicle_category', entityId: id,
    description: `${existing.name}${existing.name !== b.name ? ` renamed to ${b.name}` : ''}${!!existing.is_active !== b.isActive ? (b.isActive ? ' — activated' : ' — deactivated') : ''}`,
  });
  res.json({ data: q.get('SELECT * FROM vehicle_categories WHERE id = @id', { id }) });
});

router.delete('/categories/:id', canDelete, (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM vehicle_categories WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That category does not exist.' });
  const u = categoryUsage(id);
  const refs = [
    u.trips && `${u.trips} trip(s)`, u.fare_rules && `${u.fare_rules} fare rule(s)`,
    u.vehicles && `${u.vehicles} vehicle(s)`, u.invoices && `${u.invoices} invoice(s)`,
  ].filter(Boolean);
  if (refs.length) {
    return res.status(409).json({
      error: `"${existing.name}" is used by ${refs.join(', ')}, so it cannot be removed — history must keep pointing at it. Deactivate it instead; it then cannot be chosen for anything new.`,
      code: 'IN_USE',
      usage: u,
    });
  }
  q.run('DELETE FROM vehicle_categories WHERE id = @id', { id });
  audit(req, 'MASTER_DELETED', { entityType: 'vehicle_category', entityId: id, description: existing.name });
  res.json({ ok: true, message: `"${existing.name}" removed.` });
});

/* ==========================================================================
   Reusable lists
   ========================================================================== */

router.get('/lists', canView, (_req, res) => {
  const rows = q.all<any>('SELECT * FROM master_values ORDER BY list_type, sort_order, label');
  res.json({
    types: Object.entries(LIST_TYPES).map(([type, d]) => ({
      type, label: d.label, description: d.description,
      count: rows.filter((r) => r.list_type === type).length,
    })),
    data: rows,
  });
});

/**
 * Active values of one list — readable by anyone signed in, because the
 * booking, payment and fleet forms all need them to render their dropdowns.
 */
router.get('/lists/:type/options', (req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT code, label FROM master_values WHERE list_type = @t AND is_active = 1 ORDER BY sort_order, label`,
      { t: String(req.params.type).toUpperCase() }
    ),
  });
});

const valueSchema = z.object({
  code: z.string().trim().max(40).optional().default(''),
  label: z.string().trim().min(1, 'Enter a label.').max(80),
  description: z.string().trim().max(300).optional().default(''),
  isActive: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

router.post('/lists/:type', canCreate, validateBody(valueSchema), (req, res) => {
  const type = String(req.params.type).toUpperCase();
  if (!LIST_TYPES[type]) return res.status(400).json({ error: `Unknown list "${type}".` });
  const b = req.body as z.infer<typeof valueSchema>;
  const code = toCode(b.code || b.label);
  if (!code) return res.status(400).json({ error: 'Enter a code or a label made of letters or numbers.' });
  if (q.get('SELECT id FROM master_values WHERE list_type = @t AND code = @c', { t: type, c: code })) {
    return res.status(409).json({ error: `${LIST_TYPES[type].label} already has a value with code ${code}.` });
  }
  if (q.get('SELECT id FROM master_values WHERE list_type = @t AND lower(label) = lower(@l)', { t: type, l: b.label })) {
    return res.status(409).json({ error: `${LIST_TYPES[type].label} already has "${b.label}".` });
  }
  const info = q.run(
    `INSERT INTO master_values (list_type, code, label, description, is_system, is_active, sort_order)
     VALUES (@t, @c, @l, @d, 0, @a, @s)`,
    { t: type, c: code, l: b.label, d: b.description || null, a: b.isActive ? 1 : 0, s: b.sortOrder }
  );
  audit(req, 'MASTER_CREATED', { entityType: 'master_value', entityId: Number(info.lastInsertRowid), description: `${type}: ${b.label}` });
  res.status(201).json({ data: q.get('SELECT * FROM master_values WHERE id = @id', { id: info.lastInsertRowid }) });
});

router.put('/lists/:type/:id', canUpdate, validateBody(valueSchema), (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM master_values WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That value does not exist.' });
  const b = req.body as z.infer<typeof valueSchema>;
  if (q.get('SELECT id FROM master_values WHERE list_type = @t AND lower(label) = lower(@l) AND id <> @id',
    { t: existing.list_type, l: b.label, id })) {
    return res.status(409).json({ error: `Another value is already labelled "${b.label}".` });
  }
  // System codes are what the application logic branches on: label, order and
  // active flag may change; the code never does.
  q.run(
    `UPDATE master_values SET label=@l, description=@d, is_active=@a, sort_order=@s, updated_at=datetime('now')
      WHERE id=@id`,
    { l: b.label, d: b.description || null, a: b.isActive ? 1 : 0, s: b.sortOrder, id }
  );
  audit(req, 'MASTER_UPDATED', { entityType: 'master_value', entityId: id, description: `${existing.list_type}: ${existing.label} → ${b.label}` });
  res.json({ data: q.get('SELECT * FROM master_values WHERE id = @id', { id }) });
});

/** Where a list value is in use, so it is never deleted out from under history. */
function valueUsage(type: string, code: string): number {
  switch (type) {
    case 'TRIP_TYPE': return q.get<any>('SELECT COUNT(*) c FROM bookings WHERE trip_type = @c', { c: code })!.c;
    case 'BOOKING_SOURCE': return q.get<any>('SELECT COUNT(*) c FROM bookings WHERE inquiry_source = @c', { c: code })!.c;
    case 'PAYMENT_MODE': return q.get<any>(
      'SELECT (SELECT COUNT(*) FROM payments WHERE mode = @c) + (SELECT COUNT(*) FROM supplier_payments WHERE mode = @c) c', { c: code })!.c;
    case 'CANCELLATION_REASON': return q.get<any>('SELECT COUNT(*) c FROM bookings WHERE cancel_reason = @c', { c: code })!.c;
    case 'BRANCH': return q.get<any>('SELECT COUNT(*) c FROM bookings WHERE branch = @c', { c: code })!.c;
    case 'FUEL_TYPE': return q.get<any>('SELECT COUNT(*) c FROM vehicles WHERE fuel_type = @c', { c: code })!.c;
    case 'OWNERSHIP_TYPE': return q.get<any>('SELECT COUNT(*) c FROM vehicles WHERE ownership_type = @c', { c: code })!.c;
    default: return 0;
  }
}

router.delete('/lists/:type/:id', canDelete, (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM master_values WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That value does not exist.' });
  if (existing.is_system) {
    return res.status(409).json({ error: `"${existing.label}" is built in — the portal relies on it. Deactivate it instead.` });
  }
  const used = valueUsage(existing.list_type, existing.code);
  if (used > 0) {
    return res.status(409).json({ error: `"${existing.label}" is used on ${used} record(s). Deactivate it instead.`, code: 'IN_USE' });
  }
  q.run('DELETE FROM master_values WHERE id = @id', { id });
  audit(req, 'MASTER_DELETED', { entityType: 'master_value', entityId: id, description: `${existing.list_type}: ${existing.label}` });
  res.json({ ok: true });
});

/* ==========================================================================
   Locations — the pickup/drop suggestions
   ========================================================================== */

router.get('/locations', canView, (req, res) => {
  const search = String(req.query.search ?? '').trim();
  res.json({
    data: q.all<any>(
      `SELECT * FROM locations WHERE (@s = '' OR label LIKE '%'||@s||'%')
        ORDER BY use_count DESC, label LIMIT 500`, { s: search }
    ),
  });
});

router.put('/locations/:id', canUpdate, (req, res) => {
  const id = Number(req.params.id);
  const label = String(req.body?.label ?? '').trim();
  const kind = String(req.body?.kind ?? '').trim().toUpperCase() || null;
  const city = String(req.body?.city ?? '').trim() || null;
  if (label.length < 3) return res.status(400).json({ error: 'A location needs at least three characters.' });
  if (q.get('SELECT id FROM locations WHERE label = @l AND id <> @id', { l: label, id })) {
    return res.status(409).json({ error: 'That location is already on the list.' });
  }
  q.run('UPDATE locations SET label=@l, kind=@k, city=@c WHERE id=@id', { l: label, k: kind, c: city, id });
  res.json({ data: q.get('SELECT * FROM locations WHERE id = @id', { id }) });
});

router.delete('/locations/:id', canDelete, (req, res) => {
  // Locations are suggestions only — bookings store their own text — so a
  // location can always be removed without touching any trip.
  q.run('DELETE FROM locations WHERE id = @id', { id: Number(req.params.id) });
  res.json({ ok: true });
});

/* ==========================================================================
   Exports
   ========================================================================== */

router.get('/export/categories', canView, async (req, res) => {
  const rows = q.all<any>(
    `SELECT vc.*, (SELECT COUNT(*) FROM vehicles v WHERE v.category_id = vc.id) AS vehicle_count,
            (SELECT COUNT(*) FROM rate_cards r WHERE r.category_id = vc.id) AS rule_count,
            (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_category_id = vc.id) AS trip_count
       FROM vehicle_categories vc ORDER BY vc.display_order, vc.name`
  );
  await sendTable(res, 'vehicle-categories', {
    name: 'Categories', title: 'Vehicle categories',
    columns: [
      { key: 'code', header: 'Code', kind: 'id' }, { key: 'name', header: 'Category' },
      { key: 'segment', header: 'Segment' }, { key: 'seating', header: 'Seats', kind: 'number' },
      { key: 'luggage', header: 'Bags', kind: 'number' }, { key: 'example_models', header: 'Models', width: 30 },
      { key: 'outstation_group', header: 'Outstation group' },
      { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
      { key: 'vehicle_count', header: 'Vehicles', kind: 'number' },
      { key: 'rule_count', header: 'Fare rules', kind: 'number' },
      { key: 'trip_count', header: 'Trips', kind: 'number' },
    ],
    rows,
  }, String(req.query.format ?? 'xlsx'));
});

router.get('/export/fare-rules', canView, async (req, res) => {
  const vendorId = Number(req.query.vendorId ?? 0);
  const rows = q.all<any>(
    `SELECT r.*, v.vendor_name, v.code AS vendor_code FROM rate_cards r JOIN vendors v ON v.id = r.vendor_id
      WHERE (@v = 0 OR r.vendor_id = @v)
      ORDER BY v.vendor_name, r.display_order, r.vehicle_category, r.plan_label`, { v: vendorId }
  );
  await sendTable(res, 'fare-rules', {
    name: 'Fare rules', title: 'Fare rules (rate master)',
    columns: [
      { key: 'vendor_name', header: 'Vendor' }, { key: 'vehicle_category', header: 'Category' },
      { key: 'plan_type', header: 'Plan type' }, { key: 'plan_label', header: 'Plan' },
      { key: 'included_hours', header: 'Incl. hours', kind: 'number' }, { key: 'included_km', header: 'Incl. km', kind: 'number' },
      { key: 'base_fare', header: 'Base fare', kind: 'money' }, { key: 'extra_hour_rate', header: 'Extra hr rate', kind: 'money' },
      { key: 'extra_km_rate', header: 'Extra km rate', kind: 'money' }, { key: 'per_km_rate', header: 'Per km', kind: 'money' },
      { key: 'min_km_per_day', header: 'Min km/day', kind: 'number' }, { key: 'min_daily_charge', header: 'Min daily charge', kind: 'money' },
      { key: 'driver_allowance', header: 'Driver allowance/day', kind: 'money' }, { key: 'night_charge', header: 'Night charge', kind: 'money' },
      { key: 'waiting_rate', header: 'Waiting/hr', kind: 'money' }, { key: 'free_waiting_minutes', header: 'Free waiting (min)', kind: 'number' },
      { key: 'state_tax', header: 'State tax', kind: 'money' }, { key: 'discount_percent', header: 'Discount %', kind: 'percent' },
      { key: 'toll_included', header: 'Toll incl.', value: (r) => (r.toll_included ? 'Yes' : 'No') },
      { key: 'effective_from', header: 'From', kind: 'date' }, { key: 'effective_to', header: 'To', kind: 'date' },
      { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
    ],
    rows,
  }, String(req.query.format ?? 'xlsx'));
});

router.get('/export/lists', canView, async (req, res) => {
  const rows = q.all<any>('SELECT * FROM master_values ORDER BY list_type, sort_order, label');
  await sendTable(res, 'master-lists', Object.entries(LIST_TYPES).map(([type, d]) => ({
    name: d.label, title: d.label,
    columns: [
      { key: 'code', header: 'Code', kind: 'id' as const }, { key: 'label', header: 'Label' },
      { key: 'description', header: 'Description', width: 40 },
      { key: 'is_system', header: 'Built in', value: (r: any) => (r.is_system ? 'Yes' : 'No') },
      { key: 'is_active', header: 'Active', value: (r: any) => (r.is_active ? 'Yes' : 'No') },
    ],
    rows: rows.filter((r) => r.list_type === type),
  })), String(req.query.format ?? 'xlsx'));
});

export default router;
