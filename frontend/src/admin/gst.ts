/**
 * The GST choices a bill can be raised with.
 *
 * A vendor's own setting is only the starting point: a walk-in customer who
 * asks for a GST bill, or a trip billed to another state, needs a different
 * type or rate on that one bill. The backend already takes both as overrides.
 */
export type GstType = 'NONE' | 'CGST_SGST' | 'IGST';

export const GST_TYPES: { value: GstType; label: string }[] = [
  { value: 'NONE', label: 'No GST' },
  { value: 'CGST_SGST', label: 'CGST + SGST (same state)' },
  { value: 'IGST', label: 'IGST (other state)' },
];

/** Passenger transport and cab rental are billed at one of these. */
export const GST_RATES = [5, 12, 18];

/** The standard rates, plus a vendor's own if it is something else. */
export function gstRateOptions(current: number): number[] {
  return GST_RATES.includes(current) || !(current > 0)
    ? GST_RATES
    : [...GST_RATES, current].sort((a, b) => a - b);
}

/** "CGST 2.5% + SGST 2.5%", "IGST 12%", "No GST". */
export function gstSummary(type: string, rate: number): string {
  if (type === 'NONE' || !(rate > 0)) return 'No GST';
  if (type === 'CGST_SGST') return `CGST ${rate / 2}% + SGST ${rate / 2}%`;
  return `IGST ${rate}%`;
}
