/**
 * Customer sessions.
 *
 * Kept completely apart from staff sessions. Both are JWTs signed with the same
 * secret, so the token has to say which kind it is — without that, a customer
 * token whose subject happens to be `1` would be read by the admin middleware
 * as user 1, who is the Super Admin. Every customer token carries `typ:
 * "customer"`, the staff middleware refuses those, and this one refuses
 * anything else.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { q } from '../db';

export const CUSTOMER_COOKIE = 'gtt_customer';
export const CUSTOMER_TOKEN_TYPE = 'customer';

export interface CustomerUser {
  id: number;
  email: string;
  fullName: string;
  mobile: string;
  company: string;
  gstin: string;
  address: string;
  pictureUrl: string;
  /** False for a Google-only account, which has no password to change. */
  hasPassword: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      customer?: CustomerUser;
    }
  }
}

export function signCustomerToken(customerId: number): string {
  return jwt.sign(
    { sub: String(customerId), typ: CUSTOMER_TOKEN_TYPE, iat: Math.floor(Date.now() / 1000) },
    config.jwtSecret,
    // Customers are not handling money in the portal and re-authenticating a
    // shopper every eight hours only teaches them to give up, so this is longer
    // than the staff session deliberately.
    { expiresIn: '30d' }
  );
}

export function loadCustomer(id: number): CustomerUser | null {
  const row = q.get<any>(
    `SELECT id, email, full_name, mobile, company, gstin, address, picture_url,
            password_hash, is_active
       FROM customers WHERE id = @id`,
    { id }
  );
  if (!row || !row.is_active) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    mobile: row.mobile ?? '',
    company: row.company ?? '',
    gstin: row.gstin ?? '',
    address: row.address ?? '',
    pictureUrl: row.picture_url ?? '',
    hasPassword: !!row.password_hash,
  };
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie = (req as any).cookies?.[CUSTOMER_COOKIE];
  return cookie ?? null;
}

/**
 * The signed-in customer, or null - never an error. For "am I signed in?"
 * checks that every page makes: a 401 there is logged as an error in every
 * visitor's browser console although being signed out is perfectly normal.
 */
export function currentCustomer(req: Request) {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; typ?: string };
    if (payload.typ !== CUSTOMER_TOKEN_TYPE) return null;
    return loadCustomer(Number(payload.sub)) ?? null;
  } catch {
    return null;
  }
}

export function requireCustomer(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Please sign in to see your trips.', code: 'CUSTOMER_SIGNIN_REQUIRED' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; typ?: string };
    if (payload.typ !== CUSTOMER_TOKEN_TYPE) {
      return res.status(401).json({ error: 'Please sign in to see your trips.', code: 'CUSTOMER_SIGNIN_REQUIRED' });
    }
    const customer = loadCustomer(Number(payload.sub));
    if (!customer) {
      return res.status(401).json({ error: 'This account is no longer active. Please contact us.' });
    }
    req.customer = customer;
    next();
  } catch (err: any) {
    const expired = err?.name === 'TokenExpiredError';
    res.status(401).json({
      error: expired ? 'Your session has expired. Please sign in again.' : 'Please sign in to see your trips.',
      code: expired ? 'SESSION_EXPIRED' : 'CUSTOMER_SIGNIN_REQUIRED',
    });
  }
}

/** Cookie options shared by sign-in and sign-out so they always match. */
export const customerCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  maxAge: 30 * 24 * 60 * 60 * 1000,
};
