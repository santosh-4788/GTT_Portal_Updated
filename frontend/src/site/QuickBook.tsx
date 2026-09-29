/**
 * The quick booking widget.
 *
 * Four tabs, and each one shows only the fields that trip actually needs — an
 * airport transfer asks for a flight number and a direction, an outstation
 * trip asks whether it comes back, and neither is made to look at the other's
 * fields. That is the whole idea: the old bar asked every customer the same
 * three questions and then made them explain the rest on the phone.
 *
 * WHAT CHANGED IN THIS PASS
 *
 *   Date and time open filled in, at today and now, instead of showing an
 *   empty `mm/dd/yyyy`. Almost every booking this business takes is for today
 *   or tomorrow, so an empty date field made the common case the most work.
 *
 *   Passengers is a stepper, not a dropdown. The dropdown's options ran 12,
 *   17, 20, 25, 30 — so a party of 22 had to round itself up or down before it
 *   could even search, and the number the office quoted was never the number
 *   the customer had.
 *
 *   Dates read dd/mm/yyyy, always. A native date input renders in the
 *   BROWSER's locale — `lang` does nothing to it and neither does CSS — so on
 *   an en-US machine the third of September showed as 09/03/2026. The field is
 *   now DmyDateField: a text input that formats one way, with the OS picker
 *   still available beside it.
 *
 *   One action. The widget states the requirement and searches; the enquiry
 *   form and WhatsApp are offered on the page around it rather than inside it,
 *   so there is one obvious thing to press.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { nowLocalHm, todayLocalIso } from '../lib/format';
import { COMPANY } from './siteData';
import {
  DmyDateField, isoToDmy, PlaceInput, SegTabs, SoftField, SoftStepper, SOFT_INPUT, SOFT_INPUT_MUTED,
} from './kit';
import {
  IconArrowRight, IconSearch, IconPlus, IconClose, IconPin, IconCalendar, IconClock, IconPlane, IconCheck,
} from '../components/icons';
import { IconSeat } from './SiteIcons';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import { TimeField } from '../components/DateTimeField';
import { matchRoute, routeLabel, useOutstationRoutes } from './outstation';

/** Two arrows, one each way. Used only by the pickup/drop swap. */
function IconSwap({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 4 3 8l4 4" /><path d="M3 8h13" />
      <path d="m17 20 4-4-4-4" /><path d="M21 16H8" />
    </svg>
  );
}

const FIELD_ICON = 'h-3 w-3';

/**
 * The promises the widget makes, right under the button that acts on them.
 *
 * The cancellation window is a commitment, not decoration: it says one hour
 * because that is what the office asked for. Policies.tsx describes changes and
 * cancellations in prose and does not name a free window, so the two want to be
 * read together before either is changed again.
 */
const ASSURANCES: { label: string; note?: string; clock?: boolean }[] = [
  { label: 'No hidden charges' },
  { label: 'On-time pickup' },
  { label: 'Verified drivers' },
  { label: 'Free cancellation', note: '1 hr before pickup' },
  { label: '24×7 support' },
  { label: 'Instant booking', clock: true },
];

/** "17:46" as "5:46 pm", so the summary reads the way the field displays. */
function hm12(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hm;
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export type BookTab = 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'HOURLY';

const TABS: { value: BookTab; label: string }[] = [
  { value: 'LOCAL', label: 'Local' },
  { value: 'AIRPORT', label: 'Airport' },
  { value: 'OUTSTATION', label: 'Outstation' },
  { value: 'HOURLY', label: 'Hourly' },
];

export const HOURLY_PACKAGES = [
  { key: '4H40', label: '4 hrs / 40 km', hours: 4, km: 40 },
  { key: '8H80', label: '8 hrs / 80 km', hours: 8, km: 80 },
  { key: '12H120', label: '12 hrs / 120 km', hours: 12, km: 120 },
];

const AIRPORTS = [
  'CSMIA Terminal 2 (International)',
  'CSMIA Terminal 1 (Domestic)',
  'Navi Mumbai International (NMIA)',
  'Pune Airport',
];

export function isBookTab(v: string | null): v is BookTab {
  return v === 'LOCAL' || v === 'AIRPORT' || v === 'OUTSTATION' || v === 'HOURLY';
}

/** Column spans, written out so Tailwind's scanner can see every class. */
const SPAN: Record<number, string> = {
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
  12: 'lg:col-span-12',
};

/* ==========================================================================
   The widget
   ========================================================================== */

export function QuickBook({
  initialTab = 'LOCAL', className = '', replace = false,
}: {
  initialTab?: BookTab; className?: string;
  /** Search in place of the current history entry - used inside a sheet. */
  replace?: boolean;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<BookTab>(initialTab);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** Extra pickups or drops on the way — outstation trips collect people. */
  const [stops, setStops] = useState<string[]>([]);
  const [airport, setAirport] = useState(AIRPORTS[0]);
  const [direction, setDirection] = useState<'TO' | 'FROM'>('TO');
  const [flight, setFlight] = useState('');
  /* Nothing is chosen until the customer picks One way or Return: that choice
     is what opens the list of fixed-fare destinations underneath. */
  const [leg, setLeg] = useState<'ONE_WAY' | 'RETURN' | ''>('');
  /** A fixed-fare route key, 'other', or '' before one is picked. */
  const [routeKey, setRouteKey] = useState('');
  const { routes } = useOutstationRoutes();

  // Filled in, not blank: this business takes most of its work for today or
  // tomorrow, and an empty date field made the common case the most typing.
  const [date, setDate] = useState(todayLocalIso());
  const [time, setTime] = useState(nowLocalHm());
  const [returnDate, setReturnDate] = useState('');
  const [returnTime, setReturnTime] = useState('');

  const [pax, setPax] = useState(2);
  const [pkg, setPkg] = useState(HOURLY_PACKAGES[1].key);
  const [error, setError] = useState('');

  const today = todayLocalIso();
  const pkgLabel = HOURLY_PACKAGES.find((p) => p.key === pkg)?.label ?? pkg;
  const addressLabel = direction === 'TO' ? 'Pickup address' : 'Drop address';

  const setStop = (i: number, v: string) =>
    setStops((s) => s.map((x, j) => (j === i ? v : x)));

  /* ------------------------------------------------------------ the trip */

  /** Everything that has been filled in, as URL parameters. */
  const query = (): URLSearchParams => {
    const q = new URLSearchParams();
    q.set('tab', tab);
    q.set('pax', String(pax));
    if (date) q.set('date', date);
    if (time) q.set('time', time);

    if (tab === 'AIRPORT') {
      const other = direction === 'TO' ? from : to;
      q.set('from', direction === 'TO' ? other : airport);
      q.set('to', direction === 'TO' ? airport : other);
      q.set('dir', direction);
      q.set('airport', airport);
      if (flight.trim()) q.set('flight', flight.trim());
    } else if (tab === 'HOURLY') {
      q.set('from', from);
      q.set('plan', pkg);
    } else {
      q.set('from', from);
      q.set('to', to);
      if (tab === 'OUTSTATION') {
        q.set('leg', leg || 'ONE_WAY');
        if (leg === 'RETURN') {
          if (returnDate) q.set('return', returnDate);
          if (returnTime) q.set('returnTime', returnTime);
          // A return to one of the fixed-fare destinations shows its return
          // fares; anywhere else is quoted by the office.
          const hit = matchRoute(routes ?? [], to);
          q.set('route', hit ? hit.key : 'other');
          const extra = stops.map((s) => s.trim()).filter(Boolean);
          if (extra.length) q.set('stops', extra.join(' | '));
        } else {
          q.set('route', 'other');
        }
      }
    }
    return q;
  };

  /* ------------------------------------------------------- validation */

  /** Returns an error message, or '' when the requirement is complete enough. */
  const problem = (): string => {
    if (tab === 'AIRPORT') {
      const other = direction === 'TO' ? from : to;
      if (!other.trim()) {
        return direction === 'TO' ? 'Where should we pick you up?' : 'Where are we dropping you?';
      }
      return '';
    }
    if (!from.trim()) return 'Please tell us the pickup point.';
    if (tab === 'HOURLY') return '';
    // Outstation picks its destination from the fixed-fare routes on the next
    // screen, so the drop here is a hint, not a requirement.
    if (tab === 'OUTSTATION') {
      if (!leg) return 'Choose One way or Return.';
      if (leg === 'ONE_WAY' && routeKey !== 'other') return 'Choose your destination.';
      if (!to.trim()) return 'Where are you travelling to?';
      if (leg === 'RETURN' && !returnDate) return 'Which day are you coming back?';
      return '';
    }
    if (!to.trim()) return 'Where are you going?';
    return '';
  };

  /**
   * One way to a fixed-fare destination goes straight to its cabs and prices -
   * nothing else is asked on this screen. Pickup, date and time are taken on
   * the booking summary.
   */
  const pickRoute = (key: string) => {
    navigate(`/outstation?${new URLSearchParams({ tab: 'OUTSTATION', leg: 'ONE_WAY', route: key }).toString()}`, { replace });
  };

  const submit = () => {
    const bad = problem();
    setError(bad);
    if (bad) return;
    // Outstation is sold at fixed route fares: destination, then cab, then confirm.
    navigate(`${tab === 'OUTSTATION' ? '/outstation' : '/vehicles'}?${query().toString()}`, { replace });
  };

  /**
   * What the button is about to search for, in a line.
   *
   * Date and time are pre-filled with today and now, which is right for how
   * this business books but does mean two fields nobody looked at. Printing
   * them back keeps that honest.
   */
  const summary = (() => {
    const label = TABS.find((t) => t.value === tab)?.label ?? '';
    const people = `${pax} ${pax === 1 ? 'passenger' : 'passengers'}`;
    const when = [date ? isoToDmy(date) : '', hm12(time)].filter(Boolean).join(', ');
    const bits = [people, when];
    if (tab === 'HOURLY') bits.splice(1, 0, pkgLabel);
    if (tab === 'OUTSTATION' && leg) bits.splice(1, 0, leg === 'RETURN' ? 'return trip' : 'one way');
    return { head: `${label} trip`, rest: bits.filter(Boolean).join(' · ') };
  })();

  /* ------------------------------------------------------------ render */

  const dateField = (
    <SoftField
      label={tab === 'OUTSTATION' ? 'Departure' : 'Date'} htmlFor="qb-date"
      icon={<IconCalendar className={FIELD_ICON} />} className={SPAN[2]}
    >
      <DmyDateField id="qb-date" value={date} onChange={setDate} min={today} muted />
    </SoftField>
  );

  const timeField = (
    <SoftField
      label={tab === 'OUTSTATION' ? 'Departs at' : 'Pickup time'} htmlFor="qb-time"
      icon={<IconClock className={FIELD_ICON} />} className={SPAN[2]}
    >
      {/* Our own clock, wearing this bar's borderless cell rather than the
          `.input` shell — the browser's time control was a pair of spinner
          arrows here, and no two browsers drew it the same way. */}
      <div className="relative">
        <TimeField
          id="qb-time" value={time} onChange={setTime} placeholder="Pick a time"
          baseClass={`${SOFT_INPUT_MUTED} pr-8`} chevron={false} showIcon={false}
        />
        <IconClock className="pointer-events-none absolute right-1 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
    </SoftField>
  );

  const paxField = (
    <SoftField
      label="Passengers" htmlFor="qb-pax"
      icon={<IconSeat className={FIELD_ICON} />} className={SPAN[2]}
    >
      <SoftStepper id="qb-pax" value={pax} onChange={setPax} min={1} max={60} />
    </SoftField>
  );

  /**
   * Pickup and drop, with the swap sitting on the seam between them.
   *
   * A return leg is the same two places the other way round, and typing both
   * again is the kind of small tax that makes people give up on a search bar.
   */
  const routePair = (dropPlaceholder: string) => (
    <div className={`relative grid sm:grid-cols-2 ${SPAN[6]}`}>
      <PlaceInput
        label="Pickup" variant="soft" value={from} onChange={setFrom}
        placeholder="Andheri East" id="qb-from" icon={<IconPin className={FIELD_ICON} />}
        cellClass="max-sm:rounded-b-none sm:rounded-r-none sm:pr-11"
      />
      <PlaceInput
        label="Drop" variant="soft" value={to} onChange={setTo}
        placeholder={dropPlaceholder} id="qb-to" icon={<IconPin className={FIELD_ICON} />}
        cellClass="max-sm:-mt-px max-sm:rounded-t-none sm:-ml-px sm:rounded-l-none sm:pl-11"
      />
      <button
        type="button"
        onClick={() => { setFrom(to); setTo(from); setError(''); }}
        aria-label="Swap pickup and drop"
        className="absolute top-1/2 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full
                   bg-white text-ink-500 ring-1 ring-ink-100 shadow-raised transition-all duration-200
                   hover:text-brand-600 hover:ring-brand-200 hover:shadow-lift active:scale-90
                   max-sm:right-3 sm:left-1/2 sm:h-8 sm:w-8 sm:-translate-x-1/2"
      >
        <IconSwap className="h-3.5 w-3.5 max-sm:rotate-90" />
      </button>
    </div>
  );

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className={`tile relative overflow-hidden p-4 sm:p-6 ${className}`}
      noValidate
    >
      {/* One soft wash behind the tabs, so the top of the card is not a flat
          white slab. Decorative, and out of the accessibility tree. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full
                   bg-gradient-to-br from-brand-100/60 via-brand-50/40 to-transparent blur-2xl"
      />

      <div className="relative flex flex-wrap items-center gap-3">
        <SegTabs
          value={tab}
          onChange={(v) => { setTab(v); setError(''); }}
          options={TABS}
          tone="brand"
          className="w-full sm:max-w-md"
        />

        {/* Outstation asks this before anything else, because the answer
            decides whether there is a return date to collect at all. */}
        {tab === 'OUTSTATION' && (
          <SegTabs
            value={leg as 'ONE_WAY' | 'RETURN'}
            onChange={(v) => { setLeg(v); setError(''); }}
            options={[{ value: 'ONE_WAY', label: 'One way' }, { value: 'RETURN', label: 'Return' }]}
            className="w-full sm:max-w-[15rem]"
          />
        )}

      </div>

      {/* A tinted rail under the fields. White cells on a white card had no
          edges to speak of and the whole row read as a smudge; the rail gives
          them something to sit on and turns five inputs into one bar. */}
      <div className="relative mt-4 rounded-[1.4rem] bg-ink-50/80 p-2">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
        {/* ---------------------------------------------------- LOCAL */}
        {tab === 'LOCAL' && (
          <>
            {routePair('Bandra Kurla Complex')}
            {dateField}{timeField}{paxField}
          </>
        )}

        {/* -------------------------------------------------- AIRPORT */}
        {tab === 'AIRPORT' && (
          <>
            <SoftField label="Airport" htmlFor="qb-airport" icon={<IconPin className={FIELD_ICON} />} className={SPAN[4]}>
              <select id="qb-airport" className={SOFT_INPUT} value={airport} onChange={(e) => setAirport(e.target.value)}>
                {AIRPORTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </SoftField>
            <SoftField label="Direction" htmlFor="qb-dir" icon={<IconArrowRight className={FIELD_ICON} />} className={SPAN[4]}>
              <select
                id="qb-dir" className={SOFT_INPUT} value={direction}
                onChange={(e) => { setDirection(e.target.value as 'TO' | 'FROM'); setError(''); }}
              >
                <option value="TO">Drop at airport</option>
                <option value="FROM">Pickup from airport</option>
              </select>
            </SoftField>
            {/* One address, and which one it is follows from the direction —
                asking for both is how you get a form nobody finishes. */}
            <div className={`min-w-0 ${SPAN[4]}`}>
              {direction === 'TO' ? (
                <PlaceInput label={addressLabel} variant="soft" value={from} onChange={setFrom}
                  placeholder="Powai" id="qb-from" icon={<IconPin className={FIELD_ICON} />} />
              ) : (
                <PlaceInput label={addressLabel} variant="soft" value={to} onChange={setTo}
                  placeholder="Powai" id="qb-to" icon={<IconPin className={FIELD_ICON} />} />
              )}
            </div>
            <SoftField label="Flight number" htmlFor="qb-flight" icon={<IconPlane className={FIELD_ICON} />} className={SPAN[3]}>
              <input
                id="qb-flight" className={SOFT_INPUT} value={flight}
                onChange={(e) => setFlight(e.target.value.toUpperCase())}
                placeholder="AI 676" autoComplete="off" inputMode="text"
              />
            </SoftField>
            {dateField}{timeField}{paxField}
          </>
        )}

        {/* ----------------------------------------------- OUTSTATION */}
        {tab === 'OUTSTATION' && !leg && (
          <p className={`px-3 py-4 text-sm text-ink-500 ${SPAN[12]}`}>
            Choose <span className="font-semibold text-ink-700">One way</span> or{' '}
            <span className="font-semibold text-ink-700">Return</span> above.
          </p>
        )}

        {/* One way: only the destination names. No prices, no cars and no
            other fields here - the cabs and fares come on the next page, and
            the trip details are only asked for Other. */}
        {tab === 'OUTSTATION' && leg === 'ONE_WAY' && (
          <>
            <div className={`rounded-2xl bg-white p-3 ${SPAN[12]}`}>
              <p className="px-1 text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">
                Select destination
              </p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
                {(routes ?? []).map((r) => (
                  <button
                    key={r.key} type="button" onClick={() => pickRoute(r.key)}
                    className="rounded-xl bg-ink-50 px-3 py-3 text-left text-sm font-bold text-ink-800 transition-colors hover:bg-ink-900 hover:text-white"
                  >
                    {routeLabel(r)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setRouteKey('other'); setError(''); }}
                  className={`rounded-xl px-3 py-3 text-left text-sm font-bold transition-colors ${
                    routeKey === 'other' ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-800 hover:bg-ink-900 hover:text-white'
                  }`}
                >
                  Other
                </button>
              </div>
            </div>

            {routeKey === 'other' && (
              <>
                <p className={`px-2 pt-1 text-xs text-ink-500 ${SPAN[12]}`}>
                  <span className="font-semibold text-ink-700">Fare on request.</span> Tell us the trip and our team
                  will come back with the applicable fare and vehicle options.
                </p>
                {routePair('Where are you going?')}
                {dateField}{timeField}{paxField}
              </>
            )}
          </>
        )}

        {/* Return: the full outstation form, as it was. */}
        {tab === 'OUTSTATION' && leg === 'RETURN' && (
          <>
            {routePair('Lonavala')}
            {dateField}{timeField}{paxField}
            <SoftField label="Return date" htmlFor="qb-return" icon={<IconCalendar className={FIELD_ICON} />} className={SPAN[2]}>
              <DmyDateField
                id="qb-return" value={returnDate} min={date || today} muted
                onChange={(v) => { setReturnDate(v); setError(''); }}
              />
            </SoftField>
            <SoftField label="Return time" htmlFor="qb-return-time" icon={<IconClock className={FIELD_ICON} />} className={SPAN[2]}>
              <TimeField
                id="qb-return-time" value={returnTime} onChange={setReturnTime} placeholder="Select time"
                baseClass={SOFT_INPUT_MUTED} chevron={false} showIcon={false}
              />
            </SoftField>

            {/* Optional extra stops. Outstation groups pick people up on the
                way out far more often than they admit at booking time, and a
                stop added on the phone afterwards is a stop nobody priced. */}
            {stops.map((s, i) => (
              <div key={i} className={`flex min-w-0 items-end gap-2 ${SPAN[4]}`}>
                <PlaceInput
                  label={`Extra stop ${i + 1}`} variant="soft" value={s} icon={<IconPin className={FIELD_ICON} />}
                  onChange={(v) => setStop(i, v)} placeholder="Anywhere on the way" id={`qb-stop-${i}`}
                />
                <button
                  type="button"
                  onClick={() => setStops((x) => x.filter((_, j) => j !== i))}
                  className="mb-0 grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink-50 text-ink-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  aria-label={`Remove extra stop ${i + 1}`}
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
            ))}

            {stops.length < 3 && (
              <div className={`flex items-end ${SPAN[3]}`}>
                <button
                  type="button"
                  onClick={() => setStops((x) => [...x, ''])}
                  className="btn h-10 rounded-full bg-ink-50 px-4 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Add another pickup or drop
                </button>
              </div>
            )}
          </>
        )}

        {/* --------------------------------------------------- HOURLY */}
        {tab === 'HOURLY' && (
          <>
            <div className={`min-w-0 ${SPAN[4]}`}>
              <PlaceInput label="Pickup" variant="soft" value={from} onChange={setFrom}
                placeholder="Andheri East" id="qb-from" icon={<IconPin className={FIELD_ICON} />} />
            </div>
            <SoftField label="Package" htmlFor="qb-pkg" icon={<IconClock className={FIELD_ICON} />} className={SPAN[3]}>
              <select id="qb-pkg" className={SOFT_INPUT} value={pkg} onChange={(e) => setPkg(e.target.value)}>
                {HOURLY_PACKAGES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </SoftField>
            {dateField}{timeField}{paxField}
          </>
        )}
      </div>
      </div>

      {error && <p className="error-text mt-3">{error}</p>}

      {/* The action row states what is about to be searched for. It fills what
          was an empty band beside the button, and it is the one place a
          customer can check the date they never typed before they press. */}
      {!(tab === 'OUTSTATION' && (!leg || (leg === 'ONE_WAY' && routeKey !== 'other'))) && (
      <div className="relative mt-5 flex flex-col gap-3 border-t border-ink-100/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-xs text-ink-500">
          <span className="font-semibold text-ink-700">{summary.head}</span>
          {summary.rest && <span className="text-ink-400"> · {summary.rest}</span>}
        </p>
        <button
          type="submit"
          className="grad-brand btn group h-12 w-full shrink-0 rounded-full px-8 text-sm font-semibold text-white
                     shadow-lg shadow-brand-500/30 transition-all duration-200 hover:-translate-y-0.5
                     hover:shadow-xl hover:shadow-brand-500/35 active:translate-y-0 sm:h-11 sm:w-auto"
        >
          <IconSearch className="h-4 w-4" /> {tab === 'OUTSTATION' && leg === 'ONE_WAY' ? 'Request a quote' : 'Search'}
          <IconArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      </div>
      )}

      {/* A tinted band across the foot of the card. On a phone it is one line
          that scrolls, rather than six pills stacked three deep between the
          customer and the rest of the page. */}
      <div className="relative -mx-4 -mb-4 mt-5 rounded-b-[1.75rem] bg-ink-50/70 px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6">
        <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 sm:flex-wrap sm:overflow-visible">
          {ASSURANCES.map((a) => (
            <li
              key={a.label}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-white
                         px-3 py-1.5 text-2xs font-bold text-ink-700 shadow-card"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
                {a.clock ? <IconClock className="h-2.5 w-2.5" /> : <IconCheck className="h-2.5 w-2.5" />}
              </span>
              {a.label}
              {a.note && <span className="font-medium text-ink-400">{a.note}</span>}
            </li>
          ))}
        </ul>
      </div>

    </form>
  );
}

/**
 * The two ways out of the widget, for the two customers who do not want to use
 * it: the one who does not know what to book, and the one who would rather just
 * send a message.
 */
export function BookingHelpBanners({ className = '' }: { className?: string }) {
  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${className}`}>
      <div className="tile flex h-full flex-col items-start gap-4 p-5">
        <div className="flex items-start gap-3.5">
          <span className="grad-soft grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl" aria-hidden="true">
            🤔
          </span>
          <div>
            <p className="font-display text-md font-bold text-ink-900">
              Not sure which vehicle or service you need?
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              Answer four short questions — group size, luggage, distance and how long — and we will
              tell you what we would send, and why.
            </p>
          </div>
        </div>
        <Link
          to="/help-me-choose"
          className="btn mt-auto h-11 w-full rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800 sm:w-auto"
        >
          Help me choose <IconArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* wa.me — the free link. No Business API, nothing to sign up for: it
          opens the app if it is installed and web.whatsapp.com if it is not.
          A short form runs first so the enquiry reaches the office with a Trip
          ID rather than living only in a chat thread. */}
      <div className="tile flex h-full flex-col items-start gap-4 p-5">
        <div className="flex items-start gap-3.5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#25D366]/10 text-[#128C43]" aria-hidden="true">
            <IconWhatsApp className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-md font-bold text-ink-900">
              Rather just send us a message?
            </p>
            <p className="mt-1 text-sm leading-relaxed text-ink-500">
              Six quick boxes, then WhatsApp opens with your requirement already written out and a Trip ID
              you can quote. The desk answers {COMPANY.serviceHours.toLowerCase()} and replies with the rate.
            </p>
          </div>
        </div>
        <WhatsAppButton
          className="btn mt-auto h-11 w-full rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99] sm:w-auto"
        >
          <IconWhatsApp className="h-4 w-4" /> Message on WhatsApp
        </WhatsAppButton>
      </div>
    </div>
  );
}

/** Kept so older imports do not break; the pair above is what pages use now. */
export function HelpMeChooseBanner({ className = '' }: { className?: string }) {
  return <BookingHelpBanners className={className} />;
}
