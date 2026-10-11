import { Router } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile, isoDate } from '../utils/validate';
import { computeCharges } from '../services/billing';
import { withStoredExtras, writeCharges, type StoredChargeInput } from '../services/charges';
import { sendTable, filterNote } from '../utils/exportSheet';
import { parseBookingMessage } from '../services/bookingMessageParser';
import { ensureDirectVendor } from '../services/directCustomer';
import { nextTripId } from '../services/tripId';
import { matchCategoryId } from '../services/bootstrap';
import { parseParserConfig } from '../services/parserConfig';
import { recordTripEvent } from '../services/tripFlow';
import { airportDirectionField, resolveAirportDirection } from '../services/airport';
import { requestFeedback } from '../services/feedback';
import { requestOrigin } from '../utils/origin';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Paste-a-vendor-message parser — replaces DataEntryFormula.xlsx
// ---------------------------------------------------------------------------
router.post('/parse-message', requirePermission('bookings.create', 'bookings.view'), (req, res) => {
  const message = String(req.body?.message ?? '');
  if (!message.trim()) return res.status(400).json({ error: 'Paste the vendor booking message first.' });
  const chosenVendorId = Number(req.body?.vendorId) || null;

  // A first pass without any company rules finds the sign-off / reference shape,
  // which is how the company is recognised when the user has not chosen one.
  let result = parseBookingMessage(message);

  let vendorId: number | null = chosenVendorId;
  let detectedBy: string | null = chosenVendorId ? 'selected' : null;
  if (!vendorId) {
    const found = detectVendor(result.fields.vendorHint, result.fields.contactNumber, result.detectedFormat);
    vendorId = found?.id ?? null;
    detectedBy = found?.by ?? null;
  }

  // Second pass with the company's own label aliases and rules.
  const vendor = vendorId ? q.get<any>('SELECT id, vendor_name, code, status, parser_config FROM vendors WHERE id = @id', { id: vendorId }) : null;
  // Rules typed on the company form can be tried before they are saved.
  const config = parseParserConfig(req.body?.parserConfig ?? vendor?.parser_config);
  if (vendor || req.body?.parserConfig) result = parseBookingMessage(message, { labels: config.labels, noReference: config.noReference });

  // The company the message itself names, when it disagrees with the one chosen.
  let companyMismatch: string | null = null;
  if (chosenVendorId && result.fields.vendorHint) {
    const named = detectVendor(result.fields.vendorHint, result.fields.contactNumber, 'UNKNOWN');
    if (named && named.id !== chosenVendorId) {
      const v = q.get<any>('SELECT vendor_name FROM vendors WHERE id = @id', { id: named.id });
      companyMismatch = `The message is signed by ${result.fields.vendorHint}, which matches ${v?.vendor_name}, not the company selected.`;
    }
  }

  // Duplicate guard against the vendor's own reference
  let duplicate: any = null;
  if (result.fields.vendorBookingRef && vendorId) {
    duplicate = q.get<any>(
      `SELECT id, booking_code, trip_id, travel_date, booking_status FROM bookings
        WHERE vendor_id = @v AND vendor_booking_ref = @r LIMIT 1`,
      { v: vendorId, r: result.fields.vendorBookingRef }
    );
  }

  const category = result.fields.vehicleType ? matchCategoryId(result.fields.vehicleType) : null;
  const categoryRow = category ? q.get<any>('SELECT id, code, name FROM vehicle_categories WHERE id = @id', { id: category }) : null;

  const passenger = result.fields.passengerMobile
    ? q.get<any>('SELECT * FROM passengers WHERE mobile = @m LIMIT 1', { m: result.fields.passengerMobile })
    : null;

  audit(req, 'BOOKING_PARSED', { description: `Parsed ${result.detectedFormat} message (confidence ${result.confidence})${vendor ? ` for ${vendor.vendor_name}` : ''}` });

  res.json({
    ...result,
    company: vendor ? { id: vendor.id, name: vendor.vendor_name, code: vendor.code, status: vendor.status, detectedBy } : null,
    // The message names a company the master does not know: register it, or
    // treat the request as an event / direct booking.
    unknownCompany: !vendor && (result.fields.vendorHint || result.fields.contactNumber)
      ? { name: result.fields.vendorHint ?? null, contactNumber: result.fields.contactNumber ?? null }
      : null,
    companyMismatch,
    suggestions: {
      vendorId,
      categoryId: categoryRow?.id ?? null,
      categoryName: categoryRow?.name ?? null,
      passengerId: passenger?.id ?? null,
      passengerEmail: passenger?.email ?? null,
    },
    duplicate: duplicate
      ? {
          id: duplicate.id,
          bookingCode: duplicate.booking_code,
          tripId: duplicate.trip_id,
          travelDate: duplicate.travel_date,
          status: duplicate.booking_status,
          message: `This company reference is already saved as ${duplicate.trip_id || duplicate.booking_code}.`,
        }
      : null,
  });
});

/**
 * Which company sent the message: its sign-off name against names and aliases,
 * then its contact number, then (weakest) the reference format it uses.
 */
function detectVendor(hint?: string, contact?: string, format?: string): { id: number; by: string } | null {
  const h = (hint ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (h) {
    const rows = q.all<any>(`SELECT id, vendor_name, company_name, code, aliases FROM vendors WHERE status = 'ACTIVE' AND code <> 'DIRECT'`);
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    for (const r of rows) {
      const names = [r.vendor_name, r.company_name, r.code, ...String(r.aliases ?? '').split(',')]
        .map((x) => norm(String(x ?? ''))).filter((x) => x.length >= 3);
      if (names.some((n) => h === n || h.includes(n) || n.includes(h))) return { id: r.id, by: 'name' };
    }
  }
  if (contact) {
    const v = q.get<any>(
      `SELECT id FROM vendors WHERE status='ACTIVE' AND (
         replace(replace(mobile,' ',''),'+91','') = @m OR replace(replace(alt_mobile,' ',''),'+91','') = @m) LIMIT 1`,
      { m: contact }
    );
    if (v) return { id: v.id, by: 'contact number' };
  }
  if (format && format !== 'UNKNOWN' && format !== 'GENERIC') {
    const v = q.all<any>(`SELECT id FROM vendors WHERE status='ACTIVE' AND booking_message_format = @f`, { f: format });
    if (v.length === 1) return { id: v[0].id, by: 'message format' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
/** A money field that never goes negative, with a message an operator can act on. */
const amount = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number.` })
    .min(0, `${label} cannot be negative.`)
    .max(9_999_999, `${label} looks unrealistically large — please check it.`)
    .default(0);

const bookingSchema = z.object({
  /** A counter booking has no vendor; it is attached to the reserved Direct
   *  Customer record and billed to the customer captured below. */
  bookingSource: z.enum(['VENDOR', 'DIRECT']).default('VENDOR'),
  vendorId: z.coerce.number().int().positive().optional(),

  customerName: z.string().trim().optional().default(''),
  customerMobile: optionalMobile.default(''),
  customerEmail: z.union([z.string().email('Enter a valid email.'), z.literal('')]).optional().default(''),
  customerAddress: z.string().trim().optional().default(''),
  customerGstin: z.string().trim().optional().default(''),

  vendorBookingRef: z.string().trim().optional().default(''),
  bookingDate: isoDate.optional(),
  travelDate: isoDate,
  travelDateTo: z.union([isoDate, z.literal('')]).optional(),
  reportingTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),

  tripType: z.enum(['LOCAL', 'TRANSFER', 'OUTSTATION', 'AIRPORT', 'ROUND_TRIP', 'PACKAGE']).default('LOCAL'),
  /** AIRPORT only: TO or FROM the airport. Inferred from the addresses when left blank. */
  airportDirection: airportDirectionField,
  dutyType: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default('Mumbai'),
  pickupLocation: z.string().trim().min(1, 'Pickup location is required.'),
  pickupAddress: z.string().trim().optional().default(''),
  dropLocation: z.string().trim().optional().default(''),
  dropAddress: z.string().trim().optional().default(''),
  flightTrainNo: z.string().trim().optional().default(''),
  flightSector: z.string().trim().optional().default(''),
  flightTime: z.string().trim().optional().default(''),
  tripDistanceKm: z.coerce.number().min(0).optional().default(0),
  tripDurationHrs: z.coerce.number().min(0).optional().default(0),

  passengerName: z.string().trim().min(1, 'Passenger name is required.'),
  passengerMobile: optionalMobile.default(''),
  passengerEmail: z.union([z.string().email('Enter a valid email.'), z.literal('')]).optional().default(''),
  paxCount: z.coerce.number().int().min(0).max(60).optional().default(1),
  bagCount: z.coerce.number().int().min(0).max(60).optional().default(0),

  vehicleId: z.coerce.number().int().positive().nullable().optional(),
  /** Vehicle category from Masters; resolved from the vehicle type text when left out. */
  vehicleCategoryId: z.coerce.number().int().positive().nullable().optional(),
  /** How a direct booking reached us (walk-in, phone/WhatsApp, email, website). */
  inquirySource: z.enum(['VENDOR', 'WALKIN', 'WHATSAPP', 'EMAIL', 'PORTAL']).optional(),
  vehicleType: z.string().trim().optional().default(''),
  vehicleNumber: z.string().trim().optional().default(''),
  driverName: z.string().trim().optional().default(''),
  driverMobile: optionalMobile.default(''),

  specialInstructions: z.string().trim().optional().default(''),
  remarks: z.string().trim().optional().default(''),
  rawMessage: z.string().optional().default(''),
  bookingStatus: z
    .enum(['INQUIRY', 'DRAFT', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW'])
    .default('CONFIRMED'),

  // Every charge line is non-negative. The message is written for the operator,
  // not for a developer, because it surfaces directly in a toast.
  charges: z.object({
    baseFare: amount('Base fare'),
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
    otherChargesNote: z.string().trim().optional().default(''),
    discount: amount('Discount'),
    advance: amount('Advance'),
    taxModeOverride: z.enum(['IGST', 'CGST_SGST', 'NONE']).optional(),
    taxRateOverride: z.coerce.number().min(0).max(28).optional(),
    // The booking form bills a single amount plus toll & parking, and shows the
    // latter as an after-tax line. It sends this so the saved figures match what
    // the operator was looking at, whatever the vendor's own default is.
    tollParkingTaxableOverride: z.boolean().optional(),
  }).default({} as any),
}).refine((d) => !d.travelDateTo || d.travelDateTo >= d.travelDate, {
  message: 'The end date cannot be before the travel date.',
  path: ['travelDateTo'],
}).refine((d) => d.bookingSource === 'DIRECT' || !!d.vendorId, {
  message: 'Choose a vendor.',
  path: ['vendorId'],
}).refine((d) => d.bookingSource !== 'DIRECT' || d.customerName.trim().length >= 2, {
  message: 'Enter the customer name — the invoice is addressed to them.',
  path: ['customerName'],
});

type BookingInput = z.infer<typeof bookingSchema>;

function nextBookingCode(): string {
  const row = q.get<any>(
    `SELECT booking_code FROM bookings WHERE booking_code LIKE 'GTT-B-%'
      ORDER BY CAST(substr(booking_code, 7) AS INTEGER) DESC LIMIT 1`
  );
  const last = row ? Number(String(row.booking_code).slice(6)) : 0;
  return `GTT-B-${String(last + 1).padStart(6, '0')}`;
}

/**
 * The charge input as stored: the form's lines plus the vendor's tax treatment,
 * plus — on an edit — the waiting charge, state tax and fare rule this form
 * does not show, so saving the booking never quietly drops them.
 */
function chargeInput(vendor: any, charges: BookingInput['charges'], existingId: number | null = null): StoredChargeInput {
  return withStoredExtras(existingId, {
    ...charges,
    taxMode: charges.taxModeOverride ?? vendor.tax_mode,
    taxRate: charges.taxRateOverride ?? vendor.tax_rate,
    tollParkingTaxable: charges.tollParkingTaxableOverride ?? !!vendor.toll_parking_taxable,
  });
}

function priceBooking(vendor: any, charges: BookingInput['charges'], existingId: number | null = null) {
  return computeCharges(chargeInput(vendor, charges, existingId));
}

function upsertPassenger(b: BookingInput, vendorId: number): number | null {
  if (!b.passengerName) return null;
  const existing = q.get<any>(
    'SELECT id FROM passengers WHERE name = @n AND ifnull(mobile,\'\') = @m',
    { n: b.passengerName, m: b.passengerMobile ?? '' }
  );
  if (existing) {
    q.run(
      `UPDATE passengers SET trip_count = trip_count + 1, last_trip_at = @d,
              email = COALESCE(NULLIF(@e,''), email) WHERE id = @id`,
      { d: b.travelDate, e: b.passengerEmail, id: existing.id }
    );
    return existing.id;
  }
  const info = q.run(
    `INSERT INTO passengers (name, mobile, email, vendor_id, trip_count, last_trip_at)
     VALUES (@n, @m, @e, @v, 1, @d)`,
    { n: b.passengerName, m: b.passengerMobile, e: b.passengerEmail, v: vendorId, d: b.travelDate }
  );
  return Number(info.lastInsertRowid);
}

function bumpLocation(label: string) {
  if (!label) return;
  q.run(
    `INSERT INTO locations (label, use_count) VALUES (@l, 1)
     ON CONFLICT(label) DO UPDATE SET use_count = use_count + 1`,
    { l: label }
  );
}

// ---------------------------------------------------------------------------
// List with full filtering
// ---------------------------------------------------------------------------
function bookingList(p: Record<string, string>, all = false) {
  const params = {
    search: p.search ?? '',
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    from: p.from ?? '',
    to: p.to ?? '',
    travelFrom: p.travelFrom ?? '',
    travelTo: p.travelTo ?? '',
    bookingStatus: p.bookingStatus ?? '',
    billingStatus: p.billingStatus ?? '',
    tripType: p.tripType ?? '',
    source: p.source ?? '',
    limit: all ? 1_000_000 : Math.min(Number(p.limit ?? 50), 500),
    offset: Number(p.offset ?? 0),
  };

  const where = `
    WHERE (@search = '' OR b.booking_code LIKE '%'||@search||'%'
                        OR b.vendor_booking_ref LIKE '%'||@search||'%'
                        OR b.passenger_name LIKE '%'||@search||'%'
                        OR b.passenger_mobile LIKE '%'||@search||'%'
                        OR b.pickup_location LIKE '%'||@search||'%'
                        OR b.drop_location LIKE '%'||@search||'%'
                        OR b.vehicle_number LIKE '%'||@search||'%'
                        OR b.trip_id LIKE '%'||@search||'%'
                        OR b.customer_name LIKE '%'||@search||'%'
                        OR v.vendor_name LIKE '%'||@search||'%')
      AND (@vendorId = 0 OR b.vendor_id = @vendorId)
      AND (@from = '' OR b.booking_date >= @from)
      AND (@to = '' OR b.booking_date <= @to)
      AND (@travelFrom = '' OR b.travel_date >= @travelFrom)
      AND (@travelTo = '' OR b.travel_date <= @travelTo)
      AND (@bookingStatus = '' OR b.booking_status = @bookingStatus)
      AND (@billingStatus = '' OR b.billing_status = @billingStatus)
      AND (@tripType = '' OR b.trip_type = @tripType)
      AND (@source = '' OR b.inquiry_source = @source)`;

  const data = q.all<any>(
    `SELECT b.*, v.vendor_name, v.code AS vendor_code, v.company_name,
            c.base_fare, c.total_amount, c.taxable_amount, c.tax_amount, c.non_taxable_amount,
            i.invoice_number, i.status AS invoice_status, i.id AS invoice_id,
            CASE WHEN i.id IS NULL THEN 'NOT_INVOICED' ELSE i.status END AS derived_invoice_status,
            i.paid_amount AS invoice_paid, i.outstanding_amount AS invoice_outstanding, i.due_date AS invoice_due_date,
            CASE WHEN i.id IS NULL THEN NULL
                 WHEN COALESCE(i.outstanding_amount,0) <= 0.005 THEN 'PAID'
                 WHEN i.due_date < date('now') THEN 'OVERDUE'
                 WHEN COALESCE(i.paid_amount,0) > 0 THEN 'PARTIALLY_PAID'
                 ELSE 'UNPAID' END AS payment_status,
            vc.name AS category_name
       FROM bookings b
       LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
       LEFT JOIN invoice_items ii ON ii.booking_id = b.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status <> 'CANCELLED'
       ${where}
      ORDER BY b.travel_date DESC, b.id DESC
      LIMIT @limit OFFSET @offset`,
    params
  );

  const agg = q.get<any>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(c.total_amount),0) AS total_amount
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id ${where}`,
    params
  );

  return { data, total: agg.total, totalAmount: agg.total_amount };
}

router.get('/', requirePermission('bookings.view'), (req, res) => {
  res.json(bookingList(req.query as Record<string, string>));
});

/** The booking register as Excel/CSV, with the list's filters applied. */
router.get('/export', requirePermission('bookings.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { data } = bookingList(p, true);
  await sendTable(res, 'bookings', {
    name: 'Bookings', title: 'Booking register',
    notes: [filterNote({ Search: p.search, 'Booked from': p.from, 'Booked to': p.to, 'Travel from': p.travelFrom, 'Travel to': p.travelTo, Status: p.bookingStatus, Billing: p.billingStatus })],
    columns: [
      { key: 'booking_code', header: 'Booking ID', kind: 'id' }, { key: 'trip_id', header: 'Trip ID', kind: 'id' },
      { key: 'booking_date', header: 'Booked on', kind: 'date' }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'reporting_time', header: 'Time' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'vendor_booking_ref', header: 'Vendor ref', kind: 'id' }, { key: 'passenger_name', header: 'Passenger' },
      { key: 'passenger_mobile', header: 'Mobile', kind: 'id' }, { key: 'trip_type', header: 'Trip type' },
      { key: 'pickup_location', header: 'Pickup', width: 30 }, { key: 'drop_location', header: 'Drop', width: 30 },
      { key: 'vehicle_type', header: 'Vehicle' }, { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' },
      { key: 'driver_name', header: 'Driver' }, { key: 'taxable_amount', header: 'Taxable', kind: 'money' },
      { key: 'tax_amount', header: 'Tax', kind: 'money' }, { key: 'non_taxable_amount', header: 'Toll/parking', kind: 'money' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'booking_status', header: 'Status' },
      { key: 'billing_status', header: 'Billing' }, { key: 'invoice_number', header: 'Invoice', kind: 'id' },
    ],
    rows: data, totals: ['taxable_amount', 'tax_amount', 'non_taxable_amount', 'total_amount'],
  }, p.format);
});

// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('bookings.view'), (req, res) => {
  const booking = q.get<any>(
    `SELECT b.*, v.vendor_name, v.code AS vendor_code, v.company_name, v.gst_number,
            v.tax_mode, v.tax_rate, v.toll_parking_taxable
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id WHERE b.id = @id`,
    { id: req.params.id }
  );
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });

  const charges = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id: req.params.id });
  const invoice = q.get<any>(
    `SELECT i.* FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
      WHERE ii.booking_id = @id AND i.status <> 'CANCELLED' LIMIT 1`,
    { id: req.params.id }
  );
  res.json({ data: booking, charges, invoice: invoice ?? null });
});

// ---------------------------------------------------------------------------
router.post('/', requirePermission('bookings.create'), validateBody(bookingSchema), (req, res) => {
  const b = req.body as BookingInput;

  // A counter booking resolves to the reserved Direct Customer record, which is
  // created the first time one is taken.
  const vendor = b.bookingSource === 'DIRECT'
    ? ensureDirectVendor()
    : q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: b.vendorId });

  if (!vendor) return res.status(400).json({ error: 'The selected vendor no longer exists.' });
  if (vendor.status !== 'ACTIVE') {
    return res.status(400).json({ error: `${vendor.vendor_name} is marked Inactive. Reactivate the vendor first.` });
  }
  b.vendorId = vendor.id;

  const airportDirection = resolveAirportDirection(b.tripType, b.airportDirection, b.pickupLocation, b.dropLocation);
  if (b.tripType === 'AIRPORT' && !airportDirection) {
    return res.status(400).json({ error: 'Choose the direction first: to the airport, or from the airport.' });
  }

  if (b.vendorBookingRef) {
    const dup = q.get<any>(
      'SELECT booking_code FROM bookings WHERE vendor_id = @v AND vendor_booking_ref = @r',
      { v: b.vendorId, r: b.vendorBookingRef }
    );
    if (dup) {
      return res.status(409).json({
        error: `${vendor.vendor_name} reference "${b.vendorBookingRef}" is already saved as ${dup.booking_code}.`,
      });
    }
  }

  const c = priceBooking(vendor, b.charges);

  // Every booking joins the customer journey, whichever screen raised it: a
  // counter booking is a walk-in, everything else is vendor work. The Trip ID is
  // what the customer and the office quote at each other from here on.
  const inquirySource = b.bookingSource === 'DIRECT'
    ? (b.inquirySource && b.inquirySource !== 'VENDOR' ? b.inquirySource : 'WALKIN')
    : 'VENDOR';
  const categoryId = b.vehicleCategoryId ?? matchCategoryId(b.vehicleType);

  // Attach it to the customer's website account when the email already has one,
  // so the trip shows up in their dashboard without them asking.
  const account = b.customerEmail
    ? q.get<any>('SELECT id FROM customers WHERE email = @e', { e: b.customerEmail.toLowerCase() })
    : null;

  const result = getDb().transaction(() => {
    const passengerId = upsertPassenger(b, vendor.id);
    const code = nextBookingCode();
    const tripId = nextTripId(inquirySource);

    const info = q.run(
      `INSERT INTO bookings (booking_code, vendor_id, vendor_booking_ref, booking_date, travel_date,
          travel_date_to, reporting_time, trip_type, airport_direction, duty_type, city, pickup_location, pickup_address,
          drop_location, drop_address, flight_train_no, flight_sector, flight_time,
          trip_distance_km, trip_duration_hrs,
          passenger_id, passenger_name, passenger_mobile, passenger_email, pax_count, bag_count,
          vehicle_id, vehicle_type, vehicle_number, driver_name, driver_mobile,
          special_instructions, remarks, raw_message, booking_status, billing_status,
          booking_source, customer_name, customer_mobile, customer_email, customer_address, customer_gstin,
          trip_id, inquiry_source, customer_id, vehicle_category_id,
          created_by, updated_by)
       VALUES (@code, @vendorId, @ref, @bookingDate, @travelDate, @travelDateTo, @reportingTime,
          @tripType, @airportDirection, @dutyType, @city, @pickupLocation, @pickupAddress, @dropLocation, @dropAddress,
          @flightTrainNo, @flightSector, @flightTime, @tripDistanceKm, @tripDurationHrs,
          @passengerId, @passengerName,
          @passengerMobile, @passengerEmail, @paxCount, @bagCount, @vehicleId, @vehicleType,
          @vehicleNumber, @driverName, @driverMobile, @specialInstructions, @remarks, @rawMessage,
          @bookingStatus, @billingStatus,
          @bookingSource, @customerName, @customerMobile, @customerEmail, @customerAddress, @customerGstin,
          @tripId, @inquirySource, @customerId, @categoryId,
          @uid, @uid)`,
      {
        code,
        vendorId: b.vendorId,
        ref: b.vendorBookingRef || null,
        bookingDate: b.bookingDate ?? new Date().toISOString().slice(0, 10),
        travelDate: b.travelDate,
        travelDateTo: b.travelDateTo || null,
        reportingTime: b.reportingTime,
        tripType: b.tripType,
        airportDirection,
        dutyType: b.dutyType,
        city: b.city,
        pickupLocation: b.pickupLocation,
        pickupAddress: b.pickupAddress || b.pickupLocation,
        dropLocation: b.dropLocation,
        dropAddress: b.dropAddress || b.dropLocation,
        flightTrainNo: b.flightTrainNo,
        flightSector: b.flightSector,
        flightTime: b.flightTime,
        tripDistanceKm: b.tripDistanceKm,
        tripDurationHrs: b.tripDurationHrs,
        passengerId,
        passengerName: b.passengerName,
        passengerMobile: b.passengerMobile,
        passengerEmail: b.passengerEmail,
        paxCount: b.paxCount,
        bagCount: b.bagCount,
        vehicleId: b.vehicleId ?? null,
        vehicleType: b.vehicleType,
        vehicleNumber: b.vehicleNumber,
        driverName: b.driverName,
        driverMobile: b.driverMobile,
        specialInstructions: b.specialInstructions,
        remarks: b.remarks,
        rawMessage: b.rawMessage,
        bookingSource: b.bookingSource,
        customerName: b.customerName,
        customerMobile: b.customerMobile,
        customerEmail: b.customerEmail,
        customerAddress: b.customerAddress,
        customerGstin: b.customerGstin.toUpperCase(),
        bookingStatus: b.bookingStatus,
        // A draft is never picked up by billing; anything else with a price is ready.
        billingStatus: b.bookingStatus === 'DRAFT' ? 'PENDING' : (c.totalAmount > 0 ? 'READY' : 'PENDING'),
        tripId,
        inquirySource,
        customerId: account?.id ?? null,
        categoryId: categoryId ?? null,
        uid: req.user!.id,
      }
    );

    const bookingId = Number(info.lastInsertRowid);
    writeCharges(bookingId, chargeInput(vendor, b.charges), c);

    bumpLocation(b.pickupLocation);
    bumpLocation(b.dropLocation);

    recordTripEvent({
      bookingId,
      tripId,
      status: b.bookingStatus,
      title: b.bookingSource === 'DIRECT' ? 'Booking taken at the counter' : 'Vendor booking entered',
      detail: `${b.passengerName} · ${b.pickupLocation}${b.dropLocation ? ` to ${b.dropLocation}` : ''}`,
      userId: req.user!.id,
    });

    return { bookingId, code, tripId };
  })();

  audit(req, 'BOOKING_CREATED', {
    entityType: 'booking', entityId: result.bookingId,
    description: `${result.code} — ${vendor.vendor_name} — ${b.passengerName} on ${b.travelDate}`,
    meta: { total: c.totalAmount },
  });

  res.status(201).json({
    data: q.get('SELECT * FROM bookings WHERE id = @id', { id: result.bookingId }),
    charges: c,
    tripId: result.tripId,
  });
});

// ---------------------------------------------------------------------------
router.put('/:id', requirePermission('bookings.update'), validateBody(bookingSchema), async (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM bookings WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'Booking not found.' });

  if (existing.billing_status === 'INVOICED') {
    return res.status(409).json({
      error: 'This booking is already on an invoice. Cancel or regenerate that invoice before editing the booking.',
    });
  }

  const b = req.body as BookingInput;
  const vendor = b.bookingSource === 'DIRECT'
    ? ensureDirectVendor()
    : q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: b.vendorId });
  if (!vendor) return res.status(400).json({ error: 'The selected vendor no longer exists.' });
  b.vendorId = vendor.id;

  const airportDirection = resolveAirportDirection(b.tripType, b.airportDirection, b.pickupLocation, b.dropLocation);
  if (b.tripType === 'AIRPORT' && !airportDirection) {
    return res.status(400).json({ error: 'Choose the direction first: to the airport, or from the airport.' });
  }
  const completing = b.bookingStatus === 'COMPLETED' && existing.booking_status !== 'COMPLETED';

  if (b.vendorBookingRef) {
    const dup = q.get<any>(
      'SELECT booking_code FROM bookings WHERE vendor_id = @v AND vendor_booking_ref = @r AND id <> @id',
      { v: b.vendorId, r: b.vendorBookingRef, id }
    );
    if (dup) {
      return res.status(409).json({
        error: `${vendor.vendor_name} reference "${b.vendorBookingRef}" is already saved as ${dup.booking_code}.`,
      });
    }
  }

  const c = priceBooking(vendor, b.charges, id);

  getDb().transaction(() => {
    q.run(
      `UPDATE bookings SET vendor_id=@vendorId, vendor_booking_ref=@ref, travel_date=@travelDate,
          travel_date_to=@travelDateTo, reporting_time=@reportingTime, trip_type=@tripType,
          airport_direction=@airportDirection,
          duty_type=@dutyType, city=@city, pickup_location=@pickupLocation, pickup_address=@pickupAddress,
          drop_location=@dropLocation, drop_address=@dropAddress, flight_train_no=@flightTrainNo,
          flight_sector=@flightSector, flight_time=@flightTime, booking_source=@bookingSource,
          customer_name=@customerName, customer_mobile=@customerMobile, customer_email=@customerEmail,
          customer_address=@customerAddress, customer_gstin=@customerGstin,
          trip_distance_km=@tripDistanceKm, trip_duration_hrs=@tripDurationHrs,
          passenger_name=@passengerName, passenger_mobile=@passengerMobile, passenger_email=@passengerEmail,
          pax_count=@paxCount, bag_count=@bagCount, vehicle_id=@vehicleId, vehicle_type=@vehicleType,
          vehicle_number=@vehicleNumber, driver_name=@driverName, driver_mobile=@driverMobile,
          special_instructions=@specialInstructions, remarks=@remarks, booking_status=@bookingStatus,
          billing_status=@billingStatus,
          vehicle_category_id = COALESCE(@categoryId, vehicle_category_id),
          billing_confirmed_at = CASE WHEN @changed = 1 THEN NULL ELSE billing_confirmed_at END,
          completed_at = CASE WHEN @completing = 1 THEN datetime('now') ELSE completed_at END,
          updated_at=datetime('now'), updated_by=@uid
        WHERE id=@id`,
      {
        id, vendorId: b.vendorId, ref: b.vendorBookingRef || null, travelDate: b.travelDate,
        travelDateTo: b.travelDateTo || null, reportingTime: b.reportingTime, tripType: b.tripType,
        airportDirection, completing: completing ? 1 : 0,
        dutyType: b.dutyType, city: b.city, pickupLocation: b.pickupLocation,
        pickupAddress: b.pickupAddress || b.pickupLocation, dropLocation: b.dropLocation,
        dropAddress: b.dropAddress || b.dropLocation, flightTrainNo: b.flightTrainNo,
        flightSector: b.flightSector, flightTime: b.flightTime, bookingSource: b.bookingSource,
        customerName: b.customerName, customerMobile: b.customerMobile,
        customerEmail: b.customerEmail, customerAddress: b.customerAddress,
        customerGstin: b.customerGstin.toUpperCase(),
        tripDistanceKm: b.tripDistanceKm, tripDurationHrs: b.tripDurationHrs,
        passengerName: b.passengerName, passengerMobile: b.passengerMobile,
        passengerEmail: b.passengerEmail, paxCount: b.paxCount, bagCount: b.bagCount,
        vehicleId: b.vehicleId ?? null, vehicleType: b.vehicleType, vehicleNumber: b.vehicleNumber,
        driverName: b.driverName, driverMobile: b.driverMobile,
        specialInstructions: b.specialInstructions, remarks: b.remarks,
        bookingStatus: b.bookingStatus,
        categoryId: b.vehicleCategoryId ?? matchCategoryId(b.vehicleType) ?? null,
        changed: Math.abs(c.totalAmount - Number(q.get<any>('SELECT total_amount FROM booking_charges WHERE booking_id = @id', { id })?.total_amount ?? 0)) > 0.004 ? 1 : 0,
        billingStatus: b.bookingStatus === 'CANCELLED' ? 'CANCELLED'
          : b.bookingStatus === 'DRAFT' ? 'PENDING'
          : (c.totalAmount > 0 ? 'READY' : 'PENDING'),
        uid: req.user!.id,
      }
    );

    writeCharges(id, chargeInput(vendor, b.charges, id), c);
  })();

  audit(req, 'BOOKING_UPDATED', {
    entityType: 'booking', entityId: id,
    description: `${existing.booking_code} updated`,
  });

  // Saving the booking as Completed is the same act as the trip screen's
  // "Mark Trip as Completed", so it asks the customer for feedback the same
  // way - once. Re-saving an already-completed booking does nothing here.
  let feedback: Awaited<ReturnType<typeof requestFeedback>> | null = null;
  if (completing) {
    recordTripEvent({
      bookingId: id, tripId: existing.trip_id, status: 'COMPLETED', title: 'Trip completed',
      userId: req.user!.id,
    });
    feedback = await requestFeedback(id, { userId: req.user!.id, baseUrl: requestOrigin(req) });
  }
  res.json({ data: q.get('SELECT * FROM bookings WHERE id = @id', { id }), charges: c, feedback });
});

// ---------------------------------------------------------------------------
router.post('/:id/duplicate', requirePermission('bookings.create'), (req, res) => {
  const id = Number(req.params.id);
  const src = q.get<any>('SELECT * FROM bookings WHERE id = @id', { id });
  if (!src) return res.status(404).json({ error: 'Booking not found.' });
  const charges = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id });

  const newId = getDb().transaction(() => {
    const code = nextBookingCode();
    // A copy is a different journey, so it gets its own Trip ID rather than
    // sharing the original's — which the unique index would refuse anyway.
    const tripId = nextTripId(src.inquiry_source === 'VENDOR' ? 'VENDOR' : 'WALKIN');
    const info = q.run(
      `INSERT INTO bookings (booking_code, trip_id, inquiry_source, booking_source, customer_id,
          vendor_id, vendor_booking_ref, booking_date, travel_date,
          reporting_time, trip_type, duty_type, city, pickup_location, pickup_address, drop_location,
          drop_address, passenger_name, passenger_mobile, passenger_email, pax_count, vehicle_id,
          vehicle_type, vehicle_number, driver_name, driver_mobile, special_instructions,
          customer_name, customer_mobile, customer_email, customer_address, customer_gstin,
          booking_status, billing_status, created_by, updated_by)
       SELECT @code, @tripId, inquiry_source, booking_source, customer_id,
          vendor_id, NULL, date('now'), travel_date, reporting_time, trip_type, duty_type,
          city, pickup_location, pickup_address, drop_location, drop_address, passenger_name,
          passenger_mobile, passenger_email, pax_count, vehicle_id, vehicle_type, vehicle_number,
          driver_name, driver_mobile, special_instructions,
          customer_name, customer_mobile, customer_email, customer_address, customer_gstin,
          'DRAFT', 'PENDING', @uid, @uid
         FROM bookings WHERE id = @id`,
      { code, tripId, id, uid: req.user!.id }
    );
    const nid = Number(info.lastInsertRowid);
    if (charges) {
      q.run(
        `INSERT INTO booking_charges (booking_id, base_fare, extra_km, extra_km_rate, extra_hours,
            extra_hour_rate, toll, parking, driver_allowance, permit, night_charge, other_charges,
            discount, taxable_amount, tax_mode, tax_rate, cgst, sgst, igst, tax_amount,
            non_taxable_amount, total_amount, balance)
         SELECT @nid, base_fare, extra_km, extra_km_rate, extra_hours, extra_hour_rate, toll, parking,
            driver_allowance, permit, night_charge, other_charges, discount, taxable_amount, tax_mode,
            tax_rate, cgst, sgst, igst, tax_amount, non_taxable_amount, total_amount, total_amount
           FROM booking_charges WHERE booking_id = @id`,
        { nid, id }
      );
    }
    return nid;
  })();

  audit(req, 'BOOKING_DUPLICATED', {
    entityType: 'booking', entityId: newId,
    description: `Duplicated from ${src.booking_code}`,
  });
  res.status(201).json({ data: q.get('SELECT * FROM bookings WHERE id = @id', { id: newId }) });
});

// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('bookings.delete'), (req, res) => {
  const id = Number(req.params.id);
  const b = q.get<any>('SELECT * FROM bookings WHERE id = @id', { id });
  if (!b) return res.status(404).json({ error: 'Booking not found.' });

  const onInvoice = q.get<any>(
    `SELECT i.invoice_number FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.booking_id = @id AND i.status <> 'CANCELLED' LIMIT 1`,
    { id }
  );
  if (onInvoice) {
    return res.status(409).json({
      error: `This booking appears on invoice ${onInvoice.invoice_number} and cannot be deleted. Cancel that invoice first.`,
    });
  }

  q.run('DELETE FROM bookings WHERE id = @id', { id });
  audit(req, 'BOOKING_DELETED', {
    entityType: 'booking', entityId: id, description: `${b.booking_code} deleted`,
  });
  res.json({ ok: true });
});

// --- bulk status change ----------------------------------------------------
router.post('/bulk-status', requirePermission('bookings.update'), (req, res) => {
  const ids = (req.body?.ids ?? []) as number[];
  const billingStatus = String(req.body?.billingStatus ?? '');
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'Select at least one booking.' });
  if (!['PENDING', 'READY', 'CANCELLED'].includes(billingStatus)) {
    return res.status(400).json({ error: 'Invalid billing status. Invoiced status is set by generating an invoice.' });
  }

  const placeholders = ids.map(() => '?').join(',');
  const info = getDb()
    .prepare(
      `UPDATE bookings SET billing_status = ?, updated_at = datetime('now')
        WHERE id IN (${placeholders}) AND billing_status <> 'INVOICED'`
    )
    .run(billingStatus, ...ids);

  audit(req, 'BOOKING_UPDATED', {
    description: `Bulk billing status -> ${billingStatus} for ${info.changes} booking(s)`,
    meta: { ids },
  });
  res.json({ ok: true, updated: info.changes });
});

// --- autocomplete sources --------------------------------------------------
router.get('/lookup/locations', requirePermission('bookings.view'), (req, res) => {
  const search = String(req.query.search ?? '');
  res.json({
    data: q.all<any>(
      `SELECT label, city, kind FROM locations
        WHERE @s = '' OR label LIKE '%'||@s||'%'
        ORDER BY use_count DESC, label LIMIT 15`,
      { s: search }
    ),
  });
});

router.get('/lookup/passengers', requirePermission('bookings.view'), (req, res) => {
  const search = String(req.query.search ?? '');
  res.json({
    data: q.all<any>(
      `SELECT id, name, mobile, email, trip_count FROM passengers
        WHERE @s = '' OR name LIKE '%'||@s||'%' OR mobile LIKE '%'||@s||'%'
        ORDER BY trip_count DESC, name LIMIT 15`,
      { s: search }
    ),
  });
});

router.get('/lookup/vehicles', requirePermission('bookings.view'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT id, vehicle_number, vehicle_type, model, seating, driver_name, driver_mobile
         FROM vehicles WHERE is_active = 1 ORDER BY vehicle_type, vehicle_number`
    ),
  });
});

export default router;
