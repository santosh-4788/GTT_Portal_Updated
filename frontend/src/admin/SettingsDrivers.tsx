/**
 * Settings → Drivers.
 *
 * The roster the office allots from. Until now a driver was two free-text
 * columns on the vehicle, which is fine for a booking sheet but cannot answer
 * "which trips did Ramesh run" or "whose licence expires next month".
 *
 * The booking still copies the name and number onto itself when a driver is
 * assigned — that is what the invoice and the customer's email print, and it
 * must not change retrospectively when somebody changes their phone.
 */
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { ConfirmDialog, Field, Modal, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { IconEdit, IconPlus, IconTrash, IconWarning } from '../components/icons';
import { DateField } from '../components/DateTimeField';

const EMPTY = {
  id: 0,
  fullName: '', mobile: '', altMobile: '',
  licenceNumber: '', licenceExpiry: '', badgeNumber: '',
  languages: '', experienceYears: '', defaultVehicleId: '', notes: '',
  isActive: true,
};
type Form = typeof EMPTY;

export function DriversPanel() {
  const toast = useToast();
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [editing, setEditing] = useState<Form | null>(null);
  const [toDelete, setToDelete] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([
        api.get('/settings/drivers', { params: { all: 1 } }),
        api.get('/settings/vehicles'),
      ]);
      setRows(d.data.data ?? []);
      setVehicles(v.data.data ?? []);
    } catch {
      /* the rest of Settings still works without this panel */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) {
        await api.put(`/settings/drivers/${editing.id}`, editing);
        toast.success(`${editing.fullName} updated`);
      } else {
        await api.post('/settings/drivers', editing);
        toast.success(`${editing.fullName} added to the roster`);
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error('Could not save the driver', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!toDelete) return;
    try {
      const { data } = await api.delete(`/settings/drivers/${toDelete.id}`);
      toast.success(data.message ?? 'Driver removed');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not remove the driver', errorMessage(err));
    }
  }

  const expiringSoon = (iso?: string) => {
    if (!iso) return false;
    const d = new Date(iso).getTime();
    return Number.isFinite(d) && d < Date.now() + 60 * 86_400_000;
  };

  return (
    <section className="section p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 pb-3">
        <div>
          <h2 className="font-semibold text-ink-900">Drivers</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Who the office can allot to a trip. Selecting a driver on a trip fills in their name and number.
          </p>
        </div>
        {can('settings.create', 'bookings.create') && (
          <button onClick={() => setEditing({ ...EMPTY })} className="btn-primary btn-sm">
            <IconPlus className="h-3.5 w-3.5" /> Add driver
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-ink-50 px-4 py-6 text-center text-sm text-ink-500">
          No drivers on the roster yet. Add one and they become selectable when allotting a trip.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th><th>Mobile</th><th>Licence</th><th>Usual vehicle</th>
                <th className="text-right">Trips</th><th>Status</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>
                    <span className="font-medium text-ink-900">{d.full_name}</span>
                    {d.languages && <span className="block text-2xs text-ink-500">{d.languages}</span>}
                  </td>
                  <td className="text-sm text-ink-700">
                    <a href={`tel:+91${d.mobile}`} className="hover:text-brand-700">{d.mobile}</a>
                  </td>
                  <td className="text-xs text-ink-600">
                    {d.licence_number || '—'}
                    {d.licence_expiry && (
                      <span className={`block text-2xs ${expiringSoon(d.licence_expiry) ? 'font-semibold text-warn-600' : 'text-ink-400'}`}>
                        {expiringSoon(d.licence_expiry) && <IconWarning className="mr-0.5 inline h-3 w-3" />}
                        expires {dmy(d.licence_expiry)}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs text-ink-600">{d.default_vehicle_number || '—'}</td>
                  <td className="text-right text-sm tabular-nums text-ink-700">{d.trip_count ?? 0}</td>
                  <td>
                    <span className={`badge ${d.is_active ? 'bg-ok-100 text-ok-600' : 'bg-ink-100 text-ink-600'}`}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {can('settings.update', 'bookings.update') && (
                        <button
                          onClick={() => setEditing({
                            id: d.id,
                            fullName: d.full_name, mobile: d.mobile, altMobile: d.alt_mobile ?? '',
                            licenceNumber: d.licence_number ?? '', licenceExpiry: d.licence_expiry ?? '',
                            badgeNumber: d.badge_number ?? '', languages: d.languages ?? '',
                            experienceYears: d.experience_years ? String(d.experience_years) : '',
                            defaultVehicleId: d.default_vehicle_id ? String(d.default_vehicle_id) : '',
                            notes: d.notes ?? '', isActive: !!d.is_active,
                          })}
                          className="btn-ghost btn-sm"
                          aria-label={`Edit ${d.full_name}`}
                        >
                          <IconEdit className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {can('settings.delete') && (
                        <button
                          onClick={() => setToDelete(d)}
                          className="btn-ghost btn-sm text-danger-600"
                          aria-label={`Remove ${d.full_name}`}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={editing.id ? `Edit ${editing.fullName}` : 'Add a driver'}
          subtitle="Only the name and mobile are required. The rest helps the office plan."
          size="md"
          footer={
            <>
              <button className="btn-outline" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
              <button className="btn-primary" onClick={save} disabled={busy}>
                {busy && <Spinner />} {editing.id ? 'Save changes' : 'Add to roster'}
              </button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Full name" required>
              <input className="input" value={editing.fullName} autoFocus
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
            </Field>
            <Field label="Mobile" required>
              <input className="input" value={editing.mobile} inputMode="numeric" maxLength={13}
                onChange={(e) => setEditing({ ...editing, mobile: e.target.value })} placeholder="10-digit mobile" />
            </Field>
            <Field label="Alternate mobile">
              <input className="input" value={editing.altMobile} inputMode="numeric" maxLength={13}
                onChange={(e) => setEditing({ ...editing, altMobile: e.target.value })} />
            </Field>
            <Field label="Badge number">
              <input className="input" value={editing.badgeNumber}
                onChange={(e) => setEditing({ ...editing, badgeNumber: e.target.value })} />
            </Field>
            <Field label="Licence number">
              <input className="input uppercase" value={editing.licenceNumber}
                onChange={(e) => setEditing({ ...editing, licenceNumber: e.target.value })} placeholder="MH0120110012345" />
            </Field>
            <Field label="Licence expiry">
              <DateField value={editing.licenceExpiry}
                onChange={(v) => setEditing({ ...editing, licenceExpiry: v })} />
            </Field>
            <Field label="Languages" hint="Shown to the customer">
              <input className="input" value={editing.languages}
                onChange={(e) => setEditing({ ...editing, languages: e.target.value })} placeholder="Hindi, Marathi, English" />
            </Field>
            <Field label="Years of experience">
              <input className="input tabular-nums" inputMode="decimal" value={editing.experienceYears}
                onChange={(e) => setEditing({ ...editing, experienceYears: e.target.value })} />
            </Field>
            <Field label="Usual vehicle" className="sm:col-span-2">
              <select className="input" value={editing.defaultVehicleId}
                onChange={(e) => setEditing({ ...editing, defaultVehicleId: e.target.value })}>
                <option value="">None</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.vehicle_number} — {v.vehicle_type}</option>
                ))}
              </select>
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <textarea className="input h-auto py-2" rows={2} value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </Field>
            {editing.id > 0 && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-700 sm:col-span-2">
                <input
                  type="checkbox" checked={editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
                />
                Available for allotment
              </label>
            )}
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={remove} danger
        title="Remove this driver?" confirmLabel="Remove"
        body={
          <>
            <p><strong>{toDelete?.full_name}</strong> — {toDelete?.mobile}</p>
            <p className="mt-2 text-ink-500">
              A driver with trips against their name is marked inactive rather than deleted, so past trips and
              invoices keep saying who drove them.
            </p>
          </>
        }
      />
    </section>
  );
}
