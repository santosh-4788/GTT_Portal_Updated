/**
 * Walk-in / direct customer bookings.
 *
 * Bookings hang off a vendor, which is right for the contracted work that makes
 * up most of the business. A counter booking taken straight from a customer has
 * no vendor, so it is attached to one reserved record instead — and the
 * invoice is addressed to the customer captured on the booking rather than to
 * that placeholder.
 */
import { q } from '../db';

export const DIRECT_VENDOR_CODE = 'DIRECT';

export function ensureDirectVendor(): any {
  const existing = q.get<any>('SELECT * FROM vendors WHERE code = @c', { c: DIRECT_VENDOR_CODE });
  if (existing) return existing;

  // Tax defaults come from company settings so a counter invoice matches the
  // rest of the business without needing to be configured separately.
  const s = Object.fromEntries(
    q.all<{ key: string; value: string }>('SELECT key, value FROM settings').map((r) => [r.key, r.value])
  );

  q.run(
    `INSERT INTO vendors (code, vendor_name, company_name, status, invoice_prefix,
        invoice_number_format, document_title, tax_mode, tax_rate, toll_parking_taxable,
        consolidation_allowed, billing_cycle, booking_message_format, payment_terms_days, notes)
     VALUES (@code, 'Direct Customer', 'Direct Customer', 'ACTIVE', @prefix,
        '{PREFIX}/{FY}/{SEQ:5}', @title, @taxMode, @taxRate, 0, 0, 'PER_TRIP', 'NONE', 0,
        'Reserved record for counter bookings taken straight from a customer. Each invoice is addressed to the customer on the booking, not to this row.')`,
    {
      code: DIRECT_VENDOR_CODE,
      prefix: s['invoice.defaultPrefix'] ?? 'GTT',
      title: s['invoice.defaultTitle'] ?? 'Tax Invoice',
      taxMode: s['invoice.defaultTaxMode'] ?? 'IGST',
      taxRate: Number(s['invoice.defaultTaxRate'] ?? 5),
    }
  );

  return q.get<any>('SELECT * FROM vendors WHERE code = @c', { c: DIRECT_VENDOR_CODE });
}

/** Who an invoice should be addressed to, given the bookings it covers. */
export function resolveBillTo(vendor: any, bookings: any[]) {
  const direct = bookings.length > 0 && bookings.every((b) => b.booking_source === 'DIRECT');
  if (!direct) {
    return {
      name: vendor.company_name || vendor.vendor_name,
      address: vendor.billing_address || vendor.address || '',
      gstin: vendor.gst_number || '',
      mobile: vendor.mobile || '',
    };
  }

  const first = bookings[0];
  return {
    name: first.customer_name || first.passenger_name || 'Customer',
    address: first.customer_address || '',
    gstin: first.customer_gstin || '',
    mobile: first.customer_mobile || first.passenger_mobile || '',
  };
}
