import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useCustomerAuth } from '../lib/customerAuth';
import { ConfirmDialog } from '../components/ui';
import {
  IconPlus, IconRoad, IconPin, IconUsers, IconClose, IconChevron,
  IconPhone, IconLogout, IconKey, IconSettings, IconMail,
} from '../components/icons';
import { COMPANY } from '../site/siteData';
import { RouteTransition } from '../mobile/RouteTransition';

type IconCmp = (p: any) => JSX.Element;
interface Tab { to: string; label: string; Icon: IconCmp; end?: boolean }

/**
 * Four tabs, in the order a customer actually needs them.
 *
 * Book first because that is why the app is on the phone at all; the rest are
 * what happens after. There is no permission model here — a customer is a
 * customer — so unlike the staff app nothing is hidden from anybody.
 */
const TABS: Tab[] = [
  { to: '/book', label: 'Book', Icon: IconPlus },
  { to: '/trips', label: 'My Trips', Icon: IconRoad },
  { to: '/track', label: 'Track', Icon: IconPin },
  { to: '/profile', label: 'Profile', Icon: IconUsers, end: true },
];

/** The tabs plus the menu destinations: all peers, none a step deeper. */
const SECTION_ROOTS = [...TABS.map((t) => t.to), '/account', '/notifications', '/server', '/vehicles'];

const TITLES: Record<string, string> = {
  '/book': 'Book a trip',
  '/trips': 'My trips',
  '/track': 'Track a trip',
  '/profile': 'Profile',
  '/account': 'Sign in',
  '/notifications': 'Notifications',
  '/vehicles': 'Vehicles',
  '/server': 'Portal address',
};

function titleFor(pathname: string): string {
  const hit = Object.keys(TITLES)
    .filter((p) => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? TITLES[hit] : COMPANY.name;
}

// ---------------------------------------------------------------------------
function MenuSheet({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useCustomerAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50">
      <div className="app-backdrop absolute inset-0 bg-ink-950/60" onClick={onClose} />
      <div className="app-sheet absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white">
        <div className="flex items-center gap-3 border-b border-ink-100 px-4 py-3">
          {user ? (
            <>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
                {user.fullName?.charAt(0).toUpperCase() ?? '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink-900">{user.fullName}</span>
                <span className="block truncate text-xs text-ink-500">{user.email}</span>
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-900">Not signed in</span>
              <span className="block text-xs text-ink-500">Sign in to see your trips</span>
            </span>
          )}
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <div className="p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {/* The office is one tap away from every screen. For a travel
              customer the phone is still the fastest way to change a booking,
              and hiding it behind a form would be pretending otherwise. */}
          <a href={`tel:+91${COMPANY.mobile}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-800 active:bg-ink-50">
            <IconPhone className="h-4 w-4 text-brand-600" /> Call the office
          </a>
          <Link to="/notifications" onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-700 active:bg-ink-50">
            <IconMail className="h-4 w-4 text-ink-400" /> Notifications
          </Link>
          <Link to="/server" onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-700 active:bg-ink-50">
            <IconSettings className="h-4 w-4 text-ink-400" /> Portal address
          </Link>

          {user ? (
            <button onClick={() => setConfirmOut(true)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-danger-600 active:bg-danger-50">
              <IconLogout className="h-4 w-4" /> Sign out
            </button>
          ) : (
            <Link to="/account" onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-700 active:bg-brand-50">
              <IconKey className="h-4 w-4" /> Sign in
            </Link>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={async () => { setBusy(true); await signOut(); setBusy(false); onClose(); }}
        title="Sign out?"
        body={<p>You can sign back in any time. Your trips stay on your account.</p>}
        confirmLabel="Yes, sign out"
        cancelLabel="No"
        danger
        busy={busy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function CustomerShell() {
  const { user } = useCustomerAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="app-header sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="flex h-14 items-center gap-2 px-3">
          <img src="/app-icon.svg" alt="" className="h-8 w-auto shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[15px] font-bold leading-tight text-ink-900">
              {titleFor(pathname)}
            </span>
            <span className="block truncate text-[10px] font-medium uppercase tracking-wider text-brand-600">
              {COMPANY.name}
            </span>
          </span>
          <button
            onClick={() => setMenuOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-2 active:bg-ink-100"
            aria-label="Menu"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-bold text-white">
              {user?.fullName?.charAt(0).toUpperCase() ?? '?'}
            </span>
            <IconChevron className="h-3.5 w-3.5 text-ink-400" />
          </button>
        </div>
      </header>

      <main className="app-main flex-1 p-3 pb-24">
        <RouteTransition tabRoots={SECTION_ROOTS}>
          <Outlet />
        </RouteTransition>
      </main>

      <nav className="app-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur">
        <div className="flex items-stretch">
          {TABS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors ${
                  isActive ? 'text-brand-600' : 'text-ink-500'
                }`
              }
            >
              <Icon className="h-[22px] w-[22px]" />
              <span className="truncate px-0.5">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {menuOpen && <MenuSheet onClose={() => setMenuOpen(false)} />}
    </div>
  );
}
