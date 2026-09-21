import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';

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
