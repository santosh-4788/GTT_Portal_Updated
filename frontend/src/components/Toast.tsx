import { createContext, useCallback, useContext, useState, ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: Kind; title: string; body?: string }

const ToastCtx = createContext<{
  push: (kind: Kind, title: string, body?: string) => void;
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
  warning: (title: string, body?: string) => void;
}>({ push: () => {}, success: () => {}, error: () => {}, info: () => {}, warning: () => {} });

export const useToast = () => useContext(ToastCtx);

const STYLE: Record<Kind, { bar: string; icon: string; glyph: string }> = {
  success: { bar: 'bg-ok-500', icon: 'text-ok-600 bg-ok-50', glyph: '✓' },
  error: { bar: 'bg-danger-500', icon: 'text-danger-600 bg-danger-50', glyph: '!' },
  info: { bar: 'bg-brand-500', icon: 'text-brand-600 bg-brand-50', glyph: 'i' },
  warning: { bar: 'bg-warn-500', icon: 'text-warn-600 bg-warn-50', glyph: '!' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, title: string, body?: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, title, body }]);
    // Errors linger — the operator may need to read a validation message.
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 5000);
  }, []);

  const value = {
    push,
    success: (t: string, b?: string) => push('success', t, b),
    error: (t: string, b?: string) => push('error', t, b),
    info: (t: string, b?: string) => push('info', t, b),
    warning: (t: string, b?: string) => push('warning', t, b),
  };

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 no-print">
        {items.map((t) => {
          const s = STYLE[t.kind];
          return (
            <div key={t.id} className="animate-slide-in card flex overflow-hidden shadow-lift">
              <div className={`w-1 shrink-0 ${s.bar}`} />
              <div className="flex gap-3 p-3.5">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.icon}`}>
                  {s.glyph}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{t.title}</p>
                  {t.body && <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-ink-600">{t.body}</p>}
                </div>
                <button
                  onClick={() => setItems((p) => p.filter((x) => x.id !== t.id))}
                  className="ml-auto shrink-0 self-start text-ink-400 hover:text-ink-700"
                  aria-label="Dismiss"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
