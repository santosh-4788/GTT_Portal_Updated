/**
 * One door from "What do you need today?".
 *
 * The nine buckets on the home page used to scatter: four went to the booking
 * bar, five went to marketing pages where the form was somewhere further down.
 * They all land here now, on the questions that kind of trip actually needs,
 * with the three ways to finish underneath — send it, send it on WhatsApp, or
 * just ring the office.
 *
 * The marketing pages are still there and still linked from the header, from
 * All services, and from the "read more" line on each of these.
 */
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EnquiryForm } from './EnquirySheet';
import { CATEGORIES, CATEGORY_KEYS, isCategoryKey } from './enquiryCategories';
import type { NeedKey } from './catalog';
import { COMPANY } from './siteData';
import { BackLink, CallButton, TrustRow } from './kit';
import { Reveal } from '../components/Reveal';
import { IconArrowRight, IconCheck } from '../components/icons';

/**
 * The booking bar and the old planner both used `?tab=` and `?kind=` to say
 * what kind of trip this was. Those links are all over the site, so rather than
 * rewriting a dozen of them the words are simply translated here.
 */
const FROM_QUERY: Record<string, NeedKey> = {
  LOCAL: 'local',
  AIRPORT: 'airport',
  OUTSTATION: 'outstation',
  HOURLY: 'hourly',
  TOUR: 'darshan',
  CORPORATE: 'corporate',
  EVENT: 'event',
  WEDDING: 'wedding',
  GROUP: 'group',
  FLEET: 'group',
};

export default function EnquirePage() {
  const { category: slug } = useParams();
  const [params] = useSearchParams();

  /*
   * Three ways in, one page:
   *   /enquire/airport            — a door from "What do you need today?"
   *   /enquiry?tab=AIRPORT        — the booking bar and the older links
   *   /enquiry                    — a plain "send us a requirement" button
   *
   * An unrecognised slug falls back to local rather than showing an error: it
   * is a typo or a stale bookmark, and the chips at the bottom of the page let
   * them switch in one tap anyway.
   */
  const fromQuery = FROM_QUERY[(params.get('tab') ?? params.get('kind') ?? '').toUpperCase()];
  const category: NeedKey = isCategoryKey(slug) ? slug : (fromQuery ?? 'local');

  const cat = CATEGORIES[category];

  /* Anything the visitor already told a previous screen comes through the URL,
     so the same trip does not get typed twice. */
  const prefill = {
    pickup: params.get('from') ?? undefined,
    drop: params.get('to') ?? undefined,
    date: params.get('date') ?? undefined,
    time: params.get('time') ?? undefined,
    vehicleType: params.get('vehicle') ?? undefined,
    passengers: params.get('pax') ? Number(params.get('pax')) : undefined,
  };

  return (
    <div className="page-bg pb-24 pt-24 sm:pt-28">
      <div className="shell">
        <div className="mx-auto max-w-3xl">
          <BackLink to="/" className="mb-4" />

          {/* ------------------------------ header ------------------------------ */}
          <Reveal>
            <p className="lead">Tell us what you need</p>
            <h1 className="mt-1 flex flex-wrap items-center gap-3 font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2.4rem]">
              <span aria-hidden="true">{cat.emoji}</span>
              {cat.title}
            </h1>
            <p className="mt-3 max-w-xl text-md leading-[1.7] text-ink-600">{cat.blurb}</p>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {/* Call sits here too, before a single field, for the visitor who
                  would always rather just ring. */}
              <CallButton
                className="btn h-11 rounded-full bg-ink-900 px-5 text-md font-semibold text-white transition-colors hover:bg-ink-800"
              />
              {cat.readMore && (
                <Link
                  to={cat.readMore.to}
                  className="btn h-11 rounded-full bg-white px-5 text-md text-ink-700 shadow-card transition-shadow hover:shadow-raised"
                >
                  {cat.readMore.label} <IconArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          </Reveal>

          {/* ------------------------------- the form --------------------------- */}
          <Reveal delay={70} className="tile mt-7 p-5 sm:p-7">
            <EnquiryForm variant="page" category={category} prefill={prefill} />
          </Reveal>

          {/* --------------------------- the other doors ------------------------ */}
          <Reveal delay={120} className="mt-9">
            <p className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-400">
              Something else?
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CATEGORY_KEYS.filter((k) => k !== category).map((k) => (
                <Link
                  key={k}
                  to={`/enquire/${k}`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-ink-700 shadow-card transition-shadow hover:shadow-raised"
                >
                  <span aria-hidden="true">{CATEGORIES[k].emoji}</span>
                  {CATEGORIES[k].label}
                </Link>
              ))}
            </div>
          </Reveal>

          <div className="mt-9 flex flex-wrap items-center justify-between gap-4">
            <TrustRow compact />
            <p className="flex items-center gap-1.5 text-xs text-ink-400">
              <IconCheck className="h-3.5 w-3.5 text-ok-500" />
              {COMPANY.serviceHours} · no charge for an enquiry
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
