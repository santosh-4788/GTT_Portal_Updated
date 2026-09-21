import { Router } from 'express';
import ExcelJS from 'exceljs';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

type ReportDef = { title: string; sql: string; columns: { key: string; header: string; width?: number }[] };

const REPORTS: Record<string, ReportDef> = {
  'vendor-bookings': {
    title: 'Vendor-wise Booking Report',
    sql: `SELECT v.code AS vendor_code, v.vendor_name, COUNT(b.id) AS bookings,
                 SUM(CASE WHEN b.booking_status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                 COALESCE(SUM(c.taxable_amount),0) AS taxable,
                 COALESCE(SUM(c.tax_amount),0) AS tax,
                 COALESCE(SUM(c.total_amount),0) AS total
            FROM vendors v
            LEFT JOIN bookings b ON b.vendor_id = v.id
              AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE (@vendorId = 0 OR v.id = @vendorId)
           GROUP BY v.id HAVING bookings > 0 ORDER BY total DESC`,
    columns: [
      { key: 'vendor_code', header: 'Code', width: 12 },
      { key: 'vendor_name', header: 'Vendor', width: 28 },
      { key: 'bookings', header: 'Bookings', width: 11 },
      { key: 'cancelled', header: 'Cancelled', width: 11 },
      { key: 'taxable', header: 'Taxable', width: 14 },
      { key: 'tax', header: 'Tax', width: 12 },
      { key: 'total', header: 'Total', width: 14 },
    ],
  },
  'vendor-billing': {
    title: 'Vendor-wise Billing Report',
    sql: `SELECT v.code AS vendor_code, v.vendor_name,
                 COUNT(i.id) AS invoices, COALESCE(SUM(i.taxable_amount),0) AS taxable,
                 COALESCE(SUM(i.tax_amount),0) AS tax, COALESCE(SUM(i.total_amount),0) AS total,
                 COALESCE(SUM(i.paid_amount),0) AS paid, COALESCE(SUM(i.outstanding_amount),0) AS outstanding
            FROM vendors v
            LEFT JOIN invoices i ON i.vendor_id = v.id AND i.status <> 'CANCELLED'
              AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
           WHERE (@vendorId = 0 OR v.id = @vendorId)
           GROUP BY v.id HAVING invoices > 0 ORDER BY outstanding DESC`,
    columns: [
      { key: 'vendor_code', header: 'Code', width: 12 },
      { key: 'vendor_name', header: 'Vendor', width: 28 },
      { key: 'invoices', header: 'Invoices', width: 11 },
      { key: 'taxable', header: 'Taxable', width: 14 },
      { key: 'tax', header: 'Tax', width: 12 },
      { key: 'total', header: 'Total', width: 14 },
      { key: 'paid', header: 'Paid', width: 14 },
      { key: 'outstanding', header: 'Outstanding', width: 14 },
    ],
  },
  'vendor-outstanding': {
    title: 'Vendor-wise Outstanding Report',
    sql: `SELECT v.code AS vendor_code, v.vendor_name, i.invoice_number, i.invoice_date, i.due_date,
                 i.total_amount, i.paid_amount, i.outstanding_amount,
                 CAST(julianday('now') - julianday(i.invoice_date) AS INTEGER) AS age_days, i.status
            FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           WHERE i.status NOT IN ('CANCELLED','PAID') AND i.outstanding_amount > 0
             AND (@vendorId = 0 OR v.id = @vendorId)
             AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
           ORDER BY age_days DESC`,
    columns: [
      { key: 'vendor_name', header: 'Vendor', width: 26 },
      { key: 'invoice_number', header: 'Invoice No.', width: 22 },
      { key: 'invoice_date', header: 'Date', width: 12 },
      { key: 'due_date', header: 'Due', width: 12 },
      { key: 'total_amount', header: 'Total', width: 14 },
      { key: 'paid_amount', header: 'Paid', width: 14 },
      { key: 'outstanding_amount', header: 'Outstanding', width: 14 },
      { key: 'age_days', header: 'Age (days)', width: 11 },
      { key: 'status', header: 'Status', width: 16 },
    ],
  },
  invoices: {
    title: 'Invoice Report',
    sql: `SELECT i.invoice_number, i.invoice_date, v.vendor_name, i.booking_count,
                 i.taxable_amount, i.tax_amount, i.non_taxable_amount, i.total_amount,
                 i.paid_amount, i.outstanding_amount, i.status
            FROM invoices i JOIN vendors v ON v.id = i.vendor_id
           WHERE (@vendorId = 0 OR i.vendor_id = @vendorId)
             AND (@from='' OR i.invoice_date >= @from) AND (@to='' OR i.invoice_date <= @to)
           ORDER BY i.invoice_date DESC`,
    columns: [
      { key: 'invoice_number', header: 'Invoice No.', width: 22 },
      { key: 'invoice_date', header: 'Date', width: 12 },
      { key: 'vendor_name', header: 'Vendor', width: 26 },
      { key: 'booking_count', header: 'Bookings', width: 10 },
      { key: 'taxable_amount', header: 'Taxable', width: 14 },
      { key: 'tax_amount', header: 'Tax', width: 12 },
      { key: 'non_taxable_amount', header: 'Toll/Parking', width: 13 },
      { key: 'total_amount', header: 'Total', width: 14 },
      { key: 'paid_amount', header: 'Paid', width: 14 },
      { key: 'outstanding_amount', header: 'Outstanding', width: 14 },
      { key: 'status', header: 'Status', width: 16 },
    ],
  },
  payments: {
    title: 'Payment Report',
    sql: `SELECT p.payment_date, i.invoice_number, v.vendor_name, p.amount, p.mode,
                 p.reference_no, p.bank, p.notes
            FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN vendors v ON v.id = p.vendor_id
           WHERE (@vendorId = 0 OR p.vendor_id = @vendorId)
             AND (@from='' OR p.payment_date >= @from) AND (@to='' OR p.payment_date <= @to)
           ORDER BY p.payment_date DESC`,
    columns: [
      { key: 'payment_date', header: 'Date', width: 12 },
      { key: 'invoice_number', header: 'Invoice No.', width: 22 },
      { key: 'vendor_name', header: 'Vendor', width: 26 },
      { key: 'amount', header: 'Amount', width: 14 },
      { key: 'mode', header: 'Mode', width: 16 },
      { key: 'reference_no', header: 'Reference', width: 20 },
      { key: 'bank', header: 'Bank', width: 18 },
      { key: 'notes', header: 'Notes', width: 30 },
    ],
  },
  'daily-bookings': {
    title: 'Daily Booking Report',
    sql: `SELECT b.travel_date, b.booking_code, v.vendor_name, b.passenger_name, b.passenger_mobile,
                 b.pickup_location, b.drop_location, b.vehicle_type, b.vehicle_number,
                 c.total_amount, b.booking_status, b.billing_status
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY b.travel_date DESC, b.id DESC`,
    columns: [
      { key: 'travel_date', header: 'Travel Date', width: 12 },
      { key: 'booking_code', header: 'Booking ID', width: 16 },
      { key: 'vendor_name', header: 'Vendor', width: 22 },
      { key: 'passenger_name', header: 'Passenger', width: 22 },
      { key: 'passenger_mobile', header: 'Mobile', width: 14 },
      { key: 'pickup_location', header: 'Pickup', width: 30 },
      { key: 'drop_location', header: 'Drop', width: 30 },
      { key: 'vehicle_type', header: 'Vehicle', width: 16 },
      { key: 'vehicle_number', header: 'Vehicle No.', width: 14 },
      { key: 'total_amount', header: 'Amount', width: 13 },
      { key: 'booking_status', header: 'Booking', width: 13 },
      { key: 'billing_status', header: 'Billing', width: 13 },
    ],
  },
  'monthly-billing': {
    title: 'Monthly Billing Report',
    sql: `SELECT strftime('%Y-%m', b.travel_date) AS month, COUNT(b.id) AS bookings,
                 COALESCE(SUM(c.taxable_amount),0) AS taxable, COALESCE(SUM(c.tax_amount),0) AS tax,
                 COALESCE(SUM(c.non_taxable_amount),0) AS toll_parking,
                 COALESCE(SUM(c.total_amount),0) AS total
            FROM bookings b LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.booking_status NOT IN ('CANCELLED','INQUIRY')
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           GROUP BY month ORDER BY month DESC`,
    columns: [
      { key: 'month', header: 'Month', width: 12 },
      { key: 'bookings', header: 'Bookings', width: 11 },
      { key: 'taxable', header: 'Taxable', width: 14 },
      { key: 'tax', header: 'Tax', width: 13 },
      { key: 'toll_parking', header: 'Toll/Parking', width: 13 },
      { key: 'total', header: 'Total', width: 14 },
    ],
  },
  'pending-billing': {
    title: 'Pending Billing Report',
    sql: `SELECT b.booking_code, b.travel_date, v.vendor_name, b.passenger_name,
                 b.pickup_location, b.drop_location, c.total_amount, b.billing_status
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
            LEFT JOIN booking_charges c ON c.booking_id = b.id
           WHERE b.billing_status IN ('PENDING','READY') AND b.booking_status NOT IN ('CANCELLED','DRAFT','INQUIRY')
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY v.vendor_name, b.travel_date`,
    columns: [
      { key: 'booking_code', header: 'Booking ID', width: 16 },
      { key: 'travel_date', header: 'Travel Date', width: 12 },
      { key: 'vendor_name', header: 'Vendor', width: 24 },
      { key: 'passenger_name', header: 'Passenger', width: 22 },
      { key: 'pickup_location', header: 'Pickup', width: 30 },
      { key: 'drop_location', header: 'Drop', width: 30 },
      { key: 'total_amount', header: 'Amount', width: 14 },
      { key: 'billing_status', header: 'Status', width: 12 },
    ],
  },
  'cancelled-bookings': {
    title: 'Cancelled Bookings Report',
    sql: `SELECT b.booking_code, b.travel_date, v.vendor_name, b.passenger_name,
                 b.pickup_location, b.drop_location, b.remarks, b.updated_at
            FROM bookings b JOIN vendors v ON v.id = b.vendor_id
           WHERE b.booking_status = 'CANCELLED'
             AND (@vendorId = 0 OR b.vendor_id = @vendorId)
             AND (@from='' OR b.travel_date >= @from) AND (@to='' OR b.travel_date <= @to)
           ORDER BY b.travel_date DESC`,
    columns: [
      { key: 'booking_code', header: 'Booking ID', width: 16 },
      { key: 'travel_date', header: 'Travel Date', width: 12 },
      { key: 'vendor_name', header: 'Vendor', width: 24 },
      { key: 'passenger_name', header: 'Passenger', width: 22 },
      { key: 'pickup_location', header: 'Pickup', width: 28 },
      { key: 'drop_location', header: 'Drop', width: 28 },
      { key: 'remarks', header: 'Remarks', width: 30 },
      { key: 'updated_at', header: 'Cancelled On', width: 20 },
    ],
  },
};

function runReport(key: string, params: any) {
  const def = REPORTS[key];
  if (!def) return null;
  return { def, rows: q.all<any>(def.sql, params) };
}

router.get('/', requirePermission('reports.view'), (_req, res) => {
  res.json({
    data: Object.entries(REPORTS).map(([key, d]) => ({ key, title: d.title })),
  });
});

router.get('/:key', requirePermission('reports.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = { from: p.from ?? '', to: p.to ?? '', vendorId: p.vendorId ? Number(p.vendorId) : 0 };
  const result = runReport(req.params.key, params);
  if (!result) return res.status(404).json({ error: `Unknown report "${req.params.key}".` });

  res.json({ title: result.def.title, columns: result.def.columns, data: result.rows, filters: params });
});

/** Export any report as XLSX or CSV. */
router.get('/:key/export', requirePermission('reports.view'), async (req, res) => {
  const p = req.query as Record<string, string>;
  const params = { from: p.from ?? '', to: p.to ?? '', vendorId: p.vendorId ? Number(p.vendorId) : 0 };
  const result = runReport(req.params.key, params);
  if (!result) return res.status(404).json({ error: `Unknown report "${req.params.key}".` });

  const format = String(p.format ?? 'xlsx').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  const fileBase = `${req.params.key}_${stamp}`;

  if (format === 'csv') {
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      result.def.columns.map((c) => esc(c.header)).join(','),
      ...result.rows.map((r) => result.def.columns.map((c) => esc(r[c.key])).join(',')),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
    return res.send('﻿' + lines.join('\r\n'));
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gupta Tours & Travels';
  const ws = wb.addWorksheet(result.def.title.slice(0, 31));

  ws.mergeCells(1, 1, 1, result.def.columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Gupta Tours & Travels — ${result.def.title}`;
  titleCell.font = { bold: true, size: 13, color: { argb: 'FF0B2C45' } };
  titleCell.alignment = { horizontal: 'center' };

  ws.mergeCells(2, 1, 2, result.def.columns.length);
  const sub = ws.getCell(2, 1);
  sub.value = `Period: ${params.from || 'all'} to ${params.to || 'all'}    Generated: ${new Date().toLocaleString('en-IN')}`;
  sub.font = { size: 9, italic: true };
  sub.alignment = { horizontal: 'center' };

  const headerRow = ws.getRow(4);
  result.def.columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2C45' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getColumn(i + 1).width = c.width ?? 16;
  });
  headerRow.commit();

  result.rows.forEach((r, ri) => {
    const row = ws.getRow(5 + ri);
    result.def.columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const v = r[c.key];
      cell.value = v ?? '';
      if (typeof v === 'number' && /amount|total|taxable|tax|paid|outstanding|parking/i.test(c.key)) {
        cell.numFmt = '#,##0.00';
      }
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD5DEE5' } },
        left: { style: 'thin', color: { argb: 'FFD5DEE5' } },
        bottom: { style: 'thin', color: { argb: 'FFD5DEE5' } },
        right: { style: 'thin', color: { argb: 'FFD5DEE5' } },
      };
    });
    row.commit();
  });

  ws.views = [{ state: 'frozen', ySplit: 4 }];
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: result.def.columns.length } };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;
