import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { Spinner } from '../components/ui';
import { COMPANY } from './siteData';
import {
  IconSearch, IconBookings, IconSteering, IconPin, IconRoad, IconCheck,
  IconShield, IconLock, IconKey, IconWarning, IconUsers, IconClock, IconArrowRight,
  IconMap, IconPhone, IconMail,
} from '../components/icons';
import { useSeo } from './Seo';

/* ==========================================================================
   Staff sign-in.

   ONE CARD, SIZED TO FIT WITHOUT SCROLLING, WITH A TRIP RUNNING ACROSS IT.

   The header used to show the office's own workflow — Book, Dispatch, Bill,
   Invoice, Reports — which is the one thing a person signing in already knows
   by heart. It shows the CUSTOMER's journey instead: searching, booked, the cab
   on its way, picked up, running, done.

   WHY THE MOTION IS WRITTEN THE WAY IT IS
   The first attempt moved the cab one stage at a time on an interval. That did
   not read as a journey — it read as a stepper clicking, and at the end of the
   loop the cab flew backwards across the whole card, which is the single most
   noticeable thing on the screen. So:

     · the cab DRIVES, on an animation frame, continuously;
     · a stage lights as the cab reaches it, not on its own clock;
     · the loop hides its own reset — the cab and the trail fade out at the
       drop, return to the start unseen, and fade back in.

   The whole thing is one requestAnimationFrame loop throttled to about thirty
   updates a second, inside its own component, so nothing else on the page
   re-renders. It stops dead, showing the completed trip, for anyone whose
   system asks for reduced motion.
   ========================================================================== */

/** The customer's trip, in the order it happens. */
const JOURNEY = [
  { label: 'Searching', Icon: IconSearch },
  { label: 'Booked', Icon: IconBookings },
  { label: 'Arriving', Icon: IconSteering },
  { label: 'Pickup', Icon: IconPin },
  { label: 'On trip', Icon: IconRoad },
  { label: 'Done', Icon: IconCheck },
] as const;

/** One full loop, including the pause at the drop and the hidden return. */
const CYCLE_MS = 8200;
/** The cab has finished driving by this point in the cycle. */
const DRIVE_END = 0.78;
/** Fade in over the first slice, fade out after this one. */
const FADE_IN = 0.05;
const FADE_OUT = 0.88;

const TRUST = [
  { Icon: IconShield, label: 'GST registered' },
  { Icon: IconClock, label: COMPANY.serviceHours },
  { Icon: IconLock, label: 'Private portal' },
] as const;

/** A car, small enough to read at 36px wide. Local to this page. */
function MiniCar({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 26" className={className} aria-hidden="true">
      <path
        d="M4 20v-4c0-2 1-3 3-3l6-1 5-5c1-1 2-2 4-2h16c2 0 3 1 4 2l4 5 10 1c3 0 5 2 5 4v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"
        fill="currentColor"
      />
      <circle cx="17" cy="21" r="4" fill="#0B2C45" />
      <circle cx="47" cy="21" r="4" fill="#0B2C45" />
      <circle cx="17" cy="21" r="1.6" fill="currentColor" />
      <circle cx="47" cy="21" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** True when the machine has asked for less movement. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function JourneyTrack() {
  const n = JOURNEY.length;
  const reduced = usePrefersReducedMotion();

  /** Where we are in the loop, 0 to 1. */
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduced) { setPhase(DRIVE_END); return; }
    let raf = 0;
    let last = -1;
    const start = performance.now();
    const tick = (now: number) => {
      const p = ((now - start) % CYCLE_MS) / CYCLE_MS;
      // ~30 a second. A cab crossing 380 pixels does not need 60.
      if (last < 0 || p < last || p - last > 0.004) { setPhase(p); last = p; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Ease the drive slightly at both ends, so the cab pulls away and settles
  // rather than starting and stopping at full speed.
  const raw = Math.min(1, phase / DRIVE_END);
  const drive = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;

  const edge = (0.5 / n) * 100;        // centre of the first stage, in %
  const span = 100 - edge * 2;         // first centre to last centre
  const active = Math.round(drive * (n - 1));

  const fade = reduced ? 1
    : phase < FADE_IN ? phase / FADE_IN
      : phase > FADE_OUT ? Math.max(0, 1 - (phase - FADE_OUT) / (1 - FADE_OUT))
        : 1;

  return (
    <div className="mt-3.5">
      {/* the road the cab runs along */}
      <div aria-hidden="true" className="relative h-4 w-full">
        <svg viewBox="0 0 400 16" preserveAspectRatio="none" className="h-full w-full">
          <path d="M0 11 H400" stroke="rgba(255,255,255,.10)" strokeWidth="6" strokeLinecap="round" />
          <path
            d="M0 11 H400"
            stroke="rgba(242,226,114,.4)" strokeWidth="1.3"
            strokeDasharray="5 9" strokeLinecap="round"
            className={reduced ? '' : 'animate-road-dash'}
          />
        </svg>
        <span
          className="absolute top-0 -translate-x-1/2"
          style={{ left: `${edge + drive * span}%`, opacity: fade }}
        >
          <MiniCar className="h-3 w-8 text-brand-200" />
        </span>
      </div>

      {/* the stages */}
      <ol
        className="relative mt-2 flex items-start justify-between"
        aria-label="A trip, from the first search to the last drop"
      >
        <span
          aria-hidden="true"
          className="absolute top-[13px] h-0.5 rounded-full bg-white/10"
          style={{ left: `${edge}%`, width: `${span}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-[13px] h-0.5 rounded-full bg-gradient-to-r from-brand-400 to-gold-300"
          style={{ left: `${edge}%`, width: `${drive * span}%`, opacity: fade }}
        />

        {JOURNEY.map(({ label, Icon }, i) => {
          const done = i < active;
          const now = i === active;
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center">
              <span
                className={`relative grid h-7 w-7 place-items-center rounded-full transition-colors duration-500 sm:h-8 sm:w-8 ${
                  now
                    ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white ring-1 ring-brand-200/50'
                    : done
                      ? 'bg-brand-500/25 text-brand-100 ring-1 ring-brand-300/25'
                      : 'bg-white/[0.06] text-white/30 ring-1 ring-white/10'
                }`}
              >
                <Icon className="relative h-[13px] w-[13px] sm:h-[15px] sm:w-[15px]" />
              </span>
              <span
                className={`mt-1 text-[7px] font-bold uppercase tracking-[0.05em] transition-colors duration-500 sm:mt-1.5 sm:text-[9px] ${
                  now ? 'text-white' : done ? 'text-white/55' : 'text-white/30'
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The faint marks scattered behind the card. */
const BACKDROP = [
  { Icon: IconPin, style: { top: '13%', left: '12%' }, size: 'h-10 w-10' },
  { Icon: IconRoad, style: { top: '48%', left: '7%' }, size: 'h-8 w-8' },
  { Icon: IconSearch, style: { bottom: '15%', left: '16%' }, size: 'h-9 w-9' },
  { Icon: IconBookings, style: { top: '10%', right: '14%' }, size: 'h-9 w-9' },
  { Icon: IconMap, style: { top: '46%', right: '8%' }, size: 'h-11 w-11' },
  { Icon: IconSteering, style: { bottom: '14%', right: '17%' }, size: 'h-8 w-8' },
  { Icon: IconCheck, style: { top: '27%', left: '29%' }, size: 'h-6 w-6' },
  { Icon: IconPhone, style: { bottom: '29%', right: '31%' }, size: 'h-6 w-6' },
] as const;

export default function Login() {
  useSeo({ title: 'Staff sign in', noindex: true });
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** 'signin' asks for a password; 'forgot' asks the office for a new one. */
  const [mode, setMode] = useState<'signin' | 'forgot'>('signin');
  const [sent, setSent] = useState('');

  useEffect(() => {
    if (user) navigate(user.mustChangePassword ? '/admin/change-password' : '/admin', { replace: true });
  }, [user, navigate]);

  /*
   * Ask the office to reset it.
   *
   * There is no link and no token — the request lands in the owner's inbox and
   * a person does the reset. The reply is the same whether or not the login ID
   * exists, so this cannot be used to find out which accounts are real, and
   * the screen says so plainly rather than implying a match was found.
   */
  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Enter your login ID and we will pass the request on.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setSent(data?.message ?? 'Thank you. The request has been passed on.');
    } catch (err) {
      setError(errorMessage(err, 'Could not send the request. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter your login ID and password.');
      return;
    }
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      navigate(u.mustChangePassword ? '/admin/change-password' : '/admin', { replace: true });
    } catch (err: any) {
      setError(err.message ?? 'Could not sign in.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#F3F8FC] px-4 py-5">
      {/* ---------------------------- backdrop ---------------------------- */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-[16rem] -top-[14rem] h-[34rem] w-[34rem] rounded-full bg-brand-200/35 blur-[120px]" />
        <div className="absolute -bottom-[18rem] -right-[12rem] h-[32rem] w-[32rem] rounded-full bg-gold-200/30 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(circle, rgba(28,163,222,.22) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 25%, transparent 78%)',
            WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 45%, #000 25%, transparent 78%)',
          }}
        />
        {BACKDROP.map(({ Icon, style, size }, i) => (
          <Icon
            key={i}
            className={`absolute hidden text-brand-500/15 sm:block ${size}`}
            style={style as React.CSSProperties}
          />
        ))}
      </div>

      <div className="animate-fade-up relative w-full max-w-[24rem] sm:max-w-[27rem]">
        <div className="overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-ink-200/60">

          {/* ---------------------------- header --------------------------- */}
          <div className="relative overflow-hidden bg-gradient-to-br from-[#08243A] via-[#0E3F60] to-[#0C5E88] px-4 pb-4 pt-4 text-center sm:px-6 sm:pb-5 sm:pt-5">
            <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-brand-300 to-gold-400" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-14 left-1/2 h-32 w-60 -translate-x-1/2 rounded-full bg-brand-400/25 blur-3xl"
            />

            <Link
              to="/"
              className="group relative inline-flex items-center gap-3 transition-opacity duration-200 hover:opacity-90 sm:gap-3.5"
            >
              {/* No tile, no ring, no card. The line art is filtered to pure
                  white and drawn large enough to hold its own against the
                  wordmark — a container was only ever propping it up. */}
              <img
                src="/assets/art-car-line-bold.svg"
                alt=""
                className="h-auto w-14 shrink-0 brightness-0 invert opacity-95 sm:w-16"
              />

              <span className="text-left">
                <span className="block font-display text-[17px] font-bold leading-none tracking-[-0.015em] text-white sm:text-[19px]">
                  Gupta Tours <span className="text-brand-300">&amp;</span> Travels
                </span>
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="h-px w-4 bg-gold-300/40" aria-hidden="true" />
                  <span className="text-[8px] font-bold uppercase tracking-[0.26em] text-gold-300/85 sm:text-[9px]">
                    {COMPANY.serviceHours.replace('Service', '').trim()} · Mumbai
                  </span>
                </span>
              </span>
            </Link>

            <p className="relative mt-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1 text-[10px] font-semibold tracking-wide text-white/75 ring-1 ring-white/10 sm:text-[11px]">
              <IconShield className="h-3 w-3 text-gold-300" />
              Booking, Billing &amp; Invoice Portal
            </p>

            <JourneyTrack />
          </div>

          {/* ----------------------------- form ---------------------------- */}
          <div className="px-5 py-5 sm:px-7 sm:py-6">
            <h1 className="font-display text-lg font-extrabold tracking-[-0.02em] text-ink-900 sm:text-xl">
              {mode === 'signin' ? 'Sign in to your account' : 'Forgotten your password?'}
            </h1>
            <p className="mt-1 text-xs text-ink-500 sm:mt-1.5 sm:text-sm">
              {mode === 'signin'
                ? 'Use the login ID and password your administrator issued you.'
                : `Enter your login ID. ${COMPANY.owner} will be asked to set a new password and will come back to you with it.`}
            </p>

            {error && (
              <div
                role="alert"
                className="animate-fade-down mt-3 flex gap-2 rounded-lg border border-danger-100 bg-danger-50 p-2.5 text-xs text-danger-700"
              >
                <IconWarning className="mt-px h-4 w-4 shrink-0" />
                <p className="whitespace-pre-line leading-relaxed">{error}</p>
              </div>
            )}

            {mode === 'signin' && (
            <form onSubmit={submit} className="mt-4 space-y-3 sm:mt-5 sm:space-y-4" noValidate>
              <div>
                <label htmlFor="login-id" className="block text-xs font-semibold text-ink-800">
                  Login ID
                </label>
                <div className="group relative mt-1">
                  <IconUsers className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 transition-colors group-focus-within:text-brand-600" />
                  <input
                    id="login-id"
                    className="input h-11 rounded-lg pl-9 sm:h-12 sm:rounded-xl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. admin@guptatours.in"
                    autoComplete="username"
                    autoFocus
                  />
                </div>
              </div>

              <div>
                <label htmlFor="login-pass" className="block text-xs font-semibold text-ink-800">
                  Password
                </label>
                <div className="group relative mt-1">
                  <IconLock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 transition-colors group-focus-within:text-brand-600" />
                  <input
                    id="login-pass"
                    className="input h-11 rounded-lg pl-9 pr-14 sm:h-12 sm:rounded-xl"
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide the password' : 'Show the password'}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-2xs font-bold uppercase tracking-wide text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
                  >
                    {showPass ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="group relative h-11 w-full overflow-hidden rounded-lg bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 text-sm font-semibold text-white shadow-raised transition-shadow duration-200 hover:shadow-lift disabled:opacity-70 sm:h-12 sm:rounded-xl sm:text-md"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-12 bg-white/25 transition-all duration-700 ease-out group-hover:left-[130%] motion-reduce:hidden"
                />
                <span className="relative inline-flex items-center justify-center gap-2">
                  {busy ? <Spinner className="h-4 w-4" /> : <IconKey className="h-4 w-4" />}
                  {busy ? 'Signing in…' : 'Sign in'}
                </span>
              </button>
            </form>
            )}

            {mode === 'signin' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setError(''); setSent(''); setPassword(''); }}
                className="mt-3.5 block w-full text-center text-xs font-semibold text-brand-700 transition-colors hover:text-brand-800 sm:mt-4"
              >
                Forgotten your password?
              </button>
            )}

            {/* ------------------------ reset request ---------------------- */}
            {mode === 'forgot' && (
              <>
                {sent ? (
                  <div
                    role="status"
                    className="animate-fade-up mt-4 flex gap-2.5 rounded-lg border border-ok-100 bg-ok-50 p-3 text-xs leading-relaxed text-ok-700"
                  >
                    <IconCheck className="mt-px h-4 w-4 shrink-0" />
                    <p>{sent}</p>
                  </div>
                ) : (
                  <form onSubmit={requestReset} className="mt-4 space-y-3 sm:mt-5 sm:space-y-4" noValidate>
                    <div>
                      <label htmlFor="reset-id" className="block text-xs font-semibold text-ink-800">
                        Login ID
                      </label>
                      <div className="group relative mt-1">
                        <IconUsers className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400 transition-colors group-focus-within:text-brand-600" />
                        <input
                          id="reset-id"
                          className="input h-11 rounded-lg pl-9 sm:h-12 sm:rounded-xl"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="e.g. admin@guptatours.in"
                          autoComplete="username"
                          autoFocus
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={busy}
                      className="group relative h-11 w-full overflow-hidden rounded-lg bg-gradient-to-r from-brand-700 via-brand-600 to-brand-500 text-sm font-semibold text-white shadow-raised transition-shadow duration-200 hover:shadow-lift disabled:opacity-70 sm:h-12 sm:rounded-xl sm:text-md"
                    >
                      <span className="relative inline-flex items-center justify-center gap-2">
                        {busy ? <Spinner className="h-4 w-4" /> : <IconMail className="h-4 w-4" />}
                        {busy ? 'Sending…' : 'Send the request'}
                      </span>
                    </button>
                  </form>
                )}

                <button
                  type="button"
                  onClick={() => { setMode('signin'); setError(''); setSent(''); }}
                  className="group mt-3.5 flex w-full items-center justify-center gap-1.5 text-xs font-semibold text-brand-700 transition-colors hover:text-brand-800 sm:mt-4"
                >
                  <IconArrowRight className="h-3 w-3 rotate-180 transition-transform group-hover:-translate-x-0.5" />
                  Back to sign in
                </button>
              </>
            )}
          </div>

          {/* --------------------------- footer ---------------------------- */}
          <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1 border-t border-ink-100 bg-ink-50/70 px-4 py-2.5 sm:gap-x-5 sm:py-3">
            {TRUST.map(({ Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1 text-2xs font-medium text-ink-500">
                <Icon className="h-3 w-3 text-brand-500" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <Link
          to="/"
          className="group mt-3 flex items-center justify-center gap-1.5 text-2xs font-medium text-ink-500 transition-colors hover:text-brand-600"
        >
          <IconArrowRight className="h-3 w-3 rotate-180 transition-transform group-hover:-translate-x-0.5" />
          Back to the website
        </Link>
      </div>
    </div>
  );
}
