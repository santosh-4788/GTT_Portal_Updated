import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { q, getDb } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';
import { consolidate, amountInWords, round2, TaxMode } from '../services/billing';
import { buildInvoiceNumber, financialYearFor } from '../services/invoiceNumber';
import { buildInvoiceContext, billingContext } from '../utils/context';
import { produceDocument } from '../services/invoiceIssue';
import { resolveBillTo } from '../services/directCustomer';
import { sendMail, mailConfig } from '../services/mailer';
import { invoiceEmail } from '../services/emailTemplates';
import { portalUrl, recordTripEvent } from '../services/tripFlow';
import { ensureLocalFile } from '../services/fileStore';
import { generateInvoices, generateSchema, type GenerateInput } from '../services/invoiceGenerate';
import { sendTable, filterNote } from '../utils/exportSheet';
import PizZip from 'pizzip';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
/**
 * The status shown to people. The stored status says what has happened to the
 * invoice (generated, sent, part-paid, paid, cancelled); OVERDUE is derived
 * from it and the due date, so it can never be stale.
 */
const DISPLAY_STATUS = `CASE
    WHEN i.status IN ('CANCELLED','PAID') THEN i.status
    WHEN i.outstanding_amount > 0.009 AND i.due_date IS NOT NULL AND i.due_date < date('now','localtime') THEN 'OVERDUE'
    ELSE i.status END`;

function listFilters(p: Record<string, string>) {
  const params = {
    search: (p.search ?? '').trim(),
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    from: p.from ?? '',
    to: p.to ?? '',
    dueFrom: p.dueFrom ?? '',
    dueTo: p.dueTo ?? '',
    status: p.status ?? '',
    taxMode: p.taxMode ?? '',
  };
  const where = `
    WHERE (@search = '' OR i.invoice_number LIKE '%'||@search||'%' OR v.vendor_name LIKE '%'||@search||'%'
                        OR i.bill_to_name LIKE '%'||@search||'%'
                        OR EXISTS (SELECT 1 FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
                                    WHERE ii.invoice_id = i.id AND (b.trip_id LIKE '%'||@search||'%'
                                       OR b.booking_code LIKE '%'||@search||'%' OR b.passenger_name LIKE '%'||@search||'%')))
      AND (@vendorId = 0 OR i.vendor_id = @vendorId)
      AND (@from = '' OR i.invoice_date >= @from)
      AND (@to = '' OR i.invoice_date <= @to)
      AND (@dueFrom = '' OR i.due_date >= @dueFrom)
      AND (@dueTo = '' OR i.due_date <= @dueTo)
      AND (@taxMode = '' OR (@taxMode = 'GST' AND i.tax_mode <> 'NONE') OR i.tax_mode = @taxMode)
      AND (@status = '' OR i.status = @status
           OR (@status = 'OVERDUE' AND (${DISPLAY_STATUS}) = 'OVERDUE')
           OR (@status = 'UNPAID' AND i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009)
           OR (@status = 'ISSUED' AND i.status IN ('GENERATED','SENT')))`;
  return { params, where };
}

const LIST_SQL = (where: string) => `
    SELECT i.*, v.vendor_name, v.code AS vendor_code, v.company_name,
           u.full_name AS generated_by_name, (${DISPLAY_STATUS}) AS display_status,
           CASE WHEN i.due_date < date('now','localtime') AND i.outstanding_amount > 0.009 AND i.status NOT IN ('CANCELLED','PAID')
                THEN CAST(julianday('now','localtime') - julianday(i.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
           (SELECT group_concat(b.trip_id, ', ') FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
             WHERE ii.invoice_id = i.id) AS trip_ids
      FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      LEFT JOIN users u ON u.id = i.generated_by
      ${where}`;

const SORTS: Record<string, string> = {
  date_desc: 'i.invoice_date DESC, i.id DESC', date_asc: 'i.invoice_date ASC, i.id ASC',
  number_desc: 'i.invoice_number DESC', number_asc: 'i.invoice_number ASC',
  total_desc: 'i.total_amount DESC', outstanding_desc: 'i.outstanding_amount DESC',
  due_asc: 'i.due_date ASC', vendor_asc: 'v.vendor_name ASC, i.invoice_date DESC',
};

router.get('/', requirePermission('invoices.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const limit = Math.min(Number(p.limit ?? 50), 500);
  const offset = Math.max(0, Number(p.offset ?? 0));
  const order = SORTS[p.sort ?? ''] ?? SORTS.date_desc;

  const data = q.all<any>(`${LIST_SQL(where)} ORDER BY ${order} LIMIT @limit OFFSET @offset`, { ...params, limit, offset });
  const agg = q.get<any>(
    `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN i.status <> 'CANCELLED' THEN i.total_amount END),0) amount,
            COALESCE(SUM(CASE WHEN i.status <> 'CANCELLED' THEN i.paid_amount END),0) paid,
            COALESCE(SUM(CASE WHEN i.status NOT IN ('CANCELLED','PAID') THEN i.outstanding_amount END),0) outstanding,
            COALESCE(SUM(CASE WHEN (${DISPLAY_STATUS}) = 'OVERDUE' THEN i.outstanding_amount END),0) overdue
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id ${where}`,
    params
  );
  const counts = q.all<any>(
    `SELECT (${DISPLAY_STATUS}) AS status, COUNT(*) AS count FROM invoices i GROUP BY 1`
  );
  res.json({ data, ...agg, counts });
});

/** The invoice register as Excel, with the list's filters applied. */
router.get('/export', requirePermission('invoices.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const rows = q.all<any>(`${LIST_SQL(where)} ORDER BY ${SORTS[p.sort ?? ''] ?? SORTS.date_desc}`, params);
  audit(req, 'DATA_EXPORTED', { description: `Invoice register export — ${rows.length} row(s)`, meta: params });
  await sendTable(res, 'invoice-register', {
    name: 'Invoices', title: 'Invoice register',
    notes: [filterNote({ Search: params.search, From: params.from, To: params.to, Status: params.status })],
    columns: [
      { key: 'invoice_number', header: 'Invoice no.', kind: 'id' }, { key: 'invoice_date', header: 'Invoice date', kind: 'date' },
      { key: 'due_date', header: 'Due date', kind: 'date' }, { key: 'vendor_name', header: 'Vendor' },
      { key: 'bill_to_name', header: 'Billed to', value: (r) => r.bill_to_name || r.company_name || r.vendor_name },
      { key: 'bill_to_gstin', header: 'GSTIN', kind: 'id' }, { key: 'trip_ids', header: 'Trip IDs', width: 30 },
      { key: 'booking_count', header: 'Trips', kind: 'number' },
      { key: 'taxable_amount', header: 'Taxable', kind: 'money' }, { key: 'tax_mode', header: 'Tax type' },
      { key: 'tax_rate', header: 'Tax %', kind: 'number' }, { key: 'cgst', header: 'CGST', kind: 'money' },
      { key: 'sgst', header: 'SGST', kind: 'money' }, { key: 'igst', header: 'IGST', kind: 'money' },
      { key: 'non_taxable_amount', header: 'Toll/parking/state tax', kind: 'money' },
      { key: 'total_amount', header: 'Total', kind: 'money' }, { key: 'paid_amount', header: 'Received', kind: 'money' },
      { key: 'outstanding_amount', header: 'Outstanding', kind: 'money' },
      { key: 'display_status', header: 'Status' }, { key: 'days_overdue', header: 'Days overdue', kind: 'number' },
      { key: 'sent_at', header: 'Emailed', kind: 'datetime' }, { key: 'generated_by_name', header: 'Generated by' },
    ],
    rows,
    totals: ['taxable_amount', 'cgst', 'sgst', 'igst', 'non_taxable_amount', 'total_amount', 'paid_amount', 'outstanding_amount'],
  }, p.format);
});

/** Several invoice documents in one ZIP. */
router.post('/bulk-download', requirePermission('invoices.view'), (req, res) => {
  const ids = Array.isArray(req.body?.invoiceIds) ? req.body.invoiceIds.map(Number).filter((n: number) => n > 0) : [];
  if (!ids.length) return res.status(400).json({ error: 'Select at least one invoice.' });
  if (ids.length > 200) return res.status(400).json({ error: 'Download at most 200 invoices at a time.' });
  const rows = q.all<any>(`SELECT id, invoice_number, file_path FROM invoices WHERE id IN (${ids.join(',')})`);
  const zip = new PizZip();
  const missing: string[] = [];
  for (const r of rows) {
    if (!r.file_path) { missing.push(r.invoice_number); continue; }
    const abs = path.join(config.paths.invoices, r.file_path);
    if (!abs.startsWith(config.paths.invoices) || !ensureLocalFile(abs)) { missing.push(r.invoice_number); continue; }
    const pdfTwin = abs.replace(/\.[^.]+$/, '.pdf');
    const file = ensureLocalFile(pdfTwin) ? pdfTwin : abs;
    zip.file(path.basename(file), fs.readFileSync(file));
  }
  if (missing.length === rows.length) {
    return res.status(404).json({ error: 'None of the selected invoices has a generated file. Regenerate them first.' });
  }
  if (missing.length) zip.file('_missing.txt', `These invoices have no generated file and were left out:\r\n${missing.join('\r\n')}\r\n`);
  const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  audit(req, 'INVOICE_BULK_DOWNLOADED', { description: `${rows.length - missing.length} invoice file(s) downloaded as ZIP`, meta: { ids } });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="invoices_${new Date().toISOString().slice(0, 10)}.zip"`);
  res.send(buf);
});

// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('invoices.view'), (req, res) => {
  const invoice = q.get<any>(
    `SELECT i.*, v.vendor_name, v.code AS vendor_code, v.company_name, v.gst_number,
            v.billing_address, t.name AS template_name, u.full_name AS generated_by_name,
            (${DISPLAY_STATUS}) AS display_status
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN invoice_templates t ON t.id = i.template_id
       LEFT JOIN users u ON u.id = i.generated_by
      WHERE i.id = @id`,
    { id: req.params.id }
  );
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

  const items = q.all<any>(
    `SELECT ii.*, b.booking_code, b.trip_id, b.travel_date, b.passenger_name, b.pickup_location,
            b.drop_location, b.vehicle_number, b.vehicle_type, b.duty_type, b.driver_name,
            b.customer_name, b.customer_email, b.passenger_email, b.inquiry_source
       FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
      WHERE ii.invoice_id = @id ORDER BY ii.line_no`,
    { id: req.params.id }
  );
  const payments = q.all<any>(
    `SELECT p.*, u.full_name AS created_by_name, ru.full_name AS reversed_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users ru ON ru.id = p.reversed_by
      WHERE p.invoice_id = @id ORDER BY p.payment_date DESC, p.id DESC`, { id: req.params.id }
  );
  const revisions = q.all<any>(
    'SELECT * FROM invoice_revisions WHERE invoice_id = @id ORDER BY revision DESC', { id: req.params.id }
  );
  res.json({ data: invoice, items, payments, revisions });
});

// ---------------------------------------------------------------------------
// Generate — the heart of the system
// ---------------------------------------------------------------------------
router.post('/generate', requirePermission('invoices.create'), validateBody(generateSchema), async (req, res) => {
  const setting = q.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'billing.requireApproval'`);
  if (String(setting?.value ?? 'false').toLowerCase() === 'true') {
    return res.status(409).json({
      code: 'APPROVAL_REQUIRED',
      error: 'Invoices from Billing need an approved batch (Settings → Invoice defaults). Create a billing batch and send it for approval.',
    });
  }
  const r = await generateInvoices(req.body as GenerateInput, req);
  res.status(r.status).json(r.body);
});

// ---------------------------------------------------------------------------
// Regenerate — keeps history, never silently overwrites
// ---------------------------------------------------------------------------
router.post('/:id/regenerate', requirePermission('invoices.update'), async (req, res) => {
  const id = Number(req.params.id);
  const invoice = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status === 'CANCELLED') {
    return res.status(409).json({ error: 'This invoice is cancelled and cannot be regenerated.' });
  }
  if (invoice.paid_amount > 0) {
    return res.status(409).json({
      error: `₹${invoice.paid_amount} has already been received against ${invoice.invoice_number}. ` +
        `Cancel the invoice and raise a fresh one instead of regenerating it.`,
    });
  }

  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: invoice.vendor_id });
  const template = invoice.template_id
    ? q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: invoice.template_id })
    : null;
  const fy = q.get<any>('SELECT * FROM financial_years WHERE id = @id', { id: invoice.financial_year_id })
    ?? financialYearFor(invoice.invoice_date);

  const bookings = q.all<any>(
    `SELECT b.*, c.*, b.id AS id FROM invoice_items ii
       JOIN bookings b ON b.id = ii.booking_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE ii.invoice_id = @id ORDER BY ii.line_no`,
    { id }
  );
  if (!bookings.length) return res.status(400).json({ error: 'This invoice has no bookings attached.' });

  /**
   * Regenerating re-renders the SAME invoice; it must not re-decide what kind
   * of invoice it is.
   *
   * This used to take the tax treatment from the vendor's current default,
   * which quietly turned a non-GST invoice into a taxed one — a different
   * document, a different total, under a number already given to the customer.
   * The invoice's own stored treatment wins; the vendor is only a fallback for
   * historic rows saved before those columns existed.
   */
  const taxMode = ((invoice.tax_mode ?? vendor.tax_mode) ?? 'IGST') as TaxMode;
  const taxRate = Number(invoice.tax_rate ?? vendor.tax_rate ?? 0);
  const totals = consolidate(bookings, taxMode, taxRate);
  const revision = Number(invoice.revision) + 1;

  try {
    const doc = await produceDocument({
      vendor, template,
      invoiceRow: {
        invoiceNumber: invoice.invoice_number,
        invoiceDate: invoice.invoice_date,
        // A document with no tax on it is an Invoice, not a Tax Invoice, and
        // saying otherwise on a reprint is a compliance problem.
        documentTitle: taxMode === 'NONE'
          ? 'Invoice'
          : (template?.document_title ?? vendor.document_title ?? 'Tax Invoice'),
        tripId: bookings.length === 1 ? bookings[0].trip_id : undefined,
        amountInWords: amountInWords(totals.totalAmount),
        revision,
      },
      bookings,
      billing: totals,
      fyCode: fy.code,
      bucket: 'revised',
    });

    getDb().transaction(() => {
      q.run(
        `UPDATE invoices SET taxable_amount=@taxable, tax_mode=@taxMode, tax_rate=@taxRate,
            tax_amount=@tax, cgst=@cgst, sgst=@sgst, igst=@igst,
            non_taxable_amount=@nonTaxable, total_amount=@total, outstanding_amount=@total - paid_amount,
            file_path=@p, file_type=@t, revision=@rev, updated_at=datetime('now')
          WHERE id=@id`,
        {
          taxable: totals.taxableAmount, taxMode: totals.taxMode, taxRate: totals.taxRate,
          tax: totals.taxAmount, cgst: totals.cgst,
          sgst: totals.sgst, igst: totals.igst, nonTaxable: totals.nonTaxableAmount,
          total: totals.totalAmount, p: doc.filePath, t: doc.fileType, rev: revision, id,
        }
      );
      q.run(
        `INSERT INTO invoice_revisions (invoice_id, revision, file_path, total_amount, reason, created_by, snapshot_json)
         VALUES (@id, @rev, @p, @total, @reason, @uid, @snap)`,
        {
          id, rev: revision, p: doc.filePath, total: totals.totalAmount,
          reason: String(req.body?.reason ?? 'Regenerated after booking changes'),
          uid: req.user!.id,
          snap: JSON.stringify({ previousTotal: invoice.total_amount, previousFile: invoice.file_path }),
        }
      );
    })();

    audit(req, 'INVOICE_REGENERATED', {
      entityType: 'invoice', entityId: id,
      description: `${invoice.invoice_number} regenerated as revision ${revision}`,
    });

    res.json({
      ok: true, revision, filePath: doc.filePath, warnings: doc.warnings,
      message: `${invoice.invoice_number} regenerated as revision ${revision}. The previous version is kept in history.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: `Regeneration failed: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
router.post('/:id/cancel', requirePermission('invoices.update'), (req, res) => {
  const id = Number(req.params.id);
  const invoice = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status === 'CANCELLED') return res.status(409).json({ error: 'This invoice is already cancelled.' });
  if (invoice.paid_amount > 0) {
    return res.status(409).json({
      error: `₹${invoice.paid_amount} has been received against ${invoice.invoice_number}. ` +
        `Remove the payment entries before cancelling.`,
    });
  }
  const reason = String(req.body?.reason ?? '').trim();
  if (!reason) return res.status(400).json({ error: 'Enter a reason for cancelling this invoice.' });

  getDb().transaction(() => {
    q.run(
      `UPDATE invoices SET status='CANCELLED', cancelled_reason=@r, updated_at=datetime('now') WHERE id=@id`,
      { r: reason, id }
    );
    // Release the bookings so they can be invoiced again
    q.run(
      `UPDATE bookings SET billing_status='READY', updated_at=datetime('now')
        WHERE id IN (SELECT booking_id FROM invoice_items WHERE invoice_id = @id)`,
      { id }
    );
  })();

  audit(req, 'INVOICE_CANCELLED', {
    entityType: 'invoice', entityId: id,
    description: `${invoice.invoice_number} cancelled — ${reason}`,
  });
  res.json({ ok: true, message: `${invoice.invoice_number} cancelled. Its bookings are available for billing again.` });
});

// ---------------------------------------------------------------------------
// Preview (JSON) + download (file)
// ---------------------------------------------------------------------------
router.get('/:id/preview', requirePermission('invoices.view'), (req, res) => {
  const invoice = q.get<any>(
    `SELECT i.*, v.* , i.id AS id, i.status AS status, i.notes AS notes
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = @id`,
    { id: req.params.id }
  );
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });

  const bookings = q.all<any>(
    `SELECT b.*, c.* , b.id AS id FROM invoice_items ii
       JOIN bookings b ON b.id = ii.booking_id
       LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE ii.invoice_id = @id ORDER BY ii.line_no`,
    { id: req.params.id }
  );

  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: invoice.vendor_id });
  const ctx = buildInvoiceContext({
    vendor,
    invoice: {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date,
      documentTitle: vendor.document_title,
      revision: invoice.revision,
      status: invoice.status,
    },
    bookings,
    billing: billingContext({
      taxable_amount: invoice.taxable_amount, tax_mode: invoice.tax_mode, tax_rate: invoice.tax_rate,
      cgst: invoice.cgst, sgst: invoice.sgst, igst: invoice.igst, tax_amount: invoice.tax_amount,
      non_taxable_amount: invoice.non_taxable_amount, total_amount: invoice.total_amount,
    }),
  });
  res.json({ data: ctx });
});

router.get('/:id/download', requirePermission('invoices.view'), (req, res) => {
  const invoice = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: req.params.id });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (!invoice.file_path) {
    return res.status(404).json({ error: 'No generated file exists for this invoice. Regenerate it first.' });
  }

  const abs = path.join(config.paths.invoices, invoice.file_path);
  // Contain the path inside data/invoices — no traversal out of the store.
  if (!abs.startsWith(config.paths.invoices) || !ensureLocalFile(abs)) {
    return res.status(404).json({ error: 'The generated file is missing from disk. Regenerate the invoice.' });
  }

  const asPdf = String(req.query.format ?? '').toLowerCase() === 'pdf';
  const pdfTwin = abs.replace(/\.[^.]+$/, '.pdf');
  const send = asPdf && ensureLocalFile(pdfTwin) ? pdfTwin : abs;

  audit(req, 'INVOICE_DOWNLOADED', {
    entityType: 'invoice', entityId: invoice.id, description: invoice.invoice_number,
  });
  res.download(send, path.basename(send));
});

/* --------------------------------------------------------------------------
   Email the invoice to the customer.

   Always from the business mailbox configured under Settings → Email, with the
   PDF attached. When the office generated a spreadsheet template and
   LibreOffice produced a PDF twin, the twin is what goes out — a customer
   should never be sent a .xlsx.
   -------------------------------------------------------------------------- */
const sendSchema = z.object({
  to: z.union([z.string().email('Enter a valid email address.'), z.literal('')]).optional().default(''),
  message: z.string().trim().max(600).optional().default(''),
});

router.post('/:id/send', requirePermission('invoices.update', 'invoices.create'),
  validateBody(sendSchema), async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body as z.infer<typeof sendSchema>;

    const invoice = q.get<any>(
      `SELECT i.*, v.vendor_name, v.email AS vendor_email
         FROM invoices i JOIN vendors v ON v.id = i.vendor_id WHERE i.id = @id`,
      { id }
    );
    if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
    if (invoice.status === 'CANCELLED') {
      return res.status(409).json({ error: 'This invoice is cancelled and must not be sent.' });
    }

    // The first booking on the invoice supplies the customer and the trip.
    const booking = q.get<any>(
      `SELECT b.* FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
        WHERE ii.invoice_id = @id ORDER BY ii.line_no LIMIT 1`,
      { id }
    );

    const to = (b.to || booking?.customer_email || booking?.passenger_email || invoice.vendor_email || '').trim();
    if (!to) {
      return res.status(400).json({
        error: 'There is no email address on this invoice. Enter one, or add it to the customer record first.',
      });
    }

    // Prefer the PDF twin of a template-generated file.
    let attachment = invoice.file_path as string | null;
    if (attachment) {
      const abs = path.join(config.paths.invoices, attachment);
      const twin = abs.replace(/\.[^.]+$/, '.pdf');
      if (!attachment.toLowerCase().endsWith('.pdf') && ensureLocalFile(twin)) {
        attachment = path.relative(config.paths.invoices, twin);
      }
    }

    const safeNumber = String(invoice.invoice_number).replace(/[^A-Za-z0-9._-]/g, '-');
    const mail = invoiceEmail({
      trip: booking ?? null,
      tripId: booking?.trip_id ?? null,
      customerName: invoice.bill_to_name || booking?.customer_name || booking?.passenger_name || 'Customer',
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      total: Number(invoice.total_amount ?? 0),
      taxMode: invoice.tax_mode,
      taxRate: Number(invoice.tax_rate ?? 0),
      taxAmount: Number(invoice.tax_amount ?? 0),
      attached: !!attachment,
      portalUrl: portalUrl(),
      message: b.message,
    });

    const result = await sendMail({
      kind: 'INVOICE',
      to,
      subject: mail.subject,
      html: mail.html,
      attachmentPath: attachment ?? undefined,
      attachmentName: attachment ? `Invoice-${safeNumber}${path.extname(attachment)}` : undefined,
      invoiceId: id,
      bookingId: booking?.id ?? null,
      tripId: booking?.trip_id ?? null,
      userId: req.user!.id,
    });

    if (result.ok) {
      q.run(
        `UPDATE invoices SET sent_at = datetime('now'), sent_to = @to,
                status = CASE WHEN status = 'GENERATED' THEN 'SENT' ELSE status END,
                updated_at = datetime('now')
          WHERE id = @id`,
        { to, id }
      );
      if (booking) {
        recordTripEvent({
          bookingId: booking.id,
          tripId: booking.trip_id,
          status: 'EMAIL_SENT',
          title: 'Invoice emailed',
          detail: `${invoice.invoice_number} sent to ${to}`,
          userId: req.user!.id,
        });
      }
      audit(req, 'INVOICE_SENT', {
        entityType: 'invoice', entityId: id,
        description: `${invoice.invoice_number} emailed to ${to} from ${result.from}`,
      });
      return res.json({ ok: true, sentTo: to, from: result.from, message: result.message });
    }

    audit(req, 'INVOICE_SEND_FAILED', {
      entityType: 'invoice', entityId: id,
      description: `${invoice.invoice_number} to ${to} — ${result.message}`,
    });
    res.status(502).json({ error: result.message, logId: result.logId });
  });

export default router;
