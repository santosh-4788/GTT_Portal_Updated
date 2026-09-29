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
import { ensureDirectVendor } from '../services/directCustomer';
import { issueTripInvoice } from '../services/invoiceIssue';
import { sendMail, mailConfig } from '../services/mailer';
import { feedbackForBooking, requestFeedback } from '../services/feedback';
import { airportDirectionField, resolveAirportDirection } from '../services/airport';
import { requestOrigin } from '../utils/origin';
import { inquiryCustomerEmail, invoiceEmail, tripDetailsEmail } from '../services/emailTemplates';
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
    trail: TRIP_TRAIL,
    mail: (() => {
      const c = mailConfig();
      return { from: c.fromAddress, enabled: c.enabled, adminInbox: c.adminInbox };
    })(),
  });
});

/* ==========================================================================
   List
   ========================================================================== */

router.get('/', requirePermission('bookings.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    search: (p.search ?? '').trim(),
    source: p.source ?? '',
    status: p.status ?? '',
    from: p.from ?? '',
    to: p.to ?? '',
    invoiced: p.invoiced ?? '',      // 'yes' | 'no' | ''
    limit: Math.min(Number(p.limit ?? 100), 500),
    offset: Number(p.offset ?? 0),
  };

  // Only trips that belong to the customer journey. A vendor booking sheet row
  // has no Trip ID and belongs on the Bookings screen, not here — unless the
  // office explicitly filters for vendor work.
  const scope =
    params.source === 'VENDOR'
      ? `AND b.inquiry_source = 'VENDOR'`
      : params.source
        ? `AND b.inquiry_source = @source`
        : `AND b.trip_id IS NOT NULL`;

  const where = `
    WHERE 1 = 1
      ${scope}
      AND (@search = '' OR b.trip_id LIKE '%'||@search||'%'
                        OR b.booking_code LIKE '%'||@search||'%'
                        OR b.customer_name LIKE '%'||@search||'%'
                        OR b.customer_mobile LIKE '%'||@search||'%'
                        OR b.customer_email LIKE '%'||@search||'%'
                        OR b.passenger_name LIKE '%'||@search||'%'
                        OR b.pickup_location LIKE '%'||@search||'%'
                        OR b.drop_location LIKE '%'||@search||'%'
                        OR b.vehicle_number LIKE '%'||@search||'%')
      AND (@status = '' OR b.booking_status = @status)
      AND (@from = '' OR b.travel_date >= @from)
      AND (@to = '' OR b.travel_date <= @to)
      AND (@invoiced = ''
           OR (@invoiced = 'yes' AND i.id IS NOT NULL)
           OR (@invoiced = 'no'  AND i.id IS NULL))`;

  const join = `
       FROM bookings b
       LEFT JOIN booking_charges c ON c.booking_id = b.id
       LEFT JOIN drivers d ON d.id = b.driver_id
       LEFT JOIN customers cu ON cu.id = b.customer_id
       LEFT JOIN invoice_items ii ON ii.booking_id = b.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status <> 'CANCELLED'`;

  const data = q.all<any>(
    `SELECT b.id, b.trip_id, b.booking_code, b.inquiry_source, b.booking_status, b.billing_status,
            b.travel_date, b.reporting_time, b.trip_type, b.created_at,
            b.pickup_location, b.pickup_address, b.drop_location, b.drop_address,
            b.customer_name, b.customer_mobile, b.customer_email, b.passenger_name, b.pax_count,
            b.vehicle_type, b.vehicle_number, b.driver_name, b.driver_mobile,
            b.assigned_at, b.completed_at, b.details_sent_at, b.customer_id,
            c.total_amount, d.full_name AS driver_full_name, d.mobile AS driver_roster_mobile,
            cu.email AS account_email,
            i.id AS invoice_id, i.invoice_number, i.total_amount AS invoice_total,
            i.status AS invoice_status, i.sent_at AS invoice_sent_at, i.tax_mode AS invoice_tax_mode
       ${join}
       ${where}
      ORDER BY
        -- Fresh enquiries first: they are the ones somebody has to act on.
        CASE b.booking_status WHEN 'INQUIRY' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END,
        b.travel_date DESC, b.id DESC
      LIMIT @limit OFFSET @offset`,
    params
  );

  const agg = q.get<any>(
    `SELECT COUNT(DISTINCT b.id) AS total, COALESCE(SUM(c.total_amount),0) AS totalAmount ${join} ${where}`,
    params
  );

  res.json({ data, total: agg.total, totalAmount: agg.totalAmount });
});

/** The counters above the list — by source, and by where each trip has got to. */
router.get('/summary', requirePermission('bookings.view'), (_req, res) => {
  const bySource = q.all<any>(
    `SELECT inquiry_source AS source, COUNT(*) AS count,
            SUM(CASE WHEN booking_status = 'INQUIRY' THEN 1 ELSE 0 END) AS open_inquiries
       FROM bookings WHERE trip_id IS NOT NULL
      GROUP BY inquiry_source`
  );
  const byStatus = q.all<any>(
    `SELECT booking_status AS status, COUNT(*) AS count
       FROM bookings WHERE trip_id IS NOT NULL GROUP BY booking_status`
  );
  const needsAttention = q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM bookings WHERE trip_id IS NOT NULL AND booking_status = 'INQUIRY') AS new_inquiries,
       (SELECT COUNT(*) FROM bookings WHERE trip_id IS NOT NULL AND booking_status = 'CONFIRMED') AS awaiting_vehicle,
       (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.booking_status = 'COMPLETED'
          AND NOT EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                           WHERE ii.booking_id = b.id AND i.status <> 'CANCELLED')) AS awaiting_invoice`
  );

  res.json({
    bySource: ALL_SOURCES.map((s) => {
      const row = bySource.find((r) => r.source === s);
      return { source: s, label: SOURCE_LABEL[s], count: row?.count ?? 0, openInquiries: row?.open_inquiries ?? 0 };
    }),
    byStatus,
    ...needsAttention,
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

  res.json({
    data: b,
    trip: publicTrip(b),
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
});

router.post('/', requirePermission('bookings.create'), validateBody(manualSchema), async (req, res) => {
  const b = req.body as z.infer<typeof manualSchema>;
  if (b.tripType === 'AIRPORT' && !b.airportDirection) {
    return res.status(400).json({ error: 'Choose the direction first: to the airport, or from the airport.' });
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
  .omit({ source: true, status: true, notifyCustomer: true })
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
    title: 'Trip details updated', detail: `${b.pickup} → ${b.dropOff || '—'} on ${b.travelDate}`,
    isPublic: false, userId: req.user!.id,
  });
  audit(req, 'TRIP_UPDATED', { entityType: 'booking', entityId: trip.id, description: `${trip.trip_id} updated` });

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

  const vehicleNumber = (b.vehicleNumber || vehicle?.vehicle_number || '').toUpperCase();
  const vehicleType = b.vehicleType || vehicle?.vehicle_type || trip.vehicle_type || '';
  const driverName = b.driverName || driver?.full_name || '';
  const driverMobile = b.driverMobile || driver?.mobile || '';

  // The same car on the same day for two different trips is nearly always a
  // mistake. Warn rather than block — a short airport drop followed by an
  // evening local is perfectly normal.
  const clash = vehicleNumber
    ? q.get<any>(
        `SELECT trip_id, booking_code, reporting_time FROM bookings
          WHERE id <> @id AND vehicle_number = @v AND travel_date = @d
            AND booking_status NOT IN ('CANCELLED','NO_SHOW','COMPLETED') LIMIT 1`,
        { id: trip.id, v: vehicleNumber, d: trip.travel_date }
      )
    : null;

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
    recordTripEvent({
      bookingId: trip.id,
      tripId: trip.trip_id,
      status: 'ASSIGNED',
      title: 'Vehicle and driver assigned',
      detail: `${[vehicleType, vehicleNumber].filter(Boolean).join(' ')} · ${driverName}${driverMobile ? ` (${driverMobile})` : ''}`,
      userId: req.user!.id,
    });
  })();

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
    warning: clash
      ? `Heads up — ${vehicleNumber} is also on ${clash.trip_id ?? clash.booking_code} that same day${clash.reporting_time ? ` at ${clash.reporting_time}` : ''}. Check the timings.`
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
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id`,
      { status: b.status, billing, id: trip.id, uid: req.user!.id }
    );
    recordTripEvent({
      bookingId: trip.id, tripId: trip.trip_id, status: b.status,
      title: STATUS_LABEL[b.status] ?? b.status,
      detail: b.note || null,
      userId: req.user!.id,
    });
  })();

  audit(req, 'TRIP_STATUS_CHANGED', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id}: ${trip.booking_status} -> ${b.status}${b.note ? ` (${b.note})` : ''}`,
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
  const c = computeCharges({
    ...b,
    taxMode: b.taxMode as TaxMode,
    taxRate: b.taxRate,
    tollParkingTaxable: b.tollParkingTaxable,
  });

  getDb().transaction(() => {
    q.run(
      `INSERT INTO booking_charges (booking_id, base_fare, extra_km, extra_km_rate, extra_hours,
          extra_hour_rate, toll, parking, driver_allowance, permit, night_charge, other_charges,
          other_charges_note, discount, taxable_amount, tax_mode, tax_rate, cgst, sgst, igst,
          tax_amount, non_taxable_amount, total_amount, advance, balance)
       VALUES (@id, @baseFare, @extraKm, @extraKmRate, @extraHours, @extraHourRate, @toll, @parking,
          @driverAllowance, @permit, @nightCharge, @otherCharges, @note, @discount, @taxable,
          @taxMode, @taxRate, @cgst, @sgst, @igst, @tax, @nonTaxable, @total, @advance, @balance)
       ON CONFLICT(booking_id) DO UPDATE SET
          base_fare=@baseFare, extra_km=@extraKm, extra_km_rate=@extraKmRate, extra_hours=@extraHours,
          extra_hour_rate=@extraHourRate, toll=@toll, parking=@parking, driver_allowance=@driverAllowance,
          permit=@permit, night_charge=@nightCharge, other_charges=@otherCharges, other_charges_note=@note,
          discount=@discount, taxable_amount=@taxable, tax_mode=@taxMode, tax_rate=@taxRate,
          cgst=@cgst, sgst=@sgst, igst=@igst, tax_amount=@tax, non_taxable_amount=@nonTaxable,
          total_amount=@total, advance=@advance, balance=@balance, updated_at=datetime('now')`,
      {
        id: trip.id,
        baseFare: b.baseFare, extraKm: b.extraKm, extraKmRate: b.extraKmRate,
        extraHours: b.extraHours, extraHourRate: b.extraHourRate,
        toll: b.toll, parking: b.parking, driverAllowance: b.driverAllowance,
        permit: b.permit, nightCharge: b.nightCharge, otherCharges: b.otherCharges,
        note: b.otherChargesNote, discount: b.discount,
        taxable: c.taxableAmount, taxMode: c.taxMode, taxRate: c.taxRate,
        cgst: c.cgst, sgst: c.sgst, igst: c.igst, tax: c.taxAmount,
        nonTaxable: c.nonTaxableAmount, total: c.totalAmount,
        advance: c.advance, balance: c.balance,
      }
    );
    q.run(
      `UPDATE bookings SET billing_status = CASE WHEN @total > 0 AND booking_status <> 'CANCELLED'
                                                 THEN 'READY' ELSE billing_status END,
              updated_at = datetime('now'), updated_by = @uid
        WHERE id = @id AND billing_status <> 'INVOICED'`,
      { total: c.totalAmount, id: trip.id, uid: req.user!.id }
    );
  })();

  audit(req, 'TRIP_FARE_SET', {
    entityType: 'booking', entityId: trip.id,
    description: `${trip.trip_id} fare set to ₹${c.totalAmount} (${c.taxMode} ${c.taxRate}%)`,
  });

  res.json({ ok: true, charges: c, data: tripRow('id', trip.id), message: 'Fare saved.' });
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

  const taxMode: TaxMode = b.gst ? (b.taxMode as TaxMode) : 'NONE';
  const taxRate = b.gst ? b.taxRate : 0;

  // The stored charges must agree with the invoice, or the booking and the
  // document disagree the moment anybody reruns a report.
  const stored = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id: trip.id });
  if (stored && (stored.tax_mode !== taxMode || Number(stored.tax_rate) !== taxRate)) {
    const c = computeCharges({
      baseFare: stored.base_fare, extraKm: stored.extra_km, extraKmRate: stored.extra_km_rate,
      extraHours: stored.extra_hours, extraHourRate: stored.extra_hour_rate,
      toll: stored.toll, parking: stored.parking, driverAllowance: stored.driver_allowance,
      permit: stored.permit, nightCharge: stored.night_charge, otherCharges: stored.other_charges,
      discount: stored.discount, advance: stored.advance,
      taxMode, taxRate, tollParkingTaxable: Number(stored.non_taxable_amount ?? 0) === 0,
    });
    q.run(
      `UPDATE booking_charges SET taxable_amount=@taxable, tax_mode=@taxMode, tax_rate=@taxRate,
              cgst=@cgst, sgst=@sgst, igst=@igst, tax_amount=@tax, non_taxable_amount=@nonTaxable,
              total_amount=@total, balance=@balance, updated_at=datetime('now')
        WHERE booking_id=@id`,
      {
        taxable: c.taxableAmount, taxMode: c.taxMode, taxRate: c.taxRate,
        cgst: c.cgst, sgst: c.sgst, igst: c.igst, tax: c.taxAmount,
        nonTaxable: c.nonTaxableAmount, total: c.totalAmount, balance: c.balance,
        id: trip.id,
      }
    );
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
