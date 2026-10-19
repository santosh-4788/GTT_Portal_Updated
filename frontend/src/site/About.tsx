import { Link } from 'react-router-dom';
import PageHero from './PageHero';
import { BenefitIcon } from './SiteIcons';
import { COMPANY, WHY_US } from './siteData';
import { IconPhone } from '../components/icons';
import { useSeo } from './Seo';

export default function About() {
  useSeo({
    title: 'About Us - Tours and Travels in Goregaon, Mumbai',
    path: '/about',
    description: 'JustCabs, by Gupta Tours & Travels, is a Mumbai cab and car rental company in Goregaon (W), owned and run by Vinay Gupta, serving families and companies 24x7.',
  });
  return (
    <>
      <PageHero
        eyebrow="About us"
        title="A Mumbai transport business run by the person who answers the phone"
        sub={`JustCabs is a brand of Gupta Tours & Travels, owned and managed by ${COMPANY.owner}. When you call, you reach the person who can actually make the decision.`}
        crumbs={[{ label: 'About Us' }]}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[1.3fr,1fr] lg:px-10">
          <div>
            <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">Who we are</h2>
            <div className="mt-5 space-y-4 text-[15px] leading-relaxed text-ink-700">
              <p>
                JustCabs, a brand of Gupta Tours &amp; Travels, provides corporate transport, car rental and outstation travel from our base in
                Goregaon (West), Mumbai. We work with corporate accounts and travel aggregators who need transport that
                simply happens — the car is there, the driver knows the route, and the invoice arrives in the format the
                accounts team can process.
              </p>
              <p>
                Most of what we run is repeat contracted work: airport transfers for visiting staff, hourly duties for a
                day of meetings across the city, and outstation runs to Pune, Nashik and Shirdi. That kind of work only
                stays with you if the operational detail is right every single time.
              </p>
              <p>
                We are GST registered under <span className="font-mono text-ink-900">{COMPANY.gstin}</span>, and we bill
                against agreed rate cards with toll and parking passed through at actuals. Duty slips and trip evidence
                are retained against every booking, so any query months later can be answered with a document rather
                than a memory.
              </p>
            </div>

            <h2 className="mt-12 text-2xl font-bold text-ink-900 sm:text-3xl">How we work</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {[
                ['One point of contact', `${COMPANY.owner} handles accounts personally. No call-centre queue, no ticket number.`],
                ['Agreed rates in advance', 'Rate cards are set per account. What counts as an extra is defined before the trip, not argued after it.'],
                ['Evidence kept on file', 'Duty slips, toll receipts and trip photos are filed against the booking they belong to.'],
                ['Billing in your format', 'Each account gets its invoice in the layout its finance team already accepts.'],
              ].map(([t, b]) => (
                <div key={t} className="rounded-xl border border-ink-200/70 bg-ink-50/60 p-5">
                  <h3 className="font-semibold text-ink-900">{t}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{b}</p>
                </div>
              ))}
            </div>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="tile overflow-hidden">
              <div className="grid place-items-center bg-gradient-to-br from-ink-900 to-brand-800 px-6 py-8">
                <img
                  src="/assets/art-car-line-bold.svg"
                  alt="JustCabs"
                  className="h-auto w-64 max-w-full"
                />
              </div>
              <div className="p-6">
                <h3 className="font-display text-lg font-bold text-ink-900">{COMPANY.name}</h3>
                <p className="mt-0.5 text-sm text-brand-600">{COMPANY.tagline}</p>
                <p className="mt-1 text-xs text-ink-500">A brand of {COMPANY.legalName}</p>

                <dl className="mt-5 space-y-3.5 text-sm">
                  {[
                    ['Owner', COMPANY.owner],
                    ['Based in', 'Goregaon (W), Mumbai'],
                    ['Availability', COMPANY.serviceHours],
                    ['GSTIN', COMPANY.gstin],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-ink-100 pb-3 last:border-0">
                      <dt className="text-ink-500">{k}</dt>
                      <dd className="text-right font-semibold text-ink-900">{v}</dd>
                    </div>
                  ))}
                </dl>

                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn mt-6 h-12 w-full rounded-full bg-ink-900 text-md text-white hover:bg-ink-800">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
                <Link to="/contact" className="btn-outline mt-2 w-full">Send an enquiry</Link>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <h2 className="mb-10 text-center text-2xl font-bold text-ink-900 sm:text-3xl">What you can rely on</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map((w) => (
              <div key={w.title} className="tile p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><BenefitIcon title={w.title} /></span>
                <h3 className="mt-4 font-semibold text-ink-900">{w.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{w.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
