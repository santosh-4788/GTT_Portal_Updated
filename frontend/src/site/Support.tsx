/**
 * Support centre.
 *
 * Six things people actually call about. Picking one does not open a ticket
 * form — it tells you what we will need from you so the call takes one minute
 * instead of five, and then gives you the three ways to reach us.
 *
 * There is no ticket number on this site because there is no ticket system:
 * calls go to the owner. Saying that is more useful than a fake queue.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { COMPANY, whatsappLink, FAQS } from './siteData';
import { SUPPORT_TOPICS } from './catalog';
import { useCustomer } from './tripStore';
import { ChoiceCard, SectionHead, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import PageHero from './PageHero';
import { IconArrowRight, IconCheck, IconChevron, IconMail, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';

export default function Support() {
  const [params] = useSearchParams();
  const { trips } = useCustomer();
  const [topic, setTopic] = useState<string>(params.get('topic') ?? '');

  const chosen = SUPPORT_TOPICS.find((t) => t.key === topic);
  const recent = trips.filter((t) => t.status !== 'CANCELLED').slice(0, 3);

  const waMessage = chosen
    ? `Hello, I need help with: ${chosen.label}.`
    : 'Hello, I need some help with a booking.';

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Support"
        title="How can we help?"
        sub={`One number, answered by ${COMPANY.owner} and the desk, ${COMPANY.serviceHours.toLowerCase()}. No queue, no ticket number, no call-centre script.`}
        crumbs={[{ label: 'Support' }]}
        compact
      />

      <section className="shell">
        <div className="grid gap-6 lg:grid-cols-[1fr,20rem] lg:gap-8">
          <div className="min-w-0">
            {/* ------------------------------- topics ------------------------------- */}
            <div className="grid gap-3 sm:grid-cols-2">
              {SUPPORT_TOPICS.map((t) => (
                <ChoiceCard
                  key={t.key}
                  on={topic === t.key}
                  title={t.label}
                  sub={t.sub}
                  onClick={() => setTopic(topic === t.key ? '' : t.key)}
                />
              ))}
            </div>

            {/* ------------------------- what we will need ------------------------- */}
            {chosen && (
              <div className="tile mt-5 animate-fade-up p-6">
                <h2 className="font-display text-md font-bold text-ink-900">{chosen.label}</h2>
                <p className="mt-1.5 text-sm text-ink-500">
                  Have these ready and it is usually settled on the first call.
                </p>
                <ul className="mt-4 space-y-2.5">
                  {chosen.asks.map((a) => (
                    <li key={a} className="flex gap-2.5 text-sm leading-relaxed text-ink-700">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok-500" /> {a}
                    </li>
                  ))}
                </ul>

                {recent.length > 0 && (chosen.key === 'booking' || chosen.key === 'change' || chosen.key === 'cancel') && (
                  <div className="mt-5 border-t border-ink-100 pt-4">
                    <p className="text-2xs font-bold uppercase tracking-[0.12em] text-ink-400">Your recent references</p>
                    <ul className="mt-2.5 space-y-2">
                      {recent.map((t) => (
                        <li key={t.ref}>
                          <Link
                            to={`/trips/${t.ref}`}
                            className="flex items-center gap-3 rounded-2xl bg-ink-50/70 px-4 py-3 transition-colors hover:bg-ink-100/70"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block font-mono text-xs font-bold text-brand-700">{t.ref}</span>
                              <span className="block truncate text-sm text-ink-700">{t.route}</span>
                            </span>
                            <IconChevron className="h-4 w-4 shrink-0 -rotate-90 text-ink-300" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2.5">
                  <a href={`tel:+91${COMPANY.mobile}`} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                    <IconPhone className="h-4 w-4" /> Call now
                  </a>
                  <a
                    href={whatsappLink(waMessage)}
                    target="_blank" rel="noreferrer"
                    className="btn h-11 rounded-full bg-[#25D366] px-5 text-md font-semibold text-white hover:bg-[#1FB855]"
                  >
                    <IconWhatsApp className="h-4 w-4" /> WhatsApp
                  </a>
                  <a href={`mailto:${COMPANY.email}?subject=${encodeURIComponent(chosen.label)}`} className="btn h-11 rounded-full bg-white px-5 text-md text-ink-800 shadow-card hover:shadow-raised">
                    <IconMail className="h-4 w-4" /> Email
                  </a>
                </div>
              </div>
            )}

            {/* ------------------------------- quick FAQ ------------------------------- */}
            <div className="mt-10">
              <SectionHead
                eyebrow="Before you call"
                title="The answers people ring up for"
                action={
                  <Link to="/faq" className="btn-ghost btn-sm text-brand-700 hover:bg-white">
                    All questions <IconArrowRight className="h-3.5 w-3.5" />
                  </Link>
                }
                className="mb-6"
              />
              <div className="divide-y divide-ink-100 rounded-2xl bg-white p-2 shadow-card">
                {FAQS.slice(0, 6).map((f, i) => (
                  <details key={f.q} className="group px-4 py-1" open={i === 0}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-3.5 text-sm font-semibold text-ink-800 transition-colors hover:text-brand-700">
                      {f.q}
                      <IconChevron className="h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <p className="pb-4 pr-6 text-sm leading-[1.7] text-ink-500">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>

          {/* -------------------------------- rail -------------------------------- */}
          <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
            <div className="tile p-5">
              <h2 className="font-display text-md font-bold text-ink-900">Reach us</h2>
              <ul className="mt-4 space-y-3.5">
                <li>
                  <a href={`tel:+91${COMPANY.mobile}`} className="flex items-start gap-3">
                    <span className="grad-soft grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-brand-600">
                      <IconPhone className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink-900">Call the office</span>
                      <span className="block text-xs text-ink-500">{COMPANY.serviceHours} · ask for {COMPANY.owner}</span>
                    </span>
                  </a>
                </li>
                <li>
                  <a href={whatsappLink(waMessage)} target="_blank" rel="noreferrer" className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#25D366]/10 text-[#128C43]">
                      <IconWhatsApp className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-ink-900">WhatsApp</span>
                      <span className="block text-xs text-ink-500">Same number. Best for photos and addresses.</span>
                    </span>
                  </a>
                </li>
                <li>
                  <a href={`mailto:${COMPANY.email}`} className="flex items-start gap-3">
                    <span className="grad-soft grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-brand-600">
                      <IconMail className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block break-all text-sm font-bold text-ink-900">{COMPANY.email}</span>
                      <span className="block text-xs text-ink-500">For invoices and account paperwork.</span>
                    </span>
                  </a>
                </li>
              </ul>
            </div>

            <div className="tile p-5">
              <h2 className="font-display text-md font-bold text-ink-900">Ask the assistant</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                It answers from this website's own pages — rates, vehicles, routes, billing — and takes your number
                when it cannot.
              </p>
              <Link to="/assistant" className="btn mt-3.5 h-10 w-full rounded-full bg-ink-50 text-sm text-ink-700 hover:bg-ink-100">
                Open the assistant <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="tile p-5">
              <h2 className="font-display text-md font-bold text-ink-900">Your trips</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
                References for everything you have sent from this device.
              </p>
              <Link to="/trips" className="btn mt-3.5 h-10 w-full rounded-full bg-ink-50 text-sm text-ink-700 hover:bg-ink-100">
                My trips <IconArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <TrustRow compact />
          </aside>
        </div>
      </section>
    </div>
  );
}
