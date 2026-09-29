import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmy, dmyTime } from '../lib/format';
import { EmptyState, Loading, StatCard } from '../components/ui';
import { IconSearch } from '../components/icons';
import { useToast } from '../components/Toast';
import { DateField } from '../components/DateTimeField';

/* ==========================================================================
   Customer feedback.

   Every response a customer gave through the "Give Your Feedback" email,
   against the booking it is about: who drove, which car, which route, which
   day - as they were when the customer answered. The ratings themselves are
   read-only; the trip drawer is where a request is re-sent or re-opened.
   ========================================================================== */

interface FeedbackRow {
  id: number;
  booking_id: number;
  trip_id: string | null;
  booking_code: string;
  status: 'PENDING' | 'SUBMITTED';
  email_status: string | null;
  sent_to: string | null;
  requested_at: string;
  submitted_at: string | null;
  customer_name: string | null;
  travel_date: string | null;
  pickup: string | null;
  drop_off: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  vehicle_number: string | null;
  driver_rating: number | null;
  service_rating: number | null;
  vehicle_rating: number | null;
  overall_rating: number | null;
  comments: string | null;
}

interface Summary {
  responses: number;
  driver: number | null;
  service: number | null;
  vehicle: number | null;
  overall: number | null;
  pending: number;
}

const BLANK = { status: 'SUBMITTED', from: '', to: '', driver: '', vehicle: '', rating: '', route: '', booking: '' };

function Stars({ value }: { value: number | null }) {
  if (!value) return <span className="text-ink-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" title={`${value} of 5`}>
      <span className="text-sm tracking-tight" aria-hidden="true">
        <span className="text-gold-500">{'★'.repeat(value)}</span>
        <span className="text-ink-200">{'★'.repeat(5 - value)}</span>
      </span>
      <span className="sr-only">{value} out of 5</span>
    </span>
  );
}

const avg = (v: number | null) => (v == null ? '—' : v.toFixed(1));

export default function Feedback() {
  const toast = useToast();
  const [f, setF] = useState(BLANK);
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [options, setOptions] = useState<{ drivers: string[]; vehicles: string[] }>({ drivers: [], vehicles: [] });
  const [open, setOpen] = useState<number | null>(null);

  const load = async (q = f) => {
    try {
      const params = Object.fromEntries(Object.entries(q).filter(([, v]) => v !== ''));
      const { data } = await api.get('/feedback', { params });
      setRows(data.data);
      setSummary(data.summary);
    } catch (err) {
      toast.error('Could not load feedback', errorMessage(err));
      setRows([]);
    }
  };

  useEffect(() => {
    void load();
    api.get('/feedback/options').then(({ data }) => setOptions(data)).catch(() => { /* filters still work as free text */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const next = { ...f, [k]: e.target.value };
    setF(next);
    // Selects apply at once; the text boxes wait for Search.
    if (e.target.tagName === 'SELECT') void load(next);
  };
  const setDate = (k: 'from' | 'to') => (v: string) => {
    const next = { ...f, [k]: v };
    setF(next);
    void load(next);
  };

  const reset = () => { setF(BLANK); void load(BLANK); };

  if (!rows) return <Loading label="Loading feedback…" />;

  const pendingView = f.status === 'PENDING';

  return (
    <div className="page mx-auto max-w-7xl">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Customer feedback</h1>
          <p className="page-sub">
            Ratings customers gave after their trip was marked completed — the driver, the service, the cab and the
            trip overall, with anything they wrote. Each response is tied to its booking, driver, vehicle, route and date.
          </p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Responses" value={summary.responses} sub="Matching the filters" />
          <StatCard label="Overall" value={avg(summary.overall)} sub="Average of 5" tone="brand" />
          <StatCard label="Driver" value={avg(summary.driver)} sub="Average of 5" />
          <StatCard label="Service" value={avg(summary.service)} sub="Average of 5" />
          <StatCard label="Cab" value={avg(summary.vehicle)} sub="Average of 5" />
          <StatCard
            label="Awaiting reply" value={summary.pending} sub="Emailed, not answered yet" tone={summary.pending ? 'warning' : 'default'}
            onClick={() => { const next = { ...f, status: 'PENDING' }; setF(next); void load(next); }}
          />
        </div>
      )}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="fb-status">Show</label>
            <select id="fb-status" className="input" value={f.status} onChange={set('status')}>
              <option value="SUBMITTED">Responses received</option>
              <option value="PENDING">Awaiting the customer</option>
              <option value="ALL">Everything</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fb-from">Trip date from</label>
            <DateField id="fb-from" value={f.from} onChange={setDate('from')} placeholder="Any date" />
          </div>
          <div>
            <label className="label" htmlFor="fb-to">Trip date to</label>
            <DateField id="fb-to" value={f.to} min={f.from || undefined} onChange={setDate('to')} placeholder="Any date" />
          </div>
          <div>
            <label className="label" htmlFor="fb-rating">Overall rating</label>
            <select id="fb-rating" className="input" value={f.rating} onChange={set('rating')} disabled={pendingView}>
              <option value="">Any rating</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)} ({n})</option>)}
              <option value="low">Low (2 or under)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="fb-driver">Driver</label>
            <input id="fb-driver" className="input" list="fb-drivers" value={f.driver} onChange={set('driver')} placeholder="Any driver" />
            <datalist id="fb-drivers">{options.drivers.map((d) => <option key={d} value={d} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="fb-vehicle">Vehicle</label>
            <input id="fb-vehicle" className="input" list="fb-vehicles" value={f.vehicle} onChange={set('vehicle')} placeholder="Number or type" />
            <datalist id="fb-vehicles">{options.vehicles.map((v) => <option key={v} value={v} />)}</datalist>
          </div>
          <div>
            <label className="label" htmlFor="fb-route">Route</label>
            <input id="fb-route" className="input" value={f.route} onChange={set('route')} placeholder="Pickup or drop, e.g. Pune" />
          </div>
          <div>
            <label className="label" htmlFor="fb-booking">Booking ID</label>
            <input id="fb-booking" className="input" value={f.booking} onChange={set('booking')} placeholder="Trip ID or GTT-B-…" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={reset}>Clear</button>
          <button type="submit" className="btn-primary"><IconSearch className="h-4 w-4" /> Search</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <section className="section">
          <EmptyState
            title={pendingView ? 'Nobody is waiting to reply' : 'No feedback matches'}
            body={pendingView
              ? 'Every customer who was sent the feedback email has answered, or none has been sent yet.'
              : 'Feedback appears here once a customer answers the email sent when their trip is marked completed.'}
          />
        </section>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Booking</th>
                <th>Customer</th>
                <th>Trip date</th>
                <th>Route</th>
                <th>Driver</th>
                <th>Vehicle</th>
                <th>Driver rating</th>
                <th>Service</th>
                <th>Cab</th>
                <th>Overall</th>
                <th>Comments</th>
                <th>{pendingView ? 'Emailed' : 'Feedback date'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={open === r.id ? 'is-selected' : ''}>
                  <td className="whitespace-nowrap">
                    <span className="cell-code">{r.trip_id ?? r.booking_code}</span>
                    {r.trip_id && <p className="cell-meta">{r.booking_code}</p>}
                  </td>
                  <td className="td-strong whitespace-nowrap">{r.customer_name || '—'}</td>
                  <td className="whitespace-nowrap">{r.travel_date ? dmy(r.travel_date) : '—'}</td>
                  <td className="min-w-[12rem] max-w-[16rem]">
                    <span className="line-clamp-2 text-xs">{[r.pickup, r.drop_off].filter(Boolean).join(' → ') || '—'}</span>
                  </td>
                  <td className="whitespace-nowrap">{r.driver_name || '—'}</td>
                  <td className="whitespace-nowrap">
                    {r.vehicle_number || '—'}
                    {r.vehicle_type && <p className="cell-meta">{r.vehicle_type}</p>}
                  </td>
                  <td><Stars value={r.driver_rating} /></td>
                  <td><Stars value={r.service_rating} /></td>
                  <td><Stars value={r.vehicle_rating} /></td>
                  <td><Stars value={r.overall_rating} /></td>
                  <td className="min-w-[14rem] max-w-[22rem]">
                    {r.comments ? (
                      <button
                        type="button" onClick={() => setOpen(open === r.id ? null : r.id)}
                        className={`text-left text-xs text-ink-700 ${open === r.id ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}
                        title={open === r.id ? 'Show less' : 'Show the whole comment'}
                      >
                        {r.comments}
                      </button>
                    ) : <span className="text-ink-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs">
                    {pendingView || r.status === 'PENDING'
                      ? <>{dmyTime(r.requested_at)}<p className="cell-meta">{r.email_status === 'SENT' ? r.sent_to : r.email_status === 'NO_EMAIL' ? 'No email on file' : `${r.email_status?.toLowerCase() ?? ''}`}</p></>
                      : r.submitted_at ? dmyTime(r.submitted_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
