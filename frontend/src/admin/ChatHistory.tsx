import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { EmptyState, Loading, Spinner } from '../components/ui';
import { IconSearch } from '../components/icons';
import { useToast } from '../components/Toast';

/* ==========================================================================
   Chat history - every website-assistant conversation, as it happened.

   Read-only. It is here so the office can check what a customer asked, what
   the assistant answered, which vehicles and fares it showed and how each fare
   was worked out, and when the booking was confirmed. Nothing on this screen
   can change the record.
   ========================================================================== */

interface SessionRow {
  id: string;
  started_at: string;
  last_at: string;
  status: 'OPEN' | 'BOOKED';
  trip_id: string | null;
  customer_name: string | null;
  mobile: string | null;
  email: string | null;
  messages: number;
  first_question: string | null;
}

interface Message {
  seq: number;
  at: string;
  received_at: string;
  sender: 'customer' | 'assistant' | 'system';
  text: string;
  data_json: string | null;
}

/** Server times are UTC 'YYYY-MM-DD HH:MM:SS'; browser times are ISO. */
function when(v: string): string {
  const d = new Date(/Z|T/.test(v) ? v : `${v.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function ChatHistory() {
  const toast = useToast();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ session: any; messages: Message[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (t = term, s = status) => {
    try {
      const { data } = await api.get('/chats', { params: { q: t || undefined, status: s || undefined } });
      setRows(data.data);
    } catch (err) {
      toast.error('Could not load chat history', errorMessage(err));
      setRows([]);
    }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const show = async (id: string) => {
    setOpen(id);
    setDetail(null);
    setBusy(true);
    try {
      const { data } = await api.get(`/chats/${id}`);
      setDetail(data);
    } catch (err) {
      toast.error('Could not open that conversation', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!rows) return <Loading label="Loading chat history…" />;

  return (
    <div className="page mx-auto max-w-7xl">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Chat history</h1>
          <p className="page-sub">
            Every conversation with the website assistant, exactly as it happened - what was asked, what was answered,
            the vehicles and fares shown, and when a booking was confirmed. Records are never edited; later changes
            appear as new lines with their own time.
          </p>
        </div>
      </div>

      <section className="section p-5">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => { e.preventDefault(); void load(); }}
        >
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="chat-q">Search</label>
            <input id="chat-q" className="input" value={term} onChange={(e) => setTerm(e.target.value)}
              placeholder="Name, mobile, Trip ID or anything said in the chat" />
          </div>
          <div>
            <label className="label" htmlFor="chat-status">Status</label>
            <select id="chat-status" className="input" value={status}
              onChange={(e) => { setStatus(e.target.value); void load(term, e.target.value); }}>
              <option value="">All</option>
              <option value="BOOKED">Led to a booking</option>
              <option value="OPEN">No booking</option>
            </select>
          </div>
          <button type="submit" className="btn-primary"><IconSearch className="h-4 w-4" /> Search</button>
        </form>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr),minmax(0,1.1fr)]">
        <section className="section overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState title="No conversations yet" body="Chats with the website assistant appear here as they happen." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button" onClick={() => show(r.id)}
                    className={`w-full px-5 py-3.5 text-left transition-colors hover:bg-ink-50 ${open === r.id ? 'bg-brand-50/60' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-ink-900">
                        {r.customer_name || 'Visitor'}{r.mobile ? ` · ${r.mobile}` : ''}
                      </p>
                      {r.status === 'BOOKED'
                        ? <span className="badge shrink-0 bg-ok-50 text-ok-700">{r.trip_id ?? 'Booked'}</span>
                        : <span className="badge shrink-0 bg-ink-100 text-ink-600">No booking</span>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">{r.first_question ?? '(no message)'}</p>
                    <p className="mt-0.5 text-2xs text-ink-400">{when(r.last_at)} · {r.messages} messages</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="section min-h-[20rem] overflow-hidden">
          {!open ? (
            <EmptyState title="Pick a conversation" body="The whole chat opens here, line by line with the time of each." />
          ) : busy || !detail ? (
            <div className="grid h-64 place-items-center"><Spinner className="h-5 w-5" /></div>
          ) : (
            <div>
              <div className="border-b border-ink-100 px-5 py-4 text-sm">
                <p className="font-semibold text-ink-900">
                  {detail.session.customer_name || 'Visitor'}
                  {detail.session.trip_id && (
                    <Link to={`/admin/trips?search=${encodeURIComponent(detail.session.trip_id)}`}
                      className="ml-2 text-xs font-semibold text-brand-700 hover:underline">
                      Open trip {detail.session.trip_id}
                    </Link>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {[detail.session.mobile, detail.session.email].filter(Boolean).join(' · ') || 'No contact details given'}
                </p>
                <p className="mt-0.5 text-2xs text-ink-400">
                  Started {when(detail.session.started_at)} · chat {detail.session.id}
                </p>
              </div>
              <ol className="max-h-[70vh] space-y-3 overflow-y-auto bg-ink-50/50 px-5 py-4">
                {detail.messages.map((m) => <Bubble key={m.seq} m={m} />)}
              </ol>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const data = m.data_json ? safeJson(m.data_json) : null;
  const tone = m.sender === 'customer'
    ? 'ml-auto bg-brand-600 text-white'
    : m.sender === 'system' ? 'mx-auto bg-ok-50 text-ok-700' : 'bg-white text-ink-800 shadow-xs';
  return (
    <li className="flex flex-col">
      <div className={`w-fit max-w-[88%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-sm ${tone}`}>{m.text}</div>
      {data && <DataView data={data} />}
      <span className={`mt-0.5 text-2xs text-ink-400 ${m.sender === 'customer' ? 'self-end' : ''}`}>
        {m.sender === 'customer' ? 'Customer' : m.sender === 'system' ? 'System' : 'Assistant'} · {when(m.at)}
      </span>
    </li>
  );
}

/** The structured part of an assistant line: options shown, summary, basis of each fare. */
function DataView({ data }: { data: any }) {
  return (
    <div className="mt-1 w-fit max-w-[88%] space-y-1.5 rounded-xl bg-white px-3 py-2 text-xs text-ink-700 ring-1 ring-ink-100">
      {Array.isArray(data.vehicles) && (
        <div>
          <p className="font-semibold text-ink-500">Vehicles shown</p>
          <ul className="mt-0.5 space-y-0.5">
            {data.vehicles.map((v: any) => (
              <li key={v.slug}>
                <span className="font-semibold">{v.name}</span> - {v.price ?? 'on request'}
                {v.basis && <span className="text-ink-400"> ({v.basis})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {Array.isArray(data.places) && (
        <p><span className="font-semibold text-ink-500">Places suggested:</span> {data.places.join(', ')}</p>
      )}
      {Array.isArray(data.summary) && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
          {data.summary.map(([k, v]: [string, string]) => (
            <div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
      )}
      {Array.isArray(data.chips) && data.chips.length > 0 && (
        <p className="text-ink-400">Options offered: {data.chips.join(' · ')}</p>
      )}
    </div>
  );
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return null; }
}
