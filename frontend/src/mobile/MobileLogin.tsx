import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { getServerUrl } from '../lib/serverUrl';
import { Spinner } from '../components/ui';
import { IconWarning, IconLock } from '../components/icons';
import { ServerForm } from './ServerScreen';
import { APP_ROLES, roleLabel } from './roles';

export default function MobileLogin() {
  const { login } = useAuth();
  const navigate = useNavigate();

  // With no address saved there is nothing to sign in to, so the address is the
  // first thing asked for rather than an option buried under the form.
  const [showServer, setShowServer] = useState(!getServerUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await login(email.trim(), password);
      if (!APP_ROLES.includes(user.roleCode)) {
        setError(
          `This app is for ${APP_ROLES.map(roleLabel).join(' and ')} accounts only. ` +
          `Your account is ${user.roleName}. Please use the portal in a web browser.`
        );
        setBusy(false);
        return;
      }
      navigate(user.mustChangePassword ? '/admin/change-password' : '/admin', { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <div className="app-login flex min-h-screen flex-col justify-center bg-ink-900 p-5">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-7 text-center">
          {/* Sized by height; the car mark is about 3:1 and a square box squashed it. */}
          <img src={`${import.meta.env.BASE_URL}app-icon.svg`} alt="" className="mx-auto mb-4 h-14 w-auto" />
          <h1 className="font-display text-xl font-bold text-white">Gupta Tours &amp; Travels</h1>
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-brand-300">
            Business Portal
          </p>
        </div>

        <div className="card card-pad">
          {showServer ? (
            <>
              <h2 className="card-title mb-1">Connect to the portal</h2>
              <p className="card-sub mb-4">Set the portal address once. You can change it later.</p>
              <ServerForm submitLabel="Save and continue" onSaved={() => setShowServer(false)} />
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label" htmlFor="email">Login ID</label>
                <input
                  id="email"
                  className="input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="email"
                  autoComplete="username"
                  required
                />
              </div>

              <div>
                <label className="label" htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">
                  <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <button className="btn btn-primary btn-lg w-full" disabled={busy} type="submit">
                {busy ? <Spinner /> : <IconLock className="h-4 w-4" />} Sign in
              </button>
            </form>
          )}
        </div>

        <button
          onClick={() => setShowServer((v) => !v)}
          className="mx-auto mt-4 block text-center text-xs text-ink-400 underline-offset-4 active:underline"
          type="button"
        >
          {showServer ? 'Back to sign in' : `Portal address: ${getServerUrl() || 'not set'}`}
        </button>
      </div>
    </div>
  );
}
