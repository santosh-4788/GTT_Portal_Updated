/**
 * The enquiry form — one component, nine conversations, two ways out.
 *
 * WHY THERE IS A FORM IN FRONT OF WHATSAPP
 * Tapping WhatsApp used to jump straight to wa.me. That worked — people really
 * do prefer it to a form — but the office was left with a chat and no record:
 * no Trip ID, nothing in the portal, nothing to search for three weeks later
 * when the customer rings about "that Lonavala trip". So one short form sits in
 * front of it: submitting records the enquiry, allocates a Trip ID, emails the
 * office, and then opens the chat with everything already written out.
 *
 * WHAT IT ASKS DEPENDS ON WHICH DOOR THEY CAME THROUGH
 * An airport transfer needs the terminal and the flight number; an outstation
 * trip needs a return date; a wedding needs how many cars across which days.
 * The category (see enquiryCategories.ts) decides which fields appear, so
 * nobody is asked for a flight number to go to Lonavala.
 *
 * CALL IS NOT ONE OF THE WAYS OUT
 * Wherever Call appears on this site it is a plain `tel:` link. Somebody
 * reaching for the phone wants the phone; a form in front of it is the fastest
 * way to lose them. This form ends in Send, or Send-and-open-WhatsApp.
 *
 * TWO DETAILS THAT ONLY MATTER ON A PHONE
 *   · The WhatsApp window is opened SYNCHRONOUSLY on the tap, before the
 *     network call, because a browser only trusts window.open inside a real
 *     gesture. It is opened blank and pointed at wa.me once the Trip ID is
 *     back. If it is blocked anyway the thank-you carries a full-width link,
 *     and nothing is lost either way — the enquiry is already saved.
 *   · Fields are 16px. Below that iOS Safari zooms the page on focus, and a
 *     form that jumps on every tap reads as broken.
 *
 * No WhatsApp Business API, no paid service. wa.me is a plain link.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../lib/api';
import { COMPANY, whatsappLink } from './siteData';
import { VEHICLES, type NeedKey } from './catalog';
import {
  AIRPORTS, CATEGORIES, CORPORATE_NEEDS, DARSHAN_PLANS, EVENT_TYPES, HOURLY_PLANS,
  type FieldKey,
} from './enquiryCategories';
import { dmy, todayIso } from '../lib/format';
import {
  BottomSheet, CallButton, DistanceNote, PlaceInput, cleanMobile, useRouteDistance, validMobile,
  type PlacePick,
} from './kit';
import { IconWhatsApp } from './SiteIcons';
import {
  IconArrowRight, IconCalendar, IconCheck, IconClock, IconDuplicate, IconMail,
  IconPhone, IconPin, IconPlane, IconSteering, IconUsers,
} from '../components/icons';
import { rememberTrip } from './tripStore';
import { DateField, TimeField } from '../components/DateTimeField';

/* ==========================================================================
   Shapes
   ========================================================================== */

/**
 * How the enquiry leaves. Not a list of the buttons on screen — Call is always
 * a `tel:` link and never routes through here.
 */
export type EnquiryChannel = 'whatsapp' | 'email';

export interface EnquiryPrefill {
  message?: string;
  pickup?: string;
  drop?: string;
  date?: string;
  time?: string;
  vehicleType?: string;
  passengers?: number;
}

/** Kept as the old name so the screens that import it need no change. */
export type WhatsAppPrefill = EnquiryPrefill;

interface Values {
  name: string;
  email: string;
  mobile: string;
  whatsapp: string;
  sameNumber: boolean;
  message: string;
  /** Everything the category asked for, keyed by field. */
  fields: Partial<Record<FieldKey, string>>;
}

const BLANK: Values = {
  name: '', email: '', mobile: '', whatsapp: '', sameNumber: true, message: '', fields: {},
};

/* ==========================================================================
   Field primitives
   ==========================================================================
   Local rather than the site-wide SOFT_* cells: this form needs bigger targets
   and 16px text on a phone, and changing those globally would resize the
   booking bar on the home page along with it.
   ========================================================================== */

const CELL =
  'relative rounded-2xl bg-white px-3.5 py-2.5 ring-1 ring-inset ring-ink-200 ' +
  'transition-all duration-200 hover:ring-ink-300 ' +
  'focus-within:ring-2 focus-within:ring-brand-400 focus-within:shadow-focus';

const CELL_BAD = 'ring-danger-300 hover:ring-danger-400';

const LABEL =
  'mb-1 flex items-center gap-1.5 text-2xs font-bold uppercase leading-none tracking-[0.1em] text-ink-500';

/*
 * 16px, spelled out.
 *
 * iOS Safari zooms the page whenever a focused field is under 16px. This
 * project's type scale is compressed for a dense admin UI — `text-base` is 14px
 * and there is no 16px step at all — so the one place it matters says so.
 */
const INPUT =
  'h-9 w-full border-0 bg-transparent p-0 text-[1rem] font-medium text-ink-900 outline-none ' +
  'placeholder:font-normal placeholder:text-ink-400 focus-visible:ring-0 focus-visible:ring-offset-0 ' +
  'sm:h-8 sm:text-sm';

function Field({
  label, icon, error, hint, required, children,
}: {
  label: string; icon?: ReactNode; error?: string; hint?: string;
  required?: boolean; children: ReactNode;
}) {
  return (
    <div>
      <div className={`${CELL} ${error ? CELL_BAD : ''}`}>
        <label className={LABEL}>
          {icon && <span className="text-brand-500">{icon}</span>}
          {label}
          {required && <span className="text-danger-500" aria-hidden="true">*</span>}
        </label>
        {children}
      </div>
      {error
        ? <p className="mt-1 px-1 text-xs font-medium text-danger-600">{error}</p>
        : hint ? <p className="mt-1 px-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

/**
 * A date or time field inside this sheet's bordered cell.
 *
 * This used to hold a native `<input type="date">` and go to some lengths to
 * make the browser's own picker open from anywhere on the cell. It now holds
 * the portal's calendar and clock instead, so the sheet looks the same on
 * every browser and the value is drawn the way India reads it rather than the
 * way the operating system's locale happens to be set.
 */
function PickerField({
  label, icon, type, value, onChange, min, error,
}: {
  label: string; icon?: ReactNode; type: 'date' | 'time';
  value: string; onChange: (v: string) => void;
  min?: string; error?: string;
}) {
  const shared = {
    value, onChange, ariaLabel: label,
    baseClass: INPUT, chevron: false, showIcon: false,
  };

  return (
    <div>
      <div className={`${CELL} ${error ? CELL_BAD : ''}`}>
        <span className={LABEL}>
          {icon && <span className="text-brand-500">{icon}</span>}
          {label}
        </span>
        {type === 'date'
          ? <DateField {...shared} min={min} placeholder="Choose a date" />
          : <TimeField {...shared} placeholder="Choose a time" />}
      </div>
      {error && <p className="mt-1 px-1 text-xs font-medium text-danger-600">{error}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2.5 mt-6 flex items-center gap-2.5 first:mt-4">
      <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">{children}</p>
      <span className="h-px flex-1 bg-ink-100" aria-hidden="true" />
    </div>
  );
}

/** A two-way choice as a pair of pills — clearer at a glance than a select. */
function Toggle({
  label, options, value, onChange,
}: {
  label: string; options: [string, string]; value: string; onChange: (v: string) => void;
}) {
  const current = value || options[0];
  return (
    <div className={CELL}>
      <span className={LABEL}>{label}</span>
      <div className="mt-0.5 flex gap-1.5">
        {options.map((o) => (
          <button
            key={o} type="button" onClick={() => onChange(o)}
            className={`h-8 flex-1 rounded-full px-2 text-xs font-semibold transition-colors ${
              current === o ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-600 hover:bg-ink-100'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ==========================================================================
   Remembering the customer between visits
   ========================================================================== */

const CONTACT_KEY = 'gtt.enquiry.contact';

function loadContact(): Partial<Values> {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveContact(v: Values) {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify({
      name: v.name, email: v.email, mobile: v.mobile, whatsapp: v.whatsapp, sameNumber: v.sameNumber,
    }));
  } catch { /* private browsing */ }
}

/* ==========================================================================
   Field labels — also what the office reads in the requirement
   ========================================================================== */

const FIELD_LABEL: Record<FieldKey, string> = {
  pickup: 'Pickup address',
  drop: 'Drop address',
  date: 'Journey date',
  time: 'Journey time',
  returnDate: 'Return date',
  endDate: 'Last day',
  carType: 'Car type',
  passengers: 'Passengers',
  vehicles: 'Vehicles needed',
  direction: 'Which way',
  airport: 'Airport',
  flightNo: 'Flight number',
  hourlyPlan: 'Package',
  darshanPlan: 'How long',
  tripLeg: 'Trip',
  company: 'Company name',
  requirement: 'What you need',
  eventType: 'Kind of event',
  venue: 'Venue',
  functions: 'Functions',
};

/** Fields the API stores in a column of their own; the rest become the note. */
const HAS_OWN_COLUMN: FieldKey[] = ['pickup', 'drop', 'date', 'time', 'carType', 'passengers'];

/** Read better side by side on a wide screen. */
const PAIRED: FieldKey[] = ['date', 'time', 'returnDate', 'endDate', 'passengers', 'vehicles'];

const DEFAULT_FIELDS: FieldKey[] = ['pickup', 'drop', 'date', 'time', 'carType', 'passengers'];

/* ==========================================================================
   The form
   ========================================================================== */

const CHANNEL_COPY: Record<EnquiryChannel, { title: string; blurb: string; cta: string }> = {
  whatsapp: {
    title: 'Message us on WhatsApp',
    blurb: 'A few details first, so we come back with a real rate instead of asking the same questions in the chat.',
    cta: 'Send and open WhatsApp',
  },
  email: {
    title: 'Send your requirement',
    blurb: 'Tell us the trip and we will come back with a rate. It takes about thirty seconds.',
    cta: 'Send my enquiry',
  },
};

interface Sent {
  tripId: string;
  whatsappLink: string;
  openedWhatsApp: boolean;
  name: string;
  email: string;
  route: string;
  when: string;
  vehicle: string;
}

export function EnquiryForm({
  channel = 'email', category, prefill, onDone, onBusy, variant = 'sheet',
}: {
  channel?: EnquiryChannel;
  /** Which door they came through. Decides the questions. */
  category?: NeedKey;
  prefill?: EnquiryPrefill;
  onDone?: (tripId: string) => void;
  /** The sheet's pinned footer owns the button, so it is told when to spin. */
  onBusy?: (busy: boolean) => void;
  /** 'page' draws its own actions; 'sheet' leaves them to the pinned footer. */
  variant?: 'sheet' | 'page';
}) {
  const cat = category ? CATEGORIES[category] : null;
  const copy = CHANNEL_COPY[channel];

  /*
   * The sheet is opened on one channel and ends in one button, so when that
   * button is "Send my enquiry" the address is marked required up front. The
   * page shows Send, WhatsApp and Call together and cannot know which is
   * coming, so it carries a hint instead and the rule lands on submit.
   */
  const emailRequired = variant === 'sheet' && channel === 'email';

  const [v, setV] = useState<Values>(() => ({
    ...BLANK,
    ...loadContact(),
    message: prefill?.message ?? '',
    fields: {
      pickup: prefill?.pickup ?? '',
      drop: prefill?.drop ?? '',
      date: prefill?.date ?? '',
      time: prefill?.time ?? '',
      carType: prefill?.vehicleType ?? '',
      passengers: prefill?.passengers ? String(prefill.passengers) : '',
    },
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [sent, setSent] = useState<Sent | null>(null);

  /** Which way this particular submit is going out. */
  const outgoing = useRef<EnquiryChannel>(channel);
  /** The WhatsApp tab, opened on the tap so the browser trusts it. */
  const pending = useRef<Window | null>(null);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV((prev) => ({ ...prev, [k]: value }));
    setErrors((e) => (e[k as string] ? { ...e, [k as string]: '' } : e));
  };

  // Coordinates for the two ends, when a suggestion was picked rather than
  // typed. The distance works either way; this only makes it exact.
  const [pickupPt, setPickupPt] = useState<PlacePick | null>(null);
  const [dropPt, setDropPt] = useState<PlacePick | null>(null);

  const setField = (k: FieldKey, value: string) => {
    setV((prev) => ({ ...prev, fields: { ...prev.fields, [k]: value } }));
    setErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  };

  const f = (k: FieldKey) => v.fields[k] ?? '';
  const fields = cat?.fields ?? DEFAULT_FIELDS;
  const required = cat?.required ?? (['pickup'] as FieldKey[]);

  const route = useRouteDistance(
    { text: f('pickup'), lat: pickupPt?.lat, lon: pickupPt?.lon },
    { text: f('drop'), lat: dropPt?.lat, lon: dropPt?.lon },
  );

  /* ---------------------------------------------------------------- validate */
  /**
   * `how` matters for exactly one field. An email enquiry is answered by
   * email, so the address is required on that route; on the WhatsApp route the
   * chat is the reply channel and the address stays optional.
   */
  function validate(how: EnquiryChannel): boolean {
    const e: Record<string, string> = {};
    const email = v.email.trim();
    if (v.name.trim().length < 2) e.name = 'Please tell us your name.';
    if (!validMobile(v.mobile)) e.mobile = 'Enter a 10-digit mobile number.';
    if (!v.sameNumber && !validMobile(v.whatsapp)) {
      e.whatsapp = 'Enter your WhatsApp number, or tick that it is the same.';
    }
    if (how === 'email' && !email) {
      e.email = 'We need your email address - that is where the reply and your Trip ID go.';
    } else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      e.email = 'That email address does not look right.';
    }
    for (const k of required) {
      if (!f(k).trim()) e[k] = `${FIELD_LABEL[k]} is needed.`;
    }

    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      document.querySelector<HTMLElement>(`[data-field="${first}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return Object.keys(e).length === 0;
  }

  /**
   * Everything the category asked that has no column of its own, written out
   * for the office in the order it was asked, with the customer's note last.
   */
  function requirementNote(): string {
    const lines = fields
      .filter((k) => !HAS_OWN_COLUMN.includes(k) && f(k).trim())
      .map((k) => `${FIELD_LABEL[k]}: ${f(k).trim()}`);
    if (v.message.trim()) lines.push(v.message.trim());
    return lines.join('\n');
  }

  /* -------------------------------------------------------------- submitting */
  async function send(how: EnquiryChannel) {
    if (busy) return;
    outgoing.current = how;
    if (!validate(how)) {
      pending.current?.close();
      pending.current = null;
      return;
    }

    setBusy(true);
    onBusy?.(true);
    setFailed('');
    try {
      const { data } = await api.post('/public/whatsapp-enquiry', {
        name: v.name.trim(),
        mobile: cleanMobile(v.mobile),
        whatsappMobile: v.sameNumber ? '' : cleanMobile(v.whatsapp),
        sameAsContact: v.sameNumber,
        email: v.email.trim(),
        // A wedding or an event has a venue rather than a pickup, and the API
        // needs somewhere for the car to go.
        pickup: f('pickup').trim() || f('venue').trim() || 'To be confirmed',
        dropOff: f('drop').trim(),
        travelDate: f('date'),
        travelTime: f('time'),
        vehicleType: f('carType'),
        passengers: Number(f('passengers')) || 0,
        message: requirementNote(),
        category: cat?.label ?? '',
        tripType: cat?.tripType ?? 'LOCAL',
        // So the office's source filter tells the two buttons apart.
        source: how === 'whatsapp' ? 'WHATSAPP' : 'EMAIL',
      });

      saveContact(v);
      const link = `https://wa.me/91${COMPANY.whatsapp}?text=${encodeURIComponent(data.whatsappText)}`;

      rememberTrip({
        tripId: data.tripId,
        from: f('pickup').trim() || f('venue').trim(),
        to: f('drop').trim(),
        date: f('date'),
        time: f('time'),
        vehicleName: f('carType'),
        name: v.name.trim(),
        mobile: cleanMobile(v.mobile),
        email: v.email.trim(),
        channel: how === 'whatsapp' ? 'WhatsApp' : 'Website',
      });

      const win = pending.current;
      if (how === 'whatsapp' && win && !win.closed) win.location.href = link;
      pending.current = null;

      setSent({
        tripId: data.tripId,
        whatsappLink: link,
        openedWhatsApp: how === 'whatsapp' && !!win && !win.closed,
        name: v.name.trim(),
        email: v.email.trim(),
        route: [f('pickup').trim() || f('venue').trim(), f('drop').trim()].filter(Boolean).join('  →  '),
        when: [f('date') ? dmy(f('date')) : '', f('time')].filter(Boolean).join(' · '),
        vehicle: f('carType'),
      });
      onDone?.(data.tripId);
    } catch (err) {
      pending.current?.close();
      pending.current = null;
      setFailed(errorMessage(err, 'We could not save that just now.'));
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  /**
   * The one entry point for both buttons.
   *
   * WhatsApp's tab has to be opened INSIDE the tap. A browser only trusts
   * window.open while a real gesture is still on the stack, and by the time the
   * enquiry is saved and the Trip ID is back that gesture is long gone - so the
   * tab is opened blank here and pointed at wa.me in `send`.
   *
   * This used to live only on the page's WhatsApp button. The sheet submitted
   * through the form element instead, which opened nothing, so "Send and open
   * WhatsApp" recorded the enquiry and then simply sat there. Both routes come
   * through here now; there is no second path left to drift.
   */
  function submit(how: EnquiryChannel) {
    if (busy) return;
    if (how === 'whatsapp' && !pending.current) pending.current = window.open('', '_blank');
    void send(how);
  }

  if (sent) return <ThankYou {...sent} channel={outgoing.current} />;

  /* ------------------------------------------------------------- rendering */
  const renderField = (k: FieldKey): ReactNode => {
    const err = errors[k];
    const req = required.includes(k);

    switch (k) {
      case 'pickup':
      case 'drop':
      case 'venue':
        return (
          <>
            <PlaceInput
              label={FIELD_LABEL[k]} variant="soft" value={f(k)}
              onChange={(x) => setField(k, x)}
              onPick={k === 'pickup' ? setPickupPt : k === 'drop' ? setDropPt : undefined}
              placeholder={
                k === 'pickup' ? 'Where should the car come?'
                  : k === 'drop' ? 'Where are you going?'
                    : 'Where is it happening?'
              }
              cellClass={err ? 'ring-danger-300' : ''}
            />
            {err && <p className="mt-1 px-1 text-xs font-medium text-danger-600">{err}</p>}
            {/* Under the drop, so it reads as the answer to "how far is it?" */}
            {k === 'drop' && <DistanceNote info={route} className="mt-2 px-1" />}
          </>
        );

      case 'date':
      case 'returnDate':
      case 'endDate':
        return (
          <PickerField
            label={FIELD_LABEL[k]} icon={<IconCalendar className="h-3 w-3" />}
            type="date" value={f(k)} min={todayIso()} error={err}
            onChange={(x) => setField(k, x)}
          />
        );

      case 'time':
        return (
          <PickerField
            label={FIELD_LABEL[k]} icon={<IconClock className="h-3 w-3" />}
            type="time" value={f(k)} error={err}
            onChange={(x) => setField(k, x)}
          />
        );

      case 'carType':
        return (
          <Field label={FIELD_LABEL[k]} icon={<IconSteering className="h-3 w-3" />} error={err}>
            <select className={`${INPUT} cursor-pointer`} value={f(k)} onChange={(e) => setField(k, e.target.value)}>
              <option value="">Recommend one for me</option>
              {VEHICLES.map((x) => <option key={x.slug} value={x.name}>{x.name}</option>)}
            </select>
          </Field>
        );

      case 'passengers':
      case 'vehicles':
        return (
          <Field label={FIELD_LABEL[k]} icon={<IconUsers className="h-3 w-3" />} error={err} required={req}>
            <input
              className={INPUT} value={f(k)} inputMode="numeric" maxLength={3}
              onChange={(e) => setField(k, e.target.value.replace(/\D/g, ''))}
              placeholder={k === 'vehicles' ? 'How many cars?' : 'How many people?'}
            />
          </Field>
        );

      case 'direction':
        return (
          <Toggle
            label={FIELD_LABEL[k]} options={['To the airport', 'From the airport']}
            value={f(k)} onChange={(x) => setField(k, x)}
          />
        );

      case 'tripLeg':
        return (
          <Toggle
            label={FIELD_LABEL[k]} options={['One way', 'Round trip']}
            value={f(k)} onChange={(x) => setField(k, x)}
          />
        );

      case 'airport':
      case 'hourlyPlan':
      case 'darshanPlan':
      case 'requirement':
      case 'eventType': {
        const choices =
          k === 'airport' ? AIRPORTS
            : k === 'hourlyPlan' ? HOURLY_PLANS
              : k === 'darshanPlan' ? DARSHAN_PLANS
                : k === 'requirement' ? CORPORATE_NEEDS
                  : EVENT_TYPES;
        return (
          <Field
            label={FIELD_LABEL[k]}
            icon={k === 'airport' ? <IconPlane className="h-3 w-3" /> : undefined}
            error={err} required={req}
          >
            <select className={`${INPUT} cursor-pointer`} value={f(k)} onChange={(e) => setField(k, e.target.value)}>
              <option value="">Choose one</option>
              {choices.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        );
      }

      case 'flightNo':
      case 'company':
      case 'functions':
        return (
          <Field label={FIELD_LABEL[k]} error={err} required={req}>
            <input
              className={INPUT} value={f(k)}
              onChange={(e) => setField(k, e.target.value)}
              placeholder={
                k === 'flightNo' ? 'e.g. AI 641'
                  : k === 'company' ? 'Registered company name'
                    : 'e.g. Haldi, Sangeet, Reception'
              }
            />
          </Field>
        );

      default:
        return null;
    }
  };

  return (
    <form
      id="enquiry-form"
      onSubmit={(e) => { e.preventDefault(); submit(channel); }}
      noValidate
      className="animate-fade-up"
    >
      {variant === 'sheet' && (
        <p className="text-sm leading-relaxed text-ink-500">{cat?.blurb ?? copy.blurb}</p>
      )}

      {/* ------------------------------ about you ------------------------------ */}
      <SectionTitle>About you</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div data-field="name">
          <Field label="Your name" icon={<IconUsers className="h-3 w-3" />} error={errors.name} required>
            <input
              className={INPUT} value={v.name} autoComplete="name" autoCapitalize="words"
              onChange={(e) => set('name', e.target.value)} placeholder="Full name"
            />
          </Field>
        </div>

        <div data-field="mobile">
          <Field label="Contact number" icon={<IconPhone className="h-3 w-3" />} error={errors.mobile} required>
            <input
              className={INPUT} value={v.mobile} type="tel" inputMode="numeric"
              autoComplete="tel" maxLength={13}
              onChange={(e) => set('mobile', e.target.value)} placeholder="10-digit mobile"
            />
          </Field>
        </div>

        <div data-field="email" className="sm:col-span-2">
          <Field
            label="Email ID" icon={<IconMail className="h-3 w-3" />} error={errors.email}
            required={emailRequired}
            hint={emailRequired
              ? 'Your reply, Trip ID and invoice are sent here'
              : 'Needed to send this by email - your Trip ID and invoice go there'}
          >
            <input
              className={INPUT} value={v.email} type="email" inputMode="email"
              autoComplete="email" autoCapitalize="off"
              onChange={(e) => set('email', e.target.value)} placeholder="you@example.com"
            />
          </Field>
        </div>
      </div>

      {/* When the tick is on the WhatsApp field is gone rather than greyed out —
          a disabled box echoing the number above is one more thing to read. */}
      <label className="mt-2.5 flex cursor-pointer items-start gap-3 rounded-2xl bg-ink-50/80 px-3.5 py-3 text-sm leading-snug text-ink-700 transition-colors hover:bg-ink-100/70">
        <input
          type="checkbox" checked={v.sameNumber}
          onChange={(e) => set('sameNumber', e.target.checked)}
          className="mt-0.5 h-[18px] w-[18px] shrink-0 rounded border-ink-300 text-brand-600 focus:ring-brand-400"
        />
        <span>My WhatsApp number is the same as my contact number</span>
      </label>

      {!v.sameNumber && (
        <div data-field="whatsapp" className="mt-2.5 animate-fade-up">
          <Field label="WhatsApp number" icon={<IconWhatsApp className="h-3 w-3" />} error={errors.whatsapp} required>
            <input
              className={INPUT} value={v.whatsapp} type="tel" inputMode="numeric" maxLength={13} autoFocus
              onChange={(e) => set('whatsapp', e.target.value)} placeholder="10-digit WhatsApp number"
            />
          </Field>
        </div>
      )}

      {/* ------------------------- what this category needs -------------------- */}
      <SectionTitle>{cat ? cat.label : 'Your journey'}</SectionTitle>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {fields.map((k) => {
          const node = renderField(k);
          if (!node) return null;
          return (
            <div key={k} data-field={k} className={PAIRED.includes(k) ? '' : 'sm:col-span-2'}>
              {node}
            </div>
          );
        })}
      </div>

      <SectionTitle>Anything else</SectionTitle>
      <div className={CELL}>
        <label className={LABEL}>Notes for the desk</label>
        <textarea
          // Tall enough that the longer category hints are not cut in half on
          // a narrow phone, where they wrap to three lines.
          className={`${INPUT} h-auto min-h-[4.75rem] resize-y py-0.5 sm:min-h-[3.5rem]`}
          value={v.message} rows={3} maxLength={1000}
          onChange={(e) => set('message', e.target.value)}
          placeholder={cat?.notesHint ?? 'Flight number, luggage, a stop on the way, a return leg…'}
        />
      </div>

      {failed && (
        <p className="animate-fade-up mt-3 rounded-2xl bg-danger-50 px-4 py-3 text-sm leading-relaxed text-danger-700">
          {failed}{' '}
          <a
            href={whatsappLink(v.message || undefined)} target="_blank" rel="noreferrer"
            className="font-semibold underline"
          >
            Message us on WhatsApp instead
          </a>{' '}
          — we will take the details in the chat.
        </p>
      )}

      {/* On a page the actions live here; in the sheet they are in the pinned
          footer so they stay reachable above the keyboard. */}
      {variant === 'page' ? (
        <PageActions busy={busy} onSend={() => submit('email')} onWhatsApp={() => submit('whatsapp')} />
      ) : (
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">{copy.cta}</button>
      )}
    </form>
  );
}

/* ==========================================================================
   Actions
   ========================================================================== */

/**
 * Enquiry, WhatsApp and Call, shown together once the category form is filled.
 *
 * Call is an anchor, not a submit: it dials immediately and never waits on the
 * form or on the network.
 */
function PageActions({
  busy, onSend, onWhatsApp,
}: {
  busy: boolean; onSend: () => void; onWhatsApp: () => void;
}) {
  return (
    <div className="mt-7 border-t border-ink-100 pt-5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <button
          type="button" onClick={onSend} disabled={busy}
          className="grad-brand btn h-12 rounded-full text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99] disabled:opacity-70"
        >
          {busy
            ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            : <IconMail className="h-4 w-4" />}
          {busy ? 'Sending…' : 'Send enquiry'}
        </button>

        <button
          type="button" onClick={onWhatsApp} disabled={busy}
          className="btn h-12 rounded-full bg-[#25D366] text-md font-semibold text-white shadow-lg shadow-[#25D366]/25 transition-[filter,transform] hover:brightness-105 active:scale-[.99] disabled:opacity-70"
        >
          <IconWhatsApp className="h-4 w-4" /> WhatsApp
        </button>

        <a
          href={`tel:+91${COMPANY.mobile}`}
          aria-label="Call the office"
          className="btn h-12 rounded-full bg-ink-900 text-md font-semibold text-white transition-colors hover:bg-ink-800"
        >
          <IconPhone className="h-4 w-4" /> Call now
        </a>
      </div>
      <p className="mt-3 text-center text-xs leading-relaxed text-ink-400">
        Nothing is charged. Send or WhatsApp and you get a Trip ID you can quote any time —
        or just tap Call and skip the form entirely.
      </p>
    </div>
  );
}

/** The pinned footer button, rendered by the sheet outside the scroll area. */
function SubmitBar({ channel, busy }: { channel: EnquiryChannel; busy: boolean }) {
  const copy = CHANNEL_COPY[channel];
  const tone = channel === 'whatsapp'
    ? 'bg-[#25D366] shadow-[#25D366]/25 hover:brightness-105'
    : 'grad-brand shadow-brand-500/25 hover:brightness-[1.06]';

  return (
    <>
      <button
        type="submit" form="enquiry-form" disabled={busy}
        className={`btn h-12 w-full rounded-full text-md font-semibold text-white shadow-lg transition-[filter,transform] active:scale-[.99] disabled:opacity-70 ${tone}`}
      >
        {busy
          ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Saving your enquiry…</>
          : <>{channel === 'whatsapp' && <IconWhatsApp className="h-4 w-4" />}{copy.cta}</>}
      </button>
      <p className="mt-2 text-center text-xs text-ink-400">
        Nothing is charged. You get a Trip ID you can quote any time.
      </p>
    </>
  );
}

/* ==========================================================================
   Thank you
   ========================================================================== */

function ThankYou({
  channel, tripId, whatsappLink: waLink, openedWhatsApp, name, email, route, when, vehicle,
}: Sent & { channel: EnquiryChannel }) {
  const firstName = name.split(' ')[0] || 'there';
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tripId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Refused in some in-app browsers. The ID is on screen and in the email
      // either way, so this is not worth an error.
      setCopied(false);
    }
  };

  return (
    <div className="animate-fade-up py-1 text-center">
      <span className="mx-auto grid h-16 w-16 animate-pop-in place-items-center rounded-full bg-ok-50">
        <svg
          viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#0F7B52" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="m4.5 12.5 5 5 10-11" strokeDasharray="32" className="animate-check-draw" />
        </svg>
      </span>

      <h3 className="mt-4 font-display text-xl font-extrabold tracking-[-0.02em] text-ink-900 sm:text-2xl">
        Thank you, {firstName}.
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-500">
        Your enquiry is with our desk. We answer round the clock and come back with a rate,
        usually within the hour.
      </p>

      <button
        type="button" onClick={copy} title="Copy the Trip ID"
        className="group mx-auto mt-5 flex animate-pop-in flex-col items-center rounded-2xl bg-brand-50 px-7 py-3.5 ring-1 ring-inset ring-brand-100 transition-colors hover:bg-brand-100/70"
      >
        <span className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-500">Your Trip ID</span>
        <span className="mt-0.5 flex items-center gap-2 font-mono text-xl font-bold tracking-tight text-brand-700">
          {tripId}
          {copied
            ? <IconCheck className="h-4 w-4 text-ok-600" />
            : <IconDuplicate className="h-4 w-4 text-brand-300 transition-colors group-hover:text-brand-600" />}
        </span>
        <span className="mt-0.5 text-2xs text-ink-400">{copied ? 'Copied' : 'Tap to copy'}</span>
      </button>

      {(route || when || vehicle) && (
        <dl className="mx-auto mt-5 max-w-sm space-y-2 rounded-2xl bg-ink-50/70 px-4 py-3.5 text-left">
          {route && <SummaryRow icon={<IconPin className="h-3.5 w-3.5" />} value={route} />}
          {when && <SummaryRow icon={<IconCalendar className="h-3.5 w-3.5" />} value={when} />}
          {vehicle && <SummaryRow icon={<IconSteering className="h-3.5 w-3.5" />} value={vehicle} />}
        </dl>
      )}

      <div className="mt-6 space-y-2.5">
        {channel === 'whatsapp' ? (
          <>
            <p className="text-sm leading-relaxed text-ink-600">
              {openedWhatsApp
                ? 'WhatsApp is opening with your trip details and Trip ID already written out — all you do is press send.'
                : 'Tap below to open WhatsApp. Your trip details and Trip ID are already written out — all you do is press send.'}
            </p>
            <a
              href={waLink} target="_blank" rel="noreferrer"
              className={`btn h-12 w-full rounded-full bg-[#25D366] text-md font-semibold text-white shadow-lg shadow-[#25D366]/25 transition-[filter,transform] hover:brightness-105 active:scale-[.99] ${
                openedWhatsApp ? '' : 'animate-pop-in ring-2 ring-[#25D366]/30 ring-offset-2'
              }`}
            >
              <IconWhatsApp className="h-4 w-4" /> {openedWhatsApp ? 'Continue on WhatsApp' : 'Open WhatsApp'}
            </a>
            <CallButton
              className="btn h-11 w-full rounded-full bg-ink-50 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-100"
              iconClass="h-3.5 w-3.5"
              label="Rather call?"
            />
          </>
        ) : (
          <>
            <a
              href={waLink} target="_blank" rel="noreferrer"
              className="btn h-12 w-full rounded-full bg-[#25D366] text-md font-semibold text-white shadow-lg shadow-[#25D366]/25 transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
            >
              <IconWhatsApp className="h-4 w-4" /> Continue on WhatsApp
            </a>
            <CallButton
              className="btn h-12 w-full rounded-full bg-ink-900 text-md font-semibold text-white transition-colors hover:bg-ink-800"
              label="Call now"
            />
          </>
        )}
      </div>

      <p className="mt-5 flex flex-wrap items-center justify-center gap-1.5 border-t border-ink-100 pt-4 text-xs leading-relaxed text-ink-400">
        <IconCheck className="h-3.5 w-3.5 shrink-0 text-ok-500" />
        {email
          ? <>A copy is on its way to <span className="font-semibold text-ink-600">{email}</span>.</>
          : <>Saved to our office — quote the Trip ID any time.</>}
      </p>

      <Link
        to="/trips"
        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800"
      >
        See it under My trips <IconArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

function SummaryRow({ icon, value }: { icon: ReactNode; value: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-ink-700">
      <span className="mt-0.5 shrink-0 text-ink-400">{icon}</span>
      <span className="min-w-0 font-medium leading-snug">{value}</span>
    </div>
  );
}

/* ==========================================================================
   The sheet, and the buttons that open it
   ========================================================================== */

export function EnquirySheet({
  open, onClose, channel = 'email', category, prefill,
}: {
  open: boolean; onClose: () => void;
  channel?: EnquiryChannel;
  category?: NeedKey;
  prefill?: EnquiryPrefill;
}) {
  // Reset the form every time the sheet is reopened, so a second enquiry does
  // not start on the previous one's thank-you.
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) { setNonce((n) => n + 1); setSent(false); setBusy(false); }
    wasOpen.current = open;
  }, [open]);

  const cat = category ? CATEGORIES[category] : null;
  const title = sent ? 'Enquiry received' : (cat?.title ?? CHANNEL_COPY[channel].title);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      footer={sent ? undefined : <SubmitBar channel={channel} busy={busy} />}
    >
      <EnquiryForm
        key={nonce}
        channel={channel}
        category={category}
        prefill={prefill}
        onBusy={setBusy}
        onDone={() => setSent(true)}
      />
    </BottomSheet>
  );
}

/**
 * The button the rest of the site uses.
 *
 * Drop-in for the old `<a href={whatsappLink()}>` and for the "Enquire" link
 * that used to navigate to the multi-step form: same look, same place on the
 * page, but the sheet opens with whatever the screen already knows filled in.
 */
export function EnquiryButton({
  channel = 'email', category, message, prefill, className = '', children, label = 'Enquire',
}: {
  channel?: EnquiryChannel;
  category?: NeedKey;
  message?: string;
  prefill?: EnquiryPrefill;
  className?: string;
  children?: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || 'btn h-12 rounded-full bg-ink-900 px-6 text-md font-semibold text-white transition-colors hover:bg-ink-800'}
      >
        {children ?? label}
      </button>

      <EnquirySheet
        open={open}
        onClose={() => setOpen(false)}
        channel={channel}
        category={category}
        prefill={{ ...prefill, message: prefill?.message ?? message }}
      />
    </>
  );
}

/** WhatsApp and Enquire are the same button with the channel preset. */
export function WhatsAppButton(props: Omit<Parameters<typeof EnquiryButton>[0], 'channel'>) {
  return <EnquiryButton {...props} channel="whatsapp" label={props.label ?? 'WhatsApp'} />;
}
