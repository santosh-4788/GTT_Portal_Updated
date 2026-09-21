/**
 * Event transportation.
 *
 * Seven kinds of event, each leading straight into the planner with the type
 * already set — so a conference organiser is never asked to describe their
 * event in a "message" box the way every competitor's single contact form
 * makes them.
 */
import { Link } from 'react-router-dom';
import { COMPANY } from './siteData';
import { EVENT_TYPES } from './catalog';
import { GROUP_EXAMPLES } from './recommend';
import { SectionHead, TrustRow, ContactRow } from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck } from '../components/icons';

const HOW = [
  ['One coordinator', 'You get one number for the whole movement, not a driver per vehicle to chase.'],
  ['A published timetable', 'Every vehicle has a reporting time and a route agreed before the day, shared with your team.'],
  ['Staggered pickups', 'Guests arriving from several hotels or terminals are collected in waves, not all at once.'],
  ['Standby through the day', 'Vehicles wait on site where the event needs them to, rather than being released and recalled.'],
  ['Each vehicle logged', 'Every vehicle is its own booking with its own duty slip, so the final bill reconciles exactly.'],
  ['One consolidated invoice', 'The whole event on a single GST invoice, itemised per vehicle and per day.'],
];

export default function Events() {
  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Events"
        title="Event transportation"
        sub="Multiple vehicles, several pickup points and a timetable that has to hold. We have run conferences, weddings, shoots and match days — the coordination is the job, not the cars."
        crumbs={[{ label: 'Events' }]}
      />

      {/* ============================ EVENT TYPES ============================ */}
      <section className="shell">
        <SectionHead
          eyebrow="Start here"
          title="What are you running?"
          sub="Each one opens the planner with the right questions already in place."
          className="mb-9"
        />

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {EVENT_TYPES.map((e, i) => (
            <Reveal key={e.slug} delay={(i % 3) * 70}>
              <Link
                to={e.slug === 'wedding' ? '/weddings' : `/events/planner?type=${e.slug}`}
                className="tile tile-lift group flex h-full flex-col p-6"
              >
                <span className="grad-soft grid h-14 w-14 place-items-center rounded-2xl text-2xl" aria-hidden="true">
                  {e.emoji}
                </span>
                <h3 className="mt-4 font-display text-md font-bold text-ink-900">{e.label}</h3>
                <p className="mt-1.5 text-sm text-ink-500">{e.sub}</p>

                <ul className="mt-4 flex-1 space-y-1.5">
                  {e.needs.map((n) => (
                    <li key={n} className="flex gap-2 text-xs leading-relaxed text-ink-500">
                      <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" /> {n}
                    </li>
                  ))}
                </ul>

                <span className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
                  Plan this
                  <IconArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-8 flex flex-wrap gap-3">
          <Link
            to="/events/planner"
            className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
          >
            Open the event planner <IconArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/fleet-request" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
            I already know the vehicles
          </Link>
        </Reveal>
      </section>

      {/* ============================== HOW IT RUNS ============================== */}
      <section className="shell pt-16 sm:pt-24">
        <div className="grid gap-8 lg:grid-cols-[0.9fr,1.1fr] lg:gap-12">
          <Reveal className="lg:sticky lg:top-24 lg:self-start">
            <span className="lead">How an event runs</span>
            <h2 className="h-sec">Six things that keep a movement from unravelling</h2>
            <p className="mt-4 text-md leading-[1.7] text-ink-500">
              An event is not twenty bookings. It is one timetable with twenty vehicles on it, and that is how we take
              it, quote it and bill it.
            </p>
            <TrustRow className="mt-7" />
          </Reveal>

          <div className="grid gap-5 sm:grid-cols-2">
            {HOW.map(([title, body], i) => (
              <Reveal key={title} delay={(i % 2) * 80}>
                <div className="tile h-full p-6">
                  <span className="grad-brand grid h-9 w-9 place-items-center rounded-xl font-display text-xs font-bold text-white">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-4 font-display text-sm font-bold text-ink-900">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* =========================== SCALE EXAMPLES =========================== */}
      <section className="shell pt-16 sm:pt-24">
        <SectionHead
          eyebrow="Scale"
          title="What a guest count turns into"
          sub="The same calculation the group planner runs, so you can sanity-check a headcount before you call anybody."
          className="mb-8"
        />
        <div className="grid gap-5 sm:grid-cols-3">
          {GROUP_EXAMPLES.map((ex, i) => (
            <Reveal key={ex.pax} delay={i * 70}>
              <div className="tile h-full p-6">
                <p className="font-display text-[1.6rem] font-extrabold leading-none text-ink-900">{ex.pax}</p>
                <p className="mt-1 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">guests</p>
                <p className="mt-4 inline-flex rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">
                  {ex.plan.headline}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {ex.plan.legs.map((l) => (
                    <li key={l.vehicle.slug} className="flex gap-2 text-sm text-ink-600">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" />
                      {l.count > 1 && `${l.count} × `}{l.vehicle.name}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-6">
          <Link to="/group-travel" className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800">
            Work it out for your own guest count <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Reveal>
      </section>

      {/* ================================ CLOSE ================================ */}
      <section className="px-5 pt-16 sm:px-8 sm:pt-24">
        <Reveal className="mx-auto max-w-[76rem]">
          <div className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-14 sm:px-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <h2 className="max-w-[22ch] font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
                Tell us the timetable and we will build the fleet around it.
              </h2>
              <p className="mt-4 max-w-xl text-md leading-[1.7] text-ink-600">
                Or call {COMPANY.owner} directly — for anything happening this week, that is faster than any form.
              </p>
              <ContactRow className="mt-7" message="Hello, I am planning event transportation and would like to discuss the requirement." />
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
