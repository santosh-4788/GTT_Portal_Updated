import type { Request } from 'express';

/**
 * Where the admin is browsing from, for links inside emails when Settings has
 * no public website address. The Origin header is the site the admin has open
 * (the Vite dev server included); the Host header is the fallback.
 */
export function requestOrigin(req: Request): string {
  const origin = String(req.get('origin') ?? '').trim();
  if (/^https?:\/\/[^/\s]+$/.test(origin)) return origin;
  const host = req.get('host');
  return host ? `${req.protocol}://${host}` : '';
}
