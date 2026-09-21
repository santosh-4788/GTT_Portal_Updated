/**
 * Vehicle artwork — one studio shot per vehicle, drawn rather than photographed.
 *
 * WHAT THIS IS
 *
 * Every vehicle on the site is shown the same way: a rear three-quarter view on
 * a blue studio backdrop, lit from above, standing on a glossy floor, with the
 * vehicle's name on its number plate. That is the format the owner asked for,
 * and it is the one thing a folder of stock photographs can never give — a
 * photo of a white Ertiga shot in a field cannot carry the words "Ertiga" on
 * its plate, and seven photos shot by seven people never match each other.
 *
 * HOW IT IS BUILT
 *
 * One projection for the whole drawing. A point on a vehicle is three numbers:
 *
 *   t  how far along its length   (0 at the rear face, 1 at the nose)
 *   u  how far across its width   (0 at the near corner, 1 at the far side)
 *   h  how high above the sill    (0 at the sill, up)
 *
 * and `project` turns those into x/y, converging everything on one horizon.
 * That is why the panels agree with each other: the roof, the rear window and
 * the boot lid are not three drawings that happen to line up, they are three
 * surfaces measured in the same space. A silhouette per vehicle class is then
 * just a list of (t, h) pairs along its profile — see SHAPES.
 *
 * The camera sits at window height (Y0), below every roof in the fleet. That is
 * deliberate: raise it and you start to see the roof and the boot lid as broad
 * flat surfaces, and a sedan promptly reads as a pickup truck with a tonneau
 * cover over the bed. It also means a full-width surface like the rear window
 * has to be inset between body-coloured pillars, or the same thing happens —
 * see `glassPanel` below.
 */
import { useId } from 'react';

export type CarVariant = 'sedan' | 'mpv' | 'suv' | 'van' | 'bus';

const Y0 = 66;    // horizon: camera at window height, below every roof
const SILL = 160; // sill y at the near rear corner
const NX = 168;   // near rear corner x
const RX = 298;   // far rear corner x — the vehicle's right side
const KF = 0.74;  // how much the far end of the length axis shrinks
const KR = 0.88;  // how much the far side of the width axis shrinks
const U = 0.94;   // where a full-width surface stops, just short of the far edge

const sF = (t: number) => 1 - (1 - KF) * t;
const sR = (u: number) => 1 - (1 - KR) * u;

/** A point on the profile: how far along, how high. */
type Pt = [t: number, h: number];

interface Shape {
  /** Length of the visible flank, in viewBox units. */
  flank: number;
  wheelR: number;
  /** Where the two visible wheels sit along the flank. */
  wheels: [number, number];
  /** Roof height, and the height of the rear face's top edge — the same on a
   *  one-box vehicle, the boot lid on a sedan. */
  topH: number;
  rearTop: number;
  /** Window base and window top. */
  belt: number;
  glassTop: number;
  /** The silhouette, rear corner to nose. */
  top: Pt[];
  /** Where it turns down at the front. */
  nose: Pt[];
  /** Sedans only: where the boot lid ends and the backlight begins. */
  deck: [number, number] | null;
  /** The stretch of roof that is one flat surface. */
  roof: [number, number];
  /** Side glass, pane by pane. */
  windows: [number, number][];
  doors: number[];
  /** Tail lamp top and bottom. */
  lampH: [number, number];
}

/**
 * Proportions, not sketches. Each class is measured against its own rear face:
 * the width of the rear face is about 1.8 m of vehicle, so an Innova at 1.8 m
 * tall is as tall as it is wide (124 against 130) while a Dzire at 1.53 m is
 * noticeably squatter. Getting this ratio wrong is what makes an illustrated
 * car look like a bus — the first attempt had every body drawn far too low for
 * its width, and all five read as coaches seen from behind.
 */
const SHAPES: Record<CarVariant, Shape> = {
  sedan: {
    flank: 126, wheelR: 21, wheels: [0.13, 0.78], topH: 104, belt: 62, glassTop: 100,
    top: [[0, 66], [0.05, 68], [0.12, 69], [0.28, 100], [0.56, 104], [0.72, 66], [0.88, 56], [0.96, 50]],
    nose: [[1, 40], [1, 12]],
    rearTop: 66, deck: [0.12, 0.28], roof: [0.28, 0.56],
    windows: [[0.32, 0.46], [0.48, 0.62]], doors: [0.47, 0.64],
    lampH: [40, 62],
  },
  mpv: {
    flank: 130, wheelR: 22, wheels: [0.14, 0.79], topH: 116, belt: 68, glassTop: 110,
    top: [[0, 116], [0.05, 118], [0.14, 119], [0.62, 119], [0.74, 96], [0.88, 70], [0.97, 60]],
    nose: [[1, 48], [1, 12]],
    rearTop: 116, deck: null, roof: [0.14, 0.62],
    windows: [[0.10, 0.25], [0.28, 0.44], [0.47, 0.62]], doors: [0.44, 0.64],
    lampH: [66, 100],
  },
  suv: {
    flank: 134, wheelR: 24, wheels: [0.15, 0.80], topH: 124, belt: 72, glassTop: 118,
    top: [[0, 124], [0.05, 126], [0.14, 127], [0.64, 127], [0.76, 104], [0.90, 76], [0.97, 66]],
    nose: [[1, 52], [1, 14]],
    rearTop: 124, deck: null, roof: [0.14, 0.64],
    windows: [[0.10, 0.25], [0.28, 0.45], [0.48, 0.64]], doors: [0.45, 0.66],
    lampH: [70, 108],
  },
  van: {
    flank: 142, wheelR: 22, wheels: [0.13, 0.81], topH: 142, belt: 78, glassTop: 136,
    top: [[0, 142], [0.04, 144], [0.10, 145], [0.74, 145], [0.84, 138], [0.92, 90], [0.98, 76]],
    nose: [[1, 62], [1, 12]],
    rearTop: 142, deck: null, roof: [0.10, 0.74],
    windows: [[0.08, 0.22], [0.25, 0.39], [0.42, 0.56], [0.59, 0.73]], doors: [0.39, 0.58],
    lampH: [76, 124],
  },
  bus: {
    flank: 150, wheelR: 23, wheels: [0.12, 0.83], topH: 152, belt: 84, glassTop: 146,
    top: [[0, 152], [0.03, 154], [0.08, 155], [0.92, 155], [0.98, 146]],
    nose: [[1, 136], [1, 14]],
    rearTop: 152, deck: null, roof: [0.08, 0.92],
    windows: [[0.06, 0.19], [0.22, 0.35], [0.38, 0.51], [0.54, 0.67], [0.70, 0.83]], doors: [0.70],
    lampH: [82, 134],
  },
};

type XY = [number, number];

function project(s: Shape, t: number, u: number, h: number): XY {
  const k = sF(t) * sR(u);
  return [
    NX - s.flank * t * sR(u) + (RX - NX) * u * sF(t),
    Y0 + (SILL - h - Y0) * k,
  ];
}
const fmt = (q: XY) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
const poly = (pts: XY[]) => `M${pts.map(fmt).join('L')}Z`;

/**
 * A number plate holds about eleven characters on one line. Longer names split
 * across two, at whichever gap leaves the halves closest in length — "Toyota /
 * Innova Crysta" rather than "Toyota Innova / Crysta". Whatever the split, each
 * line is then stretched to the plate's width, so nothing ever overflows it.
 */
function plateLines(name: string): string[] {
  const words = name.trim().split(/\s+/);
  if (name.length <= 11 || words.length === 1) return [name.toUpperCase()];
  let at = 1;
  let gap = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    if (Math.abs(a - b) < gap) { gap = Math.abs(a - b); at = i; }
  }
  return [words.slice(0, at).join(' ').toUpperCase(), words.slice(at).join(' ').toUpperCase()];
}

export function CarArt({
  variant, name = '', className = '',
}: {
  variant: CarVariant;
  /** Goes on the number plate. */
  name?: string;
  className?: string;
}) {
  const s = SHAPES[variant];
  /**
   * Gradient ids have to be unique per INSTANCE, not per class.
   *
   * They were `sky-bus`, `side-bus` and so on, which broke the moment a page
   * drew the same class twice. A page that stacks a mobile layout and a desktop
   * layout — the comparison page does — has one of the two hidden, and Blink
   * builds no paint resources inside a `display:none` subtree. `url(#sky-bus)`
   * still resolves by id to that hidden copy, finds nothing, and paints no
   * fill: every gradient vanished and the coach came out as a bare outline.
   */
  const id = variant + useId().replace(/[^a-zA-Z0-9]/g, '');
  const edge = '#8AA2B9';

  const pf = (t: number, h: number) => project(s, t, 0, h);
  const pr = (u: number, h: number) => project(s, 0, u, h);

  const flank =
    `M${fmt(pf(0, 0))}`
    + s.top.map(([t, h]) => `L${fmt(pf(t, h))}`).join('')
    + s.nose.map(([t, h]) => `L${fmt(pf(t, h))}`).join('')
    + `L${fmt(pf(1, 0))}Z`;

  const rear =
    `M${fmt(pr(0, 0))}L${fmt(pr(0, s.rearTop - 10))}`
    + `Q${fmt(pr(0, s.rearTop))} ${fmt(pr(0.07, s.rearTop))}`
    + `L${fmt(pr(0.93, s.rearTop))}`
    + `Q${fmt(pr(1, s.rearTop))} ${fmt(pr(1, s.rearTop - 10))}`
    + `L${fmt(pr(1, 0))}Z`;

  /** A surface that spans the vehicle's width: the near edge runs along the
   *  flank, the far edge is that same edge again at the other side. */
  const span = (a: Pt, b: Pt, u0 = 0, u1 = U) => poly([
    project(s, a[0], u0, a[1]), project(s, b[0], u0, b[1]),
    project(s, b[0], u1, b[1]), project(s, a[0], u1, a[1]),
  ]);

  const deck = s.deck ? span([s.deck[0], s.top[2][1]], [0, s.rearTop]) : '';
  /* The backlight sits INSIDE its panel, with body-coloured pillars either
     side. Spanning the full width instead, which is what a rear window really
     does, drew one black slab from roof to boot and every sedan turned into a
     pickup truck. */
  const glassPanel = s.deck ? span([s.deck[0], s.top[2][1] + 2], [s.deck[1], s.glassTop]) : '';
  const backlight = s.deck
    ? span([s.deck[0] + 0.015, s.top[2][1] + 5], [s.deck[1] - 0.015, s.glassTop - 3], 0.10, 0.84)
    : '';
  const roofTop = span([s.roof[0], s.topH - 1], [s.roof[1], s.topH]);

  const panes = s.windows.map(([a, b]) => {
    // the glass follows the roof down over the bonnet
    const top = (x: number) => s.glassTop - (x > 0.62 ? (x - 0.62) * 70 : 0);
    return poly([pf(a, s.belt), pf(a, top(a)), pf(b, top(b)), pf(b, s.belt)]);
  });

  const rearGlass = s.deck ? '' : poly([
    pr(0.20, s.belt + 10), pr(0.20, s.rearTop - 14),
    pr(0.80, s.rearTop - 14), pr(0.80, s.belt + 10),
  ]);

  const lamps = [[0.04, 0.17], [0.83, 0.96]].map(([a, b]) => poly([
    pr(a, s.lampH[0]), pr(a, s.lampH[1]), pr(b, s.lampH[1]), pr(b, s.lampH[0]),
  ]));

  const bumper = poly([pr(0, 4), pr(0, 36), pr(1, 36), pr(1, 4)]);
  const valance = poly([pr(0.10, 4), pr(0.10, 15), pr(0.90, 15), pr(0.90, 4)]);

  // the plate, and the skew that sets its text on the same plane as the panel
  const plate: XY[] = [pr(0.30, 10), pr(0.70, 10), pr(0.70, 31), pr(0.30, 31)];
  const skew = Math.atan2(plate[1][1] - plate[0][1], plate[1][0] - plate[0][0]) * 180 / Math.PI;
  const px = (plate[0][0] + plate[1][0]) / 2;
  const py = (plate[0][1] + plate[2][1]) / 2;
  const pw = plate[1][0] - plate[0][0] - 11;
  const lines = plateLines(name || variant);

  const wheels = s.wheels.map((t) => {
    const [x, y] = pf(t, 0);
    const r = s.wheelR * sF(t);
    return { x, y: y - r * 0.22, r };
  });

  const doors = s.doors.map((t) => `M${fmt(pf(t, 8))}L${fmt(pf(t, s.belt - 2))}`);
  const shoulder = `M${fmt(pf(0.03, s.belt - 8))}L${fmt(pf(0.95, s.belt - 9))}`;

  return (
    <svg
      /* The 16 units of sky above y=0 are headroom, not decoration: cards crop
         this to windows as wide as 16:9, always off the top and bottom, and
         without it the coach loses its roof in the widest of them. */
      viewBox="0 -16 340 232"
      className={className}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={name ? `${name}, rear three-quarter view` : `${variant} illustration`}
    >
      <defs>
        <linearGradient id={`sky-${id}`} x1="0.1" y1="0" x2="0.55" y2="1">
          <stop offset="0%" stopColor="#E8F2FB" />
          <stop offset="38%" stopColor="#B7D6EE" />
          <stop offset="100%" stopColor="#7BAFDA" />
        </linearGradient>
        <radialGradient id={`pool-${id}`} cx="0.48" cy="0.5" r="0.6">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`floor-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6BA3D1" />
          <stop offset="55%" stopColor="#A6CBE8" />
          <stop offset="100%" stopColor="#D8E9F6" />
        </linearGradient>

        {/* Light from the upper left: the flank catches it, the rear face does
            not, and the difference between the two is what turns the near
            corner into a corner. */}
        <linearGradient id={`side-${id}`} x1="0.15" y1="0" x2="0.45" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor="#F5F9FC" />
          <stop offset="76%" stopColor="#D4E0EC" />
          <stop offset="100%" stopColor="#AEC1D4" />
        </linearGradient>
        <linearGradient id={`back-${id}`} x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#E7EFF7" />
          <stop offset="52%" stopColor="#CBDAE8" />
          <stop offset="100%" stopColor="#9FB6CB" />
        </linearGradient>

        <linearGradient id={`glass-${id}`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#56728F" />
          <stop offset="100%" stopColor="#121D29" />
        </linearGradient>
        <linearGradient id={`lamp-${id}`} x1="0" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stopColor="#FFA48E" />
          <stop offset="45%" stopColor="#E14A3C" />
          <stop offset="100%" stopColor="#8E1F22" />
        </linearGradient>
        <linearGradient id={`rim-${id}`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#FBFDFF" />
          <stop offset="100%" stopColor="#9FB2C6" />
        </linearGradient>
        <radialGradient id={`shade-${id}`}>
          <stop offset="0%" stopColor="#0F3557" stopOpacity="0.5" />
          <stop offset="62%" stopColor="#0F3557" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0F3557" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`fade-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <mask id={`mirror-${id}`}>
          <rect x="0" y="158" width="340" height="58" fill={`url(#fade-${id})`} />
        </mask>
        <clipPath id={`flank-${id}`}><path d={flank} /></clipPath>
      </defs>

      {/* the studio: sky, a suggestion of city, two light streaks, a floor */}
      <rect y="-16" width="340" height="232" fill={`url(#sky-${id})`} />
      <g opacity="0.13" fill="#3D7CAE">
        <rect x="8" y="26" width="30" height="82" rx="2" />
        <rect x="44" y="48" width="20" height="60" rx="2" />
        <rect x="70" y="14" width="24" height="94" rx="2" />
        <rect x="250" y="34" width="26" height="74" rx="2" />
        <rect x="282" y="18" width="20" height="90" rx="2" />
        <rect x="308" y="46" width="30" height="62" rx="2" />
      </g>
      <g opacity="0.16" fill="#FFFFFF">
        <path d="M56 0h30L40 158H12Z" />
        <path d="M300 0h18l-30 158h-14Z" />
      </g>
      <rect y="158" width="340" height="58" fill={`url(#floor-${id})`} />
      <ellipse cx="168" cy="160" rx="190" ry="32" fill={`url(#pool-${id})`} />

      {/* the vehicle again, upside down and fading out: a glossy floor */}
      <g mask={`url(#mirror-${id})`} transform="translate(0 316) scale(1 -1)" opacity="0.4">
        <path d={flank} fill="#BFD1E2" />
        <path d={rear} fill="#A9BED2" />
      </g>
      {wheels.map((w) => (
        <ellipse
          key={`sh${w.x}`} cx={w.x.toFixed(1)} cy={(w.y + w.r * 1.02).toFixed(1)}
          rx={(w.r * 2.2).toFixed(1)} ry={(w.r * 0.4).toFixed(1)} fill={`url(#shade-${id})`}
        />
      ))}

      {/* Surfaces, furthest first: rear face, roof, rear window, boot lid, then
          the flank over the top of all of them. */}
      <path d={rear} fill={`url(#back-${id})`} stroke={edge} strokeWidth="0.9" strokeLinejoin="round" />
      <path d={roofTop} fill="#F7FAFD" stroke={edge} strokeWidth="0.7" />
      {glassPanel && <path d={glassPanel} fill={`url(#back-${id})`} stroke={edge} strokeWidth="0.7" />}
      {backlight && <path d={backlight} fill={`url(#glass-${id})`} />}
      {deck && <path d={deck} fill={`url(#back-${id})`} stroke={edge} strokeWidth="0.7" />}

      <path d={flank} fill={`url(#side-${id})`} stroke={edge} strokeWidth="0.9" strokeLinejoin="round" />
      <g clipPath={`url(#flank-${id})`}>
        {/* wheel arches: a recess cut into the sill, not a disc sat on it */}
        {wheels.map((w) => (
          <path
            key={`ar${w.x}`}
            d={`M${(w.x - w.r * 0.94).toFixed(1)} ${(w.y + 4).toFixed(1)}`
              + `a${(w.r * 0.94).toFixed(1)} ${(w.r * 1.06).toFixed(1)} 0 0 1 ${(w.r * 1.88).toFixed(1)} 0Z`}
            fill="#1D3348" opacity="0.32"
          />
        ))}
        {panes.map((d, i) => <path key={i} d={d} fill={`url(#glass-${id})`} />)}
        {doors.map((d, i) => <path key={i} d={d} stroke="#93A8BC" strokeWidth="0.8" fill="none" />)}
        <path d={shoulder} stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="2" fill="none" />
      </g>

      {rearGlass && <path d={rearGlass} fill={`url(#glass-${id})`} stroke="#33465C" strokeWidth="0.7" />}
      <path d={bumper} fill="#C6D4E2" opacity="0.5" stroke={edge} strokeWidth="0.6" />
      <path d={valance} fill="#8FA4B9" opacity="0.4" />
      {lamps.map((d, i) => (
        <path key={i} d={d} fill={`url(#lamp-${id})`} stroke="#7E1E1E" strokeWidth="0.5" />
      ))}

      {/* the plate, and the name on it */}
      <path d={poly(plate)} fill="#FFFFFF" stroke="#26313D" strokeWidth="1.2" />
      <g
        transform={`translate(${px.toFixed(1)} ${py.toFixed(1)}) skewY(${skew.toFixed(2)})`}
        fontFamily="'Inter Variable',system-ui,sans-serif" fontWeight="700" fill="#1A2430" textAnchor="middle"
      >
        {lines.length === 1 ? (
          <text y="4" fontSize="10.5" textLength={pw.toFixed(1)} lengthAdjust="spacingAndGlyphs">{lines[0]}</text>
        ) : (
          <>
            <text y="-1.4" fontSize="8.4" textLength={pw.toFixed(1)} lengthAdjust="spacingAndGlyphs">{lines[0]}</text>
            <text y="8.4" fontSize="8.4" textLength={pw.toFixed(1)} lengthAdjust="spacingAndGlyphs">{lines[1]}</text>
          </>
        )}
      </g>

      {/* the corner between the two faces, then the wheels on top of everything */}
      <path
        d={`M${fmt(pr(0, 2))}L${fmt(pr(0, s.rearTop - 3))}`}
        stroke={edge} strokeWidth="0.9" strokeOpacity="0.85" fill="none"
      />
      {wheels.map((w) => {
        const rx = w.r * 0.4;
        return (
          <g key={`wh${w.x}`}>
            <ellipse cx={w.x.toFixed(1)} cy={w.y.toFixed(1)} rx={rx.toFixed(1)} ry={w.r.toFixed(1)} fill="#18222E" />
            <ellipse
              cx={w.x.toFixed(1)} cy={w.y.toFixed(1)}
              rx={(rx * 0.58).toFixed(1)} ry={(w.r * 0.58).toFixed(1)} fill={`url(#rim-${id})`}
            />
            <ellipse
              cx={w.x.toFixed(1)} cy={w.y.toFixed(1)}
              rx={(rx * 0.2).toFixed(1)} ry={(w.r * 0.2).toFixed(1)} fill="#6C8098"
            />
          </g>
        );
      })}
    </svg>
  );
}

/* The animated ride scene that used to live here now has its own file:
   components/HeroJourney.tsx. This module is only the vehicle artwork. */
