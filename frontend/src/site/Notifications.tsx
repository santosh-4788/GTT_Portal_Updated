/**
 * Notifications.
 *
 * Only things that happened to a trip. There is no offers category with
 * anything in it, and that is deliberate — the fastest way to make people
 * ignore a notification centre is to fill it with discounts.
 *
 * Entries are written when you send a requirement from this device, so the list
 * is a record of your own actions rather than a feed we push at you.
 */
import { Link } from 'react-router-dom';
import { dmyTime } from '../lib/format';
import { COMPANY } from './siteData';
import { clearNotes, markAllRead, markRead, useCustomer, type Note } from './tripStore';
import { SiteEmpty, Chip } from './kit';
import { useState } from 'react';
import PageHero from './PageHero';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconBookings, IconCheck, IconPhone, IconSteering, IconWarning } from '../components/icons';
import { IconSeat } from './SiteIcons';

const CATEGORIES: Note['category'][] = ['Booking', 'Trip', 'Driver', 'Offers', 'Important'];

const ICON: Record<Note['category'], (p: { className?: string }) => JSX.Element> = {
  Booking: IconBookings,
  Trip: IconSeat,
  Driver: IconSteering,
  Offers: IconCheck,
  Important: IconWarning,
};

const TONE: Record<Note['category'], string> = {
  Booking: 'grad-soft text-brand-600',
  Trip: 'grad-mint text-ok-600',
  Driver: 'bg-ink-100 text-ink-600',
  Offers: 'grad-warm text-warn-600',
  Important: 'bg-warn-50 text-warn-600',
};

export default function Notifications() {
  const { notes } = useCustomer();
  const [filter, setFilter] = useState<Note['category'] | 'all'>('all');

  const shown = filter === 'all' ? notes : notes.filter((n) => n.category === filter);
  const unread = notes.filter((n) => !n.read).length;

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Notifications"
        title="What has happened to your trips"
        sub="Requests you have sent and anything we have noted against them, newest first."
        crumbs={[{ label: 'Notifications' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
                All{notes.length ? ` (${notes.length})` : ''}
              </Chip>
              {CATEGORIES.filter((c) => notes.some((n) => n.category === c)).map((c) => (
                <Chip key={c} on={filter === c} onClick={() => setFilter(c)}>{c}</Chip>
              ))}
            </div>

            {notes.length > 0 && (
              <div className="flex gap-2">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-xs font-bold text-brand-700 hover:text-brand-800">
                    Mark all read
                  </button>
                )}
                <button onClick={clearNotes} className="text-xs font-bold text-ink-400 hover:text-danger-600">
                  Clear
                </button>
              </div>
            )}
          </div>

          <div className="mt-6">
            {shown.length === 0 ? (
              <SiteEmpty
                emoji="🔔"
                title={notes.length === 0 ? 'Nothing to tell you yet' : `Nothing under ${filter}`}
                body={
                  notes.length === 0
                    ? 'When you send us a requirement it is noted here with its reference, so you always have a record of what you asked for and when.'
                    : 'Try another category, or clear the filter.'
                }
                action={
                  notes.length === 0 ? (
                    <Link to="/book" className="grad-brand btn h-11 rounded-full px-6 text-md font-semibold text-white hover:brightness-[1.06]">
                      Plan a trip <IconArrowRight className="h-4 w-4" />
                    </Link>
                  ) : (
                    <button onClick={() => setFilter('all')} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                      Show all
                    </button>
                  )
                }
              />
            ) : (
              <ul className="space-y-3">
                {shown.map((n, i) => {
                  const Icon = ICON[n.category];
                  return (
                    <Reveal as="li" key={n.id} delay={(i % 6) * 40}>
                      <button
                        onClick={() => markRead(n.id)}
                        className={`flex w-full items-start gap-3.5 rounded-2xl bg-white p-4 text-left shadow-card transition-shadow hover:shadow-raised ${
                          n.read ? '' : 'ring-1 ring-brand-200'
                        }`}
                      >
                        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${TONE[n.category]}`}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-ink-900">{n.title}</span>
                            {!n.read && <span className="h-2 w-2 rounded-full bg-brand-500" aria-label="Unread" />}
                          </span>
                          <span className="mt-1 block text-sm leading-relaxed text-ink-500">{n.body}</span>
                          <span className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-ink-400">
                            <span className="rounded-full bg-ink-50 px-2 py-0.5 font-semibold uppercase tracking-[0.08em]">
                              {n.category}
                            </span>
                            {dmyTime(n.at)}
                          </span>
                        </span>
                      </button>
                    </Reveal>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="tile mt-8 p-5">
            <h2 className="font-display text-sm font-bold text-ink-900">We do not send promotional notifications</h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">
              Nothing here is marketing, and there is nothing to unsubscribe from — the number you give when you book is
              used to call you about that trip. Anything urgent about a booking comes as a phone call from the
              office, not as a notification, because a notification is not something we can rely on you
              seeing at 5am.
            </p>
            <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn mt-4 h-10 rounded-full bg-ink-50 px-5 text-sm text-ink-700 hover:bg-ink-100">
              <IconPhone className="h-3.5 w-3.5" /> Call
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
