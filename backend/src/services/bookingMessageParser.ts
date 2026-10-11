/**
 * Booking-message parser — company messages pasted from WhatsApp or email.
 *
 * Replaces `E:\Portal\InvoiceFormat\DataEntryFormula.xlsx`, a hand-built sheet of
 * SUBSTITUTE/SEARCH formulas. Every company words its message differently, so
 * the parser is label-driven rather than position-driven:
 *
 *   - labels are matched case-insensitively from an alias list, with or without
 *     a colon ("Drop Address Disposal//…" has none), in any order;
 *   - a label with nothing after it takes the following line(s) as its value
 *     (FleetOZ puts every address on the line below its label);
 *   - a line with no label continues the field above it (addresses and remarks
 *     wrap), except inside the company's sign-off;
 *   - the sign-off ("Regards HONZA," / "Contact: … -FleetOZ") yields the company
 *     and ITS phone number, which is never taken for the passenger's;
 *   - "NA", "N/A", "-" and similar are treated as empty, never as values.
 *
 * A company can add its own label aliases (vendors.parser_config), so a new
 * format is a configuration change, not a code change. Nothing is invented: a
 * field that is not in the message stays empty and is reported as missing, and
 * anything that had to be assumed (a year, a cut-off address) is flagged for
 * confirmation in the preview.
 */

import { inferAirportDirection } from './airport';

export interface ParsedBooking {
  vendorBookingRef?: string;
  passengerName?: string;
  passengerMobile?: string;
  passengerCount?: number;
  vehicleType?: string;
  dutyType?: string;
  tripType?: string;
  /** AIRPORT only: TO the airport (drop) or FROM it (pickup), when it can be told. */
  airportDirection?: 'TO' | 'FROM';
  packageLabel?: string;      // e.g. "4H40KMS" once LOCAL/TRANSFER is stripped
  city?: string;
  travelDate?: string;        // ISO yyyy-mm-dd when confidently parsed
  travelDateRaw?: string;     // always the original text
  travelDateTo?: string;
  reportingTime?: string;
  pickupAddress?: string;
  dropAddress?: string;
  flightTrainNo?: string;
  remarks?: string;
  vendorHint?: string;        // "Shreedestinations Travel Pvt. Ltd." / "FleetOZ"
  contactNumber?: string;     // the COMPANY's number from the sign-off
  specialInstructions?: string;
  route?: string;
  flightSector?: string;      // "NMI–MAA"
  flightTime?: string;        // "ETD 07:05"
  /** True when the drop had to be recovered from the remarks text. */
  dropFromRemarks?: boolean;
}

export type FieldState = 'ok' | 'missing' | 'confirm' | 'not_applicable';

export interface ParseResult {
  detectedFormat: 'BOOKING_HASH' | 'TRIPID_HASH' | 'GENERIC' | 'UNKNOWN';
  fields: ParsedBooking;
  /** Per field: found, missing from the message, or found but needing a human check. */
  fieldStatus: Partial<Record<keyof ParsedBooking, FieldState>>;
  /** Better values the parser could see but did not apply, e.g. a cut-off address. */
  fieldSuggestions: Partial<Record<keyof ParsedBooking, string>>;
  matchedLabels: string[];
  unmatchedLines: string[];
  warnings: string[];
  confidence: number;         // 0..1
}

export interface ParserOptions {
  /** Extra label aliases for this company: { pickupAddress: ['boarding point'] }. */
  labels?: Partial<Record<keyof ParsedBooking, string[]>>;
  /** This company never sends a booking reference — do not report it missing. */
  noReference?: boolean;
  /** Used when a date has no year. Defaults to today. */
  today?: Date;
}

/** label aliases -> canonical field. Compared lower-cased; longer aliases win. */
const BASE_LABELS: Array<{ field: keyof ParsedBooking | 'dateTime'; aliases: string[] }> = [
  { field: 'vendorBookingRef', aliases: ['booking #', 'booking#', 'booking no', 'booking id', 'booking ref', 'tripid #', 'tripid#', 'trip id', 'trip #', 'duty id', 'duty slip', 'ref #', 'reference', 'ref no'] },
  { field: 'passengerName', aliases: ['for', 'passengers', 'passenger', 'passenger name', 'guest name', 'guest', 'pax name', 'name', 'traveller', 'traveler'] },
  { field: 'passengerCount', aliases: ['no of passengers', 'no. of passengers', 'pax', 'pax count', 'number of passengers'] },
  { field: 'vehicleType', aliases: ['vehicle group', 'vehicle type', 'vehicle', 'car type', 'cab type', 'car', 'category'] },
  { field: 'dutyType', aliases: ['duty type', 'duty', 'service type', 'trip type', 'package'] },
  { field: 'city', aliases: ['city', 'location city', 'route'] },
  { field: 'dateTime', aliases: ['date & time', 'date and time', 'date/time', 'pickup date & time', 'reporting date & time'] },
  { field: 'travelDateRaw', aliases: ['date', 'travel date', 'duty date', 'pickup date', 'reporting date', 'journey date'] },
  { field: 'reportingTime', aliases: ['reporting time', 'report time', 'pickup time', 'time'] },
  { field: 'pickupAddress', aliases: ['reporting address', 'pickup address', 'pick up address', 'pickup location', 'reporting place', 'address', 'from', 'pickup'] },
  { field: 'flightTrainNo', aliases: ['flight/train number', 'flight / train number', 'flight/train no', 'flight / train no', 'flight number', 'flight no', 'train number', 'train no', 'flight'] },
  { field: 'dropAddress', aliases: ['drop address', 'drop off address', 'drop location', 'drop point', 'drop', 'to', 'destination'] },
  { field: 'remarks', aliases: ['remarks', 'remark', 'note', 'notes', 'instructions', 'special instructions'] },
  { field: 'vendorHint', aliases: ['regards', 'from company', 'company', 'sent by'] },
  { field: 'contactNumber', aliases: ['contact', 'contact no', 'contact number', '24x7', 'helpline', 'support'] },
];

/** A whitespace (no colon) separator is only trusted for these labels. */
const BARE_LABELS = new Set(['for', 'regards', 'drop address', 'reporting address', 'pickup address', 'booking #', 'trip id', 'tripid #']);

/** Fields whose value may wrap onto following lines. */
const CONTINUES = new Set<string>(['pickupAddress', 'dropAddress', 'remarks', 'specialInstructions', 'vendorHint']);

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const NA = /^(na|n\/a|n\.a\.?|-+|nil|none|null|not applicable|tbd|tba|\.)$/i;
const isNA = (v?: string) => !v || NA.test(v.trim());

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

interface LabelHit { field: string; label: string; value: string }

function buildMatcher(extra?: ParserOptions['labels']) {
  const entries: { field: string; alias: string }[] = [];
  for (const e of BASE_LABELS) for (const a of e.aliases) entries.push({ field: e.field, alias: a });
  for (const [field, aliases] of Object.entries(extra ?? {})) {
    for (const a of aliases ?? []) entries.push({ field, alias: a.toLowerCase().trim() });
  }
  // Longest first, so "drop address" beats "drop" and "date & time" beats "date".
  entries.sort((a, b) => b.alias.length - a.alias.length);

  return (line: string): LabelHit | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();

    // "For #75230989-1" — a hash straight after "For" is the booking reference.
    const forHash = trimmed.match(/^for\s*#\s*(\S.*)$/i);
    if (forHash) return { field: 'vendorBookingRef', label: 'for #', value: forHash[1].trim() };

    for (const { field, alias } of entries) {
      const bare = alias.replace(/\s*#$/, '');
      const hashAlias = alias.endsWith('#');
      if (!lower.startsWith(bare)) continue;
      const rest = trimmed.slice(bare.length);
      // The alias must end on a word boundary: "Drop" must not match "Dropping".
      if (rest && /^[A-Za-z0-9]/.test(rest)) continue;

      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^\s*#\s*(.*)$/))) return { field, label: `${bare} #`, value: m[1].trim() };
      if (hashAlias) continue;
      if ((m = rest.match(/^\s*[:：]\s*(.*)$/))) return { field, label: bare, value: m[1].trim() };
      if ((m = rest.match(/^\s*[-–]\s+(.*)$/)) && bare.length > 3) return { field, label: bare, value: m[1].trim() };
      if (rest === '') return { field, label: bare, value: '' };
      if (BARE_LABELS.has(alias) || BARE_LABELS.has(bare)) {
        if ((m = rest.match(/^\s+(.+)$/))) return { field, label: bare, value: m[1].trim() };
      }
    }
    return null;
  };
}

const HONORIFIC = /^(mr|mrs|ms|miss|dr|shri|smt|sri|mx|prof)\.?\s+/i;

/** "T Sridhar(9663655300)" / "Behari(+919870139050)" / "Rahul ( +91 77389 92084 )" -> name + mobile */
function splitNameAndMobile(value: string): { name: string; mobile?: string } {
  let m = value.match(/^(.*?)[\s]*[\(\[]\s*(\+?[\d\s\-]{6,})\s*[\)\]]\s*$/);
  if (m) return { name: m[1].trim().replace(HONORIFIC, ''), mobile: normaliseMobile(m[2]) };
  m = value.match(/^(.*?)[\s,\-]+(\+?91?[\s\-]?\d[\d\s\-]{8,12}\d)\s*$/);
  if (m && normaliseMobile(m[2]).length === 10) return { name: m[1].trim().replace(HONORIFIC, ''), mobile: normaliseMobile(m[2]) };
  return { name: value.trim().replace(HONORIFIC, '') };
}

export function normaliseMobile(raw: string): string {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** A line that is only a phone number (a signature line). */
const PHONE_ONLY = /^\+?[\d\s\-()]{10,16}$/;

/**
 * Vendor dates arrive as free text: "27/01 to 27/01", "30 OCT '24", "9 Oct 26",
 * "05-Feb-2025". An ISO date is returned only when it can be read. A date with
 * no year takes the year that puts it nearest today (so a "05/01" pasted in late
 * December is next January) and is ALWAYS flagged for confirmation.
 */
export function parseTravelDate(raw: string, today: Date = new Date()): { from?: string; to?: string; warning?: string; assumedYear?: boolean } {
  if (!raw) return {};
  const text = raw.trim().replace(/\s+/g, ' ');

  const rangeParts = text.split(/\s+(?:to|till|until|–|-)\s+/i).filter(Boolean);
  const first = rangeParts[0];
  const second = rangeParts.length > 1 ? rangeParts[rangeParts.length - 1] : undefined;

  const pickYear = (month: number, day: number) => {
    const y = today.getFullYear();
    const candidate = new Date(y, month - 1, day);
    const diffDays = (candidate.getTime() - today.getTime()) / 86_400_000;
    // A booking more than six months in the past is far likelier to be next year's.
    if (diffDays < -183) return y + 1;
    if (diffDays > 183) return y - 1;
    return y;
  };
  const iso = (y: number, mo: number, d: number) =>
    mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;

  const one = (s: string): { iso?: string; assumedYear?: boolean; month?: number; day?: number } => {
    if (!s) return {};
    let m: RegExpMatchArray | null;
    const t = s.replace(/(st|nd|rd|th)\b/i, '').trim();
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return { iso: iso(+m[1], +m[2], +m[3]) };
    if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
      const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { iso: iso(yr, +m[2], +m[1]) };
    }
    if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/))) {
      return { iso: iso(pickYear(+m[2], +m[1]), +m[2], +m[1]), assumedYear: true, month: +m[2], day: +m[1] };
    }
    if ((m = t.match(/^(\d{1,2})[\s\-]*([A-Za-z]{3,9})\.?,?[\s\-]*'?(\d{2,4})?$/))) {
      const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (!mon) return {};
      if (m[3]) return { iso: iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mon, +m[1]) };
      return { iso: iso(pickYear(mon, +m[1]), mon, +m[1]), assumedYear: true };
    }
    if ((m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*'?(\d{2,4})?$/))) {
      const mon = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
      if (!mon) return {};
      if (m[3]) return { iso: iso(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mon, +m[2]) };
      return { iso: iso(pickYear(mon, +m[2]), mon, +m[2]), assumedYear: true };
    }
    return {};
  };

  const a = one(first);
  const b = second ? one(second) : {};
  if (!a.iso) return { warning: `Could not read the travel date "${raw}" — please set it manually.` };
  let to = b.iso;
  // "28/12 to 02/01" — the end is in the next year, not eleven months back.
  if (to && to < a.iso && b.assumedYear) to = `${Number(to.slice(0, 4)) + 1}${to.slice(4)}`;

  const warning = a.assumedYear
    ? `The message did not include a year ("${raw}") — ${a.iso.slice(0, 4)} was assumed. Please confirm.`
      .replace('The message did not', 'The vendor message did not')
    : undefined;
  return { from: a.iso, to: to && to !== a.iso ? to : undefined, warning, assumedYear: !!a.assumedYear };
}

/** LOCAL / TRANSFER prefixes are noise; the package (4H40KMS) is the useful part. */
function splitDutyType(raw: string): { tripType?: string; packageLabel: string; dutyType: string } {
  const value = raw.replace(/\s+/g, ' ').trim();
  const upper = value.toUpperCase();
  let tripType: string | undefined;
  if (upper.includes('OUTSTATION')) tripType = 'OUTSTATION';
  else if (upper.includes('TRANSFER')) tripType = 'TRANSFER';
  else if (upper.includes('AIRPORT')) tripType = 'AIRPORT';
  else if (upper.includes('ROUND')) tripType = 'ROUND_TRIP';
  else if (upper.includes('PACKAGE')) tripType = 'PACKAGE';
  else if (/LOCAL|DISPOSAL|DAILY RENTAL|\d+\s*H(RS?)?\s*\/?\s*\d+\s*KMS?/.test(upper)) tripType = 'LOCAL';
  else if (/\bTO\b/.test(upper)) tripType = 'TRANSFER';

  const packageLabel = value
    .replace(/\b(LOCAL|TRANSFER|OUTSTATION|AIRPORT)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { tripType, packageLabel, dutyType: value };
}

const NOISE = /^(car model|good condition|driver in uniform|no tobacco|thanks|thank you|please confirm|kindly confirm|-{2,}|_{2,}|={2,})/i;

/**
 * An airline sector line, e.g. "6E 2128 NMI MAA ETD 07.05 HRS" or
 * "AI 2846 BLR BOM ETA 10:10HRS T2".
 */
const FLIGHT_LINE =
  /^([A-Z0-9]{2}\d?)[\s-]?(\d{2,4})\b(?:\s+([A-Z]{3})\s+([A-Z]{3}))?(?:.*?\b(ETD|ETA)\s*[:\-]?\s*(\d{1,2}[.:]\d{2}))?/i;

/** "Drop At Navi Mumbai Airport", "Drop @ CSMI T2", "drop to Pune", "drop-off: BKC". */
const DROP_IN_TEXT = /\bdrop\s*(?:off|at|to|point|@)?\s*[:\-@]?\s+(.{3,300}?)\s*$/i;

/** Terminal hints so an airport drop can set the trip type correctly. */
const AIRPORT_HINT = /\bairport\b|\bterminal\s*[t]?[123]\b|\bT[123]\b|\bCSMIA?\b|\bNMIA\b/i;

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*,\s*,+/g, ',').replace(/[\s,;]+$/, '').trim();

export function parseBookingMessage(message: string, opts: ParserOptions = {}): ParseResult {
  const warnings: string[] = [];
  const matchedLabels: string[] = [];
  const unmatchedLines: string[] = [];
  const fields: ParsedBooking = {};
  const instructions: string[] = [];
  const fieldSuggestions: ParseResult['fieldSuggestions'] = {};
  const match = buildMatcher(opts.labels);
  const today = opts.today ?? new Date();

  const rawLines = String(message ?? '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());

  let detectedFormat: ParseResult['detectedFormat'] = 'UNKNOWN';
  const head = rawLines.join('\n').toLowerCase();
  if (/booking\s*#/.test(head) || /^for\s*#/m.test(head)) detectedFormat = 'BOOKING_HASH';
  else if (/trip\s*id\s*#|tripid\s*#/.test(head)) detectedFormat = 'TRIPID_HASH';
  else if (rawLines.some((l) => match(l))) detectedFormat = 'GENERIC';

  const values: Record<string, string> = {};
  /** The field a following unlabelled line belongs to. */
  let current: string | null = null;
  let inSignature = false;
  let blankSince = false;

  const append = (field: string, text: string) => {
    const t = text.trim();
    if (!t) return;
    const prev = values[field];
    values[field] = prev ? (/[,;:\-–/]$/.test(prev) ? `${prev} ${t}` : `${prev}, ${t}`) : t;
  };

  for (const line of rawLines) {
    if (!line) { blankSince = true; continue; }
    const hit = match(line);

    if (hit) {
      blankSince = false;
      let { field } = hit;
      let value = hit.value;
      // "Passengers:" with a hash or a count only: it is a head count, not a name.
      if (field === 'passengerName' && /^\d{1,2}$/.test(value)) { field = 'passengerCount'; }
      if (field === 'vendorHint' || field === 'contactNumber') inSignature = true;

      // "Contact: +919056055563 -FleetOZ" — the number and the company in one.
      if (field === 'contactNumber') {
        const m = value.match(/^(\+?[\d\s\-()]{10,16})\s*[-–,]?\s*([A-Za-z].*)?$/);
        if (m) {
          if (!values.contactNumber) values.contactNumber = m[1].trim();
          if (m[2] && !values.vendorHint) values.vendorHint = m[2].trim();
          matchedLabels.push(hit.label);
          current = null;
          continue;
        }
      }
      if (field === 'dateTime') {
        const m = value.match(/^(.*?)[\s,]+(?:at\s+)?(\d{1,2}[:.]\d{2}\s*(?:[ap]\.?m\.?|hrs?)?)\s*$/i);
        if (m) {
          if (!values.travelDateRaw) values.travelDateRaw = m[1].trim();
          if (!values.reportingTime) values.reportingTime = m[2].trim();
        } else if (value && !values.travelDateRaw) values.travelDateRaw = value;
        matchedLabels.push(hit.label);
        current = value ? null : 'travelDateRaw';
        continue;
      }

      matchedLabels.push(hit.label);
      // Never let a second, later line for the same label overwrite a good value.
      if (values[field] && !isNA(values[field])) {
        current = CONTINUES.has(field) ? null : null;
        continue;
      }
      values[field] = value;
      current = value === '' || CONTINUES.has(field) ? field : null;
      continue;
    }

    // ---- an unlabelled line ----
    // A bare airline sector line carries the flight number and often the time.
    const flight = (!values.flightTrainNo || isNA(values.flightTrainNo)) && !inSignature && line.match(FLIGHT_LINE);
    if (flight && /^[A-Z0-9]{2}\s?\d{3,4}\b/i.test(line) && /[A-Z]/i.test(line.slice(0, 2)) &&!/[a-z]{4,}/.test(line)) {
      fields.flightTrainNo = `${flight[1].toUpperCase()} ${flight[2]}`;
      if (flight[3] && flight[4]) fields.flightSector = `${flight[3].toUpperCase()}–${flight[4].toUpperCase()}`;
      if (flight[6]) fields.flightTime = `${flight[5].toUpperCase()} ${flight[6].replace('.', ':')}`;
      values.flightTrainNo = fields.flightTrainNo;
      current = null;
      continue;
    }
    // A phone number on its own after the sign-off is the company's number.
    if (PHONE_ONLY.test(line) && (inSignature || current === 'vendorHint')) {
      if (!values.contactNumber) values.contactNumber = line;
      current = null;
      continue;
    }
    if (current && (values[current] === '' || CONTINUES.has(current)) && !(blankSince && current === 'vendorHint')) {
      if (current === 'vendorHint' && PHONE_ONLY.test(line)) { values.contactNumber ??= line; continue; }
      append(current, line);
      blankSince = false;
      continue;
    }
    blankSince = false;
    if (NOISE.test(line)) instructions.push(line);
    else unmatchedLines.push(line);
  }

  // ---- interpret the raw values ----
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const val = tidy(v);
    switch (k) {
      case 'passengerName': {
        if (isNA(val)) break;
        const { name, mobile } = splitNameAndMobile(val);
        if (name) fields.passengerName = name;
        if (mobile) fields.passengerMobile = mobile;
        break;
      }
      case 'passengerCount': {
        const n = Number(String(val).match(/\d+/)?.[0]);
        if (n > 0 && n < 100) fields.passengerCount = n;
        break;
      }
      case 'dutyType': {
        if (isNA(val)) break;
        const d = splitDutyType(val);
        fields.dutyType = d.dutyType;
        if (d.packageLabel) fields.packageLabel = d.packageLabel;
        if (d.tripType) fields.tripType = d.tripType;
        break;
      }
      case 'contactNumber':
        fields.contactNumber = normaliseMobile(val) || val;
        break;
      case 'vendorHint':
        fields.vendorHint = val.replace(/[,.\s]+$/, '');
        break;
      case 'flightTrainNo':
        if (!isNA(val) && !fields.flightTrainNo) fields.flightTrainNo = val;
        break;
      default:
        if (!isNA(val)) (fields as any)[k] = val;
    }
  }

  // "Disposal//Jio World Centre" — the duty kind written in front of the drop.
  const disposal = fields.dropAddress?.match(/^(disposal|local|drop only)\s*\/\/?\s*(.+)$/i);
  if (disposal) {
    fields.dropAddress = disposal[2].trim();
    fields.remarks = fields.remarks ? `${fields.remarks}; ${disposal[1]}` : disposal[1];
    if (!fields.tripType && /disposal|local/i.test(disposal[1])) fields.tripType = 'LOCAL';
  }

  // A flight written into an address ("6E 2122 CCU NMI ETA 10.15 HRS NAVI MUMBAI AIRPORT"):
  // keep the address as written, and lift the flight details out of it.
  if (!fields.flightTrainNo) {
    for (const text of [fields.pickupAddress, fields.dropAddress]) {
      const f = text?.match(FLIGHT_LINE);
      if (f && /^[A-Z0-9]{2}\s?\d{3,4}\b/.test(text!) && /[A-Z]/.test(f[1])) {
        fields.flightTrainNo = `${f[1].toUpperCase()} ${f[2]}`;
        if (f[3] && f[4]) fields.flightSector = `${f[3].toUpperCase()}–${f[4].toUpperCase()}`;
        if (f[6]) fields.flightTime = `${f[5].toUpperCase()} ${f[6].replace('.', ':')}`;
        break;
      }
    }
  }

  if (fields.vendorBookingRef) fields.vendorBookingRef = fields.vendorBookingRef.replace(/^#\s*/, '').split(/\s+/)[0];

  // City "Mumbai to Outstation" says what the duty type left blank.
  if (!fields.tripType && fields.city && /outstation/i.test(fields.city)) fields.tripType = 'OUTSTATION';
  if (!fields.tripType && fields.remarks && /\bdisposal\b/i.test(fields.remarks)) fields.tripType = 'LOCAL';

  // Vendors often write the destination into the remarks instead.
  const remarksDrop = fields.remarks?.match(DROP_IN_TEXT)?.[1]?.replace(/[.,;]+$/, '').trim();
  if (!fields.dropAddress && remarksDrop) {
    fields.dropAddress = remarksDrop;
    fields.dropFromRemarks = true;
  } else if (fields.dropAddress && remarksDrop) {
    // A drop address that ends mid-word ("…Mumbai, Mahara") when the remarks
    // carry a longer version: offer it, never apply it silently.
    const lastWord = fields.dropAddress.split(/[\s,]+/).pop() ?? '';
    const truncated = lastWord.length >= 3 && new RegExp(`\\b${escapeRe(lastWord)}[a-z]+`, 'i').test(remarksDrop)
      && !new RegExp(`\\b${escapeRe(lastWord)}\\b`, 'i').test(remarksDrop);
    if (truncated) {
      warnings.push(`The drop address looks cut off ("…${lastWord}"). The remarks give "${remarksDrop}". Check it before saving.`);
      fieldSuggestions.dropAddress = `${fields.dropAddress.slice(0, fields.dropAddress.length - lastWord.length)}${remarksDrop.match(new RegExp(`\\b${escapeRe(lastWord)}[a-z]+`, 'i'))![0]}`;
    }
  }

  // Trip type can also be inferred from the pickup/drop text.
  const blob = `${fields.pickupAddress ?? ''} ${fields.dropAddress ?? ''} ${fields.remarks ?? ''}`;
  if (!fields.tripType || fields.tripType === 'TRANSFER') {
    if (AIRPORT_HINT.test(blob)) fields.tripType = 'AIRPORT';
  }
  if (fields.tripType === 'AIRPORT') {
    fields.airportDirection = inferAirportDirection(fields.pickupAddress, fields.dropAddress)
      ?? (/\bETD\b/i.test(fields.flightTime ?? '') ? 'TO' : /\bETA\b/i.test(fields.flightTime ?? '') ? 'FROM' : undefined);
  }

  let dateNeedsConfirm = false;
  if (fields.travelDateRaw) {
    const d = parseTravelDate(fields.travelDateRaw, today);
    if (d.from) fields.travelDate = d.from;
    if (d.to) fields.travelDateTo = d.to;
    if (d.warning) warnings.push(d.warning);
    dateNeedsConfirm = !!d.assumedYear || !d.from;
  }

  let timeNeedsConfirm = false;
  if (fields.reportingTime) {
    const t = fields.reportingTime.match(/(\d{1,2})[:.](\d{2})\s*([ap])?\.?m?/i);
    if (t) {
      let h = Number(t[1]);
      if (t[3]?.toLowerCase() === 'p' && h < 12) h += 12;
      if (t[3]?.toLowerCase() === 'a' && h === 12) h = 0;
      if (h <= 23 && Number(t[2]) <= 59) fields.reportingTime = `${String(h).padStart(2, '0')}:${t[2]}`;
      else timeNeedsConfirm = true;
    } else timeNeedsConfirm = true;
  }

  // The original spreadsheet built the route as: pickup & " To " & drop
  if (fields.pickupAddress) {
    fields.route = fields.dropAddress ? `${fields.pickupAddress} To ${fields.dropAddress}` : fields.pickupAddress;
  }

  // The company's own number is never the passenger's.
  if (fields.passengerMobile && fields.contactNumber && fields.passengerMobile === fields.contactNumber) {
    warnings.push('The only mobile number found is the company\'s contact number — enter the passenger\'s number.');
    delete fields.passengerMobile;
  }

  if (instructions.length) fields.specialInstructions = instructions.join('\n');

  // ----- what was found, what is missing, what needs a human -----
  const fieldStatus: ParseResult['fieldStatus'] = {};
  const required: (keyof ParsedBooking)[] = [
    'vendorBookingRef', 'passengerName', 'passengerMobile', 'vehicleType', 'travelDate', 'reportingTime', 'pickupAddress',
  ];
  for (const k of required) fieldStatus[k] = fields[k] ? 'ok' : 'missing';
  for (const k of ['dropAddress', 'dutyType', 'city', 'flightTrainNo', 'remarks', 'tripType'] as (keyof ParsedBooking)[]) {
    fieldStatus[k] = fields[k] ? 'ok' : (k in values && isNA(values[k as string]) ? 'not_applicable' : 'missing');
  }
  if (opts.noReference && !fields.vendorBookingRef) fieldStatus.vendorBookingRef = 'not_applicable';
  if (dateNeedsConfirm && fields.travelDate) fieldStatus.travelDate = 'confirm';
  if (timeNeedsConfirm) fieldStatus.reportingTime = 'confirm';
  if (fieldSuggestions.dropAddress) fieldStatus.dropAddress = 'confirm';
  if (fields.dropFromRemarks) fieldStatus.dropAddress = 'confirm';
  if (fields.passengerMobile && fields.passengerMobile.length !== 10) {
    fieldStatus.passengerMobile = 'confirm';
    warnings.push(`The passenger number "${fields.passengerMobile}" is not a 10-digit mobile — check it.`);
  }

  const key: (keyof ParsedBooking)[] = ['vendorBookingRef', 'passengerName', 'passengerMobile', 'vehicleType', 'travelDate', 'reportingTime', 'pickupAddress'];
  const got = key.filter((k) => !!fields[k] || (k === 'vendorBookingRef' && opts.noReference)).length;
  const confidence = Math.round((got / key.length) * 100) / 100;

  if (!fields.vendorBookingRef && !opts.noReference) warnings.push('No vendor booking reference found in the message.');
  if (!fields.passengerName) warnings.push('No passenger name found in the message.');
  if (!fields.pickupAddress) warnings.push('No pickup / reporting address found in the message.');
  if (!fields.travelDate) warnings.push('No travel date found — set it before saving.');
  if (unmatchedLines.length > 0) {
    warnings.push(`${unmatchedLines.length} line(s) could not be matched to a field — review them below.`);
  }

  return { detectedFormat, fields, fieldStatus, fieldSuggestions, matchedLabels, unmatchedLines, warnings, confidence };
}
