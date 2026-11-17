import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { resolveApiBase } from '../lib/serverUrl';
import { COMPANY, whatsappLink } from './siteData';
import { Reveal } from '../components/Reveal';
import { IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

/* ==========================================================================
   Festival & event ads on the home page.

   Written in the staff portal (Admin -> Festival ads): a title, the office's
   own words, up to six photos and a window of dates. Only ads that are switched
   on and whose window includes today come back from the server, so nothing
   here has to be taken down by hand. Renders nothing when there are none.
   ========================================================================== */

export interface FestivalAd {
  id: number;
  kind: 'FESTIVAL' | 'EVENT' | 'OFFER';
  title: string;
  titleLocal: string | null;
  headline: string | null;
  message: string | null;
  ctaLabel: string | null;
  ctaLink: string | null;
  theme: string;
  festivalDate: string | null;
  festivalEnd: string | null;
  showFrom: string;
  showUntil: string;
  images: { id: number; url: string; caption: string | null }[];
}

/** Background and accent per theme. Shared with the admin preview. */
export const AD_THEMES: Record<string, { bg: string; accent: string; chip: string; label: string }> = {
  saffron:   { label: 'Saffron',   bg: 'linear-gradient(135deg, #3A1405 0%, #7A2E06 45%, #C2570C 100%)', accent: '#FFC56B', chip: 'linear-gradient(90deg,#F59E0B,#F97316)' },
  gold:      { label: 'Gold',      bg: 'linear-gradient(135deg, #1A1204 0%, #4A3209 50%, #8A6413 100%)', accent: '#F7D27A', chip: 'linear-gradient(90deg,#F2B93B,#D4941A)' },
  red:       { label: 'Red',       bg: 'linear-gradient(135deg, #2A0608 0%, #6E0E16 50%, #B3202A 100%)', accent: '#FFD27A', chip: 'linear-gradient(90deg,#EF4444,#B91C1C)' },
  pink:      { label: 'Pink',      bg: 'linear-gradient(135deg, #3B0A2E 0%, #8A1A63 50%, #DB2777 100%)', accent: '#FFE08A', chip: 'linear-gradient(90deg,#EC4899,#A855F7)' },
  purple:    { label: 'Purple',    bg: 'linear-gradient(135deg, #160A33 0%, #3B1B78 50%, #6D28D9 100%)', accent: '#F9D976', chip: 'linear-gradient(90deg,#8B5CF6,#6366F1)' },
  indigo:    { label: 'Indigo',    bg: 'linear-gradient(135deg, #0B0F2E 0%, #1E2A6E 50%, #3446B8 100%)', accent: '#A5C8FF', chip: 'linear-gradient(90deg,#6366F1,#3B82F6)' },
  blue:      { label: 'Blue',      bg: 'linear-gradient(135deg, #071A3A 0%, #0E3A7A 50%, #1A8FF0 100%)', accent: '#9FDCFF', chip: 'linear-gradient(90deg,#35C0EE,#1A8FF0)' },
  green:     { label: 'Green',     bg: 'linear-gradient(135deg, #04241A 0%, #0B4A35 50%, #12805A 100%)', accent: '#F7E08A', chip: 'linear-gradient(90deg,#10B981,#059669)' },
  tricolour: { label: 'Tricolour', bg: 'linear-gradient(135deg, #B8510A 0%, #0B1F44 50%, #0F6B3A 100%)', accent: '#FFFFFF', chip: 'linear-gradient(90deg,#FF9933,#138808)' },
};

/** Photo addresses come back as /api/...; in the phone apps the API lives on another host. */
export const adImage = (url: string) => (url.startsWith('/api/') ? `${resolveApiBase().replace(/\/$/, '')}${url.slice(4)}` : url);

const KIND_LABEL: Record<string, string> = { FESTIVAL: 'Festival special', EVENT: 'Event', OFFER: 'Special' };

const day = (iso: string) => new Date(`${iso}T00:00:00`);
function countdown(ad: FestivalAd, today: string) {
  if (!ad.festivalDate) return null;
  const n = Math.round((day(ad.festivalDate).getTime() - day(today).getTime()) / 86400000);
  if (n > 1) return `${n} days to go`;
  if (n === 1) return 'Tomorrow';
  if (n === 0 || (ad.festivalEnd && today <= ad.festivalEnd)) return 'Today';
  return null;
}
const nice = (iso: string) => day(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** One ad. Also used, unchanged, as the live preview in the staff portal. */
export function FestivalAdCard({ ad, today, preview = false }: { ad: FestivalAd; today: string; preview?: boolean }) {
  const t = AD_THEMES[ad.theme] ?? AD_THEMES.saffron;
  const [shown, setShown] = useState(0);
  const imgs = ad.images;

  // A slow slideshow when the office added more than one photo.
  useEffect(() => {
    if (imgs.length < 2) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const id = setInterval(() => setShown((i) => (i + 1) % imgs.length), 4500);
    return () => clearInterval(id);
  }, [imgs.length]);

  const left = countdown(ad, today);
  const when = ad.festivalDate
    ? ad.festivalEnd && ad.festivalEnd !== ad.festivalDate ? `${nice(ad.festivalDate)} – ${nice(ad.festivalEnd)}` : nice(ad.festivalDate)
    : null;
  const waText = `Hello ${COMPANY.name}, I saw your ${ad.title} post on the website. I would like to book a cab.\nFrom: \nTo: \nDate: \nTravellers: `;
  const cta = ad.ctaLink
    ? { href: ad.ctaLink, label: ad.ctaLabel || 'Know more', external: /^https?:/.test(ad.ctaLink) }
    : { href: whatsappLink(waText), label: ad.ctaLabel || 'Book on WhatsApp', external: true };

  return (
    <article className="relative overflow-hidden rounded-[2rem] text-white shadow-lift" style={{ background: t.bg }}>
      {/* soft light + the festival's own name, very large and faint */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl" style={{ background: t.accent }} aria-hidden="true" />
      {ad.titleLocal && (
        <span aria-hidden="true"
          className="pointer-events-none absolute -bottom-4 left-4 select-none whitespace-nowrap font-display text-[4.5rem] font-extrabold leading-none text-white/[0.07] sm:text-[7rem] lg:text-[8.5rem]">
          {ad.titleLocal}
        </span>
      )}

      <div className={`relative grid gap-6 p-5 sm:p-8 ${imgs.length ? 'lg:grid-cols-[1.05fr,1fr] lg:gap-10 lg:p-10' : 'lg:p-10'}`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full px-3.5 py-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-white shadow-lg" style={{ background: t.chip }}>
              {KIND_LABEL[ad.kind] ?? 'Special'}
            </span>
            {left && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.12em] ring-1 ring-white/15" style={{ color: t.accent }}>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70" style={{ background: t.accent }} />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: t.accent }} />
                </span>
                {left}
              </span>
            )}
            {when && <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-white/60">{when}</span>}
          </div>

          {ad.titleLocal && <p className="mt-5 font-display text-lg font-bold" style={{ color: t.accent }}>{ad.titleLocal}</p>}
          <h2 className={`${ad.titleLocal ? 'mt-1' : 'mt-5'} max-w-[24ch] font-display !text-white text-[1.7rem] font-bold leading-[1.12] tracking-[-0.025em] sm:text-[2.1rem] lg:text-[2.4rem]`}>
            {ad.headline || ad.title}
          </h2>
          {ad.message && <p className="mt-4 max-w-xl whitespace-pre-line text-sm leading-[1.75] text-white/80 sm:text-md">{ad.message}</p>}

          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={preview ? undefined : cta.href}
              target={cta.external ? '_blank' : undefined}
              rel={cta.external ? 'noopener noreferrer' : undefined}
              className="btn h-12 rounded-full bg-white px-6 text-md font-semibold text-ink-900 shadow-lg transition-transform hover:-translate-y-0.5"
            >
              {!ad.ctaLink && <IconWhatsApp className="h-4 w-4 text-[#25D366]" />} {cta.label}
            </a>
            <a
              href={preview ? undefined : `tel:+91${COMPANY.mobile}`}
              className="btn h-12 rounded-full bg-white/10 px-5 text-md font-semibold text-white ring-1 ring-white/25 transition-colors hover:bg-white/20"
            >
              <IconPhone className="h-4 w-4" /> Call {COMPANY.mobile}
            </a>
          </div>
        </div>

        {imgs.length > 0 && (
          <div className="relative min-h-[15rem] overflow-hidden rounded-[1.5rem] bg-black/20 ring-1 ring-white/15 sm:min-h-[19rem]">
            {imgs.map((im, i) => (
              <img
                key={im.id}
                src={adImage(im.url)}
                alt={im.caption || ad.title}
                loading="lazy"
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${i === shown ? 'opacity-100' : 'opacity-0'}`}
              />
            ))}
            {imgs[shown]?.caption && (
              <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-10 text-xs font-medium text-white">
                {imgs[shown].caption}
              </p>
            )}
            {imgs.length > 1 && (
              <div className="absolute right-3 top-3 flex gap-1.5">
                {imgs.map((im, i) => (
                  <button
                    key={im.id} type="button" onClick={() => setShown(i)}
                    aria-label={`Photo ${i + 1}`}
                    className={`h-2 rounded-full transition-all ${i === shown ? 'w-6 bg-white' : 'w-2 bg-white/50'}`}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

export function FestivalAds() {
  const [ads, setAds] = useState<FestivalAd[]>([]);
  const [today, setToday] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/public/promotions')
      .then(({ data }) => { if (live) { setAds(data.data ?? []); setToday(data.today); } })
      .catch(() => { /* no ads is a fine home page */ });
    return () => { live = false; };
  }, []);

  if (!ads.length) return null;
  return (
    <section className="pt-16 sm:pt-20" aria-label="Festival specials">
      <div className="shell space-y-6">
        {ads.map((ad, i) => (
          <Reveal key={ad.id} variant="zoom" delay={i * 80}>
            <FestivalAdCard ad={ad} today={today} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}
