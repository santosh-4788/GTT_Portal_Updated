/**
 * OnSheet — spreadsheets kept inside the portal.
 *
 * Access to a file is decided here, on every request, from two things:
 *
 *   1. Ownership and shares on the file itself:
 *        OWNER  everything, including delete
 *        MANAGE edit + share (cannot delete; cannot hand out or change MANAGE)
 *        EDIT   change cells and sheets, rename
 *        VIEW   open and download
 *
 *   2. The person's role. The onsheet.* permissions cap what a share can do:
 *      a role without onsheet.update can only VIEW, whatever the share says, and
 *      only owners holding onsheet.delete can delete. (SUPER_ADMIN holds every
 *      permission.) Nobody — the super admin included — can open a sheet that
 *      is neither theirs nor shared with them: these are personal workspaces.
 *
 * Sharing rule for MANAGE users: they may add, change and remove VIEW and EDIT
 * shares. Granting MANAGE, or changing / removing someone else's MANAGE share,
 * is for the owner only. Anybody may remove their own share (leave a file).
 */
import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import {
  blankWorkbook, validateSnapshot, countSheets, xlsxToSnapshot, csvToSnapshot,
  snapshotToXlsx, snapshotToCsv, WorkbookSnapshot,
} from '../services/onsheetXlsx';

const router = Router();
router.use(express.json({ limit: '25mb' }));
router.use(requireAuth);

const MAX_DATA_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

type Level = 'OWNER' | 'MANAGE' | 'EDIT' | 'VIEW';
const RANK: Record<Level, number> = { VIEW: 1, EDIT: 2, MANAGE: 3, OWNER: 4 };

interface FileRow {
  id: number; uid: string; name: string; owner_id: number; version: number;
  size_bytes: number; sheet_count: number; is_deleted: number;
  created_at: string; updated_at: string; updated_by: number | null;
}

const newUid = () => crypto.randomBytes(12).toString('base64url');

const has = (req: Request, code: string) =>
  req.user!.roleCode === 'SUPER_ADMIN' || req.user!.permissions.includes(code);

/** The level the share/ownership gives, capped by the person's role. */
function effectiveLevel(req: Request, file: { owner_id: number }, sharePerm: string | null): Level | null {
  let level: Level | null = file.owner_id === req.user!.id ? 'OWNER' : (sharePerm as Level | null);
  if (!level) return null;
  if (level !== 'VIEW' && !has(req, 'onsheet.update')) level = 'VIEW';
  return level;
}

/**
 * Load a file and the caller's access to it, or answer the request.
 * A file you cannot see is reported as not found, so uids cannot be probed.
 */
function loadFile(req: Request, res: Response, need: Level): { file: FileRow; level: Level } | null {
  const file = q.get<FileRow>('SELECT * FROM onsheet_files WHERE uid = @uid AND is_deleted = 0', { uid: req.params.uid });
  if (!file) {
    res.status(404).json({ error: 'That spreadsheet does not exist or has been deleted.' });
    return null;
  }
  const share = q.get<{ permission: string }>(
    'SELECT permission FROM onsheet_shares WHERE file_id = @f AND user_id = @u', { f: file.id, u: req.user!.id });
  const level = effectiveLevel(req, file, share?.permission ?? null);
  if (!level) {
    res.status(404).json({ error: 'That spreadsheet does not exist, or it has not been shared with you.' });
    return null;
  }
  if (RANK[level] < RANK[need]) {
    const what: Record<Level, string> = {
      VIEW: 'open it', EDIT: 'change it', MANAGE: 'change who it is shared with', OWNER: 'do that (only the owner can)',
    };
    res.status(403).json({
      error: `You have ${level === 'VIEW' ? 'view-only' : level.toLowerCase()} access to "${file.name}", so you cannot ${what[need]}.`,
      code: 'ONSHEET_FORBIDDEN',
      access: level,
    });
    return null;
  }
  return { file, level };
}

const userName = (id: number | null | undefined) =>
  id ? q.get<{ full_name: string }>('SELECT full_name FROM users WHERE id = @id', { id })?.full_name ?? null : null;

function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}
const nameSchema = z
  .string({ required_error: 'Give the spreadsheet a name.' })
  .transform(cleanName)
  .refine((s) => s.length >= 1, 'Give the spreadsheet a name.')
  .refine((s) => s.length <= 120, 'The name can be at most 120 characters.');

/** Serialise + check size. Returns the JSON or an error message. */
function serialise(data: unknown): { json: string; bytes: number } | { error: string; status: number } {
  const problem = validateSnapshot(data);
  if (problem) return { error: problem, status: 400 };
  const json = JSON.stringify(data);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > MAX_DATA_BYTES) {
    return { error: `This workbook is ${(bytes / 1048576).toFixed(1)} MB; the limit is 20 MB. Split it into smaller files.`, status: 413 };
  }
  return { json, bytes };
}

function insertFile(req: Request, name: string, snap: WorkbookSnapshot): { id: number; uid: string } {
  const uid = snap.id && /^[A-Za-z0-9_-]{8,40}$/.test(snap.id) && !q.get('SELECT 1 FROM onsheet_files WHERE uid = @u', { u: snap.id })
    ? snap.id : newUid();
  snap.id = uid;
  snap.name = name;
  const s = serialise(snap);
  if ('error' in s) throw Object.assign(new Error(s.error), { status: s.status });
  const info = q.run(
    `INSERT INTO onsheet_files (uid, name, owner_id, data_json, version, size_bytes, sheet_count, updated_by)
     VALUES (@uid, @name, @owner, @json, 1, @bytes, @sheets, @owner)`,
    { uid, name, owner: req.user!.id, json: s.json, bytes: s.bytes, sheets: countSheets(snap) },
  );
  return { id: Number(info.lastInsertRowid), uid };
}

/* ==========================================================================
   Listing
   ========================================================================== */

const SORTS: Record<string, string> = {
  updated_desc: 'f.updated_at DESC, f.id DESC',
  updated_asc: 'f.updated_at ASC, f.id ASC',
  name_asc: 'f.name COLLATE NOCASE ASC',
  name_desc: 'f.name COLLATE NOCASE DESC',
};

router.get('/files', requirePermission('onsheet.view'), (req, res) => {
  const scope = String(req.query.scope ?? 'all');
  if (!['mine', 'shared', 'recent', 'all'].includes(scope)) return res.status(400).json({ error: 'scope must be mine, shared, recent or all.' });
  const sortKey = String(req.query.sort ?? (scope === 'recent' ? '' : 'updated_desc'));
  if (sortKey && !SORTS[sortKey]) return res.status(400).json({ error: 'Unknown sort order.' });
  const search = String(req.query.search ?? '').trim().slice(0, 120);

  const where = ['f.is_deleted = 0', '(f.owner_id = @me OR s.id IS NOT NULL)'];
  if (scope === 'mine') where.push('f.owner_id = @me');
  if (scope === 'shared') where.push('f.owner_id <> @me AND s.id IS NOT NULL');
  if (scope === 'recent') where.push('r.opened_at IS NOT NULL');
  if (search) where.push("f.name LIKE @search ESCAPE '\\'");

  const order = scope === 'recent' && !sortKey ? 'r.opened_at DESC' : SORTS[sortKey || 'updated_desc'];
  const rows = q.all<any>(
    `SELECT f.uid, f.name, f.owner_id, ou.full_name AS owner_name, s.permission AS share_permission,
            f.created_at, f.updated_at, ub.full_name AS updated_by_name, f.version, f.size_bytes,
            f.sheet_count, r.opened_at,
            (SELECT COUNT(*) FROM onsheet_shares x WHERE x.file_id = f.id) AS share_count
       FROM onsheet_files f
       JOIN users ou ON ou.id = f.owner_id
       LEFT JOIN users ub ON ub.id = f.updated_by
       LEFT JOIN onsheet_shares s ON s.file_id = f.id AND s.user_id = @me
       LEFT JOIN onsheet_recent r ON r.file_id = f.id AND r.user_id = @me
      WHERE ${where.join(' AND ')}
      ORDER BY ${order}
      LIMIT ${scope === 'recent' ? 50 : 1000}`,
    { me: req.user!.id, search: `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%` },
  );

  res.json({
    files: rows.map((r) => ({
      uid: r.uid,
      name: r.name,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      access: effectiveLevel(req, r, r.share_permission),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      updatedByName: r.updated_by_name,
      version: r.version,
      sizeBytes: r.size_bytes,
      sheetCount: r.sheet_count,
      shareCount: r.share_count,
      openedAt: r.opened_at,
    })),
  });
});

/* ==========================================================================
   Create / open / save / rename / duplicate / delete
   ========================================================================== */

router.post(
  '/files',
  requirePermission('onsheet.create'),
  validateBody(z.object({ name: nameSchema, data: z.unknown().optional() })),
  (req, res) => {
    const { name, data } = req.body as { name: string; data?: unknown };
    let snap: WorkbookSnapshot;
    if (data !== undefined && data !== null) {
      const problem = validateSnapshot(data);
      if (problem) return res.status(400).json({ error: problem });
      snap = data as WorkbookSnapshot;
      snap.id = '';        // a copy never keeps another file's id
    } else {
      snap = blankWorkbook('', name);
    }
    const { id, uid } = insertFile(req, name, snap);
    audit(req, 'SHEET_CREATED', { entityType: 'onsheet', entityId: id, description: `Spreadsheet "${name}" created` });
    res.status(201).json({ uid, name, version: 1 });
  },
);

router.get('/files/:uid', requirePermission('onsheet.view'), (req, res) => {
  const got = loadFile(req, res, 'VIEW');
  if (!got) return;
  const { file, level } = got;
  const row = q.get<{ data_json: string }>('SELECT data_json FROM onsheet_files WHERE id = @id', { id: file.id })!;
  let data: WorkbookSnapshot;
  try {
    data = JSON.parse(row.data_json);
  } catch {
    return res.status(500).json({ error: 'This spreadsheet is damaged and cannot be opened.' });
  }
  data.id = file.uid;
  data.name = file.name;
  q.run(
    `INSERT INTO onsheet_recent (user_id, file_id, opened_at) VALUES (@u, @f, datetime('now'))
     ON CONFLICT(user_id, file_id) DO UPDATE SET opened_at = excluded.opened_at`,
    { u: req.user!.id, f: file.id },
  );
  res.json({
    uid: file.uid,
    name: file.name,
    ownerId: file.owner_id,
    ownerName: userName(file.owner_id),
    access: level,
    version: file.version,
    sizeBytes: file.size_bytes,
    sheetCount: file.sheet_count,
    createdAt: file.created_at,
    updatedAt: file.updated_at,
    updatedByName: userName(file.updated_by),
    data,
  });
});

router.put(
  '/files/:uid',
  requirePermission('onsheet.view'),
  validateBody(z.object({
    data: z.unknown(),
    baseVersion: z.number({ required_error: 'baseVersion is required.' }).int().min(1),
    force: z.boolean().optional(),
  })),
  (req, res) => {
    const got = loadFile(req, res, 'EDIT');
    if (!got) return;
    const { file } = got;
    const { data, baseVersion, force } = req.body as { data: WorkbookSnapshot; baseVersion: number; force?: boolean };
    const problem = validateSnapshot(data);
    if (problem) return res.status(400).json({ error: problem });
    data.id = file.uid;
    data.name = file.name;
    const s = serialise(data);
    if ('error' in s) return res.status(s.status).json({ error: s.error });

    const params = {
      id: file.id, json: s.json, bytes: s.bytes, sheets: countSheets(data), me: req.user!.id, base: baseVersion,
    };
    const info = force
      ? q.run(
        `UPDATE onsheet_files SET data_json = @json, size_bytes = @bytes, sheet_count = @sheets,
                version = version + 1, updated_at = datetime('now'), updated_by = @me
          WHERE id = @id AND is_deleted = 0`, params)
      : q.run(
        `UPDATE onsheet_files SET data_json = @json, size_bytes = @bytes, sheet_count = @sheets,
                version = version + 1, updated_at = datetime('now'), updated_by = @me
          WHERE id = @id AND is_deleted = 0 AND version = @base`, params);

    const now = q.get<FileRow>('SELECT * FROM onsheet_files WHERE id = @id', { id: file.id })!;
    if (!info.changes) {
      return res.status(409).json({
        error: `${userName(now.updated_by) ?? 'Someone'} saved a newer version of "${file.name}" while you were editing.`,
        code: 'VERSION_CONFLICT',
        currentVersion: now.version,
        updatedAt: now.updated_at,
        updatedBy: userName(now.updated_by),
      });
    }
    // Every autosave would flood the audit log; record the forced ones and
    // otherwise at most one entry per person per file every 10 minutes.
    const recent = q.get(
      `SELECT 1 FROM audit_logs WHERE action = 'SHEET_SAVED' AND entity_type = 'onsheet' AND entity_id = @id
          AND user_id = @me AND created_at > datetime('now', '-10 minutes')`, { id: file.id, me: req.user!.id });
    if (force || !recent) {
      audit(req, 'SHEET_SAVED', {
        entityType: 'onsheet', entityId: file.id,
        description: force
          ? `Spreadsheet "${file.name}" overwritten after a version conflict (had v${baseVersion}, server was v${file.version}; now v${now.version})`
          : `Spreadsheet "${file.name}" saved (v${now.version})`,
        meta: force ? { force: true, baseVersion, overwrittenVersion: now.version - 1 } : undefined,
      });
    }
    res.json({ ok: true, version: now.version, updatedAt: now.updated_at, sizeBytes: now.size_bytes, sheetCount: now.sheet_count });
  },
);

router.patch(
  '/files/:uid',
  requirePermission('onsheet.view'),
  validateBody(z.object({ name: nameSchema })),
  (req, res) => {
    const got = loadFile(req, res, 'EDIT');
    if (!got) return;
    const { file } = got;
    const { name } = req.body as { name: string };
    if (name === file.name) return res.json({ ok: true, name, version: file.version });
    // The name lives in its own column; the snapshot's copy is overwritten on
    // every open and save, so the version (and anyone's open editor) is untouched.
    q.run(`UPDATE onsheet_files SET name = @name, updated_at = datetime('now'), updated_by = @me WHERE id = @id`,
      { name, me: req.user!.id, id: file.id });
    audit(req, 'SHEET_RENAMED', { entityType: 'onsheet', entityId: file.id, description: `Spreadsheet "${file.name}" renamed to "${name}"` });
    res.json({ ok: true, name, version: file.version });
  },
);

router.post(
  '/files/:uid/duplicate',
  requirePermission('onsheet.create'),
  validateBody(z.object({ name: nameSchema.optional() })),
  (req, res) => {
    const got = loadFile(req, res, 'VIEW');
    if (!got) return;
    const { file } = got;
    const name = (req.body as { name?: string }).name ?? `Copy of ${file.name}`.slice(0, 120);
    const row = q.get<{ data_json: string }>('SELECT data_json FROM onsheet_files WHERE id = @id', { id: file.id })!;
    const snap = JSON.parse(row.data_json) as WorkbookSnapshot;
    snap.id = '';
    const created = insertFile(req, name, snap);
    audit(req, 'SHEET_DUPLICATED', {
      entityType: 'onsheet', entityId: created.id, description: `Spreadsheet "${file.name}" copied as "${name}"`,
    });
    res.status(201).json({ uid: created.uid, name, version: 1 });
  },
);

router.delete('/files/:uid', requirePermission('onsheet.view'), (req, res) => {
  const got = loadFile(req, res, 'OWNER');
  if (!got) return;
  if (!has(req, 'onsheet.delete')) {
    return res.status(403).json({ error: 'Your role cannot delete spreadsheets (onsheet.delete). Ask an administrator for access.' });
  }
  const { file } = got;
  q.run(`UPDATE onsheet_files SET is_deleted = 1, updated_at = datetime('now'), updated_by = @me WHERE id = @id`,
    { id: file.id, me: req.user!.id });
  audit(req, 'SHEET_DELETED', { entityType: 'onsheet', entityId: file.id, description: `Spreadsheet "${file.name}" deleted` });
  presence.delete(file.uid);
  res.json({ ok: true });
});

/* ==========================================================================
   Sharing
   ========================================================================== */

function listShares(fileId: number) {
  return q.all<any>(
    `SELECT s.user_id, u.full_name, u.email, u.is_active, s.permission, s.created_at, s.updated_at, g.full_name AS granted_by_name
       FROM onsheet_shares s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users g ON g.id = s.granted_by
      WHERE s.file_id = @f
      ORDER BY u.full_name COLLATE NOCASE`, { f: fileId },
  ).map((r) => ({
    userId: r.user_id, fullName: r.full_name, email: r.email, isActive: !!r.is_active,
    permission: r.permission, grantedByName: r.granted_by_name, createdAt: r.created_at, updatedAt: r.updated_at,
  }));
}

router.get('/files/:uid/shares', requirePermission('onsheet.view'), (req, res) => {
  const got = loadFile(req, res, 'MANAGE');
  if (!got) return;
  const { file, level } = got;
  const owner = q.get<any>('SELECT id, full_name, email FROM users WHERE id = @id', { id: file.owner_id });
  res.json({
    owner: owner ? { userId: owner.id, fullName: owner.full_name, email: owner.email } : null,
    myAccess: level,
    canGrantManage: level === 'OWNER',
    shares: listShares(file.id),
  });
});

router.put(
  '/files/:uid/shares',
  requirePermission('onsheet.view'),
  validateBody(z.object({
    userId: z.coerce.number().int().positive('Choose a person to share with.'),
    permission: z.enum(['VIEW', 'EDIT', 'MANAGE'], { errorMap: () => ({ message: 'Permission must be View, Edit or Manage.' }) }),
  })),
  (req, res) => {
    const got = loadFile(req, res, 'MANAGE');
    if (!got) return;
    const { file, level } = got;
    const { userId, permission } = req.body as { userId: number; permission: 'VIEW' | 'EDIT' | 'MANAGE' };
    if (userId === file.owner_id) return res.status(400).json({ error: 'That person owns this spreadsheet already.' });
    if (userId === req.user!.id) return res.status(400).json({ error: 'You cannot change your own access.' });
    const target = q.get<any>('SELECT id, full_name, is_active FROM users WHERE id = @id', { id: userId });
    if (!target) return res.status(404).json({ error: 'That user does not exist.' });
    if (!target.is_active) return res.status(400).json({ error: `${target.full_name} is not an active user.` });

    const existing = q.get<{ permission: string }>('SELECT permission FROM onsheet_shares WHERE file_id = @f AND user_id = @u', { f: file.id, u: userId });
    if (level !== 'OWNER' && (permission === 'MANAGE' || existing?.permission === 'MANAGE')) {
      return res.status(403).json({ error: 'Only the owner can give or change Manage access.', code: 'ONSHEET_FORBIDDEN' });
    }
    if (existing?.permission === permission) return res.json({ ok: true, shares: listShares(file.id) });

    q.run(
      `INSERT INTO onsheet_shares (file_id, user_id, permission, granted_by) VALUES (@f, @u, @p, @me)
       ON CONFLICT(file_id, user_id) DO UPDATE SET permission = excluded.permission, granted_by = excluded.granted_by,
              updated_at = datetime('now')`,
      { f: file.id, u: userId, p: permission, me: req.user!.id },
    );
    audit(req, 'SHEET_SHARED', {
      entityType: 'onsheet', entityId: file.id,
      description: existing
        ? `Spreadsheet "${file.name}": ${target.full_name} changed from ${existing.permission} to ${permission}`
        : `Spreadsheet "${file.name}" shared with ${target.full_name} (${permission})`,
    });
    res.json({ ok: true, shares: listShares(file.id) });
  },
);

router.delete('/files/:uid/shares/:userId', requirePermission('onsheet.view'), (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Invalid user.' });
  const self = userId === req.user!.id;
  const got = loadFile(req, res, self ? 'VIEW' : 'MANAGE');
  if (!got) return;
  const { file, level } = got;
  const existing = q.get<{ permission: string }>('SELECT permission FROM onsheet_shares WHERE file_id = @f AND user_id = @u', { f: file.id, u: userId });
  if (!existing) return res.status(404).json({ error: 'That person does not have access to this spreadsheet.' });
  if (!self && level !== 'OWNER' && existing.permission === 'MANAGE') {
    return res.status(403).json({ error: 'Only the owner can remove someone with Manage access.', code: 'ONSHEET_FORBIDDEN' });
  }
  q.run('DELETE FROM onsheet_shares WHERE file_id = @f AND user_id = @u', { f: file.id, u: userId });
  q.run('DELETE FROM onsheet_recent WHERE file_id = @f AND user_id = @u', { f: file.id, u: userId });
  audit(req, 'SHEET_UNSHARED', {
    entityType: 'onsheet', entityId: file.id,
    description: self
      ? `${req.user!.fullName} left spreadsheet "${file.name}"`
      : `Spreadsheet "${file.name}" no longer shared with ${userName(userId) ?? `user #${userId}`}`,
  });
  res.json({ ok: true, shares: self ? [] : listShares(file.id) });
});

router.get('/users', requirePermission('onsheet.view'), (req, res) => {
  const search = String(req.query.search ?? '').trim().slice(0, 80);
  const like = `%${search.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const rows = q.all<any>(
    `SELECT id, full_name, email FROM users
      WHERE is_active = 1 AND id <> @me
        ${search ? "AND (full_name LIKE @like ESCAPE '\\' OR email LIKE @like ESCAPE '\\')" : ''}
      ORDER BY full_name COLLATE NOCASE LIMIT 50`,
    { me: req.user!.id, like },
  );
  res.json({ users: rows.map((r) => ({ id: r.id, fullName: r.full_name, email: r.email })) });
});

/* ==========================================================================
   Import / export
   ========================================================================== */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.xlsx' && ext !== '.csv') {
      const hint = ext === '.xls' ? ' Old .xls files must be saved as .xlsx in Excel first.'
        : ext === '.xlsm' ? ' Save a copy without macros (.xlsx) and import that.' : '';
      return cb(Object.assign(new Error(`"${ext || 'That file'}" cannot be imported. Choose an .xlsx or .csv file.${hint}`), { status: 400 }));
    }
    cb(null, true);
  },
});

function uploadOne(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is larger than 15 MB. Split it or remove unused sheets and try again.' });
    if (err instanceof multer.MulterError) return res.status(400).json({ error: `Upload problem: ${err.message}. Send the file in a field called "file".` });
    return res.status(err.status ?? 400).json({ error: err.message ?? 'The upload could not be read.' });
  });
}

/** Decode CSV bytes: UTF-8 (with or without BOM), else Windows-1252 / Latin-1. */
function decodeText(buf: Buffer): { text: string; warning?: string } | null {
  const head = buf.subarray(0, Math.min(buf.length, 8192));
  // UTF-16 BOMs
  if (head[0] === 0xff && head[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le') };
  if (head.includes(0)) return null;                               // binary, not text
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch {
    return { text: new TextDecoder('latin1').decode(buf), warning: 'The file is not UTF-8; it was read as Windows-1252 (Western). Check accented characters and the ₹ sign.' };
  }
}

router.post('/import', requirePermission('onsheet.create'), uploadOne, async (req, res) => {
  const f = req.file;
  if (!f || !f.buffer?.length) return res.status(400).json({ error: 'Choose an .xlsx or .csv file to import.' });
  const ext = path.extname(f.originalname || '').toLowerCase();
  const base = cleanName(path.basename(f.originalname || 'Imported', ext)) || 'Imported';
  const parsedName = nameSchema.safeParse(req.query.name ? String(req.query.name) : base.slice(0, 120));
  if (!parsedName.success) return res.status(400).json({ error: parsedName.error.issues[0].message });
  const name = parsedName.data;

  let result;
  if (ext === '.xlsx') {
    if (!(f.buffer[0] === 0x50 && f.buffer[1] === 0x4b && f.buffer[2] === 0x03 && f.buffer[3] === 0x04)) {
      return res.status(400).json({ error: 'This is not a real .xlsx file (it may be an old .xls renamed, or damaged). Open it in Excel and save as .xlsx.' });
    }
    try {
      result = await xlsxToSnapshot(f.buffer, '', name);
    } catch (e: any) {
      const msg = String(e?.message ?? '');
      const encrypted = /encrypt|password/i.test(msg);
      return res.status(400).json({
        error: encrypted
          ? 'This workbook is password-protected. Remove the password in Excel and import it again.'
          : 'The spreadsheet could not be read. It may be damaged or password-protected — open it in Excel, save it again as .xlsx and retry.',
      });
    }
  } else {
    const decoded = decodeText(f.buffer);
    if (!decoded) return res.status(400).json({ error: 'This does not look like a CSV text file (it contains binary data).' });
    result = csvToSnapshot(decoded.text, '', name, base.slice(0, 31));
    if (decoded.warning) result.warnings.unshift(decoded.warning);
  }

  try {
    const { id, uid } = insertFile(req, name, result.snapshot);
    audit(req, 'SHEET_IMPORTED', {
      entityType: 'onsheet', entityId: id,
      description: `Spreadsheet "${name}" imported from ${f.originalname} (${result.warnings.length} warning(s))`,
      meta: result.warnings.length ? { warnings: result.warnings.slice(0, 50) } : undefined,
    });
    res.status(201).json({ uid, name, warnings: result.warnings });
  } catch (e: any) {
    res.status(e.status ?? 500).json({ error: e.message ?? 'The import could not be saved.' });
  }
});

function downloadName(name: string, ext: string) {
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'spreadsheet';
  return { ascii: safe.replace(/[^\x20-\x7e]/g, '_') + ext, utf8: encodeURIComponent(safe + ext) };
}

router.get('/files/:uid/export', requirePermission('onsheet.view'), async (req, res) => {
  const got = loadFile(req, res, 'VIEW');
  if (!got) return;
  const { file } = got;
  const format = String(req.query.format ?? 'xlsx');
  if (format !== 'xlsx' && format !== 'csv') return res.status(400).json({ error: 'format must be xlsx or csv.' });
  const row = q.get<{ data_json: string }>('SELECT data_json FROM onsheet_files WHERE id = @id', { id: file.id })!;
  const snap = JSON.parse(row.data_json) as WorkbookSnapshot;

  if (format === 'csv') {
    const sheetId = req.query.sheetId ? String(req.query.sheetId) : undefined;
    if (sheetId && !snap.sheets?.[sheetId]) return res.status(404).json({ error: 'That sheet is not in this workbook.' });
    const { csv, sheetName } = snapshotToCsv(snap, sheetId);
    const multi = (snap.sheetOrder?.length ?? 0) > 1;
    const n = downloadName(multi ? `${file.name} - ${sheetName}` : file.name, '.csv');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${n.ascii}"; filename*=UTF-8''${n.utf8}`);
    return res.send(csv);
  }

  const { buffer, warnings } = await snapshotToXlsx(snap);
  const n = downloadName(file.name, '.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${n.ascii}"; filename*=UTF-8''${n.utf8}`);
  if (warnings.length) {
    res.setHeader('X-OnSheet-Warnings', encodeURIComponent(JSON.stringify(warnings.slice(0, 20))));
    res.setHeader('Access-Control-Expose-Headers', 'X-OnSheet-Warnings, Content-Disposition');
  }
  res.send(buffer);
});

/* ==========================================================================
   Presence ("X is also editing") — in memory, per server process
   ========================================================================== */

const PRESENCE_TTL_MS = 60_000;
const presence = new Map<string, Map<number, { name: string; at: number; editing: boolean }>>();

function others(uid: string, me: number) {
  const m = presence.get(uid);
  if (!m) return [];
  const now = Date.now();
  const out: { userId: number; name: string; editing: boolean; lastSeen: string }[] = [];
  for (const [id, p] of m) {
    if (now - p.at > PRESENCE_TTL_MS) { m.delete(id); continue; }
    if (id !== me) out.push({ userId: id, name: p.name, editing: p.editing, lastSeen: new Date(p.at).toISOString() });
  }
  if (!m.size) presence.delete(uid);
  return out;
}

router.post('/files/:uid/presence', requirePermission('onsheet.view'), (req, res) => {
  const got = loadFile(req, res, 'VIEW');
  if (!got) return;
  const { file, level } = got;
  let m = presence.get(file.uid);
  if (!m) { m = new Map(); presence.set(file.uid, m); }
  if (req.body?.leaving) m.delete(req.user!.id);
  else m.set(req.user!.id, { name: req.user!.fullName, at: Date.now(), editing: RANK[level] >= RANK.EDIT });
  res.json({ others: others(file.uid, req.user!.id), version: file.version, updatedAt: file.updated_at, updatedBy: userName(file.updated_by) });
});

router.get('/files/:uid/presence', requirePermission('onsheet.view'), (req, res) => {
  const got = loadFile(req, res, 'VIEW');
  if (!got) return;
  res.json({ others: others(got.file.uid, req.user!.id), version: got.file.version });
});

/* Friendly messages for body-parser errors on this router. */
router.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'This workbook is too large to save (over 25 MB). Split it into smaller files.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request was not valid JSON.' });
  next(err);
});

export default router;
