/**
 * My invoices — every live invoice that covers one of my trips.
 *
 * Statuses read as the office's register does (Issued, Partially paid,
 * Overdue, Paid); overdue is worked out from the due date on the server.
 * ?status=UNPAID starts on the unpaid filter (the dashboard links that way).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { inr, dmy } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, StatusBadge, Spinner } from '../components/ui';
import { DataTable, Kpi, SearchBox, Segmented } from '../components/data';
import { IconDownload, IconEye, IconInvoices, IconRupee, IconCheck, IconWarning, IconPhone } from '../components/icons';
import { COMPANY } from '../site/siteData';
import type { ServerInvoice } from '../site/accountApi';
import { useAccount } from './AccountLayout';
import { useInvoiceActions } from './shared';

type Filter = '' | 'UNPAID' | 'OVERDUE' | 'PAID';
const FILTERS: { value: Filter; label: string; test: (i: ServerInvoice) => boolean }[] = [
  { value: '', label: 'All', test: () => true },
  { value: 'UNPAID', label: 'Unpaid', test: (i) => i.outstanding > 0.009 },
  { value: 'OVERDUE', label: 'Overdue', test: (i) => i.status === 'OVERDUE' },
  { value: 'PAID', label: 'Paid', test: (i) => i.status === 'PAID' },
];

export default function AccountInvoices() {
  const { invoices, invoicesLoading, invoicesError, reloadInvoices } = useAccount();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState<Filter>((params.get('status') as Filter) ?? '');
  const [search, setSearch] = useState('');
  const inv = useInvoiceActions();

  const totals = useMemo(() => ({
    billed: invoices.reduce((s, i) => s + i.total, 0),
    paid: invoices.reduce((s, i) => s + i.paid, 0),
    outstanding: invoices.reduce((s, i) => s + i.outstanding, 0),
    overdue: invoices.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + i.outstanding, 0),
  }), [invoices]);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    const s = search.trim().toLowerCase();
    return invoices.filter((i) => f.test(i)
      && (!s || i.number.toLowerCase().includes(s) || i.tripIds.some((t) => t.toLowerCase().includes(s))));
  }, [invoices, filter, search]);

  return (
    <div className="page">
      <PageHeader
        title="Invoices"
        subtitle="Every invoice for your trips, with what has been paid and what is still due."
        actions={
          <a href={`tel:+91${COMPANY.mobile}`} className="btn-outline btn-sm"><IconPhone className="h-3.5 w-3.5" /> Question about a bill?</a>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Invoiced" value={inr(totals.billed)} tone="brand" icon={<IconInvoices className="h-4 w-4" />}
          sub={`${invoices.length} invoice(s)`} onClick={() => setFilter('')} />
        <Kpi label="Paid" value={inr(totals.paid)} tone="success" icon={<IconCheck className="h-4 w-4" />}
          onClick={() => setFilter('PAID')} />
        <Kpi label="Outstanding" value={inr(totals.outstanding)} tone="warning" icon={<IconRupee className="h-4 w-4" />}
          sub="Still to be paid" onClick={() => setFilter('UNPAID')} />
        <Kpi label="Overdue" value={inr(totals.overdue)} tone={totals.overdue > 0 ? 'danger' : 'default'}
          icon={<IconWarning className="h-4 w-4" />} sub="Past the due date" onClick={() => setFilter('OVERDUE')} />
      </div>

      <section className="card p-3">
        <Segmented value={filter} onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: invoices.filter(f.test).length, alert: f.value === 'OVERDUE' }))} />
        <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-ink-100 pt-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Invoice no. or Trip ID…" className="min-w-[14rem] flex-1" />
        </div>
      </section>

      {invoicesError ? <ErrorState message={invoicesError} onRetry={reloadInvoices} /> : (
        <section className="table-wrap">
          <DataTable
            rows={rows} rowKey={(i) => i.id} loading={invoicesLoading}
            onRowClick={(i) => i.downloadable && inv.view(i)}
            empty={<EmptyState title={invoices.length ? 'No invoices match' : 'No invoices yet'}
              body={invoices.length ? 'Clear the search or pick another filter.' : 'An invoice appears here once a completed trip has been billed.'} />}
            columns={[
              { key: 'number', header: 'Invoice', render: (i) => (
                <div>
                  <span className="font-mono text-xs font-semibold text-brand-700">{i.number}</span>
                  <span className="cell-meta block max-w-[14rem] truncate" title={i.tripIds.join(', ')}>{i.tripIds.join(', ')}</span>
                </div>
              ) },
              { key: 'date', header: 'Date', render: (i) => <span className="whitespace-nowrap">{dmy(i.date)}</span> },
              { key: 'dueDate', header: 'Due', render: (i) => <span className="whitespace-nowrap">{dmy(i.dueDate)}</span> },
              { key: 'tax', header: 'GST', align: 'right', render: (i) => i.taxMode === 'NONE' || !i.tax ? <span className="text-ink-400">—</span> : inr(i.tax) },
              { key: 'total', header: 'Total', align: 'right', render: (i) => <span className="font-semibold text-ink-900">{inr(i.total)}</span> },
              { key: 'paid', header: 'Paid', align: 'right', render: (i) => i.paid > 0 ? inr(i.paid) : <span className="text-ink-400">—</span> },
              { key: 'outstanding', header: 'Outstanding', align: 'right', render: (i) => (
                <span className={i.outstanding > 0.009 ? 'font-semibold text-ink-900' : 'text-ink-400'}>{inr(i.outstanding)}</span>
              ) },
              { key: 'status', header: 'Status', render: (i) => <StatusBadge value={i.status} /> },
              { key: 'a', header: '', sortable: false, sticky: true, align: 'right', render: (i) => i.downloadable ? (
                <div className="flex justify-end gap-1">
                  <button type="button" className="btn-ghost btn-icon" title="View" aria-label="View"
                    onClick={(e) => { e.stopPropagation(); inv.view(i); }} disabled={!!inv.busy}>
                    <IconEye className="h-4 w-4" />
                  </button>
                  <button type="button" className="btn-ghost btn-icon" title="Download" aria-label="Download"
                    onClick={(e) => { e.stopPropagation(); inv.download(i); }} disabled={!!inv.busy}>
                    {inv.busy === i.id ? <Spinner /> : <IconDownload className="h-4 w-4" />}
                  </button>
                </div>
              ) : <span className="cell-meta">Being prepared</span> },
            ]}
          />
        </section>
      )}
    </div>
  );
}
