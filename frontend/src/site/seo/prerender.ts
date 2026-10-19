/**
 * Pre-rendered HTML for the landing pages, written at build time.
 *
 * The site is a single-page app, so without this every URL would return the
 * same index.html with the home page's title until the JavaScript ran. For
 * each landing page vite.config.ts writes dist/<path>.html: index.html with
 * that page's own title, description, canonical, hreflang and JSON-LD, and the
 * page's text as plain HTML inside #root. A crawler or link preview that does
 * not run JavaScript gets the real page; in a browser React then renders the
 * same content (SeoLanding.tsx / RouteLanding.tsx) in its place.
 *
 * The HTML here is the same text the React page shows - nothing extra and
 * nothing hidden, which is what Google asks of pre-rendered content.
 *
 * Node only (used by vite.config.ts), no browser APIs.
 */
import { LANG_NAME, UI, alternatesFor, landingJsonLd, type Landing } from './landings';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const OG_LOCALE = { en: 'en_IN', hi: 'hi_IN', mr: 'mr_IN' } as const;

function setMeta(html: string, attr: 'name' | 'property', key: string, value: string): string {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`);
  return re.test(html)
    ? html.replace(re, `$1${esc(value)}$2`)
    : html.replace('</head>', `    <meta ${attr}="${key}" content="${esc(value)}" />\n  </head>`);
}

function body(l: Landing): string {
  const ui = UI[l.lang];
  const alts = alternatesFor(l.path).filter(([lang]) => lang !== 'x-default' && lang !== l.lang);
  const crumbs = [`<a href="/">${esc(ui.home)}</a>`, ...l.crumbs.map((c) => (c.to ? `<a href="${esc(c.to)}">${esc(c.label)}</a>` : esc(c.label)))];
  return [
    '<div class="prerender">',
    `<header><a href="/"><strong>JustCabs</strong></a></header>`,
    '<main>',
    `<nav aria-label="Breadcrumb">${crumbs.join(' / ')}</nav>`,
    `<p>${esc(l.eyebrow)}</p>`,
    `<h1>${esc(l.h1)}</h1>`,
    `<p>${esc(l.intro)}</p>`,
    `<p><a href="${esc(l.cta.to)}">${esc(l.cta.label)}</a></p>`,
    ...l.sections.map((s) =>
      `<section><h2>${esc(s.h2)}</h2>${(s.paras ?? []).map((p) => `<p>${esc(p)}</p>`).join('')}${
        s.list?.length ? `<ul>${s.list.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</section>`),
    l.faqs.length
      ? `<section><h2>${esc(ui.faq)}</h2>${l.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>`
      : '',
    l.links.length
      ? `<nav aria-label="${esc(ui.related)}"><h2>${esc(ui.related)}</h2><ul>${l.links.map((k) => `<li><a href="${esc(k.to)}">${esc(k.label)}</a></li>`).join('')}</ul></nav>`
      : '',
    alts.length
      ? `<p>${esc(ui.langs)}: ${alts.map(([lang, p]) => `<a href="${esc(p)}" hreflang="${lang}">${esc(LANG_NAME[lang as 'en'])}</a>`).join(' · ')}</p>`
      : '',
    '</main>',
    '<footer><p>JustCabs, a brand of Gupta Tours &amp; Travels · Goregaon (W), Mumbai 400104 · 24×7</p></footer>',
    '</div>',
  ].join('\n');
}

/** index.html turned into the page for one landing. `base` is the site origin ('' when unknown). */
export function prerenderLanding(template: string, l: Landing, base: string): string {
  const abs = (p: string) => `${base}${p}`;
  let html = template.replace(/<html lang="[^"]*">/, `<html lang="${l.lang === 'en' ? 'en' : l.lang}">`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(l.title)}</title>`);
  html = setMeta(html, 'name', 'description', l.description);
  html = setMeta(html, 'property', 'og:title', l.title);
  html = setMeta(html, 'property', 'og:description', l.description);
  html = setMeta(html, 'property', 'og:url', abs(l.path));
  html = setMeta(html, 'property', 'og:locale', OG_LOCALE[l.lang]);
  html = setMeta(html, 'name', 'twitter:title', l.title);
  html = setMeta(html, 'name', 'twitter:description', l.description);

  const head = [
    `<link rel="canonical" href="${esc(abs(l.path))}" />`,
    // hreflang must be absolute, so it is only written when the build knows the
    // public address (VITE_SITE_URL). Without it the sitemap and the app add them.
    ...(base ? alternatesFor(l.path).map(([lang, p]) => `<link rel="alternate" hreflang="${lang}" href="${esc(abs(p))}" data-seo-alt="" />`) : []),
    `<script type="application/ld+json" id="page-jsonld">${JSON.stringify(landingJsonLd(l, abs)).replace(/</g, '\\u003c')}</script>`,
    // Only styles the plain pre-rendered text until the app takes over.
    '<style>.prerender{max-width:46rem;margin:0 auto;padding:2rem 1rem;font:16px/1.65 system-ui,sans-serif;color:#10233F}.prerender a{color:#1477BE}</style>',
  ].map((t) => `    ${t}`).join('\n');
  html = html.replace('</head>', `${head}\n  </head>`);
  return html.replace('<div id="root"></div>', `<div id="root">${body(l)}</div>`);
}
