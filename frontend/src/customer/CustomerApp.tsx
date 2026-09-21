import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Loading } from '../components/ui';
import { useCustomerAuth } from '../lib/customerAuth';
import { COMPANY } from '../site/siteData';
import CustomerShell from './CustomerShell';
import ServerScreen from '../mobile/ServerScreen';

/**
 * The customer app's routes.
 *
 * Same paths as the website, for the same reason the staff app uses the staff
 * paths: these screens link to each other absolutely — "My trips" opens
 * `/trips/GTT-EM-2609-0006` — and mounting them anywhere else would mean
 * rewriting every one of those links and keeping them rewritten. Only the
 * layout around them differs.
 *
 * What is deliberately NOT in here: the marketing pages. A customer who has
 * installed the app has already chosen the company, so the wedding planner, the
 * about page and the service brochures are website material.
 */
const page = (load: () => Promise<{ default: ComponentType<any> }>) => lazy(load);

const Book = page(() => import('../site/Book'));
const EnquirePage = page(() => import('../site/EnquirePage'));
const RequestSubmitted = page(() => import('../site/RequestSubmitted'));
const MyTrips = page(() => import('../site/MyTrips'));
const TripDetail = page(() => import('../site/TripDetail'));
const TrackTrip = page(() => import('../site/TrackTrip'));
const TrackLookup = page(() => import('../site/TrackLookup'));
const AccountAuth = page(() => import('../site/AccountAuth'));
const Profile = page(() => import('../site/Profile'));
const Notifications = page(() => import('../site/Notifications'));
const Vehicles = page(() => import('../site/Vehicles'));
const VehicleDetail = page(() => import('../site/VehicleDetail'));
const HelpMeChoose = page(() => import('../site/HelpMeChoose'));

/**
 * What shows while the stored session is being checked.
 *
 * Branded and still, rather than a spinner on white. This runs for a fraction
 * of a second on a warm start, but it is the first thing the customer sees
 * every time they open the app — and flashing the sign-in form at somebody who
 * IS signed in, only to replace it a moment later, is the single jarring thing
 * a gated app can do.
 */
function Splash() {
  return (
    <div className="app-login grid min-h-screen place-items-center bg-ink-900 p-6">
      <div className="text-center">
        <img src="/app-icon.svg" alt="" className="mx-auto mb-4 h-14 w-auto animate-fade-in" />
        <p className="font-display text-lg font-bold text-white">{COMPANY.name}</p>
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-brand-300">
          {COMPANY.serviceHours}
        </p>
      </div>
    </div>
  );
}

/**
 * The gate.
 *
 * The app opens on sign-in, not on the booking form. A customer's trips, their
 * invoices and their saved details are the whole reason this exists, and all of
 * them need an account — so asking once at the front is more honest than
 * letting somebody wander a half-working app until it stops them.
 *
 * Where they were headed is carried in `state.from`, which AccountAuth already
 * reads, so a deep link to a trip survives the detour through sign-in.
 */
function RequireCustomer({ children }: { children: JSX.Element }) {
  const { user, loading } = useCustomerAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!user) {
    return (
      <Navigate
        to="/account"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }
  return children;
}

function RouteFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Loading label="Loading…" variant="inline" />
    </div>
  );
}

export default function CustomerApp() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Sign-in sits OUTSIDE the shell: no tab bar, no account menu, nothing
            to tap that needs the account they have not got yet. */}
        <Route path="/account" element={<AccountAuth />} />

        {/* Reachable signed out, because a wrong portal address is a reason
            sign-in itself fails — being locked out of the fix by the thing it
            fixes is a trap. */}
        <Route path="/server" element={<ServerScreen />} />

        <Route element={<RequireCustomer><CustomerShell /></RequireCustomer>}>
          {/* booking */}
          <Route path="/book" element={<Book />} />
          <Route path="/help-me-choose" element={<HelpMeChoose />} />
          <Route path="/enquiry" element={<EnquirePage />} />
          <Route path="/enquire/:category" element={<EnquirePage />} />
          <Route path="/request/:ref" element={<RequestSubmitted />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/vehicles/:slug" element={<VehicleDetail />} />

          {/* their trips */}
          <Route path="/trips" element={<MyTrips />} />
          <Route path="/trips/:ref" element={<TripDetail />} />
          <Route path="/trips/:ref/track" element={<TrackTrip />} />
          <Route path="/track" element={<TrackLookup />} />

          {/* account */}
          <Route path="/profile" element={<Profile />} />
          <Route path="/notifications" element={<Notifications />} />
        </Route>

        {/* Anything else, including the empty path the app cold-starts on,
            lands on Book — which the gate turns into sign-in when needed. */}
        <Route path="*" element={<Navigate to="/book" replace />} />
      </Routes>
    </Suspense>
  );
}
