import { ReactNode, useEffect } from 'react';
import { statusClass, statusLabel } from '../lib/format';

/* ===========================================================================
   Shared UI. Every page composes these instead of hand-rolling padding,
   radius and colour, which is what let the portal drift out of alignment.
   =========================================================================== */

// ---------------------------------------------------------------------------
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2Z" />
    </svg>
  );
}

/** Full-page loading state. Skeletons where we know the shape, spinner otherwise. */
export function Loading({ label = 'Loading…', variant = 'page' }: { label?: string; variant?: 'page' | 'inline' | 'table' | 'cards' }) {
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2.5 py-3 text-sm text-ink-500">
        <Spinner className="h-4 w-4 text-brand-600" /> {label}
      </div>
    );
  }

  if (variant === 'cards') {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label={label}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card card-pad">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton mt-3 h-7 w-20" />
            <div className="skeleton mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'table') {
    return (
      <div className="table-wrap table-scroll" aria-busy="true" aria-label={label}>
        <div className="border-b border-ink-200 bg-ink-50 px-4 py-3">
          <div className="skeleton h-3 w-32" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-ink-100 px-4 py-3 last:border-b-0">
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton h-3.5 w-40" />
            <div className="skeleton h-3.5 w-28" />
            <div className="skeleton ml-auto h-3.5 w-20" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-ink-500" aria-busy="true">
      <Spinner className="h-6 w-6 text-brand-600" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function EmptyState({
  title, body, action, icon,
}: { title: string; body?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon && (
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-ink-100 text-ink-400">
          {icon}
        </div>
      )}
      <h3 className="text-md font-semibold text-ink-900">{title}</h3>
      {body && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-500">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="animate-fade-up flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-danger-50 text-danger-600">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.2v.3" />
        </svg>
      </div>
      <p className="max-w-md whitespace-pre-line text-sm leading-relaxed text-ink-700">{message}</p>
      {onRetry && <button onClick={onRetry} className="btn-outline btn-sm mt-5">Try again</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function StatusBadge({ value, className = '' }: { value?: string | null; className?: string }) {
  if (!value) return <span className="text-ink-400">—</span>;
  return <span className={`${statusClass(value)} ${className}`}>{statusLabel(value)}</span>;
}

// ---------------------------------------------------------------------------
export function Field({
  label, error, hint, required, children, className = '',
}: {
  label?: string; error?: string; hint?: ReactNode; required?: boolean;
  children: ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="ml-0.5 text-danger-500" aria-hidden="true">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="error-text">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" className="mt-px shrink-0">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16.2v.3" />
          </svg>
          {error}
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Consistent heading block for every admin screen. */
export function PageHeader({
  title, subtitle, actions, back,
}: { title: string; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head animate-fade-down">
      <div className="min-w-0">
        {back}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Card with a titled header strip. */
export function SectionCard({
  title, subtitle, actions, children, bodyClass = 'section-body', className = '',
}: {
  title: string; subtitle?: ReactNode; actions?: ReactNode;
  children: ReactNode; bodyClass?: string; className?: string;
}) {
  return (
    <section className={`section ${className}`}>
      <div className="section-head flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="card-title">{title}</h2>
          {subtitle && <p className="card-sub">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
export function Modal({
  open, onClose, title, subtitle, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl', full: 'max-w-[95vw]' }[size];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto no-print" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade-in fixed inset-0 bg-ink-950/45 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative flex min-h-full items-start justify-center p-4 sm:p-6">
        <div className={`card animate-scale-in relative w-full ${width} shadow-pop`}>
          <div className="flex items-start gap-4 border-b border-ink-200 px-5 py-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
              {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
            </div>
            <button onClick={onClose} className="btn-ghost btn-icon -mr-1.5 -mt-1" aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div className="max-h-[68vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 rounded-b-xl border-t border-ink-200 bg-ink-50 px-5 py-3.5">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ConfirmDialog({
  open, onClose, onConfirm, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = false, busy = false,
}: {
  open: boolean; onClose: () => void; onConfirm: () => void;
  title: string; body: ReactNode;
  confirmLabel?: string;
  /** The way out. Name it after the question — "No" answers "Are you sure?". */
  cancelLabel?: string;
  danger?: boolean; busy?: boolean;
}) {
  return (
    <Modal
      open={open} onClose={onClose} title={title} size="sm"
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-2 text-sm leading-relaxed text-ink-700">{body}</div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
type Tone = 'default' | 'brand' | 'success' | 'warning' | 'danger';

export function StatCard({
  label, value, sub, tone = 'default', icon, onClick,
}: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: Tone;
  icon?: ReactNode; onClick?: () => void;
}) {
  const valueTone: Record<Tone, string> = {
    default: 'text-ink-900',
    brand: 'text-ink-900',
    success: 'text-ok-600',
    warning: 'text-warn-600',
    danger: 'text-danger-600',
  };
  const iconTone: Record<Tone, string> = {
    default: 'bg-ink-100 text-ink-500',
    brand: 'bg-brand-50 text-brand-600',
    success: 'bg-ok-50 text-ok-600',
    warning: 'bg-warn-50 text-warn-600',
    danger: 'bg-danger-50 text-danger-600',
  };

  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`card card-pad-sm w-full text-left ${onClick ? 'card-hover cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow truncate">{label}</p>
          <p className={`mt-2 text-2xl font-bold leading-none tabular-nums tracking-tight ${valueTone[tone]}`}>
            {value}
          </p>
        </div>
        {icon && (
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${iconTone[tone]}`}>{icon}</span>
        )}
      </div>
      {sub && <p className="mt-2 truncate text-xs text-ink-500">{sub}</p>}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
export function Pagination({
  offset, limit, total, onChange,
}: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-200 bg-ink-50/60 px-4 py-3">
      <p className="text-xs text-ink-500">
        Showing <span className="font-semibold text-ink-800">{offset + 1}–{Math.min(offset + limit, total)}</span>{' '}
        of <span className="font-semibold text-ink-800">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <button className="btn-outline btn-sm" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>
          Previous
        </button>
        <span className="px-2 text-xs font-medium tabular-nums text-ink-600">{page} / {pages}</span>
        <button className="btn-outline btn-sm" disabled={page >= pages} onClick={() => onChange(offset + limit)}>
          Next
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
/** Tabs used on Billing and anywhere else with sibling views. */
export function Tabs<T extends string>({
  tabs, active, onChange,
}: { tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (k: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200 no-scrollbar" role="tablist">
      {tabs.map((t) => {
        const on = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors duration-150 ${
              on ? 'text-brand-700' : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`ml-2 rounded-md px-1.5 py-0.5 text-2xs tabular-nums ${
                on ? 'bg-brand-100 text-brand-700' : 'bg-ink-100 text-ink-500'}`}>
                {t.count}
              </span>
            )}
            {on && <span className="absolute inset-x-0 -bottom-px h-0.5 origin-left animate-bar-grow bg-brand-600" />}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Breadcrumb({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-300">/</span>}
          {it.to ? <a href={it.to} className="hover:text-brand-600">{it.label}</a>
                 : <span className="font-medium text-ink-700">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
