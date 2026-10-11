/**
 * Trips — every enquiry and booking, from the first message to the invoice.
 *
 * The buckets across the top are the lifecycle stages worked out on the
 * server (backend/src/services/tripStages.ts): each trip is in exactly one,
 * and each bucket's count is the number of rows it opens. The drawer carries
 * the whole workflow — pick it up, price it, quote it, confirm it, allot a
 * vehicle and driver, run it, complete it, bill it — and says at each stage
 * what has to happen next.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime, humanise, inr, todayIso } from '../lib/format';
import { EmptyState, Field, Modal, Pagination, Spinner, StatusBadge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField, TimeField } from '../components/DateTimeField';
import { DataTable, Drawer, ExportButton, SearchBox, type SortState } from '../components/data';
import { gstRateOptions, gstSummary } from './gst';
import { AIRPORT_NAMES, AirportDirectionPicker, airportEnds, type AirportDir } from './airport';
import FareCalculator, { type FareQuote } from './FareCalculator';
import { BillingPanel, CompleteModal, PaymentsPanel } from './TripBilling';
import AssignPicker, { EMPTY_ASSIGN, type AssignCheck, type AssignValue } from '../components/AssignPicker';
import {
  IconCheck, IconDownload, IconInvoices, IconMail, IconPlus, IconRefresh, IconSteering, IconWarning,
  IconFilter, IconUsers, IconRupee, IconSparkle, IconClose, IconCar,
} from '../components/icons';

/* ==========================================================================
   Vocabulary — kept in step with backend/src/services/tripId.ts and tripStages.ts
   ========================================================================== */

const SOURCES = [
  { value: '', label: 'All sources', short: 'All' },
  { value: 'EMAIL', label: 'Email enquiry', short: 'Email' },
  { value: 'WHATSAPP', label: 'WhatsApp enquiry', short: 'WhatsApp' },
  { value: 'PORTAL', label: 'Customer portal', short: 'Portal' },
  { value: 'WALKIN', label: 'Walk-in / phone', short: 'Walk-in' },
  { value: 'VENDOR', label: 'Vendor booking', short: 'Vendor' },
] as const;

const SOURCE_CHIP: Record<string, string> = {
  EMAIL: 'bg-brand-50 text-brand-700 ring-brand-100',
  WHATSAPP: 'bg-[#25D366]/10 text-[#0F7B52] ring-[#25D366]/20',
  PORTAL: 'bg-violet-50 text-violet-700 ring-violet-100',
  WALKIN: 'bg-gold-100 text-gold-700 ring-gold-200',
  VENDOR: 'bg-ink-100 text-ink-600 ring-ink-200',
};

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

const TRIP_TYPES = ['LOCAL', 'TRANSFER', 'AIRPORT', 'OUTSTATION', 'ROUND_TRIP', 'PACKAGE'];

interface StageInfo { key: string; label: string; phase: string; action: string; description: string; count: number; amount: number }

const LIMIT = 50;

const SORT_OPTIONS = [
  { value: 'attention', label: 'Needs attention first' },
  { value: 'travel_asc', label: 'Travel date — soonest' },
  { value: 'travel_desc', label: 'Travel date — latest' },
  { value: 'created_desc', label: 'Received — newest' },
  { value: 'created_asc', label: 'Received — oldest' },
  { value: 'fare_desc', label: 'Fare — highest' },
  { value: 'customer_asc', label: 'Customer A–Z' },
];
const COLUMN_SORT: Record<string, [string, string]> = {
  trip_id: ['trip_asc', 'trip_desc'], travel_date: ['travel_asc', 'travel_desc'],
  total_amount: ['fare_desc', 'fare_desc'], customer_name: ['customer_asc', 'customer_asc'],
};

const FILTER_KEYS = ['search', 'source', 'status', 'stage', 'from', 'to', 'createdFrom', 'createdTo', 'ownerId', 'vendorId', 'categoryId', 'tripType', 'invoiced', 'payment', 'eventId', 'sort'] as const;
type Filters = Record<(typeof FILTER_KEYS)[number], string>;

/* ==========================================================================
   The screen
   ========================================================================== */

export default function Trips() {
  const toast = useToast();
  const { can, user } = useAuth();
  const [params, setParams] = useSearchParams();

  const initial = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as Filters, []);
  const [f, setF] = useState<Filters>(initial);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [summary, setSummary] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(() => !!(initial.ownerId || initial.vendorId || initial.categoryId || initial.tripType || initial.invoiced || initial.createdFrom || initial.status));

  const [openId, setOpenId] = useState<number | null>(params.get('open') ? Number(params.get('open')) : null);
  const [creating, setCreating] = useState(params.get('new') === '1');

  const set = (patch: Partial<Filters>) => { setF((p) => ({ ...p, ...patch })); setOffset(0); };

  useEffect(() => {
    api.get('/trips/meta').then((r) => setMeta(r.data)).catch(() => {});
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);

  const query = useMemo(() => {
    const q: Record<string, string> = {};
    FILTER_KEYS.forEach((k) => { if (f[k]) q[k] = f[k]; });
    return q;
  }, [f]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, sum] = await Promise.all([
        api.get('/trips', { params: { ...query, limit: LIMIT, offset } }),
        api.get('/trips/summary', { params: { ...query, stage: undefined } }),
      ]);
      setRows(list.data.data ?? []);
      setTotal(list.data.total ?? 0);
      setTotalAmount(list.data.totalAmount ?? 0);
      setSummary(sum.data);
    } catch (err) {
      setError(errorMessage(err, 'The trip list could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [query, offset]);

  useEffect(() => { load(); }, [load]);

  // Keep every filter in the address bar, so a view can be bookmarked or linked
  // to from the dashboard, and so a link can open one trip directly.
  useEffect(() => {
    const next = new URLSearchParams(query);
    if (openId) next.set('open', String(openId));
    setParams(next, { replace: true });
  }, [query, openId, setParams]);

  const stages: StageInfo[] = summary?.stages ?? [];
  const byPhase = useMemo(() => {
    const out: Record<string, StageInfo[]> = {};
    for (const s of stages) if (s.key !== 'DRAFT' || s.count) (out[s.phase] ??= []).push(s);
    return out;
  }, [stages]);
  const sourceCounts = useMemo(
    () => Object.fromEntries((summary?.bySource ?? []).map((s: any) => [s.source, s])),
    [summary]
  );
  const activeStage = stages.find((s) => s.key === f.stage);
  const filtersOn = FILTER_KEYS.filter((k) => k !== 'sort' && k !== 'stage' && f[k]).length;

  const sortState: SortState = (() => {
    const entry = Object.entries(COLUMN_SORT).find(([, [a, d]]) => f.sort === a || f.sort === d);
    if (!entry) return null;
    return { key: entry[0], dir: f.sort === entry[1][1] && entry[1][0] !== entry[1][1] ? 'desc' : 'asc' };
  })();

  return (
    <div className="page">
      <header className="page-head animate-fade-down">
        <div className="min-w-0">
          <h1 className="page-title">Trips</h1>
          <p className="page-sub">
            Every enquiry and booking from every channel, from the first message to the invoice. Pick a stage to see
            what needs doing next.
          </p>
        </div>
        <div className="page-actions">
          <button onClick={load} className="btn-outline btn-sm" disabled={loading}>
            <IconRefresh className="h-3.5 w-3.5" /> Refresh
          </button>
          <ExportButton url="/trips/export" params={query} label="Export" />
          {can('bookings.create') && (
            <button onClick={() => setCreating(true)} className="btn-outline btn-sm">
              <IconPlus className="h-3.5 w-3.5" /> Quick enquiry
            </button>
          )}
          {can('bookings.create') && (
            <Link to="/admin/bookings/new" className="btn-primary btn-sm">
              <IconPlus className="h-3.5 w-3.5" /> New booking
            </Link>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------ buckets */}
      <section className="card p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
          <button onClick={() => set({ stage: '' })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!f.stage ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}>
            All trips <span className="ml-1 tabular-nums opacity-80">{summary?.total ?? '—'}</span>
          </button>
          <button onClick={() => set({ stage: 'CONFIRMED_ALL' })}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${f.stage === 'CONFIRMED_ALL' ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'}`}>
            Confirmed trips <span className="ml-1 tabular-nums opacity-80">{summary?.confirmedTotal ?? '—'}</span>
          </button>
          {(summary?.paymentPending ?? 0) > 0 && (
            <button onClick={() => set({ payment: f.payment === 'pending' ? '' : 'pending', stage: '' })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${f.payment === 'pending' ? 'bg-warn-600 text-white' : 'bg-warn-50 text-warn-700 hover:bg-warn-100'}`}>
              Payment pending <span className="ml-1 tabular-nums opacity-80">{summary.paymentPending}</span>
            </button>
          )}
          {(summary?.paymentOverdue ?? 0) > 0 && (
            <button onClick={() => set({ payment: f.payment === 'overdue' ? '' : 'overdue', stage: '' })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${f.payment === 'overdue' ? 'bg-danger-600 text-white' : 'bg-danger-50 text-danger-700 hover:bg-danger-100'}`}>
              Payment overdue <span className="ml-1 tabular-nums opacity-80">{summary.paymentOverdue}</span>
            </button>
          )}
          <span className="ml-auto text-xs text-ink-400">Counts follow the filters below.</span>
        </div>
        <div className="grid gap-2.5 lg:grid-cols-4">
          {['Enquiry', 'Booking', 'Billing', 'Closed'].map((phase) => (
            <div key={phase} className="rounded-xl bg-ink-50/80 p-2">
              <p className="px-1.5 pb-1.5 text-2xs font-bold uppercase tracking-[0.1em] text-ink-400">{phase}</p>
              <div className="space-y-1">
                {(byPhase[phase] ?? []).map((s) => {
                  const on = f.stage === s.key;
                  const urgent = s.count > 0 && ['NEW', 'AWAITING_ASSIGNMENT', 'AWAITING_BILLING', 'AWAITING_INVOICE'].includes(s.key);
                  return (
                    <button key={s.key} onClick={() => set({ stage: on ? '' : s.key })} title={s.description}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all ${
                        on ? 'bg-white shadow-raised ring-1 ring-brand-300' : 'bg-white/70 hover:bg-white hover:shadow-xs'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-ink-800">{s.label}</span>
                        <span className="block truncate text-2xs text-ink-400">{s.count ? `Next: ${s.action}` : s.description}</span>
                      </span>
                      <span className={`rounded-md px-2 py-0.5 font-display text-sm font-bold tabular-nums ${
                        urgent ? 'bg-warn-100 text-warn-700' : s.count ? 'bg-ink-100 text-ink-800' : 'text-ink-300'}`}>{s.count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ filters */}
      <section className="card p-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={f.search} onChange={(v) => set({ search: v })} placeholder="Trip ID, booking ref, company, customer, passenger, mobile, route, vehicle, driver, invoice…" className="min-w-[16rem] flex-1" />
          <DateField className="h-9 w-auto text-[13px]" value={f.from} placeholder="Travel from" onChange={(v) => set({ from: v })} ariaLabel="Travelling from" />
          <DateField className="h-9 w-auto text-[13px]" value={f.to} placeholder="Travel to" onChange={(v) => set({ to: v })} ariaLabel="Travelling to" />
          <select className="input h-9 w-auto text-[13px]" value={f.sort} onChange={(e) => set({ sort: e.target.value })} aria-label="Sort">
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value === 'attention' ? '' : o.value}>{o.label}</option>)}
          </select>
          <button className={`btn-sm ${showFilters || filtersOn ? 'btn-dark' : 'btn-outline'}`} onClick={() => setShowFilters((v) => !v)}>
            <IconFilter className="h-3.5 w-3.5" /> Filters{filtersOn ? ` · ${filtersOn}` : ''}
          </button>
          {(filtersOn > 0 || f.stage) && (
            <button className="btn-ghost btn-sm" onClick={() => { setF(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) as Filters); setOffset(0); }}>
              Clear all
            </button>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 grid gap-2.5 border-t border-ink-100 pt-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <select className="input h-9 text-[13px]" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
              <option value="">Any status</option>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select className="input h-9 text-[13px]" value={f.ownerId} onChange={(e) => set({ ownerId: e.target.value })} aria-label="Handled by">
              <option value="">Anyone</option>
              <option value={String(user?.id ?? '')}>Mine</option>
              <option value="none">Not picked up</option>
              {(meta?.staff ?? []).filter((s: any) => s.id !== user?.id).map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <select className="input h-9 text-[13px]" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label="Vendor">
              <option value="">All companies</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
            </select>
            <select className="input h-9 text-[13px]" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })} aria-label="Vehicle category">
              <option value="">All vehicles</option>
              {(meta?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input h-9 text-[13px]" value={f.tripType} onChange={(e) => set({ tripType: e.target.value })} aria-label="Trip type">
              <option value="">Any trip type</option>
              {TRIP_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
            </select>
            <select className="input h-9 text-[13px]" value={f.invoiced} onChange={(e) => set({ invoiced: e.target.value })} aria-label="Invoiced">
              <option value="">Invoiced or not</option><option value="yes">Invoiced</option><option value="no">Not invoiced</option>
            </select>
            <select className="input h-9 text-[13px]" value={f.payment} onChange={(e) => set({ payment: e.target.value })} aria-label="Payment">
              <option value="">Any payment state</option><option value="pending">Payment pending</option><option value="overdue">Payment overdue</option>
            </select>
            <div className="flex items-center gap-1.5">
              <DateField className="h-9 w-full text-[13px]" value={f.createdFrom} placeholder="Received from" onChange={(v) => set({ createdFrom: v })} ariaLabel="Received from" />
              <DateField className="h-9 w-full text-[13px]" value={f.createdTo} placeholder="to" onChange={(v) => set({ createdTo: v })} ariaLabel="Received to" />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-ink-100 pt-3">
          {SOURCES.map((s) => {
            const on = f.source === s.value;
            const c = s.value ? sourceCounts[s.value] : null;
            return (
              <button key={s.value || 'all'} onClick={() => set({ source: s.value })}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  on ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'}`}>
                {s.label}
                {c ? <span className={`rounded-full px-1.5 text-2xs tabular-nums ${on ? 'bg-white/20' : 'bg-white text-ink-500'}`}>{c.count}</span> : null}
                {c && c.openInquiries > 0 && !on && <span className="h-1.5 w-1.5 rounded-full bg-warn-500" title={`${c.openInquiries} not yet picked up`} />}
              </button>
            );
          })}
        </div>
      </section>

      {/* --------------------------------------------------------------- list */}
      <section className="table-wrap">
        <div className="card-head">
          <div>
            <h2 className="card-title">
              {activeStage ? activeStage.label : f.stage === 'CONFIRMED_ALL' ? 'Confirmed trips' : 'All trips'}
              <span className="ml-2 text-sm font-normal text-ink-400">{loading ? '…' : `${total} · ${inr(totalAmount)}`}</span>
            </h2>
            <p className="card-sub">{activeStage ? `${activeStage.description} Next step: ${activeStage.action.toLowerCase()}.` : 'Click a row to open the trip.'}</p>
          </div>
        </div>
        {error ? (
          <div className="p-6"><EmptyState title="Could not load trips" body={error} action={<button className="btn-outline btn-sm" onClick={load}>Try again</button>} /></div>
        ) : (
          <>
            <DataTable
              rows={rows}
              rowKey={(r) => r.id}
              loading={loading}
              clientSort={false}
              sort={sortState}
              onSortChange={(s) => {
                if (!s) return set({ sort: '' });
                const pair = COLUMN_SORT[s.key];
                if (pair) set({ sort: s.dir === 'asc' ? pair[0] : pair[1] });
              }}
              onRowClick={(r) => setOpenId(r.id)}
              empty={
                <EmptyState
                  title={filtersOn || f.stage ? 'Nothing matches' : 'No trips yet'}
                  body={filtersOn || f.stage
                    ? 'No trip matches these filters. Clear them to see everything.'
                    : 'Enquiries from the website and WhatsApp land here automatically, each with its own Trip ID. You can also add one by hand.'}
                  action={can('bookings.create') ? <button onClick={() => setCreating(true)} className="btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> New trip</button> : undefined}
                />
              }
              columns={[
                { key: 'trip_id', header: 'Trip ID', render: (r) => (
                  <div className="min-w-[10.5rem]">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-mono text-[11px] font-semibold text-brand-700">{r.trip_id}</span>
                      <span className={`rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset ${SOURCE_CHIP[r.inquiry_source] ?? SOURCE_CHIP.VENDOR}`}>
                        {SOURCES.find((s) => s.value === r.inquiry_source)?.short ?? r.inquiry_source}
                      </span>
                    </span>
                    {r.vendor_booking_ref
                      ? <span className="block whitespace-nowrap font-mono text-2xs text-ink-600" title="Company's booking reference">Ref {r.vendor_booking_ref}</span>
                      : <span className="block whitespace-nowrap text-2xs text-ink-400">{dmyTime(r.created_at)}</span>}
                    {r.event_name && <span className="block truncate text-2xs text-violet-600" title="Event">{r.event_name}</span>}
                    {(r.duplicates?.length > 0 || r.missing?.length > 0) && (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {r.duplicates?.length > 0 && <span className="badge-violet !px-1.5 !text-[10px]" title={`Also: ${r.duplicates.join(', ')}`}>Possible duplicate</span>}
                        {r.missing?.length > 0 && <span className="badge-warn !px-1.5 !text-[10px]" title={`Missing: ${r.missing.join(', ')}`}>{r.missing.length} missing</span>}
                      </span>
                    )}
                  </div>
                ) },
                { key: 'customer_name', header: 'Company / passenger', render: (r) => (
                  <div className="max-w-[13rem]">
                    <span className="block truncate text-2xs font-semibold uppercase tracking-wide text-ink-500">{r.vendor_code === 'DIRECT' ? (r.customer_name || 'Direct customer') : r.vendor_name}</span>
                    <span className="block truncate font-medium text-ink-800">{r.passenger_name || r.customer_name || '—'}</span>
                    <span className="block truncate text-2xs text-ink-500">{r.passenger_mobile || r.customer_mobile || '—'}</span>
                    {r.owner_name && <span className="block truncate text-2xs text-violet-600">with {r.owner_name}</span>}
                  </div>
                ) },
                { key: 'journey', header: 'Journey', sortable: false, render: (r) => (
                  <div className="max-w-[14rem]">
                    <span className="block truncate text-ink-700" title={[r.pickup_location, r.drop_location].filter(Boolean).join(' → ')}>{[r.pickup_location, r.drop_location].filter(Boolean).join('  →  ') || '—'}</span>
                    <span className="block truncate text-2xs text-ink-400">{humanise(r.trip_type)}{r.pax_count ? ` · ${r.pax_count} pax` : ''}</span>
                  </div>
                ) },
                { key: 'travel_date', header: 'Travel', render: (r) => (
                  <div className="whitespace-nowrap">{dmy(r.travel_date)}{r.reporting_time && <span className="block text-2xs text-ink-500">{r.reporting_time}</span>}</div>
                ) },
                { key: 'vehicle', header: 'Vehicle & driver', sortable: false, render: (r) => (
                  <div className="max-w-[11rem]">
                    <span className="block truncate text-2xs text-ink-500">{r.category_name || r.vehicle_type || '—'}</span>
                    {r.vehicle_number || r.driver_name ? (
                      <>
                        <span className="block truncate font-mono text-2xs text-ink-800">{r.vehicle_number || '—'}</span>
                        <span className="block truncate text-2xs text-ink-500">{r.driver_name || 'No driver'}</span>
                      </>
                    ) : <span className="text-2xs text-ink-400">Not allotted</span>}
                  </div>
                ) },
                { key: 'total_amount', header: 'Fare', align: 'right', render: (r) => r.total_amount ? inr(r.total_amount) : <span className="text-ink-400">—</span> },
                { key: 'stage', header: 'Stage', sortable: false, render: (r) => <StatusBadge value={r.stage} /> },
                { key: 'invoice', header: 'Billing · invoice · payment', sortable: false, render: (r) => (
                  <div className="min-w-[9rem] space-y-0.5 text-2xs">
                    <span className="block text-ink-600">
                      {r.invoice_number ? 'Billed' : r.billing_confirmed_at ? 'Billing confirmed' : r.booking_status === 'COMPLETED' ? 'Billing pending' : '—'}
                    </span>
                    {r.invoice_number ? (
                      <>
                        <span className="block font-mono font-semibold text-ok-700">{r.invoice_number}</span>
                        <span className={`block font-semibold ${r.payment_overdue ? 'text-danger-700' : Number(r.invoice_outstanding) > 0.005 ? 'text-warn-700' : 'text-ok-700'}`}>
                          {Number(r.invoice_outstanding) > 0.005
                            ? `${r.payment_overdue ? 'Overdue' : Number(r.invoice_paid) > 0 ? 'Part-paid' : 'Unpaid'} · ${inr(r.invoice_outstanding)} due`
                            : 'Paid'}
                        </span>
                      </>
                    ) : <span className="block text-ink-400">Not invoiced</span>}
                  </div>
                ) },
              ]}
            />
            <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
          </>
        )}
      </section>

      {openId !== null && (
        <TripDrawer id={openId} meta={meta} onClose={() => setOpenId(null)} onChanged={load} />
      )}

      {creating && (
        <NewTripModal
          meta={meta}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); setOpenId(id); toast.info('Trip opened', 'Carry on with the next step in the drawer.'); }}
          onOpenExisting={(id) => { setCreating(false); setOpenId(id); }}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   The drawer — one trip, its whole lifecycle
   ========================================================================== */

interface Detail {
  data: any;
  trip: any;
  stage: { key: string; label: string; action: string; description: string; phase: string } | null;
  missing: string[];
  summary: string;
  duplicates: string[];
  window: { start: string; end: string; allDay: boolean };
  assignments: any[];
  timeline: any[];
  nextStatuses: { value: string; label: string }[];
  emails: any[];
  feedback: FeedbackInfo | null;
}

interface FeedbackInfo {
  id: number;
  status: 'PENDING' | 'SUBMITTED';
  emailStatus: 'SENT' | 'QUEUED' | 'FAILED' | 'NO_EMAIL' | null;
  sentTo: string | null;
  requestedAt: string;
  submittedAt: string | null;
  allowResubmit: boolean;
  driverRating: number | null;
  serviceRating: number | null;
  vehicleRating: number | null;
  overallRating: number | null;
  comments: string | null;
}

type DrawerTab = 'overview' | 'edit' | 'assign' | 'fare' | 'billing' | 'invoice' | 'payments' | 'activity';

function TripDrawer({ id, meta, onClose, onChanged }: { id: number; meta: any; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [completeOpen, setCompleteOpen] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { await load(); onChanged(); };
  const b = d?.data;

  // Open on the tab the next step lives on.
  useEffect(() => {
    if (!d?.stage) return;
    const k = d.stage.key;
    if (k === 'AWAITING_ASSIGNMENT') setTab('assign');
    else if (k === 'ASSIGNED_TO_STAFF') setTab('fare');
    else if (k === 'AWAITING_BILLING' || k === 'BILLING_IN_PROGRESS') setTab('billing');
    else if (k === 'AWAITING_INVOICE') setTab('invoice');
    else if (k === 'BILLED') setTab('payments');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.data?.id]);

  const tabs: [DrawerTab, string][] = [
    ['overview', 'Overview'], ['edit', 'Booking details'], ['assign', 'Vehicle & driver'],
    ['fare', 'Fare'], ['billing', 'Billing'], ['invoice', 'Invoice'], ['payments', 'Payments'], ['activity', 'Activity'],
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      width="max-w-4xl"
      title={b?.trip_id ?? 'Trip'}
      subtitle={b ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>{b.customer_name || b.passenger_name || '—'} · {dmy(b.travel_date)}{b.reporting_time ? ` at ${b.reporting_time}` : ''}</span>
          {d?.stage && <StatusBadge value={d.stage.key} />}
          <span className={`inline-block rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wide ring-1 ring-inset ${SOURCE_CHIP[b.inquiry_source] ?? SOURCE_CHIP.VENDOR}`}>
            {SOURCES.find((s) => s.value === b.inquiry_source)?.short ?? b.inquiry_source}
          </span>
        </span>
      ) : undefined}
    >
      {loading && !d ? (
        <div className="flex items-center gap-2 py-6 text-sm text-ink-500"><Spinner /> Opening the trip…</div>
      ) : d && b ? (
        <div className="space-y-4">
          <StatusStrip status={b.booking_status} hasInvoice={!!b.invoice_id} />

          {d.stage && !['BILLED', 'CANCELLED', 'SETTLED'].includes(d.stage.key) && (
            <div className="flex items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/70 px-4 py-3">
              <IconSparkle className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-brand-900">Next: {d.stage.action}</p>
                <p className="text-brand-800/80">{d.summary}</p>
              </div>
            </div>
          )}
          {(d.missing.length > 0 || d.duplicates.length > 0) && (
            <div className="flex flex-wrap gap-2">
              {d.missing.length > 0 && (
                <p className="notice-warn flex-1 !py-2.5 text-xs"><IconWarning className="h-4 w-4 shrink-0" /> Missing: {d.missing.join(', ')}.</p>
              )}
              {d.duplicates.length > 0 && (
                <p className="notice-info flex-1 !py-2.5 text-xs">Possible duplicate of {d.duplicates.join(', ')} — same mobile and pickup within a day. Cancel one as “Duplicate enquiry” if so.</p>
              )}
            </div>
          )}

          <div className="flex gap-1 overflow-x-auto border-b border-ink-200 no-scrollbar">
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`relative shrink-0 px-3.5 py-2 text-sm font-semibold transition-colors ${tab === k ? 'text-brand-700' : 'text-ink-500 hover:text-ink-800'}`}>
                {label}
                {tab === k && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />}
              </button>
            ))}
          </div>

          {tab === 'overview' && <Overview d={d} meta={meta} onRefresh={refresh} goTo={setTab} onComplete={() => setCompleteOpen(true)} />}
          {tab === 'edit' && <EditPanel d={d} meta={meta} onRefresh={refresh} canEdit={can('bookings.update')} />}
          {tab === 'assign' && <AssignPanel d={d} onRefresh={refresh} canEdit={can('bookings.update')} />}
          {tab === 'fare' && <FarePanel d={d} onRefresh={refresh} canEdit={can('bookings.update')} />}
          {tab === 'billing' && <BillingPanel trip={b} onRefresh={refresh} onComplete={() => setCompleteOpen(true)} />}
          {tab === 'invoice' && <InvoicePanel d={d} onRefresh={refresh} canEdit={can('invoices.create')} />}
          {tab === 'payments' && <PaymentsPanel trip={b} />}
          {tab === 'activity' && <ActivityPanel d={d} />}
          <CompleteModal open={completeOpen} trip={b} onClose={() => setCompleteOpen(false)}
            onDone={() => { setCompleteOpen(false); setTab('billing'); refresh(); }} />
        </div>
      ) : null}
    </Drawer>
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
      : i < at || (i === at && status === 'COMPLETED') ? 'done'
        : i === at ? 'now'
          : 'off',
  }));
  steps.push({ label: 'Invoiced', state: hasInvoice ? 'done' : 'off' });

  return (
    <ol className="flex items-center gap-1 overflow-x-auto rounded-lg bg-ink-50 p-2 no-scrollbar">
      {steps.map((s, i) => (
        <li key={s.label} className="flex shrink-0 items-center gap-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-wide transition-colors duration-300 ${
            s.state === 'done' ? 'bg-ok-500 text-white' : s.state === 'now' ? 'bg-brand-600 text-white' : 'bg-white text-ink-400'}`}>
            {s.state === 'done' && <IconCheck className="h-3 w-3" />}
            {s.label}
          </span>
          {i < steps.length - 1 && <span className={`h-0.5 w-3 rounded-full ${s.state === 'done' ? 'bg-ok-300' : 'bg-ink-200'}`} />}
        </li>
      ))}
      {stopped && <li className="ml-2 shrink-0"><StatusBadge value={status} /></li>}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */

function Overview({ d, meta, onRefresh, goTo, onComplete }: { d: Detail; meta: any; onRefresh: () => void; goTo: (t: DrawerTab) => void; onComplete: () => void }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const b = d.data;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const editable = can('bookings.update');

  async function post(path: string, body: any, key: string, title: string) {
    setBusy(key);
    try {
      const { data } = await api.post(`/trips/${b.id}/${path}`, body);
      toast.success(title, data.message);
      if (data.feedback && !data.feedback.ok) toast.warning('Feedback email', data.feedback.message);
      setNote('');
      onRefresh();
      return true;
    } catch (err) {
      toast.error(`Could not ${title.toLowerCase()}`, errorMessage(err));
      return false;
    } finally { setBusy(''); }
  }

  const move = (status: string) => post('status', { status, note }, status, 'Update the status');
  const isEnquiry = b.booking_status === 'INQUIRY';
  const nextMoves = d.nextStatuses.filter((s) => !['CANCELLED', 'NO_SHOW', 'ASSIGNED'].includes(s.value));
  const priced = Number(b.total_amount ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* --- what to do now --- */}
      {editable && (
        <Panel title="Take it forward">
          {isEnquiry && (
            <div className="mb-3 grid gap-2 sm:grid-cols-[1fr,auto]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-ink-600">Handled by</span>
                <select className="input h-9 w-auto text-[13px]" value={b.owner_user_id ?? ''} disabled={!!busy}
                  onChange={(e) => post('owner', { userId: e.target.value ? Number(e.target.value) : null }, 'owner', 'Change the owner')}>
                  <option value="">Nobody yet</option>
                  {(meta?.staff ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
                {!b.owner_user_id && (
                  <button className="btn-outline btn-sm" disabled={!!busy} onClick={() => post('owner', { userId: user?.id }, 'owner', 'Pick it up')}>
                    {busy === 'owner' ? <Spinner /> : <IconUsers className="h-3.5 w-3.5" />} Pick it up
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!priced && <button className="btn-outline btn-sm" onClick={() => goTo('fare')}><IconRupee className="h-3.5 w-3.5" /> Work out the fare</button>}
                {priced && b.quote_status !== 'SENT' && (
                  <button className="btn-primary btn-sm" onClick={() => setQuoteOpen(true)}><IconMail className="h-3.5 w-3.5" /> Send quotation</button>
                )}
                {b.quote_status === 'SENT' && (
                  <>
                    <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => post('quote-response', { accepted: true }, 'accept', 'Confirm the booking')}>
                      <IconCheck className="h-3.5 w-3.5" /> Customer accepted
                    </button>
                    <button className="btn-outline btn-sm" disabled={!!busy} onClick={() => post('quote-response', { accepted: false }, 'decline', 'Record the decline')}>Declined</button>
                  </>
                )}
              </div>
            </div>
          )}
          {b.quote_status && (
            <p className="mb-3 text-xs text-ink-500">
              Quotation <StatusBadge value={b.quote_status} /> {b.quote_sent_at ? `· sent ${dmyTime(b.quote_sent_at)}` : ''} {b.quote_amount ? `· ${inr(b.quote_amount)}` : ''}
            </p>
          )}

          {(nextMoves.length > 0 || d.nextStatuses.some((s) => s.value === 'CANCELLED')) && (
            <>
              <input className="input h-9 text-[13px]" placeholder="A note for the timeline (optional) — e.g. customer asked to shift to 7am"
                value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="mt-2.5 flex flex-wrap gap-2">
                {['CONFIRMED', 'INQUIRY'].includes(b.booking_status) && (
                  <button className="btn-outline btn-sm" onClick={() => goTo('assign')}><IconSteering className="h-3.5 w-3.5" /> Allot vehicle &amp; driver</button>
                )}
                {nextMoves.map((s) => (
                  <button key={s.value} onClick={() => (s.value === 'COMPLETED' ? onComplete() : move(s.value))} disabled={!!busy}
                    className={`btn-sm ${s.value === 'COMPLETED' || s.value === 'ONTRIP' || (s.value === 'CONFIRMED' && isEnquiry) ? 'btn-primary' : 'btn-outline'}`}>
                    {busy === s.value && <Spinner />}
                    {s.value === 'COMPLETED' ? 'Mark trip completed' : s.value === 'ONTRIP' ? 'Start the trip' : s.value === 'CONFIRMED' && isEnquiry ? 'Confirm booking' : s.label}
                  </button>
                ))}
                {d.nextStatuses.some((s) => s.value === 'NO_SHOW') && (
                  <button onClick={() => move('NO_SHOW')} disabled={!!busy} className="btn-outline btn-sm text-danger-600">No show</button>
                )}
                {d.nextStatuses.some((s) => s.value === 'CANCELLED') && (
                  <button onClick={() => setCancelOpen(true)} disabled={!!busy} className="btn-outline btn-sm text-danger-600">Cancel trip…</button>
                )}
              </div>
              {d.nextStatuses.some((s) => s.value === 'COMPLETED') && !d.feedback && (
                <p className="mt-2 text-xs text-ink-500">Completing the trip records the actual km, hours and extras, and emails the customer a <strong>Give your feedback</strong> link, once.</p>
              )}
            </>
          )}
          {b.booking_status === 'COMPLETED' && !b.invoice_id && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {b.billing_confirmed_at
                ? <span className="badge-ok">Billing confirmed</span>
                : <span className="badge-warn">Billing not confirmed</span>}
              <button className="btn-outline btn-sm" onClick={() => goTo('billing')}>
                {b.billing_confirmed_at ? 'Billing details' : 'Check charges & confirm billing'}
              </button>
              {b.billing_confirmed_at && <button className="btn-primary btn-sm" onClick={() => goTo('invoice')}><IconInvoices className="h-3.5 w-3.5" /> Raise invoice</button>}
            </div>
          )}
          {b.booking_status === 'CANCELLED' && b.cancel_reason && (
            <p className="mt-2 text-sm text-danger-700">Cancelled — {meta?.cancelReasons?.find((r: any) => r.code === b.cancel_reason)?.label ?? humanise(b.cancel_reason)}</p>
          )}
        </Panel>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Customer">
          <Row label="Name" value={b.customer_name || b.passenger_name} />
          <Row label="Mobile" value={b.customer_mobile || b.passenger_mobile} href={b.customer_mobile ? `tel:+91${b.customer_mobile}` : undefined} />
          <Row label="Email" value={b.customer_email || b.passenger_email} href={b.customer_email ? `mailto:${b.customer_email}` : undefined} />
          <Row label="Passengers" value={b.pax_count} />
          <Row label="Company" value={b.vendor_code === 'DIRECT' ? 'Direct / walk-in customer' : b.vendor_name} />
          {b.vendor_booking_ref && <Row label="Company ref" value={b.vendor_booking_ref} />}
          {b.event_name && <Row label="Event" value={b.event_name} />}
          <Row label="Website account" value={b.customer_id ? 'Linked' : 'Not linked'} />
        </Panel>

        <Panel title="Journey">
          <Row label="Trip type" value={humanise(b.trip_type)} />
          {b.trip_type === 'AIRPORT' && (
            <Row label="Airport" value={b.airport_direction === 'TO' ? 'To airport (drop)' : b.airport_direction === 'FROM' ? 'From airport (pickup)' : 'Direction not set'} />
          )}
          <Row label="Pickup" value={b.pickup_address || b.pickup_location} />
          <Row label="Drop" value={b.drop_address || b.drop_location} />
          <Row label="Date" value={`${dmy(b.travel_date)}${b.travel_date_to && b.travel_date_to !== b.travel_date ? ` → ${dmy(b.travel_date_to)}` : ''}`} />
          <Row label="Time" value={b.reporting_time} />
          <Row label="Vehicle" value={b.category_name || b.vehicle_type} />
          <Row label="Booked for" value={d.window.allDay ? 'the whole day' : `${d.window.start.slice(11)} – ${d.window.end.slice(11)}`} />
        </Panel>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Allotment" action={<button className="btn-ghost btn-sm" onClick={() => goTo('assign')}>Change</button>}>
          <Row label="Vehicle number" value={b.vehicle_number} />
          <Row label="Driver" value={b.driver_name} />
          <Row label="Driver mobile" value={b.driver_mobile} href={b.driver_mobile ? `tel:+91${b.driver_mobile}` : undefined} />
          <Row label="Allotted at" value={b.assigned_at ? dmyTime(b.assigned_at) : null} />
        </Panel>
        <Panel title="Money" action={<button className="btn-ghost btn-sm" onClick={() => goTo('fare')}>Fare</button>}>
          <Row label="Fare" value={priced ? inr(b.total_amount) : null} />
          <Row label="Billing" value={b.billing_confirmed_at ? `Confirmed ${dmy(b.billing_confirmed_at)}` : humanise(b.billing_status)} />
          <Row label="Invoice" value={b.invoice_number} />
          {b.invoice_id && <Row label="Received" value={`${inr(b.invoice_paid ?? 0)} · outstanding ${inr(b.invoice_outstanding ?? 0)}`} />}
          {b.invoice_due_date && Number(b.invoice_outstanding) > 0.005 && <Row label="Due" value={`${dmy(b.invoice_due_date)}${b.invoice_due_date < todayIso() ? ' — overdue' : ''}`} />}
          <Row label="Supplier cost" value={b.supplier_cost ? `${inr(b.supplier_cost)} → ${b.supplier_name}` : null} />
        </Panel>
      </div>

      {b.inquiry_message && (
        <Panel title="What the customer told us">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{b.inquiry_message}</p>
        </Panel>
      )}

      {(b.booking_status === 'COMPLETED' || d.feedback) && <FeedbackPanel d={d} onRefresh={onRefresh} />}

      <EmailsPanel d={d} onRefresh={onRefresh} />

      <CancelModal open={cancelOpen} onClose={() => setCancelOpen(false)} reasons={meta?.cancelReasons ?? []}
        onConfirm={async (reason, why) => {
          const ok = await post('status', { status: 'CANCELLED', cancelReason: reason, note: why }, 'CANCELLED', 'Cancel the trip');
          if (ok) setCancelOpen(false);
        }} busy={busy === 'CANCELLED'} tripId={b.trip_id} />
      <QuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} d={d} onSent={() => { setQuoteOpen(false); onRefresh(); }} />
    </div>
  );
}

function CancelModal({ open, onClose, reasons, onConfirm, busy, tripId }: {
  open: boolean; onClose: () => void; reasons: { code: string; label: string }[];
  onConfirm: (reason: string, note: string) => void; busy: boolean; tripId: string;
}) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (open) { setReason(''); setNote(''); } }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Cancel ${tripId}?`} subtitle="The vehicle and driver are released. The trip stays on record."
      footer={<><button className="btn-outline" onClick={onClose}>Keep the trip</button><button className="btn-danger" disabled={!reason || busy} onClick={() => onConfirm(reason, note)}>{busy && <Spinner />} Cancel trip</button></>}>
      <div className="space-y-3">
        <Field label="Reason" required>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus>
            <option value="">Choose…</option>
            {reasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Note" hint="Optional, kept on the timeline">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function QuoteModal({ open, onClose, d, onSent }: { open: boolean; onClose: () => void; d: Detail; onSent: () => void }) {
  const toast = useToast();
  const b = d.data;
  const [email, setEmail] = useState(true);
  const [to, setTo] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTo(b.customer_email || b.passenger_email || ''); setEmail(!!(b.customer_email || b.passenger_email)); } }, [open, b]);
  const send = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/quote`, { email, emailTo: email ? to : '', validUntil, message });
      toast.success('Quotation recorded', data.message);
      onSent();
    } catch (err) { toast.error('Quotation not sent', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Quotation for ${b.trip_id}`} subtitle={`${inr(b.total_amount)} — the fare on the Fare tab.`}
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || (email && !to)} onClick={send}>{busy && <Spinner />} {email ? 'Email quotation' : 'Mark as quoted'}</button></>}>
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setEmail(true)} className={`option ${email ? 'option-on' : ''}`}>
            <span><span className="block text-sm font-semibold text-ink-900">Email it</span><span className="block text-xs text-ink-500">Journey, fare breakdown and how to confirm</span></span>
          </button>
          <button type="button" onClick={() => setEmail(false)} className={`option ${!email ? 'option-on' : ''}`}>
            <span><span className="block text-sm font-semibold text-ink-900">Quoted by phone / WhatsApp</span><span className="block text-xs text-ink-500">Just record that it was given</span></span>
          </button>
        </div>
        {email && <Field label="Send to" required><input className="input" type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valid until" hint="Optional"><DateField value={validUntil} onChange={setValidUntil} min={todayIso()} /></Field>
        </div>
        <Field label="Message" hint="Optional line in the email"><textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        {b.customer_mobile && (
          <p className="text-xs text-ink-500">
            For WhatsApp:{' '}
            <a className="font-semibold text-[#128C43] hover:underline" target="_blank" rel="noreferrer"
              href={`https://wa.me/91${b.customer_mobile}?text=${encodeURIComponent(`Hello ${b.customer_name ?? ''}, the fare for your trip ${b.trip_id} on ${dmy(b.travel_date)} (${[b.pickup_location, b.drop_location].filter(Boolean).join(' to ')}) is ${inr(b.total_amount)}. Reply YES to confirm.`)}`}>
              open a ready-written message
            </a>{' '}— then choose “Quoted by phone / WhatsApp”.
          </p>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function Stars({ value }: { value: number | null }) {
  if (!value) return <span className="text-ink-400">—</span>;
  return (
    <span className="whitespace-nowrap text-sm tracking-tight" aria-label={`${value} out of 5`}>
      <span className="text-gold-500">{'★'.repeat(value)}</span>
      <span className="text-ink-200">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

/** Whether the customer has been asked, and what they said. */
function FeedbackPanel({ d, onRefresh }: { d: Detail; onRefresh: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const b = d.data;
  const f = d.feedback;
  const [busy, setBusy] = useState('');

  async function send() {
    setBusy('send');
    try {
      const { data } = await api.post(`/feedback/request/${b.id}`, {});
      if (data.ok) toast.success('Feedback email sent', data.message);
      else toast.error('Feedback email not sent yet', data.message);
      onRefresh();
    } catch (err) {
      toast.error('Could not send the feedback email', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  async function reopen() {
    if (!f) return;
    setBusy('reopen');
    try {
      const { data } = await api.post(`/feedback/${f.id}/allow-resubmit`, {});
      toast.success('Feedback re-opened', data.message);
      onRefresh();
    } catch (err) {
      toast.error('Could not re-open the feedback', errorMessage(err));
    } finally {
      setBusy('');
    }
  }

  const emailNote = !f ? 'Not requested yet.'
    : f.emailStatus === 'SENT' ? `Emailed to ${f.sentTo} on ${dmyTime(f.requestedAt)}.`
      : f.emailStatus === 'NO_EMAIL' ? 'No email address on this trip, so the link could not be sent.'
        : f.emailStatus === 'FAILED' ? `The email to ${f.sentTo} failed — see Emails sent below.`
          : `Queued for ${f.sentTo ?? 'the customer'} — it goes out once the mailbox is set up.`;

  return (
    <Panel
      title="Customer feedback"
      action={
        can('bookings.update') && (!f || f.status === 'PENDING' || f.allowResubmit) ? (
          <button onClick={send} disabled={!!busy} className="btn-outline btn-sm">
            {busy === 'send' ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />} {f ? 'Send again' : 'Send feedback email'}
          </button>
        ) : undefined
      }
    >
      {f?.status === 'SUBMITTED' ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
            {([['Driver', f.driverRating], ['Service', f.serviceRating], ['Cab', f.vehicleRating], ['Overall', f.overallRating]] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-2xs font-bold uppercase tracking-wide text-ink-400">{k}</dt>
                <dd><Stars value={v} /></dd>
              </div>
            ))}
          </dl>
          {f.comments && <p className="whitespace-pre-wrap rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{f.comments}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
            <span>Submitted {f.submittedAt ? dmyTime(f.submittedAt) : ''}{f.allowResubmit ? ' · re-opened for one more response' : ''}</span>
            {can('bookings.update') && !f.allowResubmit && (
              <button onClick={reopen} disabled={!!busy} className="btn-ghost btn-sm">{busy === 'reopen' && <Spinner />} Allow a new response</button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-600">
          {f ? <><StatusBadge value="PENDING" /> <span className="ml-1">Waiting for the customer.</span> </> : null}
          <span className="text-ink-500">{emailNote}</span>
        </p>
      )}
    </Panel>
  );
}

function EmailsPanel({ d, onRefresh }: { d: Detail; onRefresh: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const b = d.data;
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/send-details`, {});
      toast.success('Trip details emailed', data.message);
      onRefresh();
    } catch (err) { toast.error('The email did not go out', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Panel
      title="Emails sent"
      action={can('bookings.update') && (b.customer_email || b.passenger_email) && b.vehicle_number ? (
        <button onClick={resend} disabled={busy} className="btn-outline btn-sm">{busy ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />} Send trip details</button>
      ) : undefined}
    >
      {d.emails.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing sent for this trip yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {d.emails.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
              <span className={`badge-${e.status === 'SENT' ? 'ok' : e.status === 'FAILED' ? 'danger' : 'warn'} shrink-0`}>{humanise(e.status)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-700">{e.subject}</span>
              <span className="shrink-0 text-ink-400">{e.to_address}</span>
              <span className="shrink-0 text-ink-400">{dmyTime(e.sent_at ?? e.created_at)}</span>
              {e.error && <span className="w-full text-2xs leading-relaxed text-danger-600">{e.error}</span>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ActivityPanel({ d }: { d: Detail }) {
  return (
    <div className="space-y-4">
      <Panel title="Activity">
        <ol className="space-y-0">
          {d.timeline.map((e, i) => (
            <li key={e.id} className="flex gap-3">
              <span className="relative flex w-3 shrink-0 justify-center">
                <span className={`z-10 mt-1.5 h-2 w-2 rounded-full ring-4 ring-white ${e.is_public ? 'bg-brand-500' : 'bg-ink-300'}`} />
                {i < d.timeline.length - 1 && <span className="absolute bottom-0 top-3.5 w-0.5 rounded-full bg-ink-200" />}
              </span>
              <span className={`min-w-0 flex-1 ${i < d.timeline.length - 1 ? 'pb-3' : ''}`}>
                <span className="block text-sm font-medium text-ink-800">{e.title}{!e.is_public && <span className="ml-2 text-2xs font-normal text-ink-400">internal</span>}</span>
                {e.detail && <span className="block whitespace-pre-wrap text-xs text-ink-500">{e.detail}</span>}
                <span className="block text-2xs text-ink-400">{dmyTime(e.created_at)}{e.by_name ? ` · ${e.by_name}` : ''}</span>
              </span>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel title="Vehicle and driver history">
        {d.assignments.length === 0 ? <p className="text-sm text-ink-500">Not allotted yet.</p> : (
          <ul className="divide-y divide-ink-100 text-sm">
            {d.assignments.map((a) => (
              <li key={a.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-ink-800">{[a.vehicle_number, a.driver_name].filter(Boolean).join(' · ')}</span>
                  <span className="text-xs text-ink-500">{dmyTime(a.assigned_at)}{a.assigned_by_name ? ` · ${a.assigned_by_name}` : ''}</span>
                </div>
                <p className="text-xs text-ink-500">
                  Busy {a.window_start} → {a.window_end?.slice(11)}
                  {a.released_at ? ` · released ${dmyTime(a.released_at)} (${a.release_reason})` : ' · current'}
                </p>
                {a.override_reason && <p className="text-xs text-warn-700">Clash overridden: {a.override_reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function EditPanel({ d, meta, onRefresh, canEdit }: { d: Detail; meta: any; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const b = d.data;
  const locked = b.billing_status === 'INVOICED';
  const [f, setF] = useState({
    customerName: b.customer_name || b.passenger_name || '', customerMobile: b.customer_mobile || b.passenger_mobile || '',
    customerEmail: b.customer_email || b.passenger_email || '', tripType: b.trip_type || 'LOCAL',
    airportDirection: (b.airport_direction || '') as AirportDir, pickup: b.pickup_location || '', pickupAddress: b.pickup_address || '',
    dropOff: b.drop_location || '', dropAddress: b.drop_address || '', travelDate: b.travel_date || '', travelDateTo: b.travel_date_to || '',
    journeyTime: b.reporting_time || '', vehicleCategoryId: b.vehicle_category_id ? String(b.vehicle_category_id) : '',
    vehicleType: b.vehicle_type || '', passengers: String(b.pax_count ?? 1), message: b.inquiry_message || '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const airport = f.tripType === 'AIRPORT';
  const ends = airportEnds(f.airportDirection);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put(`/trips/${b.id}`, {
        ...f, passengers: Number(f.passengers) || 1,
        vehicleCategoryId: f.vehicleCategoryId ? Number(f.vehicleCategoryId) : null,
      });
      toast.success('Trip details saved', data.message);
      onRefresh();
    } catch (err) { toast.error('Could not save', errorMessage(err)); } finally { setBusy(false); }
  };

  if (locked) {
    return <p className="notice-info">This trip is on invoice <strong className="font-mono">{b.invoice_number}</strong>, so its journey details are fixed — the invoice prints them. Cancel the invoice first if they must change.</p>;
  }

  return (
    <div className="space-y-4">
      <Panel title="Customer">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" required><input className="input" value={f.customerName} disabled={!canEdit} onChange={(e) => set('customerName', e.target.value)} /></Field>
          <Field label="Mobile"><input className="input" inputMode="numeric" value={f.customerMobile} disabled={!canEdit} onChange={(e) => set('customerMobile', e.target.value)} /></Field>
          <Field label="Email"><input className="input" type="email" value={f.customerEmail} disabled={!canEdit} onChange={(e) => set('customerEmail', e.target.value)} /></Field>
        </div>
      </Panel>
      <Panel title="Journey">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Trip type">
            <select className="input" value={f.tripType} disabled={!canEdit} onChange={(e) => set('tripType', e.target.value)}>
              {TRIP_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
            </select>
          </Field>
          <Field label="Vehicle category">
            <select className="input" value={f.vehicleCategoryId} disabled={!canEdit} onChange={(e) => set('vehicleCategoryId', e.target.value)}>
              <option value="">{f.vehicleType ? `${f.vehicleType} (not linked)` : 'Choose…'}</option>
              {(meta?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          {airport && (
            <Field label="Direction" required className="sm:col-span-2"><AirportDirectionPicker value={f.airportDirection} onChange={(v) => set('airportDirection', v)} /></Field>
          )}
          <Field label={airport ? ends.pickup : 'Pickup'} required><input className="input" value={f.pickup} disabled={!canEdit} onChange={(e) => set('pickup', e.target.value)} list="gtt-airports-e" /></Field>
          <Field label={airport ? ends.drop : 'Drop'}><input className="input" value={f.dropOff} disabled={!canEdit} onChange={(e) => set('dropOff', e.target.value)} list="gtt-airports-e" /></Field>
          <datalist id="gtt-airports-e">{AIRPORT_NAMES.map((a) => <option key={a} value={a} />)}</datalist>
          <Field label="Pickup address (full)"><input className="input" value={f.pickupAddress} disabled={!canEdit} onChange={(e) => set('pickupAddress', e.target.value)} /></Field>
          <Field label="Drop address (full)"><input className="input" value={f.dropAddress} disabled={!canEdit} onChange={(e) => set('dropAddress', e.target.value)} /></Field>
          <Field label="Journey date" required><DateField value={f.travelDate} onChange={(v) => set('travelDate', v)} disabled={!canEdit} /></Field>
          <Field label="Return / last day" hint="Multi-day trips"><DateField value={f.travelDateTo} onChange={(v) => set('travelDateTo', v)} min={f.travelDate} disabled={!canEdit} /></Field>
          <Field label="Pickup time"><TimeField value={f.journeyTime} onChange={(v) => set('journeyTime', v)} disabled={!canEdit} /></Field>
          <Field label="Passengers"><input className="input" inputMode="numeric" value={f.passengers} disabled={!canEdit} onChange={(e) => set('passengers', e.target.value)} /></Field>
        </div>
        <Field label="Notes" className="mt-3"><textarea className="input" rows={3} value={f.message} disabled={!canEdit} onChange={(e) => set('message', e.target.value)} /></Field>
      </Panel>
      {canEdit && <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy && <Spinner />} Save trip details</button>}
      <p className="text-xs text-ink-500">Every change is recorded on the Activity tab — field by field, with who made it.</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AssignPanel({ d, onRefresh, canEdit }: { d: Detail; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const { can, user } = useAuth() as any;
  const b = d.data;
  const canOverride = user?.roleCode === 'SUPER_ADMIN' || can('fleet.update');
  const initial: AssignValue = {
    ...EMPTY_ASSIGN,
    vehicleId: b.vehicle_id ?? null, driverId: b.driver_id ?? null,
    vehicleNumber: b.vehicle_number ?? '', driverName: b.driver_name ?? '', driverMobile: b.driver_mobile ?? '',
    outsideVehicle: !b.vehicle_id && !!b.vehicle_number, outsideDriver: !b.driver_id && !!b.driver_name,
  };
  const [value, setValue] = useState<AssignValue>(initial);
  const [check, setCheck] = useState<AssignCheck | null>(null);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [serverConflict, setServerConflict] = useState<string>('');
  const [confirming, setConfirming] = useState(false);

  const hasAllotment = !!(b.vehicle_number || b.driver_name);
  const vehicleChanged = (value.vehicleId ?? null) !== (b.vehicle_id ?? null) || (value.vehicleNumber || '') !== (b.vehicle_number || '');
  const driverChanged = (value.driverId ?? null) !== (b.driver_id ?? null) || (value.driverName || '') !== (b.driver_name || '');
  const changed = vehicleChanged || driverChanged;
  const ready = !!(value.vehicleId || value.vehicleNumber) && !!(value.driverId || value.driverName);
  const needsReason = !!check?.needsOverride || !!serverConflict;

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/assign`, {
        vehicleId: value.vehicleId, driverId: value.driverId,
        vehicleNumber: value.vehicleNumber, vehicleType: b.vehicle_type || undefined,
        driverName: value.driverName, driverMobile: value.driverMobile,
        notifyCustomer: notify, message,
        overrideReason: needsReason ? overrideReason : '',
      });
      toast.success(hasAllotment ? 'Allotment changed' : 'Vehicle and driver assigned', data.message);
      if (data.warning) toast.warning('Allotted with an override', data.warning);
      if (data.email && !data.email.ok) toast.warning('The customer was not emailed', data.email.message);
      setConfirming(false); setServerConflict(''); setOverrideReason('');
      onRefresh();
    } catch (err: any) {
      const body = err?.response?.data;
      if (body?.code === 'ASSIGNMENT_CONFLICT' || body?.code === 'ASSIGNMENT_UNAVAILABLE') {
        setServerConflict(body.error);
        setConfirming(false);
      } else toast.error('Could not assign', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (['CANCELLED', 'NO_SHOW'].includes(b.booking_status)) {
    return <p className="notice-info">This trip is {b.booking_status === 'NO_SHOW' ? 'a no-show' : 'cancelled'}; its vehicle and driver were released. Reopen it from the Overview to allot again.</p>;
  }

  return (
    <div className="space-y-4">
      {/* The trip being allotted, so nobody allots against the wrong one. */}
      <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-3.5 text-sm">
        <p className="font-semibold text-ink-900">{b.trip_id} · {dmy(b.travel_date)}{b.reporting_time ? ` at ${b.reporting_time}` : ''}</p>
        <p className="mt-0.5 text-ink-600">{[b.pickup_location, b.drop_location].filter(Boolean).join(' → ') || 'Route not entered'}</p>
        <p className="mt-0.5 text-xs text-ink-500">
          {[b.category_name || b.vehicle_type, b.pax_count ? `${b.pax_count} pax` : '', humanise(b.trip_type), b.customer_name || b.passenger_name].filter(Boolean).join(' · ')}
        </p>
        {hasAllotment && (
          <p className="mt-2 text-xs text-ink-700">
            Currently: <strong>{b.vehicle_number || '—'}</strong> with <strong>{b.driver_name || '—'}</strong>{b.driver_mobile ? ` (${b.driver_mobile})` : ''}
          </p>
        )}
      </div>

      <AssignPicker trip={{ bookingId: b.id }} value={value} onChange={(v) => { setValue(v); setServerConflict(''); }}
        onCheck={setCheck} disabled={!canEdit} canOverride={canOverride} />

      {(needsReason) && (
        <div className="notice-warn flex-col">
          <p className="flex items-center gap-2 font-semibold"><IconWarning className="h-4 w-4" /> This allotment needs an override</p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs">
            {check?.reasons.map((r, i) => <li key={i}>{r}</li>)}
            {serverConflict && <li>{serverConflict}</li>}
          </ul>
          {canOverride ? (
            <Field label="Allot anyway? Say why (kept with the allotment)" className="mt-1">
              <input className="input" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Airport drop finishes by 9am; evening local starts 6pm" />
            </Field>
          ) : <p className="text-xs">Only a fleet manager can override this. Choose another vehicle or driver.</p>}
        </div>
      )}

      <Panel title="Tell the customer">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!canEdit} className="check mt-0.5" />
          <span>
            Email the trip details as soon as this is saved
            {b.customer_email || b.passenger_email
              ? <> — to <strong className="font-semibold text-ink-900">{b.customer_email || b.passenger_email}</strong></>
              : <span className="text-warn-600"> — no email address on this trip, so nothing can be sent</span>}
          </span>
        </label>
        <textarea className="input mt-3 h-auto py-2" rows={2} value={message} disabled={!canEdit || !notify}
          onChange={(e) => setMessage(e.target.value)} placeholder="An extra line for the email (optional) — e.g. the driver will call 30 minutes before pickup." />
        {(b.customer_mobile || b.passenger_mobile) && (
          <p className="mt-2 text-xs leading-relaxed text-ink-500">
            For WhatsApp, message{' '}
            <a href={`https://wa.me/91${b.customer_mobile || b.passenger_mobile}?text=${encodeURIComponent(
              `Hello ${b.customer_name || b.passenger_name || ''}, your trip ${b.trip_id} is confirmed. Vehicle ${value.vehicleNumber || b.vehicle_type || ''}, driver ${value.driverName || ''}` +
              `${value.driverMobile ? ` (${value.driverMobile})` : ''}. Pickup ${dmy(b.travel_date)}${b.reporting_time ? ` at ${b.reporting_time}` : ''} from ${b.pickup_location ?? ''}.`)}`}
              target="_blank" rel="noreferrer" className="font-semibold text-[#128C43] hover:underline">+91 {b.customer_mobile || b.passenger_mobile}</a>
            {' '}— the message opens ready written (no paid WhatsApp service is used).
          </p>
        )}
      </Panel>

      {canEdit && (
        confirming ? (
          <div className="rounded-xl border border-ink-200 p-4">
            <p className="text-sm font-semibold text-ink-900">Check before saving</p>
            <dl className="mt-2 grid grid-cols-[110px,1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-ink-500">Vehicle</dt>
              <dd>{value.vehicleNumber || '—'} {vehicleChanged && hasAllotment && b.vehicle_number ? <span className="text-xs text-ink-500">(was {b.vehicle_number})</span> : null}</dd>
              <dt className="text-ink-500">Driver</dt>
              <dd>{value.driverName || '—'}{value.driverMobile ? ` · ${value.driverMobile}` : ''} {driverChanged && hasAllotment && b.driver_name ? <span className="text-xs text-ink-500">(was {b.driver_name})</span> : null}</dd>
              <dt className="text-ink-500">Customer email</dt><dd>{notify ? 'Will be sent' : 'Not sent'}</dd>
              {needsReason && <><dt className="text-ink-500">Override</dt><dd>{overrideReason}</dd></>}
            </dl>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn-outline btn-sm" onClick={() => setConfirming(false)}>Back</button>
              <button className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner />} Save allotment</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)}
            disabled={!ready || !changed || (needsReason && (!canOverride || overrideReason.trim().length < 3))}
            className="btn-primary w-full">
            <IconSteering className="h-4 w-4" />
            {!changed && hasAllotment ? 'No change to save'
              : hasAllotment ? (vehicleChanged && driverChanged ? 'Change vehicle and driver' : vehicleChanged ? 'Change vehicle' : 'Change driver')
              : 'Assign vehicle and driver'}
          </button>
        )
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

  const fromRow = () => ({
    baseFare: blank(b.base_fare),
    extraKm: blank(b.extra_km), extraKmRate: blank(b.extra_km_rate),
    extraHours: blank(b.extra_hours), extraHourRate: blank(b.extra_hour_rate),
    toll: blank(b.toll), parking: blank(b.parking), stateTax: blank(b.state_tax),
    driverAllowance: blank(b.driver_allowance), nightCharge: blank(b.night_charge), waitingCharge: blank(b.waiting_charge),
    permit: blank(b.permit), otherCharges: blank(b.other_charges), otherChargesNote: b.other_charges_note ?? '',
    discount: blank(b.discount), advance: blank(b.advance),
    taxMode: (b.tax_mode ?? 'IGST') as string, taxRate: String(b.tax_rate ?? 5),
  });
  const [f, setF] = useState(fromRow);
  const [rule, setRule] = useState<{ id: number; label: string; snapshot: string; total: number } | null>(
    b.fare_rule_id ? { id: b.fare_rule_id, label: (() => { try { const s = JSON.parse(b.fare_snapshot); return `${s.rule.vehicleCategory} · ${s.rule.planLabel}`; } catch { return `Rule #${b.fare_rule_id}`; } })(), snapshot: b.fare_snapshot, total: Number(b.total_amount) } : null
  );
  const [calcOpen, setCalcOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cost, setCost] = useState({ supplierCost: blank(b.supplier_cost), supplierName: b.supplier_name ?? '' });

  const set = (k: keyof ReturnType<typeof fromRow>, v: string) => setF((p) => ({ ...p, [k]: v }));

  // Mirrors services/billing.ts, so the desk sees the total as it types.
  const totals = useMemo(() => {
    const taxable = Math.max(0, num(f.baseFare) + num(f.extraKm) * num(f.extraKmRate) + num(f.extraHours) * num(f.extraHourRate)
      + num(f.driverAllowance) + num(f.permit) + num(f.nightCharge) + num(f.waitingCharge) + num(f.otherCharges) - num(f.discount));
    const rate = f.taxMode === 'NONE' ? 0 : num(f.taxRate);
    const tax = Math.round(taxable * rate) / 100;
    const nonTaxable = num(f.toll) + num(f.parking) + num(f.stateTax);
    const total = Math.round((taxable + tax + nonTaxable) * 100) / 100;
    return { taxable, tax, nonTaxable, total, balance: total - num(f.advance) };
  }, [f]);
  const adjusted = rule && Math.abs(rule.total - totals.total) > 0.009;

  const apply = (q: FareQuote) => {
    const c = q.charges;
    const s = (v: number) => (v ? String(v) : '');
    setF({
      baseFare: s(c.baseFare), extraKm: s(c.extraKm), extraKmRate: s(c.extraKmRate), extraHours: s(c.extraHours),
      extraHourRate: s(c.extraHourRate), toll: s(c.toll), parking: s(c.parking), stateTax: s(c.stateTax),
      driverAllowance: s(c.driverAllowance), nightCharge: s(c.nightCharge), waitingCharge: s(c.waitingCharge),
      permit: s(c.permit), otherCharges: s(c.otherCharges), otherChargesNote: c.otherChargesNote ?? '',
      discount: s(c.discount), advance: f.advance, taxMode: c.taxMode, taxRate: String(c.taxRate),
    });
    setRule({ id: q.rule.id, label: q.rule.label, snapshot: q.snapshot, total: q.totals.totalAmount });
    setCalcOpen(false);
    toast.info('Fare filled from the rule', 'Check it, then Save the fare.');
  };

  async function save() {
    setBusy(true);
    try {
      const { data } = await api.post(`/trips/${b.id}/fare`, {
        baseFare: num(f.baseFare), extraKm: num(f.extraKm), extraKmRate: num(f.extraKmRate),
        extraHours: num(f.extraHours), extraHourRate: num(f.extraHourRate),
        toll: num(f.toll), parking: num(f.parking), stateTax: num(f.stateTax),
        driverAllowance: num(f.driverAllowance), nightCharge: num(f.nightCharge), waitingCharge: num(f.waitingCharge),
        permit: num(f.permit), otherCharges: num(f.otherCharges), otherChargesNote: f.otherChargesNote,
        discount: num(f.discount), advance: num(f.advance),
        taxMode: f.taxMode, taxRate: num(f.taxRate), tollParkingTaxable: false,
        fareRuleId: rule?.id ?? null, fareSnapshot: rule?.snapshot ?? null,
      });
      toast.success('Fare saved', data.message);
      onRefresh();
    } catch (err) {
      toast.error('Could not save the fare', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCost() {
    try {
      const { data } = await api.post(`/trips/${b.id}/cost`, { supplierCost: cost.supplierCost === '' ? null : num(cost.supplierCost), supplierName: cost.supplierName });
      toast.success('Supplier cost saved', data.message);
      onRefresh();
    } catch (err) { toast.error('Could not save the cost', errorMessage(err)); }
  }

  const money = (k: keyof ReturnType<typeof fromRow>, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input text-right tabular-nums" inputMode="decimal" value={f[k]} disabled={!canEdit} onChange={(e) => set(k, e.target.value)} placeholder="0" />
    </Field>
  );

  const costPanel = (
    <Panel title="What this trip costs us (payable)">
      <p className="mb-3 text-xs text-ink-500">For a vehicle that is not your own — what is owed to its owner or partner. Kept apart from the customer's fare; it never appears on an invoice and is settled under Payments → Payables.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr,1fr,auto]">
        <Field label="Supplier cost"><input className="input text-right tabular-nums" inputMode="decimal" value={cost.supplierCost} disabled={!canEdit} onChange={(e) => setCost((c) => ({ ...c, supplierCost: e.target.value }))} placeholder="0" /></Field>
        <Field label="Payable to"><input className="input" value={cost.supplierName} disabled={!canEdit} onChange={(e) => setCost((c) => ({ ...c, supplierName: e.target.value }))} placeholder="Vehicle owner / partner" /></Field>
        {canEdit && <button className="btn-outline btn-sm self-end" onClick={saveCost}>Save cost</button>}
      </div>
      {num(cost.supplierCost) > 0 && Number(b.taxable_amount) > 0 && (
        <p className="mt-2 text-xs text-ink-500">Margin on the taxable fare: <strong className="text-ink-800">{inr(Number(b.taxable_amount) - num(cost.supplierCost))}</strong></p>
      )}
    </Panel>
  );

  if (locked) {
    return (
      <div className="space-y-4">
        <Panel title="Fare">
          <p className="text-sm leading-relaxed text-ink-600">
            This trip is on invoice <strong className="font-mono">{b.invoice_number}</strong>, so the fare is fixed.
            Cancel that invoice from the Invoices screen if it has to change.
          </p>
          <dl className="mt-4 space-y-2 text-sm">
            <Money label="Taxable value" value={b.taxable_amount} />
            <Money label="Tax" value={b.tax_amount} />
            <Money label="Toll, parking & state tax" value={b.non_taxable_amount} />
            <Money label="Total" value={b.total_amount} strong />
          </dl>
          {rule && <p className="mt-3 text-xs text-ink-500">Priced from fare rule {rule.label}.</p>}
        </Panel>
        {costPanel}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-ink-50/70 px-4 py-3">
        <IconCar className="h-4 w-4 text-ink-400" />
        <p className="min-w-0 flex-1 text-sm text-ink-700">
          {rule
            ? <>Priced from <strong>{rule.label}</strong>{adjusted ? <span className="ml-1 text-warn-700">— adjusted by hand afterwards</span> : ''}.</>
            : 'Typed by hand. Use a fare rule so the price follows your Masters.'}
        </p>
        {canEdit && <button className="btn-primary btn-sm" onClick={() => setCalcOpen(true)}>Calculate from fare rule</button>}
        {rule && canEdit && <button className="btn-ghost btn-sm" onClick={() => setRule(null)}>Unlink rule</button>}
      </div>

      <Panel title="What the customer is being charged">
        <div className="grid gap-3 sm:grid-cols-3">
          {money('baseFare', 'Fare', 'Package or km charge')}
          <div className="grid grid-cols-2 gap-2">
            {money('extraKm', 'Extra km')}
            {money('extraKmRate', '₹ / km')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {money('extraHours', 'Extra hrs')}
            {money('extraHourRate', '₹ / hr')}
          </div>
          {money('driverAllowance', 'Driver allowance')}
          {money('nightCharge', 'Night charge')}
          {money('waitingCharge', 'Waiting charge')}
          {money('permit', 'Permit')}
          {money('otherCharges', 'Other charges')}
          <Field label="Other charges are for"><input className="input" value={f.otherChargesNote} disabled={!canEdit} onChange={(e) => set('otherChargesNote', e.target.value)} placeholder="e.g. Decoration" /></Field>
          {money('discount', 'Discount')}
          {money('toll', 'Toll', 'After tax, at actuals')}
          {money('parking', 'Parking', 'After tax, at actuals')}
          {money('stateTax', 'State tax', 'After tax, at actuals')}
          {money('advance', 'Advance received')}
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
            <select className="input tabular-nums" value={String(num(f.taxRate))} disabled={!canEdit || f.taxMode === 'NONE'} onChange={(e) => set('taxRate', e.target.value)}>
              {gstRateOptions(num(f.taxRate)).map((r) => <option key={r} value={String(r)}>{r}%</option>)}
            </select>
          </Field>
        </div>
      </Panel>

      <div className="rounded-lg bg-ink-50 p-4">
        <dl className="space-y-2 text-sm">
          <Money label="Taxable value" value={totals.taxable} />
          <Money label={f.taxMode === 'NONE' ? 'Tax (none)' : gstSummary(f.taxMode, num(f.taxRate))} value={totals.tax} />
          <Money label="Toll, parking & state tax (after tax)" value={totals.nonTaxable} />
          <Money label="Total" value={totals.total} strong />
          {num(f.advance) > 0 && <Money label="Balance due" value={totals.balance} />}
        </dl>
      </div>

      {canEdit && (
        <button onClick={save} disabled={busy} className="btn-primary w-full">{busy && <Spinner />} Save the fare</button>
      )}

      {costPanel}

      <Modal open={calcOpen} onClose={() => setCalcOpen(false)} size="lg" title="Calculate from a fare rule"
        subtitle={`${b.category_name || b.vehicle_type || 'Vehicle'} · ${humanise(b.trip_type)} · ${dmy(b.travel_date)} — the same calculation quotations and invoices use.`}>
        <FareCalculator
          vendorId={b.vendor_id} categoryId={b.vehicle_category_id} vehicleText={b.vehicle_type}
          tripType={b.trip_type} onDate={b.travel_date} onApply={apply} applyLabel="Fill the trip's fare with this"
          initial={{
            distanceKm: b.trip_distance_km ? String(b.trip_distance_km) : '',
            days: b.travel_date_to && b.travel_date_to > b.travel_date
              ? String(Math.round((new Date(b.travel_date_to).getTime() - new Date(b.travel_date).getTime()) / 86_400_000) + 1) : '1',
            toll: blank(b.toll), parking: blank(b.parking),
          }}
        />
      </Modal>
    </div>
  );
}

function Money({ label, value, strong }: { label: string; value: any; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? 'font-semibold text-ink-800' : 'text-ink-500'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'text-lg font-bold text-ink-900' : 'font-medium text-ink-700'}`}>{inr(value ?? 0)}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function InvoicePanel({ d, onRefresh, canEdit }: { d: Detail; onRefresh: () => void; canEdit: boolean }) {
  const toast = useToast();
  const b = d.data;
  const [gst, setGst] = useState(b.tax_mode !== 'NONE');
  const [taxMode, setTaxMode] = useState<'IGST' | 'CGST_SGST'>((b.tax_mode === 'CGST_SGST' ? 'CGST_SGST' : 'IGST'));
  const [taxRate, setTaxRate] = useState(String(b.tax_rate || 5));
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [sendNow, setSendNow] = useState(!!b.customer_email);
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
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ok-700"><IconCheck className="h-4 w-4" /> Invoice raised</p>
          <p className="mt-2 font-mono text-lg font-bold text-ink-900">{b.invoice_number}</p>
          <p className="mt-1 text-sm text-ink-600">
            {dmy(b.invoice_date)} · {inr(b.invoice_total)} ·{' '}
            {b.invoice_tax_mode === 'NONE' ? 'no GST' : `${b.invoice_tax_mode === 'CGST_SGST' ? 'CGST + SGST' : 'IGST'} ${b.invoice_tax_rate}%`}
          </p>
          <p className="mt-2 text-xs text-ink-500">{b.invoice_sent_at ? `Emailed to the customer on ${dmyTime(b.invoice_sent_at)}.` : 'Not emailed to the customer yet.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/admin/invoices/${b.invoice_id}`} className="btn-outline btn-sm"><IconInvoices className="h-3.5 w-3.5" /> Open the invoice</Link>
          <Link to={`/admin/invoices/${b.invoice_id}`} className="btn-outline btn-sm"><IconDownload className="h-3.5 w-3.5" /> Download / print</Link>
          <Link to={`/admin/payments?new=1&invoiceId=${b.invoice_id}`} className="btn-outline btn-sm"><IconRupee className="h-3.5 w-3.5" /> Record payment</Link>
          {canEdit && (
            <button onClick={sendInvoice} disabled={!!busy} className="btn-primary btn-sm">
              {busy === 'send' ? <Spinner /> : <IconMail className="h-3.5 w-3.5" />}{b.invoice_sent_at ? 'Email it again' : 'Email it to the customer'}
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
      {b.inquiry_source === 'VENDOR' && (
        <p className="notice-info text-sm">This is a vendor booking. Vendor trips are usually billed together from <Link to="/admin/billing" className="font-semibold underline">Billing</Link> (one invoice per trip or consolidated). Raising it here creates a single-trip invoice.</p>
      )}
      {!completed && (
        <p className="notice-warn text-sm">Mark the trip <strong>completed</strong> before raising its invoice — the invoice states that the journey took place.</p>
      )}
      {completed && !priced && (
        <p className="notice-warn text-sm">Enter the final charges on the Fare tab first.</p>
      )}

      <Panel title="Invoice type">
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setGst(true)} className={`option ${gst ? 'option-on' : ''}`}>
            <span><span className="block text-sm font-semibold text-ink-900">GST invoice</span><span className="mt-0.5 block text-xs text-ink-500">Tax Invoice with GSTIN and the tax split out</span></span>
          </button>
          <button type="button" onClick={() => setGst(false)} className={`option ${!gst ? 'option-on' : ''}`}>
            <span><span className="block text-sm font-semibold text-ink-900">Non-GST invoice</span><span className="mt-0.5 block text-xs text-ink-500">A plain invoice with no tax lines at all</span></span>
          </button>
        </div>
        {gst && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="GST type">
              <select className="input" value={taxMode} onChange={(e) => setTaxMode(e.target.value as any)}>
                <option value="IGST">IGST (other state)</option>
                <option value="CGST_SGST">CGST + SGST (same state)</option>
              </select>
            </Field>
            <Field label="Rate %">
              <select className="input tabular-nums" value={String(num(taxRate))} onChange={(e) => setTaxRate(e.target.value)}>
                {gstRateOptions(num(taxRate)).map((r) => <option key={r} value={String(r)}>{r}%</option>)}
              </select>
            </Field>
          </div>
        )}
      </Panel>

      <Panel title="Invoice details">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Invoice date"><DateField value={invoiceDate} onChange={setInvoiceDate} /></Field>
          <Field label="Amount" hint="Taken from the fare on this trip"><input className="input tabular-nums" value={inr(b.total_amount ?? 0)} readOnly /></Field>
        </div>
        <Field label="Note on the invoice" className="mt-3"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" /></Field>
        <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} className="check mt-0.5" />
          <span>
            Email it to the customer straight away
            {b.customer_email ? <> — to <strong className="font-semibold text-ink-900">{b.customer_email}</strong></> : <span className="text-warn-600"> — no email address on this trip, so it cannot be sent</span>}
          </span>
        </label>
      </Panel>

      {canEdit && (
        <button onClick={generate} disabled={!!busy || !completed || !priced} className="btn-primary w-full">
          {busy === 'generate' ? <Spinner /> : <IconInvoices className="h-4 w-4" />} Generate {gst ? 'GST' : 'non-GST'} invoice
        </button>
      )}
    </div>
  );
}

/* ==========================================================================
   Small shared pieces
   ========================================================================== */

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-4">
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
        {value ? href ? <a href={href} className="text-brand-700 hover:underline">{value}</a> : String(value) : <span className="text-ink-400">—</span>}
      </dd>
    </div>
  );
}

/* ==========================================================================
   New trip by hand — the phone call and the walk-in
   ========================================================================== */

function NewTripModal({ meta, onClose, onCreated, onOpenExisting }: {
  meta: any; onClose: () => void; onCreated: (id: number) => void; onOpenExisting: (id: number) => void;
}) {
  const toast = useToast();
  const { user } = useAuth();
  const [f, setF] = useState({
    source: 'WALKIN',
    customerName: '', customerMobile: '', customerEmail: '',
    pickup: '', dropOff: '',
    travelDate: todayIso(), travelDateTo: '', journeyTime: '',
    tripType: 'LOCAL', airportDirection: '' as AirportDir, vehicleCategoryId: '', vehicleType: '', passengers: '1',
    message: '', status: 'CONFIRMED', notifyCustomer: true, ownerUserId: '',
  });
  const airport = f.tripType === 'AIRPORT';
  const ends = airportEnds(f.airportDirection);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dups, setDups] = useState<any[] | null>(null);

  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e?: React.FormEvent, allowDuplicate = false) {
    e?.preventDefault();
    setError('');
    if (airport && !f.airportDirection) { setError('Choose the direction first: to the airport, or from the airport.'); return; }
    setBusy(true);
    try {
      const cat = (meta?.categories ?? []).find((c: any) => String(c.id) === f.vehicleCategoryId);
      const { data } = await api.post('/trips', {
        ...f,
        vehicleType: cat?.name ?? f.vehicleType,
        vehicleCategoryId: f.vehicleCategoryId ? Number(f.vehicleCategoryId) : null,
        ownerUserId: f.status === 'INQUIRY' && f.ownerUserId ? Number(f.ownerUserId) : null,
        passengers: Number(f.passengers) || 1,
        allowDuplicate,
      });
      toast.success(`Trip ${data.tripId} created`, data.message);
      onCreated(data.id);
    } catch (err: any) {
      if (err?.response?.data?.code === 'POSSIBLE_DUPLICATE') setDups(err.response.data.duplicates ?? []);
      else setError(errorMessage(err, 'The trip could not be created.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open onClose={onClose} size="lg" title="New trip"
      subtitle="An enquiry or a booking taken by phone, at the counter, by email or WhatsApp. A Trip ID is allocated automatically."
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={(e) => submit(e)} disabled={busy} form="new-trip">{busy && <Spinner />} Create trip</button>
        </>
      }
    >
      <form id="new-trip" onSubmit={submit} className="space-y-4">
        {dups && (
          <div className="notice-warn flex-col">
            <p className="font-semibold">This customer already has an open trip around that date</p>
            <ul className="space-y-1 text-xs">
              {dups.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2">
                  <button type="button" className="font-mono font-semibold underline" onClick={() => onOpenExisting(x.id)}>{x.trip_id}</button>
                  <span>{dmy(x.travel_date)} {x.reporting_time ?? ''} · {[x.pickup_location, x.drop_location].filter(Boolean).join(' → ')} · {humanise(x.booking_status)}</span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button type="button" className="btn-outline btn-sm" onClick={() => setDups(null)}><IconClose className="h-3.5 w-3.5" /> Change details</button>
              <button type="button" className="btn-primary btn-sm" onClick={() => submit(undefined, true)} disabled={busy}>It is a separate journey — create it</button>
            </div>
          </div>
        )}

        <Panel title="How it reached us">
          <div className="flex flex-wrap gap-2">
            {SOURCES.filter((s) => s.value && s.value !== 'VENDOR').map((s) => (
              <button key={s.value} type="button" onClick={() => set('source', s.value)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${f.source === s.value ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Starting point">
              <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
                <option value="CONFIRMED">Booking confirmed — the customer has agreed</option>
                <option value="INQUIRY">Enquiry only — needs a quotation first</option>
              </select>
            </Field>
            {f.status === 'INQUIRY' && (
              <Field label="Handled by">
                <select className="input" value={f.ownerUserId} onChange={(e) => set('ownerUserId', e.target.value)}>
                  <option value="">Leave in New enquiries</option>
                  <option value={String(user?.id ?? '')}>Me</option>
                  {(meta?.staff ?? []).filter((s: any) => s.id !== user?.id).map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </Field>
            )}
          </div>
        </Panel>

        <Panel title="Customer">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name" required><input className="input" value={f.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Full name" autoFocus /></Field>
            <Field label="Mobile" required><input className="input" value={f.customerMobile} inputMode="numeric" maxLength={13} onChange={(e) => set('customerMobile', e.target.value)} placeholder="10-digit mobile" /></Field>
            <Field label="Email" hint="Needed to email quotations, trip details and invoices"><input className="input" type="email" value={f.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="name@example.com" /></Field>
          </div>
        </Panel>

        <Panel title="Journey">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Trip type">
              <select className="input" value={f.tripType} onChange={(e) => set('tripType', e.target.value)}>
                {TRIP_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
              </select>
            </Field>
            <Field label="Vehicle category">
              <select className="input" value={f.vehicleCategoryId} onChange={(e) => set('vehicleCategoryId', e.target.value)}>
                <option value="">Not decided yet</option>
                {(meta?.categories ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.seating ? ` — ${c.seating} seats` : ''}</option>)}
              </select>
            </Field>
            {airport && (
              <Field label="Direction" required className="sm:col-span-2"><AirportDirectionPicker value={f.airportDirection} onChange={(v) => set('airportDirection', v)} /></Field>
            )}
            {airport && !f.airportDirection ? (
              <p className="text-sm text-ink-500 sm:col-span-2">Choose <strong className="text-ink-700">To airport</strong> or <strong className="text-ink-700">From airport</strong> to enter the addresses.</p>
            ) : (
              <>
                <Field label={airport ? ends.pickup : 'Pickup'} required>
                  <input className="input" value={f.pickup} onChange={(e) => set('pickup', e.target.value)}
                    placeholder={airport ? ends.pickupHint : 'Pickup address'} list={airport && ends.airportEnd === 'pickup' ? 'gtt-airports' : undefined} />
                </Field>
                <Field label={airport ? ends.drop : 'Drop'} required={airport}>
                  <input className="input" value={f.dropOff} onChange={(e) => set('dropOff', e.target.value)}
                    placeholder={airport ? ends.dropHint : 'Drop address'} list={airport && ends.airportEnd === 'drop' ? 'gtt-airports' : undefined} />
                </Field>
                <datalist id="gtt-airports">{AIRPORT_NAMES.map((a) => <option key={a} value={a} />)}</datalist>
              </>
            )}
            <Field label="Journey date" required><DateField value={f.travelDate} onChange={(v) => set('travelDate', v)} /></Field>
            <Field label="Journey time"><TimeField value={f.journeyTime} onChange={(v) => set('journeyTime', v)} /></Field>
            {['OUTSTATION', 'ROUND_TRIP', 'PACKAGE'].includes(f.tripType) && (
              <Field label="Return / last day"><DateField value={f.travelDateTo} onChange={(v) => set('travelDateTo', v)} min={f.travelDate} /></Field>
            )}
            <Field label="Passengers"><input className="input tabular-nums" inputMode="numeric" value={f.passengers} onChange={(e) => set('passengers', e.target.value)} /></Field>
          </div>
          <Field label="Notes" className="mt-3">
            <textarea className="input h-auto py-2" rows={2} value={f.message} onChange={(e) => set('message', e.target.value)} placeholder="Anything the driver or the desk needs to know" />
          </Field>
        </Panel>

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-700">
          <input type="checkbox" checked={f.notifyCustomer} onChange={(e) => set('notifyCustomer', e.target.checked)} className="check mt-0.5" />
          Email the customer their Trip ID and journey details, if an address is given
        </label>

        {error && <p className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}
      </form>
    </Modal>
  );
}

