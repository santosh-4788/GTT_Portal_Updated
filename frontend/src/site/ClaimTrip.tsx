/**
 * Adding a trip that was booked before the account existed.
 *
 * A customer who rang the office, or messaged on WhatsApp from a different
 * email address, has a Trip ID the account does not know about. Rather than
 * leaving them to phone up about it, they can attach it themselves — with the
 * Trip ID *and* the mobile number on the booking, both of which only the real
 * customer has. One without the other is not enough, and the API says the same
 * thing whichever is wrong so nothing can be discovered by guessing.
 */
import { useState } from 'react';
import { customerApi } from '../lib/customerAuth';
import { errorMessage } from '../lib/api';
import { cleanMobile, SoftField, SOFT_INPUT, validMobile } from './kit';
import { IconCheck, IconPlus } from '../components/icons';

export function ClaimTripCard({
  onClaimed, className = '',
}: {
  onClaimed?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState('');
  const [mobile, setMobile] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (tripId.trim().length < 4) return setError('Enter the Trip ID exactly as we sent it.');
    if (!validMobile(mobile)) return setError('Enter the 10-digit mobile number on the booking.');

    setBusy(true);
    try {
      const { data } = await customerApi.post('/trips/claim', {
        tripId: tripId.trim().toUpperCase(),
        mobile: cleanMobile(mobile),
      });
      setDone(data.message ?? `${tripId.trim().toUpperCase()} added.`);
      setTripId('');
      setMobile('');
      onClaimed?.();
    } catch (err) {
      setError(errorMessage(err, 'We could not add that trip.'));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className={`tile flex flex-wrap items-center justify-between gap-4 p-5 ${className}`}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">Booked over the phone or on WhatsApp?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            Add it here with its Trip ID and it joins the rest of your trips.
          </p>
        </div>
        <button
          onClick={() => { setOpen(true); setDone(''); }}
          className="btn h-10 shrink-0 rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-ink-800"
        >
          <IconPlus className="h-3.5 w-3.5" /> Add a trip
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className={`tile animate-fade-up p-5 ${className}`}>
      <p className="text-sm font-semibold text-ink-900">Add a trip to your account</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-500">
        Both are on the confirmation we sent you. The mobile number has to be the one on the booking.
      </p>

      <div className="mt-4 grid gap-2.5 sm:grid-cols-[1fr,1fr,auto] sm:items-end">
        <SoftField label="Trip ID">
          <input
            className={`${SOFT_INPUT} font-mono uppercase`} value={tripId} autoFocus
            onChange={(e) => setTripId(e.target.value)} placeholder="GTT-WA-2609-0007"
          />
        </SoftField>
        <SoftField label="Mobile on the booking">
          <input
            className={SOFT_INPUT} value={mobile} inputMode="numeric" maxLength={13}
            onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile"
          />
        </SoftField>
        <div className="flex gap-2">
          <button
            type="submit" disabled={busy}
            className="grad-brand btn h-11 rounded-full px-5 text-sm font-semibold text-white transition-[filter] hover:brightness-[1.06] disabled:opacity-70"
          >
            {busy ? 'Checking…' : 'Add trip'}
          </button>
          <button
            type="button" onClick={() => { setOpen(false); setError(''); }}
            className="btn h-11 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100"
          >
            Cancel
          </button>
        </div>
      </div>

      {error && (
        <p className="animate-fade-up mt-3 rounded-2xl bg-danger-50 px-4 py-2.5 text-xs leading-relaxed text-danger-700">
          {error}
        </p>
      )}
      {done && (
        <p className="animate-fade-up mt-3 flex items-center gap-2 rounded-2xl bg-ok-50 px-4 py-2.5 text-xs font-semibold text-ok-700">
          <IconCheck className="h-4 w-4" /> {done}
        </p>
      )}
    </form>
  );
}
