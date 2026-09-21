import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { Loading } from './components/ui';

import SiteLayout from './site/SiteLayout';
import Home from './site/Home';

/* ==========================================================================
   Code splitting.

   The site is now thirty screens plus an admin portal, and a visitor who lands
   on the home page should not download the wedding planner, the invoice
   templates screen and a charting library to see it. Everything except the
   layout and the home page is loaded on the route that needs it.

   `page()` exists so the import list below stays one line per screen.
   ========================================================================== */
const page = (load: () => Promise<{ default: ComponentType<any> }>) => lazy(load);

/* ---------- the rest of the public site ---------- */
const About = page(() => import('./site/About'));
const Services = page(() => import('./site/Services'));
const ServiceDetail = page(() => import('./site/ServiceDetail'));
const Fleet = page(() => import('./site/Fleet'));
const Packages = page(() => import('./site/Packages'));
const Contact = page(() => import('./site/Contact'));
const Policies = page(() => import('./site/Policies'));
const Login = page(() => import('./site/Login'));

/* ---------- booking and vehicles ---------- */
const Book = page(() => import('./site/Book'));
const HelpMeChoose = page(() => import('./site/HelpMeChoose'));
const Vehicles = page(() => import('./site/Vehicles'));
const VehicleDetail = page(() => import('./site/VehicleDetail'));
const CompareVehicles = page(() => import('./site/CompareVehicles'));

/* ---------- groups, corporate, events ---------- */
const GroupTravel = page(() => import('./site/GroupTravel'));
const FleetRequest = page(() => import('./site/FleetRequest'));
const Corporate = page(() => import('./site/Corporate'));
const CorporateRequest = page(() => import('./site/CorporateRequest'));
const Events = page(() => import('./site/Events'));
const EventPlanner = page(() => import('./site/EventPlanner'));
const Weddings = page(() => import('./site/Weddings'));

/* ---------- travel and discovery ---------- */
const MumbaiTours = page(() => import('./site/MumbaiTours'));
const WeekendTrips = page(() => import('./site/WeekendTrips'));
const DestinationDetail = page(() => import('./site/DestinationDetail'));
const FindATrip = page(() => import('./site/FindATrip'));
const AssistantPage = page(() => import('./site/AssistantPage'));

/* ---------- requirement, trips and account ---------- */
const EnquirePage = page(() => import('./site/EnquirePage'));
const RequestSubmitted = page(() => import('./site/RequestSubmitted'));
const MyTrips = page(() => import('./site/MyTrips'));
const AccountAuth = page(() => import('./site/AccountAuth'));
const TripDetail = page(() => import('./site/TripDetail'));
const TrackTrip = page(() => import('./site/TrackTrip'));
const TrackLookup = page(() => import('./site/TrackLookup'));
const Profile = page(() => import('./site/Profile'));
const Notifications = page(() => import('./site/Notifications'));

/* ---------- help and discovery ---------- */
const Support = page(() => import('./site/Support'));
const Faq = page(() => import('./site/Faq'));
const Reviews = page(() => import('./site/Reviews'));
const SearchPage = page(() => import('./site/SearchPage'));

/* ---------- admin portal ---------- */
const AdminLayout = page(() => import('./admin/AdminLayout'));
const Dashboard = page(() => import('./admin/Dashboard'));
const Bookings = page(() => import('./admin/Bookings'));
const Trips = page(() => import('./admin/Trips'));
const BookingForm = page(() => import('./admin/BookingForm'));
const CustomerBooking = page(() => import('./admin/CustomerBooking'));
const Master = page(() => import('./admin/Master'));
const Vendors = page(() => import('./admin/Vendors'));
const VendorForm = page(() => import('./admin/VendorForm'));
const Billing = page(() => import('./admin/Billing'));
const Invoices = page(() => import('./admin/Invoices'));
const InvoiceDetail = page(() => import('./admin/InvoiceDetail'));
const Payments = page(() => import('./admin/Payments'));
const Reports = page(() => import('./admin/Reports'));
const Settings = page(() => import('./admin/Settings'));
const Templates = page(() => import('./admin/Templates'));
const Users = page(() => import('./admin/Users'));
const AuditLog = page(() => import('./admin/AuditLog'));
const ChangePassword = page(() => import('./admin/ChangePassword'));

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center"><Loading label="Checking your session…" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && location.pathname !== '/admin/change-password') {
    return <Navigate to="/admin/change-password" replace />;
  }
  return children;
}

/**
 * What a visitor sees for the moment a screen's code is fetched.
 *
 * Deliberately not a blank page: it keeps the pale ground and shows the same
 * spinner the rest of the app uses, so a slow connection reads as loading
 * rather than broken.
 */
function RouteFallback() {
  return (
    <div className="page-bg grid min-h-[70vh] place-items-center">
      <Loading label="Loading…" variant="inline" />
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* ---------- public website ---------- */}
        <Route element={<SiteLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/services" element={<Services />} />
          <Route path="/services/:slug" element={<ServiceDetail />} />
          <Route path="/packages" element={<Packages />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/policies" element={<Policies />} />

          {/* booking and vehicles */}
          <Route path="/book" element={<Book />} />
          <Route path="/help-me-choose" element={<HelpMeChoose />} />
          <Route path="/vehicles" element={<Vehicles />} />
          <Route path="/vehicles/compare" element={<CompareVehicles />} />
          <Route path="/vehicles/:slug" element={<VehicleDetail />} />
          {/* The brochure view of the same twelve vehicles. Still linked from
              the services pages, so the route stays. */}
          <Route path="/fleet" element={<Fleet />} />

          {/* groups, corporate, events */}
          <Route path="/group-travel" element={<GroupTravel />} />
          <Route path="/fleet-request" element={<FleetRequest />} />
          <Route path="/corporate" element={<Corporate />} />
          <Route path="/corporate/request" element={<CorporateRequest />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/planner" element={<EventPlanner />} />
          <Route path="/weddings" element={<Weddings />} />

          {/* travel and discovery */}
          <Route path="/tours/mumbai" element={<MumbaiTours />} />
          <Route path="/weekend-trips" element={<WeekendTrips />} />
          <Route path="/destinations/:slug" element={<DestinationDetail />} />
          <Route path="/find-a-trip" element={<FindATrip />} />
          <Route path="/assistant" element={<AssistantPage />} />

          {/* requirement, trips and account */}
          {/* One door per bucket on "What do you need today?". /enquiry is the
              same page — it reads the kind of trip from ?tab= or ?kind=, so the
              links scattered across the site did not have to be rewritten. */}
          <Route path="/enquire/:category" element={<EnquirePage />} />
          <Route path="/enquiry" element={<EnquirePage />} />
          <Route path="/request/:ref" element={<RequestSubmitted />} />
          <Route path="/account" element={<AccountAuth />} />
          <Route path="/trips" element={<MyTrips />} />
          <Route path="/trips/:ref" element={<TripDetail />} />
          <Route path="/trips/:ref/track" element={<TrackTrip />} />
          <Route path="/track" element={<TrackLookup />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/notifications" element={<Notifications />} />

          {/* help and discovery */}
          <Route path="/support" element={<Support />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/search" element={<SearchPage />} />
        </Route>

        <Route path="/login" element={<Login />} />

        {/* ---------- admin portal ---------- */}
        <Route path="/admin" element={<Protected><AdminLayout /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="change-password" element={<ChangePassword />} />
          <Route path="trips" element={<Trips />} />
          <Route path="bookings" element={<Bookings />} />
          <Route path="bookings/new" element={<BookingForm />} />
          <Route path="bookings/:id/edit" element={<BookingForm />} />
          <Route path="customer-booking" element={<CustomerBooking />} />
          <Route path="master" element={<Master />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="vendors/new" element={<VendorForm />} />
          <Route path="vendors/:id/edit" element={<VendorForm />} />
          <Route path="billing" element={<Billing />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="payments" element={<Payments />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/templates" element={<Templates />} />
          <Route path="users" element={<Users />} />
          <Route path="audit" element={<AuditLog />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
