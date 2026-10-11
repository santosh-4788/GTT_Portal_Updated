/**
 * Portal language — English or Hindi, chosen from the user menu.
 *
 * The choice is kept on the user (PUT /auth/language) so it follows them to
 * another browser and to the phone app, and in localStorage so the first
 * paint is already in the right language.
 *
 * How the Hindi gets onto the screen: rather than threading a t() call through
 * every one of the portal's screens, a single observer watches the staff
 * portal's DOM and swaps any text node or label attribute whose whole text is
 * a known English phrase (lib/hi.ts) for its Hindi. It only ever replaces a
 * complete label, so a phrase that is not in the dictionary stays in English
 * instead of becoming a half-translated sentence, and it never touches what
 * people type (inputs and text areas) or anything marked data-no-i18n.
 *
 * React keeps working because the node is edited in place (nodeValue), not
 * replaced: when React later changes the text, the observer sees the new
 * English and translates that. Switching back to English restores every node
 * from the original it recorded.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { HI as HI1 } from './hi';
import { HI2 } from './hi2';

/** Both batches; the first wins where they overlap. */
const HI: Record<string, string> = { ...HI2, ...HI1 };

export type Lang = 'en' | 'hi';
const KEY = 'gtt.lang';

const readStored = (): Lang => {
  try { return localStorage.getItem(KEY) === 'hi' ? 'hi' : 'en'; } catch { return 'en'; }
};

interface I18nCtx { lang: Lang; setLang: (l: Lang) => Promise<void>; t: (s: string) => string }
const Ctx = createContext<I18nCtx>({ lang: 'en', setLang: async () => {}, t: (s) => s });
export const useI18n = () => useContext(Ctx);

/** Translate one phrase, keeping surrounding whitespace and a trailing mark (…, :, *, →). */
export function translate(text: string): string | null {
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!m) return null;
  const [, lead, core, trail] = m;
  if (!core) return null;
  const hit = HI[core];
  if (hit) return lead + hit + trail;
  const tail = core.match(/^(.*?)(\s*(?:…|:|\*|→|\?|\.))$/);
  if (tail && HI[tail[1]]) return lead + HI[tail[1]] + tail[2] + trail;
  return null;
}

const ATTRS = ['placeholder', 'title', 'aria-label'];
const SKIP = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT']);

/** text node -> [original English, the Hindi we put there] */
const done = new Map<Text, [string, string]>();

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-no-i18n') || (e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

function translateText(node: Text) {
  const value = node.nodeValue ?? '';
  const prev = done.get(node);
  if (prev && value === prev[1]) return;                 // our own write
  const hi = translate(value);
  if (!hi || skipped(node.parentElement)) { if (prev) done.delete(node); return; }
  done.set(node, [value, hi]);
  node.nodeValue = hi;
}

function translateAttrs(el: Element) {
  if (skipped(el.parentElement) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const orig = el.getAttribute(`data-i18n-${a}`);
    if (orig !== null && v === HI[orig]) continue;
    const hi = translate(v);
    if (hi) { el.setAttribute(`data-i18n-${a}`, v.trim()); el.setAttribute(a, hi); }
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { translateText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP.has(el.tagName) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
  translateAttrs(el);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n as Text);
    else translateAttrs(n as Element);
  }
}

function restoreAll() {
  for (const [node, [en]] of done) if (node.isConnected) node.nodeValue = en;
  done.clear();
  document.querySelectorAll('[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]').forEach((el) => {
    for (const a of ATTRS) {
      const orig = el.getAttribute(`data-i18n-${a}`);
      if (orig !== null) { el.setAttribute(a, orig); el.removeAttribute(`data-i18n-${a}`); }
    }
  });
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth() as any;
  const [lang, setLangState] = useState<Lang>(readStored);

  // The account's own choice wins once it is known.
  useEffect(() => {
    if (user?.language === 'hi' || user?.language === 'en') {
      setLangState(user.language);
      try { localStorage.setItem(KEY, user.language); } catch { /* per-browser only */ }
    }
  }, [user?.language]);

  const setLang = useCallback(async (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* per-browser only */ }
    if (user) {
      try { await api.put('/auth/language', { language: l }); await refresh?.(); } catch { /* still applied locally */ }
    }
  }, [user, refresh]);

  useEffect(() => {
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en';
    document.documentElement.classList.toggle('lang-hi', lang === 'hi');
    if (lang !== 'hi') { restoreAll(); return; }
    walk(document.body);
    const obs = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'characterData') translateText(m.target as Text);
        else if (m.type === 'attributes') translateAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    // Forget nodes React has thrown away, so the map does not grow all day.
    const sweep = setInterval(() => { for (const n of done.keys()) if (!n.isConnected) done.delete(n); }, 60_000);
    return () => { obs.disconnect(); clearInterval(sweep); };
  }, [lang]);

  const t = useCallback((s: string) => (lang === 'hi' ? translate(s) ?? s : s), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The two-button switch used in the user menu and the phone app's More sheet. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`flex items-center gap-1 rounded-full bg-ink-100 p-1 ${className}`} role="radiogroup" aria-label="Language" data-no-i18n>
      {([['en', 'English'], ['hi', 'हिन्दी']] as const).map(([code, label]) => (
        <button key={code} type="button" role="radio" aria-checked={lang === code}
          onClick={() => setLang(code)}
          className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${lang === code ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}
