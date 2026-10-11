/**
 * The five company message formats the business receives every day.
 * Fixtures are the messages exactly as pasted (tests/fixtures/*.txt).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBookingMessage, parseTravelDate } from '../src/services/bookingMessageParser';

const today = new Date('2026-10-05T09:00:00');
const sample = (name: string) => readFileSync(path.join(__dirname, 'fixtures', `${name}.txt`), 'utf8');
const parse = (name: string, opts = {}) => parseBookingMessage(sample(name), { today, ...opts });

test('DriveInn: "For #ref" is the reference and the second "For" is the passenger', () => {
  const r = parse('driveinn');
  assert.equal(r.fields.vendorBookingRef, '75230989-1');
  assert.equal(r.fields.passengerName, 'Ravi Kumar');
  assert.equal(r.fields.passengerMobile, '9800000001');
  assert.equal(r.fields.vehicleType, 'Intermediate');
  assert.equal(r.fields.city, 'Mumbai to Outstation');
  assert.equal(r.fields.tripType, 'OUTSTATION');
  assert.equal(r.fields.travelDate, '2026-10-08');
  assert.equal(r.fields.reportingTime, '07:30');
  assert.equal(r.fields.pickupAddress, 'Vidyalankar Polytechnic,Wadala');
  assert.equal(r.fields.dropAddress, 'Visit to Karjat');
  assert.equal(r.fields.flightTrainNo, undefined, 'NA is not a flight number');
  assert.equal(r.fields.remarks, undefined, 'NA is not a remark');
  assert.equal(r.fieldStatus.travelDate, 'confirm', 'a date without a year must be confirmed');
  assert.deepEqual(r.unmatchedLines, []);
});

test('Destination: the drop comes from a two-line remark; the sign-off is the company', () => {
  const r = parse('destination');
  assert.equal(r.fields.vendorBookingRef, '48659584-1');
  assert.equal(r.fields.passengerName, 'Anil Mehta');
  assert.equal(r.fields.passengerMobile, '9800000002');
  assert.equal(r.fields.vehicleType, 'DZIRE/ETIOS/XCENT');
  assert.equal(r.fields.travelDate, '2026-10-10');
  assert.equal(r.fields.reportingTime, '10:00');
  assert.equal(r.fields.pickupAddress, '6E 2122 CCU NMI ETA 10.15 HRS NAVI MUMBAI AIRPORT');
  assert.equal(r.fields.flightTrainNo, '6E 2122');
  assert.equal(r.fields.flightSector, 'CCU–NMI');
  assert.equal(r.fields.dropAddress, 'B-1204, Sample Heights, Sector 3, Kolshet Road, Thane West – 400607');
  assert.equal(r.fields.dropFromRemarks, true);
  assert.equal(r.fields.tripType, 'AIRPORT');
  assert.equal(r.fields.airportDirection, 'FROM');
  assert.match(r.fields.vendorHint ?? '', /Shreedestinations/);
  assert.equal(r.fields.contactNumber, '9800000099');
  assert.notEqual(r.fields.passengerMobile, r.fields.contactNumber);
});

test('Aurafox / FleetOZ: values on the line below their labels; cut-off drop is flagged, not changed', () => {
  const r = parse('aurafox');
  assert.equal(r.fields.vendorBookingRef, '1V3L2VNA');
  assert.equal(r.fields.passengerName, 'Neha Verma');
  assert.equal(r.fields.passengerMobile, '9800000003');
  assert.equal(r.fields.travelDate, '2026-10-09');
  assert.equal(r.fields.reportingTime, '06:15');
  assert.match(r.fields.pickupAddress ?? '', /^Sample Residency Cooperative Housing Society, Palm Beach, Sanpada, Navi Mumbai/);
  assert.match(r.fields.dropAddress ?? '', /Mumbai, Mahara$/, 'the address is kept exactly as sent');
  assert.equal(r.fieldStatus.dropAddress, 'confirm');
  assert.match(r.fieldSuggestions.dropAddress ?? '', /Mumbai, Maharashtra$/);
  assert.ok(r.warnings.some((w) => /cut off/i.test(w)));
  assert.equal(r.fields.vehicleType, 'SEDAN');
  assert.equal(r.fields.dutyType, 'daily rentals');
  assert.equal(r.fields.flightTrainNo, undefined);
  assert.equal(r.fields.vendorHint, 'FleetOZ');
  assert.equal(r.fields.contactNumber, '9800000098');
  assert.equal(r.fieldStatus.travelDate, 'ok', '"9 Oct 26" carries its year');
});

test('Uvalley: honorific stripped, trailing comma removed, NA drop left empty', () => {
  const r = parse('uvalley');
  assert.equal(r.fields.vendorBookingRef, '17755763-2');
  assert.equal(r.fields.passengerName, 'Suresh Kumar Patil');
  assert.equal(r.fields.passengerMobile, '9800000004');
  assert.equal(r.fields.vehicleType, 'Maruti Suzuki Dzire');
  assert.equal(r.fields.tripType, 'LOCAL');
  assert.equal(r.fields.travelDate, '2026-10-08');
  assert.equal(r.fields.pickupAddress, 'Hotel-Kohinoor Continental Andheri - Kurla Rd, J B Nagar, Andheri East, Mumbai');
  assert.equal(r.fields.dropAddress, undefined);
  assert.equal(r.fieldStatus.dropAddress, 'not_applicable');
  assert.equal(r.fields.remarks, 'Disposal');
});

test('Honza: no-colon drop label, signature number is the company contact, not the passenger', () => {
  const r = parse('honza', { noReference: true });
  assert.equal(r.fields.passengerName, 'Kiran R');
  assert.equal(r.fields.passengerMobile, '9800000005');
  assert.equal(r.fields.vehicleType, 'DZIRE');
  assert.equal(r.fields.dutyType, '8H 80KMs');
  assert.equal(r.fields.tripType, 'LOCAL');
  assert.equal(r.fields.travelDate, '2026-10-06');
  assert.equal(r.fields.reportingTime, '09:00');
  assert.equal(r.fields.pickupAddress, 'Hotel Bawa International Mumbai');
  assert.match(r.fields.dropAddress ?? '', /^Jio Wolrd Convention Centre/);
  assert.equal(r.fields.vendorHint, 'HONZA');
  assert.equal(r.fields.contactNumber, '9800000097');
  assert.equal(r.fieldStatus.vendorBookingRef, 'not_applicable');
  assert.ok(!r.warnings.some((w) => /booking reference/i.test(w)));
});

test('nothing is invented: a missing field stays empty and is reported', () => {
  const r = parseBookingMessage('For Asha ( 9820012345 )\nVehicle group: DZIRE', { today });
  assert.equal(r.fields.travelDate, undefined);
  assert.equal(r.fields.pickupAddress, undefined);
  assert.equal(r.fieldStatus.travelDate, 'missing');
  assert.equal(r.fieldStatus.pickupAddress, 'missing');
  assert.ok(r.confidence < 0.6);
});

test('company aliases extend the labels without code changes', () => {
  const r = parseBookingMessage('Guest: Neha\nBoarding point: Hotel Sahara Star\nDuty on: 12/11/2026', {
    today, labels: { pickupAddress: ['boarding point'], travelDateRaw: ['duty on'] },
  });
  assert.equal(r.fields.pickupAddress, 'Hotel Sahara Star');
  assert.equal(r.fields.travelDate, '2026-11-12');
});

test('a year-less date near the new year rolls forward', () => {
  const d = parseTravelDate('03/01', new Date('2026-12-20'));
  assert.equal(d.from, '2027-01-03');
  assert.equal(d.assumedYear, true);
});
