/**
 * The customer's own portal, at /my.
 *
 * The same frame the office works in — the navy sidebar, the top bar, the
 * tables — so a customer signing in sees a proper account rather than a page
 * of the brochure site. Everything inside it comes from /api/customer, which
 * only ever returns the signed-in customer's own trips and invoices.
 *
 * Trips and invoices are loaded once here and handed to every page through
 * the outlet context, so moving between Dashboard, Trips and Invoices does not
 * refetch, and the sidebar counts agree with the pages.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { useCustomerAuth, type CustomerUser } from '../lib/customerAuth';
import { stageBucket, useMyInvoices, useMyTrips, type ServerInvoice, type ServerTrip } from '../site/accountApi';
import { ConfirmDialog, Loading } from '../components/ui';
import {
  IconDashboard, IconRoute, IconInvoices, IconUsers, IconMenu, IconChevron, IconExternal,
  IconLogout, IconPlus, IconGlobe, IconPhone,
} from '../components/icons';
import { LanguageProvider, LanguageSwitch } from '../lib/i18n';
import { useSeo } from '../site/Seo';
import { COMPANY } from '../site/siteData';

export interface AccountCtx {
  user: CustomerUser;
  trips: ServerTrip[];
  tripsLoading: boolean;
  tripsError: string;
  reloadTrips: () => Promise<void>;
  invoices: ServerInvoice[];
  invoicesLoading: boolean;
  invoicesError: string;
  reloadInvoices: () => Promise<void>;
}

export const useAccount = () => useOutletContext<AccountCtx>();

type IconCmp = (p: any) => JSX.Element;
interface NavItem { to: string; label: string; Icon: IconCmp; end?: boolean; count?: (c: AccountCtx) => number; alert?: boolean }

const NAV: NavItem[] = [
  { to: '/my', label: 'Dashboard', Icon: IconDashboard, end: true },
  {
    to: '/my/trips', label: 'My trips', Icon: IconRoute,
    count: (c) => c.trips.filter((t) => ['upcoming', 'active'].includes(stageBucket(t))).length,
  },
  {
    to: '/my/invoices', label: 'Invoices', Icon: IconInvoices, alert: true,
    count: (c) => c.invoices.filter((i) => i.outstanding > 0.009).length,
  },
  { to: '/my/profile', label: 'Profile', Icon: IconUsers },
];

const HIDDEN_KEY = 'gtt.myrail.hidden';
function readHidden(): boolean {
  try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; }
}

export default function AccountLayout() {
  const { user, loading } = useCustomerAuth();
  const location = useLocation();

  if (loading) {
    return <div className="grid min-h-screen place-items-center"><Loading label="Checking your session…" /></div>;
  }
  if (!user) {
    return <Navigate to={`/account?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return (
    <LanguageProvider>
      <AccountShell user={user} />
    </LanguageProvider>
  );
}

function AccountShell({ user }: { user: CustomerUser }) {
  useSeo({ title: 'My account', noindex: true });
  const { signOut } = useCustomerAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const { trips, loading: tripsLoading, error: tripsError, reload: reloadTrips } = useMyTrips(true);
  const { invoices, loading: invoicesLoading, error: invoicesError, reload: reloadInvoices } = useMyInvoices(true);
  const ctx: AccountCtx = {
    user, trips, tripsLoading, tripsError, reloadTrips, invoices, invoicesLoading, invoicesError, reloadInvoices,
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railHidden, setRailHidden] = useState(readHidden);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuBox = useRef<HTMLDivElement>(null);

  useEffect(() => { setSidebarOpen(false); setMenuOpen(false); }, [pathname]);

  // The portal's palette, applied to <html> so dialogs and toasts get it too.
  useEffect(() => {
    document.documentElement.classList.add('theme-admin');
    return () => document.documentElement.classList.remove('theme-admin');
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('rail-hidden', railHidden);
    try { localStorage.setItem(HIDDEN_KEY, railHidden ? '1' : '0'); } catch { /* per-browser nicety only */ }
    return () => document.documentElement.classList.remove('rail-hidden');
  }, [railHidden]);

  const toggleNav = () => {
    if (window.matchMedia('(min-width: 1024px)').matches) setRailHidden((v) => !v);
    else setSidebarOpen(true);
  };

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

  const matches = (n: NavItem) => (n.end ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + '/'));
  const current = [...NAV].reverse().find(matches);

  const sidebar = (
    <div className="flex h-full flex-col bg-gradient-to-b from-[#0C1A2B] via-[#0F2033] to-[#0B1726]">
      <Link to="/my" className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-4 transition-colors hover:bg-white/[0.03]">
        <img src={`${import.meta.env.BASE_URL}assets/art-car-line-bold.svg`} alt="" className="h-auto w-12 shrink-0" />
        <span className="min-w-0">
          <span className="block font-display text-[13px] font-bold leading-tight text-white">Gupta Tours &amp; Travels</span>
          <span className="block text-[9.5px] font-semibold uppercase tracking-[0.18em] text-gold-300/90">My Account</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2.5 pb-4 pt-3" aria-label="My account">
        {NAV.map((n) => {
          const count = n.count ? n.count(ctx) : 0;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} className={() => `rail-link ${matches(n) ? 'rail-link-active' : ''}`}>
              <n.Icon className="h-[17px] w-[17px] shrink-0" />
              <span className="truncate">{n.label}</span>
              {count > 0 && <span className={`rail-count ${n.alert ? 'rail-count-alert' : ''}`}>{count > 99 ? '99+' : count}</span>}
            </NavLink>
          );
        })}
      </nav>

      <div className="space-y-0.5 border-t border-white/[0.07] p-2.5">
        <a href={`tel:+91${COMPANY.mobile}`}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white">
          <IconPhone className="h-[17px] w-[17px] shrink-0" />
          <span>Call the office</span>
        </a>
        <Link to="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-white/55 transition-colors hover:bg-white/[0.06] hover:text-white">
          <IconExternal className="h-[17px] w-[17px] shrink-0" />
          <span>Public website</span>
        </Link>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F3F5F9]">
      <aside className={`fixed inset-y-0 left-0 z-30 hidden w-60 transition-transform duration-200 ease-smooth lg:block ${railHidden ? '-translate-x-full' : ''}`}
        aria-hidden={railHidden}>
        {sidebar}
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/60" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-slide-in">{sidebar}</aside>
        </div>
      )}

      <div className={`transition-[padding] duration-200 ease-smooth ${railHidden ? '' : 'lg:pl-60'}`}>
        <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-white/90 backdrop-blur-md no-print">
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <button className="btn-ghost btn-sm -ml-1" onClick={toggleNav}
              aria-label={railHidden ? 'Show the sidebar' : 'Hide the sidebar'}>
              <IconMenu className="h-5 w-5" />
            </button>

            <nav className="hidden min-w-0 items-center gap-1.5 text-xs md:flex" aria-label="Breadcrumb">
              <Link to="/my" className="text-ink-500 transition-colors hover:text-brand-600">My account</Link>
              {current && current.to !== '/my' && (
                <>
                  <span className="text-ink-300">/</span>
                  <span className="truncate font-semibold text-ink-800">{current.label}</span>
                </>
              )}
            </nav>

            <button onClick={() => navigate('/book')} className="btn-primary btn-sm ml-auto">
              <IconPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Book a trip</span>
            </button>

            <div ref={menuBox} className="relative shrink-0">
              <button onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 transition-colors hover:bg-ink-100"
                aria-haspopup="menu" aria-expanded={menuOpen}>
                {user.pictureUrl ? (
                  <img src={user.pictureUrl} alt="" referrerPolicy="no-referrer" className="h-8 w-8 shrink-0 rounded-full ring-2 ring-gold-300/60" />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-600 to-brand-800 text-[13px] font-bold text-white ring-2 ring-gold-300/60">
                    {user.fullName?.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="hidden text-left lg:block">
                  <span className="block max-w-[9rem] truncate text-[13px] font-semibold leading-tight text-ink-900" data-no-i18n>{user.fullName}</span>
                  <span className="block text-[10.5px] leading-tight text-ink-500">Customer</span>
                </span>
                <IconChevron className="h-3.5 w-3.5 text-ink-400" />
              </button>

              {menuOpen && (
                <div className="card absolute right-0 top-full z-40 mt-2 w-64 p-1.5 shadow-lift" role="menu">
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink-900" data-no-i18n>{user.fullName}</p>
                    <p className="truncate text-xs text-ink-500" data-no-i18n>{user.email}</p>
                    {user.company && <span className="badge-brand mt-2" data-no-i18n>{user.company}</span>}
                  </div>
                  <div className="border-b border-ink-100 px-3 py-2.5">
                    <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-500"><IconGlobe className="h-4 w-4" /> Language</p>
                    <LanguageSwitch />
                  </div>
                  <Link to="/my/profile" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <IconUsers className="h-4 w-4 text-ink-400" /> Profile &amp; password
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
        </header>

        <main className="admin-main mx-auto max-w-[100rem] p-4 sm:p-6">
          <Outlet context={ctx} />
        </main>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={async () => {
          setSigningOut(true);
          // Leave first: once the session is gone this frame would bounce to
          // the sign-in screen instead of the home page.
          navigate('/', { replace: true });
          await signOut();
        }}
        title="Sign out?"
        body={<p>Are you sure you want to sign out of your account?</p>}
        confirmLabel="Yes, sign out"
        cancelLabel="No"
        danger
        busy={signingOut}
      />
    </div>
  );
}
