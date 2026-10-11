export const inr = (v: any, withSymbol = true): string => {
  const n = Number(v ?? 0);
  const s = n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return withSymbol ? `₹${s}` : s;
};

/** Compact form for dashboard tiles: ₹1.24L, ₹3.5Cr */
export const inrShort = (v: any): string => {
  const n = Number(v ?? 0);
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (Math.abs(n) >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

export const dmy = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00` : String(iso));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const dmyTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z'));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
};

export const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Today, in the browser's own timezone.
 *
 * `todayIso` above is UTC, which in IST (+05:30) returns YESTERDAY until 05:30
 * local. Harmless as a `min` attribute; wrong as a default value, because the
 * form would open showing a date it then rejects. Anything a customer sees
 * pre-filled uses this one.
 */
export const todayLocalIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The current wall-clock time as HH:MM, for an <input type="time">. */
export const nowLocalHm = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 2026-09-03 -> "03/09/2026 (Thu)" — how an Indian office writes a date. */
export const dmySlash = (iso?: string | null, withDay = true): string => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const core = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withDay ? `${core} (${day})` : core;
};

/** 14:05 -> "2:05 PM". Twelve-hour, because that is how a pickup is agreed. */
export const hm12 = (hm?: string | null): string => {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hm);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const monthStartIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

/** Turn WAGON / PARTIALLY_PAID into readable text. */
export const humanise = (v?: string | null): string => {
  if (!v) return '—';
  return v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Every status in the portal has one colour, used on every screen:
 *
 *   amber   pending / waiting on us      blue    confirmed / issued
 *   violet  allotted / approved          teal    under way / ready
 *   green   completed / paid             red     cancelled / overdue
 *   grey    draft / inactive
 *
 * A status means the same thing wherever it appears, so it looks the same
 * wherever it appears.
 */
export const STATUS_STYLES: Record<string, string> = {
  // booking / trip status
  INQUIRY: 'badge-warn',
  DRAFT: 'badge-neutral',
  CONFIRMED: 'badge-brand',
  ASSIGNED: 'badge-violet',
  ONTRIP: 'badge-teal',
  COMPLETED: 'badge-ok',
  CANCELLED: 'badge-danger',
  NO_SHOW: 'badge-danger',
  // trip stages (services/tripStages.ts)
  NEW: 'badge-warn',
  ASSIGNED_TO_STAFF: 'badge-warn',
  QUOTE_PENDING: 'badge-warn',
  AWAITING_CONFIRMATION: 'badge-brand',
  AWAITING_ASSIGNMENT: 'badge-brand',
  UPCOMING: 'badge-violet',
  IN_PROGRESS: 'badge-teal',
  AWAITING_BILLING: 'badge-warn',
  AWAITING_INVOICE: 'badge-teal',
  BILLING_IN_PROGRESS: 'badge-violet',
  BILLED: 'badge-brand',
  SETTLED: 'badge-ok',
  // billing status
  PENDING: 'badge-warn',
  READY: 'badge-teal',
  INVOICED: 'badge-ok',
  NOT_INVOICED: 'badge-neutral',
  // billing batches
  PENDING_APPROVAL: 'badge-warn',
  APPROVED: 'badge-violet',
  // invoice status
  GENERATED: 'badge-brand',
  SENT: 'badge-brand',
  ISSUED: 'badge-brand',
  PARTIALLY_PAID: 'badge-warn',
  PAID: 'badge-ok',
  OVERDUE: 'badge-danger-solid',
  REVERSED: 'badge-danger',
  // quotations
  ACCEPTED: 'badge-ok',
  DECLINED: 'badge-danger',
  // vendor / user / fleet status
  ACTIVE: 'badge-ok',
  INACTIVE: 'badge-neutral',
  AVAILABLE: 'badge-ok',
  FREE: 'badge-ok',
  BOOKED: 'badge-violet',
  MAINTENANCE: 'badge-warn',
  ON_LEAVE: 'badge-warn',
  UNAVAILABLE: 'badge-neutral',
  EXPIRED: 'badge-danger-solid',
  EXPIRING: 'badge-warn',
  OK: 'badge-ok',
  // parser confidence
  BOOKING_HASH: 'badge-brand',
  TRIPID_HASH: 'badge-brand',
  GENERIC: 'badge-neutral',
  UNKNOWN: 'badge-warn',
};

export const statusClass = (s?: string | null) => STATUS_STYLES[s ?? ''] ?? 'badge-neutral';

/** Words for codes whose plain humanised form reads badly. */
export const STATUS_LABELS: Record<string, string> = {
  INQUIRY: 'Enquiry',
  ONTRIP: 'On trip',
  NO_SHOW: 'No show',
  GENERATED: 'Issued',
  SENT: 'Issued · emailed',
  PARTIALLY_PAID: 'Partially paid',
  PENDING_APPROVAL: 'Awaiting approval',
  READY: 'Ready to bill',
  PENDING: 'Pending',
  NEW: 'New enquiry',
  ASSIGNED_TO_STAFF: 'With staff',
  QUOTE_PENDING: 'Quote pending',
  AWAITING_CONFIRMATION: 'Quoted',
  AWAITING_ASSIGNMENT: 'Needs vehicle',
  UPCOMING: 'Upcoming',
  IN_PROGRESS: 'In progress',
  AWAITING_BILLING: 'Awaiting billing',
  BILLING_IN_PROGRESS: 'Billing in progress',
  AWAITING_INVOICE: 'Billed — awaiting invoice',
  BILLED: 'Invoice generated',
  SETTLED: 'Settled',
  ON_LEAVE: 'On leave',
  BANK_TRANSFER: 'Bank transfer',
};

export const statusLabel = (s?: string | null) => (s ? STATUS_LABELS[s] ?? humanise(s) : '—');
