/**
 * Events — weddings, conferences, offsites: one client, many vehicles.
 *
 * An event holds requirement lines ("3 × Dzire on 14-Oct, 07:00, from the
 * Taj"). "Create trips" turns each line into ordinary trips, which are then
 * allotted, completed, billed, invoiced and paid on the usual screens. This
 * page only reads them back to show where the whole job stands.
 *
 * Backend: backend/src/routes/events.ts
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime, hm12, inr, inrShort, humanise } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Spinner, StatusBadge, Tabs } from '../components/ui';
import { DataTable, DateRange, Detail, Drawer, ExportButton, Kpi, Menu, SearchBox } from '../components/data';
import { DateField } from '../components/DateTimeField';
import {
  IconCalendar, IconCar, IconCheck, IconEdit, IconEvent, IconPaste, IconPlus, IconRupee, IconTrash, IconUpload, IconWarning,
} from '../components/icons';

/* ==========================================================================
   Shared bits
   ========================================================================== */

const EVENT_STATUS: Record<string, { label: string; cls: string }> = {
  PLANNED: { label: 'Planned', cls: 'badge-neutral' },
  CONFIRMED: { label: 'Confirmed', cls: 'badge-brand' },
  IN_PROGRESS: { label: 'In progress', cls: 'badge-teal' },
  COMPLETED: { label: 'Completed', cls: 'badge-ok' },
  CANCELLED: { label: 'Cancelled', cls: 'badge-danger' },
};
const EventStatus = ({ value }: { value: string }) => {
  const s = EVENT_STATUS[value] ?? { label: humanise(value), cls: 'badge-neutral' };
  return <span className={s.cls}>{s.label}</span>;
};

const TRIP_TYPES = [
  { value: 'LOCAL', label: 'Local' }, { value: 'TRANSFER', label: 'Transfer' }, { value: 'AIRPORT', label: 'Airport' },
  { value: 'OUTSTATION', label: 'Outstation' }, { value: 'ROUND_TRIP', label: 'Round trip' }, { value: 'PACKAGE', label: 'Package' },
];

type FieldKey =
  | 'travelDate' | 'reportingTime' | 'vehicleCategory' | 'vehicleCount' | 'pickupAddress' | 'dropAddress'
  | 'dutyType' | 'tripType' | 'passengerName' | 'passengerMobile' | 'paxCount' | 'farePerVehicle' | 'remarks';

interface DraftRow {
  key: number;
  vehicleCategoryId: string;
  vehicleCategory: string;
  travelDate: string; reportingTime: string; vehicleCount: string; pickupAddress: string; dropAddress: string;
  dutyType: string; tripType: string; passengerName: string; passengerMobile: string; paxCount: string;
  farePerVehicle: string; remarks: string;
}

let draftKey = 1;
const emptyDraft = (base: Partial<DraftRow> = {}): DraftRow => ({
  key: draftKey++, vehicleCategoryId: '', vehicleCategory: '', travelDate: '', reportingTime: '', vehicleCount: '1',
  pickupAddress: '', dropAddress: '', dutyType: '', tripType: '', passengerName: '', passengerMobile: '', paxCount: '',
  farePerVehicle: '', remarks: '', ...base,
});

const draftPayload = (d: DraftRow) => ({
  vehicleCategoryId: d.vehicleCategoryId ? Number(d.vehicleCategoryId) : undefined,
  vehicleCategory: d.vehicleCategory, travelDate: d.travelDate, reportingTime: d.reportingTime,
  vehicleCount: d.vehicleCount, pickupAddress: d.pickupAddress, dropAddress: d.dropAddress, dutyType: d.dutyType,
  tripType: d.tripType, passengerName: d.passengerName, passengerMobile: d.passengerMobile, paxCount: d.paxCount,
  farePerVehicle: d.farePerVehicle, remarks: d.remarks,
});

interface RowCheck {
  row: number; ok: boolean; category_name?: string | null; data: any;
  errors: { field: string; message: string }[]; warnings: { field: string; message: string }[];
}

/* ==========================================================================
   Page
   ========================================================================== */

export default function Events() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<any[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [f, setF] = useState({ search: '', status: 'ACTIVE', vendorId: '', from: '', to: '' });
  const [vendors, setVendors] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  // ?new=1 (from the Create menu) opens the new-event form straight away.
  const [form, setForm] = useState<any>(() => (params.get('new') === '1' ? {} : null));
  const openId = params.get('open') ? Number(params.get('open')) : null;
  const setOpenId = (id: number | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (id) n.set('open', String(id)); else n.delete('open');
    return n;
  }, { replace: true });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data } = await api.get('/events', { params: f });
      setRows(data.data ?? []); setKpis(data.kpis ?? null);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    Promise.all([
      api.get('/vendors/options').catch(() => ({ data: { data: [] } })),
      api.get('/fares/categories').catch(() => ({ data: { data: [] } })),
    ]).then(([v, c]) => { setVendors(v.data.data ?? []); setCategories(c.data.data ?? []); });
  }, []);

  const companies = useMemo(() => vendors.filter((v) => v.code !== 'DIRECT'), [vendors]);

  return (
    <div className="page">
      <PageHeader
        title="Events"
        subtitle="Weddings, conferences and corporate events that need many vehicles. Requirement lines become ordinary trips, so they are allotted, billed, invoiced and paid on the usual screens."
        actions={can('events.create') && (
          <button className="btn-primary" onClick={() => setForm({})}><IconPlus className="h-4 w-4" /> New event</button>
        )}
      />

      {kpis && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Active events" value={kpis.active} sub={`${kpis.upcoming} starting today or later`} tone="brand" icon={<IconEvent className="h-4 w-4" />} />
          <Kpi label="Vehicles required" value={kpis.vehicles_required} sub={`${kpis.trips_without_vehicle} trip(s) without a vehicle`} tone={kpis.trips_without_vehicle ? 'warning' : 'teal'} icon={<IconCar className="h-4 w-4" />} />
          <Kpi label="Agreed value" value={inrShort(kpis.agreed)} sub="Listed events, not cancelled" tone="violet" icon={<IconRupee className="h-4 w-4" />} />
          <Kpi label="Billed" value={inrShort(kpis.billed)} sub={`${inrShort(kpis.received)} received`} tone="success" icon={<IconCheck className="h-4 w-4" />} />
          <Kpi label="Outstanding" value={inrShort(kpis.outstanding)} sub="Billed, not yet received" tone={kpis.outstanding > 0 ? 'danger' : 'default'} icon={<IconWarning className="h-4 w-4" />} />
        </div>
      )}

      {error ? <ErrorState message={error} onRetry={load} /> : (
        <section className="table-wrap">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 p-3">
            <SearchBox value={f.search} onChange={(v) => setF({ ...f, search: v })} placeholder="Event, client, venue, contact…" className="flex-1" />
            <select className="input h-9 w-auto text-[13px]" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
              <option value="ACTIVE">Open events</option>
              <option value="">All statuses</option>
              {Object.entries(EVENT_STATUS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
            <select className="input h-9 w-auto max-w-[14rem] text-[13px]" value={f.vendorId} onChange={(e) => setF({ ...f, vendorId: e.target.value })} aria-label="Company">
              <option value="">All companies</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Direct customers' : v.vendor_name}</option>)}
            </select>
            <DateRange from={f.from} to={f.to} onChange={(r) => setF({ ...f, ...r })} />
            <ExportButton url="/events/export" params={f} />
          </div>
          <DataTable
            rows={rows} rowKey={(r) => r.id} loading={loading} onRowClick={(r) => setOpenId(r.id)} pageSize={50}
            empty={<EmptyState title="No events match" body="Clear the filters, or create the first event." icon={<IconEvent className="h-5 w-5" />} />}
            columns={[
              { key: 'event_code', header: 'Event', render: (r) => (
                <div><p className="font-semibold text-ink-900">{r.name}</p><p className="cell-code">{r.event_code}</p></div>
              ) },
              { key: 'vendor_name', header: 'Billed to', render: (r) => (
                <div><p className="text-sm">{r.vendor_code === 'DIRECT' ? 'Direct customer' : r.vendor_name}</p>{r.client_name && <p className="cell-meta">{r.client_name}</p>}</div>
              ) },
              { key: 'start_date', header: 'Dates', render: (r) => (
                <div><p className="text-sm">{dmy(r.start_date)}</p>{r.end_date && r.end_date !== r.start_date && <p className="cell-meta">to {dmy(r.end_date)}</p>}</div>
              ) },
              { key: 'venue', header: 'Venue', render: (r) => <span className="text-sm">{[r.venue, r.city].filter(Boolean).join(', ') || '—'}</span> },
              { key: 'vehicles', header: 'Vehicles', align: 'right', sortValue: (r) => r.summary.vehicles_required, render: (r) => (
                <div className="text-right"><p className="tabular-nums">{r.summary.vehicles_required}</p>
                  <p className="cell-meta">{r.summary.trips_created} trips · {r.summary.vehicles_allocated} allotted</p></div>
              ) },
              { key: 'billed', header: 'Billed / received', align: 'right', sortValue: (r) => r.summary.billed, render: (r) => (
                <div className="text-right"><p className="tabular-nums">{inr(r.summary.billed)}</p>
                  <p className="cell-meta">{inr(r.summary.received)} received</p></div>
              ) },
              { key: 'status', header: 'Status', render: (r) => <EventStatus value={r.status} /> },
            ]}
          />
        </section>
      )}

      <EventForm
        open={!!form} initial={form} vendors={companies} directId={vendors.find((v) => v.code === 'DIRECT')?.id}
        onClose={() => setForm(null)}
        onSaved={(ev) => { setForm(null); load(); if (ev?.id) setOpenId(ev.id); }}
      />
      {openId && (
        <EventDrawer
          id={openId} categories={categories} onClose={() => setOpenId(null)} onChanged={load}
          onEdit={(ev) => setForm(ev)} key={openId}
        />
      )}
    </div>
  );
}

/* ==========================================================================
   Create / edit
   ========================================================================== */

function EventForm({ open, initial, vendors, directId, onClose, onSaved }: {
  open: boolean; initial: any; vendors: any[]; directId?: number; onClose: () => void; onSaved: (ev: any) => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<any>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const e = initial ?? {};
    setErrors({});
    setV({
      id: e.id ?? 0,
      name: e.name ?? '',
      billing: e.id ? (e.vendor_code === 'DIRECT' ? 'DIRECT' : String(e.vendor_id)) : '',
      clientName: e.client_name ?? '', contactPerson: e.contact_person ?? '', contactMobile: e.contact_mobile ?? '',
      contactEmail: e.contact_email ?? '', venue: e.venue ?? '', city: e.city ?? '',
      startDate: e.start_date ?? '', endDate: e.end_date ?? '',
      agreedAmount: e.agreed_amount != null ? String(e.agreed_amount) : '',
      status: e.status && e.status !== 'CANCELLED' ? e.status : 'PLANNED', notes: e.notes ?? '',
    });
  }, [open, initial]);

  const set = (k: string) => (e: any) => setV((p: any) => ({ ...p, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (v.name.trim().length < 2) e.name = 'Enter the event name.';
    if (!v.billing) e.billing = 'Choose who is billed.';
    if (v.billing === 'DIRECT' && !v.clientName.trim() && !v.contactPerson.trim()) e.clientName = 'A direct customer needs a name for the invoice.';
    if (!v.startDate) e.startDate = 'Choose the start date.';
    if (v.endDate && v.startDate && v.endDate < v.startDate) e.endDate = 'Ends before it starts.';
    if (v.contactMobile && !/^[6-9]\d{9}$/.test(v.contactMobile.replace(/\D/g, '').slice(-10))) e.contactMobile = '10-digit mobile.';
    if (v.agreedAmount && !(Number(v.agreedAmount) >= 0)) e.agreedAmount = 'Enter an amount.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = {
        ...v, vendorId: v.billing === 'DIRECT' ? (directId ?? null) : Number(v.billing),
        agreedAmount: v.agreedAmount === '' ? null : Number(v.agreedAmount),
      };
      const { data } = v.id ? await api.put(`/events/${v.id}`, payload) : await api.post('/events', payload);
      toast.success(data.message ?? 'Event saved');
      onSaved(data.data);
    } catch (err) { toast.error('Could not save the event', errorMessage(err)); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={v.id ? `Edit ${initial?.event_code ?? 'event'}` : 'New event'}
      subtitle="The company chosen here is billed for every trip of the event."
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} {v.id ? 'Save event' : 'Create event'}</button></>}>
      {open && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event name" required error={errors.name} className="sm:col-span-2">
            <input className={`input ${errors.name ? 'input-error' : ''}`} value={v.name ?? ''} onChange={set('name')} placeholder="Sharma–Verma wedding" autoFocus />
          </Field>
          <Field label="Billed to" required error={errors.billing} hint={v.billing === 'DIRECT' ? 'Invoices are addressed to the client below.' : undefined}>
            <select className={`input ${errors.billing ? 'input-error' : ''}`} value={v.billing ?? ''} onChange={set('billing')}>
              <option value="">Choose…</option>
              <option value="DIRECT">Direct customer (walk-in)</option>
              {vendors.map((x) => <option key={x.id} value={x.id}>{x.vendor_name}{x.company_name && x.company_name !== x.vendor_name ? ` — ${x.company_name}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Client" error={errors.clientName} required={v.billing === 'DIRECT'}>
            <input className={`input ${errors.clientName ? 'input-error' : ''}`} value={v.clientName ?? ''} onChange={set('clientName')} placeholder="Family / organisation" />
          </Field>
          <Field label="Contact person"><input className="input" value={v.contactPerson ?? ''} onChange={set('contactPerson')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact mobile" error={errors.contactMobile}><input className={`input ${errors.contactMobile ? 'input-error' : ''}`} inputMode="tel" value={v.contactMobile ?? ''} onChange={set('contactMobile')} /></Field>
            <Field label="Contact email"><input className="input" type="email" value={v.contactEmail ?? ''} onChange={set('contactEmail')} /></Field>
          </div>
          <Field label="Venue"><input className="input" value={v.venue ?? ''} onChange={set('venue')} placeholder="Used as pickup when a line has none" /></Field>
          <Field label="City"><input className="input" value={v.city ?? ''} onChange={set('city')} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" required error={errors.startDate}><DateField value={v.startDate ?? ''} onChange={set('startDate')} error={!!errors.startDate} /></Field>
            <Field label="Ends" error={errors.endDate}><DateField value={v.endDate ?? ''} onChange={set('endDate')} min={v.startDate || undefined} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agreed amount (₹)" error={errors.agreedAmount}><input className="input text-right" inputMode="decimal" value={v.agreedAmount ?? ''} onChange={set('agreedAmount')} /></Field>
            <Field label="Status">
              <select className="input" value={v.status ?? 'PLANNED'} onChange={set('status')}>
                {['PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].map((s) => <option key={s} value={s}>{EVENT_STATUS[s].label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes" className="sm:col-span-2"><textarea className="input min-h-[70px]" value={v.notes ?? ''} onChange={set('notes')} /></Field>
        </div>
      )}
    </Modal>
  );
}

/* ==========================================================================
   Event drawer
   ========================================================================== */

type Tab = 'overview' | 'requirements' | 'trips' | 'activity';

function EventDrawer({ id, categories, onClose, onChanged, onEdit }: {
  id: number; categories: any[]; onClose: () => void; onChanged: () => void; onEdit: (ev: any) => void;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [plan, setPlan] = useState<any>(null);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try { const { data } = await api.get(`/events/${id}`); setD(data); }
    catch (err) { setError(errorMessage(err)); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const apply = (data: any) => { setD((p: any) => ({ ...p, ...data })); onChanged(); };

  const askGenerate = async () => {
    try { const { data } = await api.get(`/events/${id}/generate-trips`); setPlan(data.data); }
    catch (err) { toast.error('Could not work out the trips', errorMessage(err)); }
  };
  const generate = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${id}/generate-trips`);
      toast.success(data.message);
      setPlan(null); apply(data); load(); setTab('trips');
    } catch (err) { toast.error('Could not create the trips', errorMessage(err)); } finally { setBusy(false); }
  };

  const ev = d?.data;
  const s = d?.summary;
  const closed = ev?.status === 'CANCELLED';
  const pendingTrips = (d?.requirements ?? []).reduce((n: number, r: any) => n + (r.trips_pending ?? 0), 0);

  return (
    <Drawer
      open onClose={onClose} width="max-w-6xl"
      title={ev ? ev.name : 'Event'}
      subtitle={ev && (
        <span className="flex flex-wrap items-center gap-2">
          <span className="cell-code">{ev.event_code}</span>
          <EventStatus value={ev.status} />
          <span>{ev.vendor_code === 'DIRECT' ? `Direct customer — ${ev.client_name ?? ''}` : ev.vendor_name}</span>
          <span>· {dmy(ev.start_date)}{ev.end_date && ev.end_date !== ev.start_date ? ` to ${dmy(ev.end_date)}` : ''}</span>
        </span>
      )}
      footer={ev && !closed && (
        <>
          {can('events.update') && <button className="btn-outline" onClick={() => setCancelling(true)}>Cancel event</button>}
          {can('events.update') && <button className="btn-outline" onClick={() => onEdit(ev)}><IconEdit className="h-4 w-4" /> Edit details</button>}
          {can('events.update') && (
            <button className="btn-primary" onClick={askGenerate} disabled={!pendingTrips}
              title={pendingTrips ? undefined : 'Every open line already has its trips'}>
              <IconCar className="h-4 w-4" /> Create trips{pendingTrips ? ` (${pendingTrips})` : ''}
            </button>
          )}
        </>
      )}
    >
      {error ? <ErrorState message={error} onRetry={load} /> : !d ? <Loading /> : (
        <div className="space-y-4">
          <Tabs<Tab>
            active={tab} onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'requirements', label: 'Requirements', count: d.requirements.length },
              { key: 'trips', label: 'Trips', count: d.trips.length },
              { key: 'activity', label: 'Activity' },
            ]}
          />
          {tab === 'overview' && <Overview ev={ev} s={s} />}
          {tab === 'requirements' && (
            <Requirements ev={ev} rows={d.requirements} categories={categories} onApplied={apply} readOnly={closed || !can('events.update')} />
          )}
          {tab === 'trips' && <Trips trips={d.trips} />}
          {tab === 'activity' && <Activity rows={d.activity ?? []} />}
        </div>
      )}

      <ConfirmDialog
        open={!!plan} onClose={() => setPlan(null)} onConfirm={generate} busy={busy}
        title={plan?.trips ? `Create ${plan.trips} trip(s)?` : 'Nothing to create'}
        confirmLabel={plan?.trips ? `Create ${plan.trips} trip(s)` : 'OK'} cancelLabel="Not now"
        body={plan?.trips ? (
          <>
            <p>Each vehicle becomes one confirmed trip billed to <b>{ev?.vendor_code === 'DIRECT' ? ev?.client_name : ev?.vendor_name}</b>, ready for allotment on Trips.</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {plan.lines.map((l: any) => <li key={l.id}>Line {l.line_no}: {l.to_create} × {l.vehicle_type} on {dmy(l.travel_date)}</li>)}
            </ul>
            <p className="text-ink-500">Running this again later only creates trips that are still missing — it never duplicates.</p>
          </>
        ) : <p>Every open line already has its trips.</p>}
      />
      <CancelEvent open={cancelling} ev={ev} onClose={() => setCancelling(false)} onDone={(data) => { setCancelling(false); apply(data); }} />
    </Drawer>
  );
}

function Overview({ ev, s }: { ev: any; s: any }) {
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Requirement lines" value={s.requirements} sub={s.requirements_cancelled ? `${s.requirements_cancelled} cancelled` : 'Open lines'} icon={<IconCalendar className="h-4 w-4" />} />
        <Kpi label="Vehicles required" value={s.vehicles_required} sub={`${s.trips_created} trip(s) created`} tone="brand" icon={<IconCar className="h-4 w-4" />} />
        <Kpi label="Vehicles allotted" value={s.vehicles_allocated} sub={`${pct(s.vehicles_allocated, s.trips_created)} of trips · ${s.drivers_assigned} driver(s)`}
          tone={s.trips_created && s.vehicles_allocated < s.trips_created ? 'warning' : 'success'} />
        <Kpi label="Trips completed" value={s.trips_completed} sub={`${s.trips_in_progress} on trip · ${s.awaiting_billing} awaiting billing`} tone="teal" />
        <Kpi label="Agreed amount" value={ev.agreed_amount != null ? inr(ev.agreed_amount) : '—'} sub={`Trip charges ${inr(s.trip_value)}`} tone="violet" icon={<IconRupee className="h-4 w-4" />} />
        <Kpi label="Billed" value={inr(s.billed)} sub={`${s.invoices} invoice(s) · ${s.trips_billed} trip(s)`} tone="success" />
        <Kpi label="Received" value={inr(s.received)} sub="Reversed payments excluded" tone="success" />
        <Kpi label="Outstanding" value={inr(s.outstanding)} sub="Billed, not yet received" tone={s.outstanding > 0 ? 'danger' : 'default'} />
      </div>
      <dl className="card card-pad grid gap-4 sm:grid-cols-3">
        <Detail label="Billed to">{ev.vendor_code === 'DIRECT' ? 'Direct customer' : `${ev.vendor_name}${ev.company_name && ev.company_name !== ev.vendor_name ? ` (${ev.company_name})` : ''}`}</Detail>
        <Detail label="Client">{ev.client_name}</Detail>
        <Detail label="Contact">{[ev.contact_person, ev.contact_mobile, ev.contact_email].filter(Boolean).join(' · ') || null}</Detail>
        <Detail label="Venue">{[ev.venue, ev.city].filter(Boolean).join(', ') || null}</Detail>
        <Detail label="Dates">{dmy(ev.start_date)}{ev.end_date ? ` to ${dmy(ev.end_date)}` : ''}</Detail>
        <Detail label="Created">{dmyTime(ev.created_at)}{ev.created_by_name ? ` by ${ev.created_by_name}` : ''}</Detail>
        {ev.notes && <Detail label="Notes" className="sm:col-span-3"><span className="whitespace-pre-line">{ev.notes}</span></Detail>}
      </dl>
      <p className="text-xs text-ink-500">
        Billing for this event runs through Billing, Invoices and Payments as usual. "Billed" is the total of the live invoices that carry this event's trips.
      </p>
    </div>
  );
}

function Trips({ trips }: { trips: any[] }) {
  return (
    <div className="table-wrap">
      <DataTable
        rows={trips} rowKey={(r) => r.id} pageSize={50} dense
        empty={<EmptyState title="No trips yet" body='Add requirement lines, then use "Create trips".' icon={<IconCar className="h-5 w-5" />} />}
        rowClassName={(r) => (r.stage === 'CANCELLED' ? 'opacity-60' : '')}
        columns={[
          { key: 'trip_id', header: 'Trip', render: (r) => (
            <div><Link to={`/admin/trips?open=${r.id}`} className="cell-code hover:underline">{r.trip_id ?? r.booking_code}</Link>
              <p className="cell-meta">Line {r.line_no ?? '—'}</p></div>
          ) },
          { key: 'travel_date', header: 'When', render: (r) => (
            <div><p className="text-sm">{dmy(r.travel_date)}</p><p className="cell-meta">{r.reporting_time ? hm12(r.reporting_time) : 'No time'}</p></div>
          ) },
          { key: 'vehicle_type', header: 'Vehicle', render: (r) => (
            <div><p className="text-sm">{r.vehicle_type ?? '—'}</p>{r.vehicle_number ? <p className="cell-meta font-mono">{r.vehicle_number}</p> : <p className="cell-meta text-warn-700">Not allotted</p>}</div>
          ) },
          { key: 'driver_name', header: 'Driver', render: (r) => r.driver_name ? <div><p className="text-sm">{r.driver_name}</p>{r.driver_mobile && <p className="cell-meta">{r.driver_mobile}</p>}</div> : <span className="text-xs text-ink-400">Not assigned</span> },
          { key: 'stage', header: 'Stage', render: (r) => <StatusBadge value={r.stage} /> },
          { key: 'total_amount', header: 'Fare', align: 'right', render: (r) => Number(r.total_amount) > 0 ? inr(r.total_amount) : <span className="text-xs text-warn-700">No fare</span> },
          { key: 'billing_status', header: 'Billing', render: (r) => <StatusBadge value={r.billing_status} /> },
          { key: 'invoice_number', header: 'Invoice', render: (r) => r.invoice_id ? (
            <div><Link to={`/admin/invoices/${r.invoice_id}`} className="cell-code hover:underline">{r.invoice_number}</Link>
              <p className="mt-0.5"><StatusBadge value={r.invoice_status} /></p></div>
          ) : <span className="text-xs text-ink-400">Not invoiced</span> },
          { key: 'invoice_outstanding', header: 'Payment', align: 'right', render: (r) => r.invoice_id ? (
            <div className="text-right"><p className="text-sm tabular-nums">{inr(r.invoice_paid)} paid</p>
              <p className="cell-meta">{inr(r.invoice_outstanding)} due on invoice</p></div>
          ) : <span className="text-xs text-ink-400">—</span> },
        ]}
      />
    </div>
  );
}

function Activity({ rows }: { rows: any[] }) {
  if (!rows.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="space-y-2">
      {rows.map((a) => (
        <li key={a.id} className="card card-pad-sm">
          <p className="text-sm text-ink-800">{a.description ?? humanise(a.action)}</p>
          <p className="mt-0.5 text-2xs text-ink-500">{humanise(a.action)} · {dmyTime(a.created_at)}{a.user_name ? ` · ${a.user_name}` : ''}</p>
        </li>
      ))}
    </ol>
  );
}

function CancelEvent({ open, ev, onClose, onDone }: { open: boolean; ev: any; onClose: () => void; onDone: (data: any) => void }) {
  const toast = useToast();
  const [reasons, setReasons] = useState<{ code: string; label: string }[]>([]);
  const [reason, setReason] = useState('PLAN_CHANGED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || reasons.length) return;
    api.get('/masters/lists/CANCELLATION_REASON/options').then((r) => setReasons(r.data.data ?? [])).catch(() => {});
  }, [open, reasons.length]);
  const go = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${ev.id}/cancel`, { reason, note });
      toast.success('Event cancelled', data.message);
      onDone(data);
    } catch (err) { toast.error('Could not cancel', errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Cancel ${ev?.event_code ?? 'event'}?`}
      footer={<><button className="btn-outline" onClick={onClose} disabled={busy}>Keep the event</button>
        <button className="btn-danger" onClick={go} disabled={busy}>{busy && <Spinner />} Cancel event</button></>}>
      <div className="space-y-3 text-sm text-ink-700">
        <p>Open requirement lines and trips that have not started are cancelled. Trips already under way, completed or invoiced are left exactly as they are.</p>
        <Field label="Reason">
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {(reasons.length ? reasons : [{ code: 'PLAN_CHANGED', label: 'Travel plan changed' }]).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Modal>
  );
}

/* ==========================================================================
   Requirements: saved lines + a draft grid (manual, paste, upload)
   ========================================================================== */

function Requirements({ ev, rows, categories, onApplied, readOnly }: {
  ev: any; rows: any[]; categories: any[]; onApplied: (data: any) => void; readOnly: boolean;
}) {
  const toast = useToast();
  const { can } = useAuth();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [checks, setChecks] = useState<Record<number, RowCheck>>({});
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paste, setPaste] = useState<string | null>(null);
  const [mapping, setMapping] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const defaults = () => ({ travelDate: ev.start_date ?? '', pickupAddress: '' });
  const addRow = () => { setDrafts((p) => [...p, emptyDraft(defaults())]); setChecked(false); };
  const setCell = (key: number, k: keyof DraftRow, val: string) => {
    setDrafts((p) => p.map((r) => (r.key === key ? { ...r, [k]: val, ...(k === 'vehicleCategoryId' ? { vehicleCategory: '' } : {}) } : r)));
    setChecked(false);
  };

  const parse = async (body: FormData | { text: string }) => {
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${ev.id}/import/parse`, body);
      setMapping({ ...data.data, map: { ...data.data.mapping } });
      setPaste(null);
    } catch (err) { toast.error('Could not read those rows', errorMessage(err)); } finally { setBusy(false); }
  };

  const onFile = (file?: File | null) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    parse(fd);
    if (fileRef.current) fileRef.current.value = '';
  };

  const applyMapping = () => {
    const m = mapping.map as Record<string, number | ''>;
    const next = (mapping.rows as string[][]).map((r) => {
      const get = (f: FieldKey) => (m[f] === '' || m[f] === undefined ? '' : String(r[m[f] as number] ?? '').trim());
      return emptyDraft({
        travelDate: get('travelDate'), reportingTime: get('reportingTime'), vehicleCategory: get('vehicleCategory'),
        vehicleCount: get('vehicleCount') || '1', pickupAddress: get('pickupAddress'), dropAddress: get('dropAddress'),
        dutyType: get('dutyType'), tripType: get('tripType'), passengerName: get('passengerName'),
        passengerMobile: get('passengerMobile'), paxCount: get('paxCount'), farePerVehicle: get('farePerVehicle'), remarks: get('remarks'),
      });
    }).filter((d) => Object.entries(d).some(([k, val]) => k !== 'key' && k !== 'vehicleCount' && val !== ''));
    // Replace empty untouched rows, append to the rest.
    setDrafts((p) => [...p.filter((d) => d.vehicleCategoryId || d.vehicleCategory || d.pickupAddress || d.passengerName), ...next]);
    setMapping(null);
    setChecked(false);
    toast.info(`${next.length} row(s) added to the grid`, 'Check them, fix anything marked, then save.');
  };

  const check = async (): Promise<boolean> => {
    if (!drafts.length) return false;
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${ev.id}/requirements/preview`, { rows: drafts.map(draftPayload) });
      const res: RowCheck[] = data.data.rows;
      const map: Record<number, RowCheck> = {};
      // Normalise what the server could read (dates, times, matched category) back into the grid.
      setDrafts((p) => p.map((d, i) => {
        const r = res[i];
        map[d.key] = r;
        if (!r?.data) return d;
        return {
          ...d, travelDate: r.data.travel_date, reportingTime: r.data.reporting_time ?? '',
          vehicleCategoryId: r.data.vehicle_category_id ? String(r.data.vehicle_category_id) : d.vehicleCategoryId,
          vehicleCategory: r.data.vehicle_category_id ? '' : d.vehicleCategory, vehicleCount: String(r.data.vehicle_count),
          passengerMobile: r.data.passenger_mobile ?? '', farePerVehicle: r.data.fare_per_vehicle != null ? String(r.data.fare_per_vehicle) : '',
          tripType: r.data.trip_type,
        };
      }));
      setChecks(map);
      setChecked(true);
      return data.data.invalid === 0;
    } catch (err) { toast.error('Could not check the rows', errorMessage(err)); return false; } finally { setBusy(false); }
  };

  const save = async () => {
    const ok = await check();
    if (!ok) { toast.error('Some rows need attention', 'Fix the rows marked in red, then save again.'); return; }
    setBusy(true);
    try {
      const { data } = await api.post(`/events/${ev.id}/requirements`, { rows: drafts.map(draftPayload) });
      toast.success(data.message);
      setDrafts([]); setChecks({}); setChecked(false);
      onApplied(data);
    } catch (err) { toast.error('Could not save the rows', errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/events/${ev.id}/requirements/${toDelete.id}`);
      toast.success(data.cancelled ? 'Line cancelled' : 'Line deleted', data.message);
      setToDelete(null); onApplied(data);
    } catch (err) { toast.error('Could not remove the line', errorMessage(err)); } finally { setBusy(false); }
  };

  const errorsOf = (key: number, field: string) => checks[key]?.errors.filter((e) => e.field === field).map((e) => e.message).join(' ');
  const invalid = Object.values(checks).filter((c) => !c.ok).length;
  const totalVehicles = rows.filter((r) => r.status === 'OPEN').reduce((n, r) => n + r.vehicle_count, 0);

  return (
    <div className="space-y-4">
      <div className="table-wrap">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3">
          <p className="text-sm font-semibold text-ink-800">Saved lines <span className="font-normal text-ink-500">· {totalVehicles} vehicle(s) on open lines</span></p>
        </div>
        <DataTable
          rows={rows} rowKey={(r) => r.id} dense
          rowClassName={(r) => (r.status === 'CANCELLED' ? 'opacity-60' : '')}
          empty={<p className="px-4 py-8 text-center text-sm text-ink-500">No lines yet. Add rows below — type them, paste from Excel or upload a sheet.</p>}
          columns={[
            { key: 'line_no', header: '#', align: 'right' },
            { key: 'travel_date', header: 'Date', render: (r) => <div><p className="text-sm">{dmy(r.travel_date)}</p><p className="cell-meta">{r.reporting_time ? hm12(r.reporting_time) : 'No time'}</p></div> },
            { key: 'vehicle', header: 'Vehicle', render: (r) => <span className="text-sm">{r.vehicle_count} × {r.category_name ?? r.vehicle_type}</span> },
            { key: 'pickup_address', header: 'Pickup → drop', render: (r) => <span className="text-sm">{r.pickup_address || <i className="text-ink-400">Venue</i>}{r.drop_address ? ` → ${r.drop_address}` : ''}</span> },
            { key: 'passenger_name', header: 'Guest', render: (r) => r.passenger_name ? <div><p className="text-sm">{r.passenger_name}</p>{r.passenger_mobile && <p className="cell-meta">{r.passenger_mobile}</p>}</div> : <span className="text-ink-400">—</span> },
            { key: 'trip_type', header: 'Type', render: (r) => <span className="text-sm">{humanise(r.trip_type)}{r.duty_type ? ` · ${r.duty_type}` : ''}</span> },
            { key: 'fare_per_vehicle', header: 'Fare / vehicle', align: 'right', render: (r) => r.fare_per_vehicle != null ? inr(r.fare_per_vehicle) : <span className="text-xs text-warn-700">No fare</span> },
            { key: 'trips', header: 'Trips', render: (r) => r.status === 'CANCELLED' ? <span className="badge-danger">Cancelled</span>
              : r.trips_pending ? <span className="badge-warn">{r.trips_created} of {r.vehicle_count} created</span>
                : <span className="badge-ok">All {r.trips_created} created</span> },
            { key: 'a', header: '', sortable: false, align: 'right', render: (r) => !readOnly && r.status === 'OPEN' && (
              <Menu items={[
                { label: 'Edit line', icon: <IconEdit className="h-4 w-4" />, onClick: () => setEditing(r) },
                can('events.delete', 'events.update') && {
                  label: r.trips_created ? 'Cancel line' : 'Delete line', danger: true, icon: <IconTrash className="h-4 w-4" />,
                  hint: r.trips_created ? 'Has trips — un-started ones are cancelled' : undefined, onClick: () => setToDelete(r),
                },
              ]} />
            ) },
          ]}
        />
      </div>

      {!readOnly && (
        <section className="table-wrap">
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-4 py-3">
            <p className="mr-auto text-sm font-semibold text-ink-800">Add lines</p>
            <button className="btn-outline btn-sm" onClick={addRow}><IconPlus className="h-3.5 w-3.5" /> Add row</button>
            <button className="btn-outline btn-sm" onClick={() => setPaste('')}><IconPaste className="h-3.5 w-3.5" /> Paste from Excel</button>
            <button className="btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}><IconUpload className="h-3.5 w-3.5" /> Upload sheet</button>
            <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
          {drafts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">Add a row by hand, paste rows copied from Excel, or upload an .xlsx / .csv. Nothing is saved until you press Save.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="tbl min-w-[1400px]">
                  <thead>
                    <tr>
                      <th className="w-8">#</th><th>Date *</th><th>Time</th><th>Vehicle *</th><th className="w-20">Count</th>
                      <th>Pickup</th><th>Drop</th><th>Trip type</th><th>Duty</th><th>Guest</th><th>Mobile</th>
                      <th className="w-16">Pax</th><th className="w-24">Fare</th><th>Remarks</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.map((d, i) => {
                      const c = checks[d.key];
                      const cell = (k: keyof DraftRow, field: string, props: any = {}) => {
                        const err = errorsOf(d.key, field);
                        return (
                          <td className="py-1.5 align-top">
                            <input className={`input h-8 text-[13px] ${err ? 'input-error' : ''}`} value={(d as any)[k]} title={err || undefined}
                              aria-invalid={!!err} onChange={(e) => setCell(d.key, k, e.target.value)} {...props} />
                          </td>
                        );
                      };
                      const catErr = errorsOf(d.key, 'vehicleCategory');
                      return (
                        <tr key={d.key} className={c && !c.ok ? 'bg-danger-50/40' : ''}>
                          <td className="py-1.5 align-top text-xs text-ink-500">{i + 1}</td>
                          {cell('travelDate', 'travelDate', { placeholder: 'DD-MM-YYYY' })}
                          {cell('reportingTime', 'reportingTime', { placeholder: '07:30' })}
                          <td className="py-1.5 align-top">
                            <select className={`input h-8 min-w-[9rem] text-[13px] ${catErr ? 'input-error' : ''}`} value={d.vehicleCategoryId} title={catErr || undefined}
                              onChange={(e) => setCell(d.key, 'vehicleCategoryId', e.target.value)}>
                              <option value="">{d.vehicleCategory ? `"${d.vehicleCategory}" — choose` : 'Choose…'}</option>
                              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                            </select>
                          </td>
                          {cell('vehicleCount', 'vehicleCount', { inputMode: 'numeric' })}
                          {cell('pickupAddress', 'pickupAddress', { placeholder: ev.venue || 'Venue' })}
                          {cell('dropAddress', 'dropAddress')}
                          <td className="py-1.5 align-top">
                            <select className="input h-8 text-[13px]" value={d.tripType} onChange={(e) => setCell(d.key, 'tripType', e.target.value)}>
                              <option value="">Local</option>{TRIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                          </td>
                          {cell('dutyType', 'dutyType', { placeholder: '8H/80KM' })}
                          {cell('passengerName', 'passengerName')}
                          {cell('passengerMobile', 'passengerMobile', { inputMode: 'tel' })}
                          {cell('paxCount', 'paxCount', { inputMode: 'numeric' })}
                          {cell('farePerVehicle', 'farePerVehicle', { inputMode: 'decimal' })}
                          {cell('remarks', 'remarks')}
                          <td className="py-1.5 align-top">
                            <button className="btn-ghost btn-icon" aria-label={`Remove row ${i + 1}`}
                              onClick={() => { setDrafts((p) => p.filter((x) => x.key !== d.key)); setChecked(false); }}>
                              <IconTrash className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {checked && (
                <div className="space-y-1 border-t border-ink-200 px-4 py-3 text-xs">
                  {invalid === 0
                    ? <p className="font-semibold text-ok-700">All {drafts.length} row(s) are ready to save.</p>
                    : <p className="font-semibold text-danger-700">{invalid} row(s) need attention — they are marked in red.</p>}
                  {drafts.map((d, i) => {
                    const c = checks[d.key];
                    if (!c || (!c.errors.length && !c.warnings.length)) return null;
                    return (
                      <p key={d.key} className="text-ink-700">
                        <b>Row {i + 1}:</b>{' '}
                        {c.errors.map((e, j) => <span key={`e${j}`} className="text-danger-700">Error: {e.message} </span>)}
                        {c.warnings.map((w, j) => <span key={`w${j}`} className="text-warn-700">Note: {w.message} </span>)}
                      </p>
                    );
                  })}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-4 py-3">
                <button className="btn-ghost btn-sm" onClick={() => { setDrafts([]); setChecks({}); setChecked(false); }}>Discard rows</button>
                <button className="btn-outline btn-sm" onClick={check} disabled={busy}>{busy && <Spinner />} Check rows</button>
                <button className="btn-primary btn-sm" onClick={save} disabled={busy}>{busy && <Spinner />} Save {drafts.length} row(s)</button>
              </div>
            </>
          )}
        </section>
      )}

      <Modal open={paste !== null} onClose={() => setPaste(null)} size="lg" title="Paste rows from Excel"
        subtitle="Copy the cells in Excel or Google Sheets (with the heading row if there is one) and paste them here."
        footer={<><button className="btn-outline" onClick={() => setPaste(null)}>Cancel</button>
          <button className="btn-primary" disabled={busy || !paste?.trim()} onClick={() => parse({ text: paste ?? '' })}>{busy && <Spinner />} Next: match columns</button></>}>
        <textarea className="input min-h-[240px] font-mono text-xs" value={paste ?? ''} onChange={(e) => setPaste(e.target.value)} autoFocus
          placeholder={'Date\tTime\tVehicle\tQty\tPickup\n14-10-2026\t07:30\tInnova Crysta\t4\tTaj Lands End'} />
      </Modal>

      <MappingModal mapping={mapping} onChange={setMapping} onClose={() => setMapping(null)} onApply={applyMapping} />

      <EditLine ev={ev} line={editing} categories={categories} onClose={() => setEditing(null)} onSaved={(data) => { setEditing(null); onApplied(data); }} />

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} busy={busy} danger
        title={toDelete?.trips_created ? `Cancel line ${toDelete?.line_no}?` : `Delete line ${toDelete?.line_no}?`}
        confirmLabel={toDelete?.trips_created ? 'Cancel line' : 'Delete line'} cancelLabel="Keep it"
        body={toDelete?.trips_created
          ? <p>This line already has {toDelete.trips_created} trip(s). The line is cancelled, and its trips that have not started are cancelled too. Trips under way, completed or invoiced are kept.</p>
          : <p>This line has no trips yet, so it is removed completely.</p>}
      />
    </div>
  );
}

function MappingModal({ mapping, onChange, onClose, onApply }: {
  mapping: any; onChange: (m: any) => void; onClose: () => void; onApply: () => void;
}) {
  if (!mapping) return null;
  const m = mapping.map as Record<string, number | ''>;
  const setField = (f: string, val: string) => onChange({ ...mapping, map: { ...m, [f]: val === '' ? '' : Number(val) } });
  const missing = (mapping.fields as any[]).filter((f) => f.required && (m[f.key] === '' || m[f.key] === undefined));
  const shown = (mapping.rows as string[][]).slice(0, 8);
  const mappedFields = (mapping.fields as any[]).filter((f) => m[f.key] !== '' && m[f.key] !== undefined);
  return (
    <Modal open onClose={onClose} size="xl" title="Match the columns"
      subtitle={`${mapping.source} · ${mapping.total} row(s)${mapping.hasHeader ? '' : ' · no heading row found, so columns are numbered'}. The columns were matched by their headings — check them.`}
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={missing.length > 0} onClick={onApply}>Add {mapping.total} row(s) to the grid</button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(mapping.fields as any[]).map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              <select className={`input h-9 text-[13px] ${f.required && (m[f.key] === '' || m[f.key] === undefined) ? 'input-error' : ''}`}
                value={m[f.key] === undefined ? '' : String(m[f.key])} onChange={(e) => setField(f.key, e.target.value)}>
                <option value="">— Not in the sheet —</option>
                {(mapping.headers as string[]).map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select>
            </Field>
          ))}
        </div>
        {missing.length > 0 && <p className="text-sm text-danger-700">Choose a column for: {missing.map((f) => f.label).join(', ')}.</p>}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-500">How the first rows will read</p>
          <div className="table-wrap table-scroll">
            <table className="tbl">
              <thead><tr>{mappedFields.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>{mappedFields.map((f) => <td key={f.key} className="text-[13px]">{r[m[f.key] as number] || <span className="text-ink-300">—</span>}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-xs text-ink-500">Rows are checked (dates, times, vehicle, mobile) in the grid before anything is saved.</p>
        </div>
      </div>
    </Modal>
  );
}

function EditLine({ ev, line, categories, onClose, onSaved }: {
  ev: any; line: any; categories: any[]; onClose: () => void; onSaved: (data: any) => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<DraftRow | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!line) { setV(null); return; }
    setErrs({});
    setV(emptyDraft({
      vehicleCategoryId: line.vehicle_category_id ? String(line.vehicle_category_id) : '', vehicleCategory: line.vehicle_category_id ? '' : (line.vehicle_type ?? ''),
      travelDate: line.travel_date, reportingTime: line.reporting_time ?? '', vehicleCount: String(line.vehicle_count),
      pickupAddress: line.pickup_address ?? '', dropAddress: line.drop_address ?? '', dutyType: line.duty_type ?? '',
      tripType: line.trip_type ?? 'LOCAL', passengerName: line.passenger_name ?? '', passengerMobile: line.passenger_mobile ?? '',
      paxCount: line.pax_count != null ? String(line.pax_count) : '', farePerVehicle: line.fare_per_vehicle != null ? String(line.fare_per_vehicle) : '',
      remarks: line.remarks ?? '',
    }));
  }, [line]);
  if (!v) return null;
  const set = (k: keyof DraftRow) => (e: any) => setV((p) => p && ({ ...p, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put(`/events/${ev.id}/requirements/${line.id}`, draftPayload(v));
      toast.success(data.message);
      onSaved(data);
    } catch (err: any) {
      const rows = err?.response?.data?.data?.rows;
      if (rows?.[0]?.errors) setErrs(Object.fromEntries(rows[0].errors.map((x: any) => [x.field, x.message])));
      toast.error('Could not save the line', errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Edit line ${line.line_no}`}
      subtitle={line.trips_created ? `${line.trips_created} trip(s) already exist for this line. They keep their own details; raising the count lets "Create trips" add the rest.` : undefined}
      footer={<><button className="btn-outline" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} Save line</button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Travel date" required error={errs.travelDate}><DateField value={v.travelDate} onChange={set('travelDate')} /></Field>
        <Field label="Reporting time" error={errs.reportingTime}><input className="input" value={v.reportingTime} onChange={set('reportingTime')} placeholder="07:30" /></Field>
        <Field label="Vehicle" required error={errs.vehicleCategory}>
          <select className="input" value={v.vehicleCategoryId} onChange={set('vehicleCategoryId')}>
            <option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="No. of vehicles" required error={errs.vehicleCount}><input className="input text-right" inputMode="numeric" value={v.vehicleCount} onChange={set('vehicleCount')} /></Field>
        <Field label="Trip type">
          <select className="input" value={v.tripType} onChange={set('tripType')}>{TRIP_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
        </Field>
        <Field label="Duty"><input className="input" value={v.dutyType} onChange={set('dutyType')} placeholder="8H/80KM" /></Field>
        <Field label="Pickup"><input className="input" value={v.pickupAddress} onChange={set('pickupAddress')} placeholder={ev.venue || ''} /></Field>
        <Field label="Drop"><input className="input" value={v.dropAddress} onChange={set('dropAddress')} /></Field>
        <Field label="Fare per vehicle (₹)" error={errs.farePerVehicle}><input className="input text-right" inputMode="decimal" value={v.farePerVehicle} onChange={set('farePerVehicle')} /></Field>
        <Field label="Guest"><input className="input" value={v.passengerName} onChange={set('passengerName')} /></Field>
        <Field label="Guest mobile" error={errs.passengerMobile}><input className="input" inputMode="tel" value={v.passengerMobile} onChange={set('passengerMobile')} /></Field>
        <Field label="Pax" error={errs.paxCount}><input className="input text-right" inputMode="numeric" value={v.paxCount} onChange={set('paxCount')} /></Field>
        <Field label="Remarks" className="sm:col-span-3"><input className="input" value={v.remarks} onChange={set('remarks')} /></Field>
      </div>
    </Modal>
  );
}
