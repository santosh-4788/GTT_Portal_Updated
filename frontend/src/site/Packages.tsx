import { Link } from 'react-router-dom';
import PageHero from './PageHero';
import { COMPANY, ROUTES } from './siteData';
import { IconCheck, IconPhone } from '../components/icons';
import { useSeo } from './Seo';
import { POPULAR_ROUTES, routeLandingPath } from './outstation';

const LOCAL_PACKAGES = [
  {
    name: '4 Hours / 40 KM',
    tag: 'Half day',
    for: 'A couple of meetings or an airport transfer with a wait.',
    includes: ['4 hours of duty time', '40 kilometres included', 'Extra hours and KM at agreed rate', 'Toll & parking at actuals'],
  },
  {
    name: '8 Hours / 80 KM',
    tag: 'Full day',
    for: 'A full working day of meetings across the city.',
    includes: ['8 hours of duty time', '80 kilometres included', 'Multiple pickups on the same duty', 'Toll & parking at actuals'],
    featured: true,
  },
  {
    name: 'Airport Transfer',
    tag: 'Point to point',
    for: 'Single pickup or drop at Terminal 1 or Terminal 2.',
    includes: ['Flight number tracked', 'Waiting time as agreed', 'Meet & greet on request', 'Toll & parking at actuals'],
  },
  {
    name: 'Outstation',
    tag: 'Per day',
    for: 'One-way drops and multi-day round trips.',
    includes: ['Minimum KM per day as agreed', 'Driver allowance shown separately', 'Permit and toll itemised', 'Highway-experienced drivers'],
  },
];

export default function Packages() {
  useSeo({
    title: 'Local and Outstation Packages from Mumbai',
    path: '/packages',
    description: 'Hourly local packages in Mumbai and outstation packages to Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Alibaug, Surat and Goa.',
  });
  return (
    <>
      <PageHero
        eyebrow="Tour packages"
        title="Packages priced before you travel, not after"
        sub="Standard duty packages for city and outstation work, plus planned multi-day itineraries. Rates are confirmed for your account before the first trip."
        crumbs={[{ label: 'Tour Packages' }]}
      />

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">Duty packages</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-600">
            These are the package structures we work with. The exact rate depends on the vehicle class and your account —
            call us and we will quote for your requirement.
          </p>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {LOCAL_PACKAGES.map((p) => (
              <article
                key={p.name}
                className={`tile relative flex flex-col p-6 ${p.featured ? 'ring-2 ring-brand-400' : ''}`}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-6 badge bg-brand-500 px-3 py-1 text-white">Most booked</span>
                )}
                <p className="text-[11px] font-bold uppercase tracking-wide text-brand-600">{p.tag}</p>
                <h3 className="mt-1 text-lg font-bold text-ink-900">{p.name}</h3>
                <p className="mt-2 text-sm text-ink-600">{p.for}</p>
                <ul className="mt-5 flex-1 space-y-2">
                  {p.includes.map((i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-700">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                      <span>{i}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/book?tab=${p.name.startsWith('Airport') ? 'AIRPORT' : p.name.startsWith('Outstation') ? 'OUTSTATION' : 'HOURLY'}`}
                  className={`mt-6 h-11 w-full rounded-full text-sm font-semibold ${
                    p.featured ? 'grad-brand btn text-white hover:brightness-[1.06]' : 'btn bg-ink-50 text-ink-700 hover:bg-ink-100'
                  }`}
                >
                  Get an estimate
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="pt-16 sm:pt-20">
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">Outstation destinations</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-ink-600">
            Routes we run regularly from Mumbai. Distances and times are approximate and vary with traffic and the route
            taken on the day.
          </p>

          <div className="table-wrap mt-8">
            <table className="tbl">
              <thead>
                <tr>
                  <th>From</th>
                  <th>Destination</th>
                  <th>Approx. distance</th>
                  <th>Approx. drive time</th>
                  <th className="text-right">Plan</th>
                </tr>
              </thead>
              <tbody>
                {ROUTES.map((r) => (
                  <tr key={r.to}>
                    <td className="font-medium text-ink-700">{r.from}</td>
                    <td className="font-semibold text-ink-900">
                      {POPULAR_ROUTES.some((p) => p.destination === r.to)
                        ? <Link to={routeLandingPath(r.to.toLowerCase())} className="hover:text-brand-700">{r.to}</Link>
                        : r.to}
                    </td>
                    <td className="text-ink-600">{r.km}</td>
                    <td className="text-ink-600">{r.time}</td>
                    <td className="text-right">
                      <Link to={`/vehicles?tab=OUTSTATION&from=Mumbai&to=${encodeURIComponent(r.to)}&pax=4`} className="btn btn-sm rounded-full bg-ink-50 text-ink-700 hover:bg-ink-100">
                        See vehicles
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-ink-500">
            Travelling somewhere not on this list? We cover destinations across Maharashtra, Gujarat and Goa — call us
            with the route.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-6 text-center lg:px-10">
          <h2 className="text-2xl font-bold text-ink-900 sm:text-3xl">Planning a multi-day trip?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-600">
            Tell us the days, the stops and the group size. We will plan the itinerary, assign one vehicle and driver for
            the whole trip, and give you a single quote covering it end to end.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link to="/enquiry" className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]">Send the requirement</Link>
            <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-ink-900 px-7 text-md text-white hover:bg-ink-800"><IconPhone className="h-4 w-4" /> Call</a>
            <Link to="/enquiry" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">Send trip details</Link>
          </div>
        </div>
      </section>
    </>
  );
}
