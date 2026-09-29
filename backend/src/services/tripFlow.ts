/**
 * The trip lifecycle.
 *
 * Everything a customer's journey passes through lives on the existing
 * `bookings` row — an enquiry is simply a booking that has not been confirmed
 * yet. That is a deliberate choice: it means one record carries the job from
 * the first WhatsApp message to the invoice, so the office never has to
 * "convert" anything, and the billing, reporting and invoice code that already
 * works keeps working untouched.
 *
 *   INQUIRY -> CONFIRMED -> ASSIGNED -> ONTRIP -> COMPLETED -> (invoiced)
 *
 * `trip_events` records each step so the customer's timeline and the admin's
 * activity strip read history rather than guessing it from the current status.
 */
import { q, getDb } from '../db';
import { ensureDirectVendor } from './directCustomer';
import { nextTripId, type InquirySource, SOURCE_LABEL } from './tripId';
import { resolveAirportDirection } from './airport';

/* ==========================================================================
   Status vocabulary
   ========================================================================== */

export type TripStatus =
  | 'INQUIRY' | 'CONFIRMED' | 'ASSIGNED' | 'ONTRIP'
  | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'DRAFT';

/** The statuses that form the customer-facing trail, in order. */
export const TRIP_TRAIL: { key: TripStatus; label: string; blurb: string }[] = [
  { key: 'INQUIRY', label: 'Enquiry received', blurb: 'We have your requirement and will call with the rate.' },
  { key: 'CONFIRMED', label: 'Booking confirmed', blurb: 'The fare is agreed and the trip is on our sheet.' },
  { key: 'ASSIGNED', label: 'Vehicle & driver assigned', blurb: 'Your car and chauffeur are allotted.' },
  { key: 'ONTRIP', label: 'Trip in progress', blurb: 'The journey is under way.' },
  { key: 'COMPLETED', label: 'Trip completed', blurb: 'The journey is finished.' },
];

export const STATUS_LABEL: Record<string, string> = {
  INQUIRY: 'Enquiry received',
  DRAFT: 'Draft',
  CONFIRMED: 'Booking confirmed',
  ASSIGNED: 'Vehicle & driver assigned',
  ONTRIP: 'Trip in progress',
  COMPLETED: 'Trip completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
};

/**
 * Which status may follow which.
 *
 * Enforced on the admin endpoint so the timeline cannot go backwards by
 * accident — a completed trip does not quietly become an enquiry again. Going
 * back deliberately is still possible one step at a time.
 */
const NEXT: Record<string, TripStatus[]> = {
  INQUIRY: ['CONFIRMED', 'ASSIGNED', 'CANCELLED', 'NO_SHOW'],
  DRAFT: ['INQUIRY', 'CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'INQUIRY'],
  ASSIGNED: ['ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CONFIRMED'],
  ONTRIP: ['COMPLETED', 'CANCELLED', 'ASSIGNED'],
  COMPLETED: ['ONTRIP'],
  CANCELLED: ['INQUIRY', 'CONFIRMED'],
  NO_SHOW: ['CONFIRMED', 'CANCELLED'],
};

export function canMoveTo(from: string, to: string): boolean {
  if (from === to) return true;
  return (NEXT[from] ?? []).includes(to as TripStatus);
}

export function allowedNext(from: string): TripStatus[] {
  return NEXT[from] ?? [];
}

/* ==========================================================================
   Timeline
   ========================================================================== */

export function recordTripEvent(e: {
  bookingId: number;
  tripId?: string | null;
  status: string;
  title: string;
  detail?: string | null;
  isPublic?: boolean;
  userId?: number | null;
}): void {
  q.run(
    `INSERT INTO trip_events (booking_id, trip_id, status, title, detail, is_public, created_by)
     VALUES (@bookingId, @tripId, @status, @title, @detail, @isPublic, @uid)`,
    {
      bookingId: e.bookingId,
      tripId: e.tripId ?? null,
      status: e.status,
      title: e.title,
      detail: e.detail ?? null,
      isPublic: e.isPublic === false ? 0 : 1,
      uid: e.userId ?? null,
    }
  );
}

export function tripEvents(bookingId: number, publicOnly = false) {
  return q.all<any>(
    `SELECT e.*, u.full_name AS by_name FROM trip_events e
       LEFT JOIN users u ON u.id = e.created_by
      WHERE e.booking_id = @id ${publicOnly ? 'AND e.is_public = 1' : ''}
      ORDER BY e.id ASC`,
    { id: bookingId }
  );
}

/* ==========================================================================
   Creating a trip from an enquiry
   ========================================================================== */

export interface InquiryInput {
  source: InquirySource;
  customerName: string;
  customerMobile: string;
  customerEmail?: string;
  /** WhatsApp number, when the customer said it differs from their contact number. */
  whatsappMobile?: string;
  pickup: string;
  pickupAddress?: string;
  drop?: string;
  dropAddress?: string;
  travelDate: string;      // yyyy-mm-dd
  travelDateTo?: string;
  journeyTime?: string;    // HH:MM
  vehicleType?: string;
  tripType?: string;
  /** AIRPORT only: TO or FROM the airport. Inferred from the addresses when blank. */
  airportDirection?: string;
  paxCount?: number;
  message?: string;
  serviceLabel?: string;
  customerId?: number | null;
  /** Set when the office raises the trip on the customer's behalf. */
  userId?: number | null;
  /** A trip raised by the office starts life confirmed, not as an enquiry. */
  status?: TripStatus;
}

function nextBookingCode(): string {
  const row = q.get<any>(
    `SELECT booking_code FROM bookings WHERE booking_code LIKE 'GTT-B-%'
      ORDER BY CAST(substr(booking_code, 7) AS INTEGER) DESC LIMIT 1`
  );
  const last = row ? Number(String(row.booking_code).slice(6)) : 0;
  return `GTT-B-${String(last + 1).padStart(6, '0')}`;
}

function bumpLocation(label?: string) {
  const l = (label ?? '').trim();
  if (l.length < 3) return;
  q.run(
    `INSERT INTO locations (label, use_count) VALUES (@l, 1)
     ON CONFLICT(label) DO UPDATE SET use_count = use_count + 1`,
    { l }
  );
}

/**
 * An enquiry from any channel becomes a trip.
 *
 * Returns the Trip ID immediately, because that is the one thing the customer
 * is shown on screen and the one thing they will quote back to us.
 */
export function createInquiryTrip(input: InquiryInput): { bookingId: number; tripId: string; bookingCode: string } {
  const vendor = ensureDirectVendor();
  const status = input.status ?? 'INQUIRY';

  const whatsappNote =
    input.whatsappMobile && input.whatsappMobile !== input.customerMobile
      ? `WhatsApp number: ${input.whatsappMobile}`
      : '';

  const messageParts = [
    input.serviceLabel ? `Requirement: ${input.serviceLabel}` : '',
    input.message?.trim() ?? '',
    whatsappNote,
  ].filter(Boolean);

  return getDb().transaction(() => {
    const tripId = nextTripId(input.source);
    const code = nextBookingCode();

    const info = q.run(
      `INSERT INTO bookings (
          booking_code, trip_id, inquiry_source, vendor_id, booking_source, customer_id,
          booking_date, travel_date, travel_date_to, reporting_time,
          trip_type, airport_direction, city, pickup_location, pickup_address, drop_location, drop_address,
          passenger_name, passenger_mobile, passenger_email, pax_count,
          customer_name, customer_mobile, customer_email,
          vehicle_type, inquiry_message, booking_status, billing_status)
       VALUES (
          @code, @tripId, @source, @vendorId, 'DIRECT', @customerId,
          date('now'), @travelDate, @travelDateTo, @time,
          @tripType, @airportDirection, 'Mumbai', @pickup, @pickupAddress, @drop, @dropAddress,
          @name, @mobile, @email, @pax,
          @name, @mobile, @email,
          @vehicleType, @message, @status, 'PENDING')`,
      {
        code,
        tripId,
        source: input.source,
        vendorId: vendor.id,
        customerId: input.customerId ?? null,
        travelDate: input.travelDate,
        travelDateTo: input.travelDateTo || null,
        time: input.journeyTime ?? '',
        tripType: input.tripType ?? 'LOCAL',
        airportDirection: resolveAirportDirection(input.tripType, input.airportDirection, input.pickup, input.drop),
        pickup: input.pickup,
        pickupAddress: input.pickupAddress || input.pickup,
        drop: input.drop ?? '',
        dropAddress: input.dropAddress || input.drop || '',
        name: input.customerName,
        mobile: input.customerMobile,
        email: input.customerEmail ?? '',
        pax: input.paxCount ?? 1,
        vehicleType: input.vehicleType ?? '',
        message: messageParts.join('\n') || null,
        status,
      }
    );

    const bookingId = Number(info.lastInsertRowid);

    // A charges row from the start, so Billing and the invoice engine see the
    // same shape for an enquiry as for a booking taken at the counter.
    q.run(
      `INSERT INTO booking_charges (booking_id, tax_mode, tax_rate)
       VALUES (@id, @mode, @rate)`,
      { id: bookingId, mode: vendor.tax_mode ?? 'IGST', rate: vendor.tax_rate ?? 5 }
    );

    recordTripEvent({
      bookingId,
      tripId,
      status,
      title: status === 'INQUIRY' ? 'Enquiry received' : 'Booking created',
      detail: `${SOURCE_LABEL[input.source]} · ${input.customerName}`,
      userId: input.userId ?? null,
    });

    bumpLocation(input.pickup);
    bumpLocation(input.drop);

    return { bookingId, tripId, bookingCode: code };
  })();
}

/* ==========================================================================
   Reading a trip back
   ========================================================================== */

/** Everything the trip screens need, in one query. */
export function tripRow(where: 'id' | 'trip_id', value: string | number): any | undefined {
  const column = where === 'id' ? 'b.id' : 'b.trip_id';
  return q.get<any>(
    `SELECT b.*, v.vendor_name, v.code AS vendor_code,
            c.base_fare, c.taxable_amount, c.tax_mode, c.tax_rate, c.cgst, c.sgst, c.igst,
            c.tax_amount, c.non_taxable_amount, c.total_amount, c.advance, c.balance,
            c.toll, c.parking, c.driver_allowance, c.extra_km, c.extra_km_rate,
            c.extra_hours, c.extra_hour_rate, c.night_charge, c.permit, c.other_charges, c.discount,
            d.full_name AS driver_full_name, d.mobile AS driver_roster_mobile,
            d.experience_years, d.languages,
            i.id AS invoice_id, i.invoice_number, i.invoice_date, i.total_amount AS invoice_total,
            i.status AS invoice_status, i.file_path AS invoice_file, i.file_type AS invoice_file_type,
            i.tax_mode AS invoice_tax_mode, i.tax_rate AS invoice_tax_rate,
            i.tax_amount AS invoice_tax_amount, i.sent_at AS invoice_sent_at
       FROM bookings b
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
       LEFT JOIN drivers d ON d.id = b.driver_id
       LEFT JOIN invoice_items ii ON ii.booking_id = b.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status <> 'CANCELLED'
      WHERE ${column} = @v
      LIMIT 1`,
    { v: value }
  );
}

/**
 * The customer-safe shape.
 *
 * Deliberately narrow: no vendor, no internal remarks, no cost breakdown the
 * office has not agreed to show. What the customer sees is their own journey.
 */
export function publicTrip(b: any) {
  const invoiceReady = !!b.invoice_id && b.invoice_status !== 'CANCELLED';
  return {
    tripId: b.trip_id,
    bookingCode: b.booking_code,
    source: b.inquiry_source,
    sourceLabel: SOURCE_LABEL[b.inquiry_source as InquirySource] ?? 'Booking',
    status: b.booking_status,
    statusLabel: STATUS_LABEL[b.booking_status] ?? b.booking_status,
    createdAt: b.created_at,

    travelDate: b.travel_date,
    travelDateTo: b.travel_date_to,
    journeyTime: b.reporting_time,
    tripType: b.trip_type,
    airportDirection: b.airport_direction ?? null,
    pickup: b.pickup_address || b.pickup_location,
    drop: b.drop_address || b.drop_location,
    passengers: b.pax_count,

    vehicleType: b.vehicle_type,
    vehicleNumber: b.vehicle_number,
    driverName: b.driver_full_name || b.driver_name,
    driverMobile: b.driver_roster_mobile || b.driver_mobile,
    assignedAt: b.assigned_at,
    completedAt: b.completed_at,

    passengerName: b.passenger_name,
    customerName: b.customer_name,
    customerMobile: b.customer_mobile,
    customerEmail: b.customer_email,

    fare: Number(b.total_amount ?? 0) || null,
    message: b.inquiry_message,

    invoice: invoiceReady
      ? {
          id: b.invoice_id,
          number: b.invoice_number,
          date: b.invoice_date,
          total: Number(b.invoice_total ?? 0),
          status: b.invoice_status,
          taxMode: b.invoice_tax_mode,
          taxRate: Number(b.invoice_tax_rate ?? 0),
          taxAmount: Number(b.invoice_tax_amount ?? 0),
          gst: b.invoice_tax_mode !== 'NONE' && Number(b.invoice_tax_amount ?? 0) > 0,
          downloadable: !!b.invoice_file,
          sentAt: b.invoice_sent_at,
        }
      : null,
  };
}

/**
 * Attach every trip whose recorded email matches a newly signed-in customer.
 *
 * Only the email is matched, and only exactly. Matching on mobile as well was
 * tempting — most enquiries carry one — but a mobile number typed into a public
 * form is not proof of ownership, and one transposed digit would put a
 * stranger's journey and invoice in somebody's account.
 */
export function linkCustomerTrips(customerId: number, email: string): number {
  if (!email) return 0;
  const info = q.run(
    `UPDATE bookings SET customer_id = @cid, updated_at = datetime('now')
      WHERE customer_id IS NULL AND lower(trim(customer_email)) = lower(trim(@e))`,
    { cid: customerId, e: email }
  );
  return info.changes;
}

/** The public site's own address, used to build links inside emails. */
export function portalUrl(): string {
  const row = q.get<{ value: string }>("SELECT value FROM settings WHERE key = 'website.publicUrl'");
  return (process.env.PUBLIC_URL ?? row?.value ?? '').trim().replace(/\/+$/, '');
}
