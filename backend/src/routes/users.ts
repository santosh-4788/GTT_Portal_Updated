import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../middleware/audit';
import { validateBody, optionalMobile } from '../utils/validate';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('users.view'), (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT u.id, u.email, u.full_name, u.mobile, u.is_active, u.must_change_password,
              u.last_login_at, u.created_at, r.code AS role_code, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`
    ),
  });
});

router.get('/roles', requirePermission('users.view'), (_req, res) => {
  const roles = q.all<any>('SELECT * FROM roles ORDER BY id');
  for (const r of roles) {
    r.permissions = q.all<any>(
      `SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
        WHERE rp.role_id = @id ORDER BY p.code`,
      { id: r.id }
    ).map((p: any) => p.code);
  }
  res.json({ data: roles });
});

/** Every permission, grouped by module, for the role editor. */
router.get('/permissions', requirePermission('users.view'), (_req, res) => {
  res.json({ data: q.all<any>('SELECT id, code, module, description FROM permissions ORDER BY module, id') });
});

/**
 * Change what a role may do.
 *
 * The Super Admin role always has everything and cannot be edited, and a user
 * cannot take user-management away from their own role — two ways an office
 * could otherwise lock itself out of the portal.
 */
router.put('/roles/:id/permissions', requirePermission('users.update'), (req, res) => {
  const id = Number(req.params.id);
  const role = q.get<any>('SELECT * FROM roles WHERE id = @id', { id });
  if (!role) return res.status(404).json({ error: 'That role does not exist.' });
  if (role.code === 'SUPER_ADMIN') return res.status(409).json({ error: 'The Super Admin role always has every permission.' });
  const codes: string[] = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [];
  const known = new Map(q.all<any>('SELECT id, code FROM permissions').map((p) => [p.code, p.id]));
  const unknown = codes.filter((c) => !known.has(c));
  if (unknown.length) return res.status(400).json({ error: `Unknown permission(s): ${unknown.join(', ')}` });
  if (req.user!.roleCode === role.code && req.user!.permissions.includes('users.update') && !codes.includes('users.update')) {
    return res.status(409).json({ error: 'You cannot remove user management from your own role — ask a Super Admin.' });
  }
  const before = q.all<any>(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = @id`, { id }
  ).map((p) => p.code as string);
  const added = codes.filter((c) => !before.includes(c));
  const removed = before.filter((c) => !codes.includes(c));
  q.tx(() => {
    q.run('DELETE FROM role_permissions WHERE role_id = @id', { id });
    for (const c of codes) q.run('INSERT INTO role_permissions (role_id, permission_id) VALUES (@r, @p)', { r: id, p: known.get(c) });
  });
  audit(req, 'ROLE_PERMISSIONS_CHANGED', {
    entityType: 'role', entityId: id,
    description: `${role.name}: ${added.length ? `+${added.join(', +')}` : ''}${added.length && removed.length ? '; ' : ''}${removed.length ? `-${removed.join(', -')}` : ''}` || `${role.name}: no change`,
    meta: { added, removed },
  });
  res.json({ ok: true, message: `${role.name} updated — ${added.length} added, ${removed.length} removed.` });
});

const userSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  fullName: z.string().trim().min(2, 'Full name is required.'),
  roleCode: z.enum(['SUPER_ADMIN', 'ADMIN', 'BILLING', 'OPERATIONS', 'VIEWER']),
  mobile: optionalMobile.default(''),
  password: z.string()
    .min(8, 'Password must be at least 8 characters.')
    .regex(/[A-Za-z]/, 'Password must contain a letter.')
    .regex(/\d/, 'Password must contain a number.')
    .optional(),
  isActive: z.coerce.boolean().default(true),
});

router.post('/', requirePermission('users.create'), validateBody(userSchema), (req, res) => {
  const b = req.body as z.infer<typeof userSchema>;
  if (!b.password) return res.status(400).json({ error: 'Set an initial password for the new user.' });
  if (q.get('SELECT id FROM users WHERE lower(email) = lower(@e)', { e: b.email })) {
    return res.status(409).json({ error: `${b.email} is already registered.` });
  }
  const role = q.get<any>('SELECT id FROM roles WHERE code = @c', { c: b.roleCode });
  if (!role) return res.status(400).json({ error: 'Unknown role.' });

  const info = q.run(
    `INSERT INTO users (email, full_name, password_hash, role_id, mobile, is_active, must_change_password)
     VALUES (@e, @n, @h, @r, @m, @a, 1)`,
    {
      e: b.email, n: b.fullName, h: bcrypt.hashSync(b.password, 12), r: role.id,
      m: b.mobile, a: b.isActive ? 1 : 0,
    }
  );
  audit(req, 'USER_CREATED', {
    entityType: 'user', entityId: Number(info.lastInsertRowid),
    description: `${b.fullName} (${b.email}) created as ${b.roleCode}`,
  });
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

router.put('/:id', requirePermission('users.update'), validateBody(userSchema.partial({ password: true })), (req, res) => {
  const id = Number(req.params.id);
  const user = q.get<any>('SELECT * FROM users WHERE id = @id', { id });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const b = req.body as z.infer<typeof userSchema>;
  const role = q.get<any>('SELECT id FROM roles WHERE code = @c', { c: b.roleCode });
  if (!role) return res.status(400).json({ error: 'Unknown role.' });

  const clash = q.get<any>('SELECT id FROM users WHERE lower(email) = lower(@e) AND id <> @id', { e: b.email, id });
  if (clash) return res.status(409).json({ error: `${b.email} is already registered to another user.` });

  // Don't let the last active super admin be demoted or switched off.
  if (user.role_id === (q.get<any>("SELECT id FROM roles WHERE code='SUPER_ADMIN'")!).id) {
    const others = q.get<any>(
      `SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.code = 'SUPER_ADMIN' AND u.is_active = 1 AND u.id <> @id`, { id }
    )!.c;
    if (others === 0 && (b.roleCode !== 'SUPER_ADMIN' || !b.isActive)) {
      return res.status(409).json({ error: 'This is the only active Super Admin. Create another one before changing this account.' });
    }
  }

  q.run(
    `UPDATE users SET email=@e, full_name=@n, role_id=@r, mobile=@m, is_active=@a,
            updated_at=datetime('now') WHERE id=@id`,
    { e: b.email, n: b.fullName, r: role.id, m: b.mobile, a: b.isActive ? 1 : 0, id }
  );

  if (b.password) {
    q.run('UPDATE users SET password_hash=@h, must_change_password=1 WHERE id=@id',
      { h: bcrypt.hashSync(b.password, 12), id });
  }

  audit(req, 'USER_UPDATED', { entityType: 'user', entityId: id, description: `${b.fullName} updated` });
  res.json({ ok: true });
});

router.delete('/:id', requirePermission('users.delete'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user!.id) return res.status(400).json({ error: 'You cannot delete your own account.' });

  const user = q.get<any>(
    'SELECT u.*, r.code AS role_code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = @id', { id }
  );
  if (!user) return res.status(404).json({ error: 'User not found.' });

  if (user.role_code === 'SUPER_ADMIN') {
    const others = q.get<any>(
      `SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id
        WHERE r.code='SUPER_ADMIN' AND u.is_active=1 AND u.id <> @id`, { id }
    )!.c;
    if (others === 0) return res.status(409).json({ error: 'This is the only Super Admin and cannot be deleted.' });
  }

  // Audit rows reference the user, so deactivate rather than hard-delete when history exists.
  const hasHistory = q.get<any>('SELECT COUNT(*) c FROM audit_logs WHERE user_id = @id', { id })!.c > 0;
  if (hasHistory) {
    q.run('UPDATE users SET is_active = 0 WHERE id = @id', { id });
    audit(req, 'USER_DELETED', { entityType: 'user', entityId: id, description: `${user.full_name} deactivated (has history)` });
    return res.json({ ok: true, message: `${user.full_name} has activity history, so the account was deactivated instead of deleted.` });
  }

  q.run('DELETE FROM users WHERE id = @id', { id });
  audit(req, 'USER_DELETED', { entityType: 'user', entityId: id, description: `${user.full_name} deleted` });
  res.json({ ok: true });
});

export default router;
