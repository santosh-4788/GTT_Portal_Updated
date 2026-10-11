/**
 * The money end of a trip, as used by the trip drawer:
 *
 *   CompleteModal  — record what actually happened (end time, km, hours, extras)
 *   BillingPanel   — confirm the final charges for billing, or withdraw that
 *   PaymentsPanel  — what has been received against the trip's invoice
 *
 * Workflow: Trip completed → Billing confirmed → Invoice generated →
 * Payment tracked → Invoice settled. Every step is a server call; nothing here
 * works out money on its own beyond showing a running total while typing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime, humanise, inr } from '../lib/format';
import { Field, Modal, Spinner, StatusBadge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { IconCheck, IconWarning } from '../components/icons';

const n = (v: any) => {
  const x = parseFloat(String(v ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(x) ? x : 0;
};
const blank = (v: any) => (v === null || v === undefined || Number(v) === 0 ? '' : String(v));

function Box({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-200 bg-white p-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 text-sm ${strong ? 'border-t border-ink-200 pt-2 font-bold text-ink-900' : 'text-ink-700'}`}>
      <span className={strong ? '' : 'text-ink-500'}>{label}</span>
      <span className="text-right tabular-nums">{value ?? '—'}</span>
    </div>
  );
}

/* ==========================================================================
   Complete the trip
   ========================================================================== */

export function CompleteModal({ open, trip, onClose, onDone }: { open: boolean; trip: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const init = () => ({
    completedAt: trip.completed_at ? String(trip.completed_at).replace(' ', 'T').slice(0, 16) : nowLocal(),
    startKm: blank(trip.start_km), endKm: blank(trip.end_km), actualKm: blank(trip.actual_km), actualHours: blank(trip.actual_hours),
    baseFare: blank(trip.base_fare), extraKm: blank(trip.extra_km), extraKmRate: blank(trip.extra_km_rate),
    extraHours: blank(trip.extra_hours), extraHourRate: blank(trip.extra_hour_rate),
    toll: blank(trip.toll), parking: blank(trip.parking), stateTax: blank(trip.state_tax),
    waitingCharge: blank(trip.waiting_charge), otherCharges: blank(trip.other_charges),
    otherChargesNote: trip.other_charges_note ?? '', remarks: trip.completion_remarks ?? '',
  });
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF(init()); setErr(''); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, trip?.id]);

  const set = (k: keyof ReturnType<typeof init>) => (e: any) => setF((x) => ({ ...x, [k]: e.target.value }));
  const kmFromOdo = f.startKm && f.endKm ? Math.max(0, Math.round((n(f.endKm) - n(f.startKm)) * 10) / 10) : null;
  // A running total before tax, to sanity-check — the server prices it.
  const preTax = useMemo(() =>
    n(f.baseFare) + n(f.extraKm) * n(f.extraKmRate) + n(f.extraHours) * n(f.extraHourRate) + n(f.waitingCharge) + n(f.otherCharges)
    + Number(trip.driver_allowance ?? 0) + Number(trip.night_charge ?? 0) + Number(trip.permit ?? 0) - Number(trip.discount ?? 0),
  [f, trip]);
  const reimb = n(f.toll) + n(f.parking) + n(f.stateTax);

  async function save() {
    if (f.startKm && f.endKm && n(f.endKm) < n(f.startKm)) { setErr('Closing km cannot be less than opening km.'); return; }
    if (n(f.otherCharges) > 0 && !f.otherChargesNote.trim()) { setErr('Say what the other charges are for.'); return; }
    setBusy(true); setErr('');
    const num = (v: string) => (v === '' ? undefined : n(v));
    try {
      const { data } = await api.post(`/trips/${trip.id}/complete`, {
        completedAt: f.completedAt || undefined,
        startKm: num(f.startKm) ?? null, endKm: num(f.endKm) ?? null,
        actualKm: f.actualKm !== '' ? n(f.actualKm) : kmFromOdo, actualHours: num(f.actualHours) ?? null,
        baseFare: num(f.baseFare) ?? 0, extraKm: num(f.extraKm) ?? 0, extraKmRate: num(f.extraKmRate) ?? 0,
        extraHours: num(f.extraHours) ?? 0, extraHourRate: num(f.extraHourRate) ?? 0,
        toll: num(f.toll) ?? 0, parking: num(f.parking) ?? 0, stateTax: num(f.stateTax) ?? 0,
        waitingCharge: num(f.waitingCharge) ?? 0, otherCharges: num(f.otherCharges) ?? 0,
        otherChargesNote: f.otherChargesNote, remarks: f.remarks,
      });
      toast.success('Trip completed', data.message);
      if (data.feedback && !data.feedback.ok) toast.warning('Feedback email', data.feedback.message);
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally { setBusy(false); }
  }

  const done = trip.booking_status === 'COMPLETED';
  return (
    <Modal open={open} onClose={onClose} size="lg"
      title={done ? `Completion details — ${trip.trip_id}` : `Complete ${trip.trip_id}`}
      subtitle="Record what actually happened. The trip then waits for billing to be confirmed before it can be invoiced."
      footer={<>
        <button className="btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={busy}>{busy && <Spinner />} {done ? 'Save changes' : 'Complete the trip'}</button>
      </>}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Trip ended at" required>
            <input type="datetime-local" className="input" value={f.completedAt} onChange={set('completedAt')} />
          </Field>
          <Field label="Opening km"><input className="input text-right" inputMode="decimal" value={f.startKm} onChange={set('startKm')} /></Field>
          <Field label="Closing km"><input className="input text-right" inputMode="decimal" value={f.endKm} onChange={set('endKm')} /></Field>
          <Field label="Total km" hint={kmFromOdo != null ? `From odometer: ${kmFromOdo}` : 'Or enter directly'}>
            <input className="input text-right" inputMode="decimal" value={f.actualKm} onChange={set('actualKm')} placeholder={kmFromOdo != null ? String(kmFromOdo) : ''} />
          </Field>
          <Field label="Total hours"><input className="input text-right" inputMode="decimal" value={f.actualHours} onChange={set('actualHours')} /></Field>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">Final charges (before tax)</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Fare / package" className="sm:col-span-2"><input className="input text-right" inputMode="decimal" value={f.baseFare} onChange={set('baseFare')} /></Field>
            <Field label="Waiting charge" className="sm:col-span-2"><input className="input text-right" inputMode="decimal" value={f.waitingCharge} onChange={set('waitingCharge')} /></Field>
            <Field label="Extra km"><input className="input text-right" inputMode="decimal" value={f.extraKm} onChange={set('extraKm')} /></Field>
            <Field label="Rate / km"><input className="input text-right" inputMode="decimal" value={f.extraKmRate} onChange={set('extraKmRate')} /></Field>
            <Field label="Extra hours"><input className="input text-right" inputMode="decimal" value={f.extraHours} onChange={set('extraHours')} /></Field>
            <Field label="Rate / hour"><input className="input text-right" inputMode="decimal" value={f.extraHourRate} onChange={set('extraHourRate')} /></Field>
            <Field label="Other charges"><input className="input text-right" inputMode="decimal" value={f.otherCharges} onChange={set('otherCharges')} /></Field>
            <Field label="Other — what for" className="sm:col-span-3"><input className="input" value={f.otherChargesNote} onChange={set('otherChargesNote')} placeholder="e.g. Extra pickup at Andheri" /></Field>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-500">At actuals (not taxed)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Toll"><input className="input text-right" inputMode="decimal" value={f.toll} onChange={set('toll')} /></Field>
            <Field label="Parking"><input className="input text-right" inputMode="decimal" value={f.parking} onChange={set('parking')} /></Field>
            <Field label="State tax / entry"><input className="input text-right" inputMode="decimal" value={f.stateTax} onChange={set('stateTax')} /></Field>
          </div>
        </div>

        <Field label="Remarks"><textarea className="input h-auto py-2" rows={2} value={f.remarks} onChange={set('remarks')} placeholder="Anything the billing desk should know" /></Field>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-50 px-4 py-3 text-sm">
          <span className="text-ink-600">Before tax <strong className="tabular-nums text-ink-900">{inr(preTax)}</strong></span>
          <span className="text-ink-600">At actuals <strong className="tabular-nums text-ink-900">{inr(reimb)}</strong></span>
          <span className="text-xs text-ink-500">GST is added on saving, using this trip’s tax setting.</span>
        </div>
        {err && <p className="notice-warn !py-2.5 text-sm"><IconWarning className="h-4 w-4" /> {err}</p>}
      </div>
    </Modal>
  );
}

/* ==========================================================================
   Billing — confirmation
   ========================================================================== */

export function BillingPanel({ trip, onRefresh, onComplete }: { trip: any; onRefresh: () => void; onComplete: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const [busy, setBusy] = useState('');
  const [why, setWhy] = useState('');
  const canBill = can('billing.create') || can('billing.update') || can('invoices.create');
  const invoiced = trip.billing_status === 'INVOICED' || !!trip.invoice_id;
  const confirmed = !!trip.billing_confirmed_at;
  const completed = trip.booking_status === 'COMPLETED';

  async function call(path: string, body: any, title: string) {
    setBusy(path);
    try {
      const { data } = await api.post(`/trips/${trip.id}/${path}`, body);
      toast.success(title, data.message);
      setWhy('');
      onRefresh();
    } catch (e) { toast.error(`Could not ${title.toLowerCase()}`, errorMessage(e)); } finally { setBusy(''); }
  }

  const steps = [
    { label: 'Trip completed', done: completed, when: trip.completed_at },
    { label: 'Billing confirmed', done: confirmed, when: trip.billing_confirmed_at, who: trip.billing_confirmed_by_name },
    { label: 'Invoice generated', done: invoiced, when: trip.invoice_date, ref: trip.invoice_number },
    { label: 'Payment received', done: invoiced && Number(trip.invoice_outstanding ?? 1) <= 0.005, ref: invoiced ? `${inr(trip.invoice_paid ?? 0)} of ${inr(trip.invoice_total ?? 0)}` : '' },
  ];

  return (
    <div className="space-y-4">
      <Box title="Where billing stands">
        <ol className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-2.5 text-sm">
              <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${s.done ? 'bg-ok-500 text-white' : 'bg-ink-100 text-ink-400'}`}>
                {s.done ? <IconCheck className="h-3 w-3" /> : null}
              </span>
              <span className="min-w-0">
                <span className={`font-semibold ${s.done ? 'text-ink-900' : 'text-ink-500'}`}>{s.label}</span>
                <span className="ml-2 text-xs text-ink-500">
                  {[s.done ? 'Done' : 'Not yet', s.when ? dmyTime(s.when) : '', (s as any).who, (s as any).ref].filter(Boolean).join(' · ')}
                </span>
              </span>
            </li>
          ))}
        </ol>
        {trip.open_batch_code && (
          <p className="mt-3 text-xs text-ink-600">In billing batch <Link className="font-semibold text-brand-700" to="/admin/billing?tab=batches">{trip.open_batch_code}</Link>.</p>
        )}
      </Box>

      <Box title="Actuals">
        <Line label="Ended" value={trip.completed_at ? dmyTime(trip.completed_at) : null} />
        <Line label="Odometer" value={trip.start_km != null && trip.end_km != null ? `${trip.start_km} → ${trip.end_km}` : null} />
        <Line label="Kilometres" value={trip.actual_km ?? trip.trip_distance_km ?? null} />
        <Line label="Hours" value={trip.actual_hours ?? trip.trip_duration_hrs ?? null} />
        {trip.completion_remarks && <p className="mt-2 text-sm text-ink-700">{trip.completion_remarks}</p>}
      </Box>

      <Box title="Charges">
        <Line label="Fare" value={inr(trip.base_fare ?? 0)} />
        {Number(trip.extra_km) > 0 && <Line label={`Extra ${trip.extra_km} km × ${inr(trip.extra_km_rate)}`} value={inr(trip.extra_km * trip.extra_km_rate)} />}
        {Number(trip.extra_hours) > 0 && <Line label={`Extra ${trip.extra_hours} hr × ${inr(trip.extra_hour_rate)}`} value={inr(trip.extra_hours * trip.extra_hour_rate)} />}
        {Number(trip.waiting_charge) > 0 && <Line label="Waiting" value={inr(trip.waiting_charge)} />}
        {Number(trip.other_charges) > 0 && <Line label={trip.other_charges_note || 'Other'} value={inr(trip.other_charges)} />}
        {Number(trip.discount) > 0 && <Line label="Discount" value={`− ${inr(trip.discount)}`} />}
        <Line label="Taxable" value={inr(trip.taxable_amount ?? 0)} />
        <Line label={`GST ${trip.tax_mode === 'NONE' ? '(none)' : `${humanise(trip.tax_mode)} ${trip.tax_rate}%`}`} value={inr(trip.tax_amount ?? 0)} />
        {Number(trip.non_taxable_amount) > 0 && <Line label="Toll, parking, state tax" value={inr(trip.non_taxable_amount)} />}
        <Line label="Total" value={inr(trip.total_amount ?? 0)} strong />
      </Box>

      {!invoiced && canBill && (
        <div className="flex flex-wrap gap-2">
          {['ASSIGNED', 'ONTRIP', 'COMPLETED'].includes(trip.booking_status) && (
            <button className="btn-outline btn-sm" onClick={onComplete}>{completed ? 'Edit completion details' : 'Complete the trip'}</button>
          )}
          {!confirmed && (
            <button className="btn-primary btn-sm" disabled={!!busy || !(Number(trip.total_amount) > 0)}
              onClick={() => call('confirm-billing', {}, 'Confirm billing')}>
              {busy === 'confirm-billing' ? <Spinner /> : <IconCheck className="h-3.5 w-3.5" />} Confirm billing
            </button>
          )}
          {!(Number(trip.total_amount) > 0) && <p className="w-full text-xs text-warn-700">Enter the fare before confirming billing.</p>}
          {!completed && trip.booking_source !== 'DIRECT' && !confirmed && (
            <p className="w-full text-xs text-ink-500">Confirming billing for a trip dated today or earlier also marks it completed.</p>
          )}
        </div>
      )}
      {!invoiced && confirmed && canBill && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Withdraw the confirmation — why?" className="min-w-[220px] flex-1">
            <input className="input" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Customer disputes the toll" />
          </Field>
          <button className="btn-outline btn-sm" disabled={!!busy || why.trim().length < 3} onClick={() => call('unconfirm-billing', { reason: why }, 'Withdraw confirmation')}>
            Withdraw
          </button>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   Payments against the trip's invoice
   ========================================================================== */

export function PaymentsPanel({ trip }: { trip: any }) {
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (!trip.invoice_id) return;
    api.get(`/invoices/${trip.invoice_id}`).then((r) => setData(r.data)).catch((e) => setFailed(errorMessage(e)));
  }, [trip.invoice_id]);

  if (!trip.invoice_id) {
    return <p className="notice-info">No invoice yet, so nothing to collect. Payments appear here once the trip is invoiced.</p>;
  }
  const inv = data?.data;
  const overdue = inv && Number(inv.outstanding_amount) > 0.005 && inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <Box title={`Invoice ${trip.invoice_number}`} action={<Link className="btn-ghost btn-sm" to={`/admin/invoices/${trip.invoice_id}`}>Open invoice</Link>}>
        {failed && <p className="text-sm text-danger-600">{failed}</p>}
        {!inv && !failed && <p className="flex items-center gap-2 text-sm text-ink-500"><Spinner /> Loading…</p>}
        {inv && (
          <>
            <Line label="Invoice total" value={inr(inv.total_amount)} />
            <Line label="Received" value={inr(inv.paid_amount)} />
            <Line label="Outstanding" value={inr(inv.outstanding_amount)} strong />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-600">
              <StatusBadge value={overdue ? 'OVERDUE' : inv.status} />
              {inv.due_date && <span>Due {dmy(inv.due_date)}</span>}
              {(data?.data?.booking_count ?? 0) > 1 && <span>· this invoice covers other trips too</span>}
            </div>
          </>
        )}
      </Box>
      {inv && (
        <Box title="Payments">
          {(data.payments ?? []).length === 0 ? <p className="text-sm text-ink-500">Nothing received yet.</p> : (
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Date</th><th>Mode</th><th>Reference</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
              <tbody>
                {data.payments.map((p: any) => (
                  <tr key={p.id} className={p.is_reversed ? 'opacity-60' : ''}>
                    <td>{dmy(p.payment_date)}</td><td>{humanise(p.mode)}</td><td className="font-mono text-xs">{p.reference_no || '—'}</td>
                    <td className="text-right tabular-nums">{inr(p.amount)}</td>
                    <td>{p.is_reversed ? <span className="badge-danger">Reversed</span> : <span className="badge-ok">Received</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          <p className="mt-3 text-xs text-ink-500">Record payments from <Link className="font-semibold text-brand-700" to="/admin/payments">Payments &amp; Ledger</Link> or the invoice.</p>
        </Box>
      )}
    </div>
  );
}
