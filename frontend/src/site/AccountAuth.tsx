/**
 * Customer sign-in and sign-up.
 *
 * Two ways in, both free to run: an email address with a password, or Google.
 * The Google button only appears when a client ID has been configured in
 * Settings — an unconfigured portal shows the password form alone rather than a
 * button that fails when tapped.
 *
 * This is NOT the staff login at /login. A customer who lands here gets their
 * own trips; nothing on this screen can reach the admin portal.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { googleConfig, loadGoogleScript, useCustomerAuth } from '../lib/customerAuth';
import { cleanMobile, validMobile, SoftField, SOFT_INPUT } from './kit';
import { COMPANY } from './siteData';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck, IconLock, IconMail, IconPhone, IconUsers } from '../components/icons';

type Mode = 'signin' | 'signup';

const PROMISES = [
  'Every trip under its own Trip ID',
  'Live status from enquiry to completion',
  'Vehicle and chauffeur details once allotted',
  'GST and non-GST invoices, ready to download',
];

export default function AccountAuth() {
  const [params] = useSearchParams();
  const location = useLocation() as { state?: { from?: string } };
  const navigate = useNavigate();
  const { user, signIn, signUp, signInWithGoogle } = useCustomerAuth();

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [confirm, setConfirm] = useState('');

  const next = location.state?.from ?? params.get('next') ?? '/trips';

  // Already signed in? There is nothing to do on this screen.
  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (mode === 'signup') {
      if (fullName.trim().length < 2) return setError('Please enter your name.');
      if (!validMobile(mobile)) return setError('Enter a valid 10-digit mobile number.');
      if (password !== confirm) return setError('The two passwords do not match.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return setError('Enter a valid email address.');
    }
    if (password.length < 1) return setError('Enter your password.');

    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const r = await signUp({
          fullName: fullName.trim(),
          email: email.trim(),
          mobile: cleanMobile(mobile),
          password,
          confirmPassword: confirm,
        });
        if (r.linkedTrips > 0) setNotice(r.message);
      }
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err.message ?? 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-bg pb-24 pt-28 sm:pt-32">
      <div className="shell">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[1fr,22rem] lg:items-start">

          {/* ---------------------------- the form --------------------------- */}
          <Reveal className="tile p-6 sm:p-8">
            <p className="lead">Your account</p>
            <h1 className="mt-1 font-display text-[1.75rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.1rem]">
              {mode === 'signin' ? 'Sign in to see your trips' : 'Create your account'}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-500">
              {mode === 'signin'
                ? 'Your Trip IDs, live status, allotted vehicle and driver, and every invoice — in one place.'
                : 'Use the email address you gave us on your enquiries and we will attach those trips to your account automatically.'}
            </p>

            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="mt-6 grid max-w-sm grid-cols-2 gap-1 rounded-full bg-ink-100 p-1"
            >
              {([['signin', 'Sign in'], ['signup', 'Create account']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => { setMode(m); setError(''); }}
                  className={`h-10 rounded-full text-sm font-semibold transition-all duration-150 ${
                    mode === m
                      ? 'bg-white text-ink-900 shadow-xs'
                      : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <GoogleButton
              onCredential={async (credential) => {
                setBusy(true); setError('');
                try {
                  await signInWithGoogle(credential);
                  navigate(next, { replace: true });
                } catch (err: any) {
                  setError(err.message ?? 'Google could not sign you in.');
                } finally {
                  setBusy(false);
                }
              }}
            />

            <form onSubmit={submit} noValidate className="mt-5 space-y-3">
              {mode === 'signup' && (
                <SoftField label="Your name" icon={<IconUsers className="h-3 w-3" />}>
                  <input
                    className={SOFT_INPUT} value={fullName} autoComplete="name"
                    onChange={(e) => setFullName(e.target.value)} placeholder="Full name"
                  />
                </SoftField>
              )}

              <SoftField label="Email ID" icon={<IconMail className="h-3 w-3" />}>
                <input
                  className={SOFT_INPUT} value={email} type="email" inputMode="email" autoComplete="email"
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                />
              </SoftField>

              {mode === 'signup' && (
                <SoftField label="Mobile number" icon={<IconPhone className="h-3 w-3" />}>
                  <input
                    className={SOFT_INPUT} value={mobile} inputMode="numeric" autoComplete="tel" maxLength={13}
                    onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile"
                  />
                </SoftField>
              )}

              <SoftField label="Password" icon={<IconLock className="h-3 w-3" />}>
                <div className="relative">
                  <input
                    className={`${SOFT_INPUT} pr-14`} value={password}
                    type={showPass ? 'text' : 'password'}
                    autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass((v) => !v)}
                    aria-label={showPass ? 'Hide the password' : 'Show the password'}
                    className="absolute right-0 top-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-2xs font-bold uppercase tracking-wide text-ink-500 transition-colors hover:text-brand-700"
                  >
                    {showPass ? 'Hide' : 'Show'}
                  </button>
                </div>
              </SoftField>

              {mode === 'signup' && (
                <SoftField label="Confirm password" icon={<IconLock className="h-3 w-3" />}>
                  <input
                    className={SOFT_INPUT} value={confirm} type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    onChange={(e) => setConfirm(e.target.value)} placeholder="Type it once more"
                  />
                </SoftField>
              )}

              {error && (
                <p role="alert" className="animate-fade-up rounded-2xl bg-danger-50 px-4 py-3 text-sm leading-relaxed text-danger-700">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="animate-fade-up rounded-2xl bg-ok-50 px-4 py-3 text-sm leading-relaxed text-ok-700">
                  {notice}
                </p>
              )}

              <button
                type="submit" disabled={busy}
                className="grad-brand btn h-12 w-full rounded-full text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99] disabled:opacity-70"
              >
                {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create my account'}
                {!busy && <IconArrowRight className="h-4 w-4" />}
              </button>
            </form>

            <p className="mt-6 border-t border-ink-100 pt-5 text-xs leading-relaxed text-ink-400">
              Forgotten your password? There is no reset email yet —{' '}
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="font-semibold text-brand-700">call the office</a>{' '}
              and they will help, or sign in with Google using the same address.
            </p>
          </Reveal>

          {/* ------------------------- what you get -------------------------- */}
          <Reveal delay={80}>
            <div className="rounded-[1.75rem] bg-nav p-6 text-white/90 sm:p-7">
              <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-300">In your account</p>
              <h2 className="mt-2 font-display text-lg font-bold text-white">
                Every journey, start to invoice
              </h2>
              <ul className="mt-5 space-y-3">
                {PROMISES.map((p, i) => (
                  <li key={p} className="flex animate-fade-up items-start gap-2.5 text-sm leading-relaxed" style={{ animationDelay: `${i * 70}ms` }}>
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-6 border-t border-white/10 pt-5 text-xs leading-relaxed text-white/55">
                Already enquired without an account? Sign up with the same email address and those trips
                attach themselves. Otherwise you can add one by its Trip ID from{' '}
                <Link to="/trips" className="font-semibold text-brand-300 hover:text-brand-200">My trips</Link>.
              </p>
            </div>

            <div className="tile mt-5 p-5">
              <p className="text-sm font-semibold text-ink-900">Looking for the staff portal?</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-500">
                Vendors and office staff sign in separately.
              </p>
              <Link to="/login" className="btn mt-3 h-10 rounded-full bg-ink-50 px-4 text-sm font-semibold text-ink-700 hover:bg-ink-100">
                <IconLock className="h-3.5 w-3.5" /> Partner login
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================
   Google Sign-In
   ========================================================================== */

/**
 * Google's own rendered button.
 *
 * It renders itself into a div, so this waits for both the config and the
 * script before asking for it. Anything that goes wrong — no client ID, no
 * internet, an extension blocking the script — simply means the button is not
 * there, and the password form beside it still works.
 */
function GoogleButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Kept in a ref so re-rendering the parent never re-initialises the widget.
  const handler = useRef(onCredential);
  handler.current = onCredential;

  useEffect(() => {
    let alive = true;

    (async () => {
      const cfg = await googleConfig();
      if (!alive || !cfg.enabled || !cfg.clientId) return;

      try {
        await loadGoogleScript();
      } catch {
        if (alive) setFailed(true);
        return;
      }
      if (!alive || !host.current || !window.google?.accounts?.id) return;

      window.google.accounts.id.initialize({
        client_id: cfg.clientId,
        callback: (res: { credential?: string }) => {
          if (res?.credential) handler.current(res.credential);
        },
      });
      window.google.accounts.id.renderButton(host.current, {
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        width: 320,
        text: 'continue_with',
        logo_alignment: 'center',
      });
      setReady(true);
    })();

    return () => { alive = false; };
  }, []);

  if (failed) return null;

  return (
    <div className={ready ? 'animate-fade-up mt-6' : 'mt-6'}>
      <div ref={host} className="flex justify-center [&>div]:!w-full" />
      {ready && (
        <div className="mt-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">or with your email</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>
      )}
    </div>
  );
}
