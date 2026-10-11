/**
 * Payments & Ledger — money RECEIVED from companies, and money PAID OUT to suppliers.
 *
 *   /api/payments              receipts and their allocations to invoices (receivables)
 *   /api/payments/payables     what is owed to, and paid to, vehicle owners and partners
 *   (ledger.ts)                register, receipts split across invoices, unallocated
 *                              balances, company ledger, adjustments, reconciliation
 *
 * Every receipt is a payment_transactions row; each `payments` row is the share
 * of one receipt allocated to one invoice. The single-invoice endpoints below
 * (used by the invoice screen and older clients) create a one-allocation
 * receipt. The money rules live in services/ledger.ts.
 *
 * An invoice's paid and outstanding figures are always recomputed from its
 * allocation rows (resyncInvoice), never adjusted by hand, and a mistaken
 * payment is reversed — the row stays, marked reversed, with who and why.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';
import { sendTable, filterNote } from '../utils/exportSheet';
import {
  LedgerError, validMode, latestAllowedDate, createReceipt, invoicePaise, toPaise, rupees, resyncInvoice,
  unallocatePayment, reverseTransaction, txnAllocatedPaise, payables,
} from '../services/ledger';
import ledgerRoutes, { sendLedgerError } from './ledger';

export { resyncInvoice };

const router = Router();
router.use(requireAuth);
router.use(ledgerRoutes);

const paymentSchema = z.object({
  invoiceId: z.coerce.number().int().positive('Choose an invoice.'),
  paymentDate: isoDate,
  amount: z.coerce.number().positive('Payment amount must be more than zero.'),
  mode: z.string().trim().min(2, 'Choose a payment method.').max(40).default('BANK_TRANSFER').transform((s) => s.toUpperCase()),
  referenceNo: z.string().trim().max(80).optional().default(''),
  bank: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(400).optional().default(''),
  /** Set after the office has seen the possible-duplicate warning. */
  allowDuplicate: z.coerce.boolean().default(false),
  duplicateReason: z.string().trim().max(200).optional().default(''),
});

function listFilters(p: Record<string, string>) {
  const params = {
    vendorId: p.vendorId ? Number(p.vendorId) : 0,
    invoiceId: p.invoiceId ? Number(p.invoiceId) : 0,
    from: p.from ?? '', to: p.to ?? '', mode: p.mode ?? '', search: (p.search ?? '').trim(),
    reversed: p.reversed ?? '',   // '' = live only, 'all', 'only'
  };
  const where = `
    WHERE (@vendorId = 0 OR p.vendor_id = @vendorId)
      AND (@invoiceId = 0 OR p.invoice_id = @invoiceId)
      AND (@from = '' OR p.payment_date >= @from)
      AND (@to = '' OR p.payment_date <= @to)
      AND (@mode = '' OR p.mode = @mode)
      AND ((@reversed = '' AND p.is_reversed = 0) OR @reversed = 'all' OR (@reversed = 'only' AND p.is_reversed = 1))
      AND (@search = '' OR i.invoice_number LIKE '%'||@search||'%'
                        OR p.reference_no LIKE '%'||@search||'%'
                        OR v.vendor_name LIKE '%'||@search||'%'
                        OR i.bill_to_name LIKE '%'||@search||'%'
                        OR t.txn_code LIKE '%'||@search||'%')`;
  return { params, where };
}

const LIST_SQL = (where: string) => `
    SELECT p.*, i.invoice_number, i.invoice_date, i.total_amount AS invoice_total, i.outstanding_amount,
           i.status AS invoice_status, i.bill_to_name, t.txn_code,
           v.vendor_name, v.code AS vendor_code, u.full_name AS created_by_name, ru.full_name AS reversed_by_name
      FROM payments p
      JOIN invoices i ON i.id = p.invoice_id
      JOIN vendors v ON v.id = p.vendor_id
      LEFT JOIN payment_transactions t ON t.id = p.transaction_id
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN users ru ON ru.id = p.reversed_by
      ${where}`;

/** Allocations (payment rows) — one per receipt and invoice. */
router.get('/', requirePermission('payments.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const limit = Math.min(Number(p.limit ?? 100), 500);
  const offset = Math.max(0, Number(p.offset ?? 0));
  const data = q.all<any>(`${LIST_SQL(where)} ORDER BY p.payment_date DESC, p.id DESC LIMIT @limit OFFSET @offset`, { ...params, limit, offset });
  const agg = q.get<any>(
    `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN p.is_reversed = 0 THEN CAST(ROUND(p.amount*100) AS INTEGER) END),0) / 100.0 amount
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN vendors v ON v.id = p.vendor_id
       LEFT JOIN payment_transactions t ON t.id = p.transaction_id ${where}`,
    params
  );
  res.json({ data, ...agg });
});

/** Received / pending / overdue at a glance, and the same split per vendor. */
router.get('/summary', requirePermission('payments.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const from = p.from ?? '', to = p.to ?? '';
  const totals = q.get<any>(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM payments WHERE is_reversed = 0
          AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)) AS received,
       (SELECT COUNT(*) FROM payments WHERE is_reversed = 0
          AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)) AS receipts,
       (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices WHERE status NOT IN ('CANCELLED','PAID')) AS pending,
       (SELECT COUNT(*) FROM invoices WHERE status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0.009) AS pending_count,
       (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices WHERE status NOT IN ('CANCELLED','PAID')
          AND outstanding_amount > 0.009 AND due_date < date('now','localtime')) AS overdue,
       (SELECT COUNT(*) FROM invoices WHERE status NOT IN ('CANCELLED','PAID')
          AND outstanding_amount > 0.009 AND due_date < date('now','localtime')) AS overdue_count`,
    { from, to }
  );
  const byVendor = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name,
            (SELECT COALESCE(SUM(total_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED') AS invoiced,
            (SELECT COALESCE(SUM(amount),0) FROM payments pp WHERE pp.vendor_id = v.id AND pp.is_reversed = 0
               AND (@from = '' OR pp.payment_date >= @from) AND (@to = '' OR pp.payment_date <= @to)) AS received_in_period,
            (SELECT COALESCE(SUM(paid_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED') AS received,
            (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')) AS outstanding,
            (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')
               AND i.outstanding_amount > 0.009 AND i.due_date < date('now','localtime')) AS overdue,
            (SELECT MAX(payment_date) FROM payments pp WHERE pp.vendor_id = v.id AND pp.is_reversed = 0) AS last_payment
       FROM vendors v
      ORDER BY outstanding DESC, v.vendor_name`, { from, to }
  ).filter((r) => Number(r.invoiced) > 0);
  const byMode = q.all<any>(
    `SELECT mode, COUNT(*) AS count, COALESCE(SUM(amount),0) AS amount FROM payments
      WHERE is_reversed = 0 AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)
      GROUP BY mode ORDER BY amount DESC`, { from, to }
  );
  res.json({ totals, byVendor, byMode });
});

/** Invoices that can take a payment — optionally one company's, oldest first. */
router.get('/open-invoices', requirePermission('payments.view', 'payments.create'), (req, res) => {
  const search = String(req.query.search ?? '').trim();
  const vendorId = Number(req.query.vendorId ?? 0) || 0;
  res.json({
    data: q.all<any>(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.paid_amount, i.outstanding_amount,
              i.status, i.bill_to_name, v.vendor_name, v.id AS vendor_id,
              CASE WHEN i.due_date < date('now','localtime') THEN 1 ELSE 0 END AS is_overdue
         FROM invoices i JOIN vendors v ON v.id = i.vendor_id
        WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009
          AND (@v = 0 OR i.vendor_id = @v)
          AND (@s = '' OR i.invoice_number LIKE '%'||@s||'%' OR v.vendor_name LIKE '%'||@s||'%' OR i.bill_to_name LIKE '%'||@s||'%')
        ORDER BY ${vendorId ? 'i.invoice_date, COALESCE(i.due_date, i.invoice_date), i.id' : 'i.due_date, i.invoice_date'} LIMIT ${vendorId ? 1000 : 200}`,
      { s: search, v: vendorId }
    ),
  });
});

/** Record a payment against ONE invoice — a receipt with a single allocation. */
router.post('/', requirePermission('payments.create'), validateBody(paymentSchema), (req, res) => {
  const b = req.body as z.infer<typeof paymentSchema>;
  if (!validMode(b.mode)) return res.status(400).json({ error: `"${b.mode}" is not an active payment method. Choose one from the list.` });
  const invoice = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: b.invoiceId });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  if (invoice.status === 'CANCELLED') {
    return res.status(409).json({ error: `${invoice.invoice_number} is cancelled — payments cannot be recorded against it.` });
  }
  // A payment may pre-date its invoice (an advance), but not today's calendar.
  if (b.paymentDate > latestAllowedDate()) {
    return res.status(400).json({ error: 'A payment cannot be dated in the future. Record it on the day it is received.' });
  }
  const amountP = toPaise(b.amount);
  const outstandingP = Math.max(0, invoicePaise(b.invoiceId).outstanding);
  if (amountP > outstandingP) {
    return res.status(400).json({
      error: `Payment of ₹${rupees(amountP).toFixed(2)} is more than the ₹${rupees(outstandingP).toFixed(2)} outstanding on ${invoice.invoice_number}.`,
    });
  }

  // The same receipt entered twice is the commonest mistake: same invoice,
  // same amount, same reference (or same day without one).
  if (!b.allowDuplicate) {
    const dup = q.get<any>(
      `SELECT id, payment_date, amount, reference_no FROM payments
        WHERE invoice_id = @i AND is_reversed = 0 AND CAST(ROUND(amount*100) AS INTEGER) = @a
          AND ((@ref <> '' AND lower(reference_no) = lower(@ref)) OR (@ref = '' AND payment_date = @d))
        LIMIT 1`,
      { i: b.invoiceId, a: amountP, ref: b.referenceNo, d: b.paymentDate }
    );
    if (dup) {
      return res.status(409).json({
        code: 'POSSIBLE_DUPLICATE',
        error: `₹${rupees(amountP)} was already recorded against ${invoice.invoice_number} on ${dup.payment_date}` +
          `${dup.reference_no ? ` (ref ${dup.reference_no})` : ''}. Save again only if this is a second, separate payment.`,
      });
    }
  }

  let r;
  try {
    r = createReceipt({
      vendorId: invoice.vendor_id, txnDate: b.paymentDate, amount: b.amount, mode: b.mode,
      referenceNo: b.referenceNo, bank: b.bank, remarks: b.notes,
      allocations: [{ invoiceId: b.invoiceId, amount: b.amount }],
      allowDuplicate: b.allowDuplicate, duplicateReason: b.duplicateReason, legacyDuplicateConfirm: true,
    }, req.user!.id);
  } catch (e) { return sendLedgerError(res, e); }
  const alloc = r.allocations[0];

  audit(req, 'PAYMENT_ADDED', {
    entityType: 'payment', entityId: alloc.paymentId,
    description: `₹${rupees(amountP)} received against ${invoice.invoice_number} via ${b.mode}${b.referenceNo ? ` (ref ${b.referenceNo})` : ''} — ${r.txn.txn_code}`,
    meta: { invoiceId: b.invoiceId, transactionId: r.txn.id, before: Number(invoice.outstanding_amount), after: alloc.invoice.outstanding,
      ...(b.allowDuplicate ? { duplicateOverride: b.duplicateReason || 'Confirmed as a separate payment' } : {}) },
  });

  res.status(201).json({
    ok: true,
    data: q.get('SELECT * FROM payments WHERE id = @id', { id: alloc.paymentId }),
    transaction: { id: r.txn.id, txn_code: r.txn.txn_code },
    invoice: alloc.invoice,
    message: alloc.invoice.outstanding <= 0
      ? `Payment recorded (${r.txn.txn_code}). ${invoice.invoice_number} is now fully paid.`
      : `Payment recorded (${r.txn.txn_code}). ₹${alloc.invoice.outstanding.toFixed(2)} still outstanding on ${invoice.invoice_number}.`,
  });
});

/**
 * Reverse a payment row (an allocation).
 *   - If it is the whole of its receipt (the usual single-invoice payment),
 *     the receipt itself is reversed: the money is treated as not received.
 *   - If the receipt was split across invoices or has an unallocated balance,
 *     only this allocation is taken back and its amount returns to the
 *     receipt's unallocated balance (reverse the receipt from the register to
 *     undo the money itself).
 */
function reverse(req: any, res: any) {
  const id = Number(req.params.id);
  const payment = q.get<any>('SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = @id', { id });
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.is_reversed) return res.status(409).json({ error: 'This payment has already been reversed.' });
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the payment is being reversed.' });

  try {
    const txn = payment.transaction_id ? q.get<any>('SELECT * FROM payment_transactions WHERE id = @id', { id: payment.transaction_id }) : null;
    const wholeReceipt = txn && !txn.is_reversed && txnAllocatedPaise(txn.id) === toPaise(payment.amount) && toPaise(txn.amount) === toPaise(payment.amount);
    if (wholeReceipt) {
      const r = reverseTransaction(txn.id, reason, req.user!.id);
      const state = r.invoices.find((x) => x.invoiceId === payment.invoice_id) ?? resyncInvoice(payment.invoice_id);
      audit(req, 'PAYMENT_REVERSED', {
        entityType: 'payment', entityId: id,
        description: `₹${payment.amount} on ${payment.invoice_number} reversed (receipt ${txn.txn_code}) — ${reason}`,
      });
      return res.json({ ok: true, invoice: state, message: `Payment reversed. ₹${state.outstanding.toFixed(2)} is outstanding on ${payment.invoice_number}.` });
    }
    const r = unallocatePayment(id, reason, req.user!.id);
    audit(req, 'PAYMENT_REVERSED', {
      entityType: 'payment', entityId: id,
      description: `₹${payment.amount} on ${payment.invoice_number} reversed${txn ? ` — returned to ${txn.txn_code} unallocated` : ''} — ${reason}`,
    });
    return res.json({
      ok: true, invoice: r.invoice, unallocated: r.unallocated,
      message: `Payment taken off ${payment.invoice_number}. ₹${r.invoice.outstanding.toFixed(2)} is outstanding` +
        (txn ? `; ₹${r.unallocated.toFixed(2)} of receipt ${txn.txn_code} is now unallocated.` : '.'),
    });
  } catch (e) { return sendLedgerError(res, e); }
}

router.post('/:id/reverse', requirePermission('payments.delete', 'payments.update'), reverse);
/** Kept for older screens: "delete" is a reversal now. */
router.delete('/:id', requirePermission('payments.delete'), (req, res) => {
  if (!req.body?.reason) req.body = { ...(req.body ?? {}), reason: 'Removed from the payments list' };
  return reverse(req, res);
});

/** Bulk mark-paid used by the invoice list's "Mark Paid" action — one receipt per company. */
router.post('/bulk-settle', requirePermission('payments.create'), (req, res) => {
  const ids = (req.body?.invoiceIds ?? []) as number[];
  const paymentDate = String(req.body?.paymentDate ?? new Date().toISOString().slice(0, 10));
  const mode = String(req.body?.mode ?? 'BANK_TRANSFER').toUpperCase();
  const referenceNo = String(req.body?.referenceNo ?? '').trim();
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Select at least one invoice.' });
  if (!validMode(mode)) return res.status(400).json({ error: `"${mode}" is not an active payment method.` });
  if (paymentDate > latestAllowedDate()) return res.status(400).json({ error: 'A payment cannot be dated in the future.' });

  const settled: string[] = [];
  const skipped: string[] = [];
  const byVendor = new Map<number, { invoiceId: number; amount: number; number: string }[]>();
  for (const id of ids) {
    const inv = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: Number(id) });
    if (!inv) continue;
    const out = inv.status === 'CANCELLED' ? 0 : invoicePaise(inv.id).outstanding;
    if (out <= 0) { skipped.push(inv.invoice_number); continue; }
    const list = byVendor.get(inv.vendor_id) ?? [];
    list.push({ invoiceId: inv.id, amount: rupees(out), number: inv.invoice_number });
    byVendor.set(inv.vendor_id, list);
  }

  const receipts: string[] = [];
  // Each company's receipt is atomic on its own (createReceipt runs in a DB transaction).
  try {
    for (const [vendorId, list] of byVendor) {
      const total = rupees(list.reduce((s, x) => s + toPaise(x.amount), 0));
      const r = createReceipt({
        vendorId, txnDate: paymentDate, amount: total, mode, referenceNo, remarks: 'Bulk settlement',
        allocations: list.map((x) => ({ invoiceId: x.invoiceId, amount: x.amount })),
        allowDuplicate: true, legacyDuplicateConfirm: true,
      }, req.user!.id);
      receipts.push(r.txn.txn_code);
      settled.push(...list.map((x) => x.number));
    }
  } catch (e) {
    if (e instanceof LedgerError && settled.length === 0) return sendLedgerError(res, e);
    if (!(e instanceof LedgerError)) throw e;
    skipped.push(`(stopped: ${e.message})`);
  }

  audit(req, 'PAYMENT_ADDED', { description: `Bulk settled ${settled.length} invoice(s)`, meta: { settled, skipped, receipts } });
  res.json({
    ok: true, settled, skipped, receipts,
    message: `${settled.length} invoice(s) marked paid${skipped.length ? `, ${skipped.length} skipped` : ''}.`,
  });
});

router.get('/export', requirePermission('payments.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const { params, where } = listFilters(p);
  const rows = q.all<any>(`${LIST_SQL(where)} ORDER BY p.payment_date DESC, p.id DESC`, params);
  await sendTable(res, 'payments-received', {
    name: 'Payments', title: 'Payments received (allocations to invoices)',
    notes: [filterNote({ From: params.from, To: params.to, Method: params.mode, Search: params.search, Reversals: params.reversed || 'excluded' })],
    columns: [
      { key: 'payment_date', header: 'Date', kind: 'date' }, { key: 'txn_code', header: 'Receipt', kind: 'id' },
      { key: 'invoice_number', header: 'Invoice no.', kind: 'id' },
      { key: 'vendor_name', header: 'Vendor' }, { key: 'bill_to_name', header: 'Billed to' },
      { key: 'amount', header: 'Amount', kind: 'money' }, { key: 'mode', header: 'Method' },
      { key: 'reference_no', header: 'Reference', kind: 'id' }, { key: 'bank', header: 'Bank' },
      { key: 'invoice_total', header: 'Invoice total', kind: 'money' }, { key: 'outstanding_amount', header: 'Invoice outstanding now', kind: 'money' },
      { key: 'created_by_name', header: 'Recorded by' },
      { key: 'is_reversed', header: 'Reversed', value: (r) => (r.is_reversed ? 'Yes' : 'No') },
      { key: 'reversal_reason', header: 'Reversal reason' }, { key: 'notes', header: 'Notes', width: 30 },
    ],
    rows,
    totals: ['amount'],
  }, p.format);
});

/* ==========================================================================
   Payables — what is owed to vehicle owners and partners
   ========================================================================== */

router.get('/payables', requirePermission('payments.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const rows = payables(p.from ?? '', p.to ?? '');
  const sum = (k: 'payable' | 'paid' | 'balance') => rupees(rows.reduce((s, r) => s + toPaise(r[k]), 0));
  res.json({
    data: rows,
    totals: { payable: sum('payable'), paid: sum('paid'), balance: sum('balance') },
    trips: q.all<any>(
      `SELECT b.id, b.trip_id, b.travel_date, b.supplier_name, b.supplier_cost, b.vehicle_number, b.booking_status,
              c.total_amount AS billed
         FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
        WHERE b.supplier_cost > 0 AND b.booking_status NOT IN ('CANCELLED','NO_SHOW','INQUIRY','DRAFT')
          AND (@from = '' OR b.travel_date >= @from) AND (@to = '' OR b.travel_date <= @to)
        ORDER BY b.travel_date DESC LIMIT 300`, { from: p.from ?? '', to: p.to ?? '' }
    ),
    payments: q.all<any>(
      `SELECT sp.*, b.trip_id, u.full_name AS created_by_name FROM supplier_payments sp
         LEFT JOIN bookings b ON b.id = sp.booking_id LEFT JOIN users u ON u.id = sp.created_by
        WHERE (@from = '' OR sp.payment_date >= @from) AND (@to = '' OR sp.payment_date <= @to)
        ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 300`, { from: p.from ?? '', to: p.to ?? '' }
    ),
  });
});

const supplierPaymentSchema = z.object({
  payeeName: z.string().trim().min(2, 'Enter who was paid.').max(120),
  bookingId: z.coerce.number().int().positive().nullable().optional(),
  paymentDate: isoDate,
  amount: z.coerce.number().positive('Amount must be more than zero.').max(9_999_999),
  mode: z.string().trim().min(2).max(40).default('BANK_TRANSFER').transform((s) => s.toUpperCase()),
  referenceNo: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(400).optional().default(''),
});

router.post('/payables', requirePermission('payments.create'), validateBody(supplierPaymentSchema), (req, res) => {
  const b = req.body as z.infer<typeof supplierPaymentSchema>;
  if (!validMode(b.mode)) return res.status(400).json({ error: `"${b.mode}" is not an active payment method.` });
  if (b.paymentDate > latestAllowedDate()) return res.status(400).json({ error: 'A payout cannot be dated in the future.' });
  if (b.bookingId && !q.get('SELECT id FROM bookings WHERE id = @id', { id: b.bookingId })) {
    return res.status(400).json({ error: 'That trip does not exist.' });
  }
  const balance = payables('', '').find((r) => r.payee.trim().toLowerCase() === b.payeeName.trim().toLowerCase());
  if (!balance) {
    return res.status(400).json({ error: `Nothing is owed to ${b.payeeName}. Record a supplier cost on their trips first (Trips → Fare → Supplier cost).` });
  }
  if (toPaise(b.amount) > toPaise(balance.balance)) {
    return res.status(400).json({ error: `Only ₹${balance.balance.toFixed(2)} is owed to ${balance.payee}. Record the trip costs first if more is due.` });
  }
  const info = q.run(
    `INSERT INTO supplier_payments (payee_name, booking_id, payment_date, amount, mode, reference_no, notes, created_by)
     VALUES (@p, @b, @d, @a, @m, @r, @n, @u)`,
    { p: balance.payee, b: b.bookingId ?? null, d: b.paymentDate, a: rupees(toPaise(b.amount)), m: b.mode, r: b.referenceNo || null, n: b.notes || null, u: req.user!.id }
  );
  audit(req, 'SUPPLIER_PAYMENT_ADDED', { entityType: 'supplier_payment', entityId: Number(info.lastInsertRowid), description: `₹${rupees(toPaise(b.amount))} paid to ${balance.payee} via ${b.mode}` });
  res.status(201).json({ ok: true, message: `₹${rupees(toPaise(b.amount))} paid to ${balance.payee} recorded.` });
});

router.post('/payables/:id/reverse', requirePermission('payments.delete', 'payments.update'), (req, res) => {
  const id = Number(req.params.id);
  const sp = q.get<any>('SELECT * FROM supplier_payments WHERE id = @id', { id });
  if (!sp) return res.status(404).json({ error: 'That payout does not exist.' });
  if (sp.is_reversed) return res.status(409).json({ error: 'This payout is already reversed.' });
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the payout is being reversed.' });
  q.run(`UPDATE supplier_payments SET is_reversed = 1, reversed_at = datetime('now'), reversed_by = @u, reversal_reason = @r WHERE id = @id`,
    { u: req.user!.id, r: reason, id });
  audit(req, 'SUPPLIER_PAYMENT_REVERSED', { entityType: 'supplier_payment', entityId: id, description: `₹${sp.amount} to ${sp.payee_name} reversed — ${reason}` });
  res.json({ ok: true, message: 'Payout reversed.' });
});

router.get('/payables/export', requirePermission('payments.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const rows = payables(p.from ?? '', p.to ?? '');
  await sendTable(res, 'supplier-settlement', {
    name: 'Payables', title: 'Supplier payables and settlement',
    notes: [filterNote({ From: p.from, To: p.to }), 'Amounts payable to vehicle owners and partners. Not included in invoice receivables.'],
    columns: [
      { key: 'payee', header: 'Payee' }, { key: 'trips', header: 'Trips', kind: 'number' },
      { key: 'payable', header: 'Payable', kind: 'money' }, { key: 'paid', header: 'Paid', kind: 'money' },
      { key: 'balance', header: 'Balance due', kind: 'money' }, { key: 'last_paid', header: 'Last paid', kind: 'date' },
    ],
    rows, totals: ['payable', 'paid', 'balance'],
  }, p.format);
});

export default router;
