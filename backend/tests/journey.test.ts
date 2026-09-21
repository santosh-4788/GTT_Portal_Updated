/**
 * The customer journey, end to end.
 *
 * Enquiry -> Trip ID -> the office sees it under its source -> vehicle and
 * driver allotted -> trip completed -> GST invoice raised -> the customer signs
 * in and downloads it.
 *
 * Email is deliberately NOT configured here. Every send therefore falls through
 * to a QUEUED row in email_log, which is exactly what these tests want to prove:
 * the journey completes whether or not the mailbox is reachable, and nothing is
 * lost when it is not.
 *
 * Runs on its own port and its own scratch database so it cannot interfere with
 * api.test.ts.
 *
 * Run:  npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-journey-'));
process.env.DB_FILE = path.join(TEST_DIR, 'journey.db');
process.env.PORT = '4112';
process.env.JWT_SECRET = 'journey-test-secret';
process.env.NODE_ENV = 'test';
// Make sure a developer's own working mailbox is never used by the suite.
process.env.MAIL_APP_PASSWORD = '';

const BASE = 'http://127.0.0.1:4112/api';

let staffToken = '';
let customerToken = '';

async function req(method: string, url: string, body?: any, auth?: string) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

/** As the office. */
const admin = (method: string, url: string, body?: any) => req(method, url, body, staffToken);
/** As the customer. */
const customer = (method: string, url: string, body?: any) => req(method, url, body, customerToken);
/** As a visitor with no session at all. */
const anon = (method: string, url: string, body?: any) => req(method, url, body);

/**
 * Wait until the server is actually answering.
 *
 * A fixed `setTimeout` was a guess, and a bad one: when the port is already
 * taken — a stray dev server, or the other test file still shutting down — the
 * app prints "port in use" and calls process.exit(1), and every request after
 * the guessed delay then hangs on a connection that will never be accepted.
 * The suite sat there until something killed it, which reads as "the tests are
 * slow" rather than "the tests never ran".
 */
async function waitForServer(timeoutMs = 15_000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return;
    } catch {
      /* not listening yet */
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(
        `The test server never came up on ${BASE}. The usual cause is the port ` +
        `already being in use — check for a stray "tsx src/server.ts" process.`
      );
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

before(async () => {
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  await import('../src/server');
  await waitForServer();

  const login = await anon('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' });
  staffToken = login.body.token;

  // The seeded admin is forced to change its password before it can do anything.
  await admin('POST', '/auth/change-password', {
    currentPassword: 'Pass@123',
    newPassword: 'JourneyTest1',
    confirmPassword: 'JourneyTest1',
  });
});

after(async () => {
  // Close the listener rather than calling process.exit(). Exiting outright
  // races the test reporter — the file's results are cut off mid-stream and the
  // runner reports fewer passing tests than actually ran, which is the worst
  // possible failure mode for a test suite.
  const { httpServer } = await import('../src/server');
  await new Promise<void>((resolve) => (httpServer ? httpServer.close(() => resolve()) : resolve()));

  const { closeDb } = await import('../src/db');
  closeDb();

  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
});

/* ========================================================================== */

/** Carried between describes — node:test runs a file's tests in order. */
const state = { tripId: '', tripRowId: 0, customerId: 0 };

describe('Enquiries become trips', () => {
  test('an email enquiry is given a Trip ID straight away', async () => {
    const r = await anon('POST', '/public/enquiry', {
      name: 'Journey Tester',
      mobile: '9820055667',
      email: 'journey.tester@example.com',
      service: 'Airport Transfers',
      pickup: 'Andheri East',
      dropOff: 'Terminal 2',
      travelDate: '2027-01-15',
      travelTime: '06:30',
      vehicleType: 'Innova Crysta',
    });

    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-EM-\d{4}-\d{4}$/, 'an email enquiry carries the EM prefix');
    assert.match(r.body.message, /GTT-EM-/, 'the Trip ID is put in front of the customer');
    assert.equal(r.body.sentFrom, 'vinaykumar87674@gmail.com');
    state.tripId = r.body.tripId;
  });

  test('a WhatsApp enquiry has its own prefix and a prepared chat message', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'Whatsapp Tester',
      mobile: '9820055668',
      sameAsContact: true,
      email: 'wa.tester@example.com',
      pickup: 'Goregaon West',
      dropOff: 'Lonavala',
      travelDate: '2027-02-02',
      travelTime: '07:00',
      vehicleType: 'Ertiga',
    });

    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-WA-\d{4}-\d{4}$/, 'a WhatsApp enquiry carries the WA prefix');
    assert.match(r.body.whatsappText, new RegExp(r.body.tripId), 'the chat text quotes the Trip ID');
    assert.match(r.body.whatsappText, /Pickup: Goregaon West/);
    assert.match(r.body.whatsappText, /Journey date: 2027-02-02/);
  });

  test('a different WhatsApp number is carried through when it is not the contact number', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'Two Numbers',
      mobile: '9820055670',
      whatsappMobile: '9820055671',
      sameAsContact: false,
      pickup: 'Powai',
      travelDate: '2027-02-03',
    });
    assert.equal(r.status, 201);
    assert.match(r.body.whatsappText, /WhatsApp: 9820055671/);
  });

  test('a missing WhatsApp number is refused rather than guessed at', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'No Number', mobile: '9820055672', sameAsContact: false, whatsappMobile: '',
      pickup: 'Vashi', travelDate: '2027-02-04',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /WhatsApp number/i);
  });

  /*
   * The two buttons on the enquiry form post to this one endpoint and differ
   * only in `source`. That difference has to reach the email address rule:
   * "Send my enquiry" promises a reply, a Trip ID and an invoice by email and
   * cannot keep any of it without an address, while the WhatsApp button
   * answers in the chat and must not lose people over a field it never needs.
   */
  test('an email enquiry is refused without an email address', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'No Address', mobile: '9820055673', sameAsContact: true,
      pickup: 'Chembur', travelDate: '2027-02-05', source: 'EMAIL',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error ?? '', /email address/i);
    assert.ok(
      (r.body.issues ?? []).some((i: { field: string }) => i.field === 'email'),
      'the complaint is attached to the email field'
    );
  });

  test('the same enquiry on WhatsApp goes through without one', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'No Address', mobile: '9820055673', sameAsContact: true,
      pickup: 'Chembur', travelDate: '2027-02-05', source: 'WHATSAPP',
    });
    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-WA-\d{4}-\d{4}$/);
  });

  test('an email enquiry with an address is filed under the EM prefix', async () => {
    const r = await anon('POST', '/public/whatsapp-enquiry', {
      name: 'Has Address', mobile: '9820055674', sameAsContact: true,
      email: 'has.address@example.com',
      pickup: 'Chembur', travelDate: '2027-02-06', source: 'EMAIL',
    });
    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-EM-\d{4}-\d{4}$/);
  });

  test('Trip IDs are never handed out twice', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const r = await anon('POST', '/public/enquiry', {
        name: `Repeat ${i}`, mobile: '9820055669', pickup: 'Bandra', travelDate: '2027-03-01',
      });
      assert.equal(r.status, 201);
      assert.ok(!seen.has(r.body.tripId), `duplicate Trip ID ${r.body.tripId}`);
      seen.add(r.body.tripId);
    }
  });
});

describe('The office picks the enquiry up', () => {
  test('trips are counted by the channel they arrived on', async () => {
    const r = await admin('GET', '/trips/summary');
    assert.equal(r.status, 200);

    const bySource = Object.fromEntries(r.body.bySource.map((s: any) => [s.source, s]));
    assert.ok(bySource.EMAIL.count >= 5, 'email enquiries are counted');
    assert.ok(bySource.WHATSAPP.count >= 2, 'WhatsApp enquiries are counted separately');
    assert.ok(r.body.new_inquiries >= 7, 'and the office is told how many are waiting');
  });

  test('the list can be filtered down to one source', async () => {
    const r = await admin('GET', '/trips?source=WHATSAPP');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length >= 2);
    assert.ok(
      r.body.data.every((t: any) => t.inquiry_source === 'WHATSAPP'),
      'the filter returns only that source'
    );
  });

  test('a trip opens by its Trip ID as well as by row id', async () => {
    const r = await admin('GET', `/trips/${state.tripId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.trip_id, state.tripId);
    assert.equal(r.body.data.booking_status, 'INQUIRY');
    assert.equal(r.body.data.inquiry_source, 'EMAIL');
    assert.ok(r.body.timeline.length >= 1, 'the enquiry is already on the timeline');
    state.tripRowId = r.body.data.id;

    const byRow = await admin('GET', `/trips/${state.tripRowId}`);
    assert.equal(byRow.body.data.trip_id, state.tripId);
  });

  test('the office can raise a walk-in trip by hand', async () => {
    const r = await admin('POST', '/trips', {
      source: 'WALKIN',
      customerName: 'Counter Customer',
      customerMobile: '9820077889',
      customerEmail: 'counter@example.com',
      pickup: 'Dadar',
      dropOff: 'Pune',
      travelDate: '2027-04-10',
      journeyTime: '05:30',
      tripType: 'OUTSTATION',
      vehicleType: 'Innova Crysta',
      passengers: 4,
    });
    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-OF-/, 'a walk-in carries the office prefix');
    assert.equal(r.body.data.booking_status, 'CONFIRMED', 'a booking taken on the phone starts confirmed');
  });
});

describe('Allotting the car and the driver', () => {
  let driverId = 0;
  let vehicleNumber = '';

  test('a driver goes on the roster', async () => {
    const r = await admin('POST', '/settings/drivers', {
      fullName: 'Ramesh Kumar',
      mobile: '9867001122',
      licenceNumber: 'MH0120110012345',
      languages: 'Hindi, Marathi, English',
      experienceYears: 9,
    });
    assert.equal(r.status, 201);
    driverId = r.body.data.id;

    const dup = await admin('POST', '/settings/drivers', { fullName: 'Someone Else', mobile: '9867001122' });
    assert.equal(dup.status, 409, 'one mobile number, one driver');
  });

  test('assigning moves the trip on and stamps the time', async () => {
    const vehicles = await admin('GET', '/settings/vehicles');
    const vehicle = vehicles.body.data[0];
    vehicleNumber = vehicle.vehicle_number;

    const r = await admin('POST', `/trips/${state.tripRowId}/assign`, {
      vehicleId: vehicle.id,
      driverId,
      notifyCustomer: true,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.booking_status, 'ASSIGNED');
    assert.equal(r.body.data.vehicle_number, vehicleNumber);
    assert.equal(r.body.data.driver_name, 'Ramesh Kumar');
    assert.ok(r.body.data.assigned_at, 'the allotment time is recorded');

    // No mailbox in the test environment: the send is honestly reported as not
    // done, and the allotment itself still stands.
    assert.equal(r.body.email.ok, false);
    assert.match(r.body.email.message, /App Password/i);
  });

  test('assigning with neither a vehicle nor a driver is refused', async () => {
    const r = await admin('POST', `/trips/${state.tripRowId}/assign`, { notifyCustomer: false });
    assert.equal(r.status, 400);
  });

  test('the timeline reads back what happened, in order', async () => {
    const r = await admin('GET', `/trips/${state.tripRowId}`);
    const titles = r.body.timeline.map((e: any) => e.title);
    assert.ok(titles.includes('Enquiry received'));
    assert.ok(titles.includes('Vehicle and driver assigned'));
  });
});

describe('Running the trip and closing it out', () => {
  test('the status cannot jump backwards by accident', async () => {
    const r = await admin('POST', `/trips/${state.tripRowId}/status`, { status: 'INQUIRY' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /cannot go straight to/);
  });

  test('the agreed fare is saved, with toll and parking after tax', async () => {
    const r = await admin('POST', `/trips/${state.tripRowId}/fare`, {
      baseFare: 2500, toll: 120, parking: 60, taxMode: 'IGST', taxRate: 5,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.charges.taxableAmount, 2500);
    assert.equal(r.body.charges.taxAmount, 125);
    assert.equal(r.body.charges.totalAmount, 2805);
  });

  test('the trip runs and is marked completed', async () => {
    const running = await admin('POST', `/trips/${state.tripRowId}/status`, { status: 'ONTRIP' });
    assert.equal(running.status, 200);
    assert.ok(running.body.data.started_at);

    const done = await admin('POST', `/trips/${state.tripRowId}/status`, { status: 'COMPLETED' });
    assert.equal(done.status, 200);
    assert.equal(done.body.data.booking_status, 'COMPLETED');
    assert.ok(done.body.data.completed_at, 'the completion time is stamped');
  });
});

describe('Invoicing', () => {
  test('an unfinished trip cannot be invoiced', async () => {
    const list = await admin('GET', '/trips?status=INQUIRY');
    const open = list.body.data[0];
    const r = await admin('POST', `/trips/${open.id}/invoice`, { gst: false });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /completed/);
  });

  test('a GST invoice is raised against the Trip ID', async () => {
    const r = await admin('POST', `/trips/${state.tripRowId}/invoice`, {
      gst: true, taxMode: 'IGST', taxRate: 5,
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.invoice.invoiceNumber, 'the invoice is numbered');
    assert.equal(r.body.invoice.total, 2805);
    assert.ok(r.body.invoice.filePath, 'a file is produced on disk');
    assert.equal(r.body.data.billing_status, 'INVOICED');
  });

  test('the same trip cannot be invoiced twice', async () => {
    const r = await admin('POST', `/trips/${state.tripRowId}/invoice`, { gst: true });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already invoiced/);
  });

  test('regenerating a non-GST invoice does not turn it into a GST one', async () => {
    // Regeneration used to take the tax treatment from the vendor's current
    // default rather than from the invoice, which silently added 5% to a
    // document the customer already had.
    const trip = await admin('POST', '/trips', {
      source: 'WALKIN', customerName: 'Reprint Please', customerMobile: '9820099002',
      pickup: 'Bandra', dropOff: 'Airport', travelDate: '2027-05-06', vehicleType: 'Sedan',
    });
    const id = trip.body.id;
    await admin('POST', `/trips/${id}/assign`, {
      vehicleType: 'Sedan', vehicleNumber: 'MH01AB9999',
      driverName: 'Reprint Driver', driverMobile: '9867001144', notifyCustomer: false,
    });
    await admin('POST', `/trips/${id}/fare`, { baseFare: 2000, taxMode: 'NONE', taxRate: 0 });
    await admin('POST', `/trips/${id}/status`, { status: 'COMPLETED' });

    const raised = await admin('POST', `/trips/${id}/invoice`, { gst: false });
    assert.equal(raised.status, 201);
    assert.equal(raised.body.invoice.total, 2000);
    const invoiceId = raised.body.invoice.invoiceId;

    const again = await admin('POST', `/invoices/${invoiceId}/regenerate`, { reason: 'test' });
    assert.equal(again.status, 200);

    const after = await admin('GET', `/invoices/${invoiceId}`);
    assert.equal(after.body.data.tax_mode, 'NONE', 'the treatment stays the invoice’s own, not the vendor default');
    assert.equal(after.body.data.tax_amount, 0);
    assert.equal(after.body.data.total_amount, 2000, 'the total a customer already has does not move');
  });

  test('a non-GST invoice carries no tax at all', async () => {
    const trip = await admin('POST', '/trips', {
      source: 'WALKIN', customerName: 'No GST Please', customerMobile: '9820099001',
      pickup: 'Thane', dropOff: 'Nashik', travelDate: '2027-05-05',
      vehicleType: 'Sedan', status: 'CONFIRMED',
    });
    const id = trip.body.id;

    await admin('POST', `/trips/${id}/assign`, {
      vehicleType: 'Sedan', vehicleNumber: 'MH01AB1234',
      driverName: 'Suresh', driverMobile: '9867001133', notifyCustomer: false,
    });
    await admin('POST', `/trips/${id}/fare`, { baseFare: 4000, taxMode: 'NONE', taxRate: 0 });
    await admin('POST', `/trips/${id}/status`, { status: 'COMPLETED' });

    const r = await admin('POST', `/trips/${id}/invoice`, { gst: false });
    assert.equal(r.status, 201);
    assert.equal(r.body.invoice.total, 4000, 'no tax is added to a non-GST invoice');
  });
});

describe('The customer account', () => {
  test('registering claims the trips already booked with that email', async () => {
    const r = await anon('POST', '/customer/auth/register', {
      fullName: 'Journey Tester',
      email: 'journey.tester@example.com',
      mobile: '9820055667',
      password: 'traveller99',
      confirmPassword: 'traveller99',
    });
    assert.equal(r.status, 201);
    assert.ok(r.body.linkedTrips >= 1, 'earlier enquiries are attached on sign-up');
    state.customerId = r.body.user.id;

    // The session the browser gets back, used as-is for the rest of the file.
    assert.ok(r.body.token, 'registering signs the customer straight in');
    customerToken = r.body.token;
  });

  test('a weak password is refused with a reason', async () => {
    const r = await anon('POST', '/customer/auth/register', {
      fullName: 'Weak Password', email: 'weak@example.com', mobile: '9820011000',
      password: 'abcdefgh', confirmPassword: 'abcdefgh',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /number/i);
  });

  test('signing in again works and the same email cannot register twice', async () => {
    const login = await anon('POST', '/customer/auth/login', {
      email: 'journey.tester@example.com', password: 'traveller99',
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.email, 'journey.tester@example.com');
    assert.ok(login.body.token, 'signing in returns a session the browser can use');

    const wrong = await anon('POST', '/customer/auth/login', {
      email: 'journey.tester@example.com', password: 'not-the-password',
    });
    assert.equal(wrong.status, 401);

    const dup = await anon('POST', '/customer/auth/register', {
      fullName: 'Journey Tester', email: 'journey.tester@example.com', mobile: '9820055667',
      password: 'traveller99', confirmPassword: 'traveller99',
    });
    assert.equal(dup.status, 409);
  });

  test('the dashboard shows their own trips and nobody else’s', async () => {
    const r = await customer('GET', '/customer/trips');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length >= 1);
    assert.ok(
      r.body.data.every((t: any) => t.customerEmail === 'journey.tester@example.com'),
      'a customer only ever sees their own journeys'
    );

    const mine = r.body.data.find((t: any) => t.tripId === state.tripId);
    assert.ok(mine, 'the completed trip is in the dashboard');
    assert.equal(mine.status, 'COMPLETED');
    assert.equal(mine.statusLabel, 'Trip completed');
    assert.equal(mine.sourceLabel, 'Email enquiry');
    assert.equal(mine.driverName, 'Ramesh Kumar');
    assert.ok(mine.invoice, 'the invoice appears without the customer having to ask');
    assert.equal(mine.invoice.gst, true);
    assert.equal(mine.invoice.downloadable, true);
  });

  test('a customer cannot open somebody else’s trip', async () => {
    const others = await admin('GET', '/trips?source=WALKIN');
    const someoneElse = others.body.data[0];
    const r = await customer('GET', `/customer/trips/${someoneElse.trip_id}`);
    assert.equal(r.status, 404);
    assert.match(r.body.error, /not on your account/);
  });

  test('the customer downloads their own invoice as a PDF', async () => {
    const res = await fetch(`${BASE}/customer/trips/${state.tripId}/invoice`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500, 'a real file comes back');
    assert.equal(buf.subarray(0, 4).toString(), '%PDF', 'and it is a PDF');
  });

  test('a customer session cannot reach the staff API', async () => {
    const r = await customer('GET', '/vendors');
    assert.equal(r.status, 401, 'a customer token must never be read as a staff token');
  });

  test('a staff token cannot masquerade as a customer', async () => {
    const r = await req('GET', '/customer/trips', undefined, staffToken);
    assert.equal(r.status, 401);
  });

  test('a trip can be claimed with the Trip ID and the number on the booking', async () => {
    const wa = await admin('GET', '/trips?source=WHATSAPP');
    const target = wa.body.data.find((t: any) => t.customer_mobile === '9820055668');

    const wrong = await customer('POST', '/customer/trips/claim', {
      tripId: target.trip_id, mobile: '9999999999',
    });
    assert.equal(wrong.status, 404);

    const right = await customer('POST', '/customer/trips/claim', {
      tripId: target.trip_id, mobile: '9820055668',
    });
    assert.equal(right.status, 200);

    const trips = await customer('GET', '/customer/trips');
    assert.ok(trips.body.data.some((t: any) => t.tripId === target.trip_id));
  });
});

describe('Tracking and email records', () => {
  test('a trip is trackable without an account, but only with the right number', async () => {
    const wrong = await anon('GET', `/public/track/${state.tripId}?verify=0000`);
    assert.equal(wrong.status, 404);

    const missing = await anon('GET', '/public/track/GTT-EM-9999-9999?verify=1234');
    assert.equal(missing.status, 404);
    assert.equal(
      missing.body.error, wrong.body.error,
      'the same message either way, so Trip IDs cannot be discovered by probing'
    );

    const right = await anon('GET', `/public/track/${state.tripId}?verify=5667`);
    assert.equal(right.status, 200);
    assert.equal(right.body.data.tripId, state.tripId);
    assert.ok(right.body.timeline.length >= 3, 'the timeline reads back the whole journey');
  });

  test('every attempted email is recorded, from the one business mailbox', async () => {
    const r = await admin('GET', '/settings/email/log');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length >= 5, 'enquiries, trip details and invoices all leave a trace');
    assert.ok(
      r.body.data.every((e: any) => e.from_address === 'vinaykumar87674@gmail.com'),
      'everything goes out from the one business mailbox'
    );
    assert.ok(
      r.body.data.every((e: any) => e.status === 'QUEUED'),
      'with no App Password nothing is sent, and nothing is lost either'
    );
  });

  /*
   * Retrying used to write a SECOND row and leave the first at QUEUED, so
   * Settings -> Email and the dashboard's "undelivered" figure went on
   * reporting mail that had already gone out - and the natural response to
   * that is to press Resend again and send the customer a duplicate.
   *
   * There is still no App Password here, so this retry cannot reach Gmail.
   * That is deliberate: what is under test is the log, not the mailbox.
   */
  test('retrying a message updates that message rather than logging a second one', async () => {
    const before = await admin('GET', '/settings/email/log');
    const queued = before.body.data.find((e: any) => e.status === 'QUEUED');
    assert.ok(queued, 'there is something in the log to retry');

    const r = await admin('POST', `/settings/email/log/${queued.id}/resend`, {});
    assert.equal(r.status, 502, 'the office is told it still has not gone');

    const after = await admin('GET', '/settings/email/log');
    assert.equal(after.body.total, before.body.total, 'a retry adds no row');

    const row = after.body.data.find((e: any) => e.id === queued.id);
    assert.equal(row.status, 'QUEUED', 'the original row carries the outcome');
    assert.ok(row.attempts > queued.attempts, 'and counts the attempt');
    assert.match(row.error, /App Password/, 'with the reason still spelled out');
  });

  test('the email status screen explains exactly what is missing', async () => {
    const r = await admin('GET', '/settings/email/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.enabled, false);
    assert.equal(r.body.from, 'vinaykumar87674@gmail.com');
    assert.equal(r.body.passwordSet, false);
    assert.match(r.body.reason, /App Password/);
  });

  test('the Gmail App Password is never readable from the settings screen', async () => {
    await admin('PUT', '/settings', { settings: { 'email.appPassword': 'abcdefghijklmnop' } });

    const r = await admin('GET', '/settings');
    const row = r.body.data.find((s: any) => s.key === 'email.appPassword');
    assert.notEqual(row.value, 'abcdefghijklmnop', 'the secret is never sent back to the browser');
    assert.equal(row.is_set, true, 'but the screen can still show that one is configured');

    // Saving the mask back must not wipe the stored secret.
    await admin('PUT', '/settings', { settings: { 'email.appPassword': row.value } });
    const status = await admin('GET', '/settings/email/status');
    assert.equal(status.body.passwordSet, true);
  });
});

describe('Nothing that already worked has broken', () => {
  test('enquiries stay out of the billing worklist', async () => {
    const r = await admin('GET', '/billing/pending');
    assert.equal(r.status, 200);
    assert.ok(
      r.body.data.every((b: any) => b.booking_status !== 'INQUIRY'),
      'an unconfirmed enquiry is not something to invoice'
    );
  });

  test('a vendor booking still saves, and now carries a Trip ID too', async () => {
    const vendors = await admin('GET', '/vendors');
    const vendor = vendors.body.data.find((v: any) => v.code !== 'DIRECT');

    const r = await admin('POST', '/bookings', {
      bookingSource: 'VENDOR',
      vendorId: vendor.id,
      travelDate: '2027-06-01',
      pickupLocation: 'Airport T2',
      dropLocation: 'Bandra Kurla Complex',
      passengerName: 'Vendor Passenger',
      passengerMobile: '9820044556',
      vehicleType: 'Sedan',
      charges: { baseFare: 1800 },
    });
    assert.equal(r.status, 201);
    assert.match(r.body.tripId, /^GTT-VN-/, 'vendor work is tagged as vendor work');
    assert.equal(r.body.data.inquiry_source, 'VENDOR');
  });

  test('the dashboard still answers', async () => {
    const r = await admin('GET', '/dashboard');
    assert.equal(r.status, 200);
  });
});
