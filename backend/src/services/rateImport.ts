/**
 * Reading a rate card out of a spreadsheet.
 *
 * Rates arrive as a workbook far more often than they arrive one row at a time
 * in a form — a new account sends its whole card as an attachment. This turns
 * that sheet into rows the Master understands, and, just as importantly, says
 * exactly what it could not read and on which line.
 *
 * Nothing here writes to the database. The caller decides whether a parse is
 * good enough to commit, which is what lets the same code power both the
 * preview and the import.
 */
import ExcelJS from 'exceljs';

/** Column headings we accept, lower-cased and stripped of anything but letters. */
const FIELDS: Record<string, string[]> = {
  vendor: ['vendor', 'vendorcode', 'vendorname', 'account', 'client'],
  vehicleCategory: ['vehicle', 'vehicleclass', 'vehiclecategory', 'category', 'car', 'cartype', 'vehicletype'],
  planType: ['plantype', 'type', 'triptype', 'ratetype'],
  planLabel: ['plan', 'planname', 'package', 'duty', 'dutytype', 'slab'],
  includedHours: ['includedhours', 'hours', 'hrs', 'inclhours'],
  includedKm: ['includedkm', 'km', 'kms', 'inclkm', 'kilometres', 'kilometers'],
  baseFare: ['basefare', 'fare', 'rate', 'amount', 'price', 'base', 'flatfare'],
  extraHourRate: ['extrahour', 'extrahourrate', 'exthr', 'perhour', 'addlhour', 'extrahr'],
  extraKmRate: ['extrakm', 'extrakmrate', 'extkm', 'addlkm'],
  perKmRate: ['perkm', 'perkmrate', 'kmrate', 'ratepkm', 'ratperkm'],
  minKmPerDay: ['minkm', 'minkmperday', 'minimumkm', 'minkmday', 'mindaykm'],
  driverAllowance: ['driverallowance', 'da', 'allowance', 'driverbata', 'bata'],
  notes: ['note', 'notes', 'remark', 'remarks', 'comment'],
  isActive: ['active', 'isactive', 'status', 'enabled'],
};

const normalise = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** ExcelJS hands back strings, numbers, formula results and rich text. Flatten them. */
function cellText(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r: any) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    if ('hyperlink' in v) return String(v.text ?? '');
    if (v instanceof Date) return v.toISOString();
  }
  return String(v).trim();
}

/** "₹2,400.00", "2400", " 2,400 " all mean the same number. */
function cellNumber(v: any): number {
  const t = cellText(v).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const PLAN_TYPES = ['LOCAL', 'AIRPORT', 'OUTSTATION'] as const;
type PlanType = (typeof PLAN_TYPES)[number];

/**
 * Work out the plan type when the sheet does not say.
 *
 * Most real rate cards have a "Duty type" column reading "8H/80KM" or "Airport
 * drop" and no separate type column at all, so guessing from the plan name is
 * the difference between an import that works and one that rejects every row.
 */
function inferPlanType(planLabel: string, row: Record<string, number>): PlanType {
  const p = planLabel.toLowerCase();
  if (/airport|transfer|pick ?up|drop|point to point|p2p/.test(p)) return 'AIRPORT';
  if (/outstation|per ?km|outside|highway|round ?trip|one ?way/.test(p)) return 'OUTSTATION';
  if (/\d+\s*h/.test(p) || /\d+\s*hr/.test(p)) return 'LOCAL';
  // Fall back to whichever number the row actually carries.
  if (row.perKmRate > 0 && row.baseFare === 0) return 'OUTSTATION';
  return 'LOCAL';
}

/** "8H/80KM", "4 hrs / 40 kms", "08H-80KM" → { hours: 8, km: 80 } */
function parseSlab(planLabel: string): { hours: number; km: number } {
  const m = planLabel.match(/(\d+(?:\.\d+)?)\s*h\w*\s*[/\-–]?\s*(\d+(?:\.\d+)?)\s*k/i);
  if (m) return { hours: parseFloat(m[1]), km: parseFloat(m[2]) };
  return { hours: 0, km: 0 };
}

export interface ParsedRate {
  rowNumber: number;
  vendorText: string;
  vehicleCategory: string;
  planType: PlanType;
  planLabel: string;
  includedHours: number;
  includedKm: number;
  baseFare: number;
  extraHourRate: number;
  extraKmRate: number;
  perKmRate: number;
  minKmPerDay: number;
  driverAllowance: number;
  notes: string;
  isActive: boolean;
}

export interface ParseResult {
  rows: ParsedRate[];
  errors: { rowNumber: number; message: string }[];
  /** Which sheet columns were recognised, so the UI can show what was mapped. */
  mapped: Record<string, string>;
  /** Headings present in the sheet that meant nothing to us. */
  ignored: string[];
  sheetName: string;
}

export async function parseRateWorkbook(filePath: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ rowNumber: 0, message: 'The workbook has no sheets.' }], mapped: {}, ignored: [], sheetName: '' };

  // --- find the header row --------------------------------------------------
  // Rate cards routinely open with a title and a blank line, so the headings
  // are rarely on row 1. Take the first row that maps at least two fields.
  let headerRow = 0;
  let columnOf: Record<string, number> = {};
  let ignored: string[] = [];

  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const map: Record<string, number> = {};
    const unknown: string[] = [];
    const row = ws.getRow(r);
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = normalise(cellText(cell.value));
      if (!key) return;
      const field = Object.keys(FIELDS).find((f) => FIELDS[f].includes(key));
      if (field && map[field] === undefined) map[field] = col;
      else if (!field) unknown.push(cellText(cell.value));
    });
    if (map.vehicleCategory !== undefined && Object.keys(map).length >= 2) {
      headerRow = r;
      columnOf = map;
      ignored = unknown;
      break;
    }
  }

  if (!headerRow) {
    return {
      rows: [],
      errors: [{
        rowNumber: 0,
        message: 'Could not find the headings. The sheet needs a row with at least a Vehicle column — download the template to see the expected layout.',
      }],
      mapped: {}, ignored: [], sheetName: ws.name,
    };
  }

  // --- read the rows --------------------------------------------------------
  const rows: ParsedRate[] = [];
  const errors: ParseResult['errors'] = [];
  const get = (row: ExcelJS.Row, field: string) =>
    columnOf[field] === undefined ? '' : cellText(row.getCell(columnOf[field]).value);
  const getNum = (row: ExcelJS.Row, field: string) =>
    columnOf[field] === undefined ? 0 : cellNumber(row.getCell(columnOf[field]).value);

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vehicle = get(row, 'vehicleCategory').trim();
    // A blank vehicle is a spacer or a total line, not an error.
    if (!vehicle) continue;
    if (/^(total|grand total|sub ?total)$/i.test(vehicle)) continue;

    const planLabel = (get(row, 'planLabel') || '').trim();
    const numbers = {
      baseFare: getNum(row, 'baseFare'),
      perKmRate: getNum(row, 'perKmRate'),
    };

    const declared = normalise(get(row, 'planType')).toUpperCase();
    const planType: PlanType =
      (PLAN_TYPES as readonly string[]).includes(declared)
        ? (declared as PlanType)
        : inferPlanType(planLabel || declared, numbers as any);

    if (!planLabel) {
      errors.push({ rowNumber: r, message: `${vehicle}: no plan name. Add one, e.g. 8H/80KM or Airport transfer.` });
      continue;
    }

    // Hours and km are usually already in the plan name; only fall back to it.
    const slab = parseSlab(planLabel);
    const includedHours = getNum(row, 'includedHours') || slab.hours;
    const includedKm = getNum(row, 'includedKm') || slab.km;

    const parsed: ParsedRate = {
      rowNumber: r,
      vendorText: get(row, 'vendor').trim(),
      vehicleCategory: vehicle,
      planType,
      planLabel,
      includedHours: planType === 'LOCAL' ? includedHours : 0,
      includedKm: planType === 'LOCAL' ? includedKm : 0,
      baseFare: numbers.baseFare,
      extraHourRate: getNum(row, 'extraHourRate'),
      extraKmRate: getNum(row, 'extraKmRate'),
      perKmRate: numbers.perKmRate,
      minKmPerDay: getNum(row, 'minKmPerDay'),
      driverAllowance: getNum(row, 'driverAllowance'),
      notes: get(row, 'notes').slice(0, 300),
      isActive: !/^(no|inactive|0|false|disabled)$/i.test(get(row, 'isActive').trim() || 'yes'),
    };

    if (parsed.planType === 'OUTSTATION' && parsed.perKmRate <= 0) {
      errors.push({ rowNumber: r, message: `${vehicle} — ${planLabel}: an outstation rate needs a per-km rate.` });
      continue;
    }
    if (parsed.planType !== 'OUTSTATION' && parsed.baseFare <= 0) {
      errors.push({ rowNumber: r, message: `${vehicle} — ${planLabel}: no fare found in this row.` });
      continue;
    }

    rows.push(parsed);
  }

  if (!rows.length && !errors.length) {
    errors.push({ rowNumber: 0, message: 'The headings were read, but there were no rate rows underneath them.' });
  }

  const mapped: Record<string, string> = {};
  for (const [field, col] of Object.entries(columnOf)) {
    mapped[field] = cellText(ws.getRow(headerRow).getCell(col).value);
  }

  return { rows, errors, mapped, ignored, sheetName: ws.name };
}

/** The headings the template writes, in order. */
export const TEMPLATE_COLUMNS: { header: string; key: string; width: number; help: string }[] = [
  { header: 'Vendor Code', key: 'vendor', width: 16, help: 'DIRECT for website rates, or the vendor code' },
  { header: 'Vehicle', key: 'vehicleCategory', width: 24, help: 'Dzire, Hyundai Aura, Ertiga, Toyota Innova Crysta…' },
  { header: 'Plan Type', key: 'planType', width: 14, help: 'LOCAL, AIRPORT or OUTSTATION' },
  { header: 'Plan', key: 'planLabel', width: 20, help: '8H/80KM, Airport transfer, Per km' },
  { header: 'Included Hours', key: 'includedHours', width: 15, help: 'Local only — read from the plan name if blank' },
  { header: 'Included KM', key: 'includedKm', width: 14, help: 'Local only — read from the plan name if blank' },
  { header: 'Base Fare', key: 'baseFare', width: 13, help: 'Local and airport' },
  { header: 'Extra Hour', key: 'extraHourRate', width: 13, help: 'Local only' },
  { header: 'Extra KM', key: 'extraKmRate', width: 12, help: 'Local only' },
  { header: 'Per KM', key: 'perKmRate', width: 11, help: 'Outstation only' },
  { header: 'Min KM/Day', key: 'minKmPerDay', width: 13, help: 'Outstation only' },
  { header: 'Driver Allowance', key: 'driverAllowance', width: 17, help: 'Outstation, per night away' },
  { header: 'Notes', key: 'notes', width: 30, help: 'Optional' },
  { header: 'Active', key: 'isActive', width: 9, help: 'Yes or No' },
];
