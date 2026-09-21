import { Link, Navigate, useParams } from 'react-router-dom';
import PageHero from './PageHero';
import { ServiceIcon } from './SiteIcons';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { COMPANY, SERVICES, FLEET } from './siteData';
import { IconCheck, IconClock, IconInvoices, IconPhone, IconPin } from '../components/icons';

export default function ServiceDetail() {
  const { slug } = useParams();
  const service = SERVICES.find((s) => s.slug === slug);
  if (!service) return <Navigate to="/services" replace />;

  const others = SERVICES.filter((s) => s.slug !== slug).slice(0, 3);

  return (
    <>
      <PageHero
        eyebrow="Service"
        title={service.name}
        sub={service.short}
        crumbs={[{ label: 'Services', to: '/services' }, { label: service.name }]}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[1.35fr,1fr] lg:px-10">
          <div>
            <p className="text-[15px] leading-relaxed text-ink-700">{service.blurb}</p>

            <h2 className="mt-10 text-xl font-bold text-ink-900">What's included</h2>
            <ul className="mt-4 space-y-3">
              {service.points.map((p) => (
                <li key={p} className="flex gap-3 rounded-lg border border-ink-100 bg-ink-50/50 p-3.5 text-sm text-ink-700">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>

            <h2 className="mt-10 text-xl font-bold text-ink-900">Ideal for</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {service.idealFor.map((t) => (
                <span key={t} className="badge bg-brand-50 px-3 py-1.5 text-brand-800">{t}</span>
              ))}
            </div>

            <h2 className="mt-10 text-xl font-bold text-ink-900">Vehicles available for this service</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {FLEET.map((v) => (
                <div key={v.slug} className="flex items-center gap-3.5 rounded-xl border border-ink-200/70 p-4">
                  <VehiclePhoto
                    photo={v.photo}
                    art={v.art}
                    name={v.name}
                    alt={v.name}
                    className="h-12 w-20 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-ink-900">{v.name}</p>
                    <p className="text-xs text-ink-500">{v.seats} seats · {v.luggage}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="tile p-6">
              <h3 className="text-lg font-bold text-ink-900">Book {service.name.toLowerCase()}</h3>
              <p className="mt-1.5 text-sm text-ink-600">
                Call us with the date, time, pickup and drop. We will confirm the package and the rate before assigning
                the vehicle.
              </p>
              <Link to="/book" className="grad-brand btn mt-5 h-12 w-full rounded-full text-md font-semibold text-white hover:brightness-[1.06]">
                Plan this trip
              </Link>
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn mt-2 h-12 w-full rounded-full bg-ink-900 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <Link to="/enquiry" className="btn mt-2 h-11 w-full rounded-full bg-ink-50 text-md text-ink-700 hover:bg-ink-100">
                Send a requirement instead
              </Link>

              <div className="mt-6 space-y-2.5 border-t border-ink-100 pt-5 text-xs text-ink-600">
                <p className="flex gap-2"><IconClock className="h-4 w-4 text-brand-500" /> {COMPANY.serviceHours}</p>
                <p className="flex gap-2"><IconInvoices className="h-4 w-4 text-brand-500" /> GST-compliant invoices</p>
                <p className="flex gap-2"><IconPin className="h-4 w-4 text-brand-500" /> Based in Goregaon (W), Mumbai</p>
              </div>
            </div>
          </aside>
        </div>
      </section>

      <section className="pb-24 pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <h2 className="mb-8 text-xl font-bold text-ink-900">Other services</h2>
          <div className="grid gap-5 sm:grid-cols-3">
            {others.map((s) => (
              <Link key={s.slug} to={`/services/${s.slug}`} className="tile tile-lift group p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600"><ServiceIcon slug={s.slug} /></span>
                <h3 className="mt-4 font-semibold text-ink-900 group-hover:text-brand-700">{s.name}</h3>
                <p className="mt-1.5 text-sm text-ink-600">{s.short}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
