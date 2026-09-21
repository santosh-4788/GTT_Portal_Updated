import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, downloadFile } from '../lib/api';
import { inr, monthStartIso, todayIso } from '../lib/format';
import { Loading, EmptyState, ErrorState } from '../components/ui';
import { useToast } from '../components/Toast';
import { DateField } from '../components/DateTimeField';

const MONEY_KEYS = /amount|total|taxable|^tax$|paid|outstanding|parking|billing/i;

export default function Reports() {
  const [reports, setReports] = useState<any[]>([]);
  const [active, setActive] = useState('vendor-billing');
  const [from, setFrom] = useState(monthStartIso());
  const [to, setTo] = useState(todayIso());
  const [vendorId, setVendorId] = useState('');
  const [vendors, setVendors] = useState<any[]>([]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    Promise.all([api.get('/reports'), api.get('/vendors/options')])
      .then(([r, v]) => {
        setReports(r.data.data ?? []);
        setVendors(v.data.data ?? []);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get(`/reports/${active}`, { params: { from, to, vendorId } });
      setResult(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [active, from, to, vendorId]);

  useEffect(() => { load(); }, [load]);

  const exportAs = async (format: 'xlsx' | 'csv') => {
    try {
      await downloadFile(`/reports/${active}/export?format=${format}&from=${from}&to=${to}&vendorId=${vendorId}`);
      toast.success(`Exported as ${format.toUpperCase()}`);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    }
  };

  const totalsRow = result?.data?.length
    ? result.columns.reduce((acc: any, c: any) => {
        if (MONEY_KEYS.test(c.key)) {
          acc[c.key] = result.data.reduce((s: number, r: any) => s + Number(r[c.key] ?? 0), 0);
        }
        return acc;
      }, {} as Record<string, number>)
    : null;

  return (
    <div className="page">
      <div className="page-head animate-fade-down">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-sub">
            Filter by date and vendor, then print or export to Excel or CSV.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <button onClick={() => window.print()} className="btn-outline btn-sm" disabled={!result?.data?.length}>🖨 Print</button>
          <button onClick={() => exportAs('csv')} className="btn-outline btn-sm" disabled={!result?.data?.length}>Export CSV</button>
          <button onClick={() => exportAs('xlsx')} className="btn-primary btn-sm" disabled={!result?.data?.length}>Export Excel</button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[16rem,1fr]">
        <aside className="card h-fit p-2 no-print">
          <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">Available reports</p>
          {reports.map((r) => (
            <button
              key={r.key}
              onClick={() => setActive(r.key)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                active === r.key ? 'bg-brand-500 text-white' : 'text-ink-700 hover:bg-ink-50'
              }`}
            >
              {r.title}
            </button>
          ))}
        </aside>

        <div className="space-y-4">
          <div className="card p-4 no-print">
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">From</label>
                <DateField value={from} onChange={setFrom} />
              </div>
              <div>
                <label className="label">To</label>
                <DateField value={to} onChange={setTo} />
              </div>
              <div>
                <label className="label">Vendor</label>
                <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">All vendors</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendor_name}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button className="btn-ghost btn-sm" onClick={() => { setFrom(''); setTo(''); setVendorId(''); }}>
                  Clear
                </button>
              </div>
            </div>
          </div>

          {loading ? <Loading /> : error ? <ErrorState message={error} onRetry={load} /> : !result ? null : (
            <div className="table-wrap print-sheet">
              <div className="border-b border-ink-200 bg-ink-50 px-4 py-3">
                <h2 className="font-semibold text-ink-900">{result.title}</h2>
                <p className="mt-0.5 text-xs text-ink-500">
                  {from || 'all time'} to {to || 'today'}
                  {vendorId && ` · ${vendors.find((v) => String(v.id) === vendorId)?.vendor_name}`}
                  {' · '}{result.data.length} row{result.data.length === 1 ? '' : 's'}
                </p>
              </div>

              {result.data.length === 0 ? (
                <EmptyState title="No data for this period"
                  body="Try widening the date range or clearing the vendor filter." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="tbl">
                    <thead>
                      <tr>
                        {result.columns.map((c: any) => (
                          <th key={c.key} className={MONEY_KEYS.test(c.key) ? 'text-right' : ''}>{c.header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.map((row: any, i: number) => (
                        <tr key={i}>
                          {result.columns.map((c: any) => {
                            const v = row[c.key];
                            const money = MONEY_KEYS.test(c.key);
                            return (
                              <td key={c.key} className={money ? 'text-right tabular-nums whitespace-nowrap' : ''}>
                                {money ? inr(v) : (v ?? '—')}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      {totalsRow && (
                        <tr className="bg-ink-50 font-bold">
                          {result.columns.map((c: any, i: number) => (
                            <td key={c.key} className={MONEY_KEYS.test(c.key) ? 'text-right tabular-nums' : ''}>
                              {i === 0 ? 'Total' : MONEY_KEYS.test(c.key) ? inr(totalsRow[c.key]) : ''}
                            </td>
                          ))}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
