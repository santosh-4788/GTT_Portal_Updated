/**
 * Fleet — vehicles, drivers, availability and assignment history.
 *
 * This is where the fleet and driver lists moved to from Settings. The old
 * /api/settings/vehicles and /api/settings/drivers endpoints still answer (the
 * Android app and older screens call them), and they read the same tables.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile } from '../utils/validate';
import { sendTable, filterNote } from '../utils/exportSheet';
import { DRIVER_DOCS, VEHICLE_DOCS, blockingDocuments, docState, expiringDocuments, tripWindow } from '../services/fleet';

const router = Router();
router.use(requireAuth);

const canView = requirePermission('fleet.view', 'settings.view', 'bookings.view');
const canCreate = requirePermission('fleet.create', 'settings.create');
const canUpdate = requirePermission('fleet.update', 'settings.update');
const canDelete = requirePermission('fleet.delete', 'settings.delete');

const LIVE = `('CONFIRMED','ASSIGNED','ONTRIP')`;
const isoDay = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.'), z.literal('')]).optional().default('');

/** Indian registration: MH04LQ1748, MH 04 LQ 1748, 22BH1234AA (BH series). */
export function normaliseRegNo(s: string): string {
  return String(s ?? '').toUpperCase().replace(/[\s-]+/g, '');
}
const REG_RE = /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/;

/* ==========================================================================
   Vehicles
   ========================================================================== */

const vehicleSchema = z.object({
  vehicleNumber: z.string().trim().min(4, 'Enter the registration number.'),
  categoryId: z.coerce.number().int().positive('Choose the vehicle category.'),
  make: z.string().trim().max(40).optional().default(''),
  model: z.string().trim().max(60).optional().default(''),
  seating: z.coerce.number().int().min(1, 'Seating must be at least 1.').max(80).nullable().optional(),
  fuelType: z.string().trim().max(20).optional().default(''),
  manufactureYear: z.union([z.coerce.number().int().min(1990).max(2100), z.literal('')]).optional().default(''),
  // HIRED is the label the office uses; it is stored as PARTNER, as before.
  ownershipType: z.enum(['OWN', 'ATTACHED', 'PARTNER', 'HIRED']).default('OWN').transform((x) => (x === 'HIRED' ? 'PARTNER' : x)),
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  ownerName: z.string().trim().max(120).optional().default(''),
  ownerMobile: optionalMobile.default(''),
  availabilityStatus: z.enum(['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE']).default('AVAILABLE'),
  driverName: z.string().trim().max(120).optional().default(''),
  driverMobile: optionalMobile.default(''),
  rcExpiry: isoDay,
  permitNumber: z.string().trim().max(40).optional().default(''),
  permitExpiry: isoDay,
  insuranceNumber: z.string().trim().max(60).optional().default(''),
  insuranceExpiry: isoDay,
  fitnessExpiry: isoDay,
  pucExpiry: isoDay,
  notes: z.string().trim().max(600).optional().default(''),
  isActive: z.coerce.boolean().default(true),
  /** The driver who usually drives it — suggested first when it is allotted. */
  regularDriverId: z.coerce.number().int().positive().nullable().optional(),
  /** Add a new driver from the vehicle form and make them its regular driver. */
  newDriver: z.object({
    fullName: z.string().trim().min(2, 'Enter the new driver\'s full name.').max(120),
    mobile: z.string().transform((x) => x.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
      .refine((x) => /^[6-9]\d{9}$/.test(x), 'Enter a valid 10-digit mobile number for the new driver.'),
    licenceNumber: z.string().trim().max(30).optional().default(''),
    licenceExpiry: isoDay,
    associationType: z.enum(['EMPLOYEE', 'ATTACHED', 'HIRED', 'FREELANCE']).default('EMPLOYEE'),
  }).nullable().optional(),
}).refine((d) => d.ownershipType === 'OWN' || !!(d.ownerName || d.vendorId), {
  message: 'An attached or partner vehicle needs its owner or vendor, so payouts go to the right person.',
  path: ['ownerName'],
});

function vehicleRow(id: number) {
  return q.get<any>(
    `SELECT v.*, vc.name AS category_name, vd.vendor_name,
            rd.full_name AS regular_driver_name, rd.mobile AS regular_driver_mobile
       FROM vehicles v LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
       LEFT JOIN vendors vd ON vd.id = v.vendor_id
       LEFT JOIN drivers rd ON rd.id = v.regular_driver_id WHERE v.id = @id`, { id }
  );
}

/**
 * Resolve the regular driver for a vehicle save: an existing driver, or a new
 * one created on the spot (inside the caller's transaction). Returns the id and
 * the name/mobile to keep on the vehicle row, or an error for the operator.
 */
function resolveRegularDriver(b: z.infer<typeof vehicleSchema>, req: any): { id: number | null; name: string | null; mobile: string | null; error?: string; created?: boolean } {
  if (b.newDriver) {
    const nd = b.newDriver;
    const dup = q.get<any>('SELECT id, full_name FROM drivers WHERE mobile = @m', { m: nd.mobile });
    if (dup) return { id: null, name: null, mobile: null, error: `${dup.full_name} is already on the roster with ${nd.mobile} — pick them as the regular driver instead.` };
    const lic = nd.licenceNumber.toUpperCase();
    if (lic && q.get('SELECT id FROM drivers WHERE upper(licence_number) = @l', { l: lic })) {
      return { id: null, name: null, mobile: null, error: `Licence ${lic} is already recorded for another driver.` };
    }
    const info = q.run(
      `INSERT INTO drivers (full_name, mobile, licence_number, licence_expiry, association_type, availability_status, is_active)
       VALUES (@n, @m, @l, @e, @a, 'AVAILABLE', 1)`,
      { n: nd.fullName, m: nd.mobile, l: lic || null, e: nd.licenceExpiry || null, a: nd.associationType }
    );
    const id = Number(info.lastInsertRowid);
    audit(req, 'DRIVER_ADDED', { entityType: 'driver', entityId: id, description: `${nd.fullName} (${nd.mobile}) — added from a vehicle form` });
    return { id, name: nd.fullName, mobile: nd.mobile, created: true };
  }
  if (b.regularDriverId) {
    const d = q.get<any>('SELECT id, full_name, mobile, is_active FROM drivers WHERE id = @id', { id: b.regularDriverId });
    if (!d) return { id: null, name: null, mobile: null, error: 'That driver is no longer on the roster.' };
    if (!d.is_active) return { id: null, name: null, mobile: null, error: `${d.full_name} is inactive and cannot be a regular driver.` };
    return { id: d.id, name: d.full_name, mobile: d.mobile };
  }
  return { id: null, name: b.driverName || null, mobile: b.driverMobile || null };
}

function withDocs(v: any) {
  const docs = VEHICLE_DOCS.map((d) => ({ key: d.key, label: d.label, date: v[d.key] ?? null, ...docState(v[d.key]) }));
  const worst = docs.some((d) => d.state === 'EXPIRED') ? 'EXPIRED' : docs.some((d) => d.state === 'EXPIRING') ? 'EXPIRING' : 'OK';
  return { ...v, documents: docs, document_state: worst };
}

function vehicleParams(b: z.infer<typeof vehicleSchema>) {
  return {
    n: normaliseRegNo(b.vehicleNumber), cat: b.categoryId, make: b.make || null, model: b.model || null,
    seats: b.seating ?? null, fuel: b.fuelType || null, year: b.manufactureYear === '' ? null : b.manufactureYear,
    own: b.ownershipType, vendor: b.vendorId ?? null, oname: b.ownerName || null, omob: b.ownerMobile || null,
    avail: b.availabilityStatus, dn: b.driverName || null, dm: b.driverMobile || null,
    rc: b.rcExpiry || null, pno: b.permitNumber || null, pexp: b.permitExpiry || null,
    ino: b.insuranceNumber || null, iexp: b.insuranceExpiry || null,
    fit: b.fitnessExpiry || null, puc: b.pucExpiry || null, notes: b.notes || null,
    active: b.isActive ? 1 : 0,
  };
}

const vehicleListSql = (where: string) => `
  SELECT v.*, vc.name AS category_name, vd.vendor_name, rd.full_name AS regular_driver_name, rd.mobile AS regular_driver_mobile,
         (SELECT COUNT(*) FROM bookings b WHERE b.vehicle_id = v.id OR replace(upper(b.vehicle_number),' ','') = v.vehicle_number) AS trip_count,
         (SELECT b.trip_id || '|' || b.travel_date || '|' || COALESCE(b.reporting_time,'') || '|' || b.booking_status
            FROM bookings b WHERE (b.vehicle_id = v.id OR replace(upper(b.vehicle_number),' ','') = v.vehicle_number)
             AND b.booking_status IN ${LIVE} AND COALESCE(b.travel_date_to, b.travel_date) >= date('now','localtime')
           ORDER BY b.travel_date, b.reporting_time LIMIT 1) AS next_trip
    FROM vehicles v
    LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
    LEFT JOIN vendors vd ON vd.id = v.vendor_id
    LEFT JOIN drivers rd ON rd.id = v.regular_driver_id
   ${where}
   ORDER BY v.is_active DESC, vc.display_order, v.vehicle_number`;

function vehicleFilters(p: Record<string, string>) {
  const params = {
    search: (p.search ?? '').trim(), status: p.status ?? '', categoryId: Number(p.categoryId ?? 0),
    ownership: p.ownership ?? '', availability: p.availability ?? '', vendorId: Number(p.vendorId ?? 0),
  };
  const where = `WHERE (@search = '' OR v.vehicle_number LIKE '%'||@search||'%' OR v.model LIKE '%'||@search||'%'
                        OR v.make LIKE '%'||@search||'%' OR v.owner_name LIKE '%'||@search||'%'
                        OR v.driver_name LIKE '%'||@search||'%')
      AND (@status = '' OR (@status = 'ACTIVE' AND v.is_active = 1) OR (@status = 'INACTIVE' AND v.is_active = 0))
      AND (@categoryId = 0 OR v.category_id = @categoryId)
      AND (@ownership = '' OR v.ownership_type = @ownership)
      AND (@availability = '' OR v.availability_status = @availability)
      AND (@vendorId = 0 OR v.vendor_id = @vendorId)`;
  return { params, where };
}

router.get('/vehicles', canView, (req, res) => {
  const { params, where } = vehicleFilters(req.query as Record<string, string>);
  const rows = q.all<any>(vehicleListSql(where), params).map((v) => {
    const [tripId, date, time, status] = String(v.next_trip ?? '').split('|');
    return withDocs({ ...v, next_trip: v.next_trip ? { tripId, date, time, status } : null });
  });
  res.json({ data: rows });
});

router.get('/vehicles/:id', canView, (req, res) => {
  const id = Number(req.params.id);
  const v = vehicleRow(id);
  if (!v) return res.status(404).json({ error: 'That vehicle is not on the fleet list.' });
  res.json({
    data: withDocs(v),
    trips: q.all<any>(
      `SELECT b.id, b.trip_id, b.travel_date, b.reporting_time, b.booking_status, b.driver_name,
              COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location
         FROM bookings b WHERE b.vehicle_id = @id OR replace(upper(b.vehicle_number),' ','') = @n
        ORDER BY b.travel_date DESC LIMIT 50`, { id, n: v.vehicle_number }
    ),
    assignments: q.all<any>(
      `SELECT a.*, b.trip_id, u.full_name AS assigned_by_name FROM trip_assignments a
         JOIN bookings b ON b.id = a.booking_id LEFT JOIN users u ON u.id = a.assigned_by
        WHERE a.vehicle_id = @id OR replace(upper(a.vehicle_number),' ','') = @n
        ORDER BY a.id DESC LIMIT 100`, { id, n: v.vehicle_number }
    ),
  });
});

router.post('/vehicles', canCreate, validateBody(vehicleSchema), (req, res) => {
  const b = req.body as z.infer<typeof vehicleSchema>;
  const p = vehicleParams(b);
  if (!REG_RE.test(p.n)) return res.status(400).json({ error: 'Enter a valid registration number, e.g. MH04LQ1748.' });
  const dup = q.get<any>('SELECT id, is_active FROM vehicles WHERE vehicle_number = @n', { n: p.n });
  if (dup) {
    return res.status(409).json({
      error: `${p.n} is already on the fleet list${dup.is_active ? '' : ' (inactive — reactivate it instead of adding it again)'}.`,
      existingId: dup.id,
    });
  }
  const cat = q.get<any>('SELECT name, is_active, seating FROM vehicle_categories WHERE id = @id', { id: b.categoryId });
  if (!cat) return res.status(400).json({ error: 'That category no longer exists.' });
  if (!cat.is_active) return res.status(400).json({ error: `"${cat.name}" is deactivated. Choose an active category.` });
  if (b.vendorId) {
    const v = q.get<any>('SELECT status, vendor_name FROM vendors WHERE id = @id', { id: b.vendorId });
    if (!v) return res.status(400).json({ error: 'That vendor no longer exists.' });
    if (v.status !== 'ACTIVE') return res.status(400).json({ error: `${v.vendor_name} is inactive and cannot be given new vehicles.` });
  }

  let failure: string | null = null;
  let newId = 0;
  let addedDriver = false;
  try {
    getDb().transaction(() => {
      const rd = resolveRegularDriver(b, req);
      if (rd.error) { failure = rd.error; throw new Error('rollback'); }
      addedDriver = !!rd.created;
      const info = q.run(
        `INSERT INTO vehicles (vehicle_number, vehicle_type, category_id, make, model, seating, fuel_type,
            manufacture_year, ownership_type, vendor_id, owner_name, owner_mobile, availability_status,
            driver_name, driver_mobile, regular_driver_id, rc_expiry, permit_number, permit_expiry, insurance_number,
            insurance_expiry, fitness_expiry, puc_expiry, notes, is_active, updated_at)
         VALUES (@n, @type, @cat, @make, @model, @seats, @fuel, @year, @own, @vendor, @oname, @omob, @avail,
            @dn, @dm, @rdid, @rc, @pno, @pexp, @ino, @iexp, @fit, @puc, @notes, @active, datetime('now'))`,
        { ...p, type: cat.name, seats: p.seats ?? cat.seating ?? null, dn: rd.name, dm: rd.mobile, rdid: rd.id }
      );
      newId = Number(info.lastInsertRowid);
      if (rd.id) q.run('UPDATE drivers SET default_vehicle_id = @v WHERE id = @d AND default_vehicle_id IS NULL', { v: newId, d: rd.id });
    })();
  } catch (err) {
    if (failure) return res.status(409).json({ error: failure });
    throw err;
  }
  audit(req, 'VEHICLE_ADDED', { entityType: 'vehicle', entityId: newId, description: `${p.n} — ${cat.name}` });
  res.status(201).json({
    data: withDocs(vehicleRow(newId)),
    message: `${p.n} added to the fleet${addedDriver ? ' with its new regular driver' : ''}.`,
  });
});

router.put('/vehicles/:id', canUpdate, validateBody(vehicleSchema), (req, res) => {
  const id = Number(req.params.id);
  const existing = vehicleRow(id);
  if (!existing) return res.status(404).json({ error: 'That vehicle is not on the fleet list.' });
  const b = req.body as z.infer<typeof vehicleSchema>;
  const p = vehicleParams(b);
  if (!REG_RE.test(p.n)) return res.status(400).json({ error: 'Enter a valid registration number, e.g. MH04LQ1748.' });
  if (q.get('SELECT id FROM vehicles WHERE vehicle_number = @n AND id <> @id', { n: p.n, id })) {
    return res.status(409).json({ error: `Another vehicle already has the number ${p.n}.` });
  }
  const cat = q.get<any>('SELECT name, is_active FROM vehicle_categories WHERE id = @id', { id: b.categoryId });
  if (!cat) return res.status(400).json({ error: 'That category no longer exists.' });
  if (!cat.is_active && b.categoryId !== existing.category_id) {
    return res.status(400).json({ error: `"${cat.name}" is deactivated. Choose an active category.` });
  }
  // Renumbering a vehicle with trips behind it would orphan those trips' text.
  if (p.n !== existing.vehicle_number) {
    const used = q.get<any>(`SELECT COUNT(*) c FROM bookings WHERE vehicle_id = @id`, { id })!.c;
    if (used > 0) {
      return res.status(409).json({ error: `${existing.vehicle_number} has ${used} trip(s) recorded against it, so its number cannot be changed. Add the new number as a separate vehicle.` });
    }
  }

  const changes: string[] = [];
  const compare: [string, unknown, unknown][] = [
    ['category', existing.category_name, cat.name], ['availability', existing.availability_status, p.avail],
    ['active', !!existing.is_active, !!p.active], ['insurance expiry', existing.insurance_expiry, p.iexp],
    ['permit expiry', existing.permit_expiry, p.pexp], ['fitness expiry', existing.fitness_expiry, p.fit],
    ['owner', existing.owner_name, p.oname], ['driver', existing.driver_name, p.dn],
  ];
  for (const [k, a, bb] of compare) if (String(a ?? '') !== String(bb ?? '')) changes.push(`${k}: ${a ?? '—'} → ${bb ?? '—'}`);

  let failure: string | null = null;
  try {
    getDb().transaction(() => {
      const rd = resolveRegularDriver(b, req);
      if (rd.error) { failure = rd.error; throw new Error('rollback'); }
      if ((rd.id ?? null) !== (existing.regular_driver_id ?? null)) {
        changes.push(`regular driver: ${existing.regular_driver_name ?? '—'} → ${rd.name ?? '—'}`);
      }
      q.run(
        `UPDATE vehicles SET vehicle_number=@n, vehicle_type=@type, category_id=@cat, make=@make, model=@model,
            seating=@seats, fuel_type=@fuel, manufacture_year=@year, ownership_type=@own, vendor_id=@vendor,
            owner_name=@oname, owner_mobile=@omob, availability_status=@avail, driver_name=@dn, driver_mobile=@dm,
            regular_driver_id=@rdid,
            rc_expiry=@rc, permit_number=@pno, permit_expiry=@pexp, insurance_number=@ino, insurance_expiry=@iexp,
            fitness_expiry=@fit, puc_expiry=@puc, notes=@notes, is_active=@active, updated_at=datetime('now')
          WHERE id=@id`,
        { ...p, type: cat.name, id, dn: rd.name, dm: rd.mobile, rdid: rd.id }
      );
      if (rd.id) q.run('UPDATE drivers SET default_vehicle_id = @v WHERE id = @d AND default_vehicle_id IS NULL', { v: id, d: rd.id });
    })();
  } catch (err) {
    if (failure) return res.status(409).json({ error: failure });
    throw err;
  }
  audit(req, 'VEHICLE_UPDATED', { entityType: 'vehicle', entityId: id, description: `${p.n}${changes.length ? ' — ' + changes.join('; ') : ''}`, meta: { changes } });
  res.json({ data: withDocs(vehicleRow(id)), message: `${p.n} saved.` });
});

router.delete('/vehicles/:id', canDelete, (req, res) => {
  const id = Number(req.params.id);
  const v = vehicleRow(id);
  if (!v) return res.status(404).json({ error: 'That vehicle is not on the fleet list.' });
  const used = q.get<any>('SELECT COUNT(*) c FROM bookings WHERE vehicle_id = @id', { id })!.c
    + q.get<any>('SELECT COUNT(*) c FROM trip_assignments WHERE vehicle_id = @id', { id })!.c;
  if (used > 0) {
    q.run(`UPDATE vehicles SET is_active = 0, updated_at = datetime('now') WHERE id = @id`, { id });
    audit(req, 'VEHICLE_UPDATED', { entityType: 'vehicle', entityId: id, description: `${v.vehicle_number} deactivated (has trip history)` });
    return res.json({ ok: true, deactivated: true, message: `${v.vehicle_number} has trip history, so it was deactivated instead of deleted.` });
  }
  q.run('UPDATE drivers SET default_vehicle_id = NULL WHERE default_vehicle_id = @id', { id });
  q.run('DELETE FROM vehicles WHERE id = @id', { id });
  audit(req, 'VEHICLE_DELETED', { entityType: 'vehicle', entityId: id, description: v.vehicle_number });
  res.json({ ok: true, message: `${v.vehicle_number} removed.` });
});

/* ==========================================================================
   Drivers
   ========================================================================== */

const driverSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the driver\'s full name.').max(120),
  mobile: z.string().transform((s) => s.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, ''))
    .refine((s) => /^[6-9]\d{9}$/.test(s), 'Enter a valid 10-digit mobile number for the driver.'),
  altMobile: optionalMobile.default(''),
  licenceNumber: z.string().trim().max(30).optional().default(''),
  licenceIssued: isoDay,
  licenceExpiry: isoDay,
  badgeNumber: z.string().trim().max(30).optional().default(''),
  badgeExpiry: isoDay,
  idProof: z.string().trim().max(60).optional().default(''),
  policeVerifiedOn: isoDay,
  address: z.string().trim().max(300).optional().default(''),
  languages: z.string().trim().max(120).optional().default(''),
  experienceYears: z.union([z.coerce.number().min(0).max(60), z.literal('')]).optional().default(''),
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  defaultVehicleId: z.coerce.number().int().positive().nullable().optional(),
  availabilityStatus: z.enum(['AVAILABLE', 'ON_LEAVE', 'UNAVAILABLE']).default('AVAILABLE'),
  associationType: z.enum(['EMPLOYEE', 'ATTACHED', 'HIRED', 'FREELANCE']).default('EMPLOYEE'),
  /** Planned leave: the driver is not offered for trips inside these dates. */
  leaveFrom: isoDay,
  leaveTo: isoDay,
  unavailableReason: z.string().trim().max(200).optional().default(''),
  notes: z.string().trim().max(600).optional().default(''),
  isActive: z.coerce.boolean().default(true),
}).refine((d) => !d.licenceIssued || !d.licenceExpiry || d.licenceExpiry > d.licenceIssued, {
  message: 'The licence expiry must be after the issue date.', path: ['licenceExpiry'],
}).refine((d) => !d.leaveFrom || !d.leaveTo || d.leaveTo >= d.leaveFrom, {
  message: 'Leave cannot end before it starts.', path: ['leaveTo'],
}).refine((d) => !d.leaveTo || !!d.leaveFrom, {
  message: 'Enter the first day of leave.', path: ['leaveFrom'],
});

function driverRow(id: number) {
  return q.get<any>(
    `SELECT d.*, v.vehicle_number AS default_vehicle_number, vd.vendor_name
       FROM drivers d LEFT JOIN vehicles v ON v.id = d.default_vehicle_id
       LEFT JOIN vendors vd ON vd.id = d.vendor_id WHERE d.id = @id`, { id }
  );
}

function driverWithDocs(r: any) {
  const docs = DRIVER_DOCS.map((d) => ({ key: d.key, label: d.label, date: r[d.key] ?? null, ...docState(r[d.key]) }));
  const worst = docs.some((d) => d.state === 'EXPIRED') ? 'EXPIRED' : docs.some((d) => d.state === 'EXPIRING') ? 'EXPIRING' : 'OK';
  return { ...r, documents: docs, document_state: worst };
}

function driverParams(b: z.infer<typeof driverSchema>) {
  return {
    n: b.fullName, m: b.mobile, am: b.altMobile || null, lic: b.licenceNumber.toUpperCase() || null,
    issued: b.licenceIssued || null, exp: b.licenceExpiry || null, badge: b.badgeNumber || null,
    bexp: b.badgeExpiry || null, idp: b.idProof || null, pol: b.policeVerifiedOn || null,
    addr: b.address || null, lang: b.languages || null,
    years: b.experienceYears === '' ? null : b.experienceYears, vendor: b.vendorId ?? null,
    veh: b.defaultVehicleId ?? null, avail: b.availabilityStatus, notes: b.notes || null,
    active: b.isActive ? 1 : 0, assoc: b.associationType, lfrom: b.leaveFrom || null,
    lto: b.leaveTo || b.leaveFrom || null, ureason: b.unavailableReason || null,
  };
}

const driverFilters = (p: Record<string, string>) => ({
  params: { search: (p.search ?? '').trim(), status: p.status ?? '', availability: p.availability ?? '', vendorId: Number(p.vendorId ?? 0) },
  where: `WHERE (@search = '' OR d.full_name LIKE '%'||@search||'%' OR d.mobile LIKE '%'||@search||'%'
                 OR d.licence_number LIKE '%'||@search||'%')
            AND (@status = '' OR (@status = 'ACTIVE' AND d.is_active = 1) OR (@status = 'INACTIVE' AND d.is_active = 0))
            AND (@availability = '' OR d.availability_status = @availability)
            AND (@vendorId = 0 OR d.vendor_id = @vendorId)`,
});

const driverListSql = (where: string) => `
  SELECT d.*, v.vehicle_number AS default_vehicle_number, vd.vendor_name,
         (SELECT COUNT(*) FROM bookings b WHERE b.driver_id = d.id) AS trip_count,
         (SELECT b.trip_id || '|' || b.travel_date || '|' || COALESCE(b.reporting_time,'') || '|' || b.booking_status
            FROM bookings b WHERE b.driver_id = d.id AND b.booking_status IN ${LIVE}
             AND COALESCE(b.travel_date_to, b.travel_date) >= date('now','localtime')
           ORDER BY b.travel_date, b.reporting_time LIMIT 1) AS next_trip
    FROM drivers d LEFT JOIN vehicles v ON v.id = d.default_vehicle_id
    LEFT JOIN vendors vd ON vd.id = d.vendor_id
   ${where}
   ORDER BY d.is_active DESC, d.full_name`;

router.get('/drivers', canView, (req, res) => {
  const { params, where } = driverFilters(req.query as Record<string, string>);
  res.json({
    data: q.all<any>(driverListSql(where), params).map((r) => {
      const [tripId, date, time, status] = String(r.next_trip ?? '').split('|');
      return driverWithDocs({ ...r, next_trip: r.next_trip ? { tripId, date, time, status } : null });
    }),
  });
});

router.get('/drivers/:id', canView, (req, res) => {
  const id = Number(req.params.id);
  const d = driverRow(id);
  if (!d) return res.status(404).json({ error: 'That driver is not on the roster.' });
  res.json({
    data: driverWithDocs(d),
    trips: q.all<any>(
      `SELECT b.id, b.trip_id, b.travel_date, b.reporting_time, b.booking_status, b.vehicle_number,
              COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location
         FROM bookings b WHERE b.driver_id = @id ORDER BY b.travel_date DESC LIMIT 50`, { id }
    ),
    assignments: q.all<any>(
      `SELECT a.*, b.trip_id, u.full_name AS assigned_by_name FROM trip_assignments a
         JOIN bookings b ON b.id = a.booking_id LEFT JOIN users u ON u.id = a.assigned_by
        WHERE a.driver_id = @id ORDER BY a.id DESC LIMIT 100`, { id }
    ),
    feedback: q.get<any>(
      `SELECT COUNT(*) AS responses, ROUND(AVG(driver_rating), 2) AS avg_rating
         FROM trip_feedback WHERE driver_id = @id AND status = 'SUBMITTED'`, { id }
    ),
  });
});

function checkDriverLinks(b: z.infer<typeof driverSchema>): string | null {
  if (b.vendorId) {
    const v = q.get<any>('SELECT status, vendor_name FROM vendors WHERE id = @id', { id: b.vendorId });
    if (!v) return 'That vendor no longer exists.';
    if (v.status !== 'ACTIVE') return `${v.vendor_name} is inactive and cannot be given new drivers.`;
  }
  if (b.defaultVehicleId) {
    const v = q.get<any>('SELECT is_active, vehicle_number FROM vehicles WHERE id = @id', { id: b.defaultVehicleId });
    if (!v) return 'That vehicle is no longer on the fleet list.';
    if (!v.is_active) return `${v.vehicle_number} is inactive and cannot be a driver's regular vehicle.`;
  }
  return null;
}

router.post('/drivers', canCreate, validateBody(driverSchema), (req, res) => {
  const b = req.body as z.infer<typeof driverSchema>;
  const p = driverParams(b);
  const dup = q.get<any>('SELECT id, full_name FROM drivers WHERE mobile = @m', { m: p.m });
  if (dup) return res.status(409).json({ error: `${dup.full_name} is already on the roster with that number.`, existingId: dup.id });
  if (p.lic) {
    const dl = q.get<any>('SELECT full_name FROM drivers WHERE upper(licence_number) = @l', { l: p.lic });
    if (dl) return res.status(409).json({ error: `Licence ${p.lic} is already recorded for ${dl.full_name}.` });
  }
  const linkProblem = checkDriverLinks(b);
  if (linkProblem) return res.status(400).json({ error: linkProblem });

  const info = q.run(
    `INSERT INTO drivers (full_name, mobile, alt_mobile, licence_number, licence_issued, licence_expiry,
        badge_number, badge_expiry, id_proof, police_verified_on, address, languages, experience_years,
        vendor_id, default_vehicle_id, availability_status, notes, is_active,
        association_type, leave_from, leave_to, unavailable_reason)
     VALUES (@n, @m, @am, @lic, @issued, @exp, @badge, @bexp, @idp, @pol, @addr, @lang, @years,
        @vendor, @veh, @avail, @notes, @active, @assoc, @lfrom, @lto, @ureason)`,
    p
  );
  audit(req, 'DRIVER_ADDED', { entityType: 'driver', entityId: Number(info.lastInsertRowid), description: `${p.n} (${p.m})` });
  res.status(201).json({ data: driverWithDocs(driverRow(Number(info.lastInsertRowid))), message: `${p.n} added to the roster.` });
});

router.put('/drivers/:id', canUpdate, validateBody(driverSchema), (req, res) => {
  const id = Number(req.params.id);
  const existing = driverRow(id);
  if (!existing) return res.status(404).json({ error: 'That driver is not on the roster.' });
  const b = req.body as z.infer<typeof driverSchema>;
  const p = driverParams(b);
  const dup = q.get<any>('SELECT full_name FROM drivers WHERE mobile = @m AND id <> @id', { m: p.m, id });
  if (dup) return res.status(409).json({ error: `${dup.full_name} already uses that number.` });
  if (p.lic) {
    const dl = q.get<any>('SELECT full_name FROM drivers WHERE upper(licence_number) = @l AND id <> @id', { l: p.lic, id });
    if (dl) return res.status(409).json({ error: `Licence ${p.lic} is already recorded for ${dl.full_name}.` });
  }
  if (b.defaultVehicleId !== existing.default_vehicle_id || b.vendorId !== existing.vendor_id) {
    const linkProblem = checkDriverLinks(b);
    if (linkProblem) return res.status(400).json({ error: linkProblem });
  }
  q.run(
    `UPDATE drivers SET full_name=@n, mobile=@m, alt_mobile=@am, licence_number=@lic, licence_issued=@issued,
        licence_expiry=@exp, badge_number=@badge, badge_expiry=@bexp, id_proof=@idp, police_verified_on=@pol,
        address=@addr, languages=@lang, experience_years=@years, vendor_id=@vendor, default_vehicle_id=@veh,
        availability_status=@avail, notes=@notes, is_active=@active,
        association_type=@assoc, leave_from=@lfrom, leave_to=@lto, unavailable_reason=@ureason,
        updated_at=datetime('now')
      WHERE id=@id`,
    { ...p, id }
  );
  audit(req, 'DRIVER_UPDATED', {
    entityType: 'driver', entityId: id,
    description: `${p.n}${!!existing.is_active !== !!p.active ? (p.active ? ' — reactivated' : ' — deactivated') : ''}${existing.availability_status !== p.avail ? ` — ${p.avail.toLowerCase()}` : ''}`,
  });
  res.json({ data: driverWithDocs(driverRow(id)), message: `${p.n} saved.` });
});

router.delete('/drivers/:id', canDelete, (req, res) => {
  const id = Number(req.params.id);
  const d = driverRow(id);
  if (!d) return res.status(404).json({ error: 'That driver is not on the roster.' });
  const used = q.get<any>('SELECT COUNT(*) c FROM bookings WHERE driver_id = @id', { id })!.c
    + q.get<any>('SELECT COUNT(*) c FROM trip_assignments WHERE driver_id = @id', { id })!.c;
  if (used > 0) {
    q.run(`UPDATE drivers SET is_active = 0, updated_at = datetime('now') WHERE id = @id`, { id });
    audit(req, 'DRIVER_UPDATED', { entityType: 'driver', entityId: id, description: `${d.full_name} deactivated (has trip history)` });
    return res.json({ ok: true, deactivated: true, message: `${d.full_name} has trips against their name, so they were marked inactive instead of deleted.` });
  }
  q.run('DELETE FROM drivers WHERE id = @id', { id });
  audit(req, 'DRIVER_DELETED', { entityType: 'driver', entityId: id, description: d.full_name });
  res.json({ ok: true, message: `${d.full_name} removed.` });
});

/* ==========================================================================
   Availability, assignments and documents
   ========================================================================== */

/** Who is free and who is busy on one day — the allotment board. */
router.get('/availability', canView, (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date ?? '')) ? String(req.query.date) : new Date().toISOString().slice(0, 10);
  const trips = q.all<any>(
    `SELECT b.id, b.trip_id, b.travel_date, b.travel_date_to, b.reporting_time, b.trip_type, b.trip_duration_hrs,
            b.booking_status, b.vehicle_id, b.vehicle_number, b.driver_id, b.driver_name,
            COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location
       FROM bookings b
      WHERE b.booking_status IN ${LIVE} AND b.travel_date <= @d AND COALESCE(b.travel_date_to, b.travel_date) >= @d`,
    { d: date }
  ).map((t) => ({ ...t, window: tripWindow(t) }));

  const vehicles = q.all<any>(
    `SELECT v.id, v.vehicle_number, v.model, v.availability_status, vc.name AS category_name
       FROM vehicles v LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
      WHERE v.is_active = 1 ORDER BY vc.display_order, v.vehicle_number`
  ).map((v) => {
    const mine = trips.filter((t) => t.vehicle_id === v.id || String(t.vehicle_number ?? '').toUpperCase().replace(/\s+/g, '') === v.vehicle_number);
    return { ...v, trips: mine, state: v.availability_status !== 'AVAILABLE' ? v.availability_status : mine.length ? 'BOOKED' : 'FREE' };
  });
  const drivers = q.all<any>(
    `SELECT id, full_name, mobile, availability_status FROM drivers WHERE is_active = 1 ORDER BY full_name`
  ).map((d) => {
    const mine = trips.filter((t) => t.driver_id === d.id);
    return { ...d, trips: mine, state: d.availability_status !== 'AVAILABLE' ? d.availability_status : mine.length ? 'BOOKED' : 'FREE' };
  });
  const unallotted = trips.filter((t) => !t.vehicle_number && !t.vehicle_id);
  res.json({ date, vehicles, drivers, unallotted });
});

/**
 * Everything the allotment pickers need for one trip window: every vehicle and
 * driver, with whether they can go and — when not — why. The trip is either an
 * existing booking (?bookingId=) or one being entered (?date&time&tripType…).
 * Nothing is filtered out here; the screen shows the unavailable ones greyed
 * with the reason, and only an authorised override can pick them.
 */
router.get('/assign-options', canView, (req, res) => {
  const p = req.query as Record<string, string>;
  const bookingId = Number(p.bookingId ?? 0);
  const me = bookingId ? q.get<any>('SELECT * FROM bookings WHERE id = @id', { id: bookingId }) : null;
  const trip = me ?? {
    travel_date: /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? '') ? p.date : new Date().toISOString().slice(0, 10),
    travel_date_to: /^\d{4}-\d{2}-\d{2}$/.test(p.dateTo ?? '') ? p.dateTo : null,
    reporting_time: p.time ?? '', trip_type: p.tripType ?? 'LOCAL',
    trip_duration_hrs: Number(p.hours ?? 0) || null, vehicle_category_id: Number(p.categoryId ?? 0) || null,
  };
  const window = tripWindow(trip);
  const day = window.start.slice(0, 10), lastDay = window.end.slice(0, 10);
  const categoryId = Number(p.categoryId ?? 0) || trip.vehicle_category_id || null;

  const live = q.all<any>(
    `SELECT b.id, b.trip_id, b.travel_date, b.travel_date_to, b.reporting_time, b.trip_type, b.trip_duration_hrs,
            b.booking_status, b.vehicle_id, b.vehicle_number, b.driver_id, b.driver_mobile,
            COALESCE(b.customer_name, b.passenger_name) AS customer
       FROM bookings b
      WHERE b.booking_status IN ${LIVE} AND b.id <> @id
        AND b.travel_date <= date(@last, '+1 day') AND COALESCE(b.travel_date_to, b.travel_date) >= date(@first, '-1 day')`,
    { id: bookingId, first: day, last: lastDay }
  ).map((t) => ({ ...t, window: tripWindow(t) }))
   .filter((t) => t.window.start < window.end && window.start < t.window.end);

  const busy = (match: (t: any) => boolean) => live.filter(match).map((t) => ({
    tripId: t.trip_id, date: t.travel_date, time: t.reporting_time, customer: t.customer, status: t.booking_status,
  }));

  const vehicles = q.all<any>(
    `SELECT v.id, v.vehicle_number, v.make, v.model, v.seating, v.ownership_type, v.availability_status, v.is_active,
            v.category_id, vc.name AS category_name, v.regular_driver_id, rd.full_name AS regular_driver_name,
            rd.mobile AS regular_driver_mobile, v.driver_name, v.driver_mobile, vd.vendor_name,
            v.rc_expiry, v.permit_expiry, v.insurance_expiry, v.fitness_expiry, v.puc_expiry
       FROM vehicles v LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
       LEFT JOIN drivers rd ON rd.id = v.regular_driver_id
       LEFT JOIN vendors vd ON vd.id = v.vendor_id
      ORDER BY v.is_active DESC, vc.display_order, v.vehicle_number`
  ).map((v) => {
    const clashes = busy((t) => t.vehicle_id === v.id || String(t.vehicle_number ?? '').toUpperCase().replace(/\s+/g, '') === v.vehicle_number);
    const docs = blockingDocuments('vehicle', v, day);
    const reasons: string[] = [];
    if (!v.is_active) reasons.push('Inactive');
    else if (v.availability_status !== 'AVAILABLE') reasons.push(String(v.availability_status).replace('_', ' ').toLowerCase());
    if (clashes.length) reasons.push(`On ${clashes.map((c) => c.tripId).join(', ')}`);
    reasons.push(...docs);
    return {
      ...v,
      state: !v.is_active ? 'INACTIVE' : v.availability_status !== 'AVAILABLE' ? v.availability_status : clashes.length ? 'BUSY' : docs.length ? 'DOCUMENTS' : 'AVAILABLE',
      clashes, reasons, categoryMatch: !categoryId || v.category_id === categoryId,
    };
  });

  const drivers = q.all<any>(
    `SELECT d.id, d.full_name, d.mobile, d.availability_status, d.is_active, d.association_type,
            d.leave_from, d.leave_to, d.unavailable_reason, d.default_vehicle_id, d.licence_expiry, d.badge_expiry,
            v.vehicle_number AS regular_vehicle_number, vd.vendor_name
       FROM drivers d LEFT JOIN vehicles v ON v.id = d.default_vehicle_id
       LEFT JOIN vendors vd ON vd.id = d.vendor_id
      ORDER BY d.is_active DESC, d.full_name`
  ).map((d) => {
    const clashes = busy((t) => t.driver_id === d.id
      || (!!d.mobile && String(t.driver_mobile ?? '').replace(/\D/g, '').slice(-10) === d.mobile));
    const onLeave = !!d.leave_from && d.leave_from <= lastDay && (d.leave_to ?? d.leave_from) >= day;
    const docs = blockingDocuments('driver', d, day);
    const reasons: string[] = [];
    if (!d.is_active) reasons.push('Inactive');
    else if (d.availability_status !== 'AVAILABLE') reasons.push(String(d.availability_status).replace('_', ' ').toLowerCase());
    if (onLeave) reasons.push(`On leave ${d.leave_from}${d.leave_to && d.leave_to !== d.leave_from ? ` to ${d.leave_to}` : ''}`);
    if (clashes.length) reasons.push(`On ${clashes.map((c) => c.tripId).join(', ')}`);
    reasons.push(...docs);
    return {
      ...d,
      state: !d.is_active ? 'INACTIVE' : d.availability_status !== 'AVAILABLE' ? d.availability_status : onLeave ? 'ON_LEAVE' : clashes.length ? 'BUSY' : docs.length ? 'DOCUMENTS' : 'AVAILABLE',
      onLeave, clashes, reasons,
    };
  });

  res.json({
    window, categoryId,
    current: me ? { vehicleId: me.vehicle_id, vehicleNumber: me.vehicle_number, driverId: me.driver_id, driverName: me.driver_name } : null,
    vehicles, drivers,
  });
});

router.get('/assignments', canView, (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    vehicleId: Number(p.vehicleId ?? 0), driverId: Number(p.driverId ?? 0),
    from: p.from ?? '', to: p.to ?? '', search: (p.search ?? '').trim(),
    limit: Math.min(Number(p.limit ?? 200), 1000),
  };
  res.json({
    data: q.all<any>(
      `SELECT a.*, b.trip_id, b.travel_date, b.booking_status, COALESCE(b.customer_name, b.passenger_name) AS customer,
              u.full_name AS assigned_by_name
         FROM trip_assignments a JOIN bookings b ON b.id = a.booking_id
         LEFT JOIN users u ON u.id = a.assigned_by
        WHERE (@vehicleId = 0 OR a.vehicle_id = @vehicleId) AND (@driverId = 0 OR a.driver_id = @driverId)
          AND (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
          AND (@search = '' OR b.trip_id LIKE '%'||@search||'%' OR a.vehicle_number LIKE '%'||@search||'%'
                            OR a.driver_name LIKE '%'||@search||'%')
        ORDER BY a.id DESC LIMIT @limit`, params
    ),
  });
});

router.get('/documents', canView, (req, res) => {
  const within = Math.min(365, Math.max(1, Number(req.query.days ?? 30)));
  res.json({ data: expiringDocuments(within), within });
});

router.get('/summary', canView, (_req, res) => {
  res.json({
    ...q.get<any>(
      `SELECT (SELECT COUNT(*) FROM vehicles WHERE is_active = 1) AS active_vehicles,
              (SELECT COUNT(*) FROM vehicles WHERE is_active = 0) AS inactive_vehicles,
              (SELECT COUNT(*) FROM vehicles WHERE is_active = 1 AND availability_status <> 'AVAILABLE') AS vehicles_off_road,
              (SELECT COUNT(*) FROM drivers WHERE is_active = 1) AS active_drivers,
              (SELECT COUNT(*) FROM drivers WHERE is_active = 1 AND (availability_status <> 'AVAILABLE'
                  OR (leave_from IS NOT NULL AND leave_from <= date('now','localtime') AND COALESCE(leave_to, leave_from) >= date('now','localtime')))) AS drivers_away,
              (SELECT COUNT(*) FROM drivers WHERE is_active = 1 AND (availability_status = 'ON_LEAVE'
                  OR (leave_from IS NOT NULL AND leave_from <= date('now','localtime') AND COALESCE(leave_to, leave_from) >= date('now','localtime')))) AS drivers_on_leave,
              (SELECT COUNT(*) FROM vehicles vv WHERE vv.is_active = 1 AND vv.availability_status = 'AVAILABLE'
                  AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.booking_status IN ${LIVE}
                       AND b.travel_date <= date('now','localtime') AND COALESCE(b.travel_date_to, b.travel_date) >= date('now','localtime')
                       AND (b.vehicle_id = vv.id OR replace(upper(b.vehicle_number),' ','') = vv.vehicle_number))) AS vehicles_available_today,
              (SELECT COUNT(DISTINCT COALESCE(CAST(vehicle_id AS TEXT), vehicle_number)) FROM bookings
                WHERE booking_status = 'ONTRIP' AND (vehicle_id IS NOT NULL OR vehicle_number <> '')) AS vehicles_on_trip_now,
              (SELECT COUNT(DISTINCT COALESCE(CAST(vehicle_id AS TEXT), vehicle_number)) FROM bookings
                WHERE booking_status IN ${LIVE} AND travel_date <= date('now','localtime')
                  AND COALESCE(travel_date_to, travel_date) >= date('now','localtime')
                  AND (vehicle_id IS NOT NULL OR vehicle_number <> '')) AS vehicles_busy_today`
    ),
    documents: expiringDocuments(30).length,
  });
});

/* ==========================================================================
   Exports
   ========================================================================== */

router.get('/export/vehicles', canView, async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = vehicleFilters(p);
  const rows = q.all<any>(vehicleListSql(where), params);
  await sendTable(res, 'fleet-vehicles', {
    name: 'Vehicles', title: 'Fleet — vehicles',
    notes: [filterNote({ Search: params.search, Status: params.status, Ownership: params.ownership, Availability: params.availability })],
    columns: [
      { key: 'vehicle_number', header: 'Registration no.', kind: 'id' }, { key: 'category_name', header: 'Category' },
      { key: 'make', header: 'Make' }, { key: 'model', header: 'Model' }, { key: 'seating', header: 'Seats', kind: 'number' },
      { key: 'fuel_type', header: 'Fuel' }, { key: 'manufacture_year', header: 'Year', kind: 'number' },
      { key: 'ownership_type', header: 'Ownership' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'owner_name', header: 'Owner' }, { key: 'owner_mobile', header: 'Owner mobile', kind: 'id' },
      { key: 'driver_name', header: 'Regular driver' }, { key: 'driver_mobile', header: 'Driver mobile', kind: 'id' },
      { key: 'availability_status', header: 'Availability' },
      { key: 'insurance_number', header: 'Insurance no.', kind: 'id' }, { key: 'insurance_expiry', header: 'Insurance expiry', kind: 'date' },
      { key: 'permit_number', header: 'Permit no.', kind: 'id' }, { key: 'permit_expiry', header: 'Permit expiry', kind: 'date' },
      { key: 'fitness_expiry', header: 'Fitness expiry', kind: 'date' }, { key: 'puc_expiry', header: 'PUC expiry', kind: 'date' },
      { key: 'rc_expiry', header: 'RC expiry', kind: 'date' }, { key: 'trip_count', header: 'Trips', kind: 'number' },
      { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
      { key: 'notes', header: 'Notes', width: 40 },
    ],
    rows,
  }, p.format);
});

router.get('/export/drivers', canView, async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = driverFilters(p);
  const rows = q.all<any>(driverListSql(where), params);
  await sendTable(res, 'fleet-drivers', {
    name: 'Drivers', title: 'Fleet — drivers',
    notes: [filterNote({ Search: params.search, Status: params.status, Availability: params.availability })],
    columns: [
      { key: 'full_name', header: 'Driver' }, { key: 'mobile', header: 'Mobile', kind: 'id' },
      { key: 'alt_mobile', header: 'Alt. mobile', kind: 'id' }, { key: 'licence_number', header: 'Licence no.', kind: 'id' },
      { key: 'licence_expiry', header: 'Licence expiry', kind: 'date' }, { key: 'badge_number', header: 'Badge no.', kind: 'id' },
      { key: 'badge_expiry', header: 'Badge expiry', kind: 'date' }, { key: 'police_verified_on', header: 'Police verified', kind: 'date' },
      { key: 'vendor_name', header: 'Vendor' }, { key: 'default_vehicle_number', header: 'Regular vehicle', kind: 'id' },
      { key: 'availability_status', header: 'Availability' }, { key: 'languages', header: 'Languages' },
      { key: 'experience_years', header: 'Experience (yrs)', kind: 'number' }, { key: 'trip_count', header: 'Trips', kind: 'number' },
      { key: 'is_active', header: 'Active', value: (r) => (r.is_active ? 'Yes' : 'No') },
    ],
    rows,
  }, p.format);
});

router.get('/export/assignments', canView, async (req, res) => {
  const p = req.query as Record<string, string>;
  const rows = q.all<any>(
    `SELECT a.*, b.trip_id, b.travel_date, b.booking_status, COALESCE(b.customer_name, b.passenger_name) AS customer,
            u.full_name AS assigned_by_name
       FROM trip_assignments a JOIN bookings b ON b.id = a.booking_id LEFT JOIN users u ON u.id = a.assigned_by
      WHERE (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
      ORDER BY a.id DESC`, { from: p.from ?? '', to: p.to ?? '' }
  );
  await sendTable(res, 'assignment-history', {
    name: 'Assignments', title: 'Vehicle and driver assignment history',
    notes: [filterNote({ From: p.from, To: p.to })],
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'customer', header: 'Customer' }, { key: 'vehicle_number', header: 'Vehicle', kind: 'id' },
      { key: 'vehicle_type', header: 'Vehicle type' }, { key: 'driver_name', header: 'Driver' },
      { key: 'driver_mobile', header: 'Driver mobile', kind: 'id' }, { key: 'window_start', header: 'Busy from' },
      { key: 'window_end', header: 'Busy until' }, { key: 'assigned_at', header: 'Assigned at', kind: 'datetime' },
      { key: 'assigned_by_name', header: 'Assigned by' }, { key: 'released_at', header: 'Released at', kind: 'datetime' },
      { key: 'release_reason', header: 'Released because' }, { key: 'override_reason', header: 'Clash override reason' },
      { key: 'booking_status', header: 'Trip status' },
    ],
    rows,
  }, p.format);
});

export default router;
