/**
 * Track a trip without signing in.
 *
 * For the customer who has the Trip ID from an email or a WhatsApp reply and
 * just wants to know where things stand — on a borrowed phone, on the way out
 * of the door, with no patience for creating an account.
 *
 * Trip IDs run in sequence, so the ID alone is not a secret. The last four
 * digits of the mobile on the booking are asked for as well: enough to stop
 * somebody walking the numbering, and something the real customer always has.
 * The API answers identically whichever of the two is wrong, so nothing can be
 * discovered by probing.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { COMPANY } from './siteData';
import { BackLink, CopyChip, KeyValue, SoftField, SOFT_INPUT, StatusTrail, TrustRow, since } from './kit';
import { invoiceStep, trailFor, SOURCE_TONE, STAGE_TONE, type ServerTrip, type TimelineEvent } from './accountApi';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconPhone, IconSearch, IconUsers } from '../components/icons';
import { useSeo } from './Seo';

export default function TrackLookup() {
  useSeo({ title: 'Track a trip', noindex: true });
  const [params, setParams] = useSearchParams();
  const [tripId, setTripId] = useState((params.get('trip') ?? '').toUpperCase());
  const [digits, setDigits] = useState(params.get('verify') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ trip: ServerTrip; timeline: TimelineEvent[] } | null>(null);

  async function lookup(id: string, verify: string) {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get(`/public/track/${encodeURIComponent(id.trim().toUpperCase())}`, {
        params: { verify: verify.replace(/\D/g, '').slice(-4) },
      });
      setResult({ trip: data.data, timeline: data.timeline ?? [] });
      setParams({ trip: id.trim().toUpperCase(), verify: verify.replace(/\D/g, '').slice(-4) }, { replace: true });
    } catch (err) {
      setResult(null);
      setError(errorMessage(err, 'We could not find that trip.'));
    } finally {
      setBusy(false);
    }
  }

  // A link from an email can carry both, in which case there is nothing to type.
  useEffect(() => {
    const t = params.get('trip');
    const v = params.get('verify');
    if (t && v && !result && !busy) lookup(t, v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tripId.trim().length < 4) return setError('Enter the Trip ID exactly as we sent it.');
    if (digits.replace(/\D/g, '').length < 4) return setError('Enter the last four digits of the mobile on the booking.');
    lookup(tripId, digits);
  }

  return (
    <div className="page-bg pb-24">
      <PageHero
        title="Track a trip"
        sub="Quote the Trip ID and the last four digits of the number on the booking."
        crumbs={[{ label: 'Track a trip' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-2xl">
          <Reveal className="tile p-6 sm:p-7">
            <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[1fr,10rem,auto] sm:items-end">
              <SoftField label="Trip ID">
                <input
                  className={`${SOFT_INPUT} font-mono uppercase`} value={tripId} autoFocus
                  onChange={(e) => setTripId(e.target.value)} placeholder="GTT-EM-2609-0042"
                />
              </SoftField>
              <SoftField label="Last 4 digits">
                <input
                  className={SOFT_INPUT} value={digits} inputMode="numeric" maxLength={4}
                  onChange={(e) => setDigits(e.target.value)} placeholder="5667"
                />
              </SoftField>
              <button
                type="submit" disabled={busy}
                className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white transition-[filter] hover:brightness-[1.06] disabled:opacity-70"
              >
                {busy
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  : <IconSearch className="h-4 w-4" />}
                Track
              </button>
            </form>

            {error && (
              <p className="animate-fade-up mt-4 rounded-2xl bg-danger-50 px-4 py-3 text-sm leading-relaxed text-danger-700">
                {error}
              </p>
            )}

            <p className="mt-4 border-t border-ink-100 pt-4 text-xs leading-relaxed text-ink-500">
              The Trip ID is on the confirmation we emailed you and in the WhatsApp message you sent us.
              Signed-in customers see all of this and their invoices without typing anything —{' '}
              <Link to="/account" className="font-semibold text-brand-700 hover:text-brand-800">create an account</Link>.
            </p>
          </Reveal>

          {result && <TrackResult trip={result.trip} timeline={result.timeline} />}
        </div>
      </section>
    </div>
  );
}

function TrackResult({ trip, timeline }: { trip: ServerTrip; timeline: TimelineEvent[] }) {
  const extra = invoiceStep(trip);
  const steps = [
    ...trailFor(trip).map((s) => ({ label: s.label, state: s.state })),
    ...(extra ? [extra] : []),
  ];

  return (
    <Reveal className="tile mt-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50/70 px-5 py-3.5">
        <CopyChip value={trip.tripId} />
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${SOURCE_TONE[trip.source] ?? 'bg-ink-100 text-ink-700'}`}>
            {trip.sourceLabel}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${STAGE_TONE[trip.status]}`}>
            {trip.statusLabel}
          </span>
        </div>
      </div>

      <div className="p-6">
        <h2 className="font-display text-lg font-bold leading-snug text-ink-900">
          {[trip.pickup, trip.drop].filter(Boolean).join('  →  ') || 'Your trip'}
        </h2>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <KeyValue label="Journey date" value={trip.travelDate ? dmy(trip.travelDate) : '—'} />
          <KeyValue label="Journey time" value={trip.journeyTime || 'To be confirmed'} />
          <KeyValue label="Vehicle" value={
            trip.vehicleNumber ? `${trip.vehicleType ?? 'Vehicle'} · ${trip.vehicleNumber}` : (trip.vehicleType || 'To be allotted')
          } />
          {/* Name only. The number is reachable from the Call control on this
              page, never printed into the row. */}
          <KeyValue label="Chauffeur" value={trip.driverName || 'To be allotted'} />
        </dl>

        <div className="mt-6 border-t border-ink-100 pt-5">
          <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">Where it has got to</p>
          <div className="mt-4">
            <StatusTrail steps={steps} />
          </div>
        </div>

        {timeline.length > 0 && (
          <div className="mt-6 border-t border-ink-100 pt-5">
            <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">Activity</p>
            <ul className="mt-3 space-y-2">
              {timeline.map((e) => (
                <li key={e.id} className="text-sm text-ink-600">
                  <span className="font-semibold text-ink-800">{e.title}</span>
                  {e.detail ? ` — ${e.detail}` : ''}
                  <span className="ml-1.5 text-2xs text-ink-400">{since(e.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {trip.invoice && (
          <div className="mt-6 rounded-2xl bg-ok-50/70 px-4 py-3.5">
            <p className="text-sm leading-relaxed text-ok-700">
              <strong className="font-bold">
                {trip.invoice.gst ? 'GST invoice' : 'Invoice'} {trip.invoice.number}
              </strong>{' '}
              has been raised for this trip. Sign in with the email address on the booking to download it.
            </p>
            <Link
              to="/account"
              className="btn mt-3 h-10 rounded-full bg-ok-600 px-4 text-sm font-semibold text-white transition-[filter] hover:brightness-110"
            >
              <IconUsers className="h-3.5 w-3.5" /> Sign in to download
            </Link>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-ink-100 pt-5">
          <TrustRow compact />
          <a
            href={`tel:+91${COMPANY.mobile}`}
            className="btn h-10 rounded-full bg-ink-900 px-5 text-sm text-white transition-colors hover:bg-ink-800"
          >
            <IconPhone className="h-3.5 w-3.5" /> Call the office
          </a>
        </div>
      </div>
    </Reveal>
  );
}
