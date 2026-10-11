/**
 * Events — a wedding, a conference, a corporate offsite: one client, one bill
 * to company, many vehicles over one or more days.
 *
 * An event is a plan, not a second booking system. Its requirement lines
 * ("6 Innovas on 14-Oct at 07:00 from the Taj") are turned into ORDINARY
 * trips (bookings.event_id / event_requirement_id), so allotment, completion,
 * billing, invoicing and payments all run through the existing screens. The
 * event only reads them back to show where the whole job stands.
 *
 *   GET    /                         list (+ summary per event)
 *   GET    /export                   the list as Excel / CSV
 *   GET    /:id                      event + requirements + trips + summary + activity
 *   POST   /                         create
 *   PUT    /:id                      update
 *   POST   /:id/cancel               cancel open lines and un-started trips (never invoiced ones)
 *   POST   /:id/requirements/preview validate rows, save nothing
 *   POST   /:id/requirements         add one or many rows
 *   PUT    /:id/requirements/:rid    edit a row
 *   DELETE /:id/requirements/:rid    delete (no trips yet) or cancel (trips exist)
 *   POST   /:id/import/parse         .xlsx / .csv upload or pasted text -> headers, rows, suggested mapping
 *   POST   /:id/generate-trips       create the missing trips for every open line (idempotent)
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import multer from 'multer';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile, isoDate } from '../utils/validate';
import { sendTable, filterNote } from '../utils/exportSheet';
import { STAGE_SQL, STAGE_JOINS, STAGES } from '../services/tripStages';
import { saveCharges } from '../services/charges';
import { ensureDirectVendor, DIRECT_VENDOR_CODE } from '../services/directCustomer';
import { nextTripId, type InquirySource } from '../services/tripId';
import { nextBookingCode, recordTripEvent } from '../services/tripFlow';
import { resolveAirportDirection } from '../services/airport';
import {
  FIELD_LABEL, REQUIREMENT_FIELDS, applyMapping, parseDelimited, readXlsx, toTable, validateRows,
  type RequirementField, type RequirementInput, type NormalRequirement,
} from '../services/eventSheet';

const router = Router();
router.use(requireAuth);

const canView = requirePermission('events.view');
const canCreate = requirePermission('events.create');
const canUpdate = requirePermission('events.update');
const canDelete = requirePermission('events.delete', 'events.update');

export const EVENT_STATUSES = ['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planned', CONFIRMED: 'Confirmed', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
/** Trips that have not started and are not billed — the only ones an event cancel may touch. */
const UNSTARTED = `('DRAFT','INQUIRY','CONFIRMED','ASSIGNED')`;

/* ==========================================================================
   Helpers
   ========================================================================== */

function nextEventCode(when = new Date()): string {
  const yymm = `${String(when.getFullYear()).slice(2)}${String(when.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `EV-${yymm}-`;
  const row = q.get<{ n: number }>(
    `SELECT MAX(CAST(substr(event_code, @len + 1) AS INTEGER)) AS n FROM events WHERE event_code LIKE @p || '%'`,
    { p: prefix, len: prefix.length }
  );
  return `${prefix}${String((row?.n ?? 0) + 1).padStart(4, '0')}`;
}

function eventRow(id: number) {
  return q.get<any>(
    `SELECT e.*, v.vendor_name, v.company_name, v.code AS vendor_code, u.full_name AS created_by_name
       FROM events e JOIN vendors v ON v.id = e.vendor_id LEFT JOIN users u ON u.id = e.created_by
      WHERE e.id = @id`, { id }
  );
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The numbers for a set of events, from real rows only.
 *
 * billed   = total of the live invoices that carry at least one of the event's trips
 * received = payments on those invoices, reversed ones excluded
 */
function summaries(ids: number[]): Map<number, any> {
  const out = new Map<number, any>();
  if (!ids.length) return out;
  const list = ids.map((n) => Number(n)).filter((n) => Number.isInteger(n)).join(',');
  for (const id of ids) {
    out.set(id, {
      requirements: 0, requirements_cancelled: 0, vehicles_required: 0, trips_created: 0, trips_cancelled: 0,
      vehicles_allocated: 0, drivers_assigned: 0, trips_in_progress: 0, trips_completed: 0, awaiting_billing: 0,
      trips_billed: 0, trip_value: 0, billed: 0, received: 0, outstanding: 0, invoices: 0,
    });
  }
  for (const r of q.all<any>(
    `SELECT event_id,
            SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_lines,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_lines,
            SUM(CASE WHEN status = 'OPEN' THEN vehicle_count ELSE 0 END) AS vehicles
       FROM event_requirements WHERE event_id IN (${list}) GROUP BY event_id`
  )) {
    Object.assign(out.get(r.event_id), {
      requirements: r.open_lines ?? 0, requirements_cancelled: r.cancelled_lines ?? 0, vehicles_required: r.vehicles ?? 0,
    });
  }
  for (const r of q.all<any>(
    `SELECT b.event_id,
            SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW')
                      AND (b.vehicle_id IS NOT NULL OR COALESCE(b.vehicle_number,'') <> '') THEN 1 ELSE 0 END) AS vehicles,
            SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW')
                      AND (b.driver_id IS NOT NULL OR COALESCE(b.driver_name,'') <> '') THEN 1 ELSE 0 END) AS drivers,
            SUM(CASE WHEN b.booking_status = 'ONTRIP' THEN 1 ELSE 0 END) AS ontrip,
            SUM(CASE WHEN b.booking_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN b.booking_status = 'COMPLETED' AND i.id IS NULL AND b.billing_status <> 'INVOICED' THEN 1 ELSE 0 END) AS awaiting,
            SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW') AND (i.id IS NOT NULL OR b.billing_status = 'INVOICED') THEN 1 ELSE 0 END) AS billed,
            SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW') THEN COALESCE(c.total_amount,0) ELSE 0 END) AS value
       FROM bookings b ${STAGE_JOINS}
      WHERE b.event_id IN (${list}) GROUP BY b.event_id`
  )) {
    Object.assign(out.get(r.event_id), {
      trips_created: r.active ?? 0, trips_cancelled: r.cancelled ?? 0, vehicles_allocated: r.vehicles ?? 0,
      drivers_assigned: r.drivers ?? 0, trips_in_progress: r.ontrip ?? 0, trips_completed: r.completed ?? 0,
      awaiting_billing: r.awaiting ?? 0, trips_billed: r.billed ?? 0, trip_value: round2(r.value ?? 0),
    });
  }
  for (const r of q.all<any>(
    `WITH inv AS (
       SELECT DISTINCT b.event_id, iv.id, iv.total_amount
         FROM bookings b JOIN invoice_items ii ON ii.booking_id = b.id
         JOIN invoices iv ON iv.id = ii.invoice_id AND iv.status <> 'CANCELLED'
        WHERE b.event_id IN (${list}))
     SELECT inv.event_id, COUNT(*) AS n, SUM(inv.total_amount) AS billed,
            SUM((SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id = inv.id AND COALESCE(p.is_reversed,0) = 0)) AS received
       FROM inv GROUP BY inv.event_id`
  )) {
    const billed = round2(r.billed ?? 0);
    const received = round2(r.received ?? 0);
    Object.assign(out.get(r.event_id), { invoices: r.n ?? 0, billed, received, outstanding: round2(billed - received) });
  }
  return out;
}

/** Trips already raised for each requirement line (all of them, cancelled included, so a re-run never refills). */
function createdPerLine(eventId: number): Map<number, { all: number; active: number }> {
  const m = new Map<number, { all: number; active: number }>();
  for (const r of q.all<any>(
    `SELECT event_requirement_id AS rid, COUNT(*) AS n,
            SUM(CASE WHEN booking_status NOT IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS active
       FROM bookings WHERE event_id = @id AND event_requirement_id IS NOT NULL GROUP BY event_requirement_id`, { id: eventId }
  )) m.set(r.rid, { all: r.n, active: r.active ?? 0 });
  return m;
}

function requirementsOf(eventId: number) {
  const created = createdPerLine(eventId);
  return q.all<any>(
    `SELECT r.*, vc.name AS category_name FROM event_requirements r
       LEFT JOIN vehicle_categories vc ON vc.id = r.vehicle_category_id
      WHERE r.event_id = @id ORDER BY r.travel_date, r.reporting_time, r.line_no`, { id: eventId }
  ).map((r) => {
    const c = created.get(r.id) ?? { all: 0, active: 0 };
    return { ...r, trips_created: c.all, trips_active: c.active, trips_pending: r.status === 'OPEN' ? Math.max(0, r.vehicle_count - c.all) : 0 };
  });
}

function tripsOf(eventId: number) {
  const stageLabel = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
  return q.all<any>(
    `SELECT b.id, b.trip_id, b.booking_code, b.event_requirement_id, r.line_no, b.travel_date, b.reporting_time,
            b.trip_type, b.pickup_location, b.drop_location, b.passenger_name, b.passenger_mobile,
            b.vehicle_type, b.vehicle_number, b.driver_name, b.driver_mobile, b.booking_status, b.billing_status,
            COALESCE(c.total_amount, 0) AS total_amount, COALESCE(c.base_fare, 0) AS base_fare,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status, i.total_amount AS invoice_total,
            i.paid_amount AS invoice_paid, i.outstanding_amount AS invoice_outstanding,
            ${STAGE_SQL} AS stage
       FROM bookings b ${STAGE_JOINS}
       LEFT JOIN event_requirements r ON r.id = b.event_requirement_id
      WHERE b.event_id = @id
      ORDER BY b.travel_date, b.reporting_time, r.line_no, b.id`, { id: eventId }
  ).map((t) => ({ ...t, stage_label: stageLabel[t.stage] ?? t.stage }));
}

function activityOf(eventId: number) {
  return q.all<any>(
    `SELECT a.id, a.action, a.description, a.created_at, COALESCE(u.full_name, a.user_email) AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity_type = 'event' AND a.entity_id = @id ORDER BY a.id DESC LIMIT 100`, { id: eventId }
  );
}

/* ==========================================================================
   List and export
   ========================================================================== */

function listFilters(p: Record<string, string>) {
  const params = {
    search: String(p.search ?? '').trim(), status: String(p.status ?? ''), vendorId: Number(p.vendorId ?? 0) || 0,
    from: String(p.from ?? ''), to: String(p.to ?? ''),
  };
  const where = `WHERE (@search = '' OR e.event_code LIKE '%'||@search||'%' OR e.name LIKE '%'||@search||'%'
                         OR e.client_name LIKE '%'||@search||'%' OR e.venue LIKE '%'||@search||'%'
                         OR e.contact_person LIKE '%'||@search||'%' OR e.contact_mobile LIKE '%'||@search||'%'
                         OR v.vendor_name LIKE '%'||@search||'%')
      AND (@status = '' OR e.status = @status OR (@status = 'ACTIVE' AND e.status NOT IN ('COMPLETED','CANCELLED')))
      AND (@vendorId = 0 OR e.vendor_id = @vendorId)
      AND (@from = '' OR COALESCE(e.end_date, e.start_date) >= @from)
      AND (@to = '' OR e.start_date <= @to)`;
  return { params, where };
}

function listRows(p: Record<string, string>) {
  const { params, where } = listFilters(p);
  const rows = q.all<any>(
    `SELECT e.*, v.vendor_name, v.code AS vendor_code FROM events e JOIN vendors v ON v.id = e.vendor_id
      ${where} ORDER BY e.start_date DESC, e.id DESC LIMIT 1000`, params
  );
  const sums = summaries(rows.map((r) => r.id));
  return { params, rows: rows.map((r) => ({ ...r, status_label: STATUS_LABEL[r.status] ?? r.status, summary: sums.get(r.id) })) };
}

router.get('/', canView, (req, res) => {
  const { rows } = listRows(req.query as Record<string, string>);
  const kpis = {
    total: rows.length,
    active: rows.filter((r) => !['COMPLETED', 'CANCELLED'].includes(r.status)).length,
    upcoming: rows.filter((r) => r.status !== 'CANCELLED' && r.start_date >= new Date().toISOString().slice(0, 10)).length,
    vehicles_required: rows.reduce((s, r) => s + (r.status === 'CANCELLED' ? 0 : r.summary.vehicles_required), 0),
    trips_without_vehicle: rows.reduce((s, r) => s + Math.max(0, r.summary.trips_created - r.summary.vehicles_allocated), 0),
    agreed: round2(rows.reduce((s, r) => s + (r.status === 'CANCELLED' ? 0 : Number(r.agreed_amount ?? 0)), 0)),
    billed: round2(rows.reduce((s, r) => s + r.summary.billed, 0)),
    received: round2(rows.reduce((s, r) => s + r.summary.received, 0)),
    outstanding: round2(rows.reduce((s, r) => s + r.summary.outstanding, 0)),
  };
  res.json({ data: rows, kpis });
});

router.get('/export', canView, async (req, res) => {
  const { params, rows } = listRows(req.query as Record<string, string>);
  audit(req, 'DATA_EXPORTED', { entityType: 'event', description: `Events list (${rows.length} rows)` });
  await sendTable(res, 'Events', {
    name: 'Events', title: 'Events',
    notes: [filterNote({ Search: params.search, Status: STATUS_LABEL[params.status] ?? params.status, From: params.from, To: params.to,
      Company: params.vendorId ? rows[0]?.vendor_name : '' })],
    totals: ['agreed_amount', 'billed', 'received', 'outstanding'],
    columns: [
      { key: 'event_code', header: 'Event ID', kind: 'id' },
      { key: 'name', header: 'Event' },
      { key: 'vendor_name', header: 'Billed to' },
      { key: 'client_name', header: 'Client' },
      { key: 'contact_person', header: 'Contact' },
      { key: 'contact_mobile', header: 'Contact mobile', kind: 'id' },
      { key: 'venue', header: 'Venue' },
      { key: 'city', header: 'City' },
      { key: 'start_date', header: 'Start', kind: 'date' },
      { key: 'end_date', header: 'End', kind: 'date' },
      { key: 'status', header: 'Status', value: (r) => r.status_label },
      { key: 'requirements', header: 'Requirement lines', kind: 'number', value: (r) => r.summary.requirements },
      { key: 'vehicles_required', header: 'Vehicles required', kind: 'number', value: (r) => r.summary.vehicles_required },
      { key: 'trips_created', header: 'Trips created', kind: 'number', value: (r) => r.summary.trips_created },
      { key: 'vehicles_allocated', header: 'Vehicles allotted', kind: 'number', value: (r) => r.summary.vehicles_allocated },
      { key: 'drivers_assigned', header: 'Drivers assigned', kind: 'number', value: (r) => r.summary.drivers_assigned },
      { key: 'trips_completed', header: 'Trips completed', kind: 'number', value: (r) => r.summary.trips_completed },
      { key: 'awaiting_billing', header: 'Awaiting billing', kind: 'number', value: (r) => r.summary.awaiting_billing },
      { key: 'agreed_amount', header: 'Agreed amount', kind: 'money' },
      { key: 'billed', header: 'Billed', kind: 'money', value: (r) => r.summary.billed },
      { key: 'received', header: 'Received', kind: 'money', value: (r) => r.summary.received },
      { key: 'outstanding', header: 'Outstanding', kind: 'money', value: (r) => r.summary.outstanding },
    ],
    rows,
  }, String(req.query.format ?? 'xlsx'));
});

/* ==========================================================================
   One event
   ========================================================================== */

function findEvent(req: Request, res: Response): any | null {
  const id = Number(req.params.id);
  const e = Number.isInteger(id) && id > 0 ? eventRow(id) : undefined;
  if (!e) { res.status(404).json({ error: 'That event could not be found.' }); return null; }
  return e;
}

function eventDetail(id: number) {
  const e = eventRow(id)!;
  return {
    data: { ...e, status_label: STATUS_LABEL[e.status] ?? e.status },
    summary: summaries([id]).get(id),
    requirements: requirementsOf(id),
    trips: tripsOf(id),
  };
}

router.get('/:id(\\d+)', canView, (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  res.json({ ...eventDetail(e.id), activity: activityOf(e.id) });
});

const eventSchema = z.object({
  name: z.string().trim().min(2, 'Enter the event name.').max(160),
  /** The company billed. Empty means a direct (walk-in) customer. */
  vendorId: z.coerce.number().int().positive().nullable().optional(),
  clientName: z.string().trim().max(160).optional().default(''),
  contactPerson: z.string().trim().max(120).optional().default(''),
  contactMobile: optionalMobile.default(''),
  contactEmail: z.union([z.string().trim().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  venue: z.string().trim().max(300).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  startDate: isoDate,
  endDate: z.union([isoDate, z.literal('')]).optional().default(''),
  agreedAmount: z.union([z.coerce.number().min(0, 'Amount cannot be negative.').max(99_999_999), z.literal(''), z.null()]).optional(),
  status: z.enum(['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']).default('PLANNED'),
  notes: z.string().trim().max(2000).optional().default(''),
}).refine((d) => !d.endDate || d.endDate >= d.startDate, { message: 'The end date cannot be before the start date.', path: ['endDate'] });

type EventBody = z.infer<typeof eventSchema>;

function resolveVendor(b: EventBody, existingVendorId?: number): { vendor?: any; error?: string } {
  if (!b.vendorId) {
    const v = ensureDirectVendor();
    if (!b.clientName && !b.contactPerson) return { error: 'A direct customer event needs the client name or contact person — the invoice is addressed to them.' };
    return { vendor: v };
  }
  const v = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: b.vendorId });
  if (!v) return { error: 'That company no longer exists.' };
  if (v.status !== 'ACTIVE' && v.id !== existingVendorId) return { error: `${v.vendor_name} is inactive. Choose an active company.` };
  if (v.code === DIRECT_VENDOR_CODE && !b.clientName && !b.contactPerson) {
    return { error: 'A direct customer event needs the client name or contact person — the invoice is addressed to them.' };
  }
  return { vendor: v };
}

const eventParams = (b: EventBody, vendorId: number) => ({
  name: b.name, vendor: vendorId, client: b.clientName || null, person: b.contactPerson || null,
  mobile: b.contactMobile || null, email: b.contactEmail ? b.contactEmail.toLowerCase() : null,
  venue: b.venue || null, city: b.city || null, start: b.startDate, end: b.endDate || null,
  amount: b.agreedAmount === '' || b.agreedAmount === null || b.agreedAmount === undefined ? null : Number(b.agreedAmount),
  status: b.status, notes: b.notes || null,
});

router.post('/', canCreate, validateBody(eventSchema), (req, res) => {
  const b = req.body as EventBody;
  const { vendor, error } = resolveVendor(b);
  if (error) return res.status(400).json({ error });
  const id = getDb().transaction(() => {
    const code = nextEventCode();
    const info = q.run(
      `INSERT INTO events (event_code, name, vendor_id, client_name, contact_person, contact_mobile, contact_email,
          venue, city, start_date, end_date, agreed_amount, status, notes, created_by)
       VALUES (@code, @name, @vendor, @client, @person, @mobile, @email, @venue, @city, @start, @end, @amount, @status, @notes, @uid)`,
      { ...eventParams(b, vendor.id), code, uid: req.user!.id }
    );
    return Number(info.lastInsertRowid);
  })();
  const e = eventRow(id)!;
  audit(req, 'EVENT_CREATED', { entityType: 'event', entityId: id, description: `${e.event_code} — ${e.name} for ${e.vendor_name}, ${e.start_date}` });
  res.status(201).json({ ...eventDetail(id), message: `Event ${e.event_code} created.` });
});

router.put('/:id(\\d+)', canUpdate, validateBody(eventSchema), (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  if (e.status === 'CANCELLED') return res.status(409).json({ error: `${e.event_code} is cancelled and cannot be edited.` });
  const b = req.body as EventBody;
  const { vendor, error } = resolveVendor(b, e.vendor_id);
  if (error) return res.status(400).json({ error });
  if (vendor.id !== e.vendor_id) {
    const n = q.get<any>(`SELECT COUNT(*) c FROM bookings WHERE event_id = @id`, { id: e.id })!.c;
    if (n > 0) return res.status(409).json({ error: `${e.event_code} already has ${n} trip(s) billed to ${e.vendor_name}, so the company cannot be changed.` });
  }
  const p = eventParams(b, vendor.id);
  const changes: string[] = [];
  const compare: [string, unknown, unknown][] = [
    ['name', e.name, p.name], ['company', e.vendor_id, p.vendor], ['start', e.start_date, p.start], ['end', e.end_date, p.end],
    ['status', e.status, p.status], ['agreed', e.agreed_amount, p.amount], ['venue', e.venue, p.venue],
  ];
  for (const [k, a, c] of compare) if (String(a ?? '') !== String(c ?? '')) changes.push(`${k}: ${a ?? '—'} → ${c ?? '—'}`);
  q.run(
    `UPDATE events SET name=@name, vendor_id=@vendor, client_name=@client, contact_person=@person, contact_mobile=@mobile,
        contact_email=@email, venue=@venue, city=@city, start_date=@start, end_date=@end, agreed_amount=@amount,
        status=@status, notes=@notes, updated_at=datetime('now') WHERE id=@id`,
    { ...p, id: e.id }
  );
  audit(req, 'EVENT_UPDATED', { entityType: 'event', entityId: e.id, description: `${e.event_code}${changes.length ? ' — ' + changes.join('; ') : ''}`, meta: { changes } });
  res.json({ ...eventDetail(e.id), message: `${e.event_code} saved.` });
});

const cancelSchema = z.object({
  reason: z.string().trim().max(40).optional().default('PLAN_CHANGED'),
  note: z.string().trim().max(300).optional().default(''),
});

/** Cancel the given trips (un-started, not invoiced only). Returns how many. */
function cancelTrips(ids: number[], reasonCode: string, why: string, uid: number): number {
  let n = 0;
  for (const id of ids) {
    const t = q.get<any>(
      `SELECT b.id, b.trip_id, b.booking_status, b.billing_status,
              (SELECT COUNT(*) FROM invoice_items ii JOIN invoices iv ON iv.id = ii.invoice_id
                WHERE ii.booking_id = b.id AND iv.status <> 'CANCELLED') AS on_invoice
         FROM bookings b WHERE b.id = @id`, { id }
    );
    if (!t || !['DRAFT', 'INQUIRY', 'CONFIRMED', 'ASSIGNED'].includes(t.booking_status)) continue;
    if (t.billing_status === 'INVOICED' || t.on_invoice > 0) continue;
    q.run(
      `UPDATE bookings SET booking_status = 'CANCELLED', billing_status = 'CANCELLED', cancelled_at = datetime('now'),
              cancel_reason = @reason, updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
      { id, reason: reasonCode, uid }
    );
    q.run(
      `UPDATE trip_assignments SET released_at = datetime('now'), release_reason = @why
        WHERE booking_id = @id AND released_at IS NULL`, { id, why }
    );
    recordTripEvent({ bookingId: id, tripId: t.trip_id, status: 'CANCELLED', title: 'Cancelled', detail: why, userId: uid });
    n++;
  }
  return n;
}

router.post('/:id(\\d+)/cancel', canUpdate, validateBody(cancelSchema), (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  if (e.status === 'CANCELLED') return res.status(409).json({ error: `${e.event_code} is already cancelled.` });
  const b = req.body as z.infer<typeof cancelSchema>;
  const reason = q.get<any>(`SELECT code, label FROM master_values WHERE list_type = 'CANCELLATION_REASON' AND code = @c`, { c: b.reason });
  const reasonCode = reason?.code ?? 'PLAN_CHANGED';
  const why = `Event ${e.event_code} cancelled${reason ? ` — ${reason.label}` : ''}${b.note ? ` (${b.note})` : ''}`;

  const result = getDb().transaction(() => {
    const lines = q.run(`UPDATE event_requirements SET status = 'CANCELLED', updated_at = datetime('now') WHERE event_id = @id AND status = 'OPEN'`, { id: e.id }).changes;
    const ids = q.all<any>(`SELECT id FROM bookings WHERE event_id = @id AND booking_status IN ${UNSTARTED}`, { id: e.id }).map((r) => r.id);
    const trips = cancelTrips(ids, reasonCode, why, req.user!.id);
    const kept = q.get<any>(`SELECT COUNT(*) c FROM bookings WHERE event_id = @id AND booking_status NOT IN ('CANCELLED','NO_SHOW')`, { id: e.id })!.c;
    q.run(`UPDATE events SET status = 'CANCELLED', notes = CASE WHEN @note = '' THEN notes ELSE trim(COALESCE(notes,'') || char(10) || @note) END,
             updated_at = datetime('now') WHERE id = @id`, { id: e.id, note: b.note ? `Cancelled: ${b.note}` : '' });
    return { lines, trips, kept };
  })();

  audit(req, 'EVENT_CANCELLED', {
    entityType: 'event', entityId: e.id,
    description: `${e.event_code} cancelled — ${result.lines} line(s) and ${result.trips} trip(s) cancelled, ${result.kept} started/billed trip(s) kept`,
  });
  res.json({
    ...eventDetail(e.id), result,
    message: `${e.event_code} cancelled. ${result.trips} trip(s) cancelled${result.kept ? `; ${result.kept} trip(s) already under way, completed or invoiced were left as they are` : ''}.`,
  });
});

/* ==========================================================================
   Requirements
   ========================================================================== */

const rowsSchema = z.object({
  rows: z.array(z.record(z.any())).min(1, 'Add at least one row.').max(2000, 'At most 2000 rows at a time.'),
});

router.post('/:id(\\d+)/requirements/preview', canView, validateBody(rowsSchema), (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  res.json({ data: validateRows(req.body.rows as RequirementInput[], e) });
});

function insertRequirement(eventId: number, lineNo: number, d: NormalRequirement): number {
  return Number(q.run(
    `INSERT INTO event_requirements (event_id, line_no, vehicle_category_id, vehicle_type, vehicle_count, travel_date,
        reporting_time, pickup_address, drop_address, duty_type, trip_type, passenger_name, passenger_mobile,
        pax_count, fare_per_vehicle, remarks)
     VALUES (@event, @line, @vehicle_category_id, @vehicle_type, @vehicle_count, @travel_date, @reporting_time,
        @pickup_address, @drop_address, @duty_type, @trip_type, @passenger_name, @passenger_mobile, @pax_count,
        @fare_per_vehicle, @remarks)`,
    { ...d, event: eventId, line: lineNo }
  ).lastInsertRowid);
}

router.post('/:id(\\d+)/requirements', canUpdate, validateBody(rowsSchema), (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  if (e.status === 'CANCELLED') return res.status(409).json({ error: `${e.event_code} is cancelled.` });
  const check = validateRows(req.body.rows as RequirementInput[], e);
  if (check.invalid > 0) {
    return res.status(400).json({
      error: `${check.invalid} row(s) need attention before anything is saved.`, code: 'ROWS_INVALID', data: check,
    });
  }
  const ids = getDb().transaction(() => {
    let line = q.get<any>('SELECT COALESCE(MAX(line_no),0) n FROM event_requirements WHERE event_id = @id', { id: e.id })!.n;
    return check.rows.map((r) => insertRequirement(e.id, ++line, r.data!));
  })();
  audit(req, 'EVENT_REQUIREMENTS_ADDED', {
    entityType: 'event', entityId: e.id,
    description: `${e.event_code}: ${ids.length} requirement line(s) added, ${check.vehicles} vehicle(s)`,
  });
  res.status(201).json({ ...eventDetail(e.id), created: ids, message: `${ids.length} line(s) added — ${check.vehicles} vehicle(s).` });
});

router.put('/:id(\\d+)/requirements/:rid(\\d+)', canUpdate, (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  const r = q.get<any>('SELECT * FROM event_requirements WHERE id = @rid AND event_id = @id', { rid: Number(req.params.rid), id: e.id });
  if (!r) return res.status(404).json({ error: 'That requirement line could not be found.' });
  if (r.status !== 'OPEN') return res.status(409).json({ error: 'That line is cancelled and cannot be edited.' });
  const check = validateRows([req.body ?? {}], e);
  const row = check.rows[0];
  if (!row.ok) return res.status(400).json({ error: row.errors.map((x) => x.message).join(' '), code: 'ROWS_INVALID', data: check });
  const created = createdPerLine(e.id).get(r.id) ?? { all: 0, active: 0 };
  if (row.data!.vehicle_count < created.all) {
    return res.status(409).json({
      error: `${created.all} trip(s) are already created for this line, so it cannot drop to ${row.data!.vehicle_count}. Cancel the extra trips from Trips first.`,
    });
  }
  q.run(
    `UPDATE event_requirements SET vehicle_category_id=@vehicle_category_id, vehicle_type=@vehicle_type,
        vehicle_count=@vehicle_count, travel_date=@travel_date, reporting_time=@reporting_time,
        pickup_address=@pickup_address, drop_address=@drop_address, duty_type=@duty_type, trip_type=@trip_type,
        passenger_name=@passenger_name, passenger_mobile=@passenger_mobile, pax_count=@pax_count,
        fare_per_vehicle=@fare_per_vehicle, remarks=@remarks, updated_at=datetime('now') WHERE id=@rid`,
    { ...row.data!, rid: r.id }
  );
  audit(req, 'EVENT_REQUIREMENT_UPDATED', {
    entityType: 'event', entityId: e.id,
    description: `${e.event_code} line ${r.line_no}: ${row.data!.vehicle_count} × ${row.data!.vehicle_type} on ${row.data!.travel_date}`,
  });
  res.json({
    ...eventDetail(e.id), warnings: row.warnings,
    message: `Line ${r.line_no} saved.${created.all ? ' Trips already created keep their own details — edit them from Trips.' : ''}`,
  });
});

router.delete('/:id(\\d+)/requirements/:rid(\\d+)', canDelete, (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  const r = q.get<any>('SELECT * FROM event_requirements WHERE id = @rid AND event_id = @id', { rid: Number(req.params.rid), id: e.id });
  if (!r) return res.status(404).json({ error: 'That requirement line could not be found.' });
  const created = createdPerLine(e.id).get(r.id) ?? { all: 0, active: 0 };
  if (created.all === 0) {
    q.run('DELETE FROM event_requirements WHERE id = @id', { id: r.id });
    audit(req, 'EVENT_REQUIREMENT_DELETED', { entityType: 'event', entityId: e.id, description: `${e.event_code} line ${r.line_no} deleted` });
    return res.json({ ...eventDetail(e.id), deleted: true, message: `Line ${r.line_no} deleted.` });
  }
  if (r.status === 'CANCELLED') return res.status(409).json({ error: 'That line is already cancelled.' });
  const why = `Event ${e.event_code} line ${r.line_no} cancelled`;
  const trips = getDb().transaction(() => {
    q.run(`UPDATE event_requirements SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = @id`, { id: r.id });
    const ids = q.all<any>(`SELECT id FROM bookings WHERE event_requirement_id = @id AND booking_status IN ${UNSTARTED}`, { id: r.id }).map((x) => x.id);
    return cancelTrips(ids, 'PLAN_CHANGED', why, req.user!.id);
  })();
  audit(req, 'EVENT_REQUIREMENT_DELETED', { entityType: 'event', entityId: e.id, description: `${why}; ${trips} trip(s) cancelled` });
  res.json({
    ...eventDetail(e.id), cancelled: true,
    message: `Line ${r.line_no} had trips, so it was cancelled instead of deleted. ${trips} un-started trip(s) cancelled; trips under way, completed or invoiced were kept.`,
  });
});

/* ==========================================================================
   Import: file upload or pasted grid -> headers, rows and a suggested mapping
   ========================================================================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!['.xlsx', '.csv', '.tsv', '.txt'].includes(ext)) {
      const hint = ext === '.xls' ? ' Old .xls files must be saved as .xlsx in Excel first.' : '';
      return cb(Object.assign(new Error(`"${ext || 'That file'}" cannot be read. Choose an .xlsx or .csv file.${hint}`), { status: 400 }));
    }
    cb(null, true);
  },
});

function uploadOptional(req: Request, res: Response, next: NextFunction) {
  if (!req.is('multipart/form-data')) return next();
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is larger than 5 MB.' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload problem: ${err.message}. Send the file in a field called "file".` });
    return res.status(err.status ?? 400).json({ error: err.message ?? 'The upload could not be read.' });
  });
}

router.post('/:id(\\d+)/import/parse', canUpdate, uploadOptional, async (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  let raw: string[][] = [];
  let source = '';
  try {
    if (req.file) {
      const ext = path.extname(req.file.originalname || '').toLowerCase();
      source = req.file.originalname;
      if (ext === '.xlsx') {
        const buf = req.file.buffer;
        if (!(buf[0] === 0x50 && buf[1] === 0x4b)) return res.status(400).json({ error: 'This is not a real .xlsx file. Open it in Excel and save as .xlsx.' });
        raw = await readXlsx(buf);
      } else {
        raw = parseDelimited(req.file.buffer.toString('utf8'), ext === '.tsv' ? '\t' : undefined);
      }
    } else if (typeof req.body?.base64 === 'string' && req.body.base64) {
      const buf = Buffer.from(req.body.base64, 'base64');
      source = String(req.body.filename ?? 'upload.xlsx');
      raw = buf[0] === 0x50 && buf[1] === 0x4b ? await readXlsx(buf) : parseDelimited(buf.toString('utf8'));
    } else if (typeof req.body?.text === 'string' && req.body.text.trim()) {
      source = 'Pasted rows';
      raw = parseDelimited(String(req.body.text), String(req.body.text).includes('\t') ? '\t' : undefined);
    } else {
      return res.status(400).json({ error: 'Choose an .xlsx or .csv file, or paste the rows.' });
    }
  } catch {
    return res.status(400).json({ error: 'The spreadsheet could not be read. It may be damaged or password-protected — save it again as .xlsx and retry.' });
  }
  if (!raw.length) return res.status(400).json({ error: 'No rows were found in that sheet.' });
  if (raw.length > 2001) return res.status(400).json({ error: `That sheet has ${raw.length} rows; import at most 2000 at a time.` });

  const t = toTable(raw);
  res.json({
    data: {
      source, headers: t.headers, hasHeader: t.hasHeader, rows: t.rows, total: t.rows.length,
      mapping: t.mapping,
      fields: REQUIREMENT_FIELDS.map((f) => ({ key: f, label: FIELD_LABEL[f], required: f === 'travelDate' || f === 'vehicleCategory' })),
      mapped: applyMapping(t.rows.slice(0, 10), t.mapping as Partial<Record<RequirementField, number>>),
    },
  });
});

/* ==========================================================================
   Generate trips
   ========================================================================== */

/** What /generate-trips would do right now — shown in the confirmation. */
function tripPlan(eventId: number) {
  return requirementsOf(eventId)
    .filter((r) => r.status === 'OPEN' && r.trips_pending > 0)
    .map((r) => ({ id: r.id, line_no: r.line_no, travel_date: r.travel_date, vehicle_type: r.category_name ?? r.vehicle_type, to_create: r.trips_pending }));
}

router.get('/:id(\\d+)/generate-trips', canView, (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  const plan = tripPlan(e.id);
  res.json({ data: { lines: plan, trips: plan.reduce((s, p) => s + p.to_create, 0) } });
});

router.post('/:id(\\d+)/generate-trips', canUpdate, (req, res) => {
  const e = findEvent(req, res);
  if (!e) return;
  if (e.status === 'CANCELLED') return res.status(409).json({ error: `${e.event_code} is cancelled; no trips can be created.` });
  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: e.vendor_id });
  if (!vendor) return res.status(409).json({ error: 'The company this event is billed to no longer exists.' });
  const direct = vendor.code === DIRECT_VENDOR_CODE;
  const source: InquirySource = direct ? 'WALKIN' : 'VENDOR';
  const uid = req.user!.id;

  // Everything inside one transaction, and the count of what exists is read
  // inside it too — two clicks at once cannot both create the same trips.
  const created = getDb().transaction(() => {
    const out: { id: number; tripId: string; line: number }[] = [];
    const lines = q.all<any>(
      `SELECT r.*, vc.name AS category_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.event_requirement_id = r.id) AS existing
         FROM event_requirements r LEFT JOIN vehicle_categories vc ON vc.id = r.vehicle_category_id
        WHERE r.event_id = @id AND r.status = 'OPEN' ORDER BY r.travel_date, r.reporting_time, r.line_no`, { id: e.id }
    );
    for (const r of lines) {
      const missing = r.vehicle_count - r.existing;
      for (let k = r.existing + 1; k <= r.existing + missing; k++) {
        const tripId = nextTripId(source);
        const code = nextBookingCode();
        const pickup = r.pickup_address || e.venue || '';
        const drop = r.drop_address || '';
        const tripType = r.trip_type || 'LOCAL';
        const info = q.run(
          `INSERT INTO bookings (
              booking_code, trip_id, inquiry_source, booking_source, vendor_id, vendor_booking_ref, event_id, event_requirement_id,
              booking_date, travel_date, reporting_time, trip_type, airport_direction, duty_type, city,
              pickup_location, pickup_address, drop_location, drop_address,
              passenger_name, passenger_mobile, pax_count,
              customer_name, customer_mobile, customer_email,
              vehicle_type, vehicle_category_id, remarks, inquiry_message,
              booking_status, billing_status, created_by, updated_by)
           VALUES (
              @code, @tripId, @source, @bsource, @vendor, @ref, @event, @rid,
              date('now'), @date, @time, @tripType, @airport, @duty, @city,
              @pickup, @pickup, @drop, @drop,
              @pname, @pmobile, @pax,
              @cname, @cmobile, @cemail,
              @vtype, @cat, @remarks, @message,
              'CONFIRMED', 'PENDING', @uid, @uid)`,
          {
            code, tripId, source, bsource: direct ? 'DIRECT' : 'VENDOR', vendor: vendor.id,
            ref: `${e.event_code}/L${r.line_no}/${k}`, event: e.id, rid: r.id,
            date: r.travel_date, time: r.reporting_time ?? '', tripType,
            airport: resolveAirportDirection(tripType, null, pickup, drop), duty: r.duty_type, city: e.city,
            pickup, drop,
            pname: r.passenger_name || e.contact_person || e.client_name || null,
            pmobile: r.passenger_mobile || e.contact_mobile || null, pax: r.pax_count,
            cname: e.client_name || e.contact_person || null, cmobile: e.contact_mobile || null, cemail: e.contact_email || null,
            vtype: r.category_name ?? r.vehicle_type, cat: r.vehicle_category_id, remarks: r.remarks,
            message: `Event ${e.event_code} — ${e.name}. Line ${r.line_no}, vehicle ${k} of ${r.vehicle_count}.`, uid,
          }
        );
        const bookingId = Number(info.lastInsertRowid);
        saveCharges(bookingId, {
          baseFare: Number(r.fare_per_vehicle ?? 0),
          taxMode: vendor.tax_mode ?? 'IGST', taxRate: Number(vendor.tax_rate ?? 5),
          tollParkingTaxable: !!vendor.toll_parking_taxable,
        });
        recordTripEvent({
          bookingId, tripId, status: 'CONFIRMED', title: 'Booking created',
          detail: `Event ${e.event_code} · ${e.name}`, userId: uid,
        });
        out.push({ id: bookingId, tripId, line: r.line_no });
      }
    }
    if (out.length && e.status === 'PLANNED') {
      q.run(`UPDATE events SET status = 'CONFIRMED', updated_at = datetime('now') WHERE id = @id`, { id: e.id });
    }
    return out;
  })();

  if (created.length) {
    audit(req, 'EVENT_TRIPS_GENERATED', {
      entityType: 'event', entityId: e.id,
      description: `${e.event_code}: ${created.length} trip(s) created (${created[0].tripId}${created.length > 1 ? ` … ${created[created.length - 1].tripId}` : ''})`,
      meta: { trips: created.map((c) => c.tripId) },
    });
  }
  res.status(created.length ? 201 : 200).json({
    ...eventDetail(e.id),
    created: created.map((c) => c.id),
    createdTrips: created,
    message: created.length ? `${created.length} trip(s) created.` : 'Every open line already has its trips — nothing new was created.',
  });
});

export default router;
