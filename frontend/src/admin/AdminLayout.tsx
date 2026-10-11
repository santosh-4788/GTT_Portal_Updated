import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { inr, dmy } from '../lib/format';
import { ConfirmDialog } from '../components/ui';
import { Menu } from '../components/data';
import {
  IconDashboard, IconBookings, IconVendors, IconBilling, IconInvoices,
  IconPayments, IconReports, IconSettings, IconUsers, IconAudit,
  IconSearch, IconMenu, IconChevron, IconExternal, IconRoad,
  IconLogout, IconKey, IconPlus, IconCar, IconLayers, IconChat,
  IconStar, IconBook, IconRoute, IconEvent, IconGlobe,
} from '../components/icons';
import { LanguageProvider, LanguageSwitch } from '../lib/i18n';
import { useSeo } from '../site/Seo';

type IconCmp = (p: any) => JSX.Element;
interface NavItem {
  to: string; label: string; Icon: IconCmp; perms?: string[]; end?: boolean;
  /** Key into the /dashboard/badges counts. */
  badge?: string; alert?: boolean;
  /** Extra paths that belong to this item for highlighting and breadcrumbs. */
  also?: string[];
}

/**
 * The sidebar, in the order the office works: the day's operations, the
 * reference data behind them, the money, a workspace, then administration.
 */
const NAV_GROUPS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [{ to: '/admin', label: 'Dashboard', Icon: IconDashboard, perms: ['dashboard.view'], end: true }],
  },
  {
    title: 'Operations',
    items: [
      { to: '/admin/trips', label: 'Trips', Icon: IconRoute, perms: ['bookings.view'], badge: 'newEnquiries', alert: true },
      { to: '/admin/bookings', label: 'Bookings', Icon: IconBookings, perms: ['bookings.view'] },
      { to: '/admin/events', label: 'Events', Icon: IconEvent, perms: ['events.view'] },
      { to: '/admin/fleet', label: 'Fleet', Icon: IconCar, perms: ['fleet.view', 'settings.view'], badge: 'expiringDocuments' },
      { to: '/admin/chats', label: 'Chat history', Icon: IconChat, perms: ['bookings.view'] },
      { to: '/admin/feedback', label: 'Feedback', Icon: IconStar, perms: ['bookings.view'] },
      { to: '/admin/chatbot', label: 'Chatbot Knowledge', Icon: IconBook, perms: ['settings.view'] },
    ],
  },
  {
    title: 'Masters',
    items: [
      { to: '/admin/vendors', label: 'Companies / Vendors', Icon: IconVendors, perms: ['vendors.view'] },
      { to: '/admin/outstation-fares', label: 'Outstation Fares', Icon: IconRoad, perms: ['vendors.view', 'masters.view'] },
      { to: '/admin/masters', label: 'Masters', Icon: IconLayers, perms: ['masters.view', 'vendors.view'], also: ['/admin/master'] },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/admin/billing', label: 'Billing', Icon: IconBilling, perms: ['billing.view'], badge: 'batchesAwaitingApproval', alert: true },
      { to: '/admin/invoices', label: 'Invoices', Icon: IconInvoices, perms: ['invoices.view'], badge: 'overdueInvoices' },
      { to: '/admin/payments', label: 'Payments & Ledger', Icon: IconPayments, perms: ['payments.view'] },
      { to: '/admin/reports', label: 'Reports', Icon: IconReports, perms: ['reports.view'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/settings', label: 'Settings', Icon: IconSettings, perms: ['settings.view'] },
      { to: '/admin/users', label: 'Users & Roles', Icon: IconUsers, perms: ['users.view'] },
      { to: '/admin/audit', label: 'Audit Log', Icon: IconAudit, perms: ['audit.view'] },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Sub-pages that are not in the sidebar but should read properly in the breadcrumb. */
const SUB_PAGES: { prefix: string; label: string }[] = [
  { prefix: '/admin/bookings/new', label: 'New booking' },
  { prefix: '/admin/vendors/new', label: 'New vendor' },
  { prefix: '/admin/settings/templates', label: 'Invoice templates' },
  { prefix: '/admin/change-password', label: 'Change password' },
];

const COLLAPSE_KEY = 'gtt.rail.collapsed';
/** Whether the desktop sidebar is hidden, remembered per browser. */
const HIDDEN_KEY = 'gtt.rail.hidden';
function readHidden(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}
function readCollapsed(): string[] {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]'); } catch { return []; }
}

// ---------------------------------------------------------------------------
function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/dashboard/search', { params: { q: term.trim() } });
        setResults(data);
        setOpen(true);
      } catch { /* a failed search should never interrupt the page */ }
    }, 250);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // "/" focuses the search from anywhere, as in most business tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        box.current?.querySelector('input')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: string) => {
    setOpen(false); setTerm(''); onNavigate?.(); navigate(path);
  };
  const empty = results && !results.bookings?.length && !results.invoices?.length && !results.vendors?.length;

  return (
    <div ref={box} className="relative w-full">
      <input
        className="input h-9 border-ink-200/80 bg-ink-50/70 pl-9 pr-9 text-[13px] placeholder:text-ink-400 focus:bg-white"
        placeholder="Search trips, invoices, vendors, mobile…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-label="Search the portal"
      />
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <kbd className="kbd pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 lg:block">/</kbd>

      {open && results && (
        <div className="card absolute left-0 right-0 top-full z-40 mt-2 max-h-[26rem] overflow-y-auto p-1.5 shadow-lift">
          {empty && <p className="px-3 py-6 text-center text-sm text-ink-500">Nothing matched “{term}”.</p>}

          {results.bookings?.length > 0 && (
            <div className="mb-1">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Trips & bookings</p>
              {results.bookings.map((b: any) => (
                <button key={b.id} onClick={() => go(`/admin/trips?open=${b.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50">
                  <span className="font-mono text-[11px] font-semibold text-brand-700">{b.trip_id ?? b.booking_code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{b.passenger_name}</span>
                  <span className="shrink-0 text-xs text-ink-500">{dmy(b.travel_date)}</span>
                </button>
              ))}
            </div>
          )}

          {results.invoices?.length > 0 && (
            <div className="mb-1">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Invoices</p>
              {results.invoices.map((i: any) => (
                <button key={i.id} onClick={() => go(`/admin/invoices/${i.id}`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50">
                  <span className="font-mono text-[11px] font-semibold text-brand-700">{i.invoice_number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{i.vendor_name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-ink-700">{inr(i.total_amount)}</span>
                </button>
              ))}
            </div>
          )}

          {results.vendors?.length > 0 && (
            <div>
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Vendors</p>
              {results.vendors.map((v: any) => (
                <button key={v.id} onClick={() => go(`/admin/vendors/${v.id}/edit`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50">
                  <span className="font-mono text-[11px] font-semibold text-brand-700">{v.code}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-800">{v.vendor_name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
export default function AdminLayout() {
  return (
    <LanguageProvider>
      <PortalShell />
    </LanguageProvider>
  );
}

function PortalShell() {
  useSeo({ title: 'Staff portal', noindex: true });
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(readHidden);
  const [menuOpen, setMenuOpen] = useState(false);
  // Signing out is one click from a menu that is one click from everywhere, so
  // it asks first — a mis-tap otherwise throws away an unsaved booking form.
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const { pathname } = useLocation();
  const menuBox = useRef<HTMLDivElement>(null);

  useEffect(() => { setSidebarOpen(false); setMenuOpen(false); setSearchOpen(false); }, [pathname]);

  // The portal's own palette, applied to <html> so dialogs and toasts get it too.
  useEffect(() => {
    document.documentElement.classList.add('theme-admin');
    return () => document.documentElement.classList.remove('theme-admin');
  }, []);

  // Hiding the desktop sidebar gives the page its full width. The class moves
  // --rail-w to zero, so anything sized off it (the sticky save bar) follows.
  useEffect(() => {
    document.documentElement.classList.toggle('rail-hidden', railHidden);
    try { localStorage.setItem(HIDDEN_KEY, railHidden ? '1' : '0'); } catch { /* per-browser nicety only */ }
    return () => document.documentElement.classList.remove('rail-hidden');
  }, [railHidden]);

  /** The menu button: opens the drawer on a phone, hides or shows the sidebar on a desktop. */
  const toggleNav = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) setRailHidden((v) => !v);
    else setSidebarOpen(true);
  };

  // Ctrl+B (⌘B) hides and shows the sidebar, as in most editors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        const t = e.target as HTMLElement;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
        e.preventDefault();
        setRailHidden((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Sidebar counts: refreshed on navigation and every two minutes.
  useEffect(() => {
    let alive = true;
    const load = () => api.get('/dashboard/badges').then((r) => alive && setBadges(r.data)).catch(() => { /* counts are a nicety */ });
    load();
    const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);

  /**
   * Point the page at the STAFF manifest while the portal is open.
   *
   * This is what lets an iPhone add the portal to the home screen as its own
   * icon — "GTT Portal", opening straight to /admin — rather than a second
   * shortcut to the customer site. Restored on the way out.
   */
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (!link) return;

    const previousHref = link.getAttribute('href');
    const previousTitle = title?.getAttribute('content') ?? null;

    link.setAttribute('href', '/manifest-portal.webmanifest');
    title?.setAttribute('content', 'GTT Portal');

    return () => {
      if (previousHref) link.setAttribute('href', previousHref);
      if (previousTitle && title) title.setAttribute('content', previousTitle);
    };
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); setSidebarOpen(false); }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const toggleGroup = (title: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title];
      try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* per-browser nicety only */ }
      return next;
    });
  };

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.perms || can(...n.perms)) }))
    .filter((g) => g.items.length > 0);

  const matches = (n: NavItem) =>
    n.end ? pathname === n.to : [n.to, ...(n.also ?? [])].some((p) => pathname === p || pathname.startsWith(p + '/'));
  const current = [...ALL_ITEMS].reverse().find(matches);
  const sub = SUB_PAGES.find((s) => pathname.startsWith(s.prefix));

  const createItems = [
    can('bookings.create') && { label: 'New booking', hint: 'Company message, walk-in or direct customer', onClick: () => navigate('/admin/bookings/new') },
    can('bookings.create') && { label: 'Walk-in booking', hint: 'Price and confirm at the counter', onClick: () => navigate('/admin/bookings/new?source=WALKIN') },
    can('bookings.create') && { label: 'Quick enquiry', hint: 'Note an enquiry to price later', onClick: () => navigate('/admin/trips?new=1') },
    can('events.create') && { label: 'New event', hint: 'Many vehicles for one event', onClick: () => navigate('/admin/events?new=1') },
    can('billing.view') && { label: 'Generate invoices', hint: 'Trips ready to bill', onClick: () => navigate('/admin/billing') },
    can('payments.create') && { label: 'Record a payment', hint: 'Against an invoice', onClick: () => navigate('/admin/payments?new=1') },
  ];

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#0C1A2B] via-[#0F2033] to-[#0B1726]">
      <Link
        to="/admin"
        className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-4 transition-colors hover:bg-white/[0.03]"
      >
        <img src={`${import.meta.env.BASE_URL}assets/art-car-line-bold.svg`} alt="" className="h-auto w-12 shrink-0" />
        <span className="min-w-0">
          {/* Never truncated: the full business name wraps onto a second line
              rather than being cut to "Gupta Tours & Trav…". */}
          <span className="block font-display text-[13px] font-bold leading-tight text-white">
            Gupta Tours &amp; Travels
          </span>
          <span className="block text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold-300/90">
            Business Portal
          </span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4" aria-label="Portal">
        {visibleGroups.map((group, gi) => {
          const shut = !!group.title && collapsed.includes(group.title) && !group.items.some(matches);
          return (
            <div key={group.title ?? `g${gi}`}>
              {group.title && (
                <button type="button" className="rail-group" onClick={() => toggleGroup(group.title!)} aria-expanded={!shut}>
                  {group.title}
                  <IconChevron className={`h-3 w-3 transition-transform duration-200 ${shut ? '-rotate-90' : ''}`} />
                </button>
              )}
              {!shut && (
                <div className={group.title ? 'space-y-0.5' : 'space-y-0.5 pt-3'}>
                  {group.items.map(({ to, label, Icon, end, badge, alert, also }) => {
                    const count = badge ? badges[badge] ?? 0 : 0;
                    const active = matches({ to, label, Icon, end, also });
                    return (
                      <NavLink key={to} to={to} end={end}
                        className={() => `rail-link ${active ? 'rail-link-active' : ''}`}>
                        <Icon className="h-[17px] w-[17px] shrink-0" />
                        <span className="truncate">{label}</span>
                        {count > 0 && <span className={`rail-count ${alert ? 'rail-count-alert' : ''}`}>{count > 99 ? '99+' : count}</span>}
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.07] p-2.5">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconExternal className="h-[17px] w-[17px] shrink-0" />
          <span>Public website</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F3F5F9]">
      {/* desktop sidebar — width matches --rail-w */}
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-60 transition-transform duration-200 ease-smooth lg:block ${railHidden ? '-translate-x-full' : ''}`}
        aria-hidden={railHidden}>
        {sidebar}
      </aside>

      {/* mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-slide-in">{sidebar}</aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ease-smooth ${railHidden ? '' : 'lg:pl-60'}`}>
        {/* top bar — one row, so --header-h stays accurate */}
        <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/90 backdrop-blur-md no-print">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              className="btn-ghost btn-sm -ml-1"
              onClick={toggleNav}
              aria-label={railHidden ? 'Show the sidebar' : 'Hide the sidebar'}
              title={railHidden ? 'Show the sidebar (Ctrl+B)' : 'Hide the sidebar (Ctrl+B)'}
            >
              <IconMenu className="h-5 w-5" />
            </button>

            <nav className="hidden min-w-0 items-center gap-1.5 text-xs md:flex" aria-label="Breadcrumb">
              <Link to="/admin" className="text-ink-500 transition-colors hover:text-brand-600">Portal</Link>
              {current && current.to !== '/admin' && (
                <>
                  <span className="text-ink-300">/</span>
                  {sub ? (
                    <Link to={current.to} className="text-ink-500 transition-colors hover:text-brand-600">{current.label}</Link>
                  ) : (
                    <span className="truncate font-semibold text-ink-800">{current.label}</span>
                  )}
                </>
              )}
              {sub && (
                <>
                  <span className="text-ink-300">/</span>
                  <span className="truncate font-semibold text-ink-800">{sub.label}</span>
                </>
              )}
            </nav>

            <div className="ml-auto hidden w-full max-w-md sm:block">
              <GlobalSearch />
            </div>

            <button
              className="btn-ghost btn-sm ml-auto sm:hidden"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search"
            >
              <IconSearch className="h-5 w-5" />
            </button>

            {createItems.some(Boolean) && (
              <Menu
                label="Create"
                width="w-64"
                trigger={
                  <span className="btn-primary btn-sm">
                    <IconPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Create</span>
                  </span>
                }
                items={createItems}
              />
            )}

            <div ref={menuBox} className="relative shrink-0">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors hover:bg-ink-100"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[13px] font-bold text-white ring-2 ring-gold-300/60">
                  {user?.fullName?.charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-left lg:block">
                  <span className="block max-w-[9rem] truncate text-[13px] font-semibold leading-tight text-ink-900" data-no-i18n>
                    {user?.fullName}
                  </span>
                  <span className="block text-[10.5px] leading-tight text-ink-500">{user?.roleName}</span>
                </span>
                <IconChevron className="h-3.5 w-3.5 text-ink-400" />
              </button>

              {menuOpen && (
                <div className="card absolute right-0 top-full z-40 mt-2 w-64 p-1.5 shadow-lift" role="menu">
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink-900" data-no-i18n>{user?.fullName}</p>
                    <p className="truncate text-xs text-ink-500" data-no-i18n>{user?.email}</p>
                    <span className="badge-brand mt-2">{user?.roleName}</span>
                  </div>
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-500"><IconGlobe className="h-4 w-4" /> Language</p>
                    <LanguageSwitch />
                  </div>
                  <Link to="/admin/change-password" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <IconKey className="h-4 w-4 text-ink-400" /> Change password
                  </Link>
                  <Link to="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <IconExternal className="h-4 w-4 text-ink-400" /> Public website
                  </Link>
                  <button onClick={() => { setMenuOpen(false); setConfirmOut(true); }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-danger-600 hover:bg-danger-50">
                    <IconLogout className="h-4 w-4" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* search drops below the bar on phones */}
          {searchOpen && (
            <div className="border-t border-ink-100 px-4 py-2.5 sm:hidden">
              <GlobalSearch onNavigate={() => setSearchOpen(false)} />
            </div>
          )}
        </header>

        <main className="admin-main mx-auto max-w-[100rem] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={async () => { setSigningOut(true); await logout(); }}
        title="Sign out?"
        body={
          <>
            <p>Are you sure you want to sign out of the portal?</p>
            <p className="text-ink-500">
              Anything you have typed but not saved — a half-finished booking, an unsent invoice —
              will be lost.
            </p>
          </>
        }
        confirmLabel="Yes, sign out"
        cancelLabel="No"
        danger
        busy={signingOut}
      />
    </div>
  );
}
