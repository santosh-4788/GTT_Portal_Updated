/**
 * Fleet — vehicles, drivers, who is free on a day, who drove what, and which
 * documents are about to lapse.
 *
 * Moved here from Settings. The allotment in the trip drawer reads the same
 * lists, and refuses a deactivated, off-road or double-booked vehicle or
 * driver (see backend/src/services/fleet.ts).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime, humanise, todayLocalIso } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { ConfirmDialog, EmptyState, ErrorState, Field, Loading, Modal, PageHeader, Spinner, StatusBadge } from '../components/ui';
import { DataTable, Detail, Drawer, ExportButton, Kpi, Menu, SearchBox, Segmented } from '../components/data';
import { DateField } from '../components/DateTimeField';
import { IconCar, IconIdCard, IconPlus, IconWarning, IconCalendar, IconHistory, IconEdit } from '../components/icons';

type Tab = 'vehicles' | 'drivers' | 'availability' | 'assignments' | 'documents';

export default function Fleet() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'vehicles';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  const [summary, setSummary] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [lists, setLists] = useState<Record<string, { code: string; label: string }[]>>({});
  const [bump, setBump] = useState(0);

  const refreshSummary = useCallback(() => {
    api.get('/fleet/summary').then((r) => setSummary(r.data)).catch(() => {});
  }, []);
  useEffect(() => { refreshSummary(); }, [refreshSummary, bump]);
  useEffect(() => {
    Promise.all([
      api.get('/vendors/options').catch(() => ({ data: { data: [] } })),
      api.get('/fares/categories').catch(() => ({ data: { data: [] } })),
      api.get('/masters/lists/FUEL_TYPE/options').catch(() => ({ data: { data: [] } })),
    ]).then(([v, c, f]) => {
      setVendors((v.data.data ?? []).filter((x: any) => x.code !== 'DIRECT'));
      setCategories(c.data.data ?? []);
      setLists({ FUEL_TYPE: f.data.data ?? [] });
    });
  }, []);

  const ctx = { vendors, categories, lists, onChanged: () => setBump((b) => b + 1) };

  return (
    <div className="page">
      <PageHeader
        title="Fleet"
        subtitle="Vehicles and drivers, their availability and documents. Trips are allotted from these lists — an inactive, off-road or double-booked vehicle or driver cannot be allotted."
      />
      {summary && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          <Kpi label="Active vehicles" value={summary.active_vehicles} sub={`${summary.vehicles_off_road} off the road`} tone="brand" icon={<IconCar className="h-4 w-4" />} onClick={() => setTab('vehicles')} />
          <Kpi label="On trips today" value={summary.vehicles_busy_today} sub={`${summary.vehicles_on_trip_now ?? 0} on the road right now`} tone="violet" icon={<IconCalendar className="h-4 w-4" />} onClick={() => setTab('availability')} />
          <Kpi label="Available today" value={summary.vehicles_available_today ?? 0} sub="Active vehicles with no trip today" tone="success" icon={<IconCar className="h-4 w-4" />} onClick={() => setTab('availability')} />
          <Kpi label="Active drivers" value={summary.active_drivers} sub={`${summary.drivers_away} away today`} tone="teal" icon={<IconIdCard className="h-4 w-4" />} onClick={() => setTab('drivers')} />
          <Kpi label="Drivers on leave" value={summary.drivers_on_leave ?? 0} sub="Today, by status or leave dates" tone={summary.drivers_on_leave ? 'warning' : undefined} icon={<IconIdCard className="h-4 w-4" />} onClick={() => setTab('drivers')} />
          <Kpi label="Documents due" value={summary.documents} sub="Expired or expiring in 30 days" tone={summary.documents ? 'warning' : 'success'} icon={<IconWarning className="h-4 w-4" />} onClick={() => setTab('documents')} />
          <Kpi label="Inactive vehicles" value={summary.inactive_vehicles} sub="Kept for trip history" icon={<IconHistory className="h-4 w-4" />} />
        </div>
      )}
      <Segmented<Tab>
        value={tab} onChange={setTab}
        options={[
          { value: 'vehicles', label: 'Vehicles' },
          { value: 'drivers', label: 'Drivers' },
          { value: 'availability', label: 'Availability' },
          { value: 'assignments', label: 'Assignment history' },
          { value: 'documents', label: 'Documents', count: summary?.documents, alert: true },
        ]}
      />
      {tab === 'vehicles' && <Vehicles {...ctx} key={`v${bump}`} />}
      {tab === 'drivers' && <Drivers {...ctx} key={`d${bump}`} />}
      {tab === 'availability' && <Availability />}
      {tab === 'assignments' && <Assignments />}
      {tab === 'documents' && <Documents />}
    </div>
  );
}

interface Ctx {
  vendors: any[]; categories: any[]; lists: Record<string, { code: string; label: string }[]>; onChanged: () => void;
}

const DOC_BADGE = (state: string) =>
  state === 'EXPIRED' ? <span className="badge-danger-solid">Document expired</span>
    : state === 'EXPIRING' ? <span className="badge-warn">Renewal due</span>
      : null;

/* ==========================================================================
   Vehicles
   ========================================================================== */

const EMPTY_VEHICLE = {
  id: 0, vehicleNumber: '', categoryId: '', make: '', model: '', seating: '', fuelType: '', manufactureYear: '',
  ownershipType: 'OWN', vendorId: '', ownerName: '', ownerMobile: '', availabilityStatus: 'AVAILABLE',
  driverName: '', driverMobile: '', rcExpiry: '', permitNumber: '', permitExpiry: '', insuranceNumber: '',
  insuranceExpiry: '', fitnessExpiry: '', pucExpiry: '', notes: '', isActive: true,
  regularDriverId: '', addDriver: false,
  newDriver: { fullName: '', mobile: '', licenceNumber: '', licenceExpiry: '', associationType: 'EMPLOYEE' },
};

function Vehicles({ vendors, categories, lists, onChanged }: Ctx) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [f, setF] = useState({ search: '', status: 'ACTIVE', categoryId: '', ownership: '', availability: '' });
  const [form, setForm] = useState<typeof EMPTY_VEHICLE | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const { data } = await api.get('/fleet/vehicles', { params: f }); setRows(data.data ?? []); }
    catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const openForm = (v?: any) => {
    setErrors({});
    setForm(v ? {
      id: v.id, vehicleNumber: v.vehicle_number, categoryId: v.category_id ? String(v.category_id) : '',
      make: v.make ?? '', model: v.model ?? '', seating: v.seating ? String(v.seating) : '', fuelType: v.fuel_type ?? '',
      manufactureYear: v.manufacture_year ? String(v.manufacture_year) : '', ownershipType: v.ownership_type ?? 'OWN',
      vendorId: v.vendor_id ? String(v.vendor_id) : '', ownerName: v.owner_name ?? '', ownerMobile: v.owner_mobile ?? '',
      availabilityStatus: v.availability_status ?? 'AVAILABLE', driverName: v.driver_name ?? '', driverMobile: v.driver_mobile ?? '',
      rcExpiry: v.rc_expiry ?? '', permitNumber: v.permit_number ?? '', permitExpiry: v.permit_expiry ?? '',
      insuranceNumber: v.insurance_number ?? '', insuranceExpiry: v.insurance_expiry ?? '', fitnessExpiry: v.fitness_expiry ?? '',
      pucExpiry: v.puc_expiry ?? '', notes: v.notes ?? '', isActive: !!v.is_active,
      regularDriverId: v.regular_driver_id ? String(v.regular_driver_id) : '', addDriver: false,
      newDriver: { ...EMPTY_VEHICLE.newDriver },
    } : { ...EMPTY_VEHICLE, newDriver: { ...EMPTY_VEHICLE.newDriver } });
  };
  const [roster, setRoster] = useState<any[]>([]);
  useEffect(() => {
    if (form) api.get('/fleet/drivers', { params: { status: 'ACTIVE' } }).then((r) => setRoster(r.data.data ?? [])).catch(() => {});
  }, [!!form]); // eslint-disable-line react-hooks/exhaustive-deps
  const setNew = (k: keyof typeof EMPTY_VEHICLE.newDriver) => (e: any) =>
    setForm((p) => p && ({ ...p, newDriver: { ...p.newDriver, [k]: e?.target ? e.target.value : e } }));

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    const reg = form.vehicleNumber.toUpperCase().replace(/[\s-]+/g, '');
    if (!/^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(reg)) e.vehicleNumber = 'Use the registration format, e.g. MH04LQ1748.';
    if (!form.categoryId) e.categoryId = 'Choose the category.';
    if (form.ownershipType !== 'OWN' && !form.ownerName && !form.vendorId) e.ownerName = 'Who owns it? Needed for payouts.';
    if (form.ownerMobile && !/^[6-9]\d{9}$/.test(form.ownerMobile.replace(/\D/g, '').slice(-10))) e.ownerMobile = '10-digit mobile.';
    if (form.addDriver) {
      if (form.newDriver.fullName.trim().length < 2) e.newDriverName = 'Enter the new driver\'s name.';
      if (!/^[6-9]\d{9}$/.test(form.newDriver.mobile.replace(/\D/g, '').slice(-10))) e.newDriverMobile = 'Enter a 10-digit mobile.';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = {
        ...form, vehicleNumber: reg, categoryId: Number(form.categoryId),
        seating: form.seating ? Number(form.seating) : null, vendorId: form.vendorId ? Number(form.vendorId) : null,
        manufactureYear: form.manufactureYear ? Number(form.manufactureYear) : '',
        regularDriverId: !form.addDriver && form.regularDriverId ? Number(form.regularDriverId) : null,
        newDriver: form.addDriver ? form.newDriver : null,
        // With a roster driver the server copies their name and number; otherwise
        // the free-text driver already on the vehicle is kept as it was.
        driverName: form.addDriver || form.regularDriverId ? '' : form.driverName,
        driverMobile: form.addDriver || form.regularDriverId ? '' : form.driverMobile,
      };
      const { data } = form.id ? await api.put(`/fleet/vehicles/${form.id}`, payload) : await api.post('/fleet/vehicles', payload);
      toast.success(data.message ?? 'Vehicle saved');
      setForm(null);
      load(); onChanged();
    } catch (err) { toast.error('Could not save the vehicle', errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/fleet/vehicles/${toDelete.id}`);
      toast.success(data.deactivated ? 'Vehicle deactivated' : 'Vehicle removed', data.message);
      setToDelete(null); load(); onChanged();
    } catch (err) { toast.error('Could not remove', errorMessage(err)); } finally { setBusy(false); }
  };

  const openDetail = async (v: any) => {
    setDetail({ loading: true, data: v });
    try { const { data } = await api.get(`/fleet/vehicles/${v.id}`); setDetail(data); }
    catch (err) { toast.error('Could not open the vehicle', errorMessage(err)); setDetail(null); }
  };

  const set = (k: keyof typeof EMPTY_VEHICLE) => (e: any) => setForm((p) => p && ({ ...p, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 p-3">
        <SearchBox value={f.search} onChange={(v) => setF({ ...f, search: v })} placeholder="Number, model, owner, driver…" className="flex-1" />
        <select className="input h-9 w-auto text-[13px]" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} aria-label="Category">
          <option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="input h-9 w-auto text-[13px]" value={f.ownership} onChange={(e) => setF({ ...f, ownership: e.target.value })} aria-label="Ownership">
          <option value="">Any ownership</option><option value="OWN">Own</option><option value="ATTACHED">Attached</option><option value="PARTNER">Hired</option>
        </select>
        <select className="input h-9 w-auto text-[13px]" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} aria-label="Availability">
          <option value="">Any availability</option><option value="AVAILABLE">Available</option><option value="MAINTENANCE">Maintenance</option><option value="UNAVAILABLE">Unavailable</option>
        </select>
        <select className="input h-9 w-auto text-[13px]" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="">All</option>
        </select>
        <ExportButton url="/fleet/export/vehicles" params={f} />
        {can('fleet.create', 'settings.create') && <button className="btn-primary btn-sm" onClick={() => openForm()}><IconPlus className="h-3.5 w-3.5" /> Add vehicle</button>}
      </div>
      <DataTable
        rows={rows} rowKey={(r) => r.id} loading={loading} onRowClick={openDetail} pageSize={50}
        rowClassName={(r) => (r.is_active ? '' : 'opacity-60')}
        empty={<EmptyState title="No vehicles match" body="Clear the filters, or add the first vehicle." icon={<IconCar className="h-5 w-5" />} />}
        columns={[
          { key: 'vehicle_number', header: 'Vehicle', render: (r) => (
            <div>
              <p className="font-mono text-[13px] font-semibold text-ink-900">{r.vehicle_number}</p>
              <p className="cell-meta">{[r.make, r.model].filter(Boolean).join(' ') || r.vehicle_type}</p>
            </div>
          ) },
          { key: 'category_name', header: 'Category', render: (r) => r.category_name ?? <span className="text-warn-600">Not set</span> },
          { key: 'seating', header: 'Seats', align: 'right' },
          { key: 'ownership_type', header: 'Ownership', render: (r) => (
            <div><p className="text-sm">{humanise(r.ownership_type)}</p>{(r.vendor_name || r.owner_name) && <p className="cell-meta">{r.vendor_name || r.owner_name}</p>}</div>
          ) },
          { key: 'driver_name', header: 'Regular driver', render: (r) => (r.regular_driver_name ?? r.driver_name) || '—' },
          { key: 'next_trip', header: 'Next trip', sortValue: (r) => r.next_trip?.date ?? '9999', render: (r) => r.next_trip ? (
            <div><p className="cell-code">{r.next_trip.tripId}</p><p className="cell-meta">{dmy(r.next_trip.date)} {r.next_trip.time}</p></div>
          ) : <span className="text-xs text-ink-400">Free</span> },
          { key: 'availability_status', header: 'Status', render: (r) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge value={r.is_active ? r.availability_status : 'INACTIVE'} />
              {DOC_BADGE(r.document_state)}
            </div>
          ) },
          { key: 'trip_count', header: 'Trips', align: 'right' },
          { key: 'a', header: '', sortable: false, sticky: true, align: 'right', render: (r) => (
            <Menu items={[
              { label: 'Open', onClick: () => openDetail(r) },
              can('fleet.update', 'settings.update') && { label: 'Edit', icon: <IconEdit className="h-4 w-4" />, onClick: () => openForm(r) },
              can('fleet.delete', 'settings.delete') && { label: r.trip_count ? 'Deactivate' : 'Remove', danger: true, hint: r.trip_count ? 'Has trip history — kept, switched off' : undefined, onClick: () => setToDelete(r) },
            ]} />
          ) },
        ]}
      />

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title={form?.id ? `Edit ${form.vehicleNumber}` : 'Add a vehicle'}
        subtitle="Registration numbers must be unique. Document dates drive the expiry warnings and stop an expired vehicle being allotted."
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} {form?.id ? 'Save vehicle' : 'Add vehicle'}</button></>}>
        {form && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Registration no." required error={errors.vehicleNumber}>
                <input className={`input font-mono uppercase ${errors.vehicleNumber ? 'input-error' : ''}`} value={form.vehicleNumber} onChange={set('vehicleNumber')} placeholder="MH04LQ1748" autoFocus />
              </Field>
              <Field label="Category" required error={errors.categoryId}>
                <select className={`input ${errors.categoryId ? 'input-error' : ''}`} value={form.categoryId} onChange={set('categoryId')}>
                  <option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Seats"><input className="input text-right" inputMode="numeric" value={form.seating} onChange={set('seating')} placeholder="auto" /></Field>
                <Field label="Year"><input className="input text-right" inputMode="numeric" value={form.manufactureYear} onChange={set('manufactureYear')} /></Field>
              </div>
              <Field label="Make"><input className="input" value={form.make} onChange={set('make')} placeholder="Toyota" /></Field>
              <Field label="Model"><input className="input" value={form.model} onChange={set('model')} placeholder="Innova Crysta 2.4 GX" /></Field>
              <Field label="Fuel">
                <select className="input" value={form.fuelType} onChange={set('fuelType')}>
                  <option value="">—</option>{(lists.FUEL_TYPE ?? []).map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-3">
              <Field label="Ownership">
                <select className="input" value={form.ownershipType} onChange={set('ownershipType')}>
                  <option value="OWN">Own</option><option value="ATTACHED">Attached (owner-driven)</option><option value="PARTNER">Hired (partner / vendor vehicle)</option>
                </select>
              </Field>
              <Field label="Vendor" hint="If the vehicle belongs to a vendor">
                <select className="input" value={form.vendorId} onChange={set('vendorId')}>
                  <option value="">—</option>{vendors.filter((v) => v.status === 'ACTIVE' || String(v.id) === form.vendorId).map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </Field>
              <Field label="Availability">
                <select className="input" value={form.availabilityStatus} onChange={set('availabilityStatus')}>
                  <option value="AVAILABLE">Available</option><option value="MAINTENANCE">In maintenance</option><option value="UNAVAILABLE">Unavailable</option>
                </select>
              </Field>
              <Field label="Owner name" error={errors.ownerName} hint={form.ownershipType === 'OWN' ? 'Optional for own vehicles' : 'Payouts go to this name'}>
                <input className={`input ${errors.ownerName ? 'input-error' : ''}`} value={form.ownerName} onChange={set('ownerName')} />
              </Field>
              <Field label="Owner mobile" error={errors.ownerMobile}><input className="input" inputMode="numeric" value={form.ownerMobile} onChange={set('ownerMobile')} /></Field>
              <div />
              <Field label="Regular driver" hint="Suggested first whenever this vehicle is allotted" className="sm:col-span-2">
                {form.addDriver ? (
                  <p className="text-sm text-ink-600">A new driver will be added to the roster and linked to this vehicle.</p>
                ) : (
                  <select className="input" value={form.regularDriverId} onChange={set('regularDriverId')}>
                    <option value="">{form.driverName ? `Not on the roster (${form.driverName})` : 'None'}</option>
                    {roster.map((d) => <option key={d.id} value={d.id}>{d.full_name} — {d.mobile}{d.default_vehicle_number && String(d.default_vehicle_id) !== String(form.id) ? ` · usually ${d.default_vehicle_number}` : ''}</option>)}
                  </select>
                )}
              </Field>
              <div className="flex items-end pb-1">
                <button type="button" className="btn-outline btn-sm" onClick={() => setForm((p) => p && ({ ...p, addDriver: !p.addDriver }))}>
                  {form.addDriver ? 'Pick from the roster instead' : '+ Add a new driver'}
                </button>
              </div>
              {form.addDriver && (
                <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:col-span-3 sm:grid-cols-3">
                  <p className="eyebrow sm:col-span-3">New driver — saved with the vehicle; the rest of the vehicle form is kept</p>
                  <Field label="Full name" required error={errors.newDriverName}><input className="input" value={form.newDriver.fullName} onChange={setNew('fullName')} /></Field>
                  <Field label="Mobile" required error={errors.newDriverMobile}><input className="input" inputMode="numeric" value={form.newDriver.mobile} onChange={setNew('mobile')} /></Field>
                  <Field label="Association">
                    <select className="input" value={form.newDriver.associationType} onChange={setNew('associationType')}>
                      <option value="EMPLOYEE">Employee</option><option value="ATTACHED">Attached</option><option value="HIRED">Hired</option><option value="FREELANCE">Freelance</option>
                    </select>
                  </Field>
                  <Field label="Licence no."><input className="input font-mono uppercase" value={form.newDriver.licenceNumber} onChange={setNew('licenceNumber')} /></Field>
                  <Field label="Licence valid till"><DateField value={form.newDriver.licenceExpiry} onChange={setNew('licenceExpiry')} quick={false} /></Field>
                </div>
              )}
            </div>
            <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-3">
              <p className="eyebrow sm:col-span-3">Documents</p>
              <Field label="Insurance policy no."><input className="input" value={form.insuranceNumber} onChange={set('insuranceNumber')} /></Field>
              <Field label="Insurance valid till"><DateField value={form.insuranceExpiry} onChange={set('insuranceExpiry')} quick={false} /></Field>
              <Field label="RC valid till"><DateField value={form.rcExpiry} onChange={set('rcExpiry')} quick={false} /></Field>
              <Field label="Permit no."><input className="input" value={form.permitNumber} onChange={set('permitNumber')} /></Field>
              <Field label="Permit valid till"><DateField value={form.permitExpiry} onChange={set('permitExpiry')} quick={false} /></Field>
              <Field label="Fitness valid till"><DateField value={form.fitnessExpiry} onChange={set('fitnessExpiry')} quick={false} /></Field>
              <Field label="PUC valid till"><DateField value={form.pucExpiry} onChange={set('pucExpiry')} quick={false} /></Field>
            </div>
            <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} placeholder="Service due, accessories, restrictions…" /></Field>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="check" checked={form.isActive} onChange={set('isActive')} /> Active — can be allotted to new trips
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} danger busy={busy}
        title={`${toDelete?.trip_count ? 'Deactivate' : 'Remove'} ${toDelete?.vehicle_number}?`}
        confirmLabel={toDelete?.trip_count ? 'Deactivate' : 'Remove'}
        body={<p>{toDelete?.trip_count ? 'This vehicle has trip history, so it is kept and switched off — it can no longer be allotted, and its past trips are unchanged.' : 'This vehicle has never been used and will be removed.'}</p>} />

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.data?.vehicle_number ?? 'Vehicle'}
        subtitle={detail?.data ? `${detail.data.category_name ?? detail.data.vehicle_type} · ${[detail.data.make, detail.data.model].filter(Boolean).join(' ')}` : ''}
        headerExtra={detail?.data && can('fleet.update', 'settings.update') ? <button className="btn-outline btn-sm" onClick={() => { const v = detail.data; setDetail(null); openForm(v); }}><IconEdit className="h-3.5 w-3.5" /> Edit</button> : undefined}>
        {detail?.loading ? <Loading variant="inline" /> : detail?.data && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Detail label="Status"><StatusBadge value={detail.data.is_active ? detail.data.availability_status : 'INACTIVE'} /></Detail>
              <Detail label="Ownership">{humanise(detail.data.ownership_type)}</Detail>
              <Detail label="Owner / vendor">{detail.data.vendor_name || detail.data.owner_name}</Detail>
              <Detail label="Seats">{detail.data.seating}</Detail>
              <Detail label="Fuel">{detail.data.fuel_type}</Detail>
              <Detail label="Regular driver">{detail.data.driver_name}</Detail>
            </dl>
            <DocList docs={detail.data.documents} />
            <TripList trips={detail.trips} kind="vehicle" />
            <AssignmentList rows={detail.assignments} />
            {detail.data.notes && <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">{detail.data.notes}</p>}
          </div>
        )}
      </Drawer>
    </section>
  );
}

function DocList({ docs }: { docs: any[] }) {
  return (
    <div>
      <p className="eyebrow mb-2">Documents</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {docs.map((d) => (
          <li key={d.key} className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-sm">
            <span className="text-ink-700">{d.label}</span>
            <span className="flex items-center gap-2">
              <span className="text-xs text-ink-500">{d.date ? dmy(d.date) : 'Not recorded'}</span>
              {d.state !== 'NONE' && <StatusBadge value={d.state} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TripList({ trips, kind }: { trips: any[]; kind: 'vehicle' | 'driver' }) {
  return (
    <div>
      <p className="eyebrow mb-2">Recent trips</p>
      {trips.length === 0 ? <p className="text-sm text-ink-500">No trips yet.</p> : (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200">
          {trips.slice(0, 15).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <Link to={`/admin/trips?open=${t.id}`} className="cell-code hover:underline">{t.trip_id}</Link>
              <span className="min-w-0 flex-1 truncate text-ink-600">{t.customer} · {[t.pickup_location, t.drop_location].filter(Boolean).join(' → ')}</span>
              <span className="text-xs text-ink-500">{dmy(t.travel_date)} {t.reporting_time ?? ''}</span>
              <span className="text-xs text-ink-500">{kind === 'vehicle' ? t.driver_name : t.vehicle_number}</span>
              <StatusBadge value={t.booking_status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssignmentList({ rows }: { rows: any[] }) {
  return (
    <div>
      <p className="eyebrow mb-2">Assignment history</p>
      {rows.length === 0 ? <p className="text-sm text-ink-500">No allotments recorded yet.</p> : (
        <ul className="divide-y divide-ink-100 rounded-lg border border-ink-200 text-sm">
          {rows.slice(0, 20).map((a) => (
            <li key={a.id} className="px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="cell-code">{a.trip_id}</span>
                <span className="text-ink-700">{[a.vehicle_number, a.driver_name].filter(Boolean).join(' · ')}</span>
                <span className="text-xs text-ink-500">{dmyTime(a.assigned_at)}{a.assigned_by_name ? ` · ${a.assigned_by_name}` : ''}</span>
              </div>
              {(a.released_at || a.override_reason) && (
                <p className="mt-0.5 text-xs text-ink-500">
                  {a.released_at && `Released ${dmyTime(a.released_at)} — ${a.release_reason ?? ''}. `}
                  {a.override_reason && <span className="text-warn-700">Clash overridden: {a.override_reason}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ==========================================================================
   Drivers
   ========================================================================== */

const EMPTY_DRIVER = {
  id: 0, fullName: '', mobile: '', altMobile: '', licenceNumber: '', licenceIssued: '', licenceExpiry: '',
  badgeNumber: '', badgeExpiry: '', idProof: '', policeVerifiedOn: '', address: '', languages: '',
  experienceYears: '', vendorId: '', defaultVehicleId: '', availabilityStatus: 'AVAILABLE', notes: '', isActive: true,
  associationType: 'EMPLOYEE', leaveFrom: '', leaveTo: '', unavailableReason: '',
};

function Drivers({ vendors, onChanged }: Ctx) {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [f, setF] = useState({ search: '', status: 'ACTIVE', availability: '' });
  const [form, setForm] = useState<typeof EMPTY_DRIVER | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [toDelete, setToDelete] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const { data } = await api.get('/fleet/drivers', { params: f }); setRows(data.data ?? []); }
    catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get('/fleet/vehicles', { params: { status: 'ACTIVE' } }).then((r) => setVehicles(r.data.data ?? [])).catch(() => {}); }, []);

  const openForm = (d?: any) => {
    setErrors({});
    setForm(d ? {
      id: d.id, fullName: d.full_name, mobile: d.mobile, altMobile: d.alt_mobile ?? '', licenceNumber: d.licence_number ?? '',
      licenceIssued: d.licence_issued ?? '', licenceExpiry: d.licence_expiry ?? '', badgeNumber: d.badge_number ?? '',
      badgeExpiry: d.badge_expiry ?? '', idProof: d.id_proof ?? '', policeVerifiedOn: d.police_verified_on ?? '',
      address: d.address ?? '', languages: d.languages ?? '', experienceYears: d.experience_years != null ? String(d.experience_years) : '',
      vendorId: d.vendor_id ? String(d.vendor_id) : '', defaultVehicleId: d.default_vehicle_id ? String(d.default_vehicle_id) : '',
      availabilityStatus: d.availability_status ?? 'AVAILABLE', notes: d.notes ?? '', isActive: !!d.is_active,
      associationType: d.association_type ?? 'EMPLOYEE', leaveFrom: d.leave_from ?? '', leaveTo: d.leave_to ?? '',
      unavailableReason: d.unavailable_reason ?? '',
    } : { ...EMPTY_DRIVER });
  };

  const save = async () => {
    if (!form) return;
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 2) e.fullName = 'Enter the driver\'s name.';
    if (!/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').slice(-10))) e.mobile = 'Enter a 10-digit mobile.';
    if (form.licenceIssued && form.licenceExpiry && form.licenceExpiry <= form.licenceIssued) e.licenceExpiry = 'Expiry must be after issue.';
    if (form.leaveTo && !form.leaveFrom) e.leaveFrom = 'Enter the first day of leave.';
    if (form.leaveFrom && form.leaveTo && form.leaveTo < form.leaveFrom) e.leaveTo = 'Leave cannot end before it starts.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const payload = {
        ...form, vendorId: form.vendorId ? Number(form.vendorId) : null,
        defaultVehicleId: form.defaultVehicleId ? Number(form.defaultVehicleId) : null,
        experienceYears: form.experienceYears === '' ? '' : Number(form.experienceYears),
      };
      const { data } = form.id ? await api.put(`/fleet/drivers/${form.id}`, payload) : await api.post('/fleet/drivers', payload);
      toast.success(data.message ?? 'Driver saved');
      setForm(null); load(); onChanged();
    } catch (err) { toast.error('Could not save the driver', errorMessage(err)); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/fleet/drivers/${toDelete.id}`);
      toast.success(data.deactivated ? 'Driver deactivated' : 'Driver removed', data.message);
      setToDelete(null); load(); onChanged();
    } catch (err) { toast.error('Could not remove', errorMessage(err)); } finally { setBusy(false); }
  };

  const openDetail = async (d: any) => {
    setDetail({ loading: true, data: d });
    try { const { data } = await api.get(`/fleet/drivers/${d.id}`); setDetail(data); }
    catch (err) { toast.error('Could not open the driver', errorMessage(err)); setDetail(null); }
  };

  const set = (k: keyof typeof EMPTY_DRIVER) => (e: any) => setForm((p) => p && ({ ...p, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 p-3">
        <SearchBox value={f.search} onChange={(v) => setF({ ...f, search: v })} placeholder="Name, mobile, licence…" className="flex-1" />
        <select className="input h-9 w-auto text-[13px]" value={f.availability} onChange={(e) => setF({ ...f, availability: e.target.value })} aria-label="Availability">
          <option value="">Any availability</option><option value="AVAILABLE">Available</option><option value="ON_LEAVE">On leave</option><option value="UNAVAILABLE">Unavailable</option>
        </select>
        <select className="input h-9 w-auto text-[13px]" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="">All</option>
        </select>
        <ExportButton url="/fleet/export/drivers" params={f} />
        {can('fleet.create', 'settings.create') && <button className="btn-primary btn-sm" onClick={() => openForm()}><IconPlus className="h-3.5 w-3.5" /> Add driver</button>}
      </div>
      <DataTable
        rows={rows} rowKey={(r) => r.id} loading={loading} onRowClick={openDetail} pageSize={50}
        rowClassName={(r) => (r.is_active ? '' : 'opacity-60')}
        empty={<EmptyState title="No drivers on the roster" body="Add drivers here and they become selectable when allotting a trip." icon={<IconIdCard className="h-5 w-5" />} />}
        columns={[
          { key: 'full_name', header: 'Driver', render: (r) => (
            <div><p className="font-semibold text-ink-900">{r.full_name}</p><p className="cell-meta">{r.mobile}</p></div>
          ) },
          { key: 'licence_number', header: 'Licence', render: (r) => (
            <div><p className="font-mono text-xs">{r.licence_number || '—'}</p>{r.licence_expiry && <p className="cell-meta">till {dmy(r.licence_expiry)}</p>}</div>
          ) },
          { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || '—' },
          { key: 'default_vehicle_number', header: 'Regular vehicle', render: (r) => r.default_vehicle_number ? <span className="font-mono text-xs">{r.default_vehicle_number}</span> : '—' },
          { key: 'next_trip', header: 'Next trip', sortValue: (r) => r.next_trip?.date ?? '9999', render: (r) => r.next_trip ? (
            <div><p className="cell-code">{r.next_trip.tripId}</p><p className="cell-meta">{dmy(r.next_trip.date)} {r.next_trip.time}</p></div>
          ) : <span className="text-xs text-ink-400">Free</span> },
          { key: 'availability_status', header: 'Status', render: (r) => (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge value={r.is_active ? r.availability_status : 'INACTIVE'} />
              {r.leave_from && (r.leave_to ?? r.leave_from) >= new Date().toISOString().slice(0, 10) && (
                <span className="text-2xs text-warn-700">Leave {dmy(r.leave_from)}{r.leave_to && r.leave_to !== r.leave_from ? ` – ${dmy(r.leave_to)}` : ''}</span>
              )}
              {DOC_BADGE(r.document_state)}
            </div>
          ) },
          { key: 'association_type', header: 'Association', render: (r) => humanise(r.association_type ?? 'EMPLOYEE') },
          { key: 'trip_count', header: 'Trips', align: 'right' },
          { key: 'a', header: '', sortable: false, sticky: true, align: 'right', render: (r) => (
            <Menu items={[
              { label: 'Open', onClick: () => openDetail(r) },
              can('fleet.update', 'settings.update') && { label: 'Edit', icon: <IconEdit className="h-4 w-4" />, onClick: () => openForm(r) },
              can('fleet.delete', 'settings.delete') && { label: r.trip_count ? 'Deactivate' : 'Remove', danger: true, onClick: () => setToDelete(r) },
            ]} />
          ) },
        ]}
      />

      <Modal open={!!form} onClose={() => setForm(null)} size="xl" title={form?.id ? `Edit ${form.fullName}` : 'Add a driver'}
        subtitle="The name and number are copied onto each trip when allotted, so a later change never alters past trips or invoices."
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Cancel</button><button className="btn-primary" disabled={busy} onClick={save}>{busy && <Spinner />} {form?.id ? 'Save driver' : 'Add driver'}</button></>}>
        {form && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Full name" required error={errors.fullName}><input className={`input ${errors.fullName ? 'input-error' : ''}`} value={form.fullName} onChange={set('fullName')} autoFocus /></Field>
              <Field label="Mobile" required error={errors.mobile}><input className={`input ${errors.mobile ? 'input-error' : ''}`} inputMode="numeric" value={form.mobile} onChange={set('mobile')} /></Field>
              <Field label="Alternate mobile"><input className="input" inputMode="numeric" value={form.altMobile} onChange={set('altMobile')} /></Field>
              <Field label="Vendor" hint="If employed by a vendor">
                <select className="input" value={form.vendorId} onChange={set('vendorId')}>
                  <option value="">—</option>{vendors.filter((v) => v.status === 'ACTIVE' || String(v.id) === form.vendorId).map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </Field>
              <Field label="Regular vehicle">
                <select className="input" value={form.defaultVehicleId} onChange={set('defaultVehicleId')}>
                  <option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number} — {v.category_name ?? v.vehicle_type}</option>)}
                </select>
              </Field>
              <Field label="Availability">
                <select className="input" value={form.availabilityStatus} onChange={set('availabilityStatus')}>
                  <option value="AVAILABLE">Available</option><option value="ON_LEAVE">On leave</option><option value="UNAVAILABLE">Unavailable</option>
                </select>
              </Field>
              <Field label="Association">
                <select className="input" value={form.associationType} onChange={set('associationType')}>
                  <option value="EMPLOYEE">Employee</option><option value="ATTACHED">Attached (with own vehicle)</option><option value="HIRED">Hired</option><option value="FREELANCE">Freelance</option>
                </select>
              </Field>
              <Field label="Leave from" error={errors.leaveFrom} hint="Not offered for trips in these dates"><DateField value={form.leaveFrom} onChange={set('leaveFrom')} quick={false} /></Field>
              <Field label="Leave to" error={errors.leaveTo}><DateField value={form.leaveTo} onChange={set('leaveTo')} quick={false} /></Field>
              {form.availabilityStatus !== 'AVAILABLE' && (
                <Field label="Reason" className="sm:col-span-3"><input className="input" value={form.unavailableReason} onChange={set('unavailableReason')} placeholder="e.g. Medical leave, licence renewal" /></Field>
              )}
            </div>
            <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-3">
              <p className="eyebrow sm:col-span-3">Licence and documents</p>
              <Field label="Licence no."><input className="input font-mono uppercase" value={form.licenceNumber} onChange={set('licenceNumber')} /></Field>
              <Field label="Issued on"><DateField value={form.licenceIssued} onChange={set('licenceIssued')} quick={false} /></Field>
              <Field label="Valid till" error={errors.licenceExpiry}><DateField value={form.licenceExpiry} onChange={set('licenceExpiry')} quick={false} /></Field>
              <Field label="Badge no."><input className="input" value={form.badgeNumber} onChange={set('badgeNumber')} /></Field>
              <Field label="Badge valid till"><DateField value={form.badgeExpiry} onChange={set('badgeExpiry')} quick={false} /></Field>
              <Field label="Police verification on"><DateField value={form.policeVerifiedOn} onChange={set('policeVerifiedOn')} quick={false} /></Field>
              <Field label="ID proof" hint="Type and number"><input className="input" value={form.idProof} onChange={set('idProof')} placeholder="Aadhaar XXXX-1234" /></Field>
              <Field label="Languages"><input className="input" value={form.languages} onChange={set('languages')} placeholder="Hindi, Marathi, English" /></Field>
              <Field label="Experience (years)"><input className="input text-right" inputMode="decimal" value={form.experienceYears} onChange={set('experienceYears')} /></Field>
            </div>
            <Field label="Address"><textarea className="input" rows={2} value={form.address} onChange={set('address')} /></Field>
            <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></Field>
            <label className="flex items-center gap-2 text-sm text-ink-700">
              <input type="checkbox" className="check" checked={form.isActive} onChange={set('isActive')} /> Active — can be allotted to new trips
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} danger busy={busy}
        title={`${toDelete?.trip_count ? 'Deactivate' : 'Remove'} ${toDelete?.full_name}?`} confirmLabel={toDelete?.trip_count ? 'Deactivate' : 'Remove'}
        body={<p>{toDelete?.trip_count ? 'This driver has trips on record, so they are kept and switched off.' : 'This driver has no trips and will be removed.'}</p>} />

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.data?.full_name ?? 'Driver'} subtitle={detail?.data?.mobile}
        headerExtra={detail?.data && can('fleet.update', 'settings.update') ? <button className="btn-outline btn-sm" onClick={() => { const d = detail.data; setDetail(null); openForm(d); }}><IconEdit className="h-3.5 w-3.5" /> Edit</button> : undefined}>
        {detail?.loading ? <Loading variant="inline" /> : detail?.data && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Detail label="Status"><StatusBadge value={detail.data.is_active ? detail.data.availability_status : 'INACTIVE'} /></Detail>
              <Detail label="Vendor">{detail.data.vendor_name}</Detail>
              <Detail label="Regular vehicle">{detail.data.default_vehicle_number}</Detail>
              <Detail label="Experience">{detail.data.experience_years ? `${detail.data.experience_years} yrs` : null}</Detail>
              <Detail label="Languages">{detail.data.languages}</Detail>
              <Detail label="Customer rating">{detail.feedback?.responses ? `${detail.feedback.avg_rating} ★ (${detail.feedback.responses})` : 'No ratings yet'}</Detail>
            </dl>
            <DocList docs={detail.data.documents} />
            <TripList trips={detail.trips} kind="driver" />
            <AssignmentList rows={detail.assignments} />
          </div>
        )}
      </Drawer>
    </section>
  );
}

/* ==========================================================================
   Availability board
   ========================================================================== */

function Availability() {
  const toast = useToast();
  const [date, setDate] = useState(todayLocalIso());
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get('/fleet/availability', { params: { date } }).then((r) => setD(r.data))
      .catch((err) => toast.error('Could not load availability', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const Board = ({ title, items, name }: { title: string; items: any[]; name: (x: any) => string }) => (
    <section className="card">
      <div className="card-head">
        <h3 className="card-title">{title}</h3>
        <span className="text-xs text-ink-500">{items.filter((x) => x.state === 'FREE').length} free of {items.length}</span>
      </div>
      <ul className="divide-y divide-ink-100">
        {items.length === 0 && <li className="px-5 py-6 text-sm text-ink-500">Nothing on the list.</li>}
        {items.map((x) => (
          <li key={x.id} className="flex flex-wrap items-start gap-3 px-5 py-2.5">
            <div className="min-w-[9rem]">
              <p className="text-sm font-semibold text-ink-900">{name(x)}</p>
              <p className="cell-meta">{x.category_name ?? x.mobile ?? ''}</p>
            </div>
            <StatusBadge value={x.state} />
            <div className="min-w-0 flex-1 space-y-1">
              {x.trips.map((t: any) => (
                <Link key={t.id} to={`/admin/trips?open=${t.id}`} className="block rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100">
                  <span className="font-mono font-semibold">{t.trip_id}</span> · {t.window.allDay ? 'all day' : `${t.window.start.slice(11)}–${t.window.end.slice(11)}`} · {t.customer ?? ''} · {[t.pickup_location, t.drop_location].filter(Boolean).join(' → ')}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-semibold text-ink-700">Day</span>
        <DateField value={date} onChange={(v) => v && setDate(v)} className="h-9 w-auto text-[13px]" clearable={false} />
        {loading && <Spinner className="h-4 w-4 text-brand-600" />}
        {d?.unallotted?.length > 0 && (
          <Link to="/admin/trips?stage=AWAITING_ASSIGNMENT&sort=travel_asc" className="ml-auto text-sm font-semibold text-warn-700 hover:underline">
            {d.unallotted.length} trip(s) that day still need a vehicle →
          </Link>
        )}
      </div>
      {d && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Board title="Vehicles" items={d.vehicles} name={(x) => x.vehicle_number} />
          <Board title="Drivers" items={d.drivers} name={(x) => x.full_name} />
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   Assignment history and documents
   ========================================================================== */

function Assignments() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ search: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get('/fleet/assignments', { params: f }).then((r) => setRows(r.data.data ?? []))
      .catch((err) => toast.error('Could not load the history', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f]);
  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 p-3">
        <SearchBox value={f.search} onChange={(v) => setF({ ...f, search: v })} placeholder="Trip ID, vehicle, driver…" className="flex-1" />
        <DateField className="h-9 w-auto text-[13px]" value={f.from} placeholder="From" onChange={(v) => setF({ ...f, from: v })} />
        <DateField className="h-9 w-auto text-[13px]" value={f.to} placeholder="To" onChange={(v) => setF({ ...f, to: v })} />
        <ExportButton url="/fleet/export/assignments" params={{ from: f.from, to: f.to }} />
      </div>
      <DataTable
        rows={rows} rowKey={(r) => r.id} loading={loading} pageSize={50}
        empty={<EmptyState title="No allotments recorded yet" body="Every time a vehicle and driver are allotted to a trip, it is recorded here — including re-allotments and clash overrides." />}
        columns={[
          { key: 'trip_id', header: 'Trip', render: (r) => <Link to={`/admin/trips?open=${r.booking_id}`} className="cell-code hover:underline">{r.trip_id}</Link> },
          { key: 'travel_date', header: 'Travel', render: (r) => dmy(r.travel_date) },
          { key: 'customer', header: 'Customer' },
          { key: 'vehicle_number', header: 'Vehicle', render: (r) => <span className="font-mono text-xs">{r.vehicle_number ?? '—'}</span> },
          { key: 'driver_name', header: 'Driver' },
          { key: 'window_start', header: 'Busy', render: (r) => <span className="text-xs text-ink-500">{r.window_start} → {r.window_end?.slice(11)}</span> },
          { key: 'assigned_at', header: 'Allotted', render: (r) => <span className="text-xs">{dmyTime(r.assigned_at)}<br /><span className="text-ink-400">{r.assigned_by_name}</span></span> },
          { key: 'released_at', header: 'State', render: (r) => r.released_at
            ? <span className="text-xs text-ink-500">Released — {r.release_reason}</span>
            : <StatusBadge value={r.booking_status} /> },
          { key: 'override_reason', header: 'Override', render: (r) => r.override_reason ? <span className="text-xs text-warn-700">{r.override_reason}</span> : '' },
        ]}
      />
    </section>
  );
}

function Documents() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api.get('/fleet/documents', { params: { days } }).then((r) => setRows(r.data.data ?? []))
      .catch((err) => toast.error('Could not load documents', errorMessage(err))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);
  const expired = useMemo(() => rows.filter((r) => r.state === 'EXPIRED').length, [rows]);
  return (
    <section className="table-wrap">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 p-3">
        <p className="text-sm text-ink-700"><strong>{expired}</strong> expired · <strong>{rows.length - expired}</strong> due for renewal</p>
        <label className="ml-auto flex items-center gap-2 text-sm text-ink-600">Within
          <select className="input h-9 w-auto text-[13px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>
      <DataTable
        rows={rows} rowKey={(r) => `${r.kind}-${r.id}-${r.document}`} loading={loading}
        empty={<EmptyState title="Nothing due" body="No vehicle or driver document has expired or is due in this window. Dates come from each vehicle's and driver's record." />}
        columns={[
          { key: 'name', header: 'Vehicle / driver', render: (r) => <div><p className="font-semibold text-ink-900">{r.name}</p><p className="cell-meta">{r.kind === 'vehicle' ? 'Vehicle' : 'Driver'} · {r.sub}</p></div> },
          { key: 'document', header: 'Document' },
          { key: 'date', header: 'Valid till', render: (r) => dmy(r.date) },
          { key: 'days', header: 'Days', align: 'right', render: (r) => r.days < 0 ? <span className="font-semibold text-danger-600">{Math.abs(r.days)} overdue</span> : `${r.days} left` },
          { key: 'state', header: 'Status', render: (r) => <StatusBadge value={r.state} /> },
        ]}
      />
    </section>
  );
}
