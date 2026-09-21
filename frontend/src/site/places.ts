/**
 * Places — Mumbai sightseeing stops and the weekend destinations we drive to.
 *
 * Distances and durations are the ones the office quotes on the phone and are
 * deliberately marked approximate everywhere they are shown: the route on the
 * day decides the real number. Nothing here is a live feed.
 *
 * Photographs are optional. Every card falls back to a tinted gradient with the
 * place initial, so a destination with no picture yet still looks deliberate
 * rather than broken. Drop a JPG at the `photo` path to light one up.
 */

export type Theme = 'beach' | 'hills' | 'nature' | 'religious' | 'food' | 'photo' | 'family' | 'romantic' | 'adventure' | 'heritage';

export const THEMES: { key: Theme; emoji: string; label: string }[] = [
  { key: 'beach',     emoji: '\u{1F3D6}️', label: 'Beach' },
  { key: 'hills',     emoji: '⛰️', label: 'Hills' },
  { key: 'nature',    emoji: '\u{1F33F}', label: 'Nature' },
  { key: 'religious', emoji: '\u{1F6D5}', label: 'Religious' },
  { key: 'food',      emoji: '\u{1F374}', label: 'Food' },
  { key: 'photo',     emoji: '\u{1F4F8}', label: 'Photography' },
  { key: 'family',    emoji: '\u{1F46A}', label: 'Family' },
  { key: 'romantic',  emoji: '❤️', label: 'Romantic' },
  { key: 'adventure', emoji: '\u{1F3D5}️', label: 'Adventure' },
  { key: 'heritage',  emoji: '\u{1F3DB}️', label: 'Heritage' },
];

/* ==========================================================================
   Mumbai sightseeing stops — the tour builder picks from these
   ========================================================================== */

export interface Spot {
  slug: string;
  name: string;
  area: string;
  /** Recommended time at the stop, in minutes. Drives the tour timeline. */
  minutes: number;
  idealFor: string;
  note: string;
  themes: Theme[];
  photo: string;
}

export const MUMBAI_SPOTS: Spot[] = [
  { slug: 'gateway-of-india', name: 'Gateway of India', area: 'Colaba', minutes: 45, idealFor: 'First-time visitors', note: 'The arch on the harbour, and the jetty for the Elephanta ferry.', themes: ['heritage', 'photo', 'family'], photo: '/assets/places/gateway-of-india.jpg' },
  { slug: 'marine-drive', name: 'Marine Drive', area: 'Churchgate', minutes: 40, idealFor: 'Evenings and sunsets', note: 'The sea-facing promenade — best an hour before sunset.', themes: ['photo', 'romantic', 'family'], photo: '/assets/places/marine-drive.jpg' },
  { slug: 'colaba', name: 'Colaba Causeway', area: 'Colaba', minutes: 60, idealFor: 'Shopping and cafés', note: 'Street shopping, bookshops and the old Bombay cafés.', themes: ['food', 'heritage'], photo: '/assets/places/colaba.jpg' },
  { slug: 'bandra', name: 'Bandra & Bandstand', area: 'Bandra West', minutes: 50, idealFor: 'Cafés and the sea wall', note: 'Bandstand promenade, Mount Mary and the lanes off Hill Road.', themes: ['food', 'photo', 'romantic'], photo: '/assets/places/bandra.jpg' },
  { slug: 'juhu', name: 'Juhu Beach', area: 'Juhu', minutes: 45, idealFor: 'Families and street food', note: 'Wide sand, the chaat stalls and an easy stop near the airport.', themes: ['beach', 'family'], photo: '/assets/places/juhu.jpg' },
  { slug: 'siddhivinayak', name: 'Siddhivinayak Temple', area: 'Prabhadevi', minutes: 60, idealFor: 'Darshan', note: 'Early morning is quietest. Allow longer on Tuesdays.', themes: ['religious'], photo: '/assets/places/siddhivinayak.jpg' },
  { slug: 'haji-ali', name: 'Haji Ali Dargah', area: 'Worli', minutes: 45, idealFor: 'Darshan and the causeway', note: 'The causeway is walkable only at low tide — we check before we go.', themes: ['religious', 'photo'], photo: '/assets/places/haji-ali.jpg' },
  { slug: 'film-city', name: 'Film City', area: 'Goregaon East', minutes: 120, idealFor: 'Studio tours', note: 'Entry needs a pass arranged in advance — tell us a day ahead.', themes: ['family', 'photo'], photo: '/assets/places/film-city.jpg' },
  { slug: 'elephanta', name: 'Elephanta Caves', area: 'Harbour, by ferry', minutes: 240, idealFor: 'A half-day of heritage', note: 'Ferry from the Gateway. The car waits at Colaba for your return.', themes: ['heritage', 'adventure', 'photo'], photo: '/assets/places/elephanta.jpg' },
  { slug: 'dhobi-ghat', name: 'Dhobi Ghat', area: 'Mahalaxmi', minutes: 25, idealFor: 'Photography', note: 'Seen best from the bridge above, in the morning light.', themes: ['photo', 'heritage'], photo: '/assets/places/dhobi-ghat.jpg' },
  { slug: 'sanjay-gandhi', name: 'Sanjay Gandhi National Park', area: 'Borivali', minutes: 180, idealFor: 'Nature and Kanheri Caves', note: 'The Kanheri caves sit inside the park — a morning of its own.', themes: ['nature', 'family', 'adventure'], photo: '/assets/places/sanjay-gandhi.jpg' },
  { slug: 'cst', name: 'CSMT & Fort', area: 'Fort', minutes: 45, idealFor: 'Architecture', note: 'The station facade, the High Court and the Fort precinct on foot.', themes: ['heritage', 'photo'], photo: '/assets/places/cst.jpg' },
];

export const spotBySlug = (slug: string) => MUMBAI_SPOTS.find((s) => s.slug === slug);

/** Tour lengths offered from the Mumbai tour builder. */
export const TOUR_DURATIONS = [
  { key: '4H', label: '4 Hours', minutes: 240, note: 'Three or four stops in one part of the city' },
  { key: '8H', label: '8 Hours', minutes: 480, note: 'A full day across south Mumbai and the suburbs' },
  { key: 'FD', label: 'Full Day', minutes: 660, note: 'Eleven hours, with the ferry or the park included' },
] as const;

export type TourDurationKey = (typeof TOUR_DURATIONS)[number]['key'];

/* ==========================================================================
   Weekend escapes from Mumbai
   ========================================================================== */

export interface Destination {
  slug: string;
  name: string;
  state: string;
  km: number;
  hours: string;
  /** Nights that suit the place — used by the 1/2/3-day filters. */
  nights: number[];
  blurb: string;
  bestFor: string[];
  themes: Theme[];
  seeThere: string[];
  itinerary: { day: string; plan: string }[];
  /** Vehicle slugs we usually send. Order matters — first is the default. */
  vehicles: string[];
  photo: string;
  similar: string[];
}

export const DESTINATIONS: Destination[] = [
  {
    slug: 'lonavala', name: 'Lonavala', state: 'Maharashtra', km: 83, hours: '≈2 hrs', nights: [0, 1, 2],
    blurb: 'The closest hill break to Mumbai — an easy morning drive up the expressway, and back the same evening if you want.',
    bestFor: ['Families', 'First-time hill trips', 'Monsoon drives'],
    themes: ['hills', 'nature', 'family', 'photo'],
    seeThere: ['Bhushi Dam', 'Tiger Point', 'Karla Caves', 'Lonavala Lake', 'Rajmachi viewpoint'],
    itinerary: [
      { day: 'Day 1', plan: 'Leave Mumbai by 7am, breakfast on the expressway, Karla Caves, check in, Bhushi Dam in the afternoon.' },
      { day: 'Day 2', plan: 'Tiger Point at sunrise, Lonavala market for chikki, back in Mumbai by early evening.' },
    ],
    vehicles: ['ertiga', 'innova-crysta', 'tempo-traveller-12'],
    photo: '/assets/places/lonavala.jpg',
    similar: ['khandala', 'matheran', 'mahabaleshwar'],
  },
  {
    slug: 'khandala', name: 'Khandala', state: 'Maharashtra', km: 80, hours: '≈2 hrs', nights: [0, 1],
    blurb: 'Lonavala’s quieter neighbour, on the same ghat. Better if you want the views without the weekend crowd.',
    bestFor: ['Couples', 'Short drives', 'Quiet stays'],
    themes: ['hills', 'nature', 'romantic'],
    seeThere: ['Duke’s Nose', 'Amrutanjan Point', 'Reversing Station', 'Kune Falls'],
    itinerary: [
      { day: 'Day 1', plan: 'Morning drive, Amrutanjan Point, lunch, Kune Falls, evening at Duke’s Nose.' },
    ],
    vehicles: ['dzire', 'ertiga', 'innova-crysta'],
    photo: '/assets/places/khandala.jpg',
    similar: ['lonavala', 'matheran', 'igatpuri'],
  },
  {
    slug: 'alibaug', name: 'Alibaug', state: 'Maharashtra', km: 95, hours: '≈2.5 hrs', nights: [0, 1, 2],
    blurb: 'Beaches and old sea forts a short drive down the coast — the weekend that feels furthest from Mumbai for the least driving.',
    bestFor: ['Beach weekends', 'Groups', 'Family stays'],
    themes: ['beach', 'family', 'romantic', 'food'],
    seeThere: ['Alibaug Beach', 'Kolaba Fort', 'Kashid Beach', 'Nagaon Beach', 'Kanakeshwar Temple'],
    itinerary: [
      { day: 'Day 1', plan: 'Drive via Panvel, check in, Alibaug beach and Kolaba Fort at low tide.' },
      { day: 'Day 2', plan: 'Kashid beach for the morning, seafood lunch, back to Mumbai by evening.' },
    ],
    vehicles: ['ertiga', 'innova-crysta', 'tempo-traveller-12'],
    photo: '/assets/places/alibaug.jpg',
    similar: ['kashid', 'lonavala', 'goa'],
  },
  {
    slug: 'mahabaleshwar', name: 'Mahabaleshwar', state: 'Maharashtra', km: 265, hours: '≈5.5 hrs', nights: [1, 2, 3],
    blurb: 'The full hill station — strawberry farms, viewpoints over the valley, and cool evenings even in April.',
    bestFor: ['Two-night trips', 'Families', 'Groups'],
    themes: ['hills', 'nature', 'family', 'photo', 'romantic'],
    seeThere: ['Arthur’s Seat', 'Venna Lake', 'Pratapgad Fort', 'Mapro Garden', 'Elephant’s Head Point', 'Panchgani'],
    itinerary: [
      { day: 'Day 1', plan: 'Leave Mumbai early, lunch at Panchgani, check in, Venna Lake in the evening.' },
      { day: 'Day 2', plan: 'The points circuit in the morning, Mapro for lunch, Pratapgad in the afternoon.' },
      { day: 'Day 3', plan: 'Strawberry farm, then the drive back with a stop at Panchgani table land.' },
    ],
    vehicles: ['innova-crysta', 'ertiga', 'tempo-traveller-12'],
    photo: '/assets/places/mahabaleshwar.jpg',
    similar: ['panchgani', 'lonavala', 'igatpuri'],
  },
  {
    slug: 'nashik', name: 'Nashik', state: 'Maharashtra', km: 167, hours: '≈3.5 hrs', nights: [0, 1, 2],
    blurb: 'Vineyards on one side of the city and the Godavari ghats on the other — a weekend that works for two very different trips.',
    bestFor: ['Vineyard visits', 'Pilgrimage', 'Couples'],
    themes: ['food', 'religious', 'nature', 'romantic'],
    seeThere: ['Sula Vineyards', 'Trimbakeshwar', 'Panchavati', 'Pandavleni Caves', 'Anjneri Hills'],
    itinerary: [
      { day: 'Day 1', plan: 'Drive up by mid-morning, vineyard tour and lunch, evening at the Godavari ghats.' },
      { day: 'Day 2', plan: 'Trimbakeshwar darshan early, Pandavleni Caves, back to Mumbai by evening.' },
    ],
    vehicles: ['dzire', 'ertiga', 'innova-crysta'],
    photo: '/assets/places/nashik.jpg',
    similar: ['igatpuri', 'shirdi', 'trimbakeshwar'],
  },
  {
    slug: 'igatpuri', name: 'Igatpuri', state: 'Maharashtra', km: 130, hours: '≈3 hrs', nights: [0, 1],
    blurb: 'Green hills and waterfalls at the top of the Kasara ghat. The monsoon destination people go back to every year.',
    bestFor: ['Monsoon drives', 'Nature', 'Short stays'],
    themes: ['hills', 'nature', 'adventure', 'photo'],
    seeThere: ['Bhatsa River Valley', 'Camel Valley', 'Tringalwadi Fort', 'Vipassana Pagoda', 'Randha Falls'],
    itinerary: [
      { day: 'Day 1', plan: 'Early drive up the ghat, waterfalls in the morning, valley viewpoints after lunch.' },
    ],
    vehicles: ['ertiga', 'innova-crysta', 'tempo-traveller-12'],
    photo: '/assets/places/igatpuri.jpg',
    similar: ['nashik', 'khandala', 'matheran'],
  },
  {
    slug: 'matheran', name: 'Matheran', state: 'Maharashtra', km: 85, hours: '≈2.5 hrs', nights: [0, 1],
    blurb: 'No vehicles are allowed inside the town. We drive you to Dasturi Naka and the car waits there while you walk the plateau.',
    bestFor: ['Walking trips', 'Couples', 'Car-free days'],
    themes: ['hills', 'nature', 'romantic', 'photo'],
    seeThere: ['Panorama Point', 'Charlotte Lake', 'Echo Point', 'Louisa Point', 'The toy train'],
    itinerary: [
      { day: 'Day 1', plan: 'Drive to Dasturi Naka, walk or take a horse up, the points circuit, down by evening.' },
    ],
    vehicles: ['dzire', 'ertiga', 'innova-crysta'],
    photo: '/assets/places/matheran.jpg',
    similar: ['khandala', 'lonavala', 'igatpuri'],
  },
  {
    slug: 'shirdi', name: 'Shirdi', state: 'Maharashtra', km: 240, hours: '≈5 hrs', nights: [0, 1],
    blurb: 'The darshan run we do most weeks. Overnight drive, morning darshan, back the same day is the usual pattern.',
    bestFor: ['Pilgrimage', 'Family groups', 'Overnight drives'],
    themes: ['religious', 'family'],
    seeThere: ['Sai Baba Samadhi Mandir', 'Dwarkamai', 'Chavadi', 'Shani Shingnapur', 'Shanmukhananda'],
    itinerary: [
      { day: 'Day 1', plan: 'Leave Mumbai at night, reach for the early darshan, temple complex through the morning.' },
      { day: 'Day 2', plan: 'Shani Shingnapur on the way back, in Mumbai by late evening.' },
    ],
    vehicles: ['innova-crysta', 'ertiga', 'tempo-traveller-12'],
    photo: '/assets/places/shirdi.jpg',
    similar: ['nashik', 'trimbakeshwar', 'mahabaleshwar'],
  },
  {
    slug: 'goa', name: 'Goa', state: 'Goa', km: 590, hours: '≈11 hrs', nights: [2, 3],
    blurb: 'A long drive, and worth doing in one go with a highway chauffeur rather than two flights and a rental at the other end.',
    bestFor: ['Long weekends', 'Groups', 'Beach holidays'],
    themes: ['beach', 'food', 'romantic', 'adventure'],
    seeThere: ['North Goa beaches', 'Old Goa churches', 'Dudhsagar Falls', 'Panjim', 'Spice plantations'],
    itinerary: [
      { day: 'Day 1', plan: 'Leave Mumbai before dawn, lunch on the Konkan highway, check in by evening.' },
      { day: 'Day 2', plan: 'North Goa beaches, Panjim in the evening.' },
      { day: 'Day 3', plan: 'Old Goa and Dudhsagar, or a slow beach day.' },
      { day: 'Day 4', plan: 'The drive back, with a Konkan lunch stop.' },
    ],
    vehicles: ['innova-crysta', 'tempo-traveller-12', 'ertiga'],
    photo: '/assets/places/goa.jpg',
    similar: ['alibaug', 'mahabaleshwar', 'kashid'],
  },
  {
    slug: 'kashid', name: 'Kashid', state: 'Maharashtra', km: 125, hours: '≈3 hrs', nights: [0, 1],
    blurb: 'The clean stretch of white sand past Alibaug, with far fewer people on it.',
    bestFor: ['Beach days', 'Couples', 'Small groups'],
    themes: ['beach', 'romantic', 'nature'],
    seeThere: ['Kashid Beach', 'Murud Janjira Fort', 'Phansad Sanctuary', 'Korlai Fort'],
    itinerary: [
      { day: 'Day 1', plan: 'Drive down via Alibaug, the beach all afternoon, Korlai Fort at sunset.' },
    ],
    vehicles: ['ertiga', 'innova-crysta', 'dzire'],
    photo: '/assets/places/kashid.jpg',
    similar: ['alibaug', 'goa', 'lonavala'],
  },
  {
    slug: 'panchgani', name: 'Panchgani', state: 'Maharashtra', km: 245, hours: '≈5 hrs', nights: [1, 2],
    blurb: 'Table land and valley views, twenty minutes short of Mahabaleshwar and usually quieter.',
    bestFor: ['Two-night trips', 'Families', 'Photography'],
    themes: ['hills', 'nature', 'family', 'photo'],
    seeThere: ['Table Land', 'Sydney Point', 'Devrai Art Village', 'Dhom Dam', 'Kamalgad Fort'],
    itinerary: [
      { day: 'Day 1', plan: 'Drive up, check in, Table Land for the evening.' },
      { day: 'Day 2', plan: 'Mahabaleshwar points as a day trip, back to Panchgani for the night.' },
    ],
    vehicles: ['innova-crysta', 'ertiga', 'tempo-traveller-12'],
    photo: '/assets/places/panchgani.jpg',
    similar: ['mahabaleshwar', 'lonavala', 'matheran'],
  },
  {
    slug: 'pune', name: 'Pune', state: 'Maharashtra', km: 150, hours: '≈3 hrs', nights: [0, 1],
    blurb: 'The route we run most often. Corporate day trips up and back, and weekend visits to family.',
    bestFor: ['Day trips', 'Corporate travel', 'One-way drops'],
    themes: ['food', 'heritage', 'family'],
    seeThere: ['Shaniwar Wada', 'Aga Khan Palace', 'Sinhagad Fort', 'Dagdusheth Temple', 'Koregaon Park'],
    itinerary: [
      { day: 'Day 1', plan: 'Up the expressway after breakfast, meetings or sightseeing through the day, back by night.' },
    ],
    vehicles: ['dzire', 'honda-city', 'innova-crysta'],
    photo: '/assets/places/pune.jpg',
    similar: ['lonavala', 'mahabaleshwar', 'nashik'],
  },
];

export const destinationBySlug = (slug?: string) => DESTINATIONS.find((d) => d.slug === slug);

/**
 * Road distance from Mumbai, in kilometres, for the estimate on the trip
 * screens. Falls back to `undefined` for anywhere not on the list, and the
 * screens then say "distance confirmed when we quote" rather than guessing.
 */
export const DISTANCE_FROM_MUMBAI: Record<string, number> = Object.fromEntries(
  DESTINATIONS.map((d) => [d.name.toLowerCase(), d.km])
);

export function lookupDistance(place: string): number | undefined {
  const key = place.trim().toLowerCase();
  if (!key) return undefined;
  if (DISTANCE_FROM_MUMBAI[key]) return DISTANCE_FROM_MUMBAI[key];
  const hit = Object.keys(DISTANCE_FROM_MUMBAI).find((k) => key.includes(k) || k.includes(key));
  return hit ? DISTANCE_FROM_MUMBAI[hit] : undefined;
}
