import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, todayIso } from '../lib/format';
import { Field, Loading, Modal, Spinner, SectionCard, PageHeader } from '../components/ui';
import { IconPaste, IconInvoices, IconCheck } from '../components/icons';
import { useToast } from '../components/Toast';
import { DateField, TimeField } from '../components/DateTimeField';
import { GST_TYPES, gstRateOptions, gstSummary, type GstType } from './gst';
import { AirportDirectionPicker, airportEnds, type AirportDir } from './airport';

/* ==========================================================================
   Counter booking.

   For work taken straight from a customer rather than through a vendor: their
   details, the trip, the fare, and an invoice made out to them — in one pass.
   ========================================================================== */

const TRIP_TYPES = [
  ['LOCAL', 'Local'], ['TRANSFER', 'Transfer'], ['AIRPORT', 'Airport'],
  ['OUTSTATION', 'Outstation'], ['ROUND_TRIP', 'Round Trip'], ['PACKAGE', 'Package'],
] as const;

const EMPTY = {
  bookingSource: 'DIRECT',
  customerName: '', customerMobile: '', customerEmail: '', customerAddress: '', customerGstin: '',
  travelDate: todayIso(), travelDateTo: '', reportingTime: '',
  tripType: 'LOCAL', airportDirection: '' as AirportDir, dutyType: '', city: 'Mumbai',
  pickupLocation: '', dropLocation: '', flightTrainNo: '',
  tripDistanceKm: '', tripDurationHrs: '',
  passengerName: '', passengerMobile: '', paxCount: '1', bagCount: '0',
  vehicleId: '', vehicleType: '', vehicleNumber: '', driverName: '', driverMobile: '',
  remarks: '', specialInstructions: '', rawMessage: '',
  bookingStatus: 'CONFIRMED',
  // Walk-in fares are quoted without GST; it goes on only when the customer
  // asks for a GST bill, at the type and rate picked here.
  gstType: 'NONE' as GstType,
  gstRate: '',
  charges: {
    baseFare: '', extraKm: '', extraKmRate: '', extraHours: '', extraHourRate: '',
    toll: '', parking: '', driverAllowance: '', permit: '', nightCharge: '',
    otherCharges: '', otherChargesNote: '', discount: '', advance: '',
  },
};
type Form = typeof EMPTY;

const num = (v: any) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Mirrors services/billing.ts so the counter sees the total as it types. */
function price(c: Form['charges'], taxMode: string, taxRate: number, tollTaxable: boolean) {
  const extraKmAmount = num(c.extraKm) * num(c.extraKmRate);
  const extraHoursAmount = num(c.extraHours) * num(c.extraHourRate);
  const tollParking = num(c.toll) + num(c.parking);
  let taxable = num(c.baseFare) + extraKmAmount + extraHoursAmount + num(c.driverAllowance) +
    num(c.permit) + num(c.nightCharge) + num(c.otherCharges) - num(c.discount);
  if (tollTaxable) taxable += tollParking;
  taxable = Math.max(0, Math.round(taxable * 100) / 100);

  const nonTaxable = tollTaxable ? 0 : tollParking;
  const rate = taxMode === 'NONE' ? 0 : taxRate;
  const tax = Math.round(taxable * rate) / 100;
  const cgst = taxMode === 'CGST_SGST' ? Math.round((tax / 2) * 100) / 100 : 0;
  const sgst = taxMode === 'CGST_SGST' ? Math.round((tax - cgst) * 100) / 100 : 0;
  const igst = taxMode === 'IGST' ? tax : 0;
  const invoiceValue = Math.round((taxable + tax) * 100) / 100;
  const total = Math.round((invoiceValue + nonTaxable) * 100) / 100;
  return {
    extraKmAmount, extraHoursAmount, tollParking, taxable, nonTaxable,
    tax, cgst, sgst, igst, invoiceValue, total,
    balance: Math.round((total - num(c.advance)) * 100) / 100,
  };
}

export default function CustomerBooking() {
  const [form, setForm] = useState<Form>(EMPTY);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [directVendor, setDirectVendor] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [parsing, setParsing] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const [veh, vendors] = await Promise.all([
          api.get('/bookings/lookup/vehicles'),
          api.get('/vendors/options'),
        ]);
        setVehicles(veh.data.data ?? []);
        setDirectVendor((vendors.data.data ?? []).find((v: any) => v.code === 'DIRECT') ?? null);
      } catch (err) {
        toast.error('Could not load the form', errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const taxMode: string = form.gstType;
  const taxRate = form.gstRate ? num(form.gstRate) : Number(directVendor?.tax_rate) > 0 ? Number(directVendor.tax_rate) : 5;
  const totals = useMemo(
    () => price(form.charges, taxMode, taxRate, !!directVendor?.toll_parking_taxable),
    [form.charges, taxMode, taxRate, directVendor]
  );

  const set = (k: keyof Form) => (e: any) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((p) => ({ ...p, [k]: '' }));
  };
  const setVal = (k: keyof Form) => (v: string) => set(k)({ target: { value: v } });
  const setCharge = (k: keyof Form['charges']) => (e: any) =>
    setForm((f) => ({ ...f, charges: { ...f.charges, [k]: e.target.value } }));

  const pickVehicle = (id: string) => {
    const v = vehicles.find((x) => String(x.id) === id);
    setForm((f) => ({
      ...f,
      vehicleId: id,
      vehicleType: v?.vehicle_type ?? f.vehicleType,
      vehicleNumber: v?.vehicle_number ?? f.vehicleNumber,
      driverName: v?.driver_name ?? f.driverName,
      driverMobile: v?.driver_mobile ?? f.driverMobile,
    }));
  };

  const runParse = async () => {
    if (!message.trim()) return;
    setParsing(true);
    try {
      const { data } = await api.post('/bookings/parse-message', { message });
      const f = data.fields ?? {};
      const s = data.suggestions ?? {};
      setForm((p) => ({
        ...p,
        customerName: f.passengerName ?? p.customerName,
        customerMobile: f.passengerMobile ?? p.customerMobile,
        passengerName: f.passengerName ?? p.passengerName,
        passengerMobile: f.passengerMobile ?? p.passengerMobile,
        travelDate: f.travelDate ?? p.travelDate,
        reportingTime: f.reportingTime ?? p.reportingTime,
        tripType: f.tripType ?? p.tripType,
        airportDirection: (f.airportDirection ?? p.airportDirection) as AirportDir,
        dutyType: f.dutyType ? String(f.dutyType).trim() : p.dutyType,
        city: f.city ?? p.city,
        pickupLocation: f.pickupAddress ?? p.pickupLocation,
        dropLocation: f.dropAddress ?? p.dropLocation,
        flightTrainNo: f.flightTrainNo ?? p.flightTrainNo,
        vehicleType: f.vehicleType ?? p.vehicleType,
        vehicleId: s.vehicleId ? String(s.vehicleId) : p.vehicleId,
        vehicleNumber: s.vehicleNumber ?? p.vehicleNumber,
        driverName: s.driverName ?? p.driverName,
        driverMobile: s.driverMobile ?? p.driverMobile,
        remarks: f.remarks ?? p.remarks,
        rawMessage: message,
      }));
      setPasteOpen(false);
      setMessage('');
      toast.success('Details filled from the message', 'Check them, then enter the fare.');
    } catch (err) {
      toast.error('Could not read that message', errorMessage(err));
    } finally {
      setParsing(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.customerName.trim().length < 2) {
      e.customerName = 'Customer name is required — the invoice is addressed to them.';
    }
    const mob = form.customerMobile.replace(/\D/g, '').replace(/^91/, '');
    if (form.customerMobile && !/^[6-9]\d{9}$/.test(mob)) {
      e.customerMobile = 'Enter a valid 10-digit mobile number.';
    }
    if (form.customerGstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(form.customerGstin.toUpperCase())) {
      e.customerGstin = 'GSTIN must be 15 characters, e.g. 27AAACS0764L1Z6.';
    }
    if (form.tripType === 'AIRPORT' && !form.airportDirection) {
      e.airportDirection = 'Choose the direction first: to the airport, or from the airport.';
    }
    if (!form.pickupLocation.trim()) e.pickupLocation = 'Pickup location is required.';
    if (!form.travelDate) e.travelDate = 'Travel date is required.';
    if (totals.total <= 0) e.baseFare = 'Enter the fare — an invoice cannot be raised for zero.';
    setErrors(e);
    if (Object.keys(e).length) toast.error('Some fields need attention', Object.values(e).join('\n'));
    return Object.keys(e).length === 0;
  };

  const payload = () => ({
    ...form,
    passengerName: form.passengerName.trim() || form.customerName,
    passengerMobile: form.passengerMobile || form.customerMobile,
    paxCount: num(form.paxCount),
    bagCount: num(form.bagCount),
    tripDistanceKm: num(form.tripDistanceKm),
    tripDurationHrs: num(form.tripDurationHrs),
    vehicleId: form.vehicleId ? Number(form.vehicleId) : null,
    travelDateTo: form.travelDateTo || undefined,
    gstType: undefined, gstRate: undefined,
    charges: {
      ...Object.fromEntries(
        Object.entries(form.charges).map(([k, v]) => [k, k === 'otherChargesNote' ? v : num(v)])
      ),
      taxModeOverride: taxMode,
      taxRateOverride: taxMode === 'NONE' ? 0 : taxRate,
    },
  });

  const save = async (andInvoice: boolean) => {
    if (!validate()) return;
    setSaving(true);
    try {
      const { data } = await api.post('/bookings', payload());
      const booking = data.data;

      if (!andInvoice) {
        // The Trip ID is the reference the customer will quote back, so it is
        // what the confirmation says — the booking code is internal.
        toast.success(
          `Trip ${booking.trip_id ?? booking.booking_code} saved`,
          `${booking.booking_code} · total ${inr(totals.total)}. Manage it under Trips.`
        );
        navigate('/admin/trips');
        return;
      }

      const gen = await api.post('/invoices/generate', {
        vendorId: booking.vendor_id,
        bookingIds: [booking.id],
        invoiceDate: todayIso(),
      });
      setResult({ booking, ...gen.data });
      toast.success(gen.data.message, gen.data.warnings?.length ? gen.data.warnings.join('\n') : undefined);
    } catch (err) {
      toast.error(andInvoice ? 'Saved, but the invoice failed' : 'Could not save the booking', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading…" />;

  const money = (label: string, key: keyof Form['charges']) => (
    <Field label={label} error={key === 'baseFare' ? errors.baseFare : undefined}>
      <input className="input input-money" inputMode="decimal" placeholder="0.00"
        value={form.charges[key]} onChange={setCharge(key)} />
    </Field>
  );

  return (
    <div className="page mx-auto max-w-6xl pb-24">
      <PageHeader
        title="Customer booking"
        subtitle="A booking taken straight from a customer. The invoice is made out to them, not to a vendor."
        actions={
          <>
            <button onClick={() => setPasteOpen(true)} className="btn-dark">
              <IconPaste className="h-4 w-4" /> Paste message
            </button>
            <Link to="/admin/bookings" className="btn-outline btn-sm">Cancel</Link>
          </>
        }
      />

      <SectionCard title="Customer" subtitle="These details appear on the invoice as the bill-to party.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Customer name" required error={errors.customerName}>
            <input className={`input ${errors.customerName ? 'input-error' : ''}`}
              value={form.customerName} onChange={set('customerName')} placeholder="e.g. Parag Bane" />
          </Field>
          <Field label="Mobile" error={errors.customerMobile}>
            <input className={`input ${errors.customerMobile ? 'input-error' : ''}`} inputMode="numeric"
              value={form.customerMobile} onChange={set('customerMobile')} placeholder="10-digit mobile" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.customerEmail} onChange={set('customerEmail')} />
          </Field>
          <Field label="Billing address" className="lg:col-span-2">
            <textarea className="input min-h-[70px] resize-y" value={form.customerAddress}
              onChange={set('customerAddress')} placeholder="Flat, building, street, area, city, pincode" />
          </Field>
          <Field label="GSTIN" hint="Only if the customer needs input credit" error={errors.customerGstin}>
            <input className={`input font-mono uppercase ${errors.customerGstin ? 'input-error' : ''}`}
              value={form.customerGstin} onChange={set('customerGstin')} placeholder="27AAACS0764L1Z6" />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Trip">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Travel date" required error={errors.travelDate}>
            <DateField error={!!errors.travelDate}
              value={form.travelDate} onChange={setVal('travelDate')} />
          </Field>
          <Field label="End date" hint="Multi-day duties only">
            <DateField min={form.travelDate} placeholder="Single-day duty"
              value={form.travelDateTo} onChange={setVal('travelDateTo')} />
          </Field>
          <Field label="Reporting time">
            <TimeField value={form.reportingTime} onChange={setVal('reportingTime')} />
          </Field>
          <Field label="Trip type">
            <select className="input" value={form.tripType} onChange={set('tripType')}>
              {TRIP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          {/* Airport: which way first, then the two ends named for it. */}
          {form.tripType === 'AIRPORT' && (
            <Field label="Direction" required error={errors.airportDirection} className="lg:col-span-2">
              <AirportDirectionPicker
                value={form.airportDirection}
                onChange={(v) => { setForm((f) => ({ ...f, airportDirection: v })); setErrors((x) => ({ ...x, airportDirection: '' })); }}
              />
            </Field>
          )}
          {form.tripType === 'AIRPORT' && !form.airportDirection ? (
            <p className="self-end pb-2 text-sm text-ink-500 lg:col-span-2">
              Choose <strong className="text-ink-700">To airport</strong> or <strong className="text-ink-700">From airport</strong> to enter the addresses.
            </p>
          ) : (
            <>
              <Field label={form.tripType === 'AIRPORT' ? airportEnds(form.airportDirection).pickup : 'Pickup'} required error={errors.pickupLocation} className="lg:col-span-2">
                <input className={`input ${errors.pickupLocation ? 'input-error' : ''}`}
                  value={form.pickupLocation} onChange={set('pickupLocation')}
                  placeholder={form.tripType === 'AIRPORT' ? airportEnds(form.airportDirection).pickupHint : 'e.g. New Panvel'} />
              </Field>
              <Field label={form.tripType === 'AIRPORT' ? airportEnds(form.airportDirection).drop : 'Drop'} className="lg:col-span-2">
                <input className="input" value={form.dropLocation} onChange={set('dropLocation')}
                  placeholder={form.tripType === 'AIRPORT' ? airportEnds(form.airportDirection).dropHint : 'e.g. Navi Mumbai Airport'} />
              </Field>
            </>
          )}

          <Field label="Duty type / package" hint="e.g. 4H40KMS">
            <input className="input" value={form.dutyType} onChange={set('dutyType')} />
          </Field>
          <Field label="Flight / train number">
            <input className="input" value={form.flightTrainNo} onChange={set('flightTrainNo')} />
          </Field>
          <Field label="Distance (km)">
            <input className="input input-money" inputMode="decimal"
              value={form.tripDistanceKm} onChange={set('tripDistanceKm')} />
          </Field>
          <Field label="Passengers">
            <input className="input" inputMode="numeric" value={form.paxCount} onChange={set('paxCount')} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Vehicle">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From fleet">
            <select className="input" value={form.vehicleId} onChange={(e) => pickVehicle(e.target.value)}>
              <option value="">Not assigned</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.vehicle_number} — {v.vehicle_type}</option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle type">
            <input className="input" value={form.vehicleType} onChange={set('vehicleType')} />
          </Field>
          <Field label="Vehicle number">
            <input className="input uppercase" value={form.vehicleNumber} onChange={set('vehicleNumber')} />
          </Field>
          <Field label="Driver">
            <input className="input" value={form.driverName} onChange={set('driverName')} />
          </Field>
          <Field label="Driver mobile">
            <input className="input" inputMode="numeric" value={form.driverMobile} onChange={set('driverMobile')} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Fare"
        subtitle={`${gstSummary(taxMode, taxRate)} · toll and parking are added after tax.`}
      >
        <div className="grid gap-5 lg:grid-cols-[1.6fr,1fr]">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="GST bill" hint="Only when the customer asks for a GST bill">
              <select className="input" value={form.gstType} onChange={set('gstType')}>
                {GST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="GST rate" hint={gstSummary(taxMode, taxRate)}>
              <select className="input" value={String(taxRate)} disabled={taxMode === 'NONE'} onChange={set('gstRate')}>
                {gstRateOptions(taxRate).map((r) => <option key={r} value={String(r)}>{r}%</option>)}
              </select>
            </Field>
            <div className="hidden sm:block" />
            {money('Base fare', 'baseFare')}
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              {money('Extra KM', 'extraKm')}
              {money('Rate / KM', 'extraKmRate')}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2">
              {money('Extra hours', 'extraHours')}
              {money('Rate / hour', 'extraHourRate')}
            </div>
            {money('Driver allowance', 'driverAllowance')}
            {money('Toll', 'toll')}
            {money('Parking', 'parking')}
            {money('Night charge', 'nightCharge')}
            {money('Other charges', 'otherCharges')}
            {money('Discount', 'discount')}
            {money('Advance received', 'advance')}
          </div>

          <div className="rounded-xl bg-ink-50 p-5 lg:sticky lg:top-24 lg:self-start">
            <h3 className="eyebrow">Invoice total</h3>
            <dl className="mt-4 space-y-2 text-sm">
              {[
                ['Base fare', num(form.charges.baseFare)],
                ['Extra KM', totals.extraKmAmount],
                ['Extra hours', totals.extraHoursAmount],
                ['Driver allowance', num(form.charges.driverAllowance)],
                ['Night charge', num(form.charges.nightCharge)],
                ['Other charges', num(form.charges.otherCharges)],
                ['Discount', -num(form.charges.discount)],
              ].filter(([, v]) => Number(v) !== 0).map(([k, v]) => (
                <div key={String(k)} className="flex justify-between">
                  <dt className="text-ink-600">{k}</dt>
                  <dd className="tabular-nums text-ink-800">{inr(v)}</dd>
                </div>
              ))}

              <div className="flex justify-between border-t border-ink-200 pt-2 font-semibold">
                <dt className="text-ink-700">Taxable value</dt>
                <dd className="tabular-nums text-ink-900">{inr(totals.taxable)}</dd>
              </div>

              {taxMode === 'IGST' && totals.igst > 0 && (
                <div className="flex justify-between">
                  <dt className="text-ink-600">IGST {taxRate}%</dt>
                  <dd className="tabular-nums text-ink-800">{inr(totals.igst)}</dd>
                </div>
              )}
              {taxMode === 'CGST_SGST' && totals.tax > 0 && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">CGST {taxRate / 2}%</dt>
                    <dd className="tabular-nums text-ink-800">{inr(totals.cgst)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-600">SGST {taxRate / 2}%</dt>
                    <dd className="tabular-nums text-ink-800">{inr(totals.sgst)}</dd>
                  </div>
                </>
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
                  <dt className="text-ink-500">Balance due</dt>
                  <dd className="tabular-nums font-semibold text-ink-700">{inr(totals.balance)}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Notes">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Remarks">
            <textarea className="input min-h-[80px] resize-y" value={form.remarks} onChange={set('remarks')} />
          </Field>
          <Field label="Special instructions">
            <textarea className="input min-h-[80px] resize-y"
              value={form.specialInstructions} onChange={set('specialInstructions')} />
          </Field>
        </div>
      </SectionCard>

      <div className="action-bar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="mr-auto">
            <p className="text-2xs uppercase tracking-wide text-ink-500">Invoice total</p>
            <p className="text-lg font-bold tabular-nums text-brand-700">{inr(totals.total)}</p>
          </div>
          <Link to="/admin/bookings" className="btn-outline btn-sm">Cancel</Link>
          <button onClick={() => save(false)} className="btn-outline btn-sm" disabled={saving}>Save only</button>
          <button onClick={() => save(true)} className="btn-primary" disabled={saving}>
            {saving && <Spinner />}
            <IconInvoices className="h-4 w-4" /> Save &amp; generate invoice
          </button>
        </div>
      </div>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste the booking message"
        size="lg"
        subtitle="Works with the vendor formats too — the details are read out and filled in below."
        footer={
          <>
            <button className="btn-outline" onClick={() => setPasteOpen(false)}>Cancel</button>
            <button className="btn-primary" onClick={runParse} disabled={parsing || !message.trim()}>
              {parsing && <Spinner />} Read and fill
            </button>
          </>
        }
      >
        <textarea
          className="input min-h-[200px] resize-y font-mono text-xs"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={'Booking #29435495-1\nFor Parag Bane(+919833998422)\nVehicle group: DZIRE/ETIOS/XCENT\nDuty type: TRANSFER 4H40KMS\nCity: Mumbai\nDate: 31/08 to 31/08\nReporting time: 04:00\nReporting address: 103, Shreeji Krupa CHS, New Panvel\n\nRemarks: Drop At Navi Mumbai Airport\n6E 2128 NMI MAA ETD 07.05 HRS'}
        />
      </Modal>

      <Modal
        open={!!result}
        onClose={() => navigate('/admin/invoices')}
        title="Invoice generated"
        size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => { setResult(null); setForm(EMPTY); }}>
              New booking
            </button>
            <button className="btn-primary" onClick={() => navigate('/admin/invoices')}>Go to invoices</button>
          </>
        }
      >
        {result && (
          <div className="space-y-4">
            <div className="notice-ok">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{result.message}</p>
            </div>
            {result.invoices?.map((inv: any) => (
              <div key={inv.invoiceId} className="flex flex-wrap items-center gap-3 rounded-xl bg-ink-50 p-3.5">
                <div className="mr-auto min-w-0">
                  <p className="font-mono text-sm font-semibold text-brand-700">{inv.invoiceNumber}</p>
                  <p className="text-xs text-ink-500">{inr(inv.total)} · {String(inv.fileType).toUpperCase()}</p>
                </div>
                <Link to={`/admin/invoices/${inv.invoiceId}`} className="btn-outline btn-sm">Preview</Link>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => downloadFile(`/invoices/${inv.invoiceId}/download`)
                    .catch((e) => toast.error('Download failed', errorMessage(e)))}
                >
                  Download
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
