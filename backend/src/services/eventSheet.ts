/**
 * Event requirement sheets.
 *
 * An event's vehicle list nearly always arrives as a spreadsheet (or a block
 * copied out of one): "12 Innovas on the 14th at 7 am from the Taj". This
 * turns such a table into requirement rows and says, row by row, what is wrong
 * with it — before anything is saved.
 *
 *   readTable()      .xlsx / .csv / pasted tab-separated text -> header + rows
 *   suggestMapping() fuzzy header match -> { field: columnIndex }
 *   validateRows()   normalise + validate requirement rows (no writes)
 */
import ExcelJS from 'exceljs';
import { q } from '../db';
import { matchCategoryId } from './bootstrap';
import { MOBILE_RE } from '../utils/validate';

/* ==========================================================================
   Fields
   ========================================================================== */

export const REQUIREMENT_FIELDS = [
  'travelDate', 'reportingTime', 'vehicleCategory', 'vehicleCount', 'pickupAddress', 'dropAddress',
  'dutyType', 'tripType', 'passengerName', 'passengerMobile', 'paxCount', 'farePerVehicle', 'remarks',
] as const;
export type RequirementField = (typeof REQUIREMENT_FIELDS)[number];

export const FIELD_LABEL: Record<RequirementField, string> = {
  travelDate: 'Travel date', reportingTime: 'Reporting time', vehicleCategory: 'Vehicle',
  vehicleCount: 'No. of vehicles', pickupAddress: 'Pickup', dropAddress: 'Drop', dutyType: 'Duty type',
  tripType: 'Trip type', passengerName: 'Guest / passenger', passengerMobile: 'Guest mobile',
  paxCount: 'Pax', farePerVehicle: 'Fare per vehicle', remarks: 'Remarks',
};

/** Accepted headings, lower-cased with everything but letters and digits removed. */
const ALIASES: Record<RequirementField, string[]> = {
  travelDate: ['date', 'traveldate', 'tripdate', 'dutydate', 'journeydate', 'day', 'pickupdate', 'reportingdate'],
  reportingTime: ['time', 'reportingtime', 'pickuptime', 'reporttime', 'starttime', 'rpttime', 'reporting'],
  vehicleCategory: ['vehicle', 'vehicletype', 'car', 'cartype', 'category', 'vehiclecategory', 'cab', 'cabtype', 'model', 'vehiclemodel'],
  vehicleCount: ['count', 'qty', 'quantity', 'noofvehicles', 'vehicles', 'novehicles', 'numberofvehicles', 'nos', 'units', 'noofcars', 'cars', 'vehiclecount'],
  pickupAddress: ['pickup', 'pickupaddress', 'from', 'pickuplocation', 'pickuppoint', 'source', 'origin', 'reportingaddress', 'reportingplace'],
  dropAddress: ['drop', 'dropaddress', 'to', 'droplocation', 'droppoint', 'destination', 'dropoff'],
  dutyType: ['duty', 'dutytype', 'package', 'slab', 'usage', 'plan'],
  tripType: ['triptype', 'type', 'service', 'servicetype'],
  passengerName: ['guest', 'guestname', 'passenger', 'passengername', 'name', 'pax name', 'paxname', 'contactname', 'coordinator'],
  passengerMobile: ['mobile', 'guestmobile', 'passengermobile', 'phone', 'contact', 'contactno', 'mobileno', 'phoneno', 'contactnumber', 'mobilenumber'],
  paxCount: ['pax', 'paxcount', 'passengers', 'noofpax', 'persons', 'people', 'guests'],
  farePerVehicle: ['fare', 'rate', 'amount', 'price', 'fareper vehicle', 'farepervehicle', 'ratepervehicle', 'pervehicle', 'cost', 'tariff'],
  remarks: ['remarks', 'remark', 'notes', 'note', 'comments', 'comment', 'instructions', 'specialinstructions'],
};

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const TRIP_TYPES = ['LOCAL', 'TRANSFER', 'OUTSTATION', 'AIRPORT', 'ROUND_TRIP', 'PACKAGE'] as const;

/* ==========================================================================
   Reading a table
   ========================================================================== */

const pad = (n: number) => String(n).padStart(2, '0');

/** ExcelJS cell values flattened to text; dates as YYYY-MM-DD, times as HH:MM. */
function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel stores a bare time as a date on 30-Dec-1899.
    if (v.getUTCFullYear() < 1901) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('').trim();
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text ?? '').trim();
    if ('error' in v) return '';
  }
  return String(v).trim();
}

/** CSV / TSV, with quoted fields. */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const d = delimiter ?? (firstLine.includes('\t') ? '\t' : firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === d) { row.push(cell.trim()); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export async function readXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  // The first sheet that has something on it.
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  const width = ws.actualColumnCount || ws.columnCount;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    if (cells.some((x) => x !== '')) out.push(cells);
  });
  return out;
}

/** Does this row read like headings rather than data? */
function looksLikeHeader(row: string[]): boolean {
  let hits = 0;
  for (const c of row) {
    const n = norm(c);
    if (!n) continue;
    if (Object.values(ALIASES).some((list) => list.some((a) => norm(a) === n))) hits++;
  }
  return hits >= 2;
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  hasHeader: boolean;
  mapping: Partial<Record<RequirementField, number>>;
}

/** Split off the heading row (if there is one) and suggest a mapping. */
export function toTable(raw: string[][]): ParsedTable {
  // Skip title lines above the real heading (e.g. "Sharma wedding — cars").
  let start = 0;
  for (let i = 0; i < Math.min(raw.length, 8); i++) {
    if (looksLikeHeader(raw[i])) { start = i; break; }
  }
  const hasHeader = raw.length > 0 && looksLikeHeader(raw[start]);
  const width = Math.max(0, ...raw.map((r) => r.length));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => raw[start][i] || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  const rows = (hasHeader ? raw.slice(start + 1) : raw).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''));
  return { headers, rows, hasHeader, mapping: hasHeader ? suggestMapping(headers) : guessMappingFromData(rows) };
}

/** Each field to the best-matching column; a column is used once. */
export function suggestMapping(headers: string[]): Partial<Record<RequirementField, number>> {
  const mapping: Partial<Record<RequirementField, number>> = {};
  const used = new Set<number>();
  const nh = headers.map(norm);
  // Pass 1 exact alias; pass 2 alias contained in the heading.
  for (const pass of [1, 2]) {
    for (const f of REQUIREMENT_FIELDS) {
      if (mapping[f] !== undefined) continue;
      const aliases = ALIASES[f].map(norm);
      let best = -1;
      let bestLen = 0;
      nh.forEach((h, i) => {
        if (!h || used.has(i)) return;
        for (const a of aliases) {
          const ok = pass === 1 ? h === a : a.length >= 3 && h.includes(a);
          if (ok && a.length > bestLen) { best = i; bestLen = a.length; }
        }
      });
      if (best >= 0) { mapping[f] = best; used.add(best); }
    }
  }
  return mapping;
}

/** No heading row: guess from what the cells look like. */
function guessMappingFromData(rows: string[][]): Partial<Record<RequirementField, number>> {
  const mapping: Partial<Record<RequirementField, number>> = {};
  const sample = rows.slice(0, 20);
  const width = Math.max(0, ...sample.map((r) => r.length));
  const share = (i: number, test: (s: string) => boolean) => {
    const vals = sample.map((r) => r[i]).filter(Boolean);
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };
  const used = new Set<number>();
  const take = (f: RequirementField, test: (s: string) => boolean) => {
    for (let i = 0; i < width; i++) {
      if (!used.has(i) && share(i, test) >= 0.8) { mapping[f] = i; used.add(i); return; }
    }
  };
  take('travelDate', (s) => !!parseDate(s));
  take('reportingTime', (s) => !!parseTime(s) && !/^\d+$/.test(s));
  take('passengerMobile', (s) => MOBILE_RE.test(cleanMobile(s)));
  take('vehicleCategory', (s) => !!matchCategoryId(s));
  take('vehicleCount', (s) => /^\d{1,3}$/.test(s) && Number(s) > 0 && Number(s) <= 200);
  return mapping;
}

/** Rows as field objects, using a mapping. */
export function applyMapping(rows: string[][], mapping: Partial<Record<RequirementField, number>>): Record<string, string>[] {
  return rows.map((r) => {
    const o: Record<string, string> = {};
    for (const f of REQUIREMENT_FIELDS) {
      const i = mapping[f];
      if (i !== undefined && i !== null && i >= 0) o[f] = String(r[i] ?? '').trim();
    }
    return o;
  }).filter((o) => Object.values(o).some((v) => v !== ''));
}

/* ==========================================================================
   Normalising values
   ========================================================================== */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function validYmd(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;   // 31-Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 2026-10-14, 14-10-2026, 14/10/26, 14 Oct 2026, 14-Oct-26, Excel serial 46309. Indian order (day first). */
export function parseDate(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) return validYmd(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? validYmd(+m[3], mon, +m[1]) : null;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 30000 && serial < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
  }
  return null;
}

/** 07:00, 7:00, 7 am, 7.30 pm, 0700, 19:30:00, Excel fraction 0.2916. */
export function parseTime(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.|hrs|hours|h)?$/.exec(s);
  if (m) {
    let h = +m[1];
    const mi = m[2] ? +m[2] : 0;
    const ap = m[3]?.replace(/\./g, '');
    if (!m[2] && !ap) return null;                 // a bare "7" is ambiguous
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return `${pad(h)}:${pad(mi)}`;
  }
  m = /^(\d{2})(\d{2})\s*(hrs|h)?$/.exec(s);
  if (m && +m[1] <= 23 && +m[2] <= 59) return `${m[1]}:${m[2]}`;
  if (/^0?\.\d+$/.test(s)) {
    const mins = Math.round(Number(s) * 24 * 60);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  return null;
}

const cleanMobile = (s: unknown) =>
  String(s ?? '').replace(/[^\d]/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');

function parseNumber(v: unknown): number | null {
  const s = String(v ?? '').replace(/[₹,\s]|rs\.?|inr/gi, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function tripTypeOf(v: unknown): string | null {
  const s = norm(v);
  if (!s) return null;
  if (/airport|pickup|drop|arrival|departure/.test(s)) return 'AIRPORT';
  if (/outstation/.test(s)) return 'OUTSTATION';
  if (/round/.test(s)) return 'ROUND_TRIP';
  if (/transfer|p2p|pointtopoint/.test(s)) return 'TRANSFER';
  if (/package|tour/.test(s)) return 'PACKAGE';
  if (/local|disposal|hrs|hour|km/.test(s)) return 'LOCAL';
  const up = String(v).trim().toUpperCase().replace(/\s+/g, '_');
  return (TRIP_TYPES as readonly string[]).includes(up) ? up : null;
}

/* ==========================================================================
   Validation
   ========================================================================== */

export interface RequirementInput {
  travelDate?: unknown; reportingTime?: unknown; vehicleCategory?: unknown; vehicleCategoryId?: unknown;
  vehicleCount?: unknown; pickupAddress?: unknown; dropAddress?: unknown; dutyType?: unknown; tripType?: unknown;
  passengerName?: unknown; passengerMobile?: unknown; paxCount?: unknown; farePerVehicle?: unknown; remarks?: unknown;
}

export interface NormalRequirement {
  travel_date: string;
  reporting_time: string | null;
  vehicle_category_id: number | null;
  vehicle_type: string | null;
  vehicle_count: number;
  pickup_address: string | null;
  drop_address: string | null;
  duty_type: string | null;
  trip_type: string;
  passenger_name: string | null;
  passenger_mobile: string | null;
  pax_count: number | null;
  fare_per_vehicle: number | null;
  remarks: string | null;
}

export interface RowResult {
  row: number;                     // 1-based position in what was sent
  ok: boolean;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
  data: NormalRequirement | null;
  category_name?: string | null;
}

const text = (v: unknown, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export function validateRows(
  rows: RequirementInput[],
  event: { start_date: string; end_date: string | null },
): { rows: RowResult[]; valid: number; invalid: number; vehicles: number } {
  const cats = q.all<{ id: number; name: string; is_active: number }>('SELECT id, name, is_active FROM vehicle_categories');
  const catById = new Map(cats.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Map<string, number>();

  const results = rows.map((r, idx): RowResult => {
    const errors: RowResult['errors'] = [];
    const warnings: RowResult['warnings'] = [];

    // Date
    const travel_date = parseDate(r.travelDate);
    if (!String(r.travelDate ?? '').trim()) errors.push({ field: 'travelDate', message: 'Travel date is required.' });
    else if (!travel_date) errors.push({ field: 'travelDate', message: `"${r.travelDate}" is not a date. Use DD-MM-YYYY.` });
    else {
      if (travel_date < event.start_date || (event.end_date && travel_date > event.end_date)) {
        warnings.push({ field: 'travelDate', message: `Outside the event dates (${event.start_date}${event.end_date ? ` to ${event.end_date}` : ''}).` });
      }
      if (travel_date < today) warnings.push({ field: 'travelDate', message: 'This date is in the past.' });
    }

    // Time
    let reporting_time: string | null = null;
    if (String(r.reportingTime ?? '').trim()) {
      reporting_time = parseTime(r.reportingTime);
      if (!reporting_time) errors.push({ field: 'reportingTime', message: `"${r.reportingTime}" is not a time. Use HH:MM or 7:30 am.` });
    } else warnings.push({ field: 'reportingTime', message: 'No reporting time.' });

    // Vehicle category
    let vehicle_category_id: number | null = null;
    let vehicle_type: string | null = text(r.vehicleCategory, 80);
    const givenId = Number(r.vehicleCategoryId ?? 0);
    if (givenId > 0) {
      const c = catById.get(givenId);
      if (!c) errors.push({ field: 'vehicleCategory', message: 'That vehicle category no longer exists.' });
      else if (!c.is_active) errors.push({ field: 'vehicleCategory', message: `"${c.name}" is deactivated.` });
      else { vehicle_category_id = c.id; vehicle_type = c.name; }
    } else if (vehicle_type) {
      const id = matchCategoryId(vehicle_type);
      const c = id ? catById.get(id) : undefined;
      if (!c) errors.push({ field: 'vehicleCategory', message: `"${vehicle_type}" does not match a vehicle category. Choose one from the list.` });
      else if (!c.is_active) errors.push({ field: 'vehicleCategory', message: `"${c.name}" is deactivated.` });
      else {
        vehicle_category_id = c.id;
        if (vehicle_type.toLowerCase() !== c.name.toLowerCase()) warnings.push({ field: 'vehicleCategory', message: `Read "${vehicle_type}" as ${c.name}.` });
        vehicle_type = c.name;
      }
    } else errors.push({ field: 'vehicleCategory', message: 'Vehicle category is required.' });

    // Count
    let vehicle_count = 1;
    const rawCount = String(r.vehicleCount ?? '').trim();
    if (rawCount) {
      const n = parseNumber(rawCount);
      if (n === null || !Number.isInteger(n) || n <= 0) errors.push({ field: 'vehicleCount', message: 'Number of vehicles must be a whole number above 0.' });
      else if (n > 200) errors.push({ field: 'vehicleCount', message: 'More than 200 vehicles on one line — split it.' });
      else vehicle_count = n;
    }

    // Mobile
    let passenger_mobile: string | null = null;
    if (String(r.passengerMobile ?? '').trim()) {
      const m = cleanMobile(r.passengerMobile);
      if (!MOBILE_RE.test(m)) errors.push({ field: 'passengerMobile', message: `"${r.passengerMobile}" is not a 10-digit mobile number.` });
      else passenger_mobile = m;
    }

    // Pax
    let pax_count: number | null = null;
    if (String(r.paxCount ?? '').trim()) {
      const n = parseNumber(r.paxCount);
      if (n === null || !Number.isInteger(n) || n < 0 || n > 80) errors.push({ field: 'paxCount', message: 'Pax must be a whole number up to 80.' });
      else pax_count = n;
    }

    // Fare
    let fare_per_vehicle: number | null = null;
    if (String(r.farePerVehicle ?? '').trim()) {
      const n = parseNumber(r.farePerVehicle);
      if (n === null || Number.isNaN(n) || n < 0 || n > 9_999_999) errors.push({ field: 'farePerVehicle', message: 'Fare must be a positive amount.' });
      else fare_per_vehicle = Math.round(n * 100) / 100;
    } else warnings.push({ field: 'farePerVehicle', message: 'No fare — each trip will need its fare before billing.' });

    // Trip type
    const tt = tripTypeOf(r.tripType) ?? tripTypeOf(r.dutyType);
    if (String(r.tripType ?? '').trim() && !tripTypeOf(r.tripType)) {
      warnings.push({ field: 'tripType', message: `"${r.tripType}" is not a known trip type; treated as Local.` });
    }

    const pickup_address = text(r.pickupAddress);
    if (!pickup_address) warnings.push({ field: 'pickupAddress', message: 'No pickup — the event venue will be used.' });

    const data: NormalRequirement | null = errors.length ? null : {
      travel_date: travel_date!, reporting_time, vehicle_category_id, vehicle_type, vehicle_count,
      pickup_address, drop_address: text(r.dropAddress), duty_type: text(r.dutyType, 80),
      trip_type: tt ?? 'LOCAL', passenger_name: text(r.passengerName, 120), passenger_mobile,
      pax_count, fare_per_vehicle, remarks: text(r.remarks, 600),
    };

    if (data) {
      const key = [data.travel_date, data.reporting_time, data.vehicle_category_id, (data.pickup_address ?? '').toLowerCase()].join('|');
      const prev = seen.get(key);
      if (prev) warnings.push({ field: 'row', message: `Looks the same as row ${prev} (date, time, vehicle and pickup).` });
      else seen.set(key, idx + 1);
    }

    return {
      row: idx + 1, ok: errors.length === 0, errors, warnings, data,
      category_name: vehicle_category_id ? catById.get(vehicle_category_id)?.name ?? null : null,
    };
  });

  return {
    rows: results,
    valid: results.filter((r) => r.ok).length,
    invalid: results.filter((r) => !r.ok).length,
    vehicles: results.reduce((s, r) => s + (r.data?.vehicle_count ?? 0), 0),
  };
}
