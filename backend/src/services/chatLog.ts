/**
 * The record of every website-assistant conversation.
 *
 * Messages are only ever INSERTED (see the schema note on chat_messages): a
 * resend of the same message is ignored by its (session, seq) key rather than
 * overwriting it, so what the customer was told stays exactly as it was told.
 */
import { q } from '../db';
import { recordUnderstanding, type Understood } from './chatbotKnowledge';

export interface ChatMessageIn {
  seq: number;
  at: string;
  sender: 'customer' | 'assistant' | 'system';
  text: string;
  data?: unknown;
}

export interface ChatMeta {
  page?: string;
  userAgent?: string;
  ip?: string;
  name?: string;
  mobile?: string;
  email?: string;
  summary?: unknown;
}

export const validSessionId = (id: string) => /^[A-Za-z0-9-]{16,64}$/.test(id);

export function appendChat(sessionId: string, messages: ChatMessageIn[], meta: ChatMeta = {}): number {
  let added = 0;
  q.tx(() => {
    q.run(
      `INSERT INTO chat_sessions (id, page, user_agent, ip_address) VALUES (@id, @page, @ua, @ip)
       ON CONFLICT(id) DO UPDATE SET last_at = datetime('now')`,
      { id: sessionId, page: meta.page ?? null, ua: meta.userAgent ?? null, ip: meta.ip ?? null }
    );
    for (const m of messages) {
      const info = q.run(
        `INSERT OR IGNORE INTO chat_messages (session_id, seq, at, sender, text, data_json)
         VALUES (@s, @seq, @at, @sender, @text, @data)`,
        {
          s: sessionId, seq: m.seq, at: m.at, sender: m.sender,
          text: m.text.slice(0, 4000),
          data: m.data === undefined ? null : JSON.stringify(m.data).slice(0, 20000),
        }
      );
      added += info.changes;
      // What the assistant understood of a customer line: the conversation
      // log, and the list of questions it could not place.
      const nlu = (m.data as { nlu?: Understood } | undefined)?.nlu;
      if (info.changes && m.sender === 'customer' && nlu && typeof nlu === 'object') {
        recordUnderstanding(sessionId, m.seq, m.text, nlu);
      }
    }
    // The headline for the admin list: who, and what they are after. The
    // detail stays in the messages.
    q.run(
      `UPDATE chat_sessions SET
         customer_name = COALESCE(@name, customer_name),
         mobile = COALESCE(@mobile, mobile),
         email = COALESCE(@email, email),
         summary_json = COALESCE(@summary, summary_json),
         last_at = datetime('now')
       WHERE id = @id`,
      {
        id: sessionId,
        name: meta.name || null,
        mobile: meta.mobile || null,
        email: meta.email || null,
        summary: meta.summary === undefined ? null : JSON.stringify(meta.summary),
      }
    );
  });
  return added;
}

/** Tie a chat to the trip it produced, and note that on the record itself. */
export function linkChatToBooking(sessionId: string, bookingId: number, tripId: string) {
  if (!validSessionId(sessionId)) return;
  const exists = q.get('SELECT 1 FROM chat_sessions WHERE id = @id', { id: sessionId });
  if (!exists) q.run('INSERT INTO chat_sessions (id) VALUES (@id)', { id: sessionId });
  const seq = (q.get<{ m: number }>('SELECT MAX(seq) AS m FROM chat_messages WHERE session_id = @id', { id: sessionId })?.m ?? 0) + 1;
  q.tx(() => {
    q.run(
      `UPDATE chat_sessions SET status = 'BOOKED', trip_id = @trip, booking_id = @bid, last_at = datetime('now') WHERE id = @id`,
      { id: sessionId, trip: tripId, bid: bookingId }
    );
    q.run(
      `INSERT OR IGNORE INTO chat_messages (session_id, seq, at, sender, text)
       VALUES (@id, @seq, @at, 'system', @text)`,
      { id: sessionId, seq: 100000 + seq, at: new Date().toISOString(), text: `Booking created on the server: Trip ID ${tripId}.` }
    );
  });
}
