import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { COMPANY } from './siteData';
import { estimateFare, groupRates, type RateOption } from './fare';
import { IconPhone, IconArrowRight, IconCheck } from '../components/icons';
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
  /** The walk-in GST rate the office bills at (Vendors > Direct Customer). */
  const [gstRate, setGstRate] = useState(5);
  /** Off by default: the site quotes before GST, as the rate card does. */
  const [withGst, setWithGst] = useState(false);
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
        setGstRate(Number(data.gstRate ?? 5));
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
      withGst ? 'IGST' : 'NONE',
      withGst ? gstRate : 0
    );
  }, [rate, extraHours, extraKm, distanceKm, days, withGst, gstRate]);

  // Nothing to show until somebody has entered a walk-in rate in the Master.
  if (!loaded || !rates.length || !rate) return null;

  const enquiry = [
    `${TRIP_TYPES.find(([t]) => t === tripType)?.[1]} — ${vehicle}`,
    tripType === 'OUTSTATION'
      ? `${distanceKm || rate.min_km_per_day} km, ${days} day(s)`
      : rate.plan_label,
    estimate ? `Estimated ${inr(estimate.total)}${withGst ? ` incl. GST ${gstRate}%` : ' + GST if applicable'}` : '',
  ].filter(Boolean).join(' · ');

  const field = 'text-2xs font-bold uppercase tracking-[0.1em] text-ink-500';
  const box = 'input mt-1 h-10 bg-white text-sm';

  return (
    <section className="pt-20 sm:pt-24 lg:pt-28">
      <div className="shell">
        <div className="tile overflow-hidden">
          <div className="grid lg:grid-cols-[0.9fr,1.1fr]">
            {/* ------------------------------------------------ the pitch */}
            <div className="flex flex-col p-6 sm:p-8">
              <span className="lead">Fare calculator</span>
              <h2 className="h-sec">What will your trip cost?</h2>
              <p className="mt-4 text-md leading-[1.7] text-ink-500">
                Pick the trip and the vehicle for an instant estimate from our published rate card. The final rate is
                confirmed before the car is assigned.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  ['From our own rate card', 'The same rates the office quotes on the phone.'],
                  ['GST shown only if you want it', 'Switch it on for a GST invoice figure.'],
                  ['Toll and parking at actuals', 'Never marked up, each on its own line.'],
                ].map(([t, d]) => (
                  <li key={t} className="flex gap-3">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
                      <IconCheck className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-ink-900">{t}</span>
                      <span className="block text-xs text-ink-500">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-2.5 lg:mt-auto lg:pt-7">
                <WhatsAppButton
                  message={`Hello, I would like a quote for: ${enquiry}`}
                  className="btn h-11 rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
                >
                  <IconWhatsApp className="h-4 w-4" /> Send on WhatsApp
                </WhatsAppButton>
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office"
                  className="btn h-11 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white hover:bg-ink-800">
                  <IconPhone className="h-4 w-4" /> Call
                </a>
              </div>
            </div>

            {/* ------------------------------------------------ the form */}
            <div className="border-t border-ink-100 bg-ink-50/60 p-5 sm:p-7 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap gap-1.5 rounded-full bg-ink-100/80 p-1" role="group" aria-label="Trip type">
                {available.map(([t, label]) => (
                  <button
                    key={t} type="button" onClick={() => setTripType(t)} aria-pressed={tripType === t}
                    className={`flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                      tripType === t ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-600 hover:text-ink-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className={field}>Vehicle</span>
                  <select className={box} value={vehicle} onChange={(e) => setVehicle(e.target.value)}>
                    {vehiclesFor(tripType).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>

                {plans.length > 1 ? (
                  <label className="block">
                    <span className={field}>Package</span>
                    <select className={box} value={planLabel} onChange={(e) => setPlanLabel(e.target.value)}>
                      {plans.map((p) => <option key={p.plan_label} value={p.plan_label}>{p.plan_label}</option>)}
                    </select>
                  </label>
                ) : <div />}

                {tripType === 'OUTSTATION' ? (
                  <>
                    <label className="block">
                      <span className={field}>Total km</span>
                      <input className={`${box} text-right tabular-nums`} inputMode="numeric"
                        placeholder={String(rate.min_km_per_day || 300)}
                        value={distanceKm} onChange={(e) => setDistanceKm(e.target.value.replace(/\D/g, ''))} />
                    </label>
                    <label className="block">
                      <span className={field}>Days</span>
                      <input className={`${box} text-right tabular-nums`} inputMode="numeric"
                        value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
                    </label>
                  </>
                ) : tripType === 'LOCAL' ? (
                  <>
                    <label className="block">
                      <span className={field}>Extra hours</span>
                      <input className={`${box} text-right tabular-nums`} inputMode="numeric" placeholder="0"
                        value={extraHours} onChange={(e) => setExtraHours(e.target.value.replace(/\D/g, ''))} />
                    </label>
                    <label className="block">
                      <span className={field}>Extra km</span>
                      <input className={`${box} text-right tabular-nums`} inputMode="numeric" placeholder="0"
                        value={extraKm} onChange={(e) => setExtraKm(e.target.value.replace(/\D/g, ''))} />
                    </label>
                  </>
                ) : null}
              </div>

              {/* GST: off by default, one tap to see the figure with it */}
              <label className="mt-3.5 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3.5 py-2.5 ring-1 ring-inset ring-ink-100">
                <span className="text-sm">
                  <span className="font-semibold text-ink-800">Add GST ({gstRate}%)</span>
                  <span className="block text-2xs text-ink-500">Turn on if you need a GST invoice</span>
                </span>
                <span className="relative inline-flex shrink-0">
                  <input type="checkbox" className="peer sr-only" checked={withGst} onChange={(e) => setWithGst(e.target.checked)} />
                  <span className="h-6 w-11 rounded-full bg-ink-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400" />
                  <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                </span>
              </label>

              {rate.notes && <p className="mt-3 text-xs text-ink-500">{rate.notes}</p>}

              {estimate && (
                <div className="mt-4 rounded-2xl bg-white p-4 shadow-card ring-1 ring-inset ring-brand-100">
                  <dl className="space-y-1.5 text-xs">
                    {estimate.lines.map((l) => (
                      <div key={l.label} className="flex items-baseline justify-between gap-3">
                        <dt className="min-w-0 text-ink-600">
                          {l.label}
                          {l.detail && <span className="ml-1.5 text-ink-400">{l.detail}</span>}
                        </dt>
                        <dd className="shrink-0 tabular-nums text-ink-800">{inr(l.amount)}</dd>
                      </div>
                    ))}
                    {estimate.tax > 0 && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-ink-600">{estimate.taxLabel}</dt>
                        <dd className="tabular-nums text-ink-800">{inr(estimate.tax)}</dd>
                      </div>
                    )}
                  </dl>
                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-brand-100 pt-3">
                    <div>
                      <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">Estimated total</p>
                      <p className="text-2xs text-ink-400">{withGst ? `Including GST ${gstRate}%` : 'Before GST'} · toll &amp; parking extra</p>
                    </div>
                    <p className="font-display text-2xl font-extrabold tabular-nums tracking-tight text-brand-700">{inr(estimate.total).replace('.00', '')}</p>
                  </div>
                  {estimate.note && <p className="mt-2 text-2xs text-ink-500">{estimate.note}</p>}
                </div>
              )}

              <p className="mt-3 text-2xs leading-relaxed text-ink-400">
                An estimate, not a quotation. Toll, parking and state permits are added at actuals.{' '}
                <Link to="/enquiry" className="font-semibold text-brand-700 hover:underline">
                  Send the trip details <IconArrowRight className="inline h-3 w-3" />
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
