/**
 * Trip management — the office's view of the customer journey.
 *
 * One screen's worth of API: every enquiry and booking from every channel,
 * filterable by where it came from, with the actions that move it along —
 * confirm, allot a car and driver, email the customer, run the trip, complete
 * it, raise the invoice.
 *
 * These sit alongside /api/bookings rather than replacing it. That route is the
 * vendor booking sheet with its charge lines and its own form; this one is the
 * lifecycle. Both read and write the same `bookings` row, so an office that
 * prefers the old screen loses nothing.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile, requiredMobile, isoDate } from '../utils/validate';
import { computeCharges, type TaxMode } from '../services/billing';
import { saveCharges, storedChargeInput } from '../services/charges';
import { STAGES, STAGE_SQL, STAGE_JOINS, CONFIRMED_STAGES, missingDetails, tripSummary } from '../services/tripStages';
import { findClashes, describeClash, blockingDocuments, tripWindow } from '../services/fleet';
import { matchCategoryId } from '../services/bootstrap';
import { loadRule } from '../services/fareEngine';
import { sendTable, filterNote } from '../utils/exportSheet';
import { ensureDirectVendor } from '../services/directCustomer';
import { issueTripInvoice } from '../services/invoiceIssue';
import { sendMail, mailConfig } from '../services/mailer';
import { feedbackForBooking, requestFeedback } from '../services/feedback';
import { airportDirectionField, resolveAirportDirection } from '../services/airport';
import { requestOrigin } from '../utils/origin';
import { confirmProblems, unconfirmed, unconfirmedMessage } from '../services/billingConfirm';
import { inquiryCustomerEmail, invoiceEmail, quotationEmail, tripDetailsEmail } from '../services/emailTemplates';
import { ALL_SOURCES, SOURCE_LABEL, type InquirySource } from '../services/tripId';
import {
  allowedNext, canMoveTo, createInquiryTrip, portalUrl, publicTrip,
  recordTripEvent, STATUS_LABEL, tripEvents, tripRow, TRIP_TRAIL,
} from '../services/tripFlow';

const router = Router();
router.use(requireAuth);

/* ==========================================================================
   Reference data the Trips screen needs to render its filters
   ========================================================================== */

router.get('/meta', requirePermission('bookings.view'), (_req, res) => {
  res.json({
    sources: ALL_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] })),
    statuses: Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
    stages: STAGES,
    trail: TRIP_TRAIL,
    staff: q.all<any>(
      `SELECT u.id, u.full_name, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = 1 ORDER BY u.full_name`
    ),
    categories: q.all<any>('SELECT id, name, segment, seating FROM vehicle_categories WHERE is_active = 1 ORDER BY display_order, name'),
    cancelReasons: q.all<any>(
      `SELECT code, label FROM master_values WHERE list_type = 'CANCELLATION_REASON' AND is_active = 1 ORDER BY sort_order, label`
    ),
    mail: (() => {
      const c = mailConfig();
      return { from: c.fromAddress, enabled: c.enabled, adminInbox: c.adminInbox };
    })(),
  });
});

/* ==========================================================================
   List
   ========================================================================== */

/**
 * The filters every list view and its export share, so the export is always
 * exactly the rows on screen.
 */
function listFilters(p: Record<string, string>) {
  const params = {
    search: (p.search ?? '').trim(),
    source: p.source ?? '',
    status: p.status ?? '',
    stage: p.stage ?? '',
    from: p.from ?? '',
    to: p.to ?? '',
    createdFrom: p.createdFrom ?? '',
    createdTo: p.createdTo ?? '',
    invoiced: p.invoiced ?? '',      // 'yes' | 'no' | ''
    ownerId: Number(p.ownerId ?? 0),
    unowned: p.ownerId === 'none' ? 1 : 0,
    vendorId: Number(p.vendorId ?? 0),
    categoryId: Number(p.categoryId ?? 0),
    tripType: p.tripType ?? '',
    vehicleId: Number(p.vehicleId ?? 0),
    driverId: Number(p.driverId ?? 0),
    eventId: Number(p.eventId ?? 0),
    payment: p.payment ?? '',        // 'pending' | 'overdue' | ''
    billingConfirmed: p.billingConfirmed ?? '',  // 'yes' | 'no' | ''
  };
  const stages = params.stage === 'CONFIRMED_ALL' ? CONFIRMED_STAGES : params.stage ? [params.stage] : [];
  const where = `
    WHERE b.trip_id IS NOT NULL
      AND (@source = '' OR b.inquiry_source = @source)
      AND (@search = '' OR b.trip_id LIKE '%'||@search||'%'
                        OR b.booking_code LIKE '%'||@search||'%'
                        OR b.vendor_booking_ref LIKE '%'||@search||'%'
                        OR b.customer_name LIKE '%'||@search||'%'
                        OR b.customer_mobile LIKE '%'||@search||'%'
                        OR b.customer_email LIKE '%'||@search||'%'
                        OR b.passenger_name LIKE '%'||@search||'%'
                        OR b.passenger_mobile LIKE '%'||@search||'%'
                        OR b.pickup_location LIKE '%'||@search||'%'
                        OR b.drop_location LIKE '%'||@search||'%'
                        OR b.vehicle_number LIKE '%'||@search||'%'
                        OR b.driver_name LIKE '%'||@search||'%'
                        OR v.vendor_name LIKE '%'||@search||'%'
                        OR v.company_name LIKE '%'||@search||'%'
                        OR i.invoice_number LIKE '%'||@search||'%')
      AND (@status = '' OR b.booking_status = @status)
      AND (@from = '' OR b.travel_date >= @from)
      AND (@to = '' OR b.travel_date <= @to)
      AND (@createdFrom = '' OR date(b.created_at) >= @createdFrom)
      AND (@createdTo = '' OR date(b.created_at) <= @createdTo)
      AND (@invoiced = ''
           OR (@invoiced = 'yes' AND i.id IS NOT NULL)
           OR (@invoiced = 'no'  AND i.id IS NULL))
      AND (@ownerId = 0 OR b.owner_user_id = @ownerId)
      AND (@unowned = 0 OR b.owner_user_id IS NULL)
      AND (@vendorId = 0 OR b.vendor_id = @vendorId)
      AND (@categoryId = 0 OR b.vehicle_category_id = @categoryId)
      AND (@tripType = '' OR b.trip_type = @tripType)
      AND (@vehicleId = 0 OR b.vehicle_id = @vehicleId)
      AND (@driverId = 0 OR b.driver_id = @driverId)
      AND (@eventId = 0 OR b.event_id = @eventId)
      AND (@payment = ''
           OR (@payment = 'pending' AND i.id IS NOT NULL AND COALESCE(i.outstanding_amount,0) > 0.005)
           OR (@payment = 'overdue' AND i.id IS NOT NULL AND COALESCE(i.outstanding_amount,0) > 0.005 AND i.due_date < date('now')))
      AND (@billingConfirmed = ''
           OR (@billingConfirmed = 'yes' AND b.billing_confirmed_at IS NOT NULL)
           OR (@billingConfirmed = 'no' AND b.billing_confirmed_at IS NULL))
      ${stages.length ? `AND (${STAGE_SQL}) IN (${stages.map((x) => `'${x.replace(/[^A-Z_]/g, '')}'`).join(',')})` : ''}`;
  return { params, where };
}

const LIST_FROM = `
       FROM bookings b
       JOIN vendors v ON v.id = b.vendor_id
       ${STAGE_JOINS}
       LEFT JOIN drivers d ON d.id = b.driver_id
       LEFT JOIN customers cu ON cu.id = b.customer_id
       LEFT JOIN users ow ON ow.id = b.owner_user_id
       LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id`;

const LIST_COLUMNS = `
       b.id, b.trip_id, b.booking_code, b.inquiry_source, b.booking_status, b.billing_status,
       b.travel_date, b.travel_date_to, b.reporting_time, b.trip_type, b.created_at, b.vendor_id, b.vendor_booking_ref,
       b.pickup_location, b.pickup_address, b.drop_location, b.drop_address,
       b.customer_name, b.customer_mobile, b.customer_email, b.passenger_name, b.passenger_mobile, b.passenger_email,
       b.pax_count, b.vehicle_type, b.vehicle_category_id, b.vehicle_number, b.driver_name, b.driver_mobile,
       b.assigned_at, b.completed_at, b.details_sent_at, b.customer_id,
       b.owner_user_id, b.quote_status, b.quote_sent_at, b.cancel_reason, b.supplier_cost,
       v.vendor_name, v.code AS vendor_code, vc.name AS category_name,
       ow.full_name AS owner_name,
       c.total_amount, c.taxable_amount, d.full_name AS driver_full_name, d.mobile AS driver_roster_mobile,
       cu.email AS account_email,
       i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total,
       i.status AS invoice_status, i.sent_at AS invoice_sent_at, i.tax_mode AS invoice_tax_mode,
       i.outstanding_amount AS invoice_outstanding, i.paid_amount AS invoice_paid, i.due_date AS invoice_due_date,
       CASE WHEN i.id IS NOT NULL AND COALESCE(i.outstanding_amount,0) > 0.005 AND i.due_date < date('now') THEN 1 ELSE 0 END AS payment_overdue,
       b.billing_confirmed_at, b.event_id, b.driver_id, b.vehicle_id, b.actual_km, b.actual_hours,
       (SELECT name FROM events ev WHERE ev.id = b.event_id) AS event_name,
       (${STAGE_SQL}) AS stage`;

const SORTS: Record<string, string> = {
  travel_asc: 'b.travel_date ASC, b.reporting_time ASC, b.id ASC',
  travel_desc: 'b.travel_date DESC, b.reporting_time DESC, b.id DESC',
  created_desc: 'b.created_at DESC, b.id DESC',
  created_asc: 'b.created_at ASC, b.id ASC',
  fare_desc: 'COALESCE(c.total_amount,0) DESC, b.id DESC',
  customer_asc: "lower(COALESCE(b.customer_name, b.passenger_name, '')) ASC",
  trip_asc: 'b.trip_id ASC',
  trip_desc: 'b.trip_id DESC',
  // Default: what somebody has to act on first.
  attention: `CASE (${STAGE_SQL})
      WHEN 'NEW' THEN 0 WHEN 'ASSIGNED_TO_STAFF' THEN 1 WHEN 'QUOTE_PENDING' THEN 2 WHEN 'AWAITING_ASSIGNMENT' THEN 3
      WHEN 'AWAITING_CONFIRMATION' THEN 4 WHEN 'IN_PROGRESS' THEN 5 WHEN 'UPCOMING' THEN 6
      WHEN 'AWAITING_BILLING' THEN 7 WHEN 'BILLING_IN_PROGRESS' THEN 8 WHEN 'AWAITING_INVOICE' THEN 9
      WHEN 'BILLED' THEN 10 ELSE 11 END,
    CASE WHEN b.booking_status IN ('INQUIRY','CONFIRMED','ASSIGNED','ONTRIP') THEN b.travel_date END ASC,
    b.travel_date DESC, b.id DESC`,
};

/**
 * Mobiles that appear on more than one open enquiry or trip within a week of
 * each other — very likely the same customer asking twice through two channels.
 */
function duplicateMobiles(ids: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  if (!ids.length) return out;
  const rows = q.all<any>(
    `SELECT a.id, b2.trip_id AS other
       FROM bookings a JOIN bookings b2 ON b2.id <> a.id
        AND b2.trip_id IS NOT NULL
        AND b2.booking_status NOT IN ('CANCELLED','NO_SHOW')
        AND substr(replace(COALESCE(NULLIF(b2.customer_mobile,''), b2.passenger_mobile),' ',''), -10)
          = substr(replace(COALESCE(NULLIF(a.customer_mobile,''), a.passenger_mobile),' ',''), -10)
        AND abs(julianday(b2.travel_date) - julianday(a.travel_date)) <= 1
        AND lower(COALESCE(b2.pickup_location,'')) = lower(COALESCE(a.pickup_location,''))
      WHERE a.id IN (${ids.map(Number).join(',')})
        AND a.booking_status IN ('INQUIRY','CONFIRMED')
        AND length(replace(COALESCE(NULLIF(a.customer_mobile,''), a.passenger_mobile, ''),' ','')) >= 10`
  );
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.other]);
  return out;
}

router.get('/', requirePermission('bookings.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const limit = Math.min(Number(p.limit ?? 50), 500);
  const offset = Math.max(0, Number(p.offset ?? 0));
  const order = SORTS[p.sort ?? ''] ?? SORTS.attention;

  const data = q.all<any>(
    `SELECT ${LIST_COLUMNS} ${LIST_FROM} ${where} ORDER BY ${order} LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset }
  );
  const dups = duplicateMobiles(data.map((r) => r.id));
  for (const r of data) {
    r.missing = missingDetails(r);
    r.duplicates = dups.get(r.id) ?? [];
  }

  const agg = q.get<any>(
    `SELECT COUNT(DISTINCT b.id) AS total, COALESCE(SUM(c.total_amount),0) AS totalAmount ${LIST_FROM} ${where}`,
    params
  );

  res.json({ data, total: agg.total, totalAmount: agg.totalAmount, limit, offset });
});

/** Excel / CSV of exactly the rows the list is showing (all pages). */
router.get('/export', requirePermission('bookings.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const order = SORTS[p.sort ?? ''] ?? SORTS.attention;
  const rows = q.all<any>(`SELECT ${LIST_COLUMNS} ${LIST_FROM} ${where} ORDER BY ${order}`, params);
  const stageLabel = Object.fromEntries(STAGES.map((x) => [x.key, x.label]));
  audit(req, 'DATA_EXPORTED', { description: `Trips export — ${rows.length} row(s)`, meta: params });
  await sendTable(res, p.stage ? `trips-${p.stage.toLowerCase()}` : 'trips', {
    name: 'Trips', title: p.stage ? `Trips — ${stageLabel[p.stage] ?? p.stage}` : 'Trip register',
    notes: [filterNote({
      Search: params.search, Source: params.source && SOURCE_LABEL[params.source as InquirySource],
      Stage: params.stage && (stageLabel[params.stage] ?? params.stage), Status: params.status,
      'Travel from': params.from, 'Travel to': params.to,
    })],
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' },
      { key: 'booking_code', header: 'Booking ID', kind: 'id' },
      { key: 'inquiry_source', header: 'Source', value: (r) => SOURCE_LABEL[r.inquiry_source as InquirySource] ?? r.inquiry_source },
      { key: 'stage', header: 'Stage', value: (r) => stageLabel[r.stage] ?? r.stage },
      { key: 'booking_status', header: 'Status', value: (r) => STATUS_LABEL[r.booking_status] ?? r.booking_status },
      { key: 'created_at', header: 'Received', kind: 'datetime' },
      { key: 'customer_name', header: 'Customer', value: (r) => r.customer_name || r.passenger_name },
      { key: 'customer_mobile', header: 'Mobile', kind: 'id', value: (r) => r.customer_mobile || r.passenger_mobile },
      { key: 'customer_email', header: 'Email', value: (r) => r.customer_email || r.passenger_email },
      { key: 'vendor_name', header: 'Vendor' },
      { key: 'trip_type', header: 'Trip type' },
      { key: 'pickup_location', header: 'Pickup', width: 32 },
      { key: 'drop_location', header: 'Drop', width: 32 },
      { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'reporting_time', header: 'Time' },
      { key: 'pax_count', header: 'Passengers', kind: 'number' },
      { key: 'category_name', header: 'Vehicle category', value: (r) => r.category_name || r.vehicle_type },
      { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' },
      { key: 'driver_name', header: 'Driver' },
      { key: 'driver_mobile', header: 'Driver mobile', kind: 'id' },
      { key: 'owner_name', header: 'Handled by' },
      { key: 'total_amount', header: 'Fare', kind: 'money' },
      { key: 'billing_status', header: 'Billing status' },
      { key: 'invoice_number', header: 'Invoice no.', kind: 'id' },
      { key: 'invoice_outstanding', header: 'Invoice outstanding', kind: 'money' },
      { key: 'cancel_reason', header: 'Cancellation reason' },
    ],
    rows,
    totals: ['total_amount', 'invoice_outstanding'],
  }, p.format);
});

/** The counters above the list — by stage, and by where each trip came from. */
router.get('/summary', requirePermission('bookings.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  // The stage counts honour the same filters as the list (except the stage
  // itself), so a bucket's number always equals the rows it opens.
  const { params, where } = listFilters({ ...p, stage: '' });
  const stageRows = q.all<any>(
    `SELECT (${STAGE_SQL}) AS stage, COUNT(*) AS count, COALESCE(SUM(c.total_amount),0) AS amount
       ${LIST_FROM} ${where} GROUP BY 1`, params
  );
  const stageCount = (k: string) => Number(stageRows.find((r) => r.stage === k)?.count ?? 0);
  const stages = STAGES.map((st) => ({
    ...st, count: stageCount(st.key),
    amount: Number(stageRows.find((r) => r.stage === st.key)?.amount ?? 0),
  }));

  const sourceWhere = listFilters({ ...p, source: '', stage: p.stage ?? '' });
  const bySource = q.all<any>(
    `SELECT b.inquiry_source AS source, COUNT(*) AS count,
            SUM(CASE WHEN (${STAGE_SQL}) = 'NEW' THEN 1 ELSE 0 END) AS open_inquiries
       ${LIST_FROM} ${sourceWhere.where} GROUP BY b.inquiry_source`, sourceWhere.params
  );

  // Money still to come on invoiced trips, and how much of it is past due.
  const pay = q.get<any>(
    `SELECT COUNT(DISTINCT CASE WHEN i.id IS NOT NULL AND COALESCE(i.outstanding_amount,0) > 0.005 THEN b.id END) AS pending,
            COUNT(DISTINCT CASE WHEN i.id IS NOT NULL AND COALESCE(i.outstanding_amount,0) > 0.005 AND i.due_date < date('now') THEN b.id END) AS overdue
       ${LIST_FROM} ${where}`, params
  );

  res.json({
    stages,
    paymentPending: Number(pay?.pending ?? 0),
    paymentOverdue: Number(pay?.overdue ?? 0),
    confirmedTotal: CONFIRMED_STAGES.reduce((n, k) => n + stageCount(k), 0),
    total: stageRows.reduce((n, r) => n + Number(r.count), 0),
    bySource: ALL_SOURCES.map((src) => {
      const row = bySource.find((r) => r.source === src);
      return { source: src, label: SOURCE_LABEL[src], count: row?.count ?? 0, openInquiries: row?.open_inquiries ?? 0 };
    }),
    // Kept for the dashboard and older screens.
    new_inquiries: stageCount('NEW'),
    awaiting_vehicle: stageCount('AWAITING_ASSIGNMENT'),
    awaiting_invoice: stageCount('AWAITING_INVOICE') + stageCount('AWAITING_BILLING'),
  });
});

/** Staff who can own an enquiry. */
router.get('/staff', requirePermission('bookings.view'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT u.id, u.full_name, r.name AS role_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.owner_user_id = u.id AND b.booking_status = 'INQUIRY') AS open_enquiries
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.is_active = 1 ORDER BY u.full_name`
    ),
  });
});

/* ==========================================================================
   One trip
   ========================================================================== */

/** Accepts either the numeric row id or the Trip ID, so links can use either. */
function findTrip(idOrTripId: string) {
  return /^\d+$/.test(idOrTripId)
    ? tripRow('id', Number(idOrTripId))
    : tripRow('trip_id', idOrTripId.trim().toUpperCase());
}

router.get('/:id', requirePermission('bookings.view'), (req, res) => {
  const b = findTrip(String(req.params.id));
  if (!b) return res.status(404).json({ error: 'That trip could not be found.' });

  const extra = q.get<any>(
    `SELECT (${STAGE_SQL}) AS stage, ow.full_name AS owner_name, vc.name AS category_name,
            c.waiting_charge, c.state_tax, c.fare_rule_id, c.fare_snapshot, c.other_charges_note
       FROM bookings b ${STAGE_JOINS}
       LEFT JOIN users ow ON ow.id = b.owner_user_id
       LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
      WHERE b.id = @id`, { id: b.id }
  ) ?? {};
  const data = { ...b, ...extra };
  const dups = duplicateMobiles([b.id]).get(b.id) ?? [];

  res.json({
    data,
    trip: publicTrip(b),
    stage: STAGES.find((x) => x.key === extra.stage) ?? null,
    missing: missingDetails(data),
    summary: tripSummary(data),
    duplicates: dups,
    window: tripWindow(b),
    assignments: q.all<any>(
      `SELECT a.*, u.full_name AS assigned_by_name FROM trip_assignments a
         LEFT JOIN users u ON u.id = a.assigned_by WHERE a.booking_id = @id ORDER BY a.id DESC`, { id: b.id }
    ),
    timeline: tripEvents(b.id, false),
    nextStatuses: allowedNext(b.booking_status).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
    feedback: feedbackSummary(b.id),
    emails: q.all<any>(
      `SELECT id, kind, to_address, from_address, subject, status, error, sent_at, created_at
         FROM email_log WHERE booking_id = @id ORDER BY id DESC LIMIT 25`,
      { id: b.id }
    ),
  });
});

/* ==========================================================================
   Create a trip by hand — the phone call and the walk-in
   ========================================================================== */

const manualSchema = z.object({
  source: z.enum(['WALKIN', 'EMAIL', 'WHATSAPP', 'PORTAL']).default('WALKIN'),
  customerName: z.string().trim().min(2, 'Enter the customer name.').max(120),
  customerMobile: requiredMobile('Enter a valid 10-digit mobile number.'),
  customerEmail: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  pickup: z.string().trim().min(2, 'Enter the pickup address.').max(200),
  pickupAddress: z.string().trim().max(300).optional().default(''),
  dropOff: z.string().trim().max(200).optional().default(''),
  dropAddress: z.string().trim().max(300).optional().default(''),
  travelDate: isoDate,
  travelDateTo: z.union([isoDate, z.literal('')]).optional().default(''),
  journeyTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),
  tripType: z.enum(['LOCAL', 'TRANSFER', 'OUTSTATION', 'AIRPORT', 'ROUND_TRIP', 'PACKAGE']).default('LOCAL'),
  /** AIRPORT only, and then required: TO the airport or FROM it. */
  airportDirection: airportDirectionField,
  vehicleType: z.string().trim().max(80).optional().default(''),
  passengers: z.coerce.number().int().min(0).max(60).optional().default(1),
  message: z.string().trim().max(1000).optional().default(''),
  /** A trip taken over the phone is usually already agreed, so default to confirmed. */
  status: z.enum(['INQUIRY', 'CONFIRMED']).default('CONFIRMED'),
  /** Tell the customer straight away, if we have an address for them. */
  notifyCustomer: z.coerce.boolean().default(false),
  /** Pick the vehicle category from the master; the free-text type follows it. */
  vehicleCategoryId: z.coerce.number().int().positive().nullable().optional(),
  ownerUserId: z.coerce.number().int().positive().nullable().optional(),
  branch: z.string().trim().max(40).optional().default(''),
  /** Set after the office has seen the possible-duplicate warning and wants it anyway. */
  allowDuplicate: z.coerce.boolean().default(false),
});

/** The category row, refusing inactive ones for anything new. */
function categoryFor(id: number | null | undefined, allowInactiveId?: number | null): { cat?: any; error?: string } {
  if (!id) return {};
  const cat = q.get<any>('SELECT id, name, is_active FROM vehicle_categories WHERE id = @id', { id });
  if (!cat) return { error: 'That vehicle category no longer exists.' };
  if (!cat.is_active && id !== allowInactiveId) return { error: `"${cat.name}" is deactivated and cannot be used for new trips.` };
  return { cat };
}

/** Open trips for the same mobile within a day of the same date. */
function possibleDuplicates(mobile: string, travelDate: string, excludeId = 0) {
  const m = String(mobile ?? '').replace(/\D/g, '').slice(-10);
  if (m.length < 10) return [];
  return q.all<any>(
    `SELECT id, trip_id, travel_date, reporting_time, pickup_location, drop_location, booking_status, inquiry_source
       FROM bookings
      WHERE id <> @x AND booking_status NOT IN ('CANCELLED','NO_SHOW')
        AND substr(replace(COALESCE(NULLIF(customer_mobile,''), passenger_mobile),' ',''), -10) = @m
        AND abs(julianday(travel_date) - julianday(@d)) <= 1
      ORDER BY travel_date LIMIT 5`,
    { m, d: travelDate, x: excludeId }
  );
}

router.post('/', requirePermission('bookings.create'), validateBody(manualSchema), async (req, res) => {
  const b = req.body as z.infer<typeof manualSchema>;
  if (b.tripType === 'AIRPORT' && !b.airportDirection) {
    return res.status(400).json({ error: 'Choose the direction first: to the airport, or from the airport.' });
  }
  const { cat, error: catError } = categoryFor(b.vehicleCategoryId);
  if (catError) return res.status(400).json({ error: catError });
  if (cat) b.vehicleType = cat.name;

  // The same customer asking twice — once on WhatsApp, once by email — is the
  // commonest duplicate. Say so and let the office decide.
  if (!b.allowDuplicate) {
    const dups = possibleDuplicates(b.customerMobile, b.travelDate);
    if (dups.length) {
      return res.status(409).json({
        code: 'POSSIBLE_DUPLICATE',
        error: `${b.customerMobile} already has ${dups.map((d) => d.trip_id).join(', ')} around ${b.travelDate}. ` +
          'Open that trip instead, or save this one anyway if it is a separate journey.',
        duplicates: dups,
      });
    }
  }

  // Link the trip to an existing account when the email already has one, so it
  // appears in that customer's dashboard without them having to claim it.
  const account = b.customerEmail
    ? q.get<any>('SELECT id FROM customers WHERE email = @e', { e: b.customerEmail.toLowerCase() })
    : null;

  const { bookingId, tripId } = createInquiryTrip({
    source: b.source as InquirySource,
    customerName: b.customerName,
    customerMobile: b.customerMobile,
    customerEmail: b.customerEmail,
    pickup: b.pickup,
    pickupAddress: b.pickupAddress,
    drop: b.dropOff,
    dropAddress: b.dropAddress,
    travelDate: b.travelDate,
    travelDateTo: b.travelDateTo,
    journeyTime: b.journeyTime,
    tripType: b.tripType,
    airportDirection: b.airportDirection,
    vehicleType: b.vehicleType,
    paxCount: b.passengers,
    message: b.message,
    serviceLabel: SOURCE_LABEL[b.source as InquirySource],
    customerId: account?.id ?? null,
    userId: req.user!.id,
    status: b.status,
  });

  q.run(
    `UPDATE bookings SET vehicle_category_id = @cat, branch = NULLIF(@branch,''),
            owner_user_id = @owner, owner_assigned_at = CASE WHEN @owner IS NULL THEN NULL ELSE datetime('now') END
      WHERE id = @id`,
    { cat: cat?.id ?? matchCategoryId(b.vehicleType), branch: b.branch, owner: b.ownerUserId ?? null, id: bookingId }
  );

  audit(req, 'TRIP_CREATED', {
    entityType: 'booking', entityId: bookingId,
    description: `${tripId} — ${SOURCE_LABEL[b.source as InquirySource]} — ${b.customerName} on ${b.travelDate}`,
  });

  let emailed = false;
  let emailMessage = '';
  if (b.notifyCustomer && b.customerEmail) {
    const trip = tripRow('id', bookingId)!;
    const mail = inquiryCustomerEmail({
      trip, tripId, customerName: b.customerName,
      source: b.source as InquirySource, portalUrl: portalUrl(),
    });
    const r = await sendMail({
      kind: 'INQUIRY_CUSTOMER', to: b.customerEmail, subject: mail.subject, html: mail.html,
      bookingId, tripId, userId: req.user!.id,
    });
    emailed = r.ok;
    emailMessage = r.message;
  }

  res.status(201).json({
    ok: true,
    tripId,
    id: bookingId,
    data: tripRow('id', bookingId),
    emailed,
    message: `Trip ${tripId} created.` + (emailMessage ? ` ${emailMessage}` : ''),
  });
});

/* ==========================================================================
   Edit the journey details
   ========================================================================== */

const editSchema = manualSchema
  .omit({ source: true, status: true, notifyCustomer: true, allowDuplicate: true, ownerUserId: true })
  .partial()
  .extend({
    customerName: z.string().trim().min(2, 'Enter the customer name.').max(120),
    travelDate: isoDate,
    pickup: z.string().trim().min(2, 'Enter the pickup address.').max(200),
  });

router.put('/:id', requirePermission('bookings.update'), validateBody(editSchema), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const b = req.body as z.infer<typeof editSchema>;
  const tripType = b.tripType ?? trip.trip_type ?? 'LOCAL';
  const airportDirection = resolveAirportDirection(
    tripType, b.airportDirection || trip.airport_direction, b.pickup, b.dropOff ?? trip.drop_location,
  );
  if (tripType === 'AIRPORT' && !airportDirection) {
    return res.status(400).json({ error: 'Choose the direction first: to the airport, or from the airport.' });
  }
  if (['CANCELLED', 'NO_SHOW'].includes(trip.booking_status) || trip.billing_status === 'INVOICED') {
    // An invoiced trip's journey is printed on the invoice; changing it here
    // would make the two disagree.
    if (trip.billing_status === 'INVOICED') {
      return res.status(409).json({ error: `${trip.trip_id} is invoiced. Cancel the invoice before changing the journey details.` });
    }
  }
  const { cat, error: catError } = categoryFor(b.vehicleCategoryId, trip.vehicle_category_id);
  if (catError) return res.status(400).json({ error: catError });
  if (cat) b.vehicleType = cat.name;

  // Record what changed, field by field, on the trip's own timeline.
  const before: Record<string, unknown> = {
    'Customer': trip.customer_name, 'Mobile': trip.customer_mobile, 'Email': trip.customer_email,
    'Pickup': trip.pickup_location, 'Drop': trip.drop_location, 'Date': trip.travel_date,
    'Return date': trip.travel_date_to, 'Time': trip.reporting_time, 'Trip type': trip.trip_type,
    'Vehicle type': trip.vehicle_type, 'Passengers': trip.pax_count,
  };
  const after: Record<string, unknown> = {
    'Customer': b.customerName, 'Mobile': b.customerMobile ?? trip.customer_mobile, 'Email': b.customerEmail ?? trip.customer_email,
    'Pickup': b.pickup, 'Drop': b.dropOff ?? '', 'Date': b.travelDate, 'Return date': b.travelDateTo || null,
    'Time': b.journeyTime ?? trip.reporting_time, 'Trip type': tripType,
    'Vehicle type': b.vehicleType || trip.vehicle_type, 'Passengers': b.passengers ?? trip.pax_count,
  };
  const changes = Object.keys(before)
    .filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map((k) => `${k}: ${before[k] || '—'} → ${after[k] || '—'}`);

  q.run(
    `UPDATE bookings SET vehicle_category_id = COALESCE(@cat, vehicle_category_id), branch = COALESCE(NULLIF(@branch,''), branch)
      WHERE id = @id`,
    { cat: cat?.id ?? (b.vehicleType ? matchCategoryId(b.vehicleType) : null), branch: b.branch ?? '', id: trip.id }
  );

  q.run(
    `UPDATE bookings SET
        customer_name = @name, customer_mobile = @mobile, customer_email = @email,
        passenger_name = @name, passenger_mobile = @mobile, passenger_email = @email,
        pickup_location = @pickup, pickup_address = @pickupAddress,
        drop_location = @drop, drop_address = @dropAddress,
        travel_date = @travelDate, travel_date_to = @travelDateTo, reporting_time = @time,
        trip_type = @tripType, airport_direction = @airportDirection, vehicle_type = COALESCE(NULLIF(@vehicleType,''), vehicle_type),
        pax_count = @pax, inquiry_message = @message,
        updated_at = datetime('now'), updated_by = @uid
      WHERE id = @id`,
    {
      id: trip.id,
      name: b.customerName,
      mobile: b.customerMobile ?? trip.customer_mobile ?? '',
      email: b.customerEmail ?? trip.customer_email ?? '',
      pickup: b.pickup,
      pickupAddress: b.pickupAddress || b.pickup,
      drop: b.dropOff ?? '',
      dropAddress: b.dropAddress || b.dropOff || '',
      travelDate: b.travelDate,
      travelDateTo: b.travelDateTo || null,
      time: b.journeyTime ?? trip.reporting_time ?? '',
      tripType,
      airportDirection,
      vehicleType: b.vehicleType ?? '',
      pax: b.passengers ?? trip.pax_count ?? 1,
      message: b.message ?? trip.inquiry_message ?? null,
      uid: req.user!.id,
    }
  );

  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: trip.booking_status,
    title: 'Trip details updated',
    detail: changes.length ? changes.join(' · ') : 'Saved with no changes',
    isPublic: false, userId: req.user!.id,
  });
  audit(req, 'TRIP_UPDATED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} updated${changes.length ? ` — ${changes.join('; ')}` : ''}`,
    meta: { changes },
  });

  res.json({ ok: true, data: tripRow('id', trip.id), message: 'Trip details saved.' });
});

/* ==========================================================================
   Assign the vehicle and the driver
   ========================================================================== */

const assignSchema = z.object({
  vehicleId: z.coerce.number().int().positive().nullable().optional(),
  vehicleType: z.string().trim().max(80).optional().default(''),
  vehicleNumber: z.string().trim().max(20).optional().default(''),
  driverId: z.coerce.number().int().positive().nullable().optional(),
  driverName: z.string().trim().max(120).optional().default(''),
  driverMobile: optionalMobile.default(''),
  /** Email the customer the allotment as soon as it is saved. */
  notifyCustomer: z.coerce.boolean().default(true),
  message: z.string().trim().max(600).optional().default(''),
  /** Knowingly allot a vehicle or driver that clashes; needs a reason. */
  overrideReason: z.string().trim().max(300).optional().default(''),
}).refine((d) => !!(d.vehicleId || d.vehicleNumber || d.vehicleType), {
  message: 'Choose a vehicle, or type the vehicle number.',
  path: ['vehicleId'],
}).refine((d) => !!(d.driverId || d.driverName), {
  message: 'Choose a driver, or type the driver name.',
  path: ['driverId'],
});

router.post('/:id/assign', requirePermission('bookings.update'), validateBody(assignSchema), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  if (trip.booking_status === 'CANCELLED') {
    return res.status(409).json({ error: 'This trip is cancelled. Reopen it before allotting a vehicle.' });
  }

  const b = req.body as z.infer<typeof assignSchema>;

  const vehicle = b.vehicleId
    ? q.get<any>('SELECT * FROM vehicles WHERE id = @id', { id: b.vehicleId })
    : null;
  if (b.vehicleId && !vehicle) return res.status(400).json({ error: 'That vehicle is no longer on the fleet list.' });

  const driver = b.driverId
    ? q.get<any>('SELECT * FROM drivers WHERE id = @id', { id: b.driverId })
    : null;
  if (b.driverId && !driver) return res.status(400).json({ error: 'That driver is no longer on the roster.' });

  const vehicleNumber = (b.vehicleNumber || vehicle?.vehicle_number || '').toUpperCase().replace(/\s+/g, '');
  const vehicleType = b.vehicleType || vehicle?.vehicle_type || trip.vehicle_type || '';
  const driverName = b.driverName || driver?.full_name || '';
  const driverMobile = b.driverMobile || driver?.mobile || '';

  // A vehicle or driver that is switched off, off the road or on leave cannot
  // be sent on a new trip. Re-saving the allotment a trip already has is fine.
  const problems: string[] = [];
  if (vehicle && vehicle.id !== trip.vehicle_id) {
    if (!vehicle.is_active) problems.push(`${vehicle.vehicle_number} is deactivated.`);
    else if (vehicle.availability_status && vehicle.availability_status !== 'AVAILABLE') {
      problems.push(`${vehicle.vehicle_number} is marked ${String(vehicle.availability_status).toLowerCase()}.`);
    }
  }
  if (driver && driver.id !== trip.driver_id) {
    if (!driver.is_active) problems.push(`${driver.full_name} is deactivated.`);
    else if (driver.availability_status && driver.availability_status !== 'AVAILABLE') {
      problems.push(`${driver.full_name} is marked ${String(driver.availability_status).toLowerCase().replace('_', ' ')}.`);
    } else if (driver.leave_from && driver.leave_from <= (trip.travel_date_to || trip.travel_date)
               && (driver.leave_to || driver.leave_from) >= trip.travel_date) {
      problems.push(`${driver.full_name} is on leave ${driver.leave_from}${driver.leave_to && driver.leave_to !== driver.leave_from ? ` to ${driver.leave_to}` : ''}.`);
    }
  }
  // Only someone who manages the fleet may send an unavailable vehicle or
  // driver, and only with a reason that is kept on the allotment.
  const fleetManager = req.user!.roleCode === 'SUPER_ADMIN' || req.user!.permissions.includes('fleet.update');
  if (problems.length && !(fleetManager && b.overrideReason)) {
    return res.status(409).json({
      code: 'ASSIGNMENT_UNAVAILABLE',
      canOverride: fleetManager,
      error: problems.join(' ') + (fleetManager
        ? ' Choose another, or give a reason to allot anyway.'
        : ' Choose another, or ask a fleet manager to change it under Fleet.'),
    });
  }

  // Expired documents and overlapping trips are refused unless the office
  // overrides them on purpose — and the reason is kept with the allotment.
  const docIssues = [
    ...(vehicle ? blockingDocuments('vehicle', vehicle, trip.travel_date).map((x) => `${vehicle.vehicle_number}: ${x}`) : []),
    ...(driver ? blockingDocuments('driver', driver, trip.travel_date).map((x) => `${driver.full_name}: ${x}`) : []),
  ];
  const clashes = findClashes({
    bookingId: trip.id, vehicleId: vehicle?.id ?? null, vehicleNumber,
    driverId: driver?.id ?? null, driverMobile,
  });
  if ((clashes.length || docIssues.length) && !b.overrideReason) {
    return res.status(409).json({
      code: 'ASSIGNMENT_CONFLICT',
      error: [...clashes.map(describeClash), ...docIssues].join(' ') +
        ' Choose another vehicle or driver, or give a reason to allot anyway.',
      clashes,
      documents: docIssues,
    });
  }
  const window = tripWindow(trip);

  // Moving straight past CONFIRMED is fine — allotting a car is itself the
  // confirmation, and making the office click twice helps nobody.
  const nextStatus = ['INQUIRY', 'CONFIRMED', 'DRAFT'].includes(trip.booking_status)
    ? 'ASSIGNED'
    : trip.booking_status;

  getDb().transaction(() => {
    q.run(
      `UPDATE bookings SET vehicle_id = @vehicleId, driver_id = @driverId,
              vehicle_type = @vehicleType, vehicle_number = @vehicleNumber,
              driver_name = @driverName, driver_mobile = @driverMobile,
              booking_status = @status, assigned_at = datetime('now'),
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id`,
      {
        id: trip.id,
        vehicleId: vehicle?.id ?? null,
        driverId: driver?.id ?? null,
        vehicleType, vehicleNumber, driverName, driverMobile,
        status: nextStatus,
        uid: req.user!.id,
      }
    );
    // History: release whatever this trip had before, then record the new one.
    q.run(
      `UPDATE trip_assignments SET released_at = datetime('now'), release_reason = 'Re-allotted'
        WHERE booking_id = @id AND released_at IS NULL`, { id: trip.id }
    );
    q.run(
      `INSERT INTO trip_assignments (booking_id, vehicle_id, driver_id, vehicle_number, vehicle_type,
          driver_name, driver_mobile, window_start, window_end, override_reason, assigned_by)
       VALUES (@id, @vid, @did, @vno, @vtype, @dname, @dmob, @ws, @we, @why, @uid)`,
      {
        id: trip.id, vid: vehicle?.id ?? null, did: driver?.id ?? null, vno: vehicleNumber || null,
        vtype: vehicleType || null, dname: driverName || null, dmob: driverMobile || null,
        ws: window.start, we: window.end, why: (clashes.length || docIssues.length || problems.length) ? b.overrideReason : null,
        uid: req.user!.id,
      }
    );
    recordTripEvent({
      bookingId: trip.id,
      tripId: trip.trip_id,
      status: 'ASSIGNED',
      title: trip.vehicle_number || trip.driver_name ? 'Vehicle and driver re-allotted' : 'Vehicle and driver assigned',
      detail: `${[vehicleType, vehicleNumber].filter(Boolean).join(' ')} · ${driverName}${driverMobile ? ` (${driverMobile})` : ''}` +
        (trip.vehicle_number && trip.vehicle_number !== vehicleNumber ? ` (was ${trip.vehicle_number})` : ''),
      userId: req.user!.id,
    });
  })();

  if (clashes.length || docIssues.length || problems.length) {
    audit(req, 'TRIP_ASSIGN_OVERRIDE', {
      entityType: 'booking', entityId: trip.id,
      description: `${trip.trip_id} allotted despite: ${[...problems, ...clashes.map(describeClash), ...docIssues].join(' ')} Reason: ${b.overrideReason}`,
    });
  }

  audit(req, 'TRIP_ASSIGNED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} — ${vehicleNumber || vehicleType} with ${driverName}`,
  });

  // Tell the customer.
  const fresh = tripRow('id', trip.id)!;
  let emailResult: { ok: boolean; message: string } | null = null;

  if (b.notifyCustomer) {
    const to = fresh.customer_email || fresh.passenger_email || '';
    if (!to) {
      emailResult = {
        ok: false,
        message: 'No email address is on this trip, so nothing was sent. Add one and use "Send details" — or message the customer on WhatsApp.',
      };
    } else {
      const mail = tripDetailsEmail({
        trip: fresh,
        tripId: fresh.trip_id,
        customerName: fresh.customer_name || fresh.passenger_name || 'Customer',
        fareTotal: Number(fresh.total_amount ?? 0) || null,
        portalUrl: portalUrl(),
        message: b.message,
      });
      const r = await sendMail({
        kind: 'TRIP_DETAILS', to, subject: mail.subject, html: mail.html,
        bookingId: trip.id, tripId: fresh.trip_id, userId: req.user!.id,
      });
      emailResult = { ok: r.ok, message: r.message };
      if (r.ok) {
        q.run(`UPDATE bookings SET details_sent_at = datetime('now') WHERE id = @id`, { id: trip.id });
        recordTripEvent({
          bookingId: trip.id, tripId: fresh.trip_id, status: 'EMAIL_SENT',
          title: 'Trip details emailed', detail: `Sent to ${to}`, userId: req.user!.id,
        });
      }
    }
  }

  res.json({
    ok: true,
    data: tripRow('id', trip.id),
    email: emailResult,
    warning: clashes.length || docIssues.length
      ? `Allotted with an override: ${[...clashes.map(describeClash), ...docIssues].join(' ')}`
      : null,
    message: `Vehicle and driver assigned to ${trip.trip_id}.` + (emailResult ? ` ${emailResult.message}` : ''),
  });
});

/* ==========================================================================
   Send (or resend) the trip details
   ========================================================================== */

router.post('/:id/send-details', requirePermission('bookings.update'), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });

  const to = String(req.body?.to ?? '').trim() || trip.customer_email || trip.passenger_email || '';
  if (!to) {
    return res.status(400).json({
      error: 'There is no email address for this customer. Add one to the trip, then send again.',
    });
  }

  const mail = tripDetailsEmail({
    trip,
    tripId: trip.trip_id,
    customerName: trip.customer_name || trip.passenger_name || 'Customer',
    fareTotal: Number(trip.total_amount ?? 0) || null,
    portalUrl: portalUrl(),
    message: String(req.body?.message ?? '').trim().slice(0, 600),
  });

  const r = await sendMail({
    kind: 'TRIP_DETAILS', to, subject: mail.subject, html: mail.html,
    bookingId: trip.id, tripId: trip.trip_id, userId: req.user!.id,
  });

  if (!r.ok) return res.status(502).json({ error: r.message, logId: r.logId });

  q.run(`UPDATE bookings SET details_sent_at = datetime('now') WHERE id = @id`, { id: trip.id });
  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: 'EMAIL_SENT',
    title: 'Trip details emailed', detail: `Sent to ${to}`, userId: req.user!.id,
  });
  audit(req, 'TRIP_DETAILS_SENT', {
    entityType: 'booking', entityId: trip.id, description: `${trip.trip_id} details emailed to ${to}`,
  });

  res.json({ ok: true, sentTo: to, from: r.from, message: r.message });
});

/* ==========================================================================
   Move the trip along
   ========================================================================== */

const statusSchema = z.object({
  status: z.enum(['INQUIRY', 'DRAFT', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  note: z.string().trim().max(400).optional().default(''),
  /** Required to cancel: a code from Masters → Cancellation reasons. */
  cancelReason: z.string().trim().max(40).optional().default(''),
});

router.post('/:id/status', requirePermission('bookings.update'), validateBody(statusSchema), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const b = req.body as z.infer<typeof statusSchema>;

  if (!canMoveTo(trip.booking_status, b.status)) {
    return res.status(409).json({
      error:
        `A trip that is "${STATUS_LABEL[trip.booking_status] ?? trip.booking_status}" cannot go straight to ` +
        `"${STATUS_LABEL[b.status]}". Allowed from here: ` +
        allowedNext(trip.booking_status).map((s) => STATUS_LABEL[s]).join(', ') + '.',
    });
  }
  if (b.status === 'COMPLETED' && !trip.vehicle_number && !trip.driver_name) {
    return res.status(409).json({
      error: 'Allot a vehicle and driver before marking the trip completed — the invoice prints them.',
    });
  }
  if (b.status === 'ASSIGNED' && !trip.vehicle_number && !trip.driver_name) {
    return res.status(409).json({ error: 'Use "Vehicle & driver" to allot the trip — that moves it to allotted.' });
  }
  if ((b.status === 'CANCELLED' || b.status === 'NO_SHOW') && trip.billing_status === 'INVOICED') {
    return res.status(409).json({ error: `${trip.trip_id} is on a live invoice. Cancel the invoice first, then the trip.` });
  }
  let reasonLabel = '';
  if (b.status === 'CANCELLED' && trip.booking_status !== 'CANCELLED') {
    if (!b.cancelReason) return res.status(400).json({ error: 'Choose why the trip is being cancelled.' });
    const r = q.get<any>(
      `SELECT label FROM master_values WHERE list_type = 'CANCELLATION_REASON' AND code = @c`, { c: b.cancelReason }
    );
    if (!r) return res.status(400).json({ error: 'That cancellation reason is not on the list.' });
    reasonLabel = r.label;
  }

  // An invoiced trip must keep its billing status; everything else follows the
  // trip. This is the same rule the booking form uses.
  const billing =
    trip.billing_status === 'INVOICED' ? 'INVOICED'
      : b.status === 'CANCELLED' ? 'CANCELLED'
        : b.status === 'COMPLETED' ? (Number(trip.total_amount ?? 0) > 0 ? 'READY' : 'PENDING')
          : trip.billing_status;

  getDb().transaction(() => {
    q.run(
      `UPDATE bookings SET booking_status = @status, billing_status = @billing,
              started_at = CASE WHEN @status = 'ONTRIP' THEN datetime('now') ELSE started_at END,
              completed_at = CASE WHEN @status = 'COMPLETED' THEN datetime('now') ELSE completed_at END,
              cancelled_at = CASE WHEN @status IN ('CANCELLED','NO_SHOW') THEN datetime('now')
                                  WHEN @status NOT IN ('CANCELLED','NO_SHOW') THEN NULL ELSE cancelled_at END,
              cancel_reason = CASE WHEN @status = 'CANCELLED' THEN COALESCE(NULLIF(@reason,''), cancel_reason)
                                   WHEN @status = 'NO_SHOW' THEN 'NO_SHOW' ELSE NULL END,
              -- Confirming an enquiry is the customer accepting the quotation.
              quote_status = CASE WHEN booking_status = 'INQUIRY' AND @status IN ('CONFIRMED','ASSIGNED')
                                   AND quote_status = 'SENT' THEN 'ACCEPTED' ELSE quote_status END,
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id`,
      { status: b.status, billing, reason: b.cancelReason, id: trip.id, uid: req.user!.id }
    );
    // A cancelled trip gives its vehicle and driver back.
    if (b.status === 'CANCELLED' || b.status === 'NO_SHOW') {
      q.run(
        `UPDATE trip_assignments SET released_at = datetime('now'), release_reason = @why
          WHERE booking_id = @id AND released_at IS NULL`,
        { id: trip.id, why: b.status === 'NO_SHOW' ? 'No show' : `Cancelled — ${reasonLabel}` }
      );
    }
    recordTripEvent({
      bookingId: trip.id, tripId: trip.trip_id, status: b.status,
      title: STATUS_LABEL[b.status] ?? b.status,
      detail: [reasonLabel && `Reason: ${reasonLabel}`, b.note].filter(Boolean).join(' — ') || null,
      userId: req.user!.id,
    });
  })();

  audit(req, b.status === 'CANCELLED' ? 'TRIP_CANCELLED' : 'TRIP_STATUS_CHANGED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id}: ${trip.booking_status} -> ${b.status}${reasonLabel ? ` — ${reasonLabel}` : ''}${b.note ? ` (${b.note})` : ''}`,
  });

  // Marking the trip completed is what asks the customer for feedback. Only
  // on the move INTO completed, and requestFeedback itself refuses a second
  // request for the same booking, so re-saving never emails twice.
  let feedback: Awaited<ReturnType<typeof requestFeedback>> | null = null;
  if (b.status === 'COMPLETED' && trip.booking_status !== 'COMPLETED') {
    feedback = await requestFeedback(trip.id, { userId: req.user!.id, baseUrl: requestOrigin(req) });
  }

  res.json({
    ok: true,
    data: tripRow('id', trip.id),
    feedback,
    message: `${trip.trip_id} marked "${STATUS_LABEL[b.status]}".` + (feedback ? ` ${feedback.message}` : ''),
  });
});

/* ==========================================================================
   Complete the trip with what actually happened
   ========================================================================== */

const money = (label: string) => z.coerce.number({ invalid_type_error: `${label} must be a number.` })
  .min(0, `${label} cannot be negative.`).max(9_999_999).optional();

const completeSchema = z.object({
  /** When the duty actually ended — local "YYYY-MM-DDTHH:MM" or "YYYY-MM-DD HH:MM". */
  completedAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/, 'Enter when the trip ended.').optional(),
  startKm: z.coerce.number().min(0).max(9_999_999).nullable().optional(),
  endKm: z.coerce.number().min(0).max(9_999_999).nullable().optional(),
  actualKm: z.coerce.number().min(0).max(100_000).nullable().optional(),
  actualHours: z.coerce.number().min(0).max(1_000).nullable().optional(),
  baseFare: money('Fare'),
  extraKm: money('Extra km'),
  extraKmRate: money('Extra km rate'),
  extraHours: money('Extra hours'),
  extraHourRate: money('Extra hour rate'),
  toll: money('Toll'),
  parking: money('Parking'),
  stateTax: money('State tax'),
  waitingCharge: money('Waiting charge'),
  driverAllowance: money('Driver allowance'),
  nightCharge: money('Night charge'),
  otherCharges: money('Other charges'),
  otherChargesNote: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(600).optional().default(''),
}).refine((d) => d.startKm == null || d.endKm == null || d.endKm >= d.startKm, {
  message: 'Closing km cannot be less than opening km.', path: ['endKm'],
}).refine((d) => !(Number(d.otherCharges ?? 0) > 0) || !!d.otherChargesNote, {
  message: 'Say what the other charges are for.', path: ['otherChargesNote'],
});

router.post('/:id/complete', requirePermission('bookings.update'), validateBody(completeSchema), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const b = req.body as z.infer<typeof completeSchema>;

  if (trip.billing_status === 'INVOICED') {
    return res.status(409).json({ error: `${trip.trip_id} is already invoiced. Cancel the invoice to change what is billed.` });
  }
  const wasCompleted = trip.booking_status === 'COMPLETED';
  if (!wasCompleted && !['ASSIGNED', 'ONTRIP', 'CONFIRMED'].includes(trip.booking_status)) {
    return res.status(409).json({ error: `A trip that is "${STATUS_LABEL[trip.booking_status] ?? trip.booking_status}" cannot be completed.` });
  }
  if (!trip.vehicle_number && !trip.driver_name) {
    return res.status(409).json({ error: 'Allot a vehicle and driver before completing the trip — the invoice prints them.' });
  }
  const endedAt = b.completedAt ? b.completedAt.replace('T', ' ') + ':00' : null;
  if (endedAt && endedAt.slice(0, 10) < trip.travel_date) {
    return res.status(400).json({ error: 'The trip cannot end before its travel date.' });
  }
  const actualKm = b.actualKm ?? (b.startKm != null && b.endKm != null ? Math.round((b.endKm - b.startKm) * 10) / 10 : null);

  const stored = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id: trip.id });
  const vendor = q.get<any>('SELECT tax_mode, tax_rate, toll_parking_taxable FROM vendors WHERE id = @id', { id: trip.vendor_id });
  const base = stored ? storedChargeInput(stored) : {
    baseFare: 0, taxMode: (vendor?.tax_mode ?? 'IGST') as TaxMode, taxRate: Number(vendor?.tax_rate ?? 5),
  } as any;
  // Only what the form sent changes; everything else stays as priced.
  const pick = <K extends keyof typeof b>(k: K, cur: any) => (b[k] !== undefined ? b[k] : cur);
  const input = {
    ...base,
    tollParkingTaxable: !!vendor?.toll_parking_taxable,
    baseFare: pick('baseFare', base.baseFare), extraKm: pick('extraKm', base.extraKm), extraKmRate: pick('extraKmRate', base.extraKmRate),
    extraHours: pick('extraHours', base.extraHours), extraHourRate: pick('extraHourRate', base.extraHourRate),
    toll: pick('toll', base.toll), parking: pick('parking', base.parking), stateTax: pick('stateTax', base.stateTax),
    waitingCharge: pick('waitingCharge', base.waitingCharge), driverAllowance: pick('driverAllowance', base.driverAllowance),
    nightCharge: pick('nightCharge', base.nightCharge), otherCharges: pick('otherCharges', base.otherCharges),
    otherChargesNote: pick('otherChargesNote', base.otherChargesNote),
  };
  const before = Number(stored?.total_amount ?? 0);
  let c: ReturnType<typeof computeCharges>;

  getDb().transaction(() => {
    c = saveCharges(trip.id, input);
    q.run(
      `UPDATE bookings SET booking_status = 'COMPLETED',
              billing_status = CASE WHEN @total > 0 THEN 'READY' ELSE 'PENDING' END,
              completed_at = COALESCE(@endedAt, CASE WHEN booking_status = 'COMPLETED' THEN completed_at ELSE datetime('now') END),
              start_km = @startKm, end_km = @endKm, actual_km = @actualKm, actual_hours = @actualHours,
              trip_distance_km = COALESCE(@actualKm, trip_distance_km),
              trip_duration_hrs = COALESCE(@actualHours, trip_duration_hrs),
              completion_remarks = NULLIF(@remarks, ''),
              -- New figures need checking again before they are invoiced.
              billing_confirmed_at = CASE WHEN @changed = 1 THEN NULL ELSE billing_confirmed_at END,
              billing_confirmed_by = CASE WHEN @changed = 1 THEN NULL ELSE billing_confirmed_by END,
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id`,
      {
        id: trip.id, total: c.totalAmount, endedAt, startKm: b.startKm ?? null, endKm: b.endKm ?? null,
        actualKm, actualHours: b.actualHours ?? null, remarks: b.remarks,
        changed: Math.abs(c.totalAmount - before) > 0.004 ? 1 : 0, uid: req.user!.id,
      }
    );
    recordTripEvent({
      bookingId: trip.id, tripId: trip.trip_id, status: 'COMPLETED',
      title: wasCompleted ? 'Completion details updated' : 'Trip completed',
      detail: [
        actualKm != null ? `${actualKm} km` : '', b.actualHours != null ? `${b.actualHours} hrs` : '',
        `Total ₹${c.totalAmount.toLocaleString('en-IN')}`, b.remarks,
      ].filter(Boolean).join(' · '),
      userId: req.user!.id,
    });
  })();

  audit(req, 'TRIP_COMPLETED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} ${wasCompleted ? 'completion updated' : 'completed'} — ₹${before} → ₹${c!.totalAmount}`,
    meta: { actualKm, actualHours: b.actualHours ?? null, before, total: c!.totalAmount },
  });

  let feedback: Awaited<ReturnType<typeof requestFeedback>> | null = null;
  if (!wasCompleted) feedback = await requestFeedback(trip.id, { userId: req.user!.id, baseUrl: requestOrigin(req) });

  res.json({
    ok: true, charges: c!, data: tripRow('id', trip.id), feedback,
    message: `${trip.trip_id} completed — now awaiting billing confirmation.` + (feedback ? ` ${feedback.message}` : ''),
  });
});

/* ==========================================================================
   Confirm billing (one trip or many)
   ========================================================================== */

function confirmBilling(ids: number[], req: any, note: string) {
  const { ok, problems } = confirmProblems(ids);
  if (!ok.length) return { confirmed: [] as string[], problems };
  getDb().transaction(() => {
    for (const r of ok) {
      const completing = r.booking_status !== 'COMPLETED' && r.booking_source !== 'DIRECT';
      q.run(
        `UPDATE bookings SET billing_confirmed_at = datetime('now'), billing_confirmed_by = @uid,
                billing_status = CASE WHEN billing_status = 'PENDING' THEN 'READY' ELSE billing_status END,
                booking_status = CASE WHEN @completing = 1 THEN 'COMPLETED' ELSE booking_status END,
                completed_at = CASE WHEN @completing = 1 THEN COALESCE(completed_at, datetime('now')) ELSE completed_at END,
                updated_at = datetime('now'), updated_by = @uid
          WHERE id = @id`,
        { id: r.id, uid: req.user.id, completing: completing ? 1 : 0 }
      );
      recordTripEvent({
        bookingId: r.id, tripId: r.trip_id, status: 'COMPLETED',
        title: 'Billing confirmed',
        detail: `₹${Number(r.total).toLocaleString('en-IN')}${completing ? ' · marked completed' : ''}${note ? ` · ${note}` : ''}`,
        isPublic: false, userId: req.user.id,
      });
    }
  })();
  audit(req, 'BILLING_CONFIRMED', {
    entityType: 'booking', entityId: ok.length === 1 ? ok[0].id : undefined,
    description: `Billing confirmed for ${ok.map((r) => r.trip_id || r.booking_code).join(', ')}${note ? ` — ${note}` : ''}`,
    meta: { ids: ok.map((r) => r.id) },
  });
  return { confirmed: ok.map((r) => r.trip_id || r.booking_code) as string[], problems };
}

router.post('/confirm-billing', requirePermission('billing.create', 'billing.update', 'invoices.create'), (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((n: number) => n > 0).slice(0, 500);
  if (!ids.length) return res.status(400).json({ error: 'Select the trips to confirm.' });
  const r = confirmBilling(ids, req, String(req.body?.note ?? '').trim().slice(0, 200));
  if (!r.confirmed.length) {
    return res.status(409).json({ error: 'None of these trips can be confirmed: ' + r.problems.map((p) => `${p.ref} (${p.problem})`).join(', ') + '.', problems: r.problems });
  }
  res.json({
    ok: true, ...r,
    message: `Billing confirmed for ${r.confirmed.length} trip(s).` +
      (r.problems.length ? ` Skipped: ${r.problems.map((p) => `${p.ref} (${p.problem})`).join(', ')}.` : ''),
  });
});

router.post('/:id/confirm-billing', requirePermission('billing.create', 'billing.update', 'invoices.create'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const r = confirmBilling([trip.id], req, String(req.body?.note ?? '').trim().slice(0, 200));
  if (!r.confirmed.length) return res.status(409).json({ error: `${trip.trip_id} cannot be confirmed: ${r.problems[0]?.problem}.` });
  res.json({ ok: true, data: tripRow('id', trip.id), message: `Billing confirmed for ${trip.trip_id}. It can now be invoiced.` });
});

router.post('/:id/unconfirm-billing', requirePermission('billing.update', 'invoices.create'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  if (trip.billing_status === 'INVOICED') return res.status(409).json({ error: `${trip.trip_id} is invoiced. Cancel the invoice first.` });
  const reason = String(req.body?.reason ?? '').trim().slice(0, 200);
  if (!reason) return res.status(400).json({ error: 'Say why the billing confirmation is being withdrawn.' });
  q.run(`UPDATE bookings SET billing_confirmed_at = NULL, billing_confirmed_by = NULL, updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
    { id: trip.id, uid: req.user!.id });
  recordTripEvent({ bookingId: trip.id, tripId: trip.trip_id, status: trip.booking_status, title: 'Billing confirmation withdrawn', detail: reason, isPublic: false, userId: req.user!.id });
  audit(req, 'BILLING_UNCONFIRMED', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id} — ${reason}` });
  res.json({ ok: true, data: tripRow('id', trip.id), message: `${trip.trip_id} is back to awaiting billing.` });
});

/** What the trip drawer shows about the feedback request, without the token. */
function feedbackSummary(bookingId: number) {
  const f = feedbackForBooking(bookingId);
  if (!f) return null;
  return {
    id: f.id,
    status: f.status,
    emailStatus: f.email_status,
    sentTo: f.sent_to,
    requestedAt: f.requested_at,
    submittedAt: f.submitted_at,
    allowResubmit: !!f.allow_resubmit,
    driverRating: f.driver_rating,
    serviceRating: f.service_rating,
    vehicleRating: f.vehicle_rating,
    overallRating: f.overall_rating,
    comments: f.comments,
  };
}

/* ==========================================================================
   The agreed fare
   ========================================================================== */

const amount = (label: string) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` })
    .min(0, `${label} cannot be negative.`)
    .max(9_999_999, `${label} looks unrealistically large — please check it.`)
    .default(0);

const fareSchema = z.object({
  baseFare: amount('Fare'),
  extraKm: amount('Extra KM'),
  extraKmRate: amount('Extra KM rate'),
  extraHours: amount('Extra hours'),
  extraHourRate: amount('Extra hour rate'),
  toll: amount('Toll'),
  parking: amount('Parking'),
  driverAllowance: amount('Driver allowance'),
  permit: amount('Permit'),
  nightCharge: amount('Night charge'),
  otherCharges: amount('Other charges'),
  otherChargesNote: z.string().trim().max(120).optional().default(''),
  discount: amount('Discount'),
  advance: amount('Advance'),
  taxMode: z.enum(['IGST', 'CGST_SGST', 'NONE']).default('IGST'),
  taxRate: z.coerce.number().min(0).max(28).default(5),
  tollParkingTaxable: z.coerce.boolean().default(false),
  waitingCharge: amount('Waiting charge'),
  stateTax: amount('State tax'),
  /** The fare rule the figures came from (Calculate from fare rule), if any. */
  fareRuleId: z.coerce.number().int().positive().nullable().optional(),
  fareSnapshot: z.string().max(20000).nullable().optional(),
});

router.post('/:id/fare', requirePermission('bookings.update'), validateBody(fareSchema), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  if (trip.billing_status === 'INVOICED') {
    return res.status(409).json({
      error: 'This trip is already invoiced. Cancel the invoice before changing the fare.',
    });
  }

  const b = req.body as z.infer<typeof fareSchema>;
  if (b.fareRuleId && !loadRule(b.fareRuleId)) {
    return res.status(400).json({ error: 'That fare rule no longer exists. Recalculate the fare.' });
  }
  const previousTotal = Number(trip.total_amount ?? 0);
  let c: ReturnType<typeof computeCharges>;

  getDb().transaction(() => {
    c = saveCharges(trip.id, {
      ...b,
      taxMode: b.taxMode as TaxMode,
      taxRate: b.taxRate,
      tollParkingTaxable: b.tollParkingTaxable,
      // A fare typed by hand is not linked to a rule; one calculated from a
      // rule keeps the rule and the copy of it the desk was looking at.
      fareRuleId: b.fareRuleId ?? null,
      fareSnapshot: b.fareRuleId ? (b.fareSnapshot ?? null) : null,
    });
    q.run(
      `UPDATE bookings SET billing_status = CASE WHEN @total > 0 AND booking_status <> 'CANCELLED'
                                                 THEN 'READY' ELSE billing_status END,
              billing_confirmed_at = CASE WHEN @changed = 1 THEN NULL ELSE billing_confirmed_at END,
              billing_confirmed_by = CASE WHEN @changed = 1 THEN NULL ELSE billing_confirmed_by END,
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id AND billing_status <> 'INVOICED'`,
      { total: c.totalAmount, id: trip.id, uid: req.user!.id, changed: Math.abs(c.totalAmount - previousTotal) > 0.004 ? 1 : 0 }
    );
  })();

  const saved = c!;
  const rule = b.fareRuleId ? loadRule(b.fareRuleId) : null;
  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: trip.booking_status,
    title: previousTotal ? 'Fare changed' : 'Fare set',
    detail: `${previousTotal ? `₹${previousTotal.toLocaleString('en-IN')} → ` : ''}₹${saved.totalAmount.toLocaleString('en-IN')}` +
      (rule ? ` · from rule ${rule.vehicle_category} ${rule.plan_label}` : ' · entered by hand'),
    isPublic: false, userId: req.user!.id,
  });
  audit(req, 'TRIP_FARE_SET', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} fare ${previousTotal ? `changed from ₹${previousTotal} ` : ''}set to ₹${saved.totalAmount} (${saved.taxMode} ${saved.taxRate}%)${rule ? ` from rule #${rule.id}` : ''}`,
    meta: { previousTotal, total: saved.totalAmount, fareRuleId: b.fareRuleId ?? null },
  });

  res.json({ ok: true, charges: saved, data: tripRow('id', trip.id), message: 'Fare saved.' });
});

/* ==========================================================================
   Raise the invoice
   ========================================================================== */

const invoiceSchema = z.object({
  /** false raises a plain invoice with no tax lines at all. */
  gst: z.coerce.boolean().default(true),
  taxMode: z.enum(['IGST', 'CGST_SGST']).default('IGST'),
  taxRate: z.coerce.number().min(0).max(28).default(5),
  invoiceDate: isoDate.optional(),
  notes: z.string().trim().max(600).optional().default(''),
  /** Email it to the customer the moment it is generated. */
  sendToCustomer: z.coerce.boolean().default(false),
  emailTo: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
});

router.post('/:id/invoice', requirePermission('invoices.create'), validateBody(invoiceSchema), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });

  const b = req.body as z.infer<typeof invoiceSchema>;

  if (trip.booking_status !== 'COMPLETED') {
    return res.status(409).json({
      error: 'Mark the trip completed before raising its invoice — the invoice states the journey took place.',
    });
  }
  if (trip.billing_status === 'INVOICED') {
    const existing = q.get<any>(
      `SELECT i.invoice_number FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.booking_id = @id AND i.status <> 'CANCELLED' LIMIT 1`,
      { id: trip.id }
    );
    return res.status(409).json({
      error: `${trip.trip_id} is already invoiced${existing ? ` on ${existing.invoice_number}` : ''}. Cancel that invoice to raise a new one.`,
    });
  }
  if (!Number(trip.total_amount ?? 0)) {
    return res.status(400).json({ error: 'Enter the fare for this trip before raising the invoice.' });
  }
  const pending = unconfirmed([trip.id]);
  if (pending.length) return res.status(409).json({ code: 'BILLING_NOT_CONFIRMED', error: unconfirmedMessage(pending) });
  const inBatch = q.get<any>(
    `SELECT bb.batch_code FROM billing_batch_items bi JOIN billing_batches bb ON bb.id = bi.batch_id
      WHERE bi.booking_id = @id AND bb.status IN ('DRAFT','PENDING_APPROVAL','APPROVED') LIMIT 1`, { id: trip.id }
  );
  if (inBatch) {
    return res.status(409).json({ error: `${trip.trip_id} is in billing batch ${inBatch.batch_code}. Bill it from Billing, or take it out of the batch first.` });
  }

  const taxMode: TaxMode = b.gst ? (b.taxMode as TaxMode) : 'NONE';
  const taxRate = b.gst ? b.taxRate : 0;

  // The stored charges must agree with the invoice, or the booking and the
  // document disagree the moment anybody reruns a report.
  const stored = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id: trip.id });
  if (stored && (stored.tax_mode !== taxMode || Number(stored.tax_rate) !== taxRate)) {
    const reimbursables = Number(stored.toll ?? 0) + Number(stored.parking ?? 0) + Number(stored.state_tax ?? 0);
    saveCharges(trip.id, {
      ...storedChargeInput(stored),
      taxMode, taxRate,
      tollParkingTaxable: reimbursables > 0 && Number(stored.non_taxable_amount ?? 0) === 0,
    });
  }

  let issued;
  try {
    issued = await issueTripInvoice({
      bookingId: trip.id,
      taxMode,
      taxRate,
      invoiceDate: b.invoiceDate,
      notes: b.notes,
      documentTitle: b.gst ? 'Tax Invoice' : 'Invoice',
      userId: req.user!.id,
    });
  } catch (err: any) {
    return res.status(err.status ?? 500).json({ error: err.message ?? 'The invoice could not be generated.' });
  }

  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: 'INVOICED',
    title: b.gst ? 'GST invoice generated' : 'Invoice generated',
    detail: `${issued.invoiceNumber} · ₹${issued.total.toLocaleString('en-IN')}`,
    userId: req.user!.id,
  });
  audit(req, 'INVOICE_GENERATED', {
    entityType: 'invoice', entityId: issued.invoiceId,
    description: `${issued.invoiceNumber} for trip ${trip.trip_id} — ₹${issued.total} (${taxMode})`,
  });

  // Optionally email it straight away.
  let emailResult: { ok: boolean; message: string } | null = null;
  if (b.sendToCustomer) {
    const to = b.emailTo || trip.customer_email || trip.passenger_email || '';
    if (!to) {
      emailResult = { ok: false, message: 'No email address on this trip, so the invoice was not sent.' };
    } else {
      const mail = invoiceEmailFor(trip, issued, taxMode, taxRate);
      const r = await sendMail({
        kind: 'INVOICE', to, subject: mail.subject, html: mail.html,
        attachmentPath: issued.filePath ?? undefined,
        attachmentName: issued.filePath
          ? `Invoice-${issued.invoiceNumber.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`
          : undefined,
        invoiceId: issued.invoiceId, bookingId: trip.id, tripId: trip.trip_id, userId: req.user!.id,
      });
      emailResult = { ok: r.ok, message: r.message };
      if (r.ok) {
        q.run(
          `UPDATE invoices SET sent_at = datetime('now'), sent_to = @to, status = 'SENT' WHERE id = @id`,
          { to, id: issued.invoiceId }
        );
        recordTripEvent({
          bookingId: trip.id, tripId: trip.trip_id, status: 'EMAIL_SENT',
          title: 'Invoice emailed', detail: `${issued.invoiceNumber} sent to ${to}`, userId: req.user!.id,
        });
      }
    }
  }

  res.status(201).json({
    ok: true,
    invoice: issued,
    data: tripRow('id', trip.id),
    email: emailResult,
    warnings: issued.warnings,
    message:
      `${b.gst ? 'GST invoice' : 'Invoice'} ${issued.invoiceNumber} generated for ${trip.trip_id}.` +
      (emailResult ? ` ${emailResult.message}` : ''),
  });
});

/** Small local wrapper so the email body is built the same way in both places. */
function invoiceEmailFor(trip: any, issued: { invoiceNumber: string; total: number }, taxMode: string, taxRate: number) {
  const taxAmount = taxMode === 'NONE'
    ? 0
    : Math.round((Number(trip.taxable_amount ?? 0) * taxRate)) / 100;
  return invoiceEmail({
    trip,
    tripId: trip.trip_id,
    customerName: trip.customer_name || trip.passenger_name || 'Customer',
    invoiceNumber: issued.invoiceNumber,
    invoiceDate: new Date().toISOString().slice(0, 10),
    total: issued.total,
    taxMode,
    taxRate,
    taxAmount,
    attached: true,
    portalUrl: portalUrl(),
  });
}

/* ==========================================================================
   Who owns the enquiry
   ========================================================================== */

router.post('/:id/owner', requirePermission('bookings.update'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const userId = req.body?.userId ? Number(req.body.userId) : null;
  let name = 'nobody';
  if (userId) {
    const u = q.get<any>('SELECT id, full_name, is_active FROM users WHERE id = @id', { id: userId });
    if (!u || !u.is_active) return res.status(400).json({ error: 'Choose an active member of staff.' });
    name = u.full_name;
  }
  const before = trip.owner_user_id
    ? q.get<any>('SELECT full_name FROM users WHERE id = @id', { id: trip.owner_user_id })?.full_name ?? '—'
    : 'nobody';
  q.run(
    `UPDATE bookings SET owner_user_id = @u, owner_assigned_at = CASE WHEN @u IS NULL THEN NULL ELSE datetime('now') END,
            updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
    { u: userId, uid: req.user!.id, id: trip.id }
  );
  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: trip.booking_status,
    title: userId ? `Picked up by ${name}` : 'Released back to the queue',
    detail: `Owner: ${before} → ${name}`, isPublic: false, userId: req.user!.id,
  });
  audit(req, 'TRIP_OWNER_SET', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id}: ${before} → ${name}` });
  res.json({ ok: true, message: userId ? `${trip.trip_id} is now with ${name}.` : `${trip.trip_id} is back in New enquiries.` });
});

/* ==========================================================================
   Quotation
   ========================================================================== */

const quoteSchema = z.object({
  /** Email the quotation to the customer; otherwise it is only marked sent (e.g. quoted on the phone). */
  email: z.coerce.boolean().default(true),
  emailTo: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  validUntil: z.union([isoDate, z.literal('')]).optional().default(''),
  message: z.string().trim().max(600).optional().default(''),
});

router.post('/:id/quote', requirePermission('bookings.update'), validateBody(quoteSchema), async (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  if (trip.booking_status !== 'INQUIRY') {
    return res.status(409).json({ error: 'A quotation is sent for an enquiry. This trip is already past that stage.' });
  }
  const total = Number(trip.total_amount ?? 0);
  if (!(total > 0)) return res.status(400).json({ error: 'Work out the fare first (Fare tab) — the quotation states it.' });

  const b = req.body as z.infer<typeof quoteSchema>;
  let emailResult: { ok: boolean; message: string } | null = null;

  if (b.email) {
    const to = b.emailTo || trip.customer_email || trip.passenger_email || '';
    if (!to) return res.status(400).json({ error: 'There is no email address on this trip. Add one, or mark the quotation as given by phone.' });
    const ch = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id: trip.id }) ?? {};
    const lines = [
      { label: 'Fare', amount: Number(ch.base_fare ?? 0) },
      { label: 'Extra km', amount: Number(ch.extra_km ?? 0) * Number(ch.extra_km_rate ?? 0) },
      { label: 'Extra hours', amount: Number(ch.extra_hours ?? 0) * Number(ch.extra_hour_rate ?? 0) },
      { label: 'Driver allowance', amount: Number(ch.driver_allowance ?? 0) },
      { label: 'Night charge', amount: Number(ch.night_charge ?? 0) },
      { label: 'Waiting', amount: Number(ch.waiting_charge ?? 0) },
      { label: 'Permit', amount: Number(ch.permit ?? 0) },
      { label: ch.other_charges_note || 'Other charges', amount: Number(ch.other_charges ?? 0) },
      { label: 'Discount', amount: -Number(ch.discount ?? 0) },
      { label: ch.tax_mode === 'CGST_SGST' ? `CGST + SGST ${ch.tax_rate}%` : `GST ${ch.tax_rate}%`, amount: Number(ch.tax_amount ?? 0) },
      { label: 'Toll, parking & state tax (at actuals)', amount: Number(ch.non_taxable_amount ?? 0) },
    ].filter((l) => Math.abs(l.amount) > 0.004);
    const mail = quotationEmail({
      trip, tripId: trip.trip_id, customerName: trip.customer_name || trip.passenger_name || 'Customer',
      lines, total, validUntil: b.validUntil, message: b.message,
      taxNote: ch.tax_mode === 'NONE' ? 'Prices are without GST.' : undefined,
    });
    const r = await sendMail({
      kind: 'QUOTATION', to, subject: mail.subject, html: mail.html,
      bookingId: trip.id, tripId: trip.trip_id, userId: req.user!.id,
    });
    emailResult = { ok: r.ok, message: r.message };
    if (!r.ok) return res.status(502).json({ error: `The quotation email did not go out: ${r.message}` });
  }

  q.run(
    `UPDATE bookings SET quote_status = 'SENT', quote_sent_at = datetime('now'), quote_amount = @t,
            owner_user_id = COALESCE(owner_user_id, @uid),
            owner_assigned_at = COALESCE(owner_assigned_at, datetime('now')),
            updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
    { t: total, uid: req.user!.id, id: trip.id }
  );
  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: 'INQUIRY',
    title: 'Quotation sent', detail: `₹${total.toLocaleString('en-IN')}${b.email ? ' · emailed' : ' · given by phone'}`,
    userId: req.user!.id,
  });
  audit(req, 'TRIP_QUOTE_SENT', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id} quoted at ₹${total}` });
  res.json({ ok: true, email: emailResult, message: `Quotation for ${trip.trip_id} recorded as sent.` });
});

/** The customer's answer to a quotation. Accepting confirms the booking. */
router.post('/:id/quote-response', requirePermission('bookings.update'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  if (trip.booking_status !== 'INQUIRY' || trip.quote_status !== 'SENT') {
    return res.status(409).json({ error: 'There is no open quotation on this trip.' });
  }
  const accepted = !!req.body?.accepted;
  const note = String(req.body?.note ?? '').trim().slice(0, 300);
  getDb().transaction(() => {
    if (accepted) {
      q.run(
        `UPDATE bookings SET quote_status = 'ACCEPTED', booking_status = 'CONFIRMED',
                updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
        { uid: req.user!.id, id: trip.id }
      );
      recordTripEvent({ bookingId: trip.id, tripId: trip.trip_id, status: 'CONFIRMED', title: 'Booking confirmed', detail: note || 'Customer accepted the quotation', userId: req.user!.id });
    } else {
      // Declined goes back to the desk to re-quote; cancelling is a separate, deliberate step.
      q.run(
        `UPDATE bookings SET quote_status = 'DECLINED', updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
        { uid: req.user!.id, id: trip.id }
      );
      recordTripEvent({ bookingId: trip.id, tripId: trip.trip_id, status: 'INQUIRY', title: 'Quotation declined', detail: note || null, isPublic: false, userId: req.user!.id });
    }
  })();
  audit(req, 'TRIP_QUOTE_ANSWERED', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id} quotation ${accepted ? 'accepted' : 'declined'}` });
  res.json({ ok: true, message: accepted ? `${trip.trip_id} confirmed.` : `${trip.trip_id} marked declined — revise the fare and quote again, or cancel it.` });
});

/* ==========================================================================
   What the trip costs us — the payable side
   ========================================================================== */

router.post('/:id/cost', requirePermission('bookings.update', 'billing.update'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const raw = req.body?.supplierCost;
  const cost = raw === '' || raw === null || raw === undefined ? null : Number(raw);
  if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > 9_999_999)) {
    return res.status(400).json({ error: 'Enter the supplier cost as a positive amount.' });
  }
  const payee = String(req.body?.supplierName ?? '').trim().slice(0, 120) || null;
  if (cost && !payee) return res.status(400).json({ error: 'Say who is paid this amount (the vehicle owner or partner).' });
  q.run(
    `UPDATE bookings SET supplier_cost = @c, supplier_name = @n, updated_at = datetime('now'), updated_by = @uid WHERE id = @id`,
    { c: cost, n: payee, uid: req.user!.id, id: trip.id }
  );
  recordTripEvent({
    bookingId: trip.id, tripId: trip.trip_id, status: trip.booking_status, isPublic: false, userId: req.user!.id,
    title: 'Supplier cost recorded', detail: cost ? `₹${cost.toLocaleString('en-IN')} payable to ${payee}` : 'Cleared',
  });
  audit(req, 'TRIP_COST_SET', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id}: supplier cost ${cost ?? 'cleared'}${payee ? ` to ${payee}` : ''}` });
  res.json({ ok: true, message: 'Supplier cost saved.' });
});

/** Is this vehicle / driver free for this trip? Used by the allotment form as you choose. */
router.get('/:id/clashes', requirePermission('bookings.view'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });
  const p = req.query as Record<string, string>;
  const vehicle = p.vehicleId ? q.get<any>('SELECT * FROM vehicles WHERE id = @id', { id: Number(p.vehicleId) }) : null;
  const driver = p.driverId ? q.get<any>('SELECT * FROM drivers WHERE id = @id', { id: Number(p.driverId) }) : null;
  const clashes = findClashes({
    bookingId: trip.id, vehicleId: vehicle?.id ?? null,
    vehicleNumber: p.vehicleNumber || vehicle?.vehicle_number || '',
    driverId: driver?.id ?? null, driverMobile: p.driverMobile || driver?.mobile || '',
  });
  res.json({
    clashes: clashes.map((c) => ({ ...c, message: describeClash(c) })),
    documents: [
      ...(vehicle ? blockingDocuments('vehicle', vehicle, trip.travel_date) : []),
      ...(driver ? blockingDocuments('driver', driver, trip.travel_date) : []),
    ],
    window: tripWindow(trip),
  });
});

/* ==========================================================================
   Link a trip to a customer account by hand
   ========================================================================== */

router.post('/:id/link-customer', requirePermission('bookings.update'), (req, res) => {
  const trip = findTrip(String(req.params.id));
  if (!trip) return res.status(404).json({ error: 'That trip could not be found.' });

  const email = String(req.body?.email ?? trip.customer_email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Enter the customer\'s account email address.' });

  const customer = q.get<any>('SELECT id, full_name FROM customers WHERE email = @e', { e: email });
  if (!customer) {
    return res.status(404).json({
      error: `No customer account uses ${email}. Ask them to register on the website with that address — the trip will then attach itself.`,
    });
  }

  q.run(
    `UPDATE bookings SET customer_id = @cid, customer_email = @e, updated_at = datetime('now') WHERE id = @id`,
    { cid: customer.id, e: email, id: trip.id }
  );
  audit(req, 'TRIP_LINKED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} linked to customer account ${email}`,
  });
  res.json({ ok: true, message: `${trip.trip_id} now appears in ${customer.full_name}'s account.` });
});

export default router;
