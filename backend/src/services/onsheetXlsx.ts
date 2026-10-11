/**
 * OnSheet <-> Excel / CSV.
 *
 * The browser keeps a workbook as Univer's own JSON snapshot (IWorkbookData).
 * Univer's xlsx import/export is a paid add-on, so the conversion lives here,
 * on the server, with exceljs.
 *
 * The rule for imports: nothing is dropped silently. Anything an .xlsx carries
 * that the snapshot cannot hold (charts, pictures, pivot tables, comments,
 * validation rules, macros...) is listed in `warnings`, naming the sheet it came
 * from, so the person importing knows exactly what did not come across.
 *
 * Only the parts of the Univer types this file needs are declared below. They
 * mirror @univerjs/core 1.0.2 (sheets/typedef.d.ts, interfaces/i-style-data.d.ts)
 * — the backend deliberately does not depend on the frontend packages.
 */
import ExcelJS from 'exceljs';
import crypto from 'crypto';

/* ==========================================================================
   Snapshot shape (subset of Univer's IWorkbookData)
   ========================================================================== */

export interface ColorStyle { rgb?: string | null; th?: number }
export interface BorderSide { s: number; cl?: ColorStyle }
export interface StyleData {
  ff?: string | null;
  fs?: number;
  it?: 0 | 1;
  bl?: 0 | 1;
  ul?: { s: 0 | 1; cl?: ColorStyle };
  st?: { s: 0 | 1; cl?: ColorStyle };
  bg?: ColorStyle | null;
  cl?: ColorStyle | null;
  bd?: { t?: BorderSide | null; r?: BorderSide | null; b?: BorderSide | null; l?: BorderSide | null; [k: string]: BorderSide | null | undefined } | null;
  n?: { pattern: string } | null;
  ht?: number | null;
  vt?: number | null;
  tb?: number | null;
  tr?: { a: number; v?: 0 | 1 } | null;
  [k: string]: unknown;
}
export interface CellData {
  v?: string | number | boolean | null;
  t?: number | null;
  f?: string | null;
  si?: string | null;
  s?: StyleData | string | null;
  p?: any;
  [k: string]: unknown;
}
export interface RangeData { startRow: number; endRow: number; startColumn: number; endColumn: number; [k: string]: unknown }
export interface SheetData {
  id: string;
  name: string;
  tabColor?: string;
  hidden?: number;
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number };
  rowCount?: number;
  columnCount?: number;
  zoomRatio?: number;
  scrollTop?: number;
  scrollLeft?: number;
  defaultColumnWidth?: number;
  defaultRowHeight?: number;
  mergeData?: RangeData[];
  cellData?: Record<string, Record<string, CellData>>;
  rowData?: Record<string, { h?: number; hd?: number; ia?: number; s?: StyleData | string | null }>;
  columnData?: Record<string, { w?: number; hd?: number; s?: StyleData | string | null }>;
  showGridlines?: number;
  rowHeader?: { width: number; hidden?: number };
  columnHeader?: { height: number; hidden?: number };
  rightToLeft?: number;
  [k: string]: unknown;
}
export interface WorkbookSnapshot {
  id: string;
  name: string;
  appVersion?: string;
  locale?: string;
  styles: Record<string, StyleData | null>;
  sheetOrder: string[];
  sheets: Record<string, SheetData>;
  resources?: { name: string; data: string }[];
  [k: string]: unknown;
}

/* Univer enum values used below (from @univerjs/core). */
const CT = { STRING: 1, NUMBER: 2, BOOLEAN: 3, FORCE_STRING: 4 } as const;
const H_ALIGN: Record<string, number> = { left: 1, center: 2, right: 3, justify: 4, distributed: 6, centerContinuous: 2, fill: 1 };
const H_ALIGN_BACK: Record<number, ExcelJS.Alignment['horizontal']> = { 1: 'left', 2: 'center', 3: 'right', 4: 'justify', 5: 'justify', 6: 'distributed' };
const V_ALIGN: Record<string, number> = { top: 1, middle: 2, bottom: 3, justify: 2, distributed: 2 };
const V_ALIGN_BACK: Record<number, ExcelJS.Alignment['vertical']> = { 1: 'top', 2: 'middle', 3: 'bottom' };
const WRAP = 3;
const BORDER_IN: Record<string, number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7, medium: 8,
  mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11, slantDashDot: 12, thick: 13,
};
const BORDER_OUT: Record<number, ExcelJS.BorderStyle> = Object.fromEntries(
  Object.entries(BORDER_IN).map(([k, v]) => [v, k as ExcelJS.BorderStyle])
) as Record<number, ExcelJS.BorderStyle>;

/** Univer's defaults (px). */
export const DEFAULT_COL_WIDTH = 88;
export const DEFAULT_ROW_HEIGHT = 24;
export const MIN_ROWS = 1000;
export const MIN_COLS = 26;
/** Excel's own hard limits. */
const XL_MAX_ROWS = 1_048_576;
const XL_MAX_COLS = 16_384;

/* ==========================================================================
   Small helpers
   ========================================================================== */

export const newSheetId = () => 'sh_' + crypto.randomBytes(5).toString('hex');

/** Excel character width -> pixels, and back (Calibri 11, the Excel default). */
const charsToPx = (w: number) => Math.max(4, Math.round(w * 7 + 5));
const pxToChars = (px: number) => Math.max(0.5, Math.round(((px - 5) / 7) * 100) / 100);
/** Points -> pixels at 96 dpi, and back. */
const ptToPx = (pt: number) => Math.max(4, Math.round((pt * 4) / 3));
const pxToPt = (px: number) => Math.round(px * 0.75 * 100) / 100;

/** Excel's default Office theme, by theme index (lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink). */
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
/** The legacy 64-colour palette, for `indexed` colours. Only the common part. */
const INDEXED = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

function applyTint(hex: string, tint?: number): string {
  if (!tint) return hex;
  const ch = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = ch.map((c) => Math.round(tint > 0 ? c + (255 - c) * tint : c * (1 + tint)));
  return out.map((c) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** exceljs colour -> '#RRGGBB' (or null when there is none / it is "automatic"). */
function colorIn(c: Partial<ExcelJS.Color> & { indexed?: number; tint?: number } | undefined): string | null {
  if (!c) return null;
  let hex: string | null = null;
  if (typeof c.argb === 'string' && /^[0-9a-f]{6,8}$/i.test(c.argb)) hex = c.argb.slice(-6).toUpperCase();
  else if (typeof c.theme === 'number' && THEME[c.theme]) hex = THEME[c.theme];
  else if (typeof c.indexed === 'number' && INDEXED[c.indexed]) hex = INDEXED[c.indexed];
  if (!hex) return null;
  return '#' + applyTint(hex, c.tint);
}

/** Univer colour -> exceljs ARGB. Accepts #RGB, #RRGGBB, rgb()/rgba(). */
function colorOut(c: ColorStyle | null | undefined): Partial<ExcelJS.Color> | undefined {
  const rgb = c?.rgb?.trim();
  if (!rgb) return undefined;
  let m = rgb.match(/^#?([0-9a-f]{6})$/i);
  if (m) return { argb: 'FF' + m[1].toUpperCase() };
  m = rgb.match(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (m) return { argb: ('FF' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase() };
  m = rgb.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return { argb: 'FF' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('').toUpperCase() };
  return undefined;
}

/** 0-based column index -> letters. */
export function colLetter(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function letterToCol(l: string): number {
  let n = 0;
  for (const ch of l.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Move every relative A1 reference in a formula by (dr, dc).
 *
 * Used for Univer's shared formulas: after a fill-down only the first cell
 * carries the formula text; the rest point at it through `si` and are
 * understood to be "the same formula, moved". Excel needs each one written out.
 * Text in double quotes and quoted sheet names are left untouched; $-anchored
 * parts do not move; a reference pushed off the sheet becomes #REF!.
 */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!dr && !dc) return formula;
  const re = /(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(])/g;
  const shiftPlain = (seg: string) =>
    seg.replace(re, (all, cAbs: string, col: string, rAbs: string, row: string) => {
      let c = letterToCol(col);
      let r = Number(row) - 1;
      if (c >= XL_MAX_COLS) return all; // not a cell reference (e.g. a name like ABCD1)
      if (!cAbs) c += dc;
      if (!rAbs) r += dr;
      if (c < 0 || r < 0 || c >= XL_MAX_COLS || r >= XL_MAX_ROWS) return '#REF!';
      return `${cAbs}${colLetter(c)}${rAbs}${r + 1}`;
    });

  let out = '';
  let buf = '';
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"' || ch === "'") {
      out += shiftPlain(buf);
      buf = '';
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === ch) {
          if (formula[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j++;
      }
      out += formula.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    buf += ch;
    i++;
  }
  return out + shiftPlain(buf);
}

/** Plain text out of a Univer rich-text cell (`p`). */
function richTextOfP(p: any): string | null {
  const ds = p?.body?.dataStream;
  if (typeof ds !== 'string') return null;
  return ds.replace(/\r\n$/, '').replace(/\r\n?/g, '\n');
}

/** Excel serial date (1900 system) <-> JS Date (exceljs gives dates as UTC). */
const dateToSerial = (d: Date) => d.getTime() / 86_400_000 + 25_569;
const serialToDate = (n: number) => new Date(Math.round((n - 25_569) * 86_400_000));

const isErrorString = (s: string) => /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|GETTING_DATA|SPILL!|CALC!)$/.test(s);

/* ==========================================================================
   Blank workbook + validation
   ========================================================================== */

export function blankSheet(name = 'Sheet1', id = newSheetId()): SheetData {
  return {
    id,
    name,
    tabColor: '',
    hidden: 0,
    rowCount: MIN_ROWS,
    columnCount: MIN_COLS,
    zoomRatio: 1,
    freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
    scrollTop: 0,
    scrollLeft: 0,
    defaultColumnWidth: DEFAULT_COL_WIDTH,
    defaultRowHeight: DEFAULT_ROW_HEIGHT,
    mergeData: [],
    cellData: {},
    rowData: {},
    columnData: {},
    showGridlines: 1,
    rowHeader: { width: 46, hidden: 0 },
    columnHeader: { height: 20, hidden: 0 },
    rightToLeft: 0,
  };
}

export function blankWorkbook(id: string, name: string): WorkbookSnapshot {
  const sheet = blankSheet('Sheet1');
  return {
    id,
    name,
    appVersion: '1.0.2',
    locale: 'enUS',
    styles: {},
    sheetOrder: [sheet.id],
    sheets: { [sheet.id]: sheet },
    resources: [],
  };
}

export const MAX_SHEETS = 200;

/**
 * Is this something the editor can open? Returns an error message, or null.
 * Shape only — the cell contents themselves are Univer's business.
 */
export function validateSnapshot(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'The workbook data is missing or not an object.';
  const d = data as Partial<WorkbookSnapshot>;
  if (!Array.isArray(d.sheetOrder) || !d.sheetOrder.length) return 'The workbook has no sheets (sheetOrder is empty).';
  if (!d.sheets || typeof d.sheets !== 'object' || Array.isArray(d.sheets)) return 'The workbook has no sheets object.';
  if (d.sheetOrder.length > MAX_SHEETS) return `A workbook can have at most ${MAX_SHEETS} sheets.`;
  const seen = new Set<string>();
  for (const sid of d.sheetOrder) {
    if (typeof sid !== 'string' || !sid) return 'A sheet id in sheetOrder is not a string.';
    if (seen.has(sid)) return `Sheet id "${sid}" appears twice in sheetOrder.`;
    seen.add(sid);
    const s = d.sheets[sid];
    if (!s || typeof s !== 'object') return `Sheet "${sid}" is listed in sheetOrder but has no data.`;
    if (s.cellData != null && (typeof s.cellData !== 'object' || Array.isArray(s.cellData))) return `Sheet "${s.name ?? sid}" has malformed cell data.`;
  }
  if (Object.keys(d.sheets).length > MAX_SHEETS) return `A workbook can have at most ${MAX_SHEETS} sheets.`;
  if (d.styles != null && (typeof d.styles !== 'object' || Array.isArray(d.styles))) return 'The workbook styles are malformed.';
  return null;
}

/* ==========================================================================
   Styles
   ========================================================================== */

function styleFromExcel(st: Partial<ExcelJS.Style> | undefined): StyleData | null {
  if (!st) return null;
  const out: StyleData = {};
  const f = st.font;
  if (f) {
    if (f.bold) out.bl = 1;
    if (f.italic) out.it = 1;
    if (f.underline && f.underline !== 'none') out.ul = { s: 1 };
    if (f.strike) out.st = { s: 1 };
    if (typeof f.size === 'number' && f.size !== 11) out.fs = f.size;
    if (f.name && f.name !== 'Calibri') out.ff = f.name;
    const c = colorIn(f.color as any);
    if (c && c !== '#000000') out.cl = { rgb: c };
  }
  const fill = st.fill as ExcelJS.FillPattern | ExcelJS.FillGradientAngle | undefined;
  if (fill) {
    if (fill.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
      const c = colorIn((fill.fgColor ?? fill.bgColor) as any);
      if (c) out.bg = { rgb: c };
    } else if (fill.type === 'gradient' && (fill as any).stops?.length) {
      const c = colorIn((fill as any).stops[0].color);
      if (c) out.bg = { rgb: c };
    }
  }
  const b = st.border;
  if (b) {
    const bd: NonNullable<StyleData['bd']> = {};
    const side = (x: Partial<ExcelJS.Border> | undefined): BorderSide | null => {
      if (!x?.style) return null;
      return { s: BORDER_IN[x.style] ?? 1, cl: { rgb: colorIn(x.color as any) ?? '#000000' } };
    };
    const t = side(b.top), r = side(b.right), bo = side(b.bottom), l = side(b.left);
    if (t) bd.t = t;
    if (r) bd.r = r;
    if (bo) bd.b = bo;
    if (l) bd.l = l;
    if (b.diagonal?.style) {
      const d = side(b.diagonal as any);
      if (b.diagonal.down) bd.tl_br = d;
      if (b.diagonal.up) bd.bl_tr = d;
    }
    if (Object.keys(bd).length) out.bd = bd;
  }
  const a = st.alignment;
  if (a) {
    if (a.horizontal && H_ALIGN[a.horizontal]) out.ht = H_ALIGN[a.horizontal];
    if (a.vertical && V_ALIGN[a.vertical]) out.vt = V_ALIGN[a.vertical];
    if (a.wrapText) out.tb = WRAP;
    if (typeof a.textRotation === 'number' && a.textRotation) out.tr = { a: a.textRotation, v: 0 };
    else if (a.textRotation === 'vertical') out.tr = { a: 0, v: 1 };
  }
  if (st.numFmt && st.numFmt !== 'General') {
    // Built-in format 14 is "short date in the reader's locale"; exceljs names
    // it mm-dd-yy, which reads as American. Use an unambiguous date instead.
    out.n = { pattern: st.numFmt === 'mm-dd-yy' ? 'yyyy-mm-dd' : st.numFmt };
  }
  return Object.keys(out).length ? out : null;
}

function styleToExcel(s: StyleData | null | undefined): Partial<ExcelJS.Style> | null {
  if (!s || typeof s !== 'object') return null;
  const out: Partial<ExcelJS.Style> = {};
  const font: Partial<ExcelJS.Font> = {};
  if (s.bl) font.bold = true;
  if (s.it) font.italic = true;
  if (s.ul?.s) font.underline = true;
  if (s.st?.s) font.strike = true;
  if (typeof s.fs === 'number' && s.fs > 0) font.size = s.fs;
  if (s.ff) font.name = String(s.ff);
  const fc = colorOut(s.cl);
  if (fc) font.color = fc as ExcelJS.Color;
  if (Object.keys(font).length) out.font = font as ExcelJS.Font;

  const bg = colorOut(s.bg);
  if (bg) out.fill = { type: 'pattern', pattern: 'solid', fgColor: bg as ExcelJS.Color, bgColor: bg as ExcelJS.Color };

  if (s.bd) {
    const side = (x: BorderSide | null | undefined): Partial<ExcelJS.Border> | undefined => {
      if (!x || !x.s) return undefined;
      return { style: BORDER_OUT[x.s] ?? 'thin', color: (colorOut(x.cl) ?? { argb: 'FF000000' }) as ExcelJS.Color };
    };
    const border: Partial<ExcelJS.Borders> = {};
    const t = side(s.bd.t), r = side(s.bd.r), b = side(s.bd.b), l = side(s.bd.l);
    if (t) border.top = t;
    if (r) border.right = r;
    if (b) border.bottom = b;
    if (l) border.left = l;
    const down = side(s.bd.tl_br), up = side(s.bd.bl_tr);
    if (down || up) border.diagonal = { ...(down ?? up), up: !!up, down: !!down } as ExcelJS.BorderDiagonal;
    if (Object.keys(border).length) out.border = border as ExcelJS.Borders;
  }

  const al: Partial<ExcelJS.Alignment> = {};
  if (s.ht && H_ALIGN_BACK[s.ht]) al.horizontal = H_ALIGN_BACK[s.ht];
  if (s.vt && V_ALIGN_BACK[s.vt]) al.vertical = V_ALIGN_BACK[s.vt];
  if (s.tb === WRAP) al.wrapText = true;
  if (s.tr?.v) al.textRotation = 'vertical';
  else if (s.tr?.a) al.textRotation = Math.max(-90, Math.min(90, Number(s.tr.a) || 0));
  if (Object.keys(al).length) out.alignment = al as ExcelJS.Alignment;

  if (s.n?.pattern) out.numFmt = String(s.n.pattern);
  return Object.keys(out).length ? out : null;
}

/** A cell / row / column style may be an id into workbook.styles or inline. */
function resolveStyle(styles: Record<string, StyleData | null> | undefined, s: unknown): StyleData | null {
  if (!s) return null;
  if (typeof s === 'string') return (styles?.[s] as StyleData) ?? null;
  if (typeof s === 'object') return s as StyleData;
  return null;
}

/* ==========================================================================
   xlsx -> snapshot
   ========================================================================== */

/** Inventory of the package parts exceljs does not read. */
async function scanPackage(buf: Buffer): Promise<string[]> {
  const warnings: string[] = [];
  let JSZip: any;
  try {
    // exceljs ships jszip; it is used here only to list the parts of the file.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    JSZip = require('jszip');
  } catch {
    return ['Could not inspect the file for charts, pictures and pivot tables. If it has any, they were not imported.'];
  }
  let zip: any;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return [];
  }
  const files: string[] = Object.keys(zip.files);
  const read = async (p: string): Promise<string> => {
    const f = zip.file(p);
    return f ? String(await f.async('string')) : '';
  };
  const rels = async (part: string): Promise<{ type: string; target: string }[]> => {
    const dir = part.slice(0, part.lastIndexOf('/'));
    const base = part.slice(part.lastIndexOf('/') + 1);
    const xml = await read(`${dir}/_rels/${base}.rels`);
    const out: { type: string; target: string }[] = [];
    for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1];
      const type = /Type="([^"]*)"/.exec(attrs)?.[1] ?? '';
      const target = /Target="([^"]*)"/.exec(attrs)?.[1] ?? '';
      if (/TargetMode="External"/.test(attrs)) { out.push({ type, target: '' }); continue; }
      out.push({ type, target: resolvePath(dir, target) });
    }
    return out;
  };
  const resolvePath = (dir: string, target: string) => {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (dir + '/' + target).split('/');
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '..') stack.pop();
      else if (p && p !== '.') stack.push(p);
    }
    return stack.join('/');
  };

  const wbXml = await read('xl/workbook.xml');
  const wbRels = await rels('xl/workbook.xml');
  const relById = new Map<string, string>();
  {
    const xml = await read('xl/_rels/workbook.xml.rels');
    for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = /Id="([^"]*)"/.exec(m[1])?.[1];
      const target = /Target="([^"]*)"/.exec(m[1])?.[1];
      if (id && target) relById.set(id, resolvePath('xl', target));
    }
  }
  void wbRels;

  for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const attrs = m[1];
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] ?? '?');
    const rid = /r:id="([^"]*)"/.exec(attrs)?.[1] ?? /\bid="([^"]*)"/.exec(attrs)?.[1] ?? '';
    const part = relById.get(rid);
    if (!part) continue;
    if (part.includes('chartsheets/')) {
      warnings.push(`Sheet "${name}" is a chart sheet. Charts are not supported, so this sheet was not imported.`);
      continue;
    }
    if (part.includes('dialogsheets/') || part.includes('macrosheets/')) {
      warnings.push(`Sheet "${name}" is a macro/dialog sheet and was not imported.`);
      continue;
    }
    const sheetRels = await rels(part);
    let charts = 0, pictures = 0, shapes = 0, pivots = 0, tables = 0, controls = 0, comments = 0;
    for (const r of sheetRels) {
      if (r.type.endsWith('/drawing') && r.target) {
        const dRels = await rels(r.target);
        charts += dRels.filter((x) => x.type.endsWith('/chart')).length;
        pictures += dRels.filter((x) => x.type.endsWith('/image')).length;
        const dXml = await read(r.target);
        shapes += (dXml.match(/<xdr:sp\b/g) ?? []).length;
      } else if (r.type.endsWith('/comments') && r.target) {
        comments += ((await read(r.target)).match(/<comment[\s>]/g) ?? []).length;
      } else if (r.type.endsWith('/pivotTable')) pivots++;
      else if (r.type.endsWith('/table')) tables++;
      else if (r.type.endsWith('/ctrlProp')) controls++;
    }
    const sheetXml = await read(part);
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (comments) warnings.push(`Sheet "${name}": ${plural(comments, 'comment')}/notes not imported.`);
    if (charts) warnings.push(`Sheet "${name}": ${plural(charts, 'chart')} not imported (charts are not supported).`);
    if (pictures) warnings.push(`Sheet "${name}": ${plural(pictures, 'picture')} not imported.`);
    if (shapes) warnings.push(`Sheet "${name}": ${plural(shapes, 'shape/text box')} not imported.`);
    if (pivots) warnings.push(`Sheet "${name}": ${plural(pivots, 'pivot table')} imported as plain values only (pivot tables are not supported and will not refresh).`);
    if (tables) warnings.push(`Sheet "${name}": ${plural(tables, 'Excel table')} imported as plain cells (table styling, banding and structured references are not kept).`);
    if (controls) warnings.push(`Sheet "${name}": ${plural(controls, 'form control')} (buttons, check boxes) not imported.`);
    if (/<x14:sparklineGroup\b/.test(sheetXml)) warnings.push(`Sheet "${name}": sparklines not imported.`);
    if (/<x14:slicerList\b|<x14:slicer\b/.test(sheetXml)) warnings.push(`Sheet "${name}": slicers not imported.`);
  }

  if (files.some((f) => /vbaProject\.bin$/i.test(f))) warnings.push('The file contains macros (VBA). Macros are not supported and were not imported.');
  if (files.some((f) => f.startsWith('xl/externalLinks/'))) warnings.push('The file links to other workbooks. Formulas that refer to another file keep their last calculated value but will not update.');
  if (files.some((f) => f.startsWith('xl/slicerCaches/') || f.startsWith('xl/timelineCaches/'))) {
    if (!warnings.some((w) => w.includes('slicers'))) warnings.push('Slicers / timelines in the file were not imported.');
  }
  if (files.some((f) => f.startsWith('xl/connections') || f.startsWith('xl/queryTables/'))) warnings.push('Data connections / queries in the file were not imported; their last values are kept.');
  return warnings;
}

function decodeXml(s: string) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** A cell's value from exceljs, as a Univer cell (no style). */
function cellValueIn(
  cell: ExcelJS.Cell,
  counters: { richText: number; hyperlinks: number; arrayFormulas: number; unresolved: number },
): CellData | null {
  const v: any = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { v, t: CT.NUMBER } : { v: '#NUM!', t: CT.STRING };
  if (typeof v === 'string') {
    // Text that looks like a number stays text (leading zeros, phone numbers).
    const looksNumeric = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v.trim());
    return { v, t: looksNumeric ? CT.FORCE_STRING : CT.STRING };
  }
  if (typeof v === 'boolean') return { v: v ? 'TRUE' : 'FALSE', t: CT.BOOLEAN };
  if (v instanceof Date) return { v: dateToSerial(v), t: CT.NUMBER };
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      counters.richText++;
      return { v: v.richText.map((r: any) => r?.text ?? '').join(''), t: CT.STRING };
    }
    if ('error' in v) return { v: String(v.error), t: CT.STRING };
    if ('formula' in v || 'sharedFormula' in v) {
      let formula = '';
      try { formula = cell.formula || ''; } catch { formula = ''; }
      if ((v as any).shareType === 'array') counters.arrayFormulas++;
      const res = (v as any).result;
      const out: CellData = {};
      if (formula) out.f = '=' + formula.replace(/^=/, '');
      else counters.unresolved++;
      if (res !== undefined && res !== null) {
        if (typeof res === 'number') { out.v = res; out.t = CT.NUMBER; }
        else if (typeof res === 'boolean') { out.v = res ? 'TRUE' : 'FALSE'; out.t = CT.BOOLEAN; }
        else if (res instanceof Date) { out.v = dateToSerial(res); out.t = CT.NUMBER; }
        else if (typeof res === 'object' && 'error' in res) { out.v = String(res.error); out.t = CT.STRING; }
        else { out.v = String(res); out.t = CT.STRING; }
      }
      return out.f || out.v !== undefined ? out : null;
    }
    if ('hyperlink' in v || 'text' in v) {
      counters.hyperlinks++;
      const text = typeof v.text === 'string' ? v.text : Array.isArray(v.text?.richText) ? v.text.richText.map((r: any) => r.text).join('') : String(v.hyperlink ?? '');
      return { v: text, t: CT.STRING };
    }
  }
  return { v: String(v), t: CT.STRING };
}

export interface ImportResult { snapshot: WorkbookSnapshot; warnings: string[] }

export async function xlsxToSnapshot(buf: Buffer, id: string, name: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);

  const warnings = await scanPackage(buf);
  const styles: Record<string, StyleData> = {};
  const styleIds = new Map<string, string>();
  const styleId = (st: StyleData | null): string | undefined => {
    if (!st) return undefined;
    const key = JSON.stringify(st);
    let sid = styleIds.get(key);
    if (!sid) {
      sid = 's' + (styleIds.size + 1);
      styleIds.set(key, sid);
      styles[sid] = st;
    }
    return sid;
  };

  const snapshot: WorkbookSnapshot = { id, name, appVersion: '1.0.2', locale: 'enUS', styles, sheetOrder: [], sheets: {}, resources: [] };
  const usedNames = new Set<string>();

  const worksheets = wb.worksheets;
  if (worksheets.length > MAX_SHEETS) {
    warnings.push(`The file has ${worksheets.length} sheets; only the first ${MAX_SHEETS} were imported.`);
  }

  for (const ws of worksheets.slice(0, MAX_SHEETS)) {
    const sheet = blankSheet(ws.name);
    let nm = ws.name || 'Sheet';
    while (usedNames.has(nm.toLowerCase())) nm = nm + ' (2)';
    usedNames.add(nm.toLowerCase());
    sheet.name = nm;
    const label = `Sheet "${nm}"`;

    if (ws.state === 'hidden' || ws.state === 'veryHidden') sheet.hidden = 1;
    const tab = colorIn((ws.properties as any)?.tabColor);
    if (tab) sheet.tabColor = tab;
    if (ws.properties?.defaultColWidth) sheet.defaultColumnWidth = charsToPx(ws.properties.defaultColWidth);
    if (ws.properties?.defaultRowHeight && ws.properties.defaultRowHeight !== 15) sheet.defaultRowHeight = ptToPx(ws.properties.defaultRowHeight);

    const view: any = ws.views?.[0];
    if (view) {
      if (view.state === 'frozen' && (view.xSplit || view.ySplit)) {
        const x = Number(view.xSplit) || 0, y = Number(view.ySplit) || 0;
        sheet.freeze = { xSplit: x, ySplit: y, startRow: y, startColumn: x };
      } else if (view.state === 'split') {
        warnings.push(`${label}: split panes were not kept (frozen panes are).`);
      }
      if (view.showGridLines === false) sheet.showGridlines = 0;
      if (view.rightToLeft) sheet.rightToLeft = 1;
      if (view.zoomScale && view.zoomScale !== 100) sheet.zoomRatio = Math.max(0.1, Math.min(4, view.zoomScale / 100));
    }

    // Columns
    const colCount = Math.max(ws.columnCount || 0, ws.actualColumnCount || 0);
    for (let c = 1; c <= colCount; c++) {
      const col = ws.getColumn(c);
      const entry: { w?: number; hd?: number; s?: string } = {};
      if (col.width && Math.abs(col.width - (ws.properties?.defaultColWidth ?? 8.43)) > 0.01) entry.w = charsToPx(col.width);
      if (col.hidden) entry.hd = 1;
      const cs = styleId(styleFromExcel(col.style));
      if (cs) entry.s = cs;
      if (Object.keys(entry).length) sheet.columnData![String(c - 1)] = entry;
    }

    // Merges first, so the cells hidden under a merge do not repeat the value.
    const merges: RangeData[] = [];
    const mergeModel: any = (ws as any)._merges;
    if (mergeModel && typeof mergeModel === 'object') {
      for (const key of Object.keys(mergeModel)) {
        const m = mergeModel[key]?.model;
        if (m && m.top && m.left) merges.push({ startRow: m.top - 1, endRow: m.bottom - 1, startColumn: m.left - 1, endColumn: m.right - 1 });
      }
    }
    sheet.mergeData = merges;

    // Cells
    const counters = { richText: 0, hyperlinks: 0, arrayFormulas: 0, unresolved: 0 };
    let notes = 0;
    let maxRow = 0, maxCol = 0;
    const cellData: Record<string, Record<string, CellData>> = {};
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const r = rowNumber - 1;
      const rEntry: { h?: number; hd?: number; s?: string } = {};
      if (row.height && Math.abs(row.height - (ws.properties?.defaultRowHeight ?? 15)) > 0.01) rEntry.h = ptToPx(row.height);
      if (row.hidden) rEntry.hd = 1;
      if (Object.keys(rEntry).length) sheet.rowData![String(r)] = rEntry;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const c = colNumber - 1;
        const isSlave = cell.isMerged && cell.master && cell.master.address !== cell.address;
        let data: CellData | null = isSlave ? null : cellValueIn(cell, counters);
        const st = styleFromExcel(cell.style);
        // A date without a number format would show as a bare serial number.
        if (cell.value instanceof Date && !(st?.n)) {
          const withFmt = { ...(st ?? {}), n: { pattern: 'yyyy-mm-dd' } };
          data = data ?? {};
          data.s = styleId(withFmt);
        } else {
          const sid = styleId(st);
          if (sid) { data = data ?? {}; data.s = sid; }
        }
        if ((cell as any).note) notes++;
        if (!data) return;
        (cellData[r] ??= {})[c] = data;
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
      });
    });
    sheet.cellData = cellData;
    for (const m of merges) {
      maxRow = Math.max(maxRow, m.endRow);
      maxCol = Math.max(maxCol, m.endColumn);
    }
    sheet.rowCount = Math.max(MIN_ROWS, maxRow + 1 + 100, ws.rowCount || 0);
    sheet.columnCount = Math.max(MIN_COLS, maxCol + 1 + 5, colCount);

    if (counters.richText) warnings.push(`${label}: ${counters.richText} cell(s) with mixed formatting inside the text were imported as plain text (one style per cell).`);
    if (counters.hyperlinks) warnings.push(`${label}: ${counters.hyperlinks} hyperlink(s) were imported as plain text; the links themselves were dropped.`);
    if (counters.arrayFormulas) warnings.push(`${label}: ${counters.arrayFormulas} array formula(s) (Ctrl+Shift+Enter) were imported as ordinary formulas and may calculate differently.`);
    if (counters.unresolved) warnings.push(`${label}: ${counters.unresolved} formula(s) could not be read and were imported as their last calculated value only.`);
    if (notes && !warnings.some((w) => w.startsWith(label) && w.includes('comment'))) {
      warnings.push(`${label}: ${notes} comment(s)/note(s) not imported.`);
    }

    const dv = (ws as any).dataValidations?.model;
    if (dv && Object.keys(dv).length) warnings.push(`${label}: data validation rules (drop-down lists, input limits) on ${Object.keys(dv).length} cell range(s) were not imported.`);
    const cf = (ws as any).conditionalFormattings;
    if (Array.isArray(cf) && cf.length) warnings.push(`${label}: ${cf.length} conditional formatting rule(s) were not imported.`);
    if ((ws as any).autoFilter) warnings.push(`${label}: the filter on the sheet was not kept (the data is all there; re-apply the filter in OnSheet).`);
    if ((ws as any).sheetProtection) warnings.push(`${label}: sheet protection / locked cells were not kept.`);
    const imgs = typeof ws.getImages === 'function' ? ws.getImages() : [];
    if (imgs.length && !warnings.some((w) => w.startsWith(label) && w.includes('picture'))) {
      warnings.push(`${label}: ${imgs.length} picture(s) not imported.`);
    }
    if ((ws as any).backgroundImage !== undefined && (ws as any).backgroundImage !== null) {
      warnings.push(`${label}: the background picture was not imported.`);
    }

    snapshot.sheetOrder.push(sheet.id);
    snapshot.sheets[sheet.id] = sheet;
  }

  const names: any[] = (wb as any).definedNames?.model ?? [];
  if (Array.isArray(names) && names.length) {
    const visible = names.filter((n) => n?.name && !String(n.name).startsWith('_xlnm.'));
    if (visible.length) {
      warnings.push(`${visible.length} named range(s) were not imported (${visible.slice(0, 5).map((n) => n.name).join(', ')}${visible.length > 5 ? ', …' : ''}). Formulas that use them will show #NAME?.`);
    }
  }

  if (!snapshot.sheetOrder.length) {
    const sheet = blankSheet('Sheet1');
    snapshot.sheetOrder.push(sheet.id);
    snapshot.sheets[sheet.id] = sheet;
    warnings.push('The file had no ordinary worksheets; an empty sheet was created.');
  }
  return { snapshot, warnings };
}

/* ==========================================================================
   CSV -> snapshot
   ========================================================================== */

/** RFC 4180 parse with the delimiter sniffed from the first line. */
export function parseCsv(text: string): string[][] {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = [',', ';', '\t', '|'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  const delim = counts.sort((a, b) => b.n - a.n)[0].n > 0 ? counts[0].d : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') { inQ = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // Trailing blank lines
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

export function csvToSnapshot(text: string, id: string, name: string, sheetName = 'Sheet1'): ImportResult {
  const warnings: string[] = [];
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const sheet = blankSheet(sheetName.slice(0, 31) || 'Sheet1');
  const cellData: Record<string, Record<string, CellData>> = {};
  let maxCol = 0;
  let formulaText = 0;
  const MAX_ROWS = 200_000;
  if (rows.length > MAX_ROWS) warnings.push(`The file has ${rows.length.toLocaleString('en-IN')} rows; only the first ${MAX_ROWS.toLocaleString('en-IN')} were imported.`);
  rows.slice(0, MAX_ROWS).forEach((cols, r) => {
    cols.forEach((raw, c) => {
      if (raw === '') return;
      maxCol = Math.max(maxCol, c);
      const v = raw;
      let cell: CellData;
      const t = v.trim();
      // Numbers become numbers — but not ones whose leading zeros or length
      // matter (phone numbers, account numbers, PIN codes stored as text).
      if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t) && t.replace(/[-.]/g, '').length <= 15) cell = { v: Number(t), t: CT.NUMBER };
      else if (/^(true|false)$/i.test(t)) cell = { v: t.toUpperCase(), t: CT.BOOLEAN };
      else {
        if (/^[=+@]/.test(t)) formulaText++;
        cell = { v, t: /^[-+]?\d/.test(t) && !isNaN(Number(t)) ? CT.FORCE_STRING : CT.STRING };
      }
      (cellData[r] ??= {})[c] = cell;
    });
  });
  if (formulaText) warnings.push(`${formulaText} cell(s) beginning with "=", "+" or "@" were imported as text, not as formulas.`);
  sheet.cellData = cellData;
  sheet.rowCount = Math.max(MIN_ROWS, Math.min(rows.length, MAX_ROWS) + 100);
  sheet.columnCount = Math.max(MIN_COLS, maxCol + 6);
  if (maxCol + 1 > XL_MAX_COLS) warnings.push('Some rows have more columns than a spreadsheet can hold.');
  return {
    snapshot: { id, name, appVersion: '1.0.2', locale: 'enUS', styles: {}, sheetOrder: [sheet.id], sheets: { [sheet.id]: sheet }, resources: [] },
    warnings,
  };
}

/* ==========================================================================
   snapshot -> xlsx
   ========================================================================== */

/** What the editor stores in `resources` that has no Excel export here. */
const RESOURCE_LABELS: Record<string, string> = {
  SHEET_CONDITIONAL_FORMATTING_PLUGIN: 'conditional formatting',
  SHEET_DATA_VALIDATION_PLUGIN: 'data validation (drop-downs)',
  SHEET_FILTER_PLUGIN: 'filters',
  SHEET_HYPER_LINK_PLUGIN: 'hyperlinks',
  SHEET_DRAWING_PLUGIN: 'pictures',
  SHEET_THREAD_COMMENT_PLUGIN: 'comments',
  SHEET_WORKSHEET_PROTECTION_PLUGIN: 'protection',
  SHEET_RANGE_PROTECTION_PLUGIN: 'protection',
};

function resourceWarnings(snap: WorkbookSnapshot): string[] {
  const out = new Set<string>();
  for (const r of snap.resources ?? []) {
    if (!r?.name || !r.data) continue;
    let hasContent = false;
    try {
      const parsed = JSON.parse(r.data);
      hasContent = parsed && typeof parsed === 'object' && Object.values(parsed).some((v) =>
        Array.isArray(v) ? v.length > 0 : v && typeof v === 'object' ? Object.keys(v).length > 0 : !!v);
    } catch { hasContent = r.data.length > 2; }
    if (!hasContent) continue;
    const label = RESOURCE_LABELS[r.name];
    if (label) out.add(`${label[0].toUpperCase()}${label.slice(1)} set up in OnSheet is not included in the Excel file.`);
  }
  return [...out];
}

function safeSheetName(name: string, used: Set<string>): string {
  let n = (name || 'Sheet').replace(/[\[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet';
  let i = 2;
  const base = n;
  while (used.has(n.toLowerCase())) {
    const suffix = ` (${i++})`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n.toLowerCase());
  return n;
}

/** Plain value for a cell, resolving rich text. */
function plainValue(cell: CellData): string | number | boolean | null {
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  const txt = richTextOfP(cell.p);
  return txt ?? null;
}

function excelValue(cell: CellData): ExcelJS.CellValue {
  const v = plainValue(cell);
  if (v === null) return null;
  if (cell.t === CT.BOOLEAN || typeof v === 'boolean') {
    if (typeof v === 'boolean') return v;
    const s = String(v).toUpperCase();
    if (s === 'TRUE' || s === '1') return true;
    if (s === 'FALSE' || s === '0') return false;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (cell.t === CT.NUMBER && v !== '' && !isNaN(Number(v))) return Number(v);
  const s = String(v);
  if (isErrorString(s)) return { error: s as ExcelJS.CellErrorValue['error'] };
  return s;
}

/** Resolve every formula in a sheet, expanding shared formulas (`si`). */
function sheetFormulas(sheet: SheetData): (r: number, c: number, cell: CellData) => string | null {
  const origins = new Map<string, { f: string; r: number; c: number }>();
  for (const [rk, row] of Object.entries(sheet.cellData ?? {})) {
    for (const [ck, cell] of Object.entries(row ?? {})) {
      if (cell?.si && cell.f) origins.set(cell.si, { f: cell.f, r: Number(rk), c: Number(ck) });
    }
  }
  return (r, c, cell) => {
    if (cell.f && typeof cell.f === 'string') return cell.f;
    if (cell.si) {
      const o = origins.get(cell.si);
      if (o) return shiftFormula(o.f, r - o.r, c - o.c);
    }
    return null;
  };
}

export async function snapshotToXlsx(snap: WorkbookSnapshot): Promise<{ buffer: Buffer; warnings: string[] }> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OnSheet — Gupta Tours & Travels';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const warnings = resourceWarnings(snap);
  const used = new Set<string>();
  const styles = snap.styles ?? {};

  for (const sid of snap.sheetOrder) {
    const sheet = snap.sheets[sid];
    if (!sheet) continue;
    const name = safeSheetName(sheet.name, used);
    if (name !== sheet.name) warnings.push(`Sheet "${sheet.name}" was renamed to "${name}" (Excel sheet-name rules).`);

    const fr = sheet.freeze;
    const frozen = fr && (fr.xSplit > 0 || fr.ySplit > 0);
    const ws = wb.addWorksheet(name, {
      state: sheet.hidden ? 'hidden' : 'visible',
      properties: {
        ...(sheet.tabColor ? { tabColor: colorOut({ rgb: sheet.tabColor }) as ExcelJS.Color } : {}),
        ...(sheet.defaultRowHeight && sheet.defaultRowHeight !== DEFAULT_ROW_HEIGHT ? { defaultRowHeight: pxToPt(sheet.defaultRowHeight) } : {}),
      } as any,
      views: [{
        ...(frozen ? { state: 'frozen', xSplit: fr!.xSplit, ySplit: fr!.ySplit } : { state: 'normal' }),
        showGridLines: sheet.showGridlines !== 0,
        rightToLeft: !!sheet.rightToLeft,
        ...(sheet.zoomRatio && sheet.zoomRatio !== 1 ? { zoomScale: Math.round(sheet.zoomRatio * 100) } : {}),
      } as any],
    });
    if (sheet.defaultColumnWidth && sheet.defaultColumnWidth !== DEFAULT_COL_WIDTH) {
      ws.properties.defaultColWidth = pxToChars(sheet.defaultColumnWidth);
    }

    // Column widths / hidden / style. Univer's default column is wider than
    // Excel's, so a column with no width of its own gets Univer's default.
    const defW = sheet.defaultColumnWidth ?? DEFAULT_COL_WIDTH;
    const colMax = Math.min(XL_MAX_COLS, Math.max(
      ...Object.keys(sheet.columnData ?? {}).map(Number).filter(Number.isFinite).map((n) => n + 1),
      ...Object.values(sheet.cellData ?? {}).flatMap((row) => Object.keys(row ?? {}).map((k) => Number(k) + 1)),
      0,
    ));
    for (let c = 0; c < colMax; c++) {
      const cd = sheet.columnData?.[String(c)];
      const col = ws.getColumn(c + 1);
      col.width = pxToChars(cd?.w ?? defW);
      if (cd?.hd) col.hidden = true;
      const cs = styleToExcel(resolveStyle(styles, cd?.s));
      if (cs) col.style = cs as ExcelJS.Style;
    }
    for (const [rk, rd] of Object.entries(sheet.rowData ?? {})) {
      const r = Number(rk);
      if (!Number.isFinite(r) || r < 0 || r >= XL_MAX_ROWS || !rd) continue;
      const row = ws.getRow(r + 1);
      if (rd.h && !rd.ia) row.height = pxToPt(rd.h);
      if (rd.hd) row.hidden = true;
      const rs = styleToExcel(resolveStyle(styles, rd.s));
      if (rs) (row as any).style = rs;
    }

    // Merges before values: writing into a merged slave would overwrite the master.
    const slave = new Set<string>();
    for (const m of sheet.mergeData ?? []) {
      if (![m.startRow, m.endRow, m.startColumn, m.endColumn].every((x) => Number.isInteger(x) && x >= 0)) continue;
      if (m.startRow === m.endRow && m.startColumn === m.endColumn) continue;
      try {
        ws.mergeCells(m.startRow + 1, m.startColumn + 1, m.endRow + 1, m.endColumn + 1);
        for (let r = m.startRow; r <= m.endRow; r++) {
          for (let c = m.startColumn; c <= m.endColumn; c++) {
            if (r !== m.startRow || c !== m.startColumn) slave.add(`${r}:${c}`);
          }
        }
      } catch {
        warnings.push(`Sheet "${name}": the merged range ${colLetter(m.startColumn)}${m.startRow + 1}:${colLetter(m.endColumn)}${m.endRow + 1} overlaps another merge and was left unmerged.`);
      }
    }

    const formulaOf = sheetFormulas(sheet);
    let lostFormulas = 0;
    for (const [rk, row] of Object.entries(sheet.cellData ?? {})) {
      const r = Number(rk);
      if (!Number.isFinite(r) || r < 0 || r >= XL_MAX_ROWS || !row) continue;
      for (const [ck, cell] of Object.entries(row)) {
        const c = Number(ck);
        if (!Number.isFinite(c) || c < 0 || c >= XL_MAX_COLS || !cell || typeof cell !== 'object') continue;
        const xc = ws.getCell(r + 1, c + 1);
        const st = styleToExcel(resolveStyle(styles, cell.s));
        if (st) xc.style = st as ExcelJS.Style;
        if (slave.has(`${r}:${c}`)) continue;
        const f = formulaOf(r, c, cell);
        if (f) {
          const result = excelValue(cell);
          xc.value = { formula: f.replace(/^=/, ''), ...(result !== null && result !== undefined ? { result } : {}) } as ExcelJS.CellFormulaValue;
        } else {
          if (cell.si && !cell.f) lostFormulas++;
          const v = excelValue(cell);
          if (v !== null && v !== undefined) xc.value = v;
        }
      }
    }
    if (lostFormulas) warnings.push(`Sheet "${name}": ${lostFormulas} copied formula(s) could not be traced to their original and were saved as values.`);
  }

  if (!wb.worksheets.length) wb.addWorksheet('Sheet1');
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, warnings };
}

/* ==========================================================================
   snapshot -> csv
   ========================================================================== */

/** Best-effort rendering of a number through a simple Excel number format. */
export function formatNumber(n: number, pattern?: string | null): string {
  if (!pattern || /^general$/i.test(pattern)) return generalNumber(n);
  const p = pattern.split(';')[0].replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '').replace(/\\./g, '');
  // Dates and times
  if (/[dmyhs]/i.test(p) && !/[0#]/.test(p)) return formatDate(serialToDate(n), p);
  const pct = p.includes('%');
  const val = pct ? n * 100 : n;
  const dec = (p.match(/\.([0#]+)/)?.[1].length) ?? 0;
  const grouped = /#,##|0,0/.test(p);
  let s = Math.abs(val).toFixed(dec);
  if (grouped) {
    const [i, f] = s.split('.');
    s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? '.' + f : '');
  }
  return (val < 0 ? '-' : '') + s + (pct ? '%' : '');
}

function generalNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e10) / 1e10);
}

function formatDate(d: Date, p: string): string {
  const pad = (x: number, l = 2) => String(x).padStart(l, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
  const h = d.getUTCHours(), mi = d.getUTCMinutes(), sec = d.getUTCSeconds();
  const ampm = /am\/pm|a\/p/i.test(p);
  // Tokenise so that "m" next to h/s means minutes.
  const tokens = p.match(/yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|am\/pm|a\/p|./gi) ?? [];
  let out = '';
  tokens.forEach((t, i) => {
    const lower = t.toLowerCase();
    const prev = tokens.slice(0, i).reverse().find((x) => /[a-z]/i.test(x))?.toLowerCase() ?? '';
    const next = tokens.slice(i + 1).find((x) => /[a-z]/i.test(x))?.toLowerCase() ?? '';
    const isMinute = (lower === 'm' || lower === 'mm') && (prev.startsWith('h') || next.startsWith('s'));
    switch (lower) {
      case 'yyyy': out += Y; break;
      case 'yy': out += pad(Y % 100); break;
      case 'mmmm': out += ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][M - 1]; break;
      case 'mmm': out += months[M - 1]; break;
      case 'mm': out += isMinute ? pad(mi) : pad(M); break;
      case 'm': out += isMinute ? mi : M; break;
      case 'dddd': out += ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]; break;
      case 'ddd': out += ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]; break;
      case 'dd': out += pad(D); break;
      case 'd': out += D; break;
      case 'hh': out += pad(ampm ? (h % 12 || 12) : h); break;
      case 'h': out += ampm ? (h % 12 || 12) : h; break;
      case 'ss': out += pad(sec); break;
      case 's': out += sec; break;
      case 'am/pm': out += h < 12 ? 'AM' : 'PM'; break;
      case 'a/p': out += h < 12 ? 'A' : 'P'; break;
      default: out += t;
    }
  });
  return out;
}

function csvField(s: string): string {
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** One sheet as CSV text (with a UTF-8 BOM so Excel reads ₹ and Hindi correctly). */
export function snapshotToCsv(snap: WorkbookSnapshot, sheetId?: string): { csv: string; sheetName: string } {
  const sid = sheetId && snap.sheets[sheetId] ? sheetId : snap.sheetOrder.find((id) => snap.sheets[id]);
  const sheet = sid ? snap.sheets[sid] : undefined;
  if (!sheet) return { csv: '﻿', sheetName: 'Sheet1' };
  const styles = snap.styles ?? {};
  const cells = sheet.cellData ?? {};
  const rowKeys = Object.keys(cells).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  let maxRow = -1, maxCol = -1;
  for (const r of rowKeys) {
    for (const [ck, cell] of Object.entries(cells[r] ?? {})) {
      const v = cell ? plainValue(cell) : null;
      if (v === null || v === '') continue;
      maxRow = Math.max(maxRow, r);
      maxCol = Math.max(maxCol, Number(ck));
    }
  }
  const lines: string[] = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = cells[r] ?? {};
    const out: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = row[c];
      if (!cell) { out.push(''); continue; }
      const v = plainValue(cell);
      let text: string;
      if (v === null || v === undefined) text = '';
      else if (cell.t === CT.BOOLEAN || typeof v === 'boolean') {
        const s = String(v).toUpperCase();
        text = s === '1' || s === 'TRUE' ? 'TRUE' : s === '0' || s === 'FALSE' ? 'FALSE' : String(v);
      } else if (typeof v === 'number' || (cell.t === CT.NUMBER && v !== '' && !isNaN(Number(v)))) {
        const st = resolveStyle(styles, cell.s) ?? resolveStyle(styles, sheet.rowData?.[r]?.s) ?? resolveStyle(styles, sheet.columnData?.[c]?.s);
        text = formatNumber(Number(v), st?.n?.pattern);
      } else {
        text = String(v);
        // Keep a spreadsheet that opens this file from running it as a formula.
        if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      }
      out.push(csvField(text));
    }
    lines.push(out.join(','));
  }
  return { csv: '﻿' + lines.join('\r\n') + (lines.length ? '\r\n' : ''), sheetName: sheet.name };
}

/* ==========================================================================
   Misc
   ========================================================================== */

export function countSheets(snap: WorkbookSnapshot): number {
  return snap.sheetOrder.filter((id) => snap.sheets[id]).length;
}
