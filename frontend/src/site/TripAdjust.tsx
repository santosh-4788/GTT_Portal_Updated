/**
 * The trip settings that change the price — group size, the hourly package,
 * and for an outstation trip the days out, one way or return, and the
 * distance.
 *
 * On a phone these used to sit open above the results and took most of the
 * first screen. They now live in the "Change trip" sheet: edits go to a draft
 * (`onChange`), and nothing re-prices until the customer taps Apply changes.
 * Without `onChange` the fields still write straight to the URL.
 */
import { useSearchParams } from 'react-router-dom';
import { todayLocalIso } from '../lib/format';
import { DmyDateField, SegTabs, SoftField, SoftStepper, SOFT_INPUT } from './kit';
import { HOURLY_PACKAGES } from './QuickBook';
import { lookupDistance } from './places';
import { tripDays, type TripParams } from './tripParams';
import { IconCalendar, IconClock, IconRoad } from '../components/icons';
import { IconSeat } from './SiteIcons';

const ICON = 'h-3 w-3';

/** yyyy-mm-dd plus n days, in local time. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso || todayLocalIso()}T00:00:00`);
  d.setDate(d.getDate() + n);
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function TripAdjust({
  trip, className = '', onChange, bare = false,
}: {
  trip: TripParams;
  className?: string;
  /** Edit a draft instead of the URL. */
  onChange?: (fn: (p: URLSearchParams) => void) => void;
  /** No card, no heading: for use inside a sheet that has its own. */
  bare?: boolean;
}) {
  const [, setParams] = useSearchParams();
  const days = tripDays(trip);
  const outstation = trip.tab === 'OUTSTATION';
  const roundTrip = trip.leg === 'RETURN';

  const update = (fn: (p: URLSearchParams) => void) =>
    onChange
      ? onChange(fn)
      : setParams((prev) => { const p = new URLSearchParams(prev); fn(p); return p; }, { replace: true });

  /** Days and the return date move together: a round trip comes back on its last day. */
  const setDays = (n: number, leg = trip.leg, date = trip.date) =>
    update((p) => {
      if (n > 1) p.set('days', String(n)); else p.delete('days');
      if (leg === 'RETURN') { p.set('leg', 'RETURN'); p.set('return', addDays(date, n - 1)); }
      else { p.delete('leg'); p.delete('return'); }
    });

  const autoKm = (() => {
    const one = lookupDistance(trip.to);
    return one ? one * (roundTrip ? 2 : 1) : 0;
  })();

  return (
    <div className={bare ? className : `tile relative overflow-hidden p-3 sm:p-4 ${className}`}>
      <div className={`flex flex-wrap items-center justify-between gap-2 ${bare ? 'mb-3' : 'mb-2.5 px-1'}`}>
        {!bare && (
          <p className="text-xs font-bold text-ink-800">
            Adjust your trip <span className="font-medium text-ink-400">· prices update as you change</span>
          </p>
        )}
        {outstation && (
          <SegTabs
            value={trip.leg}
            onChange={(v) => setDays(days, v)}
            options={[{ value: 'ONE_WAY', label: 'One way' }, { value: 'RETURN', label: 'Round trip' }]}
            className="w-full sm:w-auto"
          />
        )}
      </div>

      <div className={`grid gap-2 rounded-[1.2rem] bg-ink-50/80 p-2 sm:grid-cols-2 ${bare ? '' : 'lg:grid-cols-4'}`}>
        <SoftField label="Passengers" htmlFor="ta-pax" icon={<IconSeat className={ICON} />}>
          <SoftStepper
            id="ta-pax" value={trip.pax} min={1} max={60}
            onChange={(v) => update((p) => p.set('pax', String(v)))}
          />
        </SoftField>

        <SoftField label={outstation ? 'Departure' : 'Date'} htmlFor="ta-date" icon={<IconCalendar className={ICON} />}>
          <DmyDateField
            id="ta-date" value={trip.date} min={todayLocalIso()}
            onChange={(v) => update((p) => {
              p.set('date', v);
              if (outstation && roundTrip) p.set('return', addDays(v, days - 1));
            })}
          />
        </SoftField>

        {trip.tab === 'HOURLY' && (
          <SoftField label="Package" htmlFor="ta-pkg" icon={<IconClock className={ICON} />}>
            <select
              id="ta-pkg" className={SOFT_INPUT} value={trip.plan || HOURLY_PACKAGES[1].key}
              onChange={(e) => update((p) => p.set('plan', e.target.value))}
            >
              {HOURLY_PACKAGES.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </SoftField>
        )}

        {outstation && (
          <>
            <SoftField label="Days" htmlFor="ta-days" icon={<IconCalendar className={ICON} />}>
              <SoftStepper id="ta-days" value={days} min={1} max={30} unit="day" onChange={(v) => setDays(v)} />
            </SoftField>
            <SoftField label="Total km (approx.)" htmlFor="ta-km" icon={<IconRoad className={ICON} />}>
              <input
                id="ta-km" className={SOFT_INPUT} inputMode="numeric"
                value={trip.km || ''}
                placeholder={autoKm ? `${autoKm} km (estimated)` : `Min ${300 * days} km`}
                onChange={(e) => {
                  const v = Math.max(0, Math.round(Number(e.target.value.replace(/\D/g, '')) || 0));
                  update((p) => (v ? p.set('km', String(v)) : p.delete('km')));
                }}
              />
            </SoftField>
          </>
        )}
      </div>

      {outstation && (
        <p className="mt-2 px-1 text-2xs text-ink-500">
          {days} {days === 1 ? 'day' : 'days'}
          {roundTrip ? `, back on ${addDays(trip.date, days - 1).split('-').reverse().join('/')}` : ''} · billed on at
          least {300 * days} km · driver allowance for {days} {days === 1 ? 'day' : 'days'} included
        </p>
      )}
    </div>
  );
}
