/**
 * Fleet scheduling — when a vehicle or driver is busy, and what clashes.
 *
 * A trip occupies a time window. Where the booking says when it starts and
 * how long it runs, that is used; otherwise the window is the conservative
 * one for its kind of trip (an outstation day blocks the whole day, an airport
 * run a few hours). Two windows for the same vehicle, or the same driver, that
 * overlap are a clash — the second allotment is refused unless somebody
 * overrides it on purpose and says why.
 */
import { q } from '../db';

/** Trips that still hold their vehicle and driver. */
const LIVE = `('CONFIRMED','ASSIGNED','ONTRIP')`;

export interface Window { start: string; end: string; allDay: boolean }

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Default length of a trip, in hours, when the booking does not say. */
function defaultHours(tripType: string | null | undefined, includedHours?: number): number | null {
  switch (String(tripType ?? '').toUpperCase()) {
    case 'AIRPORT':
    case 'TRANSFER': return 4;
    case 'LOCAL': return Math.max(4, Number(includedHours) || 8) + 1;   // + an hour to get back
    default: return null;                                                // whole day(s)
  }
}

/** The window a booking occupies, in local wall-clock time. */
export function tripWindow(b: {
  travel_date: string; travel_date_to?: string | null; reporting_time?: string | null;
  trip_type?: string | null; trip_duration_hrs?: number | null; included_hours?: number;
}): Window {
  const day = String(b.travel_date ?? '').slice(0, 10);
  const lastDay = b.travel_date_to && b.travel_date_to > day ? b.travel_date_to.slice(0, 10) : day;
  const time = /^\d{1,2}:\d{2}$/.test(String(b.reporting_time ?? '').trim()) ? String(b.reporting_time).trim() : '';

  if (lastDay !== day) {
    return { start: `${day} ${time ? time.padStart(5, '0') : '00:00'}`, end: `${lastDay} 23:59`, allDay: !time };
  }
  const hours = Number(b.trip_duration_hrs) > 0 ? Number(b.trip_duration_hrs) : defaultHours(b.trip_type, b.included_hours);
  if (!time || hours == null) return { start: `${day} ${time ? time.padStart(5, '0') : '00:00'}`, end: `${day} 23:59`, allDay: !time || hours == null };

  const [h, m] = time.split(':').map(Number);
  const start = new Date(`${day}T${pad(h)}:${pad(m)}:00`);
  const end = new Date(start.getTime() + hours * 3600_000);
  return { start: fmt(start), end: fmt(end), allDay: false };
}

const overlaps = (a: Window, b: Window) => a.start < b.end && b.start < a.end;

export interface Clash {
  bookingId: number; tripId: string | null; bookingCode: string; travelDate: string;
  reportingTime: string | null; customer: string | null; status: string;
  resource: 'vehicle' | 'driver'; window: Window;
}

/**
 * Other live trips that would be using the same vehicle or the same driver at
 * the same time as `bookingId`.
 */
export function findClashes(opts: {
  bookingId: number;
  vehicleId?: number | null; vehicleNumber?: string | null;
  driverId?: number | null; driverMobile?: string | null;
}): Clash[] {
  const me = q.get<any>('SELECT * FROM bookings WHERE id = @id', { id: opts.bookingId });
  if (!me) return [];
  const mine = tripWindow(me);
  const vno = String(opts.vehicleNumber ?? '').toUpperCase().replace(/\s+/g, '');
  const dmob = String(opts.driverMobile ?? '').replace(/\D/g, '').slice(-10);

  // Candidates: any live trip within a few days either side that shares the
  // vehicle or the driver. The exact overlap is then checked in code.
  const rows = q.all<any>(
    `SELECT b.id, b.trip_id, b.booking_code, b.travel_date, b.travel_date_to, b.reporting_time, b.trip_type,
            b.trip_duration_hrs, b.booking_status, b.vehicle_id, b.vehicle_number, b.driver_id, b.driver_mobile,
            COALESCE(b.customer_name, b.passenger_name) AS customer
       FROM bookings b
      WHERE b.id <> @id AND b.booking_status IN ${LIVE}
        AND b.travel_date <= date(@last, '+1 day') AND COALESCE(b.travel_date_to, b.travel_date) >= date(@first, '-1 day')
        AND (
          (@vid IS NOT NULL AND b.vehicle_id = @vid) OR
          (@vno <> '' AND replace(upper(b.vehicle_number),' ','') = @vno) OR
          (@did IS NOT NULL AND b.driver_id = @did) OR
          (@dmob <> '' AND substr(replace(b.driver_mobile,' ',''), -10) = @dmob)
        )`,
    {
      id: opts.bookingId, first: mine.start.slice(0, 10), last: mine.end.slice(0, 10),
      vid: opts.vehicleId ?? null, vno, did: opts.driverId ?? null, dmob,
    }
  );

  const clashes: Clash[] = [];
  for (const r of rows) {
    const w = tripWindow(r);
    if (!overlaps(mine, w)) continue;
    const sameVehicle = (opts.vehicleId && r.vehicle_id === opts.vehicleId)
      || (vno && String(r.vehicle_number ?? '').toUpperCase().replace(/\s+/g, '') === vno);
    const sameDriver = (opts.driverId && r.driver_id === opts.driverId)
      || (dmob && String(r.driver_mobile ?? '').replace(/\D/g, '').slice(-10) === dmob);
    const base = {
      bookingId: r.id, tripId: r.trip_id, bookingCode: r.booking_code, travelDate: r.travel_date,
      reportingTime: r.reporting_time, customer: r.customer, status: r.booking_status, window: w,
    };
    if (sameVehicle) clashes.push({ ...base, resource: 'vehicle' });
    if (sameDriver) clashes.push({ ...base, resource: 'driver' });
  }
  return clashes;
}

export function describeClash(c: Clash): string {
  const when = c.window.allDay ? `all day ${c.travelDate}` : `${c.window.start.slice(11)}–${c.window.end.slice(11)} on ${c.window.start.slice(0, 10)}`;
  return `The ${c.resource} is already on ${c.tripId ?? c.bookingCode}${c.customer ? ` (${c.customer})` : ''}, ${when}.`;
}

/* ==========================================================================
   Documents
   ========================================================================== */

export const VEHICLE_DOCS: { key: string; label: string }[] = [
  { key: 'insurance_expiry', label: 'Insurance' },
  { key: 'permit_expiry', label: 'Permit' },
  { key: 'fitness_expiry', label: 'Fitness certificate' },
  { key: 'puc_expiry', label: 'PUC' },
  { key: 'rc_expiry', label: 'Registration (RC)' },
];

export const DRIVER_DOCS: { key: string; label: string }[] = [
  { key: 'licence_expiry', label: 'Driving licence' },
  { key: 'badge_expiry', label: 'Badge' },
];

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000);

/** EXPIRED / EXPIRING (within `within` days) / OK / NONE for one date. */
export function docState(date: string | null | undefined, within = 30): { state: 'EXPIRED' | 'EXPIRING' | 'OK' | 'NONE'; days: number | null } {
  if (!date) return { state: 'NONE', days: null };
  const d = daysBetween(today(), String(date).slice(0, 10));
  if (d < 0) return { state: 'EXPIRED', days: d };
  if (d <= within) return { state: 'EXPIRING', days: d };
  return { state: 'OK', days: d };
}

/** Every vehicle and driver document that has expired or expires within `within` days. */
export function expiringDocuments(within = 30) {
  const out: any[] = [];
  for (const v of q.all<any>('SELECT id, vehicle_number, vehicle_type, model, is_active, ' +
    VEHICLE_DOCS.map((d) => d.key).join(', ') + ' FROM vehicles WHERE is_active = 1')) {
    for (const d of VEHICLE_DOCS) {
      const s = docState(v[d.key], within);
      if (s.state === 'EXPIRED' || s.state === 'EXPIRING') {
        out.push({ kind: 'vehicle', id: v.id, name: v.vehicle_number, sub: v.model || v.vehicle_type, document: d.label, date: v[d.key], ...s });
      }
    }
  }
  for (const r of q.all<any>('SELECT id, full_name, mobile, ' + DRIVER_DOCS.map((d) => d.key).join(', ') + ' FROM drivers WHERE is_active = 1')) {
    for (const d of DRIVER_DOCS) {
      const s = docState(r[d.key], within);
      if (s.state === 'EXPIRED' || s.state === 'EXPIRING') {
        out.push({ kind: 'driver', id: r.id, name: r.full_name, sub: r.mobile, document: d.label, date: r[d.key], ...s });
      }
    }
  }
  return out.sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
}

/** Document problems that should stop a vehicle or driver being sent on a trip date. */
export function blockingDocuments(kind: 'vehicle' | 'driver', row: any, onDate: string): string[] {
  const docs = kind === 'vehicle' ? VEHICLE_DOCS : DRIVER_DOCS;
  return docs
    .filter((d) => row?.[d.key] && String(row[d.key]).slice(0, 10) < onDate)
    .map((d) => `${d.label} expired on ${String(row[d.key]).slice(0, 10)}`);
}
