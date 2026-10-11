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
import AssignPicker, { EMPTY_ASSIGN, type AssignCheck, type AssignValue } from '../components/AssignPicker';
import { useAuth } from '../lib/auth';
import { IconCheck, IconEvent, IconUsers, IconVendors, IconWarning } from '../components/icons';

/**
 * Where a booking comes from. Chosen first, because it decides who is billed,
 * whether a company reference is expected, and whether a message can be pasted.
 * Events (many vehicles at once) have their own screen and come back here as
 * ordinary trips.
 */
type Source = 'COMPANY' | 'WALKIN' | 'DIRECT' | 'EVENT';
const SOURCE_OPTIONS: { key: Source; label: string; hint: string }[] = [
  { key: 'COMPANY', label: 'Corporate company', hint: 'A company or travel partner sent it — billed to them' },
  { key: 'WALKIN', label: 'Walk-in customer', hint: 'At the counter — billed to the customer' },
  { key: 'DIRECT', label: 'Direct customer', hint: 'Phone, WhatsApp or email — billed to the customer' },
  { key: 'EVENT', label: 'Event / bulk', hint: 'Many vehicles for one event' },
];

/** Form fields the parser reports on, and the parser's name for each. */
const PARSED_FIELD: Record<string, string> = {
  vendorBookingRef: 'vendorBookingRef', passengerName: 'passengerName', passengerMobile: 'passengerMobile',
  vehicleType: 'vehicleType', travelDate: 'travelDate', reportingTime: 'reportingTime',
  pickupLocation: 'pickupAddress', dropLocation: 'dropAddress', dutyType: 'dutyType', flightTrainNo: 'flightTrainNo',
};
const FIELD_LABEL: Record<string, string> = {
  vendorBookingRef: 'Company reference', passengerName: 'Passenger', passengerMobile: 'Passenger mobile', passengerCount: 'Passengers',
  vehicleType: 'Vehicle', dutyType: 'Duty type', tripType: 'Trip type', city: 'City', travelDate: 'Travel date',
  travelDateTo: 'End date', reportingTime: 'Reporting time', pickupAddress: 'Pickup', dropAddress: 'Drop',
  flightTrainNo: 'Flight / train', flightSector: 'Sector', flightTime: 'Flight time', remarks: 'Remarks',
  vendorHint: 'Signed by', contactNumber: 'Company contact', airportDirection: 'Airport direction',
};
const STATE_TEXT: Record<string, string> = { ok: 'Found', missing: 'Missing', confirm: 'Check', not_applicable: 'Not applicable' };

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
  const { can, user } = useAuth() as any;
  const [source, setSource] = useState<Source>(() => {
    const p = (params.get('source') ?? '').toUpperCase();
    return (['COMPANY', 'WALKIN', 'DIRECT', 'EVENT'].includes(p) ? p : 'COMPANY') as Source;
  });
  const [directChannel, setDirectChannel] = useState<'WHATSAPP' | 'EMAIL' | 'PORTAL'>('WHATSAPP');
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryId, setCategoryId] = useState<string>('');
  const [assign, setAssign] = useState<AssignValue>(EMPTY_ASSIGN);
  const [assignCheck, setAssignCheck] = useState<AssignCheck | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  /** Fields the parser could not find or wants checked: key -> note. Cleared as they are edited. */
  const [flags, setFlags] = useState<Record<string, { state: string; note: string }>>({});
  const [dateConfirmed, setDateConfirmed] = useState(true);
  const [applied, setApplied] = useState<any>(null);
  const canOverride = user?.roleCode === 'SUPER_ADMIN' || can('fleet.update');

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
        const [v, veh, cats] = await Promise.all([
          api.get('/vendors/options'),
          api.get('/bookings/lookup/vehicles'),
          api.get('/fares/categories').catch(() => ({ data: { data: [] } })),
        ]);
        setVendors(v.data.data ?? []);
        setVehicles(veh.data.data ?? []);
        setCategories(cats.data.data ?? []);

        if (isEdit) {
          const { data } = await api.get(`/bookings/${id}`);
          const b = data.data, c = data.charges ?? {};
          const vrow = (v.data.data ?? []).find((x: any) => String(x.id) === String(b.vendor_id));
          const tollTaxed = !!vrow?.toll_parking_taxable;
          const tollParking = num(c.toll) + num(c.parking);
          const taxable = num(c.taxable_amount);

          setSource(b.booking_source === 'DIRECT' ? (b.inquiry_source === 'WALKIN' ? 'WALKIN' : 'DIRECT') : 'COMPANY');
          if (['WHATSAPP', 'EMAIL', 'PORTAL'].includes(b.inquiry_source)) setDirectChannel(b.inquiry_source);
          setCategoryId(b.vehicle_category_id ? String(b.vehicle_category_id) : '');
          setAssign({
            ...EMPTY_ASSIGN, vehicleId: b.vehicle_id ?? null, driverId: b.driver_id ?? null,
            vehicleNumber: b.vehicle_number ?? '', driverName: b.driver_name ?? '', driverMobile: b.driver_mobile ?? '',
            outsideVehicle: !b.vehicle_id && !!b.vehicle_number, outsideDriver: !b.driver_id && !!b.driver_name,
          });
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
        } else if (['WALKIN', 'DIRECT'].includes((params.get('source') ?? '').toUpperCase())) {
          setForm((f) => ({ ...f, vendorId: WALKIN }));
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
    setFlags((p) => { if (!p[k]) return p; const n = { ...p }; delete n[k]; return n; });
  };
  /** Amber outline and a note on a field the message did not settle. */
  const flagCls = (k: string) => (flags[k] ? 'ring-2 ring-warn-300 border-warn-500' : '');
  const flagNote = (k: string) => flags[k]?.note;

  const chooseSource = (next: Source) => {
    setSource(next);
    setParsed(null);
    if (next === 'WALKIN' || next === 'DIRECT') setForm((f) => ({ ...f, vendorId: WALKIN, vendorBookingRef: '' }));
    else if (next === 'COMPANY' && form.vendorId === WALKIN) setForm((f) => ({ ...f, vendorId: '' }));
  };
  const category = categories.find((c) => String(c.id) === categoryId);
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
      const { data } = await api.post('/bookings/parse-message', {
        message, vendorId: source === 'COMPANY' && form.vendorId && form.vendorId !== WALKIN ? Number(form.vendorId) : undefined,
      });
      setParsed(data);
    } catch (err) {
      toast.error('Could not read that message', errorMessage(err));
    } finally {
      setParsing(false);
    }
  };

  /**
   * Copy what the message gave into the form. Nothing is invented: a field the
   * message did not contain keeps whatever was there (usually empty) and is
   * outlined so the operator fills it; anything the parser was unsure of is
   * outlined with the reason. The original message is kept with the booking.
   */
  const applyParsed = (useSuggestions: Record<string, boolean> = {}) => {
    if (!parsed) return;
    const f = { ...(parsed.fields ?? {}) };
    for (const [k, on] of Object.entries(useSuggestions)) if (on && parsed.fieldSuggestions?.[k]) f[k] = parsed.fieldSuggestions[k];
    const s = parsed.suggestions ?? {};
    const vendorId = source === 'COMPANY' && s.vendorId ? String(s.vendorId) : undefined;
    setForm((prev) => ({
      ...prev,
      vendorId: vendorId ?? prev.vendorId,
      vendorBookingRef: f.vendorBookingRef ?? prev.vendorBookingRef,
      travelDate: f.travelDate ?? prev.travelDate,
      travelDateTo: f.travelDateTo ?? prev.travelDateTo,
      reportingTime: f.reportingTime ?? prev.reportingTime,
      tripType: f.tripType ?? prev.tripType,
      airportDirection: (f.airportDirection ?? prev.airportDirection) as AirportDir,
      dutyType: f.dutyType?.trim() ?? prev.dutyType,
      city: f.city && !/outstation/i.test(f.city) ? f.city : prev.city,
      pickupLocation: f.pickupAddress ?? prev.pickupLocation,
      pickupAddress: f.pickupAddress ?? prev.pickupAddress,
      dropLocation: f.dropAddress ?? prev.dropLocation,
      dropAddress: f.dropAddress ?? prev.dropAddress,
      flightTrainNo: f.flightTrainNo ?? prev.flightTrainNo,
      passengerName: f.passengerName ?? prev.passengerName,
      passengerMobile: f.passengerMobile ?? prev.passengerMobile,
      passengerEmail: s.passengerEmail ?? prev.passengerEmail,
      paxCount: f.passengerCount ? String(f.passengerCount) : prev.paxCount,
      vehicleType: f.vehicleType ?? prev.vehicleType,
      remarks: [f.remarks, f.flightSector ? `Flight ${f.flightTrainNo ?? ''} ${f.flightSector} ${f.flightTime ?? ''}`.trim() : '']
        .filter(Boolean).join(' · ') || prev.remarks,
      specialInstructions: f.specialInstructions ?? prev.specialInstructions,
      rawMessage: message,
    }));
    if (s.categoryId) setCategoryId(String(s.categoryId));

    const nextFlags: Record<string, { state: string; note: string }> = {};
    for (const [formKey, parsedKey] of Object.entries(PARSED_FIELD)) {
      const st = parsed.fieldStatus?.[parsedKey];
      if (st === 'missing' && !(formKey === 'dropLocation' && ['LOCAL', 'PACKAGE'].includes(f.tripType ?? ''))) {
        nextFlags[formKey] = { state: 'missing', note: 'Not in the message — enter it' };
      } else if (st === 'confirm') {
        nextFlags[formKey] = {
          state: 'confirm',
          note: parsedKey === 'travelDate' ? 'No year in the message — check the date'
            : parsedKey === 'dropAddress' && f.dropFromRemarks ? 'Taken from the remarks — check it'
            : parsedKey === 'dropAddress' && useSuggestions.dropAddress ? 'Completed from the remarks — check it'
            : parsedKey === 'dropAddress' ? 'Looks cut off — check it' : 'Check this value',
        };
      }
    }
    // Optional fields the message just did not have are not "missing".
    for (const k of ['dutyType', 'flightTrainNo']) if (nextFlags[k]?.state === 'missing') delete nextFlags[k];
    if (parsed.fieldStatus?.vendorBookingRef === 'not_applicable') delete nextFlags.vendorBookingRef;
    setFlags(nextFlags);
    setDateConfirmed(parsed.fieldStatus?.travelDate !== 'confirm');
    setApplied({ warnings: parsed.warnings ?? [], duplicate: parsed.duplicate, company: parsed.company });
    setPasteOpen(false);
    setParsed(null);
    const n = Object.keys(nextFlags).length;
    toast.success('Form filled from the message', n ? `${n} field(s) are outlined — fill or check them before saving.` : 'Check the values, then save.');
  };

  const airport = form.tripType === 'AIRPORT';
  const ends = airportEnds(form.airportDirection);

  // ---- save ---------------------------------------------------------------
  const validate = (_then: 'list' | 'new' | 'invoice' = 'list') => {
    const e: Record<string, string> = {};
    if (!form.vendorId) e.vendorId = 'Choose the company this booking came from.';
    if (!dateConfirmed) e.travelDate = 'The message had no year — confirm the travel date (tick the box under it).';
    if (assignCheck?.needsOverride && overrideReason.trim().length < 3) {
      e.assign = canOverride ? 'Give a reason for allotting an unavailable vehicle or driver.' : 'The vehicle or driver chosen is not available — choose another.';
    }
    if (isWalkIn && form.customerName.trim().length < 2) {
      e.customerName = 'Enter the customer name — the invoice is addressed to them.';
    }
    if (isWalkIn && form.customerMobile && !/^[6-9]\d{9}$/.test(form.customerMobile.replace(/\D/g, '').replace(/^91/, ''))) {
      e.customerMobile = 'Enter a valid 10-digit mobile number.';
    }
    // A fare is not invented: it can be left empty now and must be entered
    // before billing is confirmed. A walk-in at the counter is priced on the spot.
    if (num(form.charges.amount) <= 0 && source === 'WALKIN') e.amount = 'Enter the amount agreed with the customer.';
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
    // The allotment is saved through the trip's own assign step (availability,
    // clashes, history); the booking itself only carries the category.
    vehicleId: isEdit ? (form.vehicleId ? Number(form.vehicleId) : null) : null,
    vehicleNumber: isEdit ? form.vehicleNumber : '',
    driverName: isEdit ? form.driverName : '',
    driverMobile: isEdit ? form.driverMobile : '',
    vehicleCategoryId: categoryId ? Number(categoryId) : null,
    vehicleType: category?.name ?? form.vehicleType,
    inquirySource: isWalkIn ? (source === 'WALKIN' ? 'WALKIN' : directChannel) : 'VENDOR',
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

  const assignChanged = (b: any) =>
    (assign.vehicleId ?? null) !== (b?.vehicle_id ?? null) || (assign.vehicleNumber || '') !== (b?.vehicle_number || '')
    || (assign.driverId ?? null) !== (b?.driver_id ?? null) || (assign.driverName || '') !== (b?.driver_name || '');

  const save = async (then: 'list' | 'new' | 'invoice') => {
    if (!validate(then)) return;
    setSaving(true);
    try {
      const res = isEdit
        ? await api.put(`/bookings/${id}`, payload())
        : await api.post('/bookings', payload());

      const saved = res.data.data;
      const code = saved.trip_id || saved.booking_code;
      toast.success(isEdit ? `${code} updated` : `${code} saved`,
        `${totals.total > 0 ? `Total ${inr(totals.total)}. ` : 'No fare yet — add it before billing. '}It now shows in Bookings and Trips.`);

      // Vehicle and driver go through the same allotment step as the trip
      // drawer, so availability, clashes and history are checked one way.
      const hasAllotment = !!(assign.vehicleId || assign.vehicleNumber) && !!(assign.driverId || assign.driverName);
      if (hasAllotment && assignChanged(saved)) {
        try {
          const a = await api.post(`/trips/${saved.id}/assign`, {
            vehicleId: assign.vehicleId, driverId: assign.driverId, vehicleNumber: assign.vehicleNumber,
            vehicleType: category?.name ?? form.vehicleType, driverName: assign.driverName, driverMobile: assign.driverMobile,
            notifyCustomer: false, overrideReason: assignCheck?.needsOverride ? overrideReason : '',
          });
          toast.success('Vehicle and driver assigned', a.data.message);
        } catch (err) {
          toast.warning('Saved, but the allotment needs attention', `${errorMessage(err)} Open the trip to allot again.`);
          navigate(`/admin/trips?open=${saved.id}`);
          return;
        }
      }

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
        setFlags({});
        setApplied(null);
        setAssign(EMPTY_ASSIGN);
        setCategoryId('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else if (then === 'invoice') {
        navigate(`/admin/trips?open=${saved.id}`);
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
              : 'Choose where the booking came from, paste the message if there is one, check the details, allot a vehicle and save.'}
          </p>
        </div>
        <div className="page-actions">
          <Link to="/admin/bookings" className="btn-outline btn-sm">Cancel</Link>
        </div>
      </div>

      {/* --- Step 1: source --- */}
      <SectionCard title="1 · Booking source" sub="Decides who is billed and which details are needed.">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {SOURCE_OPTIONS.map((o) => {
            const on = source === o.key;
            const Icon = o.key === 'COMPANY' ? IconVendors : o.key === 'EVENT' ? IconEvent : IconUsers;
            return (
              <button key={o.key} type="button" disabled={isEdit && o.key === 'EVENT'}
                onClick={() => chooseSource(o.key)} aria-pressed={on}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${on ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-300' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'} disabled:opacity-50`}>
                <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${on ? 'text-brand-600' : 'text-ink-400'}`} />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">{o.label}{on && <IconCheck className="h-3.5 w-3.5 text-brand-600" />}</span>
                  <span className="block text-xs text-ink-500">{o.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {source === 'EVENT' && (
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/60 p-4 text-sm text-brand-900">
            <p className="font-semibold">Events are booked from the Events screen.</p>
            <p className="mt-1 text-brand-800">Enter the event once, add its vehicle requirements (by hand, pasted from Excel, or from an uploaded sheet), and the portal creates one trip per vehicle. Those trips then appear here in Bookings and in Trips, and are billed like any other.</p>
            <Link to="/admin/events" className="btn-primary btn-sm mt-3 inline-flex">Go to Events</Link>
          </div>
        )}

        {source === 'COMPANY' && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr,1.3fr]">
            <Field label="Company" required error={errors.vendorId}
              hint={vendor && !isWalkIn ? [vendor.company_name, vendor.gst_number ? `GSTIN ${vendor.gst_number}` : 'No GSTIN on file', vendor.has_parser_rules ? 'Has its own message rules' : ''].filter(Boolean).join(' · ') : 'From the Companies master'}>
              <select className={`input ${errors.vendorId ? 'input-error' : ''}`} value={isWalkIn ? '' : form.vendorId}
                onChange={(e) => { set('vendorId')(e); setParsed(null); }}>
                <option value="">Select the company…</option>
                {vendorOptions.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}{v.company_name && v.company_name !== v.vendor_name ? ` — ${v.company_name}` : ''} ({v.code})</option>)}
              </select>
              {can('vendors.create') && (
                <Link to="/admin/vendors" className="mt-1.5 inline-block text-xs font-semibold text-brand-700 hover:underline">Company not listed? Register it</Link>
              )}
            </Field>
            {!isEdit && (
              <div className="text-sm text-ink-600">
                <p className="font-semibold text-ink-800">2 · Paste the company’s booking message</p>
                <p className="mt-1">Paste the WhatsApp / email text exactly as received and press <strong>Read message</strong>. The details are shown for checking before anything is filled in, and the original message is saved with the booking.</p>
                <button onClick={() => setPasteOpen((o) => !o)} className="btn-dark btn-sm mt-2">
                  <IconPaste className="h-4 w-4" /> {pasteOpen ? 'Hide the message box' : 'Paste booking message'}
                </button>
              </div>
            )}
          </div>
        )}

        {(source === 'WALKIN' || source === 'DIRECT') && !isEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            {source === 'DIRECT' && (
              <Field label="How did they reach us?">
                <select className="input h-9 w-auto" value={directChannel} onChange={(e) => setDirectChannel(e.target.value as any)}>
                  <option value="WHATSAPP">Phone / WhatsApp</option><option value="EMAIL">Email</option><option value="PORTAL">Website</option>
                </select>
              </Field>
            )}
            <p className="text-ink-600">No company reference is needed — the invoice is made out to the customer below.</p>
            <button onClick={() => setPasteOpen((o) => !o)} className="btn-outline btn-sm"><IconPaste className="h-4 w-4" /> Paste a message</button>
          </div>
        )}

        {pasteOpen && !isEdit && source !== 'EVENT' && (
          <div className="mt-4 space-y-3 rounded-xl border border-ink-200 bg-ink-50/50 p-4">
            {source === 'COMPANY' && !form.vendorId && (
              <p className="text-xs text-ink-600">Tip: choose the company first so its own message rules are used. Without one, the portal will try to recognise the company from the message.</p>
            )}
            <textarea className="input min-h-[170px] resize-y bg-white font-mono text-xs"
              placeholder={`Booking #88245430-1\nFor T Sridhar(9663655300)\nVehicle group: DZIRE/ETIOS/XCENT\nDuty type: TRANSFER 4H40KMS\nDate: 27/01 to 27/01\nReporting time: 10:00\nReporting address: T2 Mumbai Airport`}
              value={message} onChange={(e) => { setMessage(e.target.value); setParsed(null); }} />
            <div className="flex flex-wrap gap-2">
              <button className="btn-dark btn-sm" onClick={runParse} disabled={parsing || !message.trim()}>
                {parsing && <Spinner className="h-4 w-4" />} Read message
              </button>
              {parsed && <button className="btn-primary btn-sm" onClick={() => applyParsed()}>Fill the form with these values</button>}
              {parsed?.fieldSuggestions?.dropAddress && (
                <button className="btn-outline btn-sm" onClick={() => applyParsed({ dropAddress: true })}>Fill, using the completed drop address</button>
              )}
            </div>
            {parsed && <ParsePreview parsed={parsed} />}
          </div>
        )}

        {applied && (applied.duplicate || applied.warnings.length > 0) && (
          <div className="mt-4 space-y-2">
            {applied.duplicate && (
              <div className="notice-warn flex-col !items-start">
                <p className="font-semibold">Possible duplicate — {applied.duplicate.message}</p>
                <Link className="text-xs font-semibold text-brand-700 hover:underline" to={`/admin/trips?open=${applied.duplicate.id}`}>Open the existing trip</Link>
              </div>
            )}
            {applied.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-warn-100 bg-warn-50 p-3 text-xs text-warn-700">
                {applied.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            )}
          </div>
        )}
      </SectionCard>

      {/* --- Booking Information --- */}
      {source !== 'EVENT' && <>
      <SectionCard title="Booking information" sub={isWalkIn ? 'The customer is billed directly.' : 'The company’s own reference for this booking.'}>
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!isWalkIn && (
            <Field label="Company's booking reference" error={errors.vendorBookingRef}
              hint={flagNote('vendorBookingRef') ?? (vendor ? 'Must be unique for this company' : undefined)}>
              <input className={`input ${flagCls('vendorBookingRef')}`} value={form.vendorBookingRef} onChange={set('vendorBookingRef')}
                placeholder="e.g. 88245430-1" />
            </Field>
          )}

          <Field label="Booking date">
            <DateField value={form.bookingDate} onChange={set('bookingDate')} />
          </Field>

          <Field label="Booking status" hint="Use the trip screen to complete a trip — it records km, hours and extras">
            <select className="input" value={form.bookingStatus} onChange={set('bookingStatus')}>
              {(isEdit ? ['DRAFT', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] : ['DRAFT', 'CONFIRMED']).map((s) => (
                <option key={s} value={s}>{s === 'ONTRIP' ? 'On trip' : s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</option>
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
          <Field label="Passenger name" required error={errors.passengerName} hint={flagNote('passengerName')}>
            <Suggest
              value={form.passengerName}
              onChange={(v) => setForm((f) => ({ ...f, passengerName: v }))}
              onPick={(p) => setForm((f) => ({
                ...f, passengerName: p.name, passengerMobile: p.mobile ?? f.passengerMobile,
                passengerEmail: p.email ?? f.passengerEmail,
              }))}
              fetchUrl="/bookings/lookup/passengers"
              placeholder="e.g. Mahesh Kale"
              className={flagCls('passengerName') ? 'rounded-lg ring-2 ring-warn-300' : ''}
            />
          </Field>
          <Field label="Mobile" error={errors.passengerMobile} hint={flagNote('passengerMobile')}>
            <input className={`input ${errors.passengerMobile ? 'input-error' : ''} ${flagCls('passengerMobile')}`} inputMode="numeric"
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
          <Field label="Travel date" required error={errors.travelDate} hint={flagNote('travelDate')}>
            <div className={flags.travelDate ? 'rounded-lg ring-2 ring-warn-300' : ''}>
              <DateField error={!!errors.travelDate}
                value={form.travelDate} onChange={(v: any) => { set('travelDate')(v); setDateConfirmed(true); }} />
            </div>
            {!dateConfirmed && (
              <label className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-warn-700">
                <input type="checkbox" className="check" checked={dateConfirmed} onChange={(e) => setDateConfirmed(e.target.checked)} />
                I have checked this date (the message had no year)
              </label>
            )}
          </Field>
          <Field label="End date" hint="Only for multi-day duties" error={errors.travelDateTo}>
            <DateField error={!!errors.travelDateTo} placeholder="Single-day duty"
              value={form.travelDateTo} onChange={set('travelDateTo')} min={form.travelDate} />
          </Field>
          <Field label="Reporting time" error={errors.reportingTime} hint={flagNote('reportingTime')}>
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
              <Field label={airport ? ends.pickup : 'Pickup location'} required error={errors.pickupLocation} className={`lg:col-span-2 ${flagCls('pickupLocation') ? 'rounded-lg ring-2 ring-warn-300' : ''}`} hint={flagNote('pickupLocation')}>
                <Suggest
                  value={form.pickupLocation}
                  onChange={(v) => setForm((f) => ({ ...f, pickupLocation: v }))}
                  fetchUrl="/bookings/lookup/locations"
                  placeholder={airport ? ends.pickupHint : 'e.g. Terminal 2, Mumbai Airport'}
                />
              </Field>
              <Field label={airport ? ends.drop : 'Drop location'} required={airport} className={`lg:col-span-2 ${flagCls('dropLocation') ? 'rounded-lg ring-2 ring-warn-300' : ''}`} hint={flagNote('dropLocation')}>
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

      {/* --- Vehicle & driver --- */}
      <SectionCard title="Vehicle & driver" sub="The category booked, and — if known now — the vehicle and driver. Only those free for this trip are offered first.">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Vehicle category" hint={flagNote('vehicleType') ?? (form.vehicleType && !category ? `Message says “${form.vehicleType}”` : undefined)}>
            <select className={`input ${flagCls('vehicleType')}`} value={categoryId}
              onChange={(e) => { setCategoryId(e.target.value); setFlags((p) => { const n = { ...p }; delete n.vehicleType; return n; }); }}>
              <option value="">Not chosen</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.seating ? ` · ${c.seating} seats` : ''}</option>)}
            </select>
          </Field>
          {form.vehicleType && category && form.vehicleType.toLowerCase() !== String(category.name).toLowerCase() && (
            <p className="self-end pb-2 text-xs text-ink-500 sm:col-span-3">Requested as “{form.vehicleType}”.</p>
          )}
        </div>
        <div className="mt-4">
          <AssignPicker
            trip={{ bookingId: isEdit ? Number(id) : null, date: form.travelDate, dateTo: form.travelDateTo, time: form.reportingTime, tripType: form.tripType, categoryId: categoryId ? Number(categoryId) : null }}
            value={assign} onChange={setAssign} onCheck={setAssignCheck} canOverride={canOverride} />
          {assignCheck?.needsOverride && (
            <div className="notice-warn mt-3 flex-col">
              <p className="flex items-center gap-2 font-semibold"><IconWarning className="h-4 w-4" /> Not available for this trip</p>
              <ul className="list-disc pl-5 text-xs">{assignCheck.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              {canOverride ? (
                <Field label="Allot anyway? Say why" error={errors.assign}>
                  <input className="input" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                </Field>
              ) : <p className="text-xs">Only a fleet manager can override this. Choose another, or leave it unallotted.</p>}
            </div>
          )}
          <p className="mt-2 text-xs text-ink-500">Leave both empty to allot later from Trips. The allotment is saved with its history when the booking is saved.</p>
        </div>
      </SectionCard>

      {/* --- Amount --- */}
      <SectionCard
        title="Amount"
        sub={
          !form.vendorId
            ? 'Choose the company or customer first, so the right GST rate applies.'
            : !totals.withGst
              ? 'No GST on this bill. Pick a GST type below if the customer wants a GST bill.'
              : `${gstSummary(taxMode, taxRate)} is added on the amount. Change the type or rate below for this bill.`
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1.6fr,1fr]">
          <div className="stagger grid gap-4 sm:grid-cols-2">
            <Field label="Amount" error={errors.amount}
              hint="The agreed fare before GST. Leave empty if not known yet — it must be entered before billing.">
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
              Original message (kept with the booking)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-xs text-ink-600">{form.rawMessage}</pre>
          </details>
        )}
      </SectionCard>
      </>}

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
          {source !== 'EVENT' && (
            <button onClick={() => save('invoice')} className="btn-dark btn-sm" disabled={saving}
              title="Save, then open the trip to complete, confirm billing and invoice it">
              Save &amp; open trip
            </button>
          )}
          <button onClick={() => save('list')} className="btn-primary" disabled={saving || source === 'EVENT'}>
            {saving && <Spinner className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Save booking'}
          </button>
        </div>
      </div>

    </div>
  );
}

/** What the parser read, field by field, before anything is put into the form. */
function ParsePreview({ parsed }: { parsed: any }) {
  const order = ['vendorBookingRef', 'passengerName', 'passengerMobile', 'passengerCount', 'vehicleType', 'dutyType', 'tripType',
    'airportDirection', 'city', 'travelDate', 'travelDateTo', 'reportingTime', 'pickupAddress', 'dropAddress',
    'flightTrainNo', 'flightSector', 'flightTime', 'remarks', 'vendorHint', 'contactNumber'];
  const f = parsed.fields ?? {};
  const st = parsed.fieldStatus ?? {};
  const rows = order.filter((k) => f[k] !== undefined && f[k] !== '' || st[k]);
  const badge = (state?: string) => state === 'ok' ? 'badge-ok' : state === 'missing' ? 'badge-warn' : state === 'confirm' ? 'badge-violet' : 'badge-neutral';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {parsed.company
          ? <span className="badge-brand">Company: {parsed.company.name}{parsed.company.detectedBy && parsed.company.detectedBy !== 'selected' ? ` (recognised by ${parsed.company.detectedBy})` : ''}</span>
          : <span className="badge-neutral">Company not recognised</span>}
        <span className="text-ink-600">{Math.round((parsed.confidence ?? 0) * 100)}% of the key details found</span>
      </div>
      {parsed.companyMismatch && <p className="notice-warn !py-2 text-xs">{parsed.companyMismatch}</p>}
      {parsed.unknownCompany && (
        <p className="notice-info !py-2 text-xs">
          The message is signed by {parsed.unknownCompany.name ?? 'a company'}{parsed.unknownCompany.contactNumber ? ` (${parsed.unknownCompany.contactNumber})` : ''}, which is not in the Companies master.
          Register it under <Link className="font-semibold text-brand-700" to="/admin/vendors">Companies</Link>, book it as a direct customer, or use <Link className="font-semibold text-brand-700" to="/admin/events">Events</Link> for a bulk request.
        </p>
      )}
      {parsed.duplicate && (
        <p className="notice-warn !py-2 text-xs">
          <strong>Already booked.</strong> {parsed.duplicate.message} <Link className="font-semibold text-brand-700" to={`/admin/trips?open=${parsed.duplicate.id}`}>Open it</Link>
        </p>
      )}
      <div className="table-wrap table-scroll bg-white">
        <table className="tbl">
          <thead><tr><th>Field</th><th>Read from the message</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k}>
                <td className="whitespace-nowrap text-xs font-semibold text-ink-600">{FIELD_LABEL[k] ?? k}</td>
                <td className="text-sm text-ink-900">
                  {f[k] !== undefined && f[k] !== '' ? String(f[k]) : <span className="text-ink-400">—</span>}
                  {k === 'travelDate' && f.travelDateRaw && <span className="ml-2 text-xs text-ink-500">(written “{f.travelDateRaw}”)</span>}
                  {parsed.fieldSuggestions?.[k] && <span className="block text-xs text-violet-700">Suggested: {parsed.fieldSuggestions[k]}</span>}
                </td>
                <td>{st[k] ? <span className={badge(st[k])}>{STATE_TEXT[st[k]] ?? st[k]}</span> : <span className="badge-ok">Found</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {parsed.warnings?.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warn-100 bg-warn-50 p-3 text-xs text-warn-700">
          {parsed.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
        </ul>
      )}
      {parsed.unmatchedLines?.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-ink-600">{parsed.unmatchedLines.length} line(s) not recognised</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-ink-600">{parsed.unmatchedLines.join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
