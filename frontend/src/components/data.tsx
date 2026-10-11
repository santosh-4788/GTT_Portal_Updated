/* ===========================================================================
   Data furniture for the portal's list screens.

   Every list in the portal is built from these, so a table, its sort arrows,
   its selection checkboxes, its export button and its row menu look and
   behave the same on Trips as on Invoices as on Fleet.
   =========================================================================== */
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { downloadFile, errorMessage } from '../lib/api';
import { useToast } from './Toast';
import { Spinner } from './ui';
import { DateField } from './DateTimeField';
import { IconDownload, IconMore, IconSearch, IconClose, IconChevron } from './icons';
import { todayLocalIso } from '../lib/format';

/* ---------------------------------------------------------------------------
   Sortable, selectable table
   --------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  /** Value used for client-side sorting; defaults to row[key]. */
  sortValue?: (row: T) => unknown;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  className?: string;
  headerClassName?: string;
  /** Keep this column visible at the right edge on narrow screens. */
  sticky?: boolean;
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a).localeCompare(String(b), 'en-IN', { numeric: true, sensitivity: 'base' });
}

export function DataTable<T>({
  columns, rows, rowKey, onRowClick, empty, loading,
  selectable, selected, onSelectedChange, isSelectable,
  sort, onSortChange, clientSort = true, pageSize, footer, dense, rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  loading?: boolean;
  selectable?: boolean;
  selected?: Set<string | number>;
  onSelectedChange?: (next: Set<string | number>) => void;
  isSelectable?: (row: T) => boolean;
  /** Controlled sort (for server-sorted lists). */
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  /** Sort the given rows in the browser (default) — off when the server sorts. */
  clientSort?: boolean;
  /** Paginate in the browser. */
  pageSize?: number;
  footer?: ReactNode;
  dense?: boolean;
  rowClassName?: (row: T) => string;
}) {
  const [innerSort, setInnerSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const activeSort = sort !== undefined ? sort : innerSort;

  useEffect(() => { setPage(0); }, [rows.length]);

  const sorted = useMemo(() => {
    if (!clientSort || !activeSort) return rows;
    const col = columns.find((c) => c.key === activeSort.key);
    if (!col) return rows;
    const get = col.sortValue ?? ((r: T) => (r as any)[col.key]);
    const out = [...rows].sort((a, b) => compare(get(a), get(b)));
    return activeSort.dir === 'desc' ? out.reverse() : out;
  }, [rows, activeSort, columns, clientSort]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const visible = pageSize ? sorted.slice(page * pageSize, page * pageSize + pageSize) : sorted;

  const toggleSort = (key: string) => {
    const next: SortState = !activeSort || activeSort.key !== key
      ? { key, dir: 'asc' }
      : activeSort.dir === 'asc' ? { key, dir: 'desc' } : null;
    if (onSortChange) onSortChange(next);
    else setInnerSort(next);
  };

  const selectableRows = selectable ? rows.filter((r) => (isSelectable ? isSelectable(r) : true)) : [];
  const allOn = selectable && selectableRows.length > 0 && selectableRows.every((r) => selected?.has(rowKey(r)));
  const someOn = selectable && selectableRows.some((r) => selected?.has(rowKey(r)));
  const toggleAll = () => {
    if (!onSelectedChange) return;
    const next = new Set(selected ?? []);
    if (allOn) selectableRows.forEach((r) => next.delete(rowKey(r)));
    else selectableRows.forEach((r) => next.add(rowKey(r)));
    onSelectedChange(next);
  };
  const toggleOne = (r: T) => {
    if (!onSelectedChange) return;
    const next = new Set(selected ?? []);
    const k = rowKey(r);
    if (next.has(k)) next.delete(k); else next.add(k);
    onSelectedChange(next);
  };

  const pad = dense ? 'py-1.5' : '';

  return (
    <div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              {selectable && (
                <th className="w-9">
                  <input
                    type="checkbox" className="check" aria-label="Select all"
                    checked={!!allOn}
                    ref={(el) => { if (el) el.indeterminate = !allOn && !!someOn; }}
                    onChange={toggleAll}
                  />
                </th>
              )}
              {columns.map((c) => {
                const on = activeSort?.key === c.key;
                const canSort = c.sortable !== false && (clientSort || !!onSortChange) && typeof c.header === 'string';
                return (
                  <th
                    key={c.key}
                    className={`${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''} ${c.sticky ? 'sticky-end' : ''} ${c.headerClassName ?? ''}`}
                    aria-sort={on ? (activeSort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {canSort ? (
                      <button
                        type="button" onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 uppercase tracking-[0.07em] hover:text-ink-800 ${on ? 'text-ink-800' : ''}`}
                      >
                        {c.header}
                        <span className={`text-[9px] leading-none ${on ? 'opacity-100' : 'opacity-30'}`}>
                          {on && activeSort!.dir === 'desc' ? '▼' : '▲'}
                        </span>
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={`sk${i}`}>
                  {selectable && <td />}
                  {columns.map((c) => <td key={c.key}><div className="skeleton h-3.5 w-full max-w-[9rem]" /></td>)}
                </tr>
              ))
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="!p-0">
                  {empty ?? <p className="px-4 py-10 text-center text-sm text-ink-500">Nothing to show.</p>}
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const k = rowKey(r);
                const on = selected?.has(k);
                const canPick = selectable && (isSelectable ? isSelectable(r) : true);
                return (
                  <tr
                    key={k}
                    className={`${on ? 'is-selected' : ''} ${onRowClick ? 'cursor-pointer' : ''} ${rowClassName?.(r) ?? ''}`}
                    onClick={onRowClick ? (e) => {
                      // Clicks on controls inside the row do their own thing.
                      if ((e.target as HTMLElement).closest('button, a, input, select, label, [data-stop]')) return;
                      onRowClick(r);
                    } : undefined}
                  >
                    {selectable && (
                      <td className={pad}>
                        <input
                          type="checkbox" className="check" aria-label="Select row"
                          checked={!!on} disabled={!canPick} onChange={() => toggleOne(r)}
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${pad} ${c.align === 'right' ? 'td-num' : c.align === 'center' ? 'text-center' : ''} ${c.sticky ? 'sticky-end' : ''} ${c.className ?? ''}`}
                      >
                        {c.render ? c.render(r) : ((r as any)[c.key] ?? <span className="text-ink-400">—</span>)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
          {footer}
        </table>
      </div>
      {pageSize && sorted.length > pageSize && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 bg-ink-50/60 px-4 py-2.5">
          <p className="text-xs text-ink-500">
            Showing <span className="font-semibold text-ink-800">{page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)}</span>{' '}
            of <span className="font-semibold text-ink-800">{sorted.length}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <button className="btn-outline btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="px-2 text-xs font-medium tabular-nums text-ink-600">{page + 1} / {pages}</span>
            <button className="btn-outline btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Pop-over menu (row actions, export choices)
   --------------------------------------------------------------------------- */

export interface MenuItem {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
  divider?: boolean;
}

export function Menu({
  trigger, items, align = 'right', label = 'More actions', width = 'w-56',
}: {
  trigger?: ReactNode; items: (MenuItem | false | null | undefined)[];
  align?: 'left' | 'right'; label?: string; width?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const list = items.filter(Boolean) as MenuItem[];
  if (!list.length) return null;

  return (
    <div ref={box} className="relative inline-block" data-stop>
      <button
        type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={trigger ? '' : 'btn-ghost btn-icon'}
      >
        {trigger ?? <IconMore className="h-4 w-4" />}
      </button>
      {open && (
        <div
          role="menu"
          className={`card absolute z-40 mt-1.5 ${width} animate-scale-in p-1.5 shadow-lift ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {list.map((it, i) => it.divider ? (
            <div key={`d${i}`} className="my-1 h-px bg-ink-100" />
          ) : it.href ? (
            <a key={it.label} href={it.href} role="menuitem" onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-700 hover:bg-ink-50">
              {it.icon && <span className="text-ink-400">{it.icon}</span>}{it.label}
            </a>
          ) : (
            <button
              key={it.label} type="button" role="menuitem" disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick?.(); }}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                it.danger ? 'text-danger-600 hover:bg-danger-50' : 'text-ink-700 hover:bg-ink-50'}`}
            >
              {it.icon && <span className={`mt-px ${it.danger ? '' : 'text-ink-400'}`}>{it.icon}</span>}
              <span className="min-w-0 flex-1">
                {it.label}
                {it.hint && <span className="block text-2xs text-ink-400">{it.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Export — Excel or CSV of exactly what the list is showing
   --------------------------------------------------------------------------- */

export function ExportButton({
  url, params = {}, label = 'Export', csv = true, filename,
}: {
  url: string; params?: Record<string, unknown>; label?: string; csv?: boolean; filename?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async (format: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      const all: Record<string, unknown> = { ...params, format };
      Object.entries(all).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '' && v !== 0) qs.set(k, String(v));
      });
      await downloadFile(`${url}${url.includes('?') ? '&' : '?'}${qs.toString()}`, filename ? `${filename}.${format}` : undefined);
    } catch (err) {
      toast.error('Export failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!csv) {
    return (
      <button className="btn-outline btn-sm" onClick={() => go('xlsx')} disabled={busy}>
        {busy ? <Spinner /> : <IconDownload className="h-3.5 w-3.5" />} {label}
      </button>
    );
  }
  return (
    <Menu
      width="w-52"
      trigger={
        <span className="btn-outline btn-sm">
          {busy ? <Spinner /> : <IconDownload className="h-3.5 w-3.5" />} {label}
          <IconChevron className="h-3 w-3 text-ink-400" />
        </span>
      }
      items={[
        { label: 'Excel workbook (.xlsx)', hint: 'Formatted, with totals', onClick: () => go('xlsx') },
        { label: 'CSV file (.csv)', hint: 'Plain data', onClick: () => go('csv') },
      ]}
    />
  );
}

/* ---------------------------------------------------------------------------
   Search, segmented tabs, date range
   --------------------------------------------------------------------------- */

export function SearchBox({
  value, onChange, placeholder = 'Search…', className = '', delay = 300,
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; delay?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={`relative min-w-[12rem] ${className}`}>
      <input
        className="input h-9 pl-9 pr-8 text-[13px]" placeholder={placeholder} value={text}
        onChange={(e) => setText(e.target.value)} aria-label={placeholder}
      />
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      {text && (
        <button type="button" onClick={() => { setText(''); onChange(''); }} aria-label="Clear search"
          className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-400 hover:bg-ink-100 hover:text-ink-700">
          <IconClose className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'md',
}: {
  options: { value: T; label: ReactNode; count?: number; alert?: boolean }[];
  value: T; onChange: (v: T) => void; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-ink-100/80 p-1 no-scrollbar" role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.value)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg font-semibold transition-all duration-150 ${
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]'} ${
              on ? 'bg-white text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-800'}`}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={`rounded-md px-1.5 text-2xs tabular-nums ${
                o.alert && o.count > 0 ? 'bg-warn-100 text-warn-700' : on ? 'bg-brand-50 text-brand-700' : 'bg-white/70 text-ink-500'}`}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Named periods, worked out in the browser's local time. */
export function presetRange(key: string): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = isoOf(now);
  switch (key) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const d = new Date(y, m, now.getDate() - 1); return { from: isoOf(d), to: isoOf(d) }; }
    case '7d': return { from: isoOf(new Date(y, m, now.getDate() - 6)), to: today };
    case '30d': return { from: isoOf(new Date(y, m, now.getDate() - 29)), to: today };
    case 'month': return { from: isoOf(new Date(y, m, 1)), to: today };
    case 'lastMonth': return { from: isoOf(new Date(y, m - 1, 1)), to: isoOf(new Date(y, m, 0)) };
    case 'quarter': { const q0 = Math.floor(m / 3) * 3; return { from: isoOf(new Date(y, q0, 1)), to: today }; }
    case 'fy': { const start = m >= 3 ? y : y - 1; return { from: `${start}-04-01`, to: today }; }
    case 'lastFy': { const start = m >= 3 ? y - 1 : y - 2; return { from: `${start}-04-01`, to: `${start + 1}-03-31` }; }
    case 'year': return { from: `${y}-01-01`, to: today };
    default: return { from: '', to: '' };
  }
}

export const RANGE_PRESETS: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'fy', label: 'This financial year' },
  { key: 'lastFy', label: 'Last financial year' },
  { key: 'all', label: 'All time' },
];

export function DateRange({
  from, to, onChange, presets = true, allowAll = true, label,
}: {
  from: string; to: string; onChange: (r: { from: string; to: string }) => void;
  presets?: boolean; allowAll?: boolean; label?: string;
}) {
  const matched = RANGE_PRESETS.find((p) => {
    const r = presetRange(p.key);
    return r.from === from && r.to === to;
  })?.key ?? (from || to ? 'custom' : 'all');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs font-semibold text-ink-500">{label}</span>}
      {presets && (
        <select
          className="input h-9 w-auto text-[13px]" value={matched} aria-label="Period"
          onChange={(e) => e.target.value !== 'custom' && onChange(presetRange(e.target.value))}
        >
          {RANGE_PRESETS.filter((p) => allowAll || p.key !== 'all').map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom dates</option>
        </select>
      )}
      <DateField className="h-9 w-auto text-[13px]" value={from} placeholder="From" ariaLabel="From date"
        max={to || undefined} onChange={(v) => onChange({ from: v, to })} />
      <span className="text-xs text-ink-400">to</span>
      <DateField className="h-9 w-auto text-[13px]" value={to} placeholder="To" ariaLabel="To date"
        min={from || undefined} onChange={(v) => onChange({ from, to: v })} />
    </div>
  );
}

/* ---------------------------------------------------------------------------
   KPI tile
   --------------------------------------------------------------------------- */

type Tone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'violet' | 'teal';
const TONE: Record<Tone, { value: string; icon: string; bar: string }> = {
  default: { value: 'text-ink-900', icon: 'bg-ink-100 text-ink-500', bar: 'bg-ink-300' },
  brand: { value: 'text-ink-900', icon: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500' },
  success: { value: 'text-ok-700', icon: 'bg-ok-50 text-ok-600', bar: 'bg-ok-500' },
  warning: { value: 'text-warn-700', icon: 'bg-warn-50 text-warn-600', bar: 'bg-warn-500' },
  danger: { value: 'text-danger-600', icon: 'bg-danger-50 text-danger-600', bar: 'bg-danger-500' },
  violet: { value: 'text-ink-900', icon: 'bg-violet-50 text-violet-600', bar: 'bg-violet-500' },
  teal: { value: 'text-ink-900', icon: 'bg-teal-50 text-teal-600', bar: 'bg-teal-500' },
};

export function Kpi({
  label, value, sub, tone = 'default', icon, onClick, footnote,
}: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; icon?: ReactNode;
  onClick?: () => void; footnote?: string;
}) {
  const t = TONE[tone];
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} title={footnote}
      className={`card relative overflow-hidden p-4 text-left ${onClick ? 'card-hover cursor-pointer' : ''}`}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar} opacity-80`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow truncate">{label}</p>
          <p className={`mt-2 font-display text-[1.6rem] font-bold leading-none tabular-nums tracking-tight ${t.value}`}>{value}</p>
        </div>
        {icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.icon}`}>{icon}</span>}
      </div>
      {sub && <p className="mt-2 truncate text-xs text-ink-500">{sub}</p>}
    </Tag>
  );
}

/* ---------------------------------------------------------------------------
   Side drawer — details without leaving the list
   --------------------------------------------------------------------------- */

export function Drawer({
  open, onClose, title, subtitle, children, footer, width = 'max-w-3xl', headerExtra,
}: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode; width?: string; headerExtra?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 no-print" role="dialog" aria-modal="true">
      <div className="animate-fade-in absolute inset-0 bg-ink-950/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={`absolute inset-y-0 right-0 flex w-full ${width} animate-slide-in flex-col bg-white shadow-pop`}>
        <header className="flex items-start gap-3 border-b border-ink-200 bg-gradient-to-b from-white to-ink-50/60 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-ink-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-ink-500">{subtitle}</div>}
          </div>
          {headerExtra}
          <button onClick={onClose} className="btn-ghost btn-icon -mr-1.5" aria-label="Close">
            <IconClose className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

/** "Selected: 3 · ₹12,400" bar that sits over a list while rows are ticked. */
export function SelectionBar({ count, children, onClear }: { count: number; children: ReactNode; onClear: () => void }) {
  if (!count) return null;
  return (
    <div className="action-bar">
      <div className="mx-auto flex max-w-[100rem] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <p className="text-sm font-semibold text-ink-800">{count} selected</p>
        <button className="btn-ghost btn-sm" onClick={onClear}>Clear</button>
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </div>
    </div>
  );
}

/** A labelled value for detail panels. */
export function Detail({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-2xs font-bold uppercase tracking-[0.08em] text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{children ?? <span className="text-ink-400">—</span>}</dd>
    </div>
  );
}

export const todayIsoLocal = todayLocalIso;
