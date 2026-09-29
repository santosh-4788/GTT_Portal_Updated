import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, whatsappLink } from './siteData';
import { IconWhatsApp } from './SiteIcons';
import {
  OPENING_SUGGESTIONS, ENQUIRY_LINK, findAnswer, pleasantry, outOfScope, outOfScopeReply, tokenise, topicById,
  type LiveData, type Topic,
} from './assistantKnowledge';
import { api, errorMessage } from '../lib/api';
import { useRates } from './kit';
import { rememberTrip } from './tripStore';
import { dmy } from '../lib/format';
import {
  EDITABLE, HOURLY as HOURLY_PKG, acknowledge, answer as answerStep, bookingIntent, inputFor, nextStep, prompt as promptFor,
  requestBody, summaryRows, vehicleOptions, type Draft, type Kind, type Step, type VehicleOption,
} from './assistantBooking';
import { LANGUAGE_HINT, label as tl, normalise, t, type Lang, type TextKey } from './assistantLang';
import { templateFor, understand, useChatbotKnowledge, type Entities, type Intent } from './assistantNlu';
import { MENU, chipLabel, fill, r, type ReplyKey } from './assistantReplies';
import {
  CATEGORY_META, CATEGORY_VEHICLES, fareCategoryOf, fareOf, rupees, routeLabel, useOutstationRoutes,
  type FareCategory, type Leg, type OutstationRoute,
} from './outstation';
import { VEHICLES } from './catalog';
import { AIRPORTS, AIRPORT_FROM, AIRPORT_TO } from './enquiryCategories';
import {
  BUDGET_CHIPS, CHANGE_CHIPS, TYPE_CHIPS, draftFromPlan, nextPlanStep, placeCard, planIntent, planPrompt,
  planText, readPlan, suggest, type Plan, type PlanStep,
} from './assistantPlanner';
import { DESTINATIONS } from './places';
import { IconClose, IconPhone, IconArrowRight, IconCheck } from '../components/icons';
import { useBackToClose } from '../lib/useBackToClose';

/* ==========================================================================
   Site assistant.

   Answers the questions the phone gets asked twenty times a week, so a visitor
   at 1am gets a reply instead of a voicemail. When it cannot answer, it takes a
   name and number and drops a real enquiry into the portal rather than
   pretending — see assistantKnowledge.ts for why it is a retriever and not a
   language model.

   Every message is first understood (assistantNlu.ts: language, intent,
   entities such as the route, one way / return, passengers, a Trip ID), then
   read against what the conversation is already about - "Return ka?" after a
   Pune fare is the Pune return fare - and only then answered, from the
   portal's live data (assistantReplies.ts holds the words, in five forms).

   Nothing here calls an external service or an AI model — it costs nothing to
   run. That includes languages: Hindi and Marathi (in Devanagari or typed in
   Roman letters, mixed with English or not) are understood and answered by
   the rules in assistantLang.ts, not by a translation API. The only network requests it makes are to this portal's own API:
   /api/public/outstation-fares (read, so outstation answers quote the fares the
   office has actually set) and /api/public/enquiry (the callback form, the same
   endpoint the contact form uses).
   ========================================================================== */

/** A tappable follow-up. Carrying the topic id means a suggestion resolves to
 *  the answer it names rather than being re-matched as if the visitor had typed
 *  it — a chip must never come back with "I am not certain which one you mean". */
interface Chip {
  label: string;
  /** What the tap answers with, when the words on the chip are translated. */
  value?: string;
  topicId?: string;
  /** A booking action rather than a question: confirm, modify, cancel, edit:<step>. */
  act?: string;
}

/** What the booking conversation shows beyond plain text. */
interface Confirmed {
  tripId: string;
  selfLink: string;
  officeLink: string;
  emailedTo: string;
}

/** What the assistant understood of a customer line - saved with the chat record. */
interface Nlu {
  lang: string;
  /** An intent code, or FAQ / TRIP_PLANNER when those answered it. */
  intent: Intent | 'FAQ' | 'TRIP_PLANNER';
  confidence: number;
  entities: Record<string, string | number | undefined>;
}

/** The thread of the conversation: what it is about and what was just asked. */
interface Ctx {
  intent?: Intent;
  route?: OutstationRoute;
  place?: string;
  leg?: Leg;
  kind?: Kind;
  pax?: number;
  date?: string;
  time?: string;
  hours?: number;
  tripId?: string;
  statusFor?: Intent;
  /** The question the last reply asked, which the next message may answer. */
  pending?: 'routeLeg' | 'bookOffer' | 'serviceOffer' | 'statusId' | 'statusDigits';
}

/** What goes in the "service" of a callback request, so the office can sort them. */
type LeadKind = 'Website assistant' | 'Complaint' | 'Suggestion' | 'Feedback link not received';

/** The parts of /public/track the chat reads back. */
interface TrackedTrip {
  tripId: string; status: string; statusLabel?: string; travelDate?: string; journeyTime?: string;
  pickup?: string; drop?: string; vehicleType?: string; vehicleNumber?: string; driverName?: string; driverMobile?: string;
}

/*
 * Intents the rules place from a word or two ("vehicle", "seats", "pickup").
 * A written FAQ that matches the whole question better wins over them - "are
 * child seats available" is the child-seat answer, not the seating chart.
 */
const SOFT_INTENTS = new Set<Intent>([
  'VEHICLE_INFORMATION', 'VEHICLE_CAPACITY', 'SERVICE_INFORMATION', 'CONTACT_SUPPORT', 'HELP', 'PICKUP_INFORMATION',
  'DROP_INFORMATION', 'DATE_SELECTION', 'TIME_SELECTION', 'BOOKING_CREATE',
]);
/** Words too common to show that a FAQ is about what was asked. */
const COMMON_STEMS = new Set(['vehicle', 'available', 'book', 'seat', 'rate', 'trip', 'time', 'phone', 'provide', 'have', 'need', 'ok']);
/** FAQ topics that only restate what the intent's own answer says. */
const GENERIC_TOPICS = new Set(['fleet', 'seats', 'contact', 'calculator', 'inclusions', 'routes']);
const GENERIC_TITLES = new Set(['How do I book a vehicle?', 'What do you charge?', 'Which areas do you cover?', 'Do you run at night and on Sundays?']);

interface Line {
  id: number;
  from: 'bot' | 'user';
  text: string;
  nlu?: Nlu;
  /** WhatsApp, opened with the text already written: to anyone, or to the office. */
  wa?: { self: string; office: string };
  chips?: Chip[];
  link?: { label: string; to: string };
  also?: { label: string; to: string };
  /** Vehicle cards to choose from. */
  vehicles?: VehicleOption[];
  /** Destination suggestions from the trip planner. */
  places?: ReturnType<typeof placeCard>[];
  /** The booking summary, row by row. */
  summary?: [string, string][];
  confirmed?: Confirmed;
}

const asChips = (labels: string[]): Chip[] => labels.map((label) => ({ label }));
const topicChips = (topics: Topic[]): Chip[] => topics.map((t) => ({ label: t.title, topicId: t.id }));

/** The opening menu, before the customer's language is known. */
const MENU_EN = (): Chip[] => MENU.map((m) => ({ label: m.label, value: m.value, act: m.act }));

const GREETING =
  `Hello. I can book a cab, help plan a trip, or answer questions about ${COMPANY.name} — rates, ` +
  `vehicles, routes and airport transfers. What would you like to do?\n\n` +
  `This chat is saved so our team can follow up on it.\n\n${LANGUAGE_HINT}`;

const newChatId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;

let nextId = 1;
const line = (from: Line['from'], text: string, extra: Partial<Line> = {}): Line =>
  ({ id: nextId++, from, text, ...extra });

export function Assistant() {
  const [open, setOpen] = useState(false);
  // On a phone, Back tucks the chat away rather than leaving the page.
  useBackToClose(open, () => setOpen(false));

  /* On a phone the launcher steps aside while the customer scrolls down the
     page, so it never sits on a price or a button, and comes back the moment
     they scroll up or stop near the top. */
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (window.innerWidth >= 1024 || y < 160) setTucked(false);
      else if (y > last + 6) setTucked(true);
      else if (y < last - 6) setTucked(false);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [lines, setLines] = useState<Line[]>([
    line('bot', GREETING, { chips: MENU_EN() }),
  ]);
  const [draftText, setDraft] = useState('');
  /* The customer's language. A ref as well as state: one message both sets it
     and gets answered in it, before React has re-rendered. */
  const [lang, setLangState] = useState<Lang>('en');
  const langRef = useRef<Lang>('en');
  const setLang = (l: Lang) => { langRef.current = l; setLangState(l); };
  const tt = (key: TextKey, vars?: Record<string, string | number>) => t(langRef.current, key, vars);
  /** A chip that answers in English and reads in the customer's language. */
  const chip = (value: string, extra: Partial<Chip> = {}): Chip => ({ label: tl(langRef.current, value), value, ...extra });
  const [handoff, setHandoff] = useState(false);
  const [lead, setLead] = useState({ name: '', mobile: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [leadError, setLeadError] = useState('');
  const [leadKind, setLeadKind] = useState<LeadKind>('Website assistant');

  // The live outstation fare list, so "how much to Pune" is answered from what
  // the office has set rather than from anything written into the code.
  const { routes, failed } = useOutstationRoutes();
  const live: LiveData = { routes, failed };
  const book = useRates();
  // The office's example questions and synonyms (Admin > Chatbot Knowledge).
  const kb = useChatbotKnowledge();

  /* The booking conversation. `step` is what the next message answers; null
     when the chat is answering questions rather than taking a booking. */
  const [draft, setDraftB] = useState<Draft | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [booking, setBooking] = useState(false);
  const bar = inputFor(step);

  /* The trip planner: what is known so far, and which question is open. */
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planAsk, setPlanAsk] = useState<PlanStep | 'change' | 'detail' | 'retype' | 'distance' | null>(null);

  /* The saved record of this conversation (see Admin > Chat history). Each
     line is sent once, in order; the server never overwrites one. */
  const [chatId, setChatId] = useState(newChatId);
  const sentUpTo = useRef(0);
  useEffect(() => {
    if (!lines.some((l) => l.from === 'user')) return;
    const fresh = lines.filter((l) => l.id > sentUpTo.current);
    if (!fresh.length) return;
    const t = setTimeout(() => {
      const top = fresh[fresh.length - 1].id;
      api.post(`/public/chat/${chatId}`, {
        messages: fresh.map((l) => ({
          seq: l.id,
          at: new Date().toISOString(),
          sender: l.from === 'user' ? 'customer' : 'assistant',
          text: l.text,
          data: (l.chips?.length || l.vehicles || l.places || l.summary || l.confirmed || l.nlu) ? {
            nlu: l.nlu,
            chips: l.chips?.map((c) => c.label),
            vehicles: l.vehicles?.map((o) => ({ slug: o.slug, name: o.name, price: o.price, basis: o.basis })),
            places: l.places?.map((pl) => pl.name),
            summary: l.summary,
            tripId: l.confirmed?.tripId,
          } : undefined,
        })),
        meta: {
          page: window.location.pathname,
          name: draft?.name, mobile: draft?.mobile, email: draft?.email,
          summary: draft ? { kind: draft.kind, route: draft.routeKey ?? draft.otherDestination, vehicle: draft.vehicleSlug, date: draft.date, pax: draft.pax } : plan ? { planning: true, days: plan.days, pax: plan.pax } : undefined,
        },
      }).then(() => { sentUpTo.current = Math.max(sentUpTo.current, top); }).catch(() => { /* retried with the next line */ });
    }, 600);
    return () => clearTimeout(t);
  }, [lines, chatId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // Keep the newest line in view, and start typing straight away on open.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [lines, handoff, sent]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };  // tuck away, keep the thread
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /** Is there a conversation worth coming back to? Drives the launcher dot. */
  const inProgress = lines.length > 1 || sent;

  /** Tuck it away and keep everything — the conversation is still there when
   *  the launcher is tapped again. */
  const minimise = () => setOpen(false);

  /** End it: put the panel away and start clean next time. */
  const closeAndClear = () => {
    setOpen(false);
    setLines([line('bot', GREETING, { chips: MENU_EN() })]);
    ctx.current = {};
    setLeadKind('Website assistant');
    setDraft('');
    setHandoff(false);
    setSent(false);
    setLeadError('');
    setDraftB(null);
    setStep(null);
    setPlan(null);
    setPlanAsk(null);
    setChatId(newChatId());
    setLang('en');
    sentUpTo.current = 0;
  };

  // The knowledge base is written in English; in Hindi or Marathi the answer
  // says so in one line rather than being machine-translated.
  const reply = (topic: Topic) =>
    setLines((l) => [...l, line('bot', `${tt('faq.note')}${topic.answer}`, { link: topic.link, also: topic.also })]);

  /* ------------------------------------------------------------ booking */
  const say = (text: string, extra: Partial<Line> = {}) => setLines((l) => [...l, line('bot', text, extra)]);

  /**
   * Ask for whatever the draft still needs, or show the summary. `lead` is
   * said first, in the same bubble - what the assistant understood.
   */
  const advance = (d: Draft, lead = '') => {
    const rs = routes ?? [];
    const lg = langRef.current;
    const pre = lead ? `${lead}\n\n` : '';
    setDraftB(d);
    const s = nextStep(d);
    setStep(s);
    if (s === 'vehicle') {
      let opts = vehicleOptions(d, rs, book);
      let none = '';
      if (!opts.length && d.family) {
        none = tt('noFamily', { fam: d.familyLabel ?? '' });
        opts = vehicleOptions({ ...d, family: undefined }, rs, book);
      }
      // A route fare is one-way or return, never both: say which is on show.
      const fares = d.kind === 'OUTSTATION' ? tt(d.leg === 'RETURN' ? 'fares.return' : 'fares.oneWay') : '';
      say(`${pre}${none}${tt('vehicles', { fam: d.family && !none ? `${d.familyLabel} ` : '', fares })}`,
        { vehicles: opts, chips: [chip('Cancel booking', { act: 'cancel' })] });
      return;
    }
    if (s === 'summary') {
      const opt = vehicleOptions(d, rs, book).find((o) => o.slug === d.vehicleSlug);
      setDraftB({ ...d, reviewed: true });
      say(`${pre}${tt('check')}`, {
        summary: summaryRows(d, rs, opt),
        chips: [
          chip('Confirm booking', { act: 'confirm' }),
          chip('Modify details', { act: 'modify' }),
          chip('Cancel', { act: 'cancel' }),
        ],
      });
      setLines((l) => [...l, line('bot', tt('sure'))]);
      return;
    }
    const q = promptFor(s, d, rs, lg);
    say(`${pre}${q.text}`, { chips: [...(q.chips ?? []).map((c) => chip(c)), chip('Cancel booking', { act: 'cancel' })] });
  };

  const cancelBooking = () => {
    setDraftB(null);
    setStep(null);
    say(tt('cancelled'), { chips: asChips(OPENING_SUGGESTIONS.slice(0, 3)) });
  };

  const pickVehicle = (o: VehicleOption) => {
    if (!draft) return;
    setLines((l) => [...l, line('user', o.name)]);
    advance({ ...draft, vehicleSlug: o.slug });
  };

  const confirm = async () => {
    if (!draft || booking) return;
    const rs = routes ?? [];
    const opt = vehicleOptions(draft, rs, book).find((o) => o.slug === draft.vehicleSlug);
    setLines((l) => [...l, line('user', tl(langRef.current, 'Confirm booking'))]);
    setBooking(true);
    try {
      const body = requestBody(draft, rs, opt, chatId);
      const { data } = await api.post('/public/whatsapp-enquiry', body);
      const rows = summaryRows(draft, rs, opt).filter(([k]) => !['Name', 'Mobile', 'Email'].includes(k));
      const self = [`${COMPANY.name} - booking`, `Trip ID: ${data.tripId}`, ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n');
      rememberTrip({
        tripId: data.tripId, from: body.pickup, to: body.dropOff, date: body.travelDate, time: body.travelTime,
        vehicleName: body.vehicleType, name: body.name, mobile: body.mobile, email: body.email, channel: 'Website assistant',
      });
      say(tt('confirmed', { id: data.tripId }), {
        confirmed: {
          tripId: data.tripId,
          selfLink: `https://wa.me/91${draft.mobile}?text=${encodeURIComponent(self)}`,
          officeLink: `https://wa.me/91${COMPANY.whatsapp}?text=${encodeURIComponent(data.whatsappText ?? self)}`,
          emailedTo: body.email && data.emailSent ? body.email : '',
        },
      });
      setDraftB(null);
      setStep(null);
    } catch (err) {
      say(tt('failed', { err: errorMessage(err, 'please try again.') }), {
        chips: [chip('Confirm booking', { act: 'confirm' }), chip('Modify details', { act: 'modify' })],
      });
    } finally {
      setBooking(false);
    }
  };

  const onChip = (c: Chip) => {
    if (!c.act) return ask(c.value ?? c.label, c.topicId, c.label);
    if (c.act === 'handoff') { setHandoff(true); return; }

    /* The menu and the follow-ups under an answer. */
    const said = () => setLines((l) => [...l, line('user', c.label)]);
    const [verb, a, b] = c.act.split(':');
    const rs = routes ?? [];
    if (verb === 'book') {
      said();
      if (a === 'route') { const rt = rs.find((x) => x.key === b); if (rt) bookRoute(rt, undefined, c.act.split(':')[3] as Leg); return; }
      if (a === 'other') { bookRoute(undefined, c.act.slice('book:other:'.length)); return; }
      startBooking(a === 'any' ? {} : { kind: a as Kind });
      return;
    }
    if (verb === 'fare') {
      said();
      if (a === 'LOCAL' || a === 'AIRPORT' || a === 'HOURLY') { localFareReply(a, ctx.current.hours); return; }
      const rt = rs.find((x) => x.key === a);
      if (rt) fareReply(rt, (b as Leg) || 'ONE_WAY');
      return;
    }
    if (verb === 'leg') {
      said();
      const k = ctx.current;
      if (a === 'fare') { fareFlow({}); return; }
      bookRoute(k.route, k.place, a as Leg);
      return;
    }
    if (verb === 'status') { said(); statusFlow('BOOKING_STATUS', {}); return; }
    if (verb === 'lead') { said(); openLead(c.act.slice(5) as LeadKind); return; }
    if (c.act.startsWith('plan:')) {
      const p = plan ?? EMPTY_PLAN;
      if (c.act === 'plan:accept') { setLines((l) => [...l, line('user', c.label)]); acceptPlan(p); return; }
      if (c.act === 'plan:more') { setLines((l) => [...l, line('user', c.label)]); showSuggestions({ ...p, current: undefined }); return; }
      if (c.act === 'plan:type') { setLines((l) => [...l, line('user', c.label)]); planOn({ ...p, themes: [], party: undefined, typeAsked: false }); return; }
      if (c.act === 'plan:change') {
        setLines((l) => [...l, line('user', c.label), line('bot', 'Sure - what would you like to change?', { chips: CHANGE_CHIPS.map((x) => ({ label: x, act: `plan:c:${x}` })) })]);
        setPlanAsk('change');
        return;
      }
      if (c.act.startsWith('plan:c:')) { planChange(c.act.slice(7)); return; }
    }
    if (c.act === 'cancel') return cancelBooking();
    if (c.act === 'confirm') return void confirm();
    if (c.act === 'modify') {
      const editable = EDITABLE.filter((e) => !draft || !e.when || e.when(draft));
      setLines((l) => [...l, line('user', c.label),
        line('bot', tt('modify'), { chips: editable.map((e) => chip(e.label, { act: `edit:${e.step}` })) })]);
      return;
    }
    if (c.act.startsWith('edit:') && draft) {
      const e = EDITABLE.find((x) => `edit:${x.step}` === c.act);
      if (e) { setLines((l) => [...l, line('user', c.label)]); advance(e.clear(draft)); }
    }
  };

  /* ------------------------------------------------------------ planner */
  const EMPTY_PLAN: Plan = { themes: [], rejected: [], shown: [] };

  const showSuggestions = (p: Plan, lead = '') => {
    const picks = suggest(p, book);
    if (!picks.length) {
      setPlan(p);
      setPlanAsk('retype');
      say(`${lead}I have no more places on our list that match that. I don't have confirmed information beyond these - I can connect you with our team to suggest something.`,
        { chips: [{ label: 'Change type of trip', act: 'plan:type' }, { label: 'Talk to our team', act: 'handoff' }] });
      return;
    }
    const next = { ...p, shown: [...new Set([...p.shown, ...picks.map((d) => d.slug)])] };
    setPlan(next);
    setPlanAsk('detail');
    say(`${lead}For ${next.days} ${next.days === 1 ? 'day' : 'days'}${next.pax ? ` with ${next.pax} people` : ''}, these would suit you. Tap one to see the plan:`, {
      places: picks.map((d) => placeCard(d, next, book)),
      chips: [{ label: 'Show other places', act: 'plan:more' }, { label: 'Change type of trip', act: 'plan:type' }],
    });
  };

  const showPlan = (slug: string, p: Plan) => {
    const d = DESTINATIONS.find((x) => x.slug === slug);
    if (!d) return;
    const next = { ...p, current: slug, shown: [...new Set([...p.shown, slug])] };
    setPlan(next);
    setPlanAsk('detail');
    say(planText(d, next), {
      places: [placeCard(d, next, book)],
      chips: [
        { label: 'Yes, this looks good', act: 'plan:accept' },
        { label: "I don't like this plan", act: 'plan:change' },
        { label: 'Show other places', act: 'plan:more' },
      ],
    });
  };

  const acceptPlan = (p: Plan) => {
    const d = DESTINATIONS.find((x) => x.slug === p.current);
    if (!d) return;
    setPlan(null);
    setPlanAsk(null);
    say(`Great! Let's book your ${p.days}-day trip to ${d.name}${p.pax ? ` for ${p.pax} ${p.pax === 1 ? 'person' : 'people'}` : ''}.`);
    advance(draftFromPlan(p, d, routes ?? []));
  };

  /** Ask the next thing the plan needs, or suggest places when it has enough. */
  const planOn = (p: Plan, lead = '') => {
    const s = nextPlanStep(p);
    if (s === 'suggest') { showSuggestions(p, lead); return; }
    setPlan(p);
    setPlanAsk(s);
    const q = planPrompt(s, p);
    say(`${lead}${q.text}`, { chips: q.chips?.map((c) => ({ label: c })) });
  };

  const planMessage = (text: string) => {
    const p0 = plan ?? EMPTY_PLAN;
    const low = text.toLowerCase().trim();

    // Quick answers to the open question, which the general reader would miss.
    let p = readPlan(text, p0);
    if (planAsk === 'pax' && /^\d{1,2}$/.test(low)) p = { ...p, pax: Number(low) };
    if (planAsk === 'days' && /^\d{1,2}$/.test(low)) p = { ...p, days: Number(low) };
    if (planAsk === 'budget' || BUDGET_CHIPS.map((b) => b.toLowerCase()).includes(low)) {
      const i = BUDGET_CHIPS.map((b) => b.toLowerCase()).indexOf(low);
      if (i >= 0) p = { ...p, budget: [6000, 12000, 0, 0][i] };
      else if (p.budget === undefined && /\bno|skip|any|not sure\b/.test(low)) p = { ...p, budget: 0 };
    }
    if ((planAsk === 'type' || planAsk === 'retype') && TYPE_CHIPS.map((t) => t.toLowerCase()).includes(low)) {
      p = { ...p, typeAsked: true };
      if (low === 'hills & nature') p = { ...p, themes: [...new Set([...p.themes, 'hills' as const, 'nature' as const])] };
      if (low === 'historical') p = { ...p, themes: [...new Set([...p.themes, 'heritage' as const])] };
    }
    if (planAsk === 'distance') {
      if (/closer|under|near/.test(low)) p = { ...p, maxHours: 3 };
      else p = { ...p, maxHours: undefined };
      showSuggestions(p);
      return;
    }

    // Reacting to a plan on screen.
    if (planAsk === 'detail' && p.current) {
      const named = DESTINATIONS.find((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(low) && !p.rejected.includes(d.slug) && d.slug !== p.current);
      const cur = DESTINATIONS.find((d) => d.slug === p.current);
      if (/\b(yes|yeah|yep|ok|okay|good|great|perfect|sounds good|looks good|go ahead|let'?s (do|go)|book( it)?|confirm|fine)\b/.test(low) && !/\b(not|don'?t|no)\b/.test(low)) { acceptPlan(p); return; }
      if (named) { showPlan(named.slug, p); return; }
      if (/\b(already|been there|visited|seen it)\b/.test(low) || (cur && p.rejected.includes(cur.slug))) {
        const q = { ...p, rejected: [...new Set([...p.rejected, p.current])], current: undefined, themes: [], typeAsked: false };
        setPlan(q);
        setPlanAsk('retype');
        say(`No problem${cur ? ` - we will skip ${cur.name}` : ''}. Would you prefer a nature, beach, historical, religious or adventure destination?`,
          { chips: ['Hills & nature', 'Beach', 'Historical', 'Religious', 'Adventure', 'Anything'].map((c) => ({ label: c })) });
        return;
      }
      if (/\b(no|not|don'?t|dont|change|different|another|else|other)\b/.test(low)) {
        setPlan(p);
        setPlanAsk('change');
        say('Sure - what would you like to change?', { chips: CHANGE_CHIPS.map((c) => ({ label: c, act: `plan:c:${c}` })) });
        return;
      }
      if (p.days !== p0.days || p.pax !== p0.pax) { showPlan(p.current, p); return; }
    }

    if (planAsk === 'retype' && (p.themes.length || p.typeAsked)) { showSuggestions({ ...p, typeAsked: true }); return; }
    if (planAsk === 'change' || planAsk === 'detail') {
      if (p.themes.length > p0.themes.length || p.days !== p0.days || p.budget !== p0.budget || p.maxHours !== p0.maxHours) {
        showSuggestions(p);
        return;
      }
    }
    planOn(p);
  };

  const planChange = (what: string) => {
    const p = plan ?? EMPTY_PLAN;
    const cur = DESTINATIONS.find((d) => d.slug === p.current);
    setLines((l) => [...l, line('user', what)]);
    switch (what) {
      case 'Destination':
        showSuggestions({ ...p, rejected: cur ? [...new Set([...p.rejected, cur.slug])] : p.rejected, current: undefined });
        return;
      case 'Places to visit': {
        // Somewhere with different things to see: the places the portal lists as similar.
        const similar = cur ? cur.similar.filter((s) => !p.rejected.includes(s)) : [];
        const picks = DESTINATIONS.filter((d) => similar.includes(d.slug));
        if (!picks.length) { showSuggestions(p); return; }
        setPlanAsk('detail');
        say(`Places like ${cur?.name} with different things to see:`, {
          places: picks.map((d) => placeCard(d, p, book)),
          chips: [{ label: 'Show other places', act: 'plan:more' }],
        });
        return;
      }
      case 'Number of days': planOn({ ...p, days: undefined }); return;
      case 'Budget': planOn({ ...p, budget: undefined }); return;
      case 'Type of trip': planOn({ ...p, themes: [], party: undefined, typeAsked: false }); return;
      case 'Travel distance':
        setPlan(p);
        setPlanAsk('distance');
        say('How far are you happy to drive?', { chips: [{ label: 'Closer to Mumbai (under 3 hrs)' }, { label: 'Further is fine' }] });
        return;
      default: planOn(p);
    }
  };

  /* ------------------------------------------------------ understanding */

  /** What the conversation is about, so a follow-up need not repeat it. */
  const ctx = useRef<Ctx>({});
  const lastAsked = useRef('');
  const R = (key: ReplyKey, vars?: Record<string, string | number>) => r(langRef.current, key, vars);
  /** A menu or follow-up chip, drawn in the customer's language. */
  const mchip = (value: string, extra: Partial<Chip> = {}): Chip => ({ label: chipLabel(langRef.current, value), value, ...extra });
  const menu = (): Chip[] => MENU.map((m) => ({ label: chipLabel(langRef.current, m.label), value: m.value, act: m.act }));
  /** The office's own wording for a static answer, if it has written one, else ours. */
  const words = (intent: Intent, key: ReplyKey, vars?: Record<string, string | number>) => {
    const own = templateFor(kb, intent, langRef.current);
    return own ? fill(own, vars) : R(key, vars);
  };
  const lastBotText = () => [...lines].reverse().find((l) => l.from === 'bot' && l.id > 1)?.text ?? '';

  /** Fill a new booking from what the customer already told us. */
  const withCtx = (d: Draft): Draft => {
    const c = ctx.current;
    const next = { ...d };
    if (next.leg && !next.kind) next.kind = 'OUTSTATION';
    if (!next.pax && c.pax) next.pax = c.pax;
    if (!next.date && c.date) next.date = c.date;
    if (!next.time && c.time) next.time = c.time;
    if (next.kind === 'HOURLY' && !next.hourly && c.hours) {
      next.hourly = c.hours === 4 ? '4H40' : c.hours === 8 ? '8H80' : c.hours === 12 ? '12H120' : undefined;
    }
    return next;
  };

  const startBooking = (d: Draft, lead?: string) => {
    ctx.current.pending = undefined;
    const full = withCtx(d);
    advance(full, lead ?? acknowledge(full, routes ?? [], langRef.current));
  };

  /** Book the route in context - one way, return, or ask which. */
  const bookRoute = (route: OutstationRoute | undefined, place: string | undefined, leg?: Leg) => {
    if (route) startBooking({ kind: 'OUTSTATION', routeKey: route.key, leg });
    else startBooking({ kind: 'OUTSTATION', routeKey: 'other', otherDestination: place, leg });
  };

  const approxKm = (place: string) => {
    const d = DESTINATIONS.find((x) => x.name.toLowerCase() === place.toLowerCase());
    return d ? ` (≈${d.km} km)` : '';
  };

  /** A route's fares for one leg only - one-way and return are never mixed. */
  const fareReply = (route: OutstationRoute, leg: Leg) => {
    const other: Leg = leg === 'RETURN' ? 'ONE_WAY' : 'RETURN';
    const legName = R(leg === 'RETURN' ? 'leg.return' : 'leg.oneWay');
    const otherName = R(other === 'RETURN' ? 'leg.return' : 'leg.oneWay');
    const priced = route.fares.some((f) => fareOf(f, leg) != null);
    const rows = [...route.fares]
      .sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
      .map((f) => {
        const n = fareOf(f, leg);
        return `• ${CATEGORY_META[f.category].label} (${f.vehicles}) - ${n == null ? R('fare.onRequest') : `${rupees(n)}, ${R(f.tollIncluded ? 'toll.in' : 'toll.out')}`}`;
      })
      .join('\n');
    const head = R('fare.head', { route: routeLabel(route), dist: approxKm(route.destination), leg: legName });
    const text = priced
      ? `${head}\n\n${rows}\n\n${R('fare.askBook', { other: otherName })}`
      : `${R('fare.noneForLeg', { leg: legName })}\n\n${R('fare.askBook', { other: otherName })}`;
    Object.assign(ctx.current, { route, place: undefined, leg, intent: 'FARE_INQUIRY', pending: 'bookOffer' } satisfies Partial<Ctx>);
    say(text, {
      chips: [
        mchip(leg === 'RETURN' ? 'Book return' : 'Book one way', { act: `book:route:${route.key}:${leg}` }),
        mchip(other === 'RETURN' ? 'Return fare' : 'One-way fare', { act: `fare:${route.key}:${other}` }),
      ],
      link: { label: `${routeLabel(route)} - ${legName}`, to: `/outstation?${new URLSearchParams({ tab: 'OUTSTATION', leg, route: route.key }).toString()}` },
    });
  };

  /** Local, airport and hourly fares, estimated from the published rate card. */
  const localFareReply = (kind: 'LOCAL' | 'AIRPORT' | 'HOURLY', hours?: number) => {
    if (!book.loaded) { say(R('fare.loading')); return; }
    const hourly = kind === 'HOURLY' ? (hours === 4 ? '4H40' : hours === 12 ? '12H120' : '8H80') : undefined;
    const opts = vehicleOptions({ kind, hourly }, routes ?? [], book).filter((o) => o.price).slice(0, 5);
    const what = kind === 'HOURLY'
      ? (HOURLY_PKG.find((h) => h.key === hourly)?.label ?? 'hourly')
      : tl(langRef.current, kind === 'AIRPORT' ? 'Airport transfer' : 'Local (within Mumbai)');
    ctx.current = { ...ctx.current, kind, intent: 'FARE_INQUIRY', pending: 'serviceOffer', route: undefined, place: undefined };
    if (!opts.length) { say(R('fare.failed')); return; }
    say(`${R('fare.local', { what })}\n\n${opts.map((o) => `• ${o.name} (${o.category}) - ${o.price}${o.details[0] ? ` · ${o.details[0]}` : ''}`).join('\n')}`,
      { chips: [mchip('Book now', { act: `book:${kind}` })] });
  };

  const fareFlow = (e: Entities) => {
    const c = ctx.current;
    const route = e.route ?? (!e.place ? c.route : undefined);
    const place = e.place ?? (!e.route ? c.place : undefined);
    if (e.reversed && e.route) {
      say(R('fare.reversed', { route: routeLabel(e.route), from: e.route.destination }), {
        chips: [mchip('Leave my details', { act: 'lead:Website assistant' })],
      });
      return;
    }
    if (route) { fareReply(route, e.leg ?? (c.route?.key === route.key ? c.leg : undefined) ?? 'ONE_WAY'); return; }
    if (place) {
      if (!routes) { say(R(failed ? 'fare.failed' : 'fare.loading')); return; }
      Object.assign(ctx.current, { place, route: undefined, intent: 'FARE_INQUIRY', pending: 'routeLeg' } satisfies Partial<Ctx>);
      say(R('fare.none', { place }), {
        chips: [mchip('Book as Other', { act: `book:other:${place}` }), mchip('Leave my details', { act: 'lead:Website assistant' })],
      });
      return;
    }
    if (e.kind === 'LOCAL' || e.kind === 'AIRPORT' || e.kind === 'HOURLY') { localFareReply(e.kind, e.hours); return; }
    if (!routes) { say(R(failed ? 'fare.failed' : 'fare.loading')); return; }
    ctx.current.intent = 'FARE_INQUIRY';
    say(R('fare.which'), {
      chips: [
        ...routes.map((rt) => ({ label: rt.destination, act: `fare:${rt.key}:ONE_WAY` })),
        mchip('Local', { act: 'fare:LOCAL' }), mchip('Airport', { act: 'fare:AIRPORT' }), mchip('Hourly', { act: 'fare:HOURLY' }),
      ],
    });
  };

  const tollReply = (route?: OutstationRoute) => {
    if (!route) { say(words('TOLL_INFORMATION', 'toll.general')); return; }
    ctx.current = { ...ctx.current, route, intent: 'TOLL_INFORMATION' };
    // Only the cabs the route has a fare for: a toll note on "fare on request" says nothing.
    const rows = [...route.fares]
      .filter((f) => f.oneWay != null || f.return != null)
      .sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
      .map((f) => `• ${CATEGORY_META[f.category].label} (${f.vehicles}) - ${R(f.tollIncluded ? 'toll.in' : 'toll.out')}`);
    if (!rows.length) { say(words('TOLL_INFORMATION', 'toll.general')); return; }
    say(`${R('toll.route', { route: routeLabel(route) })}\n${rows.join('\n')}\n\n${R('toll.general')}`);
  };

  /** "Pune?" - a place and nothing else. */
  const placeAsk = (e: Entities) => {
    const place = e.route?.destination ?? e.place ?? '';
    ctx.current = { ...ctx.current, route: e.route, place: e.route ? undefined : e.place, leg: e.leg, intent: 'PLACE_ONLY', pending: 'routeLeg' };
    say(R('place.ask', { place }), {
      chips: [mchip('One way', { act: 'leg:ONE_WAY' }), mchip('Return', { act: 'leg:RETURN' }), mchip('Fare', { act: 'leg:fare' })],
    });
  };

  const vehicleReply = (e: Entities) => {
    const catLabel = (slug: string) => {
      const cat = fareCategoryOf(slug);
      return cat ? CATEGORY_META[cat].label : VEHICLES.find((v) => v.slug === slug)?.category ?? '';
    };
    const seatLine = (slug: string) => {
      const v = VEHICLES.find((x) => x.slug === slug);
      return v ? `• ${v.name} - ${v.seats} seats, ${v.bags} bags` : '';
    };
    if (e.model) {
      const v = VEHICLES.find((x) => x.slug === e.model)!;
      say(`${R('vehicle.model', { name: v.name, category: catLabel(v.slug), seats: v.seats, bags: v.bags })}\n\n${R('vehicle.confirm')}`, {
        link: { label: v.name, to: `/vehicles/${v.slug}` },
        chips: [mchip('Book a cab', { value: `I want to book ${v.name}` })],
      });
      return;
    }
    if (e.category) {
      // "Premium" alone covers both premium classes; Ertiga and XL6 are never in it.
      const cats: FareCategory[] = e.category === 'PREMIUM_SEDAN' && !/\b(sedan|city|ciaz)\b/.test(lastAsked.current)
        ? ['PREMIUM_SEDAN', 'PREMIUM_MUV'] : [e.category];
      const text = cats.map((cat) => `${CATEGORY_META[cat].label}:\n${CATEGORY_VEHICLES[cat].map(seatLine).filter(Boolean).join('\n')}`).join('\n\n');
      say(`${text}\n\n${R('vehicle.confirm')}`, { chips: [mchip('Book a cab'), mchip('Check fare')], link: { label: 'See the full fleet', to: '/fleet' } });
      return;
    }
    const cats = Object.keys(CATEGORY_VEHICLES) as FareCategory[];
    const inCats = new Set(cats.flatMap((cat) => CATEGORY_VEHICLES[cat]));
    const text = [
      ...cats.map((cat) => `• ${CATEGORY_META[cat].label}: ${CATEGORY_VEHICLES[cat].map((s) => VEHICLES.find((v) => v.slug === s)?.name).filter(Boolean).join(', ')}`),
      ...VEHICLES.filter((v) => !inCats.has(v.slug)).map((v) => `• ${v.category}: ${v.name} (${v.seats} seats)`),
    ].join('\n');
    say(`${R('vehicle.fleet')}\n${text}\n\n${R('vehicle.confirm')}`, { chips: [mchip('Book a cab'), mchip('Check fare')], link: { label: 'See the full fleet', to: '/fleet' } });
  };

  const capacityReply = (pax?: number) => {
    if (pax) {
      ctx.current.pax = pax;
      const fit = VEHICLES.filter((v) => (v.maxPax ?? v.seats) >= pax).sort((a, b) => a.seats - b.seats).slice(0, 5);
      if (!fit.length) { say(R('capacity.many', { pax }), { chips: [mchip('Leave my details', { act: 'lead:Website assistant' })] }); return; }
      say(`${R('capacity.fit', { pax })}\n${fit.map((v) => `• ${v.name} - ${v.seats} seats, ${v.bags} bags`).join('\n')}`, {
        chips: [mchip('Book a cab'), mchip('Check fare')],
      });
      return;
    }
    const bySeats = [...new Set(VEHICLES.map((v) => v.seats))].sort((a, b) => a - b)
      .map((n) => `• ${n} - ${VEHICLES.filter((v) => v.seats === n).map((v) => v.name).join(', ')}`);
    say(`${R('capacity.list')}\n${bySeats.join('\n')}`, { chips: [mchip('Book a cab')] });
  };

  /** A booking looked up by Trip ID and the last four digits of its mobile. */
  const lookup = async (tripId: string, digits: string) => {
    const c = ctx.current;
    c.pending = undefined;
    try {
      const { data } = await api.get(`/public/track/${encodeURIComponent(tripId)}`, { params: { verify: digits } });
      const t = data?.data as TrackedTrip | undefined;
      if (!t) throw new Error('empty');
      const when = [t.travelDate ? dmy(t.travelDate) : '', t.journeyTime ?? ''].filter(Boolean).join(', ');
      const where = [t.pickup, t.drop].filter(Boolean).join(' → ');
      const assigned = t.vehicleNumber || t.driverName;
      const parts = [
        R('status.head', { id: t.tripId, status: t.statusLabel ?? t.status }),
        [when, where, t.vehicleType].filter(Boolean).join('\n'),
        assigned
          ? R('status.assigned', {
            vehicle: [t.vehicleType, t.vehicleNumber].filter(Boolean).join(' · ') || '-',
            driver: [t.driverName, t.driverMobile].filter(Boolean).join(' · ') || '-',
          })
          : R('status.notAssigned'),
      ];
      c.tripId = t.tripId;
      say(parts.filter(Boolean).join('\n\n'), { link: { label: 'Open the trip page', to: '/track' } });
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      say(R(status === 404 ? 'status.notFound' : 'status.error'), { chips: [mchip('Look up my booking', { act: 'status' })] });
    }
  };

  const statusFlow = (intent: Intent, e: Entities) => {
    const c = ctx.current;
    c.statusFor = intent;
    const id = e.tripId ?? c.tripId;
    if (id && e.digits) { void lookup(id, e.digits); return; }
    if (id) { c.tripId = id; c.pending = 'statusDigits'; say(R('status.askDigits')); return; }
    c.pending = 'statusId';
    say(R('status.askId'), { link: { label: 'My trips', to: '/trips' } });
  };

  /** Open the callback form, with what the customer said already in it. */
  const openLead = (kind: LeadKind, message = '') => {
    setLeadKind(kind);
    setLead((l) => ({ ...l, message: message || l.message }));
    setHandoff(true);
    setSent(false);
  };

  /** A question the rules place loosely: a written FAQ that fits better wins. */
  const specificFaq = (text: string): Topic | null => {
    const m = findAnswer(text, live);
    if (m.kind !== 'answer') return null;
    const t = m.topic;
    if (GENERIC_TOPICS.has(t.id) || t.id.startsWith('service-') || t.id.startsWith('route') || GENERIC_TITLES.has(t.title)) return null;
    // It has to share a telling word with the question ("child", "air"), not
    // only "available" - or "premium car available" gets the child-seat answer.
    const keys = new Set(t.keywords);
    return tokenise(text).some((w) => !COMMON_STEMS.has(w) && keys.has(w)) ? t : null;
  };

  /**
   * One message from the customer. `shown` is the chip's words when a chip
   * was tapped: the answer is its English value, and a tap says nothing about
   * which language the customer writes in.
   *
   * Understood first (assistantNlu: language, intent, entities), then checked
   * against what the conversation is already about, then answered from the
   * portal's live data.
   */
  const ask = (raw: string, topicId?: string, shown?: string) => {
    const question = raw.trim();
    if (!question) return;
    const u = understand(question, routes, kb);
    if (!shown && u.lang) setLang(u.lang);
    const lg = langRef.current;
    // What the rules read. English is left as typed.
    const read = lg === 'en' ? question : normalise(question);
    lastAsked.current = u.text;

    // Mid-booking, a message answers the question just asked.
    if (step && draft) {
      const display = shown ?? ((step === 'date' || step === 'returnDate') && /^\d{4}-\d{2}-\d{2}$/.test(question) ? dmy(question) : question);
      setLines((l) => [...l, line('user', display)]);
      setDraft('');
      if (/^(cancel|stop|exit|quit)( booking)?$/i.test(read)) return cancelBooking();
      if (step === 'vehicle' || step === 'summary') {
        say(tt(step === 'vehicle' ? 'tapVehicle' : 'tapSummary'));
        return;
      }
      const out = answerStep(step, question, draft, routes ?? [], lg);
      if (out.error) { say(out.error); return; }
      advance(out.draft!);
      return;
    }

    // What was understood travels with the line into the chat record, so the
    // office sees it and unplaced questions reach Admin > Chatbot Knowledge.
    const e = u.entities;
    const nlu: Nlu = {
      lang: u.lang ?? lg,
      intent: u.intent,
      confidence: Math.round(u.confidence * 100) / 100,
      entities: {
        route: e.route?.key, place: e.place, leg: e.leg, kind: e.kind, airportWay: e.airportWay, hours: e.hours,
        pax: e.pax, date: e.date, time: e.time, category: e.category, model: e.model, tripId: e.tripId,
      },
    };
    setLines((l) => [...l, line('user', shown ?? question, { nlu })]);
    setDraft('');

    // Planning a trip: every message goes to the planner until it hands over.
    if (plan) {
      if (/^(cancel|stop|exit|quit)$/i.test(read)) { setPlan(null); setPlanAsk(null); say('No problem. Ask me anything whenever you like.'); return; }
      nlu.intent = 'TRIP_PLANNER';
      planMessage(read);
      return;
    }
    if (planIntent(read) && !/\b(sedan|suv|innova|ertiga|dzire|tempo|cab|car|taxi)\b/i.test(read)) {
      nlu.intent = 'TRIP_PLANNER';
      const p = readPlan(read, EMPTY_PLAN);
      const named = DESTINATIONS.find((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(read.toLowerCase()) && !p.rejected.includes(d.slug));
      if (named && p.days) { setPlan(p); showPlan(named.slug, { ...p, typeAsked: true, budget: p.budget ?? 0 }); return; }
      planOn(p, named ? `${named.name} is a good choice. ` : '');
      return;
    }

    // A tapped suggestion already names its answer.
    if (topicId) {
      const known = topicById(topicId, live);
      if (known) { nlu.intent = 'FAQ'; reply(known); return; }
    }

    const c = ctx.current;
    // Remember the details as they are mentioned, so nothing is asked twice.
    if (e.pax) c.pax = e.pax;
    if (e.date) c.date = e.date;
    if (e.time) c.time = e.time;
    if (e.hours) c.hours = e.hours;
    const namesPlace = !!(e.route || e.place);

    /* ---------------- answers to the question the assistant just asked */
    if (c.pending === 'statusId' || c.pending === 'statusDigits') {
      // An answer to our own question is logged under that question, not as "unknown".
      if (e.tripId) { nlu.intent = c.statusFor ?? 'BOOKING_STATUS'; statusFlow(nlu.intent, e); return; }
      if (c.pending === 'statusDigits' && e.digits && c.tripId) { nlu.intent = c.statusFor ?? 'BOOKING_STATUS'; void lookup(c.tripId, e.digits); return; }
      if (u.intent === 'DENY') { c.pending = undefined; say(R('deny'), { chips: menu() }); return; }
      if (u.intent === 'UNKNOWN_INTENT') { say(R(c.pending === 'statusId' ? 'status.badId' : 'status.askDigits')); return; }
      c.pending = undefined;
    }
    if (c.pending === 'routeLeg' && (c.route || c.place) && !namesPlace) {
      if (e.leg) { nlu.intent = e.leg === 'RETURN' ? 'RETURN_BOOKING' : 'ONE_WAY_BOOKING'; bookRoute(c.route, c.place, e.leg); return; }
      if (u.intent === 'AFFIRM' || u.intent === 'BOOKING_CREATE') { bookRoute(c.route, c.place); return; }
      if (u.intent === 'FARE_INQUIRY') { fareFlow(e); return; }
      if (u.intent === 'DENY') { c.pending = undefined; say(`${R('deny')} ${R('menu.more')}`, { chips: menu() }); return; }
    }
    if (c.pending === 'bookOffer' && c.route && !namesPlace) {
      if (u.intent === 'AFFIRM') { bookRoute(c.route, undefined, c.leg); return; }
      if (u.intent === 'DENY') { c.pending = undefined; say(`${R('deny')} ${R('menu.more')}`, { chips: menu() }); return; }
    }
    if (c.pending === 'serviceOffer' && c.kind) {
      if (u.intent === 'AFFIRM') { startBooking({ kind: c.kind }); return; }
      if (u.intent === 'DENY') { c.pending = undefined; say(`${R('deny')} ${R('menu.more')}`, { chips: menu() }); return; }
    }
    c.pending = undefined;

    /* ---------------- follow-ups about the route already on screen */
    if (!namesPlace && (c.route || c.place)) {
      const legOnly = !!e.leg && !e.bookWord && ['UNKNOWN_INTENT', 'ONE_WAY_BOOKING', 'RETURN_BOOKING'].includes(u.intent);
      if (u.intent === 'FARE_INQUIRY' || (legOnly && c.intent === 'FARE_INQUIRY')) { nlu.intent = 'FARE_INQUIRY'; fareFlow(e); return; }
      if (u.intent === 'TOLL_INFORMATION' && c.route) { tollReply(c.route); return; }
      if (u.intent === 'ONE_WAY_BOOKING' || u.intent === 'RETURN_BOOKING' || (legOnly && c.intent === 'PLACE_ONLY')) {
        bookRoute(c.route, c.place, e.leg);
        return;
      }
    }

    // A loosely placed question that one of the written FAQs answers exactly
    // ("are child seats available", "is the car air conditioned").
    if (SOFT_INTENTS.has(u.intent) && u.confidence < 0.9) {
      const faq = specificFaq(u.text);
      if (faq) { nlu.intent = 'FAQ'; reply(faq); return; }
    }

    c.intent = u.intent;
    switch (u.intent) {
      case 'OUT_OF_SCOPE': {
        // "We do not arrange air tickets" says more than the general line.
        const beyond = outOfScope(u.text);
        say(lg === 'en' && beyond?.kind === 'not-arranged' ? outOfScopeReply(beyond) : R('outOfScope'), { chips: menu(), link: ENQUIRY_LINK });
        return;
      }
      case 'GREETING': {
        const small = pleasantry(read) ?? '';
        say(lg === 'en' ? (small || R('menu.prompt')) : tt('hello'), { chips: menu() });
        return;
      }
      case 'THANKS': {
        const small = pleasantry(read) ?? '';
        say(lg === 'en' ? (small || R('menu.more')) : tt('thanks'), { chips: menu() });
        return;
      }
      case 'GOODBYE': say(R('goodbye')); return;
      case 'AFFIRM': say(R('menu.prompt'), { chips: menu() }); return;
      case 'DENY': say(`${R('deny')} ${R('menu.more')}`, { chips: menu() }); return;
      case 'HELP': say(words('HELP', 'help'), { chips: menu() }); return;

      case 'BOOKING_STATUS': case 'DRIVER_INFORMATION': case 'VEHICLE_ASSIGNMENT': case 'INQUIRY_STATUS': case 'BOOKING_CONFIRMATION':
        statusFlow(u.intent, e);
        return;
      case 'BOOKING_CANCEL':
        say(words('BOOKING_CANCEL', 'cancel'), {
          link: { label: 'Terms in plain words', to: '/policies' },
          chips: [mchip('Look up my booking', { act: 'status' }), mchip('Contact support')],
        });
        return;
      case 'BOOKING_MODIFY':
        say(words('BOOKING_MODIFY', 'modify'), { chips: [mchip('Look up my booking', { act: 'status' }), mchip('Contact support')] });
        return;
      case 'PAYMENT_INFORMATION': say(words('PAYMENT_INFORMATION', 'payment'), { chips: [mchip('Contact support')] }); return;
      case 'INVOICE_INFORMATION': say(words('INVOICE_INFORMATION', 'invoice'), { link: { label: 'My trips', to: '/trips' } }); return;
      case 'WHATSAPP_REQUEST': {
        const text = lastBotText() || COMPANY.name;
        say(words('WHATSAPP_REQUEST', 'whatsapp'), {
          wa: { self: `https://wa.me/?text=${encodeURIComponent(`${COMPANY.name}\n\n${text}`)}`, office: whatsappLink(text) },
        });
        return;
      }
      case 'CONTACT_SUPPORT':
        say(words('CONTACT_SUPPORT', 'contact'), {
          link: { label: 'Contact page', to: '/contact' },
          chips: [mchip('Leave my details', { act: 'lead:Website assistant' })],
        });
        return;
      case 'CORPORATE_BOOKING':
        say(words('CORPORATE_BOOKING', 'corporate'), { link: { label: 'Corporate request', to: '/corporate/request' } });
        return;
      case 'BULK_BOOKING':
        say(words('BULK_BOOKING', 'bulk'), { link: ENQUIRY_LINK, chips: [mchip('Leave my details', { act: 'lead:Website assistant' })] });
        return;
      case 'INQUIRY_CREATE': openLead('Website assistant', question); return;
      case 'FEEDBACK': case 'DRIVER_RATING': case 'SERVICE_RATING': case 'CAB_RATING': case 'TRIP_COMPLETED':
        say(words(u.intent, 'feedback'), { chips: [mchip('Did not get the email', { act: 'lead:Feedback link not received' })] });
        return;
      case 'COMPLAINT': say(words('COMPLAINT', 'complaint')); openLead('Complaint', question); return;
      case 'SUGGESTION': say(words('SUGGESTION', 'suggestion')); openLead('Suggestion', question); return;
      case 'MULTI_STOP': say(words('MULTI_STOP', 'multistop'), { chips: [mchip('Book a cab')] }); return;
      case 'PICKUP_INFORMATION': say(words('PICKUP_INFORMATION', 'pickupInfo'), { chips: [mchip('Book a cab')] }); return;
      case 'DROP_INFORMATION': say(words('DROP_INFORMATION', 'dropInfo'), { chips: [mchip('Book a cab')] }); return;
      case 'DATE_SELECTION': case 'TIME_SELECTION':
        c.pending = 'serviceOffer';
        c.kind = e.kind ?? c.kind;
        say(words(u.intent, 'when'), { chips: [mchip('Book now', { act: e.kind ? `book:${e.kind}` : 'book:any' })] });
        return;
      case 'SERVICE_INFORMATION': say(words('SERVICE_INFORMATION', 'services'), { chips: menu() }); return;

      case 'TOLL_INFORMATION': tollReply(e.route ?? c.route); return;
      case 'FARE_BREAKDOWN': case 'EXTRA_CHARGES': {
        const topic = topicById(u.intent === 'EXTRA_CHARGES' ? 'extras' : 'inclusions', live);
        if (topic) { reply(topic); return; }
        break;
      }
      case 'FARE_INQUIRY': fareFlow(e); return;
      case 'VEHICLE_INFORMATION': case 'STANDARD_VEHICLE': case 'SUV_MUV': case 'PREMIUM_VEHICLE': vehicleReply(e); return;
      case 'VEHICLE_CAPACITY': case 'PASSENGER_INFORMATION': capacityReply(e.pax); return;
      case 'PLACE_ONLY': placeAsk(e); return;

      case 'LOCAL_BOOKING': case 'AIRPORT_BOOKING': case 'AIRPORT_TO': case 'AIRPORT_FROM': case 'OUTSTATION_BOOKING':
      case 'HOURLY_BOOKING': case 'ONE_WAY_BOOKING': case 'RETURN_BOOKING': case 'BOOKING_CREATE': case 'CUSTOM_ROUTE': {
        // "I want to book a sedan" is a booking, not a question about booking -
        // and so is "Mumbai se Pune one-way cab book karni hai". The reply opens
        // by saying what was understood: one way or return, to or from the airport.
        const intent = bookingIntent(u.cleaned, routes);
        if (intent) {
          if (!intent.kind && e.kind) intent.kind = e.kind;
          // "Andheri se Bandra cab chahiye": a local trip, both ends given.
          if (intent.kind === 'LOCAL' && !intent.drop && e.to) intent.drop = e.to.replace(/\b\w/g, (ch) => ch.toUpperCase());
          if (u.intent === 'CUSTOM_ROUTE' && !intent.routeKey) { intent.kind = 'OUTSTATION'; intent.routeKey = 'other'; }
          startBooking(intent);
          return;
        }
        if (u.intent === 'CUSTOM_ROUTE') { startBooking({ kind: 'OUTSTATION', routeKey: 'other', leg: e.leg }); return; }
        // A route and no more ("Mumbai to Pune cab"): one way or return?
        if (namesPlace && (u.intent === 'OUTSTATION_BOOKING' || u.intent === 'ONE_WAY_BOOKING' || u.intent === 'RETURN_BOOKING')) {
          if (e.leg) { bookRoute(e.route, e.place, e.leg); return; }
          placeAsk(e);
          return;
        }
        // "Airport cab milti hai?" - a question about the service.
        const kind: Kind | undefined = e.kind ?? (u.intent === 'LOCAL_BOOKING' ? 'LOCAL' : u.intent === 'HOURLY_BOOKING' ? 'HOURLY'
          : u.intent.startsWith('AIRPORT') ? 'AIRPORT' : u.intent === 'OUTSTATION_BOOKING' ? 'OUTSTATION' : undefined);
        if (kind && !e.bookWord) {
          c.kind = kind;
          c.pending = 'serviceOffer';
          say(R(`service.${kind}` as ReplyKey, { airports: AIRPORTS.join(', ') }), {
            chips: [
              mchip('Book now', { act: `book:${kind}` }),
              ...(kind === 'OUTSTATION' && routes
                ? routes.slice(0, 6).map((rt) => ({ label: rt.destination, act: `fare:${rt.key}:ONE_WAY` }))
                : [mchip('Check fare', { act: `fare:${kind}` })]),
            ],
          });
          return;
        }
        startBooking(kind ? { kind, airportWay: e.airportWay === 'TO' ? AIRPORT_TO : e.airportWay === 'FROM' ? AIRPORT_FROM : undefined } : {});
        return;
      }
      default: break;
    }

    // Nothing placed it: the written FAQs, then an honest "not sure".
    const match = findAnswer(u.text, live);
    if (match.kind === 'answer') { nlu.intent = 'FAQ'; reply(match.topic); return; }
    if (match.kind === 'unsure') {
      setLines((l) => [...l, line('bot', tt('unsure'), { chips: [...topicChips(match.options), ...menu().slice(0, 3)] })]);
      return;
    }
    say(R('unknown'), { chips: menu(), link: ENQUIRY_LINK });
  };

  const sendLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const mobile = lead.mobile.replace(/\D/g, '').replace(/^91/, '');
    if (lead.name.trim().length < 2) return setLeadError('Please enter your name.');
    if (!/^[6-9]\d{9}$/.test(mobile)) return setLeadError('Enter a valid 10-digit mobile number.');

    setLeadError('');
    setSending(true);
    try {
      // The last thing the visitor asked is the most useful context for the
      // callback, so it goes along with whatever they typed here.
      const lastQuestion = [...lines].reverse().find((l) => l.from === 'user')?.text ?? '';
      await api.post('/public/enquiry', {
        name: lead.name.trim(),
        mobile,
        service: leadKind,
        message: [lead.message.trim(), lastQuestion && `Asked the assistant: "${lastQuestion}"`]
          .filter(Boolean).join('\n'),
      });
      setSent(true);
    } catch (err) {
      setLeadError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* launcher */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close the travel assistant' : 'Ask the travel assistant'}
        /*
         * A circle on a phone, a pill with its label from `sm` up.
         *
         * The label is hidden below `sm` - but the padding that sized the pill
         * around it was not, so on a phone this was a 64x56 lozenge with a lone
         * icon rattling about inside it, parked over the page. Width and
         * padding now follow the label.
         */
        className={`grad-brand fixed bottom-[4.75rem] right-4 z-50 flex items-center justify-center rounded-full text-white shadow-lift transition-all duration-200 hover:scale-105 active:scale-95 lg:bottom-5 lg:right-5 ${
          tucked && !open ? 'pointer-events-none translate-y-6 opacity-0' : ''
        } ${
          open ? 'h-14 w-14' : 'h-[3.25rem] w-[3.25rem] sm:h-14 sm:w-auto sm:gap-2.5 sm:px-5'
        }`}
      >
        {open ? <IconClose className="h-6 w-6" /> : (
          <>
            <span className="relative">
              <ChatIcon className="h-6 w-6" />
              {inProgress && (
                <span
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-gold-400 ring-2 ring-white/70"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="hidden text-sm font-semibold sm:inline">
              {inProgress ? 'Back to chat' : 'Ask us'}
            </span>
          </>
        )}
      </button>

      {/* panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Travel assistant"
          className="animate-fade-up fixed bottom-[9.5rem] right-4 z-50 flex max-h-[min(34rem,calc(100vh-13rem))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-ink-200 lg:bottom-24 lg:max-h-[min(34rem,calc(100vh-8rem))]"
        >
          <header className="grad-brand flex items-center gap-3 px-4 py-3.5 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20">
              <ChatIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-tight">Travel assistant</p>
              <p className="text-2xs text-white/80">Answers from this site · {COMPANY.serviceHours}</p>
            </div>
            <button
              type="button"
              onClick={minimise}
              aria-label="Minimise the chat and keep it"
              title="Minimise — keeps this conversation"
              className="rounded-full p-1.5 transition-colors hover:bg-white/20"
            >
              <MinimiseIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={closeAndClear}
              aria-label="End the chat and clear it"
              title="End chat"
              className="rounded-full p-1.5 transition-colors hover:bg-white/20"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto bg-ink-50/60 px-4 py-4" aria-live="polite">
            {lines.map((l) => (
              <div key={l.id}>
                <div
                  className={
                    l.from === 'user'
                      ? 'ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2.5 text-sm text-white'
                      : 'w-fit max-w-[92%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-700 shadow-xs'
                  }
                >
                  {l.text}
                </div>

                {l.places && (
                  <div className="mt-2 space-y-2">
                    {l.places.map((pl) => (
                      <div key={pl.slug} className="rounded-xl bg-white p-3 shadow-xs ring-1 ring-ink-100">
                        <p className="text-sm font-bold text-ink-900">{pl.name}</p>
                        <p className="text-2xs text-ink-500">{pl.line}</p>
                        <p className="mt-1 text-xs leading-snug text-ink-600">{pl.blurb}</p>
                        <p className="mt-1 text-2xs text-ink-500"><span className="font-semibold">See:</span> {pl.famous.join(', ')}</p>
                        {pl.estimate && <p className="mt-0.5 text-2xs font-semibold text-ink-700">{pl.estimate}</p>}
                        {plan && plan.current !== pl.slug && l.id === lines[lines.length - 1]?.id && (
                          <button type="button" onClick={() => { setLines((x) => [...x, line('user', `Show me ${pl.name}`)]); showPlan(pl.slug, plan); }}
                            className="btn-outline btn-sm mt-2 w-full">
                            See the {pl.name} plan
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {l.vehicles && (
                  <div className="mt-2 space-y-2">
                    {l.vehicles.map((o) => (
                      <div key={o.slug} className={`rounded-xl bg-white p-3 shadow-xs ring-1 ring-ink-100 ${o.tooSmall ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-ink-900">{o.name}</p>
                            <p className="text-2xs text-ink-500">{o.category} · {o.seats} seats · {o.bags} bags</p>
                          </div>
                          <p className="shrink-0 text-right text-sm font-extrabold text-ink-900">{o.price ?? 'On request'}</p>
                        </div>
                        <ul className="mt-1.5 space-y-0.5 text-2xs leading-snug text-ink-500">
                          {o.details.map((x) => <li key={x}>{x}</li>)}
                          {o.tooSmall && <li className="font-semibold text-warn-700">Too small for your group</li>}
                        </ul>
                        {step === 'vehicle' && l.id === lines[lines.length - 1]?.id && (
                          <button type="button" onClick={() => pickVehicle(o)} className="btn-primary btn-sm mt-2 w-full">
                            Select {o.name}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {l.summary && (
                  <dl className="mt-2 divide-y divide-ink-100 rounded-xl bg-white px-3 py-1 text-xs shadow-xs ring-1 ring-ink-100">
                    {l.summary.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 py-1.5">
                        <dt className="shrink-0 text-ink-500">{tl(lang, k)}</dt>
                        <dd className={`text-right font-semibold ${/fare/i.test(k) ? 'text-ink-900' : 'text-ink-700'}`}>{tl(lang, v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                {l.confirmed && (
                  <div className="mt-2 space-y-1.5">
                    <p className="rounded-xl bg-brand-50 px-3 py-2 text-center font-mono text-base font-bold text-brand-700">{l.confirmed.tripId}</p>
                    {l.confirmed.emailedTo && (
                      <p className="flex items-center gap-1.5 text-2xs text-ok-700">
                        <IconCheck className="h-3 w-3" /> Details emailed to {l.confirmed.emailedTo}
                      </p>
                    )}
                    <a href={l.confirmed.selfLink} target="_blank" rel="noreferrer"
                      className="btn btn-sm w-full rounded-full bg-[#25D366] text-xs font-semibold text-white">
                      <IconWhatsApp className="h-3.5 w-3.5" /> Open WhatsApp to save these details
                    </a>
                    <a href={l.confirmed.officeLink} target="_blank" rel="noreferrer"
                      className="btn btn-sm w-full rounded-full bg-white text-xs font-semibold text-[#128C4B] ring-1 ring-[#25D366]/40">
                      <IconWhatsApp className="h-3.5 w-3.5" /> Send them to the office on WhatsApp
                    </a>
                    <Link to="/trips" replace onClick={() => setOpen(false)} className="block text-center text-2xs font-semibold text-brand-700 hover:underline">
                      See it under My trips
                    </Link>
                  </div>
                )}

                {l.wa && (
                  <div className="mt-2 space-y-1.5">
                    <a href={l.wa.self} target="_blank" rel="noreferrer"
                      className="btn btn-sm w-full rounded-full bg-[#25D366] text-xs font-semibold text-white">
                      <IconWhatsApp className="h-3.5 w-3.5" /> {chipLabel(lang, 'Send on WhatsApp')}
                    </a>
                    <a href={l.wa.office} target="_blank" rel="noreferrer"
                      className="btn btn-sm w-full rounded-full bg-white text-xs font-semibold text-[#128C4B] ring-1 ring-[#25D366]/40">
                      <IconWhatsApp className="h-3.5 w-3.5" /> WhatsApp {COMPANY.name}
                    </a>
                  </div>
                )}

                {l.link && (
                  <Link
                    to={l.link.to} replace
                    onClick={() => setOpen(false)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {l.link.label} <IconArrowRight className="h-3 w-3" />
                  </Link>
                )}
                {l.also && (
                  <Link
                    to={l.also.to} replace
                    onClick={() => setOpen(false)}
                    className="ml-3 mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {l.also.label} <IconArrowRight className="h-3 w-3" />
                  </Link>
                )}

                {l.chips && l.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {l.chips.map((c) => (
                      <button
                        key={c.label} type="button" onClick={() => onChip(c)} disabled={booking && c.act === 'confirm'}
                        className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* callback capture */}
            {handoff && !sent && (
              <form onSubmit={sendLead} className="rounded-xl bg-white p-3.5 shadow-xs">
                <p className="text-xs font-semibold text-ink-800">{LEAD_TITLE[leadKind]}</p>
                <input
                  className="input mt-2.5 h-9 text-sm" placeholder="Your name"
                  value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })}
                />
                <input
                  className="input mt-2 h-9 text-sm" placeholder="10-digit mobile" inputMode="numeric"
                  value={lead.mobile} onChange={(e) => setLead({ ...lead, mobile: e.target.value })}
                />
                <textarea
                  className="input mt-2 min-h-[52px] resize-y text-sm"
                  placeholder={leadKind === 'Website assistant' ? 'What do you need? (optional)' : leadKind === 'Feedback link not received' ? 'Your Trip ID' : 'What happened? Trip ID or date if you have it'}
                  value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })}
                />
                {leadError && <p className="mt-2 text-xs text-danger-600">{leadError}</p>}
                <div className="mt-2.5 flex gap-2">
                  <button type="submit" className="btn-primary btn-sm flex-1" disabled={sending}>
                    {sending ? 'Sending…' : leadKind === 'Website assistant' ? 'Request a callback' : 'Send'}
                  </button>
                  <button type="button" className="btn-outline btn-sm" onClick={() => setHandoff(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {sent && (
              <div className="flex items-start gap-2.5 rounded-xl bg-ok-50 p-3.5 text-sm text-ok-700">
                <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Thank you — your request is with us. {COMPANY.owner} will call you back shortly.</p>
              </div>
            )}
          </div>

          <div className="border-t border-ink-100 bg-white px-3 py-2.5">
            <form
              onSubmit={(e) => { e.preventDefault(); ask(draftText); }}
              className="flex items-center gap-2"
            >
              <input
                ref={input}
                className="input h-10 flex-1 text-sm"
                type={bar.type}
                inputMode={bar.type === 'tel' || bar.type === 'number' ? 'numeric' : undefined}
                placeholder={bar.placeholder}
                value={draftText}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={step ? 'Your answer' : 'Your question'}
              />
              <button type="submit" className="btn-primary h-10 w-10 shrink-0 rounded-lg p-0" aria-label="Send" disabled={!draftText.trim()}>
                <IconArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="flex items-center gap-3">
                <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline">
                  <IconPhone className="h-3.5 w-3.5" /> Call
                </a>
                <a
                  href={whatsappLink()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1FA855] hover:underline"
                >
                  <IconWhatsApp className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </span>
              {!handoff && !sent && (
                <button type="button" onClick={() => setHandoff(true)} className="text-xs font-semibold text-ink-500 hover:text-brand-700">
                  Talk to a person
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const LEAD_TITLE: Record<LeadKind, string> = {
  'Website assistant': 'Leave your number and we will call you back.',
  Complaint: 'Tell us what happened - it goes straight to the owner.',
  Suggestion: 'Your suggestion, with your name and number.',
  'Feedback link not received': 'Your Trip ID, name and number - we will send the feedback link again.',
};

/** A single rule — the universal "tuck this away" mark. */
function MinimiseIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M6 12h12" />
    </svg>
  );
}

/** Speech bubble. Local to the widget, so the shared icon set stays untouched. */
function ChatIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.6-.7L3 21l1.9-4.9A8.3 8.3 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4Z" />
      <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
    </svg>
  );
}
