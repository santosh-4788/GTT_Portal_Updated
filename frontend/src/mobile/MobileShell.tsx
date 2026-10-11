import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ConfirmDialog } from '../components/ui';
import {
  IconDashboard, IconBookings, IconVendors, IconBilling, IconInvoices,
  IconPayments, IconReports, IconSettings, IconUsers, IconAudit,
  IconTemplates, IconRoad, IconLogout, IconKey, IconMenu, IconClose, IconChevron,
  IconEvent, IconCar, IconLayers, IconGlobe,
} from '../components/icons';
import { COMPANY } from '../site/siteData';
import { LanguageProvider, LanguageSwitch } from '../lib/i18n';
import { RouteTransition } from './RouteTransition';

type IconCmp = (p: any) => JSX.Element;
interface Item { to: string; label: string; short?: string; Icon: IconCmp; perms?: string[]; end?: boolean }

/**
 * Every screen the app can reach, in the order the "More" sheet lists them.
 *
 * Permissions are the same codes the website's sidebar uses, so a Billing user
 * loses Settings, Users and the Audit Log here for exactly the reason they lose
 * them there — the role simply does not hold those permissions. Nothing about
 * access lives in this file; it only decides what is worth a bottom tab.
 */
const ALL: Item[] = [
  { to: '/admin', label: 'Dashboard', Icon: IconDashboard, perms: ['dashboard.view'], end: true },
  { to: '/admin/trips', label: 'Trips', Icon: IconRoad, perms: ['bookings.view'] },
  { to: '/admin/bookings', label: 'Bookings', Icon: IconBookings, perms: ['bookings.view'] },
  // Counter booking. The route has always existed in this bundle; without a
  // menu entry there was simply no way to open it from the phone.
  { to: '/admin/bookings/new?source=WALKIN', label: 'New booking', short: 'Book', Icon: IconUsers, perms: ['bookings.create'] },
  { to: '/admin/events', label: 'Events', Icon: IconEvent, perms: ['events.view'] },
  { to: '/admin/fleet', label: 'Fleet', Icon: IconCar, perms: ['fleet.view', 'settings.view'] },
  { to: '/admin/feedback', label: 'Feedback', Icon: IconReports, perms: ['bookings.view'] },
  { to: '/admin/chatbot', label: 'Chatbot Knowledge', short: 'Chatbot', Icon: IconTemplates, perms: ['settings.view'] },
  { to: '/admin/billing', label: 'Billing', Icon: IconBilling, perms: ['billing.view'] },
  { to: '/admin/invoices', label: 'Invoices', Icon: IconInvoices, perms: ['invoices.view'] },
  { to: '/admin/payments', label: 'Payments & Ledger', short: 'Payments', Icon: IconPayments, perms: ['payments.view'] },
  { to: '/admin/reports', label: 'Reports', Icon: IconReports, perms: ['reports.view'] },
  { to: '/admin/vendors', label: 'Companies / Vendors', short: 'Companies', Icon: IconVendors, perms: ['vendors.view'] },
  { to: '/admin/outstation-fares', label: 'Outstation Fares', short: 'Fares', Icon: IconRoad, perms: ['vendors.view', 'masters.view'] },
  { to: '/admin/masters', label: 'Masters', Icon: IconLayers, perms: ['masters.view', 'vendors.view'] },
  { to: '/admin/settings', label: 'Settings', Icon: IconSettings, perms: ['settings.view'] },
  { to: '/admin/users', label: 'Users', Icon: IconUsers, perms: ['users.view'] },
  { to: '/admin/audit', label: 'Audit Log', Icon: IconAudit, perms: ['audit.view'] },
];

/** Section roots — peers of one another, never a step deeper. */
const SECTION_ROOTS = ALL.map((i) => i.to);

/**
 * Which four screens get a bottom tab.
 *
 * There is room for four plus More, and the right four are not the same for
 * both jobs this app is built for. Billing staff open it to raise and chase
 * invoices, so the money screens come first. Admins open it to see what is
 * running today, so operations come first. Everything either role can reach is
 * still one tap away under More — this only sets what is zero taps away.
 */
const TAB_ORDER: Record<string, string[]> = {
  BILLING: ['/admin', '/admin/billing', '/admin/invoices', '/admin/payments'],
  DEFAULT: ['/admin', '/admin/trips', '/admin/bookings', '/admin/billing'],
};

function useVisibleItems() {
  const { can } = useAuth();
  return useMemo(() => ALL.filter((i) => !i.perms || can(...i.perms)), [can]);
}

// ---------------------------------------------------------------------------
function MoreSheet({ items, onClose }: { items: Item[]; onClose: () => void }) {
  const { user, logout } = useAuth();
  const [confirmOut, setConfirmOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <div className="fixed inset-0 z-50">
      <div className="app-backdrop absolute inset-0 bg-ink-950/60" onClick={onClose} />
      <div className="app-sheet absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white">
        <div className="sticky top-0 flex items-center gap-3 border-b border-ink-100 bg-white px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">
            {user?.fullName?.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink-900" data-no-i18n>{user?.fullName}</span>
            <span className="block truncate text-xs text-ink-500">{user?.roleName}</span>
          </span>
          <button className="btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-ink-100 px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-500"><IconGlobe className="h-4 w-4" /> Language</p>
          <LanguageSwitch />
        </div>

        <nav className="grid grid-cols-3 gap-1 p-3">
          {items.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1.5 rounded-xl px-2 py-3.5 text-center transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-700 active:bg-ink-100'
                }`
              }
            >
              <Icon className="h-6 w-6" />
              <span className="text-[11px] font-medium leading-tight">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-ink-100 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Link to="/admin/server" onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-700 active:bg-ink-50">
            <IconSettings className="h-4 w-4 text-ink-400" /> Portal address
          </Link>
          <Link to="/admin/change-password" onClick={onClose}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-700 active:bg-ink-50">
            <IconKey className="h-4 w-4 text-ink-400" /> Change password
          </Link>
          <button onClick={() => setConfirmOut(true)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-danger-600 active:bg-danger-50">
            <IconLogout className="h-4 w-4" /> Sign out
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        onConfirm={async () => { setSigningOut(true); await logout(); }}
        title="Sign out?"
        body={<p>Anything you have typed but not saved will be lost.</p>}
        confirmLabel="Yes, sign out"
        cancelLabel="No"
        danger
        busy={signingOut}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
export default function MobileShell() {
  return (
    <LanguageProvider>
      <Shell />
    </LanguageProvider>
  );
}

function Shell() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const visible = useVisibleItems();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const tabs = useMemo(() => {
    const wanted = TAB_ORDER[user?.roleCode ?? ''] ?? TAB_ORDER.DEFAULT;
    const picked = wanted.map((to) => visible.find((i) => i.to === to)).filter(Boolean) as Item[];
    // A role with an unusual permission set may not hold all four; top up from
    // whatever it can see so the bar is never half empty.
    for (const item of visible) {
      if (picked.length >= 4) break;
      if (!picked.includes(item)) picked.push(item);
    }
    return picked.slice(0, 4);
  }, [visible, user?.roleCode]);

  const current = [...visible].reverse().find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)));

  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="app-header sticky top-0 z-30 border-b border-ink-200 bg-white">
        <div className="flex h-14 items-center gap-2 px-3">
          {/* The logo is the car mark, which is roughly 3:1 — so it is sized by
              HEIGHT and left to take whatever width it needs. Forcing it into a
              square box (`h-8 w-8`) squashed it into an unreadable smudge. */}
          <img src="/app-icon.svg" alt="" className="h-8 w-auto shrink-0" />
          <span className="min-w-0 flex-1">
            {/* The business name leads, as it does on the website header. The
                screen name sits under it: the highlighted tab along the bottom
                already says where you are, so repeating it in the largest type
                on screen was spending the most valuable line on the least
                useful word. */}
            <span className="block truncate font-display text-[13.5px] font-bold leading-tight text-ink-900">
              {COMPANY.name}
            </span>
            <span className="block truncate text-[10px] font-medium uppercase tracking-wider text-brand-600">
              {current?.label ?? 'Business Portal'}
            </span>
          </span>
          <button
            onClick={() => setMoreOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg py-1.5 pl-1.5 pr-2 active:bg-ink-100"
            aria-label="Menu"
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-[13px] font-bold text-white">
              {user?.fullName?.charAt(0).toUpperCase()}
            </span>
            <IconChevron className="h-3.5 w-3.5 text-ink-400" />
          </button>
        </div>
      </header>

      <main className="app-main flex-1 p-3 pb-24">
        {/* Every section root is a peer of every other, so moving between them
            cross-fades; drilling into one of their detail screens slides. */}
        <RouteTransition tabRoots={SECTION_ROOTS}>
          <Outlet />
        </RouteTransition>
      </main>

      <nav className="app-tabbar fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 backdrop-blur">
        <div className="flex items-stretch">
          {tabs.map(({ to, label, short, Icon, end }) => (
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
              <span className="truncate px-0.5">{short ?? label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-medium ${
              moreOpen ? 'text-brand-600' : 'text-ink-500'
            }`}
          >
            <IconMenu className="h-[22px] w-[22px]" />
            <span>More</span>
          </button>
        </div>
      </nav>

      {moreOpen && <MoreSheet items={visible} onClose={() => setMoreOpen(false)} />}
    </div>
  );
}
