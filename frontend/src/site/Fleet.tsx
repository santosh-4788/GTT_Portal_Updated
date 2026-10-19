import { Link } from 'react-router-dom';
import PageHero from './PageHero';
import { COMPANY, FLEET } from './siteData';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck, IconPhone, IconShield, IconSteering } from '../components/icons';
import { ContactRow, SectionHead, TrustRow } from './kit';
import { useSeo } from './Seo';

const CARE = [
  { Icon: IconCheck, title: 'Cleaned before every duty', body: 'Interior vacuumed and wiped, exterior washed before the vehicle is dispatched.' },
  { Icon: IconShield, title: 'Serviced on schedule', body: 'Vehicles follow the manufacturer service interval, not a wait-until-it-breaks approach.' },
  { Icon: IconSteering, title: 'Uniformed chauffeurs', body: 'Drivers report in uniform. No tobacco, pan or gutkha on duty — a standing rule, not a request.' },
];

export default function Fleet() {
  useSeo({
    title: 'Our Fleet - Sedans, SUVs, Tempo Travellers and Buses',
    path: '/fleet',
    description: 'The cars we run in Mumbai: Dzire, Aura, Honda City, Ertiga, XL6, Innova Crysta, Kia Carens, Force Traveller, Urbania and coaches - all chauffeur-driven.',
  });
  return (
    <>
      <PageHero
        eyebrow="Our fleet"
        title="Vehicles chosen for the duty, not just whatever is free"
        sub="Sedans for airport runs and city meetings, SUVs for families and small groups, Innova Crysta for long outstation comfort, Tempo Travellers when the group is larger, and coaches for full event movements."
        crumbs={[{ label: 'Fleet' }]}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid gap-6 sm:grid-cols-2">
            {FLEET.map((v) => (
              <article key={v.slug} className="tile tile-lift group overflow-hidden">
                <div className="relative overflow-hidden bg-gradient-to-b from-ink-50 to-white">
                  <span className="absolute right-4 top-4 z-10 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-bold uppercase tracking-wider text-brand-700 shadow-xs">
                    {v.category}
                  </span>
                  <VehiclePhoto
                    photo={v.photo}
                    art={v.art}
                    name={v.name}
                    alt={`${v.name} on hire with driver in Mumbai — ${v.examples}`}
                    className="aspect-[3/2] w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.04]"
                  />
                </div>
                <div className="p-6">
                  <h2 className="text-xl font-bold text-ink-900">{v.name}</h2>

                  <dl className="mt-5 grid grid-cols-2 gap-4">
                    <div className="rounded-lg bg-ink-50 p-3.5">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Seating</dt>
                      <dd className="mt-0.5 text-lg font-bold text-ink-900">{v.seats} passengers</dd>
                    </div>
                    <div className="rounded-lg bg-ink-50 p-3.5">
                      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Luggage</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-ink-900">{v.luggage}</dd>
                    </div>
                  </dl>

                  <p className="mt-4 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900">
                    <span className="font-semibold">Best for:</span> {v.best}
                  </p>

                  <a href={`tel:+91${COMPANY.mobile}`} className="btn mt-5 h-11 w-full rounded-full bg-ink-50 text-sm text-ink-700 hover:bg-ink-100">
                    <IconPhone className="h-4 w-4" /> Enquire about the {v.name}
                  </a>
                </div>
              </article>
            ))}
          </div>

          <p className="mt-6 text-2xs text-ink-400">
            Each photograph shows the class of vehicle, not the specific one assigned to a booking — the class is what
            we guarantee, the badge on the bonnet is not.
          </p>

          <div className="tile mt-10 p-7">
            <h2 className="text-lg font-bold text-ink-900">How our vehicles are kept</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              {CARE.map(({ Icon, title, body }, i) => (
                <Reveal key={title} delay={i * 80}>
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-3.5 font-semibold text-ink-900">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{body}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 pb-24 sm:px-8">
        <div className="mx-auto max-w-[76rem]">
          <div className="grad-soft relative overflow-hidden rounded-[2.25rem] px-6 py-12 sm:px-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-200/50 blur-3xl" aria-hidden="true" />
            <div className="relative">
              <SectionHead
                eyebrow="Something else"
                title="Need a vehicle you do not see here?"
                sub="Decorated wedding cars, luxury sedans, vintage vehicles and additional coaches are arranged per booking rather than kept on the road. Tell us the requirement and we will come back with what is available for your dates."
              />
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/vehicles" className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]">
                  Compare the fleet with estimates <IconArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/fleet-request" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">Plan a fleet</Link>
              </div>
              <ContactRow className="mt-6" message="Hello, I am looking for a vehicle class that is not on your fleet page." />
              <TrustRow className="mt-8" />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
