/**
 * Vehicle & driver pickers — shared by New booking and the trip drawer.
 *
 * Both lists come from /fleet/assign-options for the trip's own time window,
 * so "available" means free for THIS trip, not free today. Every vehicle and
 * driver is listed: the ones that can go first (the booked category on top),
 * then the ones that cannot, greyed out with the reason in words. Only someone
 * allowed to override can pick an unavailable one, and the screen that uses
 * this then asks for the reason.
 *
 * Picking a vehicle offers its regular driver straight away.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { humanise } from '../lib/format';
import { Spinner } from './ui';
import { IconCar, IconCheck, IconChevron, IconSearch, IconSteering, IconWarning } from './icons';

export interface AssignValue {
  vehicleId: number | null;
  driverId: number | null;
  /** Typed by hand for an outside (not on the fleet list) vehicle or driver. */
  vehicleNumber: string;
  vehicleLabel: string;
  driverName: string;
  driverMobile: string;
  outsideVehicle: boolean;
  outsideDriver: boolean;
}

export const EMPTY_ASSIGN: AssignValue = {
  vehicleId: null, driverId: null, vehicleNumber: '', vehicleLabel: '', driverName: '', driverMobile: '',
  outsideVehicle: false, outsideDriver: false,
};

export interface AssignTrip {
  bookingId?: number | null;
  date?: string; dateTo?: string; time?: string; tripType?: string; categoryId?: number | null;
}

/** The selection's problems, for the parent to ask for an override reason. */
export interface AssignCheck {
  needsOverride: boolean;
  reasons: string[];
  vehicle: any | null;
  driver: any | null;
  window: { start: string; end: string; allDay: boolean } | null;
}

const STATE_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', BUSY: 'On another trip', MAINTENANCE: 'In maintenance', UNAVAILABLE: 'Unavailable',
  INACTIVE: 'Inactive', ON_LEAVE: 'On leave', DOCUMENTS: 'Document expired',
};

function Combo<T extends { id: number; state: string }>({
  label, placeholder, items, value, onPick, render, search, disabled, canOverride, groupOf, icon,
}: {
  label: string; placeholder: string; items: T[]; value: T | null; onPick: (item: T) => void;
  render: (item: T) => { title: string; sub: string; reasons?: string[] };
  search: (item: T) => string; disabled?: boolean; canOverride: boolean;
  groupOf: (item: T) => string; icon: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const groups = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = items.filter((i) => !t || search(i).toLowerCase().includes(t));
    const out = new Map<string, T[]>();
    for (const i of list) out.set(groupOf(i), [...(out.get(groupOf(i)) ?? []), i]);
    return [...out.entries()];
  }, [items, term, search, groupOf]);

  const shown = value ? render(value) : null;
  return (
    <div ref={box} className="relative">
      <span className="mb-1.5 block text-xs font-semibold text-ink-700">{label}</span>
      <button type="button" disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`input flex h-auto min-h-[42px] w-full items-center gap-2.5 py-2 text-left ${disabled ? 'opacity-60' : ''}`}>
        <span className="text-ink-400">{icon}</span>
        {shown ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900">{shown.title}</span>
            <span className="block truncate text-xs text-ink-500">{shown.sub}</span>
          </span>
        ) : <span className="flex-1 text-sm text-ink-400">{placeholder}</span>}
        {value && value.state !== 'AVAILABLE' && <span className="badge-warn shrink-0">{STATE_LABEL[value.state] ?? humanise(value.state)}</span>}
        <IconChevron className="h-4 w-4 shrink-0 rotate-90 text-ink-400" />
      </button>
      {open && (
        <div className="card absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden p-0 shadow-lift">
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-2">
            <IconSearch className="h-4 w-4 text-ink-400" />
            <input autoFocus className="w-full bg-transparent text-sm outline-none" value={term}
              onChange={(e) => setTerm(e.target.value)} placeholder="Search…" />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && <p className="px-3 py-3 text-sm text-ink-500">Nothing matches “{term}”.</p>}
            {groups.map(([g, list]) => (
              <div key={g}>
                <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-ink-400">{g} · {list.length}</p>
                {list.map((i) => {
                  const r = render(i);
                  const blocked = i.state !== 'AVAILABLE' && !canOverride;
                  return (
                    <button key={i.id} type="button" disabled={blocked}
                      onClick={() => { onPick(i); setOpen(false); setTerm(''); }}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left ${blocked ? 'cursor-not-allowed opacity-50' : 'hover:bg-brand-50'} ${value?.id === i.id ? 'bg-brand-50' : ''}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink-900">{r.title}</span>
                        <span className="block truncate text-xs text-ink-500">{r.sub}</span>
                        {i.state !== 'AVAILABLE' && r.reasons?.length ? (
                          <span className="block truncate text-xs text-warn-700">{r.reasons.join(' · ')}</span>
                        ) : null}
                      </span>
                      <span className={`shrink-0 text-[11px] font-semibold ${i.state === 'AVAILABLE' ? 'text-ok-700' : 'text-warn-700'}`}>
                        {STATE_LABEL[i.state] ?? humanise(i.state)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssignPicker({
  trip, value, onChange, onCheck, disabled, canOverride = false, allowOutside = true,
}: {
  trip: AssignTrip; value: AssignValue; onChange: (v: AssignValue) => void;
  onCheck?: (c: AssignCheck) => void; disabled?: boolean; canOverride?: boolean; allowOutside?: boolean;
}) {
  const [opts, setOpts] = useState<{ vehicles: any[]; drivers: any[]; window: any; categoryId: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState('');

  const key = JSON.stringify([trip.bookingId, trip.date, trip.dateTo, trip.time, trip.tripType, trip.categoryId]);
  useEffect(() => {
    if (!trip.bookingId && !trip.date) return;
    setLoading(true);
    const t = setTimeout(() => {
      api.get('/fleet/assign-options', {
        params: {
          bookingId: trip.bookingId || undefined, date: trip.date || undefined, dateTo: trip.dateTo || undefined,
          time: trip.time || undefined, tripType: trip.tripType || undefined, categoryId: trip.categoryId || undefined,
        },
      })
        .then((r) => { setOpts(r.data); setFailed(''); })
        .catch(() => setFailed('Could not load the fleet — type the vehicle and driver by hand.'))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const vehicles = opts?.vehicles ?? [];
  const drivers = opts?.drivers ?? [];
  const vehicle = vehicles.find((v) => v.id === value.vehicleId) ?? null;
  const driver = drivers.find((d) => d.id === value.driverId) ?? null;
  const regular = vehicle?.regular_driver_id ? drivers.find((d) => d.id === vehicle.regular_driver_id) : null;

  useEffect(() => {
    if (!onCheck) return;
    const reasons = [
      ...(vehicle && vehicle.state !== 'AVAILABLE' ? vehicle.reasons.map((r: string) => `${vehicle.vehicle_number}: ${r}`) : []),
      ...(driver && driver.state !== 'AVAILABLE' ? driver.reasons.map((r: string) => `${driver.full_name}: ${r}`) : []),
    ];
    onCheck({ needsOverride: reasons.length > 0, reasons, vehicle, driver, window: opts?.window ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, vehicle?.state, driver?.id, driver?.state, opts]);

  const pickVehicle = (v: any) => {
    const next: AssignValue = {
      ...value, vehicleId: v.id, vehicleNumber: v.vehicle_number, outsideVehicle: false,
      vehicleLabel: [v.category_name, v.model].filter(Boolean).join(' · '),
    };
    // The regular driver comes with the car, when they are free and nobody is chosen yet.
    const reg = v.regular_driver_id ? drivers.find((d) => d.id === v.regular_driver_id) : null;
    if (reg && reg.state === 'AVAILABLE' && !value.driverId && !value.driverName) {
      Object.assign(next, { driverId: reg.id, driverName: reg.full_name, driverMobile: reg.mobile, outsideDriver: false });
    }
    onChange(next);
  };
  const pickDriver = (d: any) => onChange({ ...value, driverId: d.id, driverName: d.full_name, driverMobile: d.mobile, outsideDriver: false });

  const catId = opts?.categoryId ?? trip.categoryId ?? null;
  const vehicleGroup = (v: any) => v.state !== 'AVAILABLE' ? 'Not available for this trip'
    : !catId || v.category_id === catId ? (catId ? 'Available · booked category' : 'Available') : 'Available · other categories';
  const groupOrder = (g: string) => (g.startsWith('Available · booked') || g === 'Available' ? 0 : g.startsWith('Available') ? 1 : 2);
  const sortedVehicles = [...vehicles].sort((a, b) => groupOrder(vehicleGroup(a)) - groupOrder(vehicleGroup(b)));
  const driverGroup = (d: any) => d.state !== 'AVAILABLE' ? 'Not available for this trip'
    : vehicle && d.id === vehicle.regular_driver_id ? 'Regular driver of this vehicle' : 'Available';
  const dOrder = (g: string) => (g.startsWith('Regular') ? 0 : g === 'Available' ? 1 : 2);
  const sortedDrivers = [...drivers].sort((a, b) => dOrder(driverGroup(a)) - dOrder(driverGroup(b)));

  const windowText = opts?.window ? (opts.window.allDay ? `${opts.window.start.slice(0, 10)} (all day)` : `${opts.window.start} – ${opts.window.end.slice(11)}`) : '';

  return (
    <div className="space-y-4">
      {(loading || failed || windowText) && (
        <p className="flex items-center gap-2 text-xs text-ink-500">
          {loading && <Spinner className="h-3.5 w-3.5" />}
          {failed || (windowText && `Availability checked for ${windowText}.`)}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          {value.outsideVehicle ? (
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-ink-700">Outside vehicle</span>
              <input className="input font-mono uppercase" value={value.vehicleNumber} disabled={disabled}
                onChange={(e) => onChange({ ...value, vehicleId: null, vehicleNumber: e.target.value.toUpperCase() })}
                placeholder="Registration, e.g. MH04LQ1748" />
            </div>
          ) : (
            <Combo label="Vehicle" placeholder="Search by number, model or category" items={sortedVehicles} value={vehicle}
              onPick={pickVehicle} disabled={disabled} canOverride={canOverride} groupOf={vehicleGroup}
              icon={<IconCar className="h-4 w-4" />}
              search={(v) => [v.vehicle_number, v.make, v.model, v.category_name, v.regular_driver_name, v.vendor_name].join(' ')}
              render={(v) => ({
                title: `${v.vehicle_number} · ${v.category_name ?? ''}`,
                sub: [v.model || v.make, v.seating ? `${v.seating} seats` : '', humanise(v.ownership_type === 'PARTNER' ? 'HIRED' : v.ownership_type),
                  v.regular_driver_name ? `Driver ${v.regular_driver_name}` : ''].filter(Boolean).join(' · '),
                reasons: v.reasons,
              })} />
          )}
          {allowOutside && !disabled && (
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline"
              onClick={() => onChange({ ...value, outsideVehicle: !value.outsideVehicle, vehicleId: null, vehicleNumber: '' })}>
              {value.outsideVehicle ? 'Pick from the fleet instead' : 'Vehicle not on the fleet list? Type it'}
            </button>
          )}
          {vehicle && vehicle.categoryMatch === false && (
            <p className="flex items-center gap-1.5 text-xs text-warn-700"><IconWarning className="h-3.5 w-3.5" /> Different category from the one booked.</p>
          )}
        </div>

        <div className="space-y-2">
          {value.outsideDriver ? (
            <div className="grid grid-cols-2 gap-2">
              <span className="col-span-2 block text-xs font-semibold text-ink-700">Outside driver</span>
              <input className="input" value={value.driverName} disabled={disabled} placeholder="Full name"
                onChange={(e) => onChange({ ...value, driverId: null, driverName: e.target.value })} />
              <input className="input" value={value.driverMobile} disabled={disabled} placeholder="Mobile" inputMode="numeric" maxLength={13}
                onChange={(e) => onChange({ ...value, driverId: null, driverMobile: e.target.value })} />
            </div>
          ) : (
            <Combo label="Driver" placeholder="Search by name or mobile" items={sortedDrivers} value={driver}
              onPick={pickDriver} disabled={disabled} canOverride={canOverride} groupOf={driverGroup}
              icon={<IconSteering className="h-4 w-4" />}
              search={(d) => [d.full_name, d.mobile, d.regular_vehicle_number, d.vendor_name].join(' ')}
              render={(d) => ({
                title: d.full_name,
                sub: [d.mobile, d.regular_vehicle_number ? `Usually ${d.regular_vehicle_number}` : '', humanise(d.association_type),
                  d.clashes?.[0] ? `On ${d.clashes[0].tripId}` : ''].filter(Boolean).join(' · '),
                reasons: d.reasons,
              })} />
          )}
          {allowOutside && !disabled && (
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline"
              onClick={() => onChange({ ...value, outsideDriver: !value.outsideDriver, driverId: null, driverName: '', driverMobile: '' })}>
              {value.outsideDriver ? 'Pick from the roster instead' : 'Driver not on the roster? Type it'}
            </button>
          )}
          {regular && driver?.id !== regular.id && !value.outsideDriver && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-600">
              Regular driver: <strong className="text-ink-800">{regular.full_name}</strong>
              <span className={regular.state === 'AVAILABLE' ? 'text-ok-700' : 'text-warn-700'}>({STATE_LABEL[regular.state] ?? humanise(regular.state)})</span>
              {(regular.state === 'AVAILABLE' || canOverride) && !disabled && (
                <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => pickDriver(regular)}>Use</button>
              )}
            </p>
          )}
        </div>
      </div>

      {(vehicle || driver) && (
        <div className="grid gap-2 rounded-xl border border-ink-100 bg-ink-50/60 p-3 text-xs sm:grid-cols-2">
          {vehicle && (
            <p className="flex items-start gap-1.5">
              {vehicle.state === 'AVAILABLE' ? <IconCheck className="mt-0.5 h-3.5 w-3.5 text-ok-600" /> : <IconWarning className="mt-0.5 h-3.5 w-3.5 text-warn-600" />}
              <span><strong>{vehicle.vehicle_number}</strong> — {vehicle.state === 'AVAILABLE' ? 'free for this trip' : vehicle.reasons.join('; ')}</span>
            </p>
          )}
          {driver && (
            <p className="flex items-start gap-1.5">
              {driver.state === 'AVAILABLE' ? <IconCheck className="mt-0.5 h-3.5 w-3.5 text-ok-600" /> : <IconWarning className="mt-0.5 h-3.5 w-3.5 text-warn-600" />}
              <span><strong>{driver.full_name}</strong> — {driver.state === 'AVAILABLE' ? 'free for this trip' : driver.reasons.join('; ')}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
