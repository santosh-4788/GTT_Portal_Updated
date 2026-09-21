/**
 * End-to-end smoke test of the invoice engine against the REAL Wagon template.
 * Generates a file, then re-reads it to prove the values landed in the right cells
 * and that the workbook's own formulas survived.
 */
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { q, closeDb } from '../src/db';
import { config } from '../src/config';
import { generateXlsx, invoiceOutputPath, TemplateMapping } from '../src/services/invoiceEngine';
import { buildInvoiceContext } from '../src/utils/context';
import { consolidate, amountInWords } from '../src/services/billing';

async function main() {
  const template = q.get<any>("SELECT * FROM invoice_templates WHERE file_name = 'wagon-local.xlsx'");
  if (!template) throw new Error('Wagon template not registered. Run npm run seed first.');

  const vendor = q.get<any>("SELECT * FROM vendors WHERE code = 'WAGON'");
  if (!vendor) throw new Error('Wagon vendor not seeded.');

  const booking = q.get<any>(
    `SELECT b.*, c.*, b.id AS id FROM bookings b JOIN booking_charges c ON c.booking_id = b.id
      WHERE b.vendor_id = @v ORDER BY b.id LIMIT 1`,
    { v: vendor.id }
  );
  if (!booking) throw new Error('No Wagon booking found.');

  const totals = consolidate([booking], vendor.tax_mode, vendor.tax_rate);
  const mapping: TemplateMapping = JSON.parse(template.mapping_json);

  const ctx = buildInvoiceContext({
    vendor,
    invoice: {
      invoiceNumber: 'GTT/2026-27/00001',
      invoiceDate: new Date().toISOString().slice(0, 10),
      documentTitle: template.document_title,
      amountInWords: amountInWords(totals.totalAmount),
    },
    bookings: [booking],
    billing: totals,
  });

  const templatePath = path.join(config.paths.templates, template.file_name);
  const out = invoiceOutputPath('2026-27', vendor.code, 'TEST-INV-GTT-2026-27-00001_WAGON.xlsx');

  console.log('Template :', templatePath);
  console.log('Output   :', out);
  console.log('Booking  :', booking.booking_code, '|', booking.passenger_name, '|', booking.vehicle_number);
  console.log('Totals   :', JSON.stringify(totals, null, 0));
  console.log('');

  const result = await generateXlsx(templatePath, mapping, ctx, out);
  if (result.warnings.length) {
    console.log('Warnings:');
    result.warnings.forEach((w) => console.log('  -', w));
    console.log('');
  }

  // --- read the produced file back and verify ---
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(out);
  const ws = wb.getWorksheet(mapping.sheet!)!;

  const checks: [string, string, any][] = [
    ['A1', 'company header (static, untouched)', 'GUPTA TOURS AND TRAVELS'],
    ['A5', 'GSTIN header (static, untouched)', 'GSTIN - 27ALRPG8019M1ZH'],
    ['A7', 'document title (static)', 'Credit Note'],
    ['G9', 'label kept verbatim incl. original typo', 'Invoie No.'],
    ['I9', 'invoice number written', 'GTT/2026-27/00001'],
    ['B10', 'vendor company name written', vendor.company_name],
    ['B14', 'vendor GSTIN written', vendor.gst_number],
    ['H12', 'vehicle number written', booking.vehicle_number],
    ['I13', 'vehicle type written', booking.vehicle_type],
    ['I14', 'passenger name written', booking.passenger_name],
    ['J17', 'base fare written', booking.base_fare],
    ['A31', 'PAN footer (static, untouched)', 'PAN NO : ALRPG8019M'],
    ['G35', 'authorised signatory (static)', 'Vinay Gupta'],
  ];

  let pass = 0, fail = 0;
  console.log('--- cell verification -------------------------------------------');
  for (const [addr, what, expected] of checks) {
    const cell = ws.getCell(addr);
    const actual = cell.text ?? cell.value;
    const ok = String(actual).trim() === String(expected).trim();
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${addr.padEnd(5)} ${what}`);
    if (!ok) console.log(`         expected "${expected}" but found "${actual}"`);
    ok ? pass++ : fail++;
  }

  console.log('');
  console.log('--- formula preservation ----------------------------------------');
  for (const addr of mapping.formulaCells ?? []) {
    const f = (ws.getCell(addr) as any).formula;
    const ok = !!f;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${addr.padEnd(5)} formula ${ok ? '= ' + f : 'MISSING'}`);
    ok ? pass++ : fail++;
  }

  console.log('');
  console.log('--- layout preservation -----------------------------------------');
  const merges = (ws as any).model?.merges ?? [];
  const expectedMerges = ['A1:J1', 'A7:J7', 'B11:F13', 'G35:J35'];
  for (const m of expectedMerges) {
    const ok = merges.includes(m);
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  merge ${m} preserved`);
    ok ? pass++ : fail++;
  }

  const originalSize = fs.statSync(templatePath).size;
  const outputSize = fs.statSync(out).size;
  console.log('');
  console.log(`Original template : ${originalSize} bytes (unchanged on disk)`);
  console.log(`Generated invoice : ${outputSize} bytes`);
  console.log('');
  console.log(`RESULT: ${pass} passed, ${fail} failed`);

  closeDb();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
