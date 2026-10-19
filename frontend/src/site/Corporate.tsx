/**
 * The corporate landing page.
 *
 * Contracted corporate transport is most of what this business actually does,
 * and until now the website mentioned it in a paragraph. This page is written
 * for the person who has to justify the choice internally: what is covered, how
 * billing works, and what they get that a marketplace cannot give them.
 */
import { Link } from 'react-router-dom';
import { COMPANY } from './siteData';
import { CORPORATE_BLOCKS, TRUST } from './catalog';
import { BackLink, SectionHead, TrustRow, ContactRow } from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck, IconInvoices, IconLock, IconPhone, IconShield, IconClock } from '../components/icons';
import { useSeo } from './Seo';

const PROMISES = [
  {
    Icon: IconInvoices,
    title: 'Invoices in your own format',
    body: 'We raise the invoice in the layout your accounts team already processes — the same template, the same cell for the same figure — so nothing comes back for rework.',
  },
  {
    Icon: IconClock,
    title: 'A billing cycle that suits you',
    body: 'Per trip, fortnightly or monthly. Every duty is logged separately and then consolidated, so the bill reconciles line by line against what you booked.',
  },
  {
    Icon: IconShield,
    title: 'Duty slips kept against every trip',
    body: 'Reporting time, opening and closing readings and the stops made are recorded, so extra hours and kilometres on an invoice can always be checked.',
  },
  {
    Icon: IconPhone,
    title: 'One person, not a call centre',
    body: `${COMPANY.owner} handles the account personally. There is no ticket number between you and a decision at 5am.`,
  },
];

const STEPS = [
  ['Tell us the pattern', 'Which routes, how often, how many vehicles, and what your accounts team needs on the invoice.'],
  ['Agree the rate card', 'A per-account card covering the duty packages you actually use, agreed before the first trip.'],
  ['Start booking', 'Call, WhatsApp or email each duty. Recurring runs are set up once and then just happen.'],
  ['Get one bill', 'Consolidated to your cycle, GST-compliant, in your format, with toll and parking itemised at actuals.'],
];

export default function Corporate() {
  useSeo({
    title: 'Corporate Car Rental in Mumbai',
    path: '/corporate',
    description: 'Corporate car rental and employee transport in Mumbai: monthly and on-call cars, airport desks for visiting guests, GST invoices and one account manager.',
  });
  return (
    <div className="page-bg pb-24">
      {/* ================================ HERO ================================ */}
      <section className="relative overflow-hidden pb-12 pt-28 sm:pt-36">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -left-40 -top-56 h-[36rem] w-[36rem] rounded-full bg-brand-200/35 blur-[120px]" />
          <div className="absolute right-[-12rem] top-[-8rem] h-[30rem] w-[30rem] rounded-full bg-[#C7D2FE]/35 blur-[120px]" />
        </div>

        <div className="shell relative">
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            <BackLink />
            <nav className="flex items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
              <Link to="/" className="hover:text-brand-700">Home</Link>
              <span className="text-ink-300">/</span>
              <span className="font-medium text-ink-700">Corporate</span>
            </nav>
          </div>

          <span className="pill">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> GST registered · GST-compliant invoices
          </span>

          <h1 className="mt-6 max-w-3xl font-display text-[2.4rem] font-extrabold leading-[1.04] tracking-[-0.035em] text-ink-900 sm:text-[3.2rem]">
            Corporate travel, <span className="grad-text">simplified.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-md leading-[1.75] text-ink-600 sm:text-lg">
            Contracted transport for corporate accounts and travel aggregators across Mumbai and Maharashtra — agreed
            rate cards, duty slips against every trip, and invoices your accounts team can process without a phone call.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/corporate/request"
              className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
            >
              Plan corporate travel <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/login" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
              <IconLock className="h-4 w-4" /> Corporate login
            </Link>
            <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full border border-ink-200 bg-white/70 px-5 text-md text-ink-700 transition-colors hover:border-ink-300 hover:bg-white">
              <IconPhone className="h-4 w-4" /> Call
            </a>
          </div>

          <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
            {[
              ['24×7', 'Booking desk'],
              ['GST', 'Compliant invoices'],
              ['4–45', 'Seater fleet'],
              ['1', 'Point of contact'],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="stat-figure">{v}</dt>
                <dd className="stat-label">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ============================== WHAT WE RUN ============================== */}
      <section className="shell pt-8 sm:pt-12">
        <SectionHead
          eyebrow="What we cover"
          title="Six kinds of corporate movement"
          sub="Most accounts start with one of these and add the others as they go. All of them sit under the same rate card and the same bill."
          className="mb-9"
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CORPORATE_BLOCKS.map((b, i) => (
            <Reveal key={b.key} delay={(i % 3) * 70}>
              <Link
                to={`/corporate/request?type=${b.key === 'dedicated' || b.key === 'recurring' ? 'employee' : b.key === 'airport' ? 'employee' : b.key}`}
                className="tile tile-lift group flex h-full flex-col p-6"
              >
                <span className="grad-soft grid h-12 w-12 place-items-center rounded-2xl text-xl">{b.emoji}</span>
                <h3 className="mt-4 font-display text-md font-bold text-ink-900">{b.label}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-500">{b.note}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                  Request this
                  <IconArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ============================== THE PROMISE ============================== */}
      <section className="shell pt-16 sm:pt-24">
        <div className="grid gap-8 lg:grid-cols-[0.9fr,1.1fr] lg:gap-12">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <span className="lead">Why accounts stay</span>
            <h2 className="h-sec">The four things that decide whether transport is a problem</h2>
            <p className="mt-4 text-md leading-[1.7] text-ink-500">
              Anyone can send a car. What makes an account easy is what happens around the car — the paperwork, the
              billing and who picks up the phone.
            </p>
            <TrustRow className="mt-7" />
          </Reveal>

          <div className="grid gap-5 sm:grid-cols-2">
            {PROMISES.map((p, i) => (
              <Reveal key={p.title} delay={(i % 2) * 80}>
                <div className="tile h-full p-6">
                  <span className="grad-soft grid h-11 w-11 place-items-center rounded-2xl text-brand-600">
                    <p.Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-sm font-bold text-ink-900">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ HOW IT STARTS ============================ */}
      <section className="shell pt-16 sm:pt-24">
        <SectionHead
          eyebrow="Opening an account"
          title="Four steps, and none of them is a tender"
          className="mb-9"
        />
        <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([title, body], i) => (
            <Reveal as="li" key={title} delay={i * 70}>
              <div className="tile h-full p-6">
                <span className="grad-brand grid h-9 w-9 place-items-center rounded-xl font-display text-xs font-bold text-white">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-4 font-display text-sm font-bold text-ink-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* =============================== BILLING =============================== */}
      <section className="shell pt-16 sm:pt-24">
        <Reveal className="tile p-7 sm:p-10">
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
            <div>
              <span className="lead">Billing</span>
              <h2 className="font-display text-[1.6rem] font-bold leading-tight tracking-[-0.02em] text-ink-900 sm:text-[2rem]">
                What appears on your invoice
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-ink-500">
                Nothing is bundled. Each of these is its own line, and the reimbursables are passed through at what they
                cost, against receipts.
              </p>
              <div className="mt-6">
                <ContactRow message="Hello, we would like to open a corporate account with JustCabs." />
              </div>
            </div>

            <ul className="space-y-3.5">
              {[
                ['Base fare', 'The agreed package for the duty — hours and kilometres included.'],
                ['Extra hours', 'Beyond the package, at the rate on your card.'],
                ['Extra kilometres', 'Beyond the package, at the rate on your card.'],
                ['Toll and parking', 'At actuals, itemised, never marked up.'],
                ['State permit', 'On outstation runs that cross a border.'],
                ['Driver allowance', 'Per night away on a multi-day duty.'],
                ['GST', 'At the applicable rate, with our GSTIN on the document.'],
              ].map(([label, note]) => (
                <li key={label} className="flex gap-3 rounded-2xl bg-ink-50/70 p-3.5">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-800">{label}</span>
                    <span className="block text-xs leading-relaxed text-ink-500">{note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* ================================ CLOSE ================================ */}
      <section className="px-5 pt-16 sm:px-8 sm:pt-24">
        <Reveal className="mx-auto max-w-[76rem]">
          <div className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-14 sm:px-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />
            <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr,auto] lg:gap-14">
              <div>
                <h2 className="max-w-[20ch] font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
                  Tell us the pattern and we will quote the card.
                </h2>
                <p className="mt-4 max-w-xl text-md leading-[1.7] text-ink-600">
                  Two minutes of detail is enough to price an account properly — the routes, the frequency and what your
                  accounts team needs to see.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/corporate/request"
                  className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                >
                  Plan corporate travel <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/login" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                  <IconLock className="h-4 w-4" /> Corporate login
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
