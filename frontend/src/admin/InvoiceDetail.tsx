import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, dmy, dmyTime } from '../lib/format';
import { Loading, ErrorState, StatusBadge, Modal, Spinner, Field, ConfirmDialog } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';
import { IconPrint, IconDownload, IconMail, IconRefresh, IconRupee, IconWarning } from '../components/icons';

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();

  const [data, setData] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: '', paymentDate: new Date().toISOString().slice(0, 10),
    mode: 'BANK_TRANSFER', referenceNo: '', bank: '', notes: '',
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [modes, setModes] = useState<{ code: string; label: string }[]>([]);
  const [dupWarning, setDupWarning] = useState('');
  const [toReverse, setToReverse] = useState<any>(null);
  const [reverseReason, setReverseReason] = useState('');

  useEffect(() => {
    api.get('/masters/lists/PAYMENT_MODE/options').then((r) => setModes(r.data.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [d, p] = await Promise.all([
        api.get(`/invoices/${id}`),
        api.get(`/invoices/${id}/preview`),
      ]);
      setData(d.data);
      setPreview(p.data.data);
      setPayForm((f) => ({ ...f, amount: String(d.data.data.outstanding_amount ?? '') }));
      // Whoever the invoice is addressed to is who it should be emailed to.
      setSendTo(
        d.data.data.sent_to
        ?? d.data.items?.[0]?.customer_email
        ?? d.data.items?.[0]?.passenger_email
        ?? ''
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data || !preview) return <Loading label="Loading invoice…" />;

  const inv = data.data;
  const { company, vendor, billing, bookings } = preview;

  const addPayment = async (allowDuplicate = false) => {
    setBusy(true);
    try {
      const { data: res } = await api.post('/payments', {
        invoiceId: Number(id),
        amount: Number(payForm.amount),
        paymentDate: payForm.paymentDate,
        mode: payForm.mode,
        referenceNo: payForm.referenceNo,
        bank: payForm.bank,
        notes: payForm.notes,
        allowDuplicate,
      });
      toast.success('Payment recorded', res.message);
      setPayOpen(false);
      setDupWarning('');
      load();
    } catch (err: any) {
      if (err?.response?.data?.code === 'POSSIBLE_DUPLICATE') setDupWarning(err.response.data.error);
      else toast.error('Could not record the payment', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const reversePayment = async () => {
    if (!toReverse) return;
    setBusy(true);
    try {
      const { data: res } = await api.post(`/payments/${toReverse.id}/reverse`, { reason: reverseReason });
      toast.success('Payment reversed', res.message);
      setToReverse(null);
      setReverseReason('');
      load();
    } catch (err) {
      toast.error('Could not reverse the payment', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post(`/invoices/${id}/regenerate`, { reason: 'Regenerated from invoice screen' });
      toast.success('Invoice regenerated', res.message);
      setRegenOpen(false);
      load();
    } catch (err) {
      toast.error('Could not regenerate', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelReason.trim()) { toast.error('Enter a reason for cancelling.'); return; }
    setBusy(true);
    try {
      const { data: res } = await api.post(`/invoices/${id}/cancel`, { reason: cancelReason });
      toast.success('Invoice cancelled', res.message);
      setCancelOpen(false);
      load();
    } catch (err) {
      toast.error('Could not cancel', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Email the invoice to the customer, from the business mailbox.
   *
   * The PDF is attached by the API — the browser never has to hold the file,
   * and the customer gets exactly the document the office generated.
   */
  const sendInvoice = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.post(`/invoices/${id}/send`, { to: sendTo, message: sendNote });
      toast.success('Invoice emailed', res.message);
      setSendOpen(false);
      setSendNote('');
      load();
    } catch (err) {
      toast.error('The invoice did not go out', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const row = (label: string, value: any, bold = false) => (
    <div className={`flex justify-between gap-4 py-1 ${bold ? 'border-t border-ink-300 pt-2 text-base font-bold' : 'text-sm'}`}>
      <span className={bold ? 'text-ink-900' : 'text-ink-600'}>{label}</span>
      <span className={`tabular-nums ${bold ? 'text-brand-700' : 'text-ink-800'}`}>{inr(value)}</span>
    </div>
  );

  return (
    <div className="page mx-auto max-w-5xl">
      {/* toolbar */}
      <div className="flex flex-wrap items-start justify-between gap-4 no-print">
        <div>
          <Link to="/admin/invoices" className="text-xs text-ink-500 hover:text-brand-600">← Back to invoices</Link>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold text-ink-900">
            <span className="font-mono">{inv.invoice_number}</span>
            <StatusBadge value={inv.display_status ?? inv.status} />
            {inv.revision > 1 && <span className="badge-neutral">Revision {inv.revision}</span>}
          </h1>
          <p className="page-sub">
            {inv.vendor_name} · {dmy(inv.invoice_date)} · {inv.booking_count} booking{inv.booking_count === 1 ? '' : 's'}
            {inv.template_name ? ` · ${inv.template_name}` : ' · standard PDF layout'}
          </p>
          {inv.sent_at && (
            <p className="mt-1 text-xs text-ok-600">
              Emailed to {inv.sent_to} on {dmyTime(inv.sent_at)}
            </p>
          )}
        </div>
        <div className="page-actions">
          <button onClick={() => window.print()} className="btn-outline btn-sm"><IconPrint className="h-3.5 w-3.5" /> Print</button>
          {inv.file_path && (
            <button
              onClick={() => downloadFile(`/invoices/${inv.id}/download`).catch((e) => toast.error('Download failed', errorMessage(e)))}
              className="btn-primary btn-sm"
            >
              <IconDownload className="h-3.5 w-3.5" /> Download {String(inv.file_type ?? '').toUpperCase()}
            </button>
          )}
          {can('invoices.update') && inv.status !== 'CANCELLED' && (
            <>
              <button onClick={() => setSendOpen(true)} className="btn-outline btn-sm">
                <IconMail className="h-3.5 w-3.5" /> {inv.sent_at ? 'Email again' : 'Email to customer'}
              </button>
              <button onClick={() => setRegenOpen(true)} className="btn-outline btn-sm"><IconRefresh className="h-3.5 w-3.5" /> Regenerate</button>
              <button onClick={() => setCancelOpen(true)} className="btn-outline btn-sm text-danger-600">Cancel invoice</button>
            </>
          )}
          {can('payments.create') && inv.status !== 'CANCELLED' && Number(inv.outstanding_amount) > 0 && (
            <button onClick={() => { setDupWarning(''); setPayOpen(true); }} className="btn-dark btn-sm"><IconRupee className="h-3.5 w-3.5" /> Record payment</button>
          )}
        </div>
      </div>

      {inv.display_status === 'OVERDUE' && (
        <div className="notice-danger no-print">
          <IconWarning className="h-4 w-4 shrink-0" />
          <span><strong>Overdue.</strong> {inr(inv.outstanding_amount)} was due on {dmy(inv.due_date)}.</span>
        </div>
      )}

      {inv.status === 'CANCELLED' && (
        <div className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-600 no-print">
          <strong>This invoice is cancelled.</strong> {inv.cancelled_reason}
        </div>
      )}

      {/* the document preview */}
      <div className="card print-sheet overflow-hidden">
        <div className="border-b-2 border-brand-500 bg-white px-6 py-5 sm:px-8">
          <div className="flex flex-wrap items-start gap-4">
            <img src="/assets/art-car-line-bold.svg" alt="" className="h-auto w-28 shrink-0" />
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-bold text-ink-900">{company.legalName ?? company.name}</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-600">{company.addressInvoice}</p>
              <p className="text-xs text-ink-600">{company.addressInvoice2}</p>
              <p className="mt-1 text-xs text-ink-600">
                Contact: {company.mobile}{company.altMobile2 ? ` / ${company.altMobile2}` : ''}
              </p>
              <p className="text-xs font-semibold text-ink-800">GSTIN — {company.gstin}</p>
            </div>
          </div>
        </div>

        <div className="bg-ink-900 px-6 py-2.5 text-center sm:px-8">
          <p className="font-display text-sm font-bold uppercase tracking-[0.2em] text-white">
            {vendor.documentTitle ?? 'Tax Invoice'}
          </p>
        </div>

        <div className="grid gap-6 border-b border-ink-100 px-6 py-5 sm:grid-cols-2 sm:px-8">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">Billing details</p>
            <p className="font-semibold text-ink-900">{vendor.companyName}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{vendor.billingAddress}</p>
            {vendor.gstNumber && <p className="mt-1.5 text-sm text-ink-700">GSTIN: <span className="font-mono">{vendor.gstNumber}</span></p>}
          </div>
          <dl className="space-y-1.5 text-sm sm:text-right">
            <div className="flex justify-between sm:justify-end sm:gap-4">
              <dt className="text-ink-500">Invoice No.</dt>
              <dd className="font-mono font-semibold text-ink-900 sm:w-44 sm:text-right">{inv.invoice_number}</dd>
            </div>
            <div className="flex justify-between sm:justify-end sm:gap-4">
              <dt className="text-ink-500">Date</dt>
              <dd className="text-ink-800 sm:w-44 sm:text-right">{dmy(inv.invoice_date)}</dd>
            </div>
            <div className="flex justify-between sm:justify-end sm:gap-4">
              <dt className="text-ink-500">Due date</dt>
              <dd className="text-ink-800 sm:w-44 sm:text-right">{dmy(inv.due_date)}</dd>
            </div>
            {bookings[0]?.vehicleNumber && (
              <div className="flex justify-between sm:justify-end sm:gap-4">
                <dt className="text-ink-500">Vehicle No.</dt>
                <dd className="font-mono text-ink-800 sm:w-44 sm:text-right">{bookings[0].vehicleNumber}</dd>
              </div>
            )}
            {bookings[0]?.vehicleType && (
              <div className="flex justify-between sm:justify-end sm:gap-4">
                <dt className="text-ink-500">Vehicle type</dt>
                <dd className="text-ink-800 sm:w-44 sm:text-right">{bookings[0].vehicleType}</dd>
              </div>
            )}
            {inv.booking_count === 1 && bookings[0]?.passengerName && (
              <div className="flex justify-between sm:justify-end sm:gap-4">
                <dt className="text-ink-500">Guest name</dt>
                <dd className="text-ink-800 sm:w-44 sm:text-right">{bookings[0].passengerName}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="overflow-x-auto px-6 py-5 sm:px-8">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-12">Sr.</th><th>Particular</th><th>Date</th><th>Passenger</th>
                <th className="text-right">KM/HRS</th><th className="text-right">Rate</th><th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b: any, i: number) => (
                <tr key={i}>
                  <td className="text-ink-600">{i + 1}</td>
                  <td>
                    <p className="text-sm text-ink-900">{b.particular || b.dutyType || 'Trip charges'}</p>
                    <p className="text-[11px] text-ink-500">{b.bookingCode}</p>
                  </td>
                  <td className="whitespace-nowrap text-sm text-ink-600">{dmy(b.travelDate)}</td>
                  <td className="max-w-[10rem] truncate text-sm text-ink-700">{b.passengerName}</td>
                  <td className="text-right tabular-nums text-ink-600">{b.qty ?? '—'}</td>
                  <td className="text-right tabular-nums text-ink-600">{b.rate ? inr(b.rate) : '—'}</td>
                  <td className="text-right font-semibold tabular-nums text-ink-900">{inr(b.billing?.taxableAmount ?? b.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 flex justify-end">
            <div className="w-full max-w-xs">
              {row('Taxable value', billing.taxableAmount)}
              {billing.taxMode === 'IGST' && billing.taxAmount > 0 && row(`IGST ${billing.taxRate}%`, billing.igst)}
              {billing.taxMode === 'CGST_SGST' && billing.taxAmount > 0 && (
                <>
                  {row(`CGST ${billing.taxRate / 2}%`, billing.cgst)}
                  {row(`SGST ${billing.taxRate / 2}%`, billing.sgst)}
                </>
              )}
              {row('Invoice value', billing.invoiceValue ?? billing.taxableAmount + billing.taxAmount)}
              {billing.nonTaxableAmount > 0 && row('Toll & parking charges', billing.nonTaxableAmount)}
              {row('Total', billing.totalAmount, true)}
              {Number(inv.paid_amount) > 0 && row('Amount received', inv.paid_amount)}
              {Number(inv.paid_amount) > 0 && row('Balance due', inv.outstanding_amount)}
            </div>
          </div>

          {preview.invoice?.amountInWords && (
            <p className="mt-4 text-sm italic text-ink-600">{preview.invoice.amountInWords}</p>
          )}
        </div>

        <div className="grid gap-6 border-t border-ink-100 bg-ink-50/60 px-6 py-5 sm:grid-cols-2 sm:px-8">
          <div className="text-xs leading-relaxed text-ink-700">
            <p className="mb-1.5 font-bold uppercase tracking-wide text-ink-500">Bank details</p>
            <p>PAN No. : <span className="font-mono">{company.pan}</span></p>
            <p>A/C No. : <span className="font-mono">{company.bankAccount}</span></p>
            <p>IFSC Code : <span className="font-mono">{company.bankIfsc}</span></p>
            <p>Bank Name : {company.bankName}</p>
            <p>Contact : {company.mobile}</p>
          </div>
          <div className="flex flex-col items-end justify-end">
            <p className="font-semibold text-ink-900">{company.owner}</p>
            <div className="my-1 h-px w-44 bg-ink-400" />
            <p className="text-xs text-ink-600">Authorised Signatory</p>
          </div>
        </div>
      </div>

      {/* payments + revisions */}
      <div className="grid gap-5 lg:grid-cols-2 no-print">
        <div className="card">
          <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3.5">
            <h3 className="font-semibold text-ink-900">Payments</h3>
            <span className="text-sm">
              <span className="text-ok-600">{inr(inv.paid_amount)}</span>
              <span className="text-ink-400"> of </span>
              <span className="font-semibold text-ink-800">{inr(inv.total_amount)}</span>
            </span>
          </div>
          {data.payments.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">No payment received yet.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {data.payments.map((p: any) => (
                <div key={p.id} className={`flex items-center gap-3 px-5 py-3 ${p.is_reversed ? 'bg-danger-50/40' : ''}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${p.is_reversed ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{inr(p.amount)}</p>
                    <p className="text-xs text-ink-500">
                      {dmy(p.payment_date)} · {p.mode.replace('_', ' ')}
                      {p.reference_no ? ` · ${p.reference_no}` : ''}
                      {p.created_by_name ? ` · by ${p.created_by_name}` : ''}
                    </p>
                    {p.is_reversed ? (
                      <p className="text-xs text-danger-600">Reversed {dmyTime(p.reversed_at)}{p.reversed_by_name ? ` by ${p.reversed_by_name}` : ''} — {p.reversal_reason}</p>
                    ) : null}
                  </div>
                  {!p.is_reversed && can('payments.delete', 'payments.update') && (
                    <button className="btn-ghost btn-sm text-danger-600" onClick={() => setToReverse(p)}>Reverse</button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-ink-100 px-5 py-3">
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-ink-700">Outstanding</span>
              <span className={Number(inv.outstanding_amount) > 0 ? 'text-danger-600' : 'text-ok-600'}>
                {inr(inv.outstanding_amount)}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="border-b border-ink-200 px-5 py-3.5">
            <h3 className="font-semibold text-ink-900">Revision history</h3>
          </div>
          <div className="divide-y divide-ink-100">
            {data.revisions.map((r: any) => (
              <div key={r.id} className="px-5 py-3">
                <p className="text-sm font-medium text-ink-900">
                  Revision {r.revision} · {inr(r.total_amount)}
                </p>
                <p className="text-xs text-ink-500">{r.reason}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">{dmyTime(r.created_at)}</p>
                {r.file_path && <p className="mt-1 truncate font-mono text-[10px] text-ink-400">{r.file_path}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---- payment modal ---- */}
      <Modal
        open={payOpen} onClose={() => setPayOpen(false)} title="Record a payment" size="sm"
        subtitle={`${inv.invoice_number} · ${inr(inv.outstanding_amount)} outstanding`}
        footer={
          <>
            <button className="btn-outline" onClick={() => setPayOpen(false)} disabled={busy}>Cancel</button>
            {dupWarning ? (
              <button className="btn-primary" onClick={() => addPayment(true)} disabled={busy}>
                {busy && <Spinner className="h-4 w-4" />} It is a separate payment — record it
              </button>
            ) : (
              <button className="btn-primary" onClick={() => addPayment(false)} disabled={busy || !payForm.amount}>
                {busy && <Spinner className="h-4 w-4" />} Record payment
              </button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Amount received" required
            hint={`Maximum ${inr(inv.outstanding_amount)} — partial payments are allowed`}>
            <input className="input text-right tabular-nums" inputMode="decimal"
              value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} />
          </Field>
          <div className="stagger grid gap-4 sm:grid-cols-2">
            <Field label="Payment date" required>
              <DateField value={payForm.paymentDate}
                onChange={(v) => setPayForm((f) => ({ ...f, paymentDate: v }))} />
            </Field>
            <Field label="Mode">
              <select className="input" value={payForm.mode}
                onChange={(e) => setPayForm((f) => ({ ...f, mode: e.target.value }))}>
                {(modes.length ? modes : ['BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CASH', 'OTHER'].map((c) => ({ code: c, label: c.replace('_', ' ') }))).map((m) =>
                  <option key={m.code} value={m.code}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="stagger grid gap-4 sm:grid-cols-2">
            <Field label="Reference number">
              <input className="input" value={payForm.referenceNo}
                onChange={(e) => setPayForm((f) => ({ ...f, referenceNo: e.target.value }))} />
            </Field>
            <Field label="Bank">
              <input className="input" value={payForm.bank}
                onChange={(e) => setPayForm((f) => ({ ...f, bank: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <input className="input" value={payForm.notes}
              onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          {dupWarning && <p className="notice-warn text-sm"><IconWarning className="h-4 w-4 shrink-0" /> {dupWarning}</p>}
        </div>
      </Modal>

      <Modal
        open={!!toReverse} onClose={() => setToReverse(null)} size="sm"
        title="Reverse this payment?"
        subtitle={toReverse ? `${inr(toReverse.amount)} on ${dmy(toReverse.payment_date)}` : ''}
        footer={
          <>
            <button className="btn-outline" onClick={() => setToReverse(null)} disabled={busy}>Keep it</button>
            <button className="btn-danger" onClick={reversePayment} disabled={busy || reverseReason.trim().length < 3}>
              {busy && <Spinner />} Reverse payment
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-700">The payment stays on record, marked reversed, and the outstanding amount goes back up.</p>
        <Field label="Why" required className="mt-3">
          <input className="input" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g. Cheque bounced / entered twice" autoFocus />
        </Field>
      </Modal>

      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title="Email this invoice to the customer"
        subtitle="The PDF is attached. It is sent from the business mailbox set under Settings → Email."
        size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setSendOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={sendInvoice} disabled={busy || !sendTo}>
              {busy && <Spinner />} Send invoice
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field
            label="To"
            required
            hint={sendTo ? undefined : 'No email address is recorded on this invoice — type one, or add it to the customer first.'}
          >
            <input
              className="input" type="email" value={sendTo}
              onChange={(e) => setSendTo(e.target.value)} placeholder="customer@example.com"
            />
          </Field>
          <Field label="A line to add to the email" hint="Optional">
            <textarea
              className="input h-auto py-2" rows={2} value={sendNote}
              onChange={(e) => setSendNote(e.target.value)}
              placeholder="e.g. Payment is due within seven days. Bank details are on the invoice."
            />
          </Field>
          <p className="text-xs leading-relaxed text-ink-500">
            The customer can also see and download this invoice in their own account, under its Trip ID.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={regenOpen} onClose={() => setRegenOpen(false)} onConfirm={regenerate} busy={busy}
        title="Regenerate this invoice?" confirmLabel="Regenerate"
        body={
          <>
            <p>The invoice file is rebuilt from the current booking data and saved as revision {inv.revision + 1}.</p>
            <p className="mt-2 text-ink-500">
              The invoice number stays the same and the previous version is kept in history under
              <span className="font-mono"> data/invoices/…/revised</span>.
            </p>
          </>
        }
      />

      <Modal
        open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this invoice?" size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setCancelOpen(false)} disabled={busy}>Keep invoice</button>
            <button className="btn-danger" onClick={cancel} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} Cancel invoice
            </button>
          </>
        }
      >
        <p className="text-sm text-ink-700">
          {inv.invoice_number} will be marked cancelled. Its {inv.booking_count} booking
          {inv.booking_count === 1 ? '' : 's'} will return to the billing queue so they can be invoiced again.
        </p>
        <Field label="Reason for cancelling" required className="mt-4">
          <textarea className="input min-h-[80px] resize-y" value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)} placeholder="e.g. Wrong rate applied — reissuing" />
        </Field>
      </Modal>
    </div>
  );
}
