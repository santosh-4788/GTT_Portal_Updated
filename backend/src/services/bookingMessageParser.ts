/**
 * Vendor booking-message parser.
 *
 * This replaces `E:\Portal\InvoiceFormat\DataEntryFormula.xlsx`, which was a hand-built
 * Excel sheet of SUBSTITUTE/SEARCH formulas used to strip labels off WhatsApp booking
 * messages. Two message dialects were found in that workbook:
 *
 *   Format A ("Booking #")  — AuraFox / Shree Destinations
 *   Format B ("TripId #")   — FleetOZ / MMT
 *
 * The original formulas were case-sensitive and already failing on Format B
 * (`Reporting address:` vs `Reporting Address:`), which left the label glued to the
 * value. This parser is case-insensitive, whitespace-tolerant and alias-driven, and it
 * reports a confidence score plus warnings so the operator can eyeball the result
 * before saving.
 */

export interface ParsedBooking {
  vendorBookingRef?: string;
  passengerName?: string;
  passengerMobile?: string;
  vehicleType?: string;
  dutyType?: string;
  tripType?: string;
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
  contactNumber?: string;
  specialInstructions?: string;
  route?: string;
  /** e.g. "6E 2128", read off a bare airline sector line. */
  flightSector?: string;      // "NMI–MAA"
  flightTime?: string;        // "ETD 07:05"
  /** True when the drop had to be recovered from the remarks text. */
  dropFromRemarks?: boolean;
}

export interface ParseResult {
  detectedFormat: 'BOOKING_HASH' | 'TRIPID_HASH' | 'GENERIC' | 'UNKNOWN';
  fields: ParsedBooking;
  matchedLabels: string[];
  unmatchedLines: string[];
  warnings: string[];
  confidence: number;         // 0..1
}

/** label aliases -> canonical field. All comparisons are lower-cased. */
const LABELS: Array<{ field: keyof ParsedBooking; aliases: string[] }> = [
  { field: 'vendorBookingRef', aliases: ['booking #', 'booking#', 'booking no', 'booking id', 'tripid #', 'tripid#', 'trip id', 'trip #', 'duty id', 'ref #'] },
  { field: 'passengerName', aliases: ['for', 'passengers', 'passenger', 'guest name', 'guest', 'pax name', 'name'] },
  { field: 'vehicleType', aliases: ['vehicle group', 'vehicle type', 'vehicle', 'car type', 'cab type'] },
  { field: 'dutyType', aliases: ['duty type', 'duty', 'service type', 'trip type'] },
  { field: 'city', aliases: ['city', 'location city'] },
  { field: 'travelDateRaw', aliases: ['date', 'travel date', 'duty date', 'pickup date'] },
  { field: 'reportingTime', aliases: ['reporting time', 'report time', 'pickup time', 'time'] },
  { field: 'pickupAddress', aliases: ['reporting address', 'pickup address', 'pick up address', 'from', 'pickup'] },
  { field: 'flightTrainNo', aliases: ['flight/train number', 'flight / train number', 'flight number', 'flight no', 'train number', 'flight'] },
  { field: 'dropAddress', aliases: ['drop address', 'drop off address', 'drop', 'to', 'destination'] },
  { field: 'remarks', aliases: ['remarks', 'remark', 'note', 'notes', 'instructions'] },
  { field: 'vendorHint', aliases: ['regards', 'from company', 'company'] },
  { field: 'contactNumber', aliases: ['contact', 'contact no', 'contact number', '24x7', 'helpline'] },
];

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Strip a leading label from a line if it matches one of the aliases. */
function splitLabel(line: string): { label: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // "Booking #88245430-1" / "TripId #674HPB-1" — hash acts as the separator
  const hash = trimmed.match(/^([A-Za-z][A-Za-z /]*?)\s*#\s*(.+)$/);
  if (hash) return { label: hash[1].trim().toLowerCase() + ' #', value: hash[2].trim() };

  // "Label: value"
  const colon = trimmed.indexOf(':');
  if (colon > 0 && colon <= 32) {
    return { label: trimmed.slice(0, colon).trim().toLowerCase(), value: trimmed.slice(colon + 1).trim() };
  }

  // "For T Sridhar(9663655300)" — space-separated label with no colon
  const space = trimmed.match(/^(For|Regards)\s+(.+)$/i);
  if (space) return { label: space[1].toLowerCase(), value: space[2].trim() };

  return null;
}

function canonical(label: string): keyof ParsedBooking | null {
  const clean = label.replace(/\s*#\s*$/, ' #').replace(/\s+/g, ' ').trim();
  for (const entry of LABELS) {
    for (const alias of entry.aliases) {
      if (clean === alias || clean === alias + ' #' || clean.replace(/ #$/, '') === alias) {
        return entry.field;
      }
    }
  }
  return null;
}

/** "T Sridhar(9663655300)" / "Behari(+919870139050)" -> name + mobile */
function splitNameAndMobile(value: string): { name: string; mobile?: string } {
  const m = value.match(/^(.*?)[\s]*[\(\[]\s*(\+?[\d\s\-]{6,})\s*[\)\]]\s*$/);
  if (m) return { name: m[1].trim(), mobile: normaliseMobile(m[2]) };

  // trailing bare number: "T Sridhar 9663655300"
  const t = value.match(/^(.*?)[\s,\-]+(\+?91?[\s\-]?\d{10})\s*$/);
  if (t) return { name: t[1].trim(), mobile: normaliseMobile(t[2]) };

  return { name: value.trim() };
}

export function normaliseMobile(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/**
 * Vendor dates arrive as free text: "27/01 to 27/01", "30 OCT '24", "05-Feb-2025".
 * Return an ISO date only when we are confident; otherwise leave it to the operator.
 */
export function parseTravelDate(raw: string): { from?: string; to?: string; warning?: string } {
  if (!raw) return {};
  const text = raw.trim().replace(/\s+/g, ' ');
  const now = new Date();

  const rangeParts = text.split(/\s+(?:to|To|TO|-|–|until)\s+/).filter(Boolean);
  const first = rangeParts[0];
  const second = rangeParts.length > 1 ? rangeParts[rangeParts.length - 1] : undefined;

  const one = (s: string): { iso?: string; assumedYear?: boolean } => {
    if (!s) return {};
    let m: RegExpMatchArray | null;

    // 2024-03-07
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
      return { iso: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
    }
    // 27/01/2024 or 27-01-24
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/))) {
      const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { iso: `${yr}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` };
    }
    // 27/01  (no year — assume current FY context)
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})$/))) {
      return {
        iso: `${now.getFullYear()}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
        assumedYear: true,
      };
    }
    // 30 OCT '24  /  30 Oct 2024  /  30-Oct-24
    if ((m = s.match(/^(\d{1,2})[\s\-]*([A-Za-z]{3,4})\.?[\s\-]*'?(\d{2,4})?$/))) {
      const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (!mon) return {};
      const assumedYear = !m[3];
      const yr = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      return {
        iso: `${yr}-${String(mon).padStart(2, '0')}-${m[1].padStart(2, '0')}`,
        assumedYear,
      };
    }
    return {};
  };

  const a = one(first);
  const b = second ? one(second) : {};

  if (!a.iso) return { warning: `Could not read the travel date "${raw}" — please set it manually.` };
  const warning = a.assumedYear
    ? `The vendor message did not include a year ("${raw}") — ${now.getFullYear()} was assumed. Please confirm.`
    : undefined;

  return { from: a.iso, to: b.iso && b.iso !== a.iso ? b.iso : undefined, warning };
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
  else if (upper.includes('LOCAL')) tripType = 'LOCAL';

  const packageLabel = value
    .replace(/\b(LOCAL|TRANSFER|OUTSTATION|AIRPORT)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { tripType, packageLabel, dutyType: value };
}

const NOISE = /^(car model|good condition|driver in uniform|no tobacco|thanks|thank you|regards|please confirm|kindly confirm|-{2,}|_{2,})/i;

/**
 * An airline sector line, e.g. "6E 2128 NMI MAA ETD 07.05 HRS" or
 * "AI 2846 BLR BOM ETA 10:10HRS T2". Vendors paste these on their own line
 * rather than filling in the Flight/Train field, so they used to be discarded.
 */
const FLIGHT_LINE =
  /^([A-Z0-9]{2}\d?)[\s-]?(\d{2,4})\b(?:\s+([A-Z]{3})\s+([A-Z]{3}))?(?:.*?\b(ETD|ETA)\s*[:\-]?\s*(\d{1,2}[.:]\d{2}))?/i;

/** "Drop At Navi Mumbai Airport", "drop to Pune", "drop-off: BKC". */
const DROP_IN_TEXT = /\bdrop\s*(?:off|at|to|point)?\s*[:\-]?\s+(.{3,200}?)\s*$/i;

/** Terminal hints so an airport drop can set the trip type correctly. */
const AIRPORT_HINT = /\bairport\b|\bterminal\s*[t]?[123]\b|\bT[123]\b|\bCSMIA\b|\bNMIA\b/i;

export function parseBookingMessage(message: string): ParseResult {
  const warnings: string[] = [];
  const matchedLabels: string[] = [];
  const unmatchedLines: string[] = [];
  const fields: ParsedBooking = {};
  const instructions: string[] = [];

  const lines = String(message ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let detectedFormat: ParseResult['detectedFormat'] = 'UNKNOWN';
  const head = lines.join('\n').toLowerCase();
  if (/booking\s*#/.test(head)) detectedFormat = 'BOOKING_HASH';
  else if (/trip\s*id\s*#|tripid\s*#/.test(head)) detectedFormat = 'TRIPID_HASH';
  else if (lines.some((l) => splitLabel(l))) detectedFormat = 'GENERIC';

  for (const line of lines) {
    const parts = splitLabel(line);
    if (!parts) {
      // A bare airline sector line carries the flight number and often the
      // departure time — worth keeping rather than filing as "unmatched".
      const flight = !fields.flightTrainNo && line.match(FLIGHT_LINE);
      if (flight) {
        fields.flightTrainNo = `${flight[1].toUpperCase()} ${flight[2]}`;
        if (flight[3] && flight[4]) fields.flightSector = `${flight[3].toUpperCase()}–${flight[4].toUpperCase()}`;
        if (flight[6]) {
          const t = flight[6].replace('.', ':');
          fields.flightTime = `${flight[5].toUpperCase()} ${t}`;
        }
        continue;
      }
      if (NOISE.test(line)) instructions.push(line);
      else unmatchedLines.push(line);
      continue;
    }
    const field = canonical(parts.label);
    if (!field) {
      if (NOISE.test(line)) instructions.push(line);
      else unmatchedLines.push(line);
      continue;
    }

    // never let a later blank line clobber an earlier good value
    if (!parts.value) continue;
    if (fields[field]) continue;

    matchedLabels.push(parts.label);

    if (field === 'passengerName') {
      const { name, mobile } = splitNameAndMobile(parts.value);
      fields.passengerName = name;
      if (mobile) fields.passengerMobile = mobile;
    } else if (field === 'dutyType') {
      const d = splitDutyType(parts.value);
      fields.dutyType = d.dutyType;
      fields.packageLabel = d.packageLabel;
      if (d.tripType) fields.tripType = d.tripType;
    } else if (field === 'contactNumber') {
      fields.contactNumber = normaliseMobile(parts.value) || parts.value;
    } else {
      (fields as any)[field] = parts.value;
    }
  }

  // Vendors frequently omit the Drop address line and write the destination
  // into the remarks instead ("Remarks: Drop At Navi Mumbai Airport").
  const naText = (v?: string) => !v || /^(na|n\/a|-|nil|none)$/i.test(v.trim());
  if (naText(fields.dropAddress) && fields.remarks) {
    const m = fields.remarks.match(DROP_IN_TEXT);
    if (m) {
      fields.dropAddress = m[1].replace(/[.,;]+$/, '').trim();
      fields.dropFromRemarks = true;
    }
  }

  // Trip type can also be inferred from the pickup/drop text when duty type was silent.
  const blob = `${fields.pickupAddress ?? ''} ${fields.dropAddress ?? ''} ${fields.remarks ?? ''}`;
  if (!fields.tripType || fields.tripType === 'TRANSFER') {
    if (AIRPORT_HINT.test(blob)) fields.tripType = 'AIRPORT';
  }

  if (fields.travelDateRaw) {
    const d = parseTravelDate(fields.travelDateRaw);
    if (d.from) fields.travelDate = d.from;
    if (d.to) fields.travelDateTo = d.to;
    if (d.warning) warnings.push(d.warning);
  }

  if (fields.reportingTime) {
    const t = fields.reportingTime.match(/(\d{1,2})[:.](\d{2})/);
    if (t) fields.reportingTime = `${t[1].padStart(2, '0')}:${t[2]}`;
  }

  // The original spreadsheet built the route as: pickup & " To " & drop
  const na = (v?: string) => !v || /^(na|n\/a|-|nil|none)$/i.test(v.trim());
  if (!na(fields.pickupAddress)) {
    fields.route = na(fields.dropAddress)
      ? fields.pickupAddress
      : `${fields.pickupAddress} To ${fields.dropAddress}`;
  }
  if (na(fields.dropAddress)) fields.dropAddress = undefined;
  if (na(fields.flightTrainNo)) fields.flightTrainNo = undefined;

  if (instructions.length) fields.specialInstructions = instructions.join('\n');

  // ----- confidence -----
  const key: (keyof ParsedBooking)[] = [
    'vendorBookingRef', 'passengerName', 'passengerMobile',
    'vehicleType', 'travelDate', 'reportingTime', 'pickupAddress',
  ];
  const got = key.filter((k) => !!fields[k]).length;
  const confidence = Math.round((got / key.length) * 100) / 100;

  if (!fields.vendorBookingRef) warnings.push('No vendor booking reference found in the message.');
  if (!fields.passengerName) warnings.push('No passenger name found in the message.');
  if (!fields.pickupAddress) warnings.push('No pickup / reporting address found in the message.');
  if (unmatchedLines.length > 3) {
    warnings.push(`${unmatchedLines.length} lines could not be matched to a field — review them below.`);
  }

  return { detectedFormat, fields, matchedLabels, unmatchedLines, warnings, confidence };
}
