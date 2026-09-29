import { Link } from 'react-router-dom';
import PageHero from './PageHero';
import { ServiceIcon } from './SiteIcons';
import { COMPANY, SERVICES } from './siteData';
import { IconArrowRight, IconCheck, IconPhone } from '../components/icons';
import { SectionHead, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import { useSeo } from './Seo';

export default function Services() {
  useSeo({
    title: 'Car Rental and Cab Services in Mumbai',
    path: '/services',
    description: 'Airport transfers, local car rental, outstation travel, corporate transport, tour packages and event transport from Mumbai - all chauffeur-driven, 24x7.',
  });
  return (
    <>
      <PageHero
        eyebrow="Our services in Mumbai"
        title="Transport arranged around the job you need done"
        sub="Airport transfers, hourly city duties, outstation runs and contracted corporate accounts — each with its own package structure and billing rhythm."
        crumbs={[{ label: 'Services' }]}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2">
            {SERVICES.map((s) => (
              <article key={s.slug} className="tile flex flex-col p-7">
                <div className="flex items-start gap-4">
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-3xl">
                    <ServiceIcon slug={s.slug} className="h-6 w-6" />
                  </span>
                  <div>
                    <h2 className="text-xl font-bold text-ink-900">{s.name}</h2>
                    <p className="mt-1 text-sm text-ink-600">{s.short}</p>
                  </div>
                </div>

                <p className="mt-5 text-sm leading-relaxed text-ink-700">{s.blurb}</p>

                <ul className="mt-5 space-y-2">
                  {s.points.slice(0, 4).map((p) => (
                    <li key={p} className="flex gap-2.5 text-sm text-ink-700">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex flex-wrap gap-2 border-t border-ink-100 pt-5">
                  {s.idealFor.map((t) => (
                    <span key={t} className="badge-neutral">{t}</span>
                  ))}
                </div>

                <div className="mt-6 flex gap-2">
                  <Link to={`/services/${s.slug}`} className="grad-brand btn h-10 rounded-full px-5 text-sm font-semibold text-white hover:brightness-[1.06]">View details</Link>
                  <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-10 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100"><IconPhone className="h-3.5 w-3.5" /> Call to book</a>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Separated from the page by space on one continuous ground rather than by
          a dark slab — the same rule the rest of the site follows. */}
      <section className="px-5 pb-24 sm:px-8">
        <Reveal className="mx-auto max-w-[76rem]">
          <div className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-12 sm:px-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <SectionHead
                eyebrow="Not sure which fits"
                title="Tell us the trip and we will say which package is cheaper"
                sub={`Four questions and we name the vehicle we would send, with the reasoning shown. Or call ${COMPANY.owner} with the Call button.`}
              />
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/help-me-choose" className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]">
                  Help me choose <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/book" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">Plan a trip</Link>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full px-5 text-md text-ink-700 hover:bg-white">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
              <TrustRow className="mt-8" />
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
