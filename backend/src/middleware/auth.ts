import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { q } from '../db';

export interface AuthUser {
  id: number;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  mustChangePassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number): string {
  return jwt.sign(
    { sub: String(userId), typ: 'staff', iat: Math.floor(Date.now() / 1000) },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as any }
  );
}

export function loadUser(userId: number): AuthUser | null {
  const row = q.get<any>(
    `SELECT u.id, u.email, u.full_name, u.is_active, u.must_change_password,
            r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = @id`,
    { id: userId }
  );
  if (!row || !row.is_active) return null;

  const perms = q.all<{ code: string }>(
    `SELECT p.code FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       JOIN roles r ON r.id = rp.role_id
       JOIN users u ON u.role_id = r.id
      WHERE u.id = @id`,
    { id: userId }
  ).map((p) => p.code);

  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    roleCode: row.role_code,
    roleName: row.role_name,
    permissions: perms,
    mustChangePassword: !!row.must_change_password,
  };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if ((req as any).cookies?.gtt_token) return (req as any).cookies.gtt_token;
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Not signed in. Please log in to continue.' });

  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; typ?: string };

    // Customer tokens are signed with the same secret and carry typ:"customer".
    // Without this check a customer whose id happened to match a staff id would
    // be loaded as that member of staff.
    if (payload.typ && payload.typ !== 'staff') {
      return res.status(401).json({ error: 'This is a customer sign-in, not a staff account.' });
    }

    const user = loadUser(Number(payload.sub));
    if (!user) return res.status(401).json({ error: 'Your account is no longer active.' });
    req.user = user;

    // Until the password is changed, only these endpoints are reachable.
    const allowedWhileLocked = ['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'];
    if (user.mustChangePassword && !allowedWhileLocked.includes(req.path) && req.baseUrl + req.path !== '/api/auth/change-password') {
      const full = req.baseUrl + req.path;
      if (!allowedWhileLocked.includes(full)) {
        return res.status(428).json({
          error: 'Password change required before you can use the portal.',
          code: 'PASSWORD_CHANGE_REQUIRED',
        });
      }
    }
    next();
  } catch (err: any) {
    const expired = err?.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Your session timed out. Please sign in again.' : 'Invalid session. Please sign in again.',
      code: expired ? 'SESSION_EXPIRED' : 'INVALID_TOKEN',
    });
  }
}

/** Require any one of the listed permission codes. */
export function requirePermission(...codes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    if (req.user.roleCode === 'SUPER_ADMIN') return next();
    if (codes.some((c) => req.user!.permissions.includes(c))) return next();
    return res.status(403).json({
      error: `You do not have permission to do this (${codes.join(' or ')}). Ask an administrator for access.`,
    });
  };
}
