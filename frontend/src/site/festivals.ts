/**
 * Festival travel specials — the seasonal card on the home page.
 *
 * Each entry runs itself: the card appears on `showFrom` and disappears the
 * day after `showUntil`, so nobody has to remember to take Chhath down in
 * December. Adding next season's special (Holi, Ganpati going home, summer
 * holidays) is one more row here, nothing else.
 *
 * Prices are deliberately not written here. Festival fares change with fuel,
 * tolls and how many seats are left, so the card asks for a quote and the
 * office answers with today's best price.
 */

export interface FestivalDay {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  note: string;
}

export interface FestivalRoute {
  to: string;
  state: string;
  /** Approximate road distance from Mumbai. */
  km: number;
  /** Approximate time on the road, as told to a customer. */
  drive: string;
}

export interface FestivalVehicle {
  /** FLEET slug, for the photo and the name. */
  slug: string;
  /** Who it suits, in a few words. */
  fits: string;
  /** Group size the per-seat line is worked out for. */
  pax: number;
  tag?: string;
}

export interface FestivalSpecial {
  key: string;
  name: string;
  /** The festival's name in Devanagari, set large as decoration. */
  nameHi: string;
  year: number;
  /** YYYY-MM-DD, inclusive. */
  showFrom: string;
  showUntil: string;
  headline: string;
  pitch: string;
  days: FestivalDay[];
  /** When to leave and when to come back, as advice. */
  leaveBy: string;
  returnFrom: string;
  routes: FestivalRoute[];
  vehicles: FestivalVehicle[];
  pickups: string[];
  promises: string[];
}

export const FESTIVALS: FestivalSpecial[] = [
  {
    key: 'chhath-2026',
    name: 'Chhath Puja',
    nameHi: 'छठ पूजा',
    year: 2026,
    showFrom: '2026-10-01',
    showUntil: '2026-11-16',
    headline: 'Going home for Chhath? Travel together, door to ghat.',
    pitch:
      'Trains to Bihar and Purvanchal are full weeks ahead. Book a cab or a mini bus for the whole family from Mumbai — '
      + 'one vehicle, your own timings, luggage and prasad samagri on board, and festive fares that come to very little '
      + 'per head when the whole family travels together.',
    days: [
      { date: '2026-11-13', name: 'Nahay Khay', note: 'Holy bath, first meal' },
      { date: '2026-11-14', name: 'Kharna', note: 'Day-long fast, kheer at dusk' },
      { date: '2026-11-15', name: 'Sandhya Arghya', note: 'Offering to the setting sun' },
      { date: '2026-11-16', name: 'Usha Arghya', note: 'Offering at sunrise, fast ends' },
    ],
    leaveBy: '2026-11-10',
    returnFrom: '2026-11-17',
    routes: [
      { to: 'Prayagraj', state: 'Uttar Pradesh', km: 1400, drive: '≈ 24 hrs' },
      { to: 'Varanasi', state: 'Uttar Pradesh', km: 1520, drive: '≈ 26 hrs' },
      { to: 'Gorakhpur', state: 'Uttar Pradesh', km: 1700, drive: '≈ 30 hrs' },
      { to: 'Gaya', state: 'Bihar', km: 1750, drive: '≈ 31 hrs' },
      { to: 'Patna', state: 'Bihar', km: 1780, drive: '≈ 32 hrs' },
      { to: 'Muzaffarpur', state: 'Bihar', km: 1850, drive: '≈ 34 hrs' },
      { to: 'Darbhanga', state: 'Bihar', km: 1920, drive: '≈ 35 hrs' },
    ],
    vehicles: [
      { slug: 'ertiga', fits: 'One family, up to 6', pax: 6 },
      { slug: 'innova-crysta', fits: 'Elders on board, extra comfort', pax: 6, tag: 'Most booked' },
      { slug: 'tempo-traveller-12', fits: 'Two families together', pax: 12 },
      { slug: 'tempo-traveller-17', fits: 'Mini bus for the whole khandaan', pax: 17, tag: 'Best per head' },
      { slug: 'bus', fits: 'Society, mandal or village group', pax: 45 },
    ],
    pickups: ['Mumbai', 'Thane', 'Navi Mumbai', 'Kalyan', 'Bhiwandi', 'Vasai–Virar', 'Pune'],
    promises: [
      'Festive fare fixed before you travel',
      'Two drivers on long runs, on request',
      'Roof carrier for luggage and puja samagri',
      'Drop now, pick-up after Usha Arghya',
    ],
  },
];

/** YYYY-MM-DD for a date in the visitor's own timezone. */
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The special running today, if any. */
export function activeFestival(today = new Date()): FestivalSpecial | undefined {
  const t = ymd(today);
  return FESTIVALS.find((f) => f.showFrom <= t && t <= f.showUntil);
}

/** Whole days from today until a YYYY-MM-DD date; 0 on the day, negative after. */
export function daysUntil(date: string, today = new Date()): number {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

/** "13 Nov" / "Fri" from a YYYY-MM-DD date. */
export function shortDate(date: string, part: 'day' | 'weekday' = 'day'): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return part === 'weekday'
    ? dt.toLocaleDateString('en-IN', { weekday: 'short' })
    : dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
