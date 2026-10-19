/**
 * Mumbai-region pickup areas, for the /cab-service/<area> pages.
 *
 * Each entry carries what is actually different about booking a cab there -
 * how far the airport is, which road out of the city is nearest, the places
 * we pick up from most - so no two area pages say the same thing with only the
 * name swapped. Times are typical off-peak figures and are written as ranges.
 *
 * Node-safe: read at build time by vite.config.ts.
 */

export interface Area {
  slug: string;
  name: string;
  /** Also known as / spelling people search with. */
  aka?: string;
  region: 'Western suburbs' | 'Central suburbs' | 'Island city' | 'Thane district' | 'Navi Mumbai' | 'Raigad';
  /** Minutes to CSMIA Terminal 2 outside peak hours. */
  airportMins: string;
  /** Minutes to Navi Mumbai International Airport, where it is the nearer one. */
  nmiaMins?: string;
  landmarks: string[];
  /** The road most outstation trips from here start on. */
  exitRoad: string;
  /** One or two sentences only true of this area. */
  note: string;
  nearby: string[];
}

export const AREAS: Area[] = [
  {
    slug: 'goregaon', name: 'Goregaon', region: 'Western suburbs', airportMins: '25–40',
    landmarks: ['Film City', 'NESCO and Bombay Exhibition Centre', 'Oberoi Mall', 'Goregaon station (East and West)', 'Aarey Colony'],
    exitRoad: 'the Western Express Highway, then JVLR to the Eastern Express Highway for Pune and Nashik',
    note: 'Our office is in Goregaon (W), so cars here are usually the quickest to reach you - including late-night and early-morning airport runs. NESCO exhibitions bring a lot of short-notice multi-car bookings.',
    nearby: ['malad', 'andheri', 'kandivali', 'powai'],
  },
  {
    slug: 'andheri', name: 'Andheri', region: 'Western suburbs', airportMins: '15–30',
    landmarks: ['Andheri station', 'MIDC and SEEPZ', 'Lokhandwala', 'Versova', 'Marol and Saki Naka'],
    exitRoad: 'the Western Express Highway, or JVLR and the Eastern Express Highway towards Thane',
    note: 'Andheri East is next to both airport terminals, and the MIDC, SEEPZ and Marol offices make it our busiest area for corporate airport transfers and day-long office duties.',
    nearby: ['goregaon', 'bandra', 'powai', 'malad'],
  },
  {
    slug: 'malad', name: 'Malad', region: 'Western suburbs', airportMins: '30–45',
    landmarks: ['Mindspace and Inorbit Mall', 'Infiniti Mall', 'Malad station', 'Marve and Madh Island', 'Evershine Nagar'],
    exitRoad: 'the Western Express Highway north for Gujarat, or south and across JVLR for Pune',
    note: 'Mindspace and the Link Road offices mean weekday shift pickups; at weekends Madh and Marve bring beach-side party and wedding drops.',
    nearby: ['goregaon', 'kandivali', 'andheri', 'borivali'],
  },
  {
    slug: 'kandivali', name: 'Kandivali', region: 'Western suburbs', airportMins: '35–50',
    landmarks: ['Thakur Village', 'Mahavir Nagar', 'Kandivali station', 'Growel’s 101 Mall', 'Charkop'],
    exitRoad: 'the Western Express Highway - north towards Gujarat is the easiest exit in the city from here',
    note: 'Thakur Village and Lokhandwala Township are large residential areas, so families book early-morning airport drops and weekend outstation trips from here most.',
    nearby: ['borivali', 'malad', 'goregaon'],
  },
  {
    slug: 'borivali', name: 'Borivali', region: 'Western suburbs', airportMins: '40–60',
    landmarks: ['Sanjay Gandhi National Park', 'Borivali station', 'IC Colony', 'Gorai and Essel World', 'Kora Kendra'],
    exitRoad: 'the Western Express Highway north - the quickest start in Mumbai for Surat, Ahmedabad and Daman',
    note: 'Being at the northern edge of the city, Borivali is where most of our Gujarat-bound trips start, and the Gorai ferry and Essel World bring group bookings.',
    nearby: ['kandivali', 'mira-bhayandar', 'malad'],
  },
  {
    slug: 'bandra', name: 'Bandra', region: 'Western suburbs', airportMins: '25–40',
    landmarks: ['Bandra Kurla Complex (BKC)', 'Bandra station', 'Bandstand and Carter Road', 'Linking Road', 'Jio World Centre'],
    exitRoad: 'the Bandra–Worli Sea Link south, or the Western Express Highway and the Eastern Freeway for Pune',
    note: 'BKC offices, consulates and the Jio World Centre make Bandra East heavy on corporate and event bookings; Bandra West is more family airport runs and evening outings.',
    nearby: ['andheri', 'dadar', 'south-mumbai'],
  },
  {
    slug: 'powai', name: 'Powai', region: 'Central suburbs', airportMins: '25–40',
    landmarks: ['Hiranandani Gardens', 'IIT Bombay', 'Powai Lake', 'Chandivali', 'L&T and the Powai business parks'],
    exitRoad: 'the Eastern Express Highway - Pune and Nashik trips start well from here',
    note: 'Between the two highways, Powai is a good start for both the airport (via JVLR) and the Pune Expressway, and the business parks bring regular corporate duties.',
    nearby: ['andheri', 'ghatkopar', 'goregaon', 'thane'],
  },
  {
    slug: 'ghatkopar', name: 'Ghatkopar', region: 'Central suburbs', airportMins: '25–40',
    landmarks: ['R City Mall', 'Ghatkopar station and Metro', 'Pant Nagar', 'Vikhroli', 'Kurla and LBS Marg'],
    exitRoad: 'the Eastern Express Highway, with the Eastern Freeway and Panvel road close by',
    note: 'The Metro and the Eastern Express Highway meet here, so Ghatkopar is a common pickup point for trips towards Navi Mumbai airport, Panvel and Pune.',
    nearby: ['powai', 'dadar', 'thane', 'navi-mumbai'],
  },
  {
    slug: 'dadar', name: 'Dadar', region: 'Island city', airportMins: '35–60',
    landmarks: ['Dadar station', 'Shivaji Park', 'Siddhivinayak Temple (Prabhadevi)', 'Worli and Lower Parel offices', 'Matunga'],
    exitRoad: 'the Eastern Freeway or the Eastern Express Highway for Pune and Nashik; the Sea Link for the western suburbs',
    note: 'Central and well connected, Dadar is a frequent pickup for Siddhivinayak darshan, Lower Parel office duties and family trips to Konkan.',
    nearby: ['bandra', 'south-mumbai', 'ghatkopar'],
  },
  {
    slug: 'south-mumbai', name: 'South Mumbai', aka: 'Colaba, Fort, Churchgate, Nariman Point',
    region: 'Island city', airportMins: '50–90',
    landmarks: ['Gateway of India', 'Colaba and the Taj', 'Nariman Point', 'CSMT and Fort', 'Marine Drive'],
    exitRoad: 'the Eastern Freeway, which avoids most city traffic on the way out to Pune and Nashik',
    note: 'The airport is the furthest from here, so we time departures around the evening peak. Hotel pickups, sightseeing and Gateway ferry drops for Alibaug are common.',
    nearby: ['dadar', 'bandra'],
  },
  {
    slug: 'thane', name: 'Thane', region: 'Thane district', airportMins: '45–75', nmiaMins: '50–75',
    landmarks: ['Viviana and Korum Mall', 'Ghodbunder Road', 'Thane station', 'Upvan Lake', 'Hiranandani Estate'],
    exitRoad: 'the Mumbai–Nashik Highway, which starts here - Nashik, Shirdi and Igatpuri are the easiest outstation trips from Thane',
    note: 'Thane is on the doorstep of the Nashik highway, so pilgrimage trips to Shirdi and Trimbakeshwar from here save the hour it takes to cross Mumbai.',
    nearby: ['ghatkopar', 'powai', 'navi-mumbai'],
  },
  {
    slug: 'navi-mumbai', name: 'Navi Mumbai', aka: 'Vashi, Nerul, Belapur, Kharghar, Airoli',
    region: 'Navi Mumbai', airportMins: '50–80', nmiaMins: '15–35',
    landmarks: ['Vashi', 'Nerul and Seawoods', 'CBD Belapur', 'Kharghar', 'Airoli and Ghansoli IT parks'],
    exitRoad: 'the Sion–Panvel Highway to the Pune Expressway - the shortest start for Pune and Lonavala',
    note: 'Navi Mumbai International Airport is close by, and the Pune Expressway starts at Kalamboli, so Navi Mumbai trips to Pune and Lonavala skip city traffic altogether.',
    nearby: ['panvel', 'thane', 'ghatkopar'],
  },
  {
    slug: 'panvel', name: 'Panvel', region: 'Raigad', airportMins: '75–110', nmiaMins: '15–30',
    landmarks: ['Panvel station', 'New Panvel', 'Kalamboli', 'Kamothe', 'Ulwe'],
    exitRoad: 'the Pune Expressway and the Mumbai–Goa Highway (NH66), both of which start next to Panvel',
    note: 'With Navi Mumbai airport next door and both the Pune Expressway and the Goa highway starting here, Panvel is the best place in the region to begin a Konkan or Goa trip.',
    nearby: ['navi-mumbai', 'thane'],
  },
  {
    slug: 'mira-bhayandar', name: 'Mira Road', aka: 'Mira Bhayandar, Bhayandar',
    region: 'Thane district', airportMins: '50–75',
    landmarks: ['Mira Road station', 'Bhayandar station', 'Shanti Nagar', 'Golden Nest', 'Uttan'],
    exitRoad: 'the Western Express Highway north towards Vasai, Daman and Gujarat',
    note: 'Just north of Borivali, Mira Road is a common start for trips to Surat, Daman and Gujarat, and for family airport drops at night.',
    nearby: ['borivali', 'kandivali'],
  },
];

export const areaBySlug = (slug: string) => AREAS.find((a) => a.slug === slug);
export const areaPath = (slug: string) => `/cab-service/${slug}`;
