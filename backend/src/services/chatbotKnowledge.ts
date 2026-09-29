/**
 * The website assistant's knowledge base: loading the seed, serving it to the
 * browser, and recording what the assistant understood.
 *
 * The assistant itself runs in the visitor's browser (frontend/src/site/
 * assistant*.ts) on rules plus this data. No AI, translation or chatbot
 * service is involved anywhere, so nothing here costs anything to run.
 */
import { q } from '../db';
import { SEED_ENTITIES, SEED_INTENTS } from './chatbotSeed';

export const LANGS = ['en', 'hi', 'hi-Latn', 'mr', 'mr-Latn'] as const;
export const ENTITY_TYPES = ['LOCATION', 'VEHICLE', 'SERVICE', 'TRIP_TYPE', 'FARE_TERM', 'TIME', 'GENERAL'] as const;

/**
 * Put the seed in place. INSERT OR IGNORE throughout: an intent or example the
 * office has edited, switched off or deleted-and-re-added keeps its state, and
 * a new one added to the seed reaches an existing database on the next start.
 */
export function ensureChatbotKnowledge(): void {
  q.tx(() => {
    for (const i of SEED_INTENTS) {
      q.run(
        `INSERT OR IGNORE INTO chatbot_intents
           (code, name, category, description, service_type, required_entities, optional_entities, dynamic)
         VALUES (@code, @name, @category, @description, @service, @required, @optional, @dynamic)`,
        {
          code: i.code, name: i.name, category: i.category, description: i.description,
          service: i.service ?? null, required: i.required ?? null, optional: i.optional ?? null,
          dynamic: i.dynamic ? 1 : 0,
        }
      );
      for (const [lang, list] of Object.entries(i.examples)) {
        for (const text of list ?? []) {
          q.run(
            `INSERT OR IGNORE INTO chatbot_intent_examples (intent_code, language, example_text, source)
             VALUES (@code, @lang, @text, 'SEED')`,
            { code: i.code, lang, text }
          );
        }
      }
    }
    for (const e of SEED_ENTITIES) {
      q.run(
        `INSERT OR IGNORE INTO chatbot_entities (entity_type, entity_value, display_name, synonyms)
         VALUES (@type, @value, @display, @synonyms)`,
        e
      );
    }
  });
}

/**
 * What the browser needs: active intents with their examples, entity
 * synonyms, and any wording the office has written for a static answer.
 * Nothing internal - no ids of users, no counts, no logs.
 */
export function publicKnowledge() {
  const intents = q.all<{ code: string; category: string; dynamic: number; response_template: string | null }>(
    `SELECT code, category, dynamic, response_template FROM chatbot_intents WHERE active = 1 ORDER BY code`
  );
  const examples = q.all<{ intent_code: string; language: string; example_text: string }>(
    `SELECT e.intent_code, e.language, e.example_text
       FROM chatbot_intent_examples e JOIN chatbot_intents i ON i.code = e.intent_code
      WHERE e.active = 1 AND i.active = 1`
  );
  const entities = q.all<{ entity_type: string; entity_value: string; display_name: string | null; synonyms: string | null }>(
    `SELECT entity_type, entity_value, display_name, synonyms FROM chatbot_entities WHERE active = 1`
  );
  return {
    intents: intents.map((i) => ({
      code: i.code,
      category: i.category,
      dynamic: !!i.dynamic,
      templates: parseTemplates(i.response_template),
    })),
    examples: examples.map((e) => ({ intent: e.intent_code, lang: e.language, text: e.example_text })),
    entities: entities.map((e) => ({
      type: e.entity_type,
      value: e.entity_value,
      display: e.display_name ?? e.entity_value,
      synonyms: splitList(e.synonyms),
    })),
  };
}

export function parseTemplates(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    const out: Record<string, string> = {};
    for (const l of LANGS) if (typeof obj[l] === 'string' && obj[l].trim()) out[l] = obj[l].trim();
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export const splitList = (s: string | null | undefined) =>
  String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export const normaliseQuestion = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/** What the browser says it understood about one customer message. */
export interface Understood {
  lang?: string;
  intent?: string;
  confidence?: number;
  entities?: Record<string, unknown>;
}

/**
 * Called as the chat record arrives. Every customer message the assistant
 * classified goes into the conversation log; one it could not place goes on
 * the office's list of unknown questions, counted rather than repeated.
 */
export function recordUnderstanding(sessionId: string, seq: number, text: string, nlu: Understood) {
  const intent = typeof nlu.intent === 'string' ? nlu.intent.slice(0, 60) : null;
  const lang = typeof nlu.lang === 'string' && (LANGS as readonly string[]).includes(nlu.lang) ? nlu.lang : null;
  const confidence = typeof nlu.confidence === 'number' && Number.isFinite(nlu.confidence)
    ? Math.max(0, Math.min(1, nlu.confidence)) : null;
  const entities = nlu.entities && typeof nlu.entities === 'object'
    ? JSON.stringify(nlu.entities).slice(0, 2000) : null;

  const info = q.run(
    `INSERT OR IGNORE INTO chatbot_conversation_log (session_id, seq, message, language, intent, entities_json, confidence)
     VALUES (@s, @seq, @m, @lang, @intent, @entities, @confidence)`,
    { s: sessionId, seq, m: text.slice(0, 1000), lang, intent, entities, confidence }
  );
  // A resend of the same line must not count the question twice.
  if (!info.changes || intent !== 'UNKNOWN_INTENT') return;

  const normalised = normaliseQuestion(text);
  if (normalised.length < 2) return;
  q.run(
    `INSERT INTO chatbot_unknown_questions (question, normalised, language, last_session_id)
     VALUES (@question, @normalised, @lang, @s)
     ON CONFLICT(normalised) DO UPDATE SET
       times_asked = times_asked + 1,
       last_asked_at = datetime('now'),
       last_session_id = excluded.last_session_id`,
    { question: text.slice(0, 500), normalised, lang, s: sessionId }
  );
}
