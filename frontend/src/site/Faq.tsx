/**
 * The full FAQ.
 *
 * Every answer the site holds — the twelve on the home page plus the thirty the
 * assistant knows — grouped into categories and searchable. Nothing here is
 * written twice: the answers come from siteData, so the FAQ page, the home page
 * and the assistant can never contradict each other.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { COMPANY, FAQS, MORE_FAQS, type Faq as FaqItem } from './siteData';
import { FAQ_GROUPS } from './catalog';
import { Chip, SearchField, SectionHead, SiteEmpty, TrustRow } from './kit';
import PageHero from './PageHero';
import { IconArrowRight, IconChevron, IconPhone } from '../components/icons';
import { IconWhatsApp } from './SiteIcons';
import { WhatsAppButton } from './EnquirySheet';
import { useSeo, faqLd } from './Seo';

const ALL: FaqItem[] = [...FAQS, ...MORE_FAQS];

/** Which group an answer belongs to, decided by its own question text. */
function groupOf(f: FaqItem): string {
  const q = f.q.toLowerCase();
  for (const g of FAQ_GROUPS) {
    if (g.match.some((m) => q.includes(m))) return g.key;
  }
  return 'booking';
}

const GROUPED: Record<string, FaqItem[]> = FAQ_GROUPS.reduce((acc, g) => {
  acc[g.key] = ALL.filter((f) => groupOf(f) === g.key);
  return acc;
}, {} as Record<string, FaqItem[]>);

export default function Faq() {
  useSeo({
    title: 'FAQs - Cab and Car Rental in Mumbai',
    path: '/faq',
    description: 'Answers on booking a cab in Mumbai: areas covered, fares, tolls and parking, waiting time, outstation trips, payment and invoices.',
    jsonLd: faqLd(FAQS),
  });
  const [group, setGroup] = useState<string>('all');
  const [term, setTerm] = useState('');

  const results = useMemo(() => {
    const t = term.trim().toLowerCase();
    let list = group === 'all' ? ALL : GROUPED[group] ?? [];
    if (t.length >= 2) {
      list = ALL.filter(
        (f) =>
          f.q.toLowerCase().includes(t) ||
          f.a.toLowerCase().includes(t) ||
          (f.keywords ?? []).some((k) => k.includes(t))
      );
    }
    return list;
  }, [group, term]);

  const searching = term.trim().length >= 2;

  return (
    <div className="page-bg pb-24">
      <PageHero
        eyebrow="Questions"
        title="Everything people ask before booking"
        sub="Forty-odd answers, grouped. If yours is not here, the number at the bottom is answered by the owner, not a call centre."
        crumbs={[{ label: 'FAQ' }]}
        compact
      />

      <section className="shell">
        <div className="mx-auto max-w-3xl">
          <SearchField value={term} onChange={setTerm} placeholder="Search the answers — toll, GST, child seat, flight delay…" />

          {!searching && (
            <div className="mt-5 flex flex-wrap gap-2">
              <Chip on={group === 'all'} onClick={() => setGroup('all')}>All ({ALL.length})</Chip>
              {FAQ_GROUPS.filter((g) => (GROUPED[g.key] ?? []).length > 0).map((g) => (
                <Chip key={g.key} on={group === g.key} onClick={() => setGroup(g.key)}>
                  {g.label} ({GROUPED[g.key].length})
                </Chip>
              ))}
            </div>
          )}

          <p className="mt-5 text-xs text-ink-500">
            {searching
              ? `${results.length} ${results.length === 1 ? 'answer' : 'answers'} matching "${term.trim()}"`
              : group === 'all'
                ? `${results.length} answers`
                : `${results.length} answers about ${FAQ_GROUPS.find((g) => g.key === group)?.label.toLowerCase()}`}
          </p>

          <div className="mt-4">
            {results.length === 0 ? (
              <SiteEmpty
                emoji="❓"
                title="Nothing matches that"
                body="Try a single word — toll, GST, luggage, cancel. Or ask us directly; the answer usually takes one message."
                action={
                  <>
                    <button onClick={() => setTerm('')} className="btn h-11 rounded-full bg-ink-900 px-6 text-md text-white hover:bg-ink-800">
                      Clear the search
                    </button>
                    <Link to="/assistant" className="btn h-11 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                      Ask the assistant
                    </Link>
                  </>
                }
              />
            ) : (
              <div className="divide-y divide-ink-100 rounded-2xl bg-white p-2 shadow-card">
                {results.map((f, i) => (
                  <details key={f.q} className="group px-4 py-1" open={searching || i === 0}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-semibold text-ink-800 transition-colors hover:text-brand-700">
                      {f.q}
                      <IconChevron className="h-4 w-4 shrink-0 text-ink-400 transition-transform duration-200 group-open:rotate-180" />
                    </summary>
                    <p className="pb-4 pr-6 text-sm leading-[1.75] text-ink-500">{f.a}</p>
                  </details>
                ))}
              </div>
            )}
          </div>

          {/* ============================== STILL STUCK ============================== */}
          <div className="grad-soft mt-12 rounded-[2rem] px-6 py-10 sm:px-10">
            <SectionHead
              eyebrow="Still stuck"
              title="Ask a person"
              sub={`${COMPANY.owner} handles the account personally — ${COMPANY.serviceHours.toLowerCase()}, no queue and no ticket number.`}
            />
            <div className="mt-7 flex flex-wrap gap-3">
              <a href={`tel:+91${COMPANY.mobile}`} aria-label="Call the office" className="btn h-12 rounded-full bg-ink-900 px-7 text-md text-white hover:bg-ink-800">
                <IconPhone className="h-4 w-4" /> Call
              </a>
              <WhatsAppButton
                className="btn h-12 rounded-full bg-[#25D366] px-6 text-md font-semibold text-white transition-[filter,transform] hover:brightness-105 active:scale-[.99]"
              >
                <IconWhatsApp className="h-4 w-4" /> WhatsApp
              </WhatsAppButton>
              <Link to="/assistant" className="btn h-12 rounded-full bg-white px-6 text-md text-ink-800 shadow-card hover:shadow-raised">
                Ask the assistant <IconArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/support" className="btn h-12 rounded-full px-5 text-md text-ink-600 hover:bg-white">
                Support centre
              </Link>
            </div>
          </div>

          <TrustRow className="mt-8" />
        </div>
      </section>
    </div>
  );
}
