import { Link } from 'react-router-dom';
import {
  COMPANY, FLEET, ROUTES, WHY_US, INCLUDED, CHARGED_SEPARATELY, FAQS, } from './siteData';
import { NEEDS, TINT_CLASS, TRUST } from './catalog';
import { DESTINATIONS } from './places';
import { GROUP_EXAMPLES } from './recommend';
import { REVIEWS } from './reviewsData';
import { BenefitIcon, IconWhatsApp, IconSeat, IconLuggage } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import { QuickBook, BookingHelpBanners } from './QuickBook';
import { DestinationCard, NeedPhoto } from './PlaceCards';
import { SectionHead, TrustRow, Stars } from './kit';
import { Reveal } from '../components/Reveal';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { HeroJourney } from '../components/HeroJourney';
import { FareCalculator } from './FareCalculator';
import { IconPhone, IconArrowRight, IconCheck, IconPin } from '../components/icons';
import { useSeo } from './Seo';

/* ==========================================================================
   Home.
   ==========================================================================
   The homepage no longer opens with "pickup → drop → search". It opens with the
   question the business is actually asked — what do you need today — because a
   wedding fleet, a monthly corporate account and a 4am airport drop are not the
   same journey and a single search box serves none of them well.

   Everything sits on one pale ground. Sections are told apart by rounded
   surfaces, spacing and type, never by rules, outlines or dark slabs.
   ========================================================================== */

/** Soft colour ways behind the fleet photos, so the row does not read flat. */
const FLEET_TINT = ['grad-soft', 'grad-mint', 'grad-warm'];

const PLANNERS = [
  {
    to: '/group-travel',
    emoji: '\u{1F46A}',
    title: 'Travelling as a group?',
    body: 'Type the number of you and we say straight away whether that is one vehicle or several, and which.',
    cta: 'Work out my group',
  },
  {
    to: '/fleet-request',
    emoji: '\u{1F68C}',
    title: 'Need multiple vehicles?',
    body: 'For weddings, corporate events and conferences. Build the fleet in a minute and get one quote.',
    cta: 'Plan my fleet',
  },
  {
    to: '/weddings',
    emoji: '\u{1F48D}',
    title: 'Planning a wedding?',
    body: 'Four days, six functions and guests from three cities — planned as one schedule, on one invoice.',
    cta: 'Open the wedding planner',
  },
  {
    to: '/corporate',
    emoji: '\u{1F3E2}',
    title: 'Corporate account?',
    body: 'Rate cards, duty slips, a billing cycle that suits your accounts team and invoices in their format.',
    cta: 'Corporate travel',
  },
];

export default function Home() {
  useSeo({
    title: 'Gupta Tours & Travels | Cab Booking & Car Rental in Mumbai, 24x7',
    rawTitle: true,
    path: '/',
    description: 'Book a cab in Mumbai with a professional chauffeur: airport pickups and drops, local hourly car rental, outstation trips to Pune, Lonavala, Nashik and beyond, and corporate transport. 24x7 from Goregaon (W).',
  });
  return (
    <div className="page-bg">

      {/* ============================== HERO ============================== */}
      <section className="relative">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute -left-40 -top-56 h-[38rem] w-[38rem] rounded-full bg-brand-200/35 blur-[120px]" />
          <div className="absolute right-[-12rem] top-[-8rem] h-[34rem] w-[34rem] rounded-full bg-[#C7D2FE]/35 blur-[120px]" />
          <div className="absolute bottom-[-14rem] left-1/3 h-[30rem] w-[30rem] rounded-full bg-[#CFF3E6]/40 blur-[120px]" />
        </div>

        <div className="shell relative grid items-center gap-10 pb-10 pt-28 sm:pt-32 lg:grid-cols-[1.05fr,1fr] lg:gap-14 lg:pt-36">
          <div>
            <span className="pill animate-fade-up">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-500" />
              </span>
              {COMPANY.serviceHours} · Mumbai &amp; outstation
            </span>

            <h1
              className="mt-6 max-w-[16ch] font-display text-[2.6rem] font-extrabold leading-[1.03] tracking-[-0.035em] text-ink-900 animate-fade-up sm:text-[3.3rem] lg:text-[3.9rem]"
              style={{ animationDelay: '60ms' }}
            >
              Every journey.{' '}
              {/* The accent carries a slow gradient drift and a route line drawn
                  under it — the same line as the logo mark, so the flourish is
                  the brand rather than decoration borrowed from somewhere. */}
              <span className="relative inline-block">
                <span className="grad-text">One place.</span>
                {/* Sits clear of the descender on the "p" — any higher and it
                    reads as a strikethrough rather than an underline. */}
                <svg
                  className="hero-underline pointer-events-none absolute -bottom-[0.14em] left-0 h-[0.2em] w-full text-brand-400"
                  viewBox="0 0 200 12"
                  fill="none"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path d="M3 8.6C44 3.4 96 2.2 197 5.9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                </svg>
              </span>
            </h1>

            <p
              className="mt-6 max-w-lg text-md leading-[1.75] text-ink-600 animate-fade-up sm:text-lg"
              style={{ animationDelay: '120ms' }}
            >
              Cab booking and car rental in Mumbai, from local travel and airport transfers to outstation trips,
              corporate transport, weddings and large events — the right vehicle and the right arrangement in one
              place, with the rate agreed before anything moves.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3 animate-fade-up" style={{ animationDelay: '180ms' }}>
              <Link
                to="/book"
                className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter] hover:brightness-[1.06]"
              >
                Plan my trip <IconArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/vehicles" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                Explore vehicles
              </Link>
              <a
                href={`tel:+91${COMPANY.mobile}`}
                aria-label="Call the office"
                className="btn h-12 rounded-full border border-ink-200 bg-white/70 px-5 text-md text-ink-700 transition-colors hover:border-ink-300 hover:bg-white"
              >
                <IconPhone className="h-4 w-4" /> Call
              </a>
            </div>


            {/* The four facts, as one panel rather than four loose pairs of
                words.

                They used to be a plain grid on the page background, and because
                the columns sized themselves to their content the gaps between
                them came out uneven — "Happy customers" is half as wide again
                as "Registered", so it stole space from its neighbours and the
                row read as slightly broken. Fixed columns inside a bordered
                panel give even spacing whatever the labels say, and the hairline
                rules make it deliberate instead of merely aligned. */}
            <dl className="glass mt-10 grid w-full max-w-xl grid-cols-2 overflow-hidden rounded-2xl animate-fade-up sm:grid-cols-4"
              style={{ animationDelay: '240ms' }}>
              {[
                ['24×7', 'Availability'],
                ['4–45', 'Seater fleet'],
                ['GST', 'Registered'],
                ['5K+', 'Happy customers'],
              ].map(([v, l], i) => (
                <div
                  key={l}
                  className={[
                    'min-w-0 border-ink-100/90 px-4 py-4 sm:px-3.5',
                    // two columns on a phone, four from sm: the dividing rules
                    // have to move with the wrap or they land mid-row.
                    i % 2 === 1 ? 'border-l' : '',
                    i >= 2 ? 'border-t' : '',
                    i >= 1 ? 'sm:border-l' : 'sm:border-l-0',
                    'sm:border-t-0',
                  ].join(' ')}
                >
                  <dt className="stat-figure">{v}</dt>
                  {/* Wraps rather than runs on. "Happy customers" is wider than
                      a quarter of this panel, and with the panel clipping its
                      corners a no-wrap label lost its last letter off the edge. */}
                  <dd className="stat-label leading-snug tracking-[0.1em]">{l}</dd>
                </div>
              ))}
            </dl>
          </div>

          <HeroJourney className="animate-fade-up mb-4 aspect-[5/6] w-full sm:mb-10 sm:aspect-[3/2] lg:mb-0 lg:aspect-auto lg:h-[26rem]" />
        </div>

        {/* the booking widget bridges the hero and the page below it */}
        <div className="shell relative z-30">
          <Reveal>
            <QuickBook />
          </Reveal>
        </div>
      </section>

      {/* ====================== WHAT DO YOU NEED TODAY? ====================== */}
      <section className="pt-16 sm:pt-20">
        <div className="shell">
          <Reveal className="mb-8">
            <SectionHead
              eyebrow="Start here"
              title="What do you need today?"
              sub="Nine doors into the same fleet. Each one asks only the questions that kind of trip actually needs."
              action={
                <Link to="/services" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  All services <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </Reveal>

          {/* Six of the nine on a phone; "All services" beside the heading
              has the rest. Nine stacked tiles were a lot of scrolling. */}
          <div className="grid grid-cols-2 gap-3.5 max-sm:[&>*:nth-child(n+7)]:hidden sm:grid-cols-3">
            {NEEDS.map((n, i) => (
              <Reveal key={n.key} delay={(i % 4) * 50}>
                <Link
                  to={n.to}
                  className="tile tile-lift group flex h-full flex-col overflow-hidden"
                >
                  <NeedPhoto need={n} index={i} />
                  <span className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                    <span className="flex-1">
                      <span className="block font-display text-sm font-bold leading-snug text-ink-900">{n.label}</span>
                      <span className="mt-1 block text-xs leading-relaxed text-ink-500">{n.sub}</span>
                    </span>
                    <IconArrowRight className="h-3.5 w-3.5 text-ink-300 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-6">
            <BookingHelpBanners />
          </Reveal>
        </div>
      </section>

      {/* ============================== FLEET ============================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-10">
            <SectionHead
              eyebrow="Our fleet"
              title="The right vehicle for the duty"
              sub="Twelve vehicles we actually run — recent models, cleaned before dispatch and checked before every corporate duty. Pick a trip and each card shows what it would cost."
              action={
                <Link to="/vehicles" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  Compare the fleet <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </Reveal>

          {/* Three of the seven on a phone. All seven stacked was 3,055px,
              the single tallest thing on the page. */}
          <div className="grid gap-5 max-sm:[&>*:nth-child(n+4)]:hidden sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {FLEET.map((v, i) => (
              <Reveal key={v.slug} delay={(i % 4) * 70}>
                <Link
                  to={`/vehicles/${v.slug}`}
                  className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-shadow duration-300 hover:shadow-lift"
                >
                  <div className={`${FLEET_TINT[i % FLEET_TINT.length]} relative overflow-hidden`}>
                    <VehiclePhoto
                      photo={v.photo}
                      art={v.art}
                      name={v.name}
                      alt={`${v.name} — ${v.examples}`}
                      className="aspect-[3/2] w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.05]"
                    />
                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-ink-950/15 to-transparent" />
                    <span className="absolute left-3.5 top-3.5 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-brand-700 backdrop-blur">
                      {v.category}
                    </span>
                    <div className="absolute inset-x-4 bottom-3">
                      <h3 className="font-display text-lg font-bold leading-tight text-white">{v.name}</h3>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-ink-700">
                      <span className="inline-flex items-center gap-1.5">
                        <IconSeat className="h-4 w-4 text-brand-500" /> {v.seats} seats
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <IconLuggage className="h-4 w-4 text-brand-500" /> {v.luggage}
                      </span>
                    </div>

                    <p className="mt-2.5 flex-1 text-sm leading-relaxed text-ink-500">
                      Best for {v.best.toLowerCase()}.
                    </p>

                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                      Details
                      <IconArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-9 text-center">
            <Link to="/vehicles" className="btn h-11 max-w-full rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised max-[360px]:px-4 max-[360px]:text-sm">
              See the full fleet, with estimates <IconArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-5 text-2xs text-ink-400">
              Each photograph shows the class of vehicle, not the specific one assigned to a booking.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ========================= WEEKEND DESTINATIONS ========================= */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-9">
            <SectionHead
              eyebrow="Where people go"
              title="Weekend escapes from Mumbai"
              sub="Everywhere within a day's drive, with the itinerary, the vehicle we would send and an estimate for the round trip."
              action={
                <Link to="/weekend-trips" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  All destinations <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </Reveal>

          {/* Two of the four on a phone; "All destinations" is beside the
              heading. Four of these cards came to 2,108px. */}
          <div className="grid gap-5 max-sm:[&>*:nth-child(n+3)]:hidden sm:grid-cols-2 lg:grid-cols-4">
            {DESTINATIONS.slice(0, 4).map((d, i) => (
              <Reveal key={d.slug} delay={(i % 4) * 60}>
                <DestinationCard d={d} index={i} />
              </Reveal>
            ))}
          </div>

          <Reveal className="mt-7 flex flex-wrap gap-3">
            <Link to="/find-a-trip" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
              Help me find a trip <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/tours/mumbai" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
              Explore Mumbai instead
            </Link>
          </Reveal>

          {/* Photographs on this page that are not ours — the destinations
              here, and some of the service cards above — are Wikimedia images
              under licences that require the page to credit them. Two files,
              because they are two folders. */}
        </div>
      </section>

      {/* ============================== PLANNERS ==============================
          Same shape as every other section on the page: the standard header,
          then four equal cards across, then one slim strip with the headcount
          examples. */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-8">
            <SectionHead
              eyebrow="Bigger than one car"
              title="Tell us what you need — we work out the rest"
              sub="Groups, fleets, weddings and corporate accounts each have their own planner, not a contact form and a wait."
            />
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLANNERS.map((pl, i) => (
              <Reveal key={pl.to} delay={(i % 4) * 60}>
                <Link to={pl.to} className="tile tile-lift group flex h-full gap-4 p-4 sm:flex-col sm:gap-0 sm:p-5">
                  <span className="grad-soft grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" aria-hidden="true">{pl.emoji}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                  <h3 className="font-display text-md font-bold text-ink-900 sm:mt-4">{pl.title}</h3>
                  <p className="mt-1 flex-1 text-sm leading-relaxed text-ink-500 sm:mt-1.5">{pl.body}</p>
                  <span className="mt-2.5 inline-flex sm:mt-4 items-center gap-1 text-xs font-bold text-brand-700">
                    {pl.cta}
                    <IconArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>

          <Reveal className="tile mt-4 flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6">
            <div className="shrink-0 lg:w-56">
              <p className="font-display text-sm font-bold text-ink-900">How a headcount becomes vehicles</p>
              <Link to="/group-travel" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800">
                Try your own number <IconArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <ul className="grid flex-1 gap-3 sm:grid-cols-3">
              {GROUP_EXAMPLES.map((ex) => (
                <li key={ex.pax} className="flex items-center gap-3 rounded-2xl bg-ink-50/70 px-4 py-3">
                  <span className="text-center">
                    <span className="block font-display text-xl font-extrabold leading-none text-ink-900">{ex.pax}</span>
                    <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.12em] text-ink-400">people</span>
                  </span>
                  <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300" />
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-brand-700">{ex.plan.headline}</span>
                    <span className="block text-xs leading-snug text-ink-500">
                      {ex.plan.legs.map((l) => `${l.count > 1 ? `${l.count} × ` : ''}${l.vehicle.name}`).join(' + ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ============================ FARE CALCULATOR ======================== */}
      <div id="fare" className="scroll-mt-24">
        <FareCalculator />
      </div>

      {/* ============================== TRUST ============================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="grad-soft rounded-[2.25rem] px-6 py-10 sm:px-10 sm:py-12">
            <div className="grid gap-8 lg:grid-cols-[0.85fr,1.15fr] lg:gap-12">
              <div>
                <span className="lead">Why it is safe to book</span>
                <h2 className="font-display text-[1.7rem] font-extrabold leading-[1.12] tracking-[-0.03em] text-ink-900 sm:text-[2.1rem]">
                  Six things you can check before you pay anything
                </h2>
                <p className="mt-4 text-md leading-[1.7] text-ink-600">
                  Nothing on this site charges you. The rate is agreed first, and every one of these is a claim we can
                  be held to.
                </p>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {TRUST.map((t) => (
                  <li key={t.label} className="flex gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ok-50 text-ok-600">
                      <IconCheck className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-ink-900">{t.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{t.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================== WHY US ============================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-8">
            <SectionHead
              eyebrow="Why choose us"
              title="The details that decide whether you book again"
              sub="Anyone can send a car. These are the things that make the second booking easy."
            />
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map((w, i) => (
              <Reveal key={w.title} delay={(i % 3) * 60}>
                <div className="tile h-full p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <span className="grad-soft grid h-10 w-10 shrink-0 place-items-center rounded-xl text-brand-600">
                      <BenefitIcon title={w.title} />
                    </span>
                    <h3 className="font-display text-md font-bold text-ink-900">{w.title}</h3>
                  </div>
                  <p className="mt-2.5 text-[13px] leading-relaxed text-ink-500 sm:mt-3 sm:text-sm">{w.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ============================== ROUTES ============================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-8">
            <SectionHead
              eyebrow="Popular routes"
              title="Outstation destinations we run every week"
              sub="One-way drops and round trips from Mumbai. Distances vary with the route on the day."
            />
          </Reveal>

          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-4">
            {ROUTES.map((r, i) => {
              const known = DESTINATIONS.find((d) => d.name === r.to);
              return (
                <Reveal key={r.to} delay={(i % 4) * 55}>
                  <Link
                    to={known ? `/destinations/${known.slug}` : `/vehicles?tab=OUTSTATION&from=Mumbai&to=${encodeURIComponent(r.to)}`}
                    className="tile tile-lift group flex w-full items-center gap-2.5 p-3 text-left sm:gap-3.5 sm:p-4"
                  >
                    <span className="grad-soft hidden h-11 w-11 shrink-0 place-items-center rounded-2xl text-brand-600 transition-colors duration-300 group-hover:text-brand-700 sm:grid">
                      <IconPin className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink-900">{r.to}</span>
                      <span className="block text-xs tabular-nums text-ink-500">{r.km} · {r.time}</span>
                    </span>
                    <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-brand-600" />
                  </Link>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* =========================== HOW IT WORKS =========================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-10 max-w-2xl">
            <span className="lead">How it works</span>
            <h2 className="h-sec">Four steps from enquiry to invoice</h2>
          </Reveal>

          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Tell us the trip', 'Use a planner here, call, or send a WhatsApp. Date, time, pickup, drop and vehicle type is all we need.'],
              ['Confirm the quote', 'You get the package, the rate and what counts as extra before the car is assigned.'],
              ['Travel', 'A uniformed chauffeur reports on time, with the vehicle cleaned and ready.'],
              ['Get the invoice', 'A GST invoice in your required format, with toll and parking shown separately.'],
            ].map(([title, body], i) => (
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
        </div>
      </section>

      {/* ============================== INCLUDED ============================== */}
      <section className="pt-20 sm:pt-24 lg:pt-28">
        <div className="shell">
          <Reveal className="mb-8">
            <SectionHead
              eyebrow="No surprises"
              title="What the fare covers"
              sub="You are told the number before the car is assigned. These are the only things that can appear on top of it."
              action={
                <Link to="/policies#terms" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                  Estimate vs quote <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
          </Reveal>

          <div className="grid gap-4 lg:grid-cols-2">
            <Reveal className="tile h-full p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-ok-50 text-ok-600"><IconCheck className="h-5 w-5" /></span>
                <h3 className="font-display text-md font-bold text-ink-900">Included in the quoted fare</h3>
              </div>
              <ul className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex gap-2.5 text-sm leading-snug text-ink-600">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>

            <Reveal delay={80} className="tile h-full p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-warn-50 text-lg font-bold text-warn-600">+</span>
                <h3 className="font-display text-md font-bold text-ink-900">Billed on top, at actuals</h3>
              </div>
              <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {CHARGED_SEPARATELY.map(([label, note]) => (
                  <div key={label} className="border-l-2 border-warn-200 pl-3">
                    <dt className="text-sm font-semibold text-ink-900">{label}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed text-ink-500">{note}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============================== REVIEWS ============================== */}
      {/* Rendered only when there are real reviews to show. See Reviews.tsx for
          why this page ships without invented testimonials. */}
      {REVIEWS.length > 0 && (
        <section className="pt-20 sm:pt-24 lg:pt-28">
          <div className="shell">
            <Reveal className="mb-9">
              <SectionHead
                eyebrow="Reviews"
                title="What our customers say"
                action={
                  <Link to="/reviews" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                    All reviews <IconArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
              />
            </Reveal>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {REVIEWS.slice(0, 3).map((r, i) => (
                <Reveal key={r.id} delay={i * 70}>
                  <article className="tile h-full p-6">
                    <Stars value={r.rating} />
                    <p className="mt-4 text-sm leading-[1.7] text-ink-700">{r.body}</p>
                    <p className="mt-5 border-t border-ink-100 pt-4 text-sm font-bold text-ink-900">{r.name}</p>
                    <p className="mt-0.5 text-xs text-ink-500">{[r.from, r.vehicle].filter(Boolean).join(' · ')}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ============================== CLOSING ============================== */}
      <section className="px-5 pb-24 pt-20 sm:px-8 sm:pb-28 sm:pt-24 lg:pt-28">
        <Reveal className="mx-auto max-w-[76rem]">
          <div className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-14 sm:px-12 sm:py-16">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />

            {/*
              The line drawing. An <img> rather than an inline component on
              purpose: 32 KB of generated path data has no business in the JS
              bundle when the browser can cache it as a file. Hidden below md —
              at phone width it would sit under the copy and read as noise.
            */}
            <img
              src="/assets/art-car-line.svg"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-10 -right-12 hidden w-[30rem] max-w-none select-none opacity-[0.2] md:block lg:-right-6 lg:w-[36rem]"
            />

            <div className="relative grid items-center gap-8 lg:grid-cols-[1.2fr,auto] lg:gap-14">
              <div>
                <h2 className="max-w-[18ch] font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
                  Ready to plan your next journey?
                </h2>
                <p className="mt-4 max-w-xl text-md leading-[1.7] text-ink-600">
                  Tell us what you need in your own words and the assistant will come back with the vehicle, the
                  itinerary and an estimate — or call {COMPANY.owner} directly.
                </p>
                <TrustRow compact className="mt-6" />
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/assistant"
                  className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                >
                  Tell us what you need <IconArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href={`tel:+91${COMPANY.mobile}`}
                  aria-label="Call the office"
                  className="btn h-12 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800"
                >
                  <IconPhone className="h-4 w-4" /> Call
                </a>
                <WhatsAppButton
                  className="btn h-12 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
                >
                  <IconWhatsApp className="h-4 w-4" /> WhatsApp
                </WhatsAppButton>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
