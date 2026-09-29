/**
 * Admin - website assistant conversations.
 *
 * Read-only on purpose. The record exists so the office can check exactly what
 * a customer asked and what they were told; an edit screen would defeat that.
 */
import { Router } from 'express';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('bookings.view'), (req, res) => {
  const term = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '');
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (term) {
    where.push(`(s.customer_name LIKE @t OR s.mobile LIKE @t OR s.email LIKE @t OR s.trip_id LIKE @t OR s.id LIKE @t
                 OR EXISTS (SELECT 1 FROM chat_messages m WHERE m.session_id = s.id AND m.text LIKE @t))`);
    params.t = `%${term}%`;
  }
  if (status === 'BOOKED' || status === 'OPEN') { where.push('s.status = @status'); params.status = status; }
  const rows = q.all(
    `SELECT s.id, s.started_at, s.last_at, s.status, s.trip_id, s.booking_id, s.customer_name, s.mobile, s.email,
            s.summary_json,
            (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS messages,
            (SELECT text FROM chat_messages m WHERE m.session_id = s.id AND m.sender = 'customer' ORDER BY seq LIMIT 1) AS first_question
       FROM chat_sessions s
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.last_at DESC
      LIMIT 200`,
    params
  );
  res.json({ data: rows });
});

router.get('/:id', requirePermission('bookings.view'), (req, res) => {
  const session = q.get('SELECT * FROM chat_sessions WHERE id = @id', { id: String(req.params.id) });
  if (!session) return res.status(404).json({ error: 'That conversation was not found.' });
  const messages = q.all(
    `SELECT seq, at, received_at, sender, text, data_json FROM chat_messages WHERE session_id = @id ORDER BY seq`,
    { id: String(req.params.id) }
  );
  res.json({ session, messages });
});

export default router;
