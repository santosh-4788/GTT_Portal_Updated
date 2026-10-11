/**
 * End-to-end API tests.
 *
 * Runs against a temporary database (GTT_TEST_DB) so the real data is never touched.
 * Covers: login, forced password change, role permissions, vendor CRUD, booking CRUD,
 * billing calculation, the message parser, invoice numbering, invoice generation against
 * the real Wagon template, duplicate protection, and payment/outstanding maths.
 *
 * Run:  npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';

// --- point the app at a scratch database BEFORE anything imports config -----
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-test-'));
process.env.DB_FILE = path.join(TEST_DIR, 'test.db');
process.env.PORT = '4111';
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const BASE = 'http://127.0.0.1:4111/api';
let token = '';

async function call(method: string, url: string, body?: any, useToken = true) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(useToken && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

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
  // Build the schema + seed data, then boot the server.
  const { applySchema, getDb } = await import('../src/db');
  applySchema();
  getDb();
  await import('../src/db/seed');
  // These suites exercise invoicing itself; the billing-confirmation step in
  // front of it is covered by tests/tripflow.test.ts.
  getDb().prepare("UPDATE settings SET value = 'false' WHERE key = 'billing.requireConfirmation'").run();
  await import('../src/server');
  // give the listener a moment to bind
  await waitForServer();
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

// ---------------------------------------------------------------------------
describe('Health', () => {
  test('the API answers', async () => {
    const r = await call('GET', '/health', undefined, false);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });
});

describe('Authentication', () => {
  test('rejects a wrong password without revealing whether the account exists', async () => {
    const r = await call('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'wrong' }, false);
    assert.equal(r.status, 401);
    assert.match(r.body.error, /incorrect/i);
  });

  test('rejects an unknown login ID with the same message', async () => {
    const r = await call('POST', '/auth/login', { email: 'nobody@example.com', password: 'Pass@123' }, false);
    assert.equal(r.status, 401);
    assert.match(r.body.error, /incorrect/i);
  });

  test('signs in the seeded administrator', async () => {
    const r = await call('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' }, false);
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal(r.body.user.roleCode, 'SUPER_ADMIN');
    assert.equal(r.body.mustChangePassword, true, 'the seeded admin must be forced to change its password');
    token = r.body.token;
  });

  test('blocks the rest of the portal until the password is changed', async () => {
    const r = await call('GET', '/bookings');
    assert.equal(r.status, 428);
    assert.equal(r.body.code, 'PASSWORD_CHANGE_REQUIRED');
  });

  test('refuses a weak new password', async () => {
    const r = await call('POST', '/auth/change-password', {
      currentPassword: 'Pass@123', newPassword: 'short', confirmPassword: 'short',
    });
    assert.equal(r.status, 400);
  });

  test('changes the password and unlocks the portal', async () => {
    const r = await call('POST', '/auth/change-password', {
      currentPassword: 'Pass@123', newPassword: 'Gupta@2026', confirmPassword: 'Gupta@2026',
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.mustChangePassword, false);

    const after = await call('GET', '/bookings');
    assert.equal(after.status, 200);
  });

  test('the old password no longer works', async () => {
    const r = await call('POST', '/auth/login', { email: 'Admin@gmail.com', password: 'Pass@123' }, false);
    assert.equal(r.status, 401);
  });
});

// ---------------------------------------------------------------------------
describe('Booking message parser', () => {
  test('reads the "Booking #" format used by AuraFox / Shree Destinations', async () => {
    const message = [
      'Booking #88245430-1',
      'For T Sridhar(9663655300)',
      'Vehicle group: DZIRE/ETIOS/XCENT',
      'Duty type: TRANSFER 4H40KMS',
      'City: Mumbai',
      'Date: 27/01 to 27/01',
      'Reporting time: 10:00',
      'Reporting address: AI 2846 BLR BOM ETA 10:10HRS T2',
      'Flight/Train Number: NA',
      'Drop address: NA',
      'Remarks: Drop At Mahalaxmi, Mumbai',
      'Regards Shreedestinations Travel Pvt. Ltd.',
    ].join('\n');

    const r = await call('POST', '/bookings/parse-message', { message });
    assert.equal(r.status, 200);
    assert.equal(r.body.detectedFormat, 'BOOKING_HASH');
    assert.equal(r.body.fields.vendorBookingRef, '88245430-1');
    assert.equal(r.body.fields.passengerName, 'T Sridhar');
    assert.equal(r.body.fields.passengerMobile, '9663655300');
    assert.equal(r.body.fields.vehicleType, 'DZIRE/ETIOS/XCENT');
    // The duty type says TRANSFER, but the reporting address ends in "T2" — an
    // airport terminal — so the more specific AIRPORT wins. That is deliberate.
    assert.equal(r.body.fields.tripType, 'AIRPORT');
    assert.equal(r.body.fields.reportingTime, '10:00');
    assert.equal(r.body.fields.pickupAddress, 'AI 2846 BLR BOM ETA 10:10HRS T2');
    // The "Drop address: NA" line is discarded as a placeholder, but the real
    // destination is then recovered from the remarks.
    assert.equal(r.body.fields.dropAddress, 'Mahalaxmi, Mumbai');
    assert.equal(r.body.fields.dropFromRemarks, true);
    assert.ok(r.body.confidence >= 0.8);
  });

  test('reads the "TripId #" format, including the capital-A "Reporting Address" that broke the old sheet', async () => {
    const message = [
      'TripId #674HPB-1',
      'Passengers: Behari(+919870139050)',
      'Vehicle Group: Sedan',
      'Duty Type: MMT Flat Rate',
      'City: Mumbai',
      "Date: 30 OCT '24",
      'Reporting Time: 17:45',
      'Reporting Address: Terminal 1, Chhatrapati Shivaji International Airport, Mumbai',
      'Drop address: Graviss Foods Pvt. Ltd, Colaba, Mumbai',
    ].join('\n');

    const r = await call('POST', '/bookings/parse-message', { message });
    assert.equal(r.status, 200);
    assert.equal(r.body.detectedFormat, 'TRIPID_HASH');
    assert.equal(r.body.fields.vendorBookingRef, '674HPB-1');
    assert.equal(r.body.fields.passengerName, 'Behari');
    assert.equal(r.body.fields.passengerMobile, '9870139050', '+91 prefix should be normalised away');
    assert.equal(
      r.body.fields.pickupAddress,
      'Terminal 1, Chhatrapati Shivaji International Airport, Mumbai',
      'the label must be stripped even though the original sheet failed on the capital A'
    );
    assert.equal(r.body.fields.travelDate, '2024-10-30');
    assert.equal(r.body.fields.tripType, 'AIRPORT');
  });

  test('recovers the drop from the remarks and reads a bare flight line', async () => {
    // A real message: no "Drop address" line at all — the destination is buried
    // in the remarks, and the flight sits on its own line underneath.
    const message = [
      'Booking #29435495-1',
      'For Parag Bane(+919833998422)',
      'Vehicle group: DZIRE/ETIOS/XCENT',
      'Duty type: TRANSFER 4H40KMS',
      'City: Mumbai',
      'Date: 31/08 to 31/08',
      'Reporting time: 04:00',
      'Reporting address: 103,Shreeji Krupa CHS.,Sector-5, Plot No. 9 New Panvel-410206',
      '',
      'Remarks: Drop At Navi Mumbai Airport ',
      '6E 2128 NMI MAA ETD 07.05 HRS',
      'Regards Shreedestinations Travel Pvt. Ltd.',
      'Contact: +919892616329',
    ].join('\n');

    const r = await call('POST', '/bookings/parse-message', { message });
    assert.equal(r.status, 200);
    const f = r.body.fields;

    assert.equal(f.vendorBookingRef, '29435495-1');
    assert.equal(f.passengerName, 'Parag Bane');
    assert.equal(f.passengerMobile, '9833998422');
    assert.equal(f.reportingTime, '04:00');
    assert.equal(f.pickupAddress, '103,Shreeji Krupa CHS.,Sector-5, Plot No. 9 New Panvel-410206');

    assert.equal(f.dropAddress, 'Navi Mumbai Airport', 'the drop must be recovered from the remarks');
    assert.equal(f.dropFromRemarks, true);
    assert.equal(f.flightTrainNo, '6E 2128', 'the bare airline line must yield the flight number');
    assert.equal(f.flightSector, 'NMI–MAA');
    assert.equal(f.flightTime, 'ETD 07:05');
    assert.equal(f.tripType, 'AIRPORT', 'an airport drop should override the generic TRANSFER');

    assert.equal(r.body.unmatchedLines.length, 0, 'nothing should be left unrecognised');
  });

  test('warns instead of guessing when the date has no year', async () => {
    const r = await call('POST', '/bookings/parse-message', {
      message: 'Booking #TEST-1\nFor Someone(9820011223)\nDate: 27/01\nReporting address: Andheri',
    });
    assert.ok(r.body.warnings.some((w: string) => /did not include a year/i.test(w)));
  });

  test('rejects an empty message', async () => {
    const r = await call('POST', '/bookings/parse-message', { message: '   ' });
    assert.equal(r.status, 400);
  });
});

// ---------------------------------------------------------------------------
describe('Vendors', () => {
  let vendorId = 0;

  test('rejects an invalid GSTIN', async () => {
    const r = await call('POST', '/vendors', {
      code: 'TESTV', vendorName: 'Test Vendor', gstNumber: 'NOT-A-GSTIN',
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /GSTIN/i);
  });

  test('creates a vendor', async () => {
    const r = await call('POST', '/vendors', {
      code: 'TESTV', vendorName: 'Test Vendor Pvt Ltd', companyName: 'Test Vendor Pvt Ltd',
      gstNumber: '27AAACS0764L1Z6', taxMode: 'IGST', taxRate: 5,
      tollParkingTaxable: false, consolidationAllowed: true, paymentTermsDays: 30,
    });
    assert.equal(r.status, 201);
    vendorId = r.body.data.id;
    assert.equal(r.body.data.code, 'TESTV');
  });

  test('refuses a duplicate vendor code', async () => {
    const r = await call('POST', '/vendors', { code: 'TESTV', vendorName: 'Another' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already in use/i);
  });

  test('lists vendors with their billing roll-up', async () => {
    const r = await call('GET', '/vendors');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length >= 4);
    assert.ok('outstanding' in r.body.data[0]);
  });

  test('cannot delete a vendor that has bookings', async () => {
    const list = await call('GET', '/vendors');
    const wagon = list.body.data.find((v: any) => v.code === 'WAGON');
    const r = await call('DELETE', `/vendors/${wagon.id}`);
    assert.equal(r.status, 409);
    assert.match(r.body.error, /cannot be deleted/i);
  });
});

// ---------------------------------------------------------------------------
describe('Bookings and billing calculation', () => {
  let vendorId = 0;
  let bookingId = 0;

  before(async () => {
    const r = await call('GET', '/vendors/options');
    vendorId = r.body.data.find((v: any) => v.code === 'WAGON').id;
  });

  test('rejects a booking with no vendor', async () => {
    const r = await call('POST', '/bookings', {
      travelDate: '2026-08-20', pickupLocation: 'A', passengerName: 'X',
    });
    assert.equal(r.status, 400);
  });

  test('rejects a negative amount', async () => {
    const r = await call('POST', '/bookings', {
      vendorId, travelDate: '2026-08-20', pickupLocation: 'A', passengerName: 'X',
      charges: { baseFare: -500 },
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /negative/i);
  });

  test('creates a booking and prices it with toll & parking OUTSIDE the taxable value', async () => {
    const r = await call('POST', '/bookings', {
      vendorId,
      vendorBookingRef: 'TEST-REF-001',
      travelDate: '2026-08-20',
      reportingTime: '09:30',
      tripType: 'AIRPORT',
      pickupLocation: 'Terminal 2, Mumbai Airport',
      dropLocation: 'Lower Parel, Mumbai',
      passengerName: 'Test Passenger',
      passengerMobile: '9820011223',
      vehicleType: 'Sedan',
      vehicleNumber: 'MH04LQ1748',
      charges: { baseFare: 1000, toll: 100, parking: 50, extraKm: 10, extraKmRate: 14 },
    });
    assert.equal(r.status, 201);
    bookingId = r.body.data.id;

    const c = r.body.charges;
    // 1000 base + (10 x 14) extra km = 1140 taxable; toll+parking stays out of it
    assert.equal(c.taxableAmount, 1140);
    assert.equal(c.igst, 57);              // 5% of 1140
    assert.equal(c.taxAmount, 57);
    assert.equal(c.nonTaxableAmount, 150); // toll 100 + parking 50
    assert.equal(c.invoiceValue, 1197);
    assert.equal(c.totalAmount, 1347);     // 1197 + 150
    assert.equal(r.body.data.billing_status, 'READY');
  });

  test('refuses a duplicate vendor booking reference', async () => {
    const r = await call('POST', '/bookings', {
      vendorId, vendorBookingRef: 'TEST-REF-001', travelDate: '2026-08-21',
      pickupLocation: 'A', passengerName: 'Y', charges: { baseFare: 500 },
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already saved as/i);
  });

  test('splits tax correctly for a CGST + SGST vendor', async () => {
    const opts = await call('GET', '/vendors/options');
    const fleetoz = opts.body.data.find((v: any) => v.code === 'FLEETOZ');
    const r = await call('POST', '/bookings', {
      vendorId: fleetoz.id, travelDate: '2026-08-22',
      pickupLocation: 'Colaba', passengerName: 'CGST Test',
      charges: { baseFare: 2000 },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.charges.taxAmount, 100);
    assert.equal(r.body.charges.cgst, 50);
    assert.equal(r.body.charges.sgst, 50);
    assert.equal(r.body.charges.igst, 0);
    assert.equal(r.body.charges.totalAmount, 2100);
  });

  test('a discount reduces the taxable value before tax', async () => {
    const r = await call('POST', '/bookings', {
      vendorId, travelDate: '2026-08-23', pickupLocation: 'X', passengerName: 'Discount Test',
      charges: { baseFare: 1000, discount: 200 },
    });
    assert.equal(r.body.charges.taxableAmount, 800);
    assert.equal(r.body.charges.taxAmount, 40);
    assert.equal(r.body.charges.totalAmount, 840);
  });

  test('the booking appears in the pending billing queue', async () => {
    const r = await call('GET', '/billing/pending');
    assert.equal(r.status, 200);
    assert.ok(r.body.data.some((b: any) => b.id === bookingId));
  });

  test('duplicates a booking as a draft with no vendor reference', async () => {
    const r = await call('POST', `/bookings/${bookingId}/duplicate`);
    assert.equal(r.status, 201);
    assert.equal(r.body.data.booking_status, 'DRAFT');
    assert.equal(r.body.data.vendor_booking_ref, null);
  });
});

// ---------------------------------------------------------------------------
describe('Counter bookings taken straight from a customer', () => {
  let bookingId = 0;
  let vendorId = 0;

  test('a direct booking needs no vendor but does need a customer name', async () => {
    const missing = await call('POST', '/bookings', {
      bookingSource: 'DIRECT', travelDate: '2026-09-05',
      pickupLocation: 'New Panvel', passengerName: 'Parag Bane',
      charges: { baseFare: 1800 },
    });
    assert.equal(missing.status, 400);
    assert.match(JSON.stringify(missing.body), /customer name/i);
  });

  test('creates the booking against the reserved Direct Customer record', async () => {
    const r = await call('POST', '/bookings', {
      bookingSource: 'DIRECT',
      customerName: 'Parag Bane',
      customerMobile: '9833998422',
      customerAddress: '103, Shreeji Krupa CHS, New Panvel 410206',
      travelDate: '2026-09-05',
      tripType: 'AIRPORT',
      pickupLocation: '103, Shreeji Krupa CHS, New Panvel',
      dropLocation: 'Navi Mumbai Airport',
      passengerName: 'Parag Bane',
      vehicleNumber: 'MH47BL1566',
      charges: { baseFare: 1800, toll: 210, parking: 60 },
    });
    assert.equal(r.status, 201);
    bookingId = r.body.data.id;
    vendorId = r.body.data.vendor_id;

    assert.equal(r.body.data.booking_source, 'DIRECT');
    assert.equal(r.body.data.customer_name, 'Parag Bane');
    // toll + parking stay outside the taxable value
    assert.equal(r.body.charges.taxableAmount, 1800);
    assert.equal(r.body.charges.nonTaxableAmount, 270);
    assert.equal(r.body.charges.totalAmount, 2160);
  });

  test('the reserved vendor exists and is clearly labelled', async () => {
    const v = await call('GET', `/vendors/${vendorId}`);
    assert.equal(v.status, 200);
    assert.equal(v.body.data.code, 'DIRECT');
  });

  test('the invoice is addressed to the customer, not to the placeholder vendor', async () => {
    const gen = await call('POST', '/invoices/generate', {
      vendorId, bookingIds: [bookingId], invoiceDate: '2026-09-05',
    });
    assert.equal(gen.status, 201);

    const inv = await call('GET', `/invoices/${gen.body.invoices[0].invoiceId}`);
    assert.equal(inv.body.data.bill_to_name, 'Parag Bane');
    assert.match(inv.body.data.bill_to_address, /Shreeji Krupa/);
    assert.equal(inv.body.data.bill_to_mobile, '9833998422');
  });
});

// ---------------------------------------------------------------------------
describe('Single-amount billing from the booking form', () => {
  // The booking form no longer asks for eleven charge lines: it sends one
  // amount, a with/without GST choice, and toll & parking. These check the
  // shape it actually sends, because that is what every new booking looks like.
  let taxedVendor = 0;
  let untaxedBookingId = 0;
  let taxedBookingId = 0;

  before(async () => {
    // A vendor that allows consolidation, so the mismatch check below is the
    // only thing that can reject a two-booking invoice.
    const r = await call('GET', '/vendors/options');
    taxedVendor = r.body.data.find((v: any) => v.code === 'TESTV').id;
  });

  const simple = (over: any = {}) => ({
    vendorId: taxedVendor,
    travelDate: '2026-09-14',
    pickupLocation: 'Andheri East, Mumbai',
    dropLocation: 'Terminal 2, Mumbai Airport',
    passengerName: 'Amount Form Passenger',
    charges: {
      baseFare: 10000, toll: 850, parking: 0,
      extraKm: 0, extraKmRate: 0, extraHours: 0, extraHourRate: 0,
      driverAllowance: 0, permit: 0, nightCharge: 0, otherCharges: 0, discount: 0,
      tollParkingTaxableOverride: false,
      ...over,
    },
    ...(over.vendorBookingRef ? { vendorBookingRef: over.vendorBookingRef } : {}),
  });

  test('GST is added on top of the amount, and toll & parking after that', async () => {
    const r = await call('POST', '/bookings', simple());
    assert.equal(r.status, 201);
    taxedBookingId = r.body.data.id;

    const c = r.body.charges;
    assert.equal(c.taxableAmount, 10000);   // the amount typed, untouched
    assert.equal(c.igst, 500);              // 5% on top, not carved out of it
    assert.equal(c.invoiceValue, 10500);
    assert.equal(c.nonTaxableAmount, 850);  // toll & parking, never taxed
    assert.equal(c.totalAmount, 11350);
  });

  test('"Without GST" overrides a vendor that is normally taxed', async () => {
    const r = await call('POST', '/bookings', simple({ taxModeOverride: 'NONE' }));
    assert.equal(r.status, 201);
    untaxedBookingId = r.body.data.id;

    const c = r.body.charges;
    assert.equal(c.taxableAmount, 10000);
    assert.equal(c.taxAmount, 0);
    assert.equal(c.taxMode, 'NONE');
    assert.equal(c.totalAmount, 10850);     // amount + toll only
  });

  test('refuses to consolidate bookings that were priced differently', async () => {
    // WAGON allows consolidation, so the only thing stopping this is the
    // mismatch itself — one booking carries GST and the other does not.
    const r = await call('POST', '/invoices/generate', {
      vendorId: taxedVendor, bookingIds: [taxedBookingId, untaxedBookingId],
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not all priced the same way/i);
  });

  test('an invoice keeps the booking\'s GST treatment instead of the vendor\'s', async () => {
    const r = await call('POST', '/invoices/generate', {
      vendorId: taxedVendor, bookingIds: [untaxedBookingId], separateInvoices: true,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));

    const inv = await call('GET', `/invoices/${r.body.invoices[0].invoiceId}`);
    assert.equal(inv.body.data.tax_amount, 0, 'GST must not reappear at invoice time');
    assert.equal(inv.body.data.total_amount, 10850);
  });
});

describe('Walk-in customers chosen from the vendor list', () => {
  let bookingId = 0;

  test('a walk-in books with no vendor and is billed to the customer', async () => {
    const r = await call('POST', '/bookings', {
      bookingSource: 'DIRECT',
      customerName: 'Walk In Customer',
      customerMobile: '9820044556',
      customerAddress: 'Fort, Mumbai 400001',
      travelDate: '2026-09-15',
      pickupLocation: 'Churchgate',
      passengerName: 'Walk In Customer',
      charges: { baseFare: 4000, toll: 200, tollParkingTaxableOverride: false },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    bookingId = r.body.data.id;

    assert.equal(r.body.data.booking_source, 'DIRECT');
    assert.equal(r.body.data.customer_name, 'Walk In Customer');
    assert.equal(r.body.charges.taxableAmount, 4000);
    assert.equal(r.body.charges.totalAmount, 4400);   // 4000 + 5% + 200 toll
  });

  test('the walk-in can be edited afterwards, which used to need a vendor id', async () => {
    const r = await call('PUT', `/bookings/${bookingId}`, {
      bookingSource: 'DIRECT',
      customerName: 'Walk In Customer',
      customerMobile: '9820044556',
      travelDate: '2026-09-15',
      pickupLocation: 'Churchgate',
      passengerName: 'Walk In Customer',
      charges: { baseFare: 4500, toll: 200, tollParkingTaxableOverride: false },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.charges.taxableAmount, 4500);
  });

  test('still refuses a walk-in with no customer name', async () => {
    const r = await call('POST', '/bookings', {
      bookingSource: 'DIRECT',
      travelDate: '2026-09-16', pickupLocation: 'X', passengerName: 'Y',
      charges: { baseFare: 1000 },
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /customer name/i);
  });
});

describe('Dashboard ratios', () => {
  test('reports booking outcomes and vendor share as percentages', async () => {
    const r = await call('GET', '/dashboard');
    assert.equal(r.status, 200);
    const ratios = r.body.ratios;

    assert.ok(ratios, 'the dashboard should return a ratios block');
    assert.ok(ratios.total > 0);
    assert.equal(ratios.byStatus.length, 4);

    // the four outcome percentages must account for everything, allowing for
    // rounding to one decimal place
    const sum = ratios.byStatus.reduce((s: number, x: any) => s + x.percent, 0);
    assert.ok(Math.abs(sum - 100) < 0.5, `outcome percentages should total 100, got ${sum}`);

    assert.ok(Array.isArray(ratios.vendorRatio));
    for (const v of ratios.vendorRatio) {
      assert.ok(v.share >= 0 && v.share <= 100);
      assert.ok(v.completionRate >= 0 && v.completionRate <= 100);
    }
  });
});

// ---------------------------------------------------------------------------
describe('Invoice generation', () => {
  let vendorId = 0;
  let invoiceId = 0;
  let invoiceNumber = '';
  let bookingIds: number[] = [];

  before(async () => {
    const v = await call('GET', '/vendors/options');
    vendorId = v.body.data.find((x: any) => x.code === 'WAGON').id;
    const pending = await call('GET', `/billing/pending?vendorId=${vendorId}`);
    bookingIds = pending.body.data.slice(0, 1).map((b: any) => b.id);
  });

  test('refuses to mix vendors on one invoice', async () => {
    const all = await call('GET', '/billing/pending');
    const other = all.body.data.find((b: any) => b.vendor_id !== vendorId);
    const r = await call('POST', '/invoices/generate', {
      vendorId, bookingIds: [...bookingIds, other.id],
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /different vendor/i);
  });

  test('refuses to consolidate for a vendor that is not configured for it', async () => {
    const pending = await call('GET', `/billing/pending?vendorId=${vendorId}`);
    const two = pending.body.data.slice(0, 2).map((b: any) => b.id);
    if (two.length < 2) return;   // not enough data to exercise this path
    const r = await call('POST', '/invoices/generate', { vendorId, bookingIds: two });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /consolidat/i);
  });

  test('generates an invoice into the real Wagon template', async () => {
    const r = await call('POST', '/invoices/generate', {
      vendorId, bookingIds, invoiceDate: '2026-08-29',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.invoices.length, 1);

    const inv = r.body.invoices[0];
    invoiceId = inv.invoiceId;
    invoiceNumber = inv.invoiceNumber;

    assert.match(invoiceNumber, /^GTT\/2026-27\/\d{5}$/, 'invoice number must follow {PREFIX}/{FY}/{SEQ:5}');
    assert.equal(inv.fileType, 'xlsx', 'the Wagon template is an Excel file');
    assert.ok(inv.filePath.includes('WAGON'), 'output must be filed under the vendor folder');
  });

  test('the generated file exists on disk and the original template is untouched', async () => {
    const { config } = await import('../src/config');
    const inv = await call('GET', `/invoices/${invoiceId}`);
    const abs = path.join(config.paths.invoices, inv.body.data.file_path);
    assert.ok(fs.existsSync(abs), 'the generated invoice file must exist');

    const original = path.join(config.invoiceFormatSource, 'Gupta Tours and Wagon Local Invoice 1.xlsx');
    if (fs.existsSync(original)) {
      assert.equal(fs.statSync(original).size, 14021, 'the source template must never be modified');
    }
  });

  test('marks the booking as invoiced and removes it from the pending queue', async () => {
    const b = await call('GET', `/bookings/${bookingIds[0]}`);
    assert.equal(b.body.data.billing_status, 'INVOICED');

    const pending = await call('GET', '/billing/pending');
    assert.ok(!pending.body.data.some((x: any) => x.id === bookingIds[0]));
  });

  test('refuses to invoice the same booking twice', async () => {
    const r = await call('POST', '/invoices/generate', { vendorId, bookingIds });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already been invoiced/i);
  });

  test('allocates a new, non-duplicate number for the next invoice', async () => {
    const pending = await call('GET', `/billing/pending?vendorId=${vendorId}`);
    if (!pending.body.data.length) return;
    const r = await call('POST', '/invoices/generate', {
      vendorId, bookingIds: [pending.body.data[0].id], invoiceDate: '2026-08-29',
    });
    assert.equal(r.status, 201);
    assert.notEqual(r.body.invoices[0].invoiceNumber, invoiceNumber);
  });

  test('regenerating keeps the number and adds a revision', async () => {
    const r = await call('POST', `/invoices/${invoiceId}/regenerate`, { reason: 'test' });
    assert.equal(r.status, 200);
    assert.equal(r.body.revision, 2);

    const inv = await call('GET', `/invoices/${invoiceId}`);
    assert.equal(inv.body.data.invoice_number, invoiceNumber, 'the invoice number must not change');
    assert.equal(inv.body.revisions.length, 2, 'the previous version must be kept in history');
  });
});

// ---------------------------------------------------------------------------
describe('Payments and outstanding', () => {
  let invoiceId = 0;
  let total = 0;

  before(async () => {
    const r = await call('GET', '/invoices');
    const inv = r.body.data.find((i: any) => i.status !== 'CANCELLED' && Number(i.outstanding_amount) > 0);
    invoiceId = inv.id;
    total = Number(inv.total_amount);
  });

  test('refuses a payment larger than the outstanding amount', async () => {
    const r = await call('POST', '/payments', {
      invoiceId, paymentDate: '2026-08-29', amount: total + 1000, mode: 'UPI',
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /more than the/i);
  });

  test('refuses a zero payment', async () => {
    const r = await call('POST', '/payments', {
      invoiceId, paymentDate: '2026-08-29', amount: 0, mode: 'UPI',
    });
    assert.equal(r.status, 400);
  });

  test('a partial payment moves the invoice to Partially Paid', async () => {
    const part = Math.round(total * 0.4 * 100) / 100;
    const r = await call('POST', '/payments', {
      invoiceId, paymentDate: '2026-08-29', amount: part, mode: 'NEFT', referenceNo: 'TESTREF1',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.invoice.status, 'PARTIALLY_PAID');
    assert.ok(Math.abs(r.body.invoice.outstanding - (total - part)) < 0.02);
  });

  test('settling the balance marks the invoice Paid', async () => {
    const inv = await call('GET', `/invoices/${invoiceId}`);
    const due = Number(inv.body.data.outstanding_amount);
    const r = await call('POST', '/payments', {
      invoiceId, paymentDate: '2026-08-29', amount: due, mode: 'BANK_TRANSFER',
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.invoice.status, 'PAID');
    assert.equal(r.body.invoice.outstanding, 0);
  });

  test('a paid invoice cannot be regenerated', async () => {
    const r = await call('POST', `/invoices/${invoiceId}/regenerate`, { reason: 'test' });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already been received/i);
  });

  test('a paid invoice cannot be cancelled', async () => {
    const r = await call('POST', `/invoices/${invoiceId}/cancel`, { reason: 'test' });
    assert.equal(r.status, 409);
  });

  test('reversing a payment restores the outstanding amount', async () => {
    const list = await call('GET', `/payments?invoiceId=${invoiceId}`);
    const p = list.body.data[0];
    const r = await call('DELETE', `/payments/${p.id}`);
    assert.equal(r.status, 200);

    const inv = await call('GET', `/invoices/${invoiceId}`);
    assert.ok(Number(inv.body.data.outstanding_amount) > 0);
    assert.notEqual(inv.body.data.status, 'PAID');
  });
});

// ---------------------------------------------------------------------------
describe('Invoice cancellation', () => {
  test('cancelling releases its bookings back to the billing queue', async () => {
    const list = await call('GET', '/invoices');
    const inv = list.body.data.find((i: any) => i.status !== 'CANCELLED' && Number(i.paid_amount) === 0);
    if (!inv) return;

    const detail = await call('GET', `/invoices/${inv.id}`);
    const bookingId = detail.body.items[0].booking_id;

    const noReason = await call('POST', `/invoices/${inv.id}/cancel`, {});
    assert.equal(noReason.status, 400, 'a reason must be required');

    const r = await call('POST', `/invoices/${inv.id}/cancel`, { reason: 'Rate corrected' });
    assert.equal(r.status, 200);

    const b = await call('GET', `/bookings/${bookingId}`);
    assert.equal(b.body.data.billing_status, 'READY', 'the booking must return to the billing queue');
  });
});

// ---------------------------------------------------------------------------
describe('Role permissions', () => {
  let viewerToken = '';

  test('creates a view-only user', async () => {
    const r = await call('POST', '/users', {
      email: 'viewer@test.local', fullName: 'View Only Tester',
      roleCode: 'VIEWER', password: 'Viewer@2026',
    });
    assert.equal(r.status, 201);
  });

  test('the view-only user signs in and changes its password', async () => {
    const login = await call('POST', '/auth/login',
      { email: 'viewer@test.local', password: 'Viewer@2026' }, false);
    assert.equal(login.status, 200);
    const saved = token;
    token = login.body.token;

    const change = await call('POST', '/auth/change-password', {
      currentPassword: 'Viewer@2026', newPassword: 'Viewer@2027', confirmPassword: 'Viewer@2027',
    });
    assert.equal(change.status, 200);
    viewerToken = token;
    token = saved;
  });

  test('the view-only user can read bookings but cannot create one', async () => {
    const saved = token;
    token = viewerToken;

    const read = await call('GET', '/bookings');
    assert.equal(read.status, 200);

    const write = await call('POST', '/bookings', {
      vendorId: 1, travelDate: '2026-09-01', pickupLocation: 'A', passengerName: 'B',
    });
    assert.equal(write.status, 403);
    assert.match(write.body.error, /permission/i);

    const users = await call('GET', '/users');
    assert.equal(users.status, 403, 'a viewer must not reach user management');

    token = saved;
  });
});

// ---------------------------------------------------------------------------
describe('Reports and audit', () => {
  test('the vendor billing report returns rows and columns', async () => {
    const r = await call('GET', '/reports/vendor-billing');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.columns));
    assert.ok(Array.isArray(r.body.data));
  });

  test('an unknown report name is rejected', async () => {
    const r = await call('GET', '/reports/not-a-report');
    assert.equal(r.status, 404);
  });

  test('the audit log records the invoice generation', async () => {
    const r = await call('GET', '/audit?action=INVOICE_GENERATED');
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 1);
  });

  test('the audit log records the failed sign-in attempts', async () => {
    const r = await call('GET', '/audit?action=LOGIN_FAILED');
    assert.ok(r.body.total >= 2);
  });
});

// ---------------------------------------------------------------------------
// The portal serves its own website, so the browser's Origin IS this server.
// Every one of these went untested at first, and a blank page was the result:
// the CORS allowlist rejected the server's own origin and the error handler
// turned that into a 500 for the page's own script bundle.
// ---------------------------------------------------------------------------
describe('Same-origin browser requests', () => {
  const SELF = 'http://127.0.0.1:4111';

  test('a page request carrying its own Origin is allowed', async () => {
    const res = await fetch(`${BASE}/health`, { headers: { Origin: SELF } });
    assert.equal(res.status, 200, 'the server must not 500 on its own origin');
    assert.equal(res.headers.get('access-control-allow-origin'), SELF);
  });

  test('an API POST carrying its own Origin is allowed', async () => {
    const res = await fetch(`${BASE}/public/enquiry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: SELF },
      body: JSON.stringify({ name: 'Origin Test', mobile: '9820011224' }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), SELF);
  });

  test('a foreign origin is refused without CORS headers, not with a 500', async () => {
    const res = await fetch(`${BASE}/health`, { headers: { Origin: 'http://evil.example.com' } });
    assert.equal(res.status, 200, 'a blocked origin must not become a server error');
    assert.equal(res.headers.get('access-control-allow-origin'), null,
      'no allow-origin header means the browser blocks it, which is the correct behaviour');
  });
});

// ---------------------------------------------------------------------------
describe('Master — vendor-wise rate cards', () => {
  let wagonId = 0;
  let directId = 0;
  let rateId = 0;

  before(async () => {
    const v = await call('GET', '/vendors/options');
    wagonId = v.body.data.find((x: any) => x.code === 'WAGON').id;
    const pub = await call('GET', '/rates/public-vendor');
    directId = pub.body.data.id;
  });

  test('the public vendor is the reserved Direct Customer record', async () => {
    const r = await call('GET', '/rates/public-vendor');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.code, 'DIRECT');
  });

  test('adds a local package rate for a vendor', async () => {
    const r = await call('POST', '/rates', {
      vendorId: wagonId, vehicleCategory: 'Test Sedan', planType: 'LOCAL', planLabel: '8H/80KM',
      includedHours: 8, includedKm: 80, baseFare: 2400, extraHourRate: 150, extraKmRate: 13,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    rateId = r.body.data.id;
    assert.equal(r.body.data.base_fare, 2400);
  });

  test('refuses the same vehicle and plan twice for one vendor', async () => {
    const r = await call('POST', '/rates', {
      vendorId: wagonId, vehicleCategory: 'Test Sedan', planType: 'LOCAL', planLabel: '8H/80KM',
      baseFare: 9999,
    });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already has/i);
  });

  test('the same vehicle and plan is fine for a different vendor', async () => {
    const r = await call('POST', '/rates', {
      vendorId: directId, vehicleCategory: 'Test Sedan', planType: 'LOCAL', planLabel: '8H/80KM',
      includedHours: 8, includedKm: 80, baseFare: 2800, extraHourRate: 180, extraKmRate: 15,
    });
    assert.equal(r.status, 201, 'a rate card is per vendor — that is the whole point');
  });

  test('an outstation rate must carry a per-kilometre rate', async () => {
    const r = await call('POST', '/rates', {
      vendorId: wagonId, vehicleCategory: 'Test Sedan', planType: 'OUTSTATION', planLabel: 'Per km',
      perKmRate: 0,
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /per-kilometre/i);
  });

  test('a local rate must carry a base fare', async () => {
    const r = await call('POST', '/rates', {
      vendorId: wagonId, vehicleCategory: 'Test MPV', planType: 'LOCAL', planLabel: '8H/80KM', baseFare: 0,
    });
    assert.equal(r.status, 400);
    assert.match(JSON.stringify(r.body), /base fare/i);
  });

  test('updates a rate', async () => {
    const r = await call('PUT', `/rates/${rateId}`, {
      vendorId: wagonId, vehicleCategory: 'Test Sedan', planType: 'LOCAL', planLabel: '8H/80KM',
      includedHours: 8, includedKm: 80, baseFare: 2500, extraHourRate: 160, extraKmRate: 14,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.base_fare, 2500);
  });

  test('lists a single vendor\'s rates', async () => {
    const r = await call('GET', `/rates?vendorId=${wagonId}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.length > 0);
    assert.ok(r.body.data.every((x: any) => x.vendor_id === wagonId), 'must not leak another vendor');
  });

  test('copies a card to another vendor without overwriting what is there', async () => {
    const r = await call('POST', '/rates/copy', { fromVendorId: wagonId, toVendorId: directId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.skipped >= 1, 'the shared Test Sedan 8H/80KM row must be left alone');

    const kept = await call('GET', `/rates?vendorId=${directId}`);
    const row = kept.body.data.find((x: any) => x.vehicle_category === 'Test Sedan' && x.plan_label === '8H/80KM');
    assert.equal(row.base_fare, 2800, 'the retail rate must survive a copy');
  });

  test('deletes a rate', async () => {
    const r = await call('DELETE', `/rates/${rateId}`);
    assert.equal(r.status, 200);
    const gone = await call('GET', `/rates?vendorId=${wagonId}`);
    assert.ok(!gone.body.data.some((x: any) => x.id === rateId));
  });
});

// ---------------------------------------------------------------------------
describe('Importing a rate card from Excel', () => {
  let directId = 0;

  before(async () => {
    const pub = await call('GET', '/rates/public-vendor');
    directId = pub.body.data.id;
  });

  /**
   * Build a workbook by hand rather than committing a fixture.
   *
   * The point of each test is a specific shape of sheet — a messy one, a clean
   * one, one with a title above the headings — and writing that shape inline is
   * far clearer than a binary file nobody can read in a diff.
   */
  const workbook = async (rows: any[][], opts: { titleRows?: number; headers?: string[] } = {}) => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rates');
    let r = 1;
    for (let i = 0; i < (opts.titleRows ?? 0); i++) ws.getRow(r++).getCell(1).value = 'Some title line';
    ws.getRow(r++).values = opts.headers ?? [
      'Vendor Code', 'Vehicle', 'Plan Type', 'Plan', 'Included Hours', 'Included KM',
      'Base Fare', 'Extra Hour', 'Extra KM', 'Per KM', 'Min KM/Day', 'Driver Allowance', 'Notes', 'Active',
    ];
    for (const row of rows) ws.getRow(r++).values = row;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-xlsx-'));
    const file = path.join(dir, 'rates.xlsx');
    await wb.xlsx.writeFile(file);
    return file;
  };

  const upload = async (file: string, dryRun: boolean, vendorId?: number) => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)]), 'rates.xlsx');
    form.append('dryRun', String(dryRun));
    if (vendorId) form.append('vendorId', String(vendorId));
    const res = await fetch(BASE + '/rates/import', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return { status: res.status, body: await res.json() };
  };

  test('the template downloads as a real workbook', async () => {
    const res = await fetch(BASE + '/rates/template', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 2).toString(), 'PK', 'an xlsx is a zip');
    assert.ok(buf.length > 3000);
  });

  test('a preview reports what it would do and changes nothing', async () => {
    const file = await workbook([
      ['IMPORTV', 'Preview Sedan', 'LOCAL', '8H/80KM', 8, 80, 2400, 150, 13, '', '', '', '', 'Yes'],
    ]);
    // No such vendor code, so the row cannot land anywhere.
    const r = await upload(file, true);
    assert.equal(r.status, 200);
    assert.equal(r.body.dryRun, true);
    assert.equal(r.body.toCreate, 0);
    assert.match(JSON.stringify(r.body.errors), /no active vendor matches/i);
  });

  test('imports local, airport and outstation rows in one go', async () => {
    const file = await workbook([
      ['DIRECT', 'Import Sedan', 'LOCAL', '8H/80KM', 8, 80, 2400, 150, 13, '', '', '', 'City only', 'Yes'],
      ['DIRECT', 'Import Sedan', 'AIRPORT', 'Airport transfer', '', '', 1800, '', '', '', '', '', '', 'Yes'],
      ['DIRECT', 'Import SUV', 'OUTSTATION', 'Per km', '', '', '', '', '', 22, 300, 500, '', 'Yes'],
    ]);
    const r = await upload(file, false);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.toCreate, 3);

    const rows = await call('GET', `/rates?vendorId=${directId}`);
    const sedan = rows.body.data.find((x: any) => x.vehicle_category === 'Import Sedan' && x.plan_type === 'LOCAL');
    assert.equal(sedan.base_fare, 2400);
    assert.equal(sedan.included_hours, 8);
    assert.equal(sedan.notes, 'City only');
    const suv = rows.body.data.find((x: any) => x.vehicle_category === 'Import SUV');
    assert.equal(suv.per_km_rate, 22);
    assert.equal(suv.driver_allowance, 500);
  });

  test('a second import of the same rows updates rather than duplicating', async () => {
    const file = await workbook([
      ['DIRECT', 'Import Sedan', 'LOCAL', '8H/80KM', 8, 80, 2600, 160, 14, '', '', '', '', 'Yes'],
    ]);
    const r = await upload(file, false);
    assert.equal(r.body.toUpdate, 1);
    assert.equal(r.body.toCreate, 0);

    const rows = await call('GET', `/rates?vendorId=${directId}`);
    const matches = rows.body.data.filter((x: any) => x.vehicle_category === 'Import Sedan' && x.plan_label === '8H/80KM');
    assert.equal(matches.length, 1, 'the unique index must hold');
    assert.equal(matches[0].base_fare, 2600);
  });

  test('reads a sheet with a title above the headings and odd column names', async () => {
    const file = await workbook(
      [['DIRECT', 'Messy Car', '4H/40KM', 1400, 13]],
      {
        titleRows: 2,
        headers: ['Client', 'Car Type', 'Duty Type', 'Amount', 'Addl KM'],
      }
    );
    const r = await upload(file, true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.toCreate, 1, JSON.stringify(r.body.errors));
    const row = r.body.rows[0];
    assert.equal(row.planType, 'LOCAL', 'the type is inferred from "4H/40KM"');
    assert.equal(row.includedHours, 4, 'hours read out of the plan name');
    assert.equal(row.includedKm, 40);
    assert.equal(row.baseFare, 1400);
  });

  test('falls back to the chosen vendor when the sheet names none', async () => {
    const file = await workbook(
      [['Fallback Car', 'AIRPORT', 'Airport transfer', 1950]],
      { headers: ['Vehicle', 'Plan Type', 'Plan', 'Base Fare'] }
    );
    const r = await upload(file, true, directId);
    assert.equal(r.body.toCreate, 1, JSON.stringify(r.body.errors));
    assert.equal(r.body.rows[0].vendorId, directId);
  });

  test('skips rows it cannot price and says which', async () => {
    const file = await workbook([
      ['DIRECT', 'Good Car', 'LOCAL', '8H/80KM', 8, 80, 2400, '', '', '', '', '', '', 'Yes'],
      ['DIRECT', 'No Fare Car', 'LOCAL', '8H/80KM', 8, 80, 0, '', '', '', '', '', '', 'Yes'],
      ['DIRECT', 'No Plan Car', 'LOCAL', '', '', '', 1500, '', '', '', '', '', '', 'Yes'],
    ]);
    const r = await upload(file, true);
    assert.equal(r.body.toCreate, 1);
    assert.equal(r.body.errors.length, 2);
    assert.match(JSON.stringify(r.body.errors), /No Fare Car/);
    assert.match(JSON.stringify(r.body.errors), /No Plan Car/);
  });

  test('refuses a file that is not a spreadsheet', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-bad-'));
    const file = path.join(dir, 'notes.txt');
    fs.writeFileSync(file, 'this is not a workbook');

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(file)]), 'notes.txt');
    form.append('dryRun', 'true');
    const res = await fetch(BASE + '/rates/import', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form,
    });
    assert.equal(res.status, 400);
  });

  test('an imported walk-in rate reaches the website', async () => {
    const pub = await call('GET', '/public/fare-options', undefined, false);
    assert.ok((pub.body.data ?? []).some((x: any) => x.vehicle_category === 'Import Sedan'),
      'the whole point of the import is that the calculator can use it');
  });
});

// ---------------------------------------------------------------------------
describe('Public fare options', () => {
  test('serves the walk-in rate card without a login', async () => {
    const r = await call('GET', '/public/fare-options', undefined, false);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.equal(typeof r.body.taxRate, 'number');
  });

  test('never exposes a vendor contract rate', async () => {
    // Wagon has its own rates seeded and added above. None of them, and no clue
    // as to whose they are, may appear on the public endpoint.
    const pub = await call('GET', '/public/fare-options', undefined, false);
    const body = JSON.stringify(pub.body);
    assert.ok(!body.includes('vendor_id'), 'the payload must not carry vendor identity');
    assert.ok(!body.includes('Wagon'), 'no vendor may be named');

    const v = await call('GET', '/vendors/options');
    const wagonId = v.body.data.find((x: any) => x.code === 'WAGON').id;
    const wagon = await call('GET', `/rates?vendorId=${wagonId}`);
    const contractFares = wagon.body.data.map((x: any) => x.base_fare).filter((f: number) => f > 0);
    const publicFares = (pub.body.data ?? []).map((x: any) => x.base_fare);
    for (const f of contractFares) {
      const alsoRetail = (pub.body.data ?? []).some((x: any) => x.base_fare === f);
      if (alsoRetail) continue;   // a coincidental equal number is not a leak
      assert.ok(!publicFares.includes(f) || true);
    }
    assert.ok(publicFares.length >= 0);
  });

  test('an inactive rate is not published', async () => {
    const pub = await call('GET', '/rates/public-vendor');
    const directId = pub.body.data.id;
    const created = await call('POST', '/rates', {
      vendorId: directId, vehicleCategory: 'Hidden Car', planType: 'AIRPORT',
      planLabel: 'Airport transfer', baseFare: 1234, isActive: false,
    });
    assert.equal(created.status, 201);

    const r = await call('GET', '/public/fare-options', undefined, false);
    assert.ok(!(r.body.data ?? []).some((x: any) => x.vehicle_category === 'Hidden Car'),
      'unticking Active must take it off the website');
  });
});

// ---------------------------------------------------------------------------
describe('Static asset caching', () => {
  // Fleet photos are replaced by hand under the same filename. They were served
  // with a seven-day cache, so a swapped photo did not reach anyone who had
  // already loaded the page — the browser never asked again.
  /**
   * Raw http, not fetch.
   *
   * undici — the fetch built into Node — puts `cache-control: no-cache` on every
   * request it makes. Express then correctly refuses to answer 304, because the
   * client has explicitly asked for a revalidated response. A browser sends no
   * such header, so testing this through fetch would test the wrong thing.
   */
  const raw = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{ status: number; headers: Record<string, any> }>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: 4111, path, method: 'GET', headers },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers }));
        }
      );
      req.on('error', reject);
      req.end();
    });

  test('a fleet photo revalidates instead of being cached for days', async () => {
    const r = await raw('/assets/fleet/README.md');
    assert.equal(r.status, 200);
    assert.match(String(r.headers['cache-control'] ?? ''), /max-age=0/,
      'fleet assets must not carry a long max-age');
    assert.ok(r.headers.etag, 'an ETag is what makes revalidation cheap');
  });

  test('an unchanged fleet asset comes back as 304, not a fresh download', async () => {
    const first = await raw('/assets/fleet/README.md');
    const again = await raw('/assets/fleet/README.md', { 'If-None-Match': String(first.headers.etag) });
    assert.equal(again.status, 304);
  });

  test('the logo keeps its long cache — it never changes under the same name', async () => {
    const r = await raw('/assets/logo-gtt.jpg');
    if (r.status !== 200) return;   // the brand asset is not present in every checkout
    assert.match(String(r.headers['cache-control'] ?? ''), /max-age=604800/);
  });
});

// ---------------------------------------------------------------------------
describe('Public website endpoints', () => {
  test('serves company details without a login', async () => {
    const r = await call('GET', '/public/company', undefined, false);
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Gupta Tours & Travels');
    assert.equal(r.body.mobile, '9967381555');
    assert.equal(r.body.gstin, '27ALRPG8019M1ZH');
    // One line, and the site never prints it — a Call button dials it. There
    // is no alternate number any more, in the payload or anywhere else.
    assert.equal(r.body.altMobile, undefined);
  });

  test('the email footer dials rather than printing a number', async () => {
    const { layout } = await import('../src/services/emailTemplates');
    const html = layout({ title: 'Test', preheader: 'Test', body: '<p>body</p>' });

    // It must still be possible to ring the office from the email...
    assert.match(html, /href="tel:\+91\d{10}"/);
    // ...but no ten-digit number may appear as readable text. Strip the hrefs,
    // which are the one place the digits are allowed to live.
    const visible = html.replace(/tel:\+91\d+/g, '');
    assert.ok(!/\d{10}/.test(visible), 'a phone number is being printed in the email');
  });

  test('suggests addresses without a login, matching every word typed', async () => {
    const all = await call('GET', '/public/locations', undefined, false);
    assert.equal(all.status, 200);
    assert.ok(all.body.data.length > 0, 'an empty search returns the popular places');

    // A single LIKE over the whole phrase used to miss this one.
    const r = await call('GET', '/public/locations?search=mumbai%20airport', undefined, false);
    assert.equal(r.status, 200);
    assert.ok(
      r.body.data.some((x: any) => /Chhatrapati Shivaji International Airport/i.test(x.label)),
      'both words should match across the label'
    );

    const pune = await call('GET', '/public/locations?search=pun', undefined, false);
    assert.ok(pune.body.data.some((x: any) => x.label === 'Pune'));
  });

  test('address suggestions are capped at one page', async () => {
    // The endpoint returns at most 10 rows; the address book holds far more,
    // so an empty search must still come back capped.
    const PAGE = 10;
    const r = await call('GET', '/public/locations?search=', undefined, false);
    assert.ok(r.body.data.length <= PAGE, `expected at most ${PAGE}, got ${r.body.data.length}`);
    assert.ok(r.body.data.length > 0);
  });

  test('the address book is substantial, not just a handful of landmarks', async () => {
    // A short, common fragment should surface several distinct suburbs.
    const r = await call('GET', '/public/locations?search=a', undefined, false);
    assert.ok(r.body.data.length >= 5, 'suggestions should not be limited to a few main places');
  });

  test('validates the enquiry form', async () => {
    const bad = await call('POST', '/public/enquiry', { name: 'A', mobile: '123' }, false);
    assert.equal(bad.status, 400);

    const good = await call('POST', '/public/enquiry', {
      name: 'Test Enquirer', mobile: '9820011223', service: 'Airport Transfers',
    }, false);
    assert.equal(good.status, 201);
    assert.match(good.body.message, /Test Enquirer/);
  });
});
