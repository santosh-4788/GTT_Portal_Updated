import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmyTime } from '../lib/format';
import { Loading, EmptyState, ErrorState, Modal, Spinner, Field, ConfirmDialog, StatusBadge } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import RolePermissions from './RolePermissions';
import { IconEdit, IconTrash, IconPlus } from '../components/icons';

const EMPTY = { email: '', fullName: '', roleCode: 'OPERATIONS', mobile: '', password: '', isActive: true };

export default function Users() {
  const [rows, setRows] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<any>(null);
  const toast = useToast();
  const { can, user: me } = useAuth();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [u, r] = await Promise.all([api.get('/users'), api.get('/users/roles')]);
      setRows(u.data.data ?? []);
      setRoles(r.data.data ?? []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    setBusy(true);
    try {
      if (form.id) {
        const payload = { ...form };
        if (!payload.password) delete payload.password;
        await api.put(`/users/${form.id}`, payload);
        toast.success(`${form.fullName} updated`, form.password ? 'They will be asked to change the password at next sign-in.' : undefined);
      } else {
        await api.post('/users', form);
        toast.success(`${form.fullName} added`, 'They will be asked to change the password at first sign-in.');
      }
      setForm(null);
      load();
    } catch (err) {
      toast.error('Could not save the user', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/users/${toDelete.id}`);
      toast.success(data.message ?? `${toDelete.full_name} removed`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not remove the user', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Users &amp; roles</h1>
          <p className="page-sub">
            Each role sees only the modules it needs. Passwords are hashed with bcrypt and never stored in plain text.
          </p>
        </div>
        {can('users.create') && (
          <button onClick={() => setForm({ ...EMPTY })} className="btn-primary btn-sm"><IconPlus className="h-3.5 w-3.5" /> Add user</button>
        )}
      </div>

      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : (
        <>
          <div className="table-wrap table-scroll">
            <table className="tbl">
              <thead>
                <tr><th>Name</th><th>Login ID</th><th>Role</th><th>Mobile</th><th>Status</th><th>Last sign-in</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <p className="font-medium text-ink-900">{u.full_name}</p>
                      {u.id === me?.id && <span className="text-[11px] text-brand-600">You</span>}
                    </td>
                    <td className="text-sm text-ink-700">{u.email}</td>
                    <td><span className="badge-brand">{u.role_name}</span></td>
                    <td className="text-sm text-ink-600">{u.mobile || '—'}</td>
                    <td className="space-x-1">
                      <StatusBadge value={u.is_active ? 'ACTIVE' : 'INACTIVE'} />
                      {!!u.must_change_password && (
                        <span className="badge-warn">Password change due</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink-500">
                      {u.last_login_at ? dmyTime(u.last_login_at) : 'Never'}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {can('users.update') && (
                          <button
                            onClick={() => setForm({
                              id: u.id, email: u.email, fullName: u.full_name, roleCode: u.role_code,
                              mobile: u.mobile ?? '', password: '', isActive: !!u.is_active,
                            })}
                            className="btn-ghost btn-sm" aria-label={`Edit ${u.full_name}`}
                          >
                            <IconEdit className="h-4 w-4" />
                          </button>
                        )}
                        {can('users.delete') && u.id !== me?.id && (
                          <button onClick={() => setToDelete(u)} className="btn-ghost btn-sm text-danger-600" aria-label={`Remove ${u.full_name}`}><IconTrash className="h-4 w-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <RolePermissions roles={roles} onSaved={load} />
        </>
      )}

      <Modal
        open={!!form} onClose={() => setForm(null)}
        title={form?.id ? 'Edit user' : 'Add user'} size="sm"
        footer={
          <>
            <button className="btn-outline" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            <button className="btn-primary" onClick={save} disabled={busy}>
              {busy && <Spinner className="h-4 w-4" />} {form?.id ? 'Save changes' : 'Add user'}
            </button>
          </>
        }
      >
        {form && (
          <div className="space-y-4">
            <Field label="Full name" required>
              <input className="input" value={form.fullName} onChange={(e) => setForm((f: any) => ({ ...f, fullName: e.target.value }))} />
            </Field>
            <Field label="Login ID (email)" required>
              <input className="input" type="email" value={form.email}
                onChange={(e) => setForm((f: any) => ({ ...f, email: e.target.value }))} />
            </Field>
            <div className="stagger grid gap-4 sm:grid-cols-2">
              <Field label="Role" required>
                <select className="input" value={form.roleCode}
                  onChange={(e) => setForm((f: any) => ({ ...f, roleCode: e.target.value }))}>
                  {roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </Field>
              <Field label="Mobile">
                <input className="input" inputMode="numeric" value={form.mobile}
                  onChange={(e) => setForm((f: any) => ({ ...f, mobile: e.target.value }))} />
              </Field>
            </div>
            <Field
              label={form.id ? 'New password (leave blank to keep the current one)' : 'Initial password'}
              required={!form.id}
              hint="At least 8 characters, with a letter and a number. The user must change it at next sign-in."
            >
              <input className="input" type="text" value={form.password}
                onChange={(e) => setForm((f: any) => ({ ...f, password: e.target.value }))} />
            </Field>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <input type="checkbox" className="check" checked={form.isActive}
                onChange={(e) => setForm((f: any) => ({ ...f, isActive: e.target.checked }))} />
              <span className="font-medium text-ink-800">Account is active</span>
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} busy={busy} danger
        title="Remove this user?" confirmLabel="Remove user"
        body={
          <>
            <p><strong>{toDelete?.full_name}</strong> ({toDelete?.email})</p>
            <p className="mt-2 text-ink-500">
              Users with activity history are deactivated rather than deleted, so the audit trail stays intact.
            </p>
          </>
        }
      />
    </div>
  );
}
