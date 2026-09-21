/**
 * What each door on "What do you need today?" actually asks.
 *
 * The nine buckets on the home page are nine different conversations. An
 * airport transfer needs the terminal and the flight number and does not care
 * how many days; an outstation trip needs a return date and does not have a
 * terminal; a wedding needs how many cars across which days and has no single
 * pickup at all. Asking one generic set of questions and hoping meant the desk
 * rang back to ask the obvious thing every time.
 *
 * So the form is a base — who you are, and a note — plus the fields this kind
 * of trip genuinely needs, listed here in the order they should be asked.
 * Everything is data: adding a bucket is a row in this file, not a new form.
 */
import type { NeedKey } from './catalog';

/** Every field the enquiry form knows how to render. */
export type FieldKey =
  | 'pickup' | 'drop' | 'date' | 'time' | 'returnDate' | 'endDate'
  | 'carType' | 'passengers' | 'vehicles'
  | 'direction' | 'airport' | 'flightNo'
  | 'hourlyPlan' | 'darshanPlan' | 'tripLeg'
  | 'company' | 'requirement' | 'eventType' | 'venue' | 'functions';

export interface EnquiryCategory {
  key: NeedKey;
  /** The requirement line the office sees on the trip. */
  label: string;
  /** The heading on the enquiry page. */
  title: string;
  blurb: string;
  emoji: string;
  /** How the booking is filed, so the admin list buckets it correctly. */
  tripType: 'LOCAL' | 'TRANSFER' | 'AIRPORT' | 'OUTSTATION' | 'ROUND_TRIP' | 'PACKAGE';
  /** Asked in this order, after name and number. */
  fields: FieldKey[];
  /** Which of those must be answered before the enquiry can be sent. */
  required?: FieldKey[];
  /** Placeholder for the free-text note at the end. */
  notesHint: string;
  /** Where to read more about this service, when such a page exists. */
  readMore?: { to: string; label: string };
}

export const CATEGORIES: Record<NeedKey, EnquiryCategory> = {
  local: {
    key: 'local',
    label: 'Local travel',
    title: 'Local travel around Mumbai',
    blurb: 'Point to point, or the car with you for the day. Tell us where and when.',
    emoji: '\u{1F695}',
    tripType: 'LOCAL',
    fields: ['pickup', 'drop', 'date', 'time', 'carType', 'passengers'],
    required: ['pickup'],
    notesHint: 'Luggage, a stop on the way, a child seat…',
    readMore: { to: '/services/local-travel', label: 'About local travel' },
  },

  airport: {
    key: 'airport',
    label: 'Airport transfer',
    title: 'Airport transfer',
    blurb: 'We track the flight number, so a delayed landing does not mean a missed car.',
    emoji: '✈️',
    tripType: 'AIRPORT',
    fields: ['direction', 'airport', 'flightNo', 'pickup', 'drop', 'date', 'time', 'carType', 'passengers'],
    required: ['pickup'],
    notesHint: 'Meet and greet at arrivals, extra luggage, a second pickup…',
    readMore: { to: '/services/airport-transfers', label: 'About airport transfers' },
  },

  outstation: {
    key: 'outstation',
    label: 'Outstation trip',
    title: 'Outstation travel',
    blurb: 'One-way drops and round trips across Maharashtra and beyond.',
    emoji: '\u{1F6E4}️',
    tripType: 'OUTSTATION',
    fields: ['pickup', 'drop', 'tripLeg', 'date', 'returnDate', 'carType', 'passengers'],
    required: ['pickup', 'drop'],
    notesHint: 'Places to cover on the way, an overnight halt, a preferred driver…',
    readMore: { to: '/weekend-trips', label: 'Popular destinations' },
  },

  hourly: {
    key: 'hourly',
    label: 'Hourly rental',
    title: 'Hourly rental',
    blurb: 'The car and chauffeur stay with you. Anything past the package is charged at the published rate.',
    emoji: '⏱️',
    tripType: 'LOCAL',
    fields: ['hourlyPlan', 'pickup', 'date', 'time', 'carType', 'passengers'],
    required: ['pickup'],
    notesHint: 'Roughly where you will be going, and anything the driver should know…',
    readMore: { to: '/services/local-travel', label: 'About hourly packages' },
  },

  corporate: {
    key: 'corporate',
    label: 'Corporate travel',
    title: 'Corporate travel',
    blurb: 'Employee, executive and client travel on one account, billed monthly with GST.',
    emoji: '\u{1F3E2}',
    tripType: 'LOCAL',
    fields: ['company', 'requirement', 'pickup', 'date', 'passengers'],
    required: ['company'],
    notesHint: 'Roughly how many trips a month, the cities you need covered, billing requirements…',
    readMore: { to: '/corporate', label: 'About corporate accounts' },
  },

  darshan: {
    key: 'darshan',
    label: 'Mumbai darshan',
    title: 'Mumbai sightseeing',
    blurb: 'Half a day or a full day around the city, at your own pace.',
    emoji: '\u{1F6D5}',
    tripType: 'PACKAGE',
    fields: ['darshanPlan', 'pickup', 'date', 'time', 'carType', 'passengers'],
    required: ['pickup'],
    notesHint: 'Places you especially want to see, or ones to skip…',
    readMore: { to: '/tours/mumbai', label: 'What the tour covers' },
  },

  event: {
    key: 'event',
    label: 'Event transport',
    title: 'Event transport',
    blurb: 'Conferences, concerts, exhibitions and launches — one vehicle or a fleet, on a schedule.',
    emoji: '\u{1F3AA}',
    tripType: 'PACKAGE',
    fields: ['eventType', 'venue', 'date', 'endDate', 'vehicles', 'passengers'],
    required: ['venue'],
    notesHint: 'The schedule, pickup points, how many guests at each…',
    readMore: { to: '/services/event-transport', label: 'About event transport' },
  },

  wedding: {
    key: 'wedding',
    label: 'Wedding transport',
    title: 'Wedding transport',
    blurb: 'Baraat, guests and airport runs — usually several vehicles across several days.',
    emoji: '\u{1F48D}',
    tripType: 'PACKAGE',
    fields: ['functions', 'venue', 'date', 'endDate', 'vehicles', 'passengers'],
    required: ['venue'],
    notesHint: 'Which functions need cars, decoration, guest pickups from the airport…',
    readMore: { to: '/weddings', label: 'About wedding transport' },
  },

  group: {
    key: 'group',
    label: 'Group travel',
    title: 'Group travel',
    blurb: 'Tell us the group size and we work out whether that is one Tempo Traveller or three cars.',
    emoji: '\u{1F46A}',
    tripType: 'LOCAL',
    fields: ['pickup', 'drop', 'date', 'time', 'passengers', 'vehicles'],
    required: ['pickup', 'passengers'],
    notesHint: 'Luggage, whether the group must travel together, a return leg…',
    readMore: { to: '/group-travel', label: 'About group travel' },
  },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as NeedKey[];

export const isCategoryKey = (v: unknown): v is NeedKey =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, v);

/* ==========================================================================
   Choices for the select fields
   ========================================================================== */

export const AIRPORTS = [
  'CSMIA Terminal 2 (international)',
  'CSMIA Terminal 1 (domestic)',
  'Navi Mumbai International',
  'Pune Airport',
];

export const HOURLY_PLANS = [
  '4 hours / 40 km',
  '8 hours / 80 km',
  '12 hours / 120 km',
];

export const DARSHAN_PLANS = [
  'Half day — about 4 hours',
  'Full day — about 8 hours',
];

export const CORPORATE_NEEDS = [
  'Employee transport',
  'Executive travel',
  'Client and guest travel',
  'Event or offsite transport',
  'Airport transfers for staff',
];

export const EVENT_TYPES = [
  'Conference',
  'Concert or show',
  'Exhibition',
  'Product launch',
  'Offsite or team day',
  'Something else',
];
