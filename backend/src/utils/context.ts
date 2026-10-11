/**
 * Builds the InvoiceContext consumed by the template engine from database rows.
 * Keeping this in one place means every writer (xlsx/docx/pdf) sees identical field names.
 */
import { q } from '../db';
import { amountInWords } from '../services/billing';
import type { InvoiceContext } from '../services/invoiceEngine';

export function companyContext(): Record<string, any> {
  const rows = q.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    name: s['company.name'],
    legalName: s['company.legalName'],
    tagline: s['company.tagline'],
    owner: s['company.owner'],
    mobile: s['company.mobile'],
    altMobile: s['company.altMobile'],
    altMobile2: s['company.altMobile2'],
    email: s['company.email'],
    addressLetterhead: s['company.address.letterhead'],
    addressInvoice: s['company.address.invoice'],
    addressInvoice2: s['company.address.invoice2'],
    city: s['company.city'],
    state: s['company.state'],
    pincode: s['company.pincode'],
    gstin: s['company.gstin'],
    pan: s['company.pan'],
    bankName: s['bank.name'],
    bankAccount: s['bank.accountNumber'],
    bankIfsc: s['bank.ifsc'],
    bankUpi: s['bank.upi'],
    stateCode: s['company.stateCode'],
    sacCode: s['invoice.sacCode'] ?? '996601',
    terms: s['invoice.terms'] ?? '',
    currencySymbol: s['invoice.currencySymbol'] ?? '₹',
  };
}

export function vendorContext(v: any): Record<string, any> {
  return {
    id: v.id,
    code: v.code,
    vendorName: v.vendor_name,
    companyName: v.company_name || v.vendor_name,
    contactPerson: v.contact_person,
    mobile: v.mobile,
    email: v.email,
    address: v.address,
    billingAddress: v.billing_address || v.address,
    city: v.city,
    state: v.state,
    gstNumber: v.gst_number,
    pan: v.pan,
    paymentTermsDays: v.payment_terms_days,
    documentTitle: v.document_title,
    taxMode: v.tax_mode,
    taxRate: v.tax_rate,
  };
}

export function bookingContext(b: any): Record<string, any> {
  return {
    id: b.id,
    bookingCode: b.booking_code,
    /** The reference the customer quotes. Printed on the invoice line. */
    tripId: b.trip_id,
    inquirySource: b.inquiry_source,
    vendorBookingRef: b.vendor_booking_ref,
    bookingDate: b.booking_date,
    travelDate: b.travel_date,
    travelDateTo: b.travel_date_to,
    reportingTime: b.reporting_time,
    tripType: b.trip_type,
    dutyType: b.duty_type,
    city: b.city,
    pickupLocation: b.pickup_location,
    pickupAddress: b.pickup_address,
    dropLocation: b.drop_location,
    dropAddress: b.drop_address,
    route: b.pickup_location ? `${b.pickup_location}${b.drop_location ? ' To ' + b.drop_location : ''}` : '',
    flightTrainNo: b.flight_train_no,
    passengerName: b.passenger_name,
    passengerMobile: b.passenger_mobile,
    paxCount: b.pax_count,
    vehicleType: b.vehicle_type,
    vehicleNumber: b.vehicle_number,
    driverName: b.driver_name,
    driverMobile: b.driver_mobile,
    tripDistanceKm: b.trip_distance_km,
    tripDurationHrs: b.trip_duration_hrs,
    remarks: b.remarks,
    particular: [b.duty_type, b.pickup_location && `${b.pickup_location} to ${b.drop_location ?? '-'}`]
      .filter(Boolean).join(' — '),
  };
}

export function billingContext(c: any): Record<string, any> {
  const taxable = Number(c?.taxable_amount ?? 0);
  const tax = Number(c?.tax_amount ?? 0);
  return {
    baseFare: Number(c?.base_fare ?? 0),
    extraKm: Number(c?.extra_km ?? 0),
    extraKmRate: Number(c?.extra_km_rate ?? 0),
    extraKmAmount: Number(c?.extra_km ?? 0) * Number(c?.extra_km_rate ?? 0),
    extraHours: Number(c?.extra_hours ?? 0),
    extraHourRate: Number(c?.extra_hour_rate ?? 0),
    extraHoursAmount: Number(c?.extra_hours ?? 0) * Number(c?.extra_hour_rate ?? 0),
    toll: Number(c?.toll ?? 0),
    parking: Number(c?.parking ?? 0),
    tollParking: Number(c?.toll ?? 0) + Number(c?.parking ?? 0),
    driverAllowance: Number(c?.driver_allowance ?? 0),
    permit: Number(c?.permit ?? 0),
    nightCharge: Number(c?.night_charge ?? 0),
    otherCharges: Number(c?.other_charges ?? 0),
    otherChargesNote: c?.other_charges_note ?? '',
    waitingCharge: Number(c?.waiting_charge ?? 0),
    stateTax: Number(c?.state_tax ?? 0),
    discount: Number(c?.discount ?? 0),
    taxableAmount: taxable,
    taxMode: c?.tax_mode ?? 'IGST',
    taxRate: Number(c?.tax_rate ?? 0),
    cgst: Number(c?.cgst ?? 0),
    sgst: Number(c?.sgst ?? 0),
    igst: Number(c?.igst ?? 0),
    taxAmount: tax,
    gst: tax,
    nonTaxableAmount: Number(c?.non_taxable_amount ?? 0),
    invoiceValue: taxable + tax,
    totalAmount: Number(c?.total_amount ?? 0),
  };
}

/**
 * Roll the per-booking charge components up to invoice level.
 *
 * Single-booking templates (the Wagon LOCAL layout, for example) address cells such as
 * `billing.baseFare` and `billing.tollParking` directly, so those component fields must
 * exist on the invoice-level billing object and not only inside `bookings[i].billing`.
 * Additive components are summed; a per-unit rate is carried through only when every
 * booking agrees on it, otherwise it is left at 0 rather than quoting a misleading rate.
 */
function rollUpComponents(bookings: Array<{ billing: Record<string, any> }>): Record<string, any> {
  if (bookings.length === 0) return {};
  const sum = (k: string) => bookings.reduce((s, b) => s + Number(b.billing[k] ?? 0), 0);
  const uniform = (k: string) => {
    const first = Number(bookings[0].billing[k] ?? 0);
    return bookings.every((b) => Number(b.billing[k] ?? 0) === first) ? first : 0;
  };
  return {
    baseFare: sum('baseFare'),
    extraKm: sum('extraKm'),
    extraKmRate: uniform('extraKmRate'),
    extraKmAmount: sum('extraKmAmount'),
    extraHours: sum('extraHours'),
    extraHourRate: uniform('extraHourRate'),
    extraHoursAmount: sum('extraHoursAmount'),
    toll: sum('toll'),
    parking: sum('parking'),
    tollParking: sum('tollParking'),
    driverAllowance: sum('driverAllowance'),
    permit: sum('permit'),
    nightCharge: sum('nightCharge'),
    otherCharges: sum('otherCharges'),
  };
}

export function buildInvoiceContext(args: {
  vendor: any;
  invoice: Record<string, any>;
  bookings: any[];             // rows joined with their charges
  billing: Record<string, any>;
  /**
   * Who the document is addressed to. For contracted work this is the vendor;
   * for a counter booking it is the customer captured on the booking, so the
   * template's vendor block shows them instead of the placeholder record.
   */
  billTo?: { name: string; address: string; gstin: string; mobile: string };
}): InvoiceContext {
  const bookings = args.bookings.map((b) => ({
    ...bookingContext(b),
    billing: billingContext(b),
    amount: Number(b.taxable_amount ?? 0),
    qty: b.extra_km || b.trip_distance_km || null,
    rate: b.extra_km_rate || null,
  }));

  const vendor = vendorContext(args.vendor);
  if (args.billTo) {
    vendor.companyName = args.billTo.name || vendor.companyName;
    vendor.vendorName = args.billTo.name || vendor.vendorName;
    vendor.billingAddress = args.billTo.address ?? vendor.billingAddress;
    vendor.address = args.billTo.address ?? vendor.address;
    vendor.gstNumber = args.billTo.gstin ?? vendor.gstNumber;
    vendor.mobile = args.billTo.mobile ?? vendor.mobile;
  }

  return {
    company: companyContext(),
    vendor,
    invoice: {
      ...args.invoice,
      amountInWords: amountInWords(Number(args.billing.totalAmount ?? 0)),
    },
    booking: bookings[0] ?? {},
    // Invoice-level totals win; component fields fill in underneath them.
    billing: { ...rollUpComponents(bookings), ...args.billing },
    bookings,
  };
}
