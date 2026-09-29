import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { COMPANY, whatsappLink } from './siteData';
import { rememberSearch, useCustomer } from './tripStore';
import { POPULAR_SEARCHES, searchSite } from './searchIndex';
import { MobileNav } from './MobileNav';
import { Assistant } from './Assistant';
import {
  IconPhone, IconLock, IconMail, IconPin, IconMenu, IconClose, IconArrowRight,
  IconSearch, IconUsers, IconCheck,
} from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { useCustomerAuth } from '../lib/customerAuth';

/* ==========================================================================
   Navigation
   ==========================================================================
   THE BAR CARRIES WHAT THE HOME PAGE DOES NOT.

   The home page already opens with "What do you need today?" — ten cards
   covering local, airport, outstation, hourly, corporate, events, weddings,
   groups, tours and fleets — and then the fleet, the destinations and the
   planners. Repeating all of that as five dropdown menus in the header bought
   nothing: it was the same content twice, it made the bar wider than the page
   container it sits in, and it crowded out the things the home page genuinely
   does not have.

   So the bar now holds search, the two ways to reach a person — Call and
   WhatsApp — the account, and a menu. Everything else lives one tap away in the
   menu panel, which shows every section at once instead of hiding them behind
   five separate hovers.

   Notifications and a "Plan a trip" button were both here and both came out:
   the home page opens on the booking form, so the button was a second door to
   a room the visitor was already standing in, and notifications is a page you
   go to rather than a control you need at all times. Both are in the menu.
   ========================================================================== */

interface NavItem {
  label: string;
  to: string;
  note?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    label: 'Transport',
    items: [
      { label: 'Local', to: '/book?tab=LOCAL', note: 'Around Mumbai, Thane and Navi Mumbai' },
      { label: 'Airport', to: '/book?tab=AIRPORT', note: 'CSMIA, Navi Mumbai and Pune' },
      { label: 'Outstation', to: '/book?tab=OUTSTATION', note: 'One-way drops and round trips' },
      { label: 'Hourly rental', to: '/book?tab=HOURLY', note: '4h/40km and 8h/80km packages' },
    ],
  },
  {
    label: 'Corporate',
    items: [
      { label: 'Corporate travel', to: '/corporate', note: 'Rate cards, billing, one contact' },
      { label: 'Employee transport', to: '/corporate/request?type=employee' },
      { label: 'Executive travel', to: '/corporate/request?type=executive' },
      { label: 'Corporate login', to: '/login' },
    ],
  },
  {
    label: 'Events',
    items: [
      { label: 'Weddings', to: '/weddings', note: 'The whole schedule, day by day' },
      { label: 'Corporate events', to: '/events/planner?type=corporate' },
      { label: 'Conferences', to: '/events/planner?type=conference' },
      { label: 'Group transport', to: '/group-travel' },
      { label: 'Multiple vehicles', to: '/fleet-request' },
    ],
  },
  {
    label: 'Travel',
    items: [
      { label: 'Mumbai tours', to: '/tours/mumbai', note: 'Sightseeing, 4 hours to a full day' },
      { label: 'Weekend trips', to: '/weekend-trips' },
      { label: 'Maharashtra tours', to: '/weekend-trips?state=Maharashtra' },
      { label: 'Help me find a trip', to: '/find-a-trip' },
    ],
  },
  {
    label: 'Vehicles',
    items: [
      { label: 'All vehicles', to: '/vehicles', note: 'Filter, compare, see estimates' },
      { label: 'Cars', to: '/vehicles?cat=Sedan' },
      { label: 'SUVs', to: '/vehicles?cat=SUV' },
      { label: 'Tempo Traveller', to: '/vehicles?cat=Group' },
      { label: 'Bus', to: '/vehicles?cat=Coach' },
    ],
  },
];

/** The half of the panel the home page does not carry. */
const YOURS: NavItem[] = [
  { label: 'My trips', to: '/trips', note: 'Trip IDs, status and invoices' },
  { label: 'Track a trip', to: '/track', note: 'With your Trip ID, no account needed' },
  { label: 'Sign in / create account', to: '/account', note: 'Track every trip and download invoices' },
  { label: 'My profile', to: '/profile' },
  { label: 'Notifications', to: '/notifications' },
];

const HELP: NavItem[] = [
  { label: 'Support', to: '/support' },
  { label: 'FAQ', to: '/faq' },
  { label: 'Services', to: '/services' },
  { label: 'Contact', to: '/contact' },
];

/* ==========================================================================
   The account button
   ==========================================================================
   Signed out it is an invitation; signed in it is the way back to your trips
   with your own initial on it. Deliberately small and quiet — the loud things
   in this bar are Call and WhatsApp, which is where the bookings come from.
   ========================================================================== */

function AccountButton() {
  const { user, loading } = useCustomerAuth();

  // Render nothing at all while the session is being checked, rather than
  // flashing "Sign in" at somebody who is already signed in.
  if (loading) return <span className="hidden h-9 w-9 sm:block" aria-hidden="true" />;

  if (!user) {
    return (
      <Link
        to="/account"
        className="btn btn-sm hidden h-9 shrink-0 rounded-full bg-white px-4 font-semibold text-ink-700 shadow-xs transition-colors hover:bg-ink-50 sm:inline-flex"
      >
        <IconUsers className="h-3.5 w-3.5" /> Sign in
      </Link>
    );
  }

  const initial = (user.fullName || user.email).trim().charAt(0).toUpperCase();
  return (
    <Link
      to="/trips"
      title={`Signed in as ${user.email}`}
      aria-label={`My trips — signed in as ${user.email}`}
      className="grad-brand hidden h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white shadow-sm shadow-brand-500/25 transition-transform hover:scale-105 sm:grid"
    >
      {initial}
    </Link>
  );
}

/* ==========================================================================
   Logo
   ========================================================================== */

/**
 * The drawing's own aspect ratio, off its viewBox (264 x 92.2). Hard-coded so
 * the <img> can be given a real width and height and the header does not
 * reflow once the SVG finishes loading.
 */
const ART_RATIO = 2.863;

export function Logo({ size = 40, tight = false }: { size?: number; tight?: boolean }) {
  /* `size` is the HEIGHT here, not a square side: the header carries the wide
     line drawing rather than the square mark. At size 42 that is ~120px of the
     bar's width where the square mark took 42. The room for it only exists
     because the Call pill stopped printing the whole phone number — if anything
     new is added to the right-hand cluster, this is what breaks first.

     The BOLD cut of the drawing, not the fine one. At 120px wide the fine
     version's body strokes survive but its sixteen-spoke sunbursts collapse
     into grey discs; the bold cut thickens every stroke and drops to eight
     spokes. Verified side by side in
     assets/logo-options/_header-fine-vs-bold.png. */
  const w = Math.round(size * ART_RATIO);
  /* `tight` is for the header bar, where the mark competes with the menu
     button for the width of a phone. The footer logo has a column to itself
     and passes nothing. The ! is needed because width and height are set
     inline, and an inline style beats a class. */
  const markPhone = tight ? 'max-[420px]:!h-7 max-[420px]:!w-20' : '';
  return (
    <Link to="/" className={`group flex items-center gap-3 ${tight ? 'min-w-0 max-[420px]:gap-2' : ''}`}>
      <img
        src="/assets/art-car-line-bold.svg"
        alt="Gupta Tours & Travels"
        width={w}
        height={size}
        style={{ width: w, height: size }}
        className={`shrink-0 transition-transform duration-300 group-hover:scale-105 ${markPhone}`}
      />
      <span className="leading-tight">
        <span className={`block whitespace-nowrap font-display text-sm font-bold tracking-tight text-ink-900 sm:text-[0.95rem] ${tight ? 'max-[360px]:text-[12.5px]' : ''}`}>
          Gupta Tours &amp; Travels
        </span>
        <span className="block whitespace-nowrap text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-600 sm:text-[9.5px]">
          24×7 · Mumbai
        </span>
      </span>
    </Link>
  );
}

/* ==========================================================================
   Search, in the header
   ========================================================================== */

function HeaderSearch({
  variant = 'popover', onDone, className = '',
}: {
  /** `inline` is the full field used inside the menu panel. */
  variant?: 'popover' | 'inline';
  onDone?: () => void;
  className?: string;
}) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(variant === 'inline');
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  const results = term.trim().length >= 2 ? searchSite(term).slice(0, 6) : [];
  const popover = variant === 'popover';

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(!popover);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(!popover); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover]);

  useEffect(() => {
    if (open && popover) setTimeout(() => field.current?.focus(), 60);
  }, [open, popover]);

  const leave = () => {
    if (popover) { setOpen(false); setTerm(''); }
    onDone?.();
  };

  const go = (to: string, label: string) => {
    rememberSearch(label);
    leave();
    navigate(to);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    rememberSearch(term);
    leave();
    navigate(`/search?q=${encodeURIComponent(term.trim())}`);
  };

  const panel = (
    <>
      <form onSubmit={submit} className="relative">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <input
          ref={field}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Destinations, vehicles, services…"
          aria-label="Search the site"
          className="h-10 w-full rounded-full border-0 bg-ink-50/90 pl-10 pr-3 text-sm font-medium text-ink-900 outline-none placeholder:font-normal placeholder:text-ink-400 focus:bg-white focus:shadow-focus"
        />
      </form>

      {results.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-2xl bg-white py-1 shadow-card">
          {results.map((r) => (
            <li key={`${r.kind}-${r.label}`}>
              <button
                onClick={() => go(r.to, r.label)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-ink-50"
              >
                <IconPin className="h-4 w-4 shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-800">{r.label}</span>
                  <span className="block truncate text-xs text-ink-500">{r.sub}</span>
                </span>
                <span className="shrink-0 text-2xs font-bold uppercase tracking-[0.08em] text-ink-400">{r.kind}</span>
              </button>
            </li>
          ))}
          <li className="border-t border-ink-100">
            <button
              onClick={submit}
              className="w-full px-3.5 py-2.5 text-left text-xs font-bold text-brand-700 hover:bg-ink-50"
            >
              See all results for "{term.trim()}"
            </button>
          </li>
        </ul>
      )}

      {term.trim().length < 2 && (
        <div className="mt-3">
          <p className="mb-2 text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Popular</p>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_SEARCHES.slice(0, 6).map((q) => (
              <button
                key={q}
                onClick={() => setTerm(q)}
                className="rounded-full bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-600 hover:bg-brand-50 hover:text-brand-700"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  if (!popover) return <div ref={box} className={className}>{panel}</div>;

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Search the site"
        className={`grid h-9 w-9 place-items-center rounded-full transition-colors ${
          open ? 'bg-white text-ink-900' : 'text-ink-500 hover:bg-white hover:text-ink-900'
        }`}
      >
        <IconSearch className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 w-[min(24rem,calc(100vw-2rem))] animate-fade-down pt-2">
          <div className="rounded-2xl bg-white p-3 shadow-pop">{panel}</div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   The menu panel
   ==========================================================================
   One surface with every section on it. Five hover-dropdowns meant five
   separate discoveries; this reads top to bottom on a phone and as columns on a
   desktop, and it is the same markup either way.
   ========================================================================== */

function MenuPanel({ onClose, activeTrips }: { onClose: () => void; activeTrips: number }) {
  return (
    <div className="shell py-6">
      <div className="sm:hidden">
        <HeaderSearch variant="inline" onDone={onClose} />
      </div>

      <div className="mt-5 grid gap-x-8 gap-y-7 sm:mt-0 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {GROUPS.map((g) => (
          <div key={g.label} className="min-w-0">
            <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">{g.label}</h2>
            <ul className="mt-3 space-y-0.5">
              {g.items.map((i) => (
                <li key={i.to}>
                  <Link to={i.to} className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-ink-50">
                    <span className="block text-sm font-semibold text-ink-800">{i.label}</span>
                    {i.note && <span className="mt-0.5 block text-xs leading-snug text-ink-500">{i.note}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="min-w-0">
          <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Yours</h2>
          <ul className="mt-3 space-y-0.5">
            {YOURS.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="-mx-2 block rounded-xl px-2 py-1.5 transition-colors hover:bg-ink-50">
                  <span className="flex items-center gap-2 text-sm font-semibold text-ink-800">
                    {i.label}
                    {i.to === '/trips' && activeTrips > 0 && (
                      <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {activeTrips}
                      </span>
                    )}
                  </span>
                  {i.note && <span className="mt-0.5 block text-xs leading-snug text-ink-500">{i.note}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">Help</h2>
          <ul className="mt-3 space-y-0.5">
            {HELP.map((i) => (
              <li key={i.to}>
                <Link
                  to={i.to}
                  className="-mx-2 block rounded-xl px-2 py-1.5 text-sm font-semibold text-ink-800 transition-colors hover:bg-ink-50"
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-2.5 border-t border-ink-100 pt-6">
        <Link to="/book" className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white hover:brightness-[1.06]">
          Plan a trip <IconArrowRight className="h-4 w-4" />
        </Link>
        <Link to="/help-me-choose" className="btn h-11 rounded-full bg-ink-50 px-5 text-md text-ink-700 hover:bg-ink-100">
          Help me choose
        </Link>
        <a
          href={`tel:+91${COMPANY.mobile}`}
          aria-label="Call the office"
          className="btn h-11 rounded-full bg-ink-900 px-5 text-md text-white hover:bg-ink-800"
        >
          <IconPhone className="h-4 w-4" /> Call
        </a>
        <a
          href={whatsappLink()}
          target="_blank" rel="noreferrer"
          className="btn h-11 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white hover:bg-[#1FB855]"
        >
          <IconWhatsApp className="h-4 w-4" /> WhatsApp
        </a>
      </div>
    </div>
  );
}

/* ==========================================================================
   The layout
   ========================================================================== */

export default function SiteLayout() {
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const { trips } = useCustomer();

  const activeTrips = trips.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menu ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const lifted = scrolled || menu;

  return (
    <div className="page-bg flex min-h-screen flex-col">
      {/* ============================== HEADER ============================== */}
      <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ease-smooth ${lifted ? 'glass' : 'bg-transparent'}`}>
        <div className={`shell flex items-center gap-3 !px-4 transition-all duration-300 min-[360px]:!px-5 sm:!px-8 ${lifted ? 'h-16' : 'h-20'}`}>
          <Logo size={lifted ? 38 : 42} tight />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <HeaderSearch className="hidden sm:block" />

            {/* The bar carries the two ways to reach a person, and nothing else.
                Notifications and "Plan a trip" were both here and both left:
                each is still one tap away in the Menu, and the home page opens
                on the booking form anyway, so the bar was repeating itself.

                Call and WhatsApp are the two the business actually runs on —
                every booking already arrives down one of them. */}
            <a
              href={`tel:+91${COMPANY.mobile}`}
              aria-label="Call the office"
              className="btn btn-sm hidden h-9 shrink-0 rounded-full bg-ink-900 px-4 text-white transition-colors duration-200 hover:bg-ink-800 md:inline-flex"
            >
              <IconPhone className="h-3.5 w-3.5" /> Call
            </a>

            <a
              href={whatsappLink()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Message the office on WhatsApp"
              className="btn btn-sm hidden h-9 shrink-0 rounded-full bg-[#25D366] px-4 font-semibold text-white transition-[filter] hover:brightness-[1.06] sm:inline-flex"
            >
              <IconWhatsApp className="h-3.5 w-3.5" /> WhatsApp
            </a>

            <AccountButton />

            {/* Below 360px the bar cannot hold this and the menu button and the
                wordmark at once - and the bottom navigation already carries a
                Profile tab, so this is the one that goes. */}
            <Link
              to="/profile"
              aria-label="My profile"
              className="grid h-9 w-9 place-items-center rounded-full text-ink-500 transition-colors hover:bg-white hover:text-ink-900 max-[359px]:hidden sm:hidden"
            >
              <IconUsers className="h-4 w-4" />
            </Link>

            {/* Everything the home page does not already show, one tap away. */}
            <button
              onClick={() => setMenu((v) => !v)}
              aria-expanded={menu}
              className={`btn h-10 shrink-0 rounded-full px-3 text-sm font-semibold transition-colors sm:h-9 ${
                menu ? 'bg-white text-ink-900' : 'text-ink-700 hover:bg-white'
              }`}
            >
              {menu ? <IconClose className="h-4 w-4" /> : <IconMenu className="h-4 w-4" />}
              <span className="hidden sm:inline">{menu ? 'Close' : 'Menu'}</span>
            </button>
          </div>
        </div>

        {!lifted && <div className="header-fade pointer-events-none h-4 w-full" aria-hidden="true" />}

        <div
          className={`overflow-y-auto bg-white/97 backdrop-blur-xl transition-[max-height] duration-300 ease-smooth ${
            menu ? 'max-h-[calc(100vh-4rem)]' : 'max-h-0'
          }`}
        >
          {menu && <MenuPanel onClose={() => setMenu(false)} activeTrips={activeTrips} />}
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* ============================== FOOTER ============================== */}
      <footer className="page-bg px-5 pb-8 sm:px-8">
        <div className="mx-auto max-w-[76rem] rounded-t-[2.25rem] bg-white px-6 pb-10 pt-12 shadow-card sm:px-12">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-12 lg:gap-8">
            <div className="sm:col-span-2 lg:col-span-4">
              <Logo size={44} />
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-ink-500">
                Transport, car rental, outstation travel, corporate accounts and event fleets across Mumbai and
                Maharashtra. Owned and managed personally by {COMPANY.owner}.
              </p>

              <ul className="mt-5 flex flex-wrap gap-2">
                {['Verified vehicles', 'Verified chauffeurs', 'Transparent pricing'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1.5 text-2xs font-semibold text-ink-600">
                    <IconCheck className="h-3 w-3 text-ok-500" /> {t}
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <h4 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-900">Services</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                {[
                  ['Local', '/book?tab=LOCAL'],
                  ['Airport', '/book?tab=AIRPORT'],
                  ['Outstation', '/book?tab=OUTSTATION'],
                  ['Corporate', '/corporate'],
                  ['Events', '/events'],
                  ['Wedding', '/weddings'],
                  ['Tours', '/tours/mumbai'],
                ].map(([label, to]) => (
                  <li key={to}>
                    <Link to={to} className="text-ink-500 transition-colors hover:text-brand-700">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <h4 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-900">Explore</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                {[
                  ['Mumbai', '/tours/mumbai'],
                  ['Maharashtra', '/weekend-trips'],
                  ['Weekend trips', '/weekend-trips'],
                  ['Vehicles', '/vehicles'],
                  ['Find a trip', '/find-a-trip'],
                  ['Travel assistant', '/assistant'],
                ].map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-ink-500 transition-colors hover:text-brand-700">{label}</Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-2">
              <h4 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-900">Support</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li><Link to="/support" className="text-ink-500 transition-colors hover:text-brand-700">Help centre</Link></li>
                <li><Link to="/contact" className="text-ink-500 transition-colors hover:text-brand-700">Contact</Link></li>
                <li>
                  <a href={whatsappLink()} target="_blank" rel="noreferrer" className="text-ink-500 transition-colors hover:text-brand-700">
                    WhatsApp
                  </a>
                </li>
                <li><Link to="/faq" className="text-ink-500 transition-colors hover:text-brand-700">FAQ</Link></li>
                <li><Link to="/trips" className="text-ink-500 transition-colors hover:text-brand-700">My trips</Link></li>
                <li><Link to="/track" className="text-ink-500 transition-colors hover:text-brand-700">Track a trip</Link></li>
                <li><Link to="/account" className="text-ink-500 transition-colors hover:text-brand-700">Sign in / create account</Link></li>
                <li><Link to="/reviews" className="text-ink-500 transition-colors hover:text-brand-700">Reviews</Link></li>
              </ul>
            </div>

            <div className="sm:col-span-2 lg:col-span-2">
              <h4 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-900">Company</h4>
              <ul className="mt-4 space-y-2.5 text-sm">
                <li><Link to="/about" className="text-ink-500 transition-colors hover:text-brand-700">About</Link></li>
                <li><Link to="/contact" className="text-ink-500 transition-colors hover:text-brand-700">Contact</Link></li>
                <li><Link to="/policies#terms" className="text-ink-500 transition-colors hover:text-brand-700">Terms</Link></li>
                <li><Link to="/policies#privacy" className="text-ink-500 transition-colors hover:text-brand-700">Privacy</Link></li>
                <li><Link to="/login" className="text-ink-500 transition-colors hover:text-brand-700">Partner login</Link></li>
              </ul>
            </div>
          </div>

          {/* ---------------------------- get in touch ---------------------------- */}
          <div className="mt-10 grid gap-6 border-t border-ink-100 pt-8 sm:grid-cols-3">
            <a href={`tel:+91${COMPANY.mobile}`} className="flex gap-3">
              <IconPhone className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              <span className="flex flex-col gap-0.5">
                <span className="font-semibold text-ink-900">Call the office</span>
                <span className="text-xs text-ink-400">{COMPANY.serviceHours} · ask for {COMPANY.owner}</span>
              </span>
            </a>
            <a href={`mailto:${COMPANY.email}`} className="flex gap-3">
              <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              <span className="break-all text-sm text-ink-500">{COMPANY.email}</span>
            </a>
            <p className="flex gap-3">
              <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
              <span className="text-sm text-ink-500">{COMPANY.address}</span>
            </p>
          </div>

          {/* Reachable channels only. We do not publish social profiles here
              because the business does not run any — a dead icon row is worse
              than none. Add them to this row when the accounts exist. */}
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <a
              href={whatsappLink()}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1FB855]"
            >
              <IconWhatsApp className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <a href={`tel:+91${COMPANY.mobile}`} className="inline-flex items-center gap-2 rounded-full bg-ink-900 px-4 py-2 text-xs font-semibold text-white hover:bg-ink-800">
              <IconPhone className="h-3.5 w-3.5" /> Call
            </a>
            <a href={`mailto:${COMPANY.email}`} className="inline-flex items-center gap-2 rounded-full bg-ink-50 px-4 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100">
              <IconMail className="h-3.5 w-3.5" /> Email
            </a>
            <Link to="/login" className="inline-flex items-center gap-2 rounded-full bg-ink-50 px-4 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-100">
              <IconLock className="h-3.5 w-3.5" /> Partner login
            </Link>
          </div>

          {/**
            * Photo attribution, once for the whole site.
            *
            * It used to sit under the photographs on five separate pages, which
            * put a line of small print in the middle of the sightseeing cards
            * every time. It cannot simply be deleted: most of these images come
            * from Wikimedia under CC BY or CC BY-SA, and both licences require
            * the credit. Carrying it here keeps the pages clean and the licence
            * satisfied at the same time.
            */}
          <p className="mt-8 text-2xs leading-relaxed text-ink-400">
            Photographs of places and events are representative images, not our own.{' '}
            <a href="/assets/places/CREDITS.txt" className="underline hover:text-ink-600">Destination credits</a>
            {' · '}
            <a href="/assets/places/CREDITS-MUMBAI.txt" className="underline hover:text-ink-600">Mumbai credits</a>
            {' · '}
            <a href="/assets/needs/CREDITS.txt" className="underline hover:text-ink-600">Service card credits</a>
          </p>

          <div className="mt-4 flex flex-col items-center justify-between gap-2 text-xs text-ink-400 sm:flex-row">
            <p>© {new Date().getFullYear()} Gupta Tours &amp; Travels. All rights reserved.</p>
            <p>{COMPANY.serviceHours} · Goregaon (W), Mumbai</p>
          </div>
        </div>
      </footer>

      {/* Space for the bottom navigation on phones. */}
      <div className="h-16 lg:hidden" aria-hidden="true" />

      <MobileNav />
      <Assistant />
    </div>
  );
}
