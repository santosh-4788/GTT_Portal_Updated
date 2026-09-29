/**
 * Give your feedback - the page the "Give Your Feedback" email opens.
 *
 * The link carries a random token for one completed trip, so there is nothing
 * to sign in to and nothing to type except the answers: four star ratings and
 * a comment box. One response per trip - once it is in, the page says thank
 * you and shows what was given, unless the office re-opens it.
 *
 * Built phone-first: the stars are big enough to tap, each rating is its own
 * row that stacks on a narrow screen and sits in a two-column grid from
 * tablet width up.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { COMPANY } from './siteData';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconCheck, IconPhone } from '../components/icons';
import { useSeo } from './Seo';

interface FeedbackTrip {
  tripId: string;
  customerName: string;
  travelDate: string | null;
  pickup: string;
  drop: string;
  vehicle: string;
  driver: string;
  canSubmit: boolean;
  submitted: boolean;
  submittedAt: string | null;
  ratings: { driver: number; service: number; vehicle: number; overall: number } | null;
}

type RatingKey = 'driverRating' | 'serviceRating' | 'vehicleRating' | 'overallRating';

const QUESTIONS: { key: RatingKey; label: string; ask: string }[] = [
  { key: 'driverRating', label: 'Driver', ask: 'Punctual, polite, driving with care?' },
  { key: 'serviceRating', label: 'Service', ask: 'Booking, calls and updates from our team' },
  { key: 'vehicleRating', label: 'Cab / vehicle', ask: 'Clean, comfortable, as booked?' },
  { key: 'overallRating', label: 'Overall experience', ask: 'The trip as a whole' },
];

const WORDS = ['', 'Poor', 'Below average', 'Good', 'Very good', 'Excellent'];

function StarInput({
  id, value, onChange, label, error,
}: { id: string; value: number; onChange: (n: number) => void; label: string; error?: boolean }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div>
      <div
        role="radiogroup" aria-labelledby={`${id}-label`} className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'} - ${WORDS[n]}`}
            onClick={() => onChange(n)} onMouseEnter={() => setHover(n)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); onChange(Math.min(5, (value || 0) + 1)); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); onChange(Math.max(1, (value || 2) - 1)); }
            }}
            className={`grid h-11 w-11 place-items-center rounded-xl transition-transform duration-150 active:scale-90
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:h-10 sm:w-10 ${
                          error && !value ? 'ring-1 ring-danger-200' : ''}`}
          >
            <svg viewBox="0 0 24 24" className={`h-8 w-8 transition-colors sm:h-7 sm:w-7 ${n <= shown ? 'text-gold-400' : 'text-ink-200'}`} aria-hidden="true">
              <path fill="currentColor" d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3L2.8 9.5l6.4-.8z" />
            </svg>
          </button>
        ))}
        <span className="ml-2 min-w-[6.5rem] text-sm font-semibold text-ink-600" aria-live="polite">
          {shown ? WORDS[shown] : <span className="font-normal text-ink-400">Tap to rate</span>}
        </span>
      </div>
      <span id={`${id}-label`} className="sr-only">{label}</span>
    </div>
  );
}

function ReadOnlyStars({ value }: { value: number }) {
  return (
    <span className="text-lg tracking-tight" aria-label={`${value} out of 5`}>
      <span className="text-gold-400">{'★'.repeat(value)}</span>
      <span className="text-ink-200">{'★'.repeat(5 - value)}</span>
    </span>
  );
}

export default function FeedbackPage() {
  useSeo({ title: 'Give your feedback', noindex: true });
  const { token = '' } = useParams();
  const [trip, setTrip] = useState<FeedbackTrip | null>(null);
  const [loadError, setLoadError] = useState('');
  const [ratings, setRatings] = useState<Record<RatingKey, number>>({ driverRating: 0, serviceRating: 0, vehicleRating: 0, overallRating: 0 });
  const [comments, setComments] = useState('');
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.get(`/public/feedback/${encodeURIComponent(token)}`)
      .then(({ data }) => setTrip(data.data))
      .catch((err) => setLoadError(errorMessage(err, 'This feedback link could not be opened.')));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (QUESTIONS.some((q) => !ratings[q.key])) {
      setMissing(true);
      setError('Please give a star rating for each of the four questions.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/public/feedback/${encodeURIComponent(token)}`, { ...ratings, comments: comments.trim() });
      if (data.data) setTrip(data.data);
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(errorMessage(err, 'We could not save your feedback just now. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const route = trip ? [trip.pickup, trip.drop].filter(Boolean).join(' → ') : '';
  const thanked = done || (!!trip?.submitted && !trip.canSubmit);

  return (
    <div className="page-bg pb-24">
      <PageHero
        title={thanked ? 'Thank you' : 'Give your feedback'}
        sub={thanked ? 'Your answers are with our team.' : 'Four quick ratings about your trip, and anything else you would like to tell us.'}
        crumbs={[{ label: 'Feedback' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          {!trip && !loadError && (
            <div className="tile p-8 text-center text-sm text-ink-500">Opening your trip…</div>
          )}

          {loadError && (
            <Reveal className="tile p-6 text-center sm:p-8">
              <p className="font-display text-lg font-bold text-ink-900">We could not open this link</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">{loadError}</p>
              <a href={`tel:+91${COMPANY.mobile}`} className="btn-primary mt-5 inline-flex">
                <IconPhone className="h-4 w-4" /> Call us
              </a>
            </Reveal>
          )}

          {trip && (
            <div className="space-y-4">
              {/* Which trip this is about, so nobody rates the wrong one. */}
              <Reveal className="tile p-5 sm:p-6">
                <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-500">Your trip</p>
                <p className="mt-1 font-mono text-lg font-bold text-brand-700">{trip.tripId}</p>
                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {trip.travelDate && <div><dt className="text-ink-500">Date</dt><dd className="font-semibold text-ink-800">{dmy(trip.travelDate)}</dd></div>}
                  {route && <div className="sm:col-span-2"><dt className="text-ink-500">Route</dt><dd className="font-semibold text-ink-800">{route}</dd></div>}
                  {trip.driver && <div><dt className="text-ink-500">Chauffeur</dt><dd className="font-semibold text-ink-800">{trip.driver}</dd></div>}
                  {trip.vehicle && <div><dt className="text-ink-500">Vehicle</dt><dd className="font-semibold text-ink-800">{trip.vehicle}</dd></div>}
                </dl>
              </Reveal>

              {thanked ? (
                <Reveal className="tile p-6 text-center sm:p-8">
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-ok-50 text-ok-600">
                    <IconCheck className="h-7 w-7" />
                  </span>
                  <h2 className="mt-4 font-display text-xl font-bold text-ink-900">Thank You for Your Feedback!</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-600">
                    Your feedback has been successfully submitted and will help us improve our services.
                  </p>
                  {trip.ratings && (
                    <dl className="mx-auto mt-5 grid max-w-md grid-cols-2 gap-3 text-left">
                      {([['Driver', trip.ratings.driver], ['Service', trip.ratings.service], ['Cab', trip.ratings.vehicle], ['Overall', trip.ratings.overall]] as const).map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-ink-50 px-3 py-2">
                          <dt className="text-2xs font-bold uppercase tracking-wide text-ink-500">{k}</dt>
                          <dd><ReadOnlyStars value={v} /></dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <Link to="/" className="btn-outline mt-6 inline-flex">Back to the website</Link>
                </Reveal>
              ) : (
                <Reveal className="tile p-5 sm:p-7">
                  <form onSubmit={submit} noValidate>
                    <p className="text-sm text-ink-600">
                      {trip.customerName ? `Hello ${trip.customerName.split(' ')[0]}, how` : 'How'} did we do? Tap the stars — 1 is poor, 5 is excellent.
                    </p>

                    <div className="mt-5 grid gap-3 md:grid-cols-2">
                      {QUESTIONS.map((q) => (
                        <fieldset
                          key={q.key}
                          className={`rounded-2xl border p-4 transition-colors ${
                            missing && !ratings[q.key] ? 'border-danger-200 bg-danger-50/40' : 'border-ink-100 bg-ink-50/50'
                          }`}
                        >
                          <legend className="sr-only">{q.label}</legend>
                          <p className="font-semibold text-ink-900">{q.label} <span className="text-danger-500" aria-hidden="true">*</span></p>
                          <p className="mb-2 text-xs text-ink-500">{q.ask}</p>
                          <StarInput
                            id={`fb-${q.key}`} label={q.label} value={ratings[q.key]} error={missing}
                            onChange={(n) => { setRatings((r) => ({ ...r, [q.key]: n })); setError(''); }}
                          />
                        </fieldset>
                      ))}
                    </div>

                    <div className="mt-5">
                      <label htmlFor="fb-comments" className="font-semibold text-ink-900">Additional Feedback / Comments</label>
                      <textarea
                        id="fb-comments" rows={4} maxLength={2000}
                        className="input mt-2 h-auto min-h-[7rem] resize-y py-2.5 text-sm"
                        placeholder="Please share any suggestions, issues, or comments about your experience."
                        value={comments} onChange={(e) => setComments(e.target.value)}
                      />
                      <p className="mt-1 text-right text-2xs text-ink-400">{comments.length} / 2000</p>
                    </div>

                    {error && <p className="mt-3 rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{error}</p>}

                    <button
                      type="submit" disabled={busy}
                      className="grad-brand btn mt-4 h-12 w-full rounded-full text-sm font-semibold text-white shadow-lg shadow-brand-500/30 sm:w-auto sm:px-10"
                    >
                      {busy ? 'Sending…' : 'Submit Feedback'}
                    </button>
                  </form>
                </Reveal>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
