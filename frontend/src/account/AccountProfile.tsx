/**
 * Profile & password.
 *
 * The details here are the ones the office holds against your trips and
 * prints on your invoices — name, mobile, company, GSTIN, billing address.
 * An account that has only ever used Google can set a password here too.
 */
import { useState } from 'react';
import { useCustomerAuth, customerApi } from '../lib/customerAuth';
import { errorMessage } from '../lib/api';
import { Field, PageHeader, SectionCard, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAccount } from './AccountLayout';

export default function AccountProfile() {
  const { user } = useAccount();
  const { updateProfile, refresh } = useCustomerAuth();
  const toast = useToast();

  const [form, setForm] = useState({
    fullName: user.fullName, mobile: user.mobile ?? '', company: user.company ?? '',
    gstin: user.gstin ?? '', address: user.address ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile saved', 'New invoices will carry these details.');
    } catch (err) {
      toast.error('Could not save your profile', errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwBusy) return;
    setPwBusy(true);
    setPwError('');
    try {
      const { data } = await customerApi.post('/auth/change-password', pw);
      toast.success(data.message ?? 'Your password has been changed.');
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' });
      await refresh();
    } catch (err) {
      setPwError(errorMessage(err, 'Your password could not be changed.'));
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Profile" subtitle="The details we hold against your trips and print on your invoices." />

      <div className="grid gap-4 xl:grid-cols-5">
        <SectionCard title="Your details" subtitle={<span data-no-i18n>{user.email}</span>} className="xl:col-span-3">
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              <input className="input" value={form.fullName} onChange={set('fullName')} required minLength={2} maxLength={120} />
            </Field>
            <Field label="Mobile" hint="10 digits — the office calls this number about your trips">
              <input className="input" value={form.mobile} onChange={set('mobile')} inputMode="numeric" maxLength={14} />
            </Field>
            <Field label="Company" hint="Optional — printed on the invoice">
              <input className="input" value={form.company} onChange={set('company')} maxLength={160} />
            </Field>
            <Field label="GSTIN" hint="Optional — for a GST invoice in your company's name">
              <input className="input uppercase" value={form.gstin} onChange={set('gstin')} maxLength={20} />
            </Field>
            <Field label="Billing address" className="sm:col-span-2">
              <textarea className="input min-h-[5rem]" value={form.address} onChange={set('address')} maxLength={400} />
            </Field>
            <div className="sm:col-span-2">
              <button className="btn-primary" disabled={saving}>{saving && <Spinner />} Save details</button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title={user.hasPassword ? 'Change password' : 'Set a password'}
          subtitle={user.hasPassword ? undefined : 'You sign in with Google. A password lets you sign in without it too.'}
          className="xl:col-span-2">
          <form onSubmit={changePassword} className="space-y-4">
            {user.hasPassword && (
              <Field label="Current password" required>
                <input type="password" className="input" autoComplete="current-password" value={pw.currentPassword}
                  onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} required />
              </Field>
            )}
            <Field label="New password" required hint="At least 8 characters">
              <input type="password" className="input" autoComplete="new-password" value={pw.newPassword}
                onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} required minLength={8} />
            </Field>
            <Field label="Confirm new password" required error={pwError}>
              <input type="password" className="input" autoComplete="new-password" value={pw.confirmPassword}
                onChange={(e) => setPw((p) => ({ ...p, confirmPassword: e.target.value }))} required minLength={8} />
            </Field>
            <button className="btn-primary" disabled={pwBusy}>{pwBusy && <Spinner />} {user.hasPassword ? 'Change password' : 'Set password'}</button>
          </form>
        </SectionCard>
      </div>
    </div>
  );
}
