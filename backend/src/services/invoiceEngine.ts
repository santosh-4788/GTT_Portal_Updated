/**
 * Invoice generation engine.
 *
 * Core principle: the engine NEVER redraws a vendor's layout. It opens the vendor's own
 * workbook/document as a binary template, writes values into the cells (or tags) named by
 * the template mapping, and saves a NEW file. Borders, merges, fonts, column widths, number
 * formats, logos, print areas and formulas therefore survive untouched — which is exactly
 * why the vendors keep recognising the document.
 *
 *   Booking(s) -> Vendor -> InvoiceTemplate -> mapping_json -> Writer -> data/invoices/...
 *
 * Cells listed in `formulaCells` are deliberately skipped so Excel recalculates them.
 */
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { round2 } from './billing';
import { ensureLocalFile, persistFile } from './fileStore';

export interface TemplateMapping {
  sheet?: string;
  documentTitle?: string;
  mode?: 'single' | 'consolidated';
  taxMode?: string;
  taxRate?: number;
  tollParkingTaxable?: boolean;
  preserveFormulas?: boolean;
  formulaCells?: string[];
  cells?: Record<string, { field?: string; static?: string; type?: 'string' | 'number' | 'date' | 'currency' }>;
  lineItems?: {
    startRow: number;
    rowsAvailable: number;
    columns: Record<string, string | { formula: string }>;
  };
}

/** Everything the mapping can reference, in one flat-ish object. */
export interface InvoiceContext {
  company: Record<string, any>;
  vendor: Record<string, any>;
  invoice: Record<string, any>;
  booking: Record<string, any>;
  billing: Record<string, any>;
  bookings: Array<Record<string, any>>;
}

// ---------------------------------------------------------------------------
// Field resolution: "vendor.companyName" -> context.vendor.companyName
// ---------------------------------------------------------------------------
export function resolveField(ctx: InvoiceContext, dotted: string): any {
  return dotted.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), ctx as any);
}

function coerce(value: any, type?: string): any {
  if (value === undefined || value === null || value === '') return type === 'number' ? 0 : '';
  switch (type) {
    case 'number':
    case 'currency': {
      const n = typeof value === 'number' ? value : parseFloat(String(value));
      return Number.isFinite(n) ? round2(n) : 0;
    }
    case 'date': {
      if (value instanceof Date) return value;
      const d = new Date(String(value).length === 10 ? `${value}T00:00:00` : String(value));
      return isNaN(d.getTime()) ? String(value) : d;
    }
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// XLSX writer
// ---------------------------------------------------------------------------
export async function generateXlsx(
  templatePath: string,
  mapping: TemplateMapping,
  ctx: InvoiceContext,
  outputPath: string
): Promise<{ path: string; warnings: string[] }> {
  const warnings: string[] = [];
  if (!ensureLocalFile(templatePath)) {
    throw new Error(`Invoice template file is missing on disk: ${templatePath}`);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath);

  const sheet = mapping.sheet ? wb.getWorksheet(mapping.sheet) : wb.worksheets[0];
  if (!sheet) {
    throw new Error(
      `Sheet "${mapping.sheet}" was not found in the template. ` +
      `Available: ${wb.worksheets.map((w) => w.name).join(', ')}`
    );
  }

  const skip = new Set((mapping.formulaCells ?? []).map((c) => c.toUpperCase()));

  for (const [ref, spec] of Object.entries(mapping.cells ?? {})) {
    const address = ref.toUpperCase();
    if (skip.has(address)) {
      warnings.push(`${address} is a formula cell — left for Excel to recalculate.`);
      continue;
    }
    const cell = sheet.getCell(address);

    // Never clobber a formula that happens to live in a mapped cell.
    if (mapping.preserveFormulas !== false && (cell as any).formula) {
      warnings.push(`${address} already holds a formula — skipped.`);
      continue;
    }

    let value: any;
    if (spec.static !== undefined) {
      value = spec.static;
    } else if (spec.field) {
      value = resolveField(ctx, spec.field);
      if (value === undefined) warnings.push(`No value for "${spec.field}" (cell ${address}).`);
    }
    cell.value = coerce(value, spec.type);
  }

  // Repeating line-item block for consolidated templates
  if (mapping.lineItems && ctx.bookings.length > 0) {
    const { startRow, rowsAvailable, columns } = mapping.lineItems;
    const needed = ctx.bookings.length;
    if (needed > rowsAvailable) {
      sheet.duplicateRow(startRow, needed - rowsAvailable, true);
    }
    ctx.bookings.forEach((b, i) => {
      const rowNo = startRow + i;
      for (const [col, source] of Object.entries(columns)) {
        const cell = sheet.getCell(`${col}${rowNo}`);
        if (typeof source === 'object' && 'formula' in source) {
          cell.value = { formula: source.formula.replace(/\{row\}/g, String(rowNo)) } as any;
        } else if (source === 'index') {
          cell.value = i + 1;
        } else {
          const v = resolveField({ ...ctx, booking: b, billing: b.billing ?? ctx.billing }, source);
          cell.value = coerce(v, typeof v === 'number' ? 'number' : 'string');
        }
      }
    });
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await wb.xlsx.writeFile(outputPath);
  persistFile(outputPath);
  return { path: outputPath, warnings };
}

// ---------------------------------------------------------------------------
// DOCX writer (tag replacement — preserves headers, footers, tables, logo)
// ---------------------------------------------------------------------------
export async function generateDocx(
  templatePath: string,
  mapping: TemplateMapping,
  ctx: InvoiceContext,
  outputPath: string
): Promise<{ path: string; warnings: string[] }> {
  const warnings: string[] = [];
  // Required lazily so a missing optional dep never breaks XLSX generation.
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');

  if (!ensureLocalFile(templatePath)) {
    throw new Error(`Invoice template file is missing on disk: ${templatePath}`);
  }

  const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  });

  // Flatten the context so {VendorName} style tags work as well as {vendor.companyName}
  const flat: Record<string, any> = {
    ...ctx.company, ...ctx.invoice, ...ctx.booking, ...ctx.billing,
    company: ctx.company, vendor: ctx.vendor, invoice: ctx.invoice,
    booking: ctx.booking, billing: ctx.billing, bookings: ctx.bookings,
    VendorName: ctx.vendor.companyName ?? ctx.vendor.vendorName,
    BookingID: ctx.booking.bookingCode,
    PassengerName: ctx.booking.passengerName,
    TravelDate: ctx.booking.travelDate,
    Pickup: ctx.booking.pickupLocation,
    Drop: ctx.booking.dropLocation,
    BaseFare: ctx.billing.baseFare,
    GST: ctx.billing.taxAmount,
    TotalAmount: ctx.billing.totalAmount,
    AmountInWords: ctx.invoice.amountInWords,
  };

  doc.render(flat);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  persistFile(outputPath);
  return { path: outputPath, warnings };
}

// ---------------------------------------------------------------------------
// Native PDF writer — used when the vendor has no file template, and for previews
// ---------------------------------------------------------------------------
/**
 * Native PDF output. The layout itself lives in invoicePdf.ts — this stays a
 * thin adapter so the engine's job (choose a writer, produce a file) is clear.
 */
export async function generatePdf(
  ctx: InvoiceContext,
  outputPath: string,
  opts: { title?: string; logoPath?: string } = {}
): Promise<{ path: string; warnings: string[] }> {
  const { renderInvoicePdf } = await import('./invoicePdf');
  const r = await renderInvoicePdf(ctx, outputPath, opts);
  persistFile(r.path);
  return r;
}

// ---------------------------------------------------------------------------
// Optional XLSX/DOCX -> PDF via LibreOffice headless (free). No-ops when absent.
// ---------------------------------------------------------------------------
export function libreOfficeAvailable(): string | null {
  const candidates = [
    process.env.LIBREOFFICE_PATH,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    // Ubuntu / Debian VPS (apt install libreoffice-calc libreoffice-writer)
    '/usr/bin/soffice',
    '/usr/bin/libreoffice',
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

export function convertToPdf(inputPath: string, outDir: string): string | null {
  const soffice = libreOfficeAvailable();
  if (!soffice) return null;
  const { execFileSync } = require('child_process');
  execFileSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath], {
    timeout: 120_000,
    windowsHide: true,
  });
  const out = path.join(outDir, path.basename(inputPath).replace(/\.[^.]+$/, '.pdf'));
  if (!fs.existsSync(out)) return null;
  persistFile(out);   // the PDF twin of an XLSX/DOCX invoice
  return out;
}

/** data/invoices/<FY>/<VendorCode>/<file> — one folder per vendor per year. */
export function invoiceOutputPath(fyCode: string, vendorCode: string, fileName: string, bucket = 'original'): string {
  const safe = (s: string) => String(s).replace(/[^A-Za-z0-9._\-]/g, '_');
  return path.join(config.paths.invoices, safe(fyCode), safe(vendorCode), bucket, safe(fileName));
}
