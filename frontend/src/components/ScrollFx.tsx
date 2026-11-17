import { useEffect, useRef, useState } from 'react';

/**
 * Scroll motion for the public website. No library, nothing paid.
 *
 *  - <ScrollRoad/>   a thin blue-to-gold road along the bottom of the header
 *                    that fills as the page is read, with a little JustCabs
 *                    cab driving along it (wheels turn while scrolling).
 *  - <BackToTop/>    a round button with a progress ring, shown once the
 *                    reader is a screen or so down the page.
 *
 * One passive scroll listener each, throttled to animation frames, and only
 * transform / stroke values change, so it stays on the compositor. With
 * "reduce motion" on, the cab stays parked and nothing spins.
 */

function useScrollProgress() {
  const [p, setP] = useState(0);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let raf = 0;
    let stop: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setP(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
      setMoving(true);
      if (stop) clearTimeout(stop);
      stop = setTimeout(() => setMoving(false), 180);
    };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (stop) clearTimeout(stop);
    };
  }, []);
  return { p, moving };
}

function MiniCab({ moving }: { moving: boolean }) {
  return (
    <svg viewBox="0 0 64 26" className={`scroll-cab-svg ${moving ? 'is-moving' : ''}`} aria-hidden="true">
      {/* body */}
      <path d="M3 18.5c0-2.6 1.4-4.3 4-4.9l7.5-1.6 7.6-5.6c1.5-1.1 3.2-1.6 5-1.6h12.3c2 0 3.8.7 5.3 2l5.6 5 6 1.3c2.6.6 4.2 2.6 4.2 5.2v1.8c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6v-1.6Z" fill="#fff" stroke="#0E5FC0" strokeWidth="1.4" />
      {/* windows */}
      <path d="M17 12.4l6.4-4.6c1-.7 2.1-1.1 3.3-1.1h3.6v5.7H17Zm15.6 0V6.7h6.3c1.4 0 2.7.5 3.7 1.4l4.4 4.3H32.6Z" fill="#9FD8FF" />
      {/* JustCabs blue stripe + gold roof light */}
      <path d="M5 16.6h54" stroke="#1A8FF0" strokeWidth="2.2" strokeLinecap="round" />
      <rect x="28" y="2" width="8" height="3" rx="1.2" fill="#F2B93B" />
      <circle cx="61" cy="16.5" r="1.3" fill="#FFD66B" />
      {/* wheels */}
      <g className="cab-wheel" style={{ transformOrigin: '16px 21px' }}>
        <circle cx="16" cy="21" r="4.4" fill="#10233F" /><circle cx="16" cy="21" r="1.8" fill="#C9D6E8" />
        <path d="M16 17.2v7.6M12.2 21h7.6" stroke="#C9D6E8" strokeWidth=".8" />
      </g>
      <g className="cab-wheel" style={{ transformOrigin: '49px 21px' }}>
        <circle cx="49" cy="21" r="4.4" fill="#10233F" /><circle cx="49" cy="21" r="1.8" fill="#C9D6E8" />
        <path d="M49 17.2v7.6M45.2 21h7.6" stroke="#C9D6E8" strokeWidth=".8" />
      </g>
    </svg>
  );
}

/** Lives inside the fixed header; absolutely placed along its bottom edge. */
export function ScrollRoad({ show }: { show: boolean }) {
  const { p, moving } = useScrollProgress();
  return (
    <div className={`scroll-road ${show ? 'is-on' : ''}`} aria-hidden="true">
      <div className="scroll-road-fill" style={{ transform: `scaleX(${p})` }} />
      <div className="scroll-road-cab" style={{ left: `calc(${(p * 100).toFixed(2)}% - ${(p * 42).toFixed(1)}px)` }}>
        <MiniCab moving={moving} />
      </div>
    </div>
  );
}

export function BackToTop() {
  const { p } = useScrollProgress();
  const [show, setShow] = useState(false);
  const ring = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const on = () => setShow(window.scrollY > window.innerHeight * 0.9);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const C = 2 * Math.PI * 20;
  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={`back-to-top no-print ${show ? 'is-on' : ''}`}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <defs>
          <linearGradient id="btt-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1A8FF0" /><stop offset="1" stopColor="#F2B93B" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="20" fill="none" stroke="rgb(16 28 43 / .08)" strokeWidth="3" />
        <circle ref={ring} cx="24" cy="24" r="20" fill="none" stroke="url(#btt-grad)" strokeWidth="3" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
      </svg>
      <svg viewBox="0 0 24 24" className="relative h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
      </svg>
    </button>
  );
}
