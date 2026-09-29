/**
 * Corporate travel request.
 *
 * Three short steps instead of one long form. Corporate procurement forms on
 * competitor sites ask thirty questions before they will show a rate; this asks
 * what kind of movement it is, the pattern, and who to call — and each screen
 * fits on a phone without scrolling past the submit button.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { todayIso } from '../lib/format';
import { COMPANY } from './siteData';
import { CORPORATE_REQUEST_TYPES, VEHICLES } from './catalog';
import {
  Callout, ChoiceCard, ContactFields, PlaceInput, Stepper, SubmitButton, TrustRow,
  useContactDetails, useSendRequirement, emailError,
} from './kit';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconLock, IconPhone, IconPlus, IconTrash } from '../components/icons';
import { DateField } from '../components/DateTimeField';
import { useSeo } from './Seo';

const STEPS = ['Type', 'Requirement', 'Contact'];

const FREQUENCIES = [
  { key: 'ONE_OFF', label: 'One-off', sub: 'A single date' },
  { key: 'WEEKLY', label: 'Weekly', sub: 'The same run each week' },
  { key: 'DAILY', label: 'Daily', sub: 'Every working day' },
  { key: 'MONTHLY', label: 'Ad-hoc monthly', sub: 'Several duties a month, on call' },
];

const BILLING = [
  { key: 'PER_TRIP', label: 'Per trip' },
  { key: 'FORTNIGHTLY', label: 'Fortnightly' },
  { key: 'MONTHLY', label: 'Monthly consolidated' },
];

export default function CorporateRequest() {
  useSeo({
    title: 'Corporate Transport Requirement',
    path: '/corporate/request',
    description: 'Send your company’s car rental or employee transport requirement in Mumbai and get a proposal from Gupta Tours & Travels.',
  });
  const [params] = useSearchParams();
  const { send, busy, error, setError } = useSendRequirement();

  const [at, setAt] = useState(0);
  const [type, setType] = useState(params.get('type') ?? 'employee');
  const [routes, setRoutes] = useState<{ from: string; to: string }[]>([{ from: '', to: '' }]);
  const [frequency, setFrequency] = useState('ONE_OFF');
  const [vehicleCount, setVehicleCount] = useState(1);
  const [vehiclePref, setVehiclePref] = useState('');
  const [pax, setPax] = useState(4);
  const [startDate, setStartDate] = useState('');
  const [billing, setBilling] = useState('MONTHLY');
  const [gstin, setGstin] = useState('');
  const [notes, setNotes] = useState('');
  const [contact, setContact] = useContactDetails();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const typeLabel = CORPORATE_REQUEST_TYPES.find((t) => t.key === type)?.label ?? 'Corporate travel';

  const stepBack = (): boolean => {
    if (at > 0) { setError(''); setAt((i) => i - 1); return true; }
    return false;
  };

  const next = () => {
    if (at === 1 && !routes.some((r) => r.from.trim() || r.to.trim())) {
      setError('Give us at least one route, even roughly — "Andheri office to BKC" is enough.');
      return;
    }
    setError('');
    setAt((i) => Math.min(STEPS.length - 1, i + 1));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (contact.name.trim().length < 2) errs.name = 'Please enter your name.';
    if (!/^[6-9]\d{9}$/.test(contact.mobile.replace(/\D/g, '').replace(/^91/, ''))) errs.mobile = 'Enter a valid 10-digit mobile number.';
    Object.assign(errs, emailError(contact));
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    const used = routes.filter((r) => r.from.trim() || r.to.trim());

    send({
      kind: 'CORPORATE',
      from: used[0]?.from ?? '',
      to: used[0]?.to ?? '',
      date: startDate,
      passengers: pax,
      vehicleCount,
      vehicleName: vehiclePref || undefined,
      legs: used.map((r, i) => ({ label: `Route ${i + 1}`, detail: `${r.from || '—'} → ${r.to || '—'}` })),
      notes: [
        `Movement type: ${typeLabel}`,
        `Frequency: ${FREQUENCIES.find((f) => f.key === frequency)?.label}`,
        `Vehicles needed: ${vehicleCount}`,
        `Billing preference: ${BILLING.find((b) => b.key === billing)?.label}`,
        gstin ? `GSTIN: ${gstin}` : '',
        notes,
      ].filter(Boolean).join('. '),
      name: contact.name,
      mobile: contact.mobile,
      email: contact.noEmail ? '' : contact.email,
      company: contact.company,
    });
  };

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Corporate"
        title="Tell us the pattern, we will quote the card"
        sub="Three short steps. Nothing here is a commitment — you get a rate card to look at, and your accounts team gets a sample invoice in their own format before the first trip."
        crumbs={[{ label: 'Corporate', to: '/corporate' }, { label: 'Request' }]}
        compact
        onBack={stepBack}
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          <Stepper steps={STEPS} at={at} onJump={setAt} />

          <form onSubmit={submit} className="tile mt-6 p-6 sm:p-8">
            {/* ------------------------------------------------- 1 · TYPE */}
            {at === 0 && (
              <div className="animate-fade-up">
                <h2 className="font-display text-lg font-bold text-ink-900">What kind of movement is this?</h2>
                <p className="mt-1.5 text-sm text-ink-500">Pick the closest. It changes which questions we ask next, not the price.</p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {CORPORATE_REQUEST_TYPES.map((t) => (
                    <ChoiceCard key={t.key} on={type === t.key} title={t.label} sub={t.sub} onClick={() => setType(t.key)} />
                  ))}
                </div>

                {type === 'fleet' && (
                  <Callout className="mt-5">
                    If you already know the vehicles and the numbers, the{' '}
                    <Link to="/fleet-request" className="font-bold underline">fleet planner</Link> is faster — you can
                    set the count per vehicle there.
                  </Callout>
                )}
              </div>
            )}

            {/* ------------------------------------------ 2 · REQUIREMENT */}
            {at === 1 && (
              <div className="animate-fade-up space-y-6">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">The routes</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    Approximate is fine. "Andheri office to BKC" prices as well as a full address at this stage.
                  </p>

                  <div className="mt-5 space-y-4">
                    {routes.map((r, i) => (
                      <div key={i} className="rounded-2xl bg-ink-50/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Route {i + 1}</p>
                          {routes.length > 1 && (
                            <button
                              type="button" onClick={() => setRoutes((l) => l.filter((_, j) => j !== i))}
                              className="btn btn-icon rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                              aria-label={`Remove route ${i + 1}`}
                            >
                              <IconTrash className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <PlaceInput
                            label="From" value={r.from}
                            onChange={(v) => setRoutes((l) => l.map((x, j) => (j === i ? { ...x, from: v } : x)))}
                            placeholder="Office, hotel or residence"
                          />
                          <PlaceInput
                            label="To" value={r.to}
                            onChange={(v) => setRoutes((l) => l.map((x, j) => (j === i ? { ...x, to: v } : x)))}
                            placeholder="Site, airport or city"
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button" onClick={() => setRoutes((l) => [...l, { from: '', to: '' }])}
                      className="inline-flex items-center gap-1.5 text-sm font-bold text-brand-700 hover:text-brand-800"
                    >
                      <IconPlus className="h-4 w-4" /> Add another route
                    </button>
                  </div>
                </div>

                <div>
                  <p className="label">How often?</p>
                  <div className="grid gap-3 sm:grid-cols-4">
                    {FREQUENCIES.map((fq) => (
                      <ChoiceCard key={fq.key} on={frequency === fq.key} title={fq.label} sub={fq.sub} onClick={() => setFrequency(fq.key)} />
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label className="label" htmlFor="cr-vehicles">Vehicles at a time</label>
                    <input
                      id="cr-vehicles" type="number" min={1} max={60} className="input"
                      value={vehicleCount} onChange={(e) => setVehicleCount(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="cr-pax">Passengers per vehicle</label>
                    <input
                      id="cr-pax" type="number" min={1} max={60} className="input"
                      value={pax} onChange={(e) => setPax(Math.max(1, Number(e.target.value) || 1))}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="cr-start">Start from</label>
                    <DateField id="cr-start" min={todayIso()} value={startDate} onChange={setStartDate} />
                  </div>
                </div>

                <div>
                  <label className="label" htmlFor="cr-vehicle">Preferred vehicle class</label>
                  <select id="cr-vehicle" className="input sm:max-w-sm" value={vehiclePref} onChange={(e) => setVehiclePref(e.target.value)}>
                    <option value="">No preference — recommend one</option>
                    {VEHICLES.map((v) => (
                      <option key={v.slug} value={v.name}>{v.name} · {v.seats} seats</option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="label">Billing preference</p>
                  <div className="flex flex-wrap gap-2">
                    {BILLING.map((b) => (
                      <button
                        key={b.key} type="button" onClick={() => setBilling(b.key)}
                        className={`rounded-full px-4 py-2.5 text-xs font-semibold transition-all ${
                          billing === b.key ? 'grad-brand text-white shadow-sm shadow-brand-500/25' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
                        }`}
                      >
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---------------------------------------------- 3 · CONTACT */}
            {at === 2 && (
              <div className="animate-fade-up space-y-5">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink-900">Who should we speak to?</h2>
                  <p className="mt-1.5 text-sm text-ink-500">
                    One call is usually enough to agree the card. We will send a sample invoice with it.
                  </p>
                </div>

                <ContactFields value={contact} onChange={setContact} error={fieldErrors} company />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="cr-gstin">Your GSTIN</label>
                    <input
                      id="cr-gstin" className="input font-mono uppercase" value={gstin}
                      onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="27AAAAA0000A1Z5" maxLength={15}
                    />
                    <p className="hint">Optional here — needed before the first invoice.</p>
                  </div>
                  <div>
                    <label className="label" htmlFor="cr-notes">Anything your accounts team needs?</label>
                    <textarea
                      id="cr-notes" className="input min-h-[92px] resize-y" value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="PO number on the invoice, a specific invoice format, a portal we must upload to, payment terms…"
                    />
                  </div>
                </div>

                <ul className="grid gap-2 rounded-2xl bg-ink-50/70 p-4 sm:grid-cols-2">
                  {[
                    'A rate card for the duties you actually use',
                    'A sample invoice in your own format',
                    'Duty slips retained against every trip',
                    'One point of contact, 24×7',
                  ].map((x) => (
                    <li key={x} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                      <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok-500" /> {x}
                    </li>
                  ))}
                </ul>

                {error && <p className="error-text">{error}</p>}

                <div className="flex flex-wrap items-center gap-3">
                  <SubmitButton busy={busy}>Send this requirement</SubmitButton>
                  <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                    <IconPhone className="h-4 w-4" /> Call
                  </a>
                  <Link to="/login" className="btn h-12 rounded-full px-5 text-md text-ink-600 hover:bg-ink-50">
                    <IconLock className="h-4 w-4" /> Existing account? Log in
                  </Link>
                </div>
              </div>
            )}

            {at < 2 && (
              <div className="mt-8 flex items-center justify-between gap-3">
                <button
                  type="button" onClick={() => setAt((i) => Math.max(0, i - 1))} disabled={at === 0}
                  className="btn h-11 rounded-full px-5 text-md text-ink-600 hover:bg-ink-50 disabled:opacity-40"
                >
                  Back
                </button>
                <button
                  type="button" onClick={next}
                  className="grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 hover:brightness-[1.06]"
                >
                  Next <IconArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
            {at < 2 && error && <p className="error-text mt-3">{error}</p>}
          </form>

          <TrustRow className="mt-6" />
        </div>
      </section>
    </div>
  );
}
