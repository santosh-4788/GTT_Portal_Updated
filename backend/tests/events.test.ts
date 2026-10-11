/**
 * Events, end to end.
 *
 * Create an event → preview requirement rows (errors reported, nothing saved)
 * → bulk add → parse an uploaded sheet and a pasted grid into a suggested
 * mapping → generate trips twice (no duplicates) → allot, complete, invoice
 * and part-pay one trip → the event summary matches the real rows → cancel
 * (open lines and un-started trips only; the invoiced trip is untouched).
 *
 * Own port and scratch database, like the other test files.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-events-'));
process.env.DB_FILE = path.join(TEST_DIR, 'events.db');
process.env.PORT = '4155';
process.env.JWT_SECRET = 'events-test-secret';
process.env.NODE_ENV = 'test';
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4155/api';
let token = '';

async function req(method: string, url: string, body?: any, auth = token) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(BASE + url, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
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
    if (Date.now() - started > timeoutMs) throw new Error('The events test server never came up.');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const S: Record<string, any> = {};
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const START = day(5);
const END = day(7);
const dmy = (iso: string) => iso.split('-').reverse().join('-');

before(async () => {
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  await import('../src/server');
  await waitForServer();
  const login = await req('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' }, '');
  token = login.body.token;
  await req('POST', '/auth/change-password', { currentPassword: 'Pass@123', newPassword: 'Events1234', confirmPassword: 'Events1234' });
});

after(async () => {
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));
  const { closeDb } = await import('../src/db');
  closeDb();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp */ }
});

describe('Creating an event', () => {
  test('permissions exist and a company is chosen from the vendor list', async () => {
    const perms = await req('GET', '/users/permissions');
    for (const code of ['events.view', 'events.create', 'events.update', 'events.delete']) {
      assert.ok(perms.body.data.some((p: any) => p.code === code), `${code} exists`);
    }
    const v = await req('GET', '/vendors/options');
    S.vendor = v.body.data.find((x: any) => x.code !== 'DIRECT');
    assert.ok(S.vendor, 'a company to bill');
  });

  test('bad input is refused with a reason', async () => {
    const r = await req('POST', '/events', { name: 'X', vendorId: S.vendor.id, startDate: START });
    assert.equal(r.status, 400);
    const r2 = await req('POST', '/events', { name: 'Backwards', vendorId: S.vendor.id, startDate: END, endDate: START });
    assert.equal(r2.status, 400);
    const r3 = await req('POST', '/events', { name: 'Direct without a name', startDate: START });
    assert.equal(r3.status, 400, 'a direct event needs the client');
  });

  test('an event is created with an EV code', async () => {
    const r = await req('POST', '/events', {
      name: 'Sharma Wedding', vendorId: S.vendor.id, clientName: 'Sharma family', contactPerson: 'Rohit Sharma',
      contactMobile: '9876543210', contactEmail: 'rohit@example.com', venue: 'Taj Lands End, Bandra', city: 'Mumbai',
      startDate: START, endDate: END, agreedAmount: 100000, status: 'PLANNED',
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.data.event_code, /^EV-\d{4}-\d{4}$/);
    S.event = r.body.data.id;
    S.code = r.body.data.event_code;
    assert.equal(r.body.summary.requirements, 0);
    const second = await req('POST', '/events', { name: 'Direct Corporate Day', clientName: 'Walk-in Co', startDate: START });
    assert.equal(second.status, 201);
    assert.notEqual(second.body.data.event_code, S.code, 'codes are unique');
    assert.equal(second.body.data.vendor_code, 'DIRECT');
    S.directEvent = second.body.data.id;
  });
});

describe('Requirements', () => {
  test('preview reports per-row errors and warnings and saves nothing', async () => {
    const r = await req('POST', `/events/${S.event}/requirements/preview`, {
      rows: [
        { travelDate: dmy(START), reportingTime: '7:30 am', vehicleCategory: 'Dzire', vehicleCount: '3', pickupAddress: 'Taj', farePerVehicle: '2,500' },
        { travelDate: '', vehicleCategory: 'Dzire', vehicleCount: 1 },
        { travelDate: START, vehicleCategory: 'Spaceship', vehicleCount: 0, passengerMobile: '12345' },
        { travelDate: '31-02-2026', reportingTime: '25:99', vehicleCategory: 'Ertiga' },
      ],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.valid, 1);
    assert.equal(d.invalid, 3);
    assert.equal(d.rows[0].data.reporting_time, '07:30');
    assert.equal(d.rows[0].data.travel_date, START);
    assert.equal(d.rows[0].data.fare_per_vehicle, 2500);
    assert.equal(d.rows[0].data.vehicle_count, 3);
    const fields = (i: number) => d.rows[i].errors.map((e: any) => e.field);
    assert.ok(fields(1).includes('travelDate'));
    assert.ok(fields(2).includes('vehicleCategory'));
    assert.ok(fields(2).includes('vehicleCount'));
    assert.ok(fields(2).includes('passengerMobile'));
    assert.ok(fields(3).includes('travelDate'));
    assert.ok(fields(3).includes('reportingTime'));
    const ev = await req('GET', `/events/${S.event}`);
    assert.equal(ev.body.requirements.length, 0, 'preview saved nothing');
  });

  test('a bulk add with any bad row is refused whole', async () => {
    const r = await req('POST', `/events/${S.event}/requirements`, {
      rows: [{ travelDate: START, vehicleCategory: 'Dzire' }, { travelDate: 'tomorrow-ish', vehicleCategory: 'Dzire' }],
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'ROWS_INVALID');
    assert.equal((await req('GET', `/events/${S.event}`)).body.requirements.length, 0);
  });

  test('bulk add saves every row', async () => {
    const r = await req('POST', `/events/${S.event}/requirements`, {
      rows: [
        { travelDate: START, reportingTime: '07:00', vehicleCategory: 'Dzire', vehicleCount: 3, pickupAddress: 'Taj Lands End', dropAddress: 'Juhu', farePerVehicle: 2500 },
        { travelDate: day(6), reportingTime: '18:00', vehicleCategory: 'Ertiga', vehicleCount: 2, farePerVehicle: 3200, passengerName: 'Guest A', passengerMobile: '+91 98200 11111' },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.requirements.length, 2);
    assert.equal(r.body.summary.vehicles_required, 5);
    S.lineA = r.body.requirements.find((x: any) => x.vehicle_count === 3).id;
    S.lineB = r.body.requirements.find((x: any) => x.vehicle_count === 2).id;
  });

  test('a line is edited, and one without trips can be deleted', async () => {
    const add = await req('POST', `/events/${S.event}/requirements`, { rows: [{ travelDate: END, vehicleCategory: 'Dzire', vehicleCount: 1 }] });
    const extra = add.body.requirements.find((x: any) => x.travel_date === END);
    const up = await req('PUT', `/events/${S.event}/requirements/${extra.id}`, { travelDate: END, vehicleCategory: 'Ertiga', vehicleCount: 4 });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.requirements.find((x: any) => x.id === extra.id).vehicle_count, 4);
    const del = await req('DELETE', `/events/${S.event}/requirements/${extra.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, true);
    assert.equal(del.body.requirements.length, 2);
  });
});

describe('Importing a sheet', () => {
  test('an uploaded .xlsx is parsed with a suggested column mapping', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Cars');
    ws.addRow(['Sharma wedding — vehicle list']);
    ws.addRow(['Date', 'Reporting Time', 'Car Type', 'No. of Vehicles', 'Pickup Location', 'Guest Name', 'Mobile No', 'Rate']);
    ws.addRow([new Date(`${START}T00:00:00Z`), '08:15', 'Toyota Innova Crysta', 2, 'Hotel Sahara Star', 'Mr Mehta', '9820012345', 4200]);
    ws.addRow([dmy(END), '9 pm', 'Dzire', 1, 'Airport T2', 'Ms Rao', '9820054321', '₹1,800']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const form = new FormData();
    form.append('file', new Blob([buf]), 'cars.xlsx');
    const r = await req('POST', `/events/${S.event}/import/parse`, form);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.equal(d.hasHeader, true);
    assert.equal(d.total, 2);
    assert.equal(d.mapping.travelDate, 0);
    assert.equal(d.mapping.reportingTime, 1);
    assert.equal(d.mapping.vehicleCategory, 2);
    assert.equal(d.mapping.vehicleCount, 3);
    assert.equal(d.mapping.pickupAddress, 4);
    assert.equal(d.mapping.passengerName, 5);
    assert.equal(d.mapping.passengerMobile, 6);
    assert.equal(d.mapping.farePerVehicle, 7);
    assert.equal(d.rows[0][0], START, 'Excel dates come back as ISO');

    // The mapped rows go through the same preview.
    const rows = d.rows.map((row: string[]) => Object.fromEntries(Object.entries(d.mapping).map(([f, i]) => [f, row[i as number]])));
    const p = await req('POST', `/events/${S.event}/requirements/preview`, { rows });
    assert.equal(p.body.data.invalid, 0, JSON.stringify(p.body.data.rows.map((x: any) => x.errors)));
    assert.equal(p.body.data.rows[1].data.reporting_time, '21:00');
    assert.equal(p.body.data.rows[1].data.fare_per_vehicle, 1800);
    assert.equal(p.body.data.rows[0].category_name, 'Toyota Innova Crysta');
  });

  test('a pasted tab-separated grid and a CSV upload are parsed too', async () => {
    const text = `Date\tVehicle\tQty\tPickup\n${dmy(START)}\tErtiga\t2\tTaj\n${dmy(END)}\tDzire\t1\tJuhu`;
    const r = await req('POST', `/events/${S.event}/import/parse`, { text });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.data.headers, ['Date', 'Vehicle', 'Qty', 'Pickup']);
    assert.equal(r.body.data.mapping.vehicleCount, 2);
    assert.equal(r.body.data.rows.length, 2);

    const form = new FormData();
    form.append('file', new Blob(['travel date,vehicle type,count\n' + `${START},Dzire,2\n`]), 'list.csv');
    const c = await req('POST', `/events/${S.event}/import/parse`, form);
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.data.mapping.travelDate, 0);
    assert.equal(c.body.data.mapping.vehicleCategory, 1);

    const bad = new FormData();
    bad.append('file', new Blob(['x']), 'old.xls');
    assert.equal((await req('POST', `/events/${S.event}/import/parse`, bad)).status, 400);
  });
});

describe('Generating trips', () => {
  test('the plan says how many trips will be created', async () => {
    const r = await req('GET', `/events/${S.event}/generate-trips`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.trips, 5);
  });

  test('trips are created once — a second run creates nothing', async () => {
    const r = await req('POST', `/events/${S.event}/generate-trips`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.created.length, 5);
    assert.equal(r.body.trips.length, 5);
    assert.equal(r.body.data.status, 'CONFIRMED', 'a planned event becomes confirmed');
    const t = r.body.trips[0];
    assert.equal(t.booking_status, 'CONFIRMED');
    assert.equal(t.stage, 'AWAITING_ASSIGNMENT');
    assert.equal(Number(t.base_fare), 2500, 'fare per vehicle becomes the base fare');
    S.trips = r.body.trips;

    const again = await req('POST', `/events/${S.event}/generate-trips`);
    assert.equal(again.status, 200);
    assert.equal(again.body.created.length, 0);
    assert.equal(again.body.trips.length, 5, 'no duplicates');

    // Trips are ordinary bookings for the event's company.
    const trip = await req('GET', `/trips/${S.trips[0].id}`);
    assert.equal(trip.status, 200);
    assert.equal(trip.body.data.vendor_id, S.vendor.id);

    // Raising the count only fills the gap.
    const up = await req('PUT', `/events/${S.event}/requirements/${S.lineB}`, { travelDate: day(6), reportingTime: '18:00', vehicleCategory: 'Ertiga', vehicleCount: 3, farePerVehicle: 3200 });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const third = await req('POST', `/events/${S.event}/generate-trips`);
    assert.equal(third.body.created.length, 1);
    assert.equal(third.body.trips.length, 6);
    const down = await req('PUT', `/events/${S.event}/requirements/${S.lineB}`, { travelDate: day(6), vehicleCategory: 'Ertiga', vehicleCount: 1 });
    assert.equal(down.status, 409, 'cannot drop below the trips already created');
    S.trips = third.body.trips;
  });
});

describe('Summary from real rows', () => {
  test('allot, complete, invoice and part-pay one trip; the summary follows', async () => {
    const t = S.trips[0];
    const a = await req('POST', `/trips/${t.id}/assign`, { vehicleNumber: 'MH01EV0001', driverName: 'Event Driver', driverMobile: '9811100001', notifyCustomer: false });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await req('POST', `/trips/${S.trips[1].id}/assign`, { vehicleNumber: 'MH01EV0002', driverName: 'Second Driver', notifyCustomer: false });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal((await req('POST', `/trips/${t.id}/status`, { status: 'ONTRIP' })).status, 200);
    assert.equal((await req('POST', `/trips/${t.id}/status`, { status: 'COMPLETED' })).status, 200);

    let s = (await req('GET', `/events/${S.event}`)).body.summary;
    assert.equal(s.vehicles_required, 6);
    assert.equal(s.trips_created, 6);
    assert.equal(s.vehicles_allocated, 2);
    assert.equal(s.drivers_assigned, 2);
    assert.equal(s.trips_completed, 1);
    assert.equal(s.awaiting_billing, 1);
    assert.equal(s.billed, 0);

    // The billing module asks for the final charges to be confirmed first.
    const conf = await req('POST', `/trips/${t.id}/confirm-billing`, {});
    assert.equal(conf.status, 200, JSON.stringify(conf.body));
    const inv = await req('POST', `/trips/${t.id}/invoice`, { gst: true, taxMode: 'IGST', taxRate: 5 });
    assert.ok([200, 201].includes(inv.status), JSON.stringify(inv.body));
    const ev = await req('GET', `/events/${S.event}`);
    const billedTrip = ev.body.trips.find((x: any) => x.id === t.id);
    assert.ok(billedTrip.invoice_id, 'the trip shows its invoice');
    assert.equal(billedTrip.stage, 'BILLED');
    S.invoiceId = billedTrip.invoice_id;
    const total = Number(billedTrip.invoice_total);
    assert.equal(total, 2625, '2500 + 5% IGST');

    const pay = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: day(0), amount: 1000, mode: 'UPI', referenceNo: 'EV-T-1' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    const pay2 = await req('POST', '/payments', { invoiceId: S.invoiceId, paymentDate: day(0), amount: 500, mode: 'UPI', referenceNo: 'EV-T-2' });
    assert.equal(pay2.status, 201, JSON.stringify(pay2.body));
    assert.equal((await req('POST', `/payments/${pay2.body.data.id}/reverse`, { reason: 'Bounced' })).status, 200);

    s = (await req('GET', `/events/${S.event}`)).body.summary;
    assert.equal(s.billed, 2625);
    assert.equal(s.received, 1000, 'reversed payments are excluded');
    assert.equal(s.outstanding, 1625);
    assert.equal(s.awaiting_billing, 0);
    assert.equal(s.invoices, 1);

    const list = await req('GET', `/events?search=${encodeURIComponent('Sharma')}`);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].summary.billed, 2625);
  });

  test('the list exports to Excel', async () => {
    const r = await req('GET', '/events/export?format=xlsx');
    assert.equal(r.status, 200);
    assert.match(r.type, /spreadsheetml/);
    assert.equal(r.raw.subarray(0, 2).toString(), 'PK');
  });
});

describe('Cancelling', () => {
  test('a line with trips is cancelled, not deleted', async () => {
    const r = await req('DELETE', `/events/${S.event}/requirements/${S.lineB}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.cancelled, true);
    assert.equal(r.body.requirements.find((x: any) => x.id === S.lineB).status, 'CANCELLED');
    assert.ok(r.body.trips.filter((x: any) => x.event_requirement_id === S.lineB).every((x: any) => x.booking_status === 'CANCELLED'));
  });

  test('cancelling the event leaves the invoiced trip alone', async () => {
    const r = await req('POST', `/events/${S.event}/cancel`, { reason: 'PLAN_CHANGED', note: 'Postponed' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'CANCELLED');
    const billed = r.body.trips.find((x: any) => x.id === S.trips[0].id);
    assert.equal(billed.booking_status, 'COMPLETED');
    assert.equal(billed.stage, 'BILLED');
    assert.ok(r.body.trips.filter((x: any) => x.id !== S.trips[0].id).every((x: any) => x.booking_status === 'CANCELLED'));
    assert.ok(r.body.requirements.every((x: any) => x.status === 'CANCELLED'));
    assert.equal(r.body.summary.billed, 2625, 'billing figures survive');

    assert.equal((await req('POST', `/events/${S.event}/cancel`, {})).status, 409);
    assert.equal((await req('POST', `/events/${S.event}/generate-trips`)).status, 409);
    const activity = (await req('GET', `/events/${S.event}`)).body.activity;
    assert.ok(activity.some((a: any) => a.action === 'EVENT_CANCELLED'));
    assert.ok(activity.some((a: any) => a.action === 'EVENT_TRIPS_GENERATED'));
  });

  test('a viewer can read but not create', async () => {
    const u = await req('POST', '/users', { email: 'viewer.ev@example.com', fullName: 'View Only', roleCode: 'VIEWER', password: 'Viewer123' });
    assert.equal(u.status, 201, JSON.stringify(u.body));
    let vt = (await req('POST', '/auth/login', { email: 'viewer.ev@example.com', password: 'Viewer123' }, '')).body.token;
    const cp = await req('POST', '/auth/change-password', { currentPassword: 'Viewer123', newPassword: 'Viewer1234', confirmPassword: 'Viewer1234' }, vt);
    if (cp.status === 200) vt = (await req('POST', '/auth/login', { email: 'viewer.ev@example.com', password: 'Viewer1234' }, '')).body.token;
    assert.equal((await req('POST', '/events', { name: 'Nope event', clientName: 'X', startDate: START }, vt)).status, 403);
  });
});
