import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { COMPANY } from './siteData';
import { estimateFare, groupRates, type RateOption } from './fare';
import { IconPhone, IconArrowRight } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';

/* ==========================================================================
   Fare calculator.

   Reads the walk-in rate card from the Master — the only rates the portal
   publishes — and works the trip out in the browser. If no rates have been
   entered yet the whole section stays hidden rather than showing an empty
   widget, so the page never advertises a calculator that cannot calculate.
   ========================================================================== */

const TRIP_TYPES = [
  ['LOCAL', 'Local package', 'A car for a block of hours'],
  ['AIRPORT', 'Airport transfer', 'One pickup or drop'],
  ['OUTSTATION', 'Outstation', 'Out of the city'],
] as const;

type TripType = (typeof TRIP_TYPES)[number][0];

export function FareCalculator() {
  const [rates, setRates] = useState<RateOption[]>([]);
  const [tax, setTax] = useState({ mode: 'IGST', rate: 5 });
  const [loaded, setLoaded] = useState(false);

  const [tripType, setTripType] = useState<TripType>('LOCAL');
  const [vehicle, setVehicle] = useState('');
  const [planLabel, setPlanLabel] = useState('');
  const [extraHours, setExtraHours] = useState('');
  const [extraKm, setExtraKm] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [days, setDays] = useState('1');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/public/fare-options');
        setRates(data.data ?? []);
        setTax({ mode: data.taxMode ?? 'IGST', rate: Number(data.taxRate ?? 5) });
      } catch {
        /* The calculator is a bonus, not the point of the page. */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  const { vehiclesFor, plansFor } = useMemo(() => groupRates(rates), [rates]);

  /** Trip types we actually hold rates for. */
  const available = useMemo(
    () => TRIP_TYPES.filter(([t]) => vehiclesFor(t).length > 0),
    [rates] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Keep the selects on something that exists as the trip type changes.
  useEffect(() => {
    if (!available.length) return;
    if (!available.some(([t]) => t === tripType)) { setTripType(available[0][0]); return; }
    const list = vehiclesFor(tripType);
    if (!list.includes(vehicle)) setVehicle(list[0] ?? '');
  }, [tripType, available]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const plans = plansFor(tripType, vehicle);
    if (!plans.some((p) => p.plan_label === planLabel)) setPlanLabel(plans[0]?.plan_label ?? '');
  }, [tripType, vehicle, rates]); // eslint-disable-line react-hooks/exhaustive-deps

  const plans = plansFor(tripType, vehicle);
  const rate = plans.find((p) => p.plan_label === planLabel) ?? plans[0];

  const estimate = useMemo(() => {
    if (!rate) return null;
    return estimateFare(
      rate,
      {
        extraHours: Number(extraHours) || 0,
        extraKm: Number(extraKm) || 0,
        distanceKm: Number(distanceKm) || 0,
        days: Number(days) || 1,
      },
      tax.mode,
      tax.rate
    );
  }, [rate, extraHours, extraKm, distanceKm, days, tax]);

  // Nothing to show until somebody has entered a walk-in rate in the Master.
  if (!loaded || !rates.length || !rate) return null;

  const enquiry = [
    `${TRIP_TYPES.find(([t]) => t === tripType)?.[1]} — ${vehicle}`,
    tripType === 'OUTSTATION'
      ? `${distanceKm || rate.min_km_per_day} km, ${days} day(s)`
      : rate.plan_label,
    estimate ? `Estimated ${inr(estimate.total)}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <section className="pt-20 sm:pt-24 lg:pt-28">
      <div className="shell">
        <div className="grid gap-8 lg:grid-cols-[0.9fr,1.1fr] lg:gap-12">
          <div>
            <span className="lead">Work it out</span>
            <h2 className="h-sec">What will your trip cost?</h2>
            <p className="mt-4 text-md leading-[1.7] text-ink-500">
              Pick the trip and the vehicle for an indicative figure. Toll, parking and any state permit are
              extra at actuals, and the final rate is confirmed before the car is assigned.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <WhatsAppButton
                message={`Hello, I would like a quote for: ${enquiry}`}
                className="btn h-11 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
              >
                <IconWhatsApp className="h-4 w-4" /> Send this on WhatsApp
              </WhatsAppButton>
            </div>
          </div>

          <div className="tile p-6 sm:p-7">
            {/* trip type */}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Trip type">
              {available.map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTripType(t)}
                  aria-pressed={tripType === t}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    tripType === t
                      ? 'bg-brand-600 text-white'
                      : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Vehicle</span>
                <select className="input mt-1.5" value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                  {vehiclesFor(tripType).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>

              {plans.length > 1 && (
                <label className="block">
                  <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Package</span>
                  <select className="input mt-1.5" value={planLabel} onChange={(e) => setPlanLabel(e.target.value)}>
                    {plans.map((p) => <option key={p.plan_label} value={p.plan_label}>{p.plan_label}</option>)}
                  </select>
                </label>
              )}

              {tripType === 'OUTSTATION' ? (
                <>
                  <label className="block">
                    <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Total distance (km)</span>
                    <input
                      className="input mt-1.5 text-right tabular-nums" inputMode="numeric"
                      placeholder={String(rate.min_km_per_day || 300)}
                      value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Days</span>
                    <input
                      className="input mt-1.5 text-right tabular-nums" inputMode="numeric"
                      value={days} onChange={(e) => setDays(e.target.value)}
                    />
                  </label>
                </>
              ) : tripType === 'LOCAL' ? (
                <>
                  <label className="block">
                    <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Extra hours</span>
                    <input
                      className="input mt-1.5 text-right tabular-nums" inputMode="numeric" placeholder="0"
                      value={extraHours} onChange={(e) => setExtraHours(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-500">Extra kilometres</span>
                    <input
                      className="input mt-1.5 text-right tabular-nums" inputMode="numeric" placeholder="0"
                      value={extraKm} onChange={(e) => setExtraKm(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
            </div>

            {rate.notes && <p className="mt-4 text-xs text-ink-500">{rate.notes}</p>}

            {/* the estimate */}
            {estimate && (
              <div className="mt-6 rounded-xl bg-ink-50 p-5">
                <dl className="space-y-2 text-sm">
                  {estimate.lines.map((l) => (
                    <div key={l.label} className="flex items-baseline justify-between gap-4">
                      <dt className="text-ink-600">
                        {l.label}
                        {l.detail && <span className="ml-1.5 text-xs text-ink-400">{l.detail}</span>}
                      </dt>
                      <dd className="tabular-nums text-ink-800">{inr(l.amount)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-ink-200 pt-2">
                    <dt className="text-ink-600">{estimate.taxLabel}</dt>
                    <dd className="tabular-nums text-ink-800">{inr(estimate.tax)}</dd>
                  </div>
                  <div className="flex justify-between border-t-2 border-ink-300 pt-2.5 text-base font-bold">
                    <dt className="text-ink-900">Estimated total</dt>
                    <dd className="tabular-nums text-brand-700">{inr(estimate.total)}</dd>
                  </div>
                </dl>

                {estimate.note && <p className="mt-3 text-xs text-ink-500">{estimate.note}</p>}

                <p className="mt-4 border-t border-ink-200 pt-3 text-[11px] leading-relaxed text-ink-500">
                  An estimate, not a quotation. Toll, parking and state permits are added at actuals, and the
                  rate is confirmed with you before the vehicle is assigned.{' '}
                  <Link to="/contact" className="font-semibold text-brand-700 hover:underline">
                    Send the trip details <IconArrowRight className="inline h-3 w-3" />
                  </Link>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
