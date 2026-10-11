import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr } from '../lib/format';
import { Field, Loading, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const EMPTY = {
  code: '', vendorName: '', companyName: '', contactPerson: '', mobile: '', altMobile: '', email: '',
  address: '', city: 'Mumbai', state: 'Maharashtra', pincode: '', gstNumber: '', pan: '',
  billingAddress: '', paymentTermsDays: '30', bankName: '', accountNumber: '', ifsc: '', upi: '',
  status: 'ACTIVE', invoiceTemplateId: '', invoicePrefix: 'GTT',
  invoiceNumberFormat: '{PREFIX}/{FY}/{SEQ:5}', documentTitle: 'Tax Invoice',
  taxMode: 'IGST', taxRate: '5', tollParkingTaxable: false, consolidationAllowed: false,
  billingCycle: 'PER_TRIP', bookingMessageFormat: 'AUTO', notes: '',
  aliases: '', companyType: 'CORPORATE',
  /** Extra label words per field, one comma-separated line each. */
  parserLabels: {} as Record<string, string>, noReference: false,
};

/** Fields a company's own label words can be added for. */
const PARSER_FIELDS: [string, string, string][] = [
  ['vendorBookingRef', 'Booking reference', 'e.g. duty no, job id'],
  ['passengerName', 'Passenger name', 'e.g. guest, traveller name'],
  ['vehicleType', 'Vehicle', 'e.g. car required'],
  ['dutyType', 'Duty type', 'e.g. usage, package'],
  ['travelDateRaw', 'Travel date', 'e.g. duty on, journey date'],
  ['reportingTime', 'Reporting time', 'e.g. pick time'],
  ['pickupAddress', 'Pickup address', 'e.g. boarding point'],
  ['dropAddress', 'Drop address', 'e.g. drop point, release at'],
  ['remarks', 'Remarks', 'e.g. special note'],
];
type Form = typeof EMPTY;

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="section p-5">
      <div className="mb-4 border-b border-ink-200 pb-3">
        <h2 className="font-semibold text-ink-900">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export default function VendorForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<Form>(EMPTY);
  const [templates, setTemplates] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await api.get('/templates');
        setTemplates((t.data.data ?? []).filter((x: any) => x.is_active));
        if (isEdit) {
          const { data } = await api.get(`/vendors/${id}`);
          const v = data.data;
          setSummary(data.summary);
          setForm({
            code: v.code, vendorName: v.vendor_name, companyName: v.company_name ?? '',
            contactPerson: v.contact_person ?? '', mobile: v.mobile ?? '', altMobile: v.alt_mobile ?? '',
            email: v.email ?? '', address: v.address ?? '', city: v.city ?? '', state: v.state ?? '',
            pincode: v.pincode ?? '', gstNumber: v.gst_number ?? '', pan: v.pan ?? '',
            billingAddress: v.billing_address ?? '', paymentTermsDays: String(v.payment_terms_days ?? 30),
            bankName: v.bank_name ?? '', accountNumber: v.account_number ?? '', ifsc: v.ifsc ?? '',
            upi: v.upi ?? '', status: v.status,
            invoiceTemplateId: v.invoice_template_id ? String(v.invoice_template_id) : '',
            invoicePrefix: v.invoice_prefix ?? 'GTT',
            invoiceNumberFormat: v.invoice_number_format ?? '{PREFIX}/{FY}/{SEQ:5}',
            documentTitle: v.document_title ?? 'Tax Invoice',
            taxMode: v.tax_mode, taxRate: String(v.tax_rate),
            tollParkingTaxable: !!v.toll_parking_taxable,
            consolidationAllowed: !!v.consolidation_allowed,
            billingCycle: v.billing_cycle, bookingMessageFormat: v.booking_message_format ?? 'AUTO',
            notes: v.notes ?? '',
            aliases: v.aliases ?? '', companyType: v.company_type ?? 'CORPORATE',
            ...(() => {
              try {
                const c = v.parser_config ? JSON.parse(v.parser_config) : {};
                const labels: Record<string, string> = {};
                for (const [k, list] of Object.entries(c.labels ?? {})) labels[k] = Array.isArray(list) ? (list as string[]).join(', ') : String(list);
                return { parserLabels: labels, noReference: !!c.noReference };
              } catch { return { parserLabels: {}, noReference: false }; }
            })(),
          });
        }
      } catch (err) {
        toast.error('Could not load the vendor', errorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (k: keyof Form) => (e: any) => {
    const v = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((p) => ({ ...p, [k]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.code.trim().length < 2) e.code = 'Vendor code needs at least 2 characters.';
    if (form.vendorName.trim().length < 2) e.vendorName = 'Vendor name is required.';
    if (form.gstNumber && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(form.gstNumber.toUpperCase())) {
      e.gstNumber = 'GSTIN must be 15 characters, e.g. 27AAACS0764L1Z6.';
    }
    if (form.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(form.pan.toUpperCase())) e.pan = 'PAN must look like ABCDE1234F.';
    if (form.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.toUpperCase())) e.ifsc = 'IFSC must look like SBIN0001266.';
    if (form.mobile && !/^[6-9]\d{9}$/.test(form.mobile.replace(/\D/g, '').replace(/^91/, ''))) {
      e.mobile = 'Enter a valid 10-digit mobile number.';
    }
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address.';
    setErrors(e);
    if (Object.keys(e).length) toast.error('Some fields need attention', Object.values(e).join('\n'));
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const labels: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(form.parserLabels)) {
        const list = v.split(',').map((x) => x.trim()).filter(Boolean);
        if (list.length) labels[k] = list;
      }
      const { parserLabels: _pl, noReference: _nr, ...rest } = form;
      const payload = {
        ...rest,
        parserConfig: Object.keys(labels).length || form.noReference ? { labels, noReference: form.noReference } : null,
        paymentTermsDays: Number(form.paymentTermsDays) || 0,
        taxRate: Number(form.taxRate) || 0,
        invoiceTemplateId: form.invoiceTemplateId ? Number(form.invoiceTemplateId) : null,
      };
      if (isEdit) await api.put(`/vendors/${id}`, payload);
      else await api.post('/vendors', payload);
      toast.success(isEdit ? `${form.vendorName} updated` : `${form.vendorName} added`);
      navigate('/admin/vendors');
    } catch (err) {
      toast.error('Could not save the company', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading label="Loading vendor…" />;

  const previewNumber = form.invoiceNumberFormat
    .replace('{PREFIX}', form.invoicePrefix || 'GTT')
    .replace('{FY}', '2026-27')
    .replace('{FYSHORT}', '2627')
    .replace('{VENDOR}', form.code || 'CODE')
    .replace('{YYYY}', '2026')
    .replace('{YY}', '26')
    .replace('{MM}', '08')
    .replace(/\{SEQ:(\d+)\}/, (_m, n) => '1'.padStart(Number(n), '0'))
    .replace('{SEQ}', '1');

  return (
    <div className="page mx-auto max-w-5xl pb-24">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">{isEdit ? 'Edit company' : 'Add company'}</h1>
          <p className="page-sub">
            A company (corporate client or travel partner) — how its bookings are read, priced and invoiced.
          </p>
        </div>
        <Link to="/admin/vendors" className="btn-outline btn-sm">Cancel</Link>
      </div>

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['Bookings', summary.total_bookings],
            ['Unbilled', summary.unbilled_bookings],
            ['Total billing', inr(summary.total_billing)],
            ['Invoiced', inr(summary.total_invoiced)],
            ['Paid', inr(summary.total_paid)],
            ['Outstanding', inr(summary.outstanding)],
          ].map(([k, v]) => (
            <div key={String(k)} className="card p-3.5">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ink-500">{k}</p>
              <p className="mt-0.5 text-base font-bold tabular-nums text-ink-900">{v as any}</p>
            </div>
          ))}
        </div>
      )}

      <Card title="Company identity">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Company code" required error={errors.code}
            hint="Short code used in invoice numbers and folder names">
            <input className={`input uppercase ${errors.code ? 'input-error' : ''}`}
              value={form.code} onChange={set('code')} placeholder="WAGON" />
          </Field>
          <Field label="Company name" required error={errors.vendorName}>
            <input className={`input ${errors.vendorName ? 'input-error' : ''}`}
              value={form.vendorName} onChange={set('vendorName')} />
          </Field>
          <Field label="Legal name (as it appears on the invoice)">
            <input className="input" value={form.companyName} onChange={set('companyName')} />
          </Field>
          <Field label="Contact person">
            <input className="input" value={form.contactPerson} onChange={set('contactPerson')} />
          </Field>
          <Field label="Mobile" error={errors.mobile}>
            <input className={`input ${errors.mobile ? 'input-error' : ''}`}
              value={form.mobile} onChange={set('mobile')} inputMode="numeric" />
          </Field>
          <Field label="Alternate mobile">
            <input className="input" value={form.altMobile} onChange={set('altMobile')} inputMode="numeric" />
          </Field>
          <Field label="Email" error={errors.email} className="lg:col-span-2">
            <input className={`input ${errors.email ? 'input-error' : ''}`}
              type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={form.companyType} onChange={set('companyType')}>
              <option value="CORPORATE">Corporate client</option>
              <option value="TRAVEL_AGENT">Travel partner / agent</option>
            </select>
          </Field>
          <Field label="Other names (aliases)" className="lg:col-span-2"
            hint="Comma-separated — how the company signs its messages, e.g. Shreedestinations, Shree Destinations">
            <input className="input" value={form.aliases} onChange={set('aliases')} />
          </Field>
        </div>
      </Card>

      <ParserRules form={form} setForm={setForm} vendorId={isEdit ? Number(id) : null} />

      <Card title="Address & statutory details">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Address" className="lg:col-span-3">
            <textarea className="input min-h-[70px] resize-y" value={form.address} onChange={set('address')} />
          </Field>
          <Field label="City"><input className="input" value={form.city} onChange={set('city')} /></Field>
          <Field label="State"><input className="input" value={form.state} onChange={set('state')} /></Field>
          <Field label="Pincode"><input className="input" value={form.pincode} onChange={set('pincode')} inputMode="numeric" /></Field>
          <Field label="GST number" error={errors.gstNumber}>
            <input className={`input uppercase font-mono ${errors.gstNumber ? 'input-error' : ''}`}
              value={form.gstNumber} onChange={set('gstNumber')} placeholder="27AAACS0764L1Z6" />
          </Field>
          <Field label="PAN" error={errors.pan}>
            <input className={`input uppercase font-mono ${errors.pan ? 'input-error' : ''}`}
              value={form.pan} onChange={set('pan')} placeholder="ABCDE1234F" />
          </Field>
          <Field label="Payment terms (days)">
            <input className="input" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} inputMode="numeric" />
          </Field>
          <Field label="Billing address (used on the invoice)" className="lg:col-span-3"
            hint="Leave blank to reuse the address above">
            <textarea className="input min-h-[70px] resize-y" value={form.billingAddress} onChange={set('billingAddress')} />
          </Field>
        </div>
      </Card>

      <Card title="Invoice configuration"
        sub="This is what makes each vendor's invoice come out in their own format.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Invoice template" className="lg:col-span-2"
            hint={form.invoiceTemplateId ? undefined : 'Without a template the portal\'s standard PDF layout is used'}>
            <select className="input" value={form.invoiceTemplateId} onChange={set('invoiceTemplateId')}>
              <option value="">No template — use the standard PDF</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.file_type}{t.mode === 'consolidated' ? ', consolidated' : ', single'})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Document title" hint="Some vendors want 'Credit Note'">
            <input className="input" value={form.documentTitle} onChange={set('documentTitle')} />
          </Field>

          <Field label="Invoice prefix">
            <input className="input uppercase" value={form.invoicePrefix} onChange={set('invoicePrefix')} />
          </Field>
          <Field label="Invoice number format" className="lg:col-span-2"
            hint="Tokens: {PREFIX} {FY} {FYSHORT} {YYYY} {YY} {MM} {VENDOR} {SEQ:5}">
            <input className="input font-mono text-xs" value={form.invoiceNumberFormat} onChange={set('invoiceNumberFormat')} />
          </Field>

          <div className="rounded-lg bg-ink-50 px-4 py-3 lg:col-span-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-500">Next invoice will look like</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-brand-700">{previewNumber}</p>
          </div>

          <Field label="Tax mode">
            <select className="input" value={form.taxMode} onChange={set('taxMode')}>
              <option value="IGST">IGST (inter-state)</option>
              <option value="CGST_SGST">CGST + SGST (intra-state)</option>
              <option value="NONE">No tax</option>
            </select>
          </Field>
          <Field label="Tax rate %">
            <input className="input text-right tabular-nums" value={form.taxRate} onChange={set('taxRate')} inputMode="decimal" />
          </Field>
          <Field label="Billing cycle">
            <select className="input" value={form.billingCycle} onChange={set('billingCycle')}>
              <option value="PER_TRIP">Per trip</option>
              <option value="FORTNIGHTLY">Fortnightly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </Field>

          <Field label="Booking message format" className="lg:col-span-3"
            hint="Helps the paste-parser recognise which company sent a message">
            <select className="input" value={form.bookingMessageFormat} onChange={set('bookingMessageFormat')}>
              <option value="AUTO">Auto-detect</option>
              <option value="BOOKING_HASH">“Booking #” format</option>
              <option value="TRIPID_HASH">“TripId #” format</option>
              <option value="NONE">Not applicable</option>
            </select>
          </Field>

          <label className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 lg:col-span-3 ${
            form.tollParkingTaxable ? 'border-brand-300 bg-brand-50' : 'border-ink-200'}`}>
            <input type="checkbox" className="check mt-0.5"
              checked={form.tollParkingTaxable} onChange={set('tollParkingTaxable')} />
            <span className="text-sm">
              <span className="font-semibold text-ink-900">Toll &amp; parking is part of the taxable value</span>
              <span className="mt-0.5 block text-xs text-ink-600">
                Leave this off for the common case, where toll and parking are reimbursements added <strong>after</strong> tax —
                this is how the existing Wagon invoice works.
              </span>
            </span>
          </label>

          <label className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 lg:col-span-3 ${
            form.consolidationAllowed ? 'border-brand-300 bg-brand-50' : 'border-ink-200'}`}>
            <input type="checkbox" className="check mt-0.5"
              checked={form.consolidationAllowed} onChange={set('consolidationAllowed')} />
            <span className="text-sm">
              <span className="font-semibold text-ink-900">Consolidation allowed</span>
              <span className="mt-0.5 block text-xs text-ink-600">
                Allows many bookings on a single invoice. The assigned template must also support multiple line items.
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card title="Bank details" sub="Optional — used when a vendor requires their own account details on file.">
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Bank name"><input className="input" value={form.bankName} onChange={set('bankName')} /></Field>
          <Field label="Account number"><input className="input font-mono" value={form.accountNumber} onChange={set('accountNumber')} /></Field>
          <Field label="IFSC" error={errors.ifsc}>
            <input className={`input uppercase font-mono ${errors.ifsc ? 'input-error' : ''}`}
              value={form.ifsc} onChange={set('ifsc')} placeholder="SBIN0001266" />
          </Field>
          <Field label="UPI ID"><input className="input" value={form.upi} onChange={set('upi')} /></Field>
          <Field label="Notes" className="lg:col-span-4">
            <textarea className="input min-h-[70px] resize-y" value={form.notes} onChange={set('notes')} />
          </Field>
        </div>
      </Card>

      <div className="action-bar">
        <div className="mx-auto flex max-w-5xl justify-end gap-2 px-4 py-3 sm:px-6">
          <Link to="/admin/vendors" className="btn-outline btn-sm">Cancel</Link>
          <button onClick={save} className="btn-primary" disabled={saving}>
            {saving && <Spinner className="h-4 w-4" />}
            {isEdit ? 'Save changes' : 'Add company'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The company's own words for booking-message fields. They are added to the
 * built-in labels (never replacing them), so a new message format is set up
 * here rather than in code. A sample can be tried before saving.
 */
function ParserRules({ form, setForm, vendorId }: { form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; vendorId: number | null }) {
  const [sample, setSample] = useState('');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const setLabel = (k: string) => (e: any) => setForm((f) => ({ ...f, parserLabels: { ...f.parserLabels, [k]: e.target.value } }));

  const test = async () => {
    setBusy(true); setErr('');
    const labels: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(form.parserLabels)) {
      const list = v.split(',').map((x) => x.trim()).filter(Boolean);
      if (list.length) labels[k] = list;
    }
    try {
      const url = vendorId ? `/vendors/${vendorId}/parser-test` : '/bookings/parse-message';
      const { data } = await api.post(url, { message: sample, parserConfig: { labels, noReference: form.noReference } });
      setResult(data);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Card title="Booking message rules" sub="Built-in labels already cover the common formats (Booking #, For, Vehicle group, Reporting address, Drop address…). Add this company's own words only if its messages use different ones.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PARSER_FIELDS.map(([k, label, ph]) => (
          <Field key={k} label={label}>
            <input className="input" value={form.parserLabels[k] ?? ''} onChange={setLabel(k)} placeholder={ph} />
          </Field>
        ))}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 text-sm lg:col-span-3">
          <input type="checkbox" className="check mt-0.5" checked={form.noReference}
            onChange={(e) => setForm((f) => ({ ...f, noReference: e.target.checked }))} />
          <span>
            <span className="font-semibold text-ink-900">This company never sends a booking reference</span>
            <span className="block text-xs text-ink-600">Its messages are then not flagged as missing a reference. Duplicate checks fall back to passenger, date and pickup.</span>
          </span>
        </label>
      </div>
      <div className="mt-4 space-y-2">
        <Field label="Try a sample message">
          <textarea className="input min-h-[110px] font-mono text-xs" value={sample} onChange={(e) => { setSample(e.target.value); setResult(null); }} />
        </Field>
        <button className="btn-outline btn-sm" onClick={test} disabled={busy || !sample.trim()}>{busy && <Spinner className="h-4 w-4" />} Read it with these rules</button>
        {err && <p className="text-sm text-danger-600">{err}</p>}
        {result && (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Field</th><th>Value</th><th>Status</th></tr></thead>
              <tbody>
                {Object.entries(result.fieldStatus ?? {}).map(([k, st]) => (
                  <tr key={k}>
                    <td className="text-xs font-semibold text-ink-600">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</td>
                    <td className="text-sm">{result.fields?.[k] !== undefined ? String(result.fields[k]) : '—'}</td>
                    <td><span className={st === 'ok' ? 'badge-ok' : st === 'missing' ? 'badge-warn' : st === 'confirm' ? 'badge-violet' : 'badge-neutral'}>
                      {st === 'ok' ? 'Found' : st === 'missing' ? 'Missing' : st === 'confirm' ? 'Check' : 'Not applicable'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.unmatchedLines?.length > 0 && <p className="p-3 text-xs text-warn-700">Not recognised: {result.unmatchedLines.join(' | ')}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}
