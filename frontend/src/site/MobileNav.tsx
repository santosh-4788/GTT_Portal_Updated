/**
 * Bottom navigation, phones only.
 *
 * Five destinations, thumb-height, with the booking action raised in the middle
 * because it is the one thing everyone came to do. Designed for the phone
 * rather than inherited from the desktop header — the desktop nav has fourteen
 * links in four groups, and none of that belongs on a 375px screen.
 */
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useCustomer } from './tripStore';
import { IconDashboard, IconMap, IconPlus, IconBookings, IconUsers } from '../components/icons';

const ITEMS = [
  { to: '/', label: 'Home', Icon: IconDashboard, end: true },
  { to: '/weekend-trips', label: 'Explore', Icon: IconMap, end: false },
  { to: '/trips', label: 'Trips', Icon: IconBookings, end: false },
  { to: '/profile', label: 'Profile', Icon: IconUsers, end: false },
];

/**
 * Screens that dock a bar of their own along the bottom edge — the tracking
 * screen's call buttons. Two stacked bars would leave a phone with 100px of
 * chrome and no page.
 */
const ownsBottomEdge = (pathname: string) =>
  /^\/trips\/[^/]+\/track$/.test(pathname);

export function MobileNav() {
  const { pathname } = useLocation();
  const { trips } = useCustomer();

  if (ownsBottomEdge(pathname)) return null;

  const active = trips.filter((t) => t.status !== 'COMPLETED' && t.status !== 'CANCELLED').length;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-100 bg-white/95 backdrop-blur-xl lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Main"
    >
      <div className="relative mx-auto flex max-w-md items-stretch justify-between px-2">
        {ITEMS.slice(0, 2).map((i) => (
          <Tab key={i.to} {...i} />
        ))}

        {/* the raised booking action */}
        <div className="relative w-16 shrink-0">
          <Link
            to="/book"
            aria-label="Plan a trip"
            className="grad-brand absolute -top-5 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full text-white shadow-lift transition-transform duration-200 active:scale-95"
          >
            <IconPlus className="h-6 w-6" />
          </Link>
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-bold text-ink-500">
            Book
          </span>
        </div>

        {ITEMS.slice(2).map((i) => (
          <Tab key={i.to} {...i} badge={i.to === '/trips' ? active : 0} />
        ))}
      </div>
    </nav>
  );
}

function Tab({
  to, label, Icon, end, badge = 0,
}: {
  to: string; label: string; Icon: (p: { className?: string }) => JSX.Element; end: boolean; badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 pb-2 pt-2.5 transition-colors duration-200 ${
          isActive ? 'text-brand-700' : 'text-ink-400'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Icon className="h-5 w-5" />
            {badge > 0 && (
              <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">
                {badge}
              </span>
            )}
          </span>
          <span className="text-[10px] font-bold">{label}</span>
          {isActive && <span className="grad-brand absolute top-0 h-0.5 w-8 rounded-full" />}
        </>
      )}
    </NavLink>
  );
}
