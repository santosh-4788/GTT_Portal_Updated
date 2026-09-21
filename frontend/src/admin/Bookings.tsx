import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { inr, dmy } from '../lib/format';
import { Loading, EmptyState, ErrorState, StatusBadge, Pagination, ConfirmDialog } from '../components/ui';
import { IconEdit, IconDuplicate, IconTrash, IconPlus } from '../components/icons';
import { useToast } from '../components/Toast';
import { useAuth } from '../lib/auth';
import { DateField } from '../components/DateTimeField';

const LIMIT = 50;
const EMPTY_FILTERS = {
  search: '', vendorId: '', travelFrom: '', travelTo: '',
  bookingStatus: '', billingStatus: '', tripType: '',
};

export default function Bookings() {
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({
    ...EMPTY_FILTERS,
    vendorId: params.get('vendorId') ?? '',
    billingStatus: params.get('billingStatus') ?? '',
  });
  const [applied, setApplied] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [vendors, setVendors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toDelete, setToDelete] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();

  useEffect(() => {
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/bookings', { params: { ...applied, limit: LIMIT, offset } });
      setRows(data.data ?? []);
      setTotal(data.total ?? 0);
      setTotalAmount(data.totalAmount ?? 0);
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [applied, offset]);

  useEffect(() => { load(); }, [load]);

  const search = () => { setOffset(0); setApplied(filters); };
  const clear = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setOffset(0);
    setParams({});
  };

  const set = (k: keyof typeof EMPTY_FILTERS) => (e: any) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }));

  const setVal = (k: keyof typeof EMPTY_FILTERS) => (v: string) => set(k)({ target: { value: v } });

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleAll = () =>
    setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));

  const bulkStatus = async (billingStatus: string) => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const { data } = await api.post('/bookings/bulk-status', { ids: [...selected], billingStatus });
      toast.success(`${data.updated} booking(s) updated`);
      load();
    } catch (err) {
      toast.error('Could not update the bookings', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async (id: number) => {
    try {
      const { data } = await api.post(`/bookings/${id}/duplicate`);
      toast.success(`Copied to ${data.data.booking_code}`, 'Saved as a draft — open it to set the travel date.');
      navigate(`/admin/bookings/${data.data.id}/edit`);
    } catch (err) {
      toast.error('Could not duplicate', errorMessage(err));
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.delete(`/bookings/${toDelete.id}`);
      toast.success(`${toDelete.booking_code} deleted`);
      setToDelete(null);
      load();
    } catch (err) {
      toast.error('Could not delete', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = ['Booking ID', 'Booking Date', 'Vendor', 'Vendor Ref', 'Travel Date', 'Passenger',
      'Mobile', 'Pickup', 'Drop', 'Vehicle', 'Amount', 'Booking Status', 'Billing Status', 'Invoice'];
    const esc = (v: any) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')].concat(
      rows.map((r) => [
        r.booking_code, r.booking_date, r.vendor_name, r.vendor_booking_ref, r.travel_date,
        r.passenger_name, r.passenger_mobile, r.pickup_location, r.drop_location,
        r.vehicle_number, r.total_amount, r.booking_status, r.billing_status, r.invoice_number,
      ].map(esc).join(','))
    );
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bookings_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Bookings</h1>
          <p className="page-sub">
            {total} booking{total === 1 ? '' : 's'} matching your filters · {inr(totalAmount)} total value
          </p>
        </div>
        <div className="page-actions">
          <button onClick={exportCsv} className="btn-outline btn-sm" disabled={!rows.length}>Export CSV</button>
          {can('bookings.create') && (
            <Link to="/admin/bookings/new" className="btn-primary btn-sm">+ New Booking</Link>
          )}
        </div>
      </div>

      {/* filters */}
      <div className="filters animate-fade-up">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <div className="lg:col-span-2">
            <label className="label">Search</label>
            <input className="input" placeholder="Booking ID, vendor ref, passenger, mobile, vehicle…"
              value={filters.search} onChange={set('search')}
              onKeyDown={(e) => e.key === 'Enter' && search()} />
          </div>
          <div>
            <label className="label">Vendor</label>
            <select className="input" value={filters.vendorId} onChange={set('vendorId')}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Travel from</label>
            <DateField value={filters.travelFrom} onChange={setVal('travelFrom')} placeholder="Any" />
          </div>
          <div>
            <label className="label">Travel to</label>
            <DateField value={filters.travelTo} onChange={setVal('travelTo')} placeholder="Any" />
          </div>
          <div>
            <label className="label">Booking status</label>
            <select className="input" value={filters.bookingStatus} onChange={set('bookingStatus')}>
              <option value="">Any</option>
              {['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) =>
                <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Billing status</label>
            <select className="input" value={filters.billingStatus} onChange={set('billingStatus')}>
              <option value="">Any</option>
              {['PENDING', 'READY', 'INVOICED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={search} className="btn-primary btn-sm">Search</button>
          <button onClick={clear} className="btn-ghost btn-sm">Clear filters</button>
        </div>
      </div>

      {/* bulk bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3">
          <p className="mr-auto text-sm font-semibold text-brand-900">{selected.size} selected</p>
          {can('bookings.update') && (
            <>
              <button onClick={() => bulkStatus('READY')} className="btn-outline btn-sm" disabled={busy}>
                Mark ready for billing
              </button>
              <button onClick={() => bulkStatus('PENDING')} className="btn-outline btn-sm" disabled={busy}>
                Mark pending
              </button>
            </>
          )}
          <button onClick={() => setSelected(new Set())} className="btn-ghost btn-sm">Clear selection</button>
        </div>
      )}

      {/* table */}
      {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : rows.length === 0 ? (
        <div className="card">
          <EmptyState title="No bookings found"
            body="No booking matches these filters. Try clearing them, or create a new booking."
            action={can('bookings.create') ? <Link to="/admin/bookings/new" className="btn-primary btn-sm">+ New Booking</Link> : undefined}
          />
        </div>
      ) : (
        <div className="table-wrap table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10">
                  <input type="checkbox" className="check"
                    checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} />
                </th>
                <th>Booking</th>
                <th>Vendor</th>
                <th>Travel</th>
                <th>Passenger</th>
                <th>Route</th>
                <th>Vehicle</th>
                <th className="text-right">Amount</th>
                <th>Billing</th>
                <th>Invoice</th>
                <th className="sticky-end text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={selected.has(r.id) ? 'bg-brand-50/60' : ''}>
                  <td>
                    <input type="checkbox" className="check"
                      checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td>
                    <Link to={`/admin/bookings/${r.id}/edit`} className="font-mono text-xs font-semibold text-brand-600 hover:underline">
                      {r.booking_code}
                    </Link>
                    {/* The Trip ID is what the customer quotes, so it belongs
                        next to the booking code rather than only on Trips. */}
                    {r.trip_id && (
                      <Link
                        to={`/admin/trips?search=${encodeURIComponent(r.trip_id)}`}
                        className="mt-0.5 block font-mono text-[11px] text-ink-500 hover:text-brand-600"
                        title="Open the trip"
                      >
                        {r.trip_id}
                      </Link>
                    )}
                    {r.vendor_booking_ref && (
                      <p className="mt-0.5 max-w-[10rem] truncate text-[11px] text-ink-400" title={r.vendor_booking_ref}>
                        {r.vendor_booking_ref}
                      </p>
                    )}
                  </td>
                  <td>
                    <p className="text-sm font-medium text-ink-800">{r.vendor_name}</p>
                    <p className="text-[11px] text-ink-400">{r.vendor_code}</p>
                  </td>
                  <td className="whitespace-nowrap">
                    <p className="text-sm text-ink-800">{dmy(r.travel_date)}</p>
                    {r.reporting_time && <p className="text-[11px] text-ink-500">{r.reporting_time}</p>}
                  </td>
                  <td>
                    <p className="max-w-[11rem] truncate text-sm font-medium text-ink-800">{r.passenger_name}</p>
                    {r.passenger_mobile && <p className="text-[11px] text-ink-500">{r.passenger_mobile}</p>}
                  </td>
                  <td>
                    <p className="max-w-[15rem] truncate text-xs text-ink-700" title={`${r.pickup_location} → ${r.drop_location}`}>
                      {r.pickup_location}
                    </p>
                    {r.drop_location && (
                      <p className="max-w-[15rem] truncate text-[11px] text-ink-500">→ {r.drop_location}</p>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <p className="text-xs text-ink-700">{r.vehicle_type || '—'}</p>
                    {r.vehicle_number && <p className="font-mono text-[11px] text-ink-500">{r.vehicle_number}</p>}
                  </td>
                  <td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink-900">
                    {inr(r.total_amount)}
                  </td>
                  <td><StatusBadge value={r.billing_status} /></td>
                  <td>
                    {r.invoice_number ? (
                      <Link to={`/admin/invoices/${r.invoice_id}`} className="font-mono text-[11px] text-brand-600 hover:underline">
                        {r.invoice_number}
                      </Link>
                    ) : <span className="text-xs text-ink-400">—</span>}
                  </td>
                  <td className="sticky-end">
                    <div className="row-actions">
                      <Link to={`/admin/bookings/${r.id}/edit`} className="btn-ghost btn-icon" title="Edit" aria-label="Edit"><IconEdit className="h-4 w-4" /></Link>
                      {can('bookings.create') && (
                        <button onClick={() => duplicate(r.id)} className="btn-ghost btn-icon" title="Duplicate" aria-label="Duplicate"><IconDuplicate className="h-4 w-4" /></button>
                      )}
                      {can('bookings.delete') && (
                        <button onClick={() => setToDelete(r)} className="btn-ghost btn-icon text-danger-600" title="Delete" aria-label="Delete"><IconTrash className="h-4 w-4" /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination offset={offset} limit={LIMIT} total={total} onChange={setOffset} />
        </div>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        busy={busy}
        danger
        title="Delete this booking?"
        confirmLabel="Delete booking"
        body={
          <>
            <p><strong>{toDelete?.booking_code}</strong> — {toDelete?.passenger_name} on {dmy(toDelete?.travel_date)}.</p>
            <p className="mt-2 text-ink-500">This cannot be undone. Bookings already on an invoice cannot be deleted.</p>
          </>
        }
      />
    </div>
  );
}
