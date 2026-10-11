/**
 * Writing a booking's charges — one place for every screen.
 *
 * The booking form, the trip drawer and the fare calculator all save the same
 * `booking_charges` row. They used to carry four copies of the same INSERT,
 * which is how a column added to one silently went missing from another. The
 * maths is `computeCharges` (services/billing.ts); this is only the storage.
 */
import { q } from '../db';
import { computeCharges, type ChargeInput, type ChargeResult } from './billing';

export interface StoredChargeInput extends ChargeInput {
  otherChargesNote?: string;
  /** The fare rule (rate card) the figures were calculated from, if any. */
  fareRuleId?: number | null;
  /** JSON copy of that rule and the inputs, as they stood when the fare was set. */
  fareSnapshot?: string | null;
}

/**
 * Fill in what a caller did not send from what is already stored.
 *
 * The older booking form knows nothing about waiting charges, state tax or the
 * fare rule, so a save from it must not quietly zero them. Only fields left
 * `undefined` are filled; an explicit 0 from the caller still wins.
 */
export function withStoredExtras(bookingId: number | null, input: StoredChargeInput): StoredChargeInput {
  if (!bookingId) return input;
  const row = q.get<any>(
    'SELECT waiting_charge, state_tax, fare_rule_id, fare_snapshot FROM booking_charges WHERE booking_id = @id',
    { id: bookingId }
  );
  if (!row) return input;
  return {
    ...input,
    waitingCharge: input.waitingCharge ?? Number(row.waiting_charge ?? 0),
    stateTax: input.stateTax ?? Number(row.state_tax ?? 0),
    fareRuleId: input.fareRuleId === undefined ? row.fare_rule_id : input.fareRuleId,
    fareSnapshot: input.fareSnapshot === undefined ? row.fare_snapshot : input.fareSnapshot,
  };
}

/** Upsert the charges row from an input and its computed result. */
export function writeCharges(bookingId: number, input: StoredChargeInput, c: ChargeResult): void {
  q.run(
    `INSERT INTO booking_charges (booking_id, base_fare, extra_km, extra_km_rate, extra_hours,
        extra_hour_rate, toll, parking, driver_allowance, permit, night_charge, other_charges,
        other_charges_note, discount, waiting_charge, state_tax, taxable_amount, tax_mode, tax_rate,
        cgst, sgst, igst, tax_amount, non_taxable_amount, total_amount, advance, balance,
        fare_rule_id, fare_snapshot)
     VALUES (@id, @baseFare, @extraKm, @extraKmRate, @extraHours, @extraHourRate, @toll, @parking,
        @driverAllowance, @permit, @nightCharge, @otherCharges, @note, @discount, @waiting, @stateTax,
        @taxable, @taxMode, @taxRate, @cgst, @sgst, @igst, @tax, @nonTaxable, @total, @advance, @balance,
        @ruleId, @snapshot)
     ON CONFLICT(booking_id) DO UPDATE SET
        base_fare=@baseFare, extra_km=@extraKm, extra_km_rate=@extraKmRate, extra_hours=@extraHours,
        extra_hour_rate=@extraHourRate, toll=@toll, parking=@parking, driver_allowance=@driverAllowance,
        permit=@permit, night_charge=@nightCharge, other_charges=@otherCharges, other_charges_note=@note,
        discount=@discount, waiting_charge=@waiting, state_tax=@stateTax,
        taxable_amount=@taxable, tax_mode=@taxMode, tax_rate=@taxRate,
        cgst=@cgst, sgst=@sgst, igst=@igst, tax_amount=@tax, non_taxable_amount=@nonTaxable,
        total_amount=@total, advance=@advance, balance=@balance,
        fare_rule_id=@ruleId, fare_snapshot=@snapshot, updated_at=datetime('now')`,
    {
      id: bookingId,
      baseFare: c.baseFare,
      extraKm: Number(input.extraKm ?? 0), extraKmRate: Number(input.extraKmRate ?? 0),
      extraHours: Number(input.extraHours ?? 0), extraHourRate: Number(input.extraHourRate ?? 0),
      toll: Number(input.toll ?? 0), parking: Number(input.parking ?? 0),
      driverAllowance: c.driverAllowance, permit: c.permit, nightCharge: c.nightCharge,
      otherCharges: c.otherCharges, note: input.otherChargesNote ?? '', discount: c.discount,
      waiting: c.waitingCharge, stateTax: c.stateTax,
      taxable: c.taxableAmount, taxMode: c.taxMode, taxRate: c.taxRate,
      cgst: c.cgst, sgst: c.sgst, igst: c.igst, tax: c.taxAmount,
      nonTaxable: c.nonTaxableAmount, total: c.totalAmount, advance: c.advance, balance: c.balance,
      ruleId: input.fareRuleId ?? null, snapshot: input.fareSnapshot ?? null,
    }
  );
}

/** Compute and store in one step. Returns the computed figures. */
export function saveCharges(bookingId: number, input: StoredChargeInput): ChargeResult {
  const merged = withStoredExtras(bookingId, input);
  const c = computeCharges(merged);
  writeCharges(bookingId, merged, c);
  return c;
}

/** The stored charges as the input they came from — for re-pricing with a different tax treatment. */
export function storedChargeInput(row: any): StoredChargeInput {
  return {
    baseFare: row.base_fare, extraKm: row.extra_km, extraKmRate: row.extra_km_rate,
    extraHours: row.extra_hours, extraHourRate: row.extra_hour_rate,
    toll: row.toll, parking: row.parking, driverAllowance: row.driver_allowance,
    permit: row.permit, nightCharge: row.night_charge, otherCharges: row.other_charges,
    otherChargesNote: row.other_charges_note ?? '',
    waitingCharge: row.waiting_charge ?? 0, stateTax: row.state_tax ?? 0,
    discount: row.discount, advance: row.advance,
    taxMode: row.tax_mode, taxRate: row.tax_rate,
    fareRuleId: row.fare_rule_id ?? null, fareSnapshot: row.fare_snapshot ?? null,
  };
}
