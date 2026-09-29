/**
 * The customer site's component kit.
 *
 * One place for the pieces every booking journey needs — steppers, choice
 * cards, counters, bottom sheets, the estimate panel, the journey line, the
 * status trail, empty and error states. Screens compose these instead of
 * inventing their own, which is what keeps twenty-eight pages looking like one
 * product.
 *
 * Everything here is presentation plus the small amount of arithmetic the
 * presentation needs. No screen-specific logic lives in this file.
 */
import { createPortal } from 'react-dom';
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { inr } from '../lib/format';
import { COMPANY, whatsappLink } from './siteData';
import { TRUST, type PlanType, type CatalogVehicle } from './catalog';
import { estimateFare, type FareEstimate, type RateOption } from './fare';
import { findRate } from './recommend';
import { submitRequest, saveCustomer, snapshot, type RequestInput } from './tripStore';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import {
  IconArrowRight, IconCalendar, IconCheck, IconChevron, IconClose, IconDuplicate,
  IconPhone, IconPin, IconPlus, IconSearch, IconTrash, IconWarning,
  IconRoad,
} from '../components/icons';
import { Spinner } from '../components/ui';
import { CalendarPopover } from '../components/DateTimeField';
import { useBackToClose } from '../lib/useBackToClose';

/* ==========================================================================
   Rates — fetched once for the whole session
   ========================================================================== */

interface RateBook {
  rates: RateOption[];
  taxMode: string;
  taxRate: number;
  loaded: boolean;
}

let cached: RateBook | null = null;
let inflight: Promise<RateBook> | null = null;

async function fetchRates(): Promise<RateBook> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = api
    .get('/public/fare-options')
    .then(({ data }) => ({
      rates: (data?.data ?? []) as RateOption[],
      taxMode: data?.taxMode ?? 'IGST',
      taxRate: Number(data?.taxRate ?? 5),
      loaded: true,
    }))
    .catch(() => ({ rates: [], taxMode: 'NONE', taxRate: 0, loaded: true }))
    .then((r) => { cached = r; return r; });
  return inflight;
}

/**
 * The published walk-in rate card.
 *
 * When the Master has no rates in it yet, every screen that shows money falls
 * back to "estimate on request" — nothing on this site ever shows a number it
 * cannot derive from the business's own rate card.
 */
export function useRates(): RateBook {
  const [book, setBook] = useState<RateBook>(cached ?? { rates: [], taxMode: 'NONE', taxRate: 0, loaded: false });
  useEffect(() => {
    let alive = true;
    fetchRates().then((r) => { if (alive) setBook(r); });
    return () => { alive = false; };
  }, []);
  return book;
}

export interface EstimateInput {
  plan: PlanType;
  /** OUTSTATION */
  distanceKm?: number;
  days?: number;
  /** LOCAL / AIRPORT */
  extraHours?: number;
  extraKm?: number;
  /** HOURLY: the package the customer picked, which chooses the rate row. */
  hours?: number;
  km?: number;
  /** Multiply the whole thing — a fleet of four cars costs four times one. */
  vehicles?: number;
}

export interface VehicleEstimate {
  estimate: FareEstimate | null;
  planLabel: string;
  /**
   * The rate row this came off, so a card can state what the fare actually
   * includes — kilometres, the after-limit rate, the driver allowance — instead
   * of only the total. Null when the rate card has nothing for this vehicle.
   */
  row: RateOption | null;
  /** Why there is no number, when there is no number. */
  reason?: string;
}

const n0 = (v: number | undefined) => (typeof v === 'number' && v > 0 ? v : 0);

/** Work out what a vehicle costs for a trip, or say honestly that we cannot. */
export function estimateFor(book: RateBook, vehicle: CatalogVehicle, input: EstimateInput): VehicleEstimate {
  if (!book.loaded) return { estimate: null, planLabel: '', row: null, reason: 'loading' };
  const row = findRate(book.rates, vehicle, input.plan, input.hours);
  if (!row) return { estimate: null, planLabel: '', row: null, reason: 'no-rate' };

  // A package longer than any this vehicle has is the largest one plus the
  // difference; one shorter than its smallest is billed at that minimum.
  const pkgHours = n0(input.hours);
  const shortBy = pkgHours && row.included_hours ? Math.max(0, pkgHours - row.included_hours) : 0;
  const shortKm = shortBy ? Math.max(0, n0(input.km) - row.included_km) : 0;

  const one = estimateFare(
    row,
    {
      distanceKm: input.distanceKm,
      days: input.days,
      extraHours: n0(input.extraHours) + shortBy,
      extraKm: n0(input.extraKm) + shortKm,
    },
    book.taxMode,
    book.taxRate
  );
  if (pkgHours && row.included_hours > pkgHours) {
    one.note = `This vehicle's shortest package is ${row.included_hours} hrs / ${row.included_km} km, so that is what is quoted.`;
  }

  const n = Math.max(1, input.vehicles ?? 1);
  if (n === 1) return { estimate: one, planLabel: row.plan_label, row };

  return {
    planLabel: row.plan_label,
    row,
    estimate: {
      ...one,
      lines: one.lines.map((l) => ({ ...l, detail: [l.detail, `× ${n} vehicles`].filter(Boolean).join(' · '), amount: l.amount * n })),
      subtotal: one.subtotal * n,
      tax: one.tax * n,
      total: one.total * n,
    },
  };
}

/* ==========================================================================
   Type and layout
   ========================================================================== */

export function SectionHead({
  eyebrow, title, sub, action, center = false, className = '',
}: {
  eyebrow?: string; title: ReactNode; sub?: ReactNode;
  action?: ReactNode; center?: boolean; className?: string;
}) {
  return (
    <div className={`${center ? 'mx-auto max-w-2xl text-center' : 'flex flex-wrap items-end justify-between gap-4'} ${className}`}>
      <div className={center ? '' : 'max-w-2xl'}>
        {eyebrow && <span className="lead">{eyebrow}</span>}
        <h2 className="h-sec">{title}</h2>
        {sub && <p className={`mt-4 text-md leading-[1.7] text-ink-500 ${center ? 'mx-auto max-w-xl' : ''}`}>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/* ==========================================================================
   Stepper
   ========================================================================== */

export function Stepper({
  steps, at, onJump,
}: {
  steps: string[]; at: number; onJump?: (i: number) => void;
}) {
  return (
    <ol className="no-scrollbar -mx-1 flex items-center gap-1 overflow-x-auto px-1" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < at;
        const now = i === at;
        const reachable = !!onJump && i <= at;
        return (
          <li key={label} className="flex min-w-0 shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onJump?.(i)}
              className={`flex items-center gap-2 rounded-full px-2.5 py-1.5 text-left transition-colors duration-200 ${
                reachable ? 'hover:bg-white' : 'cursor-default'
              }`}
              aria-current={now ? 'step' : undefined}
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-2xs font-bold transition-colors duration-300 ${
                  done ? 'bg-ok-500 text-white' : now ? 'grad-brand text-white' : 'bg-ink-100 text-ink-500'
                }`}
              >
                {done ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={`whitespace-nowrap text-xs font-semibold ${now ? 'text-ink-900' : done ? 'text-ink-600' : 'text-ink-400'}`}>
                {label}
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={`h-0.5 w-4 shrink-0 rounded-full sm:w-7 ${done ? 'bg-ok-500' : 'bg-ink-200'}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ==========================================================================
   Tabs, chips, counters, choices
   ========================================================================== */

export function SegTabs<T extends string>({
  value, onChange, options, tone = 'plain', className = '',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; sub?: string }[];
  /** 'brand' fills the selected tab with the signature gradient. Reserved for
   *  the booking widget, where the tab is the first thing to look at; a page's
   *  own filters stay 'plain' so they do not compete with it. */
  tone?: 'plain' | 'brand';
  className?: string;
}) {
  return (
    <div className={`no-scrollbar flex gap-1 overflow-x-auto rounded-full bg-ink-100/70 p-1 ${className}`} role="tablist">
      {options.map((o) => {
        const on = o.value === value;
        const selected = tone === 'brand'
          ? 'grad-brand text-white shadow-sm shadow-brand-500/30'
          : 'bg-white text-ink-900 shadow-card';
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            /*
             * Grow, but NEVER shrink.
             *
             * `flex-1` is shorthand for `1 1 0%`, and with `min-w-0` beside it
             * the tabs were free to shrink below their own text: on a 390px
             * phone the four booking tabs squeezed until "Outstation" rendered
             * as "Outstatio". The row is already `overflow-x-auto`, so refusing
             * to shrink is the right answer - the tabs fill the width when they
             * fit, and the strip scrolls when they do not.
             */
            className={`flex-[1_0_auto] whitespace-nowrap rounded-full px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 sm:px-4 sm:py-2 ${
              on ? selected : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip({
  on, children, onClick, className = '',
}: {
  on?: boolean; children: ReactNode; onClick?: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 ${
        on ? 'grad-brand text-white shadow-sm shadow-brand-500/25' : 'bg-white text-ink-600 shadow-card hover:text-ink-900'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Counter({
  label, value, onChange, min = 1, max = 99, sub,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; sub?: string;
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-white px-4 py-3 shadow-card">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button" onClick={() => step(-1)} disabled={value <= min}
          className="grid h-9 w-9 place-items-center rounded-full bg-ink-50 text-lg font-bold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-40"
          aria-label={`Fewer ${label.toLowerCase()}`}
        >
          −
        </button>
        <span className="w-9 text-center font-display text-md font-bold tabular-nums text-ink-900">{value}</span>
        <button
          type="button" onClick={() => step(1)} disabled={value >= max}
          className="grid h-9 w-9 place-items-center rounded-full bg-ink-50 text-lg font-bold text-ink-700 transition-colors hover:bg-ink-100 disabled:opacity-40"
          aria-label={`More ${label.toLowerCase()}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

/**
 * A passenger count as a stepper, sized for the booking row.
 *
 * `Counter` above is the full-width card the wizard screens use; this is the
 * h-10 version that lines up with SOFT_INPUT. It replaced a dropdown whose
 * options ran 12, 17, 20, 25, 30 — so a party of 22 had to round itself up or
 * down before it could even search, and the number the office was quoting was
 * never the number the customer had.
 */
/* --------------------------------------------------------------- dates ---
   A native <input type="date"> renders its text in the BROWSER's locale, not
   the page's. `lang="en-IN"` does nothing to it in Chrome, and neither does
   CSS — on an en-US machine the third of September reads 09/03/2026, which is
   the wrong way round for every customer this site has.

   So the visible field is a plain text input that only ever formats one way,
   and the calendar button beside it opens the portal's own CalendarPopover.
   Typing and picking both work, and neither the displayed order nor the look
   of the calendar is at the mercy of a browser setting.
   ------------------------------------------------------------------------- */

/** yyyy-mm-dd -> dd/mm/yyyy. Empty string for anything that is not a date. */
export const isoToDmy = (iso?: string | null): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/**
 * dd/mm/yyyy -> yyyy-mm-dd, or '' when it is not a real date.
 *
 * Rebuilding the Date and comparing the parts back is what rejects 31/02 —
 * `new Date(2026, 1, 31)` silently rolls over to the 3rd of March.
 */
export const dmyToIso = (text: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return '';
  const [, d, mo, y] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d));
  const ok = dt.getFullYear() === Number(y)
    && dt.getMonth() === Number(mo) - 1
    && dt.getDate() === Number(d);
  return ok ? `${y}-${mo}-${d}` : '';
};

/** Digits in, dd/mm/yyyy out, slashes inserted as you type. */
const maskDmy = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

export function DmyDateField({
  id, value, onChange, min, muted = false,
}: {
  id: string;
  /** ISO yyyy-mm-dd, or '' for empty. */
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  muted?: boolean;
}) {
  const [text, setText] = useState(isoToDmy(value));
  const [open, setOpen] = useState(false);
  const calBtn = useRef<HTMLButtonElement>(null);

  // Follow the value when something else sets it — the picker, a reset, a URL.
  useEffect(() => {
    const next = isoToDmy(value);
    if (dmyToIso(text) !== value) setText(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const type = (raw: string) => {
    const masked = maskDmy(raw);
    setText(masked);
    if (!masked) { onChange(''); return; }
    const iso = dmyToIso(masked);
    if (iso) onChange(iso);
  };

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        aria-describedby={`${id}-fmt`}
        className={`${muted ? SOFT_INPUT_MUTED : SOFT_INPUT} pr-8`}
        value={text}
        onChange={(e) => type(e.target.value)}
        onBlur={() => setText(isoToDmy(value))}
      />
      <span id={`${id}-fmt`} className="sr-only">Date in day slash month slash year</span>

      <button
        ref={calBtn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open the calendar"
        aria-expanded={open}
        className="absolute right-0 top-0 grid h-8 w-8 place-items-center rounded-lg text-ink-400
                   transition-colors hover:text-brand-600 lg:h-7 lg:w-7"
      >
        <IconCalendar className="h-4 w-4" />
      </button>

      {/* Our calendar, in place of the OS one this used to open. Typing stays
          the fastest route for anyone who knows the date; the panel is for
          phones and for "which Saturday is that?". */}
      <CalendarPopover
        anchor={calBtn}
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={onChange}
        min={min}
      />
    </div>
  );
}

export function SoftStepper({
  id, value, onChange, min = 1, max = 60, unit = 'passenger',
}: {
  id?: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; unit?: string;
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  // 36px on phones and tablets (both are touch screens), 28 on a desktop. The audit found these at 32x32, which
  // is under any sensible thumb target for the two controls a customer presses
  // most on this widget. A mouse does not need the extra eight pixels, and on
  // a desktop the row has to line up with the other fields.
  const btn = 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink-50 text-base font-bold leading-none '
    + 'text-ink-600 transition-all hover:bg-brand-50 hover:text-brand-600 active:scale-90 '
    + 'disabled:opacity-30 disabled:hover:bg-ink-50 disabled:hover:text-ink-600 lg:h-7 lg:w-7 lg:text-sm';
  return (
    <div id={id} className="flex h-9 items-center justify-center gap-3 lg:h-7">
      <button type="button" onClick={() => step(-1)} disabled={value <= min}
        className={btn} aria-label={`One fewer ${unit}`}>−</button>
      <span className="min-w-[1.5rem] text-center text-sm font-semibold tabular-nums text-ink-900"
        aria-live="polite" aria-label={`${value} ${value === 1 ? unit : `${unit}s`}`}>
        {value}
      </span>
      <button type="button" onClick={() => step(1)} disabled={value >= max}
        className={btn} aria-label={`One more ${unit}`}>+</button>
    </div>
  );
}

export function ChoiceCard({
  on, emoji, title, sub, onClick, className = '',
}: {
  on?: boolean; emoji?: string; title: ReactNode; sub?: ReactNode;
  onClick?: () => void; className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`group relative flex h-full w-full items-start gap-3.5 rounded-2xl bg-white p-4 text-left transition-all duration-300 ${
        on ? 'shadow-raised ring-2 ring-brand-400' : 'shadow-card hover:-translate-y-0.5 hover:shadow-raised'
      } ${className}`}
    >
      {emoji && (
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl transition-colors duration-300 ${on ? 'grad-soft' : 'bg-ink-50'}`}>
          {emoji}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink-900">{title}</span>
        {sub && <span className="mt-1 block text-xs leading-relaxed text-ink-500">{sub}</span>}
      </span>
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full transition-all duration-200 ${
          on ? 'bg-brand-500 text-white' : 'bg-ink-100 text-transparent'
        }`}
      >
        <IconCheck className="h-3 w-3" />
      </span>
    </button>
  );
}

/* ==========================================================================
   Place field with suggestions
   ========================================================================== */

/**
 * Field styling.
 *
 * Two looks, and only two. `field` is the bordered input used inside forms;
 * `soft` is the borderless filled input used inside the booking widget, where a
 * row of eight bordered boxes would read as a tax return. Both are exported so
 * a plain <select> sitting beside a PlaceInput matches it exactly — the old
 * widget mixed an h-9 bordered input with an h-10 filled one and the row never
 * quite lined up.
 */
/**
 * The booking widget's field is a CELL, not a box with a label above it.
 *
 * The label lives inside the same rounded block as the value, the way an
 * airline's search bar does it, and the block itself is what lights up on
 * focus. The old arrangement — a tiny grey caption floating above a grey pill —
 * drew eight rectangles across the widget and made the row read as a form to be
 * filled in rather than a bar to be used.
 */
export const SOFT_CELL =
  'group relative z-0 min-w-0 rounded-[1.15rem] bg-white px-3.5 py-2.5 ring-1 ring-inset ring-ink-100 ' +
  'transition-all duration-200 hover:ring-ink-200 focus-within:z-10 focus-within:ring-2 ' +
  'focus-within:ring-brand-400 focus-within:shadow-focus';

/**
 * The input inside a cell: no chrome of its own, the cell provides it.
 *
 * The two `focus-visible:ring-0` are load bearing. index.css rings every
 * focused element in the app, which is right for a button and wrong here: the
 * input is invisible, so that ring drew a second rounded box inside the cell's
 * own focus ring. The cell shows the focus for both of them.
 */
export const SOFT_INPUT =
  'h-8 w-full cursor-[inherit] border-0 bg-transparent p-0 text-sm font-medium text-ink-900 outline-none ' +
  'placeholder:font-normal placeholder:text-ink-400 focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-7 ' +
  '[&:is(select)]:-ml-0.5 [&:is(select)]:cursor-pointer';

/** Same field, lighter ink: for values we pre-filled rather than were told. */
export const SOFT_INPUT_MUTED = SOFT_INPUT.replace('font-medium text-ink-900', 'font-normal text-ink-500');

export const SOFT_LABEL =
  'mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase leading-none tracking-[0.12em] text-ink-500';

/** A labelled cell in the booking widget, so plain selects match PlaceInput. */
export function SoftField({
  label, htmlFor, icon, className = '', children,
}: {
  label: string; htmlFor?: string; icon?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <div className={`${SOFT_CELL} ${className}`}>
      <label htmlFor={htmlFor} className={SOFT_LABEL}>
        {icon && <span className="text-brand-500 transition-colors">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Address field.
 *
 * Suggestions come from the portal's own pickup and drop points, ranked by how
 * often they have actually been booked, plus this device's saved places. No
 * geocoding service, so there is nothing to pay for and it keeps working with
 * no internet connection.
 */
/** A place the customer can pick. Coordinates only when the map knows it. */
export interface PlacePick {
  label: string;
  city: string;
  lat: number | null;
  lon: number | null;
  /** True for the office's own saved pickup and drop points. */
  own: boolean;
}

export function PlaceInput({
  label, value, onChange, onPick, placeholder, id, variant = 'field', icon, cellClass = '',
}: {
  label: string; value: string; onChange: (v: string) => void;
  /** Fires when a suggestion is chosen, with coordinates where there are any. */
  onPick?: (p: PlacePick) => void;
  placeholder?: string; id?: string;
  variant?: 'field' | 'soft';
  icon?: ReactNode;
  /** Extra classes for the soft cell — used to square off the joined edge when
   *  two of these sit against each other as one route block. */
  cellClass?: string;
}) {
  const fieldId = id ?? `place-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const [items, setItems] = useState<PlacePick[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** The text the map was last searched for, so the button is offered once. */
  const [mapped, setMapped] = useState('');
  const [mapBusy, setMapBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  /*
   * Suggestions while typing come from /geo/search WITHOUT the map service:
   * the office's own pickup and drop points, this browser's saved places, and
   * earlier cached searches. OpenStreetMap's free search forbids autocomplete,
   * so it is only asked when the customer presses "Search the map".
   */
  const load = async (term: string, map: boolean) => {
    const { data } = await api.get('/geo/search', { params: { q: term, ...(map ? { map: 1 } : {}) } });
    const remote = (data?.places ?? []) as PlacePick[];
    // This browser's own saved places stay at the top: they are what this
    // person books, and they cost nothing to offer.
    const saved: PlacePick[] = snapshot().places
      .filter((x) => x.toLowerCase().includes(term.toLowerCase()))
      .map((x) => ({ label: x, city: 'Saved', lat: null, lon: null, own: true }));
    const merged = [...saved, ...remote];
    return merged.filter((m, i) => merged.findIndex((x) => x.label === m.label) === i).slice(0, 8);
  };

  const searchMap = async () => {
    const term = value.trim();
    if (term.length < 3 || mapBusy) return;
    setMapBusy(true);
    try {
      setItems(await load(term, true));
      setMapped(term);
      setOpen(true);
    } catch { /* keep what is shown */ } finally {
      setMapBusy(false);
    }
  };

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) { setItems([]); return; }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const merged = await load(term, false);
        if (!alive) return;
        setItems(merged);
      } catch {
        if (alive) setItems([]);
      }
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [value]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  const choose = (pick: PlacePick) => {
    onChange(pick.label);
    onPick?.(pick);
    setOpen(false);
    setActive(-1);
  };

  const term = value.trim();
  const offerMap = term.length >= 3 && mapped !== term;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && active < 0 && open && offerMap) { e.preventDefault(); void searchMap(); return; }
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const soft = variant === 'soft';

  return (
    <div ref={box} className={`relative min-w-0 flex-1 ${soft ? `${SOFT_CELL} ${cellClass}` : ''}`}>
      <label htmlFor={fieldId} className={soft ? SOFT_LABEL : 'label'}>
        {icon && soft && <span className="text-brand-500">{icon}</span>}
        {label}
      </label>
      <div className="relative">
        {icon && !soft && (
          <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-ink-400">{icon}</span>
        )}
        <input
          id={fieldId}
          value={value}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={open && items.length > 0}
          aria-autocomplete="list"
          className={`${soft ? SOFT_INPUT : 'input'} ${icon && !soft ? 'pl-9' : ''}`}
        />
      </div>

      {open && (items.length > 0 || offerMap) && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-64 overflow-auto rounded-2xl bg-white py-1.5 shadow-pop"
        >
          {items.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
                  i === active ? 'bg-brand-50' : 'hover:bg-ink-50'
                }`}
              >
                <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-800">{s.label}</span>
                  {s.city && <span className="block text-xs text-ink-500">{s.city}</span>}
                </span>
              </button>
            </li>
          ))}
          {offerMap && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void searchMap()}
                className="flex w-full items-center gap-2.5 border-t border-ink-100 px-3.5 py-2.5 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50"
              >
                {mapBusy
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
                  : <IconSearch className="h-4 w-4 shrink-0" />}
                Search the map for &ldquo;{term}&rdquo;
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ==========================================================================
   Bottom sheet — the mobile pattern for filters and summaries
   ========================================================================== */

/**
 * The bottom sheet.
 *
 * FOUR THINGS THAT ONLY GO WRONG ON A REAL PHONE
 *
 * 1. HEIGHT. The body used to be capped at 62vh inside an 88vh sheet, so any
 *    form longer than a few fields simply had its last field cut off with
 *    nothing to scroll. It is now a flex column: header and footer keep their
 *    natural height and the body takes the rest and scrolls. The cap itself
 *    lives in `.sheet-shell` — see index.css for why it is two declarations
 *    and not `min(92dvh, 92vh)`.
 *
 * 2. THE KEYBOARD. `position: fixed` is positioned against the LAYOUT viewport,
 *    which does not shrink when the on-screen keyboard opens. A sheet pinned to
 *    the bottom therefore ends up behind the keyboard, taking the submit button
 *    with it, and iOS scrolling the focused field into view drags the whole
 *    overlay around as it goes. So when `visualViewport` is available the
 *    overlay is given that exact rectangle instead — it stays glued to the part
 *    of the screen the customer can actually see.
 *
 * 3. BACKGROUND SCROLL. `body { overflow: hidden }` does not stop iOS Safari
 *    scrolling the page behind a modal. Pinning the body and putting the scroll
 *    offset back on close does.
 *
 * 4. THE HOME INDICATOR. The footer is padded by `safe-area-inset-bottom`,
 *    which is only ever non-zero when the document opts in with
 *    `viewport-fit=cover` — see index.html.
 */
export function BottomSheet({
  open, onClose, onClosed, title, subtitle, children, footer, size = 'md',
}: {
  open: boolean; onClose: () => void; title: string;
  /** Runs after the sheet has closed and the history is back in place. */
  onClosed?: () => void;
  subtitle?: ReactNode;
  children: ReactNode; footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  // The phone's Back closes the sheet first; it does not leave the page.
  useBackToClose(open, onClose, onClosed);

  /**
   * The visible rectangle, but ONLY while an on-screen keyboard is up.
   *
   * With no keyboard the plain `inset: 0` plus the CSS height cap is the
   * well-trodden path, and every browser gets it right. Taking over the
   * positioning all the time would mean trusting `visualViewport` on every
   * device for no benefit — so the override only kicks in for the one case
   * that genuinely needs it, where the keyboard has eaten the bottom of the
   * screen and would otherwise take the submit button with it.
   */
  const [view, setView] = useState<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const vp = window.visualViewport;
    if (!vp) return;

    const update = () => {
      const hidden = window.innerHeight - vp.height;
      // A keyboard is at least a couple of hundred pixels. Anything smaller is
      // the URL bar collapsing, which needs no help from us.
      const keyboardUp = hidden > 120;
      const sane = vp.height > 200 && Number.isFinite(vp.offsetTop);
      setView(keyboardUp && sane ? { height: vp.height, top: vp.offsetTop } : null);
    };

    update();
    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    return () => {
      vp.removeEventListener('resize', update);
      vp.removeEventListener('scroll', update);
      setView(null);
    };
  }, [open]);

  /* --- lock the page behind, and put it back exactly where it was --- */
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${y}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);

    return () => {
      Object.assign(body.style, prev);
      document.removeEventListener('keydown', onKey);
      // Restoring `position` alone leaves the page at the top of the document.
      window.scrollTo(0, y);
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg';

  /*
   * Rendered into <body>, not where the button is. A vehicle card has
   * overflow-hidden and a hover transform, and a transformed ancestor becomes
   * the containing block for `position: fixed` - so the sheet opened INSIDE
   * the card, clipped to its size, instead of over the page.
   */
  return createPortal(
    <div
      className="fixed inset-x-0 z-[70] flex items-end sm:items-center sm:justify-center sm:p-6"
      // Only while the keyboard is up; otherwise the ordinary full viewport.
      style={view
        ? { top: view.top, height: view.height, bottom: 'auto' }
        : { top: 0, bottom: 0 }}
      role="dialog" aria-modal="true" aria-label={title}
    >
      <button
        className="absolute inset-0 animate-fade-in bg-ink-950/45 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />

      <div
        className={`sheet-shell relative flex w-full animate-fade-up flex-col overflow-hidden rounded-t-[1.75rem] bg-white shadow-pop ${width} sm:rounded-[1.75rem]`}
        // A real number beats the CSS cap: it already accounts for the keyboard.
        style={view ? { maxHeight: Math.round(view.height * 0.94) } : undefined}
      >
        {/* header — pinned */}
        <div className="relative shrink-0 border-b border-ink-100/80 px-5 pb-3.5 pt-5 sm:pt-4">
          <span
            className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-ink-200 sm:hidden"
            aria-hidden="true"
          />
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="font-display text-md font-bold leading-tight text-ink-900">{title}</h2>
              {subtitle && <p className="mt-1 text-xs leading-relaxed text-ink-500">{subtitle}</p>}
            </div>
            <button
              onClick={onClose}
              className="-mr-1.5 -mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-400 transition-colors hover:bg-ink-50 hover:text-ink-700"
              aria-label="Close"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* body — takes what is left, and is the only thing that scrolls.
            `min-h-0` is load bearing: without it a flex child refuses to shrink
            below its content and the scroll never engages. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t border-ink-100 bg-white px-5 py-3.5"
            style={{ paddingBottom: 'calc(0.875rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ==========================================================================
   Loading, empty, error
   ========================================================================== */

export function CardSkeleton({ media = true, lines = 3 }: { media?: boolean; lines?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card">
      {media && <div className="skeleton aspect-[3/2] w-full" />}
      <div className="space-y-2.5 p-4">
        <div className="skeleton h-4 w-2/3 rounded-full" />
        {Array.from({ length: lines - 1 }).map((_, i) => (
          <div key={i} className="skeleton h-3 rounded-full" style={{ width: `${90 - i * 18}%` }} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6, media = true }: { count?: number; media?: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} media={media} />)}
    </div>
  );
}

export function LineSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-card">
          <div className="skeleton h-11 w-11 shrink-0 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-1/2 rounded-full" />
            <div className="skeleton h-3 w-1/3 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SiteEmpty({
  emoji = '\u{1F5FA}️', title, body, action,
}: {
  emoji?: string; title: string; body: string; action?: ReactNode;
}) {
  return (
    <div className="tile flex flex-col items-center px-6 py-14 text-center">
      <span className="grad-soft grid h-16 w-16 place-items-center rounded-full text-3xl" aria-hidden="true">{emoji}</span>
      <h3 className="mt-5 font-display text-lg font-bold text-ink-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">{body}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2.5">{action}</div>}
    </div>
  );
}

/**
 * Error state. Never a status code — a visitor cannot act on "500", but they
 * can act on "try again" and "call us".
 */
export function SiteError({
  title = 'We couldn’t load this right now.', body, onRetry,
}: {
  title?: string; body?: string; onRetry?: () => void;
}) {
  return (
    <div className="tile flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-warn-50 text-warn-600">
        <IconWarning className="h-6 w-6" />
      </span>
      <h3 className="mt-5 font-display text-lg font-bold text-ink-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
        {body ?? 'It is usually the connection rather than anything you did. Try again, or call and we will take the requirement over the phone.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        {onRetry && (
          <button onClick={onRetry} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
            Try again
          </button>
        )}
        <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
          <IconPhone className="h-4 w-4" /> Contact support
        </a>
      </div>
    </div>
  );
}

/* ==========================================================================
   Trust, ratings
   ========================================================================== */

export function TrustRow({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const list = compact ? TRUST.slice(0, 4) : TRUST;
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {list.map((t) => (
        <li
          key={t.label}
          title={t.note}
          className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-2xs font-semibold text-ink-600 shadow-card"
        >
          <IconCheck className="h-3.5 w-3.5 shrink-0 text-ok-500" />
          {t.label}
        </li>
      ))}
    </ul>
  );
}

export function IconStar({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.44 6.19 20.5 7.3 14.03 2.6 9.45l6.5-.95L12 2.6Z" />
    </svg>
  );
}

export function Stars({ value, className = '' }: { value: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`${value} out of 5`}>
      <IconStar className="h-3.5 w-3.5 text-gold-500" />
      <span className="text-xs font-bold tabular-nums text-ink-800">{value.toFixed(1)}</span>
    </span>
  );
}

/* ==========================================================================
   The estimate panel
   ========================================================================== */

/**
 * A price the customer can trust because it says what it is.
 *
 * Three states, and the difference between them is the whole point: an
 * estimate worked out from the published rate card, a figure we cannot work
 * out and will quote instead, and nothing yet. It is never called a quote.
 */
export function EstimatePanel({
  estimate, planLabel, reason, note, vehicles = 1, className = '',
}: {
  estimate: FareEstimate | null;
  planLabel?: string;
  reason?: string;
  note?: ReactNode;
  vehicles?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (reason === 'loading') {
    return (
      <div className={`tile p-5 ${className}`}>
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton mt-3 h-8 w-36 rounded-full" />
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className={`tile p-5 ${className}`}>
        <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Estimated trip cost</p>
        <p className="mt-2 font-display text-xl font-bold text-ink-900">Quoted on request</p>
        <p className="mt-2 text-xs leading-relaxed text-ink-500">
          This combination is priced per requirement rather than off the standard card. Send it through and you get the
          rate before anything is assigned.
        </p>
        {note}
      </div>
    );
  }

  return (
    <div className={`tile overflow-hidden ${className}`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Estimated trip cost</p>
            <p className="mt-1.5 font-display text-[1.75rem] font-extrabold leading-none tracking-tight text-ink-900">
              {inr(estimate.total, true).replace('.00', '')}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-warn-50 px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-warn-700">
            Estimate
          </span>
        </div>

        <p className="mt-2.5 text-xs leading-relaxed text-ink-500">
          Indicative, from our published rates{planLabel ? ` (${planLabel}${vehicles > 1 ? ` × ${vehicles}` : ''})` : ''}.
          Toll, parking and any state permit are extra at actuals. The final rate is confirmed before a vehicle is assigned.
        </p>

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800"
          aria-expanded={open}
        >
          {open ? 'Hide the breakdown' : 'See what this covers'}
          <IconChevron className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <dl className="animate-fade-in space-y-2.5 bg-ink-50/70 px-5 py-4 text-sm">
          {estimate.lines.map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-4">
              <dt className="min-w-0">
                <span className="font-medium text-ink-800">{l.label}</span>
                {l.detail && <span className="block text-xs text-ink-500">{l.detail}</span>}
              </dt>
              <dd className="shrink-0 tabular-nums text-ink-700">{inr(l.amount)}</dd>
            </div>
          ))}
          {estimate.tax > 0 && (
            <>
              <div className="flex items-baseline justify-between gap-4 border-t border-ink-200 pt-2.5">
                <dt className="text-ink-600">Subtotal</dt>
                <dd className="tabular-nums text-ink-700">{inr(estimate.subtotal)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-ink-600">{estimate.taxLabel}</dt>
                <dd className="tabular-nums text-ink-700">{inr(estimate.tax)}</dd>
              </div>
            </>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-ink-200 pt-2.5">
            <dt className="font-bold text-ink-900">Estimated total</dt>
            <dd className="font-bold tabular-nums text-ink-900">{inr(estimate.total)}</dd>
          </div>
          <p className="rounded-lg bg-warn-50 px-3 py-2 text-xs font-medium leading-relaxed text-warn-700">
            Toll, parking &amp; state tax extra — charged at actuals, as per receipts. The same goes for state
            permits and anything from the "enhance your trip" list.
          </p>
          {estimate.note && <p className="text-xs leading-relaxed text-warn-700">{estimate.note}</p>}
        </dl>
      )}
    </div>
  );
}

/* ==========================================================================
   Journeys and status
   ========================================================================== */

/** The route drawn as a line of stops, with optional add and remove. */
export function JourneyLine({
  stops, onRemove, onAdd, addLabel = 'Add stop',
}: {
  stops: { label: string; note?: string }[];
  onRemove?: (i: number) => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <ol className="relative space-y-1">
      {stops.map((s, i) => {
        const last = i === stops.length - 1;
        return (
          <li key={`${s.label}-${i}`} className="relative flex gap-3.5 pb-1">
            <span className="relative flex w-5 shrink-0 justify-center">
              <span
                className={`z-10 mt-1.5 h-3 w-3 rounded-full ring-4 ring-white ${
                  i === 0 ? 'bg-brand-500' : last ? 'bg-ok-500' : 'bg-ink-300'
                }`}
              />
              {!last && <span className="absolute bottom-0 top-4 w-0.5 rounded-full bg-ink-200" />}
            </span>
            <span className="min-w-0 flex-1 pb-2">
              <span className="block truncate text-sm font-semibold text-ink-900">{s.label}</span>
              {s.note && <span className="block text-xs text-ink-500">{s.note}</span>}
            </span>
            {onRemove && stops.length > 2 && (
              <button
                onClick={() => onRemove(i)}
                className="btn btn-icon shrink-0 rounded-full text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                aria-label={`Remove ${s.label}`}
              >
                <IconTrash className="h-4 w-4" />
              </button>
            )}
          </li>
        );
      })}
      {onAdd && (
        <li className="flex gap-3.5">
          <span className="flex w-5 shrink-0 justify-center">
            <span className="mt-1 h-3 w-3 rounded-full border-2 border-dashed border-ink-300" />
          </span>
          <button onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-700 hover:text-brand-800">
            <IconPlus className="h-3.5 w-3.5" /> {addLabel}
          </button>
        </li>
      )}
    </ol>
  );
}

export function StatusTrail({ steps }: { steps: { label: string; state: 'done' | 'now' | 'off'; at?: string }[] }) {
  return (
    <ol className="space-y-0">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={s.label} className="flex gap-3.5">
            <span className="relative flex w-5 shrink-0 justify-center">
              <span
                className={`z-10 mt-1 grid h-4 w-4 place-items-center rounded-full ring-4 ring-white ${
                  s.state === 'done' ? 'bg-ok-500 text-white' : s.state === 'now' ? 'bg-brand-500' : 'bg-ink-200'
                }`}
              >
                {s.state === 'done' && <IconCheck className="h-2.5 w-2.5" />}
                {s.state === 'now' && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              {!last && (
                <span className={`absolute bottom-0 top-4 w-0.5 rounded-full ${s.state === 'done' ? 'bg-ok-200' : 'bg-ink-200'}`} />
              )}
            </span>
            <span className={`min-w-0 flex-1 pb-5 ${last ? 'pb-0' : ''}`}>
              <span className={`block text-sm font-semibold ${s.state === 'off' ? 'text-ink-400' : 'text-ink-900'}`}>
                {s.label}
              </span>
              {s.at && <span className="block text-xs text-ink-500">{s.at}</span>}
              {s.state === 'now' && <span className="mt-1 inline-block badge-brand">In progress</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The map area on the tracking screen.
 *
 * Drawn rather than fetched. The portal has no vehicle telemetry and does not
 * pay a map provider, so this is a stylised plan of the route with the pickup
 * and drop marked — and the tracking screen says exactly that above it. A fake
 * moving car would be worse than an honest diagram.
 */
export function MapCanvas({
  from, to, live = false, className = '',
}: {
  from: string; to: string; live?: boolean; className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-[1.75rem] bg-[#E8F0F7] ${className}`}>
      <svg viewBox="0 0 400 260" className="h-full w-full" role="img" aria-label={`Route plan from ${from} to ${to}`}>
        <defs>
          <linearGradient id="mapRoute" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#35C0EE" />
            <stop offset="100%" stopColor="#2E86F0" />
          </linearGradient>
        </defs>

        {/* the city grid, suggested rather than mapped */}
        <g stroke="#D3E0EC" strokeWidth="1.5">
          {[30, 78, 126, 174, 222].map((y) => <line key={y} x1="0" y1={y} x2="400" y2={y} />)}
          {[52, 116, 180, 244, 308, 364].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="260" />)}
        </g>
        <g fill="#DCE8F2">
          <rect x="60" y="38" width="46" height="30" rx="5" />
          <rect x="190" y="128" width="42" height="36" rx="5" />
          <rect x="286" y="52" width="58" height="26" rx="5" />
          <rect x="120" y="184" width="52" height="30" rx="5" />
        </g>
        <path d="M-4 96 C 90 96 120 40 400 62" stroke="#C6D8E6" strokeWidth="9" fill="none" strokeLinecap="round" />

        <path
          d="M44 208 C 120 200 128 132 196 122 C 268 112 288 74 356 66"
          stroke="url(#mapRoute)" strokeWidth="5" fill="none" strokeLinecap="round"
          className={live ? 'trip-trace' : undefined}
        />

        <g>
          <circle cx="44" cy="208" r="16" fill="#fff" />
          <circle cx="44" cy="208" r="7" fill="#1CA3DE" />
        </g>
        <g>
          <circle cx="356" cy="66" r="16" fill="#fff" />
          <circle cx="356" cy="66" r="7" fill="#12996A" />
        </g>
        {live && <circle cx="196" cy="122" r="9" fill="#2E86F0" className="trip-pulse" />}
      </svg>

      <div className="pointer-events-none absolute inset-x-4 bottom-4 flex flex-wrap gap-2">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-2xs font-semibold text-ink-700 shadow-card backdrop-blur">
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" /> <span className="truncate">{from || 'Pickup'}</span>
        </span>
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-2xs font-semibold text-ink-700 shadow-card backdrop-blur">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ok-500" /> <span className="truncate">{to || 'Destination'}</span>
        </span>
      </div>
    </div>
  );
}

/* ==========================================================================
   Contact block + submit — every journey ends here
   ========================================================================== */

export interface Contact {
  name: string;
  mobile: string;
  email: string;
  company: string;
  /** Ticked "I don't have an email ID" - the reply then comes on WhatsApp or a call. */
  noEmail?: boolean;
}

export function useContactDetails(): [Contact, (p: Partial<Contact>) => void] {
  const stored = snapshot().customer;
  const [c, setC] = useState<Contact>({
    name: stored.name, mobile: stored.mobile, email: stored.email, company: stored.company, noEmail: false,
  });
  return [c, (p) => setC((v) => ({ ...v, ...p }))];
}

export const cleanMobile = (v: string) => v.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
export const validMobile = (v: string) => /^[6-9]\d{9}$/.test(cleanMobile(v));

/** Email is required unless they ticked that they do not have one. */
export function emailError(c: Pick<Contact, 'email' | 'noEmail'>): Record<string, string> {
  if (c.noEmail) return {};
  const email = c.email.trim();
  if (!email) return { email: 'Please enter your email ID, or tick that you do not have one.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { email: 'That email address does not look right.' };
  return {};
}

export function ContactFields({
  value, onChange, error, company = false,
}: {
  value: Contact; onChange: (p: Partial<Contact>) => void;
  error?: Record<string, string>; company?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="c-name">Your name <span className="text-danger-600">*</span></label>
        <input id="c-name" className={`input ${error?.name ? 'input-error' : ''}`} value={value.name}
          onChange={(e) => onChange({ name: e.target.value })} placeholder="Rajesh Menon" autoComplete="name" />
        {error?.name && <p className="error-text">{error.name}</p>}
      </div>
      <div>
        <label className="label" htmlFor="c-mobile">Mobile <span className="text-danger-600">*</span></label>
        <input id="c-mobile" className={`input ${error?.mobile ? 'input-error' : ''}`} value={value.mobile}
          onChange={(e) => onChange({ mobile: e.target.value })} placeholder="10-digit mobile" inputMode="numeric" autoComplete="tel" />
        {error?.mobile && <p className="error-text">{error.mobile}</p>}
      </div>
      {!value.noEmail && (
        <div className={company ? '' : 'sm:col-span-2'}>
          <label className="label" htmlFor="c-email">Email ID <span className="text-danger-600">*</span></label>
          <input id="c-email" className={`input ${error?.email ? 'input-error' : ''}`} type="email" value={value.email}
            onChange={(e) => onChange({ email: e.target.value })} placeholder="name@company.com" autoComplete="email" />
          {error?.email && <p className="error-text">{error.email}</p>}
        </div>
      )}
      {company && (
        <div>
          <label className="label" htmlFor="c-company">Company</label>
          <input id="c-company" className="input" value={value.company}
            onChange={(e) => onChange({ company: e.target.value })} placeholder="Company name" autoComplete="organization" />
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-700 sm:col-span-2">
        <input
          type="checkbox" checked={!!value.noEmail}
          onChange={(e) => onChange({ noEmail: e.target.checked, ...(e.target.checked ? { email: '' } : {}) })}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
        />
        <span>
          I don&apos;t have an email ID
          {value.noEmail && (
            <span className="mt-0.5 block text-xs text-ink-500">
              No problem - we send your Trip ID and quote on WhatsApp, or call you on the number above.
            </span>
          )}
        </span>
      </label>
    </div>
  );
}

/**
 * Send the requirement and go to the confirmation screen.
 *
 * Every journey on this site funnels through here, so the customer sees the
 * same acknowledgement whichever door they came in by.
 */
export function useSendRequirement() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (input: RequestInput) => {
    const mobile = cleanMobile(input.mobile);
    if (input.name.trim().length < 2) { setError('Please enter your name.'); return; }
    if (!validMobile(mobile)) { setError('Enter a valid 10-digit mobile number.'); return; }

    setBusy(true);
    setError('');
    try {
      saveCustomer({ name: input.name.trim(), mobile, email: input.email ?? '', company: input.company ?? '' });
      const { ref } = await submitRequest({ ...input, mobile });
      navigate(`/request/${ref}`);
    } catch {
      setError('We could not send that just now. Please try again, or call us and we will take it over the phone.');
    } finally {
      setBusy(false);
    }
  };

  return { send, busy, error, setError };
}

export function SubmitButton({
  busy, children = 'Submit requirement', className = '',
}: {
  busy?: boolean; children?: ReactNode; className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className={`grad-brand btn h-12 rounded-full px-7 text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter] hover:brightness-[1.06] disabled:opacity-70 ${className}`}
    >
      {busy && <Spinner />}
      {busy ? 'Sending…' : children}
    </button>
  );
}

/**
 * Call / WhatsApp / enquiry — the row that closes most pages.
 *
 * The WhatsApp button collects the trip in a short sheet before it opens the
 * chat, so the enquiry lands in the portal with a Trip ID instead of only in
 * somebody's phone. See `WhatsAppInquiry.tsx` for why.
 */
export function ContactRow({ message, className = '' }: { message?: string; className?: string }) {
  return (
    <div className={`flex flex-wrap gap-3 ${className}`}>
      <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-ink-900 px-7 text-md text-white hover:bg-ink-800">
        <IconPhone className="h-4 w-4" /> Call
      </a>
      <WhatsAppButton
        message={message}
        className="btn h-12 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
      >
        <IconWhatsApp className="h-4 w-4" /> WhatsApp
      </WhatsAppButton>
      <Link to="/enquiry" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
        Send a requirement <IconArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}


/* ==========================================================================
   Going back
   ========================================================================== */

/**
 * Back.
 *
 * Every screen below the home page gets one. Breadcrumbs alone are not enough:
 * a customer who came from the vehicle search into a vehicle, then into the trip
 * builder, wants the step they were on, not the section root — and on a phone
 * there is no browser chrome to fall back on in an installed or in-app view.
 *
 * It uses real history when there is any, and the `to` fallback when the page
 * was opened cold from a link or a bookmark, so it can never dead-end on a
 * blank tab.
 */
export function BackLink({
  to = '/', label = 'Back', className = '', onBack,
}: {
  /** Where to go when there is no history to go back to. */
  to?: string;
  label?: string;
  className?: string;
  /**
   * A screen with steps of its own passes this. Return `true` when the click
   * was consumed by unwinding one of those steps; return `false` and the button
   * falls through to leaving the page. Without it, Back on step five of a
   * six-step planner threw away all five answers.
   */
  onBack?: () => boolean;
}) {
  const navigate = useNavigate();

  const goBack = () => {
    if (onBack?.()) return;

    // `idx` is react-router's position in its own history stack. 0 means this
    // entry is the first one we created, so there is nothing of ours to pop.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(to);
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white/80 py-1.5 pl-2 pr-3.5 text-xs font-bold lg:min-h-0 text-ink-600 shadow-card transition-all duration-200 hover:bg-white hover:text-ink-900 hover:shadow-raised ${className}`}
    >
      <IconChevron className="h-3.5 w-3.5 rotate-90" />
      {label}
    </button>
  );
}

/**
 * A reference, and a one-tap way to get it into a WhatsApp message.
 *
 * The reference is the only thing a customer needs when they ring the office,
 * so it is shown as something you can act on rather than as small print.
 */
export function CopyChip({
  value, label, className = '',
}: {
  value: string; label?: string; className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); copy(); }}
      title={copied ? 'Copied' : `Copy ${label ?? 'reference'}`}
      className={`group inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-mono text-2xs font-bold text-brand-700 transition-colors hover:bg-brand-100 ${className}`}
    >
      {value}
      {copied
        ? <IconCheck className="h-3 w-3 text-ok-600" />
        : <IconDuplicate className="h-3 w-3 text-brand-400 group-hover:text-brand-700" />}
    </button>
  );
}

/**
 * "2 hours ago", "yesterday", "3 Sept".
 *
 * Two requests for the same route on the same day are told apart by when they
 * were sent, so the trip cards show this rather than only the travel date.
 */
export function since(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/* ==========================================================================
   Small pieces
   ========================================================================== */

export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">{label}</dt>
      <dd className="mt-1 truncate text-sm font-semibold text-ink-900">{value || '—'}</dd>
    </div>
  );
}

export function Callout({
  tone = 'info', children, className = '',
}: {
  tone?: 'info' | 'warn' | 'ok'; children: ReactNode; className?: string;
}) {
  const map = {
    info: 'bg-brand-50 text-brand-900',
    warn: 'bg-warn-50 text-warn-700',
    ok: 'bg-ok-50 text-ok-700',
  } as const;
  return (
    <p className={`rounded-2xl px-4 py-3 text-xs leading-relaxed ${map[tone]} ${className}`}>{children}</p>
  );
}

/** The "sample content" marker. Used wherever the page shows placeholder data. */
export function SampleTag({ className = '' }: { className?: string }) {
  return (
    <span
      title="Placeholder content shipped with the website. Replace it before go-live."
      className={`inline-flex items-center gap-1 rounded-full bg-warn-50 px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.1em] text-warn-700 ${className}`}
    >
      Sample
    </span>
  );
}

export function SearchField({
  value, onChange, placeholder = 'Search destinations, vehicles, services…', autoFocus = false,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 w-full rounded-full border-0 bg-white pl-11 pr-4 text-sm font-medium text-ink-900 shadow-card outline-none placeholder:font-normal placeholder:text-ink-400 focus:shadow-focus"
        aria-label={placeholder}
      />
    </div>
  );
}

/* ==========================================================================
   Comparison tray — shared between the vehicle list and the compare screen
   ========================================================================== */

interface CompareCtx {
  picked: string[];
  toggle: (slug: string) => void;
  clear: () => void;
  has: (slug: string) => boolean;
}

const Compare = createContext<CompareCtx | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<string[]>([]);
  const value = useMemo<CompareCtx>(
    () => ({
      picked,
      has: (slug) => picked.includes(slug),
      clear: () => setPicked([]),
      toggle: (slug) =>
        setPicked((p) => (p.includes(slug) ? p.filter((s) => s !== slug) : p.length >= 3 ? p : [...p, slug])),
    }),
    [picked]
  );
  return <Compare.Provider value={value}>{children}</Compare.Provider>;
}

export function useCompare(): CompareCtx {
  return useContext(Compare) ?? { picked: [], toggle: () => {}, clear: () => {}, has: () => false };
}

/* --------------------------------------------------------------- calling ---
   One Call control for the whole site.

   WHY THE NUMBER IS NOT IN HERE ANYWHERE
   A phone number printed on a public page gets scraped, and the business was
   receiving spam on the line customers are meant to reach it on. So the number
   is never rendered as text, never put in a `title` (which is a tooltip, and a
   tooltip is a display), and never read out by a screen reader. It exists only
   inside the `tel:` href, which the browser hands straight to the dialler.

   The design is the Home page's Call button; `className` takes whatever shell
   the surrounding page needs, so the control changes colour without ever
   changing what it does or what it leaks.
   ------------------------------------------------------------------------- */
export function CallButton({
  className = 'btn h-12 rounded-full px-5 text-md text-ink-700 hover:bg-white',
  label = 'Call',
  number,
  iconClass = 'h-4 w-4',
  ariaLabel = 'Call the office',
}: {
  className?: string;
  /** Text beside the icon. Never a phone number. */
  label?: string;
  /** A ten-digit Indian mobile. Defaults to the office line. */
  number?: string;
  iconClass?: string;
  ariaLabel?: string;
}) {
  return (
    <a href={`tel:+91${number ?? COMPANY.mobile}`} aria-label={ariaLabel} className={className}>
      <IconPhone className={iconClass} aria-hidden="true" />
      {label}
    </a>
  );
}

/* ------------------------------------------------------------- distance ---
   How far it actually is, by road.

   Fed by the two address boxes. Either end can be a suggestion the customer
   picked (which carries coordinates) or just text they typed (which the server
   resolves out of the same cache the suggestions came from), so the number
   appears whether or not anybody touched the dropdown.

   It is a convenience and never a dependency: no answer, a slow service, or
   the month's free allowance spent, and the form carries on exactly as before
   with nothing shown.
   ------------------------------------------------------------------------- */

export interface RouteInfo {
  km: number | null;
  minutes: number | null;
  /** The month's free allowance is spent; nothing further will be fetched. */
  capped: boolean;
  busy: boolean;
}

export interface RouteEnd {
  text: string;
  lat?: number | null;
  lon?: number | null;
}

export function useRouteDistance(from: RouteEnd, to: RouteEnd): RouteInfo {
  const [info, setInfo] = useState<RouteInfo>({ km: null, minutes: null, capped: false, busy: false });

  const a = from.text.trim();
  const b = to.text.trim();
  // Coordinates are part of the key: picking a suggestion for an address you
  // had already typed should re-measure against the exact point.
  const key = `${a}|${from.lat ?? ''},${from.lon ?? ''}|${b}|${to.lat ?? ''},${to.lon ?? ''}`;

  useEffect(() => {
    if (a.length < 3 || b.length < 3 || a.toLowerCase() === b.toLowerCase()) {
      setInfo({ km: null, minutes: null, capped: false, busy: false });
      return;
    }
    let alive = true;
    setInfo((p) => ({ ...p, busy: true }));

    const t = setTimeout(async () => {
      try {
        const { data } = await api.post('/geo/distance', {
          from: { text: a, ...(from.lat != null ? { lat: from.lat, lon: from.lon } : {}) },
          to: { text: b, ...(to.lat != null ? { lat: to.lat, lon: to.lon } : {}) },
        });
        if (!alive) return;
        setInfo({
          km: typeof data?.distanceKm === 'number' ? data.distanceKm : null,
          minutes: typeof data?.durationMin === 'number' ? data.durationMin : null,
          capped: !!data?.capped,
          busy: false,
        });
      } catch {
        if (alive) setInfo({ km: null, minutes: null, capped: false, busy: false });
      }
    }, 700);

    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return info;
}

/** "2 h 5 m" — a duration a person reads without converting anything. */
function readableMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h <= 0) return `${m} min`;
  return m ? `${h} h ${m} m` : `${h} h`;
}

/**
 * The line under a pickup/drop pair.
 *
 * Renders nothing at all until there is something worth saying — an empty
 * strip under two empty boxes is noise.
 */
export function DistanceNote({ info, className = '' }: { info: RouteInfo; className?: string }) {
  if (info.busy) {
    return (
      <p className={`flex items-center gap-2 text-xs text-ink-400 ${className}`}>
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
        Measuring the road…
      </p>
    );
  }
  if (info.km == null) return null;

  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className}`}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 font-semibold text-brand-700">
        <IconRoad className="h-3.5 w-3.5" />
        ≈ {info.km} km by road
      </span>
      {info.minutes != null && (
        <span className="text-ink-500">about {readableMinutes(info.minutes)} driving</span>
      )}
      <span className="text-ink-400">· an estimate, confirmed when we quote</span>
    </p>
  );
}
