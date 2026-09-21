import { useEffect, useRef, useState } from 'react';

/* ==========================================================================
   The ride, as it actually happens.

   Booked → cab arriving → picked up → on the way → dropped, then it loops.
   The cab's position is read off the real SVG path with getPointAtLength, so
   it follows the curve exactly and scales with the panel. Position is written
   straight to the element's transform rather than through React state, so the
   loop never re-renders the tree; only the phase change does, five times a
   cycle.
   ========================================================================== */

export const HERO_TRIP = {
  pickup: 'Andheri East',
  drop: 'Pune',
  vehicle: 'MH47BL1566',
  distance: '150 km',
  duration: '≈3 hrs',
  fare: '₹1,155 all-in',
  eta: '2 min away',
  driver: 'Ramesh Y.',
};

/** The whole journey. The first stretch is the cab coming to the pickup. */
const PATH_D =
  'M34 268 C 44 250, 52 250, 62 252 C 132 254, 148 186, 220 172 S 330 152, 356 100 C 370 72, 396 62, 420 62';

/** Where along the path the pickup sits (0–1). Before this, the cab is arriving. */
const PICKUP_AT = 0.12;

type PhaseKey = 'booked' | 'arriving' | 'pickup' | 'onroute' | 'dropped';

interface Phase {
  key: PhaseKey;
  ms: number;
  from: number;
  to: number;
  title: string;
  body: string;
  tone: string;
  icon: 'check' | 'clock' | 'pin' | 'car' | 'rupee';
}

const PHASES: Phase[] = [
  { key: 'booked',   ms: 1600, from: 0, to: 0, title: 'Booking confirmed', body: `${HERO_TRIP.vehicle} assigned`, tone: 'grad-brand text-white', icon: 'check' },
  { key: 'arriving', ms: 3200, from: 0, to: PICKUP_AT, title: 'Cab arriving', body: HERO_TRIP.eta, tone: 'bg-brand-50 text-brand-600', icon: 'clock' },
  { key: 'pickup',   ms: 1600, from: PICKUP_AT, to: PICKUP_AT, title: 'Picked up', body: HERO_TRIP.pickup, tone: 'bg-brand-50 text-brand-600', icon: 'pin' },
  { key: 'onroute',  ms: 5400, from: PICKUP_AT, to: 1, title: 'On the way', body: `${HERO_TRIP.distance} · ${HERO_TRIP.duration}`, tone: 'bg-brand-50 text-brand-600', icon: 'car' },
  { key: 'dropped',  ms: 2600, from: 1, to: 1, title: 'Trip complete', body: HERO_TRIP.fare, tone: 'bg-ok-50 text-ok-600', icon: 'rupee' },
];

const STEPS = ['Booked', 'Arriving', 'Picked up', 'On the way', 'Dropped'];

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function PhaseIcon({ name }: { name: Phase['icon'] }) {
  const common = { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'check') return <svg {...common}><path d="m5 12.5 4.5 4.5L19 7" /></svg>;
  if (name === 'clock') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 1.9" /></svg>;
  if (name === 'pin') return <svg {...common}><path d="M20 10.2c0 5.4-8 11.3-8 11.3s-8-5.9-8-11.3a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="2.6" /></svg>;
  if (name === 'rupee') return <svg {...common}><path d="M8 6h8M8 10h8M14.5 6c1.8 0 2.5 1.2 2.5 2s-.7 2-2.5 2H8l6 8" /></svg>;
  return (
    <svg {...common}>
      <path d="M4 16v2.5M20 16v2.5M5 16h14a1 1 0 0 0 1-1v-3.2a2 2 0 0 0-.4-1.2L17 7.2A2 2 0 0 0 15.4 6H8.6A2 2 0 0 0 7 7.2L4.4 10.6A2 2 0 0 0 4 11.8V15a1 1 0 0 0 1 1Z" />
      <path d="M7.5 13h1M15.5 13h1" />
    </svg>
  );
}

export function HeroJourney({ className = '' }: { className?: string }) {
  const pathRef = useRef<SVGPathElement>(null);
  const cabRef = useRef<SVGGElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const path = pathRef.current;
    const cab = cabRef.current;
    if (!path || !cab) return;

    const total = path.getTotalLength();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const place = (p: number) => {
      const at = path.getPointAtLength(p * total);
      const ahead = path.getPointAtLength(Math.min(total, p * total + 2));
      const angle = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
      cab.setAttribute('transform', `translate(${at.x} ${at.y}) rotate(${angle})`);
      // the travelled part of the route fills in behind the cab
      if (trailRef.current) {
        trailRef.current.style.strokeDasharray = `${p * total} ${total}`;
      }
    };

    if (reduced) {
      setPhase(3);
      place(0.62);
      return;
    }

    let raf = 0;
    let index = 0;
    let start = performance.now();
    setPhase(0);

    const tick = (now: number) => {
      const p = PHASES[index];
      const t = Math.min(1, (now - start) / p.ms);
      place(p.from + (p.to - p.from) * easeInOut(t));

      if (t >= 1) {
        index = (index + 1) % PHASES.length;
        start = now;
        setPhase(index);
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = PHASES[phase];

  return (
    <div className={`relative ${className}`}>
      <div className="grad-soft absolute inset-0 rounded-[2rem] sm:rounded-[2.25rem]" aria-hidden="true" />

      <svg viewBox="0 0 480 320" className="relative h-full w-full" role="img"
        aria-label={`Ride from ${HERO_TRIP.pickup} to ${HERO_TRIP.drop}: ${current.title}`}>
        <defs>
          <linearGradient id="tripGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#35C0EE" />
            <stop offset="100%" stopColor="#2E86F0" />
          </linearGradient>
        </defs>

        {/* a hint of streets and blocks, kept very faint */}
        <g stroke="#2E86F0" strokeOpacity=".08" strokeWidth="1.5">
          <path d="M0 108h480M0 214h480M120 0v320M288 0v320M392 0v320" />
        </g>
        <g fill="#2E86F0" fillOpacity=".05">
          <rect x="142" y="34" width="82" height="52" rx="8" />
          <rect x="310" y="128" width="62" height="60" rx="8" />
          <rect x="24" y="130" width="70" height="58" rx="8" />
          <rect x="150" y="238" width="96" height="56" rx="8" />
        </g>

        {/* the route ahead, then the part already travelled */}
        <path ref={pathRef} d={PATH_D} fill="none" stroke="#2E86F0" strokeOpacity=".16"
          strokeWidth="9" strokeLinecap="round" />
        <path ref={trailRef} d={PATH_D} fill="none" stroke="url(#tripGrad)" strokeWidth="4"
          strokeLinecap="round" style={{ strokeDasharray: '0 9999' }} />

        {/* pickup */}
        <g>
          <circle cx="62" cy="252" r="11" fill="#2E86F0" fillOpacity=".25" className="trip-pulse" />
          <circle cx="62" cy="252" r="8.5" fill="#fff" />
          <circle cx="62" cy="252" r="4.2" fill="#2E86F0" />
        </g>

        {/* drop */}
        <g>
          <path d="M420 44a11 11 0 0 0-11 11c0 8 11 18 11 18s11-10 11-18a11 11 0 0 0-11-11Z" fill="#0F1B2D" />
          <circle cx="420" cy="55" r="4.2" fill="#fff" />
        </g>

        {/* the cab */}
        <g ref={cabRef}>
          <g transform="translate(-17,-9)">
            <rect x="0" y="0" width="34" height="18" rx="7" fill="#0F1B2D" />
            <rect x="5" y="4" width="24" height="6.5" rx="3" fill="#4DD0F5" />
            <circle cx="10" cy="17" r="3" fill="#0F1B2D" />
            <circle cx="24" cy="17" r="3" fill="#0F1B2D" />
          </g>
        </g>
      </svg>

      {/* ---------- place labels ---------- */}
      {/* hidden on phones: the docked status card occupies this corner, and the
          booking bar directly below already names the pickup */}
      <span className="absolute bottom-[13%] left-[4%] hidden items-center gap-2 rounded-full bg-white px-2.5 py-1 shadow-card sm:flex sm:px-3 sm:py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
        <span className="text-2xs font-semibold text-ink-700">{HERO_TRIP.pickup}</span>
      </span>

      <span className="absolute right-[3%] top-[5%] flex items-center gap-1.5 rounded-full bg-ink-900 px-2.5 py-1 shadow-card sm:px-3 sm:py-1.5">
        <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4"
          className="text-brand-300" strokeLinecap="round">
          <path d="M20 10.2c0 5.4-8 11.3-8 11.3s-8-5.9-8-11.3a8 8 0 0 1 16 0Z" />
        </svg>
        <span className="text-2xs font-semibold text-white">{HERO_TRIP.drop}</span>
      </span>

      {/* ---------- live status ----------
          On phones this docks along the bottom as one card, the way a ride app
          shows it. From sm up it floats over the map with the extra detail. */}
      <div className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-auto sm:left-[4%] sm:top-[7%] sm:w-auto">
        <div key={current.key} className="animate-fade-up flex items-center gap-3 rounded-2xl bg-white/95 px-3.5 py-2.5 backdrop-blur"
          style={{ boxShadow: '0 2px 6px rgba(15,27,45,.05), 0 18px 40px -22px rgba(15,27,45,.4)' }}>
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${current.tone}`}>
            <PhaseIcon name={current.icon} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-2xs font-medium text-ink-500">{current.title}</span>
            <span className="block truncate text-sm font-bold text-ink-900">{current.body}</span>
          </span>
          <span className="shrink-0 rounded-full bg-ink-50 px-2 py-0.5 text-2xs font-semibold tabular-nums text-ink-500 sm:hidden">
            {phase + 1}/{PHASES.length}
          </span>
        </div>
      </div>

      {/* extra detail cards — desktop only, to keep phones uncluttered */}
      <div className="absolute left-[6%] top-[36%] hidden items-center gap-3 rounded-2xl bg-white/95 px-3.5 py-2.5 backdrop-blur sm:flex"
        style={{ boxShadow: '0 2px 6px rgba(15,27,45,.05), 0 18px 40px -22px rgba(15,27,45,.4)' }}>
        <span className="grad-brand grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white">
          <PhaseIcon name="car" />
        </span>
        <span>
          <span className="block whitespace-nowrap text-2xs font-medium text-ink-500">Vehicle · {HERO_TRIP.driver}</span>
          <span className="block whitespace-nowrap text-sm font-bold text-ink-900">{HERO_TRIP.vehicle}</span>
        </span>
      </div>

      {/* Trip length lives on the route itself while the cab is still coming;
          once it is on the way the status card carries it, so this steps aside
          rather than saying the same thing twice. */}
      <span
        className={`absolute left-1/2 top-[47%] hidden -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-2xs font-semibold tabular-nums text-ink-600 shadow-card backdrop-blur transition-opacity duration-500 sm:block ${
          current.key === 'onroute' ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {HERO_TRIP.distance} · {HERO_TRIP.duration}
      </span>

      {/* ---------- stepper: makes the sequence legible ---------- */}
      <div className="absolute inset-x-0 -bottom-9 hidden justify-center gap-1.5 sm:flex">
        {STEPS.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <span
              className={`h-1.5 rounded-full transition-all duration-500 ease-smooth ${
                i === phase ? 'w-7 bg-brand-500' : i < phase ? 'w-1.5 bg-brand-300' : 'w-1.5 bg-ink-200'
              }`}
            />
          </span>
        ))}
        <span className="ml-2 text-2xs font-semibold text-ink-500">{STEPS[phase]}</span>
      </div>
    </div>
  );
}
