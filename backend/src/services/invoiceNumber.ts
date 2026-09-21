/**
 * Invoice numbering.
 *
 * Format tokens: {PREFIX} {FY} {FYSHORT} {YYYY} {YY} {MM} {VENDOR} {SEQ:n}
 * Default:       {PREFIX}/{FY}/{SEQ:5}   ->  GTT/2026-27/00001
 *
 * The sequence is allocated inside the caller's transaction and the invoice_number
 * column carries a UNIQUE constraint, so a duplicate can never be committed even if
 * two operators generate at the same moment.
 */
import { getDb } from '../db';

export interface NumberContext {
  prefix: string;
  format: string;
  vendorCode: string;
  /** When true the sequence is per vendor; otherwise one shared company sequence. */
  perVendorSequence?: boolean;
  financialYear: { id: number; code: string; start_date: string };
  invoiceDate: string;   // yyyy-mm-dd
}

/** Reserve the next number in a scope. Must run inside a transaction. */
export function nextSequence(scope: string): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO invoice_sequences (scope, last_number) VALUES (?, 0)
     ON CONFLICT(scope) DO NOTHING`
  ).run(scope);
  db.prepare(
    `UPDATE invoice_sequences SET last_number = last_number + 1, updated_at = datetime('now')
     WHERE scope = ?`
  ).run(scope);
  const row = db.prepare('SELECT last_number FROM invoice_sequences WHERE scope = ?').get(scope) as
    | { last_number: number }
    | undefined;
  return row?.last_number ?? 1;
}

export function buildInvoiceNumber(ctx: NumberContext): { invoiceNumber: string; sequence: number } {
  const scopeKey = ctx.perVendorSequence ? ctx.vendorCode : ctx.prefix;
  const scope = `${scopeKey}|${ctx.financialYear.code}`;
  const seq = nextSequence(scope);

  const fyStartYear = Number(ctx.financialYear.start_date.slice(0, 4));
  const d = new Date(ctx.invoiceDate + 'T00:00:00');

  const invoiceNumber = (ctx.format || '{PREFIX}/{FY}/{SEQ:5}')
    .replace(/\{PREFIX\}/g, ctx.prefix)
    .replace(/\{FY\}/g, ctx.financialYear.code)
    .replace(/\{FYSHORT\}/g, String(fyStartYear).slice(2) + String(fyStartYear + 1).slice(2))
    .replace(/\{YYYY\}/g, String(d.getFullYear()))
    .replace(/\{YY\}/g, String(d.getFullYear()).slice(2))
    .replace(/\{MM\}/g, String(d.getMonth() + 1).padStart(2, '0'))
    .replace(/\{VENDOR\}/g, ctx.vendorCode)
    .replace(/\{SEQ:(\d+)\}/g, (_m, n) => String(seq).padStart(Number(n), '0'))
    .replace(/\{SEQ\}/g, String(seq));

  return { invoiceNumber, sequence: seq };
}

/** Resolve the FY row that contains a given date, falling back to the active one. */
export function financialYearFor(dateIso: string) {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM financial_years WHERE ? BETWEEN start_date AND end_date LIMIT 1')
    .get(dateIso) as any;
  if (row) return row;
  return db.prepare('SELECT * FROM financial_years WHERE is_active = 1 LIMIT 1').get() as any;
}
