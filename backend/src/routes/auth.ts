import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from '../db';
import { config } from '../config';
import { signToken, loadUser, requireAuth } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody } from '../utils/validate';
import { limiter } from '../utils/limiter';
import { clientIp } from '../middleware/audit';
import { mailConfig, sendMail } from '../services/mailer';
import { passwordResetRequestEmail } from '../services/emailTemplates';

const router = Router();

const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your login ID.'),
  password: z.string().min(1, 'Enter your password.'),
});

router.post('/login', loginLimiter, validateBody(loginSchema), (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = q.get<any>(
    `SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower(@email)`,
    { email }
  );

  // Same message whether the account is missing or the password is wrong.
  const generic = 'Login ID or password is incorrect.';

  if (!user) {
    audit(req, 'LOGIN_FAILED', { description: `Unknown login ID: ${email}` });
    return res.status(401).json({ error: generic });
  }

  if (!user.is_active) {
    audit(req, 'LOGIN_FAILED', { entityType: 'user', entityId: user.id, description: 'Inactive account' });
    return res.status(403).json({ error: 'This account has been deactivated. Contact an administrator.' });
  }

  if (user.locked_until && new Date(user.locked_until + 'Z') > new Date()) {
    return res.status(423).json({
      error: `Account temporarily locked after too many failed attempts. Try again after ${LOCK_MINUTES} minutes.`,
    });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    const failed = (user.failed_attempts ?? 0) + 1;
    const lock = failed >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    q.run('UPDATE users SET failed_attempts = @f, locked_until = @l WHERE id = @id',
      { f: failed, l: lock, id: user.id });
    audit(req, 'LOGIN_FAILED', {
      entityType: 'user', entityId: user.id,
      description: `Wrong password (attempt ${failed}/${MAX_FAILED})`,
    });
    return res.status(401).json({
      error: lock
        ? `Login ID or password is incorrect. Account locked for ${LOCK_MINUTES} minutes.`
        : generic,
    });
  }

  q.run(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = @id`,
    { id: user.id }
  );

  const token = signToken(user.id);
  const profile = loadUser(user.id)!;
  audit(req, 'LOGIN', { entityType: 'user', entityId: user.id, description: `${user.email} signed in` });

  res.cookie('gtt_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: config.sessionTimeoutMinutes * 60_000,
  });

  res.json({ token, user: profile, mustChangePassword: profile.mustChangePassword });
});

/* --------------------------------------------------------------------------
   Forgot password.

   There is no reset link and no token. The request is emailed to the office and
   a person does the reset, which is the right shape for five staff accounts and
   one owner — and it means there is no reset URL in existence for anyone to
   find, guess or intercept.

   The answer is the same whether or not the login ID exists. Otherwise this
   becomes a way to discover which accounts are real.
   -------------------------------------------------------------------------- */
const forgotLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: { error: 'Too many reset requests. Please wait 15 minutes and try again.' },
});

const forgotSchema = z.object({
  email: z.string().trim().min(1, 'Enter your login ID.'),
});

router.post('/forgot-password', forgotLimiter, validateBody(forgotSchema), async (req, res) => {
  const { email } = req.body as z.infer<typeof forgotSchema>;

  const user = q.get<any>(
    `SELECT u.id, u.email, u.full_name, u.is_active, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE lower(u.email) = lower(@email)`,
    { email }
  );

  // Said the same way every time, whatever we found.
  const answered = {
    ok: true,
    message: `Thank you. If that login ID exists, ${config.seedAdmin.fullName || 'the administrator'} `
      + 'has been asked to reset it and will be in touch with a new password.',
  };

  if (!user) {
    audit(req, 'PASSWORD_RESET_REQUESTED', { description: `Unknown login ID: ${email}` });
    return res.json(answered);
  }

  const cfg = mailConfig();
  const { subject, html } = passwordResetRequestEmail({
    loginId: user.email,
    fullName: user.full_name,
    roleName: user.role_name + (user.is_active ? '' : ' (account is deactivated)'),
    requestedAt: new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    ip: clientIp(req),
    portalUrl: (process.env.PUBLIC_URL ?? '').trim() || undefined,
  });

  // Never throws; a mailbox that is not configured leaves the message in the
  // email log for the office to see, and the person still gets the same answer.
  const sent = await sendMail({
    kind: 'ACCOUNT',
    to: cfg.adminInbox,
    subject,
    html,
    userId: user.id,
  });

  audit(req, 'PASSWORD_RESET_REQUESTED', {
    entityType: 'user',
    entityId: user.id,
    description: `Reset requested for ${user.email} — email ${sent.status.toLowerCase()}`,
  });

  return res.json(answered);
});

router.post('/logout', requireAuth, (req, res) => {
  audit(req, 'LOGOUT', { entityType: 'user', entityId: req.user!.id });
  res.clearCookie('gtt_token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** The portal language for the signed-in person, kept so every device follows it. */
router.put('/language', requireAuth, (req, res) => {
  const language = String(req.body?.language ?? '');
  if (!['en', 'hi'].includes(language)) return res.status(400).json({ error: 'Choose English or Hindi.' });
  q.run('UPDATE users SET language = @l WHERE id = @id', { l: language, id: req.user!.id });
  res.json({ ok: true, language });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .regex(/[A-Za-z]/, 'New password must contain a letter.')
    .regex(/\d/, 'New password must contain a number.'),
  confirmPassword: z.string(),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'The two new passwords do not match.',
  path: ['confirmPassword'],
}).refine((d) => d.newPassword !== d.currentPassword, {
  message: 'The new password must be different from the current one.',
  path: ['newPassword'],
});

router.post('/change-password', requireAuth, validateBody(changePasswordSchema), (req, res) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
  const row = q.get<any>('SELECT password_hash FROM users WHERE id = @id', { id: req.user!.id });
  if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'Your current password is incorrect.' });
  }

  q.run(
    `UPDATE users SET password_hash = @h, must_change_password = 0, updated_at = datetime('now')
      WHERE id = @id`,
    { h: bcrypt.hashSync(newPassword, 12), id: req.user!.id }
  );
  audit(req, 'PASSWORD_CHANGED', { entityType: 'user', entityId: req.user!.id });
  res.json({ ok: true, user: loadUser(req.user!.id) });
});

export default router;
