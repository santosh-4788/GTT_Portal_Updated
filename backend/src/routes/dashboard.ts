import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { STAGE_SQL, STAGE_JOINS, STAGES } from '../services/tripStages';
import { expiringDocuments } from '../services/fleet';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('dashboard.view'), (_req, res) => {
  const cards = q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM vendors WHERE status='ACTIVE') AS total_vendors,
       (SELECT COUNT(*) FROM bookings WHERE booking_date = date('now')) AS todays_bookings,
       (SELECT COUNT(*) FROM bookings WHERE travel_date = date('now')) AS todays_travel,
       (SELECT COUNT(*) FROM bookings WHERE strftime('%Y-%m', travel_date) = strftime('%Y-%m','now')) AS month_bookings,
       (SELECT COUNT(*) FROM bookings WHERE billing_status IN ('PENDING','READY')
          AND booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')) AS pending_billing_count,
       (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id=b.id
         WHERE b.billing_status IN ('PENDING','READY') AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
       ) AS pending_billing_amount,
       (SELECT COUNT(*) FROM bookings WHERE billing_status='INVOICED') AS invoiced_bookings,
       (SELECT COUNT(*) FROM invoices WHERE status <> 'CANCELLED') AS total_invoices,
       (SELECT COALESCE(SUM(total_amount),0) FROM invoices WHERE status <> 'CANCELLED') AS total_invoiced_amount,
       (SELECT COALESCE(SUM(paid_amount),0) FROM invoices WHERE status <> 'CANCELLED') AS paid_amount,
       (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices WHERE status NOT IN ('CANCELLED','PAID')) AS outstanding_amount,
       (SELECT COUNT(*) FROM invoices WHERE status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0) AS pending_payment_count,
       (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i
         WHERE i.status <> 'CANCELLED' AND strftime('%Y-%m', i.invoice_date) = strftime('%Y-%m','now')
       ) AS month_invoiced,
       (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id=b.id
         WHERE strftime('%Y-%m', b.travel_date) = strftime('%Y-%m','now')) AS month_billing`
  );

  const monthlyTrend = q.all<any>(
    `SELECT strftime('%Y-%m', b.travel_date) AS month,
            COUNT(*) AS bookings,
            COALESCE(SUM(c.total_amount),0) AS amount
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.travel_date >= date('now','-11 months','start of month')
        AND b.booking_status NOT IN ('CANCELLED','INQUIRY')
      GROUP BY month ORDER BY month`
  );

  const monthlyInvoiced = q.all<any>(
    `SELECT strftime('%Y-%m', invoice_date) AS month,
            COUNT(*) AS invoices, COALESCE(SUM(total_amount),0) AS amount,
            COALESCE(SUM(paid_amount),0) AS paid
       FROM invoices
      WHERE invoice_date >= date('now','-11 months','start of month') AND status <> 'CANCELLED'
      GROUP BY month ORDER BY month`
  );

  const vendorBookings = q.all<any>(
    `SELECT v.vendor_name AS name, v.code,
            COUNT(b.id) AS bookings,
            COALESCE(SUM(c.total_amount),0) AS amount
       FROM vendors v
       LEFT JOIN bookings b ON b.vendor_id = v.id AND b.booking_status NOT IN ('CANCELLED','INQUIRY')
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      GROUP BY v.id HAVING bookings > 0
      ORDER BY amount DESC LIMIT 10`
  );

  const recentBookings = q.all<any>(
    `SELECT b.id, b.booking_code, b.travel_date, b.passenger_name, b.pickup_location, b.drop_location,
            b.billing_status, b.booking_status, v.vendor_name, c.total_amount
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      ORDER BY b.created_at DESC, b.id DESC LIMIT 8`
  );

  const recentInvoices = q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.outstanding_amount, i.status,
            i.booking_count, v.vendor_name
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      ORDER BY i.created_at DESC, i.id DESC LIMIT 8`
  );

  const pendingByVendor = q.all<any>(
    `SELECT v.id AS vendor_id, v.vendor_name, v.code, v.consolidation_allowed,
            COUNT(b.id) AS count, COALESCE(SUM(c.total_amount),0) AS amount
       FROM bookings b JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.billing_status IN ('PENDING','READY') AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
      GROUP BY v.id ORDER BY amount DESC`
  );

  const overdue = q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.outstanding_amount, v.vendor_name,
            CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_overdue
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0
        AND i.due_date < date('now')
      ORDER BY days_overdue DESC LIMIT 8`
  );

  /* ---------------------------------------------------------------------
     Ratios. Percentages are computed here rather than in the browser so
     every screen and export agrees on the same denominator: all bookings
     except drafts, which are not yet real work.
     --------------------------------------------------------------------- */
  const statusRows = q.all<any>(
    `SELECT booking_status AS status, COUNT(*) AS count
       FROM bookings WHERE booking_status <> 'DRAFT'
      GROUP BY booking_status`
  );
  const statusTotal = statusRows.reduce((s, r) => s + Number(r.count), 0);
  const pct = (n: number) => (statusTotal ? Math.round((n / statusTotal) * 1000) / 10 : 0);

  const byStatus = ['COMPLETED', 'CONFIRMED', 'CANCELLED', 'NO_SHOW'].map((key) => {
    const row = statusRows.find((r) => r.status === key);
    const count = Number(row?.count ?? 0);
    return { status: key, count, percent: pct(count) };
  });

  const drafts = q.get<any>(`SELECT COUNT(*) c FROM bookings WHERE booking_status = 'DRAFT'`)!.c;

  const billingRows = q.all<any>(
    `SELECT billing_status AS status, COUNT(*) AS count
       FROM bookings WHERE booking_status NOT IN ('DRAFT','CANCELLED')
      GROUP BY billing_status`
  );
  const billingTotal = billingRows.reduce((s, r) => s + Number(r.count), 0);
  const byBilling = ['PENDING', 'READY', 'INVOICED'].map((key) => {
    const row = billingRows.find((r) => r.status === key);
    const count = Number(row?.count ?? 0);
    return {
      status: key,
      count,
      percent: billingTotal ? Math.round((count / billingTotal) * 1000) / 10 : 0,
    };
  });

  /* Vendor-wise share of bookings, plus each vendor's own completion and
     cancellation rate — the thing that tells you which account is healthy. */
  const vendorRatio = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name AS name,
            COUNT(b.id) AS bookings,
            SUM(CASE WHEN b.booking_status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN b.booking_status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN b.booking_status = 'NO_SHOW'   THEN 1 ELSE 0 END) AS no_show,
            SUM(CASE WHEN b.billing_status <> 'INVOICED' THEN 1 ELSE 0 END) AS uninvoiced,
            COALESCE(SUM(c.total_amount), 0) AS amount
       FROM vendors v
       JOIN bookings b ON b.vendor_id = v.id AND b.booking_status NOT IN ('DRAFT','INQUIRY')
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      GROUP BY v.id
      ORDER BY bookings DESC`
  ).map((r) => ({
    ...r,
    share: statusTotal ? Math.round((Number(r.bookings) / statusTotal) * 1000) / 10 : 0,
    completionRate: r.bookings ? Math.round((Number(r.completed) / Number(r.bookings)) * 1000) / 10 : 0,
    cancellationRate: r.bookings ? Math.round((Number(r.cancelled) / Number(r.bookings)) * 1000) / 10 : 0,
  }));

  const ratios = {
    total: statusTotal,
    drafts,
    byStatus,
    byBilling,
    completionRate: pct(Number(byStatus.find((s) => s.status === 'COMPLETED')?.count ?? 0)),
    cancellationRate: pct(
      Number(byStatus.find((s) => s.status === 'CANCELLED')?.count ?? 0) +
      Number(byStatus.find((s) => s.status === 'NO_SHOW')?.count ?? 0)
    ),
    /** Still open: confirmed but not yet completed. */
    inProgressRate: pct(Number(byStatus.find((s) => s.status === 'CONFIRMED')?.count ?? 0)),
    collectionRate: Number(cards.total_invoiced_amount) > 0
      ? Math.round((Number(cards.paid_amount) / Number(cards.total_invoiced_amount)) * 1000) / 10
      : 0,
    vendorRatio,
  };

  /* ---------------------------------------------------------------------
     The customer journey.

     Where the work is coming from, and what is waiting on somebody. Kept
     separate from the vendor figures above because these are the retail
     enquiries, which behave nothing like contracted work.
     --------------------------------------------------------------------- */
  const sourceRows = q.all<any>(
    `SELECT inquiry_source AS source,
            COUNT(*) AS count,
            SUM(CASE WHEN booking_status = 'INQUIRY' THEN 1 ELSE 0 END) AS open_inquiries,
            SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS last7
       FROM bookings
      WHERE trip_id IS NOT NULL AND inquiry_source <> 'VENDOR'
      GROUP BY inquiry_source`
  );

  const journey = {
    bySource: ['EMAIL', 'WHATSAPP', 'PORTAL', 'WALKIN'].map((source) => {
      const row = sourceRows.find((r) => r.source === source);
      return {
        source,
        count: Number(row?.count ?? 0),
        openInquiries: Number(row?.open_inquiries ?? 0),
        last7: Number(row?.last7 ?? 0),
      };
    }),
    ...q.get<any>(
      `SELECT
         (SELECT COUNT(*) FROM bookings WHERE trip_id IS NOT NULL AND booking_status = 'INQUIRY') AS new_inquiries,
         (SELECT COUNT(*) FROM bookings WHERE trip_id IS NOT NULL AND booking_status = 'CONFIRMED') AS awaiting_vehicle,
         (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.booking_status = 'COMPLETED'
            AND NOT EXISTS (SELECT 1 FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
                             WHERE ii.booking_id = b.id AND i.status <> 'CANCELLED')) AS awaiting_invoice,
         (SELECT COUNT(*) FROM customers WHERE is_active = 1) AS customer_accounts,
         -- QUEUED counts too: a message held because the mailbox is not
         -- configured has not reached the customer either, and the office
         -- needs to know that as much as a hard failure.
         (SELECT COUNT(*) FROM email_log WHERE status IN ('FAILED','QUEUED')) AS undelivered_emails`
    ),
    recent: q.all<any>(
      `SELECT b.id, b.trip_id, b.inquiry_source, b.booking_status, b.travel_date,
              b.customer_name, b.customer_mobile, b.pickup_location, b.drop_location, b.created_at
         FROM bookings b
        WHERE b.trip_id IS NOT NULL AND b.inquiry_source <> 'VENDOR'
        ORDER BY b.created_at DESC, b.id DESC LIMIT 6`
    ),
  };

  res.json({
    cards, ratios, journey, monthlyTrend, monthlyInvoiced, vendorBookings,
    recentBookings, recentInvoices, pendingByVendor, overdue,
  });
});

/* ==========================================================================
   The redesigned dashboard: one call, every figure scoped to a date range.

   Each figure uses the definition of the module it links to, so the number on
   a tile is the number of rows the tile opens:

     enquiries / trip stages   → Trips (services/tripStages.ts)
     ready to bill             → Billing queue (billing_status PENDING/READY on live trips)
     invoiced / outstanding    → Invoices (cancelled never counted)
     received                  → Payments (reversed never counted)

   "Range" figures follow the chosen dates; "now" figures (what is waiting,
   what is owed) are always as of today, because a backlog has no date range.
   ========================================================================== */

router.get('/overview', requirePermission('dashboard.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.from ?? '') ? p.from : iso(new Date(today.getFullYear(), today.getMonth(), 1));
  const to = /^\d{4}-\d{2}-\d{2}$/.test(p.to ?? '') ? p.to : iso(today);
  const vendorId = Number(p.vendorId ?? 0);
  const r = { from, to, vendorId };

  const range = q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.inquiry_source <> 'VENDOR'
          AND date(b.created_at) BETWEEN @from AND @to AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS enquiries,
       (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.inquiry_source <> 'VENDOR'
          AND date(b.created_at) BETWEEN @from AND @to AND (@vendorId = 0 OR b.vendor_id = @vendorId)
          AND b.booking_status NOT IN ('INQUIRY','CANCELLED','NO_SHOW','DRAFT')) AS enquiries_converted,
       (SELECT COUNT(*) FROM bookings b WHERE b.travel_date BETWEEN @from AND @to
          AND b.booking_status NOT IN ('INQUIRY','DRAFT') AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS trips,
       (SELECT COUNT(*) FROM bookings b WHERE b.travel_date BETWEEN @from AND @to
          AND b.booking_status IN ('CONFIRMED','ASSIGNED','ONTRIP') AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS confirmed,
       (SELECT COUNT(*) FROM bookings b WHERE b.travel_date BETWEEN @from AND @to
          AND b.booking_status = 'COMPLETED' AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS completed,
       (SELECT COUNT(*) FROM bookings b WHERE b.travel_date BETWEEN @from AND @to
          AND b.booking_status IN ('CANCELLED','NO_SHOW') AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS cancelled,
       (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
         WHERE b.travel_date BETWEEN @from AND @to AND b.booking_status NOT IN ('INQUIRY','DRAFT','CANCELLED','NO_SHOW')
           AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS trip_value,
       (SELECT COUNT(*) FROM invoices i WHERE i.status <> 'CANCELLED' AND i.invoice_date BETWEEN @from AND @to
          AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS invoices,
       (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.status <> 'CANCELLED'
          AND i.invoice_date BETWEEN @from AND @to AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS invoiced,
       (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.is_reversed = 0
          AND p.payment_date BETWEEN @from AND @to AND (@vendorId = 0 OR p.vendor_id = @vendorId)) AS received,
       (SELECT COUNT(*) FROM payments p WHERE p.is_reversed = 0
          AND p.payment_date BETWEEN @from AND @to AND (@vendorId = 0 OR p.vendor_id = @vendorId)) AS receipts`,
    r
  );

  const now = q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.booking_status = 'INQUIRY'
          AND b.owner_user_id IS NULL AND COALESCE(b.quote_status,'') <> 'SENT'
          AND NOT EXISTS (SELECT 1 FROM booking_charges c WHERE c.booking_id = b.id AND c.total_amount > 0)
          AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS new_enquiries,
       (SELECT COUNT(*) FROM bookings b WHERE b.trip_id IS NOT NULL AND b.booking_status = 'INQUIRY'
          AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS open_enquiries,
       (SELECT COUNT(*) FROM bookings b WHERE b.booking_status = 'CONFIRMED' AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS awaiting_assignment,
       (SELECT COUNT(*) FROM bookings b WHERE b.booking_status IN ('CONFIRMED','ASSIGNED')
          AND b.travel_date BETWEEN date('now','localtime') AND date('now','localtime','+1 day')
          AND (b.vehicle_number IS NULL OR b.vehicle_number = '') AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS unallotted_soon,
       (SELECT COUNT(*) FROM bookings b WHERE b.billing_status IN ('PENDING','READY')
          AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW') AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS billing_queue,
       (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
         WHERE b.billing_status IN ('PENDING','READY') AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
           AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS billing_queue_amount,
       (SELECT COUNT(*) FROM bookings b WHERE b.billing_status IN ('PENDING','READY')
          AND b.booking_status = 'COMPLETED' AND (@vendorId = 0 OR b.vendor_id = @vendorId)
          AND NOT EXISTS (SELECT 1 FROM booking_charges c WHERE c.booking_id = b.id AND c.total_amount > 0)) AS completed_unpriced,
       (SELECT COUNT(*) FROM invoices i WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009
          AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS unpaid_invoices,
       (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.status NOT IN ('CANCELLED','PAID')
          AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS outstanding,
       (SELECT COUNT(*) FROM invoices i WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009
          AND i.due_date < date('now','localtime') AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS overdue_invoices,
       (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.status NOT IN ('CANCELLED','PAID')
          AND i.outstanding_amount > 0.009 AND i.due_date < date('now','localtime') AND (@vendorId = 0 OR i.vendor_id = @vendorId)) AS overdue,
       (SELECT COUNT(*) FROM vendors WHERE status = 'ACTIVE' AND code <> 'DIRECT') AS active_vendors,
       (SELECT COUNT(*) FROM vehicles WHERE is_active = 1) AS active_vehicles,
       (SELECT COUNT(*) FROM vehicles WHERE is_active = 1 AND availability_status = 'AVAILABLE') AS available_vehicles,
       (SELECT COUNT(*) FROM drivers WHERE is_active = 1) AS active_drivers,
       (SELECT COUNT(*) FROM drivers WHERE is_active = 1 AND availability_status = 'AVAILABLE') AS available_drivers,
       (SELECT COUNT(*) FROM billing_batches WHERE status = 'PENDING_APPROVAL') AS batches_awaiting_approval,
       (SELECT COUNT(*) FROM email_log WHERE status IN ('FAILED','QUEUED')) AS undelivered_emails,
       -- Allotted or on the road, but the travel day is over: someone has to complete them.
       (SELECT COUNT(*) FROM bookings b WHERE b.booking_status IN ('ASSIGNED','ONTRIP')
          AND COALESCE(b.travel_date_to, b.travel_date) < date('now','localtime')
          AND (@vendorId = 0 OR b.vendor_id = @vendorId)) AS awaiting_completion,
       -- Money received but not yet set against any invoice (advances).
       (SELECT COALESCE(SUM(t.amount - COALESCE((SELECT SUM(p.amount) FROM payments p
                 WHERE p.transaction_id = t.id AND COALESCE(p.is_reversed,0) = 0), 0)), 0)
          FROM payment_transactions t WHERE t.direction = 'IN' AND t.is_reversed = 0
           AND (@vendorId = 0 OR t.vendor_id = @vendorId)) AS unallocated_receipts,
       (SELECT COUNT(*) FROM events e WHERE e.status IN ('PLANNED','CONFIRMED','IN_PROGRESS')
          AND (@vendorId = 0 OR e.vendor_id = @vendorId)) AS open_events`,
    { vendorId }
  );

  // Trip lifecycle stages, exactly as the Trips buckets count them.
  const stageRows = q.all<any>(
    `SELECT (${STAGE_SQL}) AS stage, COUNT(*) AS count FROM bookings b ${STAGE_JOINS}
      WHERE b.trip_id IS NOT NULL AND (@vendorId = 0 OR b.vendor_id = @vendorId) GROUP BY 1`, { vendorId }
  );
  const stages = STAGES.filter((s) => s.key !== 'DRAFT').map((s) => ({
    key: s.key, label: s.label, phase: s.phase, count: Number(stageRows.find((x) => x.stage === s.key)?.count ?? 0),
  }));
  // Taken from the stages so these tiles always equal the Trips buckets they open.
  now.new_enquiries = stages.find((s) => s.key === 'NEW')?.count ?? 0;
  now.awaiting_assignment = stages.find((s) => s.key === 'AWAITING_ASSIGNMENT')?.count ?? 0;
  now.awaiting_billing = stages.find((s) => s.key === 'AWAITING_BILLING')?.count ?? 0;
  now.awaiting_invoice = stages.find((s) => s.key === 'AWAITING_INVOICE')?.count ?? 0;

  const tripCols = `b.id, b.trip_id, b.travel_date, b.reporting_time, b.trip_type, b.booking_status, b.inquiry_source,
      COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location,
      COALESCE(vc.name, b.vehicle_type) AS vehicle, b.vehicle_number, b.driver_name, v.vendor_name`;
  const tripFrom = `FROM bookings b JOIN vendors v ON v.id = b.vendor_id LEFT JOIN vehicle_categories vc ON vc.id = b.vehicle_category_id`;
  const todaysTrips = q.all<any>(
    `SELECT ${tripCols} ${tripFrom}
      WHERE b.booking_status IN ('CONFIRMED','ASSIGNED','ONTRIP','COMPLETED')
        AND b.travel_date <= date('now','localtime') AND COALESCE(b.travel_date_to, b.travel_date) >= date('now','localtime')
        AND (@vendorId = 0 OR b.vendor_id = @vendorId)
      ORDER BY b.reporting_time, b.id LIMIT 25`, { vendorId }
  );
  const upcoming = q.all<any>(
    `SELECT ${tripCols} ${tripFrom}
      WHERE b.booking_status IN ('CONFIRMED','ASSIGNED')
        AND b.travel_date > date('now','localtime') AND b.travel_date <= date('now','localtime','+7 days')
        AND (@vendorId = 0 OR b.vendor_id = @vendorId)
      ORDER BY b.travel_date, b.reporting_time LIMIT 25`, { vendorId }
  );

  // Conversion by channel, for enquiries received in the range.
  const conversion = q.all<any>(
    `SELECT b.inquiry_source AS source, COUNT(*) AS received,
            SUM(CASE WHEN b.booking_status NOT IN ('INQUIRY','CANCELLED','NO_SHOW','DRAFT') THEN 1 ELSE 0 END) AS converted,
            SUM(CASE WHEN b.booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS lost,
            SUM(CASE WHEN b.booking_status = 'INQUIRY' THEN 1 ELSE 0 END) AS open
       FROM bookings b
      WHERE b.trip_id IS NOT NULL AND date(b.created_at) BETWEEN @from AND @to
        AND (@vendorId = 0 OR b.vendor_id = @vendorId)
      GROUP BY b.inquiry_source ORDER BY received DESC`, r
  );

  // Twelve months of money: invoiced and collected per month, and what was
  // outstanding at each month end (all invoices to date less all receipts to date).
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthly = q.all<any>(
    `SELECT strftime('%Y-%m', invoice_date) AS m, COALESCE(SUM(total_amount),0) AS invoiced, COUNT(*) AS n
       FROM invoices WHERE status <> 'CANCELLED' AND (@vendorId = 0 OR vendor_id = @vendorId) GROUP BY 1`, { vendorId }
  );
  const collected = q.all<any>(
    `SELECT strftime('%Y-%m', payment_date) AS m, COALESCE(SUM(amount),0) AS collected
       FROM payments WHERE is_reversed = 0 AND (@vendorId = 0 OR vendor_id = @vendorId) GROUP BY 1`, { vendorId }
  );
  const tripsByMonth = q.all<any>(
    `SELECT strftime('%Y-%m', travel_date) AS m, COUNT(*) AS trips,
            SUM(CASE WHEN booking_status IN ('CANCELLED','NO_SHOW') THEN 1 ELSE 0 END) AS cancelled
       FROM bookings WHERE booking_status NOT IN ('INQUIRY','DRAFT') AND (@vendorId = 0 OR vendor_id = @vendorId) GROUP BY 1`, { vendorId }
  );
  let runInvoiced = monthly.filter((x) => x.m < months[0]).reduce((s, x) => s + Number(x.invoiced), 0);
  let runCollected = collected.filter((x) => x.m < months[0]).reduce((s, x) => s + Number(x.collected), 0);
  const trend = months.map((m) => {
    const inv = Number(monthly.find((x) => x.m === m)?.invoiced ?? 0);
    const col = Number(collected.find((x) => x.m === m)?.collected ?? 0);
    runInvoiced += inv;
    runCollected += col;
    const t = tripsByMonth.find((x) => x.m === m);
    return {
      month: m, invoiced: Math.round(inv * 100) / 100, collected: Math.round(col * 100) / 100,
      outstanding: Math.round(Math.max(0, runInvoiced - runCollected) * 100) / 100,
      trips: Number(t?.trips ?? 0) - Number(t?.cancelled ?? 0), cancelled: Number(t?.cancelled ?? 0),
    };
  });

  // Vendor-wise money for the range (receivables only).
  const vendors = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.vendor_id = v.id AND b.travel_date BETWEEN @from AND @to
               AND b.booking_status NOT IN ('INQUIRY','DRAFT','CANCELLED','NO_SHOW')) AS trips,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
              WHERE b.vendor_id = v.id AND b.billing_status IN ('PENDING','READY')
                AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')) AS unbilled,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
               AND i.invoice_date BETWEEN @from AND @to) AS invoiced,
            (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.vendor_id = v.id AND p.is_reversed = 0
               AND p.payment_date BETWEEN @from AND @to) AS received,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id
               AND i.status NOT IN ('CANCELLED','PAID')) AS outstanding,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id
               AND i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009 AND i.due_date < date('now','localtime')) AS overdue
       FROM vendors v WHERE (@vendorId = 0 OR v.id = @vendorId)
      ORDER BY outstanding DESC, invoiced DESC`, r
  ).filter((v) => v.trips || v.invoiced || v.received || v.outstanding || v.unbilled);

  /* --- insights: deterministic rules over the data, nothing guessed --- */
  const docs = expiringDocuments(30);
  const staleEnquiries = q.get<any>(
    `SELECT COUNT(*) c FROM bookings b WHERE b.booking_status = 'INQUIRY' AND b.owner_user_id IS NULL
        AND b.created_at <= datetime('now','-24 hours') AND (@vendorId = 0 OR b.vendor_id = @vendorId)`, { vendorId }
  )!.c;
  const possibleDuplicates = q.get<any>(
    `SELECT COUNT(DISTINCT a.id) c FROM bookings a JOIN bookings b2 ON b2.id <> a.id
        AND b2.booking_status NOT IN ('CANCELLED','NO_SHOW')
        AND substr(replace(COALESCE(NULLIF(b2.customer_mobile,''), b2.passenger_mobile),' ',''), -10)
          = substr(replace(COALESCE(NULLIF(a.customer_mobile,''), a.passenger_mobile),' ',''), -10)
        AND abs(julianday(b2.travel_date) - julianday(a.travel_date)) <= 1
        AND lower(COALESCE(b2.pickup_location,'')) = lower(COALESCE(a.pickup_location,''))
      WHERE a.booking_status = 'INQUIRY' AND length(COALESCE(NULLIF(a.customer_mobile,''), a.passenger_mobile, '')) >= 10`
  )!.c;
  const insights: { tone: 'danger' | 'warn' | 'info'; title: string; body: string; link: string }[] = [];
  if (now.unallotted_soon) insights.push({ tone: 'danger', title: `${now.unallotted_soon} trip(s) today or tomorrow have no vehicle`, body: 'Allot a vehicle and driver before the pickup time.', link: '/admin/trips?stage=AWAITING_ASSIGNMENT&sort=travel_asc' });
  if (now.overdue_invoices) insights.push({ tone: 'danger', title: `${now.overdue_invoices} invoice(s) past their due date`, body: `₹${Math.round(now.overdue).toLocaleString('en-IN')} overdue. Follow up or record payments received.`, link: '/admin/invoices?status=OVERDUE' });
  if (staleEnquiries) insights.push({ tone: 'warn', title: `${staleEnquiries} enquiry(ies) unanswered for over 24 hours`, body: 'Nobody has picked these up yet.', link: '/admin/trips?stage=NEW&sort=created_asc' });
  if (possibleDuplicates) insights.push({ tone: 'info', title: `${possibleDuplicates} enquiry(ies) look like duplicates`, body: 'Same mobile, same pickup, within a day of another open trip.', link: '/admin/trips?stage=NEW' });
  if (now.completed_unpriced) insights.push({ tone: 'warn', title: `${now.completed_unpriced} completed trip(s) have no fare`, body: 'They cannot be billed until the final charges are entered.', link: '/admin/trips?stage=AWAITING_BILLING' });
  if (now.batches_awaiting_approval) insights.push({ tone: 'info', title: `${now.batches_awaiting_approval} billing batch(es) waiting for approval`, body: 'Review and approve them so they can be invoiced.', link: '/admin/billing?tab=batches' });
  const expired = docs.filter((d) => d.state === 'EXPIRED').length;
  if (docs.length) insights.push({ tone: expired ? 'danger' : 'warn', title: `${docs.length} fleet document(s) ${expired ? `expired or ` : ''}expiring within 30 days`, body: docs.slice(0, 3).map((d) => `${d.name} — ${d.document}`).join(' · '), link: '/admin/fleet?tab=documents' });
  if (now.undelivered_emails) insights.push({ tone: 'info', title: `${now.undelivered_emails} email(s) not delivered`, body: 'Check the mailbox settings and resend.', link: '/admin/settings?tab=email' });

  res.json({
    range: { from, to, vendorId },
    totals: { ...range, conversion_rate: range.enquiries ? Math.round((range.enquiries_converted / range.enquiries) * 1000) / 10 : 0 },
    now,
    stages,
    todaysTrips,
    upcoming,
    conversion,
    trend,
    vendors,
    insights,
    recentEnquiries: q.all<any>(
      `SELECT b.id, b.trip_id, b.inquiry_source, b.booking_status, b.travel_date, b.created_at,
              COALESCE(b.customer_name, b.passenger_name) AS customer, b.pickup_location, b.drop_location
         FROM bookings b WHERE b.trip_id IS NOT NULL AND b.inquiry_source <> 'VENDOR' AND (@vendorId = 0 OR b.vendor_id = @vendorId)
        ORDER BY b.created_at DESC, b.id DESC LIMIT 6`, { vendorId }
    ),
    recentInvoices: q.all<any>(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.outstanding_amount, i.status, i.due_date,
              COALESCE(i.bill_to_name, v.vendor_name) AS billed_to
         FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE (@vendorId = 0 OR i.vendor_id = @vendorId)
        ORDER BY i.created_at DESC, i.id DESC LIMIT 6`, { vendorId }
    ),
  });
});

/** The little counts beside sidebar items — cheap enough to poll. */
router.get('/badges', (req, res) => {
  const can = (code: string) => req.user!.roleCode === 'SUPER_ADMIN' || req.user!.permissions.includes(code);
  const out: Record<string, number> = {};
  if (can('bookings.view')) {
    out.newEnquiries = q.get<any>(
      `SELECT COUNT(*) c FROM bookings b ${STAGE_JOINS} WHERE b.trip_id IS NOT NULL AND (${STAGE_SQL}) = 'NEW'`
    )!.c;
    out.awaitingAssignment = q.get<any>(
      `SELECT COUNT(*) c FROM bookings b ${STAGE_JOINS} WHERE b.trip_id IS NOT NULL AND (${STAGE_SQL}) = 'AWAITING_ASSIGNMENT'`
    )!.c;
  }
  if (can('billing.view')) {
    out.batchesAwaitingApproval = q.get<any>(`SELECT COUNT(*) c FROM billing_batches WHERE status = 'PENDING_APPROVAL'`)!.c;
  }
  if (can('invoices.view')) {
    out.overdueInvoices = q.get<any>(
      `SELECT COUNT(*) c FROM invoices WHERE status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0.009
          AND due_date < date('now','localtime')`
    )!.c;
  }
  if (can('fleet.view') || can('settings.view')) out.expiringDocuments = expiringDocuments(30).length;
  res.json(out);
});

/** Global search box — booking, invoice, vendor, passenger, mobile. */
router.get('/search', requirePermission('dashboard.view'), (req, res) => {
  const term = String(req.query.q ?? '').trim();
  if (term.length < 2) return res.json({ bookings: [], invoices: [], vendors: [] });

  res.json({
    bookings: q.all<any>(
      `SELECT b.id, b.booking_code, b.trip_id, b.travel_date, b.passenger_name, b.passenger_mobile,
              b.billing_status, v.vendor_name
         FROM bookings b JOIN vendors v ON v.id = b.vendor_id
        WHERE b.booking_code LIKE '%'||@t||'%' OR b.vendor_booking_ref LIKE '%'||@t||'%'
           OR b.trip_id LIKE '%'||@t||'%'
           OR b.passenger_name LIKE '%'||@t||'%' OR b.passenger_mobile LIKE '%'||@t||'%'
           OR b.customer_name LIKE '%'||@t||'%' OR b.customer_mobile LIKE '%'||@t||'%'
           OR b.vehicle_number LIKE '%'||@t||'%'
        ORDER BY b.travel_date DESC LIMIT 8`,
      { t: term }
    ),
    invoices: q.all<any>(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.status, v.vendor_name
         FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE i.invoice_number LIKE '%'||@t||'%'
        ORDER BY i.invoice_date DESC LIMIT 8`,
      { t: term }
    ),
    vendors: q.all<any>(
      `SELECT id, code, vendor_name, company_name, status FROM vendors
        WHERE vendor_name LIKE '%'||@t||'%' OR company_name LIKE '%'||@t||'%' OR code LIKE '%'||@t||'%'
        LIMIT 8`,
      { t: term }
    ),
  });
});

export default router;
