/**
 * Admin - customer feedback on completed trips.
 *
 * The ratings themselves are read-only here: what the customer said stays
 * what they said. The two actions are about the request, not the response -
 * send the link again, or re-open the form so the customer may answer again.
 */
import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { requestFeedback } from '../services/feedback';
import { requestOrigin } from '../utils/origin';

const router = Router();
router.use(requireAuth);

/** The columns every list reads. The snapshot wins; the booking fills gaps. */
const SELECT = `
  SELECT f.id, f.booking_id, f.trip_id, b.booking_code, f.status, f.email_status, f.sent_to,
         f.requested_at, f.submitted_at, f.allow_resubmit, f.submit_count,
         COALESCE(f.customer_name, b.customer_name, b.passenger_name) AS customer_name,
         COALESCE(f.travel_date, b.travel_date) AS travel_date,
         COALESCE(f.pickup, b.pickup_address, b.pickup_location) AS pickup,
         COALESCE(f.drop_off, b.drop_address, b.drop_location) AS drop_off,
         COALESCE(f.driver_name, d.full_name, b.driver_name) AS driver_name,
         COALESCE(f.vehicle_type, b.vehicle_type) AS vehicle_type,
         COALESCE(f.vehicle_number, b.vehicle_number) AS vehicle_number,
         f.driver_rating, f.service_rating, f.vehicle_rating, f.overall_rating, f.comments
    FROM trip_feedback f
    JOIN bookings b ON b.id = f.booking_id
    LEFT JOIN drivers d ON d.id = b.driver_id`;

router.get('/', requirePermission('bookings.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  // Submitted responses by default; the office can also see who has not answered.
  const status = p.status === 'PENDING' || p.status === 'ALL' ? p.status : 'SUBMITTED';
  if (status !== 'ALL') { where.push('f.status = @status'); params.status = status; }

  if (/^\d{4}-\d{2}-\d{2}$/.test(p.from ?? '')) { where.push('COALESCE(f.travel_date, b.travel_date) >= @from'); params.from = p.from; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.to ?? '')) { where.push('COALESCE(f.travel_date, b.travel_date) <= @to'); params.to = p.to; }

  const like = (key: string, sql: string) => {
    const v = String(p[key] ?? '').trim();
    if (!v) return;
    where.push(sql);
    params[key] = `%${v}%`;
  };
  like('driver', 'COALESCE(f.driver_name, d.full_name, b.driver_name) LIKE @driver');
  like('vehicle', '(COALESCE(f.vehicle_number, b.vehicle_number) LIKE @vehicle OR COALESCE(f.vehicle_type, b.vehicle_type) LIKE @vehicle)');
  like('route', '(COALESCE(f.pickup, b.pickup_address, b.pickup_location) LIKE @route OR COALESCE(f.drop_off, b.drop_address, b.drop_location) LIKE @route)');
  like('booking', '(f.trip_id LIKE @booking OR b.booking_code LIKE @booking)');

  // "5" .. "1" is that overall rating exactly; "low" is anything 2 or under.
  if (p.rating === 'low') where.push('f.overall_rating <= 2');
  else if (/^[1-5]$/.test(p.rating ?? '')) { where.push('f.overall_rating = @rating'); params.rating = Number(p.rating); }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = q.all(`${SELECT} ${clause} ORDER BY COALESCE(f.submitted_at, f.requested_at) DESC LIMIT 500`, params);

  // Averages over the same filters, submitted responses only.
  const summary = q.get<any>(
    `SELECT COUNT(*) AS responses,
            ROUND(AVG(f.driver_rating), 2) AS driver, ROUND(AVG(f.service_rating), 2) AS service,
            ROUND(AVG(f.vehicle_rating), 2) AS vehicle, ROUND(AVG(f.overall_rating), 2) AS overall
       FROM trip_feedback f
       JOIN bookings b ON b.id = f.booking_id
       LEFT JOIN drivers d ON d.id = b.driver_id
      ${clause ? `${clause} AND f.status = 'SUBMITTED'` : `WHERE f.status = 'SUBMITTED'`}`,
    params
  );
  const pending = q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM trip_feedback WHERE status = 'PENDING'`)?.n ?? 0;

  res.json({ data: rows, summary: { ...summary, pending } });
});

/** Names for the filter dropdowns: only drivers and cars that have been rated. */
router.get('/options', requirePermission('bookings.view'), (_req, res) => {
  const drivers = q.all<{ v: string }>(
    `SELECT DISTINCT driver_name AS v FROM trip_feedback
      WHERE status = 'SUBMITTED' AND COALESCE(driver_name, '') <> '' ORDER BY v`
  ).map((r) => r.v);
  const vehicles = q.all<{ v: string }>(
    `SELECT DISTINCT vehicle_number AS v FROM trip_feedback
      WHERE status = 'SUBMITTED' AND COALESCE(vehicle_number, '') <> '' ORDER BY v`
  ).map((r) => r.v);
  res.json({ drivers, vehicles });
});

/** Email the feedback link (again). Creates the request if there is none yet. */
router.post('/request/:bookingId', requirePermission('bookings.update'), async (req, res) => {
  const bookingId = Number(req.params.bookingId);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return res.status(400).json({ error: 'Which trip?' });

  const r = await requestFeedback(bookingId, { userId: req.user!.id, resend: true, baseUrl: requestOrigin(req) });
  if (!r.emailed && !r.created) return res.status(409).json({ error: r.message });

  audit(req, 'FEEDBACK_REQUESTED', { entityType: 'booking', entityId: bookingId, description: r.message });
  res.json({ ok: r.emailStatus === 'SENT', ...r });
});

/** Let the customer answer again. Used up by their next submission. */
router.post('/:id/allow-resubmit', requirePermission('bookings.update'), (req, res) => {
  const id = Number(req.params.id);
  const f = q.get<any>('SELECT * FROM trip_feedback WHERE id = @id', { id });
  if (!f) return res.status(404).json({ error: 'That feedback record was not found.' });
  if (f.status !== 'SUBMITTED') {
    return res.status(409).json({ error: 'The customer has not answered yet, so the form is already open.' });
  }

  q.run('UPDATE trip_feedback SET allow_resubmit = 1 WHERE id = @id', { id });
  audit(req, 'FEEDBACK_REOPENED', {
    entityType: 'booking', entityId: f.booking_id,
    description: `${f.trip_id ?? f.booking_id}: feedback form re-opened for one more response`,
  });
  res.json({ ok: true, message: 'The customer can now submit their feedback once more, using the same link.' });
});

export default router;
