/**
 * Masters — the reference data everything else reads.
 *
 *   Vehicle categories   the cab classes trips, fare rules and the fleet use
 *   Fare rules           the rate master (vendor × category × plan) and its charges
 *   Lists                trip types, booking sources, payment methods, reasons…
 *   Locations            the pickup / drop suggestions
 *
 * Anything already used by a trip, rule, vehicle or invoice is deactivated
 * rather than deleted, and the screen says why.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, inr } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { DataTable, ExportButton, Menu, SearchBox, Segmented, Drawer, Detail } from '../components/data';
import { IconEdit, IconPlus, IconTrash, IconLayers, IconCar, IconMap } from '../components/icons';
import Master from './Master';

type Tab = 'categories' | 'fare-rules' | 'lists' | 'locations';

export default function Masters() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'categories';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  return (
    <div className="page">
      <PageHeader
        title="Masters"
        subtitle="The configurable reference data behind trips, fares, billing and the fleet. Changes here apply to new work; trips and invoices already priced keep their own values."
        actions={
          <>
            <Link to="/admin/vendors" className="btn-outline btn-sm">Vendors</Link>
            <Link to="/admin/outstation-fares" className="btn-outline btn-sm">Outstation fares</Link>
            <Link to="/admin/fleet" className="btn-outline btn-sm"><IconCar className="h-3.5 w-3.5" /> Fleet</Link>
          </>
        }
      />
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'categories', label: 'Vehicle categories' },
          { value: 'fare-rules', label: 'Fare rules' },
          { value: 'lists', label: 'Lists' },
          { value: 'locations', label: 'Locations' },
        ]}
      />
      {tab === 'categories' && <Categories />}
      {tab === 'fare-rules' && <Master embedded />}
      {tab === 'lists' && <Lists />}
      {tab === 'locations' && <Locations />}
    </div>
  );
}

/* ==========================================================================
   Vehicle categories
   ========================================================================== */

const EMPTY_CAT = {
  id: 0, name: '', code: '', segment: '', seating: '', luggage: '', exampleModels: '', aliases: '',
  outstationGroup: '', description: '', isActive: true, displayOrder: '0',
};
const SEGMENTS = ['Hatchback', 'Sedan', 'Premium sedan', 'SUV', 'Premium SUV', 'MUV', 'Group', 'Coach', 'Luxury'];
const GROUPS: [string, string][] = [
  ['', 'Not on the outstation fare card'], ['STANDARD', 'Standard (Dzire / Aura)'], ['SUV_MUV', 'SUV / MUV (Ertiga / XL6)'],
  ['PREMIUM_SEDAN', 'Premium sedan (City / Ciaz)'], ['PREMIUM_MUV', 'Premium MUV (Innova / Carens)'],
];

function Categories() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [form, setForm] = useState<typeof EMPTY_CAT | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);

  const editable = can('masters.update', 'vendors.update');
  const creatable = can('masters.create', 'vendors.update');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/masters/categories', { params: { all: 1 } });
      setRows(data.data ?? []);
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => rows.filter((r) =>
    (status === 'all' || (status === 'active' ? r.is_active : !r.is_active)) &&
    (!search || `${r.name} ${r.code} ${r.segment ?? ''} ${r.example_models ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  ), [rows, search, status]);

  const openEdit = (r?: any) => {
    setErrors({});
    setForm(r ? {
      id: r.id, name: r.name, code: r.code, segment: r.segment ?? '', seating: r.seating ? String(r.seating) : '',
      luggage: r.luggage != null ? String(r.luggage) : '', exampleModels: r.example_models ?? '',
      aliases: String(r.aliases ?? '').split('|').filter(Boolean).join(', '), outstationGroup: r.outstation_group ?? '',
      description: r.description ?? '', isActive: !!r.is_active, displayOrder: String(r.display_order ?? 0),
    } : { ...EMPTY_CAT, displayOrder: String((rows.length + 1) * 10) });
  };

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = 'Enter the category name.';
    if (form.seating && !(Number(form.seating) >= 1)) e.seating = 'Seats must be a number.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(), code: form.code.trim(), segment: form.segment,
        seating: form.seating ? Number(form.seating) : null, luggage: form.luggage ? Number(form.luggage) : null,
        exampleModels: form.exampleModels, aliases: form.aliases, outstationGroup: form.outstationGroup,
        description: form.description, isActive: form.isActive, displayOrder: Number(form.displayOrder) || 0,
      };
      if (form.id) await api.put(`/masters/categories/${form.id}`, payload);
      else await api.post('/masters/categories', payload);
      toast.success(form.id ? 'Category saved' : 'Category added', payload.name);
      setForm(null);
      load();
    } catch (err) {
      toast.error('Could not save the category', errorMessage(err));
    } finally { setBusy(false); }
  };

  const toggle = async (r: any) => {
    try {
      await api.put(`/masters/categories/${r.id}`, {
        name: r.name, code: r.code, segment: r.segment ?? '', seating: r.seating, luggage: r.luggage,
        exampleModels: r.example_models ?? '', aliases: String(r.aliases ?? '').replace(/\|/g, ', '),
        outstationGroup: r.outstation_group ?? '', description: r.description ?? '',
        isActive: !r.is_active, displayOrder: r.display_order ?? 0,
      });
      toast.success(r.is_active ? `${r.name} deactivated` : `${r.name} reactivated`,
        r.is_active ? 'It can no longer be chosen for new trips, rules or vehicles. History is unchanged.' : undefined);
      load();
    } catch (err) { toast.error('Could not change the category', errorMessage(err)); }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/masters/categories/${toDelete.id}`);
      toast.success('Category removed', data.message);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Not removed', errorMessage(err));
      setToDelete(null);
    } finally { setBusy(false); }
  };

  const openDetail = async (r: any) => {
    setDetail({ loading: true, data: r });
    try {
      const { data } = await api.get(`/masters/categories/${r.id}`);
      setDetail(data);
    } catch (err) { toast.error('Could not open the category', errorMessage(err)); setDetail(null); }
  };

  if (loading && !rows.length) return <Loading variant="table" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 p-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search categories…" className="flex-1" />
        <Segmented size="sm" value={status} onChange={setStatus} options={[
          { value: 'all', label: 'All', count: rows.length },
          { value: 'active', label: 'Active', count: rows.filter((r) => r.is_active).length },
          { value: 'inactive', label: 'Inactive', count: rows.filter((r) => !r.is_active).length },
        ]} />
        <ExportButton url="/masters/export/categories" />
        {creatable && <button className="btn-primary btn-sm" onClick={() => openEdit()}><IconPlus className="h-3.5 w-3.5" /> Add category</button>}
      </div>
      <DataTable
        rows={shown}
        rowKey={(r) => r.id}
        onRowClick={openDetail}
        rowClassName={(r) => (r.is_active ? '' : 'opacity-60')}
        empty={<EmptyState title="No categories match" body="Clear the search, or add a category." icon={<IconLayers className="h-5 w-5" />} />}
        columns={[
          { key: 'name', header: 'Category', render: (r) => (
            <div>
              <p className="font-semibold text-ink-900">{r.name}</p>
              <p className="cell-meta font-mono">{r.code}</p>
            </div>
          ) },
          { key: 'segment', header: 'Segment', render: (r) => r.segment || '—' },
          { key: 'seating', header: 'Seats', align: 'right' },
          { key: 'example_models', header: 'Models', render: (r) => <span className="line-clamp-1 max-w-[16rem] text-xs text-ink-600">{r.example_models || '—'}</span> },
          { key: 'vehicle_count', header: 'Vehicles', align: 'right' },
          { key: 'rule_count', header: 'Fare rules', align: 'right' },
          { key: 'trip_count', header: 'Trips', align: 'right' },
          { key: 'is_active', header: 'Status', sortValue: (r) => r.is_active, render: (r) => <StatusBadge value={r.is_active ? 'ACTIVE' : 'INACTIVE'} /> },
          { key: 'actions', header: '', sortable: false, sticky: true, align: 'right', render: (r) => (
            <Menu items={[
              { label: 'View usage', onClick: () => openDetail(r) },
              editable && { label: 'Edit', icon: <IconEdit className="h-4 w-4" />, onClick: () => openEdit(r) },
              editable && { label: r.is_active ? 'Deactivate' : 'Reactivate', onClick: () => toggle(r) },
              can('masters.delete', 'vendors.delete') && { divider: true, label: '-' },
              can('masters.delete', 'vendors.delete') && { label: 'Remove', icon: <IconTrash className="h-4 w-4" />, danger: true,
                hint: r.trip_count || r.rule_count || r.vehicle_count ? 'In use — will be refused' : 'Not used anywhere', onClick: () => setToDelete(r) },
            ]} />
          ) },
        ]}
      />

      <Modal
        open={!!form} onClose={() => setForm(null)} size="lg"
        title={form?.id ? `Edit ${form.name}` : 'Add a vehicle category'}
        subtitle="Categories are what trips, fare rules and fleet vehicles are classified by."
        footer={
          <>
            <button className="btn-outline" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} {form?.id ? 'Save' : 'Add category'}</button>
          </>
        }
      >
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name}>
              <input className={`input ${errors.name ? 'input-error' : ''}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Toyota Innova Crysta" autoFocus />
            </Field>
            <Field label="Code" hint="Leave blank to make one from the name. Fixed once the category is in use.">
              <input className="input font-mono uppercase" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="INNOVA_CRYSTA" />
            </Field>
            <Field label="Segment">
              <select className="input" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                <option value="">—</option>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Seats" error={errors.seating}><input className="input text-right" inputMode="numeric" value={form.seating} onChange={(e) => setForm({ ...form, seating: e.target.value })} /></Field>
              <Field label="Bags"><input className="input text-right" inputMode="numeric" value={form.luggage} onChange={(e) => setForm({ ...form, luggage: e.target.value })} /></Field>
            </div>
            <Field label="Example models" className="sm:col-span-2">
              <input className="input" value={form.exampleModels} onChange={(e) => setForm({ ...form, exampleModels: e.target.value })} placeholder="Toyota Innova Crysta, Kia Carens" />
            </Field>
            <Field label="Other spellings" className="sm:col-span-2" hint="Comma separated. Used to recognise this category in vendor messages and older bookings.">
              <input className="input" value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} placeholder="innova, crysta, innova crysta" />
            </Field>
            <Field label="Outstation fare group" hint="Which column of the Outstation Fares card this category is sold under">
              <select className="input" value={form.outstationGroup} onChange={(e) => setForm({ ...form, outstationGroup: e.target.value })}>
                {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Display order"><input className="input" inputMode="numeric" value={form.displayOrder} onChange={(e) => setForm({ ...form, displayOrder: e.target.value })} /></Field>
            <Field label="Description" className="sm:col-span-2">
              <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
              <input type="checkbox" className="check" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
              Active — can be chosen for new trips, fare rules and vehicles
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} danger busy={busy}
        title={`Remove ${toDelete?.name ?? 'category'}?`} confirmLabel="Remove"
        body={<p>A category used by any trip, fare rule, vehicle or invoice cannot be removed — deactivate it instead. One that is not used anywhere is deleted.</p>}
      />

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.data?.name ?? 'Category'}
        subtitle={detail?.data ? `${detail.data.segment ?? 'Category'} · ${detail.data.seating ?? '—'} seats` : ''} width="max-w-2xl">
        {detail?.loading ? <Loading variant="inline" /> : detail?.usage && (
          <div className="space-y-5">
            <dl className="grid grid-cols-3 gap-4">
              <Detail label="Vehicles">{detail.usage.vehicles} ({detail.usage.active_vehicles} active)</Detail>
              <Detail label="Fare rules">{detail.usage.fare_rules}</Detail>
              <Detail label="Trips">{detail.usage.trips}</Detail>
              <Detail label="Open enquiries">{detail.usage.enquiries}</Detail>
              <Detail label="Invoices">{detail.usage.invoices}</Detail>
              <Detail label="Status"><StatusBadge value={detail.data.is_active ? 'ACTIVE' : 'INACTIVE'} /></Detail>
            </dl>
            <div>
              <p className="eyebrow mb-2">Vehicles in this category</p>
              {detail.vehicles.length === 0 ? <p className="text-sm text-ink-500">None on the fleet list.</p> : (
                <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                  {detail.vehicles.map((v: any) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="font-mono font-semibold text-ink-900">{v.vehicle_number}</span>
                      <span className="text-ink-500">{v.model ?? ''} {v.vendor_name ? `· ${v.vendor_name}` : ''}</span>
                      <StatusBadge value={v.is_active ? v.availability_status : 'INACTIVE'} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="eyebrow mb-2">Fare rules</p>
              {detail.rules.length === 0 ? <p className="text-sm text-ink-500">No fare rules use this category.</p> : (
                <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                  {detail.rules.map((r: any) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>{r.vendor_name}</span>
                      <span className="text-ink-600">{r.plan_label}</span>
                      <span className="tabular-nums text-ink-800">{r.plan_type === 'OUTSTATION' ? `${inr(r.per_km_rate)}/km` : inr(r.base_fare)}</span>
                      <StatusBadge value={r.is_active ? 'ACTIVE' : 'INACTIVE'} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="eyebrow mb-2">Recent trips</p>
              {detail.recentTrips.length === 0 ? <p className="text-sm text-ink-500">No trips yet.</p> : (
                <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
                  {detail.recentTrips.map((t: any) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <Link to={`/admin/trips?open=${t.id}`} className="cell-code hover:underline">{t.trip_id}</Link>
                      <span className="text-ink-600">{t.customer_name || t.passenger_name}</span>
                      <span className="text-xs text-ink-500">{dmy(t.travel_date)}</span>
                      <StatusBadge value={t.booking_status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </section>
  );
}

/* ==========================================================================
   Lists
   ========================================================================== */

function Lists() {
  const toast = useToast();
  const { can } = useAuth();
  const [types, setTypes] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/masters/lists');
      setTypes(data.types ?? []);
      setRows(data.data ?? []);
      setType((t) => t || data.types?.[0]?.type || '');
    } catch (err) { toast.error('Could not load the lists', errorMessage(err)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const current = types.find((t) => t.type === type);
  const shown = rows.filter((r) => r.list_type === type);

  const save = async () => {
    setBusy(true);
    try {
      const payload = { code: form.code, label: form.label, description: form.description, isActive: form.isActive, sortOrder: Number(form.sortOrder) || 0 };
      if (form.id) await api.put(`/masters/lists/${type}/${form.id}`, payload);
      else await api.post(`/masters/lists/${type}`, payload);
      toast.success('Saved', form.label);
      setForm(null);
      load();
    } catch (err) { toast.error('Could not save', errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/masters/lists/${type}/${toDelete.id}`);
      toast.success('Removed', toDelete.label);
      setToDelete(null);
      load();
    } catch (err) { toast.error('Not removed', errorMessage(err)); setToDelete(null); } finally { setBusy(false); }
  };

  if (loading && !rows.length) return <Loading variant="table" />;

  return (
    <div className="grid gap-5 lg:grid-cols-[16rem,1fr]">
      <aside className="card h-max p-2">
        {types.map((t) => (
          <button key={t.type} onClick={() => setType(t.type)}
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${type === t.type ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-ink-50'}`}>
            {t.label}<span className="text-2xs tabular-nums text-ink-400">{t.count}</span>
          </button>
        ))}
        <div className="mt-2 border-t border-ink-100 p-2"><ExportButton url="/masters/export/lists" label="Export all" csv={false} /></div>
      </aside>
      <section className="table-wrap">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 px-4 py-3">
          <div>
            <h2 className="card-title">{current?.label}</h2>
            <p className="card-sub max-w-xl">{current?.description}</p>
          </div>
          {can('masters.create', 'vendors.update') && (
            <button className="btn-primary btn-sm" onClick={() => setForm({ code: '', label: '', description: '', isActive: true, sortOrder: String((shown.length + 1) * 10) })}>
              <IconPlus className="h-3.5 w-3.5" /> Add value
            </button>
          )}
        </div>
        <DataTable
          rows={shown} rowKey={(r) => r.id}
          rowClassName={(r) => (r.is_active ? '' : 'opacity-60')}
          columns={[
            { key: 'label', header: 'Label', render: (r) => <span className="font-medium text-ink-900">{r.label}</span> },
            { key: 'code', header: 'Code', render: (r) => <span className="cell-code">{r.code}</span> },
            { key: 'description', header: 'Description', render: (r) => <span className="text-xs text-ink-500">{r.description || '—'}</span> },
            { key: 'is_system', header: 'Type', render: (r) => r.is_system ? <span className="badge-neutral">Built in</span> : <span className="badge-brand">Custom</span> },
            { key: 'is_active', header: 'Status', render: (r) => <StatusBadge value={r.is_active ? 'ACTIVE' : 'INACTIVE'} /> },
            { key: 'sort_order', header: 'Order', align: 'right' },
            { key: 'a', header: '', sortable: false, align: 'right', render: (r) => (
              <Menu items={[
                can('masters.update', 'vendors.update') && { label: 'Edit', onClick: () => setForm({ id: r.id, code: r.code, label: r.label, description: r.description ?? '', isActive: !!r.is_active, sortOrder: String(r.sort_order), system: !!r.is_system }) },
                can('masters.delete', 'vendors.delete') && !r.is_system && { label: 'Remove', danger: true, onClick: () => setToDelete(r) },
              ]} />
            ) },
          ]}
        />
      </section>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit value' : `Add to ${current?.label ?? 'list'}`}
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" disabled={busy || !form?.label?.trim()} onClick={save}>{busy && <Spinner />} Save</button></>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Label" required><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus /></Field>
            <Field label="Code" hint={form.id ? 'Codes do not change once created' : 'Blank = made from the label'}>
              <input className="input font-mono uppercase" value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Description" className="sm:col-span-2"><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Order"><input className="input" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-700">
              <input type="checkbox" className="check" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
            </label>
            {form.system && <p className="notice-info text-xs sm:col-span-2">This value is built in — the portal relies on its code. You can rename it, reorder it or switch it off.</p>}
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} danger busy={busy}
        title={`Remove “${toDelete?.label}”?`} confirmLabel="Remove"
        body={<p>A value already used on a record is refused — switch it off instead.</p>} />
    </div>
  );
}

/* ==========================================================================
   Locations
   ========================================================================== */

function Locations() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await api.get('/masters/locations', { params: { search } }); setRows(data.data ?? []); }
    catch (err) { toast.error('Could not load locations', errorMessage(err)); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    try {
      await api.put(`/masters/locations/${form.id}`, form);
      toast.success('Location saved');
      setForm(null);
      load();
    } catch (err) { toast.error('Could not save', errorMessage(err)); }
  };
  const remove = async (r: any) => {
    try { await api.delete(`/masters/locations/${r.id}`); toast.success('Removed from suggestions', r.label); load(); }
    catch (err) { toast.error('Could not remove', errorMessage(err)); }
  };

  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 p-3">
        <SearchBox value={search} onChange={setSearch} placeholder="Search locations…" className="flex-1" />
        <p className="text-xs text-ink-500">Suggestions only — trips keep their own address text.</p>
      </div>
      <DataTable
        rows={rows} rowKey={(r) => r.id} loading={loading} pageSize={50}
        empty={<EmptyState title="No locations yet" body="Pickup and drop points are added here automatically as trips are entered." icon={<IconMap className="h-5 w-5" />} />}
        columns={[
          { key: 'label', header: 'Location', render: (r) => <span className="font-medium text-ink-900">{r.label}</span> },
          { key: 'kind', header: 'Kind', render: (r) => r.kind ? <span className="badge-neutral">{r.kind}</span> : '—' },
          { key: 'city', header: 'City', render: (r) => r.city || '—' },
          { key: 'use_count', header: 'Used', align: 'right' },
          { key: 'a', header: '', sortable: false, align: 'right', render: (r) => (
            <Menu items={[
              can('masters.update', 'vendors.update') && { label: 'Edit', onClick: () => setForm({ id: r.id, label: r.label, kind: r.kind ?? '', city: r.city ?? '' }) },
              can('masters.delete', 'vendors.delete') && { label: 'Remove suggestion', danger: true, onClick: () => remove(r) },
            ]} />
          ) },
        ]}
      />
      <Modal open={!!form} onClose={() => setForm(null)} title="Edit location"
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
        {form && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Location" className="sm:col-span-3"><input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></Field>
            <Field label="Kind">
              <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="">—</option>{['AIRPORT', 'HOTEL', 'OFFICE', 'STATION', 'RESIDENCE', 'OTHER'].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="City" className="sm:col-span-2"><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </section>
  );
}

