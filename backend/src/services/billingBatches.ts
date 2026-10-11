/**
 * Billing batches and the "what will this invoice say" preview.
 *
 * The preview is a dry run of invoice generation: the same eligibility rules,
 * the same grouping (one invoice per booking, or one consolidated invoice),
 * the same tax arithmetic (services/billing.ts) — and nothing written. The
 * Billing screen shows it before anything is issued, and a batch stores the
 * totals it showed so an approver sees exactly what the preparer saw.
 */
import { q, getDb } from '../db';
import { consolidate, round2, type TaxMode } from './billing';

export const OPEN_BATCH = `('DRAFT','PENDING_APPROVAL','APPROVED')`;

export interface PreviewLine {
  bookingId: number; tripId: string | null; bookingCode: string; travelDate: string;
  passenger: string | null; route: string; vehicle: string | null;
  baseFare: number; extras: number; allowances: number; discount: number;
  taxable: number; tax: number; reimbursables: number; total: number;
  taxMode: string; taxRate: number;
  problems: string[]; warnings: string[];
}

export interface PreviewGroup {
  bookingIds: number[];
  taxMode: string; taxRate: number;
  taxableAmount: number; cgst: number; sgst: number; igst: number; taxAmount: number;
  nonTaxableAmount: number; totalAmount: number;
}

export interface Preview {
  vendor: { id: number; name: string; code: string; consolidationAllowed: boolean; paymentTermsDays: number } | null;
  lines: PreviewLine[];
  groups: PreviewGroup[];
  totals: { count: number; taxable: number; tax: number; reimbursables: number; total: number };
  problems: string[];
  warnings: string[];
  ok: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function billingPreview(opts: {
  vendorId: number; bookingIds: number[]; separateInvoices?: boolean; batchId?: number;
}): Preview {
  const problems: string[] = [];
  const warnings: string[] = [];
  const vendorRow = q.get<any>('SELECT * FROM vendors WHERE id = @id', { id: opts.vendorId });
  if (!vendorRow) {
    return { vendor: null, lines: [], groups: [], totals: { count: 0, taxable: 0, tax: 0, reimbursables: 0, total: 0 }, problems: ['Choose a vendor.'], warnings, ok: false };
  }
  const ids = Array.from(new Set(opts.bookingIds.map(Number).filter((n) => n > 0)));
  if (!ids.length) problems.push('Select at least one trip to bill.');

  const rows = ids.length ? getDb().prepare(
    `SELECT b.*, c.*, b.id AS id,
            (SELECT i.invoice_number FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
              WHERE ii.booking_id = b.id AND i.status <> 'CANCELLED' LIMIT 1) AS live_invoice,
            (SELECT bb.batch_code FROM billing_batch_items bi JOIN billing_batches bb ON bb.id = bi.batch_id
              WHERE bi.booking_id = b.id AND bb.status IN ${OPEN_BATCH} AND bb.id <> ? LIMIT 1) AS other_batch
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.id IN (${ids.map(() => '?').join(',')}) ORDER BY b.travel_date, b.id`
  ).all(opts.batchId ?? 0, ...ids) as any[] : [];
  if (rows.length !== ids.length) problems.push('One or more of the selected trips no longer exist.');

  const lines: PreviewLine[] = rows.map((b) => {
    const p: string[] = [];
    const w: string[] = [];
    const ref = b.trip_id ?? b.booking_code;
    if (b.vendor_id !== opts.vendorId) p.push(`${ref} belongs to a different vendor.`);
    if (['CANCELLED', 'NO_SHOW'].includes(b.booking_status)) p.push(`${ref} is ${b.booking_status === 'NO_SHOW' ? 'a no-show' : 'cancelled'}.`);
    if (['DRAFT', 'INQUIRY'].includes(b.booking_status)) p.push(`${ref} is still ${b.booking_status === 'DRAFT' ? 'a draft' : 'an enquiry'}.`);
    if (b.live_invoice) p.push(`${ref} is already on invoice ${b.live_invoice}.`);
    if (b.other_batch) p.push(`${ref} is already in billing batch ${b.other_batch}.`);
    if (!(Number(b.total_amount) > 0)) p.push(`${ref} has no amount entered.`);
    if (b.travel_date > today()) p.push(`${ref} travels on ${b.travel_date} — a trip is billed after it has run.`);
    if (!['COMPLETED'].includes(b.booking_status) && !p.length) {
      w.push(`${ref} is not marked completed.`);
    }
    if (!b.vehicle_number && !p.length) w.push(`${ref} has no vehicle number — the invoice will print it blank.`);

    const extras = round2(Number(b.extra_km ?? 0) * Number(b.extra_km_rate ?? 0)
      + Number(b.extra_hours ?? 0) * Number(b.extra_hour_rate ?? 0)
      + Number(b.waiting_charge ?? 0) + Number(b.permit ?? 0) + Number(b.other_charges ?? 0));
    const allowances = round2(Number(b.driver_allowance ?? 0) + Number(b.night_charge ?? 0));
    return {
      bookingId: b.id, tripId: b.trip_id, bookingCode: b.booking_code, travelDate: b.travel_date,
      passenger: b.passenger_name || b.customer_name,
      route: [b.pickup_location, b.drop_location].filter(Boolean).join(' → '),
      vehicle: [b.vehicle_type, b.vehicle_number].filter(Boolean).join(' · ') || null,
      baseFare: round2(Number(b.base_fare ?? 0)), extras, allowances,
      discount: round2(Number(b.discount ?? 0)),
      taxable: round2(Number(b.taxable_amount ?? 0)), tax: round2(Number(b.tax_amount ?? 0)),
      reimbursables: round2(Number(b.non_taxable_amount ?? 0)), total: round2(Number(b.total_amount ?? 0)),
      taxMode: b.tax_mode ?? vendorRow.tax_mode, taxRate: Number(b.tax_rate ?? vendorRow.tax_rate ?? 0),
      problems: p, warnings: w,
    };
  });

  for (const l of lines) { problems.push(...l.problems); warnings.push(...l.warnings); }

  const consolidating = lines.length > 1 && !opts.separateInvoices;
  if (consolidating && !vendorRow.consolidation_allowed) {
    problems.push(`${vendorRow.vendor_name} is not set up for consolidated invoices. Tick "One invoice per trip", or allow consolidation on the vendor.`);
  }
  const treatments = new Set(lines.map((l) => `${l.taxMode}@${l.taxRate}`));
  if (consolidating && treatments.size > 1) {
    problems.push('The selected trips were not all priced with the same GST treatment. Bill them as one invoice per trip, or correct them first.');
  }
  if (vendorRow.invoice_template_id) {
    const t = q.get<any>('SELECT mode, is_active, name FROM invoice_templates WHERE id = @id', { id: vendorRow.invoice_template_id });
    if (!t || !t.is_active) problems.push(`The invoice template assigned to ${vendorRow.vendor_name} is missing or switched off.`);
    else if (t.mode === 'single' && consolidating) problems.push(`Template "${t.name}" holds one trip per invoice. Tick "One invoice per trip".`);
  }

  const groupsOf = consolidating ? [rows] : rows.map((r) => [r]);
  const groups: PreviewGroup[] = groupsOf.filter((g) => g.length).map((g) => {
    const taxMode = (g[0].tax_mode ?? vendorRow.tax_mode ?? 'IGST') as TaxMode;
    const taxRate = Number(g[0].tax_rate ?? vendorRow.tax_rate ?? 0);
    const t = consolidate(g, taxMode, taxRate);
    return {
      bookingIds: g.map((b: any) => b.id), taxMode: t.taxMode, taxRate: t.taxRate,
      taxableAmount: t.taxableAmount, cgst: t.cgst, sgst: t.sgst, igst: t.igst, taxAmount: t.taxAmount,
      nonTaxableAmount: t.nonTaxableAmount, totalAmount: t.totalAmount,
    };
  });

  const sum = (k: keyof PreviewGroup) => round2(groups.reduce((s, g) => s + Number(g[k] ?? 0), 0));
  return {
    vendor: {
      id: vendorRow.id, name: vendorRow.vendor_name, code: vendorRow.code,
      consolidationAllowed: !!vendorRow.consolidation_allowed, paymentTermsDays: Number(vendorRow.payment_terms_days ?? 30),
    },
    lines, groups,
    totals: { count: lines.length, taxable: sum('taxableAmount'), tax: sum('taxAmount'), reimbursables: sum('nonTaxableAmount'), total: sum('totalAmount') },
    problems: Array.from(new Set(problems)),
    warnings: Array.from(new Set(warnings)),
    ok: problems.length === 0,
  };
}

/** BB-2610-0001 — per month, like Trip IDs. */
export function nextBatchCode(): string {
  const d = new Date();
  const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const row = q.get<any>(
    `SELECT batch_code FROM billing_batches WHERE batch_code LIKE @p ORDER BY batch_code DESC LIMIT 1`,
    { p: `BB-${yymm}-%` }
  );
  const last = row ? Number(String(row.batch_code).split('-')[2]) : 0;
  return `BB-${yymm}-${String(last + 1).padStart(4, '0')}`;
}

export function batchDetail(id: number) {
  const batch = q.get<any>(
    `SELECT bb.*, v.vendor_name, v.code AS vendor_code,
            cu.full_name AS created_by_name, su.full_name AS submitted_by_name,
            au.full_name AS approved_by_name, bu.full_name AS billed_by_name, xu.full_name AS cancelled_by_name
       FROM billing_batches bb JOIN vendors v ON v.id = bb.vendor_id
       LEFT JOIN users cu ON cu.id = bb.created_by LEFT JOIN users su ON su.id = bb.submitted_by
       LEFT JOIN users au ON au.id = bb.approved_by LEFT JOIN users bu ON bu.id = bb.billed_by
       LEFT JOIN users xu ON xu.id = bb.cancelled_by
      WHERE bb.id = @id`, { id }
  );
  if (!batch) return null;
  const bookingIds = q.all<{ booking_id: number }>('SELECT booking_id FROM billing_batch_items WHERE batch_id = @id ORDER BY id', { id })
    .map((r) => r.booking_id);
  const invoiceIds: number[] = batch.invoice_ids ? JSON.parse(batch.invoice_ids) : [];
  return {
    batch,
    preview: billingPreview({ vendorId: batch.vendor_id, bookingIds, separateInvoices: !!batch.separate_invoices, batchId: id }),
    invoices: invoiceIds.length
      ? q.all<any>(`SELECT id, invoice_number, invoice_date, total_amount, status FROM invoices WHERE id IN (${invoiceIds.map(Number).join(',')})`)
      : [],
    history: q.all<any>(
      `SELECT a.action, a.description, a.created_at, a.user_email FROM audit_logs a
        WHERE a.entity_type = 'billing_batch' AND a.entity_id = @id ORDER BY a.id`, { id }
    ),
  };
}

/** Replace a batch's items and refresh the totals it stores. */
export function setBatchItems(batchId: number, vendorId: number, bookingIds: number[], separate: boolean) {
  const preview = billingPreview({ vendorId, bookingIds, separateInvoices: separate, batchId });
  getDb().transaction(() => {
    q.run('DELETE FROM billing_batch_items WHERE batch_id = @id', { id: batchId });
    for (const l of preview.lines) {
      q.run('INSERT INTO billing_batch_items (batch_id, booking_id, amount) VALUES (@b, @k, @a)', { b: batchId, k: l.bookingId, a: l.total });
    }
    q.run(
      `UPDATE billing_batches SET booking_count = @n, taxable_amount = @tx, tax_amount = @tax,
              non_taxable_amount = @nt, total_amount = @t WHERE id = @id`,
      { n: preview.totals.count, tx: preview.totals.taxable, tax: preview.totals.tax, nt: preview.totals.reimbursables, t: preview.totals.total, id: batchId }
    );
  })();
  return preview;
}
