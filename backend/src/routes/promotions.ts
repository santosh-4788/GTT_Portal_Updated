/**
 * Festival & event ads (Admin -> Festival ads) and their public feed.
 *
 * The office writes an ad - a title, its own words, a few photos - and gives
 * it a window. The website shows every active ad whose window includes today
 * (India time). Any ad can be hidden or deleted at any moment.
 *
 * Built-in festivals for the year ahead come from services/festivalCalendar.ts
 * and behave exactly like ads the office wrote.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, isoDate } from '../utils/validate';

export const THEMES = ['saffron', 'gold', 'red', 'pink', 'purple', 'indigo', 'blue', 'green', 'tricolour'] as const;
const KINDS = ['FESTIVAL', 'EVENT', 'OFFER'] as const;
const MAX_IMAGES = 6;
const MAX_BYTES = 4 * 1024 * 1024;
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Today in India, YYYY-MM-DD - the window is a calendar date, not a UTC one. */
export const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

interface Row {
  id: number; seed_key: string | null; kind: string; title: string; title_local: string | null;
  headline: string | null; message: string | null; cta_label: string | null; cta_link: string | null;
  theme: string; festival_date: string | null; festival_end: string | null;
  show_from: string; show_until: string; is_active: number; notes: string | null;
  sort_order: number; created_at: string; updated_at: string;
}

const imagesFor = (ids: number[]) => {
  if (!ids.length) return new Map<number, { id: number; caption: string | null }[]>();
  const rows = q.all<{ id: number; promotion_id: number; caption: string | null }>(
    `SELECT id, promotion_id, caption FROM promotion_images
      WHERE promotion_id IN (${ids.map(() => '?').join(',')})
      ORDER BY sort_order, id`, ids as any);
  const m = new Map<number, { id: number; caption: string | null }[]>();
  for (const r of rows) {
    if (!m.has(r.promotion_id)) m.set(r.promotion_id, []);
    m.get(r.promotion_id)!.push({ id: r.id, caption: r.caption });
  }
  return m;
};

const imageUrl = (id: number) => `/api/public/promotions/image/${id}`;

function status(r: Row, today = todayIST()) {
  if (!r.is_active) return 'HIDDEN';
  if (today < r.show_from) return 'UPCOMING';
  if (today > r.show_until) return 'ENDED';
  return 'LIVE';
}

function shape(r: Row, imgs: { id: number; caption: string | null }[] = [], admin = false) {
  const base = {
    id: r.id, kind: r.kind, title: r.title, titleLocal: r.title_local, headline: r.headline,
    message: r.message, ctaLabel: r.cta_label, ctaLink: r.cta_link, theme: r.theme,
    festivalDate: r.festival_date, festivalEnd: r.festival_end,
    showFrom: r.show_from, showUntil: r.show_until,
    images: imgs.map((i) => ({ id: i.id, url: imageUrl(i.id), caption: i.caption })),
  };
  return admin
    ? { ...base, active: !!r.is_active, notes: r.notes, builtIn: !!r.seed_key, status: status(r), updatedAt: r.updated_at }
    : base;
}

/* ===================================================================== public */
export const publicPromotions = Router();

publicPromotions.get('/', (_req, res) => {
  const today = todayIST();
  const rows = q.all<Row>(
    `SELECT * FROM promotions
      WHERE is_active = 1 AND show_from <= @today AND show_until >= @today
      ORDER BY sort_order, COALESCE(festival_date, show_until), id`, { today });
  const imgs = imagesFor(rows.map((r) => r.id));
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ today, data: rows.map((r) => shape(r, imgs.get(r.id))) });
});

publicPromotions.get('/image/:id(\\d+)', (req, res) => {
  const img = q.get<{ mime: string; data: Buffer }>(
    'SELECT mime, data FROM promotion_images WHERE id = @id', { id: Number(req.params.id) });
  if (!img) return res.status(404).json({ error: 'Image not found.' });
  res.set('Content-Type', img.mime);
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.send(Buffer.from(img.data));
});

/* ====================================================================== admin */
const router = Router();
router.use(requireAuth);

const VIEW = requirePermission('settings.view');
const EDIT = requirePermission('settings.update');

const text = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

const promoSchema = z.object({
  kind: z.enum(KINDS).default('FESTIVAL'),
  title: z.string().trim().min(2, 'Give the ad a title.').max(80),
  titleLocal: text(40),
  headline: text(140),
  message: text(1200),
  ctaLabel: text(40),
  ctaLink: text(300).refine((v) => !v || /^(https?:\/\/|tel:|\/)/.test(v), 'The button link must start with https://, tel: or /'),
  theme: z.enum(THEMES).default('saffron'),
  festivalDate: isoDate.optional().nullable().or(z.literal('').transform(() => null)),
  festivalEnd: isoDate.optional().nullable().or(z.literal('').transform(() => null)),
  showFrom: isoDate,
  showUntil: isoDate,
  active: z.boolean().default(true),
  notes: text(500),
}).refine((b) => b.showUntil >= b.showFrom, { message: 'The last day to show it is before the first day.', path: ['showUntil'] });

type PromoBody = z.infer<typeof promoSchema>;

const params = (b: PromoBody) => ({
  kind: b.kind, title: b.title, title_local: b.titleLocal ?? null, headline: b.headline ?? null,
  message: b.message ?? null, cta_label: b.ctaLabel ?? null, cta_link: b.ctaLink ?? null, theme: b.theme,
  festival_date: b.festivalDate ?? null, festival_end: b.festivalEnd ?? null,
  show_from: b.showFrom, show_until: b.showUntil, is_active: b.active ? 1 : 0, notes: b.notes ?? null,
});

const find = (id: number) => q.get<Row>('SELECT * FROM promotions WHERE id = @id', { id });

router.get('/', VIEW, (req, res) => {
  const today = todayIST();
  const rows = q.all<Row>('SELECT * FROM promotions ORDER BY show_from, id');
  const imgs = imagesFor(rows.map((r) => r.id));
  const all = rows.map((r) => ({ ...shape(r, imgs.get(r.id), true), status: status(r, today) }));
  const want = String(req.query.status ?? 'ALL').toUpperCase();
  const counts = { LIVE: 0, UPCOMING: 0, ENDED: 0, HIDDEN: 0, ALL: all.length };
  for (const p of all) counts[p.status as keyof typeof counts]++;
  res.json({ today, counts, data: want === 'ALL' ? all : all.filter((p) => p.status === want) });
});

router.get('/:id(\\d+)', VIEW, (req, res) => {
  const r = find(Number(req.params.id));
  if (!r) return res.status(404).json({ error: 'That ad no longer exists.' });
  res.json(shape(r, imagesFor([r.id]).get(r.id), true));
});

router.post('/', EDIT, validateBody(promoSchema), (req, res) => {
  const b = req.body as PromoBody;
  const info = q.run(
    `INSERT INTO promotions (kind, title, title_local, headline, message, cta_label, cta_link, theme,
        festival_date, festival_end, show_from, show_until, is_active, notes, created_by)
     VALUES (@kind, @title, @title_local, @headline, @message, @cta_label, @cta_link, @theme,
        @festival_date, @festival_end, @show_from, @show_until, @is_active, @notes, @user)`,
    { ...params(b), user: req.user?.id ?? null });
  const id = Number(info.lastInsertRowid);
  audit(req, 'PROMOTION_CREATED', { entityType: 'promotion', entityId: id, description: `Festival ad "${b.title}" (${b.showFrom} to ${b.showUntil})` });
  res.status(201).json(shape(find(id)!, [], true));
});

router.put('/:id(\\d+)', EDIT, validateBody(promoSchema), (req, res) => {
  const id = Number(req.params.id);
  if (!find(id)) return res.status(404).json({ error: 'That ad no longer exists.' });
  const b = req.body as PromoBody;
  q.run(
    `UPDATE promotions SET kind=@kind, title=@title, title_local=@title_local, headline=@headline,
        message=@message, cta_label=@cta_label, cta_link=@cta_link, theme=@theme,
        festival_date=@festival_date, festival_end=@festival_end, show_from=@show_from,
        show_until=@show_until, is_active=@is_active, notes=@notes, updated_at=datetime('now')
      WHERE id=@id`, { ...params(b), id });
  audit(req, 'PROMOTION_UPDATED', { entityType: 'promotion', entityId: id, description: `Festival ad "${b.title}" saved` });
  res.json(shape(find(id)!, imagesFor([id]).get(id), true));
});

router.patch('/:id(\\d+)/active', EDIT, validateBody(z.object({ active: z.boolean() })), (req, res) => {
  const id = Number(req.params.id);
  const r = find(id);
  if (!r) return res.status(404).json({ error: 'That ad no longer exists.' });
  q.run(`UPDATE promotions SET is_active=@a, updated_at=datetime('now') WHERE id=@id`, { a: req.body.active ? 1 : 0, id });
  audit(req, 'PROMOTION_UPDATED', { entityType: 'promotion', entityId: id, description: `Festival ad "${r.title}" ${req.body.active ? 'shown' : 'hidden'}` });
  res.json(shape(find(id)!, imagesFor([id]).get(id), true));
});

router.delete('/:id(\\d+)', EDIT, (req, res) => {
  const id = Number(req.params.id);
  const r = find(id);
  if (!r) return res.status(404).json({ error: 'That ad no longer exists.' });
  getDb().transaction(() => {
    q.run('DELETE FROM promotion_images WHERE promotion_id = @id', { id });
    q.run('DELETE FROM promotions WHERE id = @id', { id });
  })();
  audit(req, 'PROMOTION_DELETED', { entityType: 'promotion', entityId: id, description: `Festival ad "${r.title}" deleted` });
  res.json({ ok: true });
});

/* --- photos ---------------------------------------------------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_IMAGES },
  fileFilter: (_req, file, cb) => {
    if (!MIMES.includes(file.mimetype)) {
      return cb(Object.assign(new Error('Only JPG, PNG, WEBP or GIF photos can be added.'), { status: 400 }));
    }
    cb(null, true);
  },
});

function takeFiles(req: Request, res: Response, next: NextFunction) {
  upload.array('photos', MAX_IMAGES)(req, res, (err: any) => {
    if (!err) return next();
    if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Each photo must be 4 MB or smaller.' });
    if (err?.code === 'LIMIT_FILE_COUNT' || err?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Add up to ${MAX_IMAGES} photos at a time.` });
    }
    return res.status(err.status ?? 400).json({ error: err.message ?? 'The photos could not be read.' });
  });
}

router.post('/:id(\\d+)/images', EDIT, takeFiles, (req, res) => {
  const id = Number(req.params.id);
  const r = find(id);
  if (!r) return res.status(404).json({ error: 'That ad no longer exists.' });
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one photo.' });
  const have = q.get<{ n: number; top: number | null }>(
    'SELECT COUNT(*) AS n, MAX(sort_order) AS top FROM promotion_images WHERE promotion_id = @id', { id })!;
  if (have.n + files.length > MAX_IMAGES) {
    return res.status(400).json({ error: `An ad can carry ${MAX_IMAGES} photos. It has ${have.n}; remove some first.` });
  }
  const ins = getDb().prepare(
    `INSERT INTO promotion_images (promotion_id, file_name, mime, size, data, sort_order) VALUES (?, ?, ?, ?, ?, ?)`);
  getDb().transaction(() => {
    files.forEach((f, i) => ins.run(id, f.originalname, f.mimetype, f.size, f.buffer, (have.top ?? 0) + i + 1));
  })();
  q.run(`UPDATE promotions SET updated_at=datetime('now') WHERE id=@id`, { id });
  audit(req, 'PROMOTION_UPDATED', { entityType: 'promotion', entityId: id, description: `${files.length} photo(s) added to "${r.title}"` });
  res.status(201).json(shape(find(id)!, imagesFor([id]).get(id), true));
});

router.put('/:id(\\d+)/images/:img(\\d+)', EDIT, validateBody(z.object({ caption: text(120), first: z.boolean().optional() })), (req, res) => {
  const id = Number(req.params.id);
  const img = Number(req.params.img);
  if (!q.get('SELECT 1 FROM promotion_images WHERE id=@img AND promotion_id=@id', { id, img })) {
    return res.status(404).json({ error: 'That photo no longer exists.' });
  }
  q.run('UPDATE promotion_images SET caption=@c WHERE id=@img', { c: req.body.caption ?? null, img });
  if (req.body.first) {
    q.run('UPDATE promotion_images SET sort_order = sort_order + 1 WHERE promotion_id=@id', { id });
    q.run('UPDATE promotion_images SET sort_order = 0 WHERE id=@img', { img });
  }
  res.json(shape(find(id)!, imagesFor([id]).get(id), true));
});

router.delete('/:id(\\d+)/images/:img(\\d+)', EDIT, (req, res) => {
  const id = Number(req.params.id);
  const img = Number(req.params.img);
  const r = find(id);
  if (!r) return res.status(404).json({ error: 'That ad no longer exists.' });
  q.run('DELETE FROM promotion_images WHERE id=@img AND promotion_id=@id', { id, img });
  audit(req, 'PROMOTION_UPDATED', { entityType: 'promotion', entityId: id, description: `Photo removed from "${r.title}"` });
  res.json(shape(find(id)!, imagesFor([id]).get(id), true));
});

export default router;
