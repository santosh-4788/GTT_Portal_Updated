import { Router } from 'express';
import { q, getDb } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import {
  mailConfig, mailDisabledReason, resetMailTransport, resendLogged, sendMail, verifyMailbox,
} from '../services/mailer';
import { layout } from '../services/emailTemplates';

const router = Router();
router.use(requireAuth);

/**
 * A secret must never be readable from a screen.
 *
 * The Gmail App Password can be stored in Settings for offices that would
 * rather not edit a .env file, but it goes out masked — the UI shows that one
 * is set without showing what it is, and saving the mask back is ignored.
 */
export const MASK = '••••••••••••';
const isSecret = (key: string) => /password|secret|apikey|token/i.test(key);

function maskRow(r: any) {
  if (!isSecret(r.key)) return r;
  return { ...r, value: r.value ? MASK : '', is_secret: true, is_set: !!r.value };
}

router.get('/', requirePermission('settings.view'), (_req, res) => {
  const rows = q.all<any>('SELECT * FROM settings ORDER BY category, key').map(maskRow);
  const grouped: Record<string, any[]> = {};
  for (const r of rows) (grouped[r.category] ??= []).push(r);
  res.json({ data: rows, grouped });
});

router.put('/', requirePermission('settings.update'), (req, res) => {
  const updates = req.body?.settings as Record<string, string> | undefined;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Nothing to save.' });
  }

  const known = new Set(q.all<any>('SELECT key FROM settings').map((r) => r.key));
  const unknown = Object.keys(updates).filter((k) => !known.has(k));
  if (unknown.length) {
    return res.status(400).json({ error: `Unknown setting(s): ${unknown.join(', ')}` });
  }

  const changed: string[] = [];
  getDb().transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      // The masked placeholder means "leave the stored secret alone".
      if (isSecret(key) && String(value) === MASK) continue;
      q.run(
        `UPDATE settings SET value = @v, updated_at = datetime('now'), updated_by = @u WHERE key = @k`,
        { v: String(value ?? ''), u: req.user!.id, k: key }
      );
      changed.push(key);
    }
  })();

  // Anything under Email changes how mail is sent, so drop the cached SMTP
  // connection and let the next message build a fresh one.
  if (changed.some((k) => k.startsWith('email.'))) resetMailTransport();

  audit(req, 'SETTINGS_CHANGED', {
    entityType: 'settings',
    // Secrets are named in the audit trail but never valued.
    description: `Updated ${changed.length} setting(s): ${changed.join(', ')}`,
  });
  res.json({
    ok: true,
    data: q.all<any>('SELECT * FROM settings ORDER BY category, key').map(maskRow),
    message: changed.length ? 'Settings saved.' : 'Nothing changed.',
  });
});

/* --------------------------------------------------------------------------
   Email — status, a test message, and the outgoing log
   -------------------------------------------------------------------------- */

router.get('/email/status', requirePermission('settings.view'), (_req, res) => {
  const cfg = mailConfig();
  const reason = mailDisabledReason(cfg);
  const counts = q.get<any>(
    `SELECT SUM(status='SENT') AS sent, SUM(status='FAILED') AS failed, SUM(status='QUEUED') AS queued
       FROM email_log`
  );
  res.json({
    // Never the password itself, only whether one exists.
    enabled: cfg.enabled,
    reason,
    from: cfg.fromAddress,
    fromName: cfg.fromName,
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    adminInbox: cfg.adminInbox,
    passwordSet: !!cfg.password,
    passwordFromEnv: !!(process.env.MAIL_APP_PASSWORD ?? '').trim(),
    counts: { sent: counts?.sent ?? 0, failed: counts?.failed ?? 0, queued: counts?.queued ?? 0 },
  });
});

router.post('/email/verify', requirePermission('settings.update'), async (_req, res) => {
  const r = await verifyMailbox();
  res.status(r.ok ? 200 : 400).json(r);
});

router.post('/email/test', requirePermission('settings.update'), async (req, res) => {
  const cfg = mailConfig();
  const to = String(req.body?.to ?? '').trim() || cfg.adminInbox;

  const r = await sendMail({
    kind: 'ACCOUNT',
    to,
    subject: 'Test message from the Gupta Tours & Travels portal',
    html: layout({
      title: 'Email is working',
      preheader: 'A test message sent from the portal.',
      body:
        `<p style="margin:0;font-size:14px;line-height:1.7;color:#5B6E84;">` +
        `This is a test message from the portal, sent from <strong style="color:#101C2B;">${cfg.fromAddress}</strong> ` +
        `through ${cfg.host}. If you are reading it, enquiry acknowledgements, trip details and invoices ` +
        `will all reach your customers.</p>`,
    }),
    userId: req.user!.id,
  });

  audit(req, 'EMAIL_TEST', { description: `Test email to ${to} — ${r.status}` });
  res.status(r.ok ? 200 : 502).json(r.ok ? r : { error: r.message, logId: r.logId });
});

router.get('/email/log', requirePermission('settings.view'), (req, res) => {
  const p = req.query as Record<string, string>;
  const params = {
    status: p.status ?? '',
    kind: p.kind ?? '',
    search: (p.search ?? '').trim(),
    limit: Math.min(Number(p.limit ?? 50), 200),
    offset: Number(p.offset ?? 0),
  };
  const where = `
    WHERE (@status = '' OR e.status = @status)
      AND (@kind = '' OR e.kind = @kind)
      AND (@search = '' OR e.to_address LIKE '%'||@search||'%'
                        OR e.subject LIKE '%'||@search||'%'
                        OR e.trip_id LIKE '%'||@search||'%')`;

  res.json({
    // body_html is deliberately not selected — the list would be enormous.
    data: q.all<any>(
      `SELECT e.id, e.kind, e.to_address, e.from_address, e.subject, e.status, e.error,
              e.attempts, e.sent_at, e.created_at, e.trip_id, e.booking_id, e.invoice_id
         FROM email_log e ${where}
        ORDER BY e.id DESC LIMIT @limit OFFSET @offset`,
      params
    ),
    total: q.get<any>(`SELECT COUNT(*) c FROM email_log e ${where}`, params)!.c,
  });
});

router.post('/email/log/:id/resend', requirePermission('settings.update'), async (req, res) => {
  const r = await resendLogged(Number(req.params.id), req.user!.id);
  audit(req, 'EMAIL_RESENT', { description: `Resent message ${req.params.id} — ${r.status}` });
  res.status(r.ok ? 200 : 502).json(r.ok ? r : { error: r.message });
});

// --- financial years -------------------------------------------------------
router.get('/financial-years', requirePermission('settings.view', 'invoices.view'), (_req, res) => {
  res.json({ data: q.all('SELECT * FROM financial_years ORDER BY start_date DESC') });
});

router.post('/financial-years/:id/activate', requirePermission('settings.update'), (req, res) => {
  const fy = q.get<any>('SELECT * FROM financial_years WHERE id = @id', { id: req.params.id });
  if (!fy) return res.status(404).json({ error: 'Financial year not found.' });
  getDb().transaction(() => {
    q.run('UPDATE financial_years SET is_active = 0');
    q.run('UPDATE financial_years SET is_active = 1 WHERE id = @id', { id: req.params.id });
  })();
  audit(req, 'SETTINGS_CHANGED', { description: `Active financial year set to ${fy.code}` });
  res.json({ ok: true });
});

// --- vehicles --------------------------------------------------------------
router.get('/vehicles', requirePermission('settings.view', 'bookings.view'), (_req, res) => {
  res.json({ data: q.all('SELECT * FROM vehicles ORDER BY vehicle_type, vehicle_number') });
});

router.post('/vehicles', requirePermission('settings.create'), (req, res) => {
  const b = req.body ?? {};
  const number = String(b.vehicleNumber ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(number)) {
    return res.status(400).json({ error: 'Enter a valid vehicle number, e.g. MH04LQ1748.' });
  }
  if (!String(b.vehicleType ?? '').trim()) return res.status(400).json({ error: 'Vehicle type is required.' });
  if (q.get('SELECT id FROM vehicles WHERE vehicle_number = @n', { n: number })) {
    return res.status(409).json({ error: `Vehicle ${number} already exists.` });
  }
  const info = q.run(
    `INSERT INTO vehicles (vehicle_number, vehicle_type, model, seating, driver_name, driver_mobile)
     VALUES (@n, @t, @m, @s, @dn, @dm)`,
    {
      n: number, t: String(b.vehicleType).trim(), m: b.model ?? null,
      s: b.seating ? Number(b.seating) : null, dn: b.driverName ?? null, dm: b.driverMobile ?? null,
    }
  );
  res.status(201).json({ data: q.get('SELECT * FROM vehicles WHERE id = @id', { id: info.lastInsertRowid }) });
});

/* --------------------------------------------------------------------------
   Drivers.

   The roster the office allots from. A driver's name and number still get
   copied onto the booking when they are assigned — that is what the invoice and
   the customer's email print, and it must not change retrospectively if the
   driver later leaves or changes their number.
   -------------------------------------------------------------------------- */
router.get('/drivers', requirePermission('settings.view', 'bookings.view'), (req, res) => {
  const includeInactive = String(req.query.all ?? '') === '1';
  res.json({
    data: q.all(
      `SELECT d.*, v.vehicle_number AS default_vehicle_number,
              (SELECT COUNT(*) FROM bookings b WHERE b.driver_id = d.id) AS trip_count
         FROM drivers d
         LEFT JOIN vehicles v ON v.id = d.default_vehicle_id
        ${includeInactive ? '' : 'WHERE d.is_active = 1'}
        ORDER BY d.is_active DESC, d.full_name`
    ),
  });
});

function readDriver(body: any) {
  const name = String(body?.fullName ?? '').trim();
  const mobile = String(body?.mobile ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (name.length < 2) return { error: 'Enter the driver\'s full name.' };
  if (!/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a valid 10-digit mobile number for the driver.' };
  return {
    values: {
      n: name,
      m: mobile,
      am: String(body?.altMobile ?? '').replace(/\D/g, '') || null,
      lic: String(body?.licenceNumber ?? '').trim().toUpperCase() || null,
      exp: String(body?.licenceExpiry ?? '').trim() || null,
      badge: String(body?.badgeNumber ?? '').trim() || null,
      addr: String(body?.address ?? '').trim() || null,
      lang: String(body?.languages ?? '').trim() || null,
      years: body?.experienceYears ? Number(body.experienceYears) : null,
      veh: body?.defaultVehicleId ? Number(body.defaultVehicleId) : null,
      notes: String(body?.notes ?? '').trim() || null,
    },
  };
}

router.post('/drivers', requirePermission('settings.create', 'bookings.create'), (req, res) => {
  const parsed = readDriver(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const dup = q.get<any>(
    'SELECT id, full_name FROM drivers WHERE mobile = @m', { m: parsed.values.m }
  );
  if (dup) return res.status(409).json({ error: `${dup.full_name} is already on the roster with that number.` });

  const info = q.run(
    `INSERT INTO drivers (full_name, mobile, alt_mobile, licence_number, licence_expiry, badge_number,
        address, languages, experience_years, default_vehicle_id, notes)
     VALUES (@n, @m, @am, @lic, @exp, @badge, @addr, @lang, @years, @veh, @notes)`,
    parsed.values
  );
  audit(req, 'DRIVER_ADDED', {
    entityType: 'driver', entityId: Number(info.lastInsertRowid),
    description: `${parsed.values.n} (${parsed.values.m})`,
  });
  res.status(201).json({ data: q.get('SELECT * FROM drivers WHERE id = @id', { id: info.lastInsertRowid }) });
});

router.put('/drivers/:id', requirePermission('settings.update', 'bookings.update'), (req, res) => {
  const existing = q.get<any>('SELECT * FROM drivers WHERE id = @id', { id: req.params.id });
  if (!existing) return res.status(404).json({ error: 'That driver is not on the roster.' });

  const parsed = readDriver(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });

  const dup = q.get<any>(
    'SELECT id, full_name FROM drivers WHERE mobile = @m AND id <> @id',
    { m: parsed.values.m, id: req.params.id }
  );
  if (dup) return res.status(409).json({ error: `${dup.full_name} already uses that number.` });

  q.run(
    `UPDATE drivers SET full_name=@n, mobile=@m, alt_mobile=@am, licence_number=@lic,
            licence_expiry=@exp, badge_number=@badge, address=@addr, languages=@lang,
            experience_years=@years, default_vehicle_id=@veh, notes=@notes,
            is_active=@active, updated_at=datetime('now')
      WHERE id=@id`,
    { ...parsed.values, active: req.body?.isActive === false ? 0 : 1, id: req.params.id }
  );
  audit(req, 'DRIVER_UPDATED', { entityType: 'driver', entityId: Number(req.params.id), description: parsed.values.n });
  res.json({ data: q.get('SELECT * FROM drivers WHERE id = @id', { id: req.params.id }) });
});

router.delete('/drivers/:id', requirePermission('settings.delete'), (req, res) => {
  const used = q.get<any>('SELECT COUNT(*) c FROM bookings WHERE driver_id = @id', { id: req.params.id })!.c;
  if (used > 0) {
    q.run(`UPDATE drivers SET is_active = 0, updated_at = datetime('now') WHERE id = @id`, { id: req.params.id });
    return res.json({
      ok: true,
      message: 'This driver has trips against their name, so they were marked inactive instead of deleted.',
    });
  }
  q.run('DELETE FROM drivers WHERE id = @id', { id: req.params.id });
  res.json({ ok: true });
});

router.delete('/vehicles/:id', requirePermission('settings.delete'), (req, res) => {
  const used = q.get<any>('SELECT COUNT(*) c FROM bookings WHERE vehicle_id = @id', { id: req.params.id })!.c;
  if (used > 0) {
    q.run('UPDATE vehicles SET is_active = 0 WHERE id = @id', { id: req.params.id });
    return res.json({ ok: true, message: 'Vehicle is used on existing bookings, so it was deactivated instead of deleted.' });
  }
  q.run('DELETE FROM vehicles WHERE id = @id', { id: req.params.id });
  res.json({ ok: true });
});

export default router;
