/**
 * Role permissions — what each role may see and do, module by module.
 *
 * The server enforces every one of these on every request; the sidebar and
 * the buttons only follow them. The Super Admin role always has everything.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Spinner } from '../components/ui';
import { IconLock } from '../components/icons';

const MODULE_LABEL: Record<string, { label: string; blurb: string }> = {
  dashboard: { label: 'Dashboard', blurb: 'The overview and global search' },
  bookings: { label: 'Trips & bookings', blurb: 'Enquiries, trips, bookings, feedback, chats' },
  vendors: { label: 'Vendors', blurb: 'Vendor accounts and the outstation card' },
  masters: { label: 'Masters', blurb: 'Categories, fare rules, lists, locations' },
  fleet: { label: 'Fleet', blurb: 'Vehicles, drivers, availability, documents' },
  billing: { label: 'Billing', blurb: 'Billing queue, batches, approvals, corrections' },
  invoices: { label: 'Invoices', blurb: 'Generate, send, cancel, download' },
  payments: { label: 'Payments', blurb: 'Receipts, reversals, supplier payouts' },
  reports: { label: 'Reports', blurb: 'All reports and their exports' },
  onsheet: { label: 'OnSheet', blurb: 'Spreadsheet workspace (per-file sharing applies too)' },
  settings: { label: 'Settings', blurb: 'Company, invoice, email and website settings' },
  users: { label: 'Users', blurb: 'Staff accounts and these permissions' },
  audit: { label: 'Audit log', blurb: 'Who did what, and when' },
};
const ACTIONS = ['view', 'create', 'update', 'delete'] as const;
const ACTION_LABEL: Record<string, string> = { view: 'View', create: 'Create', update: 'Edit', delete: 'Delete' };

export default function RolePermissions({ roles, onSaved }: { roles: any[]; onSaved: () => void }) {
  const toast = useToast();
  const { can, user } = useAuth();
  const [perms, setPerms] = useState<{ code: string; module: string }[]>([]);
  const [roleId, setRoleId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/users/permissions').then((r) => setPerms(r.data.data ?? [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (roleId == null && roles.length) setRoleId(roles.find((r) => r.code !== 'SUPER_ADMIN')?.id ?? roles[0].id);
  }, [roles, roleId]);

  const role = roles.find((r) => r.id === roleId);
  useEffect(() => { setDraft(new Set(role?.permissions ?? [])); }, [role]);

  const modules = useMemo(() => {
    const order = Object.keys(MODULE_LABEL);
    return Array.from(new Set(perms.map((p) => p.module))).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [perms]);
  const has = (code: string) => perms.some((p) => p.code === code);
  const locked = role?.code === 'SUPER_ADMIN' || !can('users.update');
  const dirty = role && (draft.size !== role.permissions.length || role.permissions.some((p: string) => !draft.has(p)));

  const toggle = (code: string) => {
    if (locked) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
        // Without view, the other actions on a module have nothing to act on.
        if (code.endsWith('.view')) ACTIONS.forEach((a) => next.delete(code.replace('.view', `.${a}`)));
      } else {
        next.add(code);
        if (!code.endsWith('.view')) {
          const view = code.replace(/\.[a-z]+$/, '.view');
          if (has(view)) next.add(view);
        }
      }
      return next;
    });
  };

  const save = async () => {
    if (!role) return;
    setBusy(true);
    try {
      const { data } = await api.put(`/users/roles/${role.id}/permissions`, { permissions: Array.from(draft) });
      toast.success('Permissions saved', data.message);
      onSaved();
    } catch (err) {
      toast.error('Could not save the permissions', errorMessage(err));
    } finally { setBusy(false); }
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Roles and permissions</h2>
          <p className="card-sub">The server checks these on every request. Changes apply the next time each user's page loads.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {roles.map((r) => (
            <button key={r.id} onClick={() => setRoleId(r.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${roleId === r.id ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'}`}>
              {r.name}
            </button>
          ))}
        </div>
      </div>
      {role && (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-5 py-3 text-sm">
            <p className="text-ink-600">{role.description}</p>
            {role.code === 'SUPER_ADMIN' && <span className="badge-neutral"><IconLock className="h-3 w-3" /> Always has every permission</span>}
            {role.code === user?.roleCode && role.code !== 'SUPER_ADMIN' && <span className="badge-warn">Your own role</span>}
          </div>
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Module</th>
                  {ACTIONS.map((a) => <th key={a} className="text-center">{ACTION_LABEL[a]}</th>)}
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m}>
                    <td>
                      <p className="font-medium text-ink-900">{MODULE_LABEL[m]?.label ?? m}</p>
                      <p className="cell-meta">{MODULE_LABEL[m]?.blurb}</p>
                    </td>
                    {ACTIONS.map((a) => {
                      const code = `${m}.${a}`;
                      if (!has(code)) return <td key={a} className="text-center text-ink-300">—</td>;
                      const on = role.code === 'SUPER_ADMIN' || draft.has(code);
                      return (
                        <td key={a} className="text-center">
                          <input type="checkbox" className="check" checked={on} disabled={locked}
                            aria-label={`${MODULE_LABEL[m]?.label ?? m}: ${ACTION_LABEL[a]}`} onChange={() => toggle(code)} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!locked && (
            <div className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3">
              {dirty && <p className="mr-auto text-xs text-ink-500">Unsaved changes to {role.name}</p>}
              <button className="btn-outline btn-sm" disabled={!dirty || busy} onClick={() => setDraft(new Set(role.permissions))}>Discard</button>
              <button className="btn-primary btn-sm" disabled={!dirty || busy} onClick={save}>{busy && <Spinner />} Save {role.name}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
