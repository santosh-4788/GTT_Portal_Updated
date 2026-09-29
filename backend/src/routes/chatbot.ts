/**
 * Admin - Chatbot Knowledge.
 *
 * What the website assistant understands: intents, the example questions that
 * teach each one, synonyms for places / vehicles / services, the questions it
 * could not place, and the log of what it understood. Answers are not kept
 * here - fares, vehicles and trips come from their own screens, live.
 *
 * A customer's question never changes the assistant by itself: it waits in
 * Unknown questions until someone here maps it to an intent.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import { ENTITY_TYPES, LANGS, parseTemplates, splitList } from '../services/chatbotKnowledge';

const router = Router();
router.use(requireAuth);

const VIEW = requirePermission('settings.view');
const EDIT = requirePermission('settings.update');

const lang = z.enum(LANGS);
const code = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,59}$/, 'Use capital letters, digits and _ (e.g. PET_TRAVEL).');
const list = z.string().trim().max(300).optional().default('');
const templates = z.record(z.string().max(2000)).optional();

const intentExists = (c: string) => !!q.get('SELECT 1 FROM chatbot_intents WHERE code = @c', { c });

/* ------------------------------------------------------------------ summary */
router.get('/summary', VIEW, (_req, res) => {
  const one = (sql: string) => (q.get<{ n: number }>(sql)?.n ?? 0);
  res.json({
    intents: one('SELECT COUNT(*) AS n FROM chatbot_intents WHERE active = 1'),
    examples: one('SELECT COUNT(*) AS n FROM chatbot_intent_examples WHERE active = 1'),
    entities: one('SELECT COUNT(*) AS n FROM chatbot_entities WHERE active = 1'),
    unknown: one(`SELECT COUNT(*) AS n FROM chatbot_unknown_questions WHERE status = 'NEW'`),
    messages7d: one(`SELECT COUNT(*) AS n FROM chatbot_conversation_log WHERE created_at >= datetime('now','-7 days')`),
    understood7d: one(`SELECT COUNT(*) AS n FROM chatbot_conversation_log
                        WHERE created_at >= datetime('now','-7 days') AND intent IS NOT NULL AND intent <> 'UNKNOWN_INTENT'`),
    languages7d: q.all(`SELECT COALESCE(language,'?') AS language, COUNT(*) AS n FROM chatbot_conversation_log
                         WHERE created_at >= datetime('now','-7 days') GROUP BY 1 ORDER BY n DESC`),
  });
});

/* ------------------------------------------------------------------ intents */
router.get('/intents', VIEW, (_req, res) => {
  const rows = q.all(
    `SELECT i.*, (SELECT COUNT(*) FROM chatbot_intent_examples e WHERE e.intent_code = i.code AND e.active = 1) AS examples,
            (SELECT COUNT(*) FROM chatbot_conversation_log l WHERE l.intent = i.code) AS times_matched
       FROM chatbot_intents i ORDER BY i.category, i.code`
  );
  res.json({ data: rows.map((r: any) => ({ ...r, response_template: parseTemplates(r.response_template) })) });
});

const intentSchema = z.object({
  code,
  name: z.string().trim().min(2).max(80),
  category: z.string().trim().min(2).max(40),
  description: z.string().trim().max(500).optional().default(''),
  serviceType: z.enum(['LOCAL', 'AIRPORT', 'OUTSTATION', 'HOURLY', '']).optional().default(''),
  requiredEntities: list,
  optionalEntities: list,
  responseTemplate: templates,
  active: z.boolean().optional().default(true),
});

const templateJson = (t?: Record<string, string>) => {
  if (!t) return null;
  const clean: Record<string, string> = {};
  for (const l of LANGS) if (t[l]?.trim()) clean[l] = t[l].trim();
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
};

router.post('/intents', EDIT, validateBody(intentSchema), (req, res) => {
  const b = req.body as z.infer<typeof intentSchema>;
  if (intentExists(b.code)) return res.status(409).json({ error: `There is already an intent ${b.code}.` });
  q.run(
    `INSERT INTO chatbot_intents (code, name, category, description, service_type, required_entities, optional_entities, response_template, active)
     VALUES (@code, @name, @category, @description, @service, @req, @opt, @tpl, @active)`,
    {
      code: b.code, name: b.name, category: b.category, description: b.description || null,
      service: b.serviceType || null, req: b.requiredEntities || null, opt: b.optionalEntities || null,
      tpl: templateJson(b.responseTemplate), active: b.active ? 1 : 0,
    }
  );
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_intent', description: `Added intent ${b.code}` });
  res.status(201).json({ ok: true });
});

router.put('/intents/:code', EDIT, validateBody(intentSchema.omit({ code: true }).partial()), (req, res) => {
  const c = String(req.params.code).toUpperCase();
  if (!intentExists(c)) return res.status(404).json({ error: 'That intent was not found.' });
  const b = req.body as Partial<z.infer<typeof intentSchema>>;
  const sets: string[] = [];
  const p: Record<string, unknown> = { c };
  const put = (col: string, v: unknown) => { sets.push(`${col} = @${col}`); p[col] = v; };
  if (b.name !== undefined) put('name', b.name);
  if (b.category !== undefined) put('category', b.category);
  if (b.description !== undefined) put('description', b.description || null);
  if (b.serviceType !== undefined) put('service_type', b.serviceType || null);
  if (b.requiredEntities !== undefined) put('required_entities', b.requiredEntities || null);
  if (b.optionalEntities !== undefined) put('optional_entities', b.optionalEntities || null);
  if (b.responseTemplate !== undefined) put('response_template', templateJson(b.responseTemplate));
  if (b.active !== undefined) put('active', b.active ? 1 : 0);
  if (!sets.length) return res.json({ ok: true });
  q.run(`UPDATE chatbot_intents SET ${sets.join(', ')}, updated_at = datetime('now') WHERE code = @c`, p);
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_intent', description: `Updated intent ${c}` });
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- examples */
router.get('/examples', VIEW, (req, res) => {
  const where: string[] = [];
  const p: Record<string, unknown> = {};
  const intent = String(req.query.intent ?? '').trim();
  const l = String(req.query.lang ?? '').trim();
  const term = String(req.query.q ?? '').trim();
  if (intent) { where.push('e.intent_code = @intent'); p.intent = intent; }
  if ((LANGS as readonly string[]).includes(l)) { where.push('e.language = @l'); p.l = l; }
  if (term) { where.push('e.example_text LIKE @t'); p.t = `%${term}%`; }
  const rows = q.all(
    `SELECT e.id, e.intent_code, i.name AS intent_name, e.language, e.example_text, e.source, e.active, e.created_at
       FROM chatbot_intent_examples e JOIN chatbot_intents i ON i.code = e.intent_code
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.intent_code, e.language, e.id LIMIT 1000`,
    p
  );
  res.json({ data: rows });
});

const exampleSchema = z.object({
  intent: code,
  language: lang.optional().default('en'),
  text: z.string().trim().min(1).max(300),
});

router.post('/examples', EDIT, validateBody(exampleSchema), (req, res) => {
  const b = req.body as z.infer<typeof exampleSchema>;
  if (!intentExists(b.intent)) return res.status(400).json({ error: 'Pick an intent from the list.' });
  const info = q.run(
    `INSERT OR IGNORE INTO chatbot_intent_examples (intent_code, language, example_text, source)
     VALUES (@intent, @language, @text, 'ADMIN')`,
    b
  );
  if (!info.changes) return res.status(409).json({ error: 'That example is already there.' });
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_example', description: `Example for ${b.intent}: ${b.text}` });
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/examples/:id', EDIT, validateBody(exampleSchema.partial().extend({ active: z.boolean().optional() })), (req, res) => {
  const id = Number(req.params.id);
  const row = q.get('SELECT * FROM chatbot_intent_examples WHERE id = @id', { id });
  if (!row) return res.status(404).json({ error: 'That example was not found.' });
  const b = req.body as Partial<z.infer<typeof exampleSchema>> & { active?: boolean };
  if (b.intent && !intentExists(b.intent)) return res.status(400).json({ error: 'Pick an intent from the list.' });
  try {
    q.run(
      `UPDATE chatbot_intent_examples SET
         intent_code = COALESCE(@intent, intent_code), language = COALESCE(@language, language),
         example_text = COALESCE(@text, example_text), active = COALESCE(@active, active)
       WHERE id = @id`,
      { id, intent: b.intent ?? null, language: b.language ?? null, text: b.text ?? null, active: b.active === undefined ? null : b.active ? 1 : 0 }
    );
  } catch {
    return res.status(409).json({ error: 'That example is already there.' });
  }
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_example', entityId: id, description: 'Example updated' });
  res.json({ ok: true });
});

router.delete('/examples/:id', EDIT, (req, res) => {
  const id = Number(req.params.id);
  const info = q.run('DELETE FROM chatbot_intent_examples WHERE id = @id', { id });
  if (!info.changes) return res.status(404).json({ error: 'That example was not found.' });
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_example', entityId: id, description: 'Example deleted' });
  res.json({ ok: true });
});

/* ----------------------------------------------------------------- entities */
router.get('/entities', VIEW, (req, res) => {
  const type = String(req.query.type ?? '');
  const rows = (ENTITY_TYPES as readonly string[]).includes(type)
    ? q.all('SELECT * FROM chatbot_entities WHERE entity_type = @type ORDER BY entity_value', { type })
    : q.all('SELECT * FROM chatbot_entities ORDER BY entity_type, entity_value');
  res.json({ data: rows });
});

const entitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  value: z.string().trim().toLowerCase().min(1).max(80),
  display: z.string().trim().max(80).optional().default(''),
  synonyms: z.string().trim().max(1000).optional().default(''),
  active: z.boolean().optional().default(true),
});

const cleanSynonyms = (s: string) => [...new Set(splitList(s).map((x) => x.toLowerCase()))].join(', ');

router.post('/entities', EDIT, validateBody(entitySchema), (req, res) => {
  const b = req.body as z.infer<typeof entitySchema>;
  const info = q.run(
    `INSERT OR IGNORE INTO chatbot_entities (entity_type, entity_value, display_name, synonyms, active)
     VALUES (@type, @value, @display, @synonyms, @active)`,
    { ...b, display: b.display || null, synonyms: cleanSynonyms(b.synonyms), active: b.active ? 1 : 0 }
  );
  if (!info.changes) return res.status(409).json({ error: `There is already a ${b.type.toLowerCase()} "${b.value}".` });
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_entity', description: `Added ${b.type} ${b.value}` });
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/entities/:id', EDIT, validateBody(entitySchema.partial()), (req, res) => {
  const id = Number(req.params.id);
  if (!q.get('SELECT 1 FROM chatbot_entities WHERE id = @id', { id })) return res.status(404).json({ error: 'Not found.' });
  const b = req.body as Partial<z.infer<typeof entitySchema>>;
  try {
    q.run(
      `UPDATE chatbot_entities SET
         entity_type = COALESCE(@type, entity_type), entity_value = COALESCE(@value, entity_value),
         display_name = COALESCE(@display, display_name), synonyms = COALESCE(@synonyms, synonyms),
         active = COALESCE(@active, active), updated_at = datetime('now')
       WHERE id = @id`,
      {
        id, type: b.type ?? null, value: b.value ?? null, display: b.display ?? null,
        synonyms: b.synonyms === undefined ? null : cleanSynonyms(b.synonyms),
        active: b.active === undefined ? null : b.active ? 1 : 0,
      }
    );
  } catch {
    return res.status(409).json({ error: 'There is already an entry with that type and value.' });
  }
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_entity', entityId: id, description: 'Entity updated' });
  res.json({ ok: true });
});

router.delete('/entities/:id', EDIT, (req, res) => {
  const id = Number(req.params.id);
  const info = q.run('DELETE FROM chatbot_entities WHERE id = @id', { id });
  if (!info.changes) return res.status(404).json({ error: 'Not found.' });
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_entity', entityId: id, description: 'Entity deleted' });
  res.json({ ok: true });
});

/* ------------------------------------------------------- unknown questions */
router.get('/unknown', VIEW, (req, res) => {
  const status = ['NEW', 'MAPPED', 'IGNORED'].includes(String(req.query.status)) ? String(req.query.status) : 'NEW';
  const rows = q.all(
    `SELECT id, question, language, times_asked, first_asked_at, last_asked_at, last_session_id, status, mapped_intent, reviewed_at
       FROM chatbot_unknown_questions WHERE status = @status
      ORDER BY times_asked DESC, last_asked_at DESC LIMIT 500`,
    { status }
  );
  res.json({ data: rows });
});

const mapSchema = z.object({
  intent: code,
  language: lang.optional(),
  /** What to store as the example - the question as asked, or tidied up. */
  text: z.string().trim().min(1).max(300).optional(),
});

router.post('/unknown/:id/map', EDIT, validateBody(mapSchema), (req, res) => {
  const id = Number(req.params.id);
  const row = q.get<{ question: string; language: string | null }>('SELECT * FROM chatbot_unknown_questions WHERE id = @id', { id });
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const b = req.body as z.infer<typeof mapSchema>;
  if (!intentExists(b.intent)) return res.status(400).json({ error: 'Pick an intent from the list.' });
  q.tx(() => {
    q.run(
      `INSERT OR IGNORE INTO chatbot_intent_examples (intent_code, language, example_text, source)
       VALUES (@intent, @language, @text, 'LEARNED')`,
      { intent: b.intent, language: b.language ?? row.language ?? 'en', text: b.text ?? row.question }
    );
    q.run(
      `UPDATE chatbot_unknown_questions SET status = 'MAPPED', mapped_intent = @intent,
         reviewed_by = @user, reviewed_at = datetime('now') WHERE id = @id`,
      { id, intent: b.intent, user: req.user?.id ?? null }
    );
  });
  audit(req, 'CHATBOT_UPDATED', { entityType: 'chatbot_unknown', entityId: id, description: `Mapped "${row.question}" to ${b.intent}` });
  res.json({ ok: true });
});

router.post('/unknown/:id/ignore', EDIT, (req, res) => {
  const id = Number(req.params.id);
  const info = q.run(
    `UPDATE chatbot_unknown_questions SET status = 'IGNORED', reviewed_by = @user, reviewed_at = datetime('now') WHERE id = @id`,
    { id, user: req.user?.id ?? null }
  );
  if (!info.changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

/* ---------------------------------------------------------- conversation log */
router.get('/logs', VIEW, (req, res) => {
  const where: string[] = [];
  const p: Record<string, unknown> = {};
  const intent = String(req.query.intent ?? '').trim();
  const l = String(req.query.lang ?? '').trim();
  const term = String(req.query.q ?? '').trim();
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? '');
  if (intent) { where.push('l.intent = @intent'); p.intent = intent; }
  if ((LANGS as readonly string[]).includes(l)) { where.push('l.language = @l'); p.l = l; }
  if (term) { where.push('l.message LIKE @t'); p.t = `%${term}%`; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('date(l.created_at) >= @from'); p.from = from; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('date(l.created_at) <= @to'); p.to = to; }
  if (req.query.low === '1') where.push('(l.confidence IS NULL OR l.confidence < 0.6)');
  const rows = q.all(
    `SELECT l.id, l.session_id, l.seq, l.message, l.language, l.intent, l.entities_json, l.confidence, l.created_at,
            s.customer_name, s.mobile, s.trip_id,
            (SELECT m.text FROM chat_messages m
              WHERE m.session_id = l.session_id AND m.seq > l.seq AND m.sender = 'assistant'
              ORDER BY m.seq LIMIT 1) AS bot_response
       FROM chatbot_conversation_log l
       JOIN chat_sessions s ON s.id = l.session_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.created_at DESC, l.id DESC LIMIT 300`,
    p
  );
  res.json({ data: rows });
});

export default router;
