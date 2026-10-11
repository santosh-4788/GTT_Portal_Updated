import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  divider?: boolean;
}

/**
 * A "⋯" button with a drop-down. The list is portalled and positioned with
 * `fixed` so it is never clipped by a scrolling table, and it flips upwards
 * near the bottom of the window.
 */
export default function RowMenu({
  items, label = 'Actions', trigger, buttonClass = 'btn-ghost btn-icon',
}: { items: MenuItem[]; label?: string; trigger?: ReactNode; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const h = menu.current?.offsetHeight ?? 260;
    const w = menu.current?.offsetWidth ?? 208;
    const up = r.bottom + h + 8 > window.innerHeight && r.top - h - 8 > 0;
    setPos({ top: up ? r.top - h - 4 : r.bottom + 4, left: Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)), up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    const closeNow = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('resize', closeNow);
    window.addEventListener('scroll', closeNow, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('resize', closeNow);
      window.removeEventListener('scroll', closeNow, true);
    };
  }, [open]);

  return (
    <>
      <button ref={btn} type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {trigger ?? (
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
          </svg>
        )}
      </button>
      {open && createPortal(
        <div ref={menu} role="menu" style={{ top: pos.top, left: pos.left }}
          className="animate-scale-in fixed z-[60] w-52 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-pop"
          onClick={(e) => e.stopPropagation()}>
          {visible.map((it, i) => (
            <div key={it.label + i}>
              {it.divider && i > 0 && <div className="my-1 border-t border-ink-100" />}
              <button type="button" role="menuitem" disabled={it.disabled}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  it.danger ? 'text-danger-600 hover:bg-danger-50' : 'text-ink-700 hover:bg-ink-50'}`}
                onClick={() => { setOpen(false); it.onSelect(); }}>
                {it.icon && <span className="shrink-0 opacity-80">{it.icon}</span>}
                {it.label}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
