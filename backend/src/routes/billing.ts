import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

/** Bookings waiting to be billed, with vendor grouping info. */
router.get('/pending', requirePermission('billing.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    from: p.from ?? '',
    to: p.to ?? '',
    status: p.status ?? '',      // PENDING | READY | '' (both)
    search: p.search ?? '',
  };

  const data = q.all<any>(
    `SELECT b.id, b.booking_code, b.vendor_booking_ref, b.travel_date, b.reporting_time,
            b.passenger_name, b.passenger_mobile, b.pickup_location, b.drop_location,
            b.vehicle_type, b.vehicle_number, b.duty_type, b.trip_type, b.billing_status,
            v.id AS vendor_id, v.vendor_name, v.code AS vendor_code, v.company_name,
            v.consolidation_allowed, v.invoice_template_id, v.tax_mode, v.tax_rate,
            c.base_fare, c.taxable_amount, c.tax_amount, c.non_taxable_amount, c.total_amount
       FROM bookings b
       JOIN vendors v ON v.id = b.vendor_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.billing_status IN ('PENDING','READY')
        AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
        AND (@vendorId = 0 OR b.vendor_id = @vendorId)
        AND (@from = '' OR b.travel_date >= @from)
        AND (@to = '' OR b.travel_date <= @to)
        AND (@status = '' OR b.billing_status = @status)
        AND (@search = '' OR b.booking_code LIKE '%'||@search||'%'
                          OR b.passenger_name LIKE '%'||@search||'%'
                          OR b.vendor_booking_ref LIKE '%'||@search||'%')
      ORDER BY v.vendor_name, b.travel_date, b.id`,
    params
  );

  const summary = q.get<any>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(c.total_amount),0) AS amount
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.billing_status IN ('PENDING','READY')
        AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')`
  );

  res.json({ data, summary });
});

/** Vendor-wise billing summary — the "who owes what" screen. */
router.get('/vendor-summary', requirePermission('billing.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = { from: p.from ?? '', to: p.to ?? '' };

  const data = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name, v.company_name, v.status, v.payment_terms_days,
            v.consolidation_allowed, v.billing_cycle,
            t.name AS template_name,
            (SELECT COUNT(*) FROM bookings b
               WHERE b.vendor_id = v.id
                 AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            ) AS total_bookings,
            (SELECT COUNT(*) FROM bookings b
               WHERE b.vendor_id = v.id AND b.billing_status IN ('PENDING','READY')
                 AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
            ) AS pending_bookings,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b
               JOIN booking_charges c ON c.booking_id = b.id
              WHERE b.vendor_id = v.id AND b.billing_status IN ('PENDING','READY')
                AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
            ) AS pending_amount,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b
               JOIN booking_charges c ON c.booking_id = b.id
              WHERE b.vendor_id = v.id
                AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            ) AS total_billing,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS total_invoiced,
            (SELECT COALESCE(SUM(i.paid_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
            ) AS total_paid,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')
            ) AS outstanding
       FROM vendors v
       LEFT JOIN invoice_templates t ON t.id = v.invoice_template_id
      ORDER BY outstanding DESC, pending_amount DESC, v.vendor_name`,
    params
  );

  const totals = data.reduce(
    (acc, r) => ({
      bookings: acc.bookings + Number(r.total_bookings),
      pending: acc.pending + Number(r.pending_amount),
      billing: acc.billing + Number(r.total_billing),
      invoiced: acc.invoiced + Number(r.total_invoiced),
      paid: acc.paid + Number(r.total_paid),
      outstanding: acc.outstanding + Number(r.outstanding),
    }),
    { bookings: 0, pending: 0, billing: 0, invoiced: 0, paid: 0, outstanding: 0 }
  );

  res.json({ data, totals });
});

/** Ageing buckets for outstanding invoices. */
router.get('/outstanding', requirePermission('billing.view'), (_req, res) => {
  const data = q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount,
            i.paid_amount, i.outstanding_amount, i.status,
            v.vendor_name, v.code AS vendor_code,
            CAST(julianday('now') - julianday(i.invoice_date) AS INTEGER) AS age_days,
            CASE
              WHEN julianday('now') - julianday(i.invoice_date) <= 30 THEN '0-30'
              WHEN julianday('now') - julianday(i.invoice_date) <= 60 THEN '31-60'
              WHEN julianday('now') - julianday(i.invoice_date) <= 90 THEN '61-90'
              ELSE '90+'
            END AS bucket
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0
      ORDER BY age_days DESC`
  );

  const buckets = ['0-30', '31-60', '61-90', '90+'].map((b) => ({
    bucket: b,
    count: data.filter((d) => d.bucket === b).length,
    amount: data.filter((d) => d.bucket === b).reduce((s, d) => s + Number(d.outstanding_amount), 0),
  }));

  res.json({ data, buckets, total: data.reduce((s, d) => s + Number(d.outstanding_amount), 0) });
});

export default router;
