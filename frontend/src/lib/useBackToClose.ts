import { useEffect, useRef } from 'react';

/**
 * Let the phone's Back button close an open sheet or panel, instead of
 * leaving the page underneath it.
 *
 * Opening adds one history entry for the same address, marked as ours. Back
 * pops it and we close. Closing any other way (the X, the backdrop, Escape,
 * Apply) takes that entry off again, so the history stays exactly as it was
 * and the next Back leaves the page as normal.
 *
 * `onClosed` runs once the history is back in place. Anything that changes
 * the address as the panel closes (Apply writing the new trip into the URL)
 * belongs there: done any earlier, it would replace our entry and leave a
 * stray copy of the old page behind it.
 *
 * A link inside the panel should navigate with `replace`, for the same
 * reason - it then takes the place of our entry rather than stacking on it.
 */
export function useBackToClose(open: boolean, onClose: () => void, onClosed?: () => void) {
  const close = useRef(onClose);
  const closed = useRef(onClosed);
  close.current = onClose;
  closed.current = onClosed;

  useEffect(() => {
    if (!open) return;
    const mark = `panel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const ours = () => (window.history.state as { gttPanel?: string } | null)?.gttPanel === mark;
    window.history.pushState({ ...(window.history.state ?? {}), gttPanel: mark }, '');

    let poppedByBack = false;
    const onPop = () => {
      if (ours()) return;
      poppedByBack = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!poppedByBack && ours()) {
        // Take our entry off, then report once the browser has done it.
        const done = () => { window.removeEventListener('popstate', done); closed.current?.(); };
        window.addEventListener('popstate', done);
        window.history.back();
      } else {
        closed.current?.();
      }
    };
  }, [open]);
}
