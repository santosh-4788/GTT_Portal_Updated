/**
 * The search index.
 *
 * Built from the same data files the pages render from, so a new destination or
 * vehicle is searchable the moment it is added and there is no index to keep in
 * step by hand.
 *
 * It lives in its own module rather than in the search page because the header
 * search box uses it on every page — importing it from the page component would
 * pull that whole screen into the first load.
 */
import { SERVICES } from './siteData';
import { EVENT_TYPES, VEHICLES } from './catalog';
import { DESTINATIONS, MUMBAI_SPOTS } from './places';

export type SearchKind = 'Destination' | 'In Mumbai' | 'Vehicle' | 'Service' | 'Event' | 'Page';

export interface SearchEntry {
  kind: SearchKind;
  label: string;
  sub: string;
  to: string;
  /** Extra words that should match this entry. */
  words: string[];
}

const PAGES: SearchEntry[] = [
  { kind: 'Page', label: 'Plan a trip', sub: 'Local, airport, outstation and hourly', to: '/book', words: ['book', 'booking', 'search', 'quote'] },
  { kind: 'Page', label: 'Help me choose', sub: 'Four questions, one recommendation', to: '/help-me-choose', words: ['which vehicle', 'recommend', 'not sure'] },
  { kind: 'Page', label: 'Group travel', sub: 'One vehicle or several, worked out live', to: '/group-travel', words: ['group', 'many people', 'tempo'] },
  { kind: 'Page', label: 'Multiple vehicles', sub: 'Plan a fleet for one date', to: '/fleet-request', words: ['fleet', 'bulk', 'several cars'] },
  { kind: 'Page', label: 'Corporate travel', sub: 'Accounts, rate cards and billing', to: '/corporate', words: ['company', 'employee', 'business', 'gst'] },
  { kind: 'Page', label: 'Event transportation', sub: 'Conferences, concerts and more', to: '/events', words: ['event', 'conference', 'guests'] },
  { kind: 'Page', label: 'Wedding transportation', sub: 'The whole schedule, day by day', to: '/weddings', words: ['wedding', 'baraat', 'shaadi', 'marriage'] },
  { kind: 'Page', label: 'Mumbai tours', sub: 'Sightseeing and the tour builder', to: '/tours/mumbai', words: ['sightseeing', 'city tour', 'darshan'] },
  { kind: 'Page', label: 'Weekend escapes', sub: 'Everywhere within a day’s drive', to: '/weekend-trips', words: ['weekend', 'getaway', 'hill station'] },
  { kind: 'Page', label: 'Help me find a trip', sub: 'Discovery by interest and budget', to: '/find-a-trip', words: ['where should i go', 'ideas', 'suggest'] },
  { kind: 'Page', label: 'Travel assistant', sub: 'Describe the trip in your own words', to: '/assistant', words: ['chat', 'ai', 'ask'] },
  { kind: 'Page', label: 'My trips', sub: 'Your requests and references', to: '/trips', words: ['bookings', 'history', 'reference'] },
  { kind: 'Page', label: 'Support', sub: 'Change, cancel or query a trip', to: '/support', words: ['help', 'complaint', 'contact'] },
  { kind: 'Page', label: 'FAQ', sub: 'Forty answers, grouped', to: '/faq', words: ['questions', 'toll', 'gst', 'cancellation'] },
  { kind: 'Page', label: 'Fare estimate', sub: 'Work out a trip cost from our rates', to: '/#fare', words: ['price', 'cost', 'rate', 'calculator'] },
  { kind: 'Page', label: 'Terms and privacy', sub: 'What a fare covers, and what we do with your details', to: '/policies', words: ['terms', 'privacy', 'policy', 'data'] },
];

export const SEARCH_INDEX: SearchEntry[] = [
  ...DESTINATIONS.map<SearchEntry>((d) => ({
    kind: 'Destination',
    label: d.name,
    sub: `${d.km} km · ${d.hours} · ${d.bestFor[0]}`,
    to: `/destinations/${d.slug}`,
    words: [...d.themes, ...d.seeThere, d.state],
  })),
  ...MUMBAI_SPOTS.map<SearchEntry>((s) => ({
    kind: 'In Mumbai',
    label: s.name,
    sub: `${s.area} · ${s.idealFor}`,
    to: '/tours/mumbai',
    words: [...s.themes, s.area],
  })),
  ...VEHICLES.map<SearchEntry>((v) => ({
    kind: 'Vehicle',
    label: v.name,
    sub: `${v.category} · ${v.seats} seats · ${v.bags} bags`,
    to: `/vehicles/${v.slug}`,
    words: [...v.rateAliases, ...v.bestFor, v.comfort, v.examples],
  })),
  ...SERVICES.map<SearchEntry>((s) => ({
    kind: 'Service',
    label: s.name,
    sub: s.short,
    to: `/services/${s.slug}`,
    words: s.idealFor,
  })),
  ...EVENT_TYPES.map<SearchEntry>((e) => ({
    kind: 'Event',
    label: e.label,
    sub: e.sub,
    to: e.slug === 'wedding' ? '/weddings' : `/events/planner?type=${e.slug}`,
    words: e.needs,
  })),
  ...PAGES,
];

export const POPULAR_SEARCHES = [
  'Lonavala', 'Innova Crysta', 'Airport transfer', 'Mahabaleshwar',
  'Tempo Traveller', 'Wedding', 'Shirdi', 'Corporate',
];

/**
 * Rank the index against a term.
 *
 * An exact name beats a prefix, a prefix beats a substring, and a hit in the
 * extra words counts for more than one in the subtitle — because someone typing
 * "hills" wants the destination tagged hills, not the page that happens to
 * mention them.
 */
export function searchSite(term: string): SearchEntry[] {
  const t = term.trim().toLowerCase();
  if (t.length < 2) return [];

  const scored = SEARCH_INDEX.map((e) => {
    const label = e.label.toLowerCase();
    let score = 0;
    if (label === t) score += 100;
    else if (label.startsWith(t)) score += 60;
    else if (label.includes(t)) score += 40;
    if (e.sub.toLowerCase().includes(t)) score += 12;
    if (e.words.some((w) => w.toLowerCase().includes(t))) score += 16;
    // Destinations and vehicles are what people are usually after.
    if (e.kind === 'Destination' || e.kind === 'Vehicle') score += 4;
    return { e, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.e)
    .slice(0, 24);
}
