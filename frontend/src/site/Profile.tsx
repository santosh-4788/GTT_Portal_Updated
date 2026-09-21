/**
 * My profile.
 *
 * Saved details that make the next booking faster: who you are, the places you
 * travel between, the people you book for, and how you like to travel.
 *
 * TWO KINDS OF DETAIL, AND THE PAGE SAYS WHICH IS WHICH
 * Signing in gives you a real account, and the panel at the top edits the name,
 * mobile, company and GSTIN we hold against your trips and print on your
 * invoices. Everything below it — saved places, saved passengers, travel
 * preferences — is still this browser's own convenience data and always has
 * been, so the page keeps saying so rather than implying a server holds it.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY } from './siteData';
import { ConfirmDialog } from '../components/ui';
import { VEHICLES } from './catalog';
import {
  addPassenger, addPlace, removePassenger, removePlace, saveCustomer, savePrefs,
  useCustomer, bucket,
} from './tripStore';
import { Callout, SectionHead, SoftField, SOFT_INPUT, TrustRow, cleanMobile, validMobile } from './kit';
import PageHero from './PageHero';
import {
  IconArrowRight, IconCheck, IconLock, IconLogout, IconPhone, IconPin, IconPlus, IconTrash, IconUsers,
} from '../components/icons';
import { useCustomerAuth } from '../lib/customerAuth';
import { useToast } from '../components/Toast';

export default function Profile() {
  const { customer, places, passengers, prefs, trips } = useCustomer();
  const { user } = useCustomerAuth();

  const [newPlace, setNewPlace] = useState('');
  const [p, setP] = useState({ name: '', mobile: '', note: '' });
  const [saved, setSaved] = useState('');

  const flash = (what: string) => { setSaved(what); setTimeout(() => setSaved(''), 1800); };

  const upcoming = trips.filter((t) => bucket(t) === 'upcoming').length;
  const completed = trips.filter((t) => bucket(t) === 'completed').length;

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="My profile"
        title={
          user
            ? `Hello, ${user.fullName.split(' ')[0]}`
            : customer.name ? `Hello, ${customer.name.split(' ')[0]}` : 'My profile'
        }
        sub="Save what you would otherwise re-type — your details, the places you travel between, who you book for, and how you like to travel."
        crumbs={[{ label: 'Profile' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-4xl space-y-5">
          <AccountPanel />

          <Callout>
            The saved places, passengers and preferences below are stored in this browser only, as a convenience —
            they are not part of your account and will not follow you to another device.
          </Callout>

          {/* ============================ QUICK LINKS ============================ */}
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { to: '/trips', label: 'My trips', note: `${upcoming} upcoming · ${completed} completed` },
              { to: '/notifications', label: 'Notifications', note: 'Activity on your requests' },
              { to: '/support', label: 'Support', note: `${COMPANY.serviceHours} on one number` },
            ].map((l) => (
              <Link key={l.to} to={l.to} className="tile tile-lift flex items-center justify-between gap-3 p-4">
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink-900">{l.label}</span>
                  <span className="block truncate text-xs text-ink-500">{l.note}</span>
                </span>
                <IconArrowRight className="h-4 w-4 shrink-0 text-ink-300" />
              </Link>
            ))}
          </div>

          {/* =========================== PERSONAL INFO =========================== */}
          <div className="tile p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-md font-bold text-ink-900">Personal information</h2>
              {saved === 'customer' && <span className="badge-ok">Saved</span>}
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pf-name">Name</label>
                <input
                  id="pf-name" className="input" value={customer.name}
                  onChange={(e) => saveCustomer({ name: e.target.value })}
                  onBlur={() => flash('customer')} placeholder="Rajesh Menon" autoComplete="name"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-mobile">Mobile</label>
                <input
                  id="pf-mobile" className="input" value={customer.mobile}
                  onChange={(e) => saveCustomer({ mobile: e.target.value })}
                  onBlur={() => flash('customer')} placeholder="10-digit mobile" inputMode="numeric" autoComplete="tel"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-email">Email</label>
                <input
                  id="pf-email" type="email" className="input" value={customer.email}
                  onChange={(e) => saveCustomer({ email: e.target.value })}
                  onBlur={() => flash('customer')} placeholder="name@company.com" autoComplete="email"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-company">Company</label>
                <input
                  id="pf-company" className="input" value={customer.company}
                  onChange={(e) => saveCustomer({ company: e.target.value })}
                  onBlur={() => flash('customer')} placeholder="Company name" autoComplete="organization"
                />
              </div>
            </div>
            <p className="hint mt-3">
              These fill in the contact step of every booking journey on the site, so you type them once.
            </p>
          </div>

          {/* ========================== SAVED LOCATIONS ========================== */}
          <div className="tile p-6 sm:p-7">
            <h2 className="font-display text-md font-bold text-ink-900">Saved locations</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              Anywhere you travel from or to regularly. Saved places appear at the top of every address box on the site.
            </p>

            <div className="mt-5 flex gap-2">
              <input
                className="input" value={newPlace} onChange={(e) => setNewPlace(e.target.value)}
                placeholder="Office, home, a hotel you use…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addPlace(newPlace); setNewPlace(''); }
                }}
                aria-label="Add a saved location"
              />
              <button
                onClick={() => { addPlace(newPlace); setNewPlace(''); }}
                className="btn h-10 shrink-0 rounded-full bg-ink-900 px-5 text-sm text-white hover:bg-ink-800"
              >
                <IconPlus className="h-4 w-4" /> Add
              </button>
            </div>

            {places.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-ink-50/70 px-4 py-5 text-center text-sm text-ink-500">
                Nothing saved yet. Places you use in a booking are remembered here automatically.
              </p>
            ) : (
              <ul className="mt-4 flex flex-wrap gap-2">
                {places.map((pl) => (
                  <li key={pl} className="inline-flex items-center gap-2 rounded-full bg-ink-50 px-3.5 py-2 text-xs font-semibold text-ink-700">
                    <IconPin className="h-3.5 w-3.5 text-brand-500" /> {pl}
                    <button
                      onClick={() => removePlace(pl)}
                      className="text-ink-400 transition-colors hover:text-danger-600"
                      aria-label={`Remove ${pl}`}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ========================= SAVED PASSENGERS ========================= */}
          <div className="tile p-6 sm:p-7">
            <h2 className="font-display text-md font-bold text-ink-900">Saved passengers</h2>
            <p className="mt-1.5 text-sm text-ink-500">
              People you book for — family, colleagues, visiting clients. We send the vehicle and chauffeur details
              straight to them.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr,1fr,1fr,auto]">
              <input className="input" value={p.name} onChange={(e) => setP((v) => ({ ...v, name: e.target.value }))} placeholder="Name" aria-label="Passenger name" />
              <input className="input" value={p.mobile} onChange={(e) => setP((v) => ({ ...v, mobile: e.target.value }))} placeholder="Mobile" inputMode="numeric" aria-label="Passenger mobile" />
              <input className="input" value={p.note} onChange={(e) => setP((v) => ({ ...v, note: e.target.value }))} placeholder="Note (optional)" aria-label="Note about this passenger" />
              <button
                onClick={() => { if (p.name.trim()) { addPassenger(p); setP({ name: '', mobile: '', note: '' }); } }}
                className="btn h-10 rounded-full bg-ink-900 px-5 text-sm text-white hover:bg-ink-800"
              >
                <IconPlus className="h-4 w-4" /> Add
              </button>
            </div>

            {passengers.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-ink-50/70 px-4 py-5 text-center text-sm text-ink-500">
                No saved passengers yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-ink-100">
                {passengers.map((x) => (
                  <li key={x.id} className="flex items-center gap-3 py-3">
                    <span className="grad-soft grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-xs font-bold text-brand-700">
                      {x.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">{x.name}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {[x.mobile, x.note].filter(Boolean).join(' · ') || 'No details'}
                      </span>
                    </span>
                    <button
                      onClick={() => removePassenger(x.id)}
                      className="btn btn-icon rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                      aria-label={`Remove ${x.name}`}
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ======================== TRAVEL PREFERENCES ======================== */}
          <div className="tile p-6 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-md font-bold text-ink-900">Travel preferences</h2>
              {saved === 'prefs' && <span className="badge-ok">Saved</span>}
            </div>
            <p className="mt-1.5 text-sm text-ink-500">
              Used to pre-fill your next booking and passed to the chauffeur where it matters.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="pf-vehicle">Preferred vehicle</label>
                <select
                  id="pf-vehicle" className="input" value={prefs.vehicleSlug}
                  onChange={(e) => { savePrefs({ vehicleSlug: e.target.value }); flash('prefs'); }}
                >
                  <option value="">No preference</option>
                  {VEHICLES.map((v) => <option key={v.slug} value={v.slug}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="pf-gstin">GSTIN for invoices</label>
                <input
                  id="pf-gstin" className="input font-mono uppercase" value={prefs.invoiceGstin}
                  onChange={(e) => savePrefs({ invoiceGstin: e.target.value.toUpperCase() })}
                  onBlur={() => flash('prefs')} placeholder="27AAAAA0000A1Z5" maxLength={15}
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-pickup">Frequent pickup</label>
                <input
                  id="pf-pickup" className="input" value={prefs.frequentPickup}
                  onChange={(e) => savePrefs({ frequentPickup: e.target.value })}
                  onBlur={() => flash('prefs')} placeholder="Andheri East"
                />
              </div>
              <div>
                <label className="label" htmlFor="pf-drop">Frequent destination</label>
                <input
                  id="pf-drop" className="input" value={prefs.frequentDrop}
                  onChange={(e) => savePrefs({ frequentDrop: e.target.value })}
                  onBlur={() => flash('prefs')} placeholder="CSMIA Terminal 2"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ['ac', 'Always air conditioned', 'Every vehicle in the fleet is, so this is the default.'],
                ['quietRide', 'Quiet ride', 'No music, minimal conversation.'],
                ['frontSeat', 'I sit in front', 'The chauffeur keeps the front seat clear.'],
              ].map(([key, label, note]) => (
                <label key={key} className="flex cursor-pointer items-start gap-3 rounded-2xl bg-ink-50/70 p-4">
                  <input
                    type="checkbox" className="check mt-0.5"
                    checked={Boolean((prefs as any)[key])}
                    onChange={(e) => { savePrefs({ [key]: e.target.checked } as any); flash('prefs'); }}
                  />
                  <span>
                    <span className="block text-sm font-bold text-ink-900">{label}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">{note}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <SectionHead
            className="pt-6"
            eyebrow="Ready when you are"
            title="Book faster next time"
            sub="With your details and places saved, most bookings are three taps and a date."
            action={
              <Link to="/book" className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white hover:brightness-[1.06]">
                Plan a trip <IconArrowRight className="h-4 w-4" />
              </Link>
            }
          />

          <TrustRow />
        </div>
      </section>
    </div>
  );
}

/* ==========================================================================
   The account
   ==========================================================================
   Signed out this is an invitation; signed in it is where the details that go
   onto invoices are edited, and the way out.
   ========================================================================== */

function AccountPanel() {
  const { user, loading, signOut, updateProfile } = useCustomerAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ fullName: '', mobile: '', company: '', gstin: '', address: '' });

  if (loading) return null;

  if (!user) {
    return (
      <div className="animate-fade-up overflow-hidden rounded-[1.75rem] bg-nav p-6 text-white sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0 max-w-xl">
            <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-300">Your account</p>
            <h2 className="mt-1.5 font-display text-lg font-bold leading-snug text-white">
              Sign in to follow your trips and keep your invoices
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/65">
              An account holds the details we print on your invoices — name, mobile, company and GSTIN — and shows
              every trip with its live status and a downloadable invoice.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2.5">
            <Link
              to="/account?mode=signup"
              className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99]"
            >
              Create account <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/account" className="btn h-11 rounded-full bg-white/10 px-5 text-md font-semibold text-white transition-colors hover:bg-white/15">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const start = () => {
    setF({
      fullName: user.fullName, mobile: user.mobile, company: user.company,
      gstin: user.gstin, address: user.address,
    });
    setEditing(true);
  };

  const save = async () => {
    if (f.fullName.trim().length < 2) return toast.error('Please enter your name.');
    if (f.mobile && !validMobile(f.mobile)) return toast.error('Enter a valid 10-digit mobile number.');
    setBusy(true);
    try {
      await updateProfile({ ...f, mobile: cleanMobile(f.mobile) });
      toast.success('Saved', 'Your details are updated on your account.');
      setEditing(false);
    } catch {
      toast.error('Could not save', 'Please try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tile animate-fade-up p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {user.pictureUrl ? (
            <img src={user.pictureUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="grad-brand grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg font-bold text-white">
              {(user.fullName || user.email).charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="font-display text-md font-bold text-ink-900">{user.fullName}</p>
            <p className="truncate text-sm text-ink-500">{user.email}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!editing && (
            <button onClick={start} className="btn h-10 rounded-full bg-ink-50 px-4 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100">
              <IconUsers className="h-3.5 w-3.5" /> Edit details
            </button>
          )}
          <button
            onClick={() => setConfirmOut(true)}
            className="btn h-10 rounded-full bg-ink-50 px-4 text-sm font-semibold text-ink-600 transition-colors hover:bg-danger-50 hover:text-danger-600"
          >
            <IconLogout className="h-3.5 w-3.5" /> Sign out
          </button>

          <ConfirmDialog
            open={confirmOut}
            onClose={() => setConfirmOut(false)}
            onConfirm={async () => { setSigningOut(true); await signOut(); }}
            title="Sign out?"
            body={
              <>
                <p>Are you sure you want to sign out?</p>
                <p className="text-ink-500">
                  Your trips stay exactly where they are — sign in again with the same email address
                  and they will all be here.
                </p>
              </>
            }
            confirmLabel="Yes, sign out"
            cancelLabel="No"
            danger
            busy={signingOut}
          />
        </div>
      </div>

      {editing ? (
        <div className="mt-5 border-t border-ink-100 pt-5">
          <p className="mb-3 text-xs leading-relaxed text-ink-500">
            These are the details printed on your invoices. A GSTIN here means your company can claim the input credit.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <SoftField label="Full name">
              <input className={SOFT_INPUT} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
            </SoftField>
            <SoftField label="Mobile">
              <input className={SOFT_INPUT} value={f.mobile} inputMode="numeric" maxLength={13}
                onChange={(e) => setF({ ...f, mobile: e.target.value })} />
            </SoftField>
            <SoftField label="Company">
              <input className={SOFT_INPUT} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />
            </SoftField>
            <SoftField label="GSTIN">
              <input className={`${SOFT_INPUT} uppercase`} value={f.gstin} maxLength={15}
                onChange={(e) => setF({ ...f, gstin: e.target.value })} placeholder="27ABCDE1234F1Z5" />
            </SoftField>
            <SoftField label="Billing address" className="sm:col-span-2">
              <textarea className={`${SOFT_INPUT} h-auto min-h-[3rem] resize-y py-1`} rows={2} value={f.address}
                onChange={(e) => setF({ ...f, address: e.target.value })} />
            </SoftField>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={save} disabled={busy}
              className="grad-brand btn h-10 rounded-full px-5 text-sm font-semibold text-white transition-[filter] hover:brightness-[1.06] disabled:opacity-70"
            >
              {busy ? 'Saving…' : 'Save details'}
            </button>
            <button onClick={() => setEditing(false)} className="btn h-10 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <dl className="mt-5 grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-3">
          <div>
            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Mobile</dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">{user.mobile || 'Not set'}</dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Company</dt>
            <dd className="mt-1 text-sm font-semibold text-ink-900">{user.company || '—'}</dd>
          </div>
          <div>
            <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">GSTIN</dt>
            <dd className="mt-1 font-mono text-sm font-semibold text-ink-900">{user.gstin || '—'}</dd>
          </div>
        </dl>
      )}

      {!user.hasPassword && (
        <p className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50/70 px-4 py-3 text-xs leading-relaxed text-ink-600">
          <IconLock className="h-3.5 w-3.5 shrink-0 text-brand-600" />
          You sign in with Google. To add a password as well, register at{' '}
          <Link to="/account?mode=signup" className="font-semibold text-brand-700 hover:text-brand-800">
            sign-up
          </Link>{' '}
          using this same email address.
        </p>
      )}
    </div>
  );
}
