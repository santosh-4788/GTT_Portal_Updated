import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { Loading, ErrorState, Spinner, Field, ConfirmDialog } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { EmailPanel } from './SettingsEmail';
import { DriversPanel } from './SettingsDrivers';

const CATEGORY_LABELS: Record<string, { title: string; sub: string }> = {
  company: { title: 'Company details', sub: 'Appears on the public website and on every generated invoice.' },
  bank: { title: 'Bank details', sub: 'Printed in the invoice footer.' },
  invoice: { title: 'Invoice defaults', sub: 'Applied to new vendors; each vendor can override these.' },
  website: { title: 'Public website', sub: 'Text shown on the marketing site.' },
  email: {
    title: 'Email',
    sub: 'Every message the portal sends — enquiry acknowledgements, trip details and invoices — goes out '
      + 'from this address. The App Password is never shown back; leave the dots alone to keep the one already set.',
  },
  auth: {
    title: 'Customer sign-in',
    sub: 'Optional. A Google client ID puts a "Continue with Google" button on the customer login; '
      + 'leaving it blank hides the button and email sign-in still works.',
  },
};

export default function Settings() {
  const [grouped, setGrouped] = useState<Record<string, any[]>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [years, setYears] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [newVehicle, setNewVehicle] = useState({ vehicleNumber: '', vehicleType: '', model: '', seating: '', driverName: '', driverMobile: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toDelete, setToDelete] = useState<any>(null);
  /** Bumped after a save so the email panel re-reads whether sending now works. */
  const [emailKey, setEmailKey] = useState(0);
  const toast = useToast();
  const { can } = useAuth();

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, fy, v] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/financial-years'),
        api.get('/settings/vehicles'),
      ]);
      setGrouped(s.data.grouped ?? {});
      setYears(fy.data.data ?? []);
      setVehicles(v.data.data ?? []);
      setEdits({});
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!Object.keys(edits).length) { toast.info('Nothing to save'); return; }
    setSaving(true);
    try {
      await api.put('/settings', { settings: edits });
      toast.success('Settings saved', `${Object.keys(edits).length} value(s) updated.`);
      setEmailKey((k) => k + 1);
      load();
    } catch (err) {
      toast.error('Could not save settings', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const activateYear = async (id: number, code: string) => {
    try {
      await api.post(`/settings/financial-years/${id}/activate`);
      toast.success(`Financial year ${code} is now active`);
      load();
    } catch (err) {
      toast.error('Could not change the financial year', errorMessage(err));
    }
  };

  const addVehicle = async () => {
    try {
      await api.post('/settings/vehicles', newVehicle);
      toast.success(`${newVehicle.vehicleNumber} added to the fleet`);
      setNewVehicle({ vehicleNumber: '', vehicleType: '', model: '', seating: '', driverName: '', driverMobile: '' });
      load();
    } catch (err) {
      toast.error('Could not add the vehicle', errorMessage(err));
    }
  };

  const removeVehicle = async () => {
    if (!toDelete) return;
    try {
      const { data } = await api.delete(`/settings/vehicles/${toDelete.id}`);
      toast.success(data.message ?? 'Vehicle removed');
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not remove the vehicle', errorMessage(err));
    }
  };

  if (loading) return <Loading label="Loading settings…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const dirty = Object.keys(edits).length;

  return (
    <div className="page mx-auto max-w-5xl pb-24">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-sub">
            Company details, invoice defaults, email, financial years, fleet, drivers and invoice templates.
          </p>
        </div>
        <Link to="/admin/settings/templates" className="btn-primary btn-sm">Invoice Templates →</Link>
      </div>

      {Object.entries(grouped).map(([category, items]) => {
        const meta = CATEGORY_LABELS[category] ?? { title: category, sub: '' };
        return (
          <section key={category} className="card p-5">
            <div className="mb-4 border-b border-ink-200 pb-3">
              <h2 className="font-semibold text-ink-900">{meta.title}</h2>
              {meta.sub && <p className="mt-0.5 text-xs text-ink-500">{meta.sub}</p>}
            </div>
            <div className="stagger grid gap-4 sm:grid-cols-2">
              {items.map((s: any) => {
                const value = edits[s.key] ?? s.value ?? '';
                const long = /address|tagline|heroSubtitle/i.test(s.key);
                // The API sends secrets back masked and ignores the mask on
                // save, so this field can be edited without ever revealing the
                // stored value.
                const secret = !!s.is_secret;
                return (
                  <Field
                    key={s.key}
                    label={s.label ?? s.key}
                    className={long ? 'sm:col-span-2' : ''}
                    hint={
                      secret
                        ? (s.is_set ? 'Already set — leave as is to keep it, or type a new one.' : 'Not set yet.')
                        : <span className="font-mono text-[10px]">{s.key}</span>
                    }
                  >
                    {long ? (
                      <textarea className="input min-h-[64px] resize-y" value={value} disabled={!can('settings.update')}
                        onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))} />
                    ) : (
                      <input
                        className={`input ${secret ? 'font-mono' : ''}`}
                        value={value}
                        disabled={!can('settings.update')}
                        autoComplete={secret ? 'new-password' : undefined}
                        spellCheck={secret ? false : undefined}
                        onChange={(e) => setEdits((p) => ({ ...p, [s.key]: e.target.value }))}
                      />
                    )}
                  </Field>
                );
              })}
            </div>
          </section>
        );
      })}

      <EmailPanel refreshKey={emailKey} />

      {/* financial years */}
      <section className="section p-5">
        <div className="mb-4 border-b border-ink-200 pb-3">
          <h2 className="font-semibold text-ink-900">Financial years</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            The active year drives the <span className="font-mono">{'{FY}'}</span> token in invoice numbers and resets the
            sequence.
          </p>
        </div>
        <div className="space-y-2">
          {years.map((y) => (
            <div key={y.id} className={`flex flex-wrap items-center gap-3 rounded-lg border p-3.5 ${
              y.is_active ? 'border-brand-300 bg-brand-50' : 'border-ink-200'}`}>
              <div className="mr-auto">
                <p className="font-semibold text-ink-900">{y.code}</p>
                <p className="text-xs text-ink-500">{dmy(y.start_date)} — {dmy(y.end_date)}</p>
              </div>
              {y.is_active ? (
                <span className="badge bg-brand-500 text-white">Active</span>
              ) : can('settings.update') ? (
                <button onClick={() => activateYear(y.id, y.code)} className="btn-outline btn-sm">Make active</button>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* fleet */}
      <section className="section p-5">
        <div className="mb-4 border-b border-ink-200 pb-3">
          <h2 className="font-semibold text-ink-900">Fleet</h2>
          <p className="mt-0.5 text-xs text-ink-500">
            Vehicles listed here appear in the booking form and auto-fill the driver details.
          </p>
        </div>

        <div className="table-wrap mb-4">
          <table className="tbl">
            <thead>
              <tr><th>Vehicle no.</th><th>Type</th><th>Model</th><th>Seats</th><th>Driver</th><th>Mobile</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td className="font-mono text-sm font-semibold text-ink-900">{v.vehicle_number}</td>
                  <td className="text-sm text-ink-700">{v.vehicle_type}</td>
                  <td className="text-sm text-ink-600">{v.model || '—'}</td>
                  <td className="text-sm text-ink-600">{v.seating || '—'}</td>
                  <td className="text-sm text-ink-700">{v.driver_name || '—'}</td>
                  <td className="text-sm text-ink-600">{v.driver_mobile || '—'}</td>
                  <td>
                    <span className={`badge ${v.is_active ? 'bg-ok-100 text-ok-600' : 'bg-ink-100 text-ink-600'}`}>
                      {v.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    {can('settings.delete') && (
                      <button onClick={() => setToDelete(v)} className="btn-ghost btn-sm text-danger-600">🗑</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {can('settings.create') && (
          <div className="grid gap-3 rounded-lg bg-ink-50 p-4 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Vehicle no.">
              <input className="input uppercase" placeholder="MH04LQ1748" value={newVehicle.vehicleNumber}
                onChange={(e) => setNewVehicle((v) => ({ ...v, vehicleNumber: e.target.value }))} />
            </Field>
            <Field label="Type">
              <input className="input" placeholder="Sedan" value={newVehicle.vehicleType}
                onChange={(e) => setNewVehicle((v) => ({ ...v, vehicleType: e.target.value }))} />
            </Field>
            <Field label="Model">
              <input className="input" value={newVehicle.model}
                onChange={(e) => setNewVehicle((v) => ({ ...v, model: e.target.value }))} />
            </Field>
            <Field label="Seats">
              <input className="input" inputMode="numeric" value={newVehicle.seating}
                onChange={(e) => setNewVehicle((v) => ({ ...v, seating: e.target.value }))} />
            </Field>
            <Field label="Driver">
              <input className="input" value={newVehicle.driverName}
                onChange={(e) => setNewVehicle((v) => ({ ...v, driverName: e.target.value }))} />
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Driver mobile" className="flex-1">
                <input className="input" inputMode="numeric" value={newVehicle.driverMobile}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, driverMobile: e.target.value }))} />
              </Field>
              <button onClick={addVehicle} className="btn-primary btn-sm mb-0.5"
                disabled={!newVehicle.vehicleNumber || !newVehicle.vehicleType}>
                Add
              </button>
            </div>
          </div>
        )}
      </section>

      <DriversPanel />

      {can('settings.update') && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-4 py-3 sm:px-6">
            {dirty > 0 && <p className="mr-auto text-sm text-ink-600">{dirty} unsaved change{dirty === 1 ? '' : 's'}</p>}
            <button className="btn-outline btn-sm" onClick={() => setEdits({})} disabled={!dirty}>Discard</button>
            <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving && <Spinner className="h-4 w-4" />} Save settings
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete} onClose={() => setToDelete(null)} onConfirm={removeVehicle} danger
        title="Remove this vehicle?" confirmLabel="Remove"
        body={
          <>
            <p><strong>{toDelete?.vehicle_number}</strong> — {toDelete?.vehicle_type}</p>
            <p className="mt-2 text-ink-500">
              If the vehicle is used on existing bookings it will be deactivated instead of deleted.
            </p>
          </>
        }
      />
    </div>
  );
}
