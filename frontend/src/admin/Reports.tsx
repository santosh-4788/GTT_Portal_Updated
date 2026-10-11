/**
 * Reports — every figure computed from the records, nothing stored.
 *
 * The list of reports, their filters, columns, totals, drill-down and chart
 * all come from the server (routes/reports.ts), so the screen, the totals row
 * and the Excel export always agree.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { api, errorMessage } from '../lib/api';
import { inr, inrShort, dmy, dmyTime, humanise, monthLabel } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, Spinner } from '../components/ui';
import { DataTable, DateRange, ExportButton, SearchBox, presetRange, type Column } from '../components/data';
import { IconReports } from '../components/icons';

const PALETTE = ['#2A5698', '#12996A', '#C1810E', '#6D55D8', '#13968C', '#DC3A2B'];
const STATUS_OPTIONS = ['INQUIRY', 'CONFIRMED', 'ASSIGNED', 'ONTRIP', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const PAY_OPTIONS = [['', 'Any (excl. cancelled)'], ['UNPAID', 'Unpaid'], ['GENERATED', 'Issued'], ['PARTIALLY_PAID', 'Partially paid'], ['OVERDUE', 'Overdue'], ['PAID', 'Paid'], ['CANCELLED', 'Cancelled'], ['ALL', 'All, incl. cancelled']];
const SOURCES = [['', 'Any source'], ['EMAIL', 'Email'], ['WHATSAPP', 'WhatsApp'], ['PORTAL', 'Customer portal'], ['WALKIN', 'Walk-in / phone'], ['VENDOR', 'Vendor']];
const TRIP_TYPES = ['LOCAL', 'TRANSFER', 'AIRPORT', 'OUTSTATION', 'ROUND_TRIP', 'PACKAGE'];

function fmt(kind: string, v: any) {
  if (v === null || v === undefined || v === '') return <span className="text-ink-400">—</span>;
  switch (kind) {
    case 'money': return inr(v);
    case 'date': return dmy(v);
    case 'datetime': return dmyTime(v);
    case 'percent': return `${v}%`;
    case 'number': return Number(v).toLocaleString('en-IN');
    case 'id': return <span className="font-mono text-xs">{v}</span>;
    default: return String(v);
  }
}

export default function Reports() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<any[]>([]);
  const [key, setKey] = useState(params.get('report') ?? 'trip-register');
  const [f, setF] = useState({
    from: params.get('from') ?? presetRange('month').from, to: params.get('to') ?? presetRange('month').to,
    vendorId: '', source: '', status: '', paymentStatus: '', vehicleId: '', driverId: '', tripType: '',
  });
  const [vendors, setVendors] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [rep, setRep] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/reports').then((r) => setList(r.data.data ?? [])).catch((e) => setError(errorMessage(e)));
    api.get('/vendors/options').then((r) => setVendors(r.data.data ?? [])).catch(() => {});
    api.get('/fleet/vehicles').then((r) => setVehicles(r.data.data ?? [])).catch(() => {});
    api.get('/fleet/drivers').then((r) => setDrivers(r.data.data ?? [])).catch(() => {});
  }, []);

  const def = list.find((r) => r.key === key);
  const has = (k: string) => def?.filters?.includes(k);
  const query = useMemo(() => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v && (has(k) || k === 'from' || k === 'to')) q[k] = v;
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, def]);

  useEffect(() => {
    if (!def) return;
    setLoading(true); setError('');
    api.get(`/reports/${key}`, { params: query })
      .then((r) => setRep(r.data)).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
    setParams((p) => { const n = new URLSearchParams(p); n.set('report', key); n.set('from', f.from); n.set('to', f.to); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, query, def]);

  const groups = useMemo(() => {
    const out: Record<string, any[]> = {};
    for (const r of list) (out[r.group] ??= []).push(r);
    return out;
  }, [list]);

  const rows = useMemo(() => {
    const data = rep?.data ?? [];
    if (!search) return data;
    const s = search.toLowerCase();
    return data.filter((r: any) => Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(s)));
  }, [rep, search]);

  const columns: Column<any>[] = (rep?.columns ?? []).map((c: any) => ({
    key: c.key, header: c.header, align: ['money', 'number', 'percent'].includes(c.kind) ? 'right' : undefined,
    render: (r: any) => fmt(c.kind, r[c.key]),
  }));

  const drill = (r: any) => {
    const l = rep?.link;
    if (!l) return;
    const id = r[l.idKey];
    if (!id) return;
    const to = { trip: `/admin/trips?open=${id}`, invoice: `/admin/invoices/${id}`, vendor: `/admin/vendors/${id}/edit`,
      vehicle: '/admin/fleet?tab=vehicles', driver: '/admin/fleet?tab=drivers' }[l.to as string];
    if (to) navigate(to);
  };

  const chartData = useMemo(() => {
    if (!rep?.chart) return [];
    const x = rep.chart.x;
    return [...(rep.data ?? [])].slice(0, 24).map((r: any) => ({ ...r, __x: /^\d{4}-\d{2}$/.test(String(r[x])) ? monthLabel(r[x]) : humanise(String(r[x] ?? '')) }))
      .sort((a: any, b: any) => (/^\d{4}-\d{2}$/.test(String(a[x])) ? String(a[x]).localeCompare(String(b[x])) : 0));
  }, [rep]);
  const moneyChart = rep?.chart && rep.columns.find((c: any) => c.key === rep.chart.series[0].key)?.kind === 'money';

  const totalsFooter = rep?.totals?.length && rows.length ? (
    <tfoot>
      <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold">
        {rep.columns.map((c: any, i: number) => (
          <td key={c.key} className={`px-3.5 py-2.5 ${['money', 'number', 'percent'].includes(c.kind) ? 'td-num' : ''}`}>
            {i === 0 ? `Total (${rep.count})` : rep.totals.includes(c.key) ? fmt(c.kind, rep.totalsRow[c.key]) : ''}
          </td>
        ))}
      </tr>
    </tfoot>
  ) : undefined;

  const set = (patch: Partial<typeof f>) => setF((p) => ({ ...p, ...patch }));

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Operations, finance and fleet reports, worked out live from the records. Totals match the screens they come from; exports carry the filters you chose." />
      <div className="grid gap-5 lg:grid-cols-[16rem,1fr]">
        <aside className="card h-max p-2">
          {Object.entries(groups).map(([g, items]) => (
            <div key={g} className="mb-2">
              <p className="px-3 pb-1 pt-2 text-2xs font-bold uppercase tracking-[0.1em] text-ink-400">{g}</p>
              {items.map((r) => (
                <button key={r.key} onClick={() => { setKey(r.key); setSearch(''); }}
                  className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm ${key === r.key ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-ink-50'}`}>
                  {r.title}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <div className="min-w-0 space-y-4">
          {def && (
            <section className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-ink-900">{def.title}</h2>
                  <p className="mt-0.5 max-w-3xl text-sm text-ink-500">{def.description}</p>
                </div>
                <ExportButton url={`/reports/${key}/export`} params={query} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-3">
                {(has('from') || has('to')) && <DateRange from={f.from} to={f.to} onChange={(r) => set(r)} label={def.dateBasis} />}
                {has('vendorId') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })} aria-label="Vendor">
                    <option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.code === 'DIRECT' ? 'Walk-in customers' : v.vendor_name}</option>)}
                  </select>
                )}
                {has('source') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.source} onChange={(e) => set({ source: e.target.value })} aria-label="Source">
                    {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                {has('status') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.status} onChange={(e) => set({ status: e.target.value })} aria-label="Trip status">
                    <option value="">Any status</option>{STATUS_OPTIONS.map((s) => <option key={s} value={s}>{humanise(s)}</option>)}
                  </select>
                )}
                {has('paymentStatus') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.paymentStatus} onChange={(e) => set({ paymentStatus: e.target.value })} aria-label="Payment status">
                    {PAY_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                )}
                {has('tripType') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.tripType} onChange={(e) => set({ tripType: e.target.value })} aria-label="Trip type">
                    <option value="">Any trip type</option>{TRIP_TYPES.map((t) => <option key={t} value={t}>{humanise(t)}</option>)}
                  </select>
                )}
                {has('vehicleId') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })} aria-label="Vehicle">
                    <option value="">All vehicles</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
                  </select>
                )}
                {has('driverId') && (
                  <select className="input h-9 w-auto text-[13px]" value={f.driverId} onChange={(e) => set({ driverId: e.target.value })} aria-label="Driver">
                    <option value="">All drivers</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                  </select>
                )}
                <SearchBox value={search} onChange={setSearch} placeholder="Search within results…" className="ml-auto w-56" />
              </div>
            </section>
          )}

          {error ? <ErrorState message={error} /> : loading && !rep ? <div className="card p-6"><Spinner /></div> : rep && (
            <>
              {rep.totals?.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {rep.totals.slice(0, 4).map((k: string) => {
                    const c = rep.columns.find((x: any) => x.key === k);
                    return (
                      <div key={k} className="card p-4">
                        <p className="eyebrow">{c?.header}</p>
                        <p className="mt-1.5 font-display text-xl font-bold tabular-nums text-ink-900">{c?.kind === 'money' ? inr(rep.totalsRow[k]) : Number(rep.totalsRow[k]).toLocaleString('en-IN')}</p>
                      </div>
                    );
                  })}
                </div>
              )}
              {rep.chart && chartData.length > 1 && (
                <section className="card p-4">
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      {rep.chart.type === 'line' ? (
                        <LineChart data={chartData}>
                          <CartesianGrid vertical={false} stroke="#E3E8EF" />
                          <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#7A8CA0' }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fontSize: 11, fill: '#7A8CA0' }} axisLine={false} tickLine={false} tickFormatter={(v) => (moneyChart ? inrShort(v) : v)} width={56} />
                          <Tooltip formatter={(v: any) => (moneyChart ? inr(v) : v)} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                          {rep.chart.series.map((s: any, i: number) => <Line key={s.key} dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />)}
                        </LineChart>
                      ) : (
                        <BarChart data={chartData}>
                          <CartesianGrid vertical={false} stroke="#E3E8EF" />
                          <XAxis dataKey="__x" tick={{ fontSize: 11, fill: '#7A8CA0' }} axisLine={false} tickLine={false} interval={0} angle={chartData.length > 8 ? -25 : 0} textAnchor={chartData.length > 8 ? 'end' : 'middle'} height={chartData.length > 8 ? 60 : 30} />
                          <YAxis tick={{ fontSize: 11, fill: '#7A8CA0' }} axisLine={false} tickLine={false} tickFormatter={(v) => (moneyChart ? inrShort(v) : v)} width={56} />
                          <Tooltip formatter={(v: any) => (moneyChart ? inr(v) : v)} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                          {rep.chart.series.map((s: any, i: number) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={PALETTE[i % PALETTE.length]} radius={[4, 4, 0, 0]} maxBarSize={28} stackId={rep.chart.series.length > 2 ? 'a' : undefined} />)}
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </section>
              )}
              <section className="table-wrap">
                <div className="card-head">
                  <h3 className="card-title">{rows.length} row(s){search ? ` matching “${search}”` : ''}</h3>
                  {rep.link && <p className="card-sub">Click a row to open it.</p>}
                </div>
                <DataTable rows={rows} rowKey={(r: any) => JSON.stringify(r).slice(0, 200) + (r.id ?? '')} columns={columns}
                  pageSize={50} onRowClick={rep.link ? drill : undefined} loading={loading} footer={totalsFooter}
                  empty={<EmptyState title="No data for these filters" icon={<IconReports className="h-5 w-5" />} />} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
