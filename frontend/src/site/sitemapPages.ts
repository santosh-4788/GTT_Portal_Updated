/**
 * The public pages worth listing in /sitemap.xml.
 *
 * Read at build time by vite.config.ts, which writes them to
 * dist/sitemap-pages.json; the API server's /sitemap.xml reads that file and
 * adds one /cabs/mumbai-to-<route> page per fixed-fare route from the database.
 * Built from the same data the pages use, so a new service, vehicle or
 * destination is listed without anyone remembering to add it here.
 *
 * Keep this file free of imports that need a browser (it runs in Node).
 * Account, admin, form-result and search screens are deliberately left out.
 */
import { FLEET, SERVICES } from './siteData';
import { DESTINATIONS } from './places';
import { LANDINGS, alternatesFor } from './seo/landings';

const STATIC_PAGES = [
  '/',
  '/book',
  '/outstation',
  '/vehicles',
  '/fleet',
  '/services',
  '/packages',
  '/corporate',
  '/weddings',
  '/events',
  '/group-travel',
  '/tours/mumbai',
  '/weekend-trips',
  '/find-a-trip',
  '/help-me-choose',
  '/about',
  '/contact',
  '/faq',
  '/reviews',
  '/policies',
  '/support',
];

export const SITEMAP_PAGES: string[] = [
  ...STATIC_PAGES,
  ...SERVICES.map((s) => `/services/${s.slug}`),
  ...FLEET.map((v) => `/vehicles/${v.slug}`),
  ...DESTINATIONS.map((d) => `/destinations/${d.slug}`),
  // Search landing pages: areas, airports, routes, Hindi and Marathi (seo/landings.ts).
  ...LANDINGS.map((l) => l.path),
];

/** hreflang alternates for the pages that have translations, keyed by path. */
export const SITEMAP_ALTERNATES: Record<string, [string, string][]> = Object.fromEntries(
  SITEMAP_PAGES.map((p) => [p, alternatesFor(p)] as const).filter(([, a]) => a.length > 0),
);
