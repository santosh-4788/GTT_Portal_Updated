/**
 * Billing confirmation — the step between "the trip happened" and "invoice it".
 *
 *   Trip completed → Billing confirmed → Invoice generated → Payment tracked → Settled
 *
 * Confirming says the final charges (fare, extra km/hours, toll, parking,
 * other) have been checked. When the setting `billing.requireConfirmation` is
 * on (the default), an invoice can only be raised for confirmed trips; adding
 * a trip to an approved billing batch counts as confirming it.
 *
 * Changing the charges of a confirmed trip clears the confirmation, so what is
 * invoiced is always what somebody last checked.
 */
import { q } from '../db';

export function confirmationRequired(): boolean {
  const row = q.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'billing.requireConfirmation'`);
  return String(row?.value ?? 'true').toLowerCase() !== 'false';
}

export interface ConfirmProblem { id: number; ref: string; problem: string }

/**
 * Why each trip cannot be confirmed. A trip can be confirmed when it is
 * completed (or dated today or earlier — confirming then also completes it),
 * priced, not cancelled and not already invoiced. A future-dated trip can only
 * be confirmed when it is a direct / walk-in booking billed in advance.
 */
export function confirmProblems(ids: number[], today = new Date().toISOString().slice(0, 10)): { ok: any[]; problems: ConfirmProblem[] } {
  if (!ids.length) return { ok: [], problems: [] };
  const rows = q.all<any>(
    `SELECT b.id, b.trip_id, b.booking_code, b.booking_status, b.billing_status, b.travel_date, b.booking_source,
            b.billing_confirmed_at, b.vehicle_number, b.driver_name, COALESCE(c.total_amount,0) AS total
       FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.id IN (${ids.map(Number).join(',')})`
  );
  const ok: any[] = [];
  const problems: ConfirmProblem[] = [];
  for (const r of rows) {
    const ref = r.trip_id || r.booking_code;
    if (['CANCELLED', 'NO_SHOW'].includes(r.booking_status)) problems.push({ id: r.id, ref, problem: 'cancelled' });
    else if (r.billing_status === 'INVOICED') problems.push({ id: r.id, ref, problem: 'already invoiced' });
    else if (!(Number(r.total) > 0)) problems.push({ id: r.id, ref, problem: 'no fare entered' });
    else if (r.booking_status !== 'COMPLETED' && r.travel_date > today && r.booking_source !== 'DIRECT') {
      problems.push({ id: r.id, ref, problem: `travel date ${r.travel_date} is in the future` });
    } else if (['INQUIRY', 'DRAFT'].includes(r.booking_status)) problems.push({ id: r.id, ref, problem: 'still an enquiry / draft' });
    else ok.push(r);
  }
  const found = new Set(rows.map((r) => r.id));
  for (const id of ids) if (!found.has(Number(id))) problems.push({ id: Number(id), ref: `#${id}`, problem: 'not found' });
  return { ok, problems };
}

/** Bookings among `ids` that still need confirming before they can be invoiced. */
export function unconfirmed(ids: number[]): { id: number; ref: string }[] {
  if (!ids.length || !confirmationRequired()) return [];
  return q.all<any>(
    `SELECT id, COALESCE(trip_id, booking_code) AS ref FROM bookings
      WHERE id IN (${ids.map(Number).join(',')}) AND billing_confirmed_at IS NULL`
  );
}

export function unconfirmedMessage(rows: { ref: string }[]): string {
  const list = rows.slice(0, 5).map((r) => r.ref).join(', ') + (rows.length > 5 ? ` and ${rows.length - 5} more` : '');
  return `Billing is not confirmed for ${list}. Check the final charges and confirm billing first (Billing → Confirm billing).`;
}
