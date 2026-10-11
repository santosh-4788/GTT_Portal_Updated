/**
 * One way to hand a table to Excel, for every screen in the portal.
 *
 * Each list's export calls `sendTable` with the rows it already filtered for
 * the screen, so what is downloaded is always what was on screen. The rules
 * that make an export trustworthy live here once:
 *
 *  - identifiers (Trip IDs, invoice numbers, mobiles, GSTINs) are written as
 *    TEXT, so Excel never drops a leading zero or turns a number into 9.97E+09
 *  - money is a real number with a two-decimal Indian format, so it sums
 *  - dates are real dates (dd-mmm-yyyy), not strings that sort wrongly
 *  - the header row is frozen and filterable
 *
 * CSV is offered for the cases where a plain data file is all that is needed.
 */
import type { Response } from 'express';
import ExcelJS from 'exceljs';

export type ColumnKind = 'text' | 'id' | 'money' | 'number' | 'date' | 'datetime' | 'percent';

export interface ExportColumn {
  key: string;
  header: string;
  kind?: ColumnKind;
  width?: number;
  /** Derive the cell from the row instead of reading `key`. */
  value?: (row: any) => unknown;
}

export interface ExportSheet {
  name: string;
  title?: string;
  columns: ExportColumn[];
  rows: any[];
  /** Lines printed under the title, e.g. the filters that were applied. */
  notes?: string[];
  /** Sum these money/number columns in a totals row. */
  totals?: string[];
}

const BRAND = 'FF1B3A60';
const LINE = 'FFD5DEE5';

const MONEY_KEY = /amount|total|taxable|^tax$|_tax$|paid|outstanding|balance|fare|cost|parking|toll|charge|payable|received|revenue|value/i;

/** Guess a kind from the column key when the caller did not say. */
function kindOf(c: ExportColumn): ColumnKind {
  if (c.kind) return c.kind;
  if (/(_|^)(date|on)$|_date$|^date$|expiry|^due/.test(c.key)) return 'date';
  if (/_at$/.test(c.key)) return 'datetime';
  if (/mobile|phone|gstin|gst_number|pan|number$|_no$|^code$|_code$|trip_id|reference|ifsc|pincode/i.test(c.key)) return 'id';
  if (MONEY_KEY.test(c.key)) return 'money';
  return 'text';
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const s = String(v);
  // SQLite datetime('now') is UTC without a zone marker.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T00:00:00`)
    : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function cellValue(c: ExportColumn, row: any): unknown {
  const raw = c.value ? c.value(row) : row[c.key];
  const kind = kindOf(c);
  if (raw == null || raw === '') return null;
  switch (kind) {
    case 'money':
    case 'number':
    case 'percent': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : String(raw);
    }
    case 'date':
    case 'datetime':
      return toDate(raw) ?? String(raw);
    case 'id':
      return String(raw);
    default:
      return typeof raw === 'number' ? raw : String(raw);
  }
}

const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

export async function buildWorkbook(sheets: ExportSheet[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gupta Tours & Travels';
  wb.created = new Date();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    const cols = sheet.columns;
    let r = 1;

    if (sheet.title) {
      ws.mergeCells(r, 1, r, Math.max(1, cols.length));
      const t = ws.getCell(r, 1);
      t.value = `Gupta Tours & Travels — ${sheet.title}`;
      t.font = { bold: true, size: 13, color: { argb: BRAND } };
      r++;
      const notes = [
        ...(sheet.notes ?? []),
        `Generated ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} · ${sheet.rows.length} row(s)`,
      ];
      for (const n of notes) {
        ws.mergeCells(r, 1, r, Math.max(1, cols.length));
        const c = ws.getCell(r, 1);
        c.value = n;
        c.font = { size: 9, italic: true, color: { argb: 'FF5B6E84' } };
        r++;
      }
      r++;
    }

    const headerRowNo = r;
    const header = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = header.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      const kind = kindOf(c);
      ws.getColumn(i + 1).width = c.width
        ?? (kind === 'money' ? 14 : kind === 'date' ? 13 : kind === 'datetime' ? 18 : kind === 'id' ? 18 : 22);
    });
    header.height = 20;
    header.commit();
    r++;

    for (const row of sheet.rows) {
      const xr = ws.getRow(r);
      cols.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        const kind = kindOf(c);
        cell.value = cellValue(c, row) as any;
        if (kind === 'money') cell.numFmt = '#,##,##0.00';
        else if (kind === 'percent') cell.numFmt = '0.0"%"';
        else if (kind === 'date') cell.numFmt = 'dd-mmm-yyyy';
        else if (kind === 'datetime') cell.numFmt = 'dd-mmm-yyyy hh:mm';
        else if (kind === 'id') cell.numFmt = '@';
        cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
      });
      xr.commit();
      r++;
    }

    if (sheet.totals?.length && sheet.rows.length) {
      const tr = ws.getRow(r);
      tr.getCell(1).value = 'Total';
      cols.forEach((c, i) => {
        if (!sheet.totals!.includes(c.key)) return;
        const letter = ws.getColumn(i + 1).letter;
        const cell = tr.getCell(i + 1);
        const sum = sheet.rows.reduce((s, row) => s + (Number(c.value ? c.value(row) : row[c.key]) || 0), 0);
        cell.value = { formula: `SUM(${letter}${headerRowNo + 1}:${letter}${r - 1})`, result: Math.round(sum * 100) / 100 };
        cell.numFmt = kindOf(c) === 'money' ? '#,##,##0.00' : '0';
      });
      tr.font = { bold: true };
      tr.eachCell((cell) => { cell.border = { top: { style: 'thin', color: { argb: BRAND } } }; });
      tr.commit();
    }

    ws.views = [{ state: 'frozen', ySplit: headerRowNo }];
    if (cols.length) {
      ws.autoFilter = { from: { row: headerRowNo, column: 1 }, to: { row: headerRowNo, column: cols.length } };
    }
  }
  return wb;
}

function csvOf(sheet: ExportSheet): string {
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    sheet.columns.map((c) => esc(c.header)).join(','),
    ...sheet.rows.map((row) => sheet.columns.map((c) => {
      const raw = c.value ? c.value(row) : row[c.key];
      // A leading apostrophe-free CSV cannot protect a leading zero in Excel;
      // ids are wrapped as ="..." so Excel opens them as text.
      if (kindOf(c) === 'id' && raw != null && /^0\d+$/.test(String(raw))) return `="${raw}"`;
      return esc(raw);
    }).join(',')),
  ];
  return '﻿' + lines.join('\r\n');
}

/**
 * Send one table (or several, as tabs of one workbook).
 *
 * `format` is read from the request by the caller — 'csv' gives the first
 * sheet as CSV, anything else is .xlsx.
 */
export async function sendTable(
  res: Response,
  fileBase: string,
  sheets: ExportSheet | ExportSheet[],
  format: string = 'xlsx'
): Promise<void> {
  const list = Array.isArray(sheets) ? sheets : [sheets];
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${fileSafe(fileBase)}_${stamp}`;

  if (String(format).toLowerCase() === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
    res.send(csvOf(list[0]));
    return;
  }

  const wb = await buildWorkbook(list);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/** "From 01-Oct-2026 to 31-Oct-2026 · Vendor: Wagon" — the filters, as a line. */
export function filterNote(parts: Record<string, unknown>): string {
  const bits = Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== 0)
    .map(([k, v]) => `${k}: ${v}`);
  return bits.length ? `Filters — ${bits.join(' · ')}` : 'Filters — none (all records)';
}
