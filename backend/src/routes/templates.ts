import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { q } from '../db';
import { config } from '../config';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { generateXlsx, generatePdf, TemplateMapping } from '../services/invoiceEngine';
import { buildInvoiceContext } from '../utils/context';
import { amountInWords } from '../services/billing';
import { ensureLocalFile, fileExistsAnywhere, persistFile, removeStoredFile } from '../services/fileStore';

const router = Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Uploads: extension allowlist + size cap + safe generated filename.
// Executables can never land here because the filter rejects anything not in the list.
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(config.paths.templates, { recursive: true });
      cb(null, config.paths.templates);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const base = path
        .basename(file.originalname, path.extname(file.originalname))
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .slice(0, 60);
      cb(null, `${Date.now()}_${base}${ext}`);
    },
  }),
  limits: { fileSize: config.upload.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.upload.allowedExtensions.includes(ext)) {
      // Same reason as the rate importer: an untagged Error becomes a 500 and
      // this carefully written message is replaced by "something went wrong".
      const e: any = new Error(
        `"${ext || 'this file type'}" is not allowed. Upload one of: ${config.upload.allowedExtensions.join(', ')}`
      );
      e.status = 400;
      return cb(e);
    }
    cb(null, true);
  },
});

const fileTypeFor = (ext: string): string => {
  switch (ext.toLowerCase()) {
    case '.xlsx': case '.xlsm': case '.xls': return 'xlsx';
    case '.docx': case '.doc': return 'docx';
    case '.pdf': return 'pdf_static';
    default: return 'other';
  }
};

// ---------------------------------------------------------------------------
router.get('/', requirePermission('settings.view', 'invoices.view'), (_req, res) => {
  const data = q.all<any>(
    `SELECT t.*, (SELECT COUNT(*) FROM vendors v WHERE v.invoice_template_id = t.id) AS vendor_count,
            (SELECT COUNT(*) FROM invoices i WHERE i.template_id = t.id) AS invoice_count
       FROM invoice_templates t ORDER BY t.is_active DESC, t.name`
  );
  // Flag templates whose file has gone missing so the UI can warn before generation fails.
  for (const t of data) {
    t.file_exists = fileExistsAnywhere(path.join(config.paths.templates, t.file_name));
  }
  res.json({ data, libreOffice: !!require('../services/invoiceEngine').libreOfficeAvailable() });
});

router.get('/:id', requirePermission('settings.view', 'invoices.view'), (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  const vendors = q.all<any>(
    'SELECT id, code, vendor_name FROM vendors WHERE invoice_template_id = @id', { id: req.params.id }
  );
  res.json({
    data: t,
    vendors,
    fileExists: fileExistsAnywhere(path.join(config.paths.templates, t.file_name)),
  });
});

/** Inspect an uploaded workbook so the mapping editor can show real cell contents. */
router.get('/:id/inspect', requirePermission('settings.view'), async (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  if (t.file_type !== 'xlsx') {
    return res.status(400).json({ error: 'Cell inspection is only available for Excel templates.' });
  }

  const file = path.join(config.paths.templates, t.file_name);
  if (!ensureLocalFile(file)) return res.status(404).json({ error: 'The template file is missing from disk.' });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = wb.worksheets.map((ws) => {
    const cells: any[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 80) return;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > 20) return;
        const formula = (cell as any).formula;
        cells.push({
          address: cell.address,
          row: rowNumber,
          col: colNumber,
          value: formula ? `=${formula}` : (cell.text ?? ''),
          isFormula: !!formula,
        });
      });
    });
    return {
      name: ws.name,
      merges: (ws as any).model?.merges ?? [],
      cells,
    };
  });
  res.json({ data: { name: t.name, sheets } });
});

// ---------------------------------------------------------------------------
router.post('/', requirePermission('settings.create'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a template file to upload.' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  const name = String(req.body?.name ?? '').trim() || path.basename(req.file.originalname, ext);
  let mapping: TemplateMapping = {};
  if (req.body?.mapping) {
    try {
      mapping = JSON.parse(req.body.mapping);
    } catch {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'The field mapping is not valid JSON.' });
    }
  }

  persistFile(req.file.path);
  const info = q.run(
    `INSERT INTO invoice_templates (name, description, file_name, original_name, source_path,
        file_type, sheet_name, document_title, mode, mapping_json, is_active, created_by)
     VALUES (@name, @desc, @file, @orig, NULL, @type, @sheet, @title, @mode, @map, 1, @uid)`,
    {
      name,
      desc: String(req.body?.description ?? ''),
      file: req.file.filename,
      orig: req.file.originalname,
      type: fileTypeFor(ext),
      sheet: mapping.sheet ?? String(req.body?.sheetName ?? '') ?? null,
      title: mapping.documentTitle ?? String(req.body?.documentTitle ?? 'Tax Invoice'),
      mode: mapping.mode ?? String(req.body?.mode ?? 'single'),
      map: JSON.stringify(mapping, null, 2),
      uid: req.user!.id,
    }
  );

  audit(req, 'TEMPLATE_UPLOADED', {
    entityType: 'template', entityId: Number(info.lastInsertRowid),
    description: `Template "${name}" uploaded (${req.file.originalname})`,
  });
  res.status(201).json({
    data: q.get('SELECT * FROM invoice_templates WHERE id = @id', { id: info.lastInsertRowid }),
  });
});

router.put('/:id', requirePermission('settings.update'), (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });

  let mappingJson = t.mapping_json;
  if (req.body?.mapping !== undefined) {
    try {
      mappingJson = JSON.stringify(
        typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping,
        null, 2
      );
    } catch {
      return res.status(400).json({ error: 'The field mapping is not valid JSON.' });
    }
  }

  q.run(
    `UPDATE invoice_templates SET name = @name, description = @desc, sheet_name = @sheet,
        document_title = @title, mode = @mode, mapping_json = @map, is_active = @active,
        updated_at = datetime('now') WHERE id = @id`,
    {
      name: String(req.body?.name ?? t.name),
      desc: String(req.body?.description ?? t.description ?? ''),
      sheet: req.body?.sheetName ?? t.sheet_name,
      title: req.body?.documentTitle ?? t.document_title,
      mode: req.body?.mode ?? t.mode,
      map: mappingJson,
      active: req.body?.isActive === undefined ? t.is_active : (req.body.isActive ? 1 : 0),
      id: req.params.id,
    }
  );

  audit(req, 'TEMPLATE_UPDATED', {
    entityType: 'template', entityId: Number(req.params.id), description: `Template "${t.name}" updated`,
  });
  res.json({ data: q.get('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id }) });
});

/** Duplicate a template record (and its file) so a variant can be tweaked safely. */
router.post('/:id/duplicate', requirePermission('settings.create'), (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });

  const src = path.join(config.paths.templates, t.file_name);
  const ext = path.extname(t.file_name);
  const newFile = `${Date.now()}_copy_${path.basename(t.file_name, ext).slice(0, 40)}${ext}`;
  if (ensureLocalFile(src)) {
    fs.copyFileSync(src, path.join(config.paths.templates, newFile));
    persistFile(path.join(config.paths.templates, newFile));
  }

  const info = q.run(
    `INSERT INTO invoice_templates (name, description, file_name, original_name, source_path,
        file_type, sheet_name, document_title, mode, mapping_json, is_active, created_by)
     VALUES (@name, @desc, @file, @orig, @src, @type, @sheet, @title, @mode, @map, 1, @uid)`,
    {
      name: `${t.name} (copy)`, desc: t.description, file: newFile, orig: t.original_name,
      src: t.source_path, type: t.file_type, sheet: t.sheet_name, title: t.document_title,
      mode: t.mode, map: t.mapping_json, uid: req.user!.id,
    }
  );
  res.status(201).json({ data: q.get('SELECT * FROM invoice_templates WHERE id = @id', { id: info.lastInsertRowid }) });
});

/** Render a sample invoice from dummy data so the mapping can be verified safely. */
router.post('/:id/test', requirePermission('settings.view'), async (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });

  const mapping: TemplateMapping = JSON.parse(t.mapping_json || '{}');
  const sampleVendor = {
    id: 0, code: 'SAMPLE', vendor_name: 'Sample Vendor Pvt. Ltd.', company_name: 'Sample Vendor Pvt. Ltd.',
    billing_address: 'Sample Vendor Pvt. Ltd., Worli, Mumbai - 400018', gst_number: '27AAACS0764L1Z6',
    document_title: t.document_title, tax_mode: 'IGST', tax_rate: 5, payment_terms_days: 30,
  };
  const sampleBooking = {
    id: 0, booking_code: 'GTT-B-SAMPLE', travel_date: new Date().toISOString().slice(0, 10),
    passenger_name: 'Sample Guest', vehicle_number: 'MH04LQ1748', vehicle_type: 'Sedan/Ertiga',
    duty_type: '4H40KMS', pickup_location: 'Terminal 2, Mumbai Airport', drop_location: 'Lower Parel, Mumbai',
    base_fare: 1100, extra_km: 0, extra_km_rate: 14, extra_hours: 0, extra_hour_rate: 180,
    toll: 0, parking: 0, taxable_amount: 1100, tax_mode: 'IGST', tax_rate: 5,
    igst: 55, cgst: 0, sgst: 0, tax_amount: 55, non_taxable_amount: 0, total_amount: 1155,
  };
  const billing = {
    taxableAmount: 1100, taxMode: 'IGST', taxRate: 5, cgst: 0, sgst: 0, igst: 55,
    taxAmount: 55, nonTaxableAmount: 0, invoiceValue: 1155, totalAmount: 1155, discount: 0,
  };

  const ctx = buildInvoiceContext({
    vendor: sampleVendor,
    invoice: {
      invoiceNumber: 'GTT/SAMPLE/00000',
      invoiceDate: new Date().toISOString().slice(0, 10),
      documentTitle: t.document_title,
      amountInWords: amountInWords(1155),
    },
    bookings: [sampleBooking],
    billing,
  });

  const outDir = path.join(config.paths.invoices, '_samples');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    if (t.file_type === 'xlsx') {
      const file = path.join(config.paths.templates, t.file_name);
      if (!ensureLocalFile(file)) return res.status(404).json({ error: 'The template file is missing from disk.' });
      const out = path.join(outDir, `SAMPLE_${t.id}.xlsx`);
      const r = await generateXlsx(file, mapping, ctx, out);
      return res.json({
        ok: true, downloadUrl: `/api/templates/${t.id}/test/download`, warnings: r.warnings,
        message: 'Sample invoice generated from this template.',
      });
    }
    const out = path.join(outDir, `SAMPLE_${t.id}.pdf`);
    const r = await generatePdf(ctx, out, { title: t.document_title });
    res.json({
      ok: true, downloadUrl: `/api/templates/${t.id}/test/download`, warnings: r.warnings,
      message: 'Sample invoice generated using the built-in PDF layout.',
    });
  } catch (err: any) {
    res.status(500).json({ error: `Sample generation failed: ${err.message}` });
  }
});

router.get('/:id/test/download', requirePermission('settings.view'), (req, res) => {
  const dir = path.join(config.paths.invoices, '_samples');
  for (const ext of ['xlsx', 'pdf', 'docx']) {
    const f = path.join(dir, `SAMPLE_${req.params.id}.${ext}`);
    if (ensureLocalFile(f)) return res.download(f);
  }
  res.status(404).json({ error: 'No sample has been generated for this template yet.' });
});

/** Download the template file itself. */
router.get('/:id/download', requirePermission('settings.view'), (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  const file = path.join(config.paths.templates, t.file_name);
  if (!file.startsWith(config.paths.templates) || !ensureLocalFile(file)) {
    return res.status(404).json({ error: 'The template file is missing from disk.' });
  }
  res.download(file, t.original_name ?? t.file_name);
});

router.delete('/:id', requirePermission('settings.delete'), (req, res) => {
  const t = q.get<any>('SELECT * FROM invoice_templates WHERE id = @id', { id: req.params.id });
  if (!t) return res.status(404).json({ error: 'Template not found.' });

  const vendors = q.get<any>('SELECT COUNT(*) c FROM vendors WHERE invoice_template_id = @id', { id: req.params.id })!.c;
  const invoices = q.get<any>('SELECT COUNT(*) c FROM invoices WHERE template_id = @id', { id: req.params.id })!.c;
  if (vendors > 0) {
    return res.status(409).json({ error: `${vendors} vendor(s) still use this template. Reassign them first.` });
  }
  if (invoices > 0) {
    q.run('UPDATE invoice_templates SET is_active = 0 WHERE id = @id', { id: req.params.id });
    return res.json({ ok: true, message: 'This template has generated invoices, so it was deactivated instead of deleted.' });
  }

  const file = path.join(config.paths.templates, t.file_name);
  if (file.startsWith(config.paths.templates) && fs.existsSync(file)) fs.unlinkSync(file);
  removeStoredFile(file);
  q.run('DELETE FROM invoice_templates WHERE id = @id', { id: req.params.id });

  audit(req, 'TEMPLATE_DELETED', {
    entityType: 'template', entityId: Number(req.params.id), description: `Template "${t.name}" deleted`,
  });
  res.json({ ok: true });
});

export default router;
