/**
 * The portal's own calendar and clock.
 *
 * WHY THIS EXISTS
 * Every date and time on this site used to be a bare `<input type="date">` or
 * `<input type="time">`. Those are drawn by the browser, which means the
 * booking form looked like a different product in Chrome, Edge, Firefox and
 * Safari, and on Windows the time control is a pair of spinner arrows nobody
 * hits on the first try. A customer choosing a pickup time is the moment an
 * enquiry is won or abandoned, so it is worth drawing ourselves.
 *
 * WHAT IS DELIBERATE
 *
 * 1. THE VALUE FORMAT DOES NOT CHANGE. A DateField still reads and writes
 *    "YYYY-MM-DD" and a TimeField still reads and writes "HH:MM", exactly what
 *    the native controls produced. Nothing behind these components — the
 *    forms, the API, the invoice templates — can tell the difference, so this
 *    is a presentation change and nothing else.
 *
 * 2. DATES ARE BUILT FROM LOCAL PARTS, NEVER `toISOString()`. That converts to
 *    UTC first, so east of Greenwich a date picked late in the evening comes
 *    back as the day before. That is the most common way a booking silently
 *    lands on the wrong date.
 *
 * 3. THE PANEL IS PORTALLED TO `document.body`. Most of these fields sit in
 *    cards, filter strips and table headers that clip their overflow; a panel
 *    rendered in place would have its bottom half cut off.
 *
 * 4. THE TRIGGER KEEPS THE `.input` SHAPE — same height, border and focus ring
 *    — so no layout anywhere had to be adjusted to take it.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconCalendar, IconClock, IconChevron } from './icons';

/* ==========================================================================
   Date helpers — all local-time, see note 2 above.
   ========================================================================== */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A Date to "YYYY-MM-DD", using the local calendar day. */
export function toIso(d: Date): string {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/** "YYYY-MM-DD" to a Date at local midnight, or null if it is not a real date. */
export function fromIso(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const d = new Date(y, mo - 1, da);
  // Rejects 2026-02-31, which Date would happily roll forward into March.
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da ? d : null;
}


const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** "2026-09-16" to "Wed, 16 Sep 2026". The weekday matters when picking a duty date. */
export function formatDate(iso: string): string {
  const d = fromIso(iso);
  if (!d) return '';
  return DOW_SHORT[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getFullYear();
}

/** "2026-09-16" to "Wed, 16 Sep" — the headline on the calendar's header. */
export function formatDateShort(iso: string): string {
  const d = fromIso(iso);
  if (!d) return '';
  return DOW_SHORT[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()];
}

/** "14:05" to "2:05 PM". India reads the clock in 12-hour form. */
export function formatTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm ?? '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return '';
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + pad2(mi) + ' ' + ampm;
}

/** Whole days apart, ignoring clock time. */
function daysBetween(a: Date, b: Date): number {
  const ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
    - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  return Math.round(ms / 86400000);
}

/** "Today" / "Tomorrow" — a short reassurance beside the chosen date. */
function relativeLabel(iso: string): string {
  const d = fromIso(iso);
  if (!d) return '';
  const n = daysBetween(new Date(), d);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return '';
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/* ==========================================================================
   The floating panel.

   Anchored under the trigger on a desktop screen; on a phone it becomes a
   sheet at the bottom of the viewport, which is the only place a thumb
   comfortably reaches.
   ========================================================================== */

function useIsPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

function Panel({
  anchor, open, onClose, children, label, width = 304,
}: {
  anchor: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
}) {
  const phone = useIsPhone();
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position under the trigger, flipping above when the panel would fall off
  // the bottom of the window, and clamped so it never hangs off either edge.
  const place = useCallback(() => {
    const el = anchor.current;
    if (!el || phone) return;
    const r = el.getBoundingClientRect();
    const h = boxRef.current?.offsetHeight ?? 340;
    const gap = 6;
    const below = window.innerHeight - r.bottom;
    const top = below < h + gap && r.top > h + gap ? r.top - h - gap : r.bottom + gap;
    const left = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - width - 8));
    setPos({ top, left });
  }, [anchor, phone, width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open || phone) return;
    const on = () => place();
    // Capture phase, so scrolling inside any parent container repositions too.
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
    };
  }, [open, phone, place]);

  // Dismissal: a press anywhere outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;

  const shell = (
    <div
      ref={boxRef}
      role="dialog"
      aria-modal={phone || undefined}
      aria-label={label}
      className={phone
        ? 'fixed inset-x-0 bottom-0 z-[80] overflow-hidden rounded-t-2xl border-t border-ink-200 bg-white pb-3 shadow-pop animate-fade-up'
        : 'fixed z-[80] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-scale-in'}
      style={phone ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}
    >
      {phone && (
        <div
          className="absolute left-1/2 top-2 z-10 h-1 w-10 -translate-x-1/2 rounded-full bg-white/60"
          aria-hidden="true"
        />
      )}
      {children}
    </div>
  );

  return createPortal(
    <>
      {phone && (
        <div className="fixed inset-0 z-[79] bg-ink-950/30 animate-fade-in" onClick={onClose} aria-hidden="true" />
      )}
      {shell}
    </>,
    document.body
  );
}

/** The button that replaces the native input. Same height and border as `.input`. */
function Trigger({
  open, onOpen, filled, error, disabled, icon, main, meta, triggerRef, ariaLabel, className, id,
  baseClass = 'input', chevron = true,
}: {
  open: boolean; onOpen: () => void; filled: boolean; error?: boolean; disabled?: boolean;
  icon: ReactNode; main: string; meta?: string;
  triggerRef: React.RefObject<HTMLButtonElement>;
  ariaLabel?: string; className?: string; id?: string;
  /** Swap the `.input` shell for another one — the public booking bar uses its
      own borderless cell and would look wrong with a second border inside it. */
  baseClass?: string;
  chevron?: boolean;
}) {
  return (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      disabled={disabled}
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={ariaLabel}
      className={baseClass + ' flex items-center gap-2 text-left '
        + (error ? 'input-error ' : '')
        + (open && baseClass === 'input' ? 'border-brand-500 shadow-focus ' : '')
        + (className ?? '')}
    >
      {icon && (
        <span className={'shrink-0 ' + (filled ? 'text-brand-500' : 'text-ink-400')} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={'flex-1 truncate ' + (filled ? 'text-ink-900' : 'text-ink-400')}>{main}</span>
      {meta && (
        <span className="shrink-0 rounded-md bg-brand-50 px-1.5 py-0.5 text-2xs font-semibold text-brand-700">
          {meta}
        </span>
      )}
      {chevron && (
        <IconChevron
          className={'h-3.5 w-3.5 shrink-0 text-ink-400 transition-transform duration-150 '
            + (open ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/* ==========================================================================
   DateField — the calendar
   ========================================================================== */

export interface DateFieldProps {
  value: string;
  onChange: (iso: string) => void;
  /** Earliest selectable day, "YYYY-MM-DD". Anything before it is greyed out. */
  min?: string;
  /** Latest selectable day, "YYYY-MM-DD". */
  max?: string;
  error?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
  /** Show the Today / Tomorrow shortcuts. On by default. */
  quick?: boolean;
  /** Allow clearing back to "". On by default. */
  clearable?: boolean;
  /** Swap the `.input` shell — for the public booking bar's borderless cell. */
  baseClass?: string;
  chevron?: boolean;
  showIcon?: boolean;
}

export function DateField({
  value, onChange, min, max, error, disabled, placeholder = 'Select date',
  className, ariaLabel, id, quick = true, clearable = true,
  baseClass, chevron, showIcon = true,
}: DateFieldProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = fromIso(value);
  const rel = relativeLabel(value);

  return (
    <>
      <Trigger
        open={open}
        onOpen={() => setOpen((o) => !o)}
        filled={!!selected}
        error={error}
        disabled={disabled}
        icon={showIcon ? <IconCalendar className="h-4 w-4" /> : null}
        main={selected ? formatDate(value) : placeholder}
        meta={rel || undefined}
        triggerRef={triggerRef}
        ariaLabel={ariaLabel}
        className={className}
        id={id}
        baseClass={baseClass}
        chevron={chevron}
      />
      <CalendarPopover
        anchor={triggerRef}
        open={open}
        onClose={() => { setOpen(false); triggerRef.current?.focus(); }}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        quick={quick}
        clearable={clearable}
      />
    </>
  );
}

/**
 * The calendar panel by itself, for fields that draw their own trigger.
 *
 * The public site's booking widget lets the customer TYPE a date as
 * dd/mm/yyyy — which is faster than any picker once you know the date — and
 * only wants the popup behind its calendar button. Sharing the panel means
 * that widget and the admin fields cannot drift apart.
 */
export function CalendarPopover({
  anchor, open, onClose, value, onChange, min, max, quick = true, clearable = true,
}: {
  anchor: React.RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  quick?: boolean;
  clearable?: boolean;
}) {
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');

  const selected = fromIso(value);
  const today = useMemo(() => new Date(), []);

  // The month on screen. Follows the selection when it changes from outside.
  const [view, setView] = useState<Date>(() => selected ?? today);
  useEffect(() => {
    if (selected) setView(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // The day the arrow keys are sitting on.
  const [cursor, setCursor] = useState<Date>(() => selected ?? today);
  useEffect(() => {
    if (open) {
      setMode('days');
      const start = selected ?? today;
      setCursor(start);
      setView(new Date(start.getFullYear(), start.getMonth(), 1));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const outOfRange = useCallback((iso: string) => {
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  }, [min, max]);

  const commit = (d: Date) => {
    const iso = toIso(d);
    if (outOfRange(iso)) return;
    onChange(iso);
    onClose();
  };

  /* The 6x7 grid. Leading and trailing days from the neighbouring months are
     shown muted rather than as blanks — an empty corner reads as a bug, and
     being able to click 1 Oct while looking at September saves a navigation. */
  const cells = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const start = new Date(y, m, 1 - firstDow);
    return Array.from({ length: 42 }, (_, i) => {
      const d = addDays(start, i);
      return { date: d, iso: toIso(d), inMonth: d.getMonth() === m };
    });
  }, [view]);

  const onGridKey = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };
    if (e.key in step) {
      e.preventDefault();
      const next = addDays(cursor, step[e.key]);
      setCursor(next);
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + (e.key === 'PageUp' ? -1 : 1), cursor.getDate());
      setCursor(next);
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const d = e.key === 'Home'
        ? new Date(view.getFullYear(), view.getMonth(), 1)
        : new Date(view.getFullYear(), view.getMonth() + 1, 0);
      setCursor(d);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(cursor);
    }
  };

  const years = useMemo(() => {
    const base = view.getFullYear();
    const from = base - 6;
    return Array.from({ length: 16 }, (_, i) => from + i);
  }, [view]);

  return (
    <Panel anchor={anchor} open={open} onClose={onClose} label="Choose a date">
      {/* The header carries the decision, the way the clock's does: what you
          have chosen so far, large, before the grid you are choosing it in. */}
      <div className="bg-brand-500 px-4 pb-3 pt-3.5">
        <button
          type="button"
          onClick={() => setMode(mode === 'years' ? 'days' : 'years')}
          className="block text-xs font-bold uppercase tracking-[0.12em] text-white/70 transition-colors hover:text-white"
        >
          {view.getFullYear()}
        </button>
        <p className="mt-0.5 text-xl font-semibold leading-tight text-white">
          {selected ? formatDateShort(value) : 'Select a date'}
        </p>
      </div>

      <div className="p-3">
        {/* Month bar */}
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Previous month"
            onClick={() => setView(addMonths(view, -1))}
          >
            <IconChevron className="h-4 w-4 rotate-90" />
          </button>

          <button
            type="button"
            onClick={() => setMode(mode === 'days' ? 'months' : 'days')}
            className="flex-1 rounded-md px-2 py-1 text-sm font-semibold text-ink-900 transition-colors hover:bg-ink-50"
            aria-label="Choose month and year"
          >
            {MONTHS[view.getMonth()]} {view.getFullYear()}
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Next month"
            onClick={() => setView(addMonths(view, 1))}
          >
            <IconChevron className="h-4 w-4 -rotate-90" />
          </button>
        </div>

        {mode === 'days' && (
          <>
            <div className="grid grid-cols-7 gap-0.5" role="row">
              {DOW_LETTER.map((d, i) => (
                <div
                  key={i}
                  className={'py-1 text-center text-2xs font-bold uppercase tracking-wide '
                    + (i === 0 ? 'text-danger-500/70' : 'text-ink-400')}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role */}
            <div
              className="mt-0.5 grid grid-cols-7 gap-0.5"
              role="grid"
              tabIndex={0}
              onKeyDown={onGridKey}
              aria-label="Calendar"
            >
              {cells.map(({ date, iso, inMonth }) => {
                const isSel = value === iso;
                const isToday = toIso(today) === iso;
                const isCursor = toIso(cursor) === iso;
                const off = outOfRange(iso);
                const sunday = date.getDay() === 0;

                let tone = inMonth ? 'text-ink-700' : 'text-ink-300';
                if (sunday && inMonth && !isSel) tone = 'text-danger-600/80';
                if (off) tone = 'text-ink-300';

                return (
                  <button
                    key={iso}
                    type="button"
                    role="gridcell"
                    disabled={off}
                    aria-selected={isSel}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => commit(date)}
                    className={'relative h-8 rounded-md text-sm tabular-nums transition-all duration-100 '
                      + (off ? 'cursor-not-allowed opacity-50 ' : 'hover:bg-brand-50 hover:text-brand-700 ')
                      + (isSel
                        ? 'bg-brand-500 font-semibold text-white shadow-xs hover:bg-brand-600 hover:text-white '
                        : tone + ' ')
                      + (!isSel && isCursor ? 'ring-1 ring-inset ring-brand-300 ' : '')}
                  >
                    {date.getDate()}
                    {isToday && !isSel && (
                      <span className="absolute inset-x-0 bottom-1 mx-auto h-1 w-1 rounded-full bg-brand-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {mode === 'months' && (
          <div className="grid grid-cols-3 gap-1">
            {MONTHS_SHORT.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => { setView(new Date(view.getFullYear(), i, 1)); setMode('days'); }}
                className={'rounded-md py-2 text-sm transition-colors '
                  + (i === view.getMonth()
                    ? 'bg-brand-500 font-semibold text-white'
                    : 'text-ink-700 hover:bg-brand-50 hover:text-brand-700')}
              >
                {m}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMode('years')}
              className="col-span-3 mt-1 rounded-md py-1.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50"
            >
              Choose a different year
            </button>
          </div>
        )}

        {mode === 'years' && (
          <div className="grid grid-cols-4 gap-1">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => { setView(new Date(y, view.getMonth(), 1)); setMode('months'); }}
                className={'rounded-md py-2 text-sm tabular-nums transition-colors '
                  + (y === view.getFullYear()
                    ? 'bg-brand-500 font-semibold text-white'
                    : 'text-ink-700 hover:bg-brand-50 hover:text-brand-700')}
              >
                {y}
              </button>
            ))}
          </div>
        )}

        {/* Footer shortcuts */}
        {(quick || clearable) && (
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-ink-100 pt-2.5">
            {quick && (
              <>
                <button
                  type="button"
                  className="btn btn-outline btn-sm flex-1"
                  disabled={outOfRange(toIso(today))}
                  onClick={() => commit(today)}
                >
                  Today
                </button>
                <button
                  type="button"
                  className="btn btn-outline btn-sm flex-1"
                  disabled={outOfRange(toIso(addDays(today, 1)))}
                  onClick={() => commit(addDays(today, 1))}
                >
                  Tomorrow
                </button>
              </>
            )}
            {clearable && value && (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-ink-500"
                onClick={() => { onChange(''); onClose(); }}
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ==========================================================================
   TimeField — the clock

   A DIAL, NOT A LIST.
   Three scrolling columns worked, but they made you read before you could
   choose. A clock face is the one picture of time everybody already holds, so
   the hand lands where you expect and "half past three" is a single gesture
   rather than three separate hunts.

   HOW IT BEHAVES
   · The header is the value. Tap the hour or the minute to aim the dial at it;
     the part you are setting is the bright one.
   · Choosing an hour hands you straight to the minutes, because that is always
     the next thing you were going to do.
   · Dragging the hand works as well as tapping a number, and drags land on the
     exact minute — the printed numbers are every five only because sixty of
     them will not fit round a circle legibly.
   ========================================================================== */

const DIAL = 248;      // px — the dial's box
const DIAL_R = 96;     // px — the ring the numbers sit on
const KNOB_R = 19;     // px — the disc on the end of the hand

/** A point on the dial, for an angle measured clockwise from twelve o'clock. */
function dialPoint(deg: number, radius = DIAL_R) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: DIAL / 2 + radius * Math.sin(rad),
    y: DIAL / 2 - radius * Math.cos(rad),
  };
}

const HOUR_FACE = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTE_FACE = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export interface TimeFieldProps {
  value: string;
  onChange: (hhmm: string) => void;
  error?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  id?: string;
  clearable?: boolean;
  baseClass?: string;
  chevron?: boolean;
  showIcon?: boolean;
}

export function TimeField({
  value, onChange, error, disabled, placeholder = 'Select time',
  className, ariaLabel, id, clearable = true,
  baseClass, chevron, showIcon = true,
}: TimeFieldProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'hours' | 'minutes'>('hours');
  const dragging = useRef(false);

  const parsed = useMemo(() => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    return h <= 23 && mi <= 59 ? { h, mi } : null;
  }, [value]);

  // An empty field still has to point the hand somewhere; 9:00 am is the hour
  // this office starts, and nothing is written until you actually choose.
  const hour12 = parsed ? (parsed.h % 12 === 0 ? 12 : parsed.h % 12) : 9;
  const minute = parsed?.mi ?? 0;
  const isPm = parsed ? parsed.h >= 12 : false;

  useEffect(() => { if (open) setMode('hours'); }, [open]);

  /** Rebuild "HH:MM" from whichever part the user just touched. */
  const apply = (next: { h12?: number; mi?: number; pm?: boolean }) => {
    const bh = next.h12 ?? hour12;
    const bm = next.mi ?? minute;
    const bp = next.pm ?? isPm;
    const h24 = bp ? (bh === 12 ? 12 : bh + 12) : (bh === 12 ? 0 : bh);
    onChange(pad2(h24) + ':' + pad2(bm));
  };

  /* --- the hand ---------------------------------------------------------- */
  const handDeg = mode === 'hours' ? (hour12 % 12) * 30 : (minute / 60) * 360;
  const knob = dialPoint(handDeg);
  const face = mode === 'hours' ? HOUR_FACE : MINUTE_FACE;
  const offGrid = mode === 'minutes' && minute % 5 !== 0;

  /** Turn a pointer position into an hour or a minute. */
  const pickAt = (clientX: number, clientY: number) => {
    const box = dialRef.current?.getBoundingClientRect();
    if (!box) return;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    let deg = (Math.atan2(clientX - cx, cy - clientY) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    if (mode === 'hours') {
      const i = Math.round(deg / 30) % 12;
      apply({ h12: i === 0 ? 12 : i });
    } else {
      apply({ mi: Math.round(deg / 6) % 60 });
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pickAt(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragging.current) pickAt(e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    // Setting the hour is never the whole job — go where they were heading.
    if (mode === 'hours') setMode('minutes');
  };

  const headPart = (on: boolean) =>
    'text-4xl font-light leading-none tabular-nums transition-colors '
    + (on ? 'text-white' : 'text-white/55 hover:text-white/80');
  const meridiem = (on: boolean) =>
    'text-xs font-bold leading-tight transition-colors '
    + (on ? 'text-white' : 'text-white/55 hover:text-white/80');

  return (
    <>
      <Trigger
        open={open}
        onOpen={() => setOpen((o) => !o)}
        filled={!!parsed}
        error={error}
        disabled={disabled}
        icon={showIcon ? <IconClock className="h-4 w-4" /> : null}
        main={parsed ? formatTime(value) : placeholder}
        triggerRef={triggerRef}
        ariaLabel={ariaLabel}
        className={className}
        id={id}
        baseClass={baseClass}
        chevron={chevron}
      />

      <Panel
        anchor={triggerRef}
        open={open}
        onClose={() => setOpen(false)}
        label="Choose a time"
        width={DIAL + 40}
      >
        {/* Header — the value, and the two switches that aim the dial. */}
        <div className="flex items-start gap-1.5 bg-brand-500 px-4 pb-3 pt-3.5">
          <button
            type="button"
            onClick={() => setMode('hours')}
            className={headPart(mode === 'hours')}
            aria-label="Set the hour"
          >
            {hour12}
          </button>
          <span className="text-4xl font-light leading-none text-white/55">:</span>
          <button
            type="button"
            onClick={() => setMode('minutes')}
            className={headPart(mode === 'minutes')}
            aria-label="Set the minutes"
          >
            {pad2(minute)}
          </button>

          <div className="ml-1.5 flex flex-col gap-0.5 pt-0.5">
            <button type="button" onClick={() => apply({ pm: false })} className={meridiem(!isPm)}>
              AM
            </button>
            <button type="button" onClick={() => apply({ pm: true })} className={meridiem(isPm)}>
              PM
            </button>
          </div>
        </div>

        {/* The face. */}
        <div className="bg-ink-50 px-4 py-4">
          <div
            ref={dialRef}
            className="relative mx-auto touch-none select-none rounded-full bg-white shadow-xs"
            style={{ width: DIAL, height: DIAL }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            role="slider"
            aria-label={mode === 'hours' ? 'Hour' : 'Minutes'}
            aria-valuenow={mode === 'hours' ? hour12 : minute}
            aria-valuemin={0}
            aria-valuemax={mode === 'hours' ? 12 : 59}
            tabIndex={0}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={DIAL}
              height={DIAL}
              viewBox={'0 0 ' + DIAL + ' ' + DIAL}
              aria-hidden="true"
            >
              <line
                x1={DIAL / 2} y1={DIAL / 2} x2={knob.x} y2={knob.y}
                stroke="currentColor" strokeWidth="2" className="text-brand-500"
              />
              <circle cx={DIAL / 2} cy={DIAL / 2} r="4" className="fill-brand-500" />
              <circle cx={knob.x} cy={knob.y} r={KNOB_R} className="fill-brand-500" />
            </svg>

            {face.map((n, i) => {
              const pt = dialPoint(i * 30);
              const on = mode === 'hours' ? n === hour12 : n === minute;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => (mode === 'hours' ? apply({ h12: n }) : apply({ mi: n }))}
                  style={{ left: pt.x, top: pt.y }}
                  className={'absolute grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center '
                    + 'rounded-full text-sm tabular-nums transition-colors '
                    + (on ? 'font-semibold text-white' : 'text-ink-700 hover:text-brand-600')}
                >
                  {mode === 'minutes' ? pad2(n) : n}
                </button>
              );
            })}

            {/* A minute that is not a multiple of five has no number of its
                own on the face; print it on the hand so the dial and the
                header never disagree. */}
            {offGrid && (
              <span
                style={{ left: knob.x, top: knob.y }}
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-sm font-semibold tabular-nums text-white"
              >
                {pad2(minute)}
              </span>
            )}
          </div>
        </div>

        <div className="flex gap-1.5 border-t border-ink-100 px-3 py-2.5">
          <button
            type="button"
            className="btn btn-outline btn-sm flex-1"
            onClick={() => {
              const n = new Date();
              onChange(pad2(n.getHours()) + ':' + pad2(n.getMinutes()));
              setMode('minutes');
            }}
          >
            Now
          </button>
          {clearable && value && (
            <button
              type="button"
              className="btn btn-ghost btn-sm text-ink-500"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary btn-sm flex-1"
            onClick={() => {
              // An untouched field still owes the form a value on OK.
              if (!parsed) apply({});
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            OK
          </button>
        </div>
      </Panel>
    </>
  );
}
