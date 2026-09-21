import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, whatsappLink } from './siteData';
import { IconWhatsApp } from './SiteIcons';
import { OPENING_SUGGESTIONS, findAnswer, pleasantry, outOfScope, topicById, type Topic } from './assistantKnowledge';
import { api, errorMessage } from '../lib/api';
import { IconClose, IconPhone, IconArrowRight, IconCheck } from '../components/icons';

/* ==========================================================================
   Site assistant.

   Answers the questions the phone gets asked twenty times a week, so a visitor
   at 1am gets a reply instead of a voicemail. When it cannot answer, it takes a
   name and number and drops a real enquiry into the portal rather than
   pretending — see assistantKnowledge.ts for why it is a retriever and not a
   language model.

   Nothing here calls an external service. The only network request it makes is
   to this portal's own /api/public/enquiry, the same endpoint the contact form
   uses.
   ========================================================================== */

/** A tappable follow-up. Carrying the topic id means a suggestion resolves to
 *  the answer it names rather than being re-matched as if the visitor had typed
 *  it — a chip must never come back with "I am not certain which one you mean". */
interface Chip {
  label: string;
  topicId?: string;
}

interface Line {
  id: number;
  from: 'bot' | 'user';
  text: string;
  chips?: Chip[];
  link?: { label: string; to: string };
}

const asChips = (labels: string[]): Chip[] => labels.map((label) => ({ label }));
const topicChips = (topics: Topic[]): Chip[] => topics.map((t) => ({ label: t.title, topicId: t.id }));

const GREETING =
  `Hello. I can answer the common questions about ${COMPANY.name} — rates, vehicles, routes, ` +
  `airport transfers and how billing works. What would you like to know?`;

let nextId = 1;
const line = (from: Line['from'], text: string, extra: Partial<Line> = {}): Line =>
  ({ id: nextId++, from, text, ...extra });

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    line('bot', GREETING, { chips: asChips(OPENING_SUGGESTIONS) }),
  ]);
  const [draft, setDraft] = useState('');
  const [handoff, setHandoff] = useState(false);
  const [lead, setLead] = useState({ name: '', mobile: '', message: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [leadError, setLeadError] = useState('');

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
    setLines([line('bot', GREETING, { chips: asChips(OPENING_SUGGESTIONS) })]);
    setDraft('');
    setHandoff(false);
    setSent(false);
    setLeadError('');
  };

  const reply = (topic: Topic) =>
    setLines((l) => [...l, line('bot', topic.answer, { link: topic.link })]);

  const ask = (raw: string, topicId?: string) => {
    const question = raw.trim();
    if (!question) return;
    setLines((l) => [...l, line('user', question)]);
    setDraft('');

    // A tapped suggestion already names its answer. Re-matching the label would
    // be a needless round trip through the scorer, and can lose.
    if (topicId) {
      const known = topicById(topicId);
      if (known) { reply(known); return; }
    }

    const small = pleasantry(question);
    if (small) {
      setLines((l) => [...l, line('bot', small, { chips: asChips(OPENING_SUGGESTIONS.slice(0, 3)) })]);
      return;
    }

    // Say what we do not do, by name. Approximating it with the nearest car
    // answer wastes the visitor's time and looks like the widget misread them.
    const beyond = outOfScope(question);
    if (beyond) {
      setLines((l) => [...l, line('bot',
        `We arrange the vehicle and the chauffeur — ${beyond} is not something we book. ` +
        `If the travel itself is what you need, I can help with:`,
        { chips: asChips(OPENING_SUGGESTIONS.slice(0, 4)) })]);
      return;
    }

    const match = findAnswer(question);
    if (match.kind === 'answer') {
      reply(match.topic);
      return;
    }
    if (match.kind === 'unsure') {
      setLines((l) => [...l, line('bot',
        'I am not certain which one you mean. Is it one of these?',
        { chips: topicChips(match.options) })]);
      return;
    }
    setLines((l) => [...l, line('bot',
      `That one is better answered by a person — I only know what is written on this site. ` +
      `Tap Call to reach ${COMPANY.owner}, or leave your number below and he will call you back.\n\n` +
      `Things I can answer:`,
      { chips: topicChips(match.options) })]);
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
        service: 'Website assistant',
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

                {l.link && (
                  <Link
                    to={l.link.to}
                    onClick={() => setOpen(false)}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
                  >
                    {l.link.label} <IconArrowRight className="h-3 w-3" />
                  </Link>
                )}

                {l.chips && l.chips.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {l.chips.map((c) => (
                      <button
                        key={c.label} type="button" onClick={() => ask(c.label, c.topicId)}
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
                <p className="text-xs font-semibold text-ink-800">Leave your number and we will call you back.</p>
                <input
                  className="input mt-2.5 h-9 text-sm" placeholder="Your name"
                  value={lead.name} onChange={(e) => setLead({ ...lead, name: e.target.value })}
                />
                <input
                  className="input mt-2 h-9 text-sm" placeholder="10-digit mobile" inputMode="numeric"
                  value={lead.mobile} onChange={(e) => setLead({ ...lead, mobile: e.target.value })}
                />
                <textarea
                  className="input mt-2 min-h-[52px] resize-y text-sm" placeholder="What do you need? (optional)"
                  value={lead.message} onChange={(e) => setLead({ ...lead, message: e.target.value })}
                />
                {leadError && <p className="mt-2 text-xs text-danger-600">{leadError}</p>}
                <div className="mt-2.5 flex gap-2">
                  <button type="submit" className="btn-primary btn-sm flex-1" disabled={sending}>
                    {sending ? 'Sending…' : 'Request a callback'}
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
              onSubmit={(e) => { e.preventDefault(); ask(draft); }}
              className="flex items-center gap-2"
            >
              <input
                ref={input}
                className="input h-10 flex-1 text-sm"
                placeholder="Ask about rates, routes, vehicles…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Your question"
              />
              <button type="submit" className="btn-primary h-10 w-10 shrink-0 rounded-lg p-0" aria-label="Send" disabled={!draft.trim()}>
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
