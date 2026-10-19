/**
 * Vehicle details.
 *
 * A premium page for one vehicle: the gallery, what it holds, what it is good
 * at, and — when the trip is known from the search — what it costs, before
 * anything is committed to.
 *
 * The picture is honest about what it is showing: one drawing of the class,
 * captioned as such, rather than five stock interiors implying they are ours.
 */
import { Link, Navigate, useParams } from 'react-router-dom';
import { VEHICLES, vehicleBySlug, ON_REQUEST_CLASSES, type PlanType } from './catalog';
import { estimateInputFor, tripPrefill, tripQuery, tripSummary, useTripParams } from './tripParams';
import { EnquiryButton, WhatsAppButton } from './EnquirySheet';
import { COMPANY } from './siteData';
import { BackLink, CompareProvider, estimateFor, EstimatePanel, SectionHead, TrustRow, useRates, Callout } from './kit';
import { VehicleCard, CompareTray } from './VehicleCard';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { Reveal } from '../components/Reveal';
import { IconSeat, IconLuggage, IconWhatsApp } from './SiteIcons';
import { IconArrowRight, IconCheck, IconPhone, IconRoad, IconShield, IconSteering } from '../components/icons';
import { useSeo } from './Seo';

const PLAN_NAME: Record<PlanType, string> = { LOCAL: 'Local', AIRPORT: 'Airport', OUTSTATION: 'Outstation' };

export default function VehicleDetail() {
  const { slug } = useParams();
  const vehicle = vehicleBySlug(slug);
  useSeo({
    title: vehicle ? `${vehicle.name} on Rent in Mumbai with Driver` : 'Vehicles',
    path: vehicle ? `/vehicles/${vehicle.slug}` : '/vehicles',
    description: vehicle
      ? `Hire the ${vehicle.name} (${vehicle.category}, ${vehicle.seats} seats, ${vehicle.luggage}) with a chauffeur in Mumbai for local, airport and outstation trips.`
      : undefined,
  });
  const trip = useTripParams();
  const book = useRates();

  if (!vehicle) return <Navigate to="/vehicles" replace />;

  const estInput = estimateInputFor(trip);
  const est = estimateFor(book, vehicle, estInput);
  const q = tripQuery(trip);
  const knownTrip = Boolean(trip.from || trip.to);

  const others = VEHICLES.filter((v) => v.slug !== vehicle.slug)
    .sort((a, b) => Math.abs(a.seats - vehicle.seats) - Math.abs(b.seats - vehicle.seats))
    .slice(0, 3);

  const waMessage = `Hello, I would like to book the ${vehicle.name}${
    knownTrip ? ` for ${[trip.from, trip.to].filter(Boolean).join(' to ')}` : ''
  }${trip.date ? ` on ${trip.date}` : ''}.`;

  return (
    <div className="page-bg pb-24">
      {/* ============================== GALLERY ============================== */}
      <section className="pt-28 sm:pt-32">
        <div className="shell">
          <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <BackLink to={`/vehicles?${q}`} />
            <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
              <Link to="/" className="hover:text-brand-700">Home</Link>
              <span className="text-ink-300">/</span>
              <Link to={`/vehicles?${q}`} className="hover:text-brand-700">Vehicles</Link>
              <span className="text-ink-300">/</span>
              <span className="font-medium text-ink-700">{vehicle.name}</span>
            </nav>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.15fr,1fr] lg:gap-12">
            {/* -------- images -------- */}
            <div>
              <div className="grad-soft relative overflow-hidden rounded-[1.75rem]">
                <VehiclePhoto
                  photo={vehicle.photo}
                  art={vehicle.art}
                  name={vehicle.name}
                  alt={`${vehicle.name} on hire with driver in Mumbai — ${vehicle.examples}`}
                  className="aspect-[16/10] w-full object-cover"
                />
                <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-brand-700 backdrop-blur">
                  {vehicle.category}
                </span>
              </div>

              {/* The facts a customer asks next, under the picture: which model
                  it is, what it can be booked for, who it suits and when the
                  vehicle and chauffeur details arrive. */}
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs leading-snug">
                {[
                  { Icon: IconSteering, label: 'Model', value: `${vehicle.examples} or similar` },
                  { Icon: IconRoad, label: 'Available for', value: vehicle.plans.map((p) => PLAN_NAME[p]).join(' · ') },
                  { Icon: IconCheck, label: 'Best for', value: vehicle.bestFor.slice(0, 2).join(', ') },
                  { Icon: IconShield, label: 'Car & chauffeur', value: 'Details sent before pickup' },
                ].map(({ Icon, label, value }) => (
                  <div key={label} className="flex min-w-0 items-start gap-2 rounded-xl bg-white/80 px-3 py-2.5 shadow-card">
                    <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-brand-500" />
                    <div className="min-w-0">
                      <dt className="text-2xs font-bold uppercase tracking-[0.1em] text-ink-400">{label}</dt>
                      <dd className="mt-0.5 font-semibold text-ink-800">{value}</dd>
                    </div>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-2xs text-ink-400">
                {vehicle.photo ? 'Photo' : 'Illustration'} of the class; the exact vehicle may differ.
              </p>
            </div>

            {/* -------- headline and estimate -------- */}
            <div>
              <h1 className="font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.5rem]">
                {vehicle.name}
              </h1>

              <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
                <div>
                  <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Seats</dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-display text-lg font-bold text-ink-900">
                    <IconSeat className="h-4 w-4 text-brand-500" /> {vehicle.seats}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Large bags</dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-display text-lg font-bold text-ink-900">
                    <IconLuggage className="h-4 w-4 text-brand-500" /> {vehicle.bags}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Air con</dt>
                  <dd className="mt-1 font-display text-lg font-bold text-ok-600">{vehicle.ac ? 'Yes' : 'No'}</dd>
                </div>
                <div>
                  <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Comfort</dt>
                  <dd className="mt-1 font-display text-lg font-bold text-ink-900">{vehicle.comfort}</dd>
                </div>
              </dl>

              {knownTrip && (
                <div className="mt-7 rounded-2xl bg-white/70 p-4 shadow-card">
                  <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Your trip</p>
                  <p className="mt-1.5 text-sm font-semibold text-ink-900">
                    {[trip.from, trip.to].filter(Boolean).join('  →  ')}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">{tripSummary(trip).join(' · ')}</p>
                </div>
              )}

              <EstimatePanel
                className="mt-5"
                estimate={est.estimate}
                planLabel={est.planLabel}
                reason={knownTrip ? est.reason : 'no-rate'}
              />

              {/* All three open the same short sheet with this vehicle and the
                  trip already filled in. Sending the customer to the step-by-step
                  planner from here asked them for the pickup, drop, date and
                  vehicle they had just spent two screens choosing. */}
              <div className="mt-6 flex flex-wrap gap-3">
                <EnquiryButton
                  prefill={tripPrefill(trip, vehicle.name)}
                  className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99]"
                >
                  Select this vehicle <IconArrowRight className="h-4 w-4" />
                </EnquiryButton>
                <a
                  href={`tel:+91${COMPANY.mobile}`}
                  aria-label="Call the office"
                  className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card transition-shadow hover:shadow-raised"
                >
                  <IconPhone className="h-4 w-4" /> Call to book
                </a>
                <WhatsAppButton
                  prefill={tripPrefill(trip, vehicle.name)}
                  className="btn h-12 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
                >
                  <IconWhatsApp className="h-4 w-4" /> WhatsApp
                </WhatsAppButton>
              </div>

              <TrustRow compact className="mt-6" />
            </div>
          </div>
        </div>
      </section>

      {/* ============================ INFORMATION ============================ */}
      <section className="shell pt-16 sm:pt-20">
        <div className="grid gap-5 lg:grid-cols-3">
          <Reveal>
            <div className="tile h-full p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Key features</h2>
              <ul className="mt-4 space-y-2.5">
                {vehicle.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm leading-relaxed text-ink-600">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {f}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <div className="tile h-full p-6">
              <h2 className="font-display text-md font-bold text-ink-900">Best for</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {vehicle.bestFor.map((b) => (
                  <span key={b} className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">{b}</span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-ink-500">
                Best for {vehicle.best.toLowerCase()}. Available for{' '}
                {vehicle.plans.map((p) => p.toLowerCase()).join(', ')} duties.
              </p>
            </div>
          </Reveal>

          <Reveal delay={140}>
            <div className="tile h-full p-6">
              <h2 className="font-display text-md font-bold text-ink-900">How this vehicle is kept</h2>
              <ul className="mt-4 space-y-3.5 text-sm leading-relaxed text-ink-600">
                <li className="flex gap-2.5">
                  <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Commercial permit, insurance and fitness current — a condition of going out on duty.
                </li>
                <li className="flex gap-2.5">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Interior vacuumed and exterior washed before every dispatch.
                </li>
                <li className="flex gap-2.5">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                  Serviced on the manufacturer's interval, not when something breaks.
                </li>
              </ul>
            </div>
          </Reveal>
        </div>

        <Callout className="mt-6">
          We do not publish per-vehicle customer ratings yet — we would rather show none than an average made of four
          reviews. Ask for references for your kind of trip and we will put you in touch with an account that runs it.
        </Callout>
      </section>

      {/* ============================== SIMILAR ============================== */}
      {/* The provider is what makes the cards' "Add to compare" ticks work here;
          without it they fell back to a no-op and never ticked. */}
      <CompareProvider>
      <section className="shell pt-16 sm:pt-20">
        <SectionHead
          eyebrow="Compare"
          title="Similar vehicles"
          sub="The closest alternatives by size, so you can see what one step up or down actually gets you."
          action={
            <Link to={`/vehicles?${q}`} className="btn-ghost btn-sm text-brand-700 hover:bg-white">
              All vehicles <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          }
          className="mb-8"
        />
        <div className="grid gap-5 [&>*]:min-w-0 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((v, i) => (
            <Reveal key={v.slug} delay={i * 70}>
              <VehicleCard vehicle={v} index={i} estimateInput={knownTrip ? estInput : undefined} to={`/vehicles/${v.slug}?${q}`} compact />
            </Reveal>
          ))}
        </div>
        <Reveal className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/vehicles/compare?ids=${others.slice(0, 3).map((v) => v.slug).join(',')}&${q}`}
            className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised"
          >
            Compare these three <IconArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/help-me-choose" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
            Help me choose
          </Link>
        </Reveal>

        <p className="mt-8 text-xs leading-relaxed text-ink-500">
          Looking for something else? {ON_REQUEST_CLASSES.join(', ')} are arranged per booking —{' '}
          <Link to="/enquiry" className="link">tell us the requirement</Link>.
        </p>
      </section>
      <CompareTray query={q} />
      </CompareProvider>
    </div>
  );
}
