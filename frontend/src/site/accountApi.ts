/**
 * The customer account's data layer.
 *
 * One shape (`ServerTrip`) and two hooks, so every account screen reads the
 * same fields and nobody re-derives a status label. Everything here talks to
 * /api/customer, which only ever returns the signed-in customer's own trips.
 */
import { useCallback, useEffect, useState } from 'react';
import { customerApi } from '../lib/customerAuth';
import { errorMessage } from '../lib/api';

/** Matches `publicTrip()` in backend/src/services/tripFlow.ts. */
export interface ServerTrip {
  tripId: string;
  bookingCode: string;
  source: 'EMAIL' | 'WHATSAPP' | 'PORTAL' | 'WALKIN' | 'VENDOR';
  sourceLabel: string;
  status: TripStage;
  statusLabel: string;
  createdAt: string;

  travelDate: string;
  travelDateTo: string | null;
  journeyTime: string | null;
  tripType: string | null;
  pickup: string | null;
  drop: string | null;
  passengers: number | null;

  vehicleType: string | null;
  vehicleNumber: string | null;
  driverName: string | null;
  driverMobile: string | null;
  assignedAt: string | null;
  completedAt: string | null;

  passengerName: string | null;
  customerName: string | null;
  customerMobile: string | null;
  customerEmail: string | null;

  fare: number | null;
  message: string | null;

  invoice: {
    id: number;
    number: string;
    date: string;
    total: number;
    status: string;
    taxMode: string;
    taxRate: number;
    taxAmount: number;
    gst: boolean;
    downloadable: boolean;
    sentAt: string | null;
  } | null;
}

export type TripStage =
  | 'INQUIRY' | 'DRAFT' | 'CONFIRMED' | 'ASSIGNED'
  | 'ONTRIP' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface TimelineEvent {
  id: number;
  status: string;
  title: string;
  detail: string | null;
  created_at: string;
}

/* ==========================================================================
   The trail the customer reads
   ========================================================================== */

export const TRAIL: { key: TripStage; label: string; blurb: string }[] = [
  { key: 'INQUIRY', label: 'Enquiry received', blurb: 'We have your requirement and will call with the rate.' },
  { key: 'CONFIRMED', label: 'Booking confirmed', blurb: 'The fare is agreed and the trip is on our sheet.' },
  { key: 'ASSIGNED', label: 'Vehicle & driver assigned', blurb: 'Your car and chauffeur are allotted.' },
  { key: 'ONTRIP', label: 'Trip in progress', blurb: 'The journey is under way.' },
  { key: 'COMPLETED', label: 'Trip completed', blurb: 'The journey is finished.' },
];

export type TrailState = 'done' | 'now' | 'off';

/**
 * Where the trip has actually got to.
 *
 * Only steps the office has confirmed are marked done. Nothing is inferred from
 * the calendar — a trip whose travel date has passed is not "completed" until
 * somebody says so.
 */
export function trailFor(trip: Pick<ServerTrip, 'status' | 'invoice'>) {
  const steps = TRAIL.map((s) => ({ ...s, state: 'off' as TrailState }));

  if (trip.status === 'CANCELLED' || trip.status === 'NO_SHOW') {
    steps[0].state = 'done';
    return steps;
  }

  const at = TRAIL.findIndex((s) => s.key === trip.status);
  const reached = at < 0 ? 0 : at;
  steps.forEach((s, i) => {
    s.state = i < reached ? 'done' : i === reached ? 'now' : 'off';
  });

  // A completed trip with an invoice is finished, not "in progress at the end".
  if (trip.status === 'COMPLETED') steps[steps.length - 1].state = 'done';
  return steps;
}

/** Invoice raised is a sixth step, shown only once it exists. */
export function invoiceStep(trip: Pick<ServerTrip, 'invoice'>) {
  return trip.invoice
    ? { label: trip.invoice.gst ? 'GST invoice generated' : 'Invoice generated', state: 'done' as TrailState }
    : null;
}

export const STAGE_TONE: Record<TripStage, string> = {
  INQUIRY: 'bg-warn-50 text-warn-700',
  DRAFT: 'bg-ink-100 text-ink-600',
  CONFIRMED: 'bg-brand-50 text-brand-700',
  ASSIGNED: 'bg-brand-50 text-brand-700',
  ONTRIP: 'bg-ok-50 text-ok-700',
  COMPLETED: 'bg-ok-50 text-ok-700',
  CANCELLED: 'bg-danger-50 text-danger-700',
  NO_SHOW: 'bg-danger-50 text-danger-700',
};

export const SOURCE_TONE: Record<string, string> = {
  EMAIL: 'bg-brand-50 text-brand-700',
  WHATSAPP: 'bg-[#25D366]/12 text-[#128C43]',
  PORTAL: 'bg-ink-100 text-ink-700',
  WALKIN: 'bg-gold-100 text-gold-700',
  VENDOR: 'bg-ink-100 text-ink-700',
};

/** Which bucket a trip belongs in on the dashboard. */
export function stageBucket(t: ServerTrip): 'upcoming' | 'active' | 'completed' | 'cancelled' {
  if (t.status === 'ONTRIP') return 'active';
  if (t.status === 'COMPLETED') return 'completed';
  if (t.status === 'CANCELLED' || t.status === 'NO_SHOW') return 'cancelled';
  return 'upcoming';
}

/* ==========================================================================
   Hooks
   ========================================================================== */

export function useMyTrips(enabled: boolean) {
  const [trips, setTrips] = useState<ServerTrip[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled) { setTrips([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await customerApi.get('/trips');
      setTrips(data.data ?? []);
    } catch (err) {
      setError(errorMessage(err, 'We could not load your trips just now.'));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  return { trips, loading, error, reload: load };
}

export function useTrip(tripId: string | undefined, enabled: boolean) {
  const [trip, setTrip] = useState<ServerTrip | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(enabled && !!tripId);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled || !tripId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await customerApi.get(`/trips/${encodeURIComponent(tripId)}`);
      setTrip(data.data);
      setTimeline(data.timeline ?? []);
    } catch (err) {
      setError(errorMessage(err, 'We could not load that trip.'));
      setTrip(null);
    } finally {
      setLoading(false);
    }
  }, [tripId, enabled]);

  useEffect(() => { load(); }, [load]);

  return { trip, timeline, loading, error, reload: load };
}

/**
 * Download an invoice.
 *
 * Goes through fetch rather than a plain link because the endpoint needs the
 * bearer token, and because a failure should say so rather than navigating the
 * customer to a JSON error page.
 */
/**
 * The office sends the PDF when one was produced, otherwise the spreadsheet or
 * Word file itself, so the saved name follows what actually arrived.
 */
function extFor(blob: Blob): string {
  if (blob.type.includes('spreadsheetml')) return '.xlsx';
  if (blob.type.includes('ms-excel')) return '.xls';
  if (blob.type.includes('wordprocessingml')) return '.docx';
  return '.pdf';
}

export async function downloadInvoice(tripId: string, invoiceNumber?: string): Promise<void> {
  const res = await customerApi.get(`/trips/${encodeURIComponent(tripId)}/invoice`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice-${(invoiceNumber ?? tripId).replace(/[^A-Za-z0-9._-]/g, '-')}${extFor(res.data as Blob)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Open the invoice in a new tab so it can be read or printed without saving.
 *
 * The blob URL is revoked on a timer rather than immediately: revoking it
 * before the new tab has fetched it leaves the reader with a blank page.
 */
export async function viewInvoice(tripId: string): Promise<void> {
  const res = await customerApi.get(`/trips/${encodeURIComponent(tripId)}/invoice`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ==========================================================================
   Invoices — one row per invoice, from /api/customer/invoices
   ========================================================================== */

export interface ServerInvoice {
  id: number;
  number: string;
  date: string;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Only this customer's own trips on the invoice. */
  tripIds: string[];
  taxable: number;
  taxMode: string;
  taxRate: number;
  tax: number;
  total: number;
  paid: number;
  outstanding: number;
  /** GENERATED | SENT | PARTIALLY_PAID | OVERDUE | PAID */
  status: string;
  sentAt: string | null;
  downloadable: boolean;
}

export function useMyInvoices(enabled: boolean) {
  const [invoices, setInvoices] = useState<ServerInvoice[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!enabled) { setInvoices([]); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const { data } = await customerApi.get('/invoices');
      setInvoices(data.data ?? []);
    } catch (err) {
      setError(errorMessage(err, 'We could not load your invoices just now.'));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  return { invoices, loading, error, reload: load };
}

async function invoiceBlob(id: number): Promise<Blob> {
  const res = await customerApi.get(`/invoices/${id}/download`, { responseType: 'blob' });
  return res.data as Blob;
}

export async function downloadInvoiceById(inv: Pick<ServerInvoice, 'id' | 'number'>): Promise<void> {
  const blob = await invoiceBlob(inv.id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Invoice-${inv.number.replace(/[^A-Za-z0-9._-]/g, '-')}${extFor(blob)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function viewInvoiceById(id: number): Promise<void> {
  const url = URL.createObjectURL(await invoiceBlob(id));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
