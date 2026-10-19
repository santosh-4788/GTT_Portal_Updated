/**
 * The reviews page.
 *
 * It ships showing its empty state, because `REVIEWS` in `reviewsData.ts` is
 * empty — we hold no verified customer reviews yet, and inventing testimonials
 * for a real business's website is a claim a customer would act on. Add real
 * ones to that file and this page, its filters and the home-page section all
 * light up.
 *
 * /reviews?preview=1 fills the cards with obviously-marked placeholder text so
 * the layout can be checked. A visitor arriving normally never sees it.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COMPANY, whatsappLink } from './siteData';
import type { ReviewKind } from './reviewsData';
import { REVIEWS, REVIEW_KINDS, REVIEW_PREVIEW } from './reviewsData';
import { Chip, SectionHead, SiteEmpty, Stars, TrustRow, SampleTag, Callout } from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { useSeo } from './Seo';



export default function Reviews() {
  useSeo({
    title: 'Customer Reviews',
    path: '/reviews',
    description: 'What customers say about travelling with JustCabs in Mumbai - airport runs, outstation trips, weddings and corporate duties.',
  });
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const source = preview ? REVIEW_PREVIEW : REVIEWS;

  const [kind, setKind] = useState<ReviewKind | 'all'>('all');

  const shown = useMemo(
    () => (kind === 'all' ? source : source.filter((r) => r.kind === kind)),
    [kind, source]
  );

  const average = useMemo(() => {
    if (!source.length) return null;
    return source.reduce((s, r) => s + r.rating, 0) / source.length;
  }, [source]);

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Reviews"
        title="What our customers say"
        sub="Reviews from accounts and families who travel with us, filtered by the kind of trip — a corporate airport run and a family weekend are not the same test."
        crumbs={[{ label: 'Reviews' }]}
        compact
      />

      <section className="shell">
        {preview && (
          <Callout tone="warn" className="mb-6">
            <strong>Layout preview.</strong> Every card below is placeholder text, shown because this URL carries
            <code className="mx-1 font-mono">?preview=1</code>. Visitors do not see it. Add real reviews to
            <code className="mx-1 font-mono">REVIEWS</code> in <code className="font-mono">src/site/reviewsData.ts</code>.
          </Callout>
        )}

        {source.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              <Chip on={kind === 'all'} onClick={() => setKind('all')}>All</Chip>
              {REVIEW_KINDS.filter((k) => source.some((r) => r.kind === k)).map((k) => (
                <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{k}</Chip>
              ))}
            </div>
            {average !== null && (
              <p className="flex items-center gap-2 text-sm text-ink-600">
                <Stars value={average} /> from {source.length} {source.length === 1 ? 'review' : 'reviews'}
              </p>
            )}
          </div>
        )}

        <div className="mt-7">
          {shown.length === 0 ? (
            <SiteEmpty
              emoji="💬"
              title="We are collecting reviews properly"
              body="Rather than fill this page with testimonials nobody can check, it stays empty until we have reviews customers have actually given us and agreed to publish. If you have travelled with us, we would genuinely like yours."
              action={
                <>
                  <a
                    href={whatsappLink('Hello, I would like to leave a review about my trip.')}
                    target="_blank" rel="noreferrer"
                    className="btn h-11 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white hover:bg-[#1FB855]"
                  >
                    <IconWhatsApp className="h-4 w-4" /> Leave a review
                  </a>
                  <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                    <IconPhone className="h-4 w-4" /> Call
                  </a>
                </>
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((r, i) => (
                <Reveal key={r.id} delay={(i % 3) * 60}>
                  <article className="tile flex h-full flex-col p-6">
                    <div className="flex items-start justify-between gap-3">
                      <Stars value={r.rating} />
                      <span className="flex items-center gap-2">
                        {preview && <SampleTag />}
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-brand-700">
                          {r.kind}
                        </span>
                      </span>
                    </div>

                    <p className="mt-4 flex-1 text-sm leading-[1.7] text-ink-700">{r.body}</p>

                    <div className="mt-5 border-t border-ink-100 pt-4">
                      <p className="text-sm font-bold text-ink-900">{r.name}</p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {[r.from, r.vehicle].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          )}
        </div>

        {/* ============================ WHAT WE STAND ON ============================ */}
        <div className="mt-14">
          <SectionHead
            eyebrow="In the meantime"
            title="What you can check instead of a testimonial"
            sub="These are verifiable, which is more than a five-star card is."
            className="mb-8"
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['Our GST registration', 'Registered for GST in Maharashtra - the number is on every invoice we raise and on our About page.'],
              ['Speak to an account', 'Ask for a reference from an account that runs your kind of trip and we will put you in touch.'],
              ['The owner answers the phone', `${COMPANY.owner} handles the account personally. Call before you book and judge for yourself.`],
            ].map(([t, b], i) => (
              <Reveal key={t} delay={i * 70}>
                <div className="tile h-full p-6">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-ok-50 text-ok-600">
                    <IconCheck className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-sm font-bold text-ink-900">{t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{b}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <TrustRow />
          <Link to="/faq" className="text-sm font-bold text-brand-700 hover:text-brand-800">
            Questions before booking <IconArrowRight className="inline h-3.5 w-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
