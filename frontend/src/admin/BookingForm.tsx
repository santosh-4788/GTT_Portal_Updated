import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr, todayIso } from '../lib/format';
import { Field, Loading, Modal, Spinner, StatusBadge } from '../components/ui';
import { IconPaste } from '../components/icons';
import { useToast } from '../components/Toast';
import { DateField, TimeField } from '../components/DateTimeField';
import { GST_TYPES, gstRateOptions, gstSummary, type GstType } from './gst';
import { AirportDirectionPicker, airportEnds, inferAirportDir, type AirportDir } from './airport';

const TRIP_TYPES = [
  ['LOCAL', 'Local'], ['TRANSFER', 'Transfer'], ['AIRPORT', 'Airport'],
  ['OUTSTATION', 'Outstation'], ['ROUND_TRIP', 'Round Trip'], ['PACKAGE', 'Package'],
] as const;

/** Sentinel used in the vendor dropdown for a booking taken straight from a
 *  customer. It is not a vendor id — the backend attaches these to the reserved
 *  Direct Customer record and addresses the invoice to that customer instead. */
const WALKIN = 'WALKIN';

const EMPTY = {
  vendorId: '', vendorBookingRef: '', bookingDate: todayIso(), travelDate: todayIso(),
  travelDateTo: '', reportingTime: '', tripType: 'LOCAL', airportDirection: '' as AirportDir, dutyType: '', city: 'Mumbai',
  pickupLocation: '', pickupAddress: '', dropLocation: '', dropAddress: '', flightTrainNo: '',
  tripDistanceKm: '', tripDurationHrs: '',
  customerName: '', customerMobile: '', customerEmail: '', customerAddress: '', customerGstin: '',
  passengerName: '', passengerMobile: '', passengerEmail: '', paxCount: '1', bagCount: '0',
  vehicleId: '', vehicleType: '', vehicleNumber: '', driverName: '', driverMobile: '',
  specialInstructions: '', remarks: '', rawMessage: '', bookingStatus: 'CONFIRMED',
  /**
   * One agreed amount, whether GST goes on top of it, and toll & parking at
   * actuals. The itemised charge sheet this replaced asked for eleven figures to
   * reach the same total, when in practice the fare is agreed as a single number
   * before the trip.
   */
  // gst / gstRate: '' follows the vendor's own setting until one is picked.
  charges: { amount: '', gst: '' as GstType | '', gstRate: '', tollParking: '', advance: '' },
};
type FormState = typeof EMPTY;

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * Mirrors backend services/billing.ts so the operator sees the total live.
 *
 * The amount typed is the taxable value: GST is added on top of it, never taken
 * out of it. Toll and parking is a reimbursement, so it lands after the tax and
 * is not taxed — which is how the vendors' own invoice formats are laid out.
 */
function computeLocal(charges: FormState['charges'], taxMode: string, taxRate: number) {
  const taxable = Math.max(0, round2(num(charges.amount)));
  const nonTaxable = Math.max(0, round2(num(charges.tollParking)));

  const withGst = taxMode !== 'NONE' && taxRate > 0;
  const rate = withGst ? taxRate : 0;
  const tax = round2((taxable * rate) / 100);
  const cgst = withGst && taxMode === 'CGST_SGST' ? round2(tax / 2) : 0;
  const sgst = withGst && taxMode === 'CGST_SGST' ? round2(tax - cgst) : 0;
  const igst = withGst && taxMode === 'IGST' ? tax : 0;

  const invoiceValue = round2(taxable + tax);
  const total = round2(invoiceValue + nonTaxable);
  return {
    taxable, nonTaxable, withGst, rate, tax, cgst, sgst, igst, invoiceValue, total,
    balance: round2(total - num(charges.advance)),
  };
}

// ---------------------------------------------------------------------------
function SectionCard({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="section p-5">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-ink-100 pb-3">
        <div>
          <h2 className="font-semibold text-ink-900">{title}</h2>
          {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Suggest({
  value, onChange, onPick, fetchUrl, placeholder, className = '',
}: {
  value: string; onChange: (v: string) => void; onPick?: (item: any) => void;
  fetchUrl: string; placeholder?: string; className?: string;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(fetchUrl, { params: { search: value } });
        setItems(data.data ?? []);
      } catch { /* suggestions are optional */ }
    }, 200);
    return () => clearTimeout(t);
  }, [value, fetchUrl]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        className="input" value={value} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && items.length > 0 && (
        <div className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto p-1 shadow-lift">
          {items.map((it, i) => (
            <button
              key={i} type="button"
              onClick={() => { onPick ? onPick(it) : onChange(it.label ?? it.name); setOpen(false); }}
              className="block w-full truncate rounded px-3 py-1.5 text-left text-sm text-ink-700 hover:bg-brand-50"
            >
              {it.label ?? it.name}
              {it.mobile && <span className="ml-2 text-xs text-ink-400">{it.mobile}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function BookingForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [vendors, setVendors] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<any>(null);

  const isWalkIn = form.vendorId === WALKIN;

  /** The reserved record counter bookings hang off. Its tax settings are what a
   *  walk-in is priced with, so the operator sees the same figures either way. */
  const directVendor = useMemo(() => vendors.find((v) => v.code === 'DIRECT'), [vendors]);
  const vendor = useMemo(
    () => (isWalkIn ? directVendor : vendors.find((v) => String(v.id) === String(form.vendorId))),
    [vendors, form.vendorId, isWalkIn, directVendor]
  );

  /** Real vendors only — the Direct Customer row is offered as "Walk-in" instead
   *  of as a vendor, so it must not appear twice in the dropdown. */
  const vendorOptions = useMemo(() => vendors.filter((v) => v.code !== 'DIRECT'), [vendors]);

  const vendorRate = Number(vendor?.tax_rate) > 0 ? Number(vendor.tax_rate) : 5;
  // Walk-in fares are quoted without GST, so a walk-in bill starts at No GST.
  const taxMode: string = form.charges.gst || (isWalkIn ? 'NONE' : vendor?.tax_mode ?? 'IGST');
  const taxRate = form.charges.gstRate ? num(form.charges.gstRate) : vendorRate;
  const totals = useMemo(() => computeLocal(form.charges, taxMode, taxRate), [form.charges, taxMode, taxRate]);

  /** Itemised charges from a booking saved before this form billed one amount.
   *  Shown read-only so nothing looks like it silently disappeared. */
  const [legacy, setLegacy] = useState<Array<[string, number]>>([]);

  useEffect(() => {
    (async () => {
      try {
        const [v, veh] = await Promise.all([
          api.get('/vendors/options'),
          api.get('/bookings/lookup/vehicles'),
        ]);
        setVendors(v.data.data ?? []);
        setVehicles(veh.data.data ?? []);

        if (isEdit) {
          const { data } = await api.get(`/bookings/${id}`);
          const b = data.data, c = data.charges ?? {};
          const vrow = (v.data.data ?? []).find((x: any) => String(x.id) === String(b.vendor_id));
          const tollTaxed = !!vrow?.toll_parking_taxable;
          const tollParking = num(c.toll) + num(c.parking);
          const taxable = num(c.taxable_amount);

          setForm({
            vendorId: b.booking_source === 'DIRECT' ? WALKIN : String(b.vendor_id),
            vendorBookingRef: b.vendor_booking_ref ?? '',
            bookingDate: b.booking_date, travelDate: b.travel_date, travelDateTo: b.travel_date_to ?? '',
            reportingTime: b.reporting_time ?? '', tripType: b.trip_type,
            airportDirection: (b.airport_direction ?? inferAirportDir(b.pickup_location, b.drop_location)) as AirportDir,
            dutyType: b.duty_type ?? '',
            city: b.city ?? 'Mumbai', pickupLocation: b.pickup_location ?? '', pickupAddress: b.pickup_address ?? '',
            dropLocation: b.drop_location ?? '', dropAddress: b.drop_address ?? '',
            flightTrainNo: b.flight_train_no ?? '',
            tripDistanceKm: b.trip_distance_km ? String(b.trip_distance_km) : '',
            tripDurationHrs: b.trip_duration_hrs ? String(b.trip_duration_hrs) : '',
            customerName: b.customer_name ?? '', customerMobile: b.customer_mobile ?? '',
            customerEmail: b.customer_email ?? '', customerAddress: b.customer_address ?? '',
            customerGstin: b.customer_gstin ?? '',
            passengerName: b.passenger_name ?? '', passengerMobile: b.passenger_mobile ?? '',
            passengerEmail: b.passenger_email ?? '', paxCount: String(b.pax_count ?? 1),
            bagCount: String(b.bag_count ?? 0), vehicleId: b.vehicle_id ? String(b.vehicle_id) : '',
            vehicleType: b.vehicle_type ?? '', vehicleNumber: b.vehicle_number ?? '',
            driverName: b.driver_name ?? '', driverMobile: b.driver_mobile ?? '',
            specialInstructions: b.special_instructions ?? '', remarks: b.remarks ?? '',
            rawMessage: b.raw_message ?? '', bookingStatus: b.booking_status,
            charges: {
              // The saved taxable value is the amount, whatever it was built
              // from. Where a vendor taxes toll & parking it is inside that
              // figure already, so take it back out before showing the fare.
              amount: taxable ? String(round2(taxable - (tollTaxed ? tollParking : 0))) : '',
              gst: !c.tax_mode ? '' : c.tax_mode === 'NONE' || !(Number(c.tax_rate) > 0) ? 'NONE' : c.tax_mode,
              gstRate: Number(c.tax_rate) > 0 ? String(c.tax_rate) : '',
              tollParking: tollParking ? String(round2(tollParking)) : '',
              advance: c.advance ? String(c.advance) : '',
            },
          });

          setLegacy(
            ([
              ['Extra KM', num(c.extra_km) * num(c.extra_km_rate)],
              ['Extra hours', num(c.extra_hours) * num(c.extra_hour_rate)],
              ['Driver allowance', num(c.driver_allowance)],
              ['Permit', num(c.permit)],
              ['Night charge', num(c.night_charge)],
              [c.other_charges_note || 'Other charges', num(c.other_charges)],
              ['Discount', -num(c.discount)],
            ] as Array<[string, number]>).filter(([, v]) => v !== 0)
          );
        } else if (params.get('vendorId')) {
          setForm((f) => ({ ...f, vendorId: params.get('vendorId')! }));
        }
      } catch (err) {
        toast.error('Could not load the booking', errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: keyof FormState) => (e: any) => {
    setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
    setErrors((p) => ({ ...p, [k]: '' }));
  };
  const setCharge = (k: keyof FormState['charges']) => (e: any) =>
    setForm((f) => ({ ...f, charges: { ...f.charges, [k]: e.target.value } }));

  const pickVehicle = (vehicleId: string) => {
    const v = vehicles.find((x) => String(x.id) === vehicleId);
    setForm((f) => ({
      ...f,
      vehicleId,
      vehicleType: v?.vehicle_type ?? f.vehicleType,
      vehicleNumber: v?.vehicle_number ?? f.vehicleNumber,
      driverName: v?.driver_name ?? f.driverName,
      driverMobile: v?.driver_mobile ?? f.driverMobile,
    }));
  };

  // ---- paste-parser -------------------------------------------------------
  const runParse = async () => {
    if (!message.trim()) return;
    setParsing(true);
    try {
      const { data } = await api.post('/bookings/parse-message', { message });
      setParsed(data);
    } catch (err) {
      toast.error('Could not read that message', errorMessage(err));
    } finally {
      setParsing(false);
    }
  };

  const applyParsed = () => {
    if (!parsed) return;
    const f = parsed.fields ?? {};
    const s = parsed.suggestions ?? {};
    setForm((prev) => ({
      ...prev,
      vendorId: s.vendorId ? String(s.vendorId) : prev.vendorId,
      vendorBookingRef: f.vendorBookingRef ?? prev.vendorBookingRef,
      travelDate: f.travelDate ?? prev.travelDate,
      travelDateTo: f.travelDateTo ?? prev.travelDateTo,
      reportingTime: f.reportingTime ?? prev.reportingTime,
      tripType: f.tripType ?? prev.tripType,
      airportDirection: (f.airportDirection ?? prev.airportDirection) as AirportDir,
      dutyType: f.dutyType?.trim() ?? prev.dutyType,
      city: f.city ?? prev.city,
      pickupLocation: f.pickupAddress ?? prev.pickupLocation,
      pickupAddress: f.pickupAddress ?? prev.pickupAddress,
      dropLocation: f.dropAddress ?? prev.dropLocation,
      dropAddress: f.dropAddress ?? prev.dropAddress,
      flightTrainNo: f.flightTrainNo ?? prev.flightTrainNo,
      passengerName: f.passengerName ?? prev.passengerName,
      passengerMobile: f.passengerMobile ?? prev.passengerMobile,
      passengerEmail: s.passengerEmail ?? prev.passengerEmail,
      vehicleType: f.vehicleType ?? prev.vehicleType,
      vehicleId: s.vehicleId ? String(s.vehicleId) : prev.vehicleId,
      vehicleNumber: s.vehicleNumber ?? prev.vehicleNumber,
      driverName: s.driverName ?? prev.driverName,
      driverMobile: s.driverMobile ?? prev.driverMobile,
      remarks: f.remarks ?? prev.remarks,
      specialInstructions: f.specialInstructions ?? prev.specialInstructions,
      rawMessage: message,
    }));
    setPasteOpen(false);
    setParsed(null);
    setMessage('');
    toast.success('Fields filled from the message', 'Check the highlighted values, then enter the amount.');
  };

  const airport = form.tripType === 'AIRPORT';
  const ends = airportEnds(form.airportDirection);

  // ---- save ---------------------------------------------------------------
  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.vendorId) e.vendorId = 'Choose the vendor this booking came from, or Walk-in customer.';
    if (isWalkIn && form.customerName.trim().length < 2) {
      e.customerName = 'Enter the customer name — the invoice is addressed to them.';
    }
    if (isWalkIn && form.customerMobile && !/^[6-9]\d{9}$/.test(form.customerMobile.replace(/\D/g, '').replace(/^91/, ''))) {
      e.customerMobile = 'Enter a valid 10-digit mobile number.';
    }
    if (num(form.charges.amount) <= 0) e.amount = 'Enter the amount to bill for this trip.';
    if (!form.travelDate) e.travelDate = 'Travel date is required.';
    if (form.travelDateTo && form.travelDateTo < form.travelDate) e.travelDateTo = 'End date cannot be before the travel date.';
    if (form.tripType === 'AIRPORT' && !form.airportDirection) {
      e.airportDirection = 'Choose the direction first: to the airport, or from the airport.';
    }
    if (!form.pickupLocation.trim()) e.pickupLocation = 'Pickup location is required.';
    if (!form.passengerName.trim()) e.passengerName = 'Passenger name is required.';
    if (form.passengerMobile && !/^[6-9]\d{9}$/.test(form.passengerMobile.replace(/\D/g, '').replace(/^91/, ''))) {
      e.passengerMobile = 'Enter a valid 10-digit mobile number.';
    }
    if (form.reportingTime && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(form.reportingTime)) {
      e.reportingTime = 'Time must be in HH:MM format.';
    }
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error('Some fields need attention', Object.values(e).join('\n'));
      return false;
    }
    return true;
  };

  /**
   * The stored shape still has a line per charge type, because invoices, reports
   * and every booking already saved read it. One amount simply means the fare
   * lands on base_fare and the rest stay at zero — nothing downstream changes.
   */
  const payload = () => ({
    ...form,
    bookingSource: isWalkIn ? 'DIRECT' : 'VENDOR',
    vendorId: isWalkIn ? undefined : Number(form.vendorId),
    vendorBookingRef: isWalkIn ? '' : form.vendorBookingRef,
    vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
    paxCount: num(form.paxCount), bagCount: num(form.bagCount),
    tripDistanceKm: num(form.tripDistanceKm), tripDurationHrs: num(form.tripDurationHrs),
    travelDateTo: form.travelDateTo || undefined,
    charges: {
      baseFare: totals.taxable,
      extraKm: 0, extraKmRate: 0, extraHours: 0, extraHourRate: 0,
      toll: totals.nonTaxable, parking: 0,
      driverAllowance: 0, permit: 0, nightCharge: 0,
      otherCharges: 0, otherChargesNote: '', discount: 0,
      advance: num(form.charges.advance),
      // The GST type and rate picked here beat the vendor's default, and toll &
      // parking is always the after-tax line this form shows it as.
      taxModeOverride: totals.withGst ? taxMode : 'NONE',
      taxRateOverride: totals.withGst ? taxRate : 0,
      tollParkingTaxableOverride: false,
    },
  });

  const save = async (then: 'list' | 'new' | 'invoice') => {
    if (!validate()) return;
    setSaving(true);
    try {
      const res = isEdit
        ? await api.put(`/bookings/${id}`, payload())
        : await api.post('/bookings', payload());

      const code = res.data.data.booking_code;
      toast.success(isEdit ? `${code} updated` : `${code} saved`,
        `Total ${inr(totals.total)}. It is now visible in Bookings and Billing.`);

      if (then === 'new') {
        setForm({
          ...EMPTY,
          vendorId: form.vendorId,
          bookingDate: form.bookingDate,
          travelDate: form.travelDate,
          charges: { ...EMPTY.charges, gst: form.charges.gst, gstRate: form.charges.gstRate },
        });
        setLegacy([]);
        setErrors({});
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (then === 'invoice') {
        navigate(`/admin/billing?vendorId=${res.data.data.vendor_id ?? form.vendorId}`);
      } else {
        navigate('/admin/bookings');
      }
    } catch (err) {
      toast.error('Could not save the booking', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading booking…" />;

  return (
    <div className="page mx-auto max-w-6xl pb-24">
      {/* header */}
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">{isEdit ? 'Edit booking' : 'New booking'}</h1>
          <p className="page-sub">
            {isEdit
              ? 'Update the trip details or charges. Saving re-prices the booking automatically.'
              : 'Enter the booking once — it flows into vendor records, billing and invoicing on its own.'}
          </p>
        </div>
        <div className="page-actions">
          {!isEdit && (
            <button onClick={() => setPasteOpen(true)} className="btn-dark">
              <IconPaste className="h-4 w-4" /> Paste vendor message
            </button>
          )}
          <Link to="/admin/bookings" className="btn-outline btn-sm">Cancel</Link>
        </div>
      </div>

      {!isEdit && (
        <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-brand-900">
          <p className="font-semibold">Save typing: paste the vendor's WhatsApp message.</p>
          <p className="mt-1 text-brand-800">
            Click <span className="font-semibold">Paste vendor message</span> and drop in the booking text exactly as the
            vendor sent it. The reference, passenger, mobile, vehicle, date, time, pickup and drop are read out
            automatically — this replaces the old <span className="font-mono text-xs">DataEntryFormula.xlsx</span> sheet.
          </p>
        </div>
      )}

      {/* --- Booking Information --- */}
      <SectionCard title="Booking information" sub="Which vendor sent this, and their own reference for it.">
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Vendor" required error={errors.vendorId}
            hint={isWalkIn ? 'Billed to the customer below' : undefined}>
            <select className={`input ${errors.vendorId ? 'input-error' : ''}`} value={form.vendorId} onChange={set('vendorId')}>
              <option value="">Select vendor…</option>
              <option value={WALKIN}>Walk-in customer (no vendor)</option>
              {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.vendor_name} ({v.code})</option>)}
            </select>
          </Field>

          {!isWalkIn && (
            <Field label="Vendor's booking reference"
              hint={vendor ? 'Must be unique for this vendor' : undefined}>
              <input className="input" value={form.vendorBookingRef} onChange={set('vendorBookingRef')}
                placeholder="e.g. Booking #88245430-1" />
            </Field>
          )}

          <Field label="Booking date">
            <DateField value={form.bookingDate} onChange={set('bookingDate')} />
          </Field>

          <Field label="Booking status">
            <select className="input" value={form.bookingStatus} onChange={set('bookingStatus')}>
              {['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </Field>
        </div>

        {isWalkIn && (
          <div className="mt-5 rounded-xl border border-brand-200 bg-brand-50/50 p-4">
            <h3 className="text-sm font-semibold text-brand-900">Customer details</h3>
            <p className="mt-0.5 text-xs text-brand-800">
              There is no vendor on this booking, so the invoice is made out to whoever you enter here.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Customer name" required error={errors.customerName}>
                <input className={`input ${errors.customerName ? 'input-error' : ''}`}
                  value={form.customerName} onChange={set('customerName')} placeholder="Name the bill is addressed to" />
              </Field>
              <Field label="Mobile" error={errors.customerMobile}>
                <input className={`input ${errors.customerMobile ? 'input-error' : ''}`} inputMode="numeric"
                  value={form.customerMobile} onChange={set('customerMobile')} placeholder="10-digit number" />
              </Field>
              <Field label="Email">
                <input className="input" type="email" value={form.customerEmail} onChange={set('customerEmail')} />
              </Field>
              <Field label="GSTIN" hint="Only if they need input credit">
                <input className="input uppercase" value={form.customerGstin} onChange={set('customerGstin')}
                  placeholder="27ABCDE1234F1Z5" />
              </Field>
              <Field label="Billing address" className="sm:col-span-2 xl:col-span-4">
                <textarea className="input min-h-[64px] resize-y" value={form.customerAddress}
                  onChange={set('customerAddress')} placeholder="Printed on the invoice" />
              </Field>
            </div>
          </div>
        )}

        {vendor && !isWalkIn && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-ink-50 px-4 py-3 text-xs text-ink-600">
            <span><strong className="text-ink-800">{vendor.company_name || vendor.vendor_name}</strong></span>
            {vendor.gst_number && <span>GSTIN {vendor.gst_number}</span>}
            <span>{vendor.tax_mode === 'NONE' ? 'No tax' : `${vendor.tax_mode.replace('_', '+')} ${vendor.tax_rate}%`}</span>
            <span>Toll &amp; parking added after tax</span>
            <span>{vendor.consolidation_allowed ? 'Consolidated invoices allowed' : 'One invoice per booking'}</span>
            {!vendor.invoice_template_id && (
              <span className="badge-warn">No invoice template assigned</span>
            )}
          </div>
        )}
      </SectionCard>

      {/* --- Passenger --- */}
      <SectionCard title="Passenger information" sub="Start typing a name to reuse a previous guest.">
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Passenger name" required error={errors.passengerName}>
            <Suggest
              value={form.passengerName}
              onChange={(v) => setForm((f) => ({ ...f, passengerName: v }))}
              onPick={(p) => setForm((f) => ({
                ...f, passengerName: p.name, passengerMobile: p.mobile ?? f.passengerMobile,
                passengerEmail: p.email ?? f.passengerEmail,
              }))}
              fetchUrl="/bookings/lookup/passengers"
              placeholder="e.g. Mahesh Kale"
            />
          </Field>
          <Field label="Mobile" error={errors.passengerMobile}>
            <input className={`input ${errors.passengerMobile ? 'input-error' : ''}`} inputMode="numeric"
              value={form.passengerMobile} onChange={set('passengerMobile')} placeholder="10-digit mobile" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.passengerEmail} onChange={set('passengerEmail')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Passengers">
              <input className="input" inputMode="numeric" value={form.paxCount} onChange={set('paxCount')} />
            </Field>
            <Field label="Bags">
              <input className="input" inputMode="numeric" value={form.bagCount} onChange={set('bagCount')} />
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* --- Trip --- */}
      <SectionCard title="Trip information" sub="Pickup and drop suggestions come from locations you have used before.">
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Travel date" required error={errors.travelDate}>
            <DateField error={!!errors.travelDate}
              value={form.travelDate} onChange={set('travelDate')} />
          </Field>
          <Field label="End date" hint="Only for multi-day duties" error={errors.travelDateTo}>
            <DateField error={!!errors.travelDateTo} placeholder="Single-day duty"
              value={form.travelDateTo} onChange={set('travelDateTo')} min={form.travelDate} />
          </Field>
          <Field label="Reporting time" error={errors.reportingTime}>
            <TimeField error={!!errors.reportingTime}
              value={form.reportingTime} onChange={set('reportingTime')} />
          </Field>
          <Field label="Trip type">
            <select className="input" value={form.tripType} onChange={set('tripType')}>
              {TRIP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          {/* An airport trip says which way it goes before either address:
              the direction decides which end is the airport. */}
          {airport && (
            <Field label="Direction" required error={errors.airportDirection} className="lg:col-span-2">
              <AirportDirectionPicker
                value={form.airportDirection}
                onChange={(v) => { setForm((f) => ({ ...f, airportDirection: v })); setErrors((x) => ({ ...x, airportDirection: '' })); }}
              />
            </Field>
          )}

          {airport && !form.airportDirection ? (
            <p className="self-end pb-2 text-sm text-ink-500 lg:col-span-2">
              Choose <strong className="text-ink-700">To airport</strong> or <strong className="text-ink-700">From airport</strong> to enter the addresses.
            </p>
          ) : (
            <>
              <Field label={airport ? ends.pickup : 'Pickup location'} required error={errors.pickupLocation} className="lg:col-span-2">
                <Suggest
                  value={form.pickupLocation}
                  onChange={(v) => setForm((f) => ({ ...f, pickupLocation: v }))}
                  fetchUrl="/bookings/lookup/locations"
                  placeholder={airport ? ends.pickupHint : 'e.g. Terminal 2, Mumbai Airport'}
                />
              </Field>
              <Field label={airport ? ends.drop : 'Drop location'} required={airport} className="lg:col-span-2">
                <Suggest
                  value={form.dropLocation}
                  onChange={(v) => setForm((f) => ({ ...f, dropLocation: v }))}
                  fetchUrl="/bookings/lookup/locations"
                  placeholder={airport ? ends.dropHint : 'e.g. Lower Parel, Mumbai'}
                />
              </Field>
            </>
          )}

          <Field label="Duty type / package" hint="e.g. 4H40KMS, 8H80KMS">
            <input className="input" value={form.dutyType} onChange={set('dutyType')} />
          </Field>
          <Field label="Flight / train number">
            <input className="input" value={form.flightTrainNo} onChange={set('flightTrainNo')} />
          </Field>
          <Field label="Distance (km)">
            <input className="input text-right tabular-nums" inputMode="decimal"
              value={form.tripDistanceKm} onChange={set('tripDistanceKm')} />
          </Field>
          <Field label="Duration (hrs)">
            <input className="input text-right tabular-nums" inputMode="decimal"
              value={form.tripDurationHrs} onChange={set('tripDurationHrs')} />
          </Field>
        </div>
      </SectionCard>

      {/* --- Vehicle --- */}
      <SectionCard title="Vehicle information" sub="Picking a vehicle fills in its number and driver automatically.">
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="Vehicle from fleet">
            <select className="input" value={form.vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
              <option value="">Not assigned yet</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.vehicle_number} — {v.vehicle_type}</option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle type">
            <input className="input" value={form.vehicleType} onChange={set('vehicleType')} placeholder="e.g. Sedan/Ertiga" />
          </Field>
          <Field label="Vehicle number">
            <input className="input uppercase" value={form.vehicleNumber} onChange={set('vehicleNumber')} placeholder="MH04LQ1748" />
          </Field>
          <Field label="Driver name">
            <input className="input" value={form.driverName} onChange={set('driverName')} />
          </Field>
          <Field label="Driver mobile">
            <input className="input" inputMode="numeric" value={form.driverMobile} onChange={set('driverMobile')} />
          </Field>
        </div>
      </SectionCard>

      {/* --- Amount --- */}
      <SectionCard
        title="Amount"
        sub={
          !form.vendorId
            ? 'Choose a vendor or Walk-in customer first, so the right GST rate applies.'
            : !totals.withGst
              ? 'No GST on this bill. Pick a GST type below if the customer wants a GST bill.'
              : `${gstSummary(taxMode, taxRate)} is added on the amount. Change the type or rate below for this bill.`
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1.6fr,1fr]">
          <div className="stagger grid gap-4 sm:grid-cols-2">
            <Field label="Amount" required error={errors.amount}
              hint="The agreed fare for this trip, before GST">
              <input
                className={`input text-right tabular-nums ${errors.amount ? 'input-error' : ''}`}
                inputMode="decimal" placeholder="0.00"
                value={form.charges.amount}
                onChange={setCharge('amount')}
              />
            </Field>

            <Field label="GST type" hint="CGST + SGST for a customer in our state, IGST for another state">
              <select className="input" value={taxMode} onChange={setCharge('gst')}>
                {GST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>

            <Field label="GST rate" hint={totals.withGst ? gstSummary(taxMode, taxRate) : 'Not charged'}>
              <select
                className="input" value={String(taxRate)} disabled={taxMode === 'NONE'}
                onChange={setCharge('gstRate')}
              >
                {gstRateOptions(taxRate).map((r) => <option key={r} value={String(r)}>{r}%</option>)}
              </select>
            </Field>

            <Field label="Toll &amp; parking" hint="At actuals, added after GST and not taxed">
              <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00"
                value={form.charges.tollParking} onChange={setCharge('tollParking')} />
            </Field>

            <Field label="Advance received" hint="Only affects the balance, not the bill">
              <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0.00"
                value={form.charges.advance} onChange={setCharge('advance')} />
            </Field>

            {legacy.length > 0 && (
              <div className="rounded-lg border border-warn-100 bg-warn-50 p-4 text-xs text-warn-700 sm:col-span-2">
                <p className="font-semibold">This booking was priced line by line.</p>
                <p className="mt-1">
                  Those lines are folded into the amount above and are no longer edited separately. Saving keeps the
                  same total and replaces the breakdown with the single figure.
                </p>
                <dl className="mt-2.5 space-y-1">
                  {legacy.map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt>{k}</dt>
                      <dd className="tabular-nums">{inr(v)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* live total */}
          <div className="rounded-xl border border-ink-200 bg-ink-50/70 p-5 lg:sticky lg:top-24 lg:self-start">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink-600">Bill</h3>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-600">Amount</dt>
                <dd className="tabular-nums text-ink-800">{inr(totals.taxable)}</dd>
              </div>

              {totals.withGst ? (
                taxMode === 'CGST_SGST' ? (
                  <>
                    <div className="flex justify-between"><dt className="text-ink-600">CGST {taxRate / 2}%</dt>
                      <dd className="tabular-nums text-ink-800">{inr(totals.cgst)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-600">SGST {taxRate / 2}%</dt>
                      <dd className="tabular-nums text-ink-800">{inr(totals.sgst)}</dd></div>
                  </>
                ) : (
                  <div className="flex justify-between"><dt className="text-ink-600">IGST {taxRate}%</dt>
                    <dd className="tabular-nums text-ink-800">{inr(totals.igst)}</dd></div>
                )
              ) : (
                <div className="flex justify-between">
                  <dt className="text-ink-500">GST</dt>
                  <dd className="text-ink-500">Not charged</dd>
                </div>
              )}

              {totals.nonTaxable > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-600">Toll &amp; parking</dt>
                  <dd className="tabular-nums text-ink-800">{inr(totals.nonTaxable)}</dd>
                </div>
              )}

              <div className="flex justify-between border-t-2 border-ink-300 pt-2.5 text-base font-bold">
                <dt className="text-ink-900">Total</dt>
                <dd className="tabular-nums text-brand-700">{inr(totals.total)}</dd>
              </div>
              {num(form.charges.advance) > 0 && (
                <div className="flex justify-between text-xs">
                  <dt className="text-ink-500">Balance after advance</dt>
                  <dd className="tabular-nums font-semibold text-ink-700">{inr(totals.balance)}</dd>
                </div>
              )}
            </dl>

            {totals.nonTaxable > 0 && (
              <p className="mt-4 rounded-lg bg-white p-3 text-[11px] leading-relaxed text-ink-500">
                Toll &amp; parking is added <strong>after</strong> GST and is not taxed, matching the vendors' invoice
                formats.
              </p>
            )}
          </div>
        </div>
      </SectionCard>

      {/* --- Notes --- */}
      <SectionCard title="Notes">
        <div className="stagger grid gap-4 sm:grid-cols-2">
          <Field label="Special instructions">
            <textarea className="input min-h-[90px] resize-y" value={form.specialInstructions} onChange={set('specialInstructions')} />
          </Field>
          <Field label="Remarks">
            <textarea className="input min-h-[90px] resize-y" value={form.remarks} onChange={set('remarks')} />
          </Field>
        </div>
        {form.rawMessage && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-semibold text-ink-600 hover:text-brand-600">
              Original vendor message
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs text-ink-600">{form.rawMessage}</pre>
          </details>
        )}
      </SectionCard>

      {/* sticky action bar */}
      <div className="action-bar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Booking total</p>
            <p className="text-lg font-bold tabular-nums text-brand-700">{inr(totals.total)}</p>
          </div>
          <Link to="/admin/bookings" className="btn-outline btn-sm">Cancel</Link>
          {!isEdit && (
            <button onClick={() => save('new')} className="btn-outline btn-sm" disabled={saving}>
              Save &amp; New
            </button>
          )}
          <button onClick={() => save('invoice')} className="btn-dark btn-sm" disabled={saving}>
            Save &amp; Bill
          </button>
          <button onClick={() => save('list')} className="btn-primary" disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Save booking'}
          </button>
        </div>
      </div>

      {/* ---------------- paste modal ---------------- */}
      <Modal
        open={pasteOpen}
        onClose={() => { setPasteOpen(false); setParsed(null); }}
        title="Paste the vendor's booking message"
        subtitle="Works with both the “Booking #” and “TripId #” formats. Nothing is saved until you apply it."
        size="lg"
        footer={
          <>
            <button className="btn-outline" onClick={() => { setPasteOpen(false); setParsed(null); }}>Cancel</button>
            <button className="btn-dark" onClick={runParse} disabled={parsing || !message.trim()}>
              {parsing && <Spinner className="h-4 w-4" />} Read message
            </button>
            <button className="btn-primary" onClick={applyParsed} disabled={!parsed}>
              Fill the form
            </button>
          </>
        }
      >
        <textarea
          className="input min-h-[190px] resize-y font-mono text-xs"
          placeholder={`Booking #88245430-1\nFor T Sridhar(9663655300)\nVehicle group: DZIRE/ETIOS/XCENT\nDuty type: TRANSFER 4H40KMS\nCity: Mumbai\nDate: 27/01 to 27/01\nReporting time: 10:00\nReporting address: T2 Mumbai Airport\nDrop address: Mahalaxmi, Mumbai`}
          value={message}
          onChange={(e) => { setMessage(e.target.value); setParsed(null); }}
        />

        {parsed && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-ink-50 px-4 py-3">
              <StatusBadge value={parsed.detectedFormat} />
              <span className="text-sm text-ink-700">
                Confidence <strong>{Math.round(parsed.confidence * 100)}%</strong>
              </span>
              <span className="text-xs text-ink-500">{parsed.matchedLabels.length} fields recognised</span>
            </div>

            {parsed.duplicate && (
              <div className="rounded-lg border border-warn-100 bg-warn-50 p-3.5 text-sm text-warn-600">
                <strong>Possible duplicate.</strong> {parsed.duplicate.message}
              </div>
            )}

            {parsed.warnings?.length > 0 && (
              <ul className="space-y-1.5 rounded-lg border border-warn-100 bg-warn-50 p-3.5 text-xs text-warn-600">
                {parsed.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            )}

            <div className="table-wrap table-scroll">
              <table className="tbl">
                <thead><tr><th>Field</th><th>Value read from the message</th></tr></thead>
                <tbody>
                  {Object.entries(parsed.fields)
                    .filter(([, v]) => v !== undefined && v !== '')
                    .map(([k, v]) => (
                      <tr key={k}>
                        <td className="whitespace-nowrap text-xs font-semibold text-ink-600">
                          {k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}
                        </td>
                        <td className="text-sm text-ink-900">{String(v)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {parsed.unmatchedLines?.length > 0 && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-ink-600">
                  {parsed.unmatchedLines.length} line(s) not recognised
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
                  {parsed.unmatchedLines.join('\n')}
                </pre>
              </details>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
