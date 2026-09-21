/**
 * This device's copy of the customer's trips.
 *
 * WHAT THIS IS, NOW THAT THERE IS A REAL ACCOUNT
 * Customers can sign in (see `lib/customerAuth.tsx`), and a signed-in customer's
 * trips come from the server with live status, allotted vehicle and driver, and
 * invoices — that is the record. This store is what a visitor who has NOT signed
 * in still gets: the enquiries raised from this browser, kept locally so My
 * Trips is not empty and so the Trip ID is never lost between the form and the
 * phone call.
 *
 * Both halves meet on the Trip ID. Every enquiry raised through here now carries
 * the office's own `tripId`, so the same journey can be recognised whether it is
 * read from this device or from the account — and the moment the customer
 * registers with the email they used, the server attaches those trips to them.
 *
 * What that means, said plainly wherever it matters in the UI:
 *   · this list is this device's history, and says so;
 *   · the enquiry really is sent, and comes back with a Trip ID from the office;
 *   · statuses past "Request sent" are only known once signed in, so the screens
 *     show them as pending rather than pretending.
 *
 * One clearly-labelled sample trip is seeded on first visit so the trip, driver
 * and tracking screens can be seen without waiting for a real booking. It is
 * flagged `sample` and every screen marks it as such — the same convention the
 * portal's own seed data uses with `is_sample`.
 */
import { useSyncExternalStore } from 'react';
import { api } from '../lib/api';

/* ==========================================================================
   Shapes
   ========================================================================== */

export type TripKind =
  | 'LOCAL' | 'AIRPORT' | 'OUTSTATION' | 'HOURLY' | 'TOUR'
  | 'GROUP' | 'FLEET' | 'CORPORATE' | 'EVENT' | 'WEDDING' | 'CUSTOM';

export type TripStatus = 'SENT' | 'CONFIRMED' | 'ASSIGNED' | 'ONTRIP' | 'COMPLETED' | 'CANCELLED';

export const KIND_LABEL: Record<TripKind, string> = {
  LOCAL: 'Local travel',
  AIRPORT: 'Airport transfer',
  OUTSTATION: 'Outstation',
  HOURLY: 'Hourly rental',
  TOUR: 'Tour',
  GROUP: 'Group travel',
  FLEET: 'Multiple vehicles',
  CORPORATE: 'Corporate travel',
  EVENT: 'Event transport',
  WEDDING: 'Wedding transport',
  CUSTOM: 'Custom trip',
};

export interface Driver {
  name: string;
  initials: string;
  rating: number;
  experience: string;
  languages: string[];
  mobile: string;
  verified: boolean;
}

export interface TripLeg {
  label: string;
  detail?: string;
}

export interface Trip {
  ref: string;
  /**
   * The office's own reference, allocated by the API the moment the enquiry is
   * saved — GTT-EM-2609-0042. `ref` is this device's local key and stays as it
   * was; this is the number the customer quotes and the office searches on.
   * Absent only on the seeded example and on requests that failed to send.
   */
  tripId?: string;
  /** How it reached us: 'Website', 'WhatsApp'. Shown as a small tag. */
  channel?: string;
  kind: TripKind;
  /** "Andheri East → Lonavala" — what the card shows as its title. */
  route: string;
  from: string;
  to: string;
  stops: string[];
  date: string;
  time: string;
  returnDate: string;
  passengers: number;
  bags: string;
  vehicleSlug: string;
  vehicleName: string;
  vehicleCount: number;
  addons: string[];
  /** Rupees, or null where no rate card covered the request. */
  estimate: number | null;
  notes: string;
  status: TripStatus;
  createdAt: string;
  /** Set only on the seeded example. */
  sample?: boolean;
  driver?: Driver;
  vehicleNumber?: string;
  eta?: string;
  /** Requirement lines for the fleet, event and wedding requests. */
  legs?: TripLeg[];
}

export interface Note {
  id: string;
  category: 'Booking' | 'Trip' | 'Driver' | 'Offers' | 'Important';
  title: string;
  body: string;
  at: string;
  read: boolean;
}

export interface Prefs {
  vehicleSlug: string;
  frequentPickup: string;
  frequentDrop: string;
  ac: boolean;
  quietRide: boolean;
  frontSeat: boolean;
  invoiceGstin: string;
}

export interface Passenger {
  id: string;
  name: string;
  mobile: string;
  note: string;
}

export interface Customer {
  name: string;
  mobile: string;
  email: string;
  company: string;
}

interface State {
  version: 1;
  customer: Customer;
  trips: Trip[];
  notes: Note[];
  places: string[];
  passengers: Passenger[];
  prefs: Prefs;
  searches: string[];
  seeded: boolean;
}

/* ==========================================================================
   Storage
   ========================================================================== */

const KEY = 'gtt.customer.v1';

const EMPTY: State = {
  version: 1,
  customer: { name: '', mobile: '', email: '', company: '' },
  trips: [],
  notes: [],
  places: [],
  passengers: [],
  prefs: { vehicleSlug: '', frequentPickup: '', frequentDrop: '', ac: true, quietRide: false, frontSeat: false, invoiceGstin: '' },
  searches: [],
  seeded: false,
};

/** The labelled example. Written once, on first visit, and deletable. */
function sampleTrip(): Trip {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  return {
    ref: 'SAMPLE-0001',
    kind: 'OUTSTATION',
    route: 'Andheri East → Lonavala',
    from: 'Andheri East, Mumbai',
    to: 'Lonavala',
    stops: [],
    date: d.toISOString().slice(0, 10),
    time: '07:00',
    returnDate: '',
    passengers: 6,
    bags: 'A bag each',
    vehicleSlug: 'innova-crysta',
    vehicleName: 'Toyota Innova Crysta',
    vehicleCount: 1,
    addons: [],
    estimate: null,
    notes: 'This is the example trip that ships with the website, so the trip, driver and tracking screens can be seen before your first real booking. Delete it whenever you like.',
    status: 'ASSIGNED',
    createdAt: new Date().toISOString(),
    sample: true,
    driver: {
      name: 'Sample Chauffeur',
      initials: 'SC',
      rating: 4.8,
      experience: '9 years',
      languages: ['Hindi', 'Marathi', 'English'],
      mobile: '',
      verified: true,
    },
    vehicleNumber: 'MH 01 ·· ····',
    eta: '12 min',
  };
}

/** Read what is on the device. Pure — it never writes, see the note below. */
function load(): State {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<State>) };
  } catch {
    // A corrupt or blocked store must never take the site down with it.
    return EMPTY;
  }
}

let state: State = load();
const listeners = new Set<() => void>();

function write(next: State) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* Private browsing, or storage full. The session still works. */
  }
  for (const fn of listeners) fn();
}

/**
 * First visit: plant the labelled example trip.
 *
 * This has to run AFTER the two bindings above exist. Seeding from inside the
 * initialiser of `state` reaches `state` and `listeners` while both are still
 * in their temporal dead zone, which throws a ReferenceError that a try/catch
 * around the read swallows — the store then looks empty for ever and the trip,
 * driver and tracking screens have nothing to show.
 */
if (typeof localStorage !== 'undefined' && !state.seeded) {
  write({
    ...state,
    seeded: true,
    trips: state.trips.length ? state.trips : [sampleTrip()],
  });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  // Another tab of the same site is the same customer.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { state = load(); fn(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(fn); window.removeEventListener('storage', onStorage); };
}

/** The whole store. Components re-render when any of it changes. */
export function useCustomer(): State {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

export const snapshot = () => state;

const patch = (p: Partial<State>) => write({ ...state, ...p });

/* ==========================================================================
   Writing
   ========================================================================== */

/** GTT-20260902-4821 — this device's reference for a request. */
function newRef(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const tail = String(Math.floor(1000 + Math.random() * 9000));
  return `GTT-${stamp}-${tail}`;
}

export interface RequestInput {
  kind: TripKind;
  from?: string;
  to?: string;
  stops?: string[];
  date?: string;
  time?: string;
  returnDate?: string;
  passengers?: number;
  bags?: string;
  vehicleSlug?: string;
  vehicleName?: string;
  vehicleCount?: number;
  addons?: string[];
  estimate?: number | null;
  notes?: string;
  legs?: TripLeg[];
  /** Contact details. Required by the endpoint. */
  name: string;
  mobile: string;
  email?: string;
  company?: string;
}

/** Everything the office needs, in the one free-text field the endpoint has. */
function requirementText(i: RequestInput, ref: string): string {
  const L: string[] = [`Website request ${ref} — ${KIND_LABEL[i.kind]}`];
  if (i.passengers) L.push(`Passengers: ${i.passengers}`);
  if (i.bags) L.push(`Luggage: ${i.bags}`);
  if (i.vehicleName) L.push(`Vehicle: ${i.vehicleCount && i.vehicleCount > 1 ? `${i.vehicleCount} × ` : ''}${i.vehicleName}`);
  if (i.time) L.push(`Reporting time: ${i.time}`);
  if (i.returnDate) L.push(`Return: ${i.returnDate}`);
  if (i.stops?.length) L.push(`Stops: ${i.stops.join(' → ')}`);
  if (i.legs?.length) L.push(`Requirement:\n${i.legs.map((l) => `  · ${l.label}${l.detail ? ` — ${l.detail}` : ''}`).join('\n')}`);
  if (i.addons?.length) L.push(`Also wanted: ${i.addons.join(', ')}`);
  if (i.company) L.push(`Company: ${i.company}`);
  if (typeof i.estimate === 'number') L.push(`Website estimate shown: ₹${Math.round(i.estimate).toLocaleString('en-IN')} (indicative)`);
  if (i.notes?.trim()) L.push(`Notes: ${i.notes.trim()}`);
  return L.join('\n');
}

/**
 * Send a requirement to the office and keep the customer's copy.
 *
 * The POST is the real thing — the same endpoint the contact form uses, so the
 * request lands in the portal's enquiry list. If it fails we still keep the
 * local copy and tell the customer to call, rather than losing what they typed.
 */
export async function submitRequest(
  input: RequestInput
): Promise<{ ref: string; tripId: string; sent: boolean; message: string }> {
  const ref = newRef();
  const route = [input.from, input.to].filter(Boolean).join(' → ') || KIND_LABEL[input.kind];

  const trip: Trip = {
    ref,
    kind: input.kind,
    route,
    from: input.from ?? '',
    to: input.to ?? '',
    stops: input.stops ?? [],
    date: input.date ?? '',
    time: input.time ?? '',
    returnDate: input.returnDate ?? '',
    passengers: input.passengers ?? 0,
    bags: input.bags ?? '',
    vehicleSlug: input.vehicleSlug ?? '',
    vehicleName: input.vehicleName ?? '',
    vehicleCount: input.vehicleCount ?? 1,
    addons: input.addons ?? [],
    estimate: input.estimate ?? null,
    notes: input.notes ?? '',
    status: 'SENT',
    createdAt: new Date().toISOString(),
    legs: input.legs,
  };

  let sent = false;
  let message = '';
  let tripId = '';
  try {
    // The structured fields go across as fields, not only inside the free-text
    // requirement: the office's Trips screen filters and sorts on them, and a
    // journey time buried in a paragraph is a journey time somebody misses.
    const { data } = await api.post('/public/enquiry', {
      name: input.name,
      mobile: input.mobile,
      email: input.email ?? '',
      service: KIND_LABEL[input.kind],
      pickup: input.from ?? '',
      dropOff: input.to ?? '',
      travelDate: input.date ?? '',
      travelTime: input.time ?? '',
      vehicleType: input.vehicleName ?? '',
      passengers: input.passengers ?? 0,
      message: requirementText(input, ref),
    });
    sent = true;
    message = data?.message ?? '';
    tripId = data?.tripId ?? '';
  } catch {
    message = '';
  }

  write({
    ...state,
    customer: {
      name: input.name || state.customer.name,
      mobile: input.mobile || state.customer.mobile,
      email: input.email || state.customer.email,
      company: input.company || state.customer.company,
    },
    trips: [{ ...trip, tripId: tripId || undefined, channel: 'Website' }, ...state.trips],
    notes: [
      {
        id: `${ref}-sent`,
        category: 'Booking',
        title: sent ? 'Requirement received' : 'Requirement saved on this device',
        body: sent
          ? `${route} · ${KIND_LABEL[input.kind]}.${tripId ? ` Trip ID ${tripId}.` : ''} We will call you on ${input.mobile} with the rate.`
          : `${route} · ${KIND_LABEL[input.kind]}. We could not reach the office just now — please call to confirm.`,
        at: new Date().toISOString(),
        read: false,
      },
      ...state.notes,
    ],
    places: rememberPlaces(state.places, [input.from, input.to, ...(input.stops ?? [])]),
  });

  return { ref, tripId, sent, message };
}

/**
 * Keep a local copy of an enquiry that was raised somewhere other than
 * `submitRequest` — currently the WhatsApp form, which posts to its own
 * endpoint because it also has to build the chat message.
 *
 * Without this, a customer who only ever uses WhatsApp would open My Trips and
 * find it empty, even though the office has their job on its books.
 */
export function rememberTrip(input: {
  tripId: string;
  from?: string;
  to?: string;
  date?: string;
  time?: string;
  vehicleName?: string;
  name?: string;
  mobile?: string;
  email?: string;
  channel?: string;
  kind?: TripKind;
}): void {
  if (state.trips.some((t) => t.tripId === input.tripId)) return;

  const route = [input.from, input.to].filter(Boolean).join(' → ') || 'Trip enquiry';
  const trip: Trip = {
    ref: input.tripId,
    tripId: input.tripId,
    channel: input.channel ?? 'WhatsApp',
    kind: input.kind ?? 'LOCAL',
    route,
    from: input.from ?? '',
    to: input.to ?? '',
    stops: [],
    date: input.date ?? '',
    time: input.time ?? '',
    returnDate: '',
    passengers: 0,
    bags: '',
    vehicleSlug: '',
    vehicleName: input.vehicleName ?? '',
    vehicleCount: 1,
    addons: [],
    estimate: null,
    notes: '',
    status: 'SENT',
    createdAt: new Date().toISOString(),
  };

  write({
    ...state,
    customer: {
      name: input.name || state.customer.name,
      mobile: input.mobile || state.customer.mobile,
      email: input.email || state.customer.email,
      company: state.customer.company,
    },
    trips: [trip, ...state.trips],
    notes: [
      {
        id: `${input.tripId}-sent`,
        category: 'Booking',
        title: 'Enquiry sent on WhatsApp',
        body: `${route}. Trip ID ${input.tripId} — quote it in the chat and we will find your job instantly.`,
        at: new Date().toISOString(),
        read: false,
      },
      ...state.notes,
    ],
    places: rememberPlaces(state.places, [input.from, input.to]),
  });
}

function rememberPlaces(existing: string[], incoming: (string | undefined)[]): string[] {
  const clean = incoming.map((p) => (p ?? '').trim()).filter((p) => p.length > 2);
  return [...new Set([...existing, ...clean])].slice(0, 12);
}

export const tripByRef = (ref?: string) => state.trips.find((t) => t.ref === ref);

export function cancelTrip(ref: string) {
  patch({
    trips: state.trips.map((t) => (t.ref === ref ? { ...t, status: 'CANCELLED' as TripStatus } : t)),
    notes: [
      { id: `${ref}-cancel`, category: 'Booking', title: 'Cancellation noted on this device', body: `${ref} marked cancelled here. Please call the office so they stop the vehicle.`, at: new Date().toISOString(), read: false },
      ...state.notes,
    ],
  });
}

export function removeTrip(ref: string) {
  patch({ trips: state.trips.filter((t) => t.ref !== ref) });
}

export const markAllRead = () => patch({ notes: state.notes.map((n) => ({ ...n, read: true })) });
export const markRead = (id: string) => patch({ notes: state.notes.map((n) => (n.id === id ? { ...n, read: true } : n)) });
export const clearNotes = () => patch({ notes: [] });

export const savePrefs = (p: Partial<Prefs>) => patch({ prefs: { ...state.prefs, ...p } });
export const saveCustomer = (c: Partial<Customer>) => patch({ customer: { ...state.customer, ...c } });

export const addPlace = (label: string) => {
  const v = label.trim();
  if (v.length < 3 || state.places.includes(v)) return;
  patch({ places: [...state.places, v].slice(0, 20) });
};
export const removePlace = (label: string) => patch({ places: state.places.filter((p) => p !== label) });

export const addPassenger = (p: Omit<Passenger, 'id'>) =>
  patch({ passengers: [...state.passengers, { ...p, id: String(Date.now()) }] });
export const removePassenger = (id: string) => patch({ passengers: state.passengers.filter((p) => p.id !== id) });

export const rememberSearch = (term: string) => {
  const v = term.trim();
  if (v.length < 2) return;
  patch({ searches: [v, ...state.searches.filter((s) => s.toLowerCase() !== v.toLowerCase())].slice(0, 8) });
};
export const clearSearches = () => patch({ searches: [] });

/* ==========================================================================
   Derived
   ========================================================================== */

export const UPCOMING: TripStatus[] = ['SENT', 'CONFIRMED', 'ASSIGNED'];

export function bucket(t: Trip): 'upcoming' | 'active' | 'completed' | 'cancelled' {
  if (t.status === 'ONTRIP') return 'active';
  if (t.status === 'COMPLETED') return 'completed';
  if (t.status === 'CANCELLED') return 'cancelled';
  return 'upcoming';
}

/**
 * The trip status trail.
 *
 * Only the steps the office has actually confirmed are marked done. Everything
 * after that is shown as still to come — the screen never claims a driver has
 * been assigned because two days have passed.
 */
export const TRAIL: { key: TripStatus; label: string }[] = [
  { key: 'SENT', label: 'Request submitted' },
  { key: 'CONFIRMED', label: 'Vehicle confirmed' },
  { key: 'ASSIGNED', label: 'Driver assigned' },
  { key: 'ONTRIP', label: 'Trip started' },
  { key: 'COMPLETED', label: 'Completed' },
];

export function trailState(t: Trip) {
  if (t.status === 'CANCELLED') {
    return TRAIL.map((s, i) => ({ ...s, state: i === 0 ? ('done' as const) : ('off' as const) }));
  }
  const at = TRAIL.findIndex((s) => s.key === t.status);
  return TRAIL.map((s, i) => ({
    ...s,
    state: i < at ? ('done' as const) : i === at ? ('now' as const) : ('off' as const),
  }));
}
