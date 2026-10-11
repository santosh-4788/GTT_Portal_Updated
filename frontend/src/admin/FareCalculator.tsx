/**
 * Price a trip from a fare rule — the same calculation the server stores.
 *
 * Used in two places: on the Fare rules master (to check a rule does what it
 * should) and in the trip drawer (to fill the trip's fare from the rule, with
 * the rule recorded alongside it). Every figure comes back from
 * POST /api/fares/quote; nothing is worked out here, so the screen can never
 * disagree with the invoice.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { inr } from '../lib/format';
import { Field, Spinner } from '../components/ui';
import { IconCheck, IconWarning } from '../components/icons';

export interface FareQuote {
  rule: { id: number; label: string; vendorName?: string; planType: string; vehicleCategory: string };
  lines: { label: string; detail?: string; amount: number; kind: string }[];
  notes: string[];
  charges: Record<string, any>;
  totals: Record<string, any>;
  snapshot: string;
}

const num = (v: string) => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export default function FareCalculator({
  vendorId, categoryId, vehicleText, tripType, onDate, fixedRule, onApply, applyLabel = 'Use this fare', initial,
}: {
  vendorId?: number; categoryId?: number | null; vehicleText?: string; tripType?: string; onDate?: string;
  /** Lock the calculator to one rule row (the master's "Test" button). */
  fixedRule?: any;
  onApply?: (q: FareQuote) => void;
  applyLabel?: string;
  initial?: Partial<Record<'distanceKm' | 'hours' | 'days' | 'nights' | 'toll' | 'parking', string>>;
}) {
  const [rules, setRules] = useState<any[]>([]);
  const [others, setOthers] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [ruleId, setRuleId] = useState<string>(fixedRule ? String(fixedRule.id) : '');
  const [f, setF] = useState({
    distanceKm: initial?.distanceKm ?? '', oneWayKm: '', roundTrip: false,
    hours: initial?.hours ?? '', days: initial?.days ?? '1', nights: initial?.nights ?? '',
    waitingMinutes: '', toll: initial?.toll ?? '', parking: initial?.parking ?? '', stateTax: '',
    permit: '', otherCharges: '', otherChargesNote: '', discount: '',
  });
  const [quote, setQuote] = useState<FareQuote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (fixedRule) return;
    api.get('/fares/rules', { params: { vendorId, categoryId: categoryId || undefined, vehicle: vehicleText, tripType, date: onDate } })
      .then(({ data }) => {
        setRules(data.data ?? []);
        setOthers(data.others ?? []);
        setMessage(data.message ?? '');
        if (data.data?.length === 1) setRuleId(String(data.data[0].id));
      })
      .catch((err) => setMessage(errorMessage(err)));
  }, [vendorId, categoryId, vehicleText, tripType, onDate, fixedRule]);

  const rule = useMemo(
    () => fixedRule ?? [...rules, ...others].find((r) => String(r.id) === ruleId),
    [fixedRule, rules, others, ruleId]
  );
  const planType: string = rule?.plan_type ?? '';

  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));

  // Recalculate as the inputs change (debounced), so the desk sees the total live.
  useEffect(() => {
    if (!ruleId) { setQuote(null); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      setError('');
      try {
        const { data } = await api.post('/fares/quote', {
          ruleId: Number(ruleId), onDate: onDate || undefined,
          distanceKm: num(f.distanceKm), oneWayKm: num(f.oneWayKm), roundTrip: f.roundTrip,
          hours: num(f.hours), days: num(f.days) ? Math.round(num(f.days)!) : undefined,
          nights: num(f.nights) ? Math.round(num(f.nights)!) : undefined,
          waitingMinutes: num(f.waitingMinutes), toll: num(f.toll), parking: num(f.parking),
          stateTax: f.stateTax === '' ? undefined : (num(f.stateTax) ?? 0),
          permit: num(f.permit), otherCharges: num(f.otherCharges), otherChargesNote: f.otherChargesNote || undefined,
          discount: num(f.discount),
        });
        setQuote(data.data);
      } catch (err) {
        setQuote(null);
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [ruleId, f, onDate]);

  const money = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <input className="input text-right tabular-nums" inputMode="decimal" placeholder="0"
        value={f[k] as string} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );

  return (
    <div className="space-y-4">
      {!fixedRule && (
        <Field label="Fare rule" hint={message || 'Rules for this vehicle and trip type, effective on the travel date.'}>
          <select className="input" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            <option value="">Choose a fare rule…</option>
            {rules.length > 0 && (
              <optgroup label="Suggested for this trip">
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>{r.vehicle_category} · {r.plan_label} — {r.vendor_name}</option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other active rules">
                {others.map((r) => (
                  <option key={r.id} value={r.id}>{r.vehicle_category} · {r.plan_label} ({r.plan_type.toLowerCase()}) — {r.vendor_name}</option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      )}

      {(ruleId) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(planType === 'OUTSTATION' || !planType) && (
            <>
              <Field label="Total km" hint="Odometer, start to finish">
                <input className="input text-right tabular-nums" inputMode="decimal" value={f.distanceKm} onChange={(e) => set('distanceKm', e.target.value)} placeholder="0" />
              </Field>
              <Field label="Days out">
                <input className="input text-right tabular-nums" inputMode="numeric" value={f.days} onChange={(e) => set('days', e.target.value)} />
              </Field>
              <Field label="One-way km" hint="If total km is not known">
                <div className="flex items-center gap-2">
                  <input className="input text-right tabular-nums" inputMode="decimal" value={f.oneWayKm} onChange={(e) => set('oneWayKm', e.target.value)} placeholder="0" />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-600">
                    <input type="checkbox" className="check" checked={f.roundTrip} onChange={(e) => set('roundTrip', e.target.checked)} /> Return
                  </label>
                </div>
              </Field>
            </>
          )}
          {(planType === 'LOCAL' || planType === 'AIRPORT') && (
            <>
              <Field label="Km driven" hint={rule?.included_km ? `${rule.included_km} km included` : undefined}>
                <input className="input text-right tabular-nums" inputMode="decimal" value={f.distanceKm} onChange={(e) => set('distanceKm', e.target.value)} placeholder="0" />
              </Field>
              {planType === 'LOCAL' ? (
                <Field label="Hours used" hint={rule?.included_hours ? `${rule.included_hours} h included` : undefined}>
                  <input className="input text-right tabular-nums" inputMode="decimal" value={f.hours} onChange={(e) => set('hours', e.target.value)} placeholder="0" />
                </Field>
              ) : (
                <Field label="Waiting (minutes)" hint={rule?.free_waiting_minutes ? `${rule.free_waiting_minutes} min free` : undefined}>
                  <input className="input text-right tabular-nums" inputMode="numeric" value={f.waitingMinutes} onChange={(e) => set('waitingMinutes', e.target.value)} placeholder="0" />
                </Field>
              )}
            </>
          )}
          <Field label="Nights" hint={rule?.night_charge ? `₹${rule.night_charge} a night` : 'Night charge, if any'}>
            <input className="input text-right tabular-nums" inputMode="numeric" value={f.nights} onChange={(e) => set('nights', e.target.value)} placeholder="0" />
          </Field>
          {money('toll', 'Toll', rule?.toll_included ? 'Included in this rule' : 'At actuals')}
          {money('parking', 'Parking', rule?.parking_included ? 'Included in this rule' : 'At actuals')}
          {money('stateTax', 'State tax', rule?.state_tax ? `Rule default ₹${rule.state_tax}` : 'At actuals')}
          {money('permit', 'Permit')}
          {money('otherCharges', 'Other charges')}
          {money('discount', 'Discount (₹)', rule?.discount_percent ? `Plus ${rule.discount_percent}% from the rule` : undefined)}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-danger-50 px-3.5 py-2.5 text-sm text-danger-700">
          <IconWarning className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {quote && (
        <div className="rounded-xl border border-ink-200 bg-ink-50/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-2.5">
            <p className="text-xs text-ink-600">
              <span className="font-semibold text-ink-800">Rule applied:</span> {quote.rule.label}
              {quote.rule.vendorName ? ` — ${quote.rule.vendorName}` : ''}
            </p>
            {busy && <Spinner className="h-3.5 w-3.5 text-brand-600" />}
          </div>
          <dl className="space-y-1.5 px-4 py-3 text-sm">
            {quote.lines.map((l, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3">
                <dt className={l.kind === 'discount' ? 'text-ok-700' : l.kind === 'reimbursable' ? 'text-ink-500' : 'text-ink-700'}>
                  {l.label}{l.detail && <span className="ml-1.5 text-xs text-ink-400">{l.detail}</span>}
                </dt>
                <dd className="tabular-nums text-ink-800">{inr(l.amount)}</dd>
              </div>
            ))}
            <div className="my-2 h-px bg-ink-200" />
            <div className="flex justify-between text-ink-600"><dt>Taxable value</dt><dd className="tabular-nums">{inr(quote.totals.taxableAmount)}</dd></div>
            <div className="flex justify-between text-ink-600">
              <dt>{quote.totals.taxMode === 'NONE' ? 'No GST' : quote.totals.taxMode === 'CGST_SGST' ? `CGST + SGST ${quote.totals.taxRate}%` : `IGST ${quote.totals.taxRate}%`}</dt>
              <dd className="tabular-nums">{inr(quote.totals.taxAmount)}</dd>
            </div>
            {quote.totals.nonTaxableAmount > 0 && (
              <div className="flex justify-between text-ink-600"><dt>Toll, parking &amp; state tax</dt><dd className="tabular-nums">{inr(quote.totals.nonTaxableAmount)}</dd></div>
            )}
            <div className="flex items-baseline justify-between pt-1">
              <dt className="font-semibold text-ink-900">Total</dt>
              <dd className="font-display text-xl font-bold tabular-nums text-ink-900">{inr(quote.totals.totalAmount)}</dd>
            </div>
          </dl>
          {quote.notes.length > 0 && (
            <ul className="space-y-1 border-t border-ink-200 px-4 py-2.5 text-xs text-ink-600">
              {quote.notes.map((n, i) => <li key={i}>• {n}</li>)}
            </ul>
          )}
          {onApply && (
            <div className="border-t border-ink-200 px-4 py-3">
              <button className="btn-primary w-full" onClick={() => onApply(quote)}>
                <IconCheck className="h-4 w-4" /> {applyLabel}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
