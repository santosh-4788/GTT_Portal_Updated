/**
 * Feedback on a completed trip.
 *
 *   admin marks the trip completed
 *     -> one trip_feedback row, with a random token
 *     -> one email to the customer: "Give Your Feedback" -> /feedback/<token>
 *     -> the customer rates driver, service, cab and overall, and comments
 *     -> the ratings are stored against the booking, with a snapshot of who
 *        drove, which car, which route and which day
 *     -> Admin > Feedback lists and filters them
 *
 * Two rules carry the whole design:
 *
 *   One request per booking. trip_feedback.booking_id is UNIQUE, and the
 *   automatic send only happens when that INSERT actually creates the row. A
 *   completed booking opened, saved, or moved ONTRIP -> COMPLETED again does
 *   not email the customer a second time. A deliberate "resend" from the admin
 *   re-uses the same row and the same link.
 *
 *   One response per trip. Once submitted, the form is closed unless an admin
 *   explicitly re-opens it (allow_resubmit), and that permission is used up by
 *   the next submission.
 *
 * Nothing here uses a paid service: the link is a token in the portal's own
 * database and the email goes through the office's existing mailbox.
 */
import crypto from 'crypto';
import { q } from '../db';
import { sendMail } from './mailer';
import { feedbackRequestEmail } from './emailTemplates';
import { portalUrl, recordTripEvent, tripRow } from './tripFlow';

export type FeedbackEmailStatus = 'SENT' | 'QUEUED' | 'FAILED' | 'NO_EMAIL';

export interface FeedbackRequestResult {
  /** A request row was created by this call (false when one already existed). */
  created: boolean;
  /** An email was attempted by this call. */
  emailed: boolean;
  emailStatus: FeedbackEmailStatus | null;
  sentTo: string;
  /** Plain-language outcome for the admin's toast. */
  message: string;
}

const newToken = () => crypto.randomBytes(24).toString('base64url');

/** Tokens are 32 url-safe characters; anything else is not worth a query. */
export const validToken = (t: string) => /^[A-Za-z0-9_-]{20,64}$/.test(t);

export function feedbackForBooking(bookingId: number) {
  return q.get<any>('SELECT * FROM trip_feedback WHERE booking_id = @id', { id: bookingId });
}

/**
 * Ask the customer for feedback on a completed trip.
 *
 * `resend: false` is the automatic path taken when the trip is marked
 * completed: it creates the request and emails it, or does nothing at all if
 * a request already exists. `resend: true` is the admin pressing the button:
 * the same link is emailed again.
 */
export async function requestFeedback(
  bookingId: number,
  opts: { userId?: number | null; resend?: boolean; baseUrl?: string } = {},
): Promise<FeedbackRequestResult> {
  const trip = tripRow('id', bookingId);
  if (!trip) {
    return { created: false, emailed: false, emailStatus: null, sentTo: '', message: 'That trip could not be found.' };
  }
  if (trip.booking_status !== 'COMPLETED') {
    return {
      created: false, emailed: false, emailStatus: null, sentTo: '',
      message: 'Feedback is only requested once the trip is marked completed.',
    };
  }

  const to = String(trip.customer_email || trip.passenger_email || '').trim();

  // The UNIQUE booking_id makes this the one place a duplicate is stopped,
  // however the completion arrived (status button, booking form, a retry).
  const created = q.run(
    `INSERT OR IGNORE INTO trip_feedback (booking_id, trip_id, token, customer_id, customer_name, sent_to, requested_by)
     VALUES (@bookingId, @tripId, @token, @customerId, @name, @to, @uid)`,
    {
      bookingId,
      tripId: trip.trip_id ?? null,
      token: newToken(),
      customerId: trip.customer_id ?? null,
      name: trip.customer_name || trip.passenger_name || '',
      to: to || null,
      uid: opts.userId ?? null,
    }
  ).changes > 0;

  const row = feedbackForBooking(bookingId)!;

  if (!created && !opts.resend) {
    return {
      created: false, emailed: false, emailStatus: row.email_status ?? null, sentTo: row.sent_to ?? '',
      message: 'Feedback was already requested for this trip, so no second email was sent.',
    };
  }
  if (!created && row.status === 'SUBMITTED' && !row.allow_resubmit) {
    return {
      created: false, emailed: false, emailStatus: row.email_status ?? null, sentTo: row.sent_to ?? '',
      message: 'The customer has already given feedback for this trip. Allow a new response first if you want another.',
    };
  }

  if (!to) {
    q.run(`UPDATE trip_feedback SET email_status = 'NO_EMAIL' WHERE id = @id`, { id: row.id });
    if (created) {
      recordTripEvent({
        bookingId, tripId: trip.trip_id, status: 'EMAIL_SENT', isPublic: false,
        title: 'Feedback not requested', detail: 'There is no email address on this trip.', userId: opts.userId,
      });
    }
    return {
      created, emailed: false, emailStatus: 'NO_EMAIL', sentTo: '',
      message: 'There is no email address on this trip, so the feedback email could not be sent. Add one and use "Send feedback email".',
    };
  }

  const base = (portalUrl() || opts.baseUrl || '').replace(/\/+$/, '');
  const mail = feedbackRequestEmail({
    trip,
    tripId: trip.trip_id || trip.booking_code,
    customerName: trip.customer_name || trip.passenger_name || 'Customer',
    feedbackUrl: `${base}/feedback/${row.token}`,
  });
  const r = await sendMail({
    kind: 'FEEDBACK', to, subject: mail.subject, html: mail.html,
    bookingId, tripId: trip.trip_id, userId: opts.userId ?? null,
  });

  q.run(
    `UPDATE trip_feedback SET email_log_id = @log, email_status = @s, sent_to = @to WHERE id = @id`,
    { log: r.logId, s: r.status, to, id: row.id }
  );
  recordTripEvent({
    bookingId, tripId: trip.trip_id, status: 'EMAIL_SENT', isPublic: false,
    title: opts.resend && !created ? 'Feedback email sent again' : 'Feedback email sent',
    detail: `${r.status === 'SENT' ? 'Sent' : r.status === 'QUEUED' ? 'Queued' : 'Failed'} to ${to}`,
    userId: opts.userId,
  });

  return {
    created, emailed: true, emailStatus: r.status, sentTo: to,
    message: r.ok
      ? `Feedback email sent to ${to}.`
      : `The feedback email to ${to} did not go out yet: ${r.message}`,
  };
}

/* ==========================================================================
   The customer's side
   ========================================================================== */

/** What the feedback page shows: the trip, and whether the form is open. */
export function feedbackByToken(token: string) {
  if (!validToken(token)) return null;
  const f = q.get<any>('SELECT * FROM trip_feedback WHERE token = @t', { t: token });
  if (!f) return null;
  const b = tripRow('id', f.booking_id);
  if (!b) return null;
  return { f, b };
}

export function publicFeedback(f: any, b: any) {
  const open = f.status === 'PENDING' || !!f.allow_resubmit;
  return {
    tripId: b.trip_id || b.booking_code,
    customerName: b.customer_name || b.passenger_name || '',
    travelDate: b.travel_date,
    pickup: b.pickup_address || b.pickup_location || '',
    drop: b.drop_address || b.drop_location || '',
    vehicle: [b.vehicle_type, b.vehicle_number].filter(Boolean).join(' · '),
    driver: b.driver_full_name || b.driver_name || '',
    canSubmit: open,
    submitted: f.status === 'SUBMITTED',
    submittedAt: f.submitted_at,
    ratings: f.status === 'SUBMITTED'
      ? { driver: f.driver_rating, service: f.service_rating, vehicle: f.vehicle_rating, overall: f.overall_rating }
      : null,
  };
}

export interface FeedbackInput {
  driverRating: number;
  serviceRating: number;
  vehicleRating: number;
  overallRating: number;
  comments: string;
}

/**
 * Store a response. Returns an error string when the form is closed.
 *
 * The UPDATE's own WHERE re-checks that the form is open, so two taps on
 * Submit (or two tabs) cannot both land: the second one changes no row.
 */
export function submitFeedback(f: any, b: any, input: FeedbackInput): string | null {
  const info = q.run(
    `UPDATE trip_feedback SET
        status = 'SUBMITTED', allow_resubmit = 0, submit_count = submit_count + 1,
        driver_rating = @driver, service_rating = @service, vehicle_rating = @vehicle,
        overall_rating = @overall, comments = @comments, submitted_at = datetime('now'),
        customer_id = COALESCE(customer_id, @customerId),
        customer_name = @customerName,
        travel_date = @travelDate, pickup = @pickup, drop_off = @drop,
        driver_id = @driverId, driver_name = @driverName,
        vehicle_type = @vehicleType, vehicle_number = @vehicleNumber
      WHERE id = @id AND (status = 'PENDING' OR allow_resubmit = 1)`,
    {
      id: f.id,
      driver: input.driverRating,
      service: input.serviceRating,
      vehicle: input.vehicleRating,
      overall: input.overallRating,
      comments: input.comments || null,
      customerId: b.customer_id ?? null,
      customerName: b.customer_name || b.passenger_name || '',
      travelDate: b.travel_date,
      pickup: b.pickup_address || b.pickup_location || '',
      drop: b.drop_address || b.drop_location || '',
      driverId: b.driver_id ?? null,
      driverName: b.driver_full_name || b.driver_name || '',
      vehicleType: b.vehicle_type || '',
      vehicleNumber: b.vehicle_number || '',
    }
  );
  if (info.changes === 0) return 'Feedback for this trip has already been submitted. Thank you!';

  recordTripEvent({
    bookingId: b.id, tripId: b.trip_id, status: 'FEEDBACK', isPublic: false,
    title: 'Customer feedback received',
    detail: `Overall ${input.overallRating}/5 · driver ${input.driverRating} · service ${input.serviceRating} · cab ${input.vehicleRating}`,
  });
  return null;
}
