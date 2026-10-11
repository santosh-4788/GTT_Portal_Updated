/**
 * Generating invoices from bookings — shared by the Invoices screen and the
 * billing batches, so a batch that is approved and billed produces exactly
 * what the direct "Generate invoice" button produces: the same validation,
 * the same numbering, the same document, the same audit entries.
 *
 * Moved out of routes/invoices.ts unchanged apart from returning its answer
 * instead of writing it to the response.
 */
import { unconfirmed, unconfirmedMessage } from './billingConfirm';
import type { Request } from 'express';
import { z } from 'zod';
import { q, getDb } from '../db';
import { audit } from '../middleware/audit';
import { isoDate } from '../utils/validate';
import { consolidate, amountInWords, round2, TaxMode } from './billing';
import { buildInvoiceNumber, financialYearFor } from './invoiceNumber';
import { produceDocument } from './invoiceIssue';
import { resolveBillTo } from './directCustomer';

export const generateSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose a vendor.'),
  bookingIds: z.array(z.coerce.number().int().positive()).min(1, 'Select at least one booking.'),
  invoiceDate: isoDate.optional(),
  periodFrom: z.union([isoDate, z.literal('')]).optional(),
  periodTo: z.union([isoDate, z.literal('')]).optional(),
  notes: z.string().trim().optional().default(''),
  /** Force one invoice per booking even when the vendor allows consolidation. */
  separateInvoices: z.coerce.boolean().default(false),
});

export type GenerateInput = z.infer<typeof generateSchema>;

export interface GenerateOutcome {
  invoiceId: number;
  invoiceNumber: string;
  filePath: string | null;
  fileType: string;
  total: number;
  warnings: string[];
}

export interface GenerateResult { status: number; body: any }

const fail = (status: number, body: any): GenerateResult => ({ status, body });

export async function generateInvoices(
  input: GenerateInput,
  req: Request,
  opts: { batchId?: number } = {}
): Promise<GenerateResult> {
  const vendor = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: input.vendorId });
  if (!vendor) return fail(400, { error: 'The selected vendor no longer exists.' });

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
    return fail(400, { error: 'One or more selected bookings no longer exist.' });
  }
  const wrongVendor = bookings.find((b) => b.vendor_id !== input.vendorId);
  if (wrongVendor) {
    return fail(400, {
      error: `Booking ${wrongVendor.booking_code} belongs to a different vendor. An invoice can only cover one vendor.`,
    });
  }
  const cancelled = bookings.find((b) => b.booking_status === 'CANCELLED');
  if (cancelled) {
    return fail(400, { error: `Booking ${cancelled.booking_code} is cancelled and cannot be invoiced.` });
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
    return fail(409, {
      error: `Booking ${alreadyInvoiced.booking_code} has already been invoiced on ${alreadyInvoiced.invoice_number}.`,
    });
  }
  // A booking waiting in a billing batch belongs to that batch: invoicing it
  // from anywhere else would bill it twice once the batch is approved.
  const inBatch = getDb()
    .prepare(
      `SELECT b.booking_code, bb.batch_code FROM billing_batch_items bi
         JOIN billing_batches bb ON bb.id = bi.batch_id JOIN bookings b ON b.id = bi.booking_id
        WHERE bi.booking_id IN (${placeholders})
          AND bb.status IN ('DRAFT','PENDING_APPROVAL','APPROVED') AND bb.id <> ? LIMIT 1`
    )
    .get(...input.bookingIds, opts.batchId ?? 0) as any;
  if (inBatch) {
    return fail(409, {
      error: `Booking ${inBatch.booking_code} is in billing batch ${inBatch.batch_code}. Bill it from that batch, or remove it from the batch first.`,
    });
  }
  // An approved billing batch is itself the confirmation; anything else must
  // have been confirmed trip by trip.
  if (!opts.batchId) {
    const pending = unconfirmed(input.bookingIds);
    if (pending.length) return fail(409, { code: 'BILLING_NOT_CONFIRMED', error: unconfirmedMessage(pending), unconfirmed: pending });
  }
  const unpriced = bookings.find((b) => !b.total_amount || Number(b.total_amount) <= 0);
  if (unpriced) {
    return fail(400, {
      error: `Booking ${unpriced.booking_code} has no amount entered. Open it and enter the amount before invoicing.`,
    });
  }

  const consolidating = bookings.length > 1 && !input.separateInvoices;
  if (consolidating && !vendor.consolidation_allowed) {
    return fail(400, {
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
    return fail(400, {
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
    return fail(400, {
      error: `The invoice template assigned to ${vendor.vendor_name} is missing or deactivated. ` +
        `Reassign one under Settings → Invoice Templates.`,
    });
  }
  if (template && template.mode === 'single' && consolidating) {
    return fail(400, {
      error: `Template "${template.name}" only supports one booking per invoice. ` +
        `Tick "Separate invoice per booking", or assign a consolidated template to ${vendor.vendor_name}.`,
    });
  }

  const invoiceDate = input.invoiceDate ?? new Date().toISOString().slice(0, 10);
  const fy = financialYearFor(invoiceDate);
  if (!fy) {
    return fail(400, {
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
          dueDate: q.get<any>('SELECT due_date FROM invoices WHERE id = @id', { id: reserved.invoiceId })?.due_date,
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
    return fail(500, {
      error: `Invoice generation failed: ${err.message}`,
      partial: outcomes,
    });
  }

  return {
    status: 201,
    body: {
      ok: true,
      invoices: outcomes,
      warnings: Array.from(new Set(allWarnings)),
      message: outcomes.length === 1
        ? `Invoice ${outcomes[0].invoiceNumber} generated successfully.`
        : `${outcomes.length} invoices generated successfully.`,
    },
  };
}
