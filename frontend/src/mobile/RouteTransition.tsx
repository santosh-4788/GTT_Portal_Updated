import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import type { ReactNode } from 'react';

/**
 * Page transitions, the way a phone does them.
 *
 * THE RULE IOS ACTUALLY FOLLOWS, which is what makes it feel right and is the
 * bit most web apps miss: the direction of the movement tells you where you are
 * in the stack.
 *
 *   · Going deeper — tapping a trip, opening an invoice — the new screen comes
 *     in from the RIGHT, as though it were always there just off the edge.
 *   · Coming back the new screen comes in from the LEFT, undoing that.
 *   · Switching TABS is not movement through a stack at all. It is a sideways
 *     jump between peers, so iOS cross-fades rather than sliding — and sliding
 *     there would imply a "back" that does not exist.
 *
 * React Router reports POP for a back navigation, which is what separates the
 * first two. The third is decided by the list of tab roots each shell passes in.
 *
 * Everything animated here is transform and opacity only, so the whole thing
 * runs on the compositor and never costs a layout pass — which is what keeps it
 * smooth on a mid-range Android phone rather than merely smooth on a desktop.
 *
 * The reduced-motion rule at the foot of index.css switches all of it off for
 * anyone who has asked their phone for that.
 */
export function RouteTransition({
  children,
  tabRoots = [],
}: {
  children: ReactNode;
  /** Paths that are peers of one another, cross-faded instead of slid. */
  tabRoots?: string[];
}) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  /**
   * The path we came FROM, which is what decides whether this was a sideways
   * move or a step in the stack.
   *
   * A first attempt only asked whether the DESTINATION was a tab, and got the
   * common case backwards: closing an invoice to return to the invoice list
   * cross-faded, when that is the clearest "back" in the whole app and should
   * slide. It is lateral only when BOTH ends are tabs.
   *
   * The ref is written in an effect, so during this render it still holds the
   * previous value — which is exactly what is wanted.
   */
  const previous = useRef<string | null>(null);
  useEffect(() => { previous.current = pathname; }, [pathname]);

  const from = previous.current;
  const coldStart = from === null;
  const betweenTabs = from !== null && tabRoots.includes(from) && tabRoots.includes(pathname);

  const variant =
    coldStart || betweenTabs ? 'route-fade'
      : navigationType === 'POP' ? 'route-back'
        : 'route-forward';

  /**
   * `key` is what replays the animation: without it React reuses the same DOM
   * node across routes and a CSS animation only ever runs once, so the first
   * navigation would animate and none of the rest would.
   */
  return (
    <div key={pathname} className={variant}>
      {children}
    </div>
  );
}
