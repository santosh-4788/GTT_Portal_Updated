/**
 * Payments & Ledger: receipts split across invoices, unallocated balances,
 * over-allocation and duplicate guards, reversals, the company ledger with
 * opening balance / prior-period invoices / adjustments, trip-level view and
 * statement reconciliation.
 *
 * Own port and scratch database, like the other test files. Invoices are
 * inserted directly so the test does not depend on invoice templates.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-ledger-'));
process.env.DB_FILE = path.join(TEST_DIR, 'ledger.db');
process.env.PORT = '4166';
process.env.JWT_SECRET = 'ledger-test-secret';
process.env.NODE_ENV = 'test';
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4166/api';
let token = '';
let q: any;

async function req(method: string, url: string, body?: any) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = buf.length ? JSON.parse(buf.toString('utf8')) : null; } catch { json = null; }
  return { status: res.status, body: json, raw: buf, type: res.headers.get('content-type') ?? '' };
}

async function waitForServer(timeoutMs = 15_000) {
  const started = Date.now();
  for (;;) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* not yet */ }
    if (Date.now() - started > timeoutMs) throw new Error('The ledger test server never came up.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

let seq = 0;
function mkVendor(name: string): number {
  seq += 1;
  return Number(q.run(`INSERT INTO vendors (code, vendor_name) VALUES (@c, @n)`, { c: `LT${seq}`, n: name }).lastInsertRowid);
}
function mkInvoice(vendorId: number, date: string, total: number, bookingIds: number[] = [], lineAmounts: number[] = []): number {
  seq += 1;
  const id = Number(q.run(
    `INSERT INTO invoices (invoice_number, vendor_id, invoice_date, due_date, total_amount, taxable_amount, paid_amount, outstanding_amount, status, booking_count)
     VALUES (@n, @v, @d, @d, @t, @t, 0, @t, 'GENERATED', @bc)`,
    { n: `LT/${seq}`, v: vendorId, d: date, t: total, bc: bookingIds.length }
  ).lastInsertRowid);
  bookingIds.forEach((b, i) => q.run(
    `INSERT INTO invoice_items (invoice_id, booking_id, line_no, amount) VALUES (@i, @b, @l, @a)`,
    { i: id, b, l: i + 1, a: lineAmounts[i] ?? 0 }));
  return id;
}
const inv = async (id: number) => (await req('GET', `/invoices/${id}`)).body.data;

const S: Record<string, any> = {};

before(async () => {
  const db = await import('../src/db');
  db.applySchema();
  db.getDb();
  q = db.q;
  await import('../src/db/seed');
  await import('../src/server');
  await waitForServer();
  const login = await req('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' });
  token = login.body.token;
  await req('POST', '/auth/change-password', { currentPassword: 'Pass@123', newPassword: 'Ledger123', confirmPassword: 'Ledger123' });
  S.x = mkVendor('Ledger Test Co X');
  S.y = mkVendor('Ledger Test Co Y');
  S.z = mkVendor('Ledger Test Co Z');
});

after(async () => {
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../src/db');
  closeDb();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp */ }
});

describe('Receipts and allocations', () => {
  test('one receipt settles two invoices exactly, to the paisa', async () => {
    S.a = mkInvoice(S.x, '2026-08-01', 1000);
    S.b = mkInvoice(S.x, '2026-08-05', 500.1);
    const r = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-01', amount: 1500.1, mode: 'NEFT', referenceNo: 'UTR-X1',
      allocations: [{ invoiceId: S.a, amount: 1000 }, { invoiceId: S.b, amount: 500.1 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.data.txn_code, /^RCPT-\d{4}-\d{4}$/);
    assert.equal(r.body.data.allocation_status, 'ALLOCATED');
    assert.equal(r.body.data.unallocated, 0);
    assert.equal(r.body.data.allocations.length, 2);
    S.txn1 = r.body.data.id;
    for (const id of [S.a, S.b]) {
      const i = await inv(id);
      assert.equal(i.status, 'PAID');
      assert.equal(Number(i.outstanding_amount), 0);
    }
  });

  test('a partial receipt holds the rest as unallocated, and later allocations merge per invoice', async () => {
    S.c = mkInvoice(S.x, '2026-08-10', 2000);
    S.d = mkInvoice(S.x, '2026-08-12', 300);
    const r = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-05', amount: 1500, mode: 'UPI', referenceNo: 'UTR-X2',
      allocations: [{ invoiceId: S.c, amount: 1000 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.allocation_status, 'PARTLY_ALLOCATED');
    assert.equal(r.body.data.unallocated, 500);
    S.txn2 = r.body.data.id;

    const open = await req('GET', `/payments/register?status=OPEN&vendorId=${S.x}`);
    assert.ok(open.body.data.some((x: any) => x.txn_id === S.txn2 && x.unallocated === 500));

    const m = await req('POST', `/payments/transactions/${S.txn2}/allocate`, { allocations: [{ invoiceId: S.c, amount: 200 }] });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const liveC = m.body.data.allocations.filter((a: any) => a.invoice_id === S.c && !a.is_reversed);
    assert.equal(liveC.length, 1, 'same receipt + invoice is one allocation');
    assert.equal(Number(liveC[0].amount), 1200);

    const d = await req('POST', `/payments/transactions/${S.txn2}/allocate`, { allocations: [{ invoiceId: S.d, amount: 300 }] });
    assert.equal(d.status, 200);
    assert.equal(d.body.data.unallocated, 0);
    assert.equal(d.body.data.allocation_status, 'ALLOCATED');
    assert.equal(Number((await inv(S.c)).outstanding_amount), 800);
    assert.equal((await inv(S.d)).status, 'PAID');
  });

  test('over-allocation is refused — beyond the invoice, and beyond the receipt', async () => {
    const e = mkInvoice(S.x, '2026-08-20', 400);
    S.e = e;
    const tooMuchForInvoice = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-06', amount: 1000, mode: 'UPI', referenceNo: 'UTR-X3', allocations: [{ invoiceId: e, amount: 400.01 }],
    });
    assert.equal(tooMuchForInvoice.status, 400);
    assert.equal(tooMuchForInvoice.body.code, 'OVER_ALLOCATED_INVOICE');

    const tooMuchForReceipt = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-06', amount: 100, mode: 'UPI', referenceNo: 'UTR-X3',
      allocations: [{ invoiceId: e, amount: 50 }, { invoiceId: S.c, amount: 50.01 }],
    });
    assert.equal(tooMuchForReceipt.status, 400);
    assert.equal(tooMuchForReceipt.body.code, 'OVER_ALLOCATED_RECEIPT');
    assert.equal(Number((await inv(e)).outstanding_amount), 400, 'nothing was written');

    const legacy = await req('POST', '/payments', { invoiceId: e, paymentDate: '2026-09-06', amount: 401, mode: 'UPI' });
    assert.equal(legacy.status, 400);
    assert.match(legacy.body.error, /more than the/i);

    const otherCompany = mkInvoice(S.y, '2026-08-20', 100);
    const wrong = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-06', amount: 100, mode: 'UPI', allocations: [{ invoiceId: otherCompany, amount: 100 }],
    });
    assert.equal(wrong.status, 400, 'an invoice of another company cannot be settled');
    q.run(`UPDATE invoices SET status = 'CANCELLED' WHERE id = @id`, { id: otherCompany });
  });

  test('the same UTR from the same company is a 409 unless overridden with a reason', async () => {
    const dup = await req('POST', '/payments/receipts', { vendorId: S.x, txnDate: '2026-09-07', amount: 10, mode: 'NEFT', referenceNo: 'utr-x1' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'POSSIBLE_DUPLICATE');
    const noReason = await req('POST', '/payments/receipts', { vendorId: S.x, txnDate: '2026-09-07', amount: 10, mode: 'NEFT', referenceNo: 'UTR-X1', allowDuplicate: true });
    assert.equal(noReason.status, 400);
    const ok = await req('POST', '/payments/receipts', {
      vendorId: S.x, txnDate: '2026-09-07', amount: 10, mode: 'NEFT', referenceNo: 'UTR-X1', allowDuplicate: true, duplicateReason: 'Second transfer, bank reused the ref',
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.data.allocation_status, 'UNALLOCATED');
    S.advanceTxn = ok.body.data.id;
    const otherCo = await req('POST', '/payments/receipts', { vendorId: S.z, txnDate: '2026-09-07', amount: 10, mode: 'NEFT', referenceNo: 'UTR-X1' });
    assert.equal(otherCo.status, 201, 'the same reference from another company is not a duplicate');
    await req('POST', `/payments/transactions/${otherCo.body.data.id}/reverse`, { reason: 'Test clean-up' });
  });

  test('reversing a receipt reverses its allocations and restores both invoices', async () => {
    const r = await req('POST', `/payments/transactions/${S.txn1}/reverse`, { reason: 'Cheque bounced' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(Number((await inv(S.a)).outstanding_amount), 1000);
    assert.equal(Number((await inv(S.b)).outstanding_amount), 500.1);
    assert.notEqual((await inv(S.a)).status, 'PAID');
    const again = await req('POST', `/payments/transactions/${S.txn1}/reverse`, { reason: 'Twice' });
    assert.equal(again.status, 409);
    const detail = (await req('GET', `/payments/transactions/${S.txn1}`)).body.data;
    assert.equal(detail.allocation_status, 'REVERSED');
    assert.ok(detail.allocations.every((a: any) => a.is_reversed));
    const audit = q.get(`SELECT COUNT(*) c FROM audit_logs WHERE action = 'RECEIPT_REVERSED' AND entity_id = @id`, { id: S.txn1 });
    assert.equal(audit.c, 1, 'audited');
  });

  test('taking back one allocation returns its amount to unallocated', async () => {
    const detail = (await req('GET', `/payments/transactions/${S.txn2}`)).body.data;
    const dAlloc = detail.allocations.find((a: any) => a.invoice_id === S.d && !a.is_reversed);
    const r = await req('POST', `/payments/allocations/${dAlloc.id}/unallocate`, { reason: 'Meant for another invoice' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.unallocated, 300);
    assert.equal(Number((await inv(S.d)).outstanding_amount), 300);
    // ...and can go to a different invoice
    const a = await req('POST', `/payments/transactions/${S.txn2}/allocate`, { allocations: [{ invoiceId: S.e, amount: 300 }] });
    assert.equal(a.status, 200);
    assert.equal(Number((await inv(S.e)).outstanding_amount), 100);
  });

  test('the legacy single-invoice endpoint creates a receipt, and its reversal reverses the receipt', async () => {
    const r = await req('POST', '/payments', { invoiceId: S.a, paymentDate: '2026-09-08', amount: 250, mode: 'CASH' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.ok(r.body.data.transaction_id);
    assert.equal(r.body.invoice.status, 'PARTIALLY_PAID');
    const rev = await req('POST', `/payments/${r.body.data.id}/reverse`, { reason: 'Entered in error' });
    assert.equal(rev.status, 200);
    assert.equal(rev.body.invoice.outstanding, 1000);
    const t = (await req('GET', `/payments/transactions/${r.body.data.transaction_id}`)).body.data;
    assert.equal(t.is_reversed, 1, 'the whole receipt was reversed');
  });
});

describe('Company ledger', () => {
  test('opening balance, a prior-period invoice, receipts and an adjustment', async () => {
    const op = await req('PUT', `/payments/ledger/${S.y}/opening`, { asOfDate: '2026-01-01', amount: 1000, notes: 'From the old books' });
    assert.equal(op.status, 200, JSON.stringify(op.body));
    S.y1 = mkInvoice(S.y, '2026-03-15', 5000);
    S.y2 = mkInvoice(S.y, '2026-09-10', 3000);
    const rc = await req('POST', '/payments/receipts', {
      vendorId: S.y, txnDate: '2026-09-12', amount: 2500, mode: 'NEFT', referenceNo: 'UTR-Y1', allocations: [{ invoiceId: S.y1, amount: 2500 }],
    });
    assert.equal(rc.status, 201);
    const adj = await req('POST', `/payments/ledger/${S.y}/adjustments`, { adjDate: '2026-09-20', amount: 100, kind: 'TDS', invoiceId: S.y2, remarks: 'TDS 194C' });
    assert.equal(adj.status, 201, JSON.stringify(adj.body));
    assert.equal(Number((await inv(S.y2)).outstanding_amount), 2900, 'an invoice-linked adjustment reduces the invoice');
    const tooBig = await req('POST', `/payments/ledger/${S.y}/adjustments`, { adjDate: '2026-09-20', amount: 5000, kind: 'WRITE_OFF', invoiceId: S.y2, remarks: 'too much' });
    assert.equal(tooBig.status, 400);

    const l = (await req('GET', `/payments/ledger/${S.y}?from=2026-09-01&to=2026-09-30`)).body;
    assert.equal(l.opening, 6000, 'opening carries the opening balance and the March invoice');
    assert.equal(l.totals.debit, 3000);
    assert.equal(l.totals.credit, 2600);
    assert.equal(l.closing, 6400);
    assert.equal(l.lines[l.lines.length - 1].balance, 6400);
    const lx = (await req('GET', `/payments/ledger/${S.x}`)).body;
    assert.ok(lx.lines.some((x: any) => x.kind === 'RECEIPT_REVERSAL'), 'a reversal shows as its own line');

    const all = (await req('GET', `/payments/ledger/${S.y}`)).body;
    assert.equal(all.opening, 0);
    assert.equal(all.closing, 6400);
    // Closing = opening entry + invoice outstanding − unallocated advances.
    assert.equal(all.closing, 1000 + all.position.invoiceOutstanding - all.position.unallocated);

    const x = await req('GET', `/payments/ledger/${S.y}/export?from=2026-09-01&to=2026-09-30`);
    assert.equal(x.status, 200);
    assert.ok(x.type.includes('spreadsheetml'));
  });

  test('reversing an adjustment restores the invoice', async () => {
    const id = q.get(`SELECT id FROM ledger_adjustments WHERE vendor_id = @v`, { v: S.y }).id;
    const r = await req('POST', `/payments/adjustments/${id}/reverse`, { reason: 'Certificate not received' });
    assert.equal(r.status, 200);
    assert.equal(Number((await inv(S.y2)).outstanding_amount), 3000);
    const l = (await req('GET', `/payments/ledger/${S.y}`)).body;
    assert.equal(l.closing, 6500);
  });

  test('receivables ledger report and overview', async () => {
    const rep = (await req('GET', `/reports/receivables-ledger?from=2026-09-01&to=2026-09-30&vendorId=${S.y}`)).body;
    assert.equal(rep.data.length, 1);
    assert.equal(rep.data[0].opening, 6000);
    assert.equal(rep.data[0].closing, 6500);
    const ov = (await req('GET', `/payments/overview?vendorId=${S.x}`)).body;
    assert.equal(ov.receivables.unallocated, 10, 'the duplicate-override receipt is an advance');
    assert.ok('payables' in ov);
  });
});

describe('Trips and reconciliation', () => {
  test('an invoice\'s receipts are spread over its trips oldest first', async () => {
    const bookings = q.all(`SELECT id FROM bookings ORDER BY travel_date, id LIMIT 2`).map((b: any) => b.id);
    const id = mkInvoice(S.x, '2026-09-01', 300, bookings, [100, 200]);
    await req('POST', '/payments', { invoiceId: id, paymentDate: '2026-09-09', amount: 150, mode: 'UPI', referenceNo: 'UTR-TRIP' });
    const r = (await req('GET', `/payments/trip-allocation?invoiceId=${id}`)).body;
    assert.equal(r.data.length, 2);
    assert.deepEqual(r.data.map((t: any) => [t.amount, t.allocated, t.outstanding]), [[100, 100, 0], [200, 50, 150]]);
    assert.equal(r.totals.allocated, 150);
  });

  test('a statement is classified without recording anything', async () => {
    const mk = (d: string, a: number, ref: string) => req('POST', '/payments/receipts', { vendorId: S.y, txnDate: d, amount: a, mode: 'NEFT', referenceNo: ref });
    await mk('2026-09-15', 700, 'UTR-Y2');
    await mk('2026-09-18', 400, '');
    await mk('2026-09-14', 123, 'UTR-Y4');
    const before = q.get('SELECT COUNT(*) c FROM payment_transactions').c;
    const r = await req('POST', '/payments/reconcile/match', {
      vendorId: S.y,
      rows: [
        { row: 1, date: '12-09-2026', reference: 'UTR-Y1', amount: '2,500.00' },
        { row: 2, date: '2026-09-15', reference: 'UTR-Y2', amount: 750 },
        { row: 3, date: '12/09/2026', reference: 'utr-y1', amount: 2500 },
        { row: 4, date: '20-Sep-2026', reference: '', amount: 400 },
        { row: 5, date: '2026-09-21', reference: 'UTR-NEW', amount: 999, invoiceNo: '' },
        { row: 6, date: 'not a date', reference: 'X', amount: 1 },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = r.body.summary;
    assert.equal(s.matched, 2, 'by reference, and by amount + date within 3 days');
    assert.equal(s.mismatched, 1);
    assert.equal(r.body.mismatched[0].difference, 50);
    assert.equal(s.duplicates, 1);
    assert.equal(s.missingInPortal, 1);
    assert.equal(r.body.missingInPortal[0].reference, 'UTR-NEW');
    assert.equal(s.missingInStatement, 1);
    assert.equal(r.body.missingInStatement[0].reference_no, 'UTR-Y4');
    assert.equal(s.invalid, 1);
    assert.ok(r.body.matched.some((m: any) => m.matchedBy === 'AMOUNT_DATE'));
    assert.equal(q.get('SELECT COUNT(*) c FROM payment_transactions').c, before, 'nothing recorded');
  });

  test('the register lists receipts and payouts, filters by status, and exports', async () => {
    const all = (await req('GET', `/payments/register?vendorId=${S.x}`)).body;
    assert.ok(all.total >= 4);
    const reversed = (await req('GET', `/payments/register?status=REVERSED&vendorId=${S.x}`)).body;
    assert.ok(reversed.data.every((x: any) => x.status === 'REVERSED' && x.is_reversed === 1));
    const unalloc = (await req('GET', `/payments/register?status=UNALLOCATED&vendorId=${S.x}`)).body;
    assert.ok(unalloc.data.some((x: any) => x.txn_id === S.advanceTxn));
    const search = (await req('GET', `/payments/register?search=UTR-X2`)).body;
    assert.ok(search.data.some((x: any) => x.txn_id === S.txn2 && x.invoices.includes('LT/')));
    const x = await req('GET', '/payments/register/export');
    assert.equal(x.status, 200);
    assert.equal(x.raw.subarray(0, 2).toString(), 'PK');
  });
});
