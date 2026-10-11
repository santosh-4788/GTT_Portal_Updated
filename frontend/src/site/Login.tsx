import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, errorMessage } from '../lib/api';
import { Spinner } from '../components/ui';
import { COMPANY } from './siteData';
import {
  IconBookings, IconCheck, IconInvoices, IconPayments,
  IconShield, IconLock, IconKey, IconWarning, IconUsers, IconClock, IconArrowRight, IconMail,
} from '../components/icons';
import { useSeo } from './Seo';

/* ==========================================================================
   Staff sign-in — split screen.

   Left: the brand on the portal's navy, with what the portal is for. Right:
   the form, on white, with nothing else competing for attention. On a phone
   the brand panel shrinks to a strip above the form.
   ========================================================================== */

const TRUST = [
  { Icon: IconShield, label: 'GST registered' },
  { Icon: IconClock, label: COMPANY.serviceHours },
  { Icon: IconLock, label: 'Private portal' },
] as const;

/** What staff do here, in the order a trip moves through the office. */
const FEATURES = [
  { Icon: IconBookings, title: 'Bookings & trips', body: 'Company messages, walk-ins and events, allotted to the fleet.' },
  { Icon: IconInvoices, title: 'Billing & invoices', body: 'Confirm the final charges and raise GST invoices.' },
  { Icon: IconPayments, title: 'Payments & ledger', body: 'Receipts, outstanding and every company’s ledger.' },
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
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      {/* ------------------------------ brand panel ------------------------------ */}
      <aside className="relative overflow-hidden bg-gradient-to-br from-[#08243A] via-[#0E3F60] to-[#0C5E88] px-6 py-6 text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:px-12 lg:py-12">
        <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-brand-300 to-gold-400" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-gold-300/10 blur-3xl" />
        <img src="/assets/art-car-line-bold.svg" alt="" aria-hidden="true"
          className="pointer-events-none absolute -bottom-6 right-6 hidden w-[22rem] brightness-0 invert opacity-[0.06] lg:block" />

        <Link to="/" className="relative inline-flex items-center gap-3.5 transition-opacity hover:opacity-90">
          <img src="/assets/art-car-line-bold.svg" alt="" className="h-auto w-14 shrink-0 brightness-0 invert opacity-95 lg:w-16" />
          <span>
            <span className="block font-display text-[19px] font-bold leading-none tracking-[-0.015em] lg:text-[22px]">
              Gupta Tours <span className="text-brand-300">&amp;</span> Travels
            </span>
            <span className="mt-1.5 block text-[9px] font-bold uppercase tracking-[0.26em] text-gold-300/85 lg:text-[10px]">
              {COMPANY.serviceHours.replace('Service', '').trim()} · Mumbai
            </span>
          </span>
        </Link>

        <div className="relative mt-6 hidden lg:mt-0 lg:block">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/80 ring-1 ring-white/10">
            <IconShield className="h-3.5 w-3.5 text-gold-300" /> Booking, Billing &amp; Invoice Portal
          </p>
          <h2 className="mt-5 max-w-md font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-white">
            Every trip, from the first message to the last payment.
          </h2>
          <ul className="mt-8 space-y-5">
            {FEATURES.map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.08] text-brand-200 ring-1 ring-white/10">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-white/60">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mt-6 hidden flex-wrap gap-x-5 gap-y-2 lg:mt-0 lg:flex">
          {TRUST.map(({ Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/60">
              <Icon className="h-3.5 w-3.5 text-gold-300/80" /> {label}
            </span>
          ))}
        </div>
      </aside>

      {/* ------------------------------- form panel ------------------------------ */}
      <main className="flex flex-1 items-start justify-center px-5 py-8 sm:px-8 lg:items-center lg:py-12">
        <div className="animate-fade-up w-full max-w-sm">
          {/* ----------------------------- form ---------------------------- */}
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-900">
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

          <Link
            to="/"
            className="group mt-8 flex items-center justify-center gap-1.5 text-xs font-medium text-ink-500 transition-colors hover:text-brand-600"
          >
            <IconArrowRight className="h-3 w-3 rotate-180 transition-transform group-hover:-translate-x-0.5" />
            Back to the website
          </Link>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 lg:hidden">
            {TRUST.map(({ Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-1 text-2xs font-medium text-ink-500">
                <Icon className="h-3 w-3 text-brand-500" /> {label}
              </span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
