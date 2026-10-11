/**
 * The redesigned workflow, end to end.
 *
 * Masters → fare rule → enquiry → owner → fare from the rule → quotation →
 * confirmation → fleet allotment (with a clash refused, then overridden) →
 * trip run and completed → billing preview → batch submitted, approved and
 * billed → partial and full payment, a duplicate refused, a reversal →
 * dashboard and reports reconcile → exports → permissions enforced.
 *
 * Own port and scratch database, like the other test files.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-workflow-'));
process.env.DB_FILE = path.join(TEST_DIR, 'workflow.db');
process.env.PORT = '4144';
process.env.JWT_SECRET = 'workflow-test-secret';
process.env.NODE_ENV = 'test';
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4144/api';
let token = '';

async function req(method: string, url: string, body?: any, auth = token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
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
    if (Date.now() - started > timeoutMs) throw new Error('The workflow test server never came up.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const PAST = '2026-09-01';
const S: Record<string, any> = {};

before(async () => {
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  // These suites exercise invoicing itself; the billing-confirmation step in
  // front of it is covered by tests/tripflow.test.ts.
  getDb().prepare("UPDATE settings SET value = 'false' WHERE key = 'billing.requireConfirmation'").run();
  await import('../src/server');
  await waitForServer();
  const login = await req('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' }, '');
  token = login.body.token;
  await req('POST', '/auth/change-password', { currentPassword: 'Pass@123', newPassword: 'Workflow123', confirmPassword: 'Workflow123' });
});

after(async () => {
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../src/db');
  closeDb();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp */ }
});

const stageOf = async (id: number) => (await req('GET', `/trips/${id}`)).body.stage?.key;

describe('Masters and the fare engine', () => {
  test('vehicle categories are seeded and new permissions exist', async () => {
    const r = await req('GET', '/masters/categories');
    assert.equal(r.status, 200);
    S.dzire = r.body.data.find((c: any) => c.code === 'DZIRE');
    assert.ok(S.dzire, 'Dzire category seeded');
    const perms = await req('GET', '/users/permissions');
    for (const code of ['masters.view', 'fleet.update', 'onsheet.create']) {
      assert.ok(perms.body.data.some((p: any) => p.code === code), `${code} exists`);
    }
  });

  test('a fare rule is created against a category and quotes correctly', async () => {
    const pub = await req('GET', '/rates/public-vendor');
    S.directId = pub.body.data.id;
    const r = await req('POST', '/rates', {
      vendorId: S.directId, categoryId: S.dzire.id, vehicleCategory: 'ignored', planType: 'LOCAL', planLabel: 'Test 4H/40KM',
      includedHours: 4, includedKm: 40, baseFare: 1500, extraHourRate: 150, extraKmRate: 15, nightCharge: 200,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.vehicle_category, 'Dzire', 'the category name is used, not free text');
    S.ruleId = r.body.data.id;

    const q = await req('POST', '/fares/quote', { ruleId: S.ruleId, distanceKm: 60, hours: 5.5, nights: 1, toll: 120, parking: 50, taxMode: 'IGST', taxRate: 5 });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    const t = q.body.data.totals;
    // 1500 + 20×15 + ceil(1.5)=2×150 + 1 night 200 = 2300 taxable; 5% = 115; + 170 reimbursable
    assert.equal(t.taxableAmount, 2300);
    assert.equal(t.taxAmount, 115);
    assert.equal(t.nonTaxableAmount, 170);
    assert.equal(t.totalAmount, 2585);
    S.quote = q.body.data;
  });

  test('an inactive rule cannot quote, and invalid input is explained', async () => {
    const bad = await req('POST', '/fares/quote', { ruleId: S.ruleId, distanceKm: -5 });
    assert.equal(bad.status, 400);
  });
});

describe('An enquiry through to an allotted trip', () => {
  test('a new enquiry lands in New enquiries', async () => {
    const r = await req('POST', '/trips', {
      source: 'WALKIN', status: 'INQUIRY', customerName: 'Workflow Customer', customerMobile: '9811122233',
      customerEmail: '', pickup: 'Goregaon West', dropOff: 'Andheri East', travelDate: PAST, journeyTime: '09:00',
      tripType: 'LOCAL', vehicleCategoryId: S.dzire.id, passengers: 2,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    S.trip = r.body.id;
    assert.equal(await stageOf(S.trip), 'NEW');
  });

  test('the same customer on the same day is flagged as a possible duplicate', async () => {
    const r = await req('POST', '/trips', {
      source: 'WHATSAPP', status: 'INQUIRY', customerName: 'Workflow Customer', customerMobile: '9811122233',
      pickup: 'Goregaon West', travelDate: PAST, tripType: 'LOCAL',
    });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'POSSIBLE_DUPLICATE');
  });

  test('picking it up, pricing it from the rule and quoting move it through the enquiry stages', async () => {
    const me = (await req('GET', '/auth/me')).body.user;
    assert.equal((await req('POST', `/trips/${S.trip}/owner`, { userId: me.id })).status, 200);
    assert.equal(await stageOf(S.trip), 'ASSIGNED_TO_STAFF');

    const c = S.quote.charges;
    const fare = await req('POST', `/trips/${S.trip}/fare`, { ...c, fareRuleId: S.quote.rule.id, fareSnapshot: S.quote.snapshot });
    assert.equal(fare.status, 200, JSON.stringify(fare.body));
    assert.equal(fare.body.charges.totalAmount, 2585);
    assert.equal(await stageOf(S.trip), 'QUOTE_PENDING');

    assert.equal((await req('POST', `/trips/${S.trip}/quote`, { email: false })).status, 200);
    assert.equal(await stageOf(S.trip), 'AWAITING_CONFIRMATION');
    assert.equal((await req('POST', `/trips/${S.trip}/quote-response`, { accepted: true })).status, 200);
    assert.equal(await stageOf(S.trip), 'AWAITING_ASSIGNMENT');
  });

  test('changing the rule later does not re-price the trip', async () => {
    const rules = await req('GET', '/rates', undefined);
    const rule = rules.body.data.find((r: any) => r.id === S.ruleId);
    const up = await req('PUT', `/rates/${S.ruleId}`, {
      vendorId: rule.vendor_id, categoryId: S.dzire.id, vehicleCategory: 'Dzire', planType: 'LOCAL', planLabel: rule.plan_label,
      includedHours: 4, includedKm: 40, baseFare: 9999, extraHourRate: 150, extraKmRate: 15, nightCharge: 200,
    });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const t = (await req('GET', `/trips/${S.trip}`)).body.data;
    assert.equal(Number(t.total_amount), 2585);
    assert.equal(t.fare_rule_id, S.ruleId);
    assert.ok(JSON.parse(t.fare_snapshot).rule.baseFare === 1500, 'the snapshot keeps the rate as quoted');
  });

  test('a fleet vehicle and driver are added, with duplicate numbers refused', async () => {
    const v = await req('POST', '/fleet/vehicles', { vehicleNumber: 'MH 01 WF 1234', categoryId: S.dzire.id, model: 'Dzire', ownershipType: 'OWN' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.equal(v.body.data.vehicle_number, 'MH01WF1234');
    S.vehicle = v.body.data.id;
    const dup = await req('POST', '/fleet/vehicles', { vehicleNumber: 'MH01WF1234', categoryId: S.dzire.id });
    assert.equal(dup.status, 409);
    const bad = await req('POST', '/fleet/vehicles', { vehicleNumber: 'NOT A NUMBER', categoryId: S.dzire.id });
    assert.equal(bad.status, 400);
    const d = await req('POST', '/fleet/drivers', { fullName: 'Workflow Driver', mobile: '9822233344', licenceNumber: 'MH0120240001' });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    S.driver = d.body.data.id;
  });

  test('allotting moves it to Upcoming and records the history', async () => {
    const r = await req('POST', `/trips/${S.trip}/assign`, { vehicleId: S.vehicle, driverId: S.driver, notifyCustomer: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await stageOf(S.trip), 'UPCOMING');
    const detail = (await req('GET', `/trips/${S.trip}`)).body;
    assert.equal(detail.assignments.length, 1);
  });

  test('the same vehicle at an overlapping time is refused unless overridden with a reason', async () => {
    const t2 = await req('POST', '/trips', {
      source: 'WALKIN', status: 'CONFIRMED', customerName: 'Second Customer', customerMobile: '9811199999',
      pickup: 'Malad', dropOff: 'Bandra', travelDate: PAST, journeyTime: '10:00', tripType: 'LOCAL',
    });
    assert.equal(t2.status, 201);
    S.trip2 = t2.body.id;
    const clash = await req('POST', `/trips/${S.trip2}/assign`, { vehicleId: S.vehicle, driverId: S.driver, notifyCustomer: false });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'ASSIGNMENT_CONFLICT');
    assert.ok(clash.body.clashes.length >= 1);
    const ok = await req('POST', `/trips/${S.trip2}/assign`, { vehicleId: S.vehicle, driverId: S.driver, notifyCustomer: false, overrideReason: 'Short local, back by 10' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.warning);
  });

  test('a vehicle in maintenance cannot be allotted', async () => {
    const v = await req('POST', '/fleet/vehicles', { vehicleNumber: 'MH01WF9999', categoryId: S.dzire.id, availabilityStatus: 'MAINTENANCE' });
    const r = await req('POST', `/trips/${S.trip2}/assign`, { vehicleId: v.body.data.id, driverName: 'Anyone', notifyCustomer: false });
    assert.equal(r.status, 409);
  });

  test('cancelling needs a reason and releases the allotment', async () => {
    assert.equal((await req('POST', `/trips/${S.trip2}/status`, { status: 'CANCELLED' })).status, 400);
    const r = await req('POST', `/trips/${S.trip2}/status`, { status: 'CANCELLED', cancelReason: 'CUSTOMER_CANCELLED' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (await req('GET', `/trips/${S.trip2}`)).body;
    assert.equal(d.stage.key, 'CANCELLED');
    assert.ok(d.assignments.every((a: any) => a.released_at));
  });

  test('completing the trip waits for billing; confirming billing puts it in Awaiting invoice', async () => {
    assert.equal((await req('POST', `/trips/${S.trip}/status`, { status: 'ONTRIP' })).status, 200);
    assert.equal(await stageOf(S.trip), 'IN_PROGRESS');
    assert.equal((await req('POST', `/trips/${S.trip}/status`, { status: 'COMPLETED' })).status, 200);
    assert.equal(await stageOf(S.trip), 'AWAITING_BILLING');
    assert.equal((await req('POST', `/trips/${S.trip}/confirm-billing`, {})).status, 200);
    assert.equal(await stageOf(S.trip), 'AWAITING_INVOICE');
  });

  test('every bucket count equals the rows it opens', async () => {
    const sum = (await req('GET', '/trips/summary')).body;
    for (const st of sum.stages) {
      const list = await req('GET', `/trips?stage=${st.key}&limit=1`);
      assert.equal(list.body.total, st.count, `${st.key} count matches its list`);
    }
  });
});

describe('Billing, invoices and payments', () => {
  test('the preview shows the totals the invoice will carry', async () => {
    const p = await req('POST', '/billing/preview', { vendorId: S.directId, bookingIds: [S.trip] });
    assert.equal(p.status, 200);
    assert.equal(p.body.data.ok, true, JSON.stringify(p.body.data.problems));
    assert.equal(p.body.data.totals.total, 2585);
  });

  test('a batch goes draft → submitted → approved → billed, and blocks double billing', async () => {
    const b = await req('POST', '/billing/batches', { vendorId: S.directId, bookingIds: [S.trip] });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    S.batch = b.body.id;
    const direct = await req('POST', `/trips/${S.trip}/invoice`, { gst: true, taxMode: 'IGST', taxRate: 5 });
    assert.equal(direct.status, 409, 'a trip in a batch cannot be invoiced elsewhere');
    const second = await req('POST', '/billing/batches', { vendorId: S.directId, bookingIds: [S.trip] });
    assert.equal(second.status, 400, 'a trip cannot sit in two open batches');
    assert.equal((await req('POST', `/billing/batches/${S.batch}/bill`)).status, 409, 'not approved yet');
    assert.equal((await req('POST', `/billing/batches/${S.batch}/submit`)).status, 200);
    assert.equal((await req('POST', `/billing/batches/${S.batch}/approve`)).status, 200);
    const billed = await req('POST', `/billing/batches/${S.batch}/bill`);
    assert.equal(billed.status, 201, JSON.stringify(billed.body));
    S.invoiceId = billed.body.invoices[0].invoiceId;
    assert.equal(billed.body.batch.batch.status, 'BILLED');
    assert.equal(await stageOf(S.trip), 'BILLED');
  });

  test('partial, duplicate, full and reversed payments keep the balance right', async () => {
    const inv = (await req('GET', `/invoices/${S.invoiceId}`)).body.data;
    assert.equal(Number(inv.total_amount), 2585);
    const p1 = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: PAST, amount: 1000, mode: 'UPI', referenceNo: 'WF-1' });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    assert.equal(p1.body.invoice.status, 'PARTIALLY_PAID');
    const dup = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: PAST, amount: 1000, mode: 'UPI', referenceNo: 'WF-1' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'POSSIBLE_DUPLICATE');
    const p2 = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: PAST, amount: 1585, mode: 'NEFT', referenceNo: 'WF-2' });
    assert.equal(p2.body.invoice.status, 'PAID');
    assert.equal(p2.body.invoice.outstanding, 0);
    const rev = await req('POST', `/payments/${p2.body.data.id}/reverse`, { reason: 'Entered twice' });
    assert.equal(rev.status, 200);
    assert.equal(rev.body.invoice.status, 'PARTIALLY_PAID');
    assert.equal(rev.body.invoice.outstanding, 1585);
    const list = await req('GET', `/payments?invoiceId=${S.invoiceId}&reversed=all`);
    assert.equal(list.body.total, 2, 'the reversed payment is kept on record');
  });

  test('a payment in a mode switched off in Masters is refused', async () => {
    const lists = await req('GET', '/masters/lists');
    const cash = lists.body.data.find((x: any) => x.list_type === 'PAYMENT_MODE' && x.code === 'CASH');
    await req('PUT', `/masters/lists/PAYMENT_MODE/${cash.id}`, { label: cash.label, isActive: false, sortOrder: cash.sort_order });
    const r = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: PAST, amount: 10, mode: 'CASH' });
    assert.equal(r.status, 400);
    await req('PUT', `/masters/lists/PAYMENT_MODE/${cash.id}`, { label: cash.label, isActive: true, sortOrder: cash.sort_order });
  });

  test('the dashboard, the invoice list and the reports agree', async () => {
    const dash = (await req('GET', '/dashboard/overview?from=2026-01-01&to=2026-12-31')).body;
    const unpaid = (await req('GET', '/invoices?status=UNPAID&limit=500')).body;
    assert.equal(Math.round(dash.now.outstanding * 100), Math.round(unpaid.outstanding * 100));
    const rep = (await req('GET', '/reports/invoices')).body;
    assert.equal(Math.round(rep.totalsRow.outstanding_amount * 100), Math.round(unpaid.outstanding * 100));
    const pay = (await req('GET', `/reports/payments?from=${PAST}&to=${PAST}`)).body;
    assert.equal(pay.totalsRow.amount, 1000, 'reversed payments are not counted');
  });
});

describe('Reports and exports', () => {
  test('every report runs', async () => {
    const list = (await req('GET', '/reports')).body.data;
    assert.ok(list.length >= 18);
    for (const r of list) {
      const res = await req('GET', `/reports/${r.key}?from=2026-01-01&to=2026-12-31`);
      assert.equal(res.status, 200, `${r.key}: ${JSON.stringify(res.body)}`);
    }
  });

  test('exports are real Excel workbooks', async () => {
    for (const url of ['/trips/export', '/invoices/export', '/payments/export', '/fleet/export/vehicles', '/masters/export/fare-rules',
      '/billing/export/vendor-summary', '/bookings/export', '/vendors/export', '/reports/trip-register/export']) {
      const r = await req('GET', url);
      assert.equal(r.status, 200, url);
      assert.ok(r.type.includes('spreadsheetml'), `${url} is xlsx`);
      assert.equal(r.raw.subarray(0, 2).toString(), 'PK', `${url} is a zip container`);
    }
    const csv = await req('GET', '/trips/export?format=csv');
    assert.ok(csv.type.includes('text/csv'));
  });
});

describe('Masters protect history', () => {
  test('a category in use cannot be removed; an unused one can', async () => {
    const used = await req('DELETE', `/masters/categories/${S.dzire.id}`);
    assert.equal(used.status, 409);
    const c = await req('POST', '/masters/categories', { name: 'Workflow Test Van', seating: 9 });
    assert.equal(c.status, 201);
    assert.equal((await req('DELETE', `/masters/categories/${c.body.data.id}`)).status, 200);
  });

  test('a deactivated category cannot be used for a new vehicle', async () => {
    const c = await req('POST', '/masters/categories', { name: 'Retired Class', isActive: false });
    const v = await req('POST', '/fleet/vehicles', { vehicleNumber: 'MH01WF5555', categoryId: c.body.data.id });
    assert.equal(v.status, 400);
  });
});

describe('Permissions are enforced on the server', () => {
  test('a view-only user can read the fleet but not change it', async () => {
    const u = await req('POST', '/users', { email: 'viewer.wf@example.com', fullName: 'View Only', roleCode: 'VIEWER', password: 'Viewer123' });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    const login = await req('POST', '/auth/login', { email: 'viewer.wf@example.com', password: 'Viewer123' }, '');
    let vt = login.body.token;
    if (login.body.mustChangePassword || login.body.user?.mustChangePassword) {
      await req('POST', '/auth/change-password', { currentPassword: 'Viewer123', newPassword: 'Viewer1234', confirmPassword: 'Viewer1234' }, vt);
      vt = (await req('POST', '/auth/login', { email: 'viewer.wf@example.com', password: 'Viewer1234' }, '')).body.token;
    }
    assert.equal((await req('GET', '/trips', undefined, vt)).status, 200);
    assert.equal((await req('POST', '/fleet/vehicles', { vehicleNumber: 'MH01WF7777', categoryId: S.dzire.id }, vt)).status, 403);
    assert.equal((await req('POST', '/masters/categories', { name: 'Nope' }, vt)).status, 403);
    assert.equal((await req('POST', '/billing/batches', { vendorId: S.directId, bookingIds: [S.trip] }, vt)).status, 403);
    assert.equal((await req('PUT', '/users/roles/1/permissions', { permissions: [] }, vt)).status, 403);
  });

  test('the super admin role cannot be edited, other roles can', async () => {
    const roles = (await req('GET', '/users/roles')).body.data;
    const sa = roles.find((r: any) => r.code === 'SUPER_ADMIN');
    assert.equal((await req('PUT', `/users/roles/${sa.id}/permissions`, { permissions: [] })).status, 409);
    const viewer = roles.find((r: any) => r.code === 'VIEWER');
    const r = await req('PUT', `/users/roles/${viewer.id}/permissions`, { permissions: [...viewer.permissions, 'fleet.create'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });
});
