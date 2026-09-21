/**
 * Plan a trip.
 *
 * The booking widget on a page of its own, so every "Plan a trip" button in the
 * header, the footer and the bottom navigation lands somewhere that can take
 * the requirement — instead of scrolling the homepage back to a bar.
 *
 * It opens on whichever tab the link asked for (`/book?tab=AIRPORT`), which is
 * how the ten cards on the homepage and the Transport menu all reach the right
 * set of fields in one tap.
 */
import { useSearchParams, Link } from 'react-router-dom';
import { COMPANY } from './siteData';
import { NEEDS, type NeedKey } from './catalog';

/** The kinds of trip the booking bar at the top of this page already takes. */
const BAR_COVERS: NeedKey[] = ['local', 'airport', 'outstation', 'hourly'];
import { isBookTab, QuickBook, BookingHelpBanners, type BookTab } from './QuickBook';
import { SectionHead, TrustRow } from './kit';
import { NeedPhoto } from './PlaceCards';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';

const TAB_COPY: Record<BookTab, { title: string; sub: string }> = {
  LOCAL: {
    title: 'Local travel in Mumbai',
    sub: 'A car for a run across the city, or for a day of meetings. Multiple stops on the same duty need no extra booking.',
  },
  AIRPORT: {
    title: 'Airport transfers',
    sub: 'Terminal 1 and Terminal 2, arrivals and departures. Give us the flight number and the chauffeur follows the actual landing time.',
  },
  OUTSTATION: {
    title: 'Outstation travel',
    sub: 'One-way drops and multi-day round trips. Driver allowance, permit and toll are itemised up front, not argued about at the end.',
  },
  HOURLY: {
    title: 'Hourly rental',
    sub: 'The car and chauffeur at your disposal for a block of hours, with as many stops as you need inside it.',
  },
};

const NEXT = [
  'You see the vehicles that fit, with an estimate against each',
  'Pick one, or let us recommend from the group size and luggage',
  'Send the requirement and get the confirmed rate by phone',
  'Nothing is charged and no vehicle is held until you say yes',
];

export default function Book() {
  const [params] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: BookTab = isBookTab(tabParam) ? tabParam : 'LOCAL';
  const copy = TAB_COPY[tab];

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Plan a trip"
        title={copy.title}
        sub={copy.sub}
        crumbs={[{ label: 'Plan a trip' }]}
      />

      <section className="shell">
        {/* The widget is keyed on the tab so a link from another tab remounts it
            with the right fields rather than keeping the previous selection. */}
        <Reveal>
          <QuickBook key={tab} initialTab={tab} />
        </Reveal>

        <Reveal className="mt-5">
          <BookingHelpBanners />
        </Reveal>

        <div className="mt-8 grid gap-5 lg:grid-cols-[1fr,20rem] lg:gap-8">
          <Reveal className="tile p-6 sm:p-7">
            <h2 className="font-display text-md font-bold text-ink-900">What happens after you search</h2>
            <ol className="mt-4 space-y-2.5">
              {NEXT.map((n, i) => (
                <li key={n} className="flex gap-2.5 text-sm leading-relaxed text-ink-600">
                  <span className="grad-brand mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full font-display text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  {n}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-ink-400">
              Estimates on this site are worked out from our published walk-in rates and exclude toll, parking and any
              state permit. The confirmed rate is the one the office gives you.
            </p>
          </Reveal>

          <Reveal delay={80} className="tile p-6">
            <h2 className="font-display text-md font-bold text-ink-900">In a hurry?</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
              For anything in the next few hours, calling beats any form. The desk is answered{' '}
              {COMPANY.serviceHours.toLowerCase()}.
            </p>
            <div className="mt-4 space-y-2.5">
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 w-full rounded-full bg-ink-900 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <WhatsAppButton
                className="btn h-11 w-full rounded-full bg-[#25D366] text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
              >
                <IconWhatsApp className="h-4 w-4" /> WhatsApp
              </WhatsAppButton>
              <Link to="/enquiry" className="btn h-11 w-full rounded-full bg-ink-50 text-md text-ink-700 hover:bg-ink-100">
                Describe it instead <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================== OTHER DOORS ============================== */}
      <section className="shell pt-16 sm:pt-20">
        <SectionHead
          eyebrow="Something else"
          title="Other kinds of travel"
          sub="Groups, weddings, corporate accounts, events and city sightseeing each have a planner built for them."
          className="mb-8"
        />

        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
          {/* The four the booking bar above already covers are left out; this
              grid is the doors it does not have a tab for. It used to filter on
              the URL, which stopped meaning anything once every door moved to
              /enquire — so it names them. */}
          {NEEDS.filter((n) => !BAR_COVERS.includes(n.key)).map((n, i) => (
            <Reveal key={n.key} delay={(i % 4) * 50}>
              <Link to={n.to} className="tile tile-lift group flex h-full flex-col overflow-hidden">
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

        <div className="mt-10">
          <TrustRow />
        </div>
      </section>
    </div>
  );
}
