import { useEffect, useMemo, useRef, useState } from 'react';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr } from '../lib/format';
import { Field, Loading, Modal, Spinner, ConfirmDialog } from '../components/ui';
import { ExportButton } from '../components/data';
import FareCalculator from './FareCalculator';
import {
  IconPlus, IconEdit, IconTrash, IconDuplicate, IconWarning,
  IconDownload, IconPaste, IconCheck, IconGauge,
} from '../components/icons';
import { useToast } from '../components/Toast';

/* ==========================================================================
   Master — vendor-wise rate cards.

   One row per vehicle class per plan per vendor, because no two accounts pay
   the same for the same car. The rows under the reserved Direct Customer record
   are the retail price list and the only ones the public website reads, which
   the page says out loud rather than leaving to be discovered.
   ========================================================================== */

const PLAN_TYPES = [
  ['LOCAL', 'Local package', 'A block of hours and kilometres, with a rate for anything beyond it.'],
  ['AIRPORT', 'Airport transfer', 'One flat fare, point to point. No hours or kilometres.'],
  ['OUTSTATION', 'Outstation', 'Charged per kilometre, with a floor per day and a driver allowance.'],
] as const;

/** Starting points, so nobody types "8H/80KM" four different ways. */
const PLAN_PRESETS: Record<string, string[]> = {
  LOCAL: ['4H/40KM', '8H/80KM', '12H/120KM'],
  AIRPORT: ['Airport transfer', 'Airport — T1', 'Airport — T2'],
  OUTSTATION: ['Per km', 'Per km (hills)'],
};

const VEHICLE_PRESETS = [
  'Dzire', 'Hyundai Aura', 'Honda City', 'Ciaz',
  'Ertiga', 'XL6', 'Toyota Rumion',
  'Toyota Innova Crysta', 'Kia Carens',
  'Force Traveller 12', 'Force Urbania 17', 'Bus',
];

const EMPTY = {
  id: 0,
  vendorId: '',
  categoryId: '',
  vehicleCategory: '',
  planType: 'LOCAL' as (typeof PLAN_TYPES)[number][0],
  planLabel: '8H/80KM',
  includedHours: '8',
  includedKm: '80',
  baseFare: '',
  extraHourRate: '',
  extraKmRate: '',
  perKmRate: '',
  minKmPerDay: '',
  driverAllowance: '',
  minDailyCharge: '',
  nightCharge: '',
  waitingRate: '',
  freeWaitingMinutes: '',
  tollIncluded: false,
  parkingIncluded: false,
  stateTax: '',
  otherCharge: '',
  otherChargeLabel: '',
  discountPercent: '',
  taxMode: '',
  taxRate: '',
  effectiveFrom: '',
  effectiveTo: '',
  notes: '',
  isActive: true,
  displayOrder: '0',
};
type FormState = typeof EMPTY;

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export default function Master({ embedded = false }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const [vendors, setVendors] = useState<any[]>([]);
  const [publicVendorId, setPublicVendorId] = useState<number | null>(null);
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copyOpen, setCopyOpen] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [toDelete, setToDelete] = useState<any>(null);
  const [testing, setTesting] = useState<any>(null);
  const [copyFrom, setCopyFrom] = useState('');

  // --- Excel import -------------------------------------------------------
  const [importOpen, setImportOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isPublic = !!publicVendorId && String(publicVendorId) === String(vendorId);
  const vendor = useMemo(
    () => vendors.find((v) => String(v.id) === String(vendorId)),
    [vendors, vendorId]
  );

  const load = async (id: string) => {
    const { data } = await api.get('/rates', { params: id ? { vendorId: id } : {} });
    setRows(data.data ?? []);
  };

  useEffect(() => {
    (async () => {
      try {
        const [v, pub, cats] = await Promise.all([
          api.get('/vendors/options'),
          api.get('/rates/public-vendor'),
          api.get('/masters/categories', { params: { all: 1 } }).catch(() => ({ data: { data: [] } })),
        ]);
        setCategories(cats.data.data ?? []);
        const list = v.data.data ?? [];
        setVendors(list);
        const publicId = pub.data.data?.id ?? null;
        setPublicVendorId(publicId);
        // Open on the retail card: it is the one that shows on the website, so
        // it is the one most likely to be wrong and unnoticed.
        const start = publicId ? String(publicId) : String(list[0]?.id ?? '');
        setVendorId(start);
        await load(start);
      } catch (err) {
        toast.error('Could not load the rate master', errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickVendor = async (id: string) => {
    setVendorId(id);
    setBusy(true);
    try { await load(id); } catch (err) { toast.error('Could not load rates', errorMessage(err)); }
    finally { setBusy(false); }
  };

  const set = (k: keyof FormState) => (e: any) =>
    setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));

  const openNew = () => {
    setForm({ ...EMPTY, vendorId: String(vendorId) });
    setErrors({});
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setForm({
      id: r.id,
      vendorId: String(r.vendor_id),
      categoryId: r.category_id ? String(r.category_id) : '',
      vehicleCategory: r.vehicle_category,
      planType: r.plan_type,
      planLabel: r.plan_label,
      includedHours: r.included_hours ? String(r.included_hours) : '',
      includedKm: r.included_km ? String(r.included_km) : '',
      baseFare: r.base_fare ? String(r.base_fare) : '',
      extraHourRate: r.extra_hour_rate ? String(r.extra_hour_rate) : '',
      extraKmRate: r.extra_km_rate ? String(r.extra_km_rate) : '',
      perKmRate: r.per_km_rate ? String(r.per_km_rate) : '',
      minKmPerDay: r.min_km_per_day ? String(r.min_km_per_day) : '',
      driverAllowance: r.driver_allowance ? String(r.driver_allowance) : '',
      minDailyCharge: r.min_daily_charge ? String(r.min_daily_charge) : '',
      nightCharge: r.night_charge ? String(r.night_charge) : '',
      waitingRate: r.waiting_rate ? String(r.waiting_rate) : '',
      freeWaitingMinutes: r.free_waiting_minutes ? String(r.free_waiting_minutes) : '',
      tollIncluded: !!r.toll_included,
      parkingIncluded: !!r.parking_included,
      stateTax: r.state_tax ? String(r.state_tax) : '',
      otherCharge: r.other_charge ? String(r.other_charge) : '',
      otherChargeLabel: r.other_charge_label ?? '',
      discountPercent: r.discount_percent ? String(r.discount_percent) : '',
      taxMode: r.tax_mode ?? '',
      taxRate: r.tax_rate != null ? String(r.tax_rate) : '',
      effectiveFrom: r.effective_from ?? '',
      effectiveTo: r.effective_to ?? '',
      notes: r.notes ?? '',
      isActive: !!r.is_active,
      displayOrder: String(r.display_order ?? 0),
    });
    setErrors({});
    setOpen(true);
  };

  /** Switching plan type changes which numbers matter — move the defaults with it. */
  const changePlanType = (t: string) => {
    setForm((f) => ({
      ...f,
      planType: t as FormState['planType'],
      planLabel: PLAN_PRESETS[t]?.[t === 'LOCAL' ? 1 : 0] ?? f.planLabel,
      includedHours: t === 'LOCAL' ? (f.includedHours || '8') : '',
      includedKm: t === 'LOCAL' ? (f.includedKm || '80') : '',
    }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.categoryId && form.vehicleCategory.trim().length < 2) e.vehicleCategory = 'Choose the vehicle category.';
    if (form.effectiveFrom && form.effectiveTo && form.effectiveTo < form.effectiveFrom) e.effectiveTo = 'The end date is before the start date.';
    if (num(form.discountPercent) > 100) e.discountPercent = 'A discount cannot exceed 100%.';
    if (form.planLabel.trim().length < 2) e.planLabel = 'Name the plan, e.g. 8H/80KM.';
    if (form.planType === 'OUTSTATION' && num(form.perKmRate) <= 0) e.perKmRate = 'An outstation rate needs a per-km rate.';
    if (form.planType !== 'OUTSTATION' && num(form.baseFare) <= 0) e.baseFare = 'Enter the base fare.';
    setErrors(e);
    if (Object.keys(e).length) { toast.error('Some fields need attention', Object.values(e).join('\n')); return false; }
    return true;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy(true);
    const payload = {
      vendorId: Number(form.vendorId || vendorId),
      vehicleCategory: form.vehicleCategory.trim(),
      planType: form.planType,
      planLabel: form.planLabel.trim(),
      includedHours: num(form.includedHours),
      includedKm: num(form.includedKm),
      baseFare: num(form.baseFare),
      extraHourRate: num(form.extraHourRate),
      extraKmRate: num(form.extraKmRate),
      perKmRate: num(form.perKmRate),
      minKmPerDay: num(form.minKmPerDay),
      driverAllowance: num(form.driverAllowance),
      categoryId: form.categoryId ? Number(form.categoryId) : null,
      minDailyCharge: num(form.minDailyCharge),
      nightCharge: num(form.nightCharge),
      waitingRate: num(form.waitingRate),
      freeWaitingMinutes: num(form.freeWaitingMinutes),
      tollIncluded: form.tollIncluded,
      parkingIncluded: form.parkingIncluded,
      stateTax: num(form.stateTax),
      otherCharge: num(form.otherCharge),
      otherChargeLabel: form.otherChargeLabel.trim(),
      discountPercent: num(form.discountPercent),
      taxMode: form.taxMode,
      taxRate: form.taxRate === '' ? '' : num(form.taxRate),
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo,
      notes: form.notes.trim(),
      isActive: form.isActive,
      displayOrder: num(form.displayOrder),
    };
    try {
      if (form.id) await api.put(`/rates/${form.id}`, payload);
      else await api.post('/rates', payload);
      toast.success(form.id ? 'Rate updated' : 'Rate added',
        `${payload.vehicleCategory} · ${payload.planLabel}`);
      setOpen(false);
      await load(vendorId);
    } catch (err) {
      toast.error('Could not save the rate', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: any) => {
    setBusy(true);
    try {
      const { data } = await api.delete(`/rates/${r.id}`);
      toast.success(data?.deactivated ? 'Rule switched off' : 'Rule deleted', data?.message ?? `${r.vehicle_category} · ${r.plan_label}`);
      setToDelete(null);
      await load(vendorId);
    } catch (err) {
      toast.error('Could not delete the rate', errorMessage(err));
    } finally { setBusy(false); }
  };

  const runCopy = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/rates/copy', { fromVendorId: Number(copyFrom), toVendorId: Number(vendorId) });
      toast.success(`${data.copied} rate(s) copied`,
        data.skipped ? `${data.skipped} were already set here and were left alone.` : 'Adjust the numbers as needed.');
      setCopyOpen(false);
      await load(vendorId);
    } catch (err) {
      toast.error('Could not copy the rates', errorMessage(err));
    } finally { setBusy(false); }
  };

  /**
   * Send the sheet up and show what it would do.
   *
   * The same file is posted again to commit. Re-uploading a few kilobytes is
   * cheaper than parking a parsed sheet in server memory between two requests,
   * and it means the preview is always of the file that gets imported.
   */
  const post = async (dryRun: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('dryRun', String(dryRun));
    fd.append('vendorId', String(vendorId));
    const { data } = await api.post('/rates/import', fd);
    return data;
  };

  const runPreview = async (f: File) => {
    setFile(f);
    setPreview(null);
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('dryRun', 'true');
      fd.append('vendorId', String(vendorId));
      const { data } = await api.post('/rates/import', fd);
      setPreview(data);
    } catch (err) {
      toast.error('Could not read that sheet', errorMessage(err));
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  const commitImport = async () => {
    setImporting(true);
    try {
      const data = await post(false);
      toast.success(
        `${data.toCreate} added, ${data.toUpdate} updated`,
        data.errors?.length ? `${data.errors.length} row(s) were skipped — see the list.` : 'The Master is up to date.'
      );
      setImportOpen(false);
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      await load(vendorId);
    } catch (err) {
      toast.error('Import failed', errorMessage(err));
    } finally {
      setImporting(false);
    }
  };

  const getTemplate = async () => {
    try {
      await downloadFile('/rates/template', 'gtt-rate-card-template.xlsx');
    } catch (err) {
      toast.error('Could not download the template', errorMessage(err));
    }
  };

  if (loading) return <Loading label="Loading the rate master…" />;

  const byType = (t: string) => rows.filter((r) => r.plan_type === t);

  return (
    <div className={embedded ? 'flex flex-col gap-5' : 'page mx-auto max-w-7xl'}>
      <div className="page-head animate-fade-down">
        <div>
          {embedded ? (
            <h2 className="text-lg font-semibold text-ink-900">Fare rules</h2>
          ) : (
            <h1 className="page-title">Fare rules</h1>
          )}
          <p className="page-sub">
            What each vendor pays, per vehicle category and plan, and the charges that go with it. The trip
            fare calculator, quotations and invoices all price from these rules; the walk-in card also feeds the
            website's fare calculator. A trip keeps a copy of the rule it was priced with, so changing a rule
            never re-prices a confirmed trip.
          </p>
        </div>
        <div className="page-actions">
          <ExportButton url="/masters/export/fare-rules" params={{ vendorId }} label="Export" />
          <button onClick={getTemplate} className="btn-outline btn-sm">
            <IconDownload className="h-4 w-4" /> Excel template
          </button>
          <button
            onClick={() => { setFile(null); setPreview(null); setImportOpen(true); }}
            className="btn-dark btn-sm"
          >
            <IconPaste className="h-4 w-4" /> Import from Excel
          </button>
          <button onClick={() => { setCopyFrom(''); setCopyOpen(true); }} className="btn-outline btn-sm">
            <IconDuplicate className="h-4 w-4" /> Copy from another vendor
          </button>
          <button onClick={openNew} className="btn-primary"><IconPlus className="h-4 w-4" /> Add rate</button>
        </div>
      </div>

      <section className="section p-5">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Vendor" className="min-w-[16rem]">
            <select className="input" value={vendorId} onChange={(e) => pickVendor(e.target.value)}>
              {publicVendorId && (
                <option value={String(publicVendorId)}>Walk-in customers — website rates</option>
              )}
              {vendors.filter((v) => v.id !== publicVendorId).map((v) => (
                <option key={v.id} value={v.id}>{v.vendor_name} ({v.code})</option>
              ))}
            </select>
          </Field>
          {busy && <Spinner className="mb-3 h-4 w-4" />}
        </div>

        {isPublic ? (
          <p className="mt-4 rounded-lg border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
            <strong>These rates are public.</strong> They are what the fare calculator on the home page quotes,
            so treat them as your retail price list. Everything shown is exclusive of GST, and toll and parking
            stay outside the estimate.
          </p>
        ) : (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-600">
            <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-warn-500" />
            <span>
              Contract rates for <strong>{vendor?.vendor_name ?? 'this vendor'}</strong>. These never leave the
              portal — the website only ever reads the walk-in card.
            </span>
          </p>
        )}
      </section>

      {rows.length === 0 ? (
        <section className="section p-10 text-center">
          <p className="text-sm text-ink-600">No rates set for this vendor yet.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button onClick={openNew} className="btn-primary"><IconPlus className="h-4 w-4" /> Add the first rate</button>
            <button onClick={() => { setFile(null); setPreview(null); setImportOpen(true); }} className="btn-outline">
              <IconPaste className="h-4 w-4" /> Import a spreadsheet
            </button>
          </div>
          <p className="mt-4 text-xs text-ink-500">
            Already have the card in Excel? Download the template, paste your rows in, and upload it.
          </p>
        </section>
      ) : (
        PLAN_TYPES.map(([type, label, blurb]) => {
          const list = byType(type);
          if (!list.length) return null;
          return (
            <section key={type} className="section overflow-hidden">
              <div className="border-b border-ink-100 px-5 py-4">
                <h2 className="font-semibold text-ink-900">{label}</h2>
                <p className="mt-0.5 text-xs text-ink-500">{blurb}</p>
              </div>
              <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Plan</th>
                      {type === 'LOCAL' && <><th className="td-num">Includes</th><th className="td-num">Base fare</th><th className="td-num">Extra hr</th><th className="td-num">Extra km</th></>}
                      {type === 'AIRPORT' && <th className="td-num">Flat fare</th>}
                      {type === 'OUTSTATION' && <><th className="td-num">Per km</th><th className="td-num">Min km/day</th><th className="td-num">Driver allowance</th></>}
                      <th>Extras</th>
                      <th>Effective</th>
                      <th className="sticky-end"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id} className={r.is_active ? '' : 'opacity-50'}>
                        <td className="td-strong">
                          {r.vehicle_category}
                          {!r.is_active && <span className="badge ml-2 bg-ink-100 text-ink-600">Inactive</span>}
                        </td>
                        <td>{r.plan_label}</td>
                        {type === 'LOCAL' && (
                          <>
                            <td className="td-num text-ink-500">
                              {r.included_hours || 0}h / {r.included_km || 0}km
                            </td>
                            <td className="td-num td-strong">{inr(r.base_fare)}</td>
                            <td className="td-num">{inr(r.extra_hour_rate)}</td>
                            <td className="td-num">{inr(r.extra_km_rate)}</td>
                          </>
                        )}
                        {type === 'AIRPORT' && (
                          <td className="td-num td-strong">{inr(r.base_fare)}</td>
                        )}
                        {type === 'OUTSTATION' && (
                          <>
                            <td className="td-num td-strong">{inr(r.per_km_rate)}</td>
                            <td className="td-num text-ink-500">{r.min_km_per_day || 0} km</td>
                            <td className="td-num">{inr(r.driver_allowance)}</td>
                          </>
                        )}
                        <td className="max-w-[16rem] text-xs text-ink-500">
                          {[
                            r.min_daily_charge > 0 && `Min/day ${inr(r.min_daily_charge)}`,
                            r.night_charge > 0 && `Night ${inr(r.night_charge)}`,
                            r.waiting_rate > 0 && `Waiting ${inr(r.waiting_rate)}/h`,
                            r.state_tax > 0 && `State tax ${inr(r.state_tax)}`,
                            r.other_charge > 0 && `${r.other_charge_label || 'Other'} ${inr(r.other_charge)}`,
                            r.discount_percent > 0 && `${r.discount_percent}% off`,
                            r.toll_included && 'Toll incl.',
                            r.parking_included && 'Parking incl.',
                            r.tax_mode && `${r.tax_mode === 'NONE' ? 'No GST' : `${r.tax_mode === 'CGST_SGST' ? 'CGST+SGST' : 'IGST'} ${r.tax_rate ?? ''}%`}`,
                          ].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="whitespace-nowrap text-xs text-ink-500">
                          {r.effective_from || r.effective_to
                            ? `${r.effective_from || 'any time'} → ${r.effective_to || 'open'}`
                            : 'Always'}
                        </td>
                        <td className="sticky-end">
                          <div className="row-actions">
                          <button onClick={() => setTesting(r)} className="btn-ghost btn-sm" aria-label={`Test ${r.vehicle_category}`} title="Try this rule">
                            <IconGauge className="h-4 w-4" />
                          </button>
                          <button onClick={() => openEdit(r)} className="btn-ghost btn-sm" aria-label={`Edit ${r.vehicle_category}`}>
                            <IconEdit className="h-4 w-4" />
                          </button>
                          <button onClick={() => setToDelete(r)} className="btn-ghost btn-sm text-danger-600" aria-label={`Delete ${r.vehicle_category}`}>
                            <IconTrash className="h-4 w-4" />
                          </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      {/* ---------------- add / edit ---------------- */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.id ? 'Edit rate' : 'Add rate'}
        subtitle={isPublic ? 'This rate is quoted on the website.' : `Contract rate for ${vendor?.vendor_name ?? ''}.`}
        size="lg"
        footer={
          <>
            <button className="btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} {form.id ? 'Save changes' : 'Add rate'}
            </button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {categories.length ? (
            <Field label="Vehicle category" required error={errors.vehicleCategory} hint="From Masters → Vehicle categories">
              <select
                className={`input ${errors.vehicleCategory ? 'input-error' : ''}`}
                value={form.categoryId}
                onChange={(e) => {
                  const c = categories.find((x) => String(x.id) === e.target.value);
                  setForm((f) => ({ ...f, categoryId: e.target.value, vehicleCategory: c?.name ?? f.vehicleCategory }));
                }}
              >
                <option value="">Choose a category…</option>
                {categories.filter((c) => c.is_active || String(c.id) === form.categoryId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.is_active ? '' : ' (inactive)'}{c.segment ? ` — ${c.segment}` : ''}</option>
                ))}
              </select>
              {!form.categoryId && form.vehicleCategory && (
                <p className="hint">Currently “{form.vehicleCategory}” — pick the matching category to link it.</p>
              )}
            </Field>
          ) : (
            <Field label="Vehicle class" required error={errors.vehicleCategory}>
              <input
                className={`input ${errors.vehicleCategory ? 'input-error' : ''}`}
                list="vehicle-presets"
                value={form.vehicleCategory}
                onChange={set('vehicleCategory')}
                placeholder="e.g. Toyota Innova Crysta"
              />
              <datalist id="vehicle-presets">
                {VEHICLE_PRESETS.map((v) => <option key={v} value={v} />)}
              </datalist>
            </Field>
          )}

          <Field label="Plan type">
            <select className="input" value={form.planType} onChange={(e) => changePlanType(e.target.value)}>
              {PLAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          <Field label="Plan name" required error={errors.planLabel} hint="Shown to the customer">
            <input
              className={`input ${errors.planLabel ? 'input-error' : ''}`}
              list="plan-presets" value={form.planLabel} onChange={set('planLabel')}
            />
            <datalist id="plan-presets">
              {(PLAN_PRESETS[form.planType] ?? []).map((v) => <option key={v} value={v} />)}
            </datalist>
          </Field>

          <Field label="Order" hint="Lower numbers appear first">
            <input className="input" inputMode="numeric" value={form.displayOrder} onChange={set('displayOrder')} />
          </Field>

          {form.planType === 'LOCAL' && (
            <>
              <Field label="Included hours"><input className="input text-right tabular-nums" inputMode="decimal" value={form.includedHours} onChange={set('includedHours')} /></Field>
              <Field label="Included kilometres"><input className="input text-right tabular-nums" inputMode="decimal" value={form.includedKm} onChange={set('includedKm')} /></Field>
              <Field label="Base fare" required error={errors.baseFare}>
                <input className={`input text-right tabular-nums ${errors.baseFare ? 'input-error' : ''}`} inputMode="decimal" placeholder="0.00" value={form.baseFare} onChange={set('baseFare')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Extra hour"><input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.extraHourRate} onChange={set('extraHourRate')} /></Field>
                <Field label="Extra km"><input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.extraKmRate} onChange={set('extraKmRate')} /></Field>
              </div>
            </>
          )}

          {form.planType === 'AIRPORT' && (
            <Field label="Flat fare" required error={errors.baseFare} className="sm:col-span-2">
              <input className={`input text-right tabular-nums ${errors.baseFare ? 'input-error' : ''}`} inputMode="decimal" placeholder="0.00" value={form.baseFare} onChange={set('baseFare')} />
            </Field>
          )}

          {form.planType === 'OUTSTATION' && (
            <>
              <Field label="Rate per kilometre" required error={errors.perKmRate}>
                <input className={`input text-right tabular-nums ${errors.perKmRate ? 'input-error' : ''}`} inputMode="decimal" placeholder="0.00" value={form.perKmRate} onChange={set('perKmRate')} />
              </Field>
              <Field label="Minimum km per day" hint="The floor a day is billed at">
                <input className="input text-right tabular-nums" inputMode="decimal" placeholder="300" value={form.minKmPerDay} onChange={set('minKmPerDay')} />
              </Field>
              <Field label="Driver allowance" hint="Per day out">
                <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.driverAllowance} onChange={set('driverAllowance')} />
              </Field>
              <Field label="Minimum daily charge" hint="Charged when km × rate comes to less">
                <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.minDailyCharge} onChange={set('minDailyCharge')} />
              </Field>
            </>
          )}

          <div className="sm:col-span-2 mt-1 border-t border-ink-100 pt-4">
            <p className="eyebrow">Additional charges</p>
          </div>
          <Field label="Night charge" hint="Per night, when the trip runs overnight">
            <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.nightCharge} onChange={set('nightCharge')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Waiting / hour"><input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.waitingRate} onChange={set('waitingRate')} /></Field>
            <Field label="Free waiting (min)"><input className="input text-right tabular-nums" inputMode="numeric" placeholder="0" value={form.freeWaitingMinutes} onChange={set('freeWaitingMinutes')} /></Field>
          </div>
          <Field label="State tax" hint="Default per trip; can be overridden at actuals">
            <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.stateTax} onChange={set('stateTax')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Other charge"><input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00" value={form.otherCharge} onChange={set('otherCharge')} /></Field>
            <Field label="Called"><input className="input" placeholder="e.g. Cleaning" value={form.otherChargeLabel} onChange={set('otherChargeLabel')} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" className="check" checked={form.tollIncluded} onChange={set('tollIncluded')} /> Toll included in the fare</label>
            <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" className="check" checked={form.parkingIncluded} onChange={set('parkingIncluded')} /> Parking included in the fare</label>
          </div>

          <div className="sm:col-span-2 mt-1 border-t border-ink-100 pt-4">
            <p className="eyebrow">Discount, tax and validity</p>
          </div>
          <Field label="Discount %" error={errors.discountPercent} hint="On the fare and extras, never on toll or parking">
            <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0" value={form.discountPercent} onChange={set('discountPercent')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GST" hint="Blank = vendor default">
              <select className="input" value={form.taxMode} onChange={set('taxMode')}>
                <option value="">Vendor default</option>
                <option value="IGST">IGST</option>
                <option value="CGST_SGST">CGST + SGST</option>
                <option value="NONE">No GST</option>
              </select>
            </Field>
            <Field label="Rate %">
              <input className="input text-right tabular-nums" inputMode="decimal" placeholder="—" value={form.taxRate}
                disabled={!form.taxMode || form.taxMode === 'NONE'} onChange={set('taxRate')} />
            </Field>
          </div>
          <Field label="Effective from" hint="Blank = already in force">
            <input type="date" className="input" value={form.effectiveFrom} onChange={set('effectiveFrom')} />
          </Field>
          <Field label="Effective to" error={errors.effectiveTo} hint="Blank = no end date">
            <input type="date" className="input" value={form.effectiveTo} min={form.effectiveFrom || undefined} onChange={set('effectiveTo')} />
          </Field>

          <Field label="Note" className="sm:col-span-2" hint="Optional — shown under the plan on the website">
            <input className="input" value={form.notes} onChange={set('notes')} placeholder="e.g. Within Mumbai city limits" />
          </Field>

          <label className="flex items-center gap-2.5 text-sm text-ink-700 sm:col-span-2">
            <input type="checkbox" className="h-4 w-4" checked={form.isActive} onChange={set('isActive')} />
            Active {isPublic && <span className="text-xs text-ink-500">— unticking hides it from the website</span>}
          </label>
        </div>
      </Modal>

      {/* ---------------- import from Excel ---------------- */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import rates from Excel"
        subtitle="Nothing is saved until you have seen what the sheet would do."
        size="xl"
        footer={
          <>
            <button className="btn-outline" onClick={() => setImportOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={commitImport}
              disabled={importing || !preview || (preview.toCreate + preview.toUpdate) === 0}
            >
              {importing && <Spinner className="h-4 w-4" />}
              {preview ? `Import ${preview.toCreate + preview.toUpdate} row(s)` : 'Import'}
            </button>
          </>
        }
      >
        <div className="rounded-xl border border-dashed border-ink-300 bg-ink-50/60 p-5 text-center">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            className="input mx-auto max-w-sm py-2"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) runPreview(f); }}
          />
          <p className="mt-3 text-xs text-ink-500">
            The importer finds the heading row itself and reads the columns by name, so a sheet that already
            looks like a rate card usually works as-is.{' '}
            <button type="button" onClick={getTemplate} className="font-semibold text-brand-700 hover:underline">
              Download the template
            </button>{' '}
            if you would rather start from ours.
          </p>
          <p className="mt-2 text-xs text-ink-500">
            Rows with no vendor code go to <strong>{vendor?.vendor_name ?? 'the selected vendor'}</strong>.
          </p>
        </div>

        {importing && !preview && <div className="mt-5"><Loading label="Reading the sheet…" variant="inline" /></div>}

        {preview && (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-ok-50 p-3.5">
                <p className="text-2xs font-bold uppercase tracking-wide text-ok-700">To add</p>
                <p className="mt-0.5 text-xl font-bold text-ok-700">{preview.toCreate}</p>
              </div>
              <div className="rounded-lg bg-brand-50 p-3.5">
                <p className="text-2xs font-bold uppercase tracking-wide text-brand-700">To update</p>
                <p className="mt-0.5 text-xl font-bold text-brand-700">{preview.toUpdate}</p>
              </div>
              <div className={`rounded-lg p-3.5 ${preview.errors?.length ? 'bg-warn-50' : 'bg-ink-50'}`}>
                <p className={`text-2xs font-bold uppercase tracking-wide ${preview.errors?.length ? 'text-warn-700' : 'text-ink-500'}`}>
                  Skipped
                </p>
                <p className={`mt-0.5 text-xl font-bold ${preview.errors?.length ? 'text-warn-700' : 'text-ink-500'}`}>
                  {preview.errors?.length ?? 0}
                </p>
              </div>
            </div>

            {Object.keys(preview.mapped ?? {}).length > 0 && (
              <p className="text-xs text-ink-500">
                <IconCheck className="mr-1 inline h-3.5 w-3.5 text-ok-500" />
                Read sheet <strong>{preview.sheetName}</strong>, matching{' '}
                {Object.values(preview.mapped).map((h: any) => `"${h}"`).join(', ')}.
                {preview.ignored?.length > 0 && ` Ignored: ${preview.ignored.join(', ')}.`}
              </p>
            )}

            {preview.errors?.length > 0 && (
              <div className="rounded-lg border border-warn-100 bg-warn-50 p-4">
                <p className="text-xs font-semibold text-warn-700">These rows will be skipped:</p>
                <ul className="mt-2 space-y-1 text-xs text-warn-700">
                  {preview.errors.slice(0, 12).map((e: any, i: number) => (
                    <li key={i}>{e.rowNumber ? `Row ${e.rowNumber}: ` : ''}{e.message}</li>
                  ))}
                  {preview.errors.length > 12 && <li>…and {preview.errors.length - 12} more.</li>}
                </ul>
              </div>
            )}

            {preview.rows?.length > 0 && (
              <div className="table-wrap max-h-72 overflow-y-auto">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Vendor</th><th>Vehicle</th><th>Plan</th><th>Type</th>
                      <th className="td-num">Fare</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r: any, i: number) => (
                      <tr key={i}>
                        <td>{r.vendorName}</td>
                        <td className="td-strong">{r.vehicleCategory}</td>
                        <td>{r.planLabel}</td>
                        <td className="text-xs text-ink-500">{r.planType}</td>
                        <td className="td-num">
                          {r.planType === 'OUTSTATION' ? `${inr(r.perKmRate)}/km` : inr(r.baseFare)}
                        </td>
                        <td>
                          <span className={`badge ${r.action === 'create' ? 'bg-ok-50 text-ok-700' : 'bg-brand-50 text-brand-700'}`}>
                            {r.action === 'create' ? 'New' : 'Update'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={() => remove(toDelete)}
        danger busy={busy}
        title="Remove this fare rule?"
        confirmLabel="Remove"
        body={
          <>
            <p><strong>{toDelete?.vehicle_category}</strong> · {toDelete?.plan_label}</p>
            <p className="text-ink-500">
              If any trip was priced with this rule it is switched off instead, so those trips keep pointing at it.
              Their fares do not change either way.
            </p>
          </>
        }
      />

      <Modal
        open={!!testing}
        onClose={() => setTesting(null)}
        title="Try this rule"
        subtitle={testing ? `${testing.vehicle_category} · ${testing.plan_label} — the same calculation trips and invoices use.` : ''}
        size="lg"
      >
        {testing && <FareCalculator fixedRule={{ ...testing, vendor_tax_mode: vendor?.tax_mode, vendor_tax_rate: vendor?.tax_rate }} />}
      </Modal>

      {/* ---------------- copy ---------------- */}
      <Modal
        open={copyOpen}
        onClose={() => setCopyOpen(false)}
        title="Copy a rate card"
        subtitle={`Rates already set for ${vendor?.vendor_name ?? 'this vendor'} are left untouched.`}
        footer={
          <>
            <button className="btn-outline" onClick={() => setCopyOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={runCopy} disabled={busy || !copyFrom}>
              {busy && <Spinner className="h-4 w-4" />} Copy rates
            </button>
          </>
        }
      >
        <Field label="Copy from">
          <select className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Choose a vendor…</option>
            {vendors.filter((v) => String(v.id) !== String(vendorId)).map((v) => (
              <option key={v.id} value={v.id}>
                {v.id === publicVendorId ? 'Walk-in customers — website rates' : `${v.vendor_name} (${v.code})`}
              </option>
            ))}
          </select>
        </Field>
        <p className="mt-3 text-xs text-ink-500">
          Every row is copied as-is. Adjust the numbers afterwards — a copied rate is a starting point, not an
          agreement.
        </p>
      </Modal>
    </div>
  );
}
