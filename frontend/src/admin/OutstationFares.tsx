import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { ConfirmDialog, Loading, Spinner } from '../components/ui';
import { IconPlus, IconTrash, IconCheck } from '../components/icons';
import { useToast } from '../components/Toast';

/* ==========================================================================
   Outstation fares - the fixed-fare master for the popular routes.

   Each route has four categories, shown to customers in this order: Standard
   (Dzire / Aura), SUV / MUV (Ertiga / XL6), Premium sedan (Honda City / Ciaz)
   and Premium MUV (Innova Crysta / Kia Carens). One-way and return fares are
   separate. A blank fare is not priced: the website shows "Fare on request"
   for it and takes an enquiry instead.
   ========================================================================== */

type Category = 'STANDARD' | 'SUV_MUV' | 'PREMIUM_SEDAN' | 'PREMIUM_MUV';

const CATEGORY_LABEL: Record<Category, string> = {
  STANDARD: 'Standard cab',
  SUV_MUV: 'SUV / MUV',
  PREMIUM_SEDAN: 'Premium sedan',
  PREMIUM_MUV: 'Premium MUV',
};

interface FareRow {
  id: number;
  category: Category;
  vehicles: string;
  oneWay: number | null;
  return: number | null;
  tollIncluded: boolean;
  isActive: boolean;
}

interface Route {
  key: string;
  origin: string;
  destination: string;
  displayOrder: number;
  fares: FareRow[];
}

/** What the inputs hold: fares as text, so a blank stays blank. */
interface EditRow extends Omit<FareRow, 'oneWay' | 'return'> { oneWay: string; return: string }
interface EditRoute extends Omit<Route, 'fares'> { fares: EditRow[] }

const toEdit = (r: Route): EditRoute => ({
  ...r,
  fares: r.fares.map((f) => ({
    ...f,
    oneWay: f.oneWay == null ? '' : String(f.oneWay),
    return: f.return == null ? '' : String(f.return),
  })),
});

export default function OutstationFares() {
  const toast = useToast();
  const [routes, setRoutes] = useState<EditRoute[] | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [newDest, setNewDest] = useState('');
  const [removing, setRemoving] = useState<EditRoute | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/outstation-fares');
      const list = (data.data as Route[]).map(toEdit);
      setRoutes(list);
      setSaved(Object.fromEntries(list.map((r) => [r.key, JSON.stringify(r)])));
    } catch (err) {
      toast.error('Could not load outstation fares', errorMessage(err));
      setRoutes([]);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRow = (key: string, category: Category, patch: Partial<EditRow>) =>
    setRoutes((rs) => rs?.map((r) => (r.key !== key ? r : {
      ...r, fares: r.fares.map((f) => (f.category === category ? { ...f, ...patch } : f)),
    })) ?? null);

  const payload = (r: EditRoute) => ({
    origin: r.origin,
    destination: r.destination,
    displayOrder: r.displayOrder,
    fares: r.fares.map((f) => ({
      category: f.category, vehicles: f.vehicles,
      oneWay: f.oneWay.trim(), return: f.return.trim(),
      tollIncluded: f.tollIncluded, isActive: f.isActive,
    })),
  });

  const save = async (r: EditRoute) => {
    setBusy(r.key);
    try {
      await api.put(`/outstation-fares/${r.key}`, payload(r));
      setSaved((s) => ({ ...s, [r.key]: JSON.stringify(r) }));
      toast.success(`Saved ${r.origin} → ${r.destination}`);
    } catch (err) {
      toast.error('Could not save these fares', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const add = async () => {
    const destination = newDest.trim();
    if (destination.length < 2) { toast.error('Enter a destination', 'For example Lonavala.'); return; }
    setBusy('new');
    try {
      await api.post('/outstation-fares', { origin: 'Mumbai', destination, fares: [] });
      setNewDest('');
      toast.success(`Added Mumbai → ${destination}`, 'Fill in its fares below and save.');
      await load();
    } catch (err) {
      toast.error('Could not add that route', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(removing.key);
    try {
      await api.delete(`/outstation-fares/${removing.key}`);
      toast.success(`Removed ${removing.origin} → ${removing.destination}`);
      setRemoving(null);
      await load();
    } catch (err) {
      toast.error('Could not remove that route', errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (!routes) return <Loading label="Loading outstation fares…" />;

  return (
    <div className="page mx-auto max-w-7xl">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Outstation Fares</h1>
          <p className="page-sub">
            Fixed fares for the popular outstation routes, shown on the website&apos;s outstation booking. Leave a
            fare blank and customers see &ldquo;Fare on request&rdquo; for it instead of a price.
          </p>
        </div>
      </div>

      <section className="section p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1 sm:max-w-sm">
            <label className="label" htmlFor="new-dest">Add a route from Mumbai to</label>
            <input
              id="new-dest" className="input" value={newDest} placeholder="e.g. Lonavala"
              onChange={(e) => setNewDest(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }}
            />
          </div>
          <button onClick={add} className="btn-primary" disabled={busy === 'new'}>
            {busy === 'new' ? <Spinner /> : <IconPlus className="h-4 w-4" />} Add route
          </button>
        </div>
        <p className="mt-4 rounded-lg border border-brand-200 bg-brand-50/70 px-4 py-3 text-sm text-brand-900">
          <strong>These fares are public.</strong> Customers are shown Standard, then SUV / MUV, then Premium,
          and book at exactly this amount. Return fares are separate from one-way fares; a return fare left blank
          means return trips on that route are quoted by the office.
        </p>
      </section>

      {routes.length === 0 && (
        <section className="section p-10 text-center text-sm text-ink-600">No routes yet. Add the first one above.</section>
      )}

      {routes.map((r) => {
        const dirty = saved[r.key] !== JSON.stringify(r);
        return (
          <section key={r.key} className="section overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
              <h2 className="font-semibold text-ink-900">{r.origin} → {r.destination}</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => setRemoving(r)} className="btn-outline btn-sm" disabled={busy === r.key}>
                  <IconTrash className="h-4 w-4" /> Remove
                </button>
                <button onClick={() => save(r)} className="btn-primary btn-sm" disabled={!dirty || busy === r.key}>
                  {busy === r.key ? <Spinner /> : <IconCheck className="h-4 w-4" />} {dirty ? 'Save' : 'Saved'}
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Vehicles</th>
                    <th className="td-num">One-way fare (₹)</th>
                    <th className="td-num">Return fare (₹)</th>
                    <th>Toll included</th>
                    <th>Shown</th>
                  </tr>
                </thead>
                <tbody>
                  {r.fares.map((f) => (
                    <tr key={f.category} className={f.isActive ? '' : 'opacity-60'}>
                      <td className="td-strong whitespace-nowrap">{CATEGORY_LABEL[f.category]}</td>
                      <td>
                        <input
                          className="input min-w-[12rem]" value={f.vehicles}
                          onChange={(e) => setRow(r.key, f.category, { vehicles: e.target.value })}
                        />
                      </td>
                      <td className="td-num">
                        <input
                          className="input w-32 text-right" inputMode="numeric" value={f.oneWay} placeholder="On request"
                          onChange={(e) => setRow(r.key, f.category, { oneWay: e.target.value.replace(/[^\d.]/g, '') })}
                        />
                      </td>
                      <td className="td-num">
                        <input
                          className="input w-32 text-right" inputMode="numeric" value={f.return} placeholder="On request"
                          onChange={(e) => setRow(r.key, f.category, { return: e.target.value.replace(/[^\d.]/g, '') })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox" checked={f.tollIncluded} aria-label="Toll included"
                          onChange={(e) => setRow(r.key, f.category, { tollIncluded: e.target.checked })}
                          className="h-4 w-4 rounded border-ink-300 text-brand-600"
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox" checked={f.isActive} aria-label="Shown on the website"
                          onChange={(e) => setRow(r.key, f.category, { isActive: e.target.checked })}
                          className="h-4 w-4 rounded border-ink-300 text-brand-600"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <ConfirmDialog
        open={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} danger
        busy={!!removing && busy === removing.key}
        title="Remove this route?"
        body={removing ? `${removing.origin} → ${removing.destination} and all its fares will be removed from the website. Customers can still ask for it under Other.` : ''}
        confirmLabel="Remove route" cancelLabel="Keep it"
      />
    </div>
  );
}
