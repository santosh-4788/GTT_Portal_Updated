import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up on mount. Used on the dashboard tiles so figures arrive
 * rather than snapping in.
 *
 * Deliberately cheap: one rAF loop per value, ~550ms, eased, and it respects
 * the reduced-motion preference by jumping straight to the final value.
 */
export function useCountUp(target: number, duration = 550): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number>();

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !Number.isFinite(target) || target === 0) {
      setValue(target || 0);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — fast start, settles softly
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else setValue(target);
    };
    frame.current = requestAnimationFrame(tick);

    return () => { if (frame.current) cancelAnimationFrame(frame.current); };
  }, [target, duration]);

  return value;
}
