/**
 * Settings — genuine system configuration only.
 *
 * Fleet and drivers moved to Fleet; vehicle categories, lists and fare rules
 * to Masters; roles and permissions live with Users. What remains here is how
 * the business is described, how invoices and emails go out, and the
 * application-wide switches.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { dmy } from '../lib/format';
import { Loading, ErrorState, Spinner, Field, PageHeader } from '../components/ui';
import { Segmented } from '../components/data';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { EmailPanel } from './SettingsEmail';
import { IconCar, IconLayers, IconTemplates, IconUsers, IconCheck } from '../components/icons';

type Tab = 'company' | 'invoice' | 'email' | 'website' | 'access' | 'years';

/** Which setting categories each tab shows, and how each category is introduced. */
const TABS: { key: Tab; label: string; categories: string[] }[] = [
  { key: 'company', label: 'Company & bank', categories: ['company', 'bank'] },
  { key: 'invoice', label: 'Invoices & billing', categories: ['invoice'] },
  { key: 'email', label: 'Email', categories: ['email'] },
  { key: 'website', label: 'Website & maps', categories: ['website', 'maps', 'auth'] },
  { key: 'years', label: 'Financial years', categories: [] },
  { key: 'access', label: 'More', categories: [] },
];

const CATEGORY_LABELS: Record<string, { title: string; sub: string }> = {
  company: { title: 'Company details', sub: 'Appears on the public website and on every generated invoice.' },
  bank: { title: 'Bank details', sub: 'Printed in the payment block of every invoice.' },
  invoice: { title: 'Invoice and billing defaults', sub: 'Numbering, tax defaults and terms. Each vendor can override the numbering and tax treatment.' },
  website: { title: 'Public website', sub: 'Text shown on the marketing site.' },
  maps: { title: 'Addresses and distance', sub: 'The free map lookups used for pickup suggestions and distance. The portal stops at the monthly limit.' },
  email: {
    title: 'Email',
    sub: 'Every message the portal sends — enquiry acknowledgements, quotations, trip details and invoices — goes out '
      + 'from this address. The App Password is never shown back; leave the dots alone to keep the one already set.',
  },
  auth: {
    title: 'Customer sign-in',
    sub: 'Optional. A Google client ID puts a "Continue with Google" button on the customer login; '
      + 'leaving it blank hides the button and email sign-in still works.',
  },
};

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'company';
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  const [grouped, setGrouped] = useState<Record<string, any[]>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [years, setYears] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /** Bumped after a save so the email panel re-reads whether sending now works. */
  const [emailKey, setEmailKey] = useState(0);
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('settings.update');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [s, fy] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/financial-years'),
      ]);
      setGrouped(s.data.grouped ?? {});
      setYears(fy.data.data ?? []);
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

  const dirtyByTab = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of TABS) {
      out[t.key] = Object.keys(edits).filter((k) => t.categories.some((c) => (grouped[c] ?? []).some((s: any) => s.key === k))).length;
    }
    return out;
  }, [edits, grouped]);

  if (loading) return <Loading label="Loading settings…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const dirty = Object.keys(edits).length;
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];

  const renderCategory = (category: string) => {
    const items = grouped[category] ?? [];
    if (!items.length) return null;
    const meta = CATEGORY_LABELS[category] ?? { title: category, sub: '' };
    return (
      <section key={category} className="card p-5">
        <div className="mb-4 border-b border-ink-200 pb-3">
          <h2 className="font-semibold text-ink-900">{meta.title}</h2>
          {meta.sub && <p className="mt-0.5 text-xs text-ink-500">{meta.sub}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((s: any) => {
            const value = edits[s.key] ?? s.value ?? '';
            const long = /address|tagline|heroSubtitle|terms/i.test(s.key);
            const bool = s.data_type === 'boolean';
            // The API sends secrets back masked and ignores the mask on save, so
            // this field can be edited without ever revealing the stored value.
            const secret = !!s.is_secret;
            const set = (v: string) => setEdits((p) => ({ ...p, [s.key]: v }));
            if (bool) {
              const on = String(value).toLowerCase() === 'true';
              return (
                <label key={s.key} className={`option ${on ? 'option-on' : ''} ${long ? 'sm:col-span-2' : ''}`}>
                  <input type="checkbox" className="check mt-0.5" checked={on} disabled={!editable}
                    onChange={(e) => set(e.target.checked ? 'true' : 'false')} />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">{s.label ?? s.key}</span>
                    <span className="block font-mono text-[10px] text-ink-400">{s.key}</span>
                  </span>
                </label>
              );
            }
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
                  <textarea className="input min-h-[64px] resize-y" value={value} disabled={!editable}
                    onChange={(e) => set(e.target.value)} />
                ) : (
                  <input
                    className={`input ${secret ? 'font-mono' : ''}`}
                    value={value}
                    disabled={!editable}
                    autoComplete={secret ? 'new-password' : undefined}
                    spellCheck={secret ? false : undefined}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <div className="page mx-auto max-w-5xl pb-24">
      <PageHeader
        title="Settings"
        subtitle="Company details, invoice and billing defaults, email, website and financial years. Fleet and drivers are under Fleet; categories, lists and fare rules under Masters."
        actions={<Link to="/admin/settings/templates" className="btn-outline btn-sm"><IconTemplates className="h-3.5 w-3.5" /> Invoice templates</Link>}
      />

      <Segmented<Tab>
        value={tab} onChange={setTab}
        options={TABS.map((t) => ({ value: t.key, label: t.label, count: dirtyByTab[t.key] || undefined, alert: true }))}
      />

      {current.categories.map(renderCategory)}

      {tab === 'email' && <EmailPanel refreshKey={emailKey} />}

      {tab === 'years' && (
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
                  <span className="badge bg-brand-600 text-white"><IconCheck className="h-3 w-3" /> Active</span>
                ) : editable ? (
                  <button onClick={() => activateYear(y.id, y.code)} className="btn-outline btn-sm">Make active</button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === 'access' && (
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            { to: '/admin/users', icon: <IconUsers className="h-5 w-5" />, title: 'Users and roles', body: 'Add staff, reset passwords, and choose exactly what each role may see and do.', perm: can('users.view') },
            { to: '/admin/settings/templates', icon: <IconTemplates className="h-5 w-5" />, title: 'Invoice templates', body: 'Vendor-specific Excel or Word invoice layouts and their cell mapping.', perm: true },
            { to: '/admin/fleet', icon: <IconCar className="h-5 w-5" />, title: 'Fleet and drivers', body: 'Moved out of Settings into its own module, with availability and document tracking.', perm: can('fleet.view', 'settings.view') },
            { to: '/admin/masters', icon: <IconLayers className="h-5 w-5" />, title: 'Masters', body: 'Vehicle categories, fare rules, trip types, payment methods, cancellation reasons and other lists.', perm: can('masters.view', 'vendors.view') },
          ].filter((x) => x.perm).map((x) => (
            <Link key={x.to} to={x.to} className="card card-hover flex gap-4 p-5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{x.icon}</span>
              <span>
                <span className="block font-semibold text-ink-900">{x.title}</span>
                <span className="mt-1 block text-sm text-ink-500">{x.body}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {editable && dirty > 0 && (
        <div className="action-bar">
          <div className="mx-auto flex max-w-5xl items-center justify-end gap-3 px-4 py-3 sm:px-6">
            <p className="mr-auto text-sm text-ink-600">{dirty} unsaved change{dirty === 1 ? '' : 's'}</p>
            <button className="btn-outline btn-sm" onClick={() => setEdits({})} disabled={!dirty}>Discard</button>
            <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
              {saving && <Spinner className="h-4 w-4" />} Save settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
