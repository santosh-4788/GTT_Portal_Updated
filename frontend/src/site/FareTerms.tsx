/**
 * The terms that sit behind every fare on the results page.
 *
 * The cards show one number, and a number with nothing next to it reads as
 * all-in. It is not — toll and parking are paid at actuals, a package that
 * runs over is billed by the hour and the kilometre, and GST goes on the bill
 * only when the customer asks for a GST bill — so this says so, once, right
 * under the list, rather than leaving it for the invoice.
 *
 * Which terms show follows the trip type: an outstation trip is billed on a
 * daily km minimum and a driver allowance, a city package on hours and km.
 *
 * Kept to two rows of three on a desktop: it is a footnote to the vehicles
 * above it, and it should read as one, not as a page of its own.
 */
import type { ReactNode } from 'react';
import { Reveal } from '../components/Reveal';
import { IconBilling, IconCalendar, IconCity, IconClock, IconInvoices, IconRoad, IconShield, IconSteering } from '../components/icons';
import type { BookTab } from './QuickBook';

type Term = { icon: ReactNode; title: string; body: string; tone: string; badge?: string };

const TOLL: Term = {
  icon: <IconRoad className="h-4 w-4" />,
  title: 'Toll, parking & entry tax',
  body: 'Not in the fare — charged at actuals, as per receipts.',
  tone: 'from-sky-500 to-blue-600',
};
const GST: Term = {
  icon: <IconInvoices className="h-4 w-4" />,
  title: 'GST bill on request',
  body: 'Prices exclude GST. Need a GST bill? GST is added on the bill, not the fare.',
  tone: 'from-emerald-500 to-teal-600',
  badge: 'GST',
};
const CANCEL: Term = {
  icon: <IconCalendar className="h-4 w-4" />,
  title: 'Cancellation',
  body: 'Free up to 1 hour before pickup. Within 1 hour of pickup, it is chargeable.',
  tone: 'from-cyan-500 to-sky-600',
};

/** City packages — the Hourly and Local tabs, both priced off the hour/km packages. */
const CITY: Term[] = [
  TOLL,
  {
    icon: <IconClock className="h-4 w-4" />,
    title: 'Extra hours & km',
    body: 'Beyond the package, charged at the rates shown on the vehicle.',
    tone: 'from-violet-500 to-indigo-600',
  },
  GST,
  {
    icon: <IconBilling className="h-4 w-4" />,
    title: 'Billed on actual usage',
    body: 'The final bill follows the hours and km on the duty slip.',
    tone: 'from-amber-500 to-orange-600',
  },
  {
    icon: <IconCity className="h-4 w-4" />,
    title: 'City use only',
    body: 'Packages are for travel within the city; outside it is outstation.',
    tone: 'from-pink-500 to-rose-600',
  },
  CANCEL,
];

const OUTSTATION: Term[] = [
  { ...TOLL, title: 'Toll, parking, state tax & permits' },
  {
    icon: <IconRoad className="h-4 w-4" />,
    title: '300 km a day minimum',
    body: 'Each day is billed for at least 300 km. Km beyond that at the vehicle’s per-km rate.',
    tone: 'from-violet-500 to-indigo-600',
  },
  {
    icon: <IconSteering className="h-4 w-4" />,
    title: 'Driver allowance (DA)',
    body: '₹500 a day, for every day of the trip — already in the fare shown.',
    tone: 'from-amber-500 to-orange-600',
  },
  GST,
  {
    icon: <IconBilling className="h-4 w-4" />,
    title: 'Billed on actual km',
    body: 'The final bill follows the km and days on the duty slip.',
    tone: 'from-pink-500 to-rose-600',
  },
  CANCEL,
];

const AIRPORT: Term[] = [
  TOLL,
  GST,
  {
    icon: <IconBilling className="h-4 w-4" />,
    title: 'Rate confirmed on booking',
    body: 'Airport transfers are quoted to the address and confirmed before the trip.',
    tone: 'from-amber-500 to-orange-600',
  },
  CANCEL,
];

const SETS: Record<BookTab, { terms: Term[]; lead: string }> = {
  HOURLY: { terms: CITY, lead: 'The price on each vehicle is the package fare — the hours and km it includes.' },
  LOCAL: { terms: CITY, lead: 'The price on each vehicle is the package fare — the hours and km it includes.' },
  OUTSTATION: { terms: OUTSTATION, lead: 'The price covers 300 km a day and the driver allowance for every day.' },
  AIRPORT: { terms: AIRPORT, lead: 'Toll and parking on the way are the only extras.' },
};

export function FareTerms({ tab = 'HOURLY', className = '' }: { tab?: BookTab; className?: string }) {
  const { terms, lead } = SETS[tab];
  return (
    <Reveal className={`relative overflow-hidden rounded-[1.5rem] bg-white shadow-card ring-1 ring-ink-100 ${className}`}>
      {/* Header strip */}
      <div className="grad-brand relative flex items-center gap-3 overflow-hidden px-5 py-3.5 text-white sm:px-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute right-24 -bottom-14 h-24 w-24 rounded-full bg-white/10" />
        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-white/25">
          <IconShield className="h-4 w-4" />
        </span>
        <div className="relative min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-white/75">Terms &amp; conditions</p>
          <h3 className="font-display text-md font-extrabold leading-tight">Clear pricing, no surprises</h3>
        </div>
        <p className="relative ml-auto hidden max-w-xs text-right text-xs leading-snug text-white/85 md:block">
          {lead}
        </p>
      </div>

      {/* Terms */}
      <ul className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
        {terms.map((t) => (
          <li
            key={t.title}
            className={`group flex gap-3 rounded-2xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-card ${
              t.badge ? 'bg-emerald-50/70 ring-1 ring-emerald-100' : 'bg-ink-50/70'
            }`}
          >
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${t.tone} text-white shadow-sm transition-transform duration-200 group-hover:scale-105`}
            >
              {t.icon}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-tight text-ink-900">
                {t.title}
                {t.badge && (
                  <span className="rounded-full bg-emerald-600 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white">
                    {t.badge}
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs leading-snug text-ink-500">{t.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
