/**
 * A search landing page: a Mumbai area, an airport, a kind of trip, or one of
 * the Hindi and Marathi pages. The words all come from seo/landings.ts, which
 * also feeds the pre-rendered HTML and the sitemap, so the page a crawler
 * reads and the page a visitor sees are the same page.
 *
 * Looked up by the address, so one component serves every landing route; an
 * address with no landing is the ordinary not-found page.
 */
import { Link, useLocation } from 'react-router-dom';
import PageHero from './PageHero';
import NotFound from './NotFound';
import { CallButton, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { whatsappLink } from './siteData';
import { useSeo, absUrl } from './Seo';
import { LANG_NAME, UI, alternatesFor, landingByPath, landingJsonLd, type Landing } from './seo/landings';

export default function SeoLanding() {
  const { pathname } = useLocation();
  const page = landingByPath(pathname);
  return page && !page.external ? <LandingView page={page} /> : <NotFound />;
}

function LandingView({ page }: { page: Landing }) {
  const ui = UI[page.lang];
  useSeo({
    title: page.title,
    rawTitle: true,
    description: page.description,
    path: page.path,
    lang: page.lang,
    jsonLd: landingJsonLd(page, absUrl),
  });

  const otherLangs = alternatesFor(page.path).filter(([l]) => l !== 'x-default' && l !== page.lang);

  return (
    <div className="page-bg pb-24" lang={page.lang}>
      <PageHero
        eyebrow={page.eyebrow}
        title={page.h1}
        crumbs={page.crumbs}
        sub={page.intro}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to={page.cta.to}
              className="grad-brand btn h-11 rounded-full px-6 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 hover:brightness-[1.06]"
            >
              {page.cta.label} <IconArrowRight className="h-4 w-4" />
            </Link>
            <CallButton
              label={ui.call}
              className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-800"
            />
          </div>
        }
      />

      <div className="shell">
        <div className="mx-auto max-w-4xl">
          {/* WhatsApp sits here rather than with the hero buttons: three
              buttons with Hindi or Marathi labels do not fit a phone's width. */}
          <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a
              href={whatsappLink(`Hello, I would like to book: ${page.h1}`)}
              target="_blank" rel="noreferrer"
              className="btn h-11 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white hover:bg-[#1FB855]"
            >
              <IconWhatsApp className="h-4 w-4" /> {ui.whatsapp}
            </a>
          {otherLangs.length > 0 && (
            <p className="text-sm text-ink-500">
              {ui.langs}:{' '}
              {otherLangs.map(([lang, to], i) => (
                <span key={lang}>
                  {i > 0 && ' · '}
                  <Link to={to} hrefLang={lang} lang={lang} className="font-semibold text-brand-700 hover:text-brand-800">
                    {LANG_NAME[lang as 'en']}
                  </Link>
                </span>
              ))}
            </p>
          )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {page.sections.map((s, i) => (
              <Reveal key={s.h2} delay={(i % 2) * 60} className={`tile p-5 sm:p-6 ${s.list && s.list.length > 4 ? 'sm:col-span-2' : ''}`}>
                <h2 className="font-display text-lg font-bold text-ink-900">{s.h2}</h2>
                {s.paras?.map((p) => (
                  <p key={p} className="mt-2 text-sm leading-relaxed text-ink-600">{p}</p>
                ))}
                {s.list && s.list.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {s.list.map((item) => (
                      <li key={item} className="flex gap-2 text-sm text-ink-700">
                        <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {item}
                      </li>
                    ))}
                  </ul>
                )}
              </Reveal>
            ))}
          </div>

          {page.faqs.length > 0 && (
            <Reveal className="mt-12">
              <h2 className="font-display text-xl font-bold text-ink-900">{ui.faq}</h2>
              <div className="mt-4 space-y-3">
                {page.faqs.map((f) => (
                  <div key={f.q} className="tile p-5">
                    <h3 className="font-display text-md font-bold text-ink-900">{f.q}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.a}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          )}

          {page.links.length > 0 && (
            <Reveal className="mt-12">
              <h2 className="font-display text-xl font-bold text-ink-900">{ui.related}</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {page.links.map((l) => (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-ink-700 shadow-card transition-shadow hover:shadow-raised"
                  >
                    {l.label}
                  </Link>
                ))}
              </div>
            </Reveal>
          )}

          <div className="mt-9">
            <TrustRow compact />
          </div>
        </div>
      </div>
    </div>
  );
}
