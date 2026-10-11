/**
 * A company's parser rules, stored as JSON on vendors.parser_config:
 *
 *   { "labels": { "pickupAddress": ["boarding point"], "travelDateRaw": ["duty on"] },
 *     "noReference": true }
 *
 * labels adds aliases to the built-in ones (it never removes them); noReference
 * says the company never sends its own booking number, so its absence is not
 * reported as missing. A new message format is a change here, not in code.
 */
/** vendors.parser_config — label aliases and switches a company's messages need. */
export function parseParserConfig(raw: unknown): { labels?: Record<string, string[]>; noReference?: boolean } {
  if (!raw) return {};
  try {
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const labels: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(c?.labels ?? {})) {
      const list = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
      if (list.length) labels[k] = list;
    }
    return { labels, noReference: !!c?.noReference };
  } catch {
    return {};
  }
}

