/**
 * Where each trip is in its lifecycle — the buckets on the Trips screen.
 *
 * A stage is DERIVED, never stored. It is worked out from the fields that
 * already describe a trip (booking status, who owns the enquiry, whether a
 * quotation went out, whether it is allotted, priced and invoiced), so there is
 * no second status to drift out of step with the first, and every existing
 * screen keeps reading booking_status exactly as before.
 *
 * Every trip falls into exactly ONE stage. The rules are applied in order, and
 * the first that matches wins:
 *
 *   CANCELLED            cancelled or no-show
 *   SETTLED              on a live invoice that is fully paid
 *   BILLED               on a live invoice with money still to come (invoice generated)
 *   BILLING_IN_PROGRESS  completed and inside an open billing batch (draft / approval)
 *   AWAITING_INVOICE     completed and billing confirmed, no invoice yet
 *   AWAITING_BILLING     completed, billing not confirmed yet
 *   IN_PROGRESS          on trip
 *   UPCOMING             vehicle and driver allotted, not started
 *   AWAITING_ASSIGNMENT  confirmed, no vehicle / driver yet
 *   AWAITING_CONFIRMATION enquiry with a quotation sent to the customer
 *   QUOTE_PENDING        enquiry with a fare worked out, quotation not yet sent
 *   ASSIGNED_TO_STAFF    enquiry picked up by staff, fare not worked out yet
 *   NEW                  enquiry nobody has picked up
 *   DRAFT                draft bookings
 *
 * "Confirmed trips" on the screen is the sum of the three booking stages
 * (AWAITING_ASSIGNMENT + UPCOMING + IN_PROGRESS) — a parent view, not a fourth
 * bucket, so a trip is never counted twice.
 */

export type TripStage =
  | 'NEW' | 'ASSIGNED_TO_STAFF' | 'QUOTE_PENDING' | 'AWAITING_CONFIRMATION'
  | 'AWAITING_ASSIGNMENT' | 'UPCOMING' | 'IN_PROGRESS'
  | 'AWAITING_BILLING' | 'BILLING_IN_PROGRESS' | 'AWAITING_INVOICE' | 'BILLED' | 'SETTLED' | 'CANCELLED' | 'DRAFT';

export interface StageDef {
  key: TripStage;
  label: string;
  phase: 'Enquiry' | 'Booking' | 'Billing' | 'Closed';
  /** What somebody has to do next, shown on the bucket. */
  action: string;
  description: string;
}

export const STAGES: StageDef[] = [
  { key: 'NEW', label: 'New enquiries', phase: 'Enquiry',
    action: 'Pick it up', description: 'Received, nobody has taken ownership yet.' },
  { key: 'ASSIGNED_TO_STAFF', label: 'Assigned to staff', phase: 'Enquiry',
    action: 'Work out the fare', description: 'Picked up by a member of staff; the fare has not been worked out yet.' },
  { key: 'QUOTE_PENDING', label: 'Quotation / fare pending', phase: 'Enquiry',
    action: 'Send the quotation', description: 'The fare is worked out; the quotation has not gone to the customer yet.' },
  { key: 'AWAITING_CONFIRMATION', label: 'Awaiting customer confirmation', phase: 'Enquiry',
    action: 'Follow up', description: 'Quotation sent; waiting for the customer to accept.' },
  { key: 'AWAITING_ASSIGNMENT', label: 'Awaiting vehicle / driver', phase: 'Booking',
    action: 'Allot a vehicle and driver', description: 'Confirmed, but no vehicle or driver is allotted.' },
  { key: 'UPCOMING', label: 'Upcoming trips', phase: 'Booking',
    action: 'Start the trip on the day', description: 'Allotted and ready; the journey has not started.' },
  { key: 'IN_PROGRESS', label: 'Trips in progress', phase: 'Booking',
    action: 'Complete the trip', description: 'The journey is under way.' },
  { key: 'AWAITING_BILLING', label: 'Completed — awaiting billing', phase: 'Billing',
    action: 'Check the charges and confirm billing', description: 'Finished; the final charges have not been confirmed for billing.' },
  { key: 'BILLING_IN_PROGRESS', label: 'Billing in progress', phase: 'Billing',
    action: 'Finish the billing batch', description: 'In a billing batch that is still a draft or waiting for approval.' },
  { key: 'AWAITING_INVOICE', label: 'Billed — awaiting invoice', phase: 'Billing',
    action: 'Raise the invoice', description: 'Billing confirmed; no invoice has been raised.' },
  { key: 'BILLED', label: 'Invoice generated', phase: 'Billing',
    action: 'Track payment', description: 'On a live invoice; payment is pending or part-paid.' },
  { key: 'CANCELLED', label: 'Cancelled trips', phase: 'Closed',
    action: '—', description: 'Cancelled or no-show.' },
  { key: 'SETTLED', label: 'Completed & settled', phase: 'Closed',
    action: '—', description: 'Invoiced and fully paid.' },
  { key: 'DRAFT', label: 'Drafts', phase: 'Closed',
    action: 'Finish the booking', description: 'Saved as a draft booking.' },
];

/**
 * The stage as a SQL expression. Needs, in scope:
 *   b  = bookings, c = booking_charges (LEFT JOIN), i = the live invoice (LEFT JOIN, NULL if none)
 */
export const STAGE_SQL = `
  CASE
    WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 'CANCELLED'
    WHEN i.id IS NOT NULL AND (i.status = 'PAID' OR (COALESCE(i.outstanding_amount,0) <= 0.005 AND i.total_amount > 0)) THEN 'SETTLED'
    WHEN i.id IS NOT NULL OR b.billing_status = 'INVOICED' THEN 'BILLED'
    WHEN b.booking_status = 'COMPLETED' AND EXISTS (
         SELECT 1 FROM billing_batch_items bbi JOIN billing_batches bbt ON bbt.id = bbi.batch_id
          WHERE bbi.booking_id = b.id AND bbt.status IN ('DRAFT','PENDING_APPROVAL','APPROVED')) THEN 'BILLING_IN_PROGRESS'
    WHEN b.booking_status = 'COMPLETED' AND b.billing_confirmed_at IS NOT NULL THEN 'AWAITING_INVOICE'
    WHEN b.booking_status = 'COMPLETED' THEN 'AWAITING_BILLING'
    WHEN b.booking_status = 'ONTRIP' THEN 'IN_PROGRESS'
    WHEN b.booking_status = 'ASSIGNED' THEN 'UPCOMING'
    WHEN b.booking_status = 'CONFIRMED' THEN 'AWAITING_ASSIGNMENT'
    WHEN b.booking_status = 'INQUIRY' AND b.quote_status = 'SENT' THEN 'AWAITING_CONFIRMATION'
    WHEN b.booking_status = 'INQUIRY' AND COALESCE(c.total_amount,0) > 0 THEN 'QUOTE_PENDING'
    WHEN b.booking_status = 'INQUIRY' AND b.owner_user_id IS NOT NULL THEN 'ASSIGNED_TO_STAFF'
    WHEN b.booking_status = 'INQUIRY' THEN 'NEW'
    ELSE 'DRAFT'
  END`;

/** Joins that give STAGE_SQL its aliases. `i` is at most one live invoice per booking. */
export const STAGE_JOINS = `
  LEFT JOIN booking_charges c ON c.booking_id = b.id
  LEFT JOIN invoices i ON i.id = (
    SELECT ii.invoice_id FROM invoice_items ii JOIN invoices iv ON iv.id = ii.invoice_id
     WHERE ii.booking_id = b.id AND iv.status <> 'CANCELLED' ORDER BY ii.invoice_id DESC LIMIT 1)`;

/** Stages that together make up "Confirmed trips". */
export const CONFIRMED_STAGES: TripStage[] = ['AWAITING_ASSIGNMENT', 'UPCOMING', 'IN_PROGRESS'];

/**
 * What is missing from a trip — used to flag incomplete records on the list
 * and in the trip drawer. Deterministic rules, no guessing.
 */
export function missingDetails(b: any): string[] {
  const missing: string[] = [];
  const active = !['CANCELLED', 'NO_SHOW'].includes(b.booking_status);
  if (!active) return missing;
  if (!b.customer_mobile && !b.passenger_mobile) missing.push('mobile number');
  if (!b.pickup_location) missing.push('pickup');
  if (!b.drop_location && b.trip_type !== 'LOCAL' && b.trip_type !== 'PACKAGE') missing.push('drop');
  if (!b.reporting_time) missing.push('pickup time');
  if (!b.vehicle_type && !b.vehicle_category_id) missing.push('vehicle type');
  if (['ASSIGNED', 'ONTRIP', 'COMPLETED'].includes(b.booking_status) && !(Number(b.total_amount) > 0)) {
    missing.push('fare');
  }
  if (['ASSIGNED', 'ONTRIP', 'COMPLETED'].includes(b.booking_status)) {
    if (!b.vehicle_number) missing.push('vehicle number');
    if (!b.driver_name) missing.push('driver');
  }
  if (!b.customer_email && !b.passenger_email && b.inquiry_source !== 'VENDOR') missing.push('email');
  return missing;
}

/** A one-paragraph plain-English summary of a trip, built from its fields. */
export function tripSummary(b: any): string {
  const who = b.customer_name || b.passenger_name || 'A customer';
  const route = [b.pickup_location, b.drop_location].filter(Boolean).join(' to ') || 'a route not yet given';
  const when = b.travel_date ? `on ${b.travel_date}${b.reporting_time ? ` at ${b.reporting_time}` : ''}` : 'on a date not yet given';
  const car = b.vehicle_type ? `, ${b.vehicle_type}` : '';
  const pax = b.pax_count ? ` for ${b.pax_count} passenger${Number(b.pax_count) === 1 ? '' : 's'}` : '';
  const fare = Number(b.total_amount) > 0 ? ` Fare ₹${Number(b.total_amount).toLocaleString('en-IN')}.` : ' No fare yet.';
  const allot = b.vehicle_number || b.driver_name
    ? ` Allotted ${[b.vehicle_number, b.driver_name].filter(Boolean).join(' with ')}.` : '';
  return `${who} — ${String(b.trip_type ?? 'trip').toLowerCase().replace(/_/g, ' ')} from ${route} ${when}${car}${pax}.${fare}${allot}`;
}
