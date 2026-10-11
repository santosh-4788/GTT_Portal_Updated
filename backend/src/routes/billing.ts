/**
 * Billing — from "the trip has run" to "the invoice is issued".
 *
 *   GET  /pending                 trips ready to bill (filters: vendor, trip, travel/booking/completion dates, status)
 *   POST /preview                 the invoice(s) a selection would produce — totals and breakdown, nothing saved
 *   GET  /vendor-summary          vendor-wise receivables
 *   GET  /outstanding             ageing of unpaid invoices
 *   /batches ...                  the controlled route: draft → submitted → approved → billed
 *   POST /bookings/:id/adjust     an audited correction to a trip's charges before it is billed
 *   GET  /export/...              Excel of the lists above, with the filters applied
 */
import { Router } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';
import { sendTable, filterNote } from '../utils/exportSheet';
import { billingPreview, batchDetail, nextBatchCode, setBatchItems, OPEN_BATCH } from '../services/billingBatches';
import { generateInvoices } from '../services/invoiceGenerate';
import { saveCharges, storedChargeInput } from '../services/charges';
import { recordTripEvent } from '../services/tripFlow';

const router = Router();
router.use(requireAuth);

/* ==========================================================================
   Trips ready to bill
   ========================================================================== */

function pendingFilters(p: Record<string, string>) {
  const params = {
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    from: p.from ?? '',
    to: p.to ?? '',
    bookedFrom: p.bookedFrom ?? '',
    bookedTo: p.bookedTo ?? '',
    completedFrom: p.completedFrom ?? '',
    completedTo: p.completedTo ?? '',
    status: p.status ?? '',      // PENDING | READY | '' (both)
    tripStatus: p.tripStatus ?? '',
    search: (p.search ?? '').trim(),
    inBatch: p.inBatch ?? '',    // 'yes' | 'no' | ''
    confirmed: p.confirmed ?? '', // 'yes' | 'no' | ''
  };
  const where = `
      WHERE b.billing_status IN ('PENDING','READY')
        AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
        AND (@vendorId = 0 OR b.vendor_id = @vendorId)
        AND (@from = '' OR b.travel_date >= @from)
        AND (@to = '' OR b.travel_date <= @to)
        AND (@bookedFrom = '' OR b.booking_date >= @bookedFrom)
        AND (@bookedTo = '' OR b.booking_date <= @bookedTo)
        AND (@completedFrom = '' OR date(b.completed_at) >= @completedFrom)
        AND (@completedTo = '' OR date(b.completed_at) <= @completedTo)
        AND (@status = '' OR b.billing_status = @status)
        AND (@tripStatus = '' OR b.booking_status = @tripStatus)
        AND (@search = '' OR b.booking_code LIKE '%'||@search||'%'
                          OR b.trip_id LIKE '%'||@search||'%'
                          OR b.passenger_name LIKE '%'||@search||'%'
                          OR b.customer_name LIKE '%'||@search||'%'
                          OR b.vendor_booking_ref LIKE '%'||@search||'%'
                          OR b.vehicle_number LIKE '%'||@search||'%')
        AND (@inBatch = '' OR (@inBatch = 'yes' AND bb.id IS NOT NULL) OR (@inBatch = 'no' AND bb.id IS NULL))
        AND (@confirmed = '' OR (@confirmed = 'yes' AND b.billing_confirmed_at IS NOT NULL) OR (@confirmed = 'no' AND b.billing_confirmed_at IS NULL))`;
  return { params, where };
}

const PENDING_SQL = (where: string) => `
    SELECT b.id, b.booking_code, b.trip_id, b.vendor_booking_ref, b.travel_date, b.reporting_time, b.booking_date,
           b.completed_at, b.booking_status, b.inquiry_source, b.billing_confirmed_at, b.actual_km, b.actual_hours,
           b.passenger_name, b.passenger_mobile, b.customer_name, b.pickup_location, b.drop_location,
           b.vehicle_type, b.vehicle_number, b.driver_name, b.duty_type, b.trip_type, b.billing_status,
           v.id AS vendor_id, v.vendor_name, v.code AS vendor_code, v.company_name,
           v.consolidation_allowed, v.invoice_template_id, v.tax_mode AS vendor_tax_mode, v.tax_rate AS vendor_tax_rate,
           c.base_fare, c.extra_km, c.extra_km_rate, c.extra_hours, c.extra_hour_rate, c.driver_allowance,
           c.night_charge, c.waiting_charge, c.permit, c.other_charges, c.discount, c.toll, c.parking, c.state_tax,
           c.taxable_amount, c.tax_mode, c.tax_rate, c.tax_amount, c.non_taxable_amount, c.total_amount, c.fare_rule_id,
           bb.id AS batch_id, bb.batch_code, bb.status AS batch_status
      FROM bookings b
      JOIN vendors v ON v.id = b.vendor_id
      LEFT JOIN booking_charges c ON c.booking_id = b.id
      LEFT JOIN billing_batch_items bi ON bi.booking_id = b.id
           AND bi.batch_id IN (SELECT id FROM billing_batches WHERE status IN ${OPEN_BATCH})
      LEFT JOIN billing_batches bb ON bb.id = bi.batch_id
    ${where}
    ORDER BY v.vendor_name, b.travel_date, b.id`;

router.get('/pending', requirePermission('billing.view'), (req, res) => {
  const { params, where } = pendingFilters(req.query as Record<string, string>);
  const data = q.all<any>(PENDING_SQL(where), params);

  const summary = q.get<any>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(c.total_amount),0) AS amount,
            SUM(CASE WHEN b.billing_status = 'READY' THEN 1 ELSE 0 END) AS ready,
            SUM(CASE WHEN COALESCE(c.total_amount,0) <= 0 THEN 1 ELSE 0 END) AS unpriced
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.billing_status IN ('PENDING','READY')
        AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')`
  );
  const filtered = {
    count: data.length,
    amount: Math.round(data.reduce((s, r) => s + Number(r.total_amount ?? 0), 0) * 100) / 100,
  };
  const approval = q.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'billing.requireApproval'`);
  res.json({ data, summary, filtered, requireApproval: String(approval?.value ?? 'false').toLowerCase() === 'true' });
});

/** What the selected trips would be invoiced as. Writes nothing. */
const previewSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose a vendor.'),
  bookingIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one trip.'),
  separateInvoices: z.coerce.boolean().default(false),
});
router.post('/preview', requirePermission('billing.view'), validateBody(previewSchema), (req, res) => {
  const b = req.body as z.infer<typeof previewSchema>;
  res.json({ data: billingPreview(b) });
});

/* ==========================================================================
   Vendor-wise receivables and ageing
   ========================================================================== */

function vendorSummary(from: string, to: string) {
  const data = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name, v.company_name, v.status, v.payment_terms_days,
            v.consolidation_allowed, v.billing_cycle,
            t.name AS template_name,
            (SELECT COUNT(*) FROM bookings b
               WHERE b.vendor_id = v.id AND b.booking_status NOT IN ('INQUIRY','DRAFT')
                 AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            ) AS total_bookings,
            (SELECT COUNT(*) FROM bookings b
               WHERE b.vendor_id = v.id AND b.billing_status IN ('PENDING','READY')
                 AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
            ) AS pending_bookings,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b
               JOIN booking_charges c ON c.booking_id = b.id
              WHERE b.vendor_id = v.id AND b.billing_status IN ('PENDING','READY')
                AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
            ) AS pending_amount,
            (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b
               JOIN booking_charges c ON c.booking_id = b.id
              WHERE b.vendor_id = v.id AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY','NO_SHOW')
                AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            ) AS total_billing,
            (SELECT COUNT(*) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS invoice_count,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS total_invoiced,
            (SELECT COALESCE(SUM(i.paid_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED'
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS total_paid,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS outstanding,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0
                AND i.due_date < date('now','localtime')
                AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
            ) AS overdue
       FROM vendors v
       LEFT JOIN invoice_templates t ON t.id = v.invoice_template_id
      ORDER BY outstanding DESC, pending_amount DESC, v.vendor_name`,
    { from, to }
  );

  const totals = data.reduce(
    (acc, r) => ({
      bookings: acc.bookings + Number(r.total_bookings),
      pending: acc.pending + Number(r.pending_amount),
      billing: acc.billing + Number(r.total_billing),
      invoiced: acc.invoiced + Number(r.total_invoiced),
      paid: acc.paid + Number(r.total_paid),
      outstanding: acc.outstanding + Number(r.outstanding),
      overdue: acc.overdue + Number(r.overdue),
    }),
    { bookings: 0, pending: 0, billing: 0, invoiced: 0, paid: 0, outstanding: 0, overdue: 0 }
  );
  return { data, totals };
}

router.get('/vendor-summary', requirePermission('billing.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  res.json(vendorSummary(p.from ?? '', p.to ?? ''));
});

function outstanding(vendorId = 0) {
  const data = q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount,
            i.paid_amount, i.outstanding_amount, i.status,
            v.id AS vendor_id, v.vendor_name, v.code AS vendor_code,
            CAST(julianday('now') - julianday(i.invoice_date) AS INTEGER) AS age_days,
            CASE WHEN i.due_date < date('now','localtime')
                 THEN CAST(julianday('now','localtime') - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
            CASE
              WHEN julianday('now') - julianday(i.invoice_date) <= 30 THEN '0-30'
              WHEN julianday('now') - julianday(i.invoice_date) <= 60 THEN '31-60'
              WHEN julianday('now') - julianday(i.invoice_date) <= 90 THEN '61-90'
              ELSE '90+'
            END AS bucket
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0
        AND (@v = 0 OR i.vendor_id = @v)
      ORDER BY age_days DESC`, { v: vendorId }
  );
  const buckets = ['0-30', '31-60', '61-90', '90+'].map((b) => ({
    bucket: b,
    count: data.filter((d) => d.bucket === b).length,
    amount: data.filter((d) => d.bucket === b).reduce((s, d) => s + Number(d.outstanding_amount), 0),
  }));
  return { data, buckets, total: data.reduce((s, d) => s + Number(d.outstanding_amount), 0) };
}

router.get('/outstanding', requirePermission('billing.view'), (req, res) => {
  res.json(outstanding(Number(req.query.vendorId ?? 0)));
});

/* ==========================================================================
   Billing batches
   ========================================================================== */

const canPrepare = requirePermission('billing.create', 'invoices.create');
const canApprove = requirePermission('billing.update', 'invoices.create');
const canIssue = requirePermission('invoices.create');

router.get('/batches', requirePermission('billing.view'), (req, res) => {
  const status = String(req.query.status ?? '');
  res.json({
    data: q.all<any>(
      `SELECT bb.*, v.vendor_name, v.code AS vendor_code, u.full_name AS created_by_name, au.full_name AS approved_by_name
         FROM billing_batches bb JOIN vendors v ON v.id = bb.vendor_id
         LEFT JOIN users u ON u.id = bb.created_by LEFT JOIN users au ON au.id = bb.approved_by
        WHERE (@s = '' OR bb.status = @s OR (@s = 'OPEN' AND bb.status IN ${OPEN_BATCH}))
        ORDER BY CASE bb.status WHEN 'PENDING_APPROVAL' THEN 0 WHEN 'APPROVED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END,
                 bb.id DESC LIMIT 200`, { s: status }
    ),
    counts: q.all<any>('SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS amount FROM billing_batches GROUP BY status'),
  });
});

router.get('/batches/:id', requirePermission('billing.view'), (req, res) => {
  const d = batchDetail(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'That billing batch does not exist.' });
  res.json(d);
});

const batchSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose a vendor.'),
  bookingIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one trip.'),
  separateInvoices: z.coerce.boolean().default(false),
  invoiceDate: z.union([isoDate, z.literal('')]).optional().default(''),
  notes: z.string().trim().max(600).optional().default(''),
});

router.post('/batches', canPrepare, validateBody(batchSchema), (req, res) => {
  const b = req.body as z.infer<typeof batchSchema>;
  const preview = billingPreview(b);
  if (!preview.ok) {
    return res.status(400).json({ error: preview.problems.join(' '), problems: preview.problems, preview });
  }
  const code = nextBatchCode();
  const id = getDb().transaction(() => {
    const info = q.run(
      `INSERT INTO billing_batches (batch_code, vendor_id, status, separate_invoices, invoice_date, notes, created_by)
       VALUES (@code, @v, 'DRAFT', @sep, @date, @notes, @uid)`,
      { code, v: b.vendorId, sep: b.separateInvoices ? 1 : 0, date: b.invoiceDate || null, notes: b.notes || null, uid: req.user!.id }
    );
    const batchId = Number(info.lastInsertRowid);
    setBatchItems(batchId, b.vendorId, b.bookingIds, b.separateInvoices);
    return batchId;
  })();
  audit(req, 'BILLING_BATCH_CREATED', {
    entityType: 'billing_batch', entityId: id,
    description: `${code} — ${preview.vendor?.name} — ${preview.totals.count} trip(s), ₹${preview.totals.total}`,
    meta: { bookingIds: b.bookingIds },
  });
  res.status(201).json({ ok: true, id, batchCode: code, message: `Draft batch ${code} created.`, ...batchDetail(id) });
});

router.put('/batches/:id', canPrepare, validateBody(batchSchema), (req, res) => {
  const id = Number(req.params.id);
  const batch = q.get<any>('SELECT * FROM billing_batches WHERE id = @id', { id });
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (batch.status !== 'DRAFT') return res.status(409).json({ error: `${batch.batch_code} is ${batch.status.toLowerCase().replace('_', ' ')} — only a draft can be changed.` });
  const b = req.body as z.infer<typeof batchSchema>;
  if (b.vendorId !== batch.vendor_id) return res.status(400).json({ error: 'A batch stays with the vendor it was created for.' });
  const preview = billingPreview({ ...b, batchId: id });
  if (!preview.ok) return res.status(400).json({ error: preview.problems.join(' '), problems: preview.problems, preview });
  q.run(
    `UPDATE billing_batches SET separate_invoices = @sep, invoice_date = @date, notes = @notes WHERE id = @id`,
    { sep: b.separateInvoices ? 1 : 0, date: b.invoiceDate || null, notes: b.notes || null, id }
  );
  setBatchItems(id, b.vendorId, b.bookingIds, b.separateInvoices);
  audit(req, 'BILLING_BATCH_UPDATED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} — ${preview.totals.count} trip(s), ₹${preview.totals.total}` });
  res.json({ ok: true, message: `${batch.batch_code} updated.`, ...batchDetail(id) });
});

function loadBatch(id: number) {
  return q.get<any>('SELECT * FROM billing_batches WHERE id = @id', { id });
}

router.post('/batches/:id/submit', canPrepare, (req, res) => {
  const id = Number(req.params.id);
  const batch = loadBatch(id);
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (batch.status !== 'DRAFT') return res.status(409).json({ error: `${batch.batch_code} has already been submitted.` });
  // Re-check: something may have changed since the draft was saved.
  const d = batchDetail(id)!;
  if (!d.preview.ok) return res.status(400).json({ error: d.preview.problems.join(' '), problems: d.preview.problems });
  setBatchItems(id, batch.vendor_id, d.preview.lines.map((l) => l.bookingId), !!batch.separate_invoices);
  q.run(`UPDATE billing_batches SET status = 'PENDING_APPROVAL', submitted_at = datetime('now'), submitted_by = @u WHERE id = @id`, { u: req.user!.id, id });
  audit(req, 'BILLING_BATCH_SUBMITTED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} submitted for approval — ₹${d.preview.totals.total}` });
  res.json({ ok: true, message: `${batch.batch_code} sent for approval.`, ...batchDetail(id) });
});

router.post('/batches/:id/approve', canApprove, (req, res) => {
  const id = Number(req.params.id);
  const batch = loadBatch(id);
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (batch.status !== 'PENDING_APPROVAL') return res.status(409).json({ error: `${batch.batch_code} is not waiting for approval.` });
  // Four eyes: whoever prepared a batch does not approve it — except the
  // super admin, who may be the only person in a small office.
  if (batch.created_by === req.user!.id && req.user!.roleCode !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'You prepared this batch, so somebody else has to approve it.' });
  }
  const d = batchDetail(id)!;
  if (!d.preview.ok) return res.status(400).json({ error: d.preview.problems.join(' '), problems: d.preview.problems });
  // The approver approves the figures they are looking at; if those differ
  // from what was submitted, it goes back to draft instead.
  if (Math.abs(d.preview.totals.total - Number(batch.total_amount)) > 0.009) {
    q.run(`UPDATE billing_batches SET status = 'DRAFT' WHERE id = @id`, { id });
    setBatchItems(id, batch.vendor_id, d.preview.lines.map((l) => l.bookingId), !!batch.separate_invoices);
    audit(req, 'BILLING_BATCH_UPDATED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} returned to draft — charges changed after submission (₹${batch.total_amount} → ₹${d.preview.totals.total})` });
    return res.status(409).json({ error: `The charges on ${batch.batch_code} changed after it was submitted (₹${batch.total_amount} → ₹${d.preview.totals.total}). It is back in draft for review.` });
  }
  q.run(`UPDATE billing_batches SET status = 'APPROVED', approved_at = datetime('now'), approved_by = @u WHERE id = @id`, { u: req.user!.id, id });
  audit(req, 'BILLING_BATCH_APPROVED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} approved — ₹${batch.total_amount}` });
  res.json({ ok: true, message: `${batch.batch_code} approved. It can now be billed.`, ...batchDetail(id) });
});

router.post('/batches/:id/reject', canApprove, (req, res) => {
  const id = Number(req.params.id);
  const batch = loadBatch(id);
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(batch.status)) return res.status(409).json({ error: `${batch.batch_code} is not waiting for approval.` });
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say what needs fixing, so the preparer knows.' });
  q.run(`UPDATE billing_batches SET status = 'DRAFT', approved_at = NULL, approved_by = NULL WHERE id = @id`, { id });
  audit(req, 'BILLING_BATCH_UPDATED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} sent back to draft: ${reason}` });
  res.json({ ok: true, message: `${batch.batch_code} sent back to draft.` });
});

router.post('/batches/:id/bill', canIssue, async (req, res) => {
  const id = Number(req.params.id);
  const batch = loadBatch(id);
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (batch.status !== 'APPROVED') return res.status(409).json({ error: `${batch.batch_code} must be approved before it is billed.` });
  const bookingIds = q.all<{ booking_id: number }>('SELECT booking_id FROM billing_batch_items WHERE batch_id = @id', { id }).map((r) => r.booking_id);

  const r = await generateInvoices({
    vendorId: batch.vendor_id, bookingIds, separateInvoices: !!batch.separate_invoices,
    invoiceDate: batch.invoice_date || undefined, notes: batch.notes || '',
  }, req, { batchId: id });

  const made = (r.body?.invoices ?? r.body?.partial ?? []) as { invoiceId: number }[];
  if (made.length) {
    q.run(
      `UPDATE billing_batches SET status = @s, billed_at = datetime('now'), billed_by = @u, invoice_ids = @ids WHERE id = @id`,
      { s: r.status === 201 ? 'BILLED' : 'APPROVED', u: req.user!.id, ids: JSON.stringify(made.map((m) => m.invoiceId)), id }
    );
  }
  if (r.status !== 201) return res.status(r.status).json(r.body);
  audit(req, 'BILLING_BATCH_BILLED', {
    entityType: 'billing_batch', entityId: id,
    description: `${batch.batch_code} billed — ${made.length} invoice(s)`, meta: { invoiceIds: made.map((m) => m.invoiceId) },
  });
  res.status(201).json({ ...r.body, batch: batchDetail(id) });
});

router.post('/batches/:id/cancel', canPrepare, (req, res) => {
  const id = Number(req.params.id);
  const batch = loadBatch(id);
  if (!batch) return res.status(404).json({ error: 'That billing batch does not exist.' });
  if (!['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(batch.status)) {
    return res.status(409).json({ error: `${batch.batch_code} is ${batch.status.toLowerCase()} and cannot be cancelled. Cancel its invoices instead.` });
  }
  const reason = String(req.body?.reason ?? '').trim() || 'No reason given';
  q.run(
    `UPDATE billing_batches SET status = 'CANCELLED', cancelled_at = datetime('now'), cancelled_by = @u, cancel_reason = @r WHERE id = @id`,
    { u: req.user!.id, r: reason, id }
  );
  audit(req, 'BILLING_BATCH_CANCELLED', { entityType: 'billing_batch', entityId: id, description: `${batch.batch_code} cancelled: ${reason}` });
  res.json({ ok: true, message: `${batch.batch_code} cancelled. Its trips are free to bill again.` });
});

/* ==========================================================================
   Corrections before billing
   ========================================================================== */

const adjustSchema = z.object({
  reason: z.string().trim().min(3, 'Say why the charges are being corrected.').max(300),
  baseFare: z.coerce.number().min(0).max(9_999_999).optional(),
  extraKm: z.coerce.number().min(0).max(99_999).optional(),
  extraKmRate: z.coerce.number().min(0).max(99_999).optional(),
  extraHours: z.coerce.number().min(0).max(999).optional(),
  extraHourRate: z.coerce.number().min(0).max(99_999).optional(),
  toll: z.coerce.number().min(0).max(999_999).optional(),
  parking: z.coerce.number().min(0).max(999_999).optional(),
  stateTax: z.coerce.number().min(0).max(999_999).optional(),
  driverAllowance: z.coerce.number().min(0).max(999_999).optional(),
  nightCharge: z.coerce.number().min(0).max(999_999).optional(),
  waitingCharge: z.coerce.number().min(0).max(999_999).optional(),
  permit: z.coerce.number().min(0).max(999_999).optional(),
  otherCharges: z.coerce.number().min(0).max(999_999).optional(),
  discount: z.coerce.number().min(0).max(9_999_999).optional(),
});

router.post('/bookings/:id/adjust', requirePermission('billing.update', 'bookings.update'), validateBody(adjustSchema), (req, res) => {
  const id = Number(req.params.id);
  const booking = q.get<any>('SELECT * FROM bookings WHERE id = @id', { id });
  if (!booking) return res.status(404).json({ error: 'That trip does not exist.' });
  if (booking.billing_status === 'INVOICED') {
    return res.status(409).json({ error: `${booking.trip_id ?? booking.booking_code} is invoiced. Cancel or revise the invoice instead.` });
  }
  const locked = q.get<any>(
    `SELECT bb.batch_code, bb.status FROM billing_batch_items bi JOIN billing_batches bb ON bb.id = bi.batch_id
      WHERE bi.booking_id = @id AND bb.status IN ('PENDING_APPROVAL','APPROVED') LIMIT 1`, { id }
  );
  if (locked) {
    return res.status(409).json({ error: `${booking.trip_id ?? booking.booking_code} is in ${locked.batch_code}, which is ${locked.status === 'APPROVED' ? 'approved' : 'awaiting approval'}. Send it back to draft first.` });
  }
  const stored = q.get<any>('SELECT * FROM booking_charges WHERE booking_id = @id', { id });
  if (!stored) return res.status(400).json({ error: 'This trip has no charges recorded yet. Price it first.' });

  const b = req.body as z.infer<typeof adjustSchema>;
  const before = storedChargeInput(stored);
  const after = { ...before };
  const changes: string[] = [];
  for (const k of Object.keys(b) as (keyof typeof b)[]) {
    if (k === 'reason' || b[k] === undefined) continue;
    const old = Number((before as any)[k] ?? 0);
    const next = Number(b[k]);
    if (old !== next) { (after as any)[k] = next; changes.push(`${k}: ${old} → ${next}`); }
  }
  if (!changes.length) return res.status(400).json({ error: 'Nothing was changed.' });

  let total = 0;
  getDb().transaction(() => {
    const c = saveCharges(id, after);
    total = c.totalAmount;
    q.run(
      `UPDATE bookings SET billing_status = CASE WHEN @t > 0 THEN 'READY' ELSE 'PENDING' END,
              updated_at = datetime('now'), updated_by = @u WHERE id = @id`,
      { t: c.totalAmount, u: req.user!.id, id }
    );
    // A draft batch carrying this trip refreshes its stored totals.
    const draft = q.get<any>(
      `SELECT bb.id, bb.vendor_id, bb.separate_invoices FROM billing_batch_items bi JOIN billing_batches bb ON bb.id = bi.batch_id
        WHERE bi.booking_id = @id AND bb.status = 'DRAFT' LIMIT 1`, { id }
    );
    if (draft) {
      const ids = q.all<{ booking_id: number }>('SELECT booking_id FROM billing_batch_items WHERE batch_id = @b', { b: draft.id }).map((r) => r.booking_id);
      setBatchItems(draft.id, draft.vendor_id, ids, !!draft.separate_invoices);
    }
    recordTripEvent({
      bookingId: id, tripId: booking.trip_id, status: booking.booking_status, isPublic: false, userId: req.user!.id,
      title: 'Charges corrected before billing', detail: `${changes.join(', ')} — ${b.reason}`,
    });
  })();
  audit(req, 'BILLING_ADJUSTED', {
    entityType: 'booking', entityId: id,
    description: `${booking.trip_id ?? booking.booking_code}: ${changes.join(', ')} — ${b.reason}. Total ₹${Number(stored.total_amount)} → ₹${total}`,
    meta: { changes, reason: b.reason, before: Number(stored.total_amount), after: total },
  });
  res.json({ ok: true, total, message: `Charges corrected. New total ₹${total.toLocaleString('en-IN')}.` });
});

/* ==========================================================================
   Exports
   ========================================================================== */

router.get('/export/pending', requirePermission('billing.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = pendingFilters(p);
  const rows = q.all<any>(PENDING_SQL(where), params);
  await sendTable(res, 'billing-pending', {
    name: 'Ready to bill', title: 'Trips ready to bill',
    notes: [filterNote({ Search: params.search, 'Travel from': params.from, 'Travel to': params.to, Status: params.status })],
    columns: [
      { key: 'vendor_name', header: 'Vendor' }, { key: 'trip_id', header: 'Trip ID', kind: 'id' },
      { key: 'booking_code', header: 'Booking ID', kind: 'id' }, { key: 'vendor_booking_ref', header: 'Vendor ref', kind: 'id' },
      { key: 'travel_date', header: 'Travel date', kind: 'date' }, { key: 'completed_at', header: 'Completed', kind: 'datetime' },
      { key: 'passenger_name', header: 'Passenger', value: (r) => r.passenger_name || r.customer_name },
      { key: 'pickup_location', header: 'Pickup', width: 30 }, { key: 'drop_location', header: 'Drop', width: 30 },
      { key: 'vehicle_number', header: 'Vehicle no.', kind: 'id' },
      { key: 'base_fare', header: 'Base fare', kind: 'money' }, { key: 'taxable_amount', header: 'Taxable', kind: 'money' },
      { key: 'tax_amount', header: 'Tax', kind: 'money' }, { key: 'non_taxable_amount', header: 'Toll/parking/state tax', kind: 'money' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'billing_status', header: 'Billing status' },
      { key: 'batch_code', header: 'Batch', kind: 'id' },
    ],
    rows, totals: ['base_fare', 'taxable_amount', 'tax_amount', 'non_taxable_amount', 'total_amount'],
  }, p.format);
});

router.get('/export/vendor-summary', requirePermission('billing.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { data } = vendorSummary(p.from ?? '', p.to ?? '');
  await sendTable(res, 'vendor-receivables', {
    name: 'Vendor summary', title: 'Vendor-wise billing and receivables',
    notes: [filterNote({ From: p.from, To: p.to }), 'Receivables only — amounts billed to vendors. Supplier payables are reported under Payments → Payables.'],
    columns: [
      { key: 'code', header: 'Code', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'total_bookings', header: 'Trips', kind: 'number' }, { key: 'pending_bookings', header: 'Awaiting billing', kind: 'number' },
      { key: 'pending_amount', header: 'Unbilled amount', kind: 'money' }, { key: 'invoice_count', header: 'Invoices', kind: 'number' },
      { key: 'total_invoiced', header: 'Invoiced', kind: 'money' }, { key: 'total_paid', header: 'Received', kind: 'money' },
      { key: 'outstanding', header: 'Outstanding', kind: 'money' }, { key: 'overdue', header: 'Overdue', kind: 'money' },
    ],
    rows: data.filter((r) => Number(r.total_bookings) || Number(r.total_invoiced)),
    totals: ['pending_amount', 'total_invoiced', 'total_paid', 'outstanding', 'overdue'],
  }, p.format);
});

router.get('/export/outstanding', requirePermission('billing.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { data } = outstanding(Number(p.vendorId ?? 0));
  await sendTable(res, 'invoice-ageing', {
    name: 'Ageing', title: 'Invoice ageing (outstanding)',
    columns: [
      { key: 'vendor_name', header: 'Vendor' }, { key: 'invoice_number', header: 'Invoice no.', kind: 'id' },
      { key: 'invoice_date', header: 'Invoice date', kind: 'date' }, { key: 'due_date', header: 'Due date', kind: 'date' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'paid_amount', header: 'Received', kind: 'money' },
      { key: 'outstanding_amount', header: 'Outstanding', kind: 'money' }, { key: 'age_days', header: 'Age (days)', kind: 'number' },
      { key: 'days_overdue', header: 'Days overdue', kind: 'number' }, { key: 'bucket', header: 'Bucket' },
    ],
    rows: data, totals: ['total_amount', 'paid_amount', 'outstanding_amount'],
  }, p.format);
});

export default router;
