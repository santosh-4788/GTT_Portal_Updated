import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Field, Spinner } from '../components/ui';
import { IconWarning } from '../components/icons';
import { useToast } from '../components/Toast';

const RULES = [
  { test: (p: string) => p.length >= 8, label: 'At least 8 characters' },
  { test: (p: string) => /[A-Za-z]/.test(p), label: 'Contains a letter' },
  { test: (p: string) => /\d/.test(p), label: 'Contains a number' },
];

export default function ChangePassword() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const forced = !!user?.mustChangePassword;
  const passed = RULES.map((r) => r.test(form.newPassword));
  const allPassed = passed.every(Boolean);
  const matches = form.newPassword.length > 0 && form.newPassword === form.confirmPassword;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!allPassed) { setError('The new password does not meet all the requirements.'); return; }
    if (!matches) { setError('The two new passwords do not match.'); return; }
    if (form.newPassword === form.currentPassword) { setError('The new password must be different from the current one.'); return; }

    setBusy(true);
    try {
      await api.post('/auth/change-password', form);
      await refresh();
      toast.success('Password changed', 'Use the new password the next time you sign in.');
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-7">
        <h1 className="text-xl font-bold text-ink-900">
          {forced ? 'Set a new password' : 'Change password'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-600">
          {forced
            ? 'This account is still on its initial password. Choose a new one before using the portal.'
            : 'Choose a new password for your account.'}
        </p>

        {error && (
          <div className="mt-5 flex gap-2.5 rounded-lg border border-danger-100 bg-danger-50 p-3.5 text-sm text-danger-600">
            <IconWarning className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="whitespace-pre-line">{error}</p>
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <Field label="Current password" required>
            <input className="input" type="password" autoComplete="current-password" value={form.currentPassword}
              onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} />
          </Field>

          <Field label="New password" required>
            <input className="input" type="password" autoComplete="new-password" value={form.newPassword}
              onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
          </Field>

          <ul className="space-y-1.5 rounded-lg bg-ink-50 p-3.5">
            {RULES.map((r, i) => (
              <li key={r.label} className={`flex items-center gap-2 text-xs ${passed[i] ? 'text-ok-600' : 'text-ink-500'}`}>
                <span>{passed[i] ? '✓' : '○'}</span> {r.label}
              </li>
            ))}
          </ul>

          <Field label="Confirm new password" required
            error={form.confirmPassword && !matches ? 'The two passwords do not match.' : undefined}>
            <input className={`input ${form.confirmPassword && !matches ? 'input-error' : ''}`} type="password"
              autoComplete="new-password" value={form.confirmPassword}
              onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))} />
          </Field>

          <button type="submit" className="btn-primary w-full py-3" disabled={busy || !allPassed || !matches}>
            {busy && <Spinner className="h-4 w-4" />}
            {busy ? 'Saving…' : 'Change password'}
          </button>

          {!forced && (
            <button type="button" onClick={() => navigate('/admin')} className="btn-ghost w-full">
              Cancel
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
