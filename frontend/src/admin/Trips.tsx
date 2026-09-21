/**
 * Trips — the office's view of the customer journey.
 *
 * Every enquiry and booking from every channel on one screen, with the source
 * on the face of each row, and a drawer that carries the whole lifecycle:
 * confirm it, allot a car and a driver, email the customer, run the trip, close
 * it, raise the invoice, send the invoice.
 *
 * This sits alongside Bookings rather than replacing it. That screen is the
 * vendor booking sheet with its charge lines; this one is the journey. Both
 * read and write the same record.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime, humanise, inr, todayIso } from '../lib/format';
import {
  Field, Loading, Modal, PageHeader, Pagination, SectionCard, Spinner, StatusBadge, EmptyState,
} from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField, TimeField } from '../components/DateTimeField';
import {
  IconArrowRight, IconCheck, IconDownload, IconInvoices, IconMail, IconPhone,
  IconPlus, IconRefresh, IconSearch, IconSteering, IconUsers,
} from '../components/icons';

/* ==========================================================================
   Vocabulary — kept in step with backend/src/services/tripId.ts
   ========================================================================== */

const SOURCES = [
  { value: '', label: 'All sources', short: 'All' },
  { value: 'EMAIL', label: 'Email enquiry', short: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp enquiry', short: 'WhatsApp' },
  { value: 'PORTAL', label: 'Portal booking', short: 'Portal' },
  { value: 'WALKIN', label: 'Walk-in / phone', short: 'Walk-in' },
  { value: 'VENDOR', label: 'Vendor booking', short: 'Vendor' },
] as const;

const SOURCE_CHIP: Record<string, string> = {
  EMAIL: 'bg-brand-50 text-brand-700 ring-brand-100',
  WHATSAPP: 'bg-[#25D366]/10 text-[#0F7B52] ring-[#25D366]/20',
  PORTAL: 'bg-ink-100 text-ink-700 ring-ink-200',
  WALKIN: 'bg-gold-100 text-gold-700 ring-gold-200',
  VENDOR: 'bg-ink-100 text-ink-600 ring-ink-200',
};

const STATUSES = [
  'INQUIRY', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'DRAFT',
] as const;

const STATUS_LABEL: Record<string, string> = {
  INQUIRY: 'Enquiry received',
  DRAFT: 'Draft',
  CONFIRMED: 'Booking confirmed',
  ASSIGNED: 'Vehicle & driver assigned',
  ONTRIP: 'Trip in progress',
  COMPLETED: 'Trip completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
};

interface TripRow {
  id: number;
  trip_id: string;
  booking_code: string;
  inquiry_source: string;
  booking_status: string;
  billing_status: string;
  travel_date: string;
  reporting_time: string | null;
  trip_type: string | null;
  created_at: string;
  pickup_location: string | null;
  pickup_address: string | null;
  drop_location: string | null;
  drop_address: string | null;
  customer_name: string | null;
  customer_mobile: string | null;
  customer_email: string | null;
  pax_count: number | null;
  vehicle_type: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  assigned_at: string | null;
  completed_at: string | null;
  details_sent_at: string | null;
  customer_id: number | null;
  account_email: string | null;
  total_amount: number | null;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_total: number | null;
  invoice_status: string | null;
  invoice_sent_at: string | null;
  invoice_tax_mode: string | null;
}

interface Summary {
  bySource: { source: string; label: string; count: number; openInquiries: number }[];
  new_inquiries: number;
  awaiting_vehicle: number;
  awaiting_invoice: number;
}

const LIMIT = 50;

/* ==========================================================================
   The screen
   ========================================================================== */

export default function Trips() {
  const toast = useToast();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();

  const [rows, setRows] = useState<TripRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);

  const [search, setSearch] = useState(params.get('search') ?? '');
  const [term, setTerm] = useState(params.get('search') ?? '');
  const [source, setSource] = useState(params.get('source') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  // Debounced, so typing a Trip ID does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setTerm(search); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        api.get('/trips', { params: { search: term, source, status, from, to, limit: LIMIT, offset } }),
        api.get('/trips/summary'),
      ]);
      setRows(list.data.data ?? []);
      setTotal(list.data.total ?? 0);
      setSummary(sum.data);
    } catch (err) {
      setError(errorMessage(err, 'The trip list could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [term, source, status, from, to, offset]);

  useEffect(() => { load(); }, [load]);

  // Keep the filters in the address bar so a view can be linked to, and so the
  // email the office receives can deep-link straight to one Trip ID.
  useEffect(() => {
    const next = new URLSearchParams();
    if (term) next.set('search', term);
    if (source) next.set('source', source);
    if (status) next.set('status', status);
    setParams(next, { replace: true });
  }, [term, source, status, setParams]);

  const counts = useMemo(
    () => Object.fromEntries((summary?.bySource ?? []).map((s) => [s.source, s])),
    [summary]
  );

  return (
    <>
      <PageHeader
        title="Trips"
        subtitle="Every enquiry and booking, whichever way it reached us — from the first message to the invoice."
        actions={
          <>
            <button onClick={load} className="btn-outline btn-sm" disabled={loading}>
              <IconRefresh className="h-3.5 w-3.5" /> Refresh
            </button>
            {can('bookings.create') && (
              <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
                <IconPlus className="h-3.5 w-3.5" /> New trip
              </button>
            )}
          </>
        }
      />

      {/* ---------------------------- what needs doing --------------------- */}
      {summary && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <AttentionCard
            label="New enquiries" value={summary.new_inquiries} tone="warning"
            hint="Nobody has picked these up yet"
            onClick={() => { setStatus('INQUIRY'); setOffset(0); }}
          />
          <AttentionCard
            label="Awaiting a vehicle" value={summary.awaiting_vehicle} tone="brand"
            hint="Confirmed, no car or driver allotted"
            onClick={() => { setStatus('CONFIRMED'); setOffset(0); }}
          />
          <AttentionCard
            label="Awaiting an invoice" value={summary.awaiting_invoice} tone="success"
            hint="Trip finished, nothing billed yet"
            onClick={() => { setStatus('COMPLETED'); setOffset(0); }}
          />
        </div>
      )}

      {/* ------------------------------- filters --------------------------- */}
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-end gap-2.5">
          <div className="relative min-w-[15rem] flex-1">
            <input
              className="input h-9 pl-9 text-[13px]"
              placeholder="Trip ID, customer, mobile, email, route or vehicle…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search trips"
            />
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          </div>

          <select
            className="input h-9 w-auto text-[13px]"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setOffset(0); }}
            aria-label="Filter by status"
          >
            <option value="">Any status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>

          <DateField
            className="h-9 w-auto text-[13px]" value={from} placeholder="From"
            onChange={(v) => { setFrom(v); setOffset(0); }} ariaLabel="Travelling from"
          />
          <DateField
            className="h-9 w-auto text-[13px]" value={to} placeholder="To"
            onChange={(v) => { setTo(v); setOffset(0); }} ariaLabel="Travelling to"
          />

          {(term || source || status || from || to) && (
            <button
              className="btn-ghost btn-sm"
              onClick={() => { setSearch(''); setSource(''); setStatus(''); setFrom(''); setTo(''); setOffset(0); }}
            >
              Clear
            </button>
          )}
        </div>

        {/* Source is the question the office asks first, so it gets real tabs. */}
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-200 pt-3">
          {SOURCES.map((s) => {
            const on = source === s.value;
            const c = s.value ? counts[s.value] : null;
            return (
              <button
                key={s.value || 'all'}
                onClick={() => { setSource(s.value); setOffset(0); }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 ${
                  on ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                }`}
              >
                {s.label}
                {c ? (
                  <span className={`rounded-full px-1.5 text-2xs tabular-nums ${on ? 'bg-white/20' : 'bg-white text-ink-500'}`}>
                    {c.count}
                  </span>
                ) : null}
                {c && c.openInquiries > 0 && !on && (
                  <span className="h-1.5 w-1.5 rounded-full bg-warn-500" title={`${c.openInquiries} not yet picked up`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* -------------------------------- list ----------------------------- */}
      <SectionCard
        title={loading ? 'Trips' : `${total} ${total === 1 ? 'trip' : 'trips'}`}
        subtitle={source ? SOURCES.find((s) => s.value === source)?.label : 'All channels'}
        bodyClass=""
      >
        {loading && rows.length === 0 ? (
          <Loading variant="table" />
        ) : error ? (
          <div className="p-6">
            <EmptyState title="Could not load trips" body={error} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body={
              term || source || status || from || to
                ? 'No trip matches those filters. Clear them to see everything.'
                : 'Enquiries from the website and WhatsApp land here automatically, each with its own Trip ID. You can also add one by hand for a booking taken over the phone.'
            }
            action={can('bookings.create') ? (
              <button onClick={() => setCreating(true)} className="btn-primary btn-sm">
                <IconPlus className="h-3.5 w-3.5" /> New trip
              </button>
            ) : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Trip ID</th>
                  <th>Source</th>
                  <th>Customer</th>
                  <th>Journey</th>
                  <th>Travel</th>
                  <th>Vehicle &amp; driver</th>
                  <th className="text-right">Fare</th>
                  <th>Status</th>
                  <th>Invoice</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className="animate-fade-up cursor-pointer"
                    style={{ animationDelay: `${Math.min(i, 12) * 18}ms` }}
                    onClick={() => setOpenId(r.id)}
                  >
                    <td>
                      <span className="font-mono text-[11px] font-semibold text-brand-700">{r.trip_id}</span>
                      <span className="block text-2xs text-ink-400">{dmyTime(r.created_at)}</span>
                    </td>
                    <td>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wide ring-1 ring-inset ${SOURCE_CHIP[r.inquiry_source] ?? 'bg-ink-100 text-ink-600 ring-ink-200'}`}>
                        {SOURCES.find((s) => s.value === r.inquiry_source)?.short ?? r.inquiry_source}
                      </span>
                    </td>
                    <td className="max-w-[11rem]">
                      <span className="block truncate font-medium text-ink-800">{r.customer_name || '—'}</span>
                      <span className="block truncate text-2xs text-ink-500">
                        {r.customer_mobile || '—'}
                        {r.customer_id ? <span className="ml-1 text-brand-600" title="Has a website account">· account</span> : null}
                      </span>
                    </td>
                    <td className="max-w-[15rem]">
                      <span className="block truncate text-ink-700">
                        {[r.pickup_location, r.drop_location].filter(Boolean).join('  →  ') || '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      {dmy(r.travel_date)}
                      {r.reporting_time && <span className="block text-2xs text-ink-500">{r.reporting_time}</span>}
                    </td>
                    <td className="max-w-[11rem]">
                      {r.vehicle_number || r.driver_name ? (
                        <>
                          <span className="block truncate font-mono text-2xs text-ink-700">{r.vehicle_number || '—'}</span>
                          <span className="block truncate text-2xs text-ink-500">{r.driver_name || 'No driver'}</span>
                        </>
                      ) : (
                        <span className="text-2xs text-ink-400">Not allotted</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {r.total_amount ? inr(r.total_amount) : <span className="text-ink-400">—</span>}
                    </td>
                    <td><StatusBadge value={r.booking_status} /></td>
                    <td>
                      {r.invoice_number ? (
                        <span className="block">
                          <span className="font-mono text-2xs font-semibold text-ok-700">{r.invoice_number}</span>
                          <span className="block text-2xs text-ink-400">
                            {r.invoice_sent_at ? 'emailed' : 'not sent'}
                            {r.invoice_tax_mode === 'NONE' ? ' · no GST' : ' · GST'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-2xs text-ink-400">—</span>
                      )}
                    </td>
                    <td className="text-right">
                      <span className="text-ink-400"><IconArrowRight className="h-3.5 w-3.5" /></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
          </div>
        )}
      </SectionCard>

      {openId !== null && (
        <TripDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}

      {creating && (
        <NewTripModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); setOpenId(id); }}
        />
      )}
    </>
  );
}

/* ==========================================================================
   Attention cards
   ========================================================================== */

function AttentionCard({
  label, value, hint, tone, onClick,
}: {
  label: string; value: number; hint: string;
  tone: 'warning' | 'brand' | 'success'; onClick: () => void;
}) {
  const ring: Record<string, string> = {
    warning: 'text-warn-600 bg-warn-50',
    brand: 'text-brand-600 bg-brand-50',
    success: 'text-ok-600 bg-ok-50',
  };
  return (
    <button onClick={onClick} className="card card-hover card-pad-sm text-left">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow truncate">{label}</p>
          <p className="mt-1.5 text-2xl font-bold leading-none tabular-nums text-ink-900">{value}</p>
          <p className="mt-1.5 truncate text-xs text-ink-500">{hint}</p>
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ring[tone]}`}>
          {value > 0 && <span className="absolute h-9 w-9 animate-ping-once rounded-lg bg-current opacity-20" />}
          <IconBell />
        </span>
      </div>
    </button>
  );
}

function IconBell() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/* ==========================================================================
   The drawer — one trip, its whole lifecycle
   ========================================================================== */

interface Detail {
  data: any;
  trip: any;
  timeline: any[];
  nextStatuses: { value: string; label: string }[];
  emails: any[];
}

function TripDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'assign' | 'fare' | 'invoice'>('overview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/trips/${id}`);
      setD(data);
    } catch (err) {
      toast.error('Could not open that trip', errorMessage(err));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { await load(); onChanged(); };

  const b = d?.data;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={b?.trip_id ?? 'Trip'}
      subtitle={b ? `${b.customer_name ?? '—'} · ${dmy(b.travel_date)}${b.reporting_time ? ` at ${b.reporting_time}` : ''}` : undefined}
    >
      {loading || !d || !b ? (
        <Loading label="Opening the trip…" variant="inline" />
      ) : (
        <div className="space-y-4">
          {/* --- the strip that says where this is --- */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-wide ring-1 ring-inset ${SOURCE_CHIP[b.inquiry_source] ?? 'bg-ink-100 text-ink-600 ring-ink-200'}`}>
              {SOURCES.find((s) => s.value === b.inquiry_source)?.label ?? b.inquiry_source}
            </span>
            <StatusBadge value={b.booking_status} />
            <StatusBadge value={b.billing_status} />
            {b.customer_id ? (
              <span className="badge-ok">Linked to {b.account_email ?? 'a website account'}</span>
            ) : (
              <span className="badge-neutral">No website account</span>
            )}
          </div>

          <StatusStrip status={b.booking_status} hasInvoice={!!b.invoice_id} />

          {/* --- tabs --- */}
          <div className="flex gap-1 overflow-x-auto border-b border-ink-200 no-scrollbar">
            {([
              ['overview', 'Overview'],
              ['assign', 'Vehicle & driver'],
              ['fare', 'Fare'],
              ['invoice', 'Invoice'],
            ] as [typeof tab, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`relative shrink-0 px-3.5 py-2 text-sm font-semibold transition-colors ${
                  tab === k ? 'text-brand-700' : 'text-ink-500 hover:text-ink-800'
                }`}
              >
                {label}
                {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
              </button>
            ))}
          </div>

          {tab === 'overview' && <Overview d={d} onRefresh={refresh} />}
          {tab === 'assign' && <AssignPanel d={d} onRefresh={refresh} canEdit={can('bookings.update')} />}
          {tab === 'fare' && <FarePanel d={d} onRefresh={refresh} canEdit={can('bookings.update')} />}
          {tab === 'invoice' && <InvoicePanel d={d} onRefresh={refresh} canEdit={can('invoices.create')} />}
        </div>
      )}
    </Modal>
  );
}

/** The five steps, as a strip across the top of the drawer. */
function StatusStrip({ status, hasInvoice }: { status: string; hasInvoice: boolean }) {
  const order = ['INQUIRY', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED'];
  const labels = ['Enquiry', 'Confirmed', 'Allotted', 'On trip', 'Completed'];
  const stopped = status === 'CANCELLED' || status === 'NO_SHOW';
  const at = order.indexOf(status);

  const steps = labels.map((label, i) => ({
    label,
    state: stopped
      ? (i === 0 ? 'done' : 'off')
      // A completed trip is finished, not "in progress at the last step".
      : i < at || (i === at && status === 'COMPLETED') ? 'done'
        : i === at ? 'now'
          : 'off',
  }));
  if (hasInvoice) steps.push({ label: 'Invoiced', state: 'done' });

  return (
    <ol className="flex items-center gap-1 overflow-x-auto rounded-lg bg-ink-50 p-2 no-scrollbar">
      {steps.map((s, i) => (
        <li key={s.label} className="flex shrink-0 items-center gap-1">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-wide transition-colors duration-300 ${
              s.state === 'done' ? 'bg-ok-500 text-white'
                : s.state === 'now' ? 'bg-brand-500 text-white'
                  : 'bg-white text-ink-400'
            }`}
          >
            {s.state === 'done' && <IconCheck className="h-3 w-3" />}
            {s.label}
          </span>
          {i < steps.length - 1 && (
            <span className={`h-0.5 w-3 rounded-full ${s.state === 'done' ? 'bg-ok-300' : 'bg-ink-200'}`} />
          )}
        </li>
      ))}
      {stopped && <li className="ml-2 shrink-0"><StatusBadge value={status} /></li>}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */

function Overview({ d, onRefresh }: { d: Detail; onRefresh: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const b = d.data;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  async function move(status: string) {
    setBusy(status);
    try {
      const { data } = await api.post(`/trips/${b.id}/status`, { status, note });
      toast.success('Status updated', data.message);
      setNote('');
      onRefresh();
    } catch (err) {
      toast.error('Could not change the status', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function resend() {
    setBusy('email');
    try {
      const { data } = await api.post(`/trips/${b.id}/send-details`, {});
      toast.success('Trip details emailed', data.message);
      onRefresh();
    } catch (err) {
      toast.error('The email did not go out', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Customer">
          <Row label="Name" value={b.customer_name || b.passenger_name} />
          <Row label="Mobile" value={b.customer_mobile} href={b.customer_mobile ? `tel:+91${b.customer_mobile}` : undefined} />
          <Row label="Email" value={b.customer_email} href={b.customer_email ? `mailto:${b.customer_email}` : undefined} />
          <Row label="Passengers" value={b.pax_count} />
        </Panel>

        <Panel title="Journey">
          <Row label="Pickup" value={b.pickup_address || b.pickup_location} />
          <Row label="Drop" value={b.drop_address || b.drop_location} />
          <Row label="Date" value={dmy(b.travel_date)} />
          <Row label="Time" value={b.reporting_time} />
          <Row label="Vehicle type" value={b.vehicle_type} />
        </Panel>
      </div>

      {b.inquiry_message && (
        <Panel title="What the customer told us">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{b.inquiry_message}</p>
        </Panel>
      )}

      {/* --- moving the trip along --- */}
      {can('bookings.update') && d.nextStatuses.length > 0 && (
        <Panel title="Move this trip on">
          <input
            className="input h-9 text-[13px]"
            placeholder="A note for the timeline (optional) — e.g. customer asked to shift to 7am"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2.5 flex flex-wrap gap-2">
            {d.nextStatuses.map((s) => (
              <button
                key={s.value}
                onClick={() => move(s.value)}
                disabled={!!busy}
                className={`btn-sm ${
                  s.value === 'CANCELLED' || s.value === 'NO_SHOW' ? 'btn-outline text-danger-600' : 'btn-outline'
                }`}
              >
                {busy === s.value && <Spinner />}
                {s.label}
              </button>
            ))}
          </div>
        </Panel>
      )}

      {/* --- what has been sent --- */}
      <Panel
        title="Emails sent"
        action={
          can('bookings.update') && (b.customer_email || b.passenger_email) ? (
            <button onClick={resend} disabled={!!busy} className="btn-outline btn-sm">
              {busy === 'email' ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />} Send trip details
            </button>
          ) : undefined
        }
      >
        {d.emails.length === 0 ? (
          <p className="text-sm text-ink-500">Nothing sent for this trip yet.</p>
        ) : (
          <ul className="divide-y divide-ink-100">
            {d.emails.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                <span className={`badge-${e.status === 'SENT' ? 'ok' : e.status === 'FAILED' ? 'danger' : 'warn'} shrink-0`}>
                  {humanise(e.status)}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-700">{e.subject}</span>
                <span className="shrink-0 text-ink-400">{e.to_address}</span>
                <span className="shrink-0 text-ink-400">{dmyTime(e.sent_at ?? e.created_at)}</span>
                {e.error && <span className="w-full text-2xs leading-relaxed text-danger-600">{e.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* --- the timeline --- */}
      <Panel title="Activity">
        <ol className="space-y-0">
          {d.timeline.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <span className="relative flex w-3 shrink-0 justify-center">
                <span className="z-10 mt-1.5 h-2 w-2 rounded-full bg-brand-400 ring-4 ring-white" />
                {i < d.timeline.length - 1 && (
                  <span className="absolute bottom-0 top-3.5 w-0.5 origin-top animate-trail-grow rounded-full bg-ink-200" />
                )}
              </span>
              <span className={`min-w-0 flex-1 ${i < d.timeline.length - 1 ? 'pb-3' : ''}`}>
                <span className="block text-sm font-medium text-ink-800">{e.title}</span>
                {e.detail && <span className="block text-xs text-ink-500">{e.detail}</span>}
                <span className="block text-2xs text-ink-400">
                  {dmyTime(e.created_at)}{e.by_name ? ` · ${e.by_name}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AssignPanel({ d, onRefresh, canEdit }: { d: Detail; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const b = d.data;
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(b.vehicle_id ? String(b.vehicle_id) : '');
  const [driverId, setDriverId] = useState<string>(b.driver_id ? String(b.driver_id) : '');
  const [vehicleNumber, setVehicleNumber] = useState(b.vehicle_number ?? '');
  const [driverName, setDriverName] = useState(b.driver_name ?? '');
  const [driverMobile, setDriverMobile] = useState(b.driver_mobile ?? '');
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.get('/settings/vehicles'), api.get('/settings/drivers')])
      .then(([v, dr]) => { setVehicles(v.data.data ?? []); setDrivers(dr.data.data ?? []); })
      .catch(() => { /* the free-text fields still work without the lists */ });
  }, []);

  // Picking a car fills in its number; picking a driver fills in their mobile.
  useEffect(() => {
    const v = vehicles.find((x) => String(x.id) === vehicleId);
    if (v) setVehicleNumber(v.vehicle_number);
  }, [vehicleId, vehicles]);

  useEffect(() => {
    const dr = drivers.find((x) => String(x.id) === driverId);
    if (dr) { setDriverName(dr.full_name); setDriverMobile(dr.mobile); }
  }, [driverId, drivers]);

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/assign`, {
        vehicleId: vehicleId ? Number(vehicleId) : null,
        driverId: driverId ? Number(driverId) : null,
        vehicleNumber,
        driverName,
        driverMobile,
        notifyCustomer: notify,
        message,
      });
      toast.success('Vehicle and driver assigned', data.message);
      if (data.warning) toast.warning('Check the timings', data.warning);
      if (data.email && !data.email.ok) toast.warning('The customer was not emailed', data.email.message);
      onRefresh();
    } catch (err) {
      toast.error('Could not assign', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const selectedVehicle = vehicles.find((x) => String(x.id) === vehicleId);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Vehicle">
          <Field label="From the fleet">
            <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={!canEdit}>
              <option value="">Type the number instead…</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number} — {v.vehicle_type}{v.model ? ` (${v.model})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle number" className="mt-3">
            <input
              className="input font-mono uppercase" value={vehicleNumber} disabled={!canEdit}
              onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="MH04LQ1748"
            />
          </Field>
          {selectedVehicle?.seating && (
            <p className="mt-2 text-xs text-ink-500">Seats {selectedVehicle.seating}</p>
          )}
        </Panel>

        <Panel title="Driver">
          <Field label="From the roster">
            <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!canEdit}>
              <option value="">Type the name instead…</option>
              {drivers.map((x) => (
                <option key={x.id} value={x.id}>{x.full_name} — {x.mobile}</option>
              ))}
            </select>
          </Field>
          <Field label="Driver name" className="mt-3">
            <input className="input" value={driverName} disabled={!canEdit}
              onChange={(e) => setDriverName(e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Driver mobile" className="mt-3">
            <input className="input" value={driverMobile} disabled={!canEdit} inputMode="numeric" maxLength={13}
              onChange={(e) => setDriverMobile(e.target.value)} placeholder="10-digit mobile" />
          </Field>
          {drivers.length === 0 && (
            <p className="mt-2 text-xs text-ink-500">
              No drivers on the roster yet.{' '}
              <Link to="/admin/settings" className="font-semibold text-brand-700 hover:text-brand-800">
                Add one
              </Link>{' '}
              and they become selectable here.
            </p>
          )}
        </Panel>
      </div>

      <Panel title="Tell the customer">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!canEdit}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          <span>
            Email the trip details as soon as this is saved
            {b.customer_email
              ? <> — to <strong className="font-semibold text-ink-900">{b.customer_email}</strong></>
              : <span className="text-warn-600"> — no email address on this trip, so nothing can be sent</span>}
          </span>
        </label>
        <textarea
          className="input mt-3 h-auto py-2" rows={2} value={message} disabled={!canEdit || !notify}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="An extra line for the email (optional) — e.g. the driver will call you thirty minutes before pickup."
        />
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          For WhatsApp, message the customer yourself on{' '}
          {b.customer_mobile ? (
            <a
              href={`https://wa.me/91${b.customer_mobile}?text=${encodeURIComponent(
                `Hello ${b.customer_name ?? ''}, your trip ${b.trip_id} is confirmed. ` +
                `Vehicle ${vehicleNumber || b.vehicle_type || ''}, driver ${driverName || ''}` +
                `${driverMobile ? ` (${driverMobile})` : ''}. Pickup ${dmy(b.travel_date)}` +
                `${b.reporting_time ? ` at ${b.reporting_time}` : ''} from ${b.pickup_location ?? ''}.`
              )}`}
              target="_blank" rel="noreferrer"
              className="font-semibold text-[#128C43] hover:underline"
            >
              +91 {b.customer_mobile}
            </a>
          ) : 'their mobile number'}{' '}
          — the message opens ready written. The portal deliberately uses no paid WhatsApp service.
        </p>
      </Panel>

      {canEdit && (
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy && <Spinner />}
          <IconSteering className="h-4 w-4" />
          {b.vehicle_number || b.driver_name ? 'Update the allotment' : 'Assign vehicle and driver'}
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** A stored charge as an input value: zero and null both show an empty box. */
const blank = (v: any) => (v === null || v === undefined || Number(v) === 0 ? '' : String(v));

function FarePanel({ d, onRefresh, canEdit }: { d: Detail; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const b = d.data;
  const locked = b.billing_status === 'INVOICED';

  const [f, setF] = useState({
    baseFare: blank(b.base_fare),
    toll: blank(b.toll),
    parking: blank(b.parking),
    driverAllowance: blank(b.driver_allowance),
    nightCharge: blank(b.night_charge),
    permit: blank(b.permit),
    otherCharges: blank(b.other_charges),
    discount: blank(b.discount),
    advance: blank(b.advance),
    taxMode: (b.tax_mode ?? 'IGST') as string,
    taxRate: String(b.tax_rate ?? 5),
  });
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Mirrors services/billing.ts, so the desk sees the total as it types.
  const totals = useMemo(() => {
    const taxable = Math.max(0, num(f.baseFare) + num(f.driverAllowance) + num(f.permit) +
      num(f.nightCharge) + num(f.otherCharges) - num(f.discount));
    const rate = f.taxMode === 'NONE' ? 0 : num(f.taxRate);
    const tax = Math.round(taxable * rate) / 100;
    const nonTaxable = num(f.toll) + num(f.parking);
    const total = Math.round((taxable + tax + nonTaxable) * 100) / 100;
    return { taxable, tax, nonTaxable, total, balance: total - num(f.advance) };
  }, [f]);

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/fare`, {
        baseFare: num(f.baseFare), toll: num(f.toll), parking: num(f.parking),
        driverAllowance: num(f.driverAllowance), nightCharge: num(f.nightCharge),
        permit: num(f.permit), otherCharges: num(f.otherCharges),
        discount: num(f.discount), advance: num(f.advance),
        taxMode: f.taxMode, taxRate: num(f.taxRate), tollParkingTaxable: false,
      });
      toast.success('Fare saved', data.message);
      onRefresh();
    } catch (err) {
      toast.error('Could not save the fare', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <Panel title="Fare">
        <p className="text-sm leading-relaxed text-ink-600">
          This trip is already on invoice <strong className="font-mono">{b.invoice_number}</strong>, so the fare is
          fixed. Cancel that invoice from the Invoices screen if it has to change.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <Money label="Taxable value" value={b.taxable_amount} />
          <Money label="Tax" value={b.tax_amount} />
          <Money label="Toll & parking" value={b.non_taxable_amount} />
          <Money label="Total" value={b.total_amount} strong />
        </dl>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <Panel title="What the customer is being charged">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fare" required><input className="input tabular-nums" inputMode="decimal" value={f.baseFare} disabled={!canEdit} onChange={(e) => set('baseFare', e.target.value)} placeholder="0" /></Field>
          <Field label="Driver allowance"><input className="input tabular-nums" inputMode="decimal" value={f.driverAllowance} disabled={!canEdit} onChange={(e) => set('driverAllowance', e.target.value)} placeholder="0" /></Field>
          <Field label="Night charge"><input className="input tabular-nums" inputMode="decimal" value={f.nightCharge} disabled={!canEdit} onChange={(e) => set('nightCharge', e.target.value)} placeholder="0" /></Field>
          <Field label="Permit"><input className="input tabular-nums" inputMode="decimal" value={f.permit} disabled={!canEdit} onChange={(e) => set('permit', e.target.value)} placeholder="0" /></Field>
          <Field label="Other charges"><input className="input tabular-nums" inputMode="decimal" value={f.otherCharges} disabled={!canEdit} onChange={(e) => set('otherCharges', e.target.value)} placeholder="0" /></Field>
          <Field label="Discount"><input className="input tabular-nums" inputMode="decimal" value={f.discount} disabled={!canEdit} onChange={(e) => set('discount', e.target.value)} placeholder="0" /></Field>
          <Field label="Toll" hint="Added after tax"><input className="input tabular-nums" inputMode="decimal" value={f.toll} disabled={!canEdit} onChange={(e) => set('toll', e.target.value)} placeholder="0" /></Field>
          <Field label="Parking" hint="Added after tax"><input className="input tabular-nums" inputMode="decimal" value={f.parking} disabled={!canEdit} onChange={(e) => set('parking', e.target.value)} placeholder="0" /></Field>
          <Field label="Advance received"><input className="input tabular-nums" inputMode="decimal" value={f.advance} disabled={!canEdit} onChange={(e) => set('advance', e.target.value)} placeholder="0" /></Field>
        </div>
      </Panel>

      <Panel title="GST treatment">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax">
            <select className="input" value={f.taxMode} disabled={!canEdit} onChange={(e) => set('taxMode', e.target.value)}>
              <option value="IGST">GST — IGST</option>
              <option value="CGST_SGST">GST — CGST + SGST</option>
              <option value="NONE">No GST</option>
            </select>
          </Field>
          <Field label="Rate %">
            <input
              className="input tabular-nums" inputMode="decimal" value={f.taxRate}
              disabled={!canEdit || f.taxMode === 'NONE'}
              onChange={(e) => set('taxRate', e.target.value)}
            />
          </Field>
        </div>
      </Panel>

      <div className="rounded-lg bg-ink-50 p-4">
        <dl className="space-y-2 text-sm">
          <Money label="Taxable value" value={totals.taxable} />
          <Money label={f.taxMode === 'NONE' ? 'Tax (none)' : `Tax @ ${num(f.taxRate)}%`} value={totals.tax} />
          <Money label="Toll & parking (after tax)" value={totals.nonTaxable} />
          <Money label="Total" value={totals.total} strong />
          {num(f.advance) > 0 && <Money label="Balance due" value={totals.balance} />}
        </dl>
      </div>

      {canEdit && (
        <button onClick={save} disabled={busy} className="btn-primary w-full">
          {busy && <Spinner />} Save the fare
        </button>
      )}
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: any; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink-800' : 'text-ink-500'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-bold text-ink-900' : 'font-medium text-ink-700'}`}>
        {inr(value ?? 0)}
      </dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function InvoicePanel({ d, onRefresh, canEdit }: { d: Detail; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const b = d.data;
  const [gst, setGst] = useState(true);
  const [taxMode, setTaxMode] = useState<'IGST' | 'CGST_SGST'>((b.tax_mode === 'CGST_SGST' ? 'CGST_SGST' : 'IGST'));
  const [taxRate, setTaxRate] = useState(String(b.tax_rate ?? 5));
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [sendNow, setSendNow] = useState(true);
  const [busy, setBusy] = useState('');

  const hasInvoice = !!b.invoice_id;
  const completed = b.booking_status === 'COMPLETED';
  const priced = Number(b.total_amount ?? 0) > 0;

  async function generate() {
    setBusy('generate');
    try {
      const { data } = await api.post(`/trips/${b.id}/invoice`, {
        gst, taxMode, taxRate: num(taxRate), invoiceDate, notes, sendToCustomer: sendNow,
      });
      toast.success('Invoice generated', data.message);
      (data.warnings ?? []).forEach((w: string) => toast.warning('Note', w));
      if (data.email && !data.email.ok) toast.warning('The invoice was not emailed', data.email.message);
      onRefresh();
    } catch (err) {
      toast.error('The invoice was not generated', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function sendInvoice() {
    setBusy('send');
    try {
      const { data } = await api.post(`/invoices/${b.invoice_id}/send`, {});
      toast.success('Invoice emailed', data.message);
      onRefresh();
    } catch (err) {
      toast.error('The invoice did not go out', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  if (hasInvoice) {
    return (
      <div className="space-y-4">
        <div className="animate-pop-in rounded-lg bg-ok-50 p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ok-700">
            <IconCheck className="h-4 w-4" /> Invoice raised
          </p>
          <p className="mt-2 font-mono text-lg font-bold text-ink-900">{b.invoice_number}</p>
          <p className="mt-1 text-sm text-ink-600">
            {dmy(b.invoice_date)} · {inr(b.invoice_total)} ·{' '}
            {b.invoice_tax_mode === 'NONE' ? 'no GST' : `${b.invoice_tax_mode === 'CGST_SGST' ? 'CGST + SGST' : 'IGST'} ${b.invoice_tax_rate}%`}
          </p>
          <p className="mt-2 text-xs text-ink-500">
            {b.invoice_sent_at
              ? `Emailed to the customer on ${dmyTime(b.invoice_sent_at)}.`
              : 'Not emailed to the customer yet.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/invoices/${b.invoice_id}`} className="btn-outline btn-sm">
            <IconInvoices className="h-3.5 w-3.5" /> Open the invoice
          </Link>
          <a
            href={`/api/invoices/${b.invoice_id}/download`}
            className="btn-outline btn-sm"
            onClick={(e) => {
              // The API needs the bearer token, so let the invoice screen do it.
              e.preventDefault();
              window.location.href = `/admin/invoices/${b.invoice_id}`;
            }}
          >
            <IconDownload className="h-3.5 w-3.5" /> Download
          </a>
          {canEdit && (
            <button onClick={sendInvoice} disabled={!!busy} className="btn-primary btn-sm">
              {busy === 'send' ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />}
              {b.invoice_sent_at ? 'Email it again' : 'Email it to the customer'}
            </button>
          )}
        </div>

        <p className="text-xs leading-relaxed text-ink-500">
          The customer can already see and download this invoice in their account under {b.trip_id}
          {b.customer_id ? '' : ' — once they register with the email address on this trip'}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!completed && (
        <p className="rounded-lg bg-warn-50 px-4 py-3 text-sm leading-relaxed text-warn-700">
          Mark the trip <strong>completed</strong> before raising its invoice — the invoice states that the
          journey took place. Use the Overview tab.
        </p>
      )}
      {completed && !priced && (
        <p className="rounded-lg bg-warn-50 px-4 py-3 text-sm leading-relaxed text-warn-700">
          Enter the fare on the Fare tab first. An invoice for zero helps nobody.
        </p>
      )}

      <Panel title="Invoice type">
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button" onClick={() => setGst(true)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              gst ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-ink-300'
            }`}
          >
            <span className="block text-sm font-semibold text-ink-900">GST invoice</span>
            <span className="mt-0.5 block text-xs text-ink-500">Tax Invoice with GSTIN and the tax split out</span>
          </button>
          <button
            type="button" onClick={() => setGst(false)}
            className={`rounded-lg border p-3 text-left transition-colors ${
              !gst ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-ink-300'
            }`}
          >
            <span className="block text-sm font-semibold text-ink-900">Non-GST invoice</span>
            <span className="mt-0.5 block text-xs text-ink-500">A plain invoice with no tax lines at all</span>
          </button>
        </div>

        {gst && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="GST type">
              <select className="input" value={taxMode} onChange={(e) => setTaxMode(e.target.value as any)}>
                <option value="IGST">IGST (inter-state)</option>
                <option value="CGST_SGST">CGST + SGST (within Maharashtra)</option>
              </select>
            </Field>
            <Field label="Rate %">
              <input className="input tabular-nums" inputMode="decimal" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
            </Field>
          </div>
        )}
      </Panel>

      <Panel title="Invoice details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice date">
            <DateField value={invoiceDate} onChange={setInvoiceDate} />
          </Field>
          <Field label="Amount" hint="Taken from the fare on this trip">
            <input className="input tabular-nums" value={inr(b.total_amount ?? 0)} readOnly />
          </Field>
        </div>
        <Field label="Note on the invoice" className="mt-3">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          <span>
            Email it to the customer straight away
            {b.customer_email
              ? <> — to <strong className="font-semibold text-ink-900">{b.customer_email}</strong></>
              : <span className="text-warn-600"> — no email address on this trip, so it cannot be sent</span>}
          </span>
        </label>
      </Panel>

      {canEdit && (
        <button
          onClick={generate}
          disabled={!!busy || !completed || !priced}
          className="btn-primary w-full"
        >
          {busy === 'generate' ? <Spinner /> : <IconInvoices className="h-4 w-4" />}
          Generate {gst ? 'GST' : 'non-GST'} invoice
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
   Small shared pieces
   ========================================================================== */

function Panel({
  title, action, children,
}: {
  title: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-ink-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, href }: { label: string; value: any; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1.5 last:border-0">
      <dt className="shrink-0 text-xs text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-ink-800">
        {value
          ? href
            ? <a href={href} className="text-brand-700 hover:underline">{value}</a>
            : String(value)
          : <span className="text-ink-400">—</span>}
      </dd>
    </div>
  );
}

/* ==========================================================================
   New trip by hand — the phone call and the walk-in
   ========================================================================== */

function NewTripModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    source: 'WALKIN',
    customerName: '', customerMobile: '', customerEmail: '',
    pickup: '', dropOff: '',
    travelDate: todayIso(), journeyTime: '',
    tripType: 'LOCAL', vehicleType: '', passengers: '1',
    message: '', status: 'CONFIRMED', notifyCustomer: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/trips', {
        ...f,
        passengers: Number(f.passengers) || 1,
      });
      toast.success(`Trip ${data.tripId} created`, data.message);
      onCreated(data.id);
    } catch (err) {
      setError(errorMessage(err, 'The trip could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New trip"
      subtitle="For a booking taken over the phone or at the counter. A Trip ID is allocated automatically."
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={busy} form="new-trip">
            {busy && <Spinner />} Create trip
          </button>
        </>
      }
    >
      <form id="new-trip" onSubmit={submit} className="space-y-4">
        <Panel title="How it reached us">
          <div className="flex flex-wrap gap-2">
            {SOURCES.filter((s) => s.value && s.value !== 'VENDOR').map((s) => (
              <button
                key={s.value} type="button" onClick={() => set('source', s.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  f.source === s.value ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-500">
            This decides the Trip ID prefix and how the trip is counted on the dashboard.
          </p>
        </Panel>

        <Panel title="Customer">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" required>
              <input className="input" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Full name" autoFocus />
            </Field>
            <Field label="Mobile" required>
              <input className="input" value={f.customerMobile} inputMode="numeric" maxLength={13} onChange={(e) => set('customerMobile', e.target.value)} placeholder="10-digit mobile" />
            </Field>
            <Field label="Email" hint="Needed to email trip details and the invoice">
              <input className="input" type="email" value={f.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="name@example.com" />
            </Field>
          </div>
        </Panel>

        <Panel title="Journey">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Pickup" required>
              <input className="input" value={f.pickup} onChange={(e) => set('pickup', e.target.value)} placeholder="Pickup address" />
            </Field>
            <Field label="Drop">
              <input className="input" value={f.dropOff} onChange={(e) => set('dropOff', e.target.value)} placeholder="Drop address" />
            </Field>
            <Field label="Journey date" required>
              <DateField value={f.travelDate} onChange={(v) => set('travelDate', v)} />
            </Field>
            <Field label="Journey time">
              <TimeField value={f.journeyTime} onChange={(v) => set('journeyTime', v)} />
            </Field>
            <Field label="Trip type">
              <select className="input" value={f.tripType} onChange={(e) => set('tripType', e.target.value)}>
                {['LOCAL', 'TRANSFER', 'AIRPORT', 'OUTSTATION', 'ROUND_TRIP', 'PACKAGE'].map((t) => (
                  <option key={t} value={t}>{humanise(t)}</option>
                ))}
              </select>
            </Field>
            <Field label="Vehicle type">
              <input className="input" value={f.vehicleType} onChange={(e) => set('vehicleType', e.target.value)} placeholder="Innova Crysta" />
            </Field>
            <Field label="Passengers">
              <input className="input tabular-nums" inputMode="numeric" value={f.passengers} onChange={(e) => set('passengers', e.target.value)} />
            </Field>
            <Field label="Starting status">
              <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
                <option value="CONFIRMED">Booking confirmed</option>
                <option value="INQUIRY">Enquiry only</option>
              </select>
            </Field>
          </div>
          <Field label="Notes" className="mt-3">
            <textarea className="input h-auto py-2" rows={2} value={f.message} onChange={(e) => set('message', e.target.value)} placeholder="Anything the driver or the desk needs to know" />
          </Field>
        </Panel>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input
            type="checkbox" checked={f.notifyCustomer} onChange={(e) => set('notifyCustomer', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
          />
          Email the customer their Trip ID and journey details, if an address is given
        </label>

        {error && <p className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}
      </form>
    </Modal>
  );
}
