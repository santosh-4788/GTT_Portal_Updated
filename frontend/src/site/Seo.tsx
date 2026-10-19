/**
 * Per-page <head> tags, without a dependency.
 *
 * The site is a single-page app, so every screen shares the one index.html.
 * This sets the page's title, description, canonical link, Open Graph and
 * Twitter tags, and optional JSON-LD, when a screen mounts, and puts the
 * index.html defaults back when it unmounts - so a screen that does not call
 * it never inherits the previous screen's title.
 *
 * Nothing here sends anything anywhere; it only edits the document head.
 *
 * The public address comes from VITE_SITE_URL when the build sets it (so the
 * canonical is the real domain even when the site is opened on a LAN address),
 * and from the address the page was opened on otherwise.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { COMPANY } from './siteData';
import { alternatesFor, type Lang } from './seo/landings';

export const SITE_NAME = COMPANY.name;

/** The public site origin, without a trailing slash. */
export function siteUrl(): string {
  const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

export const absUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : `${siteUrl()}${path.startsWith('/') ? '' : '/'}${path}`);

const DEFAULT_TITLE = 'Gupta Tours & Travels | Cab and Car Rental in Mumbai, 24x7';
const DEFAULT_DESCRIPTION =
  'Cab booking and car rental in Mumbai with a chauffeur: airport transfers, local hourly packages, outstation trips and corporate transport. 24x7, based in Goregaon (W).';
const DEFAULT_IMAGE = '/assets/logo-512.png';

export interface SeoOptions {
  /** The page's own title. The site name is appended unless `rawTitle`. */
  title: string;
  rawTitle?: boolean;
  description?: string;
  /** Path for the canonical link. Defaults to the current path, without the query. */
  path?: string;
  image?: string;
  /** Keep this page out of search results (admin, account, one-off screens). */
  noindex?: boolean;
  /** One or more schema.org objects, written as a JSON-LD script. */
  jsonLd?: object | object[];
  ogType?: 'website' | 'article';
  /** Language of the page's content (the /hi and /mr pages). Defaults to English. */
  lang?: Lang;
}

function upsertMeta(attr: 'name' | 'property', key: string, content: string | null) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (content === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string | null) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === null) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

const LD_ID = 'page-jsonld';

function setJsonLd(data: object | object[] | undefined) {
  document.getElementById(LD_ID)?.remove();
  if (!data) return;
  const el = document.createElement('script');
  el.type = 'application/ld+json';
  el.id = LD_ID;
  // "<" is escaped so a string in the data can never close the script tag.
  el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  document.head.appendChild(el);
}

/**
 * hreflang links to the same page in the other languages (see
 * seo/landings.ts). Pre-rendered pages arrive with them already; they are
 * rebuilt here so they follow the page in the app too.
 */
function setAlternates(path: string | null) {
  document.head.querySelectorAll('link[data-seo-alt]').forEach((el) => el.remove());
  if (!path) return;
  for (const [lang, p] of alternatesFor(path)) {
    const el = document.createElement('link');
    el.rel = 'alternate';
    el.hreflang = lang;
    el.href = absUrl(p);
    el.setAttribute('data-seo-alt', '');
    document.head.appendChild(el);
  }
}

const OG_LOCALE: Record<Lang, string> = { en: 'en_IN', hi: 'hi_IN', mr: 'mr_IN' };

function apply(o: {
  title: string; description: string; url: string | null; image: string; noindex: boolean;
  jsonLd?: object | object[]; ogType: string; path: string | null; lang?: Lang;
}) {
  document.title = o.title;
  // Only pages that say their language set it, so the staff portal's own
  // Hindi switch (lib/i18n.tsx) is left alone.
  if (o.lang) document.documentElement.lang = o.lang;
  upsertMeta('property', 'og:locale', OG_LOCALE[o.lang ?? 'en']);
  setAlternates(o.noindex ? null : o.path);
  upsertMeta('name', 'description', o.description);
  upsertMeta('name', 'robots', o.noindex ? 'noindex, nofollow' : null);
  upsertCanonical(o.noindex ? null : o.url);

  upsertMeta('property', 'og:site_name', SITE_NAME);
  upsertMeta('property', 'og:type', o.ogType);
  upsertMeta('property', 'og:title', o.title);
  upsertMeta('property', 'og:description', o.description);
  upsertMeta('property', 'og:url', o.url);
  upsertMeta('property', 'og:image', absUrl(o.image));
  upsertMeta('name', 'twitter:card', 'summary');
  upsertMeta('name', 'twitter:title', o.title);
  upsertMeta('name', 'twitter:description', o.description);
  upsertMeta('name', 'twitter:image', absUrl(o.image));
  setJsonLd(o.jsonLd);
}

export function useSeo(opts: SeoOptions) {
  const { pathname } = useLocation();
  const title = opts.rawTitle ? opts.title : `${opts.title} | ${SITE_NAME}`;
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const path = opts.path ?? pathname;
  const image = opts.image ?? DEFAULT_IMAGE;
  const noindex = !!opts.noindex;
  const ogType = opts.ogType ?? 'website';
  const ld = opts.jsonLd ? JSON.stringify(opts.jsonLd) : '';
  const lang = opts.lang;

  useEffect(() => {
    apply({
      title, description, url: absUrl(path), image, noindex, ogType, path, lang,
      jsonLd: ld ? JSON.parse(ld) : undefined,
    });
  }, [title, description, path, image, noindex, ogType, ld, lang]);

  // Back to the index.html defaults when the screen goes away.
  useEffect(() => () => {
    apply({
      title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, url: null,
      image: DEFAULT_IMAGE, noindex: false, ogType: 'website', path: null,
    });
  }, []);

  // A Hindi or Marathi page puts the document back to English when it goes.
  useEffect(() => () => {
    if (lang && lang !== 'en') document.documentElement.lang = 'en';
  }, [lang]);
}

/** The same thing as a component, for screens that read better that way. */
export default function Seo(props: SeoOptions) {
  useSeo(props);
  return null;
}

/** schema.org BreadcrumbList from [label, path] pairs, Home first. */
export function breadcrumbLd(items: [string, string][]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({
      '@type': 'ListItem', position: i + 1, name, item: absUrl(path),
    })),
  };
}

/** schema.org FAQPage from question/answer pairs. */
export function faqLd(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}
