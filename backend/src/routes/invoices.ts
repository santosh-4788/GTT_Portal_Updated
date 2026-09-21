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

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
router.get('/', requirePermission('invoices.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    search: p.search ?? '',
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    from: p.from ?? '',
    to: p.to ?? '',
    status: p.status ?? '',
    limit: Math.min(Number(p.limit ?? 50), 500),
    offset: Number(p.offset ?? 0),
  };
  const where = `
    WHERE (@search = '' OR i.invoice_number LIKE '%'||@search||'%' OR v.vendor_name LIKE '%'||@search||'%')
      AND (@vendorId = 0 OR i.vendor_id = @vendorId)
      AND (@from = '' OR i.invoice_date >= @from)
      AND (@to = '' OR i.invoice_date <= @to)
      AND (@status = '' OR i.status = @status)`;

  const data = q.all<any>(
    `SELECT i.*, v.vendor_name, v.code AS vendor_code, v.company_name,
            u.full_name AS generated_by_name
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
       LEFT JOIN users u ON u.id = i.generated_by
       ${where}
      ORDER BY i.invoice_date DESC, i.id DESC LIMIT @limit OFFSET @offset`,
    params
  );
  const agg = q.get<any>(
    `SELECT COUNT(*) total, COALESCE(SUM(i.total_amount),0) amount,
            COALESCE(SUM(i.paid_amount),0) paid, COALESCE(SUM(i.outstanding_amount),0) outstanding
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id ${where}`,
    params
  );
  res.json({ data, ...agg });
});

// ---------------------------------------------------------------------------
router.get('/:id', requirePermission('invoices.view'), (req, res) => {
  const invoice = q.get<any>(
    `SELECT i.*, v.vendor_name, v.code AS vendor_code, v.company_name, v.gst_number,
            v.billing_address, t.name AS template_name, u.full_name AS generated_by_name
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
    'SELECT * FROM payments WHERE invoice_id = @id ORDER BY payment_date DESC', { id: req.params.id }
  );
  const revisions = q.all<any>(
    'SELECT * FROM invoice_revisions WHERE invoice_id = @id ORDER BY revision DESC', { id: req.params.id }
  );
  res.json({ data: invoice, items, payments, revisions });
});

// ---------------------------------------------------------------------------
// Generate — the heart of the system
// ---------------------------------------------------------------------------
const generateSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose a vendor.'),
  bookingIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one booking.'),
  invoiceDate: isoDate.optional(),
  periodFrom: z.union([isoDate, z.literal('')]).optional(),
  periodTo: z.union([isoDate, z.literal('')]).optional(),
  notes: z.string().trim().optional().default(''),
  /** Force one invoice per booking even when the vendor allows consolidation. */
  separateInvoices: z.coerce.boolean().default(false),
});

interface GenerateOutcome {
  invoiceId: number;
  invoiceNumber: string;
  filePath: string | null;
  fileType: string;
  total: number;
  warnings: string[];
}

router.post('/generate', requirePermission('invoices.create'), validateBody(generateSchema), async (req, res) => {
  const input = req.body as z.infer<typeof generateSchema>;

  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: input.vendorId });
  if (!vendor) return res.status(400).json({ error: 'The selected vendor no longer exists.' });

  const placeholders = input.bookingIds.map(() => '?').join(',');
  const bookings = getDb()
    .prepare(
      `SELECT b.*, c.* , b.id AS id
         FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
        WHERE b.id IN (${placeholders}) ORDER BY b.travel_date, b.id`
    )
    .all(...input.bookingIds) as any[];

  // ---- validation with plain-language errors ----
  if (bookings.length !== input.bookingIds.length) {
    return res.status(400).json({ error: 'One or more selected bookings no longer exist.' });
  }
  const wrongVendor = bookings.find((b) => b.vendor_id !== input.vendorId);
  if (wrongVendor) {
    return res.status(400).json({
      error: `Booking ${wrongVendor.booking_code} belongs to a different vendor. An invoice can only cover one vendor.`,
    });
  }
  const cancelled = bookings.find((b) => b.booking_status === 'CANCELLED');
  if (cancelled) {
    return res.status(400).json({ error: `Booking ${cancelled.booking_code} is cancelled and cannot be invoiced.` });
  }
  const alreadyInvoiced = getDb()
    .prepare(
      `SELECT b.booking_code, i.invoice_number
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         JOIN bookings b ON b.id = ii.booking_id
        WHERE ii.booking_id IN (${placeholders}) AND i.status <> 'CANCELLED' LIMIT 1`
    )
    .get(...input.bookingIds) as any;
  if (alreadyInvoiced) {
    return res.status(409).json({
      error: `Booking ${alreadyInvoiced.booking_code} has already been invoiced on ${alreadyInvoiced.invoice_number}.`,
    });
  }
  const unpriced = bookings.find((b) => !b.total_amount || Number(b.total_amount) <= 0);
  if (unpriced) {
    return res.status(400).json({
      error: `Booking ${unpriced.booking_code} has no amount entered. Open it and enter the amount before invoicing.`,
    });
  }

  const consolidating = bookings.length > 1 && !input.separateInvoices;
  if (consolidating && !vendor.consolidation_allowed) {
    return res.status(400).json({
      error: `${vendor.vendor_name} is not configured for consolidated invoices. ` +
        `Either enable "Consolidation allowed" on the vendor, or tick "Separate invoice per booking".`,
    });
  }

  // Each booking stores the GST treatment it was priced with, and the booking
  // form lets that differ from the vendor's default per job. Putting taxed and
  // untaxed bookings on one invoice has no right answer, so say so rather than
  // silently picking one of them.
  const treatments = new Set(
    bookings.map((b) => `${b.tax_mode ?? vendor.tax_mode}@${Number(b.tax_rate ?? vendor.tax_rate)}`)
  );
  if (consolidating && treatments.size > 1) {
    return res.status(400).json({
      error:
        'The selected bookings were not all priced the same way — some carry GST and some do not, ' +
        'or the rates differ. Tick "Separate invoice per booking", or edit the bookings so they agree.',
    });
  }

  const template = vendor.invoice_template_id
    ? q.get<any>('SELECT * FROM invoice_templates WHERE id = @id AND is_active = 1',
        { id: vendor.invoice_template_id })
    : null;

  if (vendor.invoice_template_id && !template) {
    return res.status(400).json({
      error: `The invoice template assigned to ${vendor.vendor_name} is missing or deactivated. ` +
        `Reassign one under Settings → Invoice Templates.`,
    });
  }
  if (template && template.mode === 'single' && consolidating) {
    return res.status(400).json({
      error: `Template "${template.name}" only supports one booking per invoice. ` +
        `Tick "Separate invoice per booking", or assign a consolidated template to ${vendor.vendor_name}.`,
    });
  }

  const invoiceDate = input.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(invoiceDate);
  if (!fy) {
    return res.status(400).json({
      error: `No financial year is configured for ${invoiceDate}. Add one under Settings → Financial Years.`,
    });
  }

  const groups = consolidating ? [bookings] : bookings.map((b) => [b]);
  const outcomes: GenerateOutcome[] = [];
  const allWarnings: string[] = [];

  try {
    for (const group of groups) {
      // Taken from the bookings so a "without GST" booking stays without GST.
      const taxMode = ((group[0].tax_mode ?? vendor.tax_mode) ?? 'IGST') as TaxMode;
      const taxRate = Number(group[0].tax_rate ?? vendor.tax_rate ?? 0);
      const totals = consolidate(group, taxMode, taxRate);
      // For a counter booking the invoice is addressed to the customer, not to
      // the reserved Direct Customer record the booking hangs off.
      const billTo = resolveBillTo(vendor, group);

      // Reserve the number + write the DB rows atomically, then render the file.
      const reserved = getDb().transaction(() => {
        const { invoiceNumber } = buildInvoiceNumber({
          prefix: vendor.invoice_prefix || 'GTT',
          format: vendor.invoice_number_format || '{PREFIX}/{FY}/{SEQ:5}',
          vendorCode: vendor.code,
          perVendorSequence: /\{VENDOR\}/.test(vendor.invoice_number_format ?? ''),
          financialYear: fy,
          invoiceDate,
        });

        const dueDate = new Date(invoiceDate + 'T00:00:00');
        dueDate.setDate(dueDate.getDate() + Number(vendor.payment_terms_days ?? 30));

        const info = q.run(
          `INSERT INTO invoices (invoice_number, vendor_id, template_id, financial_year_id, invoice_date,
              due_date, period_from, period_to, booking_count, taxable_amount, tax_mode, tax_rate,
              cgst, sgst, igst, tax_amount, non_taxable_amount, discount, total_amount,
              paid_amount, outstanding_amount, status, revision, notes, generated_by,
              bill_to_name, bill_to_address, bill_to_gstin, bill_to_mobile)
           VALUES (@number, @vendorId, @templateId, @fyId, @date, @due, @pFrom, @pTo, @count,
              @taxable, @taxMode, @taxRate, @cgst, @sgst, @igst, @tax, @nonTaxable, @discount,
              @total, 0, @total, 'GENERATED', 1, @notes, @uid,
              @billToName, @billToAddress, @billToGstin, @billToMobile)`,
          {
            number: invoiceNumber,
            vendorId: vendor.id,
            templateId: template?.id ?? null,
            fyId: fy.id,
            date: invoiceDate,
            due: dueDate.toISOString().slice(0, 10),
            pFrom: input.periodFrom || group[0].travel_date,
            pTo: input.periodTo || group[group.length - 1].travel_date,
            count: group.length,
            taxable: totals.taxableAmount,
            taxMode: totals.taxMode,
            taxRate: totals.taxRate,
            cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst,
            tax: totals.taxAmount,
            nonTaxable: totals.nonTaxableAmount,
            discount: totals.discount,
            total: totals.totalAmount,
            notes: input.notes,
            uid: req.user!.id,
            billToName: billTo.name,
            billToAddress: billTo.address,
            billToGstin: billTo.gstin,
            billToMobile: billTo.mobile,
          }
        );
        const invoiceId = Number(info.lastInsertRowid);

        group.forEach((b, i) => {
          q.run(
            `INSERT INTO invoice_items (invoice_id, booking_id, line_no, particular, qty, rate, amount)
             VALUES (@inv, @bk, @line, @particular, @qty, @rate, @amount)`,
            {
              inv: invoiceId, bk: b.id, line: i + 1,
              particular: [b.duty_type, b.pickup_location && `${b.pickup_location} to ${b.drop_location ?? '-'}`]
                .filter(Boolean).join(' — ') || 'Trip charges',
              qty: b.extra_km || null,
              rate: b.extra_km_rate || null,
              amount: round2(Number(b.taxable_amount ?? 0)),
            }
          );
          q.run(
            `UPDATE bookings SET billing_status = 'INVOICED', updated_at = datetime('now') WHERE id = @id`,
            { id: b.id }
          );
        });

        return { invoiceId, invoiceNumber };
      })();

      // Render outside the transaction — file IO must not hold a DB lock.
      const doc = await produceDocument({
        vendor, template,
        invoiceRow: {
          invoiceNumber: reserved.invoiceNumber,
          invoiceDate,
          documentTitle: template?.document_title ?? vendor.document_title ?? 'Tax Invoice',
          periodFrom: input.periodFrom || group[0].travel_date,
          periodTo: input.periodTo || group[group.length - 1].travel_date,
          amountInWords: amountInWords(totals.totalAmount),
          notes: input.notes,
        },
        bookings: group,
        billing: { ...totals },
        fyCode: fy.code,
      });

      q.run(
        `UPDATE invoices SET file_path = @p, file_type = @t, updated_at = datetime('now') WHERE id = @id`,
        { p: doc.filePath, t: doc.fileType, id: reserved.invoiceId }
      );
      q.run(
        `INSERT INTO invoice_revisions (invoice_id, revision, file_path, total_amount, reason, created_by)
         VALUES (@id, 1, @p, @total, 'Initial generation', @uid)`,
        { id: reserved.invoiceId, p: doc.filePath, total: totals.totalAmount, uid: req.user!.id }
      );

      allWarnings.push(...doc.warnings);
      outcomes.push({
        invoiceId: reserved.invoiceId,
        invoiceNumber: reserved.invoiceNumber,
        filePath: doc.filePath,
        fileType: doc.fileType,
        total: totals.totalAmount,
        warnings: doc.warnings,
      });

      audit(req, 'INVOICE_GENERATED', {
        entityType: 'invoice', entityId: reserved.invoiceId,
        description: `${reserved.invoiceNumber} for ${vendor.vendor_name} — ${group.length} booking(s), ₹${totals.totalAmount}`,
        meta: { bookingIds: group.map((b) => b.id), template: template?.name ?? 'built-in PDF' },
      });
    }
  } catch (err: any) {
    return res.status(500).json({
      error: `Invoice generation failed: ${err.message}`,
      partial: outcomes,
    });
  }

  res.status(201).json({
    ok: true,
    invoices: outcomes,
    warnings: Array.from(new Set(allWarnings)),
    message: outcomes.length === 1
      ? `Invoice ${outcomes[0].invoiceNumber} generated successfully.`
      : `${outcomes.length} invoices generated successfully.`,
  });
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
  if (!abs.startsWith(config.paths.invoices) || !fs.existsSync(abs)) {
    return res.status(404).json({ error: 'The generated file is missing from disk. Regenerate the invoice.' });
  }

  const asPdf = String(req.query.format ?? '').toLowerCase() === 'pdf';
  const pdfTwin = abs.replace(/\.[^.]+$/, '.pdf');
  const send = asPdf && fs.existsSync(pdfTwin) ? pdfTwin : abs;

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
      if (!attachment.toLowerCase().endsWith('.pdf') && fs.existsSync(twin)) {
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
