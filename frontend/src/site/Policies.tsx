/**
 * Terms and privacy, in plain language.
 *
 * WHAT THIS IS AND IS NOT
 * This page states, in ordinary words, how the business actually operates —
 * what a fare covers, what is billed on top, how changes are handled, and what
 * happens to the details a visitor types into this website. Every line of it is
 * something the site already says elsewhere, gathered in one place because a
 * footer that links "Terms" to nothing is worse than no link.
 *
 * It is deliberately NOT a drafted contract. The formal terms that bind a
 * corporate account come with the account agreement, and nobody should be
 * generating those from a website brief. Where a customer needs the binding
 * version, this page says so and points at the office.
 */
import { Link } from 'react-router-dom';
import { COMPANY, INCLUDED, CHARGED_SEPARATELY } from './siteData';
import { Callout, SectionHead, TrustRow } from './kit';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconMail, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import { useSeo } from './Seo';

const CHANGES = [
  ['Changing a booking', 'Tell us as early as you can and we will move the booking rather than cancel it wherever possible. If a change close to the reporting time does attract a charge, you are told at the time — it is never added quietly to the invoice.'],
  ['Cancelling', 'Cancelling up to 1 hour before the pickup time is free. A cancellation within 1 hour of pickup is chargeable. Call the office to cancel. A cancellation marked on this website only changes your own copy of the trip; the vehicle is released when you have spoken to us.'],
  ['If we cannot supply', 'If a vehicle becomes unavailable we tell you as soon as we know and offer the nearest class, at the rate of whichever is lower. We do not substitute quietly.'],
  ['Waiting time', 'On an airport pickup the chauffeur tracks the flight and waits for the actual landing. On other duties, waiting beyond the agreed reporting time is part of the duty rather than an extra you find out about later.'],
  ['Conduct in the vehicle', 'No smoking, and open alcohol is not permitted. The chauffeurs hold to the same rule — no tobacco, pan or gutkha on duty. Pets are usually fine in a larger vehicle with a carrier; tell us when you book.'],
  ['Damage and loss', 'Anything left in a vehicle is returned as soon as we find it — call the office with the travel date. Damage caused in the vehicle is discussed with you directly rather than charged without a conversation.'],
];

const DATA = [
  ['What we ask for', 'Your name and mobile number, so we can call you back with a rate. An email address and a company name only where you offer them, and a GSTIN only if you want it on the invoice.'],
  ['What we do with it', 'We use it to quote, to run the trip and to raise the invoice. That is all. It is not sold, not shared with anyone outside the trip, and not added to a marketing list.'],
  ['Chats with the website assistant', 'Conversations with the travel assistant are saved on our own server, with the time of each message, so our team can follow up on your request and check exactly what you were told. They are not shared with anyone outside the office.'],
  ['What stays on your device', 'My Trips, saved places, saved passengers, travel preferences and recent searches are kept in your own browser unless you sign in to an account. Clearing your browser data clears the ones kept there, and they do not follow you to another device.'],
  ['What reaches us', 'Only what you submit — a requirement you send, or a call you make. Nothing you type into a planner reaches us until you press the submit button.'],
  ['Fare estimates', 'Estimates shown on this site are worked out in your browser from our published walk-in rates. They are never stored and never binding.'],
  ['Trip records', 'Bookings, duty slips and invoices are kept by the office for as long as tax law requires. If you want a copy of what we hold about you, call and ask.'],
  ['Third parties', 'This website does not load advertising, social widgets or third-party analytics. Address suggestions come from our own list of pickup and drop points, not from a mapping service.'],
];

export default function Policies() {
  useSeo({
    title: 'Fare Policy, Cancellation and Terms',
    path: '/policies',
    description: 'What a Gupta Tours & Travels fare includes, what is charged at actuals, and how cancellations, waiting time and night charges work.',
  });
  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Terms and privacy"
        title="How we work, in plain words"
        sub="What a fare covers, what is billed on top, how changes are handled, and what happens to anything you type into this website."
        crumbs={[{ label: 'Terms & privacy' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl space-y-6">
          <Callout>
            This is a plain-language summary of how the business operates, not a drafted contract. The binding terms for
            a corporate account come with the account agreement — ask the office and they will send them before you
            sign anything.
          </Callout>

          {/* ================================ TERMS ================================ */}
          <div id="terms" className="scroll-mt-24">
            <SectionHead
              eyebrow="Terms"
              title="What you are agreeing to when you book"
              sub="Nothing on this website charges you. A booking exists once you have the rate from us and have said yes to it."
              className="mb-8"
            />

            <div className="tile p-6 sm:p-8">
              <h3 className="font-display text-md font-bold text-ink-900">Included in the quoted fare</h3>
              <ul className="mt-4 space-y-2.5">
                {INCLUDED.map((i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-600">
                    <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {i}
                  </li>
                ))}
              </ul>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">Billed on top, at actuals</h3>
              <dl className="mt-4 space-y-3.5">
                {CHARGED_SEPARATELY.map(([label, note]) => (
                  <div key={label}>
                    <dt className="text-sm font-semibold text-ink-800">{label}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ink-500">{note}</dd>
                  </div>
                ))}
              </dl>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">Estimates, quotes and confirmed rates</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                The three are different and this site keeps them apart. An <strong>estimate</strong> is what the website
                works out from our published rates — indicative, never binding. A <strong>quote</strong> is what the
                office gives you for your requirement, in writing or on the phone. A <strong>confirmed rate</strong> is
                a quote you have accepted, and it is what appears on the invoice. Nothing is charged before that point.
              </p>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">Payment and invoicing</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Corporate accounts are invoiced on an agreed cycle — per trip, fortnightly or monthly — with payment
                terms set when the account opens. For a one-off booking the amount is confirmed before the trip and
                settled on completion. Every invoice is GST-compliant and carries our GST registration number.
              </p>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">Changes, cancellation and conduct</h3>
              <dl className="mt-4 space-y-4">
                {CHANGES.map(([label, note]) => (
                  <div key={label}>
                    <dt className="text-sm font-semibold text-ink-800">{label}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-ink-500">{note}</dd>
                  </div>
                ))}
              </dl>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">Vehicles and chauffeurs</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                You book a class of vehicle, not a specific registration — the car that is cleanest and serviced on the
                day is the one that goes out. Every vehicle runs on a commercial permit with valid insurance and
                fitness. All our vehicles are chauffeur-driven; we do not rent self-drive cars. Photographs on this site
                show representative examples of each model rather than the specific vehicle assigned to a booking.
              </p>

              <h3 className="mt-7 font-display text-md font-bold text-ink-900">What we do not arrange</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-600">
                Air and rail tickets, visas and foreign exchange. Hotels, guides, photography, meals and activities can
                be arranged alongside a trip, but they are quoted and billed separately by the provider — the estimate
                for a vehicle never includes them.
              </p>
            </div>
          </div>

          {/* =============================== PRIVACY =============================== */}
          <div id="privacy" className="scroll-mt-24 pt-6">
            <SectionHead
              eyebrow="Privacy"
              title="What happens to your details"
              sub="Short version: we ask for a name and a number so we can call you back, and that is what we use them for."
              className="mb-8"
            />

            <div className="tile p-6 sm:p-8">
              <dl className="space-y-5">
                {DATA.map(([label, note]) => (
                  <div key={label}>
                    <dt className="text-sm font-bold text-ink-900">{label}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-ink-500">{note}</dd>
                  </div>
                ))}
              </dl>

              <Callout className="mt-6">
                To have anything we hold corrected or removed, call the office or email{' '}
                <a href={`mailto:${COMPANY.email}`} className="font-semibold underline">{COMPANY.email}</a> with the
                travel date. {COMPANY.owner} handles this personally.
              </Callout>
            </div>
          </div>

          {/* ================================ ASK US ================================ */}
          <div className="grad-soft rounded-[2rem] px-6 py-10 sm:px-10">
            <h2 className="font-display text-[1.6rem] font-extrabold leading-tight tracking-[-0.02em] text-ink-900">
              Something here not clear?
            </h2>
            <p className="mt-3 max-w-xl text-md leading-[1.7] text-ink-600">
              Ask before you book rather than after. {COMPANY.owner} answers the phone himself.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-ink-900 px-7 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <WhatsAppButton
                message="Hello, I have a question about your terms."
                className="btn h-12 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
              >
                <IconWhatsApp className="h-4 w-4" /> WhatsApp
              </WhatsAppButton>
              <a href={`mailto:${COMPANY.email}`} className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                <IconMail className="h-4 w-4" /> Email
              </a>
              <Link to="/faq" className="btn h-12 rounded-full px-5 text-md text-ink-600 hover:bg-white">
                FAQ <IconArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <TrustRow />
        </div>
      </section>
    </div>
  );
}
