import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile, gstin, pan, ifsc } from '../utils/validate';

const router = Router();
router.use(requireAuth);

const vendorSchema = z.object({
  code: z.string().trim().min(2, 'Vendor code needs at least 2 characters.').max(20)
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9_-]/g, '')),
  vendorName: z.string().trim().min(2, 'Vendor name is required.'),
  companyName: z.string().trim().optional().default(''),
  contactPerson: z.string().trim().optional().default(''),
  mobile: optionalMobile.default(''),
  altMobile: optionalMobile.default(''),
  email: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  address: z.string().trim().optional().default(''),
  city: z.string().trim().optional().default(''),
  state: z.string().trim().optional().default(''),
  pincode: z.string().trim().regex(/^(\d{6})?$/, 'Pincode must be 6 digits.').optional().default(''),
  gstNumber: gstin.optional().default(''),
  pan: pan.optional().default(''),
  billingAddress: z.string().trim().optional().default(''),
  paymentTermsDays: z.coerce.number().int().min(0).max(365).default(30),
  bankName: z.string().trim().optional().default(''),
  accountNumber: z.string().trim().optional().default(''),
  ifsc: ifsc.optional().default(''),
  upi: z.string().trim().optional().default(''),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  invoiceTemplateId: z.coerce.number().int().positive().nullable().optional(),
  invoicePrefix: z.string().trim().min(1).max(12).default('GTT'),
  invoiceNumberFormat: z.string().trim().min(1).default('{PREFIX}/{FY}/{SEQ:5}'),
  documentTitle: z.string().trim().default('Tax Invoice'),
  taxMode: z.enum(['IGST', 'CGST_SGST', 'NONE']).default('IGST'),
  taxRate: z.coerce.number().min(0).max(28).default(5),
  tollParkingTaxable: z.coerce.boolean().default(false),
  consolidationAllowed: z.coerce.boolean().default(false),
  billingCycle: z.enum(['PER_TRIP', 'FORTNIGHTLY', 'MONTHLY']).default('PER_TRIP'),
  bookingMessageFormat: z.enum(['AUTO', 'BOOKING_HASH', 'TRIPID_HASH', 'NONE']).default('AUTO'),
  notes: z.string().trim().optional().default(''),
});

const toRow = (v: z.infer<typeof vendorSchema>) => ({
  code: v.code,
  vendor_name: v.vendorName,
  company_name: v.companyName || v.vendorName,
  contact_person: v.contactPerson,
  mobile: v.mobile,
  alt_mobile: v.altMobile,
  email: v.email,
  address: v.address,
  city: v.city,
  state: v.state,
  pincode: v.pincode,
  gst_number: v.gstNumber,
  pan: v.pan,
  billing_address: v.billingAddress || v.address,
  payment_terms_days: v.paymentTermsDays,
  bank_name: v.bankName,
  account_number: v.accountNumber,
  ifsc: v.ifsc,
  upi: v.upi,
  status: v.status,
  invoice_template_id: v.invoiceTemplateId ?? null,
  invoice_prefix: v.invoicePrefix,
  invoice_number_format: v.invoiceNumberFormat,
  document_title: v.documentTitle,
  tax_mode: v.taxMode,
  tax_rate: v.taxRate,
  toll_parking_taxable: v.tollParkingTaxable ? 1 : 0,
  consolidation_allowed: v.consolidationAllowed ? 1 : 0,
  billing_cycle: v.billingCycle,
  booking_message_format: v.bookingMessageFormat,
  notes: v.notes,
});

// --- list ------------------------------------------------------------------
router.get('/', requirePermission('vendors.view'), (req, res) => {
  const { search = '', status = '', limit = '200', offset = '0' } = req.query as Record<string, string>;
  const rows = q.all<any>(
    `SELECT v.*, t.name AS template_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.vendor_id = v.id) AS booking_count,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED') AS total_invoiced,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i
              WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')) AS outstanding
       FROM vendors v
       LEFT JOIN invoice_templates t ON t.id = v.invoice_template_id
      WHERE (@search = '' OR v.vendor_name LIKE '%'||@search||'%'
                          OR v.company_name LIKE '%'||@search||'%'
                          OR v.code LIKE '%'||@search||'%')
        AND (@status = '' OR v.status = @status)
      ORDER BY v.vendor_name
      LIMIT @limit OFFSET @offset`,
    { search, status, limit: Number(limit), offset: Number(offset) }
  );
  const total = q.get<any>('SELECT COUNT(*) c FROM vendors')!.c;
  res.json({ data: rows, total });
});

// --- lightweight dropdown source ------------------------------------------
router.get('/options', requirePermission('vendors.view', 'bookings.view'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT id, code, vendor_name, company_name, gst_number, billing_address,
              tax_mode, tax_rate, toll_parking_taxable, invoice_template_id,
              consolidation_allowed, document_title, booking_message_format, payment_terms_days
         FROM vendors WHERE status = 'ACTIVE' ORDER BY vendor_name`
    ),
  });
});

// --- single ----------------------------------------------------------------
router.get('/:id', requirePermission('vendors.view'), (req, res) => {
  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: req.params.id });
  if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });

  const summary = q.get<any>(
    `SELECT
       (SELECT COUNT(*) FROM bookings WHERE vendor_id = @id) AS total_bookings,
       (SELECT COUNT(*) FROM bookings WHERE vendor_id = @id AND billing_status IN ('PENDING','READY')) AS unbilled_bookings,
       (SELECT COALESCE(SUM(c.total_amount),0) FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
         WHERE b.vendor_id = @id) AS total_billing,
       (SELECT COALESCE(SUM(total_amount),0) FROM invoices WHERE vendor_id = @id AND status <> 'CANCELLED') AS total_invoiced,
       (SELECT COALESCE(SUM(paid_amount),0) FROM invoices WHERE vendor_id = @id AND status <> 'CANCELLED') AS total_paid,
       (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices WHERE vendor_id = @id AND status NOT IN ('CANCELLED','PAID')) AS outstanding`,
    { id: req.params.id }
  );

  res.json({ data: vendor, summary });
});

// --- create ----------------------------------------------------------------
router.post('/', requirePermission('vendors.create'), validateBody(vendorSchema), (req, res) => {
  const row = toRow(req.body);
  if (q.get('SELECT id FROM vendors WHERE code = @code', { code: row.code })) {
    return res.status(409).json({ error: `Vendor code "${row.code}" is already in use.` });
  }
  const cols = Object.keys(row);
  const info = q.run(
    `INSERT INTO vendors (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`,
    row
  );
  audit(req, 'VENDOR_CREATED', {
    entityType: 'vendor', entityId: Number(info.lastInsertRowid),
    description: `Vendor ${row.vendor_name} (${row.code}) created`,
  });
  res.status(201).json({ data: q.get('SELECT * FROM vendors WHERE id = @id', { id: info.lastInsertRowid }) });
});

// --- update ----------------------------------------------------------------
router.put('/:id', requirePermission('vendors.update'), validateBody(vendorSchema), (req, res) => {
  const existing = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: req.params.id });
  if (!existing) return res.status(404).json({ error: 'Vendor not found.' });

  const row = toRow(req.body);
  const clash = q.get<any>('SELECT id FROM vendors WHERE code = @code AND id <> @id',
    { code: row.code, id: req.params.id });
  if (clash) return res.status(409).json({ error: `Vendor code "${row.code}" is already in use.` });

  const sets = Object.keys(row).map((c) => `${c} = @${c}`).join(', ');
  q.run(`UPDATE vendors SET ${sets}, updated_at = datetime('now') WHERE id = @id`,
    { ...row, id: Number(req.params.id) });

  audit(req, 'VENDOR_UPDATED', {
    entityType: 'vendor', entityId: Number(req.params.id),
    description: `Vendor ${row.vendor_name} updated`,
  });
  res.json({ data: q.get('SELECT * FROM vendors WHERE id = @id', { id: req.params.id }) });
});

// --- delete ----------------------------------------------------------------
router.delete('/:id', requirePermission('vendors.delete'), (req, res) => {
  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: req.params.id });
  if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });

  const used = q.get<any>('SELECT COUNT(*) c FROM bookings WHERE vendor_id = @id', { id: req.params.id })!.c;
  if (used > 0) {
    return res.status(409).json({
      error: `${vendor.vendor_name} has ${used} booking(s) and cannot be deleted. Set the vendor to Inactive instead.`,
    });
  }
  q.run('DELETE FROM vendors WHERE id = @id', { id: req.params.id });
  audit(req, 'VENDOR_DELETED', {
    entityType: 'vendor', entityId: Number(req.params.id),
    description: `Vendor ${vendor.vendor_name} deleted`,
  });
  res.json({ ok: true });
});

export default router;
