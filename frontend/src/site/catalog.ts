/**
 * The customer platform's catalogue.
 *
 * Purely additive to `siteData.ts`: the twelve vehicles we actually run stay the
 * single source of truth there, and this file only layers on the attributes the
 * booking journey needs — bags, comfort band, features, which rate plans apply.
 * Nothing here invents a vehicle we do not have; extra classes for weddings and
 * large events are offered as a request rather than listed as stock.
 */
import { FLEET, type Vehicle } from './siteData';

/* ==========================================================================
   1 · "What do you need today?" — the ten entry points on the home page
   ========================================================================== */

export type NeedKey =
  | 'local' | 'airport' | 'outstation' | 'hourly' | 'corporate'
  | 'event' | 'wedding' | 'group' | 'darshan';

export interface Need {
  key: NeedKey;
  emoji: string;
  label: string;
  sub: string;
  to: string;
  tint: 'blue' | 'mint' | 'warm' | 'violet';
  /**
   * The picture to ship with, from photographs the site already owns.
   *
   * It is a DEFAULT, not the source of truth: `assets/needs/<key>.jpg` wins
   * whenever it exists, so the office replaces any of these by dropping a file
   * in the bucket. Left off where nothing we own says the right thing — an
   * airport transfer is not a beach, and a card is better with its tinted panel
   * than with a photograph that misleads.
   */
  photo?: string;
}

/*
 * Every door leads to /enquire/<key>, which asks the questions that kind of
 * trip actually needs and then offers Send, WhatsApp and Call. The marketing
 * pages these used to point at are still live and still linked — from the
 * header menu, from All services, and from a "read more" line on each enquiry
 * page — they are simply no longer the first thing between a customer and a
 * rate.
 */
export const NEEDS: Need[] = [
  { key: 'local',      emoji: '\u{1F695}', label: 'Local Travel',      sub: 'Around Mumbai, by the hour or the trip',   to: '/enquire/local',      tint: 'blue', photo: '/assets/places/marine-drive.jpg' },
  { key: 'airport',    emoji: '✈️', label: 'Airport Transfer', sub: 'CSMIA T1 & T2, Navi Mumbai and Pune',      to: '/enquire/airport',    tint: 'mint' },
  { key: 'outstation', emoji: '\u{1F6E4}️', label: 'Outstation',   sub: 'One-way drops and round trips',           to: '/outstation', tint: 'warm', photo: '/assets/places/khandala.jpg' },
  { key: 'hourly',     emoji: '⏱️', label: 'Hourly Rental',   sub: '4h/40km and 8h/80km packages',            to: '/enquire/hourly',     tint: 'violet', photo: '/assets/places/colaba.jpg' },
  { key: 'corporate',  emoji: '\u{1F3E2}', label: 'Corporate Travel',   sub: 'Employee, executive and client travel',   to: '/enquire/corporate',           tint: 'blue', photo: '/assets/fleet/city.jpg' },
  { key: 'darshan',    emoji: '\u{1F6D5}', label: 'Mumbai Darshan',     sub: 'Half day and full day city sightseeing',  to: '/enquire/darshan',        tint: 'warm', photo: '/assets/places/gateway-of-india.jpg' },
  { key: 'event',      emoji: '\u{1F3AA}', label: 'Events',             sub: 'Conferences, concerts, exhibitions',      to: '/enquire/event',              tint: 'violet' },
  { key: 'wedding',    emoji: '\u{1F48D}', label: 'Wedding',            sub: 'Baraat, guests and airport transfers',    to: '/enquire/wedding',            tint: 'warm' },
  { key: 'group',      emoji: '\u{1F46A}', label: 'Group Travel',       sub: 'One vehicle or several — we work it out', to: '/enquire/group',        tint: 'mint', photo: '/assets/fleet/traveller-17.jpg' },
];

/* Weekend Trips and Multiple Vehicles used to sit on this grid. Both pages
   are still live and still linked - Explore in the phone nav and the
   destinations strip reach /weekend-trips; Fleet, Events and Group Travel
   all reach /fleet-request - they are simply no longer doors here. */

export const TINT_CLASS: Record<Need['tint'], string> = {
  blue: 'grad-soft',
  mint: 'grad-mint',
  warm: 'grad-warm',
  violet: 'bg-gradient-to-br from-[#EFEBFE] to-[#E9F1FE]',
};

/* ==========================================================================
   2 · Vehicle attributes for the search, compare and details screens
   ========================================================================== */

export type Comfort = 'Standard' | 'Comfort' | 'Premium' | 'Luxury';
export type PlanType = 'LOCAL' | 'AIRPORT' | 'OUTSTATION';
export type VehicleTag = 'budget' | 'premium' | 'luxury' | 'group' | 'ev';

export interface VehicleExtra {
  /** Large bags that fit without the boot becoming a negotiation. */
  bags: number;
  ac: boolean;
  comfort: Comfort;
  tags: VehicleTag[];
  features: string[];
  bestFor: string[];
  plans: PlanType[];
  /**
   * Words that appear in the rate-card category names kept in the Master. The
   * estimate looks a vehicle up by these rather than by an id, so a rate row
   * named "Sedan" and one named "Dzire" both find the Dzire.
   */
  rateAliases: string[];
  /**
   * The most people this vehicle will actually carry, when `seats` understates
   * it.
   *
   * `seats` is the comfortable figure the cards quote — six in an Ertiga means
   * six travelling in comfort. But the office does seat seven in the 2+3+2
   * classes, and without saying so here a group of seven was being sized
   * straight up to a twelve-seat Tempo Traveller, which is a much bigger
   * vehicle and a much bigger bill for one extra passenger.
   *
   * Only the group-size decision reads this. Every card still quotes `seats`,
   * because that is the honest number for what the customer is booking.
   *
   * Left unset when the seat count is the true limit — the XL6's middle row is
   * two captain seats, so there is no seventh seat to put anybody in.
   */
  maxPax?: number;

  /** Ranks recommendations. 1-10, meaningful only relative to each other. */
  score: { comfort: number; space: number; value: number };
}

const EXTRA: Record<string, VehicleExtra> = {
  dzire: {
    bags: 2, ac: true, comfort: 'Standard', tags: ['budget'],
    features: ['Air conditioned', 'Boot for 2 large bags', 'Charging point', 'Bottled water on request'],
    bestFor: ['Airport transfers', 'City meetings', 'Solo and couple travel'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['sedan', 'dzire', 'swift', 'hatchback', 'etios'],
    score: { comfort: 5, space: 4, value: 10 },
  },
  aura: {
    bags: 2, ac: true, comfort: 'Standard', tags: ['budget'],
    features: ['Air conditioned', 'Boot for 2 large bags', 'Charging point', 'Bottled water on request'],
    bestFor: ['Airport transfers', 'City meetings', 'Solo and couple travel'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    /* No 'dzire' here on purpose: the two share the plain "Sedan" rate row,
       but a rate row named for one model should not price the other. */
    rateAliases: ['aura', 'sedan', 'hyundai', 'xcent'],
    score: { comfort: 5, space: 4, value: 9 },
  },
  'honda-city': {
    bags: 2, ac: true, comfort: 'Premium', tags: ['premium'],
    features: ['Air conditioned', 'Premium interior', 'Rear-seat legroom', 'Charging point', 'Bottled water'],
    bestFor: ['Executive travel', 'Client pickups', 'Airport transfers'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['premium sedan', 'city', 'honda', 'verna'],
    score: { comfort: 7, space: 4, value: 7 },
  },
  ciaz: {
    bags: 2, ac: true, comfort: 'Premium', tags: ['premium'],
    features: ['Air conditioned', 'Premium interior', 'Rear-seat legroom', 'Large boot', 'Charging point', 'Bottled water'],
    bestFor: ['Executive travel', 'Client pickups', 'Long airport runs'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    /* 'ciaz' moved off the Honda City when this was added: two premium sedans
       share the "Premium sedan" row, but a row named for one must not price
       the other. */
    rateAliases: ['ciaz', 'premium sedan', 'maruti', 'sx4'],
    score: { comfort: 7, space: 5, value: 7 },
  },
  ertiga: {
    bags: 3, ac: true, comfort: 'Comfort', tags: ['budget'],
    features: ['Air conditioned', 'Three rows of seating', 'Space for 3 large bags', 'Charging point'],
    bestFor: ['Small families', 'Group city travel', 'Weekend trips'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    /* 'xl6' left here when the XL6 joined the fleet: the class words are shared
       on purpose, a model name never is. */
    rateAliases: ['ertiga', 'mpv', 'muv', 'suv'],
    maxPax: 7,
    score: { comfort: 6, space: 7, value: 8 },
  },
  xl6: {
    bags: 3, ac: true, comfort: 'Comfort', tags: ['budget'],
    features: ['Air conditioned', 'Captain seats in the middle row', 'Space for 3 large bags', 'Charging point'],
    bestFor: ['Six travelling together', 'Group city travel', 'Weekend trips'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['xl6', 'muv', 'suv'],
    score: { comfort: 7, space: 6, value: 7 },
  },
  rumion: {
    bags: 3, ac: true, comfort: 'Comfort', tags: ['budget'],
    features: ['Air conditioned', 'Three rows of seating', 'Space for 3 large bags', 'Charging point'],
    bestFor: ['Small families', 'Group city travel', 'Weekend trips'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['rumion', 'muv', 'suv'],
    maxPax: 7,
    score: { comfort: 6, space: 7, value: 7 },
  },
  'innova-crysta': {
    bags: 4, ac: true, comfort: 'Premium', tags: ['premium'],
    features: ['Air conditioned', 'Captain seats', 'Space for 4 large bags', 'Long-distance suspension', 'Charging points'],
    bestFor: ['Outstation comfort', 'Senior executives', 'Family trips', 'Long-distance travel'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['crysta', 'innova', 'premium suv', 'premium mpv'],
    maxPax: 7,
    score: { comfort: 9, space: 8, value: 6 },
  },
  carens: {
    bags: 4, ac: true, comfort: 'Premium', tags: ['premium'],
    features: ['Air conditioned', 'Three rows of seating', 'Space for 4 large bags', 'Rear air vents', 'Charging points'],
    bestFor: ['Family outstation trips', 'Group airport transfers', 'Long-distance travel'],
    plans: ['LOCAL', 'AIRPORT', 'OUTSTATION'],
    rateAliases: ['carens', 'kia', 'premium suv'],
    maxPax: 7,
    score: { comfort: 8, space: 8, value: 7 },
  },
  'tempo-traveller-12': {
    bags: 12, ac: true, comfort: 'Comfort', tags: ['group'],
    features: ['Air conditioned', '12 pushback seats', 'Roof carrier available', 'Standing headroom', 'Charging points'],
    bestFor: ['Team offsites', 'Group airport transfers', 'Family groups', 'Pilgrimage trips'],
    plans: ['LOCAL', 'OUTSTATION'],
    rateAliases: ['traveller', 'tempo', '12 seater', 'force'],
    score: { comfort: 6, space: 9, value: 8 },
  },
  'tempo-traveller-17': {
    bags: 17, ac: true, comfort: 'Comfort', tags: ['group'],
    features: ['Air conditioned', '17 pushback seats', 'Roof carrier available', 'Standing headroom', 'Charging points'],
    bestFor: ['Larger groups', 'Event shuttle runs', 'School and college trips'],
    plans: ['LOCAL', 'OUTSTATION'],
    /* 'traveller' and 'tempo' stay after the rename to Urbania: a rate row
       typed as "Force Traveller 17" by the office still has to price it. */
    rateAliases: ['urbania', 'traveller', 'tempo', '17 seater', 'force'],
    score: { comfort: 6, space: 10, value: 8 },
  },
  bus: {
    bags: 45, ac: true, comfort: 'Comfort', tags: ['group'],
    features: ['Air conditioned', '35 to 49 seats', 'Underfloor luggage bay', 'Public address system', 'Reclining seats'],
    bestFor: ['Conferences', 'Weddings', 'Large event movements', 'Institutional groups'],
    plans: ['LOCAL', 'OUTSTATION'],
    rateAliases: ['bus', 'coach', 'volvo', '45 seater', '49 seater'],
    score: { comfort: 6, space: 10, value: 9 },
  },
};

export interface CatalogVehicle extends Vehicle, VehicleExtra {}

/** The twelve vehicles we run, with everything the booking screens need. */
export const VEHICLES: CatalogVehicle[] = FLEET.map((v) => ({ ...v, ...EXTRA[v.slug] }));

export const vehicleBySlug = (slug?: string) => VEHICLES.find((v) => v.slug === slug);

/**
 * How many people this vehicle can be booked for.
 *
 * Use this — never `seats` — when deciding whether a vehicle is big enough for
 * a group. `seats` is what the cards quote; this is what the office can seat.
 */
export const capacityOf = (v: CatalogVehicle) => v.maxPax ?? v.seats;

/**
 * Classes outside the twelve above — decorated wedding cars, vintage cars,
 * additional coaches — are arranged per event rather than kept on the road, so
 * they are offered as a request and never listed as though they were on the yard.
 */
export const ON_REQUEST_CLASSES = [
  'Luxury and executive sedans',
  'Decorated wedding cars',
  'Vintage and speciality vehicles',
  'Additional coaches for large movements',
];

export const COMFORT_ORDER: Comfort[] = ['Standard', 'Comfort', 'Premium', 'Luxury'];

/* ==========================================================================
   3 · Enhance your trip
   ========================================================================== */

export interface Addon {
  key: string;
  emoji: string;
  label: string;
  note: string;
  /** What it is quoted against — keeps the estimate honest about exclusions. */
  basis: string;
}

export const ADDONS: Addon[] = [
  { key: 'hotel',     emoji: '\u{1F3E8}', label: 'Hotel booking', note: 'Rooms held on the route through the hotels we work with.', basis: 'Billed by the hotel' },
  { key: 'guide',     emoji: '\u{1F9ED}', label: 'Tour guide',    note: 'A local guide for the sightseeing part of the day.',       basis: 'Per day, quoted' },
  { key: 'photo',     emoji: '\u{1F4F8}', label: 'Photography',   note: 'A photographer for the trip or the event day.',            basis: 'Per day, quoted' },
  { key: 'meals',     emoji: '\u{1F371}', label: 'Meals',         note: 'Packed breakfast or planned lunch stops.',                 basis: 'At actuals' },
  { key: 'parking',   emoji: '\u{1F17F}️', label: 'Parking pass', note: 'Venue and hotel parking handled by the chauffeur.',   basis: 'At actuals' },
  { key: 'childseat', emoji: '\u{1F476}', label: 'Child seat',    note: 'Fitted before dispatch. A day of notice helps.',           basis: 'No charge' },
  { key: 'luggage',   emoji: '\u{1F9F3}', label: 'Extra luggage', note: 'Roof carrier, or a larger vehicle for the same group.',    basis: 'Quoted' },
  { key: 'activity',  emoji: '\u{1F39F}️', label: 'Activities', note: 'Entry tickets and pre-booked slots on the itinerary.', basis: 'At actuals' },
];

export const addonByKey = (key: string) => ADDONS.find((a) => a.key === key);

/* ==========================================================================
   4 · Events, weddings and corporate
   ========================================================================== */

export interface EventType {
  slug: string;
  emoji: string;
  label: string;
  sub: string;
  needs: string[];
}

export const EVENT_TYPES: EventType[] = [
  { slug: 'wedding',    emoji: '\u{1F48D}', label: 'Wedding',          sub: 'Baraat, family, guests and airport runs', needs: ['Guest airport transfers', 'Hotel to venue shuttles', 'Bride and groom car', 'Baraat vehicles'] },
  { slug: 'corporate',  emoji: '\u{1F3E2}', label: 'Corporate Event',  sub: 'Offsites, town halls, award nights',      needs: ['Staggered pickups', 'Venue shuttles', 'Executive cars', 'Late-night drops'] },
  { slug: 'concert',    emoji: '\u{1F3A4}', label: 'Concert',          sub: 'Artist, crew and guest movement',         needs: ['Artist and crew cars', 'Equipment vehicle', 'Guest shuttles', 'Overnight standby'] },
  { slug: 'sports',     emoji: '\u{1F3C6}', label: 'Sports',           sub: 'Teams, officials and support staff',      needs: ['Team coaches', 'Officials cars', 'Kit vehicle', 'Match-day standby'] },
  { slug: 'education',  emoji: '\u{1F393}', label: 'School / College', sub: 'Trips, fests and industrial visits',      needs: ['Coaches and Travellers', 'Teacher escort seating', 'Multi-day itineraries', 'Parent contact list'] },
  { slug: 'film',       emoji: '\u{1F3AC}', label: 'Production',       sub: 'Unit, cast and equipment movement',       needs: ['Unit vehicles', 'Cast cars', 'Long shoot-day standby', 'Location recce'] },
  { slug: 'conference', emoji: '\u{1F3AA}', label: 'Conference',       sub: 'Delegates, speakers and exhibitors',      needs: ['Airport desk', 'Hotel to venue loop', 'Speaker cars', 'Exhibitor logistics'] },
];

export const eventBySlug = (slug?: string) => EVENT_TYPES.find((e) => e.slug === slug);

export const WEDDING_SERVICES = [
  { emoji: '\u{1F490}', label: 'Bride & Groom',     note: 'The car that matters most on the day, held aside and turned out to your brief.' },
  { emoji: '\u{1F46A}', label: 'Family',            note: 'Dedicated vehicles for immediate family across every function.' },
  { emoji: '\u{1F389}', label: 'Guests',            note: 'Shuttle loops, so nobody is left standing outside a venue.' },
  { emoji: '✈️', label: 'Airport Transfers', note: 'Arrivals tracked by flight number, however late they land.' },
  { emoji: '\u{1F3E8}', label: 'Hotel Transfers',   note: 'Hotel to hotel movement between functions, on a published timetable.' },
  { emoji: '\u{1F3DB}️', label: 'Venue Transfers', note: 'Timed departures for mehendi, sangeet, wedding and reception.' },
  { emoji: '\u{1F941}', label: 'Baraat',            note: 'Slow-moving procession vehicles with a chauffeur who has done it before.' },
  { emoji: '\u{1F698}', label: 'Luxury Cars',       note: 'Premium and decorated cars arranged for the day on request.' },
];

export const CORPORATE_BLOCKS = [
  { key: 'employee',  emoji: '\u{1F9D1}', label: 'Employee Travel',  note: 'Daily and ad-hoc staff movement, one point of contact, one monthly bill.' },
  { key: 'executive', emoji: '\u{1F454}', label: 'Executive Travel', note: 'Premium cars and chauffeurs briefed on how to conduct themselves with senior guests.' },
  { key: 'airport',   emoji: '✈️', label: 'Airport Transfers', note: 'Flight-tracked pickups at CSMIA T1 and T2, Navi Mumbai and Pune, including the 4am departures.' },
  { key: 'dedicated', emoji: '\u{1F697}', label: 'Dedicated Vehicles', note: 'A car and chauffeur attached to your office on a monthly basis.' },
  { key: 'events',    emoji: '\u{1F3AA}', label: 'Corporate Events', note: 'Multiple vehicles for offsites and town halls, reconciled onto one invoice.' },
  { key: 'recurring', emoji: '\u{1F501}', label: 'Recurring Travel', note: 'The same route at the same time every week — set up once, then left running.' },
];

export const CORPORATE_REQUEST_TYPES = [
  { key: 'employee',  label: 'Employee Travel',       sub: 'Staff movement, shifts, ad-hoc duties' },
  { key: 'executive', label: 'Executive Travel',      sub: 'Senior management and board travel' },
  { key: 'client',    label: 'Client Transportation', sub: 'Visiting clients and guests' },
  { key: 'event',     label: 'Corporate Event',       sub: 'Offsite, town hall, conference' },
  { key: 'fleet',     label: 'Multiple Vehicles',     sub: 'A fleet for one date or one week' },
];

/* ==========================================================================
   5 · Trust, support and FAQ grouping
   ========================================================================== */

export const TRUST = [
  { label: 'Verified vehicles',   note: 'Commercial permit, insurance and fitness current on every car that goes out.' },
  { label: 'Verified chauffeurs', note: 'Licence and address on file, uniformed, no tobacco on duty.' },
  { label: 'Transparent pricing', note: 'Toll and parking at actuals, never marked up, always itemised.' },
  { label: 'Support 24×7',   note: 'One number, answered by the owner, day or night.' },
  { label: 'Secure booking',      note: 'Nothing is charged before the rate is agreed with you.' },
  { label: 'Trip tracking',       note: 'Vehicle and chauffeur details shared before the reporting time.' },
];

export interface SupportTopic {
  key: string;
  label: string;
  sub: string;
  /** What we need from you to settle it in one call. */
  asks: string[];
}

export const SUPPORT_TOPICS: SupportTopic[] = [
  { key: 'booking', label: 'My Booking',       sub: 'Check or confirm an existing request', asks: ['Your request reference, or the travel date', 'The mobile number you booked with'] },
  { key: 'change',  label: 'Change Trip',      sub: 'Move a date, time, pickup or vehicle', asks: ['What needs to change', 'The new date and reporting time'] },
  { key: 'cancel',  label: 'Cancel Trip',      sub: 'Call off a booked trip',               asks: ['Your request reference', 'Whether you would rather move it than cancel'] },
  { key: 'driver',  label: 'Driver Issue',     sub: 'Conduct, delay or vehicle condition',  asks: ['The travel date and vehicle number', 'What happened, in your words'] },
  { key: 'payment', label: 'Payment Question', sub: 'Invoice, GST, terms or a receipt',     asks: ['The invoice number, if you have it', 'Your GSTIN, for a corrected invoice'] },
  { key: 'general', label: 'General Question', sub: 'Anything else',                        asks: ['Your question', 'A number we can call you back on'] },
];

/**
 * FAQ categories. Each group claims the answers whose question text contains
 * one of its match words, so adding an FAQ in siteData files it automatically
 * and the two lists can never drift apart.
 */
export const FAQ_GROUPS: { key: string; label: string; match: string[] }[] = [
  { key: 'booking',      label: 'Booking',      match: ['book', 'advance', 'someone else', 'know the driver', 'minimum', 'particular vehicle'] },
  { key: 'local',        label: 'Local travel', match: ['full day', 'hourly', 'areas', 'night'] },
  { key: 'outstation',   label: 'Outstation',   match: ['outstation', 'one-way', 'multi-day', 'wait and bring', 'another city'] },
  { key: 'airport',      label: 'Airport',      match: ['airport', 'flight', 'terminal', 'odd hours', 'driver meet'] },
  { key: 'corporate',    label: 'Corporate',    match: ['corporate', 'invoice', 'gst', 'payment', 'trip sheet', 'consolidat', 'month'] },
  { key: 'events',       label: 'Events',       match: ['event', 'wedding', 'several cars'] },
  { key: 'vehicles',     label: 'Vehicles',     match: ['vehicle', 'luggage', 'air condition', 'child', 'pet', 'wifi', 'insured', 'self'] },
  { key: 'cancellation', label: 'Cancellation', match: ['plans change', 'cancel', 'complain'] },
];
