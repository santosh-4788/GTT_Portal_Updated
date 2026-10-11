import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { sendTable, filterNote } from '../utils/exportSheet';
import { validateBody, optionalMobile, gstin, pan, ifsc } from '../utils/validate';
import { parseBookingMessage } from '../services/bookingMessageParser';
import { parseParserConfig } from '../services/parserConfig';

const router = Router();
router.use(requireAuth);

/** How this company's booking messages are read: extra label aliases per field. */
const parserConfigSchema = z.object({
  labels: z.record(z.union([z.array(z.string().trim().min(1).max(60)), z.string().max(500)])).optional(),
  noReference: z.coerce.boolean().optional(),
  sample: z.string().max(5000).optional(),
});

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
  // Left out of the request = leave as stored, so older forms never wipe them.
  aliases: z.string().trim().max(500).optional(),
  companyType: z.enum(['CORPORATE', 'TRAVEL_AGENT', 'DIRECT']).optional(),
  parserConfig: parserConfigSchema.nullable().optional(),
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
  ...(v.aliases !== undefined ? { aliases: v.aliases } : {}),
  ...(v.companyType !== undefined ? { company_type: v.companyType } : {}),
  ...(v.parserConfig !== undefined ? { parser_config: v.parserConfig ? JSON.stringify(v.parserConfig) : null } : {}),
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
                          OR v.aliases LIKE '%'||@search||'%'
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
router.get('/export', requirePermission('vendors.view'), async (req, res) => {
  const { search = '', status = '' } = req.query as Record<string, string>;
  const rows = q.all<any>(
    `SELECT v.*, t.name AS template_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.vendor_id = v.id) AS booking_count,
            (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED') AS total_invoiced,
            (SELECT COALESCE(SUM(i.outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')) AS outstanding
       FROM vendors v LEFT JOIN invoice_templates t ON t.id = v.invoice_template_id
      WHERE (@search = '' OR v.vendor_name LIKE '%'||@search||'%' OR v.company_name LIKE '%'||@search||'%' OR v.code LIKE '%'||@search||'%')
        AND (@status = '' OR v.status = @status)
      ORDER BY v.vendor_name`, { search, status }
  );
  await sendTable(res, 'vendors', {
    name: 'Vendors', title: 'Vendors',
    notes: [filterNote({ Search: search, Status: status })],
    columns: [
      { key: 'code', header: 'Code', kind: 'id' }, { key: 'vendor_name', header: 'Vendor' }, { key: 'company_name', header: 'Company' },
      { key: 'contact_person', header: 'Contact' }, { key: 'mobile', header: 'Mobile', kind: 'id' }, { key: 'email', header: 'Email' },
      { key: 'gst_number', header: 'GSTIN', kind: 'id' }, { key: 'pan', header: 'PAN', kind: 'id' }, { key: 'city', header: 'City' },
      { key: 'payment_terms_days', header: 'Credit days', kind: 'number' }, { key: 'tax_mode', header: 'Tax' },
      { key: 'tax_rate', header: 'Tax %', kind: 'number' }, { key: 'billing_cycle', header: 'Billing cycle' },
      { key: 'template_name', header: 'Invoice template' }, { key: 'status', header: 'Status' },
      { key: 'booking_count', header: 'Bookings', kind: 'number' }, { key: 'total_invoiced', header: 'Invoiced', kind: 'money' },
      { key: 'outstanding', header: 'Outstanding', kind: 'money' },
    ],
    rows, totals: ['total_invoiced', 'outstanding'],
  }, String((req.query as any).format ?? 'xlsx'));
});

router.get('/options', requirePermission('vendors.view', 'bookings.view'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT id, code, vendor_name, company_name, gst_number, billing_address,
              tax_mode, tax_rate, toll_parking_taxable, invoice_template_id,
              consolidation_allowed, document_title, booking_message_format, payment_terms_days, status,
              aliases, company_type, mobile, email, contact_person,
              CASE WHEN parser_config IS NOT NULL AND parser_config <> '' THEN 1 ELSE 0 END AS has_parser_rules
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

// --- try a booking message against this company's parser rules ------------
// Nothing is saved: the office can test new aliases before storing them.
router.post('/:id/parser-test', requirePermission('vendors.view'), (req, res) => {
  const vendor = q.get<any>('SELECT id, parser_config FROM vendors WHERE id = @id', { id: req.params.id });
  if (!vendor) return res.status(404).json({ error: 'Vendor not found.' });
  const message = String(req.body?.message ?? '');
  if (!message.trim()) return res.status(400).json({ error: 'Paste a sample message first.' });
  const parsed = parserConfigSchema.safeParse(req.body?.parserConfig ?? {});
  const cfg = parseParserConfig(parsed.success && req.body?.parserConfig ? parsed.data : vendor.parser_config);
  res.json(parseBookingMessage(message, { labels: cfg.labels as any, noReference: cfg.noReference }));
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
