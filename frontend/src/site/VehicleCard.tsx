/**
 * The vehicle card.
 *
 * One card, used by the search results, the recommendation screens and the
 * destination pages — so a vehicle looks and reads the same wherever the
 * customer meets it.
 *
 * LAID OUT LIKE THE AGGREGATORS, BECAUSE THAT SHAPE WORKS
 *
 * Name and price on the left, the vehicle on the right, then a ruled block of
 * what the fare actually includes, then one button. It is the shape Savaari,
 * MakeMyTrip and Ola all use for a cab result, and it works because the
 * customer's two questions — what is it, and what does it cost — are answered
 * before their eye has to move.
 *
 * WHAT IS DELIBERATELY NOT COPIED FROM THEM
 *
 *   · No star rating. We hold no verified per-vehicle ratings. A 4.8 next to a
 *     real fare would undermine the one number on the card that is honest. The
 *     comfort band does that job and is a claim we can stand behind.
 *   · No "14% OFF" with a struck-through price. That needs a list price the
 *     discount is off. This business quotes one rate; inventing a higher number
 *     to cross out is the oldest trick on a booking page and it is a lie.
 *   · No fuel-type selector. We do not run electric vehicles, and offering the
 *     choice and then substituting quietly is worse than not offering it.
 *
 * WHAT THE INCLUSIONS BLOCK SAYS is read off the matched rate row — included
 * kilometres, the after-limit per-km rate, the driver allowance. Nothing there
 * is written by hand, so it cannot drift from what the office would quote. When
 * the rate card has no row for a vehicle, the block says so rather than
 * guessing.
 */
import { Link } from 'react-router-dom';
import { inr } from '../lib/format';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { IconSeat, IconLuggage } from './SiteIcons';
import {
  IconArrowRight, IconCheck, IconClock, IconSteering, IconRoad, IconMail, IconPhone,
} from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { EnquiryButton, WhatsAppButton, type EnquiryPrefill } from './EnquirySheet';
import { COMPANY } from './siteData';
import { capacityOf, type CatalogVehicle, type PlanType } from './catalog';
import { estimateFor, useCompare, type EstimateInput } from './kit';
import { useRates } from './kit';

const COMFORT_TONE: Record<string, string> = {
  Standard: 'bg-ink-100 text-ink-600',
  Comfort: 'bg-brand-50 text-brand-700',
  Premium: 'bg-gradient-to-r from-[#EFEBFE] to-[#E4EDFE] text-[#4B45B8]',
  Luxury: 'bg-gold-100 text-gold-700',
};

const CHIP = 'inline-flex rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em]';

const SPEC = 'inline-flex items-center gap-1.5 rounded-md border border-ink-100 px-2 py-1 font-medium text-ink-700';

const TINTS = ['grad-soft', 'grad-mint', 'grad-warm'];

/**
 * The one-line spec, the way a cab is described on the phone.
 *
 * Per VEHICLE, not per booking: a Honda City is a four-seater whether the group
 * needs one or two of them. The total goes in the inclusions row below, which
 * can also say how it is made up.
 */
function specLine(v: CatalogVehicle): string {
  /**
   * "6 seater" alone contradicted the page around it. The 2+3+2 classes are
   * offered to groups of seven, so a customer who searched for seven was
   * reading "6 seater" on every card they had just been told would fit them.
   * Naming both figures is the whole truth: six in comfort, seven at a push.
   */
  const max = capacityOf(v);
  const seating = max > v.seats ? `${v.seats}-${max} seater` : `${v.seats} seater`;

  return [seating, v.ac ? 'AC' : null,
    v.category.toLowerCase().includes('coach') ? 'coach' : 'cab']
    .filter(Boolean)
    .join(' ');
}

export function VehicleCard({
  vehicle, index = 0, best = false, count = 1, estimateInput, to, onSelect,
  selectLabel = 'Select car', compact = false, contact, fixedFare,
}: {
  vehicle: CatalogVehicle;
  index?: number;
  /** Highlights the recommendation with a ring. Only ever one card in a list. */
  best?: boolean;
  /** How many of this vehicle the group needs. */
  count?: number;
  estimateInput?: EstimateInput;
  /** Where "details" goes. Defaults to the vehicle page. */
  to?: string;
  onSelect?: () => void;
  selectLabel?: string;
  /** Drops the feature bullets, for dense lists. */
  compact?: boolean;
  /**
   * The three ways to act on THIS vehicle, when the page knows the trip.
   *
   * Given these, the card drops "Select car" and "Details": on a results page
   * the customer has already said where they are going, so the next step is
   * talking to somebody about this vehicle rather than opening another page
   * about it. Pages with no trip — the fleet list, the home page — pass
   * nothing and keep the details link.
   */
  /**
   * The trip this card is showing, used to prefill the enquiry sheet.
   *
   * It used to be three things — an /enquiry URL, a prefill and a tel: link.
   * All three buttons now open the same sheet with the same prefill and differ
   * only in what happens after Send, so one object is all that is left.
   */
  contact?: EnquiryPrefill;
  /**
   * A published route fare (outstation fixed fares). Replaces the rate-card
   * estimate: the card shows this one price, toll included or not, and none of
   * the per-km inclusions, which do not apply to a fixed fare. `amount: null`
   * is a category the office has not priced yet - shown as Fare on request.
   */
  fixedFare?: { amount: number | null; tollIncluded: boolean; legLabel: string };
}) {
  const book = useRates();
  const compare = useCompare();

  const est = estimateInput && !fixedFare
    ? estimateFor(book, vehicle, { ...estimateInput, vehicles: count })
    : { estimate: null, planLabel: '', row: null, reason: 'none' as string | undefined };

  const detail = to ?? `/vehicles/${vehicle.slug}`;
  const row = est.row;
  const rs = (n: number) => inr(n, true).replace('.00', '');

  /* Every figure is read off the matched rate row, so it cannot drift from
     what the office would quote. */
  const terms: { key: string; Icon: typeof IconClock; value: string; after?: string }[] = [];
  if (row && row.included_hours > 0) terms.push({
    key: 'hrs', Icon: IconClock, value: `${row.included_hours} hrs included`,
    after: row.extra_hour_rate > 0 ? `then ${rs(row.extra_hour_rate)}/hr` : undefined,
  });
  if (row && row.included_km > 0) terms.push({
    key: 'km', Icon: IconRoad, value: `${row.included_km} km included`,
    after: row.extra_km_rate > 0 ? `then ${rs(row.extra_km_rate)}/km` : undefined,
  });
  if (row && row.plan_type === 'OUTSTATION' && row.min_km_per_day > 0) terms.push({
    key: 'kmday', Icon: IconRoad, value: `${row.min_km_per_day} km/day`,
    after: `then ${rs(row.per_km_rate)}/km`,
  });
  if (row && row.driver_allowance > 0) terms.push({
    key: 'da', Icon: IconSteering, value: `${rs(row.driver_allowance)}/day DA`,
    after: 'driver allowance included',
  });

  return (
    <article
      className={`group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white transition-all duration-300 ${
        best ? 'shadow-raised ring-2 ring-brand-400' : 'shadow-card hover:-translate-y-0.5 hover:shadow-lift'
      }`}
    >
      <div className="flex items-start gap-3.5 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`${CHIP} bg-brand-50 text-brand-700`}>{vehicle.category}</span>

          </div>

          <Link to={detail} className="mt-2 block">
            <h3 className="font-display text-md font-bold leading-tight text-ink-900 sm:text-lg">
              {count > 1 && <span className="mr-1 tabular-nums">{count} ×</span>}
              {vehicle.name}
            </h3>
            <p className="mt-0.5 text-xs font-medium text-ink-600">{specLine(vehicle)}</p>
          </Link>

          <div className="mt-3">
            {fixedFare ? (
              fixedFare.amount != null ? (
                <>
                  <p className="font-display text-xl font-extrabold leading-none tracking-tight text-ink-900">
                    ₹{fixedFare.amount.toLocaleString('en-IN')}
                  </p>
                  <p className="mt-1 text-2xs font-semibold text-ok-700">
                    {fixedFare.tollIncluded ? 'Toll included' : 'Toll extra'} · {fixedFare.legLabel.toLowerCase()}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-md font-bold text-ink-900">Fare on request</p>
                  <p className="mt-1 text-2xs text-ink-500">Enquire and we quote this one</p>
                </>
              )
            ) : est.estimate ? (
              <>
                <p className="font-display text-xl font-extrabold leading-none tracking-tight text-ink-900">
                  {inr(est.estimate.total, true).replace('.00', '')}
                </p>
                {est.estimate.tax > 0 ? (
                  <p className="mt-1 text-2xs text-ink-500">
                    incl. {inr(est.estimate.tax, true).replace('.00', '')} charges and taxes
                  </p>
                ) : (
                  <p className="mt-1 text-2xs text-ink-500">+ toll, parking &amp; state tax extra</p>
                )}
              </>
            ) : est.reason === 'loading' ? (
              <div className="skeleton h-6 w-24 rounded-full" />
            ) : (
              <p className="text-sm font-semibold text-ink-500">
                {estimateInput ? 'Rate on request' : 'Rates quoted per account'}
              </p>
            )}
          </div>
        </div>

        <Link
          to={detail}
          className={`relative block w-[8.75rem] shrink-0 overflow-hidden rounded-xl sm:w-[9.5rem] ${TINTS[index % TINTS.length]}`}
        >
          <VehiclePhoto
            photo={vehicle.photo}
            art={vehicle.art}
            name={vehicle.name}
            alt={`${vehicle.name} on hire with driver in Mumbai — ${vehicle.examples}`}
            /* 16:10, close to the 3:2 of the photographs and the 1.47 of the
               drawings, so the crop this window takes is a sliver. It was 2:1,
               which cropped a quarter of the height off the middle band and
               took the roof off every tall vehicle with it. */
            className="aspect-[16/10] w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.06]"
          />
        </Link>
      </div>

      {/* ---------------------------------------------------------------
          What the fare covers. Every figure here is read off the matched
          rate row, so it cannot drift from what the office would quote.
          --------------------------------------------------------------- */}
      <div className="space-y-2.5 border-t border-ink-100 px-4 py-3 text-xs leading-snug text-ink-600">
        {/* The cab itself: small pills, read at a glance. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={SPEC}>
            <IconSeat className="h-3.5 w-3.5 shrink-0 text-brand-500" />
            {vehicle.seats * count} seats{count > 1 ? ` · ${count} cabs` : ''}
          </span>
          <span className={SPEC}>
            <IconLuggage className="h-3.5 w-3.5 shrink-0 text-brand-500" />
            {vehicle.bags * count} {vehicle.bags * count === 1 ? 'bag' : 'bags'}
          </span>
          <span className={`${CHIP} ml-auto ${COMFORT_TONE[vehicle.comfort]}`}>{vehicle.comfort}</span>
        </div>

        {/* What the fare covers, and what is charged after it. Only what the
            rate card actually states: with no row matched there is nothing
            true to put here, so nothing goes here. */}
        {terms.length > 0 && (
          <dl className="grid grid-cols-2 gap-1.5">
            {terms.map((t) => (
              <div key={t.key} className="flex min-w-0 items-start gap-2 rounded-lg bg-ink-50 px-2.5 py-2">
                <t.Icon className="mt-px h-3.5 w-3.5 shrink-0 text-brand-500" />
                <div className="min-w-0">
                  <dt className="font-semibold text-ink-800">{t.value}</dt>
                  {t.after && <dd className="mt-0.5 text-2xs text-ink-500">{t.after}</dd>}
                </div>
              </div>
            ))}
          </dl>
        )}
      </div>

      {est.estimate && est.estimate.lines.length > 0 && (
        <details className="border-t border-ink-100 px-4 py-3">
          <summary className="cursor-pointer list-none text-xs font-semibold text-brand-700 hover:text-brand-800">
            Fare details
          </summary>
          <dl className="mt-2.5 space-y-1.5 text-xs">
            {est.estimate.lines.map((l) => (
              <div key={l.label} className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-ink-600">
                  {l.label}
                  {l.detail && <span className="block text-2xs text-ink-400">{l.detail}</span>}
                </dt>
                <dd className="shrink-0 font-semibold tabular-nums text-ink-800">
                  {inr(l.amount, true).replace('.00', '')}
                </dd>
              </div>
            ))}
            {est.estimate.tax > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-600">{est.estimate.taxLabel}</dt>
                <dd className="shrink-0 font-semibold tabular-nums text-ink-800">
                  {inr(est.estimate.tax, true).replace('.00', '')}
                </dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 border-t border-ink-100 pt-1.5">
              <dt className="font-bold text-ink-900">Total</dt>
              <dd className="shrink-0 font-display font-bold tabular-nums text-ink-900">
                {inr(est.estimate.total, true).replace('.00', '')}
              </dd>
            </div>
            <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-warn-50 px-2.5 py-2 text-2xs font-medium leading-snug text-warn-700">
              <IconRoad className="mt-px h-3 w-3 shrink-0" />
              Toll, parking &amp; state tax extra — charged at actuals, as per receipts.
            </p>
            {est.estimate.note && (
              <p className="pt-1 text-2xs leading-relaxed text-ink-400">{est.estimate.note}</p>
            )}
          </dl>
        </details>
      )}

      {!compact && vehicle.features.length > 0 && (
        <ul className="space-y-1.5 border-t border-ink-100 px-4 py-3.5">
          {vehicle.features.slice(0, 3).map((f) => (
            <li key={f} className="flex gap-2 text-xs leading-relaxed text-ink-500">
              <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" />
              {f}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto px-4 pb-4 pt-3.5">
        {contact ? (
          /* Three equal columns, but each button is allowed to shrink inside
             its own — `grid-cols-3` alone sizes a column to its content, so in
             a narrow card the row grew wider than the card and the third button
             hung off the edge. `min-w-0` on the children is what lets the row
             honour the card's width instead of the buttons' natural width. */
          <div className="grid grid-cols-3 gap-2 [&>*]:min-w-0">
            <EnquiryButton
              prefill={contact}
              className="grad-brand btn h-11 w-full rounded-full px-2 text-xs font-semibold text-white transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99]"
            >
              <IconMail className="h-4 w-4 shrink-0" /> Enquire
            </EnquiryButton>
            <WhatsAppButton
              prefill={contact}
              className="btn h-11 w-full rounded-full bg-[#25D366] px-2 text-xs font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
            >
              <IconWhatsApp className="h-4 w-4 shrink-0" /> WhatsApp
            </WhatsAppButton>
            {/* Call dials. Somebody who reaches for the phone wants the phone,
                not a form standing between them and it. */}
            <a
              href={`tel:+91${COMPANY.mobile}`}
              aria-label="Call the office"
              className="btn h-11 w-full rounded-full bg-ink-900 px-2 text-xs font-semibold text-white transition-colors hover:bg-ink-800"
            >
              <IconPhone className="h-4 w-4 shrink-0" /> Call
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {onSelect ? (
              <button onClick={onSelect} className="grad-brand btn h-11 flex-1 rounded-full px-5 text-sm font-semibold text-white hover:brightness-[1.06]">
                {selectLabel}
              </button>
            ) : (
              <Link to={detail} className="grad-brand btn h-11 flex-1 rounded-full px-5 text-sm font-semibold text-white hover:brightness-[1.06]">
                {selectLabel}
              </Link>
            )}
            <Link to={detail} className="btn h-11 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100">
              Details <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {/* Compare reads the per-km rate card, which a fixed fare is not. */}
        {!fixedFare && <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-medium text-ink-500 hover:text-ink-700">
          <input
            type="checkbox"
            className="check"
            checked={compare.has(vehicle.slug)}
            onChange={() => compare.toggle(vehicle.slug)}
          />
          Add to compare
        </label>}
      </div>
    </article>
  );
}

/** The row that appears once two vehicles are ticked. */
export function CompareTray() {
  const compare = useCompare();
  if (compare.picked.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 lg:pb-5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 rounded-full bg-ink-900 px-4 py-2.5 shadow-pop">
        <span className="hidden shrink-0 text-xs font-semibold text-white/70 sm:block">
          {compare.picked.length} of 3 selected
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white sm:hidden">
          {compare.picked.length} selected
        </span>
        <button onClick={compare.clear} className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10 hover:text-white">
          Clear
        </button>
        <Link
          to={`/vehicles/compare?ids=${compare.picked.join(',')}`}
          aria-disabled={compare.picked.length < 2}
          className={`btn h-9 shrink-0 rounded-full px-5 text-sm font-semibold ${
            compare.picked.length < 2 ? 'pointer-events-none bg-white/20 text-white/50' : 'bg-white text-ink-900 hover:bg-brand-50'
          }`}
        >
          Compare
        </Link>
      </div>
    </div>
  );
}
