import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Loading } from '../components/ui';
import MobileShell from './MobileShell';
import MobileLogin from './MobileLogin';
import ServerScreen from './ServerScreen';
import { isAppRole } from './roles';

/**
 * The app's routes.
 *
 * These are the SAME paths the website uses for the admin portal, and that is
 * deliberate. Twenty-one admin screens link to each other with absolute paths
 * like `/admin/invoices/12`; mounting them anywhere else would mean rewriting
 * every one of those links and keeping them rewritten. Only the layout around
 * them differs — MobileShell instead of AdminLayout — so the screens themselves
 * are shared with the website, untouched.
 *
 * The public marketing site is not part of this bundle. Staff do not need the
 * wedding planner on their phone, and leaving it out keeps the APK small.
 */
const page = (load: () => Promise<{ default: ComponentType<any> }>) => lazy(load);

const Dashboard = page(() => import('../admin/Dashboard'));
const Trips = page(() => import('../admin/Trips'));
const Feedback = page(() => import('../admin/Feedback'));
const ChatbotKnowledge = page(() => import('../admin/ChatbotKnowledge'));
const Bookings = page(() => import('../admin/Bookings'));
const BookingForm = page(() => import('../admin/BookingForm'));
const CustomerBooking = page(() => import('../admin/CustomerBooking'));
const Master = page(() => import('../admin/Master'));
const Vendors = page(() => import('../admin/Vendors'));
const VendorForm = page(() => import('../admin/VendorForm'));
const Billing = page(() => import('../admin/Billing'));
const Invoices = page(() => import('../admin/Invoices'));
const InvoiceDetail = page(() => import('../admin/InvoiceDetail'));
const Payments = page(() => import('../admin/Payments'));
const Reports = page(() => import('../admin/Reports'));
const Settings = page(() => import('../admin/Settings'));
const Templates = page(() => import('../admin/Templates'));
const Users = page(() => import('../admin/Users'));
const AuditLog = page(() => import('../admin/AuditLog'));
const ChangePassword = page(() => import('../admin/ChangePassword'));

/**
 * A session that is missing, expired, or belongs to a role this app does not
 * serve all end up back at sign-in. The role check repeats the one on the login
 * screen because a session restored from storage never passes through it.
 */
function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-ink-50">
        <Loading label="Checking your session…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAppRole(user.roleCode)) return <Navigate to="/login" replace />;
  if (user.mustChangePassword && pathname !== '/admin/change-password') {
    return <Navigate to="/admin/change-password" replace />;
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

export default function MobileApp() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<MobileLogin />} />

        <Route path="/admin" element={<Protected><MobileShell /></Protected>}>
          <Route index element={<Dashboard />} />
          <Route path="change-password" element={<ChangePassword />} />
          {/* Reachable even when the rest of the app cannot load, because a
              wrong address here is the reason the rest cannot load. */}
          <Route path="server" element={<ServerScreen />} />
          <Route path="trips" element={<Trips />} />
          <Route path="feedback" element={<Feedback />} />
          <Route path="chatbot" element={<ChatbotKnowledge />} />
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

        {/* The public website's routes do not exist in this bundle; anything
            else lands on the portal, which sends signed-out users to login. */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  );
}
