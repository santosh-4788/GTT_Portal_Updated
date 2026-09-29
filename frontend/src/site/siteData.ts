/** Content for the public website. Contact details mirror Settings — nothing invented. */

export const COMPANY = {
  name: 'Gupta Tours & Travels',
  tagline: 'Corporate Transport, Car Rental and Outstation',
  owner: 'Vinay Gupta',
  mobile: '9967381555',
  /** Same line as the mobile — mirrors the website.whatsapp setting. */
  whatsapp: '9967381555',
  email: 'vinaykumar87674@gmail.com',
  address: 'P-8, Building, New Aman CHS Ltd., Ajit Glass Garden Road, Goregaon (W), Mumbai - 400 104',
  gstin: '27ALRPG8019M1ZH',
  serviceHours: '24×7 Service',
};

/**
 * A wa.me link with the enquiry already typed out.
 *
 * More people will send a WhatsApp at 11pm than will fill in a form, and the
 * reply lands where the business already works. The prefilled text saves the
 * customer writing the same first line every operator asks for anyway.
 */
export function whatsappLink(message = 'Hello, I would like to book a vehicle.'): string {
  return `https://wa.me/91${COMPANY.whatsapp}?text=${encodeURIComponent(message)}`;
}

export interface Service {
  slug: string;
  name: string;
  short: string;
  icon: string;
  blurb: string;
  points: string[];
  idealFor: string[];
}

export const SERVICES: Service[] = [
  {
    slug: 'airport-transfers',
    name: 'Airport Transfers',
    short: 'Flight-tracked pickups and drops at CSMIA T1 and T2, Navi Mumbai and Pune.',
    icon: '✈️',
    blurb:
      'Reliable pickups and drops at Chhatrapati Shivaji Maharaj International Airport. We track the flight number on the booking, so a delayed arrival does not mean a missed car — the chauffeur waits and reports to the correct terminal.',
    points: [
      'Terminal 1 and Terminal 2 coverage, arrivals and departures',
      'Flight number recorded on every booking so timing follows the actual landing',
      'Meet-and-greet at the arrivals gate on request',
      'Clean boot space planned around the number of bags declared',
      'Early morning and late night slots covered under our 24×7 desk',
    ],
    idealFor: ['Corporate guests', 'Visiting clients', 'Family arrivals', 'Crew movements'],
  },
  {
    slug: 'local-travel',
    name: 'Local Travel',
    short: 'Hourly packages across Mumbai — 4H/40KM, 8H/80KM and more.',
    icon: '🏙️',
    blurb:
      'Standard hourly-and-kilometre packages for a day of meetings across Mumbai, Thane and Navi Mumbai. Extra hours and extra kilometres are billed at the agreed rate and shown as separate lines on the invoice — never rolled into a vague lump sum.',
    points: [
      '4 Hours / 40 KM and 8 Hours / 80 KM packages',
      'Extra KM and extra hours billed transparently at the agreed rate',
      'Toll and parking passed through at actuals against receipts',
      'Multiple pickups on the same duty handled without extra bookings',
      'Driver stays with the guest for the full duty period',
    ],
    idealFor: ['Day-long meetings', 'Site visits', 'Shopping and events', 'Guest hosting'],
  },
  {
    slug: 'outstation-travel',
    name: 'Outstation Travel',
    short: 'One-way and round trips to Pune, Nashik, Shirdi, Lonavala and beyond.',
    icon: '🛣️',
    blurb:
      'Long-distance travel from Mumbai with experienced highway drivers. One-way drops and round trips are both available, with driver allowance, permit and toll shown clearly so there is no argument at the end of the journey.',
    points: [
      'One-way drops and multi-day round trips',
      'Popular routes: Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Goa',
      'Driver allowance, permit and toll itemised up front',
      'Night driving covered with rested relief planning on long duties',
      'Multi-day duties tracked as a single booking with a from–to date range',
    ],
    idealFor: ['Weekend getaways', 'Pilgrimage trips', 'Client site visits', 'Family travel'],
  },
  {
    slug: 'corporate-travel',
    name: 'Corporate Travel',
    short: 'Contracted transport with monthly consolidated billing and GST invoices.',
    icon: '🏢',
    blurb:
      'This is the core of our business. We run contracted transport for corporate accounts and travel aggregators, with per-account rate cards, agreed billing cycles and invoices raised in each account\'s own required format.',
    points: [
      'Per-account rate cards and agreed duty packages',
      'Per-trip, fortnightly or monthly consolidated billing',
      'GST-compliant invoices in the format your accounts team expects',
      'Duty slips and trip evidence retained against every booking',
      'Single point of contact for escalations, 24×7',
    ],
    idealFor: ['Corporate accounts', 'Travel aggregators', 'Employee transport', 'Event logistics'],
  },
  {
    slug: 'tour-packages',
    name: 'Tour Packages',
    short: 'Planned multi-day itineraries with the vehicle and driver arranged end to end.',
    icon: '🗺️',
    blurb:
      'Planned itineraries where the vehicle, driver and daily route are arranged in advance. You get one quote covering the whole trip rather than negotiating each leg on the road.',
    points: [
      'Itinerary planned and priced before departure',
      'Same vehicle and driver for the full trip',
      'Hill-station and pilgrimage routes handled by drivers who know them',
      'Group travel in Ertiga, Innova and Tempo Traveller',
      'Flexible day-wise stops built into the plan',
    ],
    idealFor: ['Family holidays', 'Group tours', 'Pilgrimage circuits', 'Company offsites'],
  },
  {
    slug: 'event-transport',
    name: 'Event & Group Transport',
    short: 'Fleet movements for conferences, offsites and weddings.',
    icon: '🎪',
    blurb:
      'Multiple vehicles coordinated for a single event — guest pickups from several locations, shuttle runs through the day and drops at the end. Every vehicle is logged as its own booking so the final bill reconciles exactly.',
    points: [
      'Multiple vehicles coordinated under one point of contact',
      'Staggered pickups from several locations',
      'Shuttle runs between venue and hotel',
      'Tempo Traveller for larger groups',
      'One consolidated invoice at the end of the event',
    ],
    idealFor: ['Conferences', 'Weddings', 'Company offsites', 'Exhibitions'],
  },
];

export interface Vehicle {
  /** URL-safe id. Doubles as the photo filename under assets/fleet/. */
  slug: string;
  name: string;
  category: string;
  seats: number;
  luggage: string;
  /**
   * Photograph of OUR vehicle, or empty.
   *
   * Empty is the normal case and not a gap: a vehicle with no photograph here
   * is drawn instead, in the studio format every card shares (see
   * components/CarArt.tsx). A path is set only where the office has supplied a
   * photograph of a car we actually run — the two sedans today — because a
   * stock press shot of the model promises a car we do not own and adds a
   * copyright holder to the page. Files live in the project's `assets/fleet/`
   * folder, served straight off disk, so replacing one needs no rebuild.
   */
  photo: string;
  /** Which body the drawing uses. See components/CarArt.tsx */
  art: 'sedan' | 'mpv' | 'suv' | 'van' | 'bus';
  best: string;
  examples: string;
}

/**
 * The vehicle line-up as advertised on the public site.
 *
 * Deliberately no rates here: pricing is agreed per account and confirmed
 * before the first trip, so the site shows what we run and not what it costs.
 * Package structures live on the Packages page; per-vehicle numbers do not
 * belong on the marketing pages.
 */
export const FLEET: Vehicle[] = [
  {
    slug: 'dzire', name: 'Dzire', category: 'Sedan', seats: 4, luggage: '2 large bags',
    photo: '/assets/fleet/dzire.jpg', art: 'sedan',
    best: 'Airport transfers and city meetings',
    examples: 'Maruti Suzuki Dzire',
  },
  {
    slug: 'aura', name: 'Hyundai Aura', category: 'Sedan', seats: 4, luggage: '2 large bags',
    photo: '/assets/fleet/aura.jpg', art: 'sedan',
    best: 'Airport transfers and city travel',
    examples: 'Hyundai Aura',
  },
  {
    slug: 'honda-city', name: 'Honda City', category: 'Premium sedan', seats: 4, luggage: '2 large bags',
    photo: '/assets/fleet/city.jpg', art: 'sedan',
    best: 'Executive city travel and airport pickups',
    examples: 'Honda City',
  },
  {
    slug: 'ciaz', name: 'Ciaz', category: 'Premium sedan', seats: 4, luggage: '2 large bags',
    photo: '/assets/fleet/ciaz.jpg', art: 'sedan',
    best: 'Executive travel and long airport runs',
    examples: 'Maruti Suzuki Ciaz',
  },
  {
    slug: 'ertiga', name: 'Ertiga', category: 'SUV', seats: 6, luggage: '3 large bags',
    photo: '/assets/fleet/ertiga-cab.jpg', art: 'mpv',
    best: 'Small families and group city travel',
    examples: 'Maruti Suzuki Ertiga',
  },
  {
    slug: 'xl6', name: 'XL6', category: 'SUV', seats: 6, luggage: '3 large bags',
    photo: '/assets/fleet/xl6.jpg', art: 'mpv',
    best: 'Six travelling in captain seats',
    examples: 'Maruti Suzuki XL6',
  },
  {
    slug: 'rumion', name: 'Toyota Rumion', category: 'SUV', seats: 6, luggage: '3 large bags',
    photo: '/assets/fleet/rumion.jpg', art: 'mpv',
    best: 'Small families and group city travel',
    examples: 'Toyota Rumion',
  },
  {
    slug: 'innova-crysta', name: 'Toyota Innova Crysta', category: 'Premium SUV', seats: 6, luggage: '4 large bags',
    photo: '/assets/fleet/crysta.jpg', art: 'suv',
    best: 'Outstation comfort and senior executives',
    examples: 'Toyota Innova Crysta',
  },
  {
    slug: 'carens', name: 'Kia Carens', category: 'Premium SUV', seats: 6, luggage: '4 large bags',
    photo: '/assets/fleet/carens.jpg', art: 'mpv',
    best: 'Family outstation trips in comfort',
    examples: 'Kia Carens',
  },
  {
    slug: 'tempo-traveller-12', name: 'Force Traveller 12', category: 'Group', seats: 12, luggage: 'Roof carrier available',
    photo: '/assets/fleet/traveller-12.jpg', art: 'van',
    best: 'Team offsites and airport group transfers',
    examples: 'Force Tempo Traveller, 12 seater',
  },
  {
    slug: 'tempo-traveller-17', name: 'Force Urbania 17', category: 'Group', seats: 17, luggage: 'Roof carrier available',
    photo: '/assets/fleet/traveller-17.jpg', art: 'van',
    best: 'Larger groups and event shuttle runs',
    examples: 'Force Urbania, 17 seater',
  },
  {
    slug: 'bus', name: 'Bus', category: 'Coach', seats: 45, luggage: 'Underfloor bay',
    photo: '/assets/fleet/coach.jpg', art: 'bus',
    best: 'Conferences, weddings and large event movements',
    examples: 'Volvo and Ashok Leyland coaches, 35 to 49 seats',
  },
];

export const ROUTES = [
  { from: 'Mumbai', to: 'Pune', km: '150 km', time: '≈3 hrs' },
  { from: 'Mumbai', to: 'Lonavala', km: '83 km', time: '≈2 hrs' },
  { from: 'Mumbai', to: 'Nashik', km: '167 km', time: '≈3.5 hrs' },
  { from: 'Mumbai', to: 'Shirdi', km: '240 km', time: '≈5 hrs' },
  { from: 'Mumbai', to: 'Mahabaleshwar', km: '265 km', time: '≈5.5 hrs' },
  { from: 'Mumbai', to: 'Alibaug', km: '95 km', time: '≈2.5 hrs' },
  { from: 'Mumbai', to: 'Surat', km: '285 km', time: '≈5 hrs' },
  { from: 'Mumbai', to: 'Goa', km: '590 km', time: '≈11 hrs' },
];

/**
 * What a quoted fare covers, and what is billed on top of it.
 *
 * This is the question that actually decides whether a first-time caller books,
 * and it was the one thing the site never answered. The split matches how the
 * invoices are built: the fare is one figure, and reimbursables sit outside it
 * at actuals.
 */
export const INCLUDED = [
  'The vehicle for the agreed hours and kilometres',
  'Fuel',
  'A uniformed chauffeur who knows the route',
  'Cleaning and servicing before dispatch',
  'Coordination on call for the whole duty, day or night',
  'A GST-compliant invoice in the format your accounts team needs',
];

export const CHARGED_SEPARATELY = [
  ['Toll and parking', 'At actuals, itemised on the invoice and never marked up.'],
  ['Extra hours and kilometres', 'Beyond the package, at the rate agreed before the trip.'],
  ['State permits', 'On outstation runs that cross a state border.'],
  ['Driver allowance', 'On multi-day outstation duties, shown as its own line.'],
] as const;

/**
 * Answers to what callers actually ask. Also the knowledge the site assistant
 * replies from (see assistantKnowledge.ts) — one source, so the widget can
 * never contradict the page it is sitting on.
 */
export interface Faq {
  q: string;
  a: string;
  /** Extra words a visitor might use for this topic, for the assistant's search. */
  keywords?: string[];
}

export const FAQS: Faq[] = [
  {
    q: 'Which areas do you cover?',
    a: 'We are based in Goregaon (W) and run across Mumbai, Navi Mumbai and Thane every day. Outstation duties go anywhere in Maharashtra and to neighbouring states — Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Alibaug, Surat and Goa are the routes we run most weeks.',
    keywords: ['area', 'areas', 'cover', 'coverage', 'city', 'cities', 'location', 'where', 'serve', 'mumbai', 'thane', 'navi', 'pune', 'outside', 'region'],
  },
  {
    q: 'How do I book a vehicle?',
    a: 'Use the booking bar on the home page: choose Local, Airport, Outstation or Hourly, fill in the trip and pick a vehicle, then send it as an enquiry or on WhatsApp - you get a Trip ID straight away. You can also tap Call at the top of any page. The rate is confirmed before the car is assigned.',
    keywords: ['book', 'booking', 'reserve', 'hire', 'arrange', 'order', 'how'],
  },
  {
    q: 'How far in advance should I book?',
    a: 'Same-day bookings are usually possible — call and we will tell you straight away. For an early-morning airport pickup or an outstation trip, twelve to twenty-four hours notice gives you the pick of the fleet.',
    keywords: ['advance', 'notice', 'early', 'ahead', 'short', 'urgent', 'today', 'tomorrow', 'immediately', 'last', 'minute'],
  },
  {
    q: 'What do you charge?',
    a: 'Local, airport and hourly trips show an indicative fare from our standard rates when you search, with toll, parking and any state permit extra at actuals. One-way outstation trips from Mumbai to our popular destinations (Pune, Lonavala, Nashik, Shirdi and more) have fixed fares shown on the Outstation page, toll included where it says so; any other route is quoted on request. Corporate accounts get a negotiated rate card agreed before the first trip.',
    keywords: ['rate', 'rates', 'price', 'prices', 'pricing', 'cost', 'charge', 'charges', 'fare', 'quote',
      'quotation', 'much', 'expensive', 'cheap', 'budget', 'calculator', 'calculate', 'estimate', 'tariff'],
  },
  {
    q: 'Are toll and parking extra?',
    a: 'On local, airport and hourly trips, toll and parking are passed through at actuals, each on its own line of the invoice, and are never marked up. The fixed outstation fares on our Outstation page say "Toll included" where the toll is already in the price. On runs that cross a state border, the permit is itemised separately.',
    keywords: ['toll', 'parking', 'permit', 'extra', 'hidden', 'additional', 'actuals', 'reimburse'],
  },
  {
    q: 'Do you charge GST, and can I claim it?',
    a: 'Yes. We are GST registered and every invoice is GST-compliant, so your accounts team can claim input credit. Give us your GSTIN when you book and it goes on the invoice.',
    keywords: ['gst', 'gstin', 'tax', 'invoice', 'bill', 'billing', 'input', 'credit', 'itc', 'registered', 'compliant'],
  },
  {
    q: 'How does payment work?',
    a: 'Corporate accounts are invoiced on an agreed cycle — per trip, fortnightly or monthly — with payment terms set when the account opens. For a one-off booking the amount is confirmed before the trip and settled on completion.',
    keywords: ['payment', 'pay', 'settle', 'terms', 'credit', 'cash', 'upi', 'account', 'monthly', 'invoice', 'due', 'cheque', 'check', 'neft', 'card', 'advance', 'deposit'],
  },
  {
    q: 'Do you handle airport pickups with flight tracking?',
    a: 'Yes - at Mumbai CSMIA Terminal 1 and Terminal 2, Navi Mumbai International and Pune Airport. Give us the flight number and the chauffeur adjusts to the actual landing time, so a delayed flight does not cost you the car. Meet-and-greet at arrivals is available on request.',
    keywords: ['airport', 'flight', 'terminal', 't1', 't2', 'pickup', 'arrival', 'departure', 'delay', 'delayed', 'track', 'tracking', 'meet', 'greet'],
  },
  {
    q: 'What happens if my plans change?',
    a: 'Cancelling up to 1 hour before the pickup time is free; a cancellation within 1 hour of pickup is chargeable. Tell us as early as you can and we will move the booking rather than cancel it wherever possible. If a change close to the reporting time does attract a charge, you are told at the time — it is never added quietly to the invoice.',
    keywords: ['cancel', 'cancellation', 'change', 'reschedule', 'postpone', 'refund', 'plans', 'amend'],
  },
  {
    q: 'Can you handle a whole event or a wedding?',
    a: 'Yes. We coordinate several vehicles under one point of contact — staggered guest pickups, shuttle runs through the day and drops at the end. Every vehicle is logged as its own booking, so the final bill reconciles exactly.',
    keywords: ['event', 'events', 'wedding', 'marriage', 'conference', 'offsite', 'group', 'multiple', 'fleet', 'shuttle', 'guests', 'exhibition'],
  },
  {
    q: 'Who drives, and are the drivers checked?',
    a: 'Uniformed chauffeurs who know Mumbai and the highway routes, and who understand how to conduct themselves with corporate guests. No tobacco, pan or gutkha on duty — a standing rule, not a request.',
    keywords: ['driver', 'drivers', 'chauffeur', 'safe', 'safety', 'verified', 'background', 'uniform', 'behaviour', 'trained'],
  },
  {
    q: 'Do you run at night and on Sundays?',
    a: 'Yes — 24×7. Early-morning airport runs and late-night drops are part of the normal schedule, not an exception we charge extra to arrange.',
    keywords: ['night', 'late', 'early', 'morning', 'sunday', 'holiday', 'weekend', '24', 'hours', 'time', 'open', 'available', 'midnight'],
  },
];

/**
 * A second block of answers. These are not shown on the home page — that list
 * is kept to the twelve that matter most — but the assistant searches all of
 * them, so it can answer far more than the page displays.
 */
export const MORE_FAQS: Faq[] = [
  {
    q: 'Can I get a vehicle for a full day, or only point to point?',
    a: 'Both. The hourly packages are 4 hours / 40 km, 8 hours / 80 km and 12 hours / 120 km, with the car and chauffeur with you throughout and as many stops as you need. Airport transfers are priced point to point instead.',
    keywords: ['full', 'day', 'half', 'hourly', 'package', '4h', '8h', '4hr', '8hr', '4hrs', '8hrs', '40', '80', 'disposal', 'whole', 'multiple', 'stop', 'stops', 'wait', 'waiting', 'duration', 'slab'],
  },
  {
    q: 'Do you provide vehicles for a multi-day trip?',
    a: 'Yes. Multi-day outstation duties are quoted per day with a minimum kilometre allowance agreed up front, and the driver allowance for nights away is shown as its own line. The same chauffeur stays with you for the whole trip.',
    keywords: ['multi', 'day', 'days', 'week', 'itinerary', 'overnight', 'stay', 'trip', 'holiday', 'vacation', 'long'],
  },
  {
    q: 'Is there a minimum booking, or a minimum number of hours?',
    a: 'No minimum for a city transfer - a single airport drop is a normal booking. A one-way drop to one of our popular outstation destinations has a fixed fare; multi-day outstation trips and other routes are quoted for the trip.',
    keywords: ['minimum', 'least', 'small', 'single', 'one', 'short', 'limit'],
  },
  {
    q: 'Can I request a particular vehicle or colour?',
    a: 'You can ask for a specific class — sedan, Ertiga, Innova Crysta, Tempo Traveller or a coach — and we confirm it when the booking is taken. A specific colour or registration is not something we promise, because the car that is cleanest and serviced on the day is the one that goes out.',
    keywords: ['specific', 'particular', 'choose', 'select', 'colour', 'color', 'white', 'model', 'exact', 'request', 'prefer'],
  },
  {
    q: 'Is the vehicle air conditioned?',
    a: 'Yes. Every vehicle in the fleet is air conditioned, and on outstation runs the AC is included in the fare rather than charged for the hill sections.',
    keywords: ['ac', 'air', 'condition', 'conditioned', 'conditioning', 'cool', 'heat', 'comfort', 'nonac'],
  },
  {
    q: 'Are child seats available?',
    a: 'Tell us when you book and we will arrange one where we can. Give us a day of notice if you need it for an early-morning airport run.',
    keywords: ['child', 'baby', 'infant', 'kid', 'kids', 'seat', 'toddler', 'family', 'car'],
  },
  {
    q: 'How much luggage fits?',
    a: 'A sedan takes 2 large bags, an Ertiga 3, an Innova Crysta 4. Tempo Travellers can carry a roof carrier for a group, and the coach has an underfloor luggage bay. If you are carrying more than usual, say so when you book and we will send the right size.',
    keywords: ['luggage', 'bag', 'bags', 'suitcase', 'boot', 'space', 'carry', 'fit', 'big', 'trolley'],
  },
  {
    q: 'Do you do one-way drops to another city?',
    a: 'Yes. Choose Outstation, then One way, and pick your destination - Pune, Lonavala, Nashik, Alibaug, Shirdi, Mahabaleshwar, Satara, Kolhapur, Surat, Ahmedabad or Vapi have fixed fares. For anywhere else choose Other and we quote the route. Return trips are priced separately.',
    keywords: ['one', 'way', 'oneway', 'drop', 'single', 'return', 'round', 'back'],
  },
  {
    q: 'Can the same vehicle wait and bring us back?',
    a: 'Yes — that is a round trip, and it is usually better value than two one-way drops. Waiting time is part of the duty rather than an extra you find out about later.',
    keywords: ['wait', 'waiting', 'return', 'round', 'back', 'same', 'hold', 'stay'],
  },
  {
    q: 'Do you have a corporate account facility?',
    a: 'Yes, and it is most of what we do. A corporate account gets an agreed rate card, a billing cycle that suits your accounts team, invoices in your required format and one point of contact. Call to set one up.',
    keywords: ['corporate', 'company', 'business', 'account', 'contract', 'tie', 'vendor', 'empanel', 'b2b', 'office', 'employee', 'staff'],
  },
  {
    q: 'Can we get one invoice for all the trips in a month?',
    a: 'Yes, for accounts set up that way. Every trip is logged as its own booking and then consolidated onto one invoice for the fortnight or the month, so the bill reconciles line by line against what you booked.',
    keywords: ['consolidate', 'consolidated', 'one', 'single', 'monthly', 'fortnight', 'combine', 'together', 'summary', 'statement', 'invoice'],
  },
  {
    q: 'Do you provide a trip sheet or duty slip?',
    a: 'Yes. Each duty is recorded with the reporting time, opening and closing readings, and the stops made, so the extra hours or kilometres on the invoice can be checked against what actually happened.',
    keywords: ['trip', 'sheet', 'duty', 'slip', 'log', 'record', 'reading', 'proof', 'verify', 'check'],
  },
  {
    q: 'What is your GST number?',
    a: 'We are registered for GST in Maharashtra. The GSTIN is printed on every invoice we raise and shown on our About page.',
    keywords: ['gstin', 'gst', 'number', 'registration', 'tin', 'pan', 'tax', 'detail'],
  },
  {
    q: 'Do you take airport pickups at odd hours?',
    a: 'Yes. A 4am departure or a 1am landing is a normal booking — the chauffeur reports before the reporting time, and there is no premium for the hour.',
    keywords: ['odd', 'early', 'late', 'night', 'midnight', 'dawn', 'morning', 'flight', 'airport', 'red', 'eye'],
  },
  {
    q: 'What if my flight is delayed?',
    a: 'Give us the flight number when you book. The chauffeur tracks the actual landing time and adjusts, so a delayed flight does not mean a missed car or a waiting charge you did not expect.',
    keywords: ['delay', 'delayed', 'late', 'flight', 'miss', 'missed', 'reschedule', 'landing', 'wait'],
  },
  {
    q: 'Where does the driver meet me at the airport?',
    a: 'At the pickup point outside arrivals at your terminal, and the chauffeur calls you as you land. Meet-and-greet inside the arrivals hall with a name board is available on request.',
    keywords: ['meet', 'where', 'arrival', 'terminal', 'greet', 'board', 'placard', 'find', 'gate', 'exit', 'airport'],
  },
  {
    q: 'Can I book for someone else — a guest or a client?',
    a: 'Yes, and it is common. Give us the passenger name and mobile and we send the vehicle and chauffeur details to them directly. The booking and the invoice still sit with you.',
    keywords: ['someone', 'else', 'guest', 'client', 'visitor', 'behalf', 'other', 'person', 'family', 'parent', 'friend'],
  },
  {
    q: 'Will I know the driver and vehicle before the trip?',
    a: 'Yes. The vehicle number, the chauffeur name and the chauffeur mobile are sent to you before the reporting time, so nobody is waiting outside wondering which car is theirs.',
    keywords: ['detail', 'details', 'driver', 'number', 'confirm', 'confirmation', 'sms', 'know', 'advance', 'share', 'vehicle', 'plate'],
  },
  {
    q: 'Are the vehicles insured and permitted for commercial use?',
    a: 'Yes. Every vehicle runs on a commercial permit with valid insurance and fitness, and the papers are current — that is a condition of a car going out on duty, not something checked once a year.',
    keywords: ['insurance', 'insured', 'permit', 'legal', 'fitness', 'paper', 'document', 'commercial', 'yellow', 'plate', 'valid', 'safe'],
  },
  {
    q: 'Do you go to the airport from outside Mumbai?',
    a: 'Yes — pickups from Thane, Navi Mumbai, Kalyan and further out to either terminal are routine. Tell us the address and the flight time and we will set the reporting time accordingly.',
    keywords: ['thane', 'navi', 'kalyan', 'panvel', 'vashi', 'borivali', 'outside', 'suburb', 'far', 'airport', 'pickup'],
  },
  {
    q: 'Can you arrange several cars on the same day?',
    a: 'Yes. Multiple vehicles for a conference, an offsite or a wedding are coordinated under one point of contact, with staggered pickups and shuttle runs through the day. Each vehicle is logged separately so the final bill adds up exactly.',
    keywords: ['several', 'multiple', 'many', 'cars', 'fleet', 'same', 'day', 'group', 'conference', 'offsite', 'event', 'team', 'coordinate'],
  },
  {
    q: 'Do you do sightseeing or tour packages?',
    a: 'Yes. Planned itineraries — a day around Mumbai, a weekend in Lonavala or Mahabaleshwar, a Shirdi darshan run — with the car and chauffeur for the whole trip and the route agreed before you leave.',
    keywords: ['sightseeing', 'tour', 'package', 'itinerary', 'darshan', 'temple', 'holiday', 'weekend', 'plan', 'visit', 'places', 'shirdi', 'lonavala'],
  },
  {
    q: 'Is smoking or alcohol allowed in the vehicle?',
    a: 'No smoking in the vehicle, and open alcohol is not permitted. The chauffeurs hold to the same rule — no tobacco, pan or gutkha on duty.',
    keywords: ['smoke', 'smoking', 'cigarette', 'alcohol', 'drink', 'drinking', 'rule', 'rules', 'allowed', 'permit', 'policy'],
  },
  {
    q: 'Can I carry a pet?',
    a: 'Tell us when you book. It is usually fine in a larger vehicle with a carrier, so that the car goes back into service clean for the next passenger.',
    keywords: ['pet', 'dog', 'cat', 'animal', 'carrier', 'allowed'],
  },
  {
    q: 'How do I complain if something goes wrong?',
    a: `Call and speak to ${COMPANY.owner} directly — he handles the account personally, so there is no call-centre queue and no ticket number. Tell us the booking date and what happened and it gets dealt with.`,
    keywords: ['complain', 'complaint', 'problem', 'issue', 'wrong', 'bad', 'late', 'rude', 'escalate', 'feedback', 'unhappy', 'sorry'],
  },
  {
    q: 'Do you rent self-drive cars?',
    a: 'No — every vehicle goes out with one of our own chauffeurs. That is deliberate: the driver knowing Mumbai and the highway routes is most of what you are paying for, and it is what keeps the duty accountable end to end.',
    keywords: ['self', 'drive', 'selfdrive', 'without', 'driverless', 'rent', 'rental', 'myself', 'own', 'lease', 'zoomcar', 'revv'],
  },
  {
    q: 'Is there wifi, water or charging in the vehicle?',
    a: 'Bottled water is provided on outstation duties and on request in the city, and every vehicle has a charging point. Onboard wifi is not standard — tell us if you need connectivity for a long run and we will say up front whether we can arrange it.',
    keywords: ['wifi', 'wi', 'internet', 'water', 'bottle', 'charging', 'charger', 'usb', 'point', 'amenity', 'amenities', 'facility', 'facilities', 'onboard', 'music', 'entertainment'],
  },
  {
    q: 'Are you hiring drivers, or do you buy vehicles from owners?',
    a: 'For anything about joining as a chauffeur or attaching your vehicle to the fleet, call the office directly — it is not something handled over the website.',
    keywords: ['job', 'hiring', 'vacancy', 'work', 'join', 'attach', 'owner', 'partner', 'career', 'employment', 'recruit'],
  },
];

export const WHY_US = [
  {
    icon: '🕐', title: '24×7 Availability',
    body: 'Early-morning airport runs and late-night drops are part of the normal schedule, not an exception we charge extra to arrange.',
  },
  {
    icon: '🧾', title: 'Transparent Billing',
    body: 'Base fare, extra kilometres, extra hours, toll and parking each appear as their own line. Toll and parking are passed through at actuals and are not marked up.',
  },
  {
    icon: '🚘', title: 'Well-Maintained Fleet',
    body: 'Recent-model vehicles kept clean inside and out, serviced on schedule and checked before every corporate duty.',
  },
  {
    icon: '👔', title: 'Professional Chauffeurs',
    body: 'Uniformed drivers who know Mumbai and the highway routes, and who understand how to conduct themselves with corporate guests.',
  },
  {
    icon: '📄', title: 'GST-Compliant Invoices',
    body: 'Registered for GST. Invoices are raised in the format each account requires, so your accounts team can process them without going back and forth.',
  },
  {
    icon: '📞', title: 'One Point of Contact',
    body: 'Vinay Gupta handles the account personally. There is no call-centre queue between you and a decision.',
  },
];
