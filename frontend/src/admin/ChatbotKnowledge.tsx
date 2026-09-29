import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { dmyTime } from '../lib/format';
import { useAuth } from '../lib/auth';
import { EmptyState, Loading, Modal, StatCard, Tabs } from '../components/ui';
import { IconPlus, IconSearch, IconTrash } from '../components/icons';
import { useToast } from '../components/Toast';

/* ==========================================================================
   Chatbot Knowledge.

   What the website assistant understands, kept by the office: the intents,
   the example questions that teach each one (in English, Hindi, Hinglish,
   Marathi and Marathi in Roman letters), synonyms for places, vehicles and
   services, and the questions it could not place.

   It never holds an answer's facts. Fares, vehicles and trips are read live
   from their own screens when a customer asks; an intent only says what the
   customer meant. A customer's words change nothing here until someone maps
   an unknown question to an intent.
   ========================================================================== */

const LANGS = [
  ['en', 'English'], ['hi', 'Hindi (देवनागरी)'], ['hi-Latn', 'Hinglish'], ['mr', 'Marathi (देवनागरी)'], ['mr-Latn', 'Marathi (Roman)'],
] as const;
type LangCode = (typeof LANGS)[number][0];
const LANG_NAME = Object.fromEntries(LANGS) as Record<string, string>;
const ENTITY_TYPES = ['LOCATION', 'VEHICLE', 'SERVICE', 'TRIP_TYPE', 'FARE_TERM', 'TIME', 'GENERAL'] as const;
const ENTITY_LABEL: Record<string, string> = {
  LOCATION: 'Locations', VEHICLE: 'Vehicle terms', SERVICE: 'Service terms', TRIP_TYPE: 'Trip types',
  FARE_TERM: 'Fare words', TIME: 'Time words', GENERAL: 'Other synonyms',
};

interface Intent {
  id: number; code: string; name: string; category: string; description: string | null; service_type: string | null;
  required_entities: string | null; optional_entities: string | null; dynamic: number; active: number;
  response_template: Record<string, string> | null; examples: number; times_matched: number;
}
interface Example { id: number; intent_code: string; intent_name: string; language: string; example_text: string; source: string; active: number }
interface Entity { id: number; entity_type: string; entity_value: string; display_name: string | null; synonyms: string | null; active: number }
interface Unknown { id: number; question: string; language: string | null; times_asked: number; last_asked_at: string; status: string; mapped_intent: string | null }
interface LogRow {
  id: number; message: string; language: string | null; intent: string | null; entities_json: string | null; confidence: number | null;
  created_at: string; customer_name: string | null; mobile: string | null; trip_id: string | null; bot_response: string | null;
}
interface Summary { intents: number; examples: number; entities: number; unknown: number; messages7d: number; understood7d: number }

type Tab = 'unknown' | 'intents' | 'examples' | 'entities' | 'logs';

export default function ChatbotKnowledge() {
  const toast = useToast();
  const { can } = useAuth();
  const editable = can('settings.update');
  const [tab, setTab] = useState<Tab>('unknown');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [intents, setIntents] = useState<Intent[] | null>(null);

  const loadBase = async () => {
    try {
      const [s, i] = await Promise.all([api.get('/chatbot/summary'), api.get('/chatbot/intents')]);
      setSummary(s.data);
      setIntents(i.data.data);
    } catch (err) {
      toast.error('Could not load the knowledge base', errorMessage(err));
      setIntents([]);
    }
  };
  useEffect(() => { void loadBase(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!intents) return <Loading label="Loading the chatbot knowledge…" />;
  const understood = summary && summary.messages7d ? Math.round((summary.understood7d / summary.messages7d) * 100) : null;

  return (
    <div className="page mx-auto max-w-7xl">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Chatbot knowledge</h1>
          <p className="page-sub">
            What the website assistant understands: intents, example questions in each language, and synonyms. Prices,
            vehicles and bookings are never stored here - the assistant reads them live from the portal. Questions it could
            not place wait under Unknown questions until you map them.
          </p>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Unknown questions" value={summary.unknown} sub="Waiting to be mapped" tone={summary.unknown ? 'warning' : 'default'} onClick={() => setTab('unknown')} />
          <StatCard label="Understood" value={understood == null ? '—' : `${understood}%`} sub={`${summary.messages7d} messages, last 7 days`} tone="brand" onClick={() => setTab('logs')} />
          <StatCard label="Intents" value={summary.intents} sub="Active" onClick={() => setTab('intents')} />
          <StatCard label="Example questions" value={summary.examples} sub="Across 5 languages" onClick={() => setTab('examples')} />
          <StatCard label="Synonyms" value={summary.entities} sub="Places, vehicles, terms" onClick={() => setTab('entities')} />
        </div>
      )}

      <div className="mt-5">
        <Tabs<Tab>
          active={tab} onChange={setTab}
          tabs={[
            { key: 'unknown', label: 'Unknown questions', count: summary?.unknown },
            { key: 'intents', label: 'Intents', count: intents.length },
            { key: 'examples', label: 'Question examples' },
            { key: 'entities', label: 'Synonyms & entities' },
            { key: 'logs', label: 'Conversation log' },
          ]}
        />
      </div>

      <div className="mt-4">
        {tab === 'unknown' && <UnknownTab intents={intents} editable={editable} onChange={loadBase} />}
        {tab === 'intents' && <IntentsTab intents={intents} editable={editable} onChange={loadBase} />}
        {tab === 'examples' && <ExamplesTab intents={intents} editable={editable} onChange={loadBase} />}
        {tab === 'entities' && <EntitiesTab editable={editable} onChange={loadBase} />}
        {tab === 'logs' && <LogsTab intents={intents} />}
      </div>
    </div>
  );
}

function IntentSelect({ intents, value, onChange, id, all }: { intents: Intent[]; value: string; onChange: (v: string) => void; id?: string; all?: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, Intent[]>();
    for (const i of intents) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    return [...m.entries()];
  }, [intents]);
  return (
    <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{all ?? 'Choose an intent'}</option>
      {groups.map(([cat, list]) => (
        <optgroup key={cat} label={cat}>
          {list.map((i) => <option key={i.code} value={i.code}>{i.name} ({i.code})</option>)}
        </optgroup>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------ unknown questions */
function UnknownTab({ intents, editable, onChange }: { intents: Intent[]; editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<'NEW' | 'MAPPED' | 'IGNORED'>('NEW');
  const [rows, setRows] = useState<Unknown[] | null>(null);
  const [pick, setPick] = useState<Record<number, string>>({});
  const load = async (s = status) => {
    try { setRows((await api.get('/chatbot/unknown', { params: { status: s } })).data.data); } catch (err) { toast.error('Could not load', errorMessage(err)); setRows([]); }
  };
  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  const map = async (u: Unknown) => {
    const intent = pick[u.id];
    if (!intent) { toast.error('Choose an intent first'); return; }
    try {
      await api.post(`/chatbot/unknown/${u.id}/map`, { intent });
      toast.success('Mapped', `"${u.question}" now teaches ${intent}.`);
      void load(); onChange();
    } catch (err) { toast.error('Could not map it', errorMessage(err)); }
  };
  const ignore = async (u: Unknown) => {
    try { await api.post(`/chatbot/unknown/${u.id}/ignore`); void load(); onChange(); } catch (err) { toast.error('Could not update', errorMessage(err)); }
  };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Show">
          <option value="NEW">Waiting to be mapped</option>
          <option value="MAPPED">Mapped</option>
          <option value="IGNORED">Ignored</option>
        </select>
        <p className="text-xs text-ink-500">Mapping adds the question as an example of that intent, so the next customer who asks it is understood.</p>
      </div>
      {!rows ? <Loading variant="table" /> : rows.length === 0 ? (
        <EmptyState title={status === 'NEW' ? 'Nothing waiting' : 'Nothing here'} body={status === 'NEW' ? 'Every question the assistant was asked has been understood or reviewed.' : 'No questions with this status.'} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Question</th><th>Language</th><th>Asked</th><th>Last asked</th><th>{status === 'NEW' ? 'Map to intent' : 'Intent'}</th>{status === 'NEW' && editable && <th />}</tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="td-strong min-w-[14rem]">{u.question}</td>
                  <td className="whitespace-nowrap text-xs">{LANG_NAME[u.language ?? ''] ?? '—'}</td>
                  <td className="tabular-nums">{u.times_asked}×</td>
                  <td className="whitespace-nowrap text-xs">{dmyTime(u.last_asked_at)}</td>
                  <td className="min-w-[14rem]">
                    {status === 'NEW' && editable
                      ? <IntentSelect intents={intents} value={pick[u.id] ?? ''} onChange={(v) => setPick({ ...pick, [u.id]: v })} />
                      : <span className="cell-code">{u.mapped_intent ?? '—'}</span>}
                  </td>
                  {status === 'NEW' && editable && (
                    <td className="whitespace-nowrap">
                      <button type="button" className="btn-primary btn-sm" onClick={() => void map(u)}>Map</button>
                      <button type="button" className="btn-ghost btn-sm ml-1" onClick={() => void ignore(u)}>Ignore</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ intents */
const BLANK_INTENT = { code: '', name: '', category: '', description: '', requiredEntities: '', optionalEntities: '', active: true, responseTemplate: {} as Record<string, string> };

function IntentsTab({ intents, editable, onChange }: { intents: Intent[]; editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<{ isNew: boolean; dynamic: boolean; form: typeof BLANK_INTENT } | null>(null);
  const [term, setTerm] = useState('');
  const shown = intents.filter((i) => !term || `${i.code} ${i.name} ${i.category}`.toLowerCase().includes(term.toLowerCase()));

  const openEdit = (i?: Intent) => setEdit(i ? {
    isNew: false, dynamic: !!i.dynamic,
    form: {
      code: i.code, name: i.name, category: i.category, description: i.description ?? '', requiredEntities: i.required_entities ?? '',
      optionalEntities: i.optional_entities ?? '', active: !!i.active, responseTemplate: { ...(i.response_template ?? {}) },
    },
  } : { isNew: true, dynamic: false, form: { ...BLANK_INTENT, responseTemplate: {} } });

  const save = async () => {
    if (!edit) return;
    const f = edit.form;
    try {
      if (edit.isNew) await api.post('/chatbot/intents', f);
      else {
        const { code, ...rest } = f;
        await api.put(`/chatbot/intents/${code}`, rest);
      }
      toast.success('Saved');
      setEdit(null);
      onChange();
    } catch (err) { toast.error('Could not save', errorMessage(err)); }
  };
  const toggle = async (i: Intent) => {
    try { await api.put(`/chatbot/intents/${i.code}`, { active: !i.active }); onChange(); } catch (err) { toast.error('Could not update', errorMessage(err)); }
  };
  const setForm = (k: keyof typeof BLANK_INTENT, v: unknown) => edit && setEdit({ ...edit, form: { ...edit.form, [k]: v } });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="input max-w-xs" placeholder="Find an intent" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Find an intent" />
        {editable && <button type="button" className="btn-primary ml-auto" onClick={() => openEdit()}><IconPlus className="h-4 w-4" /> New intent</button>}
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Intent</th><th>Category</th><th>Needs</th><th>Answer from</th><th>Examples</th><th>Matched</th><th>Active</th>{editable && <th />}</tr></thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.code} className={i.active ? '' : 'opacity-60'}>
                <td className="min-w-[14rem]"><span className="td-strong">{i.name}</span><p className="cell-meta cell-code">{i.code}</p>{i.description && <p className="cell-meta">{i.description}</p>}</td>
                <td className="whitespace-nowrap text-xs">{i.category}</td>
                <td className="text-xs">{i.required_entities || '—'}</td>
                <td className="whitespace-nowrap text-xs">{i.dynamic ? 'Live portal data' : i.response_template ? 'Your wording' : 'Built-in wording'}</td>
                <td className="tabular-nums">{i.examples}</td>
                <td className="tabular-nums">{i.times_matched}</td>
                <td>
                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!i.active} disabled={!editable} onChange={() => void toggle(i)} /> {i.active ? 'On' : 'Off'}
                  </label>
                </td>
                {editable && <td><button type="button" className="btn-outline btn-sm" onClick={() => openEdit(i)}>Edit</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!edit} onClose={() => setEdit(null)} size="lg"
        title={edit?.isNew ? 'New intent' : `Edit ${edit?.form.code}`}
        subtitle="An intent is what the customer means. Teach it with example questions on the next tab."
        footer={<><button type="button" className="btn-outline" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" onClick={() => void save()}>Save</button></>}
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="in-code">Code</label>
              <input id="in-code" className="input" value={edit.form.code} disabled={!edit.isNew} onChange={(e) => setForm('code', e.target.value.toUpperCase())} placeholder="PET_TRAVEL" />
            </div>
            <div>
              <label className="label" htmlFor="in-name">Name</label>
              <input id="in-name" className="input" value={edit.form.name} onChange={(e) => setForm('name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="in-cat">Category</label>
              <input id="in-cat" className="input" value={edit.form.category} onChange={(e) => setForm('category', e.target.value)} placeholder="Booking, Fare, Support…" />
            </div>
            <div>
              <label className="label" htmlFor="in-req">Required details</label>
              <input id="in-req" className="input" value={edit.form.requiredEntities} onChange={(e) => setForm('requiredEntities', e.target.value)} placeholder="route, leg" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="in-desc">Description</label>
              <input id="in-desc" className="input" value={edit.form.description} onChange={(e) => setForm('description', e.target.value)} />
            </div>
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={edit.form.active} onChange={(e) => setForm('active', e.target.checked)} /> Active - the assistant uses this intent
            </label>
            <div className="sm:col-span-2">
              <p className="label">Answer wording (optional)</p>
              {edit.dynamic ? (
                <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
                  This intent is answered from live portal data (fares, vehicles or the booking itself), so its wording is built by
                  the assistant and cannot be replaced - that is what keeps a price or a status from ever being out of date.
                </p>
              ) : (
                <>
                  <p className="mb-2 text-xs text-ink-500">
                    Leave blank to keep the built-in answer. You can use {'{phone}'} {'{whatsapp}'} {'{email}'} {'{address}'} {'{owner}'} {'{hours}'}.
                    Write only what the portal and your policies actually say.
                  </p>
                  <div className="grid gap-2">
                    {LANGS.map(([code, name]) => (
                      <div key={code}>
                        <label className="text-2xs font-semibold uppercase tracking-wide text-ink-500" htmlFor={`tpl-${code}`}>{name}</label>
                        <textarea
                          id={`tpl-${code}`} className="input min-h-[56px] text-sm" value={edit.form.responseTemplate[code] ?? ''}
                          onChange={(e) => setForm('responseTemplate', { ...edit.form.responseTemplate, [code]: e.target.value })}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

/* ----------------------------------------------------------------- examples */
function ExamplesTab({ intents, editable, onChange }: { intents: Intent[]; editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ intent: '', lang: '', q: '' });
  const [rows, setRows] = useState<Example[] | null>(null);
  const [add, setAdd] = useState<{ intent: string; language: LangCode; text: string }>({ intent: '', language: 'en', text: '' });
  const load = async (p = f) => {
    try { setRows((await api.get('/chatbot/examples', { params: Object.fromEntries(Object.entries(p).filter(([, v]) => v)) })).data.data); } catch (err) { toast.error('Could not load', errorMessage(err)); setRows([]); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!add.intent || !add.text.trim()) { toast.error('Choose an intent and type the question'); return; }
    try {
      await api.post('/chatbot/examples', add);
      toast.success('Example added');
      setAdd({ ...add, text: '' });
      void load(); onChange();
    } catch (err) { toast.error('Could not add it', errorMessage(err)); }
  };
  const toggle = async (x: Example) => { try { await api.put(`/chatbot/examples/${x.id}`, { active: !x.active }); void load(); onChange(); } catch (err) { toast.error('Could not update', errorMessage(err)); } };
  const remove = async (x: Example) => { try { await api.delete(`/chatbot/examples/${x.id}`); void load(); onChange(); } catch (err) { toast.error('Could not delete', errorMessage(err)); } };

  return (
    <section>
      {editable && (
        <form onSubmit={create} className="filters mb-3">
          <p className="mb-2 text-sm font-semibold text-ink-800">Teach a question</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr,0.8fr,2fr,auto]">
            <IntentSelect intents={intents} value={add.intent} onChange={(v) => setAdd({ ...add, intent: v })} />
            <select className="input" value={add.language} onChange={(e) => setAdd({ ...add, language: e.target.value as LangCode })} aria-label="Language">
              {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
            <input className="input" value={add.text} onChange={(e) => setAdd({ ...add, text: e.target.value })} placeholder="e.g. Pune ka rate kya hai?" aria-label="Example question" />
            <button type="submit" className="btn-primary"><IconPlus className="h-4 w-4" /> Add</button>
          </div>
        </form>
      )}
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="min-w-[14rem]"><IntentSelect intents={intents} value={f.intent} all="All intents" onChange={(v) => { const n = { ...f, intent: v }; setF(n); void load(n); }} /></div>
        <select className="input w-auto" value={f.lang} onChange={(e) => { const n = { ...f, lang: e.target.value }; setF(n); void load(n); }} aria-label="Language">
          <option value="">All languages</option>
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <input className="input max-w-xs" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search the questions" aria-label="Search" />
        <button type="submit" className="btn-outline"><IconSearch className="h-4 w-4" /> Search</button>
      </form>
      {!rows ? <Loading variant="table" /> : rows.length === 0 ? <EmptyState title="No examples match" body="Try another intent or language." /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Question</th><th>Intent</th><th>Language</th><th>Source</th><th>Active</th>{editable && <th />}</tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className={x.active ? '' : 'opacity-60'}>
                  <td className="td-strong min-w-[16rem]">{x.example_text}</td>
                  <td className="whitespace-nowrap text-xs">{x.intent_name}<p className="cell-meta cell-code">{x.intent_code}</p></td>
                  <td className="whitespace-nowrap text-xs">{LANG_NAME[x.language] ?? x.language}</td>
                  <td className="text-xs">{x.source === 'SEED' ? 'Built in' : x.source === 'LEARNED' ? 'From a customer' : 'Added here'}</td>
                  <td><input type="checkbox" checked={!!x.active} disabled={!editable} onChange={() => void toggle(x)} aria-label="Active" /></td>
                  {editable && <td><button type="button" className="btn-ghost btn-sm text-danger-600" onClick={() => void remove(x)} aria-label="Delete"><IconTrash className="h-4 w-4" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- entities */
function EntitiesTab({ editable, onChange }: { editable: boolean; onChange: () => void }) {
  const toast = useToast();
  const [type, setType] = useState('');
  const [rows, setRows] = useState<Entity[] | null>(null);
  const [edit, setEdit] = useState<{ id?: number; type: string; value: string; display: string; synonyms: string; active: boolean } | null>(null);
  const load = async (t = type) => {
    try { setRows((await api.get('/chatbot/entities', { params: t ? { type: t } : {} })).data.data); } catch (err) { toast.error('Could not load', errorMessage(err)); setRows([]); }
  };
  useEffect(() => { void load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!edit) return;
    try {
      const body = { type: edit.type, value: edit.value, display: edit.display, synonyms: edit.synonyms, active: edit.active };
      if (edit.id) await api.put(`/chatbot/entities/${edit.id}`, body); else await api.post('/chatbot/entities', body);
      toast.success('Saved'); setEdit(null); void load(); onChange();
    } catch (err) { toast.error('Could not save', errorMessage(err)); }
  };
  const remove = async (x: Entity) => { try { await api.delete(`/chatbot/entities/${x.id}`); void load(); onChange(); } catch (err) { toast.error('Could not delete', errorMessage(err)); } };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">Everything</option>
          {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABEL[t]}</option>)}
        </select>
        <p className="text-xs text-ink-500">Place and trip-type synonyms are rewritten before the assistant reads a message ("Poona" is read as Pune); vehicle and fare words help it recognise the question.</p>
        {editable && (
          <button type="button" className="btn-primary ml-auto" onClick={() => setEdit({ type: type || 'LOCATION', value: '', display: '', synonyms: '', active: true })}>
            <IconPlus className="h-4 w-4" /> Add
          </button>
        )}
      </div>
      {!rows ? <Loading variant="table" /> : rows.length === 0 ? <EmptyState title="Nothing here yet" body="Add a place or term and the ways customers write it." /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Type</th><th>Value</th><th>Shown as</th><th>Synonyms / spellings</th><th>Active</th>{editable && <th />}</tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id} className={x.active ? '' : 'opacity-60'}>
                  <td className="whitespace-nowrap text-xs">{ENTITY_LABEL[x.entity_type] ?? x.entity_type}</td>
                  <td className="td-strong cell-code">{x.entity_value}</td>
                  <td>{x.display_name ?? '—'}</td>
                  <td className="min-w-[16rem] text-xs">{x.synonyms || '—'}</td>
                  <td className="text-xs">{x.active ? 'On' : 'Off'}</td>
                  {editable && (
                    <td className="whitespace-nowrap">
                      <button type="button" className="btn-outline btn-sm" onClick={() => setEdit({ id: x.id, type: x.entity_type, value: x.entity_value, display: x.display_name ?? '', synonyms: x.synonyms ?? '', active: !!x.active })}>Edit</button>
                      <button type="button" className="btn-ghost btn-sm ml-1 text-danger-600" onClick={() => void remove(x)} aria-label="Delete"><IconTrash className="h-4 w-4" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!edit} onClose={() => setEdit(null)} size="md" title={edit?.id ? 'Edit entry' : 'Add an entry'}
        footer={<><button type="button" className="btn-outline" onClick={() => setEdit(null)}>Cancel</button><button type="button" className="btn-primary" onClick={() => void save()}>Save</button></>}
      >
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="en-type">Type</label>
              <select id="en-type" className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="en-value">Value (what it means)</label>
              <input id="en-value" className="input" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} placeholder="pune" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="en-display">Shown as</label>
              <input id="en-display" className="input" value={edit.display} onChange={(e) => setEdit({ ...edit, display: e.target.value })} placeholder="Pune" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="en-syn">Synonyms and spellings, comma separated</label>
              <textarea id="en-syn" className="input min-h-[70px]" value={edit.synonyms} onChange={(e) => setEdit({ ...edit, synonyms: e.target.value })} placeholder="poona, puna, पुणे" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
}

/* ------------------------------------------------------------ conversation log */
function LogsTab({ intents }: { intents: Intent[] }) {
  const toast = useToast();
  const [f, setF] = useState({ intent: '', lang: '', q: '', low: '' });
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const load = async (p = f) => {
    try { setRows((await api.get('/chatbot/logs', { params: Object.fromEntries(Object.entries(p).filter(([, v]) => v)) })).data.data); } catch (err) { toast.error('Could not load', errorMessage(err)); setRows([]); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setNow = (k: keyof typeof f, v: string) => { const n = { ...f, [k]: v }; setF(n); void load(n); };

  return (
    <section>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <div className="min-w-[14rem]">
          <select className="input" value={f.intent} onChange={(e) => setNow('intent', e.target.value)} aria-label="Intent">
            <option value="">All intents</option>
            <option value="UNKNOWN_INTENT">Not understood</option>
            <option value="FAQ">Answered from the FAQs</option>
            {intents.map((i) => <option key={i.code} value={i.code}>{i.name}</option>)}
          </select>
        </div>
        <select className="input w-auto" value={f.lang} onChange={(e) => setNow('lang', e.target.value)} aria-label="Language">
          <option value="">All languages</option>
          {LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
        <input className="input max-w-xs" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search messages" aria-label="Search" />
        <label className="inline-flex items-center gap-2 text-xs">
          <input type="checkbox" checked={f.low === '1'} onChange={(e) => setNow('low', e.target.checked ? '1' : '')} /> Low confidence only
        </label>
        <button type="submit" className="btn-outline"><IconSearch className="h-4 w-4" /> Search</button>
      </form>
      {!rows ? <Loading variant="table" /> : rows.length === 0 ? <EmptyState title="No messages yet" body="Each customer message to the website assistant appears here with what it understood." /> : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>When</th><th>Customer said</th><th>Language</th><th>Understood as</th><th>Details found</th><th>Assistant replied</th><th>Chat</th></tr></thead>
            <tbody>
              {rows.map((x) => {
                const ents = x.entities_json ? Object.entries(JSON.parse(x.entities_json) as Record<string, unknown>).filter(([, v]) => v != null && v !== '') : [];
                return (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-xs">{dmyTime(x.created_at)}</td>
                    <td className="td-strong min-w-[12rem] max-w-[18rem]">{x.message}</td>
                    <td className="whitespace-nowrap text-xs">{LANG_NAME[x.language ?? ''] ?? '—'}</td>
                    <td className="whitespace-nowrap text-xs">
                      <span className={`cell-code ${x.intent === 'UNKNOWN_INTENT' ? 'text-warn-700' : ''}`}>{x.intent ?? '—'}</span>
                      {x.confidence != null && <p className="cell-meta">{Math.round(x.confidence * 100)}% sure</p>}
                    </td>
                    <td className="min-w-[10rem] text-2xs text-ink-600">{ents.length ? ents.map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'}</td>
                    <td className="min-w-[14rem] max-w-[22rem]"><span className="line-clamp-3 whitespace-pre-line text-xs text-ink-600">{x.bot_response ?? '—'}</span></td>
                    <td className="whitespace-nowrap text-xs">{x.customer_name || x.mobile || '—'}{x.trip_id && <p className="cell-meta">{x.trip_id}</p>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
