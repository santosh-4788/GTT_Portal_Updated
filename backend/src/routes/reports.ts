/**
 * Reports — every figure computed from the transaction tables, nothing stored.
 *
 * Each report declares the filters it understands, its columns (with the kind
 * of value, so the screen and the Excel export format them the same way), the
 * columns that carry a total, where a row drills down to, and an optional
 * chart. The screen, the export and the totals all run the same SQL with the
 * same parameters, so they cannot disagree.
 *
 * Definitions that mirror another module use that module's rules: "billable"
 * is the Billing screen's definition, "outstanding" the Invoices screen's,
 * reversed payments never count, and receivables and supplier payables are
 * never added together.
 */
import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { sendTable, filterNote, type ExportColumn } from '../utils/exportSheet';
import { STAGE_SQL, STAGE_JOINS, STAGES } from '../services/tripStages';
import { receivablesLedger, payablesLedger } from '../services/ledger';

const router = Router();
router.use(requireAuth);

type Filter = 'from' | 'to' | 'vendorId' | 'source' | 'status' | 'paymentStatus' | 'vehicleId' | 'driverId' | 'tripType';

interface ReportDef {
  title: string;
  group: 'Operations' | 'Finance' | 'Fleet';
  description: string;
  /** What the date range applies to, shown next to the filter. */
  dateBasis: string;
  filters: Filter[];
  sql: string;
  columns: ExportColumn[];
  totals?: string[];
  /** Drill-down: which column holds the id, and where it opens. */
  link?: { idKey: string; to: 'trip' | 'invoice' | 'vendor' | 'vehicle' | 'driver' };
  chart?: { type: 'bar' | 'line'; x: string; series: { key: string; label: string }[] };
  /** Rows a report adds after the query, e.g. derived percentages. */
  post?: (rows: any[], params: any) => any[];
}

const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));
const SOURCE_LABEL: Record<string, string> = {
  EMAIL: 'Email enquiry', WHATSAPP: 'WhatsApp enquiry', PORTAL: 'Customer portal', WALKIN: 'Walk-in / phone', VENDOR: 'Vendor booking',
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const daysInRange = (from: string, to: string) => {
  if (!from || !to) return 0;
  return Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000) + 1);
};

/** Common trip filters as SQL, against alias b. */
const TRIP_FILTERS = `
  AND (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
  AND (@vendorId = 0 OR b.vendor_id = @vendorId)
  AND (@source = '' OR b.inquiry_source = @source)
  AND (@status = '' OR b.booking_status = @status)
  AND (@tripType = '' OR b.trip_type = @tripType)
  AND (@vehicleId = 0 OR b.vehicle_id = @vehicleId)
  AND (@driverId = 0 OR b.driver_id = @driverId)`;

const LIVE_TRIP = `b.booking_status NOT IN ('CANCELLED','NO_SHOW','DRAFT','INQUIRY')`;

const INVOICE_STATUS = `CASE
    WHEN i.status IN ('CANCELLED','PAID') THEN i.status
    WHEN i.outstanding_amount > 0.009 AND i.due_date < date('now','localtime') THEN 'OVERDUE'
    ELSE i.status END`;

const INVOICE_FILTERS = `
  AND (@from = '' OR i.invoice_date >= @from) AND (@to = '' OR i.invoice_date <= @to)
  AND (@vendorId = 0 OR i.vendor_id = @vendorId)
  -- Cancelled invoices only appear when asked for, so no total ever includes them.
  AND (i.status <> 'CANCELLED' OR @paymentStatus IN ('CANCELLED','ALL'))
  AND (@paymentStatus IN ('', 'ALL') OR (${INVOICE_STATUS}) = @paymentStatus
       OR (@paymentStatus = 'UNPAID' AND i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009))`;

const REPORTS: Record<string, ReportDef> = {
  /* ------------------------------------------------------------ operations */
  'trip-register': {
    title: 'Trip register', group: 'Operations', dateBasis: 'Travel date',
    description: 'Every trip with its stage, customer, journey, allotment, fare and invoice.',
    filters: ['from', 'to', 'vendorId', 'source', 'status', 'tripType', 'vehicleId', 'driverId'],
    sql: `SELECT b.id, b.trip_id, b.booking_code, b.inquiry_source, (${STAGE_SQL}) AS stage, b.booking_status,
                 b.travel_date, b.reporting_time, b.trip_type, COALESCE(b.customer_name, b.passenger_name) AS customer,
                 COALESCE(NULLIF(b.customer_mobile,''), b.passenger_mobile) AS mobile, v.vendor_name,
                 b.pickup_location, b.drop_location, COALESCE(vc.name, b.vehicle_type) AS vehicle_category,
                 b.vehicle_number, b.driver_name, c.total_amount, i.invoice_number
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id ${STAGE_JOINS}
            LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
           WHERE b.trip_id IS NOT NULL ${TRIP_FILTERS}
           ORDER BY b.travel_date DESC, b.id DESC`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'inquiry_source', header: 'Source', value: (r) => SOURCE_LABEL[r.inquiry_source] ?? r.inquiry_source },
      { key: 'stage', header: 'Stage', value: (r) => STAGE_LABEL[r.stage] ?? r.stage }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'reporting_time', header: 'Time' }, { key: 'trip_type', header: 'Trip type' }, { key: 'customer', header: 'Customer' },
      { key: 'mobile', header: 'Mobile', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'pickup_location', header: 'Pickup', width: 30 }, { key: 'drop_location', header: 'Drop', width: 30 },
      { key: 'vehicle_category', header: 'Vehicle' }, { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' },
      { key: 'driver_name', header: 'Driver' }, { key: 'total_amount', header: 'Fare', kind: 'money' },
      { key: 'invoice_number', header: 'Invoice', kind: 'id' },
    ],
    totals: ['total_amount'], link: { idKey: 'id', to: 'trip' },
  },
  'date-wise-trips': {
    title: 'Date-wise trips', group: 'Operations', dateBasis: 'Travel date',
    description: 'Trips per travel day: how many, how far along, and their value.',
    filters: ['from', 'to', 'vendorId', 'source'],
    sql: `SELECT b.travel_date, COUNT(*) AS trips,
                 SUM(CASE WHEN b.booking_status IN ('CONFIRMED','ASSIGNED','ONTRIP') THEN 1 ELSE 0 END) AS open_trips,
                 SUM(CASE WHEN b.booking_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS cancelled,
                 SUM(CASE WHEN b.booking_status NOT IN ('CANCELLED','NO_SHOW') AND COALESCE(b.vehicle_number,'') = '' THEN 1 ELSE 0 END) AS unallotted,
                 COALESCE(SUM(CASE WHEN ${LIVE_TRIP} THEN c.total_amount END),0) AS value
            FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.trip_id IS NOT NULL AND b.booking_status NOT IN ('INQUIRY','DRAFT')
             AND (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
             AND (@vendorId = 0 OR b.vendor_id = @vendorId) AND (@source = '' OR b.inquiry_source = @source)
           GROUP BY b.travel_date ORDER BY b.travel_date DESC`,
    columns: [
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'trips', header: 'Trips', kind: 'number' },
      { key: 'open_trips', header: 'Open', kind: 'number' }, { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'cancelled', header: 'Cancelled', kind: 'number' }, { key: 'unallotted', header: 'No vehicle', kind: 'number' },
      { key: 'value', header: 'Value', kind: 'money' },
    ],
    totals: ['trips', 'open_trips', 'completed', 'cancelled', 'unallotted', 'value'],
    chart: { type: 'bar', x: 'travel_date', series: [{ key: 'trips', label: 'Trips' }] },
  },
  'pending-work': {
    title: 'Pending allocation, completion & billing', group: 'Operations', dateBasis: 'Travel date',
    description: 'Every trip waiting on the office: no vehicle yet, not completed after the travel day, billing not confirmed, or not invoiced.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT * FROM (
            SELECT b.id, b.trip_id, b.travel_date, b.reporting_time, v.vendor_name, b.vendor_booking_ref,
                   COALESCE(b.passenger_name, b.customer_name) AS passenger, b.pickup_location,
                   b.vehicle_number, b.driver_name, c.total_amount,
                   CASE WHEN (${STAGE_SQL}) = 'AWAITING_ASSIGNMENT' THEN 'Allocate a vehicle and driver'
                        WHEN b.booking_status IN ('ASSIGNED','ONTRIP') AND COALESCE(b.travel_date_to, b.travel_date) < date('now','localtime') THEN 'Complete the trip'
                        WHEN (${STAGE_SQL}) = 'AWAITING_BILLING' THEN 'Confirm billing'
                        WHEN (${STAGE_SQL}) = 'BILLING_IN_PROGRESS' THEN 'Finish the billing batch'
                        WHEN (${STAGE_SQL}) = 'AWAITING_INVOICE' THEN 'Raise the invoice' END AS pending
              FROM bookings b JOIN vendors v ON v.id = b.vendor_id ${STAGE_JOINS}
             WHERE b.trip_id IS NOT NULL
               AND (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
               AND (@vendorId = 0 OR b.vendor_id = @vendorId)) x
           WHERE pending IS NOT NULL ORDER BY travel_date, reporting_time`,
    columns: [
      { key: 'pending', header: 'Waiting for' }, { key: 'trip_id', header: 'Trip ID', kind: 'id' },
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'reporting_time', header: 'Time' },
      { key: 'vendor_name', header: 'Company' }, { key: 'vendor_booking_ref', header: 'Company ref', kind: 'id' },
      { key: 'passenger', header: 'Passenger' }, { key: 'pickup_location', header: 'Pickup', width: 28 },
      { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' }, { key: 'driver_name', header: 'Driver' },
      { key: 'total_amount', header: 'Fare', kind: 'money' },
    ],
    totals: ['total_amount'], link: { idKey: 'id', to: 'trip' },
  },
  'event-summary': {
    title: 'Event-wise report', group: 'Operations', dateBasis: 'Event start date',
    description: 'Each event: vehicles required and allotted, trips completed, billed, received and outstanding.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT e.id, e.event_code, e.name, v.vendor_name, e.start_date, e.status, e.agreed_amount,
                 (SELECT COALESCE(SUM(r.vehicle_count),0) FROM event_requirements r WHERE r.event_id = e.id AND r.status <> 'CANCELLED') AS vehicles_required,
                 (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.booking_status NOT IN ('CANCELLED','NO_SHOW')) AS trips,
                 (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.booking_status NOT IN ('CANCELLED','NO_SHOW')
                    AND COALESCE(b.vehicle_number,'') <> '') AS allotted,
                 (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.booking_status = 'COMPLETED') AS completed,
                 (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
                   WHERE b.event_id = e.id AND b.booking_status NOT IN ('CANCELLED','NO_SHOW')) AS trip_value,
                 (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.status <> 'CANCELLED' AND i.id IN
                   (SELECT ii.invoice_id FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id WHERE b.event_id = e.id)) AS billed,
                 (SELECT COALESCE(SUM(i.total_amount - i.outstanding_amount),0) FROM invoices i WHERE i.status <> 'CANCELLED' AND i.id IN
                   (SELECT ii.invoice_id FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id WHERE b.event_id = e.id)) AS received,
                 (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.status <> 'CANCELLED' AND i.id IN
                   (SELECT ii.invoice_id FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id WHERE b.event_id = e.id)) AS outstanding
            FROM events e JOIN vendors v ON v.id = e.vendor_id
           WHERE (@from = '' OR e.start_date >= @from) AND (@to = '' OR e.start_date <= @to)
             AND (@vendorId = 0 OR e.vendor_id = @vendorId)
           ORDER BY e.start_date DESC`,
    columns: [
      { key: 'event_code', header: 'Event', kind: 'id' }, { key: 'name', header: 'Name' }, { key: 'vendor_name', header: 'Billed to' },
      { key: 'start_date', header: 'Starts', kind: 'date' }, { key: 'status', header: 'Status' },
      { key: 'vehicles_required', header: 'Vehicles required', kind: 'number' }, { key: 'trips', header: 'Trips', kind: 'number' },
      { key: 'allotted', header: 'Allotted', kind: 'number' }, { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'agreed_amount', header: 'Agreed', kind: 'money' }, { key: 'trip_value', header: 'Trip value', kind: 'money' },
      { key: 'billed', header: 'Billed', kind: 'money' }, { key: 'received', header: 'Received', kind: 'money' },
      { key: 'outstanding', header: 'Outstanding', kind: 'money' },
    ],
    totals: ['vehicles_required', 'trips', 'allotted', 'completed', 'agreed_amount', 'trip_value', 'billed', 'received', 'outstanding'],
  },
  'daily-bookings': {
    title: 'Booking register', group: 'Operations', dateBasis: 'Travel date',
    description: 'Bookings with passenger, route, vehicle, amount and billing status.',
    filters: ['from', 'to', 'vendorId', 'status'],
    sql: `SELECT b.id, b.travel_date, b.booking_code, b.trip_id, v.vendor_name, b.vendor_booking_ref, b.passenger_name, b.passenger_mobile,
                 b.pickup_location, b.drop_location, b.vehicle_type, b.vehicle_number,
                 c.total_amount, b.booking_status, b.billing_status
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.booking_status <> 'INQUIRY' ${TRIP_FILTERS}
           ORDER BY b.travel_date DESC, b.id DESC`,
    columns: [
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'booking_code', header: 'Booking ID', kind: 'id' },
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'vendor_booking_ref', header: 'Vendor ref', kind: 'id' }, { key: 'passenger_name', header: 'Passenger' },
      { key: 'passenger_mobile', header: 'Mobile', kind: 'id' }, { key: 'pickup_location', header: 'Pickup', width: 30 },
      { key: 'drop_location', header: 'Drop', width: 30 }, { key: 'vehicle_type', header: 'Vehicle' },
      { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' }, { key: 'total_amount', header: 'Amount', kind: 'money' },
      { key: 'booking_status', header: 'Booking' }, { key: 'billing_status', header: 'Billing' },
    ],
    totals: ['total_amount'], link: { idKey: 'id', to: 'trip' },
  },
  enquiries: {
    title: 'Customer enquiry report', group: 'Operations', dateBasis: 'Date received',
    description: 'Enquiries received from customers, where each one has got to, and why lost ones were lost.',
    filters: ['from', 'to', 'source', 'status'],
    sql: `SELECT b.id, b.trip_id, b.created_at, b.inquiry_source, COALESCE(b.customer_name, b.passenger_name) AS customer,
                 COALESCE(NULLIF(b.customer_mobile,''), b.passenger_mobile) AS mobile, b.customer_email,
                 b.pickup_location, b.drop_location, b.travel_date, b.vehicle_type, ow.full_name AS owner,
                 (${STAGE_SQL}) AS stage, b.quote_status, b.quote_amount,
                 CASE WHEN b.booking_status NOT IN ('INQUIRY','CANCELLED','NO_SHOW','DRAFT') THEN 'Yes' ELSE 'No' END AS converted,
                 mv.label AS cancel_reason, c.total_amount
            FROM bookings b ${STAGE_JOINS}
            LEFT JOIN users ow ON ow.id = b.owner_user_id
            LEFT JOIN master_values mv ON mv.list_type = 'CANCELLATION_REASON' AND mv.code = b.cancel_reason
           WHERE b.trip_id IS NOT NULL AND b.inquiry_source <> 'VENDOR'
             AND (@from = '' OR date(b.created_at) >= @from) AND (@to = '' OR date(b.created_at) <= @to)
             AND (@source = '' OR b.inquiry_source = @source) AND (@status = '' OR b.booking_status = @status)
           ORDER BY b.created_at DESC`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'created_at', header: 'Received', kind: 'datetime' },
      { key: 'inquiry_source', header: 'Source', value: (r) => SOURCE_LABEL[r.inquiry_source] ?? r.inquiry_source },
      { key: 'customer', header: 'Customer' }, { key: 'mobile', header: 'Mobile', kind: 'id' },
      { key: 'customer_email', header: 'Email' }, { key: 'pickup_location', header: 'Pickup', width: 28 },
      { key: 'drop_location', header: 'Drop', width: 28 }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'vehicle_type', header: 'Vehicle' }, { key: 'owner', header: 'Handled by' },
      { key: 'stage', header: 'Stage', value: (r) => STAGE_LABEL[r.stage] ?? r.stage }, { key: 'quote_status', header: 'Quotation' },
      { key: 'converted', header: 'Converted' }, { key: 'cancel_reason', header: 'Lost because' },
      { key: 'total_amount', header: 'Fare', kind: 'money' },
    ],
    totals: ['total_amount'], link: { idKey: 'id', to: 'trip' },
  },
  'source-wise': {
    title: 'Trip source-wise report', group: 'Operations', dateBasis: 'Date received',
    description: 'Enquiries and bookings by channel, with conversion and cancellation rates and the revenue each channel brought.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT b.inquiry_source AS source, COUNT(*) AS received,
                 SUM(CASE WHEN b.booking_status NOT IN ('INQUIRY','CANCELLED','NO_SHOW','DRAFT') THEN 1 ELSE 0 END) AS converted,
                 SUM(CASE WHEN b.booking_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS cancelled,
                 SUM(CASE WHEN b.booking_status = 'INQUIRY' THEN 1 ELSE 0 END) AS open_enquiries,
                 COALESCE(SUM(CASE WHEN ${LIVE_TRIP} THEN c.total_amount END),0) AS revenue
            FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.trip_id IS NOT NULL
             AND (@from = '' OR date(b.created_at) >= @from) AND (@to = '' OR date(b.created_at) <= @to)
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
           GROUP BY b.inquiry_source ORDER BY received DESC`,
    columns: [
      { key: 'source', header: 'Source', value: (r) => SOURCE_LABEL[r.source] ?? r.source },
      { key: 'received', header: 'Received', kind: 'number' }, { key: 'converted', header: 'Converted', kind: 'number' },
      { key: 'conversion_rate', header: 'Conversion %', kind: 'percent' }, { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'cancelled', header: 'Cancelled', kind: 'number' }, { key: 'cancellation_rate', header: 'Cancellation %', kind: 'percent' },
      { key: 'open_enquiries', header: 'Open enquiries', kind: 'number' }, { key: 'revenue', header: 'Revenue', kind: 'money' },
    ],
    totals: ['received', 'converted', 'completed', 'cancelled', 'open_enquiries', 'revenue'],
    post: (rows) => rows.map((r) => ({ ...r, conversion_rate: pct(r.converted, r.received), cancellation_rate: pct(r.cancelled, r.received) })),
    chart: { type: 'bar', x: 'source', series: [{ key: 'received', label: 'Received' }, { key: 'converted', label: 'Converted' }] },
  },
  'vendor-bookings': {
    title: 'Vendor-wise trip report', group: 'Operations', dateBasis: 'Travel date',
    description: 'Trips per vendor, with completions, cancellations and the value billed.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT v.id AS vendor_id, v.code AS vendor_code, v.vendor_name, COUNT(b.id) AS bookings,
                 SUM(CASE WHEN b.booking_status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
                 SUM(CASE WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS cancelled,
                 COALESCE(SUM(CASE WHEN ${LIVE_TRIP} THEN c.taxable_amount END),0) AS taxable,
                 COALESCE(SUM(CASE WHEN ${LIVE_TRIP} THEN c.tax_amount END),0) AS tax,
                 COALESCE(SUM(CASE WHEN ${LIVE_TRIP} THEN c.total_amount END),0) AS total
            FROM vendors v
            LEFT JOIN bookings b ON b.vendor_id = v.id AND b.booking_status NOT IN ('INQUIRY','DRAFT')
              AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE (@vendorId = 0 OR v.id = @vendorId)
           GROUP BY v.id HAVING bookings > 0 ORDER BY total DESC`,
    columns: [
      { key: 'vendor_code', header: 'Code', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'bookings', header: 'Trips', kind: 'number' }, { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'cancelled', header: 'Cancelled', kind: 'number' }, { key: 'taxable', header: 'Taxable', kind: 'money' },
      { key: 'tax', header: 'Tax', kind: 'money' }, { key: 'total', header: 'Total', kind: 'money' },
    ],
    totals: ['bookings', 'completed', 'cancelled', 'taxable', 'tax', 'total'], link: { idKey: 'vendor_id', to: 'vendor' },
    chart: { type: 'bar', x: 'vendor_name', series: [{ key: 'total', label: 'Total' }] },
  },
  'cancelled-bookings': {
    title: 'Cancellation report', group: 'Operations', dateBasis: 'Travel date',
    description: 'Cancelled and no-show trips with the reason recorded.',
    filters: ['from', 'to', 'vendorId', 'source'],
    sql: `SELECT b.id, b.trip_id, b.booking_code, b.travel_date, v.vendor_name, b.inquiry_source,
                 COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location,
                 b.booking_status, COALESCE(mv.label, b.cancel_reason) AS reason, b.remarks, COALESCE(b.cancelled_at, b.updated_at) AS cancelled_on
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN master_values mv ON mv.list_type = 'CANCELLATION_REASON' AND mv.code = b.cancel_reason
           WHERE b.booking_status IN ('CANCELLED','NO_SHOW')
             AND (@vendorId = 0 OR b.vendor_id = @vendorId) AND (@source = '' OR b.inquiry_source = @source)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY b.travel_date DESC`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'booking_code', header: 'Booking ID', kind: 'id' },
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'inquiry_source', header: 'Source', value: (r) => SOURCE_LABEL[r.inquiry_source] ?? r.inquiry_source },
      { key: 'customer', header: 'Customer' }, { key: 'pickup_location', header: 'Pickup', width: 28 },
      { key: 'drop_location', header: 'Drop', width: 28 }, { key: 'booking_status', header: 'Status' },
      { key: 'reason', header: 'Reason' }, { key: 'remarks', header: 'Remarks', width: 30 },
      { key: 'cancelled_on', header: 'Cancelled on', kind: 'datetime' },
    ],
    link: { idKey: 'id', to: 'trip' },
  },
  'monthly-summary': {
    title: 'Monthly business summary', group: 'Operations', dateBasis: 'Month',
    description: 'Month by month: enquiries, trips run, cancellations, value of trips, invoices raised, money collected.',
    filters: ['from', 'to', 'vendorId'],
    sql: `WITH months AS (
            SELECT strftime('%Y-%m', travel_date) AS m FROM bookings WHERE travel_date IS NOT NULL
            UNION SELECT strftime('%Y-%m', invoice_date) FROM invoices
            UNION SELECT strftime('%Y-%m', payment_date) FROM payments)
          SELECT m AS month,
            (SELECT COUNT(*) FROM bookings b WHERE strftime('%Y-%m', b.created_at) = m AND b.inquiry_source <> 'VENDOR'
               AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS enquiries,
            (SELECT COUNT(*) FROM bookings b WHERE strftime('%Y-%m', b.travel_date) = m AND ${LIVE_TRIP}
               AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS trips,
            (SELECT COUNT(*) FROM bookings b WHERE strftime('%Y-%m', b.travel_date) = m AND b.booking_status = 'COMPLETED'
               AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS completed,
            (SELECT COUNT(*) FROM bookings b WHERE strftime('%Y-%m', b.travel_date) = m AND b.booking_status IN ('CANCELLED','NO_SHOW')
               AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS cancelled,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
              WHERE strftime('%Y-%m', b.travel_date) = m AND ${LIVE_TRIP} AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS trip_value,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m
               AND i.status <> 'CANCELLED' AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS invoiced,
            (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE strftime('%Y-%m', p.payment_date) = m
               AND p.is_reversed = 0 AND (@vendorId = 0 OR p.vendor_id = @vendorId)) AS collected
          FROM months WHERE m IS NOT NULL
            AND (@from = '' OR m >= substr(@from, 1, 7)) AND (@to = '' OR m <= substr(@to, 1, 7))
          ORDER BY m DESC`,
    columns: [
      { key: 'month', header: 'Month', kind: 'id' }, { key: 'enquiries', header: 'Enquiries', kind: 'number' },
      { key: 'trips', header: 'Trips', kind: 'number' }, { key: 'completed', header: 'Completed', kind: 'number' },
      { key: 'cancelled', header: 'Cancelled', kind: 'number' }, { key: 'trip_value', header: 'Trip value', kind: 'money' },
      { key: 'invoiced', header: 'Invoiced', kind: 'money' }, { key: 'collected', header: 'Collected', kind: 'money' },
    ],
    totals: ['enquiries', 'trips', 'completed', 'cancelled', 'trip_value', 'invoiced', 'collected'],
    chart: { type: 'line', x: 'month', series: [{ key: 'invoiced', label: 'Invoiced' }, { key: 'collected', label: 'Collected' }] },
  },

  /* --------------------------------------------------------------- finance */
  invoices: {
    title: 'Invoice register', group: 'Finance', dateBasis: 'Invoice date',
    description: 'Every invoice with its tax split, what has been received and what is outstanding.',
    filters: ['from', 'to', 'vendorId', 'paymentStatus'],
    sql: `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, v.vendor_name, COALESCE(i.bill_to_name, v.vendor_name) AS billed_to,
                 i.booking_count, i.taxable_amount, i.cgst, i.sgst, i.igst, i.tax_amount, i.non_taxable_amount, i.total_amount,
                 i.paid_amount, i.outstanding_amount, (${INVOICE_STATUS}) AS status
            FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           WHERE 1 = 1 ${INVOICE_FILTERS}
           ORDER BY i.invoice_date DESC, i.id DESC`,
    columns: [
      { key: 'invoice_number', header: 'Invoice no.', kind: 'id' }, { key: 'invoice_date', header: 'Date', kind: 'date' },
      { key: 'due_date', header: 'Due', kind: 'date' }, { key: 'vendor_name', header: 'Vendor' }, { key: 'billed_to', header: 'Billed to' },
      { key: 'booking_count', header: 'Trips', kind: 'number' }, { key: 'taxable_amount', header: 'Taxable', kind: 'money' },
      { key: 'cgst', header: 'CGST', kind: 'money' }, { key: 'sgst', header: 'SGST', kind: 'money' }, { key: 'igst', header: 'IGST', kind: 'money' },
      { key: 'non_taxable_amount', header: 'Toll/parking/state tax', kind: 'money' }, { key: 'total_amount', header: 'Total', kind: 'money' },
      { key: 'paid_amount', header: 'Received', kind: 'money' }, { key: 'outstanding_amount', header: 'Outstanding', kind: 'money' },
      { key: 'status', header: 'Status' },
    ],
    totals: ['taxable_amount', 'cgst', 'sgst', 'igst', 'tax_amount', 'non_taxable_amount', 'total_amount', 'paid_amount', 'outstanding_amount'],
    link: { idKey: 'id', to: 'invoice' },
  },
  'invoice-ageing': {
    title: 'Invoice ageing report', group: 'Finance', dateBasis: 'Invoice date',
    description: 'Outstanding money by vendor, split by how long it has been owed.',
    filters: ['vendorId'],
    sql: `SELECT v.id AS vendor_id, v.vendor_name,
                 COALESCE(SUM(CASE WHEN julianday('now') - julianday(i.invoice_date) <= 30 THEN i.outstanding_amount END),0) AS d0_30,
                 COALESCE(SUM(CASE WHEN julianday('now') - julianday(i.invoice_date) > 30 AND julianday('now') - julianday(i.invoice_date) <= 60 THEN i.outstanding_amount END),0) AS d31_60,
                 COALESCE(SUM(CASE WHEN julianday('now') - julianday(i.invoice_date) > 60 AND julianday('now') - julianday(i.invoice_date) <= 90 THEN i.outstanding_amount END),0) AS d61_90,
                 COALESCE(SUM(CASE WHEN julianday('now') - julianday(i.invoice_date) > 90 THEN i.outstanding_amount END),0) AS d90_plus,
                 COALESCE(SUM(i.outstanding_amount),0) AS total_outstanding,
                 COALESCE(SUM(CASE WHEN i.due_date < date('now','localtime') THEN i.outstanding_amount END),0) AS overdue,
                 COUNT(i.id) AS invoices
            FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009 AND (@vendorId = 0 OR i.vendor_id = @vendorId)
           GROUP BY v.id ORDER BY total_outstanding DESC`,
    columns: [
      { key: 'vendor_name', header: 'Vendor' }, { key: 'invoices', header: 'Invoices', kind: 'number' },
      { key: 'd0_30', header: '0–30 days', kind: 'money' }, { key: 'd31_60', header: '31–60 days', kind: 'money' },
      { key: 'd61_90', header: '61–90 days', kind: 'money' }, { key: 'd90_plus', header: '90+ days', kind: 'money' },
      { key: 'total_outstanding', header: 'Outstanding', kind: 'money' }, { key: 'overdue', header: 'Past due date', kind: 'money' },
    ],
    totals: ['invoices', 'd0_30', 'd31_60', 'd61_90', 'd90_plus', 'total_outstanding', 'overdue'], link: { idKey: 'vendor_id', to: 'vendor' },
    chart: { type: 'bar', x: 'vendor_name', series: [{ key: 'd0_30', label: '0–30' }, { key: 'd31_60', label: '31–60' }, { key: 'd61_90', label: '61–90' }, { key: 'd90_plus', label: '90+' }] },
  },
  'vendor-billing': {
    title: 'Vendor-wise billing report', group: 'Finance', dateBasis: 'Invoice date',
    description: 'Invoiced, received and outstanding per vendor (receivables only).',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT v.id AS vendor_id, v.code AS vendor_code, v.vendor_name,
                 COUNT(i.id) AS invoices, COALESCE(SUM(i.taxable_amount),0) AS taxable,
                 COALESCE(SUM(i.tax_amount),0) AS tax, COALESCE(SUM(i.total_amount),0) AS total,
                 COALESCE(SUM(i.paid_amount),0) AS paid, COALESCE(SUM(CASE WHEN i.status <> 'PAID' THEN i.outstanding_amount END),0) AS outstanding
            FROM vendors v
            LEFT JOIN invoices i ON i.vendor_id = v.id AND i.status <> 'CANCELLED'
              AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
           WHERE (@vendorId = 0 OR v.id = @vendorId)
           GROUP BY v.id HAVING invoices > 0 ORDER BY outstanding DESC`,
    columns: [
      { key: 'vendor_code', header: 'Code', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'invoices', header: 'Invoices', kind: 'number' }, { key: 'taxable', header: 'Taxable', kind: 'money' },
      { key: 'tax', header: 'Tax', kind: 'money' }, { key: 'total', header: 'Total', kind: 'money' },
      { key: 'paid', header: 'Received', kind: 'money' }, { key: 'outstanding', header: 'Outstanding', kind: 'money' },
    ],
    totals: ['invoices', 'taxable', 'tax', 'total', 'paid', 'outstanding'], link: { idKey: 'vendor_id', to: 'vendor' },
  },
  'vendor-outstanding': {
    title: 'Vendor-wise outstanding report', group: 'Finance', dateBasis: 'Invoice date',
    description: 'Each unpaid invoice, oldest first, with how long it has been due.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT i.id, v.code AS vendor_code, v.vendor_name, i.invoice_number, i.invoice_date, i.due_date,
                 i.total_amount, i.paid_amount, i.outstanding_amount,
                 CAST(julianday('now') - julianday(i.invoice_date) AS INTEGER) AS age_days,
                 CASE WHEN i.due_date < date('now','localtime') THEN CAST(julianday('now','localtime') - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
                 (${INVOICE_STATUS}) AS status
            FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009
             AND (@vendorId = 0 OR v.id = @vendorId)
             AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
           ORDER BY age_days DESC`,
    columns: [
      { key: 'vendor_name', header: 'Vendor' }, { key: 'invoice_number', header: 'Invoice no.', kind: 'id' },
      { key: 'invoice_date', header: 'Date', kind: 'date' }, { key: 'due_date', header: 'Due', kind: 'date' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'paid_amount', header: 'Received', kind: 'money' },
      { key: 'outstanding_amount', header: 'Outstanding', kind: 'money' }, { key: 'age_days', header: 'Age (days)', kind: 'number' },
      { key: 'days_overdue', header: 'Days overdue', kind: 'number' }, { key: 'status', header: 'Status' },
    ],
    totals: ['total_amount', 'paid_amount', 'outstanding_amount'], link: { idKey: 'id', to: 'invoice' },
  },
  payments: {
    title: 'Payments received report', group: 'Finance', dateBasis: 'Payment date',
    description: 'Money received against invoices. Reversed payments are excluded.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT i.id, p.payment_date, i.invoice_number, v.vendor_name, COALESCE(i.bill_to_name, v.vendor_name) AS billed_to,
                 p.amount, p.mode, p.reference_no, p.bank, p.notes
            FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN vendors v ON v.id = p.vendor_id
           WHERE p.is_reversed = 0 AND (@vendorId = 0 OR p.vendor_id = @vendorId)
             AND (@from='' OR p.payment_date >= @from) AND (@to='' OR p.payment_date <= @to)
           ORDER BY p.payment_date DESC, p.id DESC`,
    columns: [
      { key: 'payment_date', header: 'Date', kind: 'date' }, { key: 'invoice_number', header: 'Invoice no.', kind: 'id' },
      { key: 'vendor_name', header: 'Vendor' }, { key: 'billed_to', header: 'Billed to' },
      { key: 'amount', header: 'Amount', kind: 'money' }, { key: 'mode', header: 'Method' },
      { key: 'reference_no', header: 'Reference', kind: 'id' }, { key: 'bank', header: 'Bank' }, { key: 'notes', header: 'Notes', width: 30 },
    ],
    totals: ['amount'], link: { idKey: 'id', to: 'invoice' },
  },
  // Payments & Ledger (rules in services/ledger.ts)
  'receivables-ledger': {
    title: 'Receivables ledger', group: 'Finance', dateBasis: 'Ledger date',
    description: 'Per company: opening balance (everything before the range, incl. earlier invoices), invoiced, received (incl. unallocated advances), adjusted and closing balance.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT 1 AS placeholder`,
    post: (_rows, p) => receivablesLedger(p.from, p.to, p.vendorId),
    columns: [
      { key: 'vendor_name', header: 'Company' }, { key: 'opening', header: 'Opening', kind: 'money' },
      { key: 'opening_entry', header: 'Opening entry in range', kind: 'money' },
      { key: 'invoiced', header: 'Invoiced', kind: 'money' }, { key: 'received', header: 'Received', kind: 'money' },
      { key: 'adjusted', header: 'Adjusted', kind: 'money' }, { key: 'closing', header: 'Closing', kind: 'money' },
      { key: 'unallocated_now', header: 'Unallocated now', kind: 'money' },
    ],
    totals: ['opening', 'opening_entry', 'invoiced', 'received', 'adjusted', 'closing', 'unallocated_now'],
    link: { idKey: 'id', to: 'vendor' },
  },
  'payment-reconciliation': {
    title: 'Payment reconciliation', group: 'Finance', dateBasis: 'Receipt date',
    description: 'Every receipt with how much is allocated to invoices and how much is still unallocated.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT x.*, CASE WHEN x.is_reversed = 1 THEN 'REVERSED' WHEN x.allocated_p <= 0 THEN 'UNALLOCATED'
                      WHEN x.allocated_p >= x.amount_p THEN 'ALLOCATED' ELSE 'PARTLY_ALLOCATED' END AS status,
                 x.allocated_p / 100.0 AS allocated,
                 CASE WHEN x.is_reversed = 1 THEN 0 ELSE (x.amount_p - x.allocated_p) / 100.0 END AS unallocated
            FROM (SELECT t.id, t.txn_code, t.txn_date, v.vendor_name, t.amount, CAST(ROUND(t.amount*100) AS INTEGER) AS amount_p,
                         t.mode, t.reference_no, t.is_reversed, t.remarks,
                         (SELECT COALESCE(SUM(CAST(ROUND(p.amount*100) AS INTEGER)),0) FROM payments p WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS allocated_p,
                         (SELECT group_concat(i.invoice_number, ', ') FROM payments p JOIN invoices i ON i.id = p.invoice_id
                           WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS invoices
                    FROM payment_transactions t LEFT JOIN vendors v ON v.id = t.vendor_id
                   WHERE t.direction = 'IN' AND (@vendorId = 0 OR t.vendor_id = @vendorId)
                     AND (@from = '' OR t.txn_date >= @from) AND (@to = '' OR t.txn_date <= @to)) x
           WHERE (@status = '' OR @status = CASE WHEN x.is_reversed = 1 THEN 'REVERSED' WHEN x.allocated_p <= 0 THEN 'UNALLOCATED'
                      WHEN x.allocated_p >= x.amount_p THEN 'ALLOCATED' ELSE 'PARTLY_ALLOCATED' END)
           ORDER BY x.txn_date DESC, x.id DESC`,
    columns: [
      { key: 'txn_date', header: 'Date', kind: 'date' }, { key: 'txn_code', header: 'Receipt', kind: 'id' },
      { key: 'vendor_name', header: 'Company' }, { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'allocated', header: 'Allocated', kind: 'money' }, { key: 'unallocated', header: 'Unallocated', kind: 'money' },
      { key: 'status', header: 'Status', value: (r) => ({ ALLOCATED: 'Fully allocated', PARTLY_ALLOCATED: 'Partly allocated', UNALLOCATED: 'Unallocated', REVERSED: 'Reversed' } as Record<string, string>)[r.status] ?? r.status },
      { key: 'mode', header: 'Method' }, { key: 'reference_no', header: 'Reference / UTR', kind: 'id' },
      { key: 'invoices', header: 'Invoices', width: 30 }, { key: 'remarks', header: 'Remarks', width: 30 },
    ],
    totals: ['amount', 'allocated', 'unallocated'],
  },
  'vendor-payables-ledger': {
    title: 'Vendor payables ledger', group: 'Finance', dateBasis: 'Travel / payout date',
    description: 'Per vehicle owner or partner: opening balance owed, supplier cost on trips in the range, paid out, and closing balance. Never netted with receivables.',
    filters: ['from', 'to'],
    sql: `SELECT 1 AS placeholder`,
    post: (_rows, p) => payablesLedger(p.from, p.to),
    columns: [
      { key: 'payee', header: 'Payee' }, { key: 'opening', header: 'Opening', kind: 'money' },
      { key: 'trips', header: 'Trips', kind: 'number' }, { key: 'payable', header: 'Payable in range', kind: 'money' },
      { key: 'paid', header: 'Paid in range', kind: 'money' }, { key: 'closing', header: 'Closing', kind: 'money' },
      { key: 'last_paid', header: 'Last paid', kind: 'date' },
    ],
    totals: ['opening', 'trips', 'payable', 'paid', 'closing'],
  },
  'revenue-collection': {
    title: 'Revenue and collection report', group: 'Finance', dateBasis: 'Month',
    description: 'Per month: what was invoiced, what was collected, and the collection rate.',
    filters: ['from', 'to', 'vendorId'],
    sql: `WITH months AS (SELECT strftime('%Y-%m', invoice_date) AS m FROM invoices UNION SELECT strftime('%Y-%m', payment_date) FROM payments)
          SELECT m AS month,
            (SELECT COUNT(*) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m AND i.status <> 'CANCELLED' AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS invoices,
            (SELECT COALESCE(SUM(i.taxable_amount),0) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m AND i.status <> 'CANCELLED' AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS taxable,
            (SELECT COALESCE(SUM(i.tax_amount),0) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m AND i.status <> 'CANCELLED' AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS tax,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m AND i.status <> 'CANCELLED' AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS invoiced,
            (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE strftime('%Y-%m', p.payment_date) = m AND p.is_reversed = 0 AND (@vendorId = 0 OR p.vendor_id = @vendorId)) AS collected,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE strftime('%Y-%m', i.invoice_date) = m AND i.status NOT IN ('CANCELLED','PAID') AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS still_outstanding
          FROM months WHERE m IS NOT NULL
            AND (@from = '' OR m >= substr(@from, 1, 7)) AND (@to = '' OR m <= substr(@to, 1, 7))
          ORDER BY m DESC`,
    columns: [
      { key: 'month', header: 'Month', kind: 'id' }, { key: 'invoices', header: 'Invoices', kind: 'number' },
      { key: 'taxable', header: 'Taxable', kind: 'money' }, { key: 'tax', header: 'GST', kind: 'money' },
      { key: 'invoiced', header: 'Invoiced', kind: 'money' }, { key: 'collected', header: 'Collected', kind: 'money' },
      { key: 'collection_rate', header: 'Collected %', kind: 'percent' },
      { key: 'still_outstanding', header: 'Still outstanding (from that month)', kind: 'money' },
    ],
    totals: ['invoices', 'taxable', 'tax', 'invoiced', 'collected', 'still_outstanding'],
    post: (rows) => rows.map((r) => ({ ...r, collection_rate: pct(r.collected, r.invoiced) })),
    chart: { type: 'bar', x: 'month', series: [{ key: 'invoiced', label: 'Invoiced' }, { key: 'collected', label: 'Collected' }] },
  },
  'pending-billing': {
    title: 'Pending billing report', group: 'Finance', dateBasis: 'Travel date',
    description: 'Trips that have run and are not yet invoiced — the Billing screen\'s queue.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT b.id, b.trip_id, b.booking_code, b.travel_date, v.vendor_name, b.passenger_name,
                 b.pickup_location, b.drop_location, c.total_amount, b.billing_status
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.billing_status IN ('PENDING','READY') AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY v.vendor_name, b.travel_date`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'booking_code', header: 'Booking ID', kind: 'id' },
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'passenger_name', header: 'Passenger' }, { key: 'pickup_location', header: 'Pickup', width: 30 },
      { key: 'drop_location', header: 'Drop', width: 30 }, { key: 'total_amount', header: 'Amount', kind: 'money' },
      { key: 'billing_status', header: 'Status' },
    ],
    totals: ['total_amount'], link: { idKey: 'id', to: 'trip' },
  },
  'monthly-billing': {
    title: 'Monthly billing report', group: 'Finance', dateBasis: 'Travel date',
    description: 'The value of trips run each month, split into taxable, GST and reimbursables.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT strftime('%Y-%m', b.travel_date) AS month, COUNT(b.id) AS bookings,
                 COALESCE(SUM(c.taxable_amount),0) AS taxable, COALESCE(SUM(c.tax_amount),0) AS tax,
                 COALESCE(SUM(c.non_taxable_amount),0) AS toll_parking,
                 COALESCE(SUM(c.total_amount),0) AS total
            FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE ${LIVE_TRIP}
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           GROUP BY month ORDER BY month DESC`,
    columns: [
      { key: 'month', header: 'Month', kind: 'id' }, { key: 'bookings', header: 'Trips', kind: 'number' },
      { key: 'taxable', header: 'Taxable', kind: 'money' }, { key: 'tax', header: 'Tax', kind: 'money' },
      { key: 'toll_parking', header: 'Toll/parking/state tax', kind: 'money' }, { key: 'total', header: 'Total', kind: 'money' },
    ],
    totals: ['bookings', 'taxable', 'tax', 'toll_parking', 'total'],
    chart: { type: 'bar', x: 'month', series: [{ key: 'total', label: 'Total' }] },
  },
  'supplier-settlement': {
    title: 'Vendor payment and settlement report', group: 'Finance', dateBasis: 'Travel / payment date',
    description: 'What is payable to vehicle owners and partners from trip costs, what has been paid, and the balance. Kept separate from receivables.',
    filters: ['from', 'to'],
    sql: `WITH owed AS (
            SELECT lower(trim(supplier_name)) AS k, MAX(supplier_name) AS payee, COUNT(*) AS trips, COALESCE(SUM(supplier_cost),0) AS payable
              FROM bookings b WHERE supplier_cost > 0 AND supplier_name IS NOT NULL AND ${LIVE_TRIP}
               AND (@from = '' OR travel_date >= @from) AND (@to = '' OR travel_date <= @to)
             GROUP BY 1),
          paid AS (
            SELECT lower(trim(payee_name)) AS k, MAX(payee_name) AS payee, COALESCE(SUM(amount),0) AS paid, MAX(payment_date) AS last_paid
              FROM supplier_payments WHERE is_reversed = 0
               AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)
             GROUP BY 1),
          keys AS (SELECT k FROM owed UNION SELECT k FROM paid)
          SELECT COALESCE(o.payee, p.payee) AS payee, COALESCE(o.trips, 0) AS trips, COALESCE(o.payable, 0) AS payable,
                 COALESCE(p.paid, 0) AS paid, COALESCE(o.payable, 0) - COALESCE(p.paid, 0) AS balance, p.last_paid
            FROM keys LEFT JOIN owed o ON o.k = keys.k LEFT JOIN paid p ON p.k = keys.k
           ORDER BY balance DESC`,
    columns: [
      { key: 'payee', header: 'Payee' }, { key: 'trips', header: 'Trips', kind: 'number' },
      { key: 'payable', header: 'Payable', kind: 'money' }, { key: 'paid', header: 'Paid', kind: 'money' },
      { key: 'balance', header: 'Balance due', kind: 'money' }, { key: 'last_paid', header: 'Last paid', kind: 'date' },
    ],
    totals: ['trips', 'payable', 'paid', 'balance'],
  },
  profitability: {
    title: 'Trip profitability report', group: 'Finance', dateBasis: 'Travel date',
    description: 'Trips that have a supplier cost recorded: what was billed (before GST and reimbursables) against what the trip cost. Trips without a cost are left out rather than guessed.',
    filters: ['from', 'to', 'vendorId', 'tripType'],
    sql: `SELECT b.id, b.trip_id, b.travel_date, b.trip_type, v.vendor_name, b.pickup_location, b.drop_location,
                 COALESCE(vc.name, b.vehicle_type) AS vehicle, b.supplier_name, c.taxable_amount AS billed_value,
                 b.supplier_cost, ROUND(COALESCE(c.taxable_amount,0) - COALESCE(b.supplier_cost,0), 2) AS margin
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN booking_charges c ON c.booking_id = b.id
            LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
           WHERE b.supplier_cost > 0 AND ${LIVE_TRIP}
             AND (@vendorId = 0 OR b.vendor_id = @vendorId) AND (@tripType = '' OR b.trip_type = @tripType)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY b.travel_date DESC`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'trip_type', header: 'Trip type' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'pickup_location', header: 'Pickup', width: 26 }, { key: 'drop_location', header: 'Drop', width: 26 },
      { key: 'vehicle', header: 'Vehicle' }, { key: 'supplier_name', header: 'Supplier' },
      { key: 'billed_value', header: 'Billed (taxable)', kind: 'money' }, { key: 'supplier_cost', header: 'Cost', kind: 'money' },
      { key: 'margin', header: 'Margin', kind: 'money' }, { key: 'margin_pct', header: 'Margin %', kind: 'percent' },
    ],
    totals: ['billed_value', 'supplier_cost', 'margin'],
    post: (rows) => rows.map((r) => ({ ...r, margin_pct: pct(r.margin, r.billed_value) })),
    link: { idKey: 'id', to: 'trip' },
  },

  /* ----------------------------------------------------------------- fleet */
  'vehicle-utilisation': {
    title: 'Vehicle utilisation report', group: 'Fleet', dateBasis: 'Travel date',
    description: 'Trips and days each fleet vehicle was out, and the value of those trips. Utilisation is days used ÷ days in the chosen period.',
    filters: ['from', 'to', 'vehicleId'],
    sql: `SELECT v.id AS vehicle_id, v.vehicle_number, COALESCE(vc.name, v.vehicle_type) AS category, v.ownership_type,
                 COUNT(b.id) AS trips, COUNT(DISTINCT b.travel_date) AS days_used,
                 COALESCE(SUM(b.trip_distance_km),0) AS km, COALESCE(SUM(c.taxable_amount),0) AS revenue,
                 MAX(b.travel_date) AS last_trip
            FROM vehicles v
            LEFT JOIN vehicle_categories vc ON vc.id = v.category_id
            LEFT JOIN bookings b ON (b.vehicle_id = v.id OR replace(upper(b.vehicle_number),' ','') = v.vehicle_number)
              AND ${LIVE_TRIP} AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE (@vehicleId = 0 OR v.id = @vehicleId) AND (v.is_active = 1 OR b.id IS NOT NULL)
           GROUP BY v.id ORDER BY trips DESC, v.vehicle_number`,
    columns: [
      { key: 'vehicle_number', header: 'Vehicle', kind: 'id' }, { key: 'category', header: 'Category' },
      { key: 'ownership_type', header: 'Ownership' }, { key: 'trips', header: 'Trips', kind: 'number' },
      { key: 'days_used', header: 'Days used', kind: 'number' }, { key: 'utilisation', header: 'Utilisation %', kind: 'percent' },
      { key: 'km', header: 'Km (where recorded)', kind: 'number' }, { key: 'revenue', header: 'Revenue (taxable)', kind: 'money' },
      { key: 'last_trip', header: 'Last trip', kind: 'date' },
    ],
    totals: ['trips', 'days_used', 'km', 'revenue'], link: { idKey: 'vehicle_id', to: 'vehicle' },
    post: (rows, params) => {
      const d = daysInRange(params.from, params.to);
      return rows.map((r) => ({ ...r, utilisation: d ? pct(r.days_used, d) : null }));
    },
    chart: { type: 'bar', x: 'vehicle_number', series: [{ key: 'trips', label: 'Trips' }] },
  },
  'driver-utilisation': {
    title: 'Driver utilisation report', group: 'Fleet', dateBasis: 'Travel date',
    description: 'Trips and days each driver worked, the value of those trips and their average customer rating.',
    filters: ['from', 'to', 'driverId'],
    sql: `SELECT d.id AS driver_id, d.full_name, d.mobile, COUNT(b.id) AS trips, COUNT(DISTINCT b.travel_date) AS days_worked,
                 COALESCE(SUM(c.taxable_amount),0) AS revenue, MAX(b.travel_date) AS last_trip,
                 (SELECT ROUND(AVG(f.driver_rating), 2) FROM trip_feedback f WHERE f.driver_id = d.id AND f.status = 'SUBMITTED') AS rating,
                 (SELECT COUNT(*) FROM trip_feedback f WHERE f.driver_id = d.id AND f.status = 'SUBMITTED') AS ratings
            FROM drivers d
            LEFT JOIN bookings b ON b.driver_id = d.id AND ${LIVE_TRIP}
              AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE (@driverId = 0 OR d.id = @driverId) AND (d.is_active = 1 OR b.id IS NOT NULL)
           GROUP BY d.id ORDER BY trips DESC, d.full_name`,
    columns: [
      { key: 'full_name', header: 'Driver' }, { key: 'mobile', header: 'Mobile', kind: 'id' },
      { key: 'trips', header: 'Trips', kind: 'number' }, { key: 'days_worked', header: 'Days worked', kind: 'number' },
      { key: 'utilisation', header: 'Utilisation %', kind: 'percent' }, { key: 'revenue', header: 'Revenue (taxable)', kind: 'money' },
      { key: 'rating', header: 'Avg rating', kind: 'number' }, { key: 'ratings', header: 'Ratings', kind: 'number' },
      { key: 'last_trip', header: 'Last trip', kind: 'date' },
    ],
    totals: ['trips', 'days_worked', 'revenue'], link: { idKey: 'driver_id', to: 'driver' },
    post: (rows, params) => {
      const d = daysInRange(params.from, params.to);
      return rows.map((r) => ({ ...r, utilisation: d ? pct(r.days_worked, d) : null }));
    },
  },
  'outstation-trips': {
    title: 'Outstation trip report', group: 'Fleet', dateBasis: 'Travel date',
    description: 'Outstation and round trips with the fare rule applied, the fare and — where recorded — the cost and margin.',
    filters: ['from', 'to', 'vendorId'],
    sql: `SELECT b.id, b.trip_id, b.travel_date, b.travel_date_to, b.trip_type, b.pickup_location, b.drop_location,
                 COALESCE(vc.name, b.vehicle_type) AS vehicle, b.vehicle_number, b.driver_name,
                 r.plan_label AS fare_rule, c.taxable_amount, c.non_taxable_amount, c.total_amount, b.supplier_cost,
                 CASE WHEN b.supplier_cost > 0 THEN ROUND(COALESCE(c.taxable_amount,0) - b.supplier_cost, 2) END AS margin,
                 b.booking_status
            FROM bookings b
            LEFT JOIN booking_charges c ON c.booking_id = b.id
            LEFT JOIN rate_cards r ON r.id = c.fare_rule_id
            LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id
           WHERE b.trip_type IN ('OUTSTATION','ROUND_TRIP') AND b.booking_status NOT IN ('DRAFT')
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY b.travel_date DESC`,
    columns: [
      { key: 'trip_id', header: 'Trip ID', kind: 'id' }, { key: 'travel_date', header: 'From', kind: 'date' },
      { key: 'travel_date_to', header: 'To', kind: 'date' }, { key: 'trip_type', header: 'Type' },
      { key: 'pickup_location', header: 'Pickup', width: 26 }, { key: 'drop_location', header: 'Destination', width: 26 },
      { key: 'vehicle', header: 'Vehicle' }, { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' },
      { key: 'driver_name', header: 'Driver' }, { key: 'fare_rule', header: 'Fare rule' },
      { key: 'taxable_amount', header: 'Fare (taxable)', kind: 'money' }, { key: 'non_taxable_amount', header: 'Toll/state tax', kind: 'money' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'supplier_cost', header: 'Cost', kind: 'money' },
      { key: 'margin', header: 'Margin', kind: 'money' }, { key: 'booking_status', header: 'Status' },
    ],
    totals: ['taxable_amount', 'non_taxable_amount', 'total_amount', 'supplier_cost', 'margin'], link: { idKey: 'id', to: 'trip' },
  },
};

function paramsFrom(p: Record<string, string>) {
  return {
    from: p.from ?? '', to: p.to ?? '',
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    source: p.source ?? '', status: p.status ?? '', paymentStatus: p.paymentStatus ?? '',
    vehicleId: p.vehicleId ? Number(p.vehicleId) : 0, driverId: p.driverId ? Number(p.driverId) : 0,
    tripType: p.tripType ?? '',
  };
}

function runReport(key: string, params: ReturnType<typeof paramsFrom>) {
  const def = REPORTS[key];
  if (!def) return null;
  let rows = q.all<any>(def.sql, params);
  if (def.post) rows = def.post(rows, params);
  const totals = Object.fromEntries((def.totals ?? []).map((k) => [
    k, Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100,
  ]));
  return { def, rows, totals };
}

const describe = (key: string, d: ReportDef) => ({
  key, title: d.title, group: d.group, description: d.description, dateBasis: d.dateBasis, filters: d.filters,
  columns: d.columns.map((c) => ({ key: c.key, header: c.header, kind: c.kind ?? 'text' })),
  totals: d.totals ?? [], link: d.link ?? null, chart: d.chart ?? null,
});

router.get('/', requirePermission('reports.view'), (_req, res) => {
  res.json({ data: Object.entries(REPORTS).map(([key, d]) => describe(key, d)) });
});

router.get('/:key', requirePermission('reports.view'), (req, res) => {
  const params = paramsFrom(req.query as Record<string, string>);
  const result = runReport(req.params.key, params);
  if (!result) return res.status(404).json({ error: `Unknown report "${req.params.key}".` });
  // Values derived in code (labels) are resolved here so the screen shows what Excel shows.
  const data = result.rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    for (const c of result.def.columns) if (c.value) out[c.key] = c.value(r);
    return out;
  });
  res.json({
    ...describe(req.params.key, result.def),
    data, totalsRow: result.totals, filters: params, count: data.length,
  });
});

/** Export any report as XLSX or CSV — the same rows and totals as on screen. */
router.get('/:key/export', requirePermission('reports.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const params = paramsFrom(p);
  const result = runReport(req.params.key, params);
  if (!result) return res.status(404).json({ error: `Unknown report "${req.params.key}".` });
  audit(req, 'DATA_EXPORTED', { description: `${result.def.title} — ${result.rows.length} row(s)`, meta: params });
  const vendor = params.vendorId ? q.get<any>('SELECT vendor_name FROM vendors WHERE id = @id', { id: params.vendorId })?.vendor_name : '';
  await sendTable(res, req.params.key, {
    name: result.def.title, title: result.def.title,
    notes: [
      filterNote({
        [result.def.dateBasis + ' from']: params.from, To: params.to, Vendor: vendor, Source: params.source,
        Status: params.status || params.paymentStatus, 'Trip type': params.tripType,
      }),
      result.def.description,
    ],
    columns: result.def.columns,
    rows: result.rows,
    totals: result.def.totals,
  }, String(p.format ?? 'xlsx'));
});

export default router;
