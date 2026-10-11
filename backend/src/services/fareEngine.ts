/**
 * The fare engine — one calculation for quotations, trips, bookings and invoices.
 *
 * A fare rule is a row of the rate master (`rate_cards`): what one vendor (or,
 * for walk-in customers, the reserved DIRECT record) pays for one vehicle
 * category on one plan. This turns a rule plus what actually happened on the
 * trip — kilometres, hours, days, nights, waiting, tolls — into the charge
 * lines `computeCharges` taxes and totals. Nothing else in the portal prices a
 * trip from a rule, so a quotation and the invoice that follows it can never
 * disagree about the arithmetic.
 *
 * The result always says which rule was used and shows every step, and the
 * caller stores a copy of the rule with the fare (booking_charges.fare_snapshot)
 * so a later change to the rate master never re-prices a confirmed trip.
 */
import { q } from '../db';
import { computeCharges, round2, type ChargeResult, type TaxMode } from './billing';

export interface FareRule {
  id: number;
  vendor_id: number;
  vendor_name?: string;
  vehicle_category: string;
  category_id: number | null;
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
  min_daily_charge: number;
  night_charge: number;
  waiting_rate: number;
  free_waiting_minutes: number;
  toll_included: number;
  parking_included: number;
  state_tax: number;
  other_charge: number;
  other_charge_label: string | null;
  discount_percent: number;
  tax_mode: string | null;
  tax_rate: number | null;
  effective_from: string | null;
  effective_to: string | null;
  is_active: number;
}

export interface FareRequest {
  /** Total kilometres driven (or, with roundTrip and oneWayKm, worked out from the one-way distance). */
  distanceKm?: number;
  /** One-way distance; doubled for a round trip when distanceKm is not given. */
  oneWayKm?: number;
  roundTrip?: boolean;
  /** Total hours the vehicle was used (LOCAL). */
  hours?: number;
  /** Calendar days out (OUTSTATION). */
  days?: number;
  /** Nights for which a night charge applies. */
  nights?: number;
  /** Minutes the vehicle waited (AIRPORT / transfers). */
  waitingMinutes?: number;
  toll?: number;
  parking?: number;
  /** State / border tax at actuals. When omitted the rule's own figure is used. */
  stateTax?: number;
  permit?: number;
  otherCharges?: number;
  otherChargesNote?: string;
  /** Flat discount in rupees, on top of any percentage the rule carries. */
  discount?: number;
  advance?: number;
  taxMode?: TaxMode;
  taxRate?: number;
  tollParkingTaxable?: boolean;
}

export interface FareLine { label: string; detail?: string; amount: number; kind: 'fare' | 'extra' | 'allowance' | 'reimbursable' | 'discount' }

export interface FareQuote {
  rule: { id: number; label: string; vendorName?: string; planType: string; vehicleCategory: string };
  lines: FareLine[];
  notes: string[];
  /** The input for computeCharges / booking_charges. */
  charges: {
    baseFare: number; extraKm: number; extraKmRate: number; extraHours: number; extraHourRate: number;
    driverAllowance: number; nightCharge: number; waitingCharge: number; permit: number;
    otherCharges: number; otherChargesNote: string; discount: number;
    toll: number; parking: number; stateTax: number; advance: number;
    taxMode: TaxMode; taxRate: number; tollParkingTaxable: boolean;
  };
  totals: ChargeResult;
  /** JSON stored with the fare so it never changes if the rule does. */
  snapshot: string;
}

const pos = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export class FareError extends Error {
  status = 400;
}

/** Load one rule, with its vendor's tax defaults. */
export function loadRule(id: number): (FareRule & { vendor_tax_mode: string; vendor_tax_rate: number; vendor_toll_taxable: number }) | undefined {
  return q.get<any>(
    `SELECT r.*, v.vendor_name, v.tax_mode AS vendor_tax_mode, v.tax_rate AS vendor_tax_rate,
            v.toll_parking_taxable AS vendor_toll_taxable
       FROM rate_cards r JOIN vendors v ON v.id = r.vendor_id WHERE r.id = @id`,
    { id }
  );
}

/** Is a rule usable on a given date? Returns the reason when it is not. */
export function ruleProblem(rule: FareRule, onDate?: string): string | null {
  if (!rule.is_active) return `The ${rule.vehicle_category} ${rule.plan_label} rule is inactive.`;
  const d = onDate || new Date().toISOString().slice(0, 10);
  if (rule.effective_from && d < rule.effective_from) return `The ${rule.plan_label} rule only applies from ${rule.effective_from}.`;
  if (rule.effective_to && d > rule.effective_to) return `The ${rule.plan_label} rule ended on ${rule.effective_to}.`;
  return null;
}

/**
 * Candidate rules for a trip: the vendor's own active rules for the category
 * and plan type, effective on the travel date. Falls back to the DIRECT
 * (walk-in) price list when the vendor has none for that category.
 */
export function candidateRules(opts: { vendorId?: number; categoryId?: number | null; vehicleText?: string; planType?: string; onDate?: string }) {
  const onDate = opts.onDate || new Date().toISOString().slice(0, 10);
  const rows = q.all<any>(
    `SELECT r.*, v.vendor_name, v.code AS vendor_code
       FROM rate_cards r JOIN vendors v ON v.id = r.vendor_id
      WHERE r.is_active = 1
        AND (@vendorId = 0 OR r.vendor_id = @vendorId)
        AND (@planType = '' OR r.plan_type = @planType)
        AND (r.effective_from IS NULL OR r.effective_from = '' OR r.effective_from <= @d)
        AND (r.effective_to IS NULL OR r.effective_to = '' OR r.effective_to >= @d)
      ORDER BY r.display_order, r.vehicle_category, r.plan_label`,
    { vendorId: opts.vendorId ?? 0, planType: opts.planType ?? '', d: onDate }
  );
  const text = String(opts.vehicleText ?? '').toLowerCase();
  const matches = rows.filter((r) =>
    (opts.categoryId && r.category_id === opts.categoryId) ||
    (!opts.categoryId && text && (text.includes(String(r.vehicle_category).toLowerCase()) ||
      String(r.vehicle_category).toLowerCase().includes(text)))
  );
  return { matches, all: rows };
}

/** Price a trip from a rule. Throws FareError with a plain-language reason on bad input. */
export function quoteFare(rule: FareRule & { vendor_tax_mode?: string; vendor_tax_rate?: number; vendor_toll_taxable?: number }, req: FareRequest, onDate?: string): FareQuote {
  const problem = ruleProblem(rule, onDate);
  if (problem) throw new FareError(problem);

  const lines: FareLine[] = [];
  const notes: string[] = [];

  let baseFare = 0;
  let extraKm = 0, extraKmRate = 0, extraHours = 0, extraHourRate = 0;
  let driverAllowance = 0, nightCharge = 0, waitingCharge = 0;

  const km = pos(req.distanceKm) || (req.roundTrip ? pos(req.oneWayKm) * 2 : pos(req.oneWayKm));
  if (req.roundTrip && !pos(req.distanceKm) && pos(req.oneWayKm)) {
    notes.push(`Round trip: ${pos(req.oneWayKm)} km each way, ${km} km in all.`);
  }

  if (rule.plan_type === 'OUTSTATION') {
    if (!(rule.per_km_rate > 0)) throw new FareError(`The ${rule.plan_label} rule has no per-kilometre rate.`);
    const days = Math.max(1, Math.round(pos(req.days) || 1));
    const floor = pos(rule.min_km_per_day) * days;
    if (!km && !floor) throw new FareError('Enter the distance in kilometres for an outstation trip.');
    const billedKm = Math.max(km, floor);
    let kmCharge = round2(billedKm * rule.per_km_rate);
    lines.push({
      label: `${billedKm} km × ₹${rule.per_km_rate}/km`, kind: 'fare', amount: kmCharge,
      detail: floor ? `Minimum ${rule.min_km_per_day} km a day${days > 1 ? ` × ${days} days` : ''}` : undefined,
    });
    if (km && km < floor) notes.push(`${km} km is below the daily minimum, so ${billedKm} km is charged.`);
    const minDaily = pos(rule.min_daily_charge) * days;
    if (minDaily > kmCharge) {
      lines.push({ label: 'Minimum daily charge top-up', kind: 'fare', amount: round2(minDaily - kmCharge),
        detail: `₹${rule.min_daily_charge} a day × ${days}` });
      notes.push(`The minimum daily charge of ₹${rule.min_daily_charge} applies.`);
      kmCharge = minDaily;
    }
    baseFare = round2(kmCharge);
    if (rule.driver_allowance > 0) {
      driverAllowance = round2(days * rule.driver_allowance);
      lines.push({ label: 'Driver allowance', detail: `${days} day${days > 1 ? 's' : ''} × ₹${rule.driver_allowance}`, kind: 'allowance', amount: driverAllowance });
    }
  } else {
    if (!(rule.base_fare > 0)) throw new FareError(`The ${rule.plan_label} rule has no base fare.`);
    baseFare = round2(rule.base_fare);
    lines.push({
      label: `${rule.plan_label} — ${rule.vehicle_category}`, kind: 'fare', amount: baseFare,
      detail: rule.plan_type === 'LOCAL' && (rule.included_hours || rule.included_km)
        ? `${rule.included_hours} hrs / ${rule.included_km} km included` : undefined,
    });

    if (km && rule.included_km > 0 && km > rule.included_km) {
      extraKm = round2(km - rule.included_km);
      extraKmRate = rule.extra_km_rate;
      if (extraKmRate > 0) {
        lines.push({ label: 'Extra kilometres', detail: `${extraKm} km × ₹${extraKmRate}`, kind: 'extra', amount: round2(extraKm * extraKmRate) });
      } else {
        notes.push(`${extraKm} km beyond the package, but the rule has no extra-km rate.`);
      }
    }
    const hours = pos(req.hours);
    if (hours && rule.included_hours > 0 && hours > rule.included_hours) {
      // Part hours are charged as a full hour, as on the duty slips.
      extraHours = Math.ceil(hours - rule.included_hours);
      extraHourRate = rule.extra_hour_rate;
      if (extraHourRate > 0) {
        lines.push({ label: 'Extra hours', detail: `${extraHours} hr × ₹${extraHourRate}`, kind: 'extra', amount: round2(extraHours * extraHourRate) });
      } else {
        notes.push(`${extraHours} hr beyond the package, but the rule has no extra-hour rate.`);
      }
    }
    const waited = pos(req.waitingMinutes) - pos(rule.free_waiting_minutes);
    if (waited > 0 && rule.waiting_rate > 0) {
      const hrs = Math.ceil(waited / 30) / 2;   // billed in half hours
      waitingCharge = round2(hrs * rule.waiting_rate);
      lines.push({ label: 'Waiting', detail: `${hrs} hr beyond ${rule.free_waiting_minutes} free min × ₹${rule.waiting_rate}/hr`, kind: 'extra', amount: waitingCharge });
    }
    if (req.roundTrip && rule.plan_type === 'AIRPORT') notes.push('An airport rule is one way; price the return as a second trip.');
  }

  const nights = pos(req.nights);
  if (nights && rule.night_charge > 0) {
    nightCharge = round2(nights * rule.night_charge);
    lines.push({ label: 'Night charge', detail: `${nights} × ₹${rule.night_charge}`, kind: 'allowance', amount: nightCharge });
  }

  const otherCharges = round2(pos(rule.other_charge) + pos(req.otherCharges));
  if (pos(rule.other_charge)) {
    lines.push({ label: rule.other_charge_label || 'Other charge', kind: 'extra', amount: round2(pos(rule.other_charge)) });
  }
  if (pos(req.otherCharges)) {
    lines.push({ label: req.otherChargesNote || 'Other charges', kind: 'extra', amount: round2(pos(req.otherCharges)) });
  }
  const permit = round2(pos(req.permit));
  if (permit) lines.push({ label: 'Permit', kind: 'extra', amount: permit });

  // Percentage discount is on the fare and its extras, never on reimbursables.
  const discountable = baseFare + round2(extraKm * extraKmRate) + round2(extraHours * extraHourRate)
    + driverAllowance + nightCharge + waitingCharge + otherCharges + permit;
  const pctDiscount = round2((discountable * pos(rule.discount_percent)) / 100);
  const discount = round2(pctDiscount + pos(req.discount));
  if (pctDiscount) lines.push({ label: `Discount ${rule.discount_percent}%`, kind: 'discount', amount: -pctDiscount });
  if (pos(req.discount)) lines.push({ label: 'Discount', kind: 'discount', amount: -round2(pos(req.discount)) });

  const toll = rule.toll_included ? 0 : round2(pos(req.toll));
  const parking = rule.parking_included ? 0 : round2(pos(req.parking));
  const stateTax = round2(req.stateTax !== undefined ? pos(req.stateTax) : pos(rule.state_tax));
  if (rule.toll_included && pos(req.toll)) notes.push('Toll is included in this rule, so the toll entered is not added.');
  if (rule.parking_included && pos(req.parking)) notes.push('Parking is included in this rule, so the parking entered is not added.');
  if (toll) lines.push({ label: 'Toll (at actuals)', kind: 'reimbursable', amount: toll });
  if (parking) lines.push({ label: 'Parking (at actuals)', kind: 'reimbursable', amount: parking });
  if (stateTax) lines.push({ label: 'State tax (at actuals)', kind: 'reimbursable', amount: stateTax });

  const taxMode = (req.taxMode ?? (rule.tax_mode as TaxMode) ?? (rule.vendor_tax_mode as TaxMode) ?? 'IGST') as TaxMode;
  const taxRate = taxMode === 'NONE' ? 0 : Number(req.taxRate ?? rule.tax_rate ?? rule.vendor_tax_rate ?? 5);
  const tollParkingTaxable = req.tollParkingTaxable ?? !!rule.vendor_toll_taxable;

  const charges = {
    baseFare, extraKm, extraKmRate, extraHours, extraHourRate,
    driverAllowance, nightCharge, waitingCharge, permit,
    otherCharges, otherChargesNote: [rule.other_charge_label, req.otherChargesNote].filter(Boolean).join(', '),
    discount, toll, parking, stateTax, advance: round2(pos(req.advance)),
    taxMode, taxRate, tollParkingTaxable,
  };
  const totals = computeCharges(charges);

  const snapshot = JSON.stringify({
    calculatedAt: new Date().toISOString(),
    rule: {
      id: rule.id, vendor: rule.vendor_name, vehicleCategory: rule.vehicle_category, planType: rule.plan_type,
      planLabel: rule.plan_label, includedHours: rule.included_hours, includedKm: rule.included_km,
      baseFare: rule.base_fare, extraHourRate: rule.extra_hour_rate, extraKmRate: rule.extra_km_rate,
      perKmRate: rule.per_km_rate, minKmPerDay: rule.min_km_per_day, driverAllowance: rule.driver_allowance,
      minDailyCharge: rule.min_daily_charge, nightCharge: rule.night_charge, waitingRate: rule.waiting_rate,
      freeWaitingMinutes: rule.free_waiting_minutes, tollIncluded: !!rule.toll_included,
      parkingIncluded: !!rule.parking_included, stateTax: rule.state_tax, otherCharge: rule.other_charge,
      discountPercent: rule.discount_percent, effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to,
    },
    inputs: req,
    lines,
    notes,
  });

  return {
    rule: { id: rule.id, label: `${rule.vehicle_category} · ${rule.plan_label}`, vendorName: rule.vendor_name, planType: rule.plan_type, vehicleCategory: rule.vehicle_category },
    lines, notes, charges, totals, snapshot,
  };
}
