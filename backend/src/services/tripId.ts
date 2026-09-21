/**
 * Trip IDs.
 *
 * One reference the customer quotes, the office searches on and the invoice
 * prints. The source is baked into the ID itself so an operator reading it
 * aloud on the phone already knows where the job came from:
 *
 *   GTT-EM-2609-0042   an email / website enquiry
 *   GTT-WA-2609-0007   a WhatsApp enquiry
 *   GTT-PB-2609-0113   a booking placed by a signed-in customer on the portal
 *   GTT-OF-2609-0031   a walk-in or phone booking entered by the office
 *   GTT-VN-2609-0290   a vendor booking
 *
 * The counter is per source per month, allocated through `trip_sequences` the
 * same way invoice numbers are allocated, and `bookings.trip_id` carries a
 * unique index — so two operators saving at the same instant cannot collide.
 */
import { getDb, q } from '../db';

export type InquirySource = 'EMAIL' | 'WHATSAPP' | 'PORTAL' | 'WALKIN' | 'VENDOR';

const CODE: Record<InquirySource, string> = {
  EMAIL: 'EM',
  WHATSAPP: 'WA',
  PORTAL: 'PB',
  WALKIN: 'OF',
  VENDOR: 'VN',
};

export const SOURCE_LABEL: Record<InquirySource, string> = {
  EMAIL: 'Email enquiry',
  WHATSAPP: 'WhatsApp enquiry',
  PORTAL: 'Portal booking',
  WALKIN: 'Walk-in / phone booking',
  VENDOR: 'Vendor booking',
};

export const ALL_SOURCES: InquirySource[] = ['EMAIL', 'WHATSAPP', 'PORTAL', 'WALKIN', 'VENDOR'];

/** Reserve the next number in a scope. Safe to call inside a transaction. */
function nextSequence(scope: string): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO trip_sequences (scope, last_number) VALUES (?, 0) ON CONFLICT(scope) DO NOTHING`
  ).run(scope);
  db.prepare(
    `UPDATE trip_sequences SET last_number = last_number + 1, updated_at = datetime('now') WHERE scope = ?`
  ).run(scope);
  const row = db.prepare('SELECT last_number FROM trip_sequences WHERE scope = ?').get(scope) as
    | { last_number: number }
    | undefined;
  return row?.last_number ?? 1;
}

/**
 * Allocate a Trip ID for a source.
 *
 * Re-checks the bookings table before handing the ID back. The sequence alone
 * is enough in normal running, but a restored backup can leave the counter
 * behind the data, and a duplicate here would surface as a save failure at the
 * end of a long form rather than as a number nobody noticed was skipped.
 */
export function nextTripId(source: InquirySource, when = new Date()): string {
  const yymm = `${String(when.getFullYear()).slice(2)}${String(when.getMonth() + 1).padStart(2, '0')}`;
  const scope = `${CODE[source]}|${yymm}`;

  for (let attempt = 0; attempt < 25; attempt++) {
    const seq = nextSequence(scope);
    const tripId = `GTT-${CODE[source]}-${yymm}-${String(seq).padStart(4, '0')}`;
    const clash = q.get<{ id: number }>('SELECT id FROM bookings WHERE trip_id = @t', { t: tripId });
    if (!clash) return tripId;
  }

  // 25 consecutive clashes means the counter is badly out of step. Fall back to
  // something that cannot collide rather than failing the customer's enquiry.
  return `GTT-${CODE[source]}-${yymm}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
}
