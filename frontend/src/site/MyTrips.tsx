/**
 * My trips.
 *
 * Two lists behind one screen, and the page is explicit about which one you are
 * looking at:
 *
 *   SIGNED IN  — the office's own record. Live status, the allotted car and
 *                chauffeur, and the invoice for every completed trip, all keyed
 *                on the Trip ID.
 *   NOT SIGNED IN — this browser's history of what you have asked for. Real
 *                enquiries with real Trip IDs, but no status beyond "sent",
 *                because a device cannot be told one without an account.
 *
 * The bridge between them is the Trip ID and the email address: signing up with
 * the address used on an enquiry attaches those trips automatically, and a trip
 * booked over the phone can be added by its Trip ID.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dmy, inr } from '../lib/format';
import { COMPANY } from './siteData';
import { bucket, KIND_LABEL, useCustomer, type Trip, type TripStatus } from './tripStore';
import {
  Callout, CopyChip, LineSkeleton, SearchField, SegTabs, since, SiteEmpty, TrustRow, SampleTag,
} from './kit';
import {
  downloadInvoice, stageBucket, useMyTrips, SOURCE_TONE, STAGE_TONE, type ServerTrip,
} from './accountApi';
import { useCustomerAuth } from '../lib/customerAuth';
import { ClaimTripCard } from './ClaimTrip';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import {
  IconArrowRight, IconClock, IconDownload, IconInvoices, IconPhone, IconPin, IconSearch, IconUsers,
} from '../components/icons';
import { IconSeat, IconLuggage } from './SiteIcons';
import { useToast } from '../components/Toast';

type Tab = 'upcoming' | 'active' | 'completed' | 'cancelled';

const TABS: [Tab, string][] = [
  ['upcoming', 'Upcoming'],
  ['active', 'Active'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
];

/* ==========================================================================
   A trip on the account — the real record
   ========================================================================== */

function AccountTripCard({ t }: { t: ServerTrip }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const trackable = t.status === 'ASSIGNED' || t.status === 'ONTRIP';

  async function getInvoice() {
    if (busy) return;
    setBusy(true);
    try {
      await downloadInvoice(t.tripId, t.invoice?.number);
      toast.success('Invoice downloaded', `${t.invoice?.number} for ${t.tripId}.`);
    } catch {
      toast.error('That did not download', 'Please try again, or call the office and we will email it to you.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="tile flex h-full flex-col overflow-hidden transition-shadow duration-300 hover:shadow-raised">
      {/* The Trip ID leads, because it is what you quote on the phone. */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50/70 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CopyChip value={t.tripId} />
          <span className={`rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.08em] ${SOURCE_TONE[t.source] ?? 'bg-ink-100 text-ink-700'}`}>
            {t.sourceLabel.replace(' enquiry', '').replace(' booking', '')}
          </span>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${STAGE_TONE[t.status]}`}>
          {t.statusLabel}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-md font-bold leading-snug text-ink-900">
          {[t.pickup, t.drop].filter(Boolean).join('  →  ') || 'Trip'}
        </h3>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink-800">
          <IconClock className="h-4 w-4 shrink-0 text-brand-500" />
          {t.travelDate ? dmy(t.travelDate) : 'Date to be confirmed'}
          {t.journeyTime && <><span className="text-ink-300">·</span>{t.journeyTime}</>}
        </p>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-600">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Passengers</dt>
            <IconSeat className="h-3.5 w-3.5 text-ink-400" />
            <dd className="font-semibold">{t.passengers || '—'}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="sr-only">Vehicle</dt>
            <IconLuggage className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            <dd className="truncate font-semibold">
              {t.vehicleNumber
                ? `${t.vehicleType ?? 'Vehicle'} · ${t.vehicleNumber}`
                : t.vehicleType || 'Vehicle to be confirmed'}
            </dd>
          </div>
          {t.driverName && (
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">Driver</dt>
              <IconUsers className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <dd className="truncate font-semibold">{t.driverName}</dd>
            </div>
          )}
        </dl>

        {/* The invoice line only exists once the office has raised one. */}
        {t.invoice ? (
          <div className="mt-3.5 flex flex-wrap items-center gap-2 rounded-2xl bg-ok-50/70 px-3 py-2.5">
            <IconInvoices className="h-4 w-4 shrink-0 text-ok-600" />
            <span className="min-w-0 flex-1 text-xs leading-snug text-ok-700">
              <strong className="font-bold">{t.invoice.gst ? 'GST invoice' : 'Invoice'} {t.invoice.number}</strong>
              {' · '}{inr(t.invoice.total)}
            </span>
            <button
              onClick={getInvoice} disabled={busy}
              className="btn h-8 shrink-0 rounded-full bg-ok-600 px-3 text-xs font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-60"
            >
              <IconDownload className="h-3.5 w-3.5" /> {busy ? 'Fetching…' : 'PDF'}
            </button>
          </div>
        ) : t.status === 'COMPLETED' ? (
          <p className="mt-3.5 rounded-2xl bg-ink-50 px-3 py-2.5 text-xs leading-snug text-ink-500">
            Trip completed. The invoice appears here as soon as the office raises it.
          </p>
        ) : t.fare ? (
          <p className="mt-3.5 text-sm font-semibold text-ink-800">
            Agreed fare <span className="text-brand-700">{inr(t.fare)}</span>
          </p>
        ) : null}

        <p className="mt-3 text-2xs text-ink-400">Raised {since(t.createdAt)}</p>

        <div className="mt-4 flex flex-wrap gap-2 pt-1">
          <Link to={`/trips/${t.tripId}`} className="btn h-10 flex-1 rounded-full bg-ink-900 px-5 text-sm text-white transition-colors hover:bg-ink-800">
            View trip
          </Link>
          {trackable && (
            <Link to={`/trips/${t.tripId}/track`} className="btn h-10 rounded-full bg-brand-50 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              <IconPin className="h-3.5 w-3.5" /> Track
            </Link>
          )}
          <a href={`tel:+91${COMPANY.mobile}`} className="btn h-10 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100" aria-label="Call the office about this trip">
            <IconPhone className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ==========================================================================
   A trip kept on this device — no account yet
   ========================================================================== */

const LOCAL_TONE: Record<TripStatus, string> = {
  SENT: 'bg-warn-50 text-warn-700',
  CONFIRMED: 'bg-brand-50 text-brand-700',
  ASSIGNED: 'bg-brand-50 text-brand-700',
  ONTRIP: 'bg-ok-50 text-ok-700',
  COMPLETED: 'bg-ok-50 text-ok-700',
  CANCELLED: 'bg-danger-50 text-danger-700',
};

const LOCAL_LABEL: Record<TripStatus, string> = {
  SENT: 'Awaiting our call',
  CONFIRMED: 'Vehicle confirmed',
  ASSIGNED: 'Driver assigned',
  ONTRIP: 'On trip',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

function LocalTripCard({ t }: { t: Trip }) {
  const trackable = t.status === 'ASSIGNED' || t.status === 'ONTRIP';

  return (
    <article className="tile flex h-full flex-col overflow-hidden transition-shadow duration-300 hover:shadow-raised">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-ink-50/70 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CopyChip value={t.tripId ?? t.ref} />
          {t.channel && (
            <span className={`rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-[0.08em] ${
              t.channel === 'WhatsApp' ? 'bg-[#25D366]/12 text-[#128C43]' : 'bg-brand-50 text-brand-700'
            }`}>
              {t.channel}
            </span>
          )}
          {t.sample && <SampleTag />}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.08em] ${LOCAL_TONE[t.status]}`}>
          {LOCAL_LABEL[t.status]}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="text-2xs font-bold uppercase tracking-[0.12em] text-brand-600">{KIND_LABEL[t.kind]}</p>
        <h3 className="mt-1 font-display text-md font-bold leading-snug text-ink-900">
          {t.route || KIND_LABEL[t.kind]}
        </h3>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink-800">
          <IconClock className="h-4 w-4 shrink-0 text-brand-500" />
          {t.date ? dmy(t.date) : 'Date flexible'}
          {t.time && <><span className="text-ink-300">·</span>{t.time}</>}
          {t.returnDate && <><span className="text-ink-300">·</span>back {dmy(t.returnDate)}</>}
        </p>

        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-600">
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Passengers</dt>
            <IconSeat className="h-3.5 w-3.5 text-ink-400" />
            <dd className="font-semibold">{t.passengers || '—'}</dd>
          </div>
          {t.bags && (
            <div className="flex min-w-0 items-center gap-1.5">
              <dt className="sr-only">Luggage</dt>
              <IconLuggage className="h-3.5 w-3.5 shrink-0 text-ink-400" />
              <dd className="truncate font-semibold">{t.bags}</dd>
            </div>
          )}
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="sr-only">Vehicle</dt>
            <IconPin className="h-3.5 w-3.5 shrink-0 text-ink-400" />
            <dd className="truncate font-semibold">
              {t.vehicleName ? `${t.vehicleCount > 1 ? `${t.vehicleCount} × ` : ''}${t.vehicleName}` : 'Vehicle to be confirmed'}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-2xs text-ink-400">Sent {since(t.createdAt)}</p>

        <div className="mt-4 flex flex-wrap gap-2 pt-1">
          <Link to={`/trips/${t.tripId ?? t.ref}`} className="btn h-10 flex-1 rounded-full bg-ink-900 px-5 text-sm text-white transition-colors hover:bg-ink-800">
            View trip
          </Link>
          {trackable && (
            <Link to={`/trips/${t.ref}/track`} className="btn h-10 rounded-full bg-brand-50 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-100">
              <IconPin className="h-3.5 w-3.5" /> Track
            </Link>
          )}
          <a href={`tel:+91${COMPANY.mobile}`} className="btn h-10 rounded-full bg-ink-50 px-4 text-sm text-ink-700 hover:bg-ink-100" aria-label="Call support about this trip">
            <IconPhone className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ==========================================================================
   The page
   ========================================================================== */

const EMPTY: Record<Tab, { emoji: string; title: string; body: string }> = {
  upcoming: {
    emoji: '🗺️',
    title: 'No upcoming trips',
    body: 'Nothing planned yet. Tell us where you are going and the trip appears here with its Trip ID.',
  },
  active: {
    emoji: '🚗',
    title: 'No trip in progress',
    body: 'A trip moves here on the day, once the chauffeur has reported and the duty has started.',
  },
  completed: {
    emoji: '✅',
    title: 'No completed trips yet',
    body: 'Finished trips stay here with their Trip ID and their invoice, ready to download whenever you need it.',
  },
  cancelled: {
    emoji: '🗂️',
    title: 'Nothing cancelled',
    body: 'Trips called off are kept here rather than deleted, in case you want to reinstate one.',
  },
};

const text = (...parts: (string | null | undefined | number)[]) =>
  parts.filter(Boolean).join(' ').toLowerCase();

export default function MyTrips() {
  const { user, loading: authLoading } = useCustomerAuth();
  const { trips: localTrips } = useCustomer();
  const { trips: serverTrips, loading, error, reload } = useMyTrips(!!user);

  const [tab, setTab] = useState<Tab>('upcoming');
  const [term, setTerm] = useState('');
  /** Cleared once the customer picks a tab, so their choice is never overridden. */
  const [tabPicked, setTabPicked] = useState(false);

  const signedIn = !!user;

  const grouped = useMemo(() => {
    const g: Record<Tab, (ServerTrip | Trip)[]> = { upcoming: [], active: [], completed: [], cancelled: [] };
    if (signedIn) {
      for (const t of serverTrips) g[stageBucket(t)].push(t);
    } else {
      for (const t of localTrips) g[bucket(t)].push(t);
    }
    return g;
  }, [signedIn, serverTrips, localTrips]);

  // Landing on an empty "Upcoming" while three completed trips sit one tab
  // away reads as "you have no trips". Open on the first tab that has
  // something — until the customer picks one themselves.
  useEffect(() => {
    if (tabPicked) return;
    if (grouped[tab].length > 0) return;
    const firstWithTrips = TABS.map(([t]) => t).find((t) => grouped[t].length > 0);
    if (firstWithTrips) setTab(firstWithTrips);
  }, [grouped, tab, tabPicked]);

  const searching = term.trim().length > 0;
  const all: (ServerTrip | Trip)[] = signedIn ? serverTrips : localTrips;

  const hits = useMemo(() => {
    if (!searching) return [];
    const q = term.trim().toLowerCase();
    return all.filter((t) =>
      'tripId' in t && 'statusLabel' in t
        ? text(t.tripId, t.pickup, t.drop, t.vehicleType, t.vehicleNumber, t.driverName,
               t.travelDate, t.statusLabel, t.sourceLabel, t.invoice?.number).includes(q)
        : text((t as Trip).tripId, (t as Trip).ref, (t as Trip).route, (t as Trip).vehicleName,
               (t as Trip).date, KIND_LABEL[(t as Trip).kind]).includes(q)
    );
  }, [all, term, searching]);

  const list = searching ? hits : grouped[tab];
  const showSkeleton = signedIn && loading && serverTrips.length === 0;

  return (
    <div className="page-bg pb-24">
      <PageHero
        title="My trips"
        sub={signedIn
          ? 'Your Trip IDs, live status, allotted vehicle and driver, and every invoice.'
          : 'Everything you have asked us for, with the Trip ID to quote when you call.'}
        crumbs={[{ label: 'My trips' }]}
        compact
        actions={
          <Link to="/book" className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white transition-[filter] hover:brightness-[1.06]">
            Plan a trip <IconArrowRight className="h-4 w-4" />
          </Link>
        }
      />

      <section className="shell">
        {!signedIn && !authLoading && <SignInBanner count={localTrips.filter((t) => !t.sample).length} />}

        {signedIn && (
          <Callout className="mb-5">
            <strong>Signed in as {user.email}.</strong> This is our own record of your journeys — the status,
            the allotted vehicle and chauffeur, and the invoice all come straight from the office. Only trips
            linked to your account are shown here.
          </Callout>
        )}

        {error && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl bg-danger-50 px-4 py-3 text-sm text-danger-700">
            {error}
            <button onClick={reload} className="font-bold underline">Try again</button>
          </div>
        )}

        {all.length > 2 && (
          <div className="mb-5 max-w-xl">
            <SearchField
              value={term}
              onChange={setTerm}
              placeholder="Find a trip — Trip ID, destination, vehicle, invoice or date"
            />
          </div>
        )}

        {searching ? (
          <p className="mb-5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
            <span className="inline-flex items-center gap-1.5">
              <IconSearch className="h-3.5 w-3.5" />
              {hits.length} {hits.length === 1 ? 'trip' : 'trips'} matching "{term.trim()}" — across all tabs
            </span>
            <button onClick={() => setTerm('')} className="font-bold text-brand-700 hover:text-brand-800">Clear</button>
          </p>
        ) : (
          <SegTabs
            value={tab}
            onChange={(t) => { setTab(t); setTabPicked(true); }}
            options={TABS.map(([value, label]) => ({
              value,
              label: grouped[value].length ? `${label} (${grouped[value].length})` : label,
            }))}
            className="max-w-2xl"
          />
        )}

        <div className="mt-7">
          {showSkeleton ? (
            <LineSkeleton rows={3} />
          ) : list.length === 0 ? (
            searching ? (
              <SiteEmpty
                emoji="🔍"
                title="No trip matches that"
                body="Trip IDs look like GTT-EM-2609-0042. You can also search by destination, vehicle, invoice number or travel date."
                action={
                  <>
                    <button onClick={() => setTerm('')} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                      Show all trips
                    </button>
                    <a href={`tel:+91${COMPANY.mobile}`} className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                      <IconPhone className="h-4 w-4" /> Ask the office
                    </a>
                  </>
                }
              />
            ) : (
              <SiteEmpty
                {...EMPTY[tab]}
                action={
                  <>
                    <Link to="/book" className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white hover:brightness-[1.06]">
                      Plan a trip <IconArrowRight className="h-4 w-4" />
                    </Link>
                    <Link to="/help-me-choose" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                      Help me choose
                    </Link>
                  </>
                }
              />
            )
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((t, i) => (
                <Reveal key={'tripId' in t && 'statusLabel' in t ? t.tripId : (t as Trip).ref} delay={(i % 3) * 60}>
                  {'statusLabel' in t
                    ? <AccountTripCard t={t as ServerTrip} />
                    : <LocalTripCard t={t as Trip} />}
                </Reveal>
              ))}
            </div>
          )}
        </div>

        {signedIn && <ClaimTripCard onClaimed={reload} className="mt-8" />}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <TrustRow compact />
          <Link to="/support" className="text-sm font-bold text-brand-700 hover:text-brand-800">
            Need help with a trip? →
          </Link>
        </div>

        {!signedIn && (
          <p className="mt-8 max-w-2xl text-xs leading-relaxed text-ink-400">
            This list is kept in this browser. Your enquiries really were sent — each carries a Trip ID the office
            can look up — but the live status, the allotted vehicle and your invoices only appear once you sign in.
            Clearing your browser data clears this list; it does not affect the office's record. Call the
            office with a Trip ID or a travel date and they will find it.
          </p>
        )}
      </section>
    </div>
  );
}

/* ==========================================================================
   The nudge, shown once, to people with no account
   ========================================================================== */

function SignInBanner({ count }: { count: number }) {
  return (
    <div className="animate-fade-up mb-6 overflow-hidden rounded-[1.75rem] bg-nav p-6 text-white sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="min-w-0 max-w-xl">
          <p className="text-2xs font-bold uppercase tracking-[0.14em] text-brand-300">Your account</p>
          <h2 className="mt-1.5 font-display text-lg font-bold leading-snug text-white sm:text-xl">
            See the live status of every trip, and download your invoices
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/65">
            {count > 0
              ? `You have ${count} ${count === 1 ? 'enquiry' : 'enquiries'} on this device. Sign up with the same email address and ${count === 1 ? 'it moves' : 'they move'} into your account, with status, the allotted car and chauffeur, and the invoice once the trip is done.`
              : 'Create a free account to follow each trip from enquiry to invoice — vehicle, chauffeur, status and a downloadable GST invoice, all under one Trip ID.'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2.5">
          <Link
            to="/account?mode=signup"
            className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white shadow-lg shadow-brand-500/25 transition-[filter,transform] hover:brightness-[1.06] active:scale-[.99]"
          >
            Create account <IconArrowRight className="h-4 w-4" />
          </Link>
          <Link to="/account" className="btn h-11 rounded-full bg-white/10 px-5 text-md font-semibold text-white transition-colors hover:bg-white/15">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
