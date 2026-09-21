/**
 * The portal's own invoice layout.
 *
 * Used when a vendor has no template of their own, and for every counter
 * booking. Built with PDFKit so it needs no browser, no headless renderer and
 * no external service — it draws straight to a file.
 *
 * The structure follows the real Gupta Tours & Travels credit note: company
 * block, bill-to, itemised trips, taxable value, tax, then toll and parking
 * added *after* tax, bank details and an authorised signature.
 */
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { amountInWords, round2 } from './billing';
import type { InvoiceContext } from './invoiceEngine';

const INK = '#0F1B2D';
const MUTED = '#64748B';
const LINE = '#E3E8EF';
const BRAND = '#0E82B8';
const BRAND_SOFT = '#EAF4FB';
const OK = '#0F7B52';

const PAGE = { left: 42, right: 553, top: 40 };
const W = PAGE.right - PAGE.left;

const money = (v: any) =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dmy = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : String(iso));
  return isNaN(d.getTime())
    ? String(iso)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export async function renderInvoicePdf(
  ctx: InvoiceContext,
  outputPath: string,
  opts: { title?: string; logoPath?: string } = {}
): Promise<{ path: string; warnings: string[] }> {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const { company, vendor, invoice, billing, bookings } = ctx;
    const title = (opts.title ?? invoice.documentTitle ?? 'Tax Invoice').toUpperCase();

    /* ------------------------------------------------------------------ *
     *  Header — a soft brand band rather than a hard rule                  *
     * ------------------------------------------------------------------ */
    doc.rect(0, 0, 595, 132).fill(BRAND_SOFT);
    doc.rect(0, 0, 595, 4).fill(BRAND);

    const logo = opts.logoPath ?? path.join(config.paths.assets, 'logo-gtt.jpg');
    let textLeft = PAGE.left;
    if (fs.existsSync(logo)) {
      try {
        doc.save();
        doc.circle(PAGE.left + 26, 62, 26).clip();
        doc.image(logo, PAGE.left, 36, { width: 52, height: 52 });
        doc.restore();
        textLeft = PAGE.left + 66;
      } catch { /* a missing logo must never stop an invoice */ }
    }

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(15)
      .text(company.legalName ?? company.name ?? 'Gupta Tours & Travels', textLeft, 40, { width: 300 });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(company.addressInvoice ?? '', textLeft, doc.y + 2, { width: 300 })
      .text(company.addressInvoice2 ?? '', textLeft, doc.y, { width: 300 })
      .text(
        `${company.mobile ?? ''}${company.altMobile2 ? ' / ' + company.altMobile2 : ''}` +
        `${company.email ? '  ·  ' + company.email : ''}`,
        textLeft, doc.y + 1, { width: 300 }
      );
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK)
      .text(`GSTIN ${company.gstin ?? ''}   ·   PAN ${company.pan ?? ''}`, textLeft, doc.y + 2, { width: 300 });

    // Document title + number, right aligned in the band
    doc.font('Helvetica-Bold').fontSize(19).fillColor(BRAND)
      .text(title, 320, 42, { width: W - 320 + PAGE.left, align: 'right', characterSpacing: 1.2 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`No.  ${invoice.invoiceNumber ?? '—'}`, 320, 70, { width: W - 320 + PAGE.left, align: 'right' })
      .text(`Date  ${dmy(invoice.invoiceDate)}`, 320, doc.y + 1, { width: W - 320 + PAGE.left, align: 'right' });
    if (invoice.dueDate) {
      doc.text(`Due  ${dmy(invoice.dueDate)}`, 320, doc.y + 1, { width: W - 320 + PAGE.left, align: 'right' });
    }

    /* ------------------------------------------------------------------ *
     *  Bill-to and trip summary, side by side on tinted cards             *
     * ------------------------------------------------------------------ */
    let y = 152;
    const colW = (W - 14) / 2;

    const card = (x: number, h: number) =>
      doc.roundedRect(x, y, colW, h, 7).fillAndStroke('#FBFCFE', LINE);

    const billLines = [
      vendor.companyName || vendor.vendorName || 'Customer',
      vendor.billingAddress || vendor.address || '',
      vendor.gstNumber ? `GSTIN: ${vendor.gstNumber}` : '',
      vendor.mobile ? `Mobile: ${vendor.mobile}` : '',
    ].filter(Boolean);

    const first = bookings[0] ?? {};
    const tripLines = [
      // Only shown for a single-trip invoice: on a consolidated one there is no
      // single Trip ID, and each line carries its own underneath the route.
      bookings.length === 1 && first.tripId ? `Trip ID: ${first.tripId}` : '',
      first.travelDate ? `Travel date: ${dmy(first.travelDate)}` : '',
      first.reportingTime ? `Reporting: ${first.reportingTime}` : '',
      first.pickupLocation
        ? `Route: ${first.pickupLocation}${first.dropLocation ? ` to ${first.dropLocation}` : ''}` : '',
      first.vehicleType || first.vehicleNumber
        ? `Vehicle: ${[first.vehicleType, first.vehicleNumber].filter(Boolean).join(' · ')}` : '',
      // The chauffeur belongs on the invoice: it is what a corporate customer
      // reconciles against their own gate register.
      first.driverName
        ? `Driver: ${first.driverName}${first.driverMobile ? ` · ${first.driverMobile}` : ''}` : '',
      first.passengerName ? `Guest: ${first.passengerName}` : '',
      first.dutyType ? `Duty: ${first.dutyType}` : '',
    ].filter(Boolean);

    // measure so both cards share a height
    doc.font('Helvetica').fontSize(9);
    const billH = billLines.reduce((h, l) => h + doc.heightOfString(l, { width: colW - 24 }) + 2, 0);
    const tripH = tripLines.reduce((h, l) => h + doc.heightOfString(l, { width: colW - 24 }) + 2, 0);
    const cardH = Math.max(billH, tripH) + 34;

    card(PAGE.left, cardH);
    card(PAGE.left + colW + 14, cardH);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND)
      .text('BILL TO', PAGE.left + 12, y + 11, { characterSpacing: 0.8 });
    doc.text('TRIP', PAGE.left + colW + 26, y + 11, { characterSpacing: 0.8 });

    let by = y + 25;
    billLines.forEach((line, i) => {
      doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 0 ? 10 : 8.5)
        .fillColor(i === 0 ? INK : MUTED)
        .text(line, PAGE.left + 12, by, { width: colW - 24 });
      by = doc.y + 2;
    });

    let ty = y + 25;
    tripLines.forEach((line) => {
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
        .text(line, PAGE.left + colW + 26, ty, { width: colW - 24 });
      ty = doc.y + 2;
    });

    y += cardH + 22;

    /* ------------------------------------------------------------------ *
     *  Items                                                              *
     * ------------------------------------------------------------------ */
    const cols = [
      { x: PAGE.left, w: 26, label: '#', align: 'left' as const },
      { x: PAGE.left + 26, w: 232, label: 'PARTICULARS', align: 'left' as const },
      { x: PAGE.left + 258, w: 70, label: 'DATE', align: 'left' as const },
      { x: PAGE.left + 328, w: 58, label: 'KM / HRS', align: 'right' as const },
      { x: PAGE.left + 386, w: 58, label: 'RATE', align: 'right' as const },
      { x: PAGE.left + 444, w: 67, label: 'AMOUNT', align: 'right' as const },
    ];

    const headerRow = (atY: number) => {
      doc.roundedRect(PAGE.left, atY, W, 20, 4).fill(INK);
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5);
      cols.forEach((c) =>
        doc.text(c.label, c.x + 6, atY + 6.5, { width: c.w - 12, align: c.align, characterSpacing: 0.6 })
      );
      return atY + 20;
    };

    y = headerRow(y);

    const lines = bookings.length ? bookings : [ctx.booking];
    doc.font('Helvetica').fontSize(8.5);

    lines.forEach((b: any, i: number) => {
      const bill = b.billing ?? billing;
      const particular =
        b.particular ||
        [b.dutyType, b.pickupLocation && `${b.pickupLocation} to ${b.dropLocation ?? '—'}`]
          .filter(Boolean).join(' — ') ||
        'Trip charges';

      const h = Math.max(24, doc.heightOfString(particular, { width: cols[1].w - 12 }) + 22);

      if (y + h > 690) {
        doc.addPage();
        y = headerRow(60);
      }

      if (i % 2 === 1) doc.rect(PAGE.left, y, W, h).fill('#F7FAFD');

      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(String(i + 1), cols[0].x + 6, y + 7, { width: cols[0].w - 12 });

      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text(particular, cols[1].x + 6, y + 6, { width: cols[1].w - 12 });
      // The Trip ID first: it is what the customer has, and what they will
      // quote back if anything on this line needs discussing. The booking code
      // is the office's own and comes second.
      const refs = [b.tripId, b.bookingCode].filter(Boolean).join('   ·   ');
      if (refs) {
        doc.font('Helvetica').fontSize(7).fillColor(MUTED)
          .text(refs, cols[1].x + 6, doc.y + 1, { width: cols[1].w - 12 });
      }

      doc.fillColor(MUTED).font('Helvetica').fontSize(8.5)
        .text(dmy(b.travelDate), cols[2].x + 6, y + 7, { width: cols[2].w - 12 })
        .text(b.qty != null ? String(b.qty) : '—', cols[3].x + 6, y + 7, { width: cols[3].w - 12, align: 'right' })
        .text(b.rate != null ? money(b.rate) : '—', cols[4].x + 6, y + 7, { width: cols[4].w - 12, align: 'right' });

      doc.fillColor(INK).font('Helvetica-Bold')
        .text(money(bill?.taxableAmount ?? b.amount ?? 0), cols[5].x + 6, y + 7,
          { width: cols[5].w - 12, align: 'right' });

      y += h;
      doc.moveTo(PAGE.left, y).lineTo(PAGE.right, y).lineWidth(0.5).strokeColor(LINE).stroke();
    });

    /* ------------------------------------------------------------------ *
     *  Totals                                                             *
     * ------------------------------------------------------------------ */
    y += 16;
    const tX = PAGE.left + 300;
    const tW = PAGE.right - tX;

    const totalRow = (label: string, value: string, opt: { bold?: boolean; tone?: string } = {}) => {
      doc.font(opt.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opt.bold ? 10 : 9)
        .fillColor(opt.tone ?? (opt.bold ? INK : MUTED));
      doc.text(label, tX, y, { width: tW - 90, align: 'right' });
      doc.fillColor(opt.tone ?? INK)
        .text(value, tX + tW - 88, y, { width: 88, align: 'right' });
      y += opt.bold ? 18 : 15;
    };

    totalRow('Taxable value', money(billing.taxableAmount));

    if (billing.taxMode === 'IGST' && Number(billing.taxAmount) > 0) {
      totalRow(`IGST @ ${billing.taxRate}%`, money(billing.igst));
    } else if (billing.taxMode === 'CGST_SGST' && Number(billing.taxAmount) > 0) {
      totalRow(`CGST @ ${round2(Number(billing.taxRate) / 2)}%`, money(billing.cgst));
      totalRow(`SGST @ ${round2(Number(billing.taxRate) / 2)}%`, money(billing.sgst));
    }

    const invoiceValue = billing.invoiceValue ?? Number(billing.taxableAmount) + Number(billing.taxAmount);
    totalRow('Invoice value', money(invoiceValue));

    if (Number(billing.nonTaxableAmount) > 0) {
      totalRow('Toll & parking (at actuals)', money(billing.nonTaxableAmount));
    }

    // the grand total sits on a tinted plate so it is unmissable
    doc.roundedRect(tX, y - 2, tW, 26, 5).fill(BRAND_SOFT);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(BRAND)
      .text('TOTAL', tX + 10, y + 5, { width: tW - 100, align: 'right' })
      .text(`Rs. ${money(billing.totalAmount)}`, tX + tW - 98, y + 5, { width: 88, align: 'right' });
    y += 34;

    // amount in words, left of the totals
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(MUTED)
      .text(
        invoice.amountInWords ?? amountInWords(Number(billing.totalAmount ?? 0)),
        PAGE.left, y - 60, { width: 290 }
      );

    if (Number(billing.nonTaxableAmount) > 0) {
      doc.font('Helvetica').fontSize(7).fillColor(MUTED)
        .text('Toll and parking are reimbursed at actuals and are not taxed.',
          PAGE.left, doc.y + 4, { width: 290 });
    }

    /* ------------------------------------------------------------------ *
     *  Footer — bank details and signature                                *
     * ------------------------------------------------------------------ */
    const fy = Math.max(y + 20, 660);
    doc.roundedRect(PAGE.left, fy, W, 96, 7).fillAndStroke('#FBFCFE', LINE);

    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(BRAND)
      .text('PAYMENT DETAILS', PAGE.left + 12, fy + 11, { characterSpacing: 0.8 });

    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    const bank = [
      ['Bank', company.bankName ?? ''],
      ['A/C No.', company.bankAccount ?? ''],
      ['IFSC', company.bankIfsc ?? ''],
      ['PAN', company.pan ?? ''],
    ];
    let byy = fy + 26;
    bank.forEach(([k, v]) => {
      doc.fillColor(MUTED).text(String(k), PAGE.left + 12, byy, { width: 52 });
      doc.fillColor(INK).font('Helvetica-Bold').text(String(v), PAGE.left + 66, byy, { width: 200 });
      doc.font('Helvetica');
      byy += 13;
    });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK)
      .text(String(company.owner ?? ''), PAGE.right - 190, fy + 46, { width: 178, align: 'center' });
    doc.moveTo(PAGE.right - 180, fy + 62).lineTo(PAGE.right - 22, fy + 62)
      .lineWidth(0.7).strokeColor(LINE).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
      .text('Authorised Signatory', PAGE.right - 190, fy + 67, { width: 178, align: 'center' });

    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(
        `This is a computer-generated ${(opts.title ?? 'invoice').toLowerCase()}.` +
        `${invoice.revision && Number(invoice.revision) > 1 ? `  Revision ${invoice.revision}.` : ''}`,
        PAGE.left, fy + 104, { width: W, align: 'center' }
      );

    doc.end();
    stream.on('finish', () => resolve({ path: outputPath, warnings: [] }));
    stream.on('error', reject);
  });
}
