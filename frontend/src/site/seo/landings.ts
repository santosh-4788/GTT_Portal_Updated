/**
 * The search landing pages: one page per thing people actually search for.
 *
 *   /cab-service/<area>          a cab in Andheri, Thane, Navi Mumbai...
 *   /mumbai-airport-cab          CSMIA T1 and T2
 *   /navi-mumbai-airport-cab     NMIA
 *   /one-way-cab-mumbai, /round-trip-cab-mumbai, /hourly-car-rental-mumbai
 *   /cabs/mumbai-to-<route>      (rendered by RouteLanding, words from here)
 *   /hi/...  /mr/...             the same needs, written in Hindi and Marathi
 *
 * Google's rules shape this file: every page answers one search with content
 * that is specific to it (distances, roads, landmarks, how the trip works),
 * nothing is hidden, and the words read naturally - no lists of keywords. The
 * keyword research these pages are built from is in docs/SEO-KEYWORDS.md.
 *
 * The same objects drive the React page (SeoLanding.tsx), the pre-rendered
 * HTML written at build time (vite.config.ts), the sitemap and the hreflang
 * links, so they can never disagree.
 *
 * No prices here: fares come from the office's masters. No phone number as
 * text either - the site never prints it (see CallButton in kit.tsx).
 *
 * Node-safe: no browser APIs, no React.
 */
import { AREAS, areaPath, type Area } from './areas';
import { ROUTE_INFO, enRoutePath, hiRoutePath, mrRoutePath, type RouteInfo } from './routeInfo';

export type Lang = 'en' | 'hi' | 'mr';

export interface LandingSection {
  h2: string;
  paras?: string[];
  list?: string[];
}

export interface Landing {
  path: string;
  lang: Lang;
  /** Pages in the same group are translations of each other (hreflang). */
  group?: string;
  /** Full <title>. Kept near 60 characters. */
  title: string;
  /** Meta description. Kept under about 160 characters. */
  description: string;
  eyebrow: string;
  h1: string;
  intro: string;
  sections: LandingSection[];
  faqs: { q: string; a: string }[];
  links: { label: string; to: string }[];
  crumbs: { label: string; to?: string }[];
  cta: { label: string; to: string };
  /** schema.org Service details. */
  serviceType: string;
  areaServed: string[];
  image?: { src: string; alt: string };
  /** Rendered by another component (RouteLanding); still pre-rendered and listed. */
  external?: boolean;
}

const BRAND = 'Gupta Tours & Travels';

/** Words for the buttons and headings, in each language. */
export const UI: Record<Lang, {
  book: string; whatsapp: string; faq: string; related: string; langs: string; home: string;
  call: string; quote: string; noPrice: string;
}> = {
  en: {
    book: 'Book a cab', whatsapp: 'Book on WhatsApp', faq: 'Common questions', related: 'Related pages',
    langs: 'Read this in', home: 'Home', call: 'Call', quote: 'Ask for a quote',
    noPrice: 'Fares depend on the vehicle and the trip and are confirmed before you travel.',
  },
  hi: {
    book: 'कैब बुक करें', whatsapp: 'WhatsApp पर बुक करें', faq: 'अक्सर पूछे जाने वाले सवाल', related: 'और जानकारी',
    langs: 'यह पेज पढ़ें', home: 'होम', call: 'कॉल करें', quote: 'किराया पूछें',
    noPrice: 'किराया गाड़ी और सफ़र के हिसाब से तय होता है और यात्रा से पहले कन्फ़र्म किया जाता है।',
  },
  mr: {
    book: 'कॅब बुक करा', whatsapp: 'WhatsApp वर बुक करा', faq: 'नेहमी विचारले जाणारे प्रश्न', related: 'अधिक माहिती',
    langs: 'हे पान वाचा', home: 'होम', call: 'कॉल करा', quote: 'भाडे विचारा',
    noPrice: 'भाडे गाडी आणि प्रवासानुसार ठरते आणि प्रवासापूर्वी निश्चित केले जाते.',
  },
};

export const LANG_NAME: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', mr: 'मराठी' };

const FLEET_LINE = 'Dzire and Aura sedans, Honda City and Ciaz, Ertiga, XL6, Innova Crysta, Carens, 12 and 17 seat Tempo Travellers and coaches';

// ---------------------------------------------------------------------------
// English: Mumbai areas
// ---------------------------------------------------------------------------

function areaPage(a: Area): Landing {
  const where = a.aka ? `${a.name} (${a.aka})` : a.name;
  const nmia = a.nmiaMins
    ? ` Navi Mumbai International Airport is about ${a.nmiaMins} minutes away.`
    : '';
  return {
    path: areaPath(a.slug),
    lang: 'en',
    title: `Cab Service in ${a.name}, Mumbai | Taxi and Car Rental 24x7`,
    description: `Book a cab in ${a.name}: airport transfers, local hourly car rental and outstation taxis with a chauffeur. Pickups across ${a.name}, 24x7.`,
    eyebrow: `${a.region} · Mumbai`,
    h1: `Cab and Taxi Service in ${a.name}`,
    intro: `Chauffeur-driven cabs from anywhere in ${where} - to the airport, around the city by the hour, or out of town. ${a.note}`,
    sections: [
      {
        h2: `${a.name} to Mumbai airport`,
        paras: [
          `From ${a.name} to Chhatrapati Shivaji Maharaj International Airport (Terminal 1 or Terminal 2) usually takes ${a.airportMins} minutes outside peak hours.${nmia} We note your flight number, so a delayed landing does not cost you the car, and for early departures the cab reaches your gate before the agreed time - not "on the way".`,
        ],
      },
      {
        h2: `Local car rental in ${a.name}`,
        paras: [
          `For meetings, shopping or a day of errands, book the car by the hour: 4 hours / 40 km or 8 hours / 80 km, with the driver staying with you between stops. Extra hours and kilometres are billed at the agreed rate on their own lines, and toll and parking at actuals.`,
        ],
      },
      {
        h2: `Outstation cabs from ${a.name}`,
        paras: [
          `Most trips from ${a.name} start on ${a.exitRoad}. One-way drops and return trips both work - Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Alibaug and Goa are the ones we run most weeks.`,
        ],
      },
      {
        h2: `Where we pick up in ${a.name}`,
        list: a.landmarks,
        paras: [`Or any home, office, hotel or station in ${a.name} - give the building name or drop a map pin when you book.`],
      },
      {
        h2: 'Cars you can book',
        paras: [`${FLEET_LINE}. Every vehicle comes with a verified chauffeur.`],
      },
    ],
    faqs: [
      {
        q: `How long does a cab from ${a.name} to Mumbai airport take?`,
        a: `Usually ${a.airportMins} minutes outside peak hours. In the morning and evening rush allow more, and for an early flight we suggest leaving a little earlier than the map says.${nmia}`,
      },
      {
        q: `Can I get a taxi in ${a.name} late at night?`,
        a: `Yes. The booking desk runs 24x7, and night and early-morning airport pickups in ${a.name} are booked every day. Booking a few hours ahead gives you the widest choice of cars.`,
      },
      {
        q: `Do you have cabs near me in ${a.name} for outstation trips?`,
        a: `Yes - the car comes to your door in ${a.name}, one way or return. Fixed-fare routes such as Mumbai to Pune show the fare when you book; other routes are quoted before you travel.`,
      },
    ],
    links: [
      ...a.nearby.map((s) => { const n = AREAS.find((x) => x.slug === s)!; return { label: `Cab service in ${n.name}`, to: areaPath(s) }; }),
      { label: 'Mumbai airport cab', to: '/mumbai-airport-cab' },
      { label: 'Hourly car rental in Mumbai', to: '/hourly-car-rental-mumbai' },
      { label: 'Outstation cabs from Mumbai', to: '/outstation' },
    ],
    crumbs: [{ label: 'Cab service', to: '/services' }, { label: a.name }],
    cta: { label: 'Book a cab', to: '/book' },
    serviceType: 'Taxi and car rental with chauffeur',
    areaServed: [a.name, 'Mumbai'],
  };
}

// ---------------------------------------------------------------------------
// English: airports and kinds of trip
// ---------------------------------------------------------------------------

const EN_TOPICS: Landing[] = [
  {
    path: '/mumbai-airport-cab', lang: 'en', group: 'airport',
    title: 'Mumbai Airport Cab - Pickup and Drop, T1 and T2 | 24x7',
    description: 'Mumbai airport taxi for pickup and drop at CSMIA Terminal 1 and Terminal 2. Flight-tracked pickups, sedans to Tempo Travellers, 24x7 from anywhere in Mumbai.',
    eyebrow: 'Airport transfers',
    h1: 'Mumbai Airport Pickup and Drop Cab',
    intro: 'A private cab to or from Chhatrapati Shivaji Maharaj International Airport (CSMIA), Terminal 1 at Santacruz and Terminal 2 at Sahar, at any hour. The car is booked for you alone - no surge, no sharing, no waiting at the taxi rank.',
    sections: [
      {
        h2: 'Airport drop',
        paras: ['Tell us the flight and the terminal. We work back from the departure time with a margin for traffic, and the car reaches your building before the pickup time. Terminal 2 handles international and most full-service domestic flights; some low-cost domestic flights use Terminal 1 - your ticket says which.'],
      },
      {
        h2: 'Airport pickup',
        paras: ['We record the flight number and follow the actual landing time, so a delay does not mean a missed car. The chauffeur waits at the arrival pickup area and, on request, at the arrivals gate with a name card. Tell us the number of bags so the right boot comes.'],
      },
      {
        h2: 'Which car for the airport',
        list: [
          'Sedan (Dzire, Aura): up to 4 passengers and 2 large bags',
          'Ertiga or XL6: up to 6 passengers, or 4 with lots of luggage',
          'Innova Crysta: 6 to 7 in comfort, the usual choice for families and guests',
          'Tempo Traveller: groups of 12 or 17 arriving together',
        ],
      },
      {
        h2: 'Also: Navi Mumbai and Pune airports',
        paras: ['We run the same service to Navi Mumbai International Airport and drop or collect at Pune Airport for travellers who fly from there.'],
      },
    ],
    faqs: [
      { q: 'Do you track flight delays for Mumbai airport pickups?', a: 'Yes. The flight number is on the booking and the pickup follows the real landing time, so you are not charged for a car that left because the plane was late.' },
      { q: 'Is airport parking or toll extra?', a: 'Airport parking and any toll on the way are passed through at actuals and shown on their own line of the bill.' },
      { q: 'Can I book a cab for a 3 am flight?', a: 'Yes - the desk is open 24x7 and early-morning airport drops are among the trips we run most. Book the evening before at the latest.' },
      { q: 'Which terminal is my flight?', a: 'International flights and most full-service domestic flights use Terminal 2 (Sahar); some domestic flights use Terminal 1 (Santacruz). Check the ticket and tell us - the drive differs by a few minutes.' },
    ],
    links: [
      { label: 'Navi Mumbai airport cab', to: '/navi-mumbai-airport-cab' },
      { label: 'Airport transfers', to: '/services/airport-transfers' },
      { label: 'Cab service in Andheri', to: areaPath('andheri') },
      { label: 'Mumbai to Pune cab', to: enRoutePath('pune') },
    ],
    crumbs: [{ label: 'Services', to: '/services' }, { label: 'Mumbai airport cab' }],
    cta: { label: 'Book an airport cab', to: '/book?tab=AIRPORT' },
    serviceType: 'Airport transfer',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  {
    path: '/navi-mumbai-airport-cab', lang: 'en',
    title: 'Navi Mumbai Airport Cab - NMIA Pickup and Drop, 24x7',
    description: 'Taxi to and from Navi Mumbai International Airport (NMIA) from Mumbai, Thane, Navi Mumbai and Panvel. Flight-tracked pickups, sedans, SUVs and Tempo Travellers.',
    eyebrow: 'Airport transfers',
    h1: 'Navi Mumbai International Airport Cab',
    intro: 'Pickups and drops at Navi Mumbai International Airport (NMIA) near Panvel and Ulwe, from Navi Mumbai, Panvel, Thane and the rest of Mumbai. Booked for you alone, with the flight followed so a delay does not cost you the car.',
    sections: [
      {
        h2: 'Getting there from Mumbai',
        paras: ['From the island city and the eastern suburbs the Atal Setu (Mumbai Trans Harbour Link) and the Sion–Panvel Highway are the usual roads; from the western suburbs allow extra time to cross the city. From Vashi, Nerul, Kharghar and Panvel the airport is close - typically 15 to 35 minutes.'],
      },
      {
        h2: 'Pickups at arrivals',
        paras: ['Give us the flight number when you book; the chauffeur follows the landing time and waits at the arrival pickup area, or at the gate with a name card if you ask.'],
      },
      {
        h2: 'Onward from NMIA',
        paras: ['The airport sits next to the Pune Expressway and the Goa highway, so an arrival can go straight on to Pune, Lonavala, Alibaug or the Konkan without coming into Mumbai.'],
      },
    ],
    faqs: [
      { q: 'How far is Navi Mumbai airport from Mumbai?', a: 'It depends where you start: from Navi Mumbai and Panvel it is usually 15 to 35 minutes; from South Mumbai via Atal Setu around an hour; from the western suburbs allow more for city traffic.' },
      { q: 'Is the Atal Setu toll included?', a: 'Tolls are passed through at actuals and shown on their own line, so you see exactly what was paid.' },
      { q: 'Can I go from Navi Mumbai airport directly to Pune?', a: 'Yes. The Pune Expressway starts close to the airport, so a direct drop to Pune or Lonavala is a common booking.' },
    ],
    links: [
      { label: 'Mumbai airport cab (T1 and T2)', to: '/mumbai-airport-cab' },
      { label: 'Cab service in Navi Mumbai', to: areaPath('navi-mumbai') },
      { label: 'Cab service in Panvel', to: areaPath('panvel') },
      { label: 'Mumbai to Pune cab', to: enRoutePath('pune') },
    ],
    crumbs: [{ label: 'Services', to: '/services' }, { label: 'Navi Mumbai airport cab' }],
    cta: { label: 'Book an airport cab', to: '/book?tab=AIRPORT' },
    serviceType: 'Airport transfer',
    areaServed: ['Navi Mumbai', 'Panvel', 'Mumbai', 'Thane'],
  },
  {
    path: '/one-way-cab-mumbai', lang: 'en',
    title: 'One Way Cab from Mumbai - Outstation Drop Taxi',
    description: 'One-way outstation cab from Mumbai to Pune, Nashik, Shirdi, Lonavala, Goa and more. Pay for the drop only, with a chauffeur, sedans to Innova Crysta. 24x7.',
    eyebrow: 'One-way outstation',
    h1: 'One Way Cab from Mumbai',
    intro: 'Need to get somewhere and not come back the same day? A one-way cab drops you at the destination and you pay for that journey - not a return you will not use. It is the usual way people book Mumbai to Pune, Pune airport drops, relocations and college returns.',
    sections: [
      {
        h2: 'How a one-way drop works',
        list: [
          'Choose the destination and the car; fixed-fare routes show the fare straight away',
          'The car comes to your door anywhere in Mumbai, Thane or Navi Mumbai',
          'Toll is shown as included or at actuals before you confirm',
          'The fare is confirmed before the trip - nothing is added for the empty run back unless the quote said so',
        ],
      },
      {
        h2: 'Popular one-way routes',
        paras: ['Mumbai to Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Alibaug, Surat and Goa. For other towns, send the trip and the office quotes it.'],
      },
    ],
    faqs: [
      { q: 'Is a one-way cab cheaper than a round trip?', a: 'For a drop where you are not coming back the same day, yes - you pay for the one journey. If you are returning within a day or two, a round trip with the same car is usually better value.' },
      { q: 'Can I book a one-way cab from Pune to Mumbai?', a: 'Yes, ask when you book. Return-direction trips depend on a car being in that city, so the office confirms availability and the fare.' },
    ],
    links: [
      { label: 'Round trip cab from Mumbai', to: '/round-trip-cab-mumbai' },
      { label: 'Mumbai to Pune cab', to: enRoutePath('pune') },
      { label: 'Mumbai to Nashik cab', to: enRoutePath('nashik') },
      { label: 'All outstation routes', to: '/outstation' },
    ],
    crumbs: [{ label: 'Outstation', to: '/outstation' }, { label: 'One way cab' }],
    cta: { label: 'See one-way fares', to: '/outstation?tab=OUTSTATION&leg=ONE_WAY' },
    serviceType: 'One-way outstation taxi',
    areaServed: ['Mumbai', 'Maharashtra'],
  },
  {
    path: '/round-trip-cab-mumbai', lang: 'en',
    title: 'Round Trip Cab from Mumbai - Outstation Return Taxi',
    description: 'Round trip outstation cab from Mumbai with the same car and driver for the whole trip: weekend getaways, pilgrimages and multi-day tours.',
    eyebrow: 'Return trips',
    h1: 'Round Trip Cab from Mumbai',
    intro: 'For a weekend away, a pilgrimage or a multi-day tour, a round trip keeps the same car and chauffeur with you from the day you leave to the day you are back - for the sightseeing in between too.',
    sections: [
      {
        h2: 'What is included',
        list: [
          'The same vehicle and driver for every day of the trip',
          'Local running at the destination for sightseeing',
          'Driver allowance, toll and any state permit shown on the quote',
          'One booking and one bill for the whole trip',
        ],
      },
      {
        h2: 'Trips people book as round trips',
        paras: ['Lonavala and Khandala day trips, Mahabaleshwar and Panchgani weekends, Shirdi with Shani Shingnapur, Nashik with Trimbakeshwar, Alibaug and Kashid beaches, and Konkan or Goa holidays.'],
      },
    ],
    faqs: [
      { q: 'Does the driver stay with us at the destination?', a: 'Yes. On a round trip the car and chauffeur stay with you for the days booked, including local sightseeing at the destination.' },
      { q: 'How is a multi-day trip billed?', a: 'As one booking: the agreed fare with driver allowance per day, plus toll, parking and permits shown separately. You see the full figure before you travel.' },
    ],
    links: [
      { label: 'One way cab from Mumbai', to: '/one-way-cab-mumbai' },
      { label: 'Weekend trips from Mumbai', to: '/weekend-trips' },
      { label: 'Mumbai to Mahabaleshwar cab', to: enRoutePath('mahabaleshwar') },
      { label: 'Mumbai to Shirdi cab', to: enRoutePath('shirdi') },
    ],
    crumbs: [{ label: 'Outstation', to: '/outstation' }, { label: 'Round trip cab' }],
    cta: { label: 'Plan a round trip', to: '/outstation?tab=OUTSTATION&leg=RETURN' },
    serviceType: 'Round-trip outstation taxi',
    areaServed: ['Mumbai', 'Maharashtra', 'Goa', 'Gujarat'],
  },
  {
    path: '/hourly-car-rental-mumbai', lang: 'en', group: 'local',
    title: 'Hourly Car Rental in Mumbai with Driver - 4 hr and 8 hr',
    description: 'Rent a car with driver by the hour in Mumbai: 4 hours / 40 km and 8 hours / 80 km packages for meetings, shopping and sightseeing. Sedans, SUVs and Innova Crysta.',
    eyebrow: 'Local travel',
    h1: 'Hourly Car Rental in Mumbai with Driver',
    intro: 'A car and chauffeur for as many stops as your day needs - meetings across the city, a hospital visit, shopping, a wedding errand run or Mumbai sightseeing - without booking a new cab at every stop.',
    sections: [
      {
        h2: 'Packages',
        list: [
          '4 hours / 40 km - a few stops or a half-day',
          '8 hours / 80 km - a full working day or a city tour',
          'Extra hours and extra kilometres at the agreed rate, each on its own line',
          'Toll and parking at actuals against receipts',
        ],
      },
      {
        h2: 'Where it works',
        paras: ['Anywhere in Mumbai, Thane and Navi Mumbai. Popular uses are Mumbai Darshan sightseeing (Gateway of India, Marine Drive, Siddhivinayak, Haji Ali, Bandra), office days around BKC and Andheri, and wedding-day guest runs.'],
      },
    ],
    faqs: [
      { q: 'What is an 8 hour 80 km package?', a: 'The car and driver are yours for up to 8 hours or 80 km, whichever comes first. Beyond that, extra hours and kilometres are charged at the agreed rate and shown separately.' },
      { q: 'Can I use an hourly car for Mumbai sightseeing?', a: 'Yes - an 8 hour package covers a full Mumbai Darshan; our Mumbai tours page suggests routes.' },
    ],
    links: [
      { label: 'Mumbai sightseeing tours', to: '/tours/mumbai' },
      { label: 'Local travel', to: '/services/local-travel' },
      { label: 'Corporate car rental', to: '/corporate' },
      { label: 'Wedding car rental', to: '/weddings' },
    ],
    crumbs: [{ label: 'Services', to: '/services' }, { label: 'Hourly car rental' }],
    cta: { label: 'Book by the hour', to: '/book?tab=LOCAL' },
    serviceType: 'Hourly car rental with driver',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
];

// ---------------------------------------------------------------------------
// English route pages (rendered by RouteLanding with the live fares)
// ---------------------------------------------------------------------------

function enRoutePage(r: RouteInfo): Landing {
  const n = r.name.en;
  const short = n.replace(/ \(.*\)$/, '');
  return {
    path: enRoutePath(r.key), lang: 'en', group: r.localised ? `route-${r.key}` : undefined, external: true,
    title: `Mumbai to ${short} Cab - One Way and Round Trip Taxi`,
    description: `Book a Mumbai to ${short} cab with a chauffeur, one way or return. About ${r.km} km, roughly ${r.hours.en}. Sedans, SUVs and Innova Crysta, 24x7.`,
    eyebrow: 'Outstation cab from Mumbai',
    h1: `Mumbai to ${short} Cab`,
    intro: `A private, chauffeur-driven cab from anywhere in Mumbai, Navi Mumbai or Thane to ${n}, one way or return. It is about ${r.km} km by road via ${r.via.en}, roughly ${r.hours.en} depending on traffic. ${r.note.en}`,
    sections: [
      { h2: `Places to see in and around ${short}`, list: r.seeThere.en },
      { h2: 'Good for', list: r.goodFor },
    ],
    faqs: [
      { q: `How far is ${short} from Mumbai by road?`, a: `About ${r.km} km via ${r.via.en}, roughly ${r.hours.en} by car depending on traffic and where in Mumbai you are picked up.` },
      { q: `Can I book a one-way cab from Mumbai to ${short}?`, a: `Yes. Choose one way when you book; you pay for the drop only. For a return trip the same car and driver stay with you.` },
    ],
    links: [],
    crumbs: [{ label: 'Outstation', to: '/outstation' }, { label: `Mumbai to ${short}` }],
    cta: { label: 'See cabs and fares', to: `/outstation?tab=OUTSTATION&route=${r.key}` },
    serviceType: 'Outstation taxi',
    areaServed: ['Mumbai', short],
  };
}

// ---------------------------------------------------------------------------
// Hindi
// ---------------------------------------------------------------------------

const HI_FLEET = 'डिज़ायर और ऑरा सेडान, होंडा सिटी, अर्टिगा, XL6, इनोवा क्रिस्टा, कैरेंस, 12 और 17 सीट टेम्पो ट्रैवलर और बस';

const hiRoutes = ROUTE_INFO.filter((r) => r.localised);

function hiRoutePage(r: RouteInfo): Landing {
  const n = r.name.hi;
  return {
    path: hiRoutePath(r.key), lang: 'hi', group: `route-${r.key}`,
    title: `मुंबई से ${n} कैब बुकिंग - वन वे और राउंड ट्रिप टैक्सी`,
    description: `मुंबई से ${n} टैक्सी ड्राइवर के साथ, वन वे या राउंड ट्रिप। लगभग ${r.km} किमी, करीब ${r.hours.hi}। सेडान, अर्टिगा, इनोवा क्रिस्टा - 24x7 बुकिंग।`,
    eyebrow: 'मुंबई से आउटस्टेशन कैब',
    h1: `मुंबई से ${n} कैब बुकिंग`,
    intro: `मुंबई, ठाणे या नवी मुंबई में कहीं से भी ${n} के लिए प्राइवेट कैब, ड्राइवर के साथ - वन वे या आना-जाना। सड़क से दूरी लगभग ${r.km} किमी है, ${r.via.hi} होकर करीब ${r.hours.hi} लगते हैं। ${r.note.hi}`,
    sections: [
      { h2: `${n} में घूमने की जगहें`, list: r.seeThere.hi },
      {
        h2: 'गाड़ियाँ',
        paras: [`4 लोगों के लिए सेडान (डिज़ायर, ऑरा), 6 लोगों के लिए अर्टिगा या XL6, आराम के लिए इनोवा क्रिस्टा, और ग्रुप के लिए टेम्पो ट्रैवलर। हर गाड़ी के साथ वेरिफ़ाइड ड्राइवर।`],
      },
      { h2: 'किराया', paras: [`टोल शामिल है या अलग, यह बुकिंग से पहले बताया जाता है। ${UI.hi.noPrice}`] },
    ],
    faqs: [
      { q: `मुंबई से ${n} कितनी दूर है?`, a: `सड़क से लगभग ${r.km} किमी, ${r.via.hi} होकर। ट्रैफ़िक के हिसाब से करीब ${r.hours.hi} लगते हैं।` },
      { q: `क्या मुंबई से ${n} वन वे कैब मिलती है?`, a: 'हाँ। वन वे चुनें तो सिर्फ़ ड्रॉप का किराया लगता है। राउंड ट्रिप में वही गाड़ी और ड्राइवर पूरी यात्रा साथ रहते हैं।' },
      { q: 'क्या रात में या सुबह जल्दी कैब मिलेगी?', a: 'हाँ, बुकिंग 24x7 होती है। सुबह जल्दी निकलना हो तो एक दिन पहले बुक कर लें।' },
    ],
    links: [
      { label: 'मुंबई आउटस्टेशन कैब', to: '/hi/outstation-cab-mumbai' },
      ...hiRoutes.filter((x) => x.key !== r.key).slice(0, 5).map((x) => ({ label: `मुंबई से ${x.name.hi} कैब`, to: hiRoutePath(x.key) })),
    ],
    crumbs: [{ label: 'हिन्दी', to: '/hi/mumbai-cab-booking' }, { label: `मुंबई से ${n}` }],
    cta: { label: 'किराया और गाड़ियाँ देखें', to: `/outstation?tab=OUTSTATION&route=${r.key}` },
    serviceType: 'Outstation taxi',
    areaServed: ['Mumbai', r.name.en],
  };
}

const HI_PAGES: Landing[] = [
  {
    path: '/hi/mumbai-cab-booking', lang: 'hi', group: 'home',
    title: 'मुंबई में कैब बुकिंग और कार किराये पर - 24x7 टैक्सी सेवा',
    description: 'मुंबई में ड्राइवर के साथ कार बुकिंग: एयरपोर्ट पिकअप-ड्रॉप, लोकल टैक्सी घंटे के हिसाब से, आउटस्टेशन कैब, शादी और कॉर्पोरेट गाड़ियाँ। 24x7, गोरेगाँव (प.) से।',
    eyebrow: 'गुप्ता टूर्स एंड ट्रैवल्स · मुंबई',
    h1: 'मुंबई में कैब बुकिंग और टैक्सी सेवा',
    intro: 'एयरपोर्ट जाना हो, शहर में दिन भर के काम हों, या पुणे, नासिक, शिर्डी जैसी आउटस्टेशन यात्रा - ड्राइवर के साथ साफ़-सुथरी AC गाड़ी आपके दरवाज़े पर। हमारा ऑफ़िस गोरेगाँव (पश्चिम) में है और बुकिंग 24 घंटे, सातों दिन चलती है।',
    sections: [
      {
        h2: 'हमारी सेवाएँ',
        list: [
          'मुंबई एयरपोर्ट (T1, T2) और नवी मुंबई एयरपोर्ट पिकअप-ड्रॉप',
          'लोकल कार किराया - 4 घंटे/40 किमी और 8 घंटे/80 किमी',
          'आउटस्टेशन कैब - वन वे और राउंड ट्रिप',
          'शादी, इवेंट और ग्रुप के लिए कई गाड़ियाँ',
          'कंपनियों के लिए कॉर्पोरेट कार सेवा, GST बिल के साथ',
        ],
      },
      { h2: 'गाड़ियाँ', paras: [`${HI_FLEET}। हर गाड़ी के साथ वेरिफ़ाइड ड्राइवर।`] },
      { h2: 'कहाँ से पिकअप', paras: ['पूरा मुंबई - अंधेरी, गोरेगाँव, मलाड, बोरीवली, बांद्रा, दादर, पवई, घाटकोपर, दक्षिण मुंबई - और ठाणे, नवी मुंबई, पनवेल, मीरा रोड।'] },
    ],
    faqs: [
      { q: 'कैब कैसे बुक करें?', a: 'वेबसाइट पर बुकिंग फ़ॉर्म भरें या WhatsApp पर यात्रा की जानकारी भेजें। गाड़ी भेजने से पहले किराया कन्फ़र्म किया जाता है।' },
      { q: 'क्या टोल और पार्किंग अलग से है?', a: 'लोकल और एयरपोर्ट ट्रिप में टोल और पार्किंग असल खर्च के हिसाब से बिल में अलग लाइन पर दिखते हैं। कुछ आउटस्टेशन किराये में टोल शामिल होता है - यह बुकिंग से पहले बताया जाता है।' },
      { q: 'क्या GST बिल मिलता है?', a: 'हाँ, हम GST रजिस्टर्ड हैं और हर बिल GST वाला होता है।' },
    ],
    links: [
      { label: 'मुंबई एयरपोर्ट टैक्सी', to: '/hi/mumbai-airport-taxi' },
      { label: 'लोकल टैक्सी मुंबई', to: '/hi/local-taxi-mumbai' },
      { label: 'आउटस्टेशन कैब', to: '/hi/outstation-cab-mumbai' },
      { label: 'शादी के लिए कार', to: '/hi/shaadi-ke-liye-car' },
      { label: 'मुंबई से नासिक कैब', to: hiRoutePath('nashik') },
      { label: 'मुंबई से पुणे कैब', to: hiRoutePath('pune') },
    ],
    crumbs: [{ label: 'हिन्दी' }],
    cta: { label: 'कैब बुक करें', to: '/book' },
    serviceType: 'Taxi and car rental with chauffeur',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai', 'Maharashtra'],
  },
  {
    path: '/hi/mumbai-airport-taxi', lang: 'hi', group: 'airport',
    title: 'मुंबई एयरपोर्ट टैक्सी - पिकअप और ड्रॉप, T1 और T2 | 24x7',
    description: 'मुंबई एयरपोर्ट (CSMIA) टर्मिनल 1 और 2 के लिए कैब, फ़्लाइट ट्रैकिंग के साथ पिकअप। नवी मुंबई एयरपोर्ट भी। सेडान से टेम्पो ट्रैवलर तक, 24x7।',
    eyebrow: 'एयरपोर्ट ट्रांसफ़र',
    h1: 'मुंबई एयरपोर्ट पिकअप और ड्रॉप टैक्सी',
    intro: 'छत्रपति शिवाजी महाराज अंतरराष्ट्रीय एयरपोर्ट - टर्मिनल 1 (सांताक्रूज़) और टर्मिनल 2 (सहार) - के लिए किसी भी समय प्राइवेट कैब। गाड़ी सिर्फ़ आपके लिए, कोई शेयरिंग नहीं।',
    sections: [
      { h2: 'एयरपोर्ट ड्रॉप', paras: ['फ़्लाइट का समय और टर्मिनल बताइए। ट्रैफ़िक का मार्जिन जोड़कर पिकअप का समय तय होता है और गाड़ी समय से पहले आपकी बिल्डिंग पर पहुँचती है।'] },
      { h2: 'एयरपोर्ट पिकअप', paras: ['हम फ़्लाइट नंबर नोट करते हैं और असल लैंडिंग के हिसाब से ड्राइवर पहुँचता है - फ़्लाइट लेट हुई तो भी गाड़ी नहीं छूटती। माँगने पर ड्राइवर नाम का कार्ड लेकर अराइवल गेट पर मिलता है।'] },
      { h2: 'नवी मुंबई और पुणे एयरपोर्ट', paras: ['नवी मुंबई अंतरराष्ट्रीय एयरपोर्ट और पुणे एयरपोर्ट के लिए भी यही सेवा।'] },
    ],
    faqs: [
      { q: 'सुबह 3 बजे की फ़्लाइट के लिए कैब मिलेगी?', a: 'हाँ, बुकिंग 24x7 है। पिछली शाम तक बुक कर लें।' },
      { q: 'एयरपोर्ट पार्किंग का चार्ज किसका?', a: 'पार्किंग और टोल असल खर्च के हिसाब से बिल में अलग दिखते हैं।' },
    ],
    links: [
      { label: 'मुंबई में कैब बुकिंग', to: '/hi/mumbai-cab-booking' },
      { label: 'लोकल टैक्सी मुंबई', to: '/hi/local-taxi-mumbai' },
      { label: 'मुंबई से पुणे कैब', to: hiRoutePath('pune') },
    ],
    crumbs: [{ label: 'हिन्दी', to: '/hi/mumbai-cab-booking' }, { label: 'एयरपोर्ट टैक्सी' }],
    cta: { label: 'एयरपोर्ट कैब बुक करें', to: '/book?tab=AIRPORT' },
    serviceType: 'Airport transfer',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  {
    path: '/hi/local-taxi-mumbai', lang: 'hi', group: 'local',
    title: 'मुंबई में लोकल टैक्सी - घंटे के हिसाब से कार किराये पर',
    description: 'मुंबई में ड्राइवर के साथ कार घंटे के हिसाब से: 4 घंटे/40 किमी और 8 घंटे/80 किमी पैकेज। मीटिंग, शॉपिंग, मुंबई दर्शन के लिए। 24x7 बुकिंग।',
    eyebrow: 'लोकल यात्रा',
    h1: 'मुंबई में लोकल टैक्सी और घंटे वाली कार',
    intro: 'दिन भर कई जगह जाना हो - मीटिंग, अस्पताल, शॉपिंग या मुंबई दर्शन - तो हर जगह नई टैक्सी ढूँढने की ज़रूरत नहीं। गाड़ी और ड्राइवर पूरे समय आपके साथ रहते हैं।',
    sections: [
      { h2: 'पैकेज', list: ['4 घंटे / 40 किमी', '8 घंटे / 80 किमी', 'ज़्यादा घंटे और किमी तय रेट पर, बिल में अलग से', 'टोल और पार्किंग असल खर्च पर'] },
      { h2: 'मुंबई दर्शन', paras: ['गेटवे ऑफ़ इंडिया, मरीन ड्राइव, सिद्धिविनायक, हाजी अली, बांद्रा - 8 घंटे के पैकेज में पूरा शहर घूम सकते हैं।'] },
    ],
    faqs: [
      { q: '8 घंटे 80 किमी पैकेज क्या है?', a: 'गाड़ी 8 घंटे या 80 किमी तक (जो पहले पूरा हो) आपकी। उसके बाद अतिरिक्त घंटे और किमी तय रेट पर।' },
    ],
    links: [
      { label: 'मुंबई में कैब बुकिंग', to: '/hi/mumbai-cab-booking' },
      { label: 'मुंबई एयरपोर्ट टैक्सी', to: '/hi/mumbai-airport-taxi' },
      { label: 'Mumbai sightseeing tours', to: '/tours/mumbai' },
    ],
    crumbs: [{ label: 'हिन्दी', to: '/hi/mumbai-cab-booking' }, { label: 'लोकल टैक्सी' }],
    cta: { label: 'लोकल कार बुक करें', to: '/book?tab=LOCAL' },
    serviceType: 'Hourly car rental with driver',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  {
    path: '/hi/outstation-cab-mumbai', lang: 'hi', group: 'outstation',
    title: 'मुंबई से आउटस्टेशन कैब - वन वे और राउंड ट्रिप टैक्सी',
    description: 'मुंबई से पुणे, नासिक, शिर्डी, लोनावला, महाबलेश्वर, अलीबाग और गोवा के लिए आउटस्टेशन कैब, ड्राइवर के साथ। वन वे या राउंड ट्रिप, 24x7।',
    eyebrow: 'आउटस्टेशन',
    h1: 'मुंबई से आउटस्टेशन कैब बुकिंग',
    intro: 'वीकेंड ट्रिप, तीर्थ यात्रा या बिज़नेस - मुंबई से बाहर जाने के लिए ड्राइवर के साथ गाड़ी। सिर्फ़ ड्रॉप चाहिए तो वन वे, वापस भी आना है तो राउंड ट्रिप जिसमें वही गाड़ी और ड्राइवर साथ रहते हैं।',
    sections: [
      { h2: 'लोकप्रिय रूट', list: hiRoutes.map((r) => `मुंबई से ${r.name.hi} - लगभग ${r.km} किमी, ${r.hours.hi}`) },
      { h2: 'किराया', paras: [`ड्राइवर भत्ता, टोल और परमिट कोटेशन में साफ़ दिखते हैं। ${UI.hi.noPrice}`] },
    ],
    faqs: [
      { q: 'वन वे और राउंड ट्रिप में क्या फ़र्क है?', a: 'वन वे में सिर्फ़ मंज़िल तक छोड़ा जाता है। राउंड ट्रिप में वही गाड़ी पूरे सफ़र और घूमने के दौरान साथ रहती है और वापस लाती है।' },
    ],
    links: hiRoutes.map((r) => ({ label: `मुंबई से ${r.name.hi} कैब`, to: hiRoutePath(r.key) })),
    crumbs: [{ label: 'हिन्दी', to: '/hi/mumbai-cab-booking' }, { label: 'आउटस्टेशन' }],
    cta: { label: 'आउटस्टेशन किराया देखें', to: '/outstation?tab=OUTSTATION' },
    serviceType: 'Outstation taxi',
    areaServed: ['Mumbai', 'Maharashtra', 'Goa'],
  },
  {
    path: '/hi/shaadi-ke-liye-car', lang: 'hi', group: 'wedding',
    title: 'शादी के लिए कार बुकिंग मुंबई - दूल्हे की गाड़ी और मेहमानों की कैब',
    description: 'मुंबई में शादी के लिए कार किराये पर: सजी हुई दूल्हे की गाड़ी, मेहमानों के लिए सेडान, इनोवा और टेम्पो ट्रैवलर, एयरपोर्ट पिकअप। एक कोऑर्डिनेटर, एक बिल।',
    eyebrow: 'शादी और इवेंट',
    h1: 'शादी के लिए कार और मेहमानों की टैक्सी',
    intro: 'शादी में गाड़ियों का इंतज़ाम सबसे ज़्यादा भागदौड़ वाला काम है - दूल्हे की गाड़ी, बाहर से आने वाले मेहमानों का एयरपोर्ट-स्टेशन पिकअप, होटल से वेन्यू तक शटल। यह सब एक जगह से, एक बिल में।',
    sections: [
      { h2: 'क्या-क्या मिलता है', list: ['दूल्हा-दुल्हन के लिए प्रीमियम गाड़ी', 'मेहमानों के लिए सेडान, अर्टिगा, इनोवा क्रिस्टा', 'बड़े ग्रुप के लिए टेम्पो ट्रैवलर और बस', 'एयरपोर्ट और रेलवे स्टेशन पिकअप', 'होटल-वेन्यू शटल'] },
    ],
    faqs: [
      { q: 'कितने दिन पहले बुक करें?', a: 'शादी के सीज़न में 2-4 हफ़्ते पहले बताएँ ताकि सारी गाड़ियाँ एक साथ तय हो सकें।' },
    ],
    links: [
      { label: 'Wedding car rental (English)', to: '/weddings' },
      { label: 'मुंबई में कैब बुकिंग', to: '/hi/mumbai-cab-booking' },
    ],
    crumbs: [{ label: 'हिन्दी', to: '/hi/mumbai-cab-booking' }, { label: 'शादी के लिए कार' }],
    cta: { label: 'शादी की गाड़ियाँ पूछें', to: '/weddings' },
    serviceType: 'Wedding car rental',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  ...hiRoutes.map(hiRoutePage),
];

// ---------------------------------------------------------------------------
// Marathi
// ---------------------------------------------------------------------------

const MR_FLEET = 'डिझायर व ऑरा सेडान, होंडा सिटी, अर्टिगा, XL6, इनोव्हा क्रिस्टा, कॅरेन्स, 12 व 17 आसनी टेम्पो ट्रॅव्हलर आणि बस';

function mrRoutePage(r: RouteInfo): Landing {
  const n = r.name.mr;
  return {
    path: mrRoutePath(r.key), lang: 'mr', group: `route-${r.key}`,
    title: `मुंबई ते ${n} टॅक्सी बुकिंग - वन वे व राउंड ट्रिप कॅब`,
    description: `मुंबई ते ${n} कॅब चालकासह, वन वे किंवा परतीचा प्रवास. सुमारे ${r.km} किमी, साधारण ${r.hours.mr}. सेडान, अर्टिगा, इनोव्हा क्रिस्टा - 24x7 बुकिंग.`,
    eyebrow: 'मुंबईहून आउटस्टेशन कॅब',
    h1: `मुंबई ते ${n} टॅक्सी बुकिंग`,
    intro: `मुंबई, ठाणे किंवा नवी मुंबईतून कुठूनही ${n}साठी खाजगी कॅब, चालकासह - वन वे किंवा जाणे-येणे. रस्त्याने अंतर सुमारे ${r.km} किमी, ${r.via.mr} साधारण ${r.hours.mr} लागतात. ${r.note.mr}`,
    sections: [
      { h2: `${n} मधील पाहण्यासारखी ठिकाणे`, list: r.seeThere.mr },
      { h2: 'गाड्या', paras: ['4 जणांसाठी सेडान (डिझायर, ऑरा), 6 जणांसाठी अर्टिगा किंवा XL6, आरामासाठी इनोव्हा क्रिस्टा आणि ग्रुपसाठी टेम्पो ट्रॅव्हलर. प्रत्येक गाडीसोबत पडताळणी केलेला चालक.'] },
      { h2: 'भाडे', paras: [`टोल समाविष्ट आहे की वेगळा, हे बुकिंगपूर्वी सांगितले जाते. ${UI.mr.noPrice}`] },
    ],
    faqs: [
      { q: `मुंबई ते ${n} अंतर किती आहे?`, a: `रस्त्याने सुमारे ${r.km} किमी, ${r.via.mr}. वाहतुकीनुसार साधारण ${r.hours.mr} लागतात.` },
      { q: `मुंबई ते ${n} वन वे कॅब मिळते का?`, a: 'हो. वन वे निवडल्यास फक्त ड्रॉपचे भाडे लागते. राउंड ट्रिपमध्ये तीच गाडी व चालक संपूर्ण प्रवासात सोबत असतात.' },
      { q: 'रात्री किंवा पहाटे कॅब मिळेल का?', a: 'हो, बुकिंग 24x7 सुरू असते. पहाटे निघायचे असल्यास आदल्या दिवशी बुक करा.' },
    ],
    links: [
      { label: 'मुंबई आउटस्टेशन कॅब', to: '/mr/outstation-cab-mumbai' },
      ...hiRoutes.filter((x) => x.key !== r.key).slice(0, 5).map((x) => ({ label: `मुंबई ते ${x.name.mr} टॅक्सी`, to: mrRoutePath(x.key) })),
    ],
    crumbs: [{ label: 'मराठी', to: '/mr/mumbai-cab-booking' }, { label: `मुंबई ते ${n}` }],
    cta: { label: 'भाडे व गाड्या पाहा', to: `/outstation?tab=OUTSTATION&route=${r.key}` },
    serviceType: 'Outstation taxi',
    areaServed: ['Mumbai', r.name.en],
  };
}

const MR_PAGES: Landing[] = [
  {
    path: '/mr/mumbai-cab-booking', lang: 'mr', group: 'home',
    title: 'मुंबईत कॅब बुकिंग व कार भाड्याने - 24x7 टॅक्सी सेवा',
    description: 'मुंबईत चालकासह कार बुकिंग: विमानतळ पिकअप-ड्रॉप, तासाप्रमाणे लोकल टॅक्सी, आउटस्टेशन कॅब, लग्न व कॉर्पोरेट गाड्या. 24x7, गोरेगाव (प.) येथून.',
    eyebrow: 'गुप्ता टूर्स अँड ट्रॅव्हल्स · मुंबई',
    h1: 'मुंबईत कॅब बुकिंग व टॅक्सी सेवा',
    intro: 'विमानतळावर जायचे असो, शहरात दिवसभराची कामे असोत, किंवा पुणे, नाशिक, शिर्डीसारखा बाहेरगावचा प्रवास - चालकासह स्वच्छ AC गाडी तुमच्या दारात. आमचे ऑफिस गोरेगाव (पश्चिम) येथे आहे आणि बुकिंग 24 तास, सातही दिवस सुरू असते.',
    sections: [
      {
        h2: 'आमच्या सेवा',
        list: [
          'मुंबई विमानतळ (T1, T2) व नवी मुंबई विमानतळ पिकअप-ड्रॉप',
          'लोकल कार भाड्याने - 4 तास/40 किमी व 8 तास/80 किमी',
          'आउटस्टेशन कॅब - वन वे व राउंड ट्रिप',
          'लग्न, कार्यक्रम व ग्रुपसाठी अनेक गाड्या',
          'कंपन्यांसाठी कॉर्पोरेट कार सेवा, GST बिलासह',
        ],
      },
      { h2: 'गाड्या', paras: [`${MR_FLEET}. प्रत्येक गाडीसोबत पडताळणी केलेला चालक.`] },
      { h2: 'कुठून पिकअप', paras: ['संपूर्ण मुंबई - अंधेरी, गोरेगाव, मालाड, बोरिवली, वांद्रे, दादर, पवई, घाटकोपर, दक्षिण मुंबई - तसेच ठाणे, नवी मुंबई, पनवेल, मीरा रोड.'] },
    ],
    faqs: [
      { q: 'कॅब कशी बुक करायची?', a: 'वेबसाइटवरील बुकिंग फॉर्म भरा किंवा WhatsApp वर प्रवासाची माहिती पाठवा. गाडी पाठवण्यापूर्वी भाडे निश्चित केले जाते.' },
      { q: 'टोल व पार्किंग वेगळे आहे का?', a: 'लोकल व विमानतळ प्रवासात टोल व पार्किंग प्रत्यक्ष खर्चानुसार बिलात वेगळ्या ओळीवर दिसतात. काही आउटस्टेशन भाड्यांत टोल समाविष्ट असतो - हे बुकिंगपूर्वी सांगितले जाते.' },
      { q: 'GST बिल मिळते का?', a: 'हो, आम्ही GST नोंदणीकृत आहोत आणि प्रत्येक बिल GST सह असते.' },
    ],
    links: [
      { label: 'मुंबई विमानतळ टॅक्सी', to: '/mr/mumbai-airport-taxi' },
      { label: 'लोकल टॅक्सी मुंबई', to: '/mr/local-taxi-mumbai' },
      { label: 'आउटस्टेशन कॅब', to: '/mr/outstation-cab-mumbai' },
      { label: 'लग्नासाठी गाडी', to: '/mr/lagnasathi-gadi' },
      { label: 'मुंबई ते नाशिक टॅक्सी', to: mrRoutePath('nashik') },
      { label: 'मुंबई ते पुणे टॅक्सी', to: mrRoutePath('pune') },
    ],
    crumbs: [{ label: 'मराठी' }],
    cta: { label: 'कॅब बुक करा', to: '/book' },
    serviceType: 'Taxi and car rental with chauffeur',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai', 'Maharashtra'],
  },
  {
    path: '/mr/mumbai-airport-taxi', lang: 'mr', group: 'airport',
    title: 'मुंबई विमानतळ टॅक्सी - पिकअप व ड्रॉप, T1 व T2 | 24x7',
    description: 'मुंबई विमानतळ (CSMIA) टर्मिनल 1 व 2 साठी कॅब, फ्लाइट ट्रॅकिंगसह पिकअप. नवी मुंबई विमानतळ सुद्धा. सेडानपासून टेम्पो ट्रॅव्हलरपर्यंत, 24x7.',
    eyebrow: 'विमानतळ ट्रान्सफर',
    h1: 'मुंबई विमानतळ पिकअप व ड्रॉप टॅक्सी',
    intro: 'छत्रपती शिवाजी महाराज आंतरराष्ट्रीय विमानतळ - टर्मिनल 1 (सांताक्रूझ) व टर्मिनल 2 (सहार) - साठी कोणत्याही वेळी खाजगी कॅब. गाडी फक्त तुमच्यासाठी, शेअरिंग नाही.',
    sections: [
      { h2: 'विमानतळ ड्रॉप', paras: ['फ्लाइटची वेळ व टर्मिनल सांगा. वाहतुकीचा वेळ धरून पिकअपची वेळ ठरते आणि गाडी वेळेआधी तुमच्या इमारतीजवळ पोहोचते.'] },
      { h2: 'विमानतळ पिकअप', paras: ['आम्ही फ्लाइट नंबर नोंदवतो आणि प्रत्यक्ष लँडिंगनुसार चालक पोहोचतो - फ्लाइट उशिरा आली तरी गाडी चुकत नाही. मागणी केल्यास चालक नावाचा फलक घेऊन अरायव्हल गेटवर भेटतो.'] },
      { h2: 'नवी मुंबई व पुणे विमानतळ', paras: ['नवी मुंबई आंतरराष्ट्रीय विमानतळ व पुणे विमानतळासाठीही हीच सेवा.'] },
    ],
    faqs: [
      { q: 'पहाटे 3 च्या फ्लाइटसाठी कॅब मिळेल का?', a: 'हो, बुकिंग 24x7 असते. आदल्या संध्याकाळपर्यंत बुक करा.' },
      { q: 'विमानतळ पार्किंगचा खर्च कोणाचा?', a: 'पार्किंग व टोल प्रत्यक्ष खर्चानुसार बिलात वेगळे दाखवले जातात.' },
    ],
    links: [
      { label: 'मुंबईत कॅब बुकिंग', to: '/mr/mumbai-cab-booking' },
      { label: 'लोकल टॅक्सी मुंबई', to: '/mr/local-taxi-mumbai' },
      { label: 'मुंबई ते पुणे टॅक्सी', to: mrRoutePath('pune') },
    ],
    crumbs: [{ label: 'मराठी', to: '/mr/mumbai-cab-booking' }, { label: 'विमानतळ टॅक्सी' }],
    cta: { label: 'विमानतळ कॅब बुक करा', to: '/book?tab=AIRPORT' },
    serviceType: 'Airport transfer',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  {
    path: '/mr/local-taxi-mumbai', lang: 'mr', group: 'local',
    title: 'मुंबईत लोकल टॅक्सी - तासाप्रमाणे कार भाड्याने',
    description: 'मुंबईत चालकासह कार तासाप्रमाणे: 4 तास/40 किमी व 8 तास/80 किमी पॅकेज. मीटिंग, खरेदी, मुंबई दर्शनसाठी. 24x7 बुकिंग.',
    eyebrow: 'लोकल प्रवास',
    h1: 'मुंबईत लोकल टॅक्सी व तासाची गाडी',
    intro: 'दिवसभर अनेक ठिकाणी जायचे असेल - मीटिंग, हॉस्पिटल, खरेदी किंवा मुंबई दर्शन - तर प्रत्येक ठिकाणी नवी टॅक्सी शोधण्याची गरज नाही. गाडी व चालक पूर्ण वेळ तुमच्यासोबत राहतात.',
    sections: [
      { h2: 'पॅकेज', list: ['4 तास / 40 किमी', '8 तास / 80 किमी', 'जास्तीचे तास व किमी ठरलेल्या दराने, बिलात वेगळे', 'टोल व पार्किंग प्रत्यक्ष खर्चानुसार'] },
      { h2: 'मुंबई दर्शन', paras: ['गेटवे ऑफ इंडिया, मरीन ड्राइव्ह, सिद्धिविनायक, हाजी अली, वांद्रे - 8 तासांच्या पॅकेजमध्ये संपूर्ण शहर फिरता येते.'] },
    ],
    faqs: [
      { q: '8 तास 80 किमी पॅकेज म्हणजे काय?', a: 'गाडी 8 तास किंवा 80 किमीपर्यंत (जे आधी पूर्ण होईल) तुमची. त्यानंतर जास्तीचे तास व किमी ठरलेल्या दराने.' },
    ],
    links: [
      { label: 'मुंबईत कॅब बुकिंग', to: '/mr/mumbai-cab-booking' },
      { label: 'मुंबई विमानतळ टॅक्सी', to: '/mr/mumbai-airport-taxi' },
      { label: 'Mumbai sightseeing tours', to: '/tours/mumbai' },
    ],
    crumbs: [{ label: 'मराठी', to: '/mr/mumbai-cab-booking' }, { label: 'लोकल टॅक्सी' }],
    cta: { label: 'लोकल गाडी बुक करा', to: '/book?tab=LOCAL' },
    serviceType: 'Hourly car rental with driver',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  {
    path: '/mr/outstation-cab-mumbai', lang: 'mr', group: 'outstation',
    title: 'मुंबईहून आउटस्टेशन कॅब - वन वे व राउंड ट्रिप टॅक्सी',
    description: 'मुंबईहून पुणे, नाशिक, शिर्डी, लोणावळा, महाबळेश्वर, अलिबाग व गोव्यासाठी आउटस्टेशन कॅब, चालकासह. वन वे किंवा राउंड ट्रिप, 24x7.',
    eyebrow: 'आउटस्टेशन',
    h1: 'मुंबईहून आउटस्टेशन कॅब बुकिंग',
    intro: 'वीकेंड सहल, तीर्थयात्रा किंवा व्यवसाय - मुंबईबाहेर जाण्यासाठी चालकासह गाडी. फक्त ड्रॉप हवा असल्यास वन वे, परत यायचे असल्यास राउंड ट्रिप ज्यात तीच गाडी व चालक सोबत राहतात.',
    sections: [
      { h2: 'लोकप्रिय मार्ग', list: hiRoutes.map((r) => `मुंबई ते ${r.name.mr} - सुमारे ${r.km} किमी, ${r.hours.mr}`) },
      { h2: 'भाडे', paras: [`चालक भत्ता, टोल व परमिट कोटेशनमध्ये स्पष्ट दिसतात. ${UI.mr.noPrice}`] },
    ],
    faqs: [
      { q: 'वन वे व राउंड ट्रिपमध्ये काय फरक आहे?', a: 'वन वेमध्ये फक्त ठिकाणापर्यंत सोडले जाते. राउंड ट्रिपमध्ये तीच गाडी संपूर्ण प्रवासात व फिरताना सोबत राहते आणि परत आणते.' },
    ],
    links: hiRoutes.map((r) => ({ label: `मुंबई ते ${r.name.mr} टॅक्सी`, to: mrRoutePath(r.key) })),
    crumbs: [{ label: 'मराठी', to: '/mr/mumbai-cab-booking' }, { label: 'आउटस्टेशन' }],
    cta: { label: 'आउटस्टेशन भाडे पाहा', to: '/outstation?tab=OUTSTATION' },
    serviceType: 'Outstation taxi',
    areaServed: ['Mumbai', 'Maharashtra', 'Goa'],
  },
  {
    path: '/mr/lagnasathi-gadi', lang: 'mr', group: 'wedding',
    title: 'लग्नासाठी गाडी बुकिंग मुंबई - नवरदेवाची गाडी व पाहुण्यांच्या कॅब',
    description: 'मुंबईत लग्नासाठी कार भाड्याने: सजवलेली नवरदेवाची गाडी, पाहुण्यांसाठी सेडान, इनोव्हा व टेम्पो ट्रॅव्हलर, विमानतळ पिकअप. एक समन्वयक, एक बिल.',
    eyebrow: 'लग्न व कार्यक्रम',
    h1: 'लग्नासाठी गाडी व पाहुण्यांच्या टॅक्सी',
    intro: 'लग्नात गाड्यांची व्यवस्था हे सर्वात धावपळीचे काम - नवरदेवाची गाडी, बाहेरगावच्या पाहुण्यांचे विमानतळ-स्टेशन पिकअप, हॉटेल ते मंगल कार्यालय शटल. हे सर्व एकाच ठिकाणाहून, एकाच बिलात.',
    sections: [
      { h2: 'काय काय मिळते', list: ['नवरा-नवरीसाठी प्रीमियम गाडी', 'पाहुण्यांसाठी सेडान, अर्टिगा, इनोव्हा क्रिस्टा', 'मोठ्या ग्रुपसाठी टेम्पो ट्रॅव्हलर व बस', 'विमानतळ व रेल्वे स्टेशन पिकअप', 'हॉटेल-मंगल कार्यालय शटल'] },
    ],
    faqs: [
      { q: 'किती दिवस आधी बुक करावे?', a: 'लग्नसराईत 2-4 आठवडे आधी कळवा म्हणजे सर्व गाड्या एकत्र ठरवता येतील.' },
    ],
    links: [
      { label: 'Wedding car rental (English)', to: '/weddings' },
      { label: 'मुंबईत कॅब बुकिंग', to: '/mr/mumbai-cab-booking' },
    ],
    crumbs: [{ label: 'मराठी', to: '/mr/mumbai-cab-booking' }, { label: 'लग्नासाठी गाडी' }],
    cta: { label: 'लग्नाच्या गाड्या विचारा', to: '/weddings' },
    serviceType: 'Wedding car rental',
    areaServed: ['Mumbai', 'Thane', 'Navi Mumbai'],
  },
  ...hiRoutes.map(mrRoutePage),
];

// ---------------------------------------------------------------------------

export const EN_ROUTE_PAGES: Landing[] = ROUTE_INFO.map(enRoutePage);

export const LANDINGS: Landing[] = [
  ...AREAS.map(areaPage),
  ...EN_TOPICS,
  ...EN_ROUTE_PAGES,
  ...HI_PAGES,
  ...MR_PAGES,
];

const byPath = new Map(LANDINGS.map((l) => [l.path, l]));
export const landingByPath = (path: string) => byPath.get(path.replace(/\/+$/, '') || '/');

/**
 * English pages that already exist elsewhere on the site but belong to a
 * translation group, so they get hreflang links to their Hindi and Marathi
 * versions too.
 */
const EXISTING_EN: Record<string, string> = { home: '/', outstation: '/outstation', wedding: '/weddings' };

/** hreflang alternates for a path: [[lang, path]...], or [] when it has none. */
export function alternatesFor(path: string): [Lang | 'x-default', string][] {
  const p = path.replace(/\/+$/, '') || '/';
  const group = byPath.get(p)?.group ?? Object.entries(EXISTING_EN).find(([, v]) => v === p)?.[0];
  if (!group) return [];
  const out: [Lang | 'x-default', string][] = [];
  const en = EXISTING_EN[group] ?? LANDINGS.find((l) => l.group === group && l.lang === 'en')?.path;
  if (en) out.push(['en', en]);
  for (const lang of ['hi', 'mr'] as const) {
    const l = LANDINGS.find((x) => x.group === group && x.lang === lang);
    if (l) out.push([lang, l.path]);
  }
  if (en) out.push(['x-default', en]);
  return out.length > 2 ? out : [];
}

/** schema.org data for a landing page. `abs` turns a path into an absolute URL. */
export function landingJsonLd(l: Landing, abs: (p: string) => string): object[] {
  const crumbs = [{ label: UI[l.lang].home, to: '/' }, ...l.crumbs.map((c) => ({ label: c.label, to: c.to ?? l.path }))];
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'TaxiService',
      name: l.h1,
      serviceType: l.serviceType,
      url: abs(l.path),
      inLanguage: l.lang === 'en' ? 'en-IN' : l.lang,
      provider: { '@type': 'LocalBusiness', '@id': abs('/#business'), name: BRAND },
      areaServed: l.areaServed.map((name) => ({ '@type': 'Place', name })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.label, item: abs(c.to) })),
    },
    ...(l.faqs.length
      ? [{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: l.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
        }]
      : []),
  ];
}
