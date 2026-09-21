/**
 * The public fare estimate.
 *
 * There is deliberately no server-side twin of this. An estimate is never
 * stored, never invoiced and never binding — it exists so a visitor at 11pm can
 * see roughly what a trip costs instead of waiting for the office to open. The
 * numbers it works from come from the Master's walk-in rate card, so the only
 * thing living here is the arithmetic.
 *
 * Everything is quoted before toll and parking, which are reimbursements at
 * actuals and cannot be known in advance — the same split the invoices use.
 */

export interface RateOption {
  vehicle_category: string;
  plan_type: 'LOCAL' | 'AIRPORT' | 'OUTSTATION';
  plan_label: string;
  included_hours: number;
  included_km: number;
  base_fare: number;
  extra_hour_rate: number;
  extra_km_rate: number;
  per_km_rate: number;
  min_km_per_day: number;
  driver_allowance: number;
  notes?: string | null;
}

export interface FareInput {
  /** LOCAL and AIRPORT only. */
  extraHours?: number;
  extraKm?: number;
  /** OUTSTATION only. */
  distanceKm?: number;
  days?: number;
}

export interface FareLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface FareEstimate {
  lines: FareLine[];
  subtotal: number;
  taxLabel: string;
  tax: number;
  total: number;
  /** Set when the customer's own distance is below the daily minimum. */
  note?: string;
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const n = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function estimateFare(
  rate: RateOption,
  input: FareInput,
  taxMode: string,
  taxRate: number
): FareEstimate {
  const lines: FareLine[] = [];

  if (rate.plan_type === 'OUTSTATION') {
    const days = Math.max(1, Math.round(n(input.days) || 1));
    const asked = n(input.distanceKm);
    const floor = n(rate.min_km_per_day) * days;
    // The day is billed at its minimum even if the trip is shorter: the vehicle
    // is out for the day either way. Saying so beats a total that looks wrong.
    const billedKm = Math.max(asked, floor);

    lines.push({
      label: `${billedKm} km @ ${rate.per_km_rate}/km`,
      detail: days > 1 ? `${days} days` : undefined,
      amount: round2(billedKm * rate.per_km_rate),
    });

    // The allowance is per night away, so a single-day return trip has none.
    const nights = days - 1;
    if (nights > 0 && rate.driver_allowance > 0) {
      lines.push({
        label: 'Driver allowance',
        detail: `${nights} night${nights > 1 ? 's' : ''}`,
        amount: round2(nights * rate.driver_allowance),
      });
    }

    var note = asked > 0 && asked < floor
      ? `${days === 1 ? 'A day is' : 'Days are'} billed at a minimum of ${rate.min_km_per_day} km, so ${billedKm} km is used here.`
      : undefined;
  } else {
    lines.push({
      label: rate.plan_label,
      detail: rate.plan_type === 'LOCAL' && rate.included_hours
        ? `${rate.included_hours} hrs and ${rate.included_km} km included`
        : undefined,
      amount: round2(rate.base_fare),
    });

    const hours = n(input.extraHours);
    if (hours > 0 && rate.extra_hour_rate > 0) {
      lines.push({
        label: 'Extra hours',
        detail: `${hours} @ ${rate.extra_hour_rate}/hr`,
        amount: round2(hours * rate.extra_hour_rate),
      });
    }

    const km = n(input.extraKm);
    if (km > 0 && rate.extra_km_rate > 0) {
      lines.push({
        label: 'Extra kilometres',
        detail: `${km} @ ${rate.extra_km_rate}/km`,
        amount: round2(km * rate.extra_km_rate),
      });
    }
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const rate_ = taxMode === 'NONE' ? 0 : n(taxRate);
  const tax = round2((subtotal * rate_) / 100);

  return {
    lines,
    subtotal,
    taxLabel: rate_ ? `GST ${rate_}%` : 'GST',
    tax,
    total: round2(subtotal + tax),
    note: typeof note === 'undefined' ? undefined : note,
  };
}

/** Group the flat list of rates into the shape the calculator's selects need. */
export function groupRates(rates: RateOption[]) {
  const byType: Record<string, RateOption[]> = { LOCAL: [], AIRPORT: [], OUTSTATION: [] };
  for (const r of rates) (byType[r.plan_type] ??= []).push(r);

  const vehiclesFor = (type: string) =>
    [...new Set((byType[type] ?? []).map((r) => r.vehicle_category))];

  const plansFor = (type: string, vehicle: string) =>
    (byType[type] ?? []).filter((r) => r.vehicle_category === vehicle);

  return { byType, vehiclesFor, plansFor };
}
