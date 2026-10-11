/**
 * Payments & Ledger — the money rules, in one place.
 *
 * Model
 * -----
 *   payment_transactions   one row per movement of money (a receipt, IN). It
 *                          carries the full amount received, even the part not
 *                          yet matched to an invoice (the "unallocated" or
 *                          advance balance).
 *   payments               one row per ALLOCATION of a receipt to ONE invoice.
 *                          A receipt may be split across many invoices; an
 *                          invoice may take many receipts.
 *   ledger_adjustments     TDS, write-offs, rounding, credit notes. Positive =
 *                          reduces what the company owes. An adjustment linked
 *                          to an invoice also reduces that invoice's outstanding.
 *   ledger_opening_balances  what a company owed before the portal (+ = owes us).
 *
 * Exactness
 * ---------
 * Every calculation is done in integer paise (toPaise / SQL `PAISE()`), never
 * by adding floating rupees, and stored back as rupees with two decimals.
 *
 * Allocation rules
 * ----------------
 *   - an allocation is always > 0 and never more than the invoice's outstanding
 *     (total − live allocations − live invoice-linked adjustments)
 *   - the allocations of one receipt never add up to more than its amount
 *   - an invoice must belong to the receipt's company
 *   - allocating the same receipt to the same invoice again MERGES into the
 *     existing live allocation (one row per receipt+invoice), never a second row
 *   - reversing an allocation ("unallocate") returns its amount to the receipt's
 *     unallocated balance; reversing a receipt reverses all its allocations
 *   - nothing is deleted: reversals are flags with who, when and why
 *
 * Ledger rules (company ledger)
 * -----------------------------
 *   debit  (company owes more):  opening balance (if positive), invoices
 *                                (not cancelled) on their invoice date,
 *                                reversal of a receipt (on the reversal date),
 *                                negative adjustments, reversal of an adjustment
 *   credit (company owes less):  receipts on their date — the FULL receipt,
 *                                including any unallocated advance — and
 *                                positive adjustments
 *   Opening for a range = every line dated before `from`, so outstanding from
 *   earlier periods is always carried in. Cancelled invoices never appear.
 */
import { q, getDb } from '../db';
import { backfillPaymentTransactions } from './bootstrap';

/* --------------------------------------------------------------------------
   Money helpers
   -------------------------------------------------------------------------- */

/** Rupees (number or string) → integer paise, robust to float noise (1.005 → 101). */
export function toPaise(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Number((n * 100).toFixed(4)));
}
/** Integer paise → rupees with at most two decimals. */
export const rupees = (p: number): number => Math.round(p) / 100;
/** SQL: sum of a REAL rupee column, in integer paise. */
export const PAISE = (expr: string) => `COALESCE(SUM(CAST(ROUND(${expr} * 100) AS INTEGER)),0)`;

export class LedgerError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

const inrText = (p: number) => `₹${rupees(p).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* --------------------------------------------------------------------------
   Payment methods & dates
   -------------------------------------------------------------------------- */

const BUILT_IN_MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'OTHER'];
/** Payment methods come from Masters → Payment methods (active ones). */
export function validMode(mode: string): boolean {
  const row = q.get<{ is_active: number }>(
    `SELECT is_active FROM master_values WHERE list_type = 'PAYMENT_MODE' AND code = @c`, { c: mode }
  );
  return row ? !!row.is_active : BUILT_IN_MODES.includes(mode);
}

/** Tomorrow (UTC) — a payment dated later than this is in the future wherever the office is. */
export const latestAllowedDate = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

/** Make sure every allocation has a transaction (rows written by older code paths). */
export function ensureTransactionLinks(): void {
  try {
    const orphan = q.get<{ c: number }>('SELECT COUNT(*) c FROM payments WHERE transaction_id IS NULL');
    if (orphan && orphan.c > 0) backfillPaymentTransactions();
  } catch { /* never block a read */ }
}

/* --------------------------------------------------------------------------
   Invoice state
   -------------------------------------------------------------------------- */

export interface InvoicePaise { total: number; paid: number; adjusted: number; outstanding: number }

export function invoicePaise(invoiceId: number): InvoicePaise & { inv: any } {
  const inv = q.get<any>('SELECT * FROM invoices WHERE id = @id', { id: invoiceId });
  if (!inv) throw new LedgerError(404, 'Invoice not found.');
  const paid = q.get<any>(`SELECT ${PAISE('amount')} p FROM payments WHERE invoice_id = @id AND is_reversed = 0`, { id: invoiceId })!.p;
  const adjusted = q.get<any>(
    `SELECT ${PAISE('amount')} p FROM ledger_adjustments WHERE invoice_id = @id AND is_reversed = 0`, { id: invoiceId }
  )!.p;
  const total = toPaise(inv.total_amount);
  return { inv, total, paid, adjusted, outstanding: total - paid - adjusted };
}

/**
 * Recompute an invoice's paid / outstanding / status from its allocation rows
 * (and invoice-linked adjustments) — the single source of truth.
 * `paid_amount` is money received only; adjustments reduce outstanding.
 */
export function resyncInvoice(invoiceId: number) {
  const { inv, paid, adjusted, outstanding } = invoicePaise(invoiceId);
  let status = inv.status;
  if (status !== 'CANCELLED') {
    if (paid <= 0 && adjusted <= 0) status = inv.sent_at || inv.status === 'SENT' ? 'SENT' : 'GENERATED';
    else if (outstanding > 0) status = 'PARTIALLY_PAID';
    else status = 'PAID';
  }
  const out = Math.max(0, outstanding);
  q.run(
    `UPDATE invoices SET paid_amount = @paid, outstanding_amount = @out, status = @status,
            updated_at = datetime('now') WHERE id = @id`,
    { paid: rupees(paid), out: rupees(out), status, id: invoiceId }
  );
  return { paid: rupees(paid), adjusted: rupees(adjusted), outstanding: rupees(out), status };
}

/* --------------------------------------------------------------------------
   Transactions
   -------------------------------------------------------------------------- */

export function txnAllocatedPaise(txnId: number): number {
  return q.get<any>(`SELECT ${PAISE('amount')} p FROM payments WHERE transaction_id = @t AND is_reversed = 0`, { t: txnId })!.p;
}

/** Allocation status of a receipt, as text (never colour only on screen). */
export function allocationStatus(isReversed: number | boolean, amountP: number, allocatedP: number): string {
  if (isReversed) return 'REVERSED';
  if (allocatedP <= 0) return 'UNALLOCATED';
  if (allocatedP >= amountP) return 'ALLOCATED';
  return 'PARTLY_ALLOCATED';
}

function nextTxnCode(direction: 'IN' | 'OUT', date: string): string {
  const prefix = `${direction === 'IN' ? 'RCPT' : 'PAY'}-${date.slice(2, 4)}${date.slice(5, 7)}-`;
  const last = q.get<{ txn_code: string }>(
    `SELECT txn_code FROM payment_transactions WHERE txn_code LIKE @p || '%' ORDER BY length(txn_code) DESC, txn_code DESC LIMIT 1`,
    { p: prefix }
  );
  const n = last ? Number(last.txn_code.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, '0')}`;
}

/** A live receipt from the same company with the same reference/UTR. */
export function findDuplicateReference(vendorId: number, ref: string, excludeTxnId = 0) {
  const clean = String(ref ?? '').trim();
  if (!clean) return null;
  return q.get<any>(
    `SELECT t.id, t.txn_code, t.txn_date, t.amount, t.reference_no FROM payment_transactions t
      WHERE t.direction = 'IN' AND t.is_reversed = 0 AND t.vendor_id = @v AND t.id <> @x
        AND lower(replace(trim(t.reference_no),' ','')) = lower(replace(@r,' ',''))
      LIMIT 1`, { v: vendorId, r: clean, x: excludeTxnId }
  ) ?? null;
}

export interface AllocationInput { invoiceId: number; amount: number | string }

/** Merge repeated invoices in one request, reject negatives, drop zeros. */
function normaliseAllocations(list: AllocationInput[] | undefined): Map<number, number> {
  const m = new Map<number, number>();
  for (const a of list ?? []) {
    const id = Number(a.invoiceId);
    const p = toPaise(a.amount);
    if (!Number.isInteger(id) || id <= 0) throw new LedgerError(400, 'Each allocation needs an invoice.');
    if (p < 0) throw new LedgerError(400, 'An allocation cannot be negative.');
    if (p === 0) continue;
    m.set(id, (m.get(id) ?? 0) + p);
  }
  return m;
}

export interface AllocationResult { paymentId: number; invoiceId: number; invoiceNumber: string; amount: number; merged: boolean; invoice: ReturnType<typeof resyncInvoice> }

/** Apply allocations to a live IN transaction. Must run inside a DB transaction. */
function applyAllocations(txn: any, allocs: Map<number, number>, userId: number | null): AllocationResult[] {
  const totalP = Array.from(allocs.values()).reduce((s, p) => s + p, 0);
  const freeP = toPaise(txn.amount) - txnAllocatedPaise(txn.id);
  if (totalP > freeP) {
    throw new LedgerError(400,
      `The allocations add up to ${inrText(totalP)} but only ${inrText(freeP)} of ${txn.txn_code} is unallocated.`, 'OVER_ALLOCATED_RECEIPT');
  }
  const out: AllocationResult[] = [];
  for (const [invoiceId, p] of allocs) {
    const st = invoicePaise(invoiceId);
    if (st.inv.status === 'CANCELLED') {
      throw new LedgerError(409, `${st.inv.invoice_number} is cancelled — payments cannot be recorded against it.`);
    }
    if (txn.vendor_id && st.inv.vendor_id !== txn.vendor_id) {
      throw new LedgerError(400, `${st.inv.invoice_number} belongs to a different company than this receipt.`);
    }
    if (p > st.outstanding) {
      throw new LedgerError(400,
        `Payment of ${inrText(p)} is more than the ${inrText(Math.max(0, st.outstanding))} outstanding on ${st.inv.invoice_number}.`, 'OVER_ALLOCATED_INVOICE');
    }
    const existing = q.get<any>(
      'SELECT id, amount FROM payments WHERE transaction_id = @t AND invoice_id = @i AND is_reversed = 0 LIMIT 1',
      { t: txn.id, i: invoiceId }
    );
    let paymentId: number;
    if (existing) {
      // One live allocation per receipt + invoice: a second allocation merges.
      q.run('UPDATE payments SET amount = @a WHERE id = @id', { a: rupees(toPaise(existing.amount) + p), id: existing.id });
      paymentId = existing.id;
    } else {
      const info = q.run(
        `INSERT INTO payments (invoice_id, vendor_id, payment_date, amount, mode, reference_no, bank, notes, created_by, transaction_id)
         VALUES (@inv, @v, @d, @a, @m, @ref, @bank, @notes, @u, @t)`,
        { inv: invoiceId, v: st.inv.vendor_id, d: txn.txn_date, a: rupees(p), m: txn.mode, ref: txn.reference_no ?? '',
          bank: txn.bank ?? '', notes: txn.remarks ?? '', u: userId, t: txn.id }
      );
      paymentId = Number(info.lastInsertRowid);
    }
    out.push({ paymentId, invoiceId, invoiceNumber: st.inv.invoice_number, amount: rupees(p), merged: !!existing, invoice: resyncInvoice(invoiceId) });
  }
  return out;
}

export interface ReceiptInput {
  vendorId: number;
  txnDate: string;
  amount: number | string;
  mode: string;
  referenceNo?: string;
  bank?: string;
  remarks?: string;
  partyName?: string;
  source?: 'MANUAL' | 'IMPORT';
  allocations?: AllocationInput[];
  allowDuplicate?: boolean;
  duplicateReason?: string;
  /** Legacy single-invoice screens confirm a duplicate without typing a reason. */
  legacyDuplicateConfirm?: boolean;
}

/** Record money received: one transaction, zero or more allocations, all or nothing. */
export function createReceipt(input: ReceiptInput, userId: number | null) {
  const amountP = toPaise(input.amount);
  if (amountP <= 0) throw new LedgerError(400, 'The amount received must be more than zero.');
  const mode = String(input.mode || 'BANK_TRANSFER').toUpperCase();
  if (!validMode(mode)) throw new LedgerError(400, `"${mode}" is not an active payment method. Choose one from the list.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.txnDate)) throw new LedgerError(400, 'Date must be in YYYY-MM-DD format.');
  if (input.txnDate > latestAllowedDate()) {
    throw new LedgerError(400, 'A payment cannot be dated in the future. Record it on the day it is received.');
  }
  const vendor = q.get<any>('SELECT id, vendor_name FROM vendors WHERE id = @id', { id: input.vendorId });
  if (!vendor) throw new LedgerError(400, 'Choose the company the money came from.');
  const ref = String(input.referenceNo ?? '').trim();

  if (!input.allowDuplicate) {
    const dup = findDuplicateReference(vendor.id, ref);
    if (dup) {
      throw new LedgerError(409,
        `Reference ${ref} from ${vendor.vendor_name} is already recorded as ${dup.txn_code} (${inrText(toPaise(dup.amount))} on ${dup.txn_date}). ` +
        'One transfer that settles several invoices should be one receipt split across them. Save again only if this is a separate payment, and say why.',
        'POSSIBLE_DUPLICATE', { duplicateOf: dup });
    }
  } else if (findDuplicateReference(vendor.id, ref) && !input.legacyDuplicateConfirm && String(input.duplicateReason ?? '').trim().length < 3) {
    throw new LedgerError(400, 'Say why this is a separate payment with the same reference.', 'DUPLICATE_REASON_REQUIRED');
  }

  const allocs = normaliseAllocations(input.allocations);

  return getDb().transaction(() => {
    const code = nextTxnCode('IN', input.txnDate);
    const info = q.run(
      `INSERT INTO payment_transactions (txn_code, direction, vendor_id, party_name, txn_date, amount, mode, reference_no, bank, remarks, source, created_by)
       VALUES (@code, 'IN', @v, @party, @d, @a, @m, @ref, @bank, @remarks, @src, @u)`,
      { code, v: vendor.id, party: input.partyName || vendor.vendor_name, d: input.txnDate, a: rupees(amountP), m: mode,
        ref: ref || null, bank: input.bank || null, remarks: input.remarks || null, src: input.source ?? 'MANUAL', u: userId }
    );
    const txn = q.get<any>('SELECT * FROM payment_transactions WHERE id = @id', { id: Number(info.lastInsertRowid) })!;
    const allocations = applyAllocations(txn, allocs, userId);
    const allocatedP = txnAllocatedPaise(txn.id);
    return { txn, allocations, vendor, allocated: rupees(allocatedP), unallocated: rupees(amountP - allocatedP) };
  })();
}

function liveInTxn(txnId: number) {
  const txn = q.get<any>('SELECT * FROM payment_transactions WHERE id = @id', { id: txnId });
  if (!txn) throw new LedgerError(404, 'That receipt does not exist.');
  if (txn.direction !== 'IN') throw new LedgerError(400, 'Only receipts can be allocated to invoices.');
  if (txn.is_reversed) throw new LedgerError(409, `${txn.txn_code} has been reversed.`);
  return txn;
}

/** Allocate (part of) a receipt's unallocated balance to invoices. */
export function allocateTransaction(txnId: number, list: AllocationInput[], userId: number | null) {
  const allocs = normaliseAllocations(list);
  if (!allocs.size) throw new LedgerError(400, 'Enter an amount against at least one invoice.');
  return getDb().transaction(() => {
    const txn = liveInTxn(txnId);
    const allocations = applyAllocations(txn, allocs, userId);
    const allocatedP = txnAllocatedPaise(txn.id);
    return { txn, allocations, allocated: rupees(allocatedP), unallocated: rupees(toPaise(txn.amount) - allocatedP) };
  })();
}

/** Take one allocation back: the money stays on the receipt as unallocated. */
export function unallocatePayment(paymentId: number, reason: string, userId: number | null) {
  if (String(reason ?? '').trim().length < 3) throw new LedgerError(400, 'Say why the allocation is being reversed.');
  return getDb().transaction(() => {
    const p = q.get<any>('SELECT p.*, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = @id', { id: paymentId });
    if (!p) throw new LedgerError(404, 'Payment not found.');
    if (p.is_reversed) throw new LedgerError(409, 'This payment has already been reversed.');
    q.run(`UPDATE payments SET is_reversed = 1, reversed_at = datetime('now'), reversed_by = @u, reversal_reason = @r WHERE id = @id`,
      { u: userId, r: reason.trim(), id: paymentId });
    const invoice = resyncInvoice(p.invoice_id);
    const txn = p.transaction_id ? q.get<any>('SELECT * FROM payment_transactions WHERE id = @id', { id: p.transaction_id }) : null;
    const unallocated = txn ? rupees(toPaise(txn.amount) - txnAllocatedPaise(txn.id)) : 0;
    return { payment: p, invoice, txn, unallocated };
  })();
}

/** Reverse a whole receipt: the transaction and every live allocation. */
export function reverseTransaction(txnId: number, reason: string, userId: number | null) {
  if (String(reason ?? '').trim().length < 3) throw new LedgerError(400, 'Say why the receipt is being reversed.');
  return getDb().transaction(() => {
    const txn = q.get<any>('SELECT * FROM payment_transactions WHERE id = @id', { id: txnId });
    if (!txn) throw new LedgerError(404, 'That receipt does not exist.');
    if (txn.is_reversed) throw new LedgerError(409, `${txn.txn_code} has already been reversed.`);
    const live = q.all<any>('SELECT id, invoice_id, amount FROM payments WHERE transaction_id = @t AND is_reversed = 0', { t: txnId });
    q.run(`UPDATE payment_transactions SET is_reversed = 1, reversed_at = datetime('now'), reversed_by = @u, reversal_reason = @r WHERE id = @id`,
      { u: userId, r: reason.trim(), id: txnId });
    q.run(`UPDATE payments SET is_reversed = 1, reversed_at = datetime('now'), reversed_by = @u, reversal_reason = @r
            WHERE transaction_id = @t AND is_reversed = 0`, { u: userId, r: `Receipt ${txn.txn_code} reversed — ${reason.trim()}`, t: txnId });
    const invoices = Array.from(new Set(live.map((l) => l.invoice_id))).map((id) => ({ invoiceId: id, ...resyncInvoice(id) }));
    return { txn, invoices, allocationsReversed: live.length };
  })();
}

export function transactionDetail(txnId: number) {
  const txn = q.get<any>(
    `SELECT t.*, v.vendor_name, v.code AS vendor_code, u.full_name AS created_by_name, ru.full_name AS reversed_by_name
       FROM payment_transactions t LEFT JOIN vendors v ON v.id = t.vendor_id
       LEFT JOIN users u ON u.id = t.created_by LEFT JOIN users ru ON ru.id = t.reversed_by
      WHERE t.id = @id`, { id: txnId });
  if (!txn) throw new LedgerError(404, 'That receipt does not exist.');
  const allocations = q.all<any>(
    `SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.is_reversed, p.reversed_at, p.reversal_reason, p.created_at,
            i.invoice_number, i.invoice_date, i.total_amount, i.outstanding_amount, i.status AS invoice_status,
            u.full_name AS created_by_name, ru.full_name AS reversed_by_name
       FROM payments p JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users ru ON ru.id = p.reversed_by
      WHERE p.transaction_id = @id ORDER BY p.is_reversed, p.id`, { id: txnId });
  const allocatedP = txnAllocatedPaise(txnId);
  const amountP = toPaise(txn.amount);
  return {
    ...txn, allocations,
    allocated: rupees(allocatedP), unallocated: txn.is_reversed ? 0 : rupees(amountP - allocatedP),
    allocation_status: allocationStatus(txn.is_reversed, amountP, allocatedP),
  };
}

/** Open invoices of a company, oldest first — the order auto-allocation follows. */
export function openInvoicesFor(vendorId: number) {
  return q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.total_amount, i.paid_amount, i.outstanding_amount,
            i.status, i.bill_to_name, i.vendor_id,
            CASE WHEN i.due_date < date('now','localtime') THEN 1 ELSE 0 END AS is_overdue
       FROM invoices i
      WHERE i.vendor_id = @v AND i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0.009
      ORDER BY i.invoice_date, COALESCE(i.due_date, i.invoice_date), i.id`, { v: vendorId });
}

/* --------------------------------------------------------------------------
   Opening balance & adjustments
   -------------------------------------------------------------------------- */

export const ADJUSTMENT_KINDS = ['TDS', 'WRITE_OFF', 'ROUNDING', 'CREDIT_NOTE', 'OTHER'] as const;

export function setOpeningBalance(vendorId: number, asOfDate: string, amount: number | string, notes: string, userId: number | null) {
  const vendor = q.get<any>('SELECT id, vendor_name FROM vendors WHERE id = @id', { id: vendorId });
  if (!vendor) throw new LedgerError(404, 'Company not found.');
  const before = q.get<any>('SELECT * FROM ledger_opening_balances WHERE vendor_id = @v', { v: vendorId }) ?? null;
  q.run(
    `INSERT INTO ledger_opening_balances (vendor_id, as_of_date, amount, notes, updated_at, updated_by)
     VALUES (@v, @d, @a, @n, datetime('now'), @u)
     ON CONFLICT(vendor_id) DO UPDATE SET as_of_date = excluded.as_of_date, amount = excluded.amount,
       notes = excluded.notes, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    { v: vendorId, d: asOfDate, a: rupees(toPaise(amount)), n: notes || null, u: userId }
  );
  return { vendor, before, after: q.get<any>('SELECT * FROM ledger_opening_balances WHERE vendor_id = @v', { v: vendorId }) };
}

export interface AdjustmentInput { adjDate: string; amount: number | string; kind: string; invoiceId?: number | null; remarks?: string }

export function addAdjustment(vendorId: number, a: AdjustmentInput, userId: number | null) {
  const vendor = q.get<any>('SELECT id, vendor_name FROM vendors WHERE id = @id', { id: vendorId });
  if (!vendor) throw new LedgerError(404, 'Company not found.');
  const p = toPaise(a.amount);
  if (p === 0) throw new LedgerError(400, 'An adjustment needs an amount.');
  const kind = String(a.kind || 'OTHER').toUpperCase();
  if (!(ADJUSTMENT_KINDS as readonly string[]).includes(kind)) throw new LedgerError(400, `Choose the kind of adjustment (${ADJUSTMENT_KINDS.join(', ')}).`);
  if (a.adjDate > latestAllowedDate()) throw new LedgerError(400, 'An adjustment cannot be dated in the future.');
  return getDb().transaction(() => {
    let invoice: any = null;
    if (a.invoiceId) {
      const st = invoicePaise(Number(a.invoiceId));
      if (st.inv.vendor_id !== vendorId) throw new LedgerError(400, `${st.inv.invoice_number} belongs to a different company.`);
      if (st.inv.status === 'CANCELLED') throw new LedgerError(409, `${st.inv.invoice_number} is cancelled.`);
      if (p < 0) throw new LedgerError(400, 'An adjustment against an invoice must reduce what is owed (a positive amount).');
      if (p > st.outstanding) {
        throw new LedgerError(400, `${inrText(p)} is more than the ${inrText(Math.max(0, st.outstanding))} outstanding on ${st.inv.invoice_number}.`);
      }
      invoice = st.inv;
    }
    const info = q.run(
      `INSERT INTO ledger_adjustments (vendor_id, adj_date, amount, kind, invoice_id, remarks, created_by)
       VALUES (@v, @d, @a, @k, @i, @r, @u)`,
      { v: vendorId, d: a.adjDate, a: rupees(p), k: kind, i: invoice?.id ?? null, r: a.remarks || null, u: userId }
    );
    const state = invoice ? resyncInvoice(invoice.id) : null;
    return { id: Number(info.lastInsertRowid), vendor, invoice, state, amount: rupees(p), kind };
  })();
}

export function reverseAdjustment(id: number, reason: string) {
  if (String(reason ?? '').trim().length < 3) throw new LedgerError(400, 'Say why the adjustment is being reversed.');
  return getDb().transaction(() => {
    const adj = q.get<any>('SELECT * FROM ledger_adjustments WHERE id = @id', { id });
    if (!adj) throw new LedgerError(404, 'That adjustment does not exist.');
    if (adj.is_reversed) throw new LedgerError(409, 'This adjustment is already reversed.');
    // The table has no reversal columns; the reason is appended to the remarks
    // (and recorded in the audit log) so the ledger can show it.
    q.run(`UPDATE ledger_adjustments SET is_reversed = 1,
             remarks = trim(COALESCE(remarks,'') || ' [Reversed ' || date('now','localtime') || ': ' || @r || ']') WHERE id = @id`,
      { r: reason.trim(), id });
    const state = adj.invoice_id ? resyncInvoice(adj.invoice_id) : null;
    return { adj, state };
  })();
}

/* --------------------------------------------------------------------------
   Company ledger
   -------------------------------------------------------------------------- */

export type LedgerKind = 'OPENING' | 'INVOICE' | 'RECEIPT' | 'RECEIPT_REVERSAL' | 'ADJUSTMENT' | 'ADJUSTMENT_REVERSAL';
const KIND_ORDER: Record<LedgerKind, number> = { OPENING: 0, INVOICE: 1, RECEIPT: 2, ADJUSTMENT: 3, RECEIPT_REVERSAL: 4, ADJUSTMENT_REVERSAL: 5 };

interface LedgerEvent {
  date: string; kind: LedgerKind; ref: string; description: string;
  /** Signed paise: + increases what the company owes (debit), − reduces it (credit). */
  p: number; linkType?: 'invoice' | 'receipt' | 'adjustment'; linkId?: number; seq: number;
}

function ledgerEvents(vendorId: number): LedgerEvent[] {
  const ev: LedgerEvent[] = [];
  const ob = q.get<any>('SELECT * FROM ledger_opening_balances WHERE vendor_id = @v', { v: vendorId });
  if (ob && toPaise(ob.amount) !== 0) {
    ev.push({ date: ob.as_of_date, kind: 'OPENING', ref: 'Opening', description: `Opening balance as of ${ob.as_of_date}${ob.notes ? ` — ${ob.notes}` : ''}`, p: toPaise(ob.amount), seq: 0 });
  }
  for (const i of q.all<any>(
    `SELECT id, invoice_number, invoice_date, due_date, total_amount, booking_count FROM invoices
      WHERE vendor_id = @v AND status <> 'CANCELLED'`, { v: vendorId })) {
    ev.push({ date: i.invoice_date, kind: 'INVOICE', ref: i.invoice_number,
      description: `Invoice${i.booking_count ? ` · ${i.booking_count} trip(s)` : ''}${i.due_date ? ` · due ${i.due_date}` : ''}`,
      p: toPaise(i.total_amount), linkType: 'invoice', linkId: i.id, seq: i.id });
  }
  for (const t of q.all<any>(
    `SELECT t.*, (SELECT group_concat(i.invoice_number, ', ') FROM payments p JOIN invoices i ON i.id = p.invoice_id
                   WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS invoices
       FROM payment_transactions t WHERE t.direction = 'IN' AND t.vendor_id = @v`, { v: vendorId })) {
    const amt = toPaise(t.amount);
    const allocated = txnAllocatedPaise(t.id);
    const bits = [humanMode(t.mode), t.reference_no ? `ref ${t.reference_no}` : '',
      t.invoices ? `for ${t.invoices}` : '', !t.is_reversed && amt - allocated > 0 ? `${inrText(amt - allocated)} unallocated (advance)` : ''].filter(Boolean);
    ev.push({ date: t.txn_date, kind: 'RECEIPT', ref: t.txn_code, description: `Receipt · ${bits.join(' · ')}`, p: -amt, linkType: 'receipt', linkId: t.id, seq: t.id });
    if (t.is_reversed) {
      let d = String(t.reversed_at ?? '').slice(0, 10) || t.txn_date;
      if (d < t.txn_date) d = t.txn_date;
      ev.push({ date: d, kind: 'RECEIPT_REVERSAL', ref: t.txn_code, description: `Reversal of receipt ${t.txn_code}${t.reversal_reason ? ` — ${t.reversal_reason}` : ''}`,
        p: amt, linkType: 'receipt', linkId: t.id, seq: t.id });
    }
  }
  for (const a of q.all<any>(
    `SELECT a.*, i.invoice_number FROM ledger_adjustments a LEFT JOIN invoices i ON i.id = a.invoice_id WHERE a.vendor_id = @v`, { v: vendorId })) {
    const amt = toPaise(a.amount);
    const label = `${humanMode(a.kind)}${a.invoice_number ? ` on ${a.invoice_number}` : ''}${a.remarks ? ` — ${a.remarks}` : ''}`;
    ev.push({ date: a.adj_date, kind: 'ADJUSTMENT', ref: `ADJ-${a.id}`, description: `Adjustment · ${label}`, p: -amt, linkType: 'adjustment', linkId: a.id, seq: a.id });
    if (a.is_reversed) {
      // No reversal date is stored for adjustments; the reversing line sits on the same date.
      ev.push({ date: a.adj_date, kind: 'ADJUSTMENT_REVERSAL', ref: `ADJ-${a.id}`, description: `Reversal of adjustment ADJ-${a.id}`, p: amt, linkType: 'adjustment', linkId: a.id, seq: a.id });
    }
  }
  ev.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.seq - y.seq));
  return ev;
}

function humanMode(s: string) {
  return String(s ?? '').toLowerCase().split('_').map((w) => (w === 'tds' || w === 'upi' || w === 'neft' || w === 'rtgs' ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

export interface LedgerLine {
  date: string; kind: LedgerKind; ref: string; description: string;
  debit: number; credit: number; balance: number; linkType?: string; linkId?: number;
}

export function buildLedger(vendorId: number, from = '', to = '') {
  const vendor = q.get<any>('SELECT id, code, vendor_name, company_name, gst_number, billing_address, address FROM vendors WHERE id = @id', { id: vendorId });
  if (!vendor) throw new LedgerError(404, 'Company not found.');
  ensureTransactionLinks();
  const ev = ledgerEvents(vendorId);
  let openingP = 0;
  let runP = 0;
  let debitP = 0;
  let creditP = 0;
  const lines: LedgerLine[] = [];
  const sum = { invoiced: 0, received: 0, receiptReversals: 0, adjusted: 0, opening: 0 };
  for (const e of ev) {
    if (from && e.date < from) { openingP += e.p; continue; }
    if (to && e.date > to) continue;
    if (!lines.length) runP = openingP;
    runP += e.p;
    if (e.p >= 0) debitP += e.p; else creditP += -e.p;
    if (e.kind === 'INVOICE') sum.invoiced += e.p;
    else if (e.kind === 'RECEIPT') sum.received += -e.p;
    else if (e.kind === 'RECEIPT_REVERSAL') sum.receiptReversals += e.p;
    else if (e.kind === 'OPENING') sum.opening += e.p;
    else sum.adjusted += -e.p;
    lines.push({ date: e.date, kind: e.kind, ref: e.ref, description: e.description,
      debit: e.p > 0 ? rupees(e.p) : 0, credit: e.p < 0 ? rupees(-e.p) : 0, balance: rupees(runP), linkType: e.linkType, linkId: e.linkId });
  }
  const closingP = openingP + debitP - creditP;
  const outstandingInvoices = q.get<any>(
    `SELECT ${PAISE('outstanding_amount')} p, COUNT(*) c FROM invoices WHERE vendor_id = @v AND status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0.009`, { v: vendorId })!;
  const unallocated = q.get<any>(
    `SELECT COALESCE(SUM(CAST(ROUND(t.amount*100) AS INTEGER) - (SELECT ${PAISE('p.amount')} FROM payments p WHERE p.transaction_id = t.id AND p.is_reversed = 0)),0) p
       FROM payment_transactions t WHERE t.direction = 'IN' AND t.is_reversed = 0 AND t.vendor_id = @v`, { v: vendorId })!;
  return {
    vendor, from, to,
    opening: rupees(openingP),
    lines,
    totals: { debit: rupees(debitP), credit: rupees(creditP) },
    closing: rupees(closingP),
    summary: {
      opening: rupees(openingP), openingEntry: rupees(sum.opening), invoiced: rupees(sum.invoiced),
      received: rupees(sum.received - sum.receiptReversals), adjusted: rupees(sum.adjusted), closing: rupees(closingP),
    },
    /** As of now, independent of the range — for the header cards. */
    position: {
      invoiceOutstanding: rupees(outstandingInvoices.p), openInvoices: outstandingInvoices.c, unallocated: rupees(unallocated.p),
    },
    openingBalance: q.get<any>(
      `SELECT o.*, u.full_name AS updated_by_name FROM ledger_opening_balances o LEFT JOIN users u ON u.id = o.updated_by WHERE o.vendor_id = @v`, { v: vendorId }) ?? null,
    adjustments: q.all<any>(
      `SELECT a.*, i.invoice_number, u.full_name AS created_by_name FROM ledger_adjustments a
         LEFT JOIN invoices i ON i.id = a.invoice_id LEFT JOIN users u ON u.id = a.created_by
        WHERE a.vendor_id = @v ORDER BY a.adj_date DESC, a.id DESC`, { v: vendorId }),
  };
}

/** Per-company opening / invoiced / received / adjusted / closing for a range. */
export function receivablesLedger(from = '', to = '', vendorId = 0) {
  const vendors = q.all<any>(
    `SELECT v.id, v.code, v.vendor_name FROM vendors v
      WHERE (@v = 0 OR v.id = @v)
        AND (EXISTS (SELECT 1 FROM invoices i WHERE i.vendor_id = v.id AND i.status <> 'CANCELLED')
          OR EXISTS (SELECT 1 FROM payment_transactions t WHERE t.vendor_id = v.id AND t.direction = 'IN')
          OR EXISTS (SELECT 1 FROM ledger_opening_balances o WHERE o.vendor_id = v.id)
          OR EXISTS (SELECT 1 FROM ledger_adjustments a WHERE a.vendor_id = v.id))
      ORDER BY v.vendor_name`, { v: vendorId });
  return vendors.map((v) => {
    const l = buildLedger(v.id, from, to);
    return {
      id: v.id, vendor_name: v.vendor_name, code: v.code,
      opening: l.summary.opening, opening_entry: l.summary.openingEntry, invoiced: l.summary.invoiced,
      received: l.summary.received, adjusted: l.summary.adjusted, closing: l.summary.closing,
      unallocated_now: l.position.unallocated,
    };
  });
}

/* --------------------------------------------------------------------------
   Trip-level allocation view
   -------------------------------------------------------------------------- */

/**
 * Money is allocated to INVOICES, not trips. For a trip-level view, each
 * invoice's settled amount (received + invoice-linked adjustments, i.e.
 * total − outstanding) is spread over its trips like this:
 *
 *   1. A trip's share of the invoice total is proportional to its invoice line
 *      amount (equal shares if every line is zero), computed with cumulative
 *      rounding in paise so the shares add up exactly to the invoice total
 *      (tax, discount and reimbursables are spread the same way).
 *   2. The settled amount is applied SEQUENTIALLY — oldest trip first (travel
 *      date, then invoice line order) — each trip taking up to its share.
 *
 * So a part-paid invoice shows its earliest trips settled and its latest trips
 * outstanding. This is a display rule only; nothing is stored per trip.
 */
export function tripAllocation(opts: { invoiceId?: number; vendorId?: number; from?: string; to?: string }) {
  const invoices = q.all<any>(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount, i.outstanding_amount, i.status, i.vendor_id, v.vendor_name
       FROM invoices i JOIN vendors v ON v.id = i.vendor_id
      WHERE i.status <> 'CANCELLED'
        AND (@inv = 0 OR i.id = @inv) AND (@v = 0 OR i.vendor_id = @v)
        AND (@from = '' OR i.invoice_date >= @from) AND (@to = '' OR i.invoice_date <= @to)
      ORDER BY i.invoice_date, i.id`,
    { inv: opts.invoiceId ?? 0, v: opts.vendorId ?? 0, from: opts.from ?? '', to: opts.to ?? '' });
  const rows: any[] = [];
  for (const inv of invoices) {
    const st = invoicePaise(inv.id);
    const items = q.all<any>(
      `SELECT ii.line_no, ii.amount AS line_amount, b.id AS booking_id, b.booking_code, b.trip_id, b.vendor_booking_ref,
              b.passenger_name, b.customer_name, b.travel_date
         FROM invoice_items ii JOIN bookings b ON b.id = ii.booking_id
        WHERE ii.invoice_id = @id ORDER BY b.travel_date, ii.line_no, ii.id`, { id: inv.id });
    if (!items.length) continue;
    const weights = items.map((it) => Math.max(0, toPaise(it.line_amount)));
    const W = weights.reduce((s, w) => s + w, 0);
    const useEqual = W === 0;
    const totalW = useEqual ? items.length : W;
    let cum = 0;
    let prevShare = 0;
    let settledLeft = Math.max(0, st.total - Math.max(0, st.outstanding));
    items.forEach((it, idx) => {
      cum += useEqual ? 1 : weights[idx];
      const upto = Math.round((st.total * cum) / totalW);
      const share = upto - prevShare;
      prevShare = upto;
      const alloc = Math.min(share, settledLeft);
      settledLeft -= alloc;
      rows.push({
        invoice_id: inv.id, invoice_number: inv.invoice_number, invoice_date: inv.invoice_date, vendor_name: inv.vendor_name,
        booking_id: it.booking_id, booking_code: it.booking_code, trip_id: it.trip_id, reference: it.vendor_booking_ref,
        passenger: it.passenger_name || it.customer_name, travel_date: it.travel_date,
        amount: rupees(share), allocated: rupees(alloc), outstanding: rupees(share - alloc),
        status: alloc <= 0 ? (share > 0 ? 'UNPAID' : 'PAID') : alloc >= share ? 'PAID' : 'PARTIALLY_PAID',
      });
    });
  }
  const sumP = (k: string) => rows.reduce((s, r) => s + toPaise(r[k]), 0);
  return {
    data: rows,
    totals: { amount: rupees(sumP('amount')), allocated: rupees(sumP('allocated')), outstanding: rupees(sumP('outstanding')) },
    rule: 'Each invoice\'s settled amount is spread over its trips oldest first; a trip\'s share of the invoice is proportional to its line amount.',
  };
}

/* --------------------------------------------------------------------------
   Payables (supplier settlements) — moved here so reports can share it
   -------------------------------------------------------------------------- */

/**
 * Payable per payee: the supplier cost recorded on completed trips, less what
 * has been paid to that payee. Never mixed with the invoice receivables.
 */
export function payables(from: string, to: string) {
  const owed = q.all<any>(
    `SELECT supplier_name AS payee, COUNT(*) AS trips, ${PAISE('supplier_cost')} AS payable_p
       FROM bookings
      WHERE supplier_cost > 0 AND supplier_name IS NOT NULL AND booking_status NOT IN ('CANCELLED','NO_SHOW','INQUIRY','DRAFT')
        AND (@from = '' OR travel_date >= @from) AND (@to = '' OR travel_date <= @to)
      GROUP BY lower(supplier_name)`, { from, to }
  );
  const paid = q.all<any>(
    `SELECT payee_name AS payee, ${PAISE('amount')} AS paid_p, MAX(payment_date) AS last_paid
       FROM supplier_payments WHERE is_reversed = 0
        AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)
      GROUP BY lower(payee_name)`, { from, to }
  );
  const key = (s: string) => String(s ?? '').trim().toLowerCase();
  const names = new Map<string, string>();
  for (const r of [...owed, ...paid]) if (!names.has(key(r.payee))) names.set(key(r.payee), r.payee);
  return Array.from(names.entries()).map(([k, payee]) => {
    const o = owed.find((r) => key(r.payee) === k);
    const pd = paid.find((r) => key(r.payee) === k);
    const payableP = Number(o?.payable_p ?? 0);
    const paidP = Number(pd?.paid_p ?? 0);
    return { payee, trips: Number(o?.trips ?? 0), payable: rupees(payableP), paid: rupees(paidP), balance: rupees(payableP - paidP), last_paid: pd?.last_paid ?? null };
  }).sort((a, b) => b.balance - a.balance);
}

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Per payee: opening, payable in range, paid in range, closing. */
export function payablesLedger(from = '', to = '') {
  const before = from ? payables('', dayBefore(from)) : [];
  const during = payables(from, to);
  const key = (s: string) => String(s ?? '').trim().toLowerCase();
  const names = new Map<string, string>();
  for (const r of [...before, ...during]) if (!names.has(key(r.payee))) names.set(key(r.payee), r.payee);
  return Array.from(names.entries()).map(([k, payee]) => {
    const b = before.find((r) => key(r.payee) === k);
    const d = during.find((r) => key(r.payee) === k);
    const openingP = toPaise(b?.balance ?? 0);
    const payableP = toPaise(d?.payable ?? 0);
    const paidP = toPaise(d?.paid ?? 0);
    return { payee, opening: rupees(openingP), trips: d?.trips ?? 0, payable: rupees(payableP), paid: rupees(paidP),
      closing: rupees(openingP + payableP - paidP), last_paid: d?.last_paid ?? b?.last_paid ?? null };
  }).sort((a, b) => b.closing - a.closing);
}

/* --------------------------------------------------------------------------
   Overview totals
   -------------------------------------------------------------------------- */

export function overview(from = '', to = '', vendorId = 0) {
  ensureTransactionLinks();
  const p = { from, to, v: vendorId };
  const inv = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('total_amount')} p FROM invoices
      WHERE status <> 'CANCELLED' AND (@v = 0 OR vendor_id = @v)
        AND (@from = '' OR invoice_date >= @from) AND (@to = '' OR invoice_date <= @to)`, p)!;
  const rec = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('amount')} p FROM payment_transactions
      WHERE direction = 'IN' AND is_reversed = 0 AND (@v = 0 OR vendor_id = @v)
        AND (@from = '' OR txn_date >= @from) AND (@to = '' OR txn_date <= @to)`, p)!;
  const out = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('outstanding_amount')} p FROM invoices
      WHERE status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0.009 AND (@v = 0 OR vendor_id = @v)`, p)!;
  const overdue = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('outstanding_amount')} p FROM invoices
      WHERE status NOT IN ('CANCELLED','PAID') AND outstanding_amount > 0.009 AND due_date < date('now','localtime')
        AND (@v = 0 OR vendor_id = @v)`, p)!;
  const unalloc = q.get<any>(
    `SELECT COUNT(*) c, COALESCE(SUM(x.free),0) p FROM (
       SELECT CAST(ROUND(t.amount*100) AS INTEGER) - (SELECT ${PAISE('pp.amount')} FROM payments pp WHERE pp.transaction_id = t.id AND pp.is_reversed = 0) AS free
         FROM payment_transactions t WHERE t.direction = 'IN' AND t.is_reversed = 0 AND (@v = 0 OR t.vendor_id = @v)) x
      WHERE x.free > 0`, p)!;
  const adj = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('amount')} p FROM ledger_adjustments
      WHERE is_reversed = 0 AND (@v = 0 OR vendor_id = @v)
        AND (@from = '' OR adj_date >= @from) AND (@to = '' OR adj_date <= @to)`, p)!;
  const sup = q.get<any>(
    `SELECT COUNT(*) c, ${PAISE('amount')} p FROM supplier_payments
      WHERE is_reversed = 0 AND (@from = '' OR payment_date >= @from) AND (@to = '' OR payment_date <= @to)`, p)!;
  const pay = payables('', '');
  const payBalanceP = pay.reduce((s, r) => s + Math.max(0, toPaise(r.balance)), 0);
  return {
    filters: { from, to, vendorId },
    receivables: {
      invoices: inv.c, invoiced: rupees(inv.p),
      receipts: rec.c, received: rupees(rec.p),
      outstanding: rupees(out.p), outstandingCount: out.c,
      overdue: rupees(overdue.p), overdueCount: overdue.c,
      unallocated: rupees(unalloc.p), unallocatedCount: unalloc.c,
      adjusted: rupees(adj.p), adjustments: adj.c,
      netReceivable: rupees(out.p - unalloc.p),
    },
    payables: {
      paidOut: rupees(sup.p), payouts: sup.c,
      outstanding: rupees(payBalanceP), payees: pay.filter((r) => r.balance > 0).length,
      note: 'Payables are owed to vehicle owners and partners by name, so the company filter does not apply to them.',
    },
  };
}

/* --------------------------------------------------------------------------
   Statement import & reconciliation
   -------------------------------------------------------------------------- */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, '0');

/** Statement dates arrive as ISO, dd-mm-yyyy, dd/mm/yy, 05-Oct-2026 or an Excel serial. */
export function parseStatementDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
    return null;
  }
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ,]+(\d{2,4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(Number(m[1]))}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** "1,23,456.00", "₹ 500", "(500)" and "500 Cr" all become paise (absolute). */
export function parseStatementAmount(v: unknown): number {
  if (typeof v === 'number') return Math.abs(toPaise(v));
  const s = String(v ?? '').replace(/[₹,\s]|INR|Rs\.?/gi, '').replace(/(cr|dr)$/i, '').replace(/^\((.*)\)$/, '$1');
  if (!s || !/^-?\d*\.?\d+$/.test(s)) return 0;
  return Math.abs(toPaise(s));
}

const normRef = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/** Read the first sheet of an .xlsx, or a .csv, into header + rows of text. */
export async function parseStatementFile(buffer: Buffer, ext: string): Promise<{ headers: string[]; rows: string[][] }> {
  let matrix: string[][] = [];
  if (ext === '.xlsx') {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new LedgerError(400, 'The workbook has no sheets.');
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals: string[] = [];
      const count = row.cellCount;
      for (let c = 1; c <= count; c++) {
        const cell = row.getCell(c);
        let v: any = cell.value;
        if (v && typeof v === 'object') {
          if (v instanceof Date) v = v.toISOString().slice(0, 10);
          else if ('result' in v) v = v.result instanceof Date ? v.result.toISOString().slice(0, 10) : v.result;
          else if ('richText' in v) v = v.richText.map((t: any) => t.text).join('');
          else if ('text' in v) v = v.text;
        }
        vals.push(v == null ? '' : String(v).trim());
      }
      matrix.push(vals);
    });
  } else {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    matrix = parseCsv(text);
  }
  matrix = matrix.filter((r) => r.some((c) => c !== ''));
  // The header is the first row that has at least two non-empty text cells
  // with no amounts (bank statements often start with a title block).
  let h = matrix.findIndex((r) => r.filter((c) => c && !/^[-\d.,₹ ]+$/.test(c)).length >= 2);
  if (h < 0) h = 0;
  const headers = (matrix[h] ?? []).map((c, i) => c || `Column ${i + 1}`);
  const rows = matrix.slice(h + 1).slice(0, 5000);
  return { headers, rows };
}

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur.trim()); out.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur.trim()); out.push(row); }
  return out;
}

/** Guess which column is which from the header text. */
export function guessMapping(headers: string[]) {
  const find = (re: RegExp, not?: RegExp) => headers.findIndex((h) => re.test(h) && !(not && not.test(h)));
  return {
    date: find(/date|dt\b/i, /value date/i) >= 0 ? find(/date|dt\b/i, /value date/i) : find(/date/i),
    reference: find(/utr|ref|cheque|chq|txn|transaction id/i),
    amount: find(/amount|credit|deposit|paid|received/i, /debit|withdraw/i),
    invoiceNo: find(/invoice|bill no|inv/i),
    narration: find(/narration|description|particular|remark|details/i),
  };
}

export interface StatementRow { row?: number; date?: unknown; reference?: unknown; amount?: unknown; invoiceNo?: unknown; narration?: unknown }

/**
 * Compare a company's statement with its receipts. Nothing is recorded.
 *   1. duplicates in the statement (same reference, or same date+amount with no reference) — later copies set aside
 *   2. match on reference/UTR → matched, or amount mismatch
 *   3. otherwise match on amount with a date within ±3 days (closest date) → matched
 *   4. what is left of the statement → in statement, not in portal
 *   5. live receipts in the statement period (±3 days) not matched → in portal, not in statement
 */
export function reconcileStatement(vendorId: number, input: StatementRow[], opts: { from?: string; to?: string } = {}) {
  const vendor = q.get<any>('SELECT id, vendor_name FROM vendors WHERE id = @id', { id: vendorId });
  if (!vendor) throw new LedgerError(400, 'Choose the company whose statement this is.');
  ensureTransactionLinks();

  const invalid: any[] = [];
  const rows = input.map((r, i) => ({
    row: r.row ?? i + 1,
    date: parseStatementDate(r.date),
    reference: String(r.reference ?? '').trim(),
    amountP: parseStatementAmount(r.amount),
    invoiceNo: String(r.invoiceNo ?? '').trim(),
    narration: String(r.narration ?? '').trim(),
  })).filter((r) => {
    if (!r.date || r.amountP <= 0) {
      invalid.push({ row: r.row, reason: !r.date ? 'Date not recognised' : 'Amount missing or zero', reference: r.reference, narration: r.narration });
      return false;
    }
    return true;
  });

  const dates = rows.map((r) => r.date!).sort();
  const shift = (iso: string, d: number) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const from = opts.from || (dates[0] ? shift(dates[0], -3) : '');
  const to = opts.to || (dates.length ? shift(dates[dates.length - 1], 3) : '');

  const txns = q.all<any>(
    `SELECT t.id, t.txn_code, t.txn_date, t.amount, t.mode, t.reference_no, t.remarks,
            (SELECT group_concat(i.invoice_number, ', ') FROM payments p JOIN invoices i ON i.id = p.invoice_id
              WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS invoices
       FROM payment_transactions t
      WHERE t.direction = 'IN' AND t.is_reversed = 0 AND t.vendor_id = @v
      ORDER BY t.txn_date, t.id`, { v: vendorId }).map((t) => ({ ...t, amountP: toPaise(t.amount), used: false }));

  const view = (r: typeof rows[number]) => ({ row: r.row, date: r.date, reference: r.reference, amount: rupees(r.amountP), invoiceNo: r.invoiceNo, narration: r.narration });
  const tview = (t: any) => ({ id: t.id, txn_code: t.txn_code, txn_date: t.txn_date, amount: t.amount, mode: t.mode, reference_no: t.reference_no, invoices: t.invoices });

  const duplicates: any[] = [];
  const seen = new Map<string, number>();
  const unique = rows.filter((r) => {
    const k = r.reference ? `R:${normRef(r.reference)}` : `D:${r.date}:${r.amountP}`;
    if (seen.has(k)) { duplicates.push({ ...view(r), duplicateOfRow: seen.get(k) }); return false; }
    seen.set(k, r.row);
    return true;
  });

  const matched: any[] = [];
  const mismatched: any[] = [];
  const pending: typeof unique = [];
  for (const r of unique) {
    const ref = normRef(r.reference);
    const t = ref ? txns.find((x) => !x.used && normRef(x.reference_no) === ref) : undefined;
    if (!t) { pending.push(r); continue; }
    t.used = true;
    if (t.amountP === r.amountP) matched.push({ statement: view(r), portal: tview(t), matchedBy: 'REFERENCE' });
    else mismatched.push({ statement: view(r), portal: tview(t), matchedBy: 'REFERENCE', difference: rupees(r.amountP - t.amountP) });
  }
  const missingInPortal: any[] = [];
  const dayDiff = (a: string, b: string) => Math.abs(new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000;
  for (const r of pending) {
    const cands = txns.filter((x) => !x.used && x.amountP === r.amountP && dayDiff(x.txn_date, r.date!) <= 3)
      .sort((a, b) => dayDiff(a.txn_date, r.date!) - dayDiff(b.txn_date, r.date!));
    if (cands[0]) {
      cands[0].used = true;
      matched.push({ statement: view(r), portal: tview(cands[0]), matchedBy: 'AMOUNT_DATE' });
      continue;
    }
    let suggestedInvoice: any = null;
    if (r.invoiceNo) {
      suggestedInvoice = q.get<any>(
        `SELECT id, invoice_number, outstanding_amount, status FROM invoices
          WHERE vendor_id = @v AND lower(invoice_number) = lower(@n) AND status <> 'CANCELLED'`, { v: vendorId, n: r.invoiceNo }) ?? null;
    }
    missingInPortal.push({ ...view(r), suggestedInvoice });
  }
  const missingInStatement = txns.filter((t) => !t.used && (!from || t.txn_date >= from) && (!to || t.txn_date <= to)).map(tview);

  const amt = (list: any[], pick: (x: any) => number) => rupees(list.reduce((s, x) => s + toPaise(pick(x)), 0));
  return {
    vendor, period: { from, to },
    summary: {
      statementRows: input.length, valid: rows.length,
      matched: matched.length, matchedAmount: amt(matched, (x) => x.statement.amount),
      mismatched: mismatched.length, duplicates: duplicates.length,
      missingInPortal: missingInPortal.length, missingInPortalAmount: amt(missingInPortal, (x) => x.amount),
      missingInStatement: missingInStatement.length, missingInStatementAmount: amt(missingInStatement, (x) => x.amount),
      invalid: invalid.length,
    },
    matched, mismatched, duplicates, missingInPortal, missingInStatement, invalid,
  };
}
