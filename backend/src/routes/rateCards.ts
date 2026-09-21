/**
 * The Master — vendor-wise rate cards.
 *
 * One row per (vendor, vehicle class, plan). What a vendor pays for an Innova
 * on 8H/80KM is not what the next vendor pays, which is why the rate lives here
 * rather than on the vehicle or the plan.
 *
 * The reserved DIRECT vendor's rows are the retail price list. They are the
 * only ones the public site may read (see routes/public.ts) — a contract rate
 * escaping to the website would be a commercial problem, not a bug report.
 */
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import { ensureDirectVendor } from '../services/directCustomer';
import { parseRateWorkbook, TEMPLATE_COLUMNS, type ParsedRate } from '../services/rateImport';

const router = Router();
router.use(requireAuth);

/** Money that cannot go backwards, with a message an operator can act on. */
const money = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number.` })
    .min(0, `${label} cannot be negative.`)
    .max(9_999_999, `${label} looks unrealistically large — please check it.`)
    .default(0);

const rateSchema = z
  .object({
    vendorId: z.coerce.number().int().positive('Choose which vendor this rate belongs to.'),
    vehicleCategory: z.string().trim().min(2, 'Enter the vehicle class, e.g. Sedan or Innova Crysta.').max(60),
    planType: z.enum(['LOCAL', 'AIRPORT', 'OUTSTATION']).default('LOCAL'),
    planLabel: z.string().trim().min(2, 'Give the plan a name, e.g. 8H/80KM.').max(40),

    includedHours: money('Included hours'),
    includedKm: money('Included kilometres'),
    baseFare: money('Base fare'),
    extraHourRate: money('Extra hour rate'),
    extraKmRate: money('Extra kilometre rate'),

    perKmRate: money('Per kilometre rate'),
    minKmPerDay: money('Minimum kilometres per day'),
    driverAllowance: money('Driver allowance'),

    notes: z.string().trim().max(300).optional().default(''),
    isActive: z.coerce.boolean().default(true),
    displayOrder: z.coerce.number().int().min(0).max(999).default(0),
  })
  // Each plan type is priced by a different number, so a row with none of them
  // set is a row that cannot quote anything.
  .refine((d) => d.planType !== 'OUTSTATION' || d.perKmRate > 0, {
    message: 'An outstation rate needs a per-kilometre rate.',
    path: ['perKmRate'],
  })
  .refine((d) => d.planType === 'OUTSTATION' || d.baseFare > 0, {
    message: 'A local or airport rate needs a base fare.',
    path: ['baseFare'],
  });

type RateInput = z.infer<typeof rateSchema>;

/**
 * Every column carries the table alias.
 *
 * A single `r.` in front of the list only qualifies the first name, which left
 * `id` ambiguous across the join and turned the list endpoint into a 500.
 */
const COLUMNS = [
  'id', 'vendor_id', 'vehicle_category', 'plan_type', 'plan_label',
  'included_hours', 'included_km', 'base_fare', 'extra_hour_rate', 'extra_km_rate',
  'per_km_rate', 'min_km_per_day', 'driver_allowance', 'notes', 'is_active',
  'display_order', 'created_at', 'updated_at',
];
const selectFrom = (alias: string) => COLUMNS.map((c) => `${alias}.${c}`).join(', ');

// --- list, optionally for one vendor ----------------------------------------
router.get('/', requirePermission('vendors.view'), (req, res) => {
  const vendorId = req.query.vendorId ? Number(req.query.vendorId) : 0;
  const rows = q.all<any>(
    `SELECT ${selectFrom('r')}, v.vendor_name, v.code AS vendor_code
       FROM rate_cards r JOIN vendors v ON v.id = r.vendor_id
      WHERE (@vendorId = 0 OR r.vendor_id = @vendorId)
      ORDER BY v.vendor_name, r.display_order, r.vehicle_category, r.plan_label`,
    { vendorId }
  );
  res.json({ data: rows });
});

/**
 * Which vendor the website quotes from.
 *
 * The page needs this to say "these rows are public" out loud, and it creates
 * the reserved record on first use so the Master is usable on a fresh install.
 */
router.get('/public-vendor', requirePermission('vendors.view'), (_req, res) => {
  const v = ensureDirectVendor();
  res.json({ data: { id: v.id, code: v.code, vendorName: v.vendor_name } });
});

// --- create ------------------------------------------------------------------
router.post('/', requirePermission('vendors.update'), validateBody(rateSchema), (req, res) => {
  const b = req.body as RateInput;

  const vendor = q.get<any>('SELECT id, vendor_name FROM vendors WHERE id = @id', { id: b.vendorId });
  if (!vendor) return res.status(400).json({ error: 'That vendor no longer exists.' });

  const dup = q.get<any>(
    `SELECT id FROM rate_cards
      WHERE vendor_id = @v AND vehicle_category = @c AND plan_label = @p`,
    { v: b.vendorId, c: b.vehicleCategory, p: b.planLabel }
  );
  if (dup) {
    return res.status(409).json({
      error: `${vendor.vendor_name} already has a ${b.vehicleCategory} rate for ${b.planLabel}. Edit that row instead.`,
    });
  }

  const info = q.run(
    `INSERT INTO rate_cards (vendor_id, vehicle_category, plan_type, plan_label,
        included_hours, included_km, base_fare, extra_hour_rate, extra_km_rate,
        per_km_rate, min_km_per_day, driver_allowance, notes, is_active, display_order)
     VALUES (@vendorId, @vehicleCategory, @planType, @planLabel,
        @includedHours, @includedKm, @baseFare, @extraHourRate, @extraKmRate,
        @perKmRate, @minKmPerDay, @driverAllowance, @notes, @isActive, @displayOrder)`,
    { ...b, isActive: b.isActive ? 1 : 0 }
  );

  const row = q.get<any>('SELECT * FROM rate_cards WHERE id = @id', { id: info.lastInsertRowid });
  audit(req, 'RATE_CREATED', {
    entityType: 'rate_card', entityId: Number(info.lastInsertRowid),
    description: `${vendor.vendor_name} — ${b.vehicleCategory} ${b.planLabel}`,
  });
  res.status(201).json({ data: row });
});

// --- update ------------------------------------------------------------------
router.put('/:id', requirePermission('vendors.update'), validateBody(rateSchema), (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM rate_cards WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That rate row no longer exists.' });

  const b = req.body as RateInput;
  const dup = q.get<any>(
    `SELECT id FROM rate_cards
      WHERE vendor_id = @v AND vehicle_category = @c AND plan_label = @p AND id <> @id`,
    { v: b.vendorId, c: b.vehicleCategory, p: b.planLabel, id }
  );
  if (dup) {
    return res.status(409).json({ error: `Another row already covers ${b.vehicleCategory} on ${b.planLabel}.` });
  }

  q.run(
    `UPDATE rate_cards SET vendor_id=@vendorId, vehicle_category=@vehicleCategory,
        plan_type=@planType, plan_label=@planLabel, included_hours=@includedHours,
        included_km=@includedKm, base_fare=@baseFare, extra_hour_rate=@extraHourRate,
        extra_km_rate=@extraKmRate, per_km_rate=@perKmRate, min_km_per_day=@minKmPerDay,
        driver_allowance=@driverAllowance, notes=@notes, is_active=@isActive,
        display_order=@displayOrder, updated_at=datetime('now')
      WHERE id=@id`,
    { ...b, isActive: b.isActive ? 1 : 0, id }
  );

  audit(req, 'RATE_UPDATED', {
    entityType: 'rate_card', entityId: id,
    description: `${b.vehicleCategory} ${b.planLabel}`,
  });
  res.json({ data: q.get<any>('SELECT * FROM rate_cards WHERE id = @id', { id }) });
});

// --- delete ------------------------------------------------------------------
router.delete('/:id', requirePermission('vendors.delete'), (req, res) => {
  const id = Number(req.params.id);
  const existing = q.get<any>('SELECT * FROM rate_cards WHERE id = @id', { id });
  if (!existing) return res.status(404).json({ error: 'That rate row no longer exists.' });

  q.run('DELETE FROM rate_cards WHERE id = @id', { id });
  audit(req, 'RATE_DELETED', {
    entityType: 'rate_card', entityId: id,
    description: `${existing.vehicle_category} ${existing.plan_label}`,
  });
  res.json({ ok: true });
});

/**
 * Copy a whole rate card from one vendor to another.
 *
 * Setting up a new account otherwise means retyping twenty rows that differ
 * from an existing account by a few per cent. Existing rows are left alone, so
 * this cannot overwrite a negotiated rate by accident.
 */
router.post('/copy', requirePermission('vendors.update'), (req, res) => {
  const fromId = Number(req.body?.fromVendorId);
  const toId = Number(req.body?.toVendorId);
  if (!fromId || !toId || fromId === toId) {
    return res.status(400).json({ error: 'Choose two different vendors to copy between.' });
  }
  const rows = q.all<any>('SELECT * FROM rate_cards WHERE vendor_id = @id', { id: fromId });
  if (!rows.length) return res.status(400).json({ error: 'That vendor has no rates to copy.' });

  let copied = 0;
  let skipped = 0;
  getDb().transaction(() => {
    for (const r of rows) {
      const clash = q.get<any>(
        `SELECT id FROM rate_cards WHERE vendor_id = @v AND vehicle_category = @c AND plan_label = @p`,
        { v: toId, c: r.vehicle_category, p: r.plan_label }
      );
      if (clash) { skipped++; continue; }
      q.run(
        `INSERT INTO rate_cards (vendor_id, vehicle_category, plan_type, plan_label,
            included_hours, included_km, base_fare, extra_hour_rate, extra_km_rate,
            per_km_rate, min_km_per_day, driver_allowance, notes, is_active, display_order)
         VALUES (@to, @cat, @type, @label, @ih, @ik, @base, @eh, @ek, @pk, @mk, @da, @notes, @active, @order)`,
        {
          to: toId, cat: r.vehicle_category, type: r.plan_type, label: r.plan_label,
          ih: r.included_hours, ik: r.included_km, base: r.base_fare,
          eh: r.extra_hour_rate, ek: r.extra_km_rate, pk: r.per_km_rate,
          mk: r.min_km_per_day, da: r.driver_allowance, notes: r.notes,
          active: r.is_active, order: r.display_order,
        }
      );
      copied++;
    }
  })();

  audit(req, 'RATE_COPIED', {
    entityType: 'rate_card', entityId: toId,
    description: `${copied} rate(s) copied, ${skipped} already present`,
  });
  res.json({ ok: true, copied, skipped });
});

/* ===========================================================================
   Excel
   =========================================================================== */

/**
 * Uploads land in the OS temp directory, not in the project.
 *
 * A rate sheet is read once and thrown away — there is no reason to keep a copy
 * of someone's price list sitting on disk next to the invoice templates.
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, fs.mkdtempSync(path.join(os.tmpdir(), 'gtt-rates-'))),
    filename: (_req, file, cb) => cb(null, 'rates' + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.xlsx', '.xlsm', '.xls'].includes(ext)) {
      // Without a status this reaches the client as a generic 500 and the
      // operator never sees which file types are accepted.
      const e: any = new Error(`"${ext || 'That file type'}" cannot be read. Save the sheet as .xlsx and try again.`);
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  },
});

/** A blank sheet in the shape the importer reads, with the vendor codes on it. */
router.get('/template', requirePermission('vendors.view'), async (_req, res) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gupta Tours & Travels';
  const ws = wb.addWorksheet('Rates');

  ws.mergeCells(1, 1, 1, TEMPLATE_COLUMNS.length);
  const title = ws.getCell(1, 1);
  title.value = 'Gupta Tours & Travels — rate card import';
  title.font = { bold: true, size: 13, color: { argb: 'FF0B2C45' } };

  ws.mergeCells(2, 1, 2, TEMPLATE_COLUMNS.length);
  const sub = ws.getCell(2, 1);
  sub.value = 'Fill the rows below and upload this file under Master → Import from Excel. '
    + 'Leave a column blank where it does not apply.';
  sub.font = { size: 9, italic: true, color: { argb: 'FF5B6E84' } };

  const header = ws.getRow(4);
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2C45' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = c.width;
  });
  header.commit();

  const hint = ws.getRow(5);
  TEMPLATE_COLUMNS.forEach((c, i) => {
    const cell = hint.getCell(i + 1);
    cell.value = c.help;
    cell.font = { size: 8, italic: true, color: { argb: 'FF9DAAB9' } };
    cell.alignment = { wrapText: true, vertical: 'top' };
  });
  hint.commit();

  // Worked examples, one per plan type, so the shape is obvious at a glance.
  const examples = [
    ['DIRECT', 'Dzire', 'LOCAL', '8H/80KM', 8, 80, 2400, 150, 13, '', '', '', '', 'Yes'],
    ['DIRECT', 'Dzire', 'AIRPORT', 'Airport transfer', '', '', 1800, '', '', '', '', '', '', 'Yes'],
    ['DIRECT', 'Toyota Innova Crysta', 'OUTSTATION', 'Per km', '', '', '', '', '', 22, 300, 500, '', 'Yes'],
  ];
  examples.forEach((vals, ri) => {
    const row = ws.getRow(6 + ri);
    vals.forEach((v, ci) => { row.getCell(ci + 1).value = v as any; });
    row.commit();
  });

  // Second sheet: the vendor codes, so nobody has to guess them.
  const vs = wb.addWorksheet('Vendor codes');
  vs.getRow(1).values = ['Code', 'Vendor', 'Notes'];
  vs.getRow(1).font = { bold: true };
  vs.getColumn(1).width = 16; vs.getColumn(2).width = 32; vs.getColumn(3).width = 44;
  ensureDirectVendor();
  q.all<any>("SELECT code, vendor_name FROM vendors WHERE status = 'ACTIVE' ORDER BY code")
    .forEach((v, i) => {
      vs.getRow(2 + i).values = [
        v.code,
        v.vendor_name,
        v.code === 'DIRECT' ? 'Walk-in customers — these are the rates the website quotes' : '',
      ];
    });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="gtt-rate-card-template.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

/**
 * Read a workbook and either report what would happen or do it.
 *
 * The same parse drives both, so the preview cannot promise something the
 * import then does differently. `dryRun` decides which.
 */
router.post('/import', requirePermission('vendors.update'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a spreadsheet to upload.' });

  const dryRun = String(req.body?.dryRun ?? 'true') !== 'false';
  const fallbackVendorId = Number(req.body?.vendorId) || 0;

  let parsed;
  try {
    parsed = await parseRateWorkbook(req.file.path);
  } catch (err: any) {
    return res.status(400).json({ error: `That file could not be read as a spreadsheet: ${err.message}` });
  } finally {
    // The sheet has been read; there is no reason to keep it.
    fs.rm(path.dirname(req.file.path), { recursive: true, force: true }, () => {});
  }

  const vendors = q.all<any>("SELECT id, code, vendor_name FROM vendors WHERE status = 'ACTIVE'");
  const byCode = new Map(vendors.map((v) => [String(v.code).toUpperCase(), v]));
  const byName = new Map(vendors.map((v) => [String(v.vendor_name).toLowerCase(), v]));

  const resolveVendor = (text: string) => {
    const t = text.trim();
    if (!t) return fallbackVendorId ? vendors.find((v) => v.id === fallbackVendorId) : undefined;
    return byCode.get(t.toUpperCase()) ?? byName.get(t.toLowerCase());
  };

  interface Planned extends ParsedRate { vendorId: number; vendorName: string; action: 'create' | 'update' }
  const planned: Planned[] = [];
  const errors = [...parsed.errors];

  for (const row of parsed.rows) {
    const vendor = resolveVendor(row.vendorText);
    if (!vendor) {
      errors.push({
        rowNumber: row.rowNumber,
        message: row.vendorText
          ? `${row.vehicleCategory}: no active vendor matches "${row.vendorText}".`
          : `${row.vehicleCategory}: no vendor on the row and none chosen for the import.`,
      });
      continue;
    }
    const existing = q.get<any>(
      'SELECT id FROM rate_cards WHERE vendor_id = @v AND vehicle_category = @c AND plan_label = @p',
      { v: vendor.id, c: row.vehicleCategory, p: row.planLabel }
    );
    planned.push({
      ...row,
      vendorId: vendor.id,
      vendorName: vendor.vendor_name,
      action: existing ? 'update' : 'create',
    });
  }

  const summary = {
    sheetName: parsed.sheetName,
    mapped: parsed.mapped,
    ignored: parsed.ignored,
    toCreate: planned.filter((p) => p.action === 'create').length,
    toUpdate: planned.filter((p) => p.action === 'update').length,
    errors,
    rows: planned.slice(0, 200),
  };

  if (dryRun) return res.json({ ok: true, dryRun: true, ...summary });

  if (!planned.length) {
    return res.status(400).json({ error: 'Nothing in that sheet could be imported.', ...summary });
  }

  // One transaction: a half-applied rate card is worse than none.
  getDb().transaction(() => {
    for (const r of planned) {
      const params = {
        v: r.vendorId, cat: r.vehicleCategory, type: r.planType, label: r.planLabel,
        ih: r.includedHours, ik: r.includedKm, base: r.baseFare, eh: r.extraHourRate,
        ek: r.extraKmRate, pk: r.perKmRate, mk: r.minKmPerDay, da: r.driverAllowance,
        notes: r.notes, active: r.isActive ? 1 : 0,
      };
      if (r.action === 'update') {
        q.run(
          `UPDATE rate_cards SET plan_type=@type, included_hours=@ih, included_km=@ik,
              base_fare=@base, extra_hour_rate=@eh, extra_km_rate=@ek, per_km_rate=@pk,
              min_km_per_day=@mk, driver_allowance=@da, notes=@notes, is_active=@active,
              updated_at=datetime('now')
            WHERE vendor_id=@v AND vehicle_category=@cat AND plan_label=@label`,
          params
        );
      } else {
        q.run(
          `INSERT INTO rate_cards (vendor_id, vehicle_category, plan_type, plan_label,
              included_hours, included_km, base_fare, extra_hour_rate, extra_km_rate,
              per_km_rate, min_km_per_day, driver_allowance, notes, is_active)
           VALUES (@v, @cat, @type, @label, @ih, @ik, @base, @eh, @ek, @pk, @mk, @da, @notes, @active)`,
          params
        );
      }
    }
  })();

  audit(req, 'RATE_IMPORTED', {
    entityType: 'rate_card',
    description: `${summary.toCreate} added, ${summary.toUpdate} updated from ${req.file.originalname}`,
    meta: { file: req.file.originalname, errors: errors.length },
  });

  res.json({ ok: true, dryRun: false, ...summary });
});

export default router;
