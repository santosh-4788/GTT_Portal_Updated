/**
 * Billing calculation.
 *
 * The rule was derived from the real Wagon invoice
 * (`Gupta Tours and Wagon Local Invoice 1.xlsx`, sheet `LOCAL`):
 *
 *     Taxable Value = Basic Fare + Extra KM + Extra Hours (+ other taxable charges − discount)
 *     Tax           = Taxable Value × rate
 *     Invoice Value = Taxable Value + Tax
 *     Total         = Invoice Value + Toll & Parking        <-- reimbursables are NOT taxed
 *
 * `tollParkingTaxable` flips that last behaviour per vendor, because not every
 * vendor treats toll/parking as a pure-agent reimbursement.
 */

export type TaxMode = 'IGST' | 'CGST_SGST' | 'NONE';

export interface ChargeInput {
  baseFare?: number;
  extraKm?: number;
  extraKmRate?: number;
  extraHours?: number;
  extraHourRate?: number;
  toll?: number;
  parking?: number;
  driverAllowance?: number;
  permit?: number;
  nightCharge?: number;
  otherCharges?: number;
  /** Waiting beyond the free allowance. Taxable, like the fare itself. */
  waitingCharge?: number;
  /** State / border entry tax, charged at actuals alongside toll and parking. */
  stateTax?: number;
  discount?: number;
  taxMode?: TaxMode | string;
  taxRate?: number;
  tollParkingTaxable?: boolean;
  advance?: number;
}

export interface ChargeResult {
  baseFare: number;
  extraKmAmount: number;
  extraHoursAmount: number;
  tollParking: number;
  driverAllowance: number;
  permit: number;
  nightCharge: number;
  otherCharges: number;
  waitingCharge: number;
  stateTax: number;
  /** Toll + parking + state tax: the reimbursables. */
  reimbursables: number;
  discount: number;
  taxableAmount: number;
  taxMode: TaxMode;
  taxRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  taxAmount: number;
  nonTaxableAmount: number;
  invoiceValue: number;
  totalAmount: number;
  advance: number;
  balance: number;
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(x) ? x : 0;
};

/** Round to 2dp, avoiding binary float artefacts like 1155.0000000000002. */
export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;

export function computeCharges(input: ChargeInput): ChargeResult {
  const baseFare = n(input.baseFare);
  const extraKmAmount = round2(n(input.extraKm) * n(input.extraKmRate));
  const extraHoursAmount = round2(n(input.extraHours) * n(input.extraHourRate));
  const toll = n(input.toll);
  const parking = n(input.parking);
  const tollParking = round2(toll + parking);
  const driverAllowance = n(input.driverAllowance);
  const permit = n(input.permit);
  const nightCharge = n(input.nightCharge);
  const otherCharges = n(input.otherCharges);
  const waitingCharge = n(input.waitingCharge);
  const stateTax = n(input.stateTax);
  const reimbursables = round2(tollParking + stateTax);
  const discount = n(input.discount);

  const taxMode = (['IGST', 'CGST_SGST', 'NONE'].includes(String(input.taxMode))
    ? input.taxMode
    : 'IGST') as TaxMode;
  const taxRate = taxMode === 'NONE' ? 0 : n(input.taxRate);
  const tollParkingTaxable = !!input.tollParkingTaxable;

  let taxableAmount =
    baseFare + extraKmAmount + extraHoursAmount + driverAllowance + permit + nightCharge + otherCharges
    + waitingCharge - discount;
  if (tollParkingTaxable) taxableAmount += reimbursables;
  taxableAmount = round2(Math.max(0, taxableAmount));

  const nonTaxableAmount = tollParkingTaxable ? 0 : reimbursables;

  const taxAmount = round2((taxableAmount * taxRate) / 100);
  let cgst = 0, sgst = 0, igst = 0;
  if (taxMode === 'IGST') {
    igst = taxAmount;
  } else if (taxMode === 'CGST_SGST') {
    cgst = round2(taxAmount / 2);
    sgst = round2(taxAmount - cgst);   // absorb the rounding remainder in SGST
  }

  const invoiceValue = round2(taxableAmount + taxAmount);
  const totalAmount = round2(invoiceValue + nonTaxableAmount);
  const advance = n(input.advance);
  const balance = round2(totalAmount - advance);

  return {
    baseFare: round2(baseFare),
    extraKmAmount,
    extraHoursAmount,
    tollParking,
    driverAllowance: round2(driverAllowance),
    permit: round2(permit),
    nightCharge: round2(nightCharge),
    otherCharges: round2(otherCharges),
    waitingCharge: round2(waitingCharge),
    stateTax: round2(stateTax),
    reimbursables,
    discount: round2(discount),
    taxableAmount,
    taxMode,
    taxRate,
    cgst,
    sgst,
    igst,
    taxAmount,
    nonTaxableAmount: round2(nonTaxableAmount),
    invoiceValue,
    totalAmount,
    advance: round2(advance),
    balance,
  };
}

/** Sum many bookings into one consolidated invoice total. */
export function consolidate(
  rows: Array<{ taxable_amount: number; non_taxable_amount: number; discount?: number }>,
  taxMode: TaxMode,
  taxRate: number
): Omit<ChargeResult, 'baseFare' | 'extraKmAmount' | 'extraHoursAmount' | 'tollParking' |
  'driverAllowance' | 'permit' | 'nightCharge' | 'otherCharges' | 'waitingCharge' | 'stateTax' |
  'reimbursables' | 'advance' | 'balance'> & {
    advance: number; balance: number;
  } {
  const taxableAmount = round2(rows.reduce((s, r) => s + n(r.taxable_amount), 0));
  const nonTaxableAmount = round2(rows.reduce((s, r) => s + n(r.non_taxable_amount), 0));
  const discount = round2(rows.reduce((s, r) => s + n(r.discount), 0));
  const rate = taxMode === 'NONE' ? 0 : n(taxRate);
  const taxAmount = round2((taxableAmount * rate) / 100);

  let cgst = 0, sgst = 0, igst = 0;
  if (taxMode === 'IGST') igst = taxAmount;
  else if (taxMode === 'CGST_SGST') { cgst = round2(taxAmount / 2); sgst = round2(taxAmount - cgst); }

  const invoiceValue = round2(taxableAmount + taxAmount);
  const totalAmount = round2(invoiceValue + nonTaxableAmount);

  return {
    discount, taxableAmount, taxMode, taxRate: rate,
    cgst, sgst, igst, taxAmount, nonTaxableAmount,
    invoiceValue, totalAmount, advance: 0, balance: totalAmount,
  };
}

// ---------------------------------------------------------------------------
// Amount in words (Indian numbering system) — used in the invoice footer
// ---------------------------------------------------------------------------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(num: number): string {
  if (num < 20) return ONES[num];
  const t = Math.floor(num / 10), o = num % 10;
  return TENS[t] + (o ? ' ' + ONES[o] : '');
}

function threeDigits(num: number): string {
  const h = Math.floor(num / 100), r = num % 100;
  let s = '';
  if (h) s += ONES[h] + ' Hundred';
  if (r) s += (s ? ' ' : '') + twoDigits(r);
  return s;
}

export function amountInWords(amount: number): string {
  const value = Math.abs(round2(amount));
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';

  const units: [number, string][] = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
  ];

  let rest = rupees;
  const parts: string[] = [];
  for (const [div, label] of units) {
    const chunk = Math.floor(rest / div);
    if (chunk) parts.push(`${threeDigits(chunk)} ${label}`);
    rest %= div;
  }
  if (rest) parts.push(threeDigits(rest));

  let words = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return words + ' Only';
}
