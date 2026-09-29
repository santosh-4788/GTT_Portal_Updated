import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { inr, dmy } from '../lib/format';
import { ConfirmDialog } from '../components/ui';
import { IconTemplates,
  IconDashboard, IconBookings, IconVendors, IconBilling, IconInvoices,
  IconPayments, IconReports, IconSettings, IconUsers, IconAudit,
  IconSearch, IconMenu, IconClose, IconChevron, IconExternal, IconRoad,
  IconLogout, IconKey, IconPlus,
} from '../components/icons';
import { useSeo } from '../site/Seo';

type IconCmp = (p: any) => JSX.Element;
interface NavItem { to: string; label: string; Icon: IconCmp; perms?: string[]; end?: boolean }

/** Grouped so the sidebar reads as three jobs, not one flat list of ten links. */
const NAV_GROUPS: { title: string | null; items: NavItem[] }[] = [
  {
    title: null,
    items: [{ to: '/admin', label: 'Dashboard', Icon: IconDashboard, perms: ['dashboard.view'], end: true }],
  },
  {
    title: 'Operations',
    items: [
      // The customer journey — every enquiry and booking from every channel.
      { to: '/admin/trips', label: 'Trips', Icon: IconRoad, perms: ['bookings.view'] },
      { to: '/admin/bookings', label: 'Bookings', Icon: IconBookings, perms: ['bookings.view'] },
      { to: '/admin/customer-booking', label: 'Customer Booking', Icon: IconUsers, perms: ['bookings.create'] },
      { to: '/admin/chats', label: 'Chat history', Icon: IconAudit, perms: ['bookings.view'] },
      // What the website assistant understands - intents, examples, synonyms.
      { to: '/admin/chatbot', label: 'Chatbot Knowledge', Icon: IconTemplates, perms: ['settings.view'] },
      { to: '/admin/feedback', label: 'Feedback', Icon: IconReports, perms: ['bookings.view'] },
      { to: '/admin/vendors', label: 'Vendors', Icon: IconVendors, perms: ['vendors.view'] },
      // Rate cards are vendor data, so they sit behind the vendor permissions
      // rather than a new module — which also means every existing account can
      // reach the Master without a permission migration.
      { to: '/admin/master', label: 'Master', Icon: IconTemplates, perms: ['vendors.view'] },
      { to: '/admin/outstation-fares', label: 'Outstation Fares', Icon: IconRoad, perms: ['vendors.view'] },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/admin/billing', label: 'Billing', Icon: IconBilling, perms: ['billing.view'] },
      { to: '/admin/invoices', label: 'Invoices', Icon: IconInvoices, perms: ['invoices.view'] },
      { to: '/admin/payments', label: 'Payments', Icon: IconPayments, perms: ['payments.view'] },
      { to: '/admin/reports', label: 'Reports', Icon: IconReports, perms: ['reports.view'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/admin/settings', label: 'Settings', Icon: IconSettings, perms: ['settings.view'] },
      { to: '/admin/users', label: 'Users', Icon: IconUsers, perms: ['users.view'] },
      { to: '/admin/audit', label: 'Audit Log', Icon: IconAudit, perms: ['audit.view'] },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

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

  const go = (path: string) => {
    setOpen(false); setTerm(''); onNavigate?.(); navigate(path);
  };
  const empty = results && !results.bookings?.length && !results.invoices?.length && !results.vendors?.length;

  return (
    <div ref={box} className="relative w-full">
      <input
        className="input h-9 border-ink-200/80 bg-ink-50/70 pl-9 text-[13px] placeholder:text-ink-400 focus:bg-white"
        placeholder="Search bookings, invoices, vendors, mobile…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results && setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-label="Search the portal"
      />
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />

      {open && results && (
        <div className="card absolute left-0 right-0 top-full z-40 mt-2 max-h-[26rem] overflow-y-auto p-1.5 shadow-lift">
          {empty && <p className="px-3 py-6 text-center text-sm text-ink-500">Nothing matched “{term}”.</p>}

          {results.bookings?.length > 0 && (
            <div className="mb-1">
              <p className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">Bookings</p>
              {results.bookings.map((b: any) => (
                <button key={b.id} onClick={() => go(`/admin/bookings/${b.id}/edit`)}
                  className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left hover:bg-brand-50">
                  <span className="font-mono text-[11px] font-semibold text-brand-600">{b.booking_code}</span>
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
                  <span className="font-mono text-[11px] font-semibold text-brand-600">{i.invoice_number}</span>
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
                  <span className="font-mono text-[11px] font-semibold text-brand-600">{v.code}</span>
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
export default function AdminLayout() {
  useSeo({ title: 'Staff portal', noindex: true });
  const { user, logout, can } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Signing out is one click from a menu that is one click from everywhere, so
  // it asks first — a mis-tap otherwise throws away an unsaved booking form.
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const menuBox = useRef<HTMLDivElement>(null);

  useEffect(() => { setSidebarOpen(false); setMenuOpen(false); setSearchOpen(false); }, [pathname]);

  /**
   * Point the page at the STAFF manifest while the portal is open.
   *
   * This is what lets an iPhone add the portal to the home screen as its own
   * icon — "GTT Portal", opening straight to /admin — rather than a second
   * shortcut to the customer site. Safari reads the manifest at the moment the
   * user taps Add to Home Screen, so swapping the link while this layout is
   * mounted is enough; both icons can then live on the same phone.
   *
   * Restored on the way out, so leaving the portal leaves the public manifest
   * in place for a customer using the same browser.
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

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((n) => !n.perms || can(...n.perms)) }))
    .filter((g) => g.items.length > 0);

  const current = [...ALL_ITEMS].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-900">
      <Link
        to="/admin"
        className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5 transition-colors hover:bg-white/[0.04]"
      >
        <img src="/assets/art-car-line-bold.svg" alt="" className="h-auto w-16 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate font-display text-[13px] font-bold leading-tight text-white">
            Gupta Tours &amp; Travels
          </span>
          <span className="block text-[9.5px] font-medium uppercase tracking-[0.13em] text-brand-300">
            Business Portal
          </span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {visibleGroups.map((group, gi) => (
          <div key={group.title ?? `g${gi}`}>
            {group.title && <p className="rail-group">{group.title}</p>}
            <div className={group.title ? 'space-y-0.5' : 'space-y-0.5 pt-3'}>
              {group.items.map(({ to, label, Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `rail-link ${isActive ? 'rail-link-active' : ''}`}
                >
                  <Icon className="h-[17px] w-[17px] shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 p-2.5">
        <Link
          to="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-400 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <IconExternal className="h-[17px] w-[17px] shrink-0" />
          <span>Public website</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      {/* desktop sidebar — width matches --admin-rail-w */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 lg:block">{sidebar}</aside>

      {/* mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-slide-in">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-60">
        {/* top bar — one row, so --admin-header-h stays accurate */}
        <header className="sticky top-0 z-30 border-b border-ink-200 bg-white/95 backdrop-blur no-print">
          {/* height must equal --header-h, which sticky page elements offset from */}
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button
              className="btn-ghost btn-sm -ml-1 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <IconMenu className="h-5 w-5" />
            </button>

            {/* breadcrumb sits inline instead of taking a second row */}
            <nav className="hidden min-w-0 items-center gap-1.5 text-xs md:flex" aria-label="Breadcrumb">
              <Link to="/admin" className="text-ink-500 transition-colors hover:text-brand-600">Portal</Link>
              {current && (
                <>
                  <span className="text-ink-300">/</span>
                  <span className="truncate font-semibold text-ink-800">{current.label}</span>
                </>
              )}
            </nav>

            <div className="ml-auto hidden w-full max-w-sm sm:block">
              <GlobalSearch />
            </div>

            <button
              className="btn-ghost btn-sm ml-auto sm:hidden"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label="Search"
            >
              <IconSearch className="h-5 w-5" />
            </button>

            <div ref={menuBox} className="relative shrink-0">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors hover:bg-ink-100"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-bold text-white">
                  {user?.fullName?.charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-left lg:block">
                  <span className="block max-w-[9rem] truncate text-[13px] font-semibold leading-tight text-ink-900">
                    {user?.fullName}
                  </span>
                  <span className="block text-[10.5px] leading-tight text-ink-500">{user?.roleName}</span>
                </span>
                <IconChevron className="h-3.5 w-3.5 text-ink-400" />
              </button>

              {menuOpen && (
                <div className="card absolute right-0 top-full z-40 mt-2 w-60 p-1.5 shadow-lift" role="menu">
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink-900">{user?.fullName}</p>
                    <p className="truncate text-xs text-ink-500">{user?.email}</p>
                    <span className="badge-brand mt-2">{user?.roleName}</span>
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
