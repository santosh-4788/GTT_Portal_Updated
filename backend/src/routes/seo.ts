/**
 * /robots.txt and /sitemap.xml for the public website.
 *
 * Mounted at the root, before the built SPA is served, so these win over the
 * static copies. Both use the address the request came in on for absolute
 * URLs (trust proxy is on, so an HTTPS proxy in front reports https), which
 * keeps them right on localhost, a LAN address and the real domain alike.
 *
 * The sitemap lists:
 *   - the public pages the frontend build wrote to dist/sitemap-pages.json
 *     (generated from the same data the pages use - see
 *     frontend/src/site/sitemapPages.ts), or a short built-in list when the
 *     website has not been built next to this server;
 *   - one /cabs/mumbai-to-<route> landing page per active fixed-fare route from
 *     Mumbai in outstation_fares, so a route the office adds is listed at once;
 *   - hreflang links between the English, Hindi and Marathi landing pages.
 */
import { Router, type Request } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { groupedRoutes } from '../services/outstationFares';

const router = Router();

const distDir = () => path.join(config.paths.root, 'frontend', 'dist');

/** Used only when dist/sitemap-pages.json is missing. */
const FALLBACK_PAGES = [
  '/', '/book', '/outstation', '/vehicles', '/fleet', '/services', '/packages', '/corporate',
  '/weddings', '/events', '/group-travel', '/tours/mumbai', '/weekend-trips', '/about',
  '/contact', '/faq', '/reviews', '/policies',
];

const FALLBACK_ROBOTS = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/
Disallow: /login
Disallow: /account
Disallow: /trips
Disallow: /profile
Disallow: /notifications
Disallow: /request/
Disallow: /track
Disallow: /feedback
Disallow: /search
Disallow: /vehicles/compare
`;

function origin(req: Request): string {
  const configured = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

/** hreflang alternates per path: [[lang, path], ...]. */
type Alternates = Record<string, [string, string][]>;

function staticPages(): { pages: string[]; alternates: Alternates } {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(distDir(), 'sitemap-pages.json'), 'utf8'));
    if (Array.isArray(raw?.pages) && raw.pages.every((p: unknown) => typeof p === 'string')) {
      const alternates = raw.alternates && typeof raw.alternates === 'object' ? (raw.alternates as Alternates) : {};
      return { pages: raw.pages, alternates };
    }
  } catch {
    /* not built here - use the short list */
  }
  return { pages: FALLBACK_PAGES, alternates: {} };
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

router.get('/robots.txt', (req, res) => {
  let body = FALLBACK_ROBOTS;
  try {
    body = fs.readFileSync(path.join(distDir(), 'robots.txt'), 'utf8');
  } catch {
    /* keep the built-in rules */
  }
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600')
    .send(`${body.trimEnd()}\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res, next) => {
  try {
    const base = origin(req);
    const routes = groupedRoutes(true)
      .filter((r) => r.origin.trim().toLowerCase() === 'mumbai')
      .map((r) => `/cabs/mumbai-to-${r.key}`);

    const { pages, alternates } = staticPages();
    const seen = new Set<string>();
    const urls = [...pages, ...routes].filter((p) => !seen.has(p) && seen.add(p));

    const body = urls
      .map((p) => {
        const priority = p === '/' ? '1.0' : p === '/outstation' || p.startsWith('/cabs/') ? '0.8' : '0.6';
        // hreflang links to the same page in English, Hindi and Marathi, where it has them.
        const alt = (alternates[p] ?? [])
          .map(([lang, href]) => `\n    <xhtml:link rel="alternate" hreflang="${xmlEscape(lang)}" href="${xmlEscape(base + href)}"/>`)
          .join('');
        return `  <url><loc>${xmlEscape(base + p)}</loc>${alt}${alt ? '\n    ' : ''}<priority>${priority}</priority></url>`;
      })
      .join('\n');

    res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`
    );
  } catch (e) {
    next(e);
  }
});

export default router;
