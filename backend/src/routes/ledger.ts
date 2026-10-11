/**
 * Payments & Ledger endpoints, mounted under /api/payments (see payments.ts).
 *
 *   GET  /companies                       companies for the pickers
 *   GET  /overview                        receivable and payable totals (from, to, vendorId)
 *   GET  /register                        every receipt (IN) and payout (OUT); /register/export
 *   POST /receipts                        record money received, split across invoices
 *   GET  /transactions/:id                one receipt with its allocations
 *   POST /transactions/:id/allocate       allocate unallocated balance to invoices
 *   POST /transactions/:id/reverse        reverse a receipt and all its allocations
 *   POST /allocations/:id/unallocate      take one allocation back to unallocated
 *   GET  /ledger/:vendorId                company ledger (from, to); /ledger/:vendorId/export
 *   PUT  /ledger/:vendorId/opening        set the opening balance
 *   POST /ledger/:vendorId/adjustments    TDS / write-off / rounding / credit note
 *   POST /adjustments/:id/reverse
 *   GET  /trip-allocation                 invoice receipts spread over trips; /trip-allocation/export
 *   POST /reconcile/parse                 read a statement file (xlsx/csv) → headers + rows
 *   POST /reconcile/match                 compare mapped statement rows with receipts
 *
 * The money rules themselves live in services/ledger.ts.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { q } from '../db';
import { requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';
import { sendTable, filterNote } from '../utils/exportSheet';
import {
  LedgerError, PAISE, rupees, ensureTransactionLinks, createReceipt, allocateTransaction, unallocatePayment,
  reverseTransaction, transactionDetail, buildLedger, setOpeningBalance, addAdjustment, reverseAdjustment, ADJUSTMENT_KINDS,
  tripAllocation, overview, parseStatementFile, guessMapping, reconcileStatement,
} from '../services/ledger';

const router = Router();

/** Turn a LedgerError into the JSON the screens already understand. */
export function sendLedgerError(res: Response, e: unknown) {
  if (e instanceof LedgerError) return res.status(e.status).json({ error: e.message, code: e.code, ...(e.extra ?? {}) });
  throw e;
}
const safe = (fn: (req: Request, res: Response) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try { await fn(req, res); } catch (e) {
    try { sendLedgerError(res, e); } catch (err) { next(err); }
  }
};

const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

router.get('/companies', requirePermission('payments.view', 'payments.create'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT v.id, v.code, v.vendor_name, v.status,
              (SELECT COALESCE(SUM(outstanding_amount),0) FROM invoices i WHERE i.vendor_id = v.id AND i.status NOT IN ('CANCELLED','PAID')) AS outstanding
         FROM vendors v ORDER BY CASE WHEN v.status = 'ACTIVE' THEN 0 ELSE 1 END, v.vendor_name`),
  });
});

router.get('/overview', requirePermission('payments.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  res.json(overview(p.from ?? '', p.to ?? '', p.vendorId ? Number(p.vendorId) : 0));
});

/* --------------------------------------------------------------------------
   Register — receipts and payouts in one list
   -------------------------------------------------------------------------- */

const REGISTER_CTE = `
  WITH reg AS (
    SELECT 'IN' AS direction, t.id AS txn_id, NULL AS payout_id, t.txn_code AS code, t.txn_date AS date,
           t.vendor_id, COALESCE(v.vendor_name, t.party_name) AS party, t.amount, CAST(ROUND(t.amount*100) AS INTEGER) AS amount_p,
           t.mode, t.reference_no, t.bank, t.remarks, t.source, t.is_reversed, t.reversal_reason, t.reversed_at,
           t.created_at, u.full_name AS created_by_name,
           (SELECT ${PAISE('p.amount')} FROM payments p WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS allocated_p,
           (SELECT group_concat(i.invoice_number, ', ') FROM payments p JOIN invoices i ON i.id = p.invoice_id
             WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS invoices,
           (SELECT group_concat(DISTINCT b.trip_id) FROM payments p JOIN invoice_items ii ON ii.invoice_id = p.invoice_id
              JOIN bookings b ON b.id = ii.booking_id WHERE p.transaction_id = t.id AND p.is_reversed = 0) AS trips
      FROM payment_transactions t LEFT JOIN vendors v ON v.id = t.vendor_id LEFT JOIN users u ON u.id = t.created_by
     WHERE t.direction = 'IN'
    UNION ALL
    SELECT 'OUT', NULL, sp.id, 'PAYOUT-' || printf('%05d', sp.id), sp.payment_date,
           NULL, sp.payee_name, sp.amount, CAST(ROUND(sp.amount*100) AS INTEGER),
           sp.mode, sp.reference_no, NULL, sp.notes, 'MANUAL', sp.is_reversed, sp.reversal_reason, sp.reversed_at,
           sp.created_at, u.full_name,
           CAST(ROUND(sp.amount*100) AS INTEGER), NULL, b.trip_id
      FROM supplier_payments sp LEFT JOIN bookings b ON b.id = sp.booking_id LEFT JOIN users u ON u.id = sp.created_by
  ),
  reg2 AS (
    SELECT reg.*,
           CASE WHEN is_reversed = 1 THEN 'REVERSED'
                WHEN direction = 'OUT' THEN 'PAID_OUT'
                WHEN allocated_p <= 0 THEN 'UNALLOCATED'
                WHEN allocated_p >= amount_p THEN 'ALLOCATED'
                ELSE 'PARTLY_ALLOCATED' END AS status,
           CASE WHEN is_reversed = 1 OR direction = 'OUT' THEN 0 ELSE amount_p - allocated_p END AS unallocated_p
      FROM reg
  )`;

function registerFilters(p: Record<string, string>) {
  const params = {
    from: p.from ?? '', to: p.to ?? '', vendorId: p.vendorId ? Number(p.vendorId) : 0,
    direction: (p.direction ?? '').toUpperCase(), mode: (p.mode ?? '').toUpperCase(),
    status: (p.status ?? '').toUpperCase(), search: (p.search ?? '').trim(),
  };
  const where = `
    WHERE (@from = '' OR date >= @from) AND (@to = '' OR date <= @to)
      AND (@vendorId = 0 OR (direction = 'IN' AND vendor_id = @vendorId))
      AND (@direction = '' OR direction = @direction)
      AND (@mode = '' OR mode = @mode)
      AND (@status = '' OR status = @status OR (@status = 'OPEN' AND unallocated_p > 0) OR (@status = 'LIVE' AND is_reversed = 0))
      AND (@search = '' OR code LIKE '%'||@search||'%' OR party LIKE '%'||@search||'%'
           OR reference_no LIKE '%'||@search||'%' OR invoices LIKE '%'||@search||'%'
           OR trips LIKE '%'||@search||'%' OR remarks LIKE '%'||@search||'%')`;
  return { params, where };
}

const REGISTER_SELECT = `SELECT direction, txn_id, payout_id, code, date, vendor_id, party, amount, mode, reference_no, bank, remarks,
       source, is_reversed, reversal_reason, reversed_at, created_at, created_by_name, invoices, trips, status,
       allocated_p / 100.0 AS allocated, unallocated_p / 100.0 AS unallocated`;

router.get('/register', requirePermission('payments.view'), (req, res) => {
  ensureTransactionLinks();
  const p = req.query as Record<string, string>;
  const { params, where } = registerFilters(p);
  const limit = Math.min(Number(p.limit ?? 100) || 100, 500);
  const offset = Math.max(0, Number(p.offset ?? 0) || 0);
  const data = q.all<any>(`${REGISTER_CTE} ${REGISTER_SELECT} FROM reg2 ${where} ORDER BY date DESC, created_at DESC LIMIT @limit OFFSET @offset`,
    { ...params, limit, offset });
  const agg = q.get<any>(
    `${REGISTER_CTE} SELECT COUNT(*) total,
        COALESCE(SUM(CASE WHEN direction = 'IN' AND is_reversed = 0 THEN amount_p END),0) in_p,
        COALESCE(SUM(CASE WHEN direction = 'OUT' AND is_reversed = 0 THEN amount_p END),0) out_p,
        COALESCE(SUM(unallocated_p),0) unalloc_p
       FROM reg2 ${where}`, params)!;
  res.json({ data, total: agg.total, received: rupees(agg.in_p), paidOut: rupees(agg.out_p), unallocated: rupees(agg.unalloc_p) });
});

const STATUS_TEXT: Record<string, string> = {
  ALLOCATED: 'Fully allocated', PARTLY_ALLOCATED: 'Partly allocated', UNALLOCATED: 'Unallocated', REVERSED: 'Reversed', PAID_OUT: 'Paid out',
};

router.get('/register/export', requirePermission('payments.view'), async (req, res) => {
  ensureTransactionLinks();
  const p = req.query as Record<string, string>;
  const { params, where } = registerFilters(p);
  const rows = q.all<any>(`${REGISTER_CTE} ${REGISTER_SELECT} FROM reg2 ${where} ORDER BY date DESC, created_at DESC`, params);
  audit(req, 'DATA_EXPORTED', { description: `Payment register — ${rows.length} row(s)`, meta: params });
  await sendTable(res, 'payment-register', {
    name: 'Payment register', title: 'Payment register — received and paid',
    notes: [filterNote({ From: params.from, To: params.to, Direction: params.direction, Method: params.mode, Status: params.status, Search: params.search }),
      'Received = receipts from companies (allocated to invoices or held as advance). Paid = payouts to vehicle owners and partners.'],
    columns: [
      { key: 'code', header: 'ID', kind: 'id' }, { key: 'date', header: 'Date', kind: 'date' },
      { key: 'direction', header: 'Direction', value: (r) => (r.direction === 'IN' ? 'Received' : 'Paid') },
      { key: 'party', header: 'Party' }, { key: 'amount', header: 'Amount', kind: 'money' },
      { key: 'mode', header: 'Method' }, { key: 'reference_no', header: 'Reference / UTR', kind: 'id' },
      { key: 'invoices', header: 'Invoices', width: 30 }, { key: 'trips', header: 'Trips', width: 30 },
      { key: 'allocated', header: 'Allocated', kind: 'money' }, { key: 'unallocated', header: 'Unallocated', kind: 'money' },
      { key: 'status', header: 'Status', value: (r) => STATUS_TEXT[r.status] ?? r.status },
      { key: 'remarks', header: 'Remarks', width: 30 }, { key: 'created_by_name', header: 'Recorded by' },
      { key: 'is_reversed', header: 'Reversed', value: (r) => (r.is_reversed ? 'Yes' : 'No') },
      { key: 'reversal_reason', header: 'Reversal reason', width: 30 },
    ],
    rows,
    totals: ['allocated', 'unallocated'],
  }, p.format);
});

/* --------------------------------------------------------------------------
   Receipts and allocations
   -------------------------------------------------------------------------- */

const allocationSchema = z.object({
  invoiceId: z.coerce.number().int().positive(),
  amount: z.coerce.number().min(0, 'An allocation cannot be negative.'),
});

const receiptSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose the company.'),
  txnDate: isoDate,
  amount: z.coerce.number().positive('The amount received must be more than zero.').max(999_999_999),
  mode: z.string().trim().min(2, 'Choose a payment method.').max(40).default('BANK_TRANSFER').transform((s) => s.toUpperCase()),
  referenceNo: z.string().trim().max(80).optional().default(''),
  bank: z.string().trim().max(80).optional().default(''),
  remarks: z.string().trim().max(400).optional().default(''),
  source: z.enum(['MANUAL', 'IMPORT']).optional().default('MANUAL'),
  allocations: z.array(allocationSchema).max(500).optional().default([]),
  allowDuplicate: z.coerce.boolean().default(false),
  duplicateReason: z.string().trim().max(200).optional().default(''),
});

router.post('/receipts', requirePermission('payments.create'), validateBody(receiptSchema), safe((req, res) => {
  const b = req.body as z.infer<typeof receiptSchema>;
  const r = createReceipt({ ...b }, req.user!.id);
  audit(req, 'RECEIPT_RECORDED', {
    entityType: 'payment_transaction', entityId: r.txn.id,
    description: `${r.txn.txn_code}: ${inr(r.txn.amount)} received from ${r.vendor.vendor_name} via ${r.txn.mode}` +
      `${r.txn.reference_no ? ` (ref ${r.txn.reference_no})` : ''} — ${r.allocations.length} invoice(s), ${inr(r.unallocated)} unallocated`,
    meta: {
      allocations: r.allocations.map((a) => ({ invoice: a.invoiceNumber, amount: a.amount, outstandingAfter: a.invoice.outstanding })),
      unallocated: r.unallocated, source: b.source,
      ...(b.allowDuplicate ? { duplicateOverride: b.duplicateReason } : {}),
    },
  });
  res.status(201).json({
    ok: true, data: transactionDetail(r.txn.id),
    message: `${r.txn.txn_code} recorded: ${inr(r.allocated)} allocated` + (r.unallocated > 0 ? `, ${inr(r.unallocated)} held as unallocated.` : '.'),
  });
}));

router.get('/transactions/:id', requirePermission('payments.view'), safe((req, res) => {
  res.json({ data: transactionDetail(Number(req.params.id)) });
}));

router.post('/transactions/:id/allocate', requirePermission('payments.create', 'payments.update'),
  validateBody(z.object({ allocations: z.array(allocationSchema).min(1).max(500) })), safe((req, res) => {
    const r = allocateTransaction(Number(req.params.id), req.body.allocations, req.user!.id);
    audit(req, 'RECEIPT_ALLOCATED', {
      entityType: 'payment_transaction', entityId: r.txn.id,
      description: `${r.txn.txn_code}: ${r.allocations.map((a) => `${inr(a.amount)} to ${a.invoiceNumber}${a.merged ? ' (added to existing allocation)' : ''}`).join(', ')}`,
      meta: { allocations: r.allocations.map((a) => ({ invoice: a.invoiceNumber, amount: a.amount, merged: a.merged })), unallocatedAfter: r.unallocated },
    });
    res.json({ ok: true, data: transactionDetail(r.txn.id),
      message: `Allocated. ${r.unallocated > 0 ? `${inr(r.unallocated)} of ${r.txn.txn_code} is still unallocated.` : `${r.txn.txn_code} is fully allocated.`}` });
  }));

router.post('/transactions/:id/reverse', requirePermission('payments.delete', 'payments.update'), safe((req, res) => {
  const reason = String(req.body?.reason ?? '').trim();
  const r = reverseTransaction(Number(req.params.id), reason, req.user!.id);
  audit(req, 'RECEIPT_REVERSED', {
    entityType: 'payment_transaction', entityId: r.txn.id,
    description: `${r.txn.txn_code} (${inr(r.txn.amount)}) reversed with ${r.allocationsReversed} allocation(s) — ${reason}`,
    meta: { invoices: r.invoices },
  });
  res.json({ ok: true, invoices: r.invoices, message: `${r.txn.txn_code} reversed. ${r.invoices.length} invoice balance(s) worked out again.` });
}));

router.post('/allocations/:id/unallocate', requirePermission('payments.delete', 'payments.update'), safe((req, res) => {
  const reason = String(req.body?.reason ?? '').trim();
  const r = unallocatePayment(Number(req.params.id), reason, req.user!.id);
  audit(req, 'RECEIPT_UNALLOCATED', {
    entityType: 'payment', entityId: r.payment.id,
    description: `${inr(r.payment.amount)} taken off ${r.payment.invoice_number}${r.txn ? ` back to ${r.txn.txn_code} unallocated` : ''} — ${reason}`,
  });
  res.json({ ok: true, invoice: r.invoice, unallocated: r.unallocated,
    message: `Allocation reversed. ${inr(r.invoice.outstanding)} is outstanding on ${r.payment.invoice_number}` +
      (r.txn ? `; ${inr(r.unallocated)} of ${r.txn.txn_code} is unallocated.` : '.') });
}));

/* --------------------------------------------------------------------------
   Company ledger
   -------------------------------------------------------------------------- */

router.get('/ledger/:vendorId', requirePermission('payments.view'), safe((req, res) => {
  const p = req.query as Record<string, string>;
  res.json(buildLedger(Number(req.params.vendorId), p.from ?? '', p.to ?? ''));
}));

const KIND_TEXT: Record<string, string> = {
  OPENING: 'Opening balance', INVOICE: 'Invoice', RECEIPT: 'Receipt', RECEIPT_REVERSAL: 'Receipt reversed',
  ADJUSTMENT: 'Adjustment', ADJUSTMENT_REVERSAL: 'Adjustment reversed',
};

router.get('/ledger/:vendorId/export', requirePermission('payments.view'), safe(async (req, res) => {
  const p = req.query as Record<string, string>;
  const l = buildLedger(Number(req.params.vendorId), p.from ?? '', p.to ?? '');
  audit(req, 'DATA_EXPORTED', { description: `Company ledger — ${l.vendor.vendor_name}`, meta: { from: l.from, to: l.to } });
  const rows = [
    { date: l.from || null, type: 'Opening balance', ref: '', description: l.from ? `Balance brought forward before ${l.from}` : 'Opening balance', debit: null, credit: null, balance: l.opening },
    ...l.lines.map((x) => ({ ...x, type: KIND_TEXT[x.kind] ?? x.kind })),
    { date: l.to || null, type: 'Closing balance', ref: '', description: 'Positive = the company owes us', debit: l.totals.debit, credit: l.totals.credit, balance: l.closing },
  ];
  await sendTable(res, `ledger-${l.vendor.code}`, {
    name: 'Ledger', title: `Ledger — ${l.vendor.vendor_name}`,
    notes: [filterNote({ From: l.from, To: l.to }), 'Debit = invoices and reversals (company owes more). Credit = receipts, including unallocated advances, and adjustments.'],
    columns: [
      { key: 'date', header: 'Date', kind: 'date' }, { key: 'type', header: 'Type' }, { key: 'ref', header: 'Reference', kind: 'id' },
      { key: 'description', header: 'Particulars', width: 50 }, { key: 'debit', header: 'Debit', kind: 'money' },
      { key: 'credit', header: 'Credit', kind: 'money' }, { key: 'balance', header: 'Balance', kind: 'money' },
    ],
    rows,
  }, p.format);
}));

router.put('/ledger/:vendorId/opening', requirePermission('payments.update'),
  validateBody(z.object({
    asOfDate: isoDate,
    amount: z.coerce.number().min(-999_999_999).max(999_999_999),
    notes: z.string().trim().max(300).optional().default(''),
  })), safe((req, res) => {
    const r = setOpeningBalance(Number(req.params.vendorId), req.body.asOfDate, req.body.amount, req.body.notes, req.user!.id);
    audit(req, 'LEDGER_OPENING_SET', {
      entityType: 'vendor', entityId: r.vendor.id,
      description: `Opening balance for ${r.vendor.vendor_name} set to ${inr(r.after.amount)} as of ${r.after.as_of_date}` +
        (r.before ? ` (was ${inr(r.before.amount)} as of ${r.before.as_of_date})` : ''),
      meta: { before: r.before, after: r.after },
    });
    res.json({ ok: true, data: r.after, message: 'Opening balance saved.' });
  }));

router.post('/ledger/:vendorId/adjustments', requirePermission('payments.update'),
  validateBody(z.object({
    adjDate: isoDate,
    amount: z.coerce.number().min(-999_999_999).max(999_999_999),
    kind: z.enum(ADJUSTMENT_KINDS),
    invoiceId: z.coerce.number().int().positive().nullable().optional(),
    remarks: z.string().trim().min(3, 'Say what the adjustment is for.').max(300),
  })), safe((req, res) => {
    const r = addAdjustment(Number(req.params.vendorId), req.body, req.user!.id);
    audit(req, 'LEDGER_ADJUSTMENT_ADDED', {
      entityType: 'ledger_adjustment', entityId: r.id,
      description: `${r.kind} ${inr(r.amount)} for ${r.vendor.vendor_name}${r.invoice ? ` on ${r.invoice.invoice_number}` : ''} — ${req.body.remarks}`,
      meta: { invoice: r.state },
    });
    res.status(201).json({ ok: true, id: r.id, invoice: r.state, message: 'Adjustment recorded.' });
  }));

router.post('/adjustments/:id/reverse', requirePermission('payments.update', 'payments.delete'), safe((req, res) => {
  const reason = String(req.body?.reason ?? '').trim();
  const r = reverseAdjustment(Number(req.params.id), reason);
  audit(req, 'LEDGER_ADJUSTMENT_REVERSED', {
    entityType: 'ledger_adjustment', entityId: r.adj.id,
    description: `${r.adj.kind} ${inr(r.adj.amount)} reversed — ${reason}`, meta: { invoice: r.state },
  });
  res.json({ ok: true, message: 'Adjustment reversed.' });
}));

/* --------------------------------------------------------------------------
   Trip-level allocation view
   -------------------------------------------------------------------------- */

const tripParams = (p: Record<string, string>) => ({
  invoiceId: p.invoiceId ? Number(p.invoiceId) : 0, vendorId: p.vendorId ? Number(p.vendorId) : 0, from: p.from ?? '', to: p.to ?? '',
});

router.get('/trip-allocation', requirePermission('payments.view'), (req, res) => {
  const o = tripParams(req.query as Record<string, string>);
  if (!o.invoiceId && !o.vendorId) return res.status(400).json({ error: 'Choose an invoice or a company.' });
  res.json(tripAllocation(o));
});

router.get('/trip-allocation/export', requirePermission('payments.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const o = tripParams(p);
  if (!o.invoiceId && !o.vendorId) return res.status(400).json({ error: 'Choose an invoice or a company.' });
  const r = tripAllocation(o);
  await sendTable(res, 'trip-allocation', {
    name: 'Trips', title: 'Receipts by trip',
    notes: [filterNote({ 'Invoice date from': o.from, To: o.to }), r.rule],
    columns: [
      { key: 'invoice_number', header: 'Invoice', kind: 'id' }, { key: 'trip_id', header: 'Trip ID', kind: 'id' },
      { key: 'booking_code', header: 'Booking ID', kind: 'id' }, { key: 'reference', header: 'Company ref', kind: 'id' },
      { key: 'passenger', header: 'Passenger' }, { key: 'travel_date', header: 'Travel date', kind: 'date' },
      { key: 'amount', header: 'Amount', kind: 'money' }, { key: 'allocated', header: 'Received', kind: 'money' },
      { key: 'outstanding', header: 'Outstanding', kind: 'money' }, { key: 'status', header: 'Status' },
    ],
    rows: r.data, totals: ['amount', 'allocated', 'outstanding'],
  }, p.format);
});

/* --------------------------------------------------------------------------
   Statement import & reconciliation — nothing is recorded here
   -------------------------------------------------------------------------- */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xlsx' && ext !== '.csv') {
      return cb(Object.assign(new Error('Choose an .xlsx or .csv statement. Old .xls files must be saved as .xlsx first.'), { status: 400 }));
    }
    cb(null, true);
  },
});

router.post('/reconcile/parse', requirePermission('payments.view'), (req, res, next) => {
  upload.single('file')(req, res, (err: any) => {
    if (err) return res.status(err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message ?? 'The upload could not be read.' });
    next();
  });
}, safe(async (req, res) => {
  const f = req.file;
  if (!f?.buffer?.length) return res.status(400).json({ error: 'Choose a statement file (.xlsx or .csv).' });
  const ext = path.extname(f.originalname || '').toLowerCase();
  if (ext === '.xlsx' && !(f.buffer[0] === 0x50 && f.buffer[1] === 0x4b)) {
    return res.status(400).json({ error: 'This is not a real .xlsx file. Open it in Excel and save it as .xlsx.' });
  }
  let parsed;
  try { parsed = await parseStatementFile(f.buffer, ext); } catch (e) {
    if (e instanceof LedgerError) throw e;
    return res.status(400).json({ error: 'The statement could not be read. It may be damaged or password-protected.' });
  }
  if (!parsed.rows.length) return res.status(400).json({ error: 'No rows were found under the header in that file.' });
  res.json({ fileName: f.originalname, headers: parsed.headers, rows: parsed.rows, mapping: guessMapping(parsed.headers) });
}));

const matchSchema = z.object({
  vendorId: z.coerce.number().int().positive('Choose the company.'),
  from: z.string().optional().default(''),
  to: z.string().optional().default(''),
  rows: z.array(z.object({
    row: z.coerce.number().int().optional(),
    date: z.any(), reference: z.any().optional(), amount: z.any(), invoiceNo: z.any().optional(), narration: z.any().optional(),
  })).min(1, 'The statement has no rows.').max(5000),
});

router.post('/reconcile/match', requirePermission('payments.view'), validateBody(matchSchema), safe((req, res) => {
  const b = req.body as z.infer<typeof matchSchema>;
  const r = reconcileStatement(b.vendorId, b.rows, { from: b.from, to: b.to });
  audit(req, 'STATEMENT_RECONCILED', {
    entityType: 'vendor', entityId: b.vendorId,
    description: `Statement for ${r.vendor.vendor_name} compared: ${r.summary.matched} matched, ${r.summary.mismatched} mismatched, ` +
      `${r.summary.missingInPortal} not in portal, ${r.summary.missingInStatement} not in statement`,
    meta: r.summary,
  });
  res.json(r);
}));

export default router;
