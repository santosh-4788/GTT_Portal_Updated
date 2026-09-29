/**
 * The customer's own account.
 *
 * Everything a person who booked a car can do without help: create an account,
 * sign in with a password or with Google, see the trips that belong to them,
 * and download the invoices raised against those trips. Nothing here can reach
 * a vendor, a rate card or anybody else's journey.
 *
 * Google Sign-In is free: the browser gets an ID token from Google Identity
 * Services and this endpoint verifies it against Google's own tokeninfo
 * endpoint. No SDK, no library, no paid identity provider.
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { airportDirectionField } from '../services/airport';
import { q, getDb } from '../db';
import { config } from '../config';
import { validateBody, optionalMobile, requiredMobile } from '../utils/validate';
import { limiter } from '../utils/limiter';
import {
  requireCustomer, signCustomerToken, loadCustomer,
  CUSTOMER_COOKIE, customerCookieOptions, currentCustomer,
} from '../middleware/customerAuth';
import {
  createInquiryTrip, linkCustomerTrips, portalUrl, publicTrip, tripEvents, tripRow,
} from '../services/tripFlow';
import { sendMail, mailConfig } from '../services/mailer';
import { inquiryAdminEmail, inquiryCustomerEmail, welcomeEmail } from '../services/emailTemplates';
import { SOURCE_LABEL } from '../services/tripId';
import { ensureLocalFile } from '../services/fileStore';

const router = Router();

/* ==========================================================================
   Rate limits — a public login endpoint without one is an invitation
   ========================================================================== */

const authLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { error: 'Too many attempts. Please wait fifteen minutes and try again.' },
});

const MAX_FAILED = 6;
const LOCK_MINUTES = 15;

/* ==========================================================================
   Helpers
   ========================================================================== */

/**
 * Start a session.
 *
 * The httpOnly cookie is the real session and is what a same-origin browser
 * uses. The token is returned as well because the cookie is `sameSite=lax` and
 * therefore does not travel when the site is reached on a different origin to
 * the API — the dev server, or a tunnel. The staff side already works this way,
 * so both halves of the app behave the same.
 */
function issueSession(res: any, customerId: number) {
  const token = signCustomerToken(customerId);
  res.cookie(CUSTOMER_COOKIE, token, customerCookieOptions);
  q.run(`UPDATE customers SET last_login_at = datetime('now'), failed_attempts = 0, locked_until = NULL WHERE id = @id`, {
    id: customerId,
  });
  return token;
}

const passwordRule = z
  .string()
  .min(8, 'Your password must be at least 8 characters.')
  .max(200, 'That password is too long.')
  .regex(/[A-Za-z]/, 'Your password must contain a letter.')
  .regex(/\d/, 'Your password must contain a number.');

/* ==========================================================================
   Register
   ========================================================================== */

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.').max(160),
  mobile: requiredMobile('Please enter a valid 10-digit mobile number.'),
  password: passwordRule,
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'The two passwords do not match.',
  path: ['confirmPassword'],
});

router.post('/auth/register', authLimiter, validateBody(registerSchema), async (req, res) => {
  const b = req.body as z.infer<typeof registerSchema>;
  const email = b.email.trim().toLowerCase();

  const existing = q.get<any>('SELECT id, password_hash FROM customers WHERE email = @e', { e: email });
  if (existing) {
    // An account made through Google has no password. Rather than a dead end,
    // set one — the person proved they own the mailbox when Google signed
    // them in, and the alternative is a confusing "already registered" wall.
    if (!existing.password_hash) {
      q.run(
        `UPDATE customers SET password_hash = @h, full_name = @n, mobile = COALESCE(NULLIF(@m,''), mobile),
                updated_at = datetime('now') WHERE id = @id`,
        { h: bcrypt.hashSync(b.password, 12), n: b.fullName, m: b.mobile, id: existing.id }
      );
      const token = issueSession(res, existing.id);
      return res.status(200).json({
        ok: true,
        token,
        user: loadCustomer(existing.id),
        message: 'A password has been added to your Google account. You can now sign in either way.',
      });
    }
    return res.status(409).json({
      error: 'An account already exists for that email address. Sign in instead, or use a different address.',
    });
  }

  const info = q.run(
    `INSERT INTO customers (email, full_name, mobile, password_hash, email_verified)
     VALUES (@e, @n, @m, @h, 0)`,
    { e: email, n: b.fullName, m: b.mobile, h: bcrypt.hashSync(b.password, 12) }
  );
  const id = Number(info.lastInsertRowid);
  const linked = linkCustomerTrips(id, email);
  const token = issueSession(res, id);

  const mail = welcomeEmail({ customerName: b.fullName, email, portalUrl: portalUrl() });
  await sendMail({ kind: 'ACCOUNT', to: email, subject: mail.subject, html: mail.html });

  res.status(201).json({
    ok: true,
    token,
    user: loadCustomer(id),
    linkedTrips: linked,
    message: linked
      ? `Welcome. We found ${linked} earlier ${linked === 1 ? 'trip' : 'trips'} booked with this email and added ${linked === 1 ? 'it' : 'them'} to your account.`
      : 'Welcome. Your account is ready.',
  });
});

/* ==========================================================================
   Sign in with a password
   ========================================================================== */

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

router.post('/auth/login', authLimiter, validateBody(loginSchema), (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;
  const row = q.get<any>('SELECT * FROM customers WHERE email = @e', { e: email.trim().toLowerCase() });

  const generic = 'That email address or password is incorrect.';
  if (!row) return res.status(401).json({ error: generic });
  if (!row.is_active) {
    return res.status(403).json({ error: 'This account has been closed. Please call us if that is a mistake.' });
  }
  if (row.locked_until && new Date(row.locked_until + 'Z') > new Date()) {
    return res.status(423).json({
      error: `Too many failed attempts. Please try again in ${LOCK_MINUTES} minutes, or sign in with Google.`,
    });
  }
  if (!row.password_hash) {
    return res.status(400).json({
      error: 'This account was created with Google. Use the "Continue with Google" button, or register a password with the same email.',
    });
  }
  if (!bcrypt.compareSync(password, row.password_hash)) {
    const failed = (row.failed_attempts ?? 0) + 1;
    const lock = failed >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    q.run('UPDATE customers SET failed_attempts = @f, locked_until = @l WHERE id = @id',
      { f: failed, l: lock, id: row.id });
    return res.status(401).json({
      error: lock ? `${generic} The account is now locked for ${LOCK_MINUTES} minutes.` : generic,
    });
  }

  const linked = linkCustomerTrips(row.id, row.email);
  const token = issueSession(res, row.id);
  res.json({ ok: true, token, user: loadCustomer(row.id), linkedTrips: linked });
});

/* ==========================================================================
   Sign in with Google
   ========================================================================== */

interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
}

export function googleClientId(): string {
  const row = q.get<{ value: string }>("SELECT value FROM settings WHERE key = 'auth.googleClientId'");
  return (process.env.GOOGLE_CLIENT_ID ?? row?.value ?? '').trim();
}

/**
 * Verify a Google ID token.
 *
 * Google's tokeninfo endpoint checks the signature and expiry for us, which
 * keeps this to one fetch and no dependency. The audience check is ours to do
 * and is the part that matters: without it, an ID token minted for any other
 * site would be accepted here.
 */
async function verifyGoogleToken(idToken: string): Promise<GoogleProfile> {
  const clientId = googleClientId();
  if (!clientId) throw new Error('Google Sign-In is not configured on this portal yet.');
  if (typeof fetch !== 'function') throw new Error('This server build cannot verify Google sign-ins.');

  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!r.ok) throw new Error('Google could not confirm that sign-in. Please try again.');
  const p = (await r.json()) as Record<string, string>;

  const audiences = clientId.split(',').map((s) => s.trim()).filter(Boolean);
  if (!audiences.includes(p.aud)) throw new Error('That Google sign-in was issued for a different website.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss)) {
    throw new Error('That sign-in did not come from Google.');
  }
  if (Number(p.exp) * 1000 < Date.now()) throw new Error('That Google sign-in has expired. Please try again.');
  if (!p.email) throw new Error('Google did not share an email address, so an account cannot be created.');

  return {
    sub: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: String(p.email_verified) === 'true',
    name: p.name || p.given_name || p.email.split('@')[0],
    picture: p.picture ?? '',
  };
}

router.get('/auth/google/config', (_req, res) => {
  const clientId = googleClientId();
  res.json({ enabled: !!clientId, clientId: clientId.split(',')[0] ?? '' });
});

router.post('/auth/google', authLimiter, async (req, res) => {
  const idToken = String(req.body?.credential ?? req.body?.idToken ?? '').trim();
  if (!idToken) return res.status(400).json({ error: 'No Google sign-in was received. Please try again.' });

  let p: GoogleProfile;
  try {
    p = await verifyGoogleToken(idToken);
  } catch (err: any) {
    return res.status(401).json({ error: err.message });
  }

  const existing =
    q.get<any>('SELECT * FROM customers WHERE google_sub = @s', { s: p.sub }) ??
    q.get<any>('SELECT * FROM customers WHERE email = @e', { e: p.email });

  let id: number;
  let created = false;

  if (existing) {
    if (!existing.is_active) {
      return res.status(403).json({ error: 'This account has been closed. Please call us if that is a mistake.' });
    }
    id = existing.id;
    q.run(
      `UPDATE customers SET google_sub = COALESCE(google_sub, @s),
              picture_url = COALESCE(NULLIF(@pic,''), picture_url),
              email_verified = CASE WHEN @v = 1 THEN 1 ELSE email_verified END,
              updated_at = datetime('now')
        WHERE id = @id`,
      { s: p.sub, pic: p.picture, v: p.emailVerified ? 1 : 0, id }
    );
  } else {
    const info = q.run(
      `INSERT INTO customers (email, full_name, google_sub, picture_url, email_verified)
       VALUES (@e, @n, @s, @pic, @v)`,
      { e: p.email, n: p.name, s: p.sub, pic: p.picture, v: p.emailVerified ? 1 : 0 }
    );
    id = Number(info.lastInsertRowid);
    created = true;
  }

  const linked = linkCustomerTrips(id, p.email);
  const token = issueSession(res, id);

  if (created) {
    const mail = welcomeEmail({ customerName: p.name, email: p.email, portalUrl: portalUrl(), viaGoogle: true });
    await sendMail({ kind: 'ACCOUNT', to: p.email, subject: mail.subject, html: mail.html });
  }

  res.json({ ok: true, token, user: loadCustomer(id), created, linkedTrips: linked });
});

/* ==========================================================================
   Session
   ========================================================================== */

router.post('/auth/logout', (_req, res) => {
  res.clearCookie(CUSTOMER_COOKIE, { ...customerCookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

/** "Am I signed in?" - 200 either way, so a signed-out visit logs no error. */
router.get('/auth/session', (req, res) => {
  res.json({ user: currentCustomer(req) });
});

router.get('/auth/me', requireCustomer, (req, res) => {
  res.json({ user: req.customer });
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Please enter your name.').max(120),
  mobile: optionalMobile.default(''),
  company: z.string().trim().max(160).optional().default(''),
  gstin: z.string().trim().max(20).optional().default(''),
  address: z.string().trim().max(400).optional().default(''),
});

router.put('/auth/me', requireCustomer, validateBody(profileSchema), (req, res) => {
  const b = req.body as z.infer<typeof profileSchema>;
  q.run(
    `UPDATE customers SET full_name = @n, mobile = @m, company = @c, gstin = @g, address = @a,
            updated_at = datetime('now') WHERE id = @id`,
    {
      n: b.fullName, m: b.mobile, c: b.company,
      g: b.gstin.toUpperCase(), a: b.address, id: req.customer!.id,
    }
  );
  res.json({ ok: true, user: loadCustomer(req.customer!.id), message: 'Your details have been saved.' });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().optional().default(''),
  newPassword: passwordRule,
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'The two new passwords do not match.',
  path: ['confirmPassword'],
});

router.post('/auth/change-password', requireCustomer, validateBody(changePasswordSchema), (req, res) => {
  const b = req.body as z.infer<typeof changePasswordSchema>;
  const row = q.get<any>('SELECT password_hash FROM customers WHERE id = @id', { id: req.customer!.id });

  // A Google-only account is setting its first password, so there is nothing to
  // check against; one that already has a password must prove it.
  if (row?.password_hash) {
    if (!b.currentPassword) return res.status(400).json({ error: 'Enter your current password.' });
    if (!bcrypt.compareSync(b.currentPassword, row.password_hash)) {
      return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
  }

  q.run(
    `UPDATE customers SET password_hash = @h, updated_at = datetime('now') WHERE id = @id`,
    { h: bcrypt.hashSync(b.newPassword, 12), id: req.customer!.id }
  );
  res.json({
    ok: true,
    user: loadCustomer(req.customer!.id),
    message: row?.password_hash ? 'Your password has been changed.' : 'Your password has been set.',
  });
});

/* ==========================================================================
   Trips
   ========================================================================== */

router.get('/trips', requireCustomer, (req, res) => {
  const rows = q.all<any>(
    `SELECT b.*, c.total_amount,
            d.full_name AS driver_full_name, d.mobile AS driver_roster_mobile,
            i.id AS invoice_id, i.invoice_number, i.invoice_date, i.total_amount AS invoice_total,
            i.status AS invoice_status, i.file_path AS invoice_file,
            i.tax_mode AS invoice_tax_mode, i.tax_rate AS invoice_tax_rate,
            i.tax_amount AS invoice_tax_amount, i.sent_at AS invoice_sent_at
       FROM bookings b
       LEFT JOIN booking_charges c ON c.booking_id = b.id
       LEFT JOIN drivers d ON d.id = b.driver_id
       LEFT JOIN invoice_items ii ON ii.booking_id = b.id
       LEFT JOIN invoices i ON i.id = ii.invoice_id AND i.status <> 'CANCELLED'
      WHERE b.customer_id = @cid
      ORDER BY b.travel_date DESC, b.id DESC`,
    { cid: req.customer!.id }
  );

  res.json({ data: rows.map(publicTrip) });
});

/** One trip, with its timeline. */
router.get('/trips/:tripId', requireCustomer, (req, res) => {
  const b = tripRow('trip_id', String(req.params.tripId).trim().toUpperCase());
  if (!b || b.customer_id !== req.customer!.id) {
    return res.status(404).json({ error: 'That trip is not on your account.' });
  }
  res.json({ data: publicTrip(b), timeline: tripEvents(b.id, true) });
});

/**
 * Download the invoice for one of my trips.
 *
 * Reads the same file the office generated — the customer is never served a
 * second, differently-numbered document.
 */
router.get('/trips/:tripId/invoice', requireCustomer, (req, res) => {
  const b = tripRow('trip_id', String(req.params.tripId).trim().toUpperCase());
  if (!b || b.customer_id !== req.customer!.id) {
    return res.status(404).json({ error: 'That trip is not on your account.' });
  }
  if (!b.invoice_id || !b.invoice_file) {
    return res.status(404).json({ error: 'No invoice has been issued for this trip yet.' });
  }

  const abs = path.join(config.paths.invoices, b.invoice_file);
  if (!abs.startsWith(config.paths.invoices) || !ensureLocalFile(abs)) {
    return res.status(404).json({
      error: 'The invoice file could not be found. Please call us and we will email it to you.',
    });
  }

  // Prefer the PDF twin when the office generated a spreadsheet template — a
  // customer should never be handed an .xlsx to open.
  const pdfTwin = abs.replace(/\.[^.]+$/, '.pdf');
  const send = ensureLocalFile(pdfTwin) ? pdfTwin : abs;
  const safeNumber = String(b.invoice_number).replace(/[^A-Za-z0-9._-]/g, '-');
  res.download(send, `Invoice-${safeNumber}${path.extname(send)}`);
});

/* ==========================================================================
   Book from inside the account
   ========================================================================== */

const bookSchema = z.object({
  pickup: z.string().trim().min(2, 'Please enter the pickup address.').max(200),
  dropOff: z.string().trim().max(200).optional().default(''),
  travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the journey date.'),
  travelTime: z.string().trim().regex(/^([01]?\d|2[0-3]):[0-5]\d$|^$/, 'Time must be HH:MM.').optional().default(''),
  tripType: z.enum(['LOCAL', 'TRANSFER', 'OUTSTATION', 'AIRPORT', 'ROUND_TRIP', 'PACKAGE']).optional().default('LOCAL'),
  /** AIRPORT only: TO the airport or FROM it. */
  airportDirection: airportDirectionField,
  vehicleType: z.string().trim().max(80).optional().default(''),
  passengers: z.coerce.number().int().min(0).max(60).optional().default(1),
  message: z.string().trim().max(1000).optional().default(''),
  mobile: optionalMobile.default(''),
});

router.post('/trips', requireCustomer, validateBody(bookSchema), async (req, res) => {
  const b = req.body as z.infer<typeof bookSchema>;
  const me = req.customer!;
  const mobile = b.mobile || me.mobile;
  if (!mobile) {
    return res.status(400).json({ error: 'Add a mobile number to your profile, or enter one for this trip.' });
  }

  const { bookingId, tripId } = createInquiryTrip({
    source: 'PORTAL',
    customerName: me.fullName,
    customerMobile: mobile,
    customerEmail: me.email,
    pickup: b.pickup,
    drop: b.dropOff,
    travelDate: b.travelDate,
    journeyTime: b.travelTime,
    tripType: b.tripType,
    airportDirection: b.airportDirection,
    vehicleType: b.vehicleType,
    paxCount: b.passengers,
    message: b.message,
    serviceLabel: 'Portal booking',
    customerId: me.id,
  });

  const trip = tripRow('id', bookingId)!;
  const cfg = mailConfig();
  const url = portalUrl();

  const admin = inquiryAdminEmail({ trip, tripId, sourceLabel: SOURCE_LABEL.PORTAL, adminUrl: url });
  await sendMail({ kind: 'INQUIRY_ADMIN', to: cfg.adminInbox, subject: admin.subject, html: admin.html, bookingId, tripId });

  const mine = inquiryCustomerEmail({ trip, tripId, customerName: me.fullName, source: 'PORTAL', portalUrl: url });
  const sent = await sendMail({ kind: 'INQUIRY_CUSTOMER', to: me.email, subject: mine.subject, html: mine.html, bookingId, tripId });

  res.status(201).json({
    ok: true,
    tripId,
    data: publicTrip(trip),
    emailSent: sent.ok,
    message: `Booked. Your Trip ID is ${tripId} — we will call you on ${mobile} to confirm the fare.`,
  });
});

/* ==========================================================================
   Claim a trip raised before the account existed
   ========================================================================== */

const claimSchema = z.object({
  tripId: z.string().trim().min(4, 'Enter the Trip ID exactly as we sent it.').max(40),
  mobile: requiredMobile('Enter the mobile number on the booking.'),
});

router.post('/trips/claim', requireCustomer, validateBody(claimSchema), (req, res) => {
  const b = req.body as z.infer<typeof claimSchema>;
  const tripId = b.tripId.trim().toUpperCase();
  const row = q.get<any>('SELECT * FROM bookings WHERE trip_id = @t', { t: tripId });

  const onFile = String(row?.customer_mobile || row?.passenger_mobile || '').replace(/\D/g, '').slice(-10);
  if (!row || onFile !== b.mobile) {
    return res.status(404).json({
      error: 'We could not match that Trip ID to that mobile number. Check both, or call us and we will link it for you.',
    });
  }
  if (row.customer_id && row.customer_id !== req.customer!.id) {
    return res.status(409).json({ error: 'That trip is already linked to another account.' });
  }

  getDb().transaction(() => {
    q.run(
      `UPDATE bookings SET customer_id = @cid,
              customer_email = COALESCE(NULLIF(customer_email,''), @email),
              updated_at = datetime('now')
        WHERE id = @id`,
      { cid: req.customer!.id, email: req.customer!.email, id: row.id }
    );
  })();

  res.json({ ok: true, tripId, message: `${tripId} has been added to your account.` });
});

export default router;
