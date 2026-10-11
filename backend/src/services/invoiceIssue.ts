/**
 * Rendering and issuing an invoice.
 *
 * `produceDocument` used to live inside routes/invoices.ts. It moved here so the
 * customer-trip flow can raise an invoice for one completed trip without
 * duplicating a line of the numbering, rendering or revision logic — the
 * document a customer downloads is produced by exactly the same code that
 * produces a vendor's.
 */
import path from 'path';
import { q, getDb } from '../db';
import { config } from '../config';
import { amountInWords, consolidate, round2, type TaxMode } from './billing';
import { buildInvoiceNumber, financialYearFor } from './invoiceNumber';
import {
  generateXlsx, generateDocx, generatePdf, invoiceOutputPath,
  convertToPdf, libreOfficeAvailable, type TemplateMapping,
} from './invoiceEngine';
import { buildInvoiceContext } from '../utils/context';
import { resolveBillTo } from './directCustomer';

export interface ProducedDocument {
  filePath: string | null;
  fileType: string;
  warnings: string[];
}

export async function produceDocument(args: {
  vendor: any;
  template: any | null;
  invoiceRow: Record<string, any>;
  bookings: any[];
  billing: Record<string, any>;
  fyCode: string;
  bucket?: string;
}): Promise<ProducedDocument> {
  const { vendor, template, invoiceRow, bookings, billing, fyCode } = args;
  const bucket = args.bucket ?? 'original';

  const billTo = resolveBillTo(vendor, bookings);
  const ctx = buildInvoiceContext({ vendor, invoice: invoiceRow, bookings, billing, billTo });
  const safeNumber = String(invoiceRow.invoiceNumber).replace(/[^A-Za-z0-9._-]/g, '-');
  const baseName = `INV-${safeNumber}_${vendor.code}`;

  if (!template) {
    // No vendor template assigned — fall back to the portal's own PDF layout.
    const out = invoiceOutputPath(fyCode, vendor.code, `${baseName}.pdf`, bucket);
    const r = await generatePdf(ctx, out, { title: invoiceRow.documentTitle ?? vendor.document_title ?? 'Tax Invoice' });
    return {
      filePath: path.relative(config.paths.invoices, r.path),
      fileType: 'pdf',
      warnings: [
        ...(vendor.code === 'DIRECT'
          ? []
          : [`${vendor.vendor_name} has no invoice template assigned, so the portal's standard PDF layout was used. ` +
             `Assign a template under Settings → Invoice Templates to match the vendor's own format.`]),
        ...r.warnings,
      ],
    };
  }

  const mapping: TemplateMapping = JSON.parse(template.mapping_json || '{}');
  const templatePath = path.join(config.paths.templates, template.file_name);

  if (template.file_type === 'xlsx') {
    const out = invoiceOutputPath(fyCode, vendor.code, `${baseName}.xlsx`, bucket);
    const r = await generateXlsx(templatePath, mapping, ctx, out);
    if (libreOfficeAvailable()) {
      try { convertToPdf(r.path, path.dirname(r.path)); } catch { /* optional */ }
    }
    return { filePath: path.relative(config.paths.invoices, r.path), fileType: 'xlsx', warnings: r.warnings };
  }

  if (template.file_type === 'docx') {
    const out = invoiceOutputPath(fyCode, vendor.code, `${baseName}.docx`, bucket);
    const r = await generateDocx(templatePath, mapping, ctx, out);
    if (libreOfficeAvailable()) {
      try { convertToPdf(r.path, path.dirname(r.path)); } catch { /* optional */ }
    }
    return { filePath: path.relative(config.paths.invoices, r.path), fileType: 'docx', warnings: r.warnings };
  }

  // pdf_static / pdf_fillable / anything else -> controlled PDF rebuild
  const out = invoiceOutputPath(fyCode, vendor.code, `${baseName}.pdf`, bucket);
  const r = await generatePdf(ctx, out, { title: template.document_title ?? vendor.document_title });
  return {
    filePath: path.relative(config.paths.invoices, r.path),
    fileType: 'pdf',
    warnings: [
      `Template "${template.name}" is a static PDF, so a controlled PDF was produced instead of filling the original.`,
      ...r.warnings,
    ],
  };
}

/* ==========================================================================
   Issuing an invoice for one completed customer trip
   ========================================================================== */

export interface IssueTripInvoiceInput {
  bookingId: number;
  /** GST invoice or not, and how the tax is split. */
  taxMode: TaxMode;
  taxRate: number;
  invoiceDate?: string;
  notes?: string;
  documentTitle?: string;
  userId: number;
}

export interface IssuedInvoice {
  invoiceId: number;
  invoiceNumber: string;
  filePath: string | null;
  fileType: string;
  total: number;
  warnings: string[];
}

/**
 * Raise a single-trip invoice.
 *
 * The number is reserved and the rows written in one transaction, then the
 * file is rendered outside it — file IO must never hold a database lock, and a
 * reserved number that fails to render is recoverable with Regenerate, whereas
 * a rendered file with no row is not.
 */
export async function issueTripInvoice(input: IssueTripInvoiceInput): Promise<IssuedInvoice> {
  const booking = q.get<any>(
    // b.id last so the booking's own id wins over booking_charges.id.
    `SELECT b.*, c.*, b.id AS id
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.id = @id`,
    { id: input.bookingId }
  );
  if (!booking) throw Object.assign(new Error('That trip no longer exists.'), { status: 404 });

  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: booking.vendor_id });
  if (!vendor) throw Object.assign(new Error('The billing account for this trip is missing.'), { status: 400 });

  const invoiceDate = input.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(invoiceDate);
  if (!fy) {
    throw Object.assign(
      new Error(`No financial year is configured for ${invoiceDate}. Add one under Settings → Financial Years.`),
      { status: 400 }
    );
  }

  const totals = consolidate([booking], input.taxMode, input.taxRate);
  const documentTitle = input.documentTitle
    ?? (input.taxMode === 'NONE' ? 'Invoice' : 'Tax Invoice');

  const template = vendor.invoice_template_id
    ? q.get<any>('SELECT * FROM invoice_templates WHERE id = @id AND is_active = 1', { id: vendor.invoice_template_id })
    : null;

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
    dueDate.setDate(dueDate.getDate() + Number(vendor.payment_terms_days ?? 0));

    const billTo = resolveBillTo(vendor, [booking]);

    const info = q.run(
      `INSERT INTO invoices (invoice_number, vendor_id, template_id, financial_year_id, invoice_date,
          due_date, period_from, period_to, booking_count, taxable_amount, tax_mode, tax_rate,
          cgst, sgst, igst, tax_amount, non_taxable_amount, discount, total_amount,
          paid_amount, outstanding_amount, status, revision, notes, generated_by,
          bill_to_name, bill_to_address, bill_to_gstin, bill_to_mobile)
       VALUES (@number, @vendorId, @templateId, @fyId, @date, @due, @travel, @travel, 1,
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
        travel: booking.travel_date,
        taxable: totals.taxableAmount,
        taxMode: totals.taxMode,
        taxRate: totals.taxRate,
        cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst,
        tax: totals.taxAmount,
        nonTaxable: totals.nonTaxableAmount,
        discount: totals.discount,
        total: totals.totalAmount,
        notes: input.notes ?? '',
        uid: input.userId,
        billToName: billTo.name,
        billToAddress: billTo.address,
        billToGstin: billTo.gstin,
        billToMobile: billTo.mobile,
      }
    );
    const invoiceId = Number(info.lastInsertRowid);

    q.run(
      `INSERT INTO invoice_items (invoice_id, booking_id, line_no, particular, qty, rate, amount)
       VALUES (@inv, @bk, 1, @particular, @qty, @rate, @amount)`,
      {
        inv: invoiceId,
        bk: booking.id,
        particular:
          [booking.duty_type, booking.pickup_location && `${booking.pickup_location} to ${booking.drop_location || '-'}`]
            .filter(Boolean).join(' — ') || 'Trip charges',
        qty: booking.extra_km || null,
        rate: booking.extra_km_rate || null,
        amount: round2(Number(booking.taxable_amount ?? 0)),
      }
    );

    q.run(
      `UPDATE bookings SET billing_status = 'INVOICED', updated_at = datetime('now') WHERE id = @id`,
      { id: booking.id }
    );

    return { invoiceId, invoiceNumber };
  })();

  const doc = await produceDocument({
    vendor,
    template,
    invoiceRow: {
      invoiceNumber: reserved.invoiceNumber,
      invoiceDate,
      dueDate: q.get<any>('SELECT due_date FROM invoices WHERE id = @id', { id: reserved.invoiceId })?.due_date,
      documentTitle,
      tripId: booking.trip_id,
      periodFrom: booking.travel_date,
      periodTo: booking.travel_date,
      amountInWords: amountInWords(totals.totalAmount),
      notes: input.notes ?? '',
    },
    bookings: [booking],
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
    { id: reserved.invoiceId, p: doc.filePath, total: totals.totalAmount, uid: input.userId }
  );

  return {
    invoiceId: reserved.invoiceId,
    invoiceNumber: reserved.invoiceNumber,
    filePath: doc.filePath,
    fileType: doc.fileType,
    total: totals.totalAmount,
    warnings: doc.warnings,
  };
}
