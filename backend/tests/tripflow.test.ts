/**
 * The booking-to-settlement flow added with company messages and billing
 * confirmation:
 *
 *   company message parsed with the company's own rules → booking saved with a
 *   category (duplicate reference refused) → walk-in booking in the same flow →
 *   vehicle added with a new regular driver inline → availability for the trip
 *   window (driver on leave shown, refused, overridden only with a reason) →
 *   trip completed with actuals → invoice refused until billing is confirmed →
 *   a fare change withdraws the confirmation → invoice → payment → settled.
 *
 * Own port and scratch database, like the other test files. The confirmation
 * gate is ON here (the default), unlike the older invoicing suites.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-tripflow-'));
process.env.DB_FILE = path.join(TEST_DIR, 'tripflow.db');
process.env.PORT = '4177';
process.env.JWT_SECRET = 'tripflow-test-secret';
process.env.NODE_ENV = 'test';
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4177/api';
let token = '';
const S: Record<string, any> = {};
const DAY = '2026-09-15';

async function req(method: string, url: string, body?: any, auth = token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, body: json };
}

async function waitForServer(timeoutMs = 15_000) {
  const started = Date.now();
  for (;;) {
    try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* not yet */ }
    if (Date.now() - started > timeoutMs) throw new Error('The tripflow test server never came up.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const fixture = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures', `${n}.txt`), 'utf8');
const stageOf = async (id: number) => (await req('GET', `/trips/${id}`)).body.stage?.key;

before(async () => {
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  await import('../src/server');
  await waitForServer();
  const login = await req('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' }, '');
  token = login.body.token;
  await req('POST', '/auth/change-password', { currentPassword: 'Pass@123', newPassword: 'Tripflow123', confirmPassword: 'Tripflow123' });
});

after(async () => {
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../src/db');
  closeDb();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp */ }
});

describe('Company messages', () => {
  test('companies are registered with aliases and their own parser rules', async () => {
    const honza = await req('POST', '/vendors', {
      code: 'HONZA', vendorName: 'Honza', mobile: '9800000097', aliases: 'HONZA Travels',
      parserConfig: { noReference: true },
    });
    assert.equal(honza.status, 201, JSON.stringify(honza.body));
    S.honza = honza.body.data.id;
    const dest = await req('POST', '/vendors', {
      code: 'DESTN', vendorName: 'Destination', companyName: 'Shreedestinations Travel Pvt. Ltd.',
      aliases: 'Shreedestinations, Shree Destinations', mobile: '9800000099',
    });
    assert.equal(dest.status, 201, JSON.stringify(dest.body));
    S.dest = dest.body.data.id;
  });

  test('the company is recognised from the sign-off; its contact is never the passenger', async () => {
    const r = await req('POST', '/bookings/parse-message', { message: fixture('honza') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.company?.id, S.honza);
    assert.equal(r.body.fields.passengerMobile, '9800000005');
    assert.equal(r.body.fields.contactNumber, '9800000097');
    assert.equal(r.body.fieldStatus.vendorBookingRef, 'not_applicable', 'Honza never sends a reference');
    assert.equal(r.body.fieldStatus.travelDate, 'confirm', 'a date without a year needs confirming');
  });

  test('an unknown sender is reported, not guessed', async () => {
    const msg = 'For Neha ( 9820011111 )\nDate: 12/10\nReporting address: BKC\nRegards Skyline Cabs,\n9123456789';
    const r = await req('POST', '/bookings/parse-message', { message: msg });
    assert.equal(r.body.company, null);
    assert.match(r.body.unknownCompany?.name ?? '', /Skyline/);
  });

  test('a parsed booking is saved once; the same company reference is refused', async () => {
    const parsed = (await req('POST', '/bookings/parse-message', { message: fixture('destination'), vendorId: S.dest })).body;
    assert.equal(parsed.company.id, S.dest);
    const f = parsed.fields;
    const body = {
      bookingSource: 'VENDOR', vendorId: S.dest, vendorBookingRef: f.vendorBookingRef, travelDate: DAY,
      reportingTime: f.reportingTime, tripType: f.tripType, airportDirection: f.airportDirection,
      pickupLocation: f.pickupAddress, dropLocation: f.dropAddress, passengerName: f.passengerName,
      passengerMobile: f.passengerMobile, vehicleCategoryId: parsed.suggestions.categoryId, vehicleType: f.vehicleType,
      rawMessage: fixture('destination'), charges: {},
    };
    const r = await req('POST', '/bookings', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    S.trip = r.body.data.id;
    assert.ok(r.body.data.trip_id, 'every booking gets a Trip ID');
    assert.ok(r.body.data.vehicle_category_id, 'the category is stored');
    assert.equal(r.body.data.billing_status, 'PENDING', 'no fare was invented');

    const again = await req('POST', '/bookings', body);
    assert.equal(again.status, 409);
    const dup = (await req('POST', '/bookings/parse-message', { message: fixture('destination'), vendorId: S.dest })).body;
    assert.equal(dup.duplicate?.id, S.trip);

    const list = await req('GET', `/trips?search=${encodeURIComponent(f.vendorBookingRef)}`);
    assert.equal(list.body.data.length, 1, 'the booking shows on Trips, once');
  });

  test('a walk-in uses the same booking flow and is billed to the customer', async () => {
    const r = await req('POST', '/bookings', {
      bookingSource: 'DIRECT', inquirySource: 'WALKIN', customerName: 'Counter Customer', customerMobile: '9811100000',
      travelDate: DAY, reportingTime: '18:00', tripType: 'LOCAL', pickupLocation: 'Andheri', passengerName: 'Counter Customer',
      charges: { baseFare: 1200 },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.inquiry_source, 'WALKIN');
    assert.equal(r.body.data.booking_source, 'DIRECT');
  });
});

describe('Fleet and allotment', () => {
  test('a vehicle is added with a new regular driver in one step', async () => {
    const cats = (await req('GET', '/fares/categories')).body.data;
    const dzire = cats.find((c: any) => c.code === 'DZIRE');
    const r = await req('POST', '/fleet/vehicles', {
      vehicleNumber: 'MH04TF1001', categoryId: dzire.id, ownershipType: 'HIRED', ownerName: 'Partner Cabs',
      newDriver: { fullName: 'Ramesh Inline', mobile: '9822000001', associationType: 'HIRED' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    S.vehicle = r.body.data.id;
    assert.ok(r.body.data.regular_driver_id, 'the new driver is the regular driver');
    assert.equal(r.body.data.ownership_type, 'PARTNER', 'Hired is stored as before');
    S.regular = r.body.data.regular_driver_id;
    const d = await req('GET', `/fleet/drivers/${S.regular}`);
    assert.equal(d.body.data.full_name, 'Ramesh Inline');
    assert.equal(d.body.data.default_vehicle_id, S.vehicle);

    const dup = await req('POST', '/fleet/vehicles', {
      vehicleNumber: 'MH04TF1002', categoryId: dzire.id, newDriver: { fullName: 'Same Number', mobile: '9822000001' },
    });
    assert.equal(dup.status, 409, 'a driver already on the roster is not added twice');
    assert.equal((await req('GET', '/fleet/vehicles?search=MH04TF1002')).body.data.length, 0, 'nothing half-saved');
  });

  test('a driver on leave is shown as unavailable for the trip window', async () => {
    const r = await req('POST', '/fleet/drivers', {
      fullName: 'Leave Driver', mobile: '9822000002', leaveFrom: '2026-09-14', leaveTo: '2026-09-16', associationType: 'EMPLOYEE',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    S.onLeave = r.body.data.id;
    const o = await req('GET', `/fleet/assign-options?bookingId=${S.trip}`);
    assert.equal(o.status, 200);
    const v = o.body.vehicles.find((x: any) => x.id === S.vehicle);
    assert.equal(v.state, 'AVAILABLE');
    assert.equal(v.regular_driver_id, S.regular);
    const d = o.body.drivers.find((x: any) => x.id === S.onLeave);
    assert.equal(d.state, 'ON_LEAVE');
    assert.ok(d.reasons.some((x: string) => /leave/i.test(x)));
  });

  test('allotting a driver on leave needs an authorised override with a reason', async () => {
    const refused = await req('POST', `/trips/${S.trip}/assign`, { vehicleId: S.vehicle, driverId: S.onLeave, notifyCustomer: false });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'ASSIGNMENT_UNAVAILABLE');
    const ok = await req('POST', `/trips/${S.trip}/assign`, { vehicleId: S.vehicle, driverId: S.onLeave, notifyCustomer: false, overrideReason: 'Driver came back early' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // Change driver back to the regular one; the history keeps both.
    const change = await req('POST', `/trips/${S.trip}/assign`, { vehicleId: S.vehicle, driverId: S.regular, notifyCustomer: false });
    assert.equal(change.status, 200, JSON.stringify(change.body));
    const d = (await req('GET', `/trips/${S.trip}`)).body;
    assert.equal(d.data.driver_id, S.regular);
    assert.ok(d.assignments.length >= 2);
    assert.ok(d.assignments.some((a: any) => a.override_reason === 'Driver came back early'));
  });
});

describe('Completion, billing confirmation, invoice, payment', () => {
  test('completing records the actuals and waits for billing', async () => {
    const r = await req('POST', `/trips/${S.trip}/complete`, {
      completedAt: `${DAY}T14:30`, startKm: 1000, endKm: 1085, actualHours: 5,
      baseFare: 2000, extraKm: 5, extraKmRate: 14, toll: 120, parking: 60, remarks: 'Waited at the airport',
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.actual_km, 85);
    assert.equal(r.body.charges.taxableAmount, 2070);
    assert.equal(await stageOf(S.trip), 'AWAITING_BILLING');
  });

  test('an invoice is refused until billing is confirmed', async () => {
    const r = await req('POST', `/trips/${S.trip}/invoice`, { gst: true, taxMode: 'IGST', taxRate: 5 });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'BILLING_NOT_CONFIRMED');
  });

  test('confirming moves it to awaiting invoice; changing the fare withdraws that', async () => {
    assert.equal((await req('POST', `/trips/${S.trip}/confirm-billing`, {})).status, 200);
    assert.equal(await stageOf(S.trip), 'AWAITING_INVOICE');
    const fare = await req('POST', `/trips/${S.trip}/fare`, { baseFare: 2100, extraKm: 5, extraKmRate: 14, toll: 120, parking: 60, taxMode: 'IGST', taxRate: 5 });
    assert.equal(fare.status, 200, JSON.stringify(fare.body));
    assert.equal(await stageOf(S.trip), 'AWAITING_BILLING', 'new figures need confirming again');
    const bulk = await req('POST', '/trips/confirm-billing', { ids: [S.trip] });
    assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
    assert.equal(await stageOf(S.trip), 'AWAITING_INVOICE');
  });

  test('invoiced, paid in full, settled', async () => {
    const inv = await req('POST', `/trips/${S.trip}/invoice`, { gst: true, taxMode: 'IGST', taxRate: 5 });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const d = (await req('GET', `/trips/${S.trip}`)).body.data;
    assert.ok(d.invoice_id);
    assert.equal(await stageOf(S.trip), 'BILLED');
    const sum = (await req('GET', '/trips/summary')).body;
    assert.ok(sum.paymentPending >= 1);

    const pay = await req('POST', '/payments', { invoiceId: d.invoice_id, amount: d.invoice_total, paymentDate: DAY, mode: 'UPI', referenceNo: 'UTR-TF-1' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    assert.equal(await stageOf(S.trip), 'SETTLED');
  });

  test('the pending-work report lists only trips waiting on the office', async () => {
    const r = await req('GET', '/reports/pending-work?from=2026-09-01&to=2026-09-30');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const rows = r.body.rows ?? r.body.data ?? [];
    assert.ok(!rows.some((x: any) => x.id === S.trip), 'a settled trip is not pending');
  });
});
