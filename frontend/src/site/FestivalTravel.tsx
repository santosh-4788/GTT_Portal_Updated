import { useMemo, useState } from 'react';
import { COMPANY, FLEET } from './siteData';
import { activeFestival, daysUntil, shortDate, type FestivalSpecial } from './festivals';
import { EnquiryButton, WhatsAppButton } from './EnquirySheet';
import { IconWhatsApp, IconSeat } from './SiteIcons';
import { Reveal } from '../components/Reveal';
import { VehiclePhoto } from '../components/VehiclePhoto';
import { IconArrowRight, IconCheck, IconPin } from '../components/icons';

/* ==========================================================================
   Festival travel — the seasonal card on the home page.
   ==========================================================================
   One dark, warm card that breaks the pale rhythm of the page on purpose: it
   is the one thing on the home page that is only true for a few weeks. The
   left half sells the occasion (the four days, when to leave, what we
   promise); the right half is a small picker — destination and vehicle —
   that writes the WhatsApp message for the customer, so the office gets
   "Mumbai to Patna, Urbania 17" instead of "hi, rate?".

   Nothing renders outside the festival's window (see festivals.ts).
   ========================================================================== */

export function FestivalTravel() {
  const fest = activeFestival();
  if (!fest) return null;
  return <FestivalCard fest={fest} />;
}

function FestivalCard({ fest }: { fest: FestivalSpecial }) {
  const [dest, setDest] = useState(fest.routes.find((r) => r.to === 'Patna')?.to ?? fest.routes[0].to);
  const [slug, setSlug] = useState(fest.vehicles.find((v) => v.tag)?.slug ?? fest.vehicles[0].slug);

  const route = fest.routes.find((r) => r.to === dest)!;
  const pick = fest.vehicles.find((v) => v.slug === slug)!;
  const vehicle = FLEET.find((v) => v.slug === slug);

  const toStart = daysUntil(fest.days[0].date);
  const countdown = toStart > 1 ? `${toStart} days to go` : toStart === 1 ? 'Starts tomorrow' : 'On now';

  const message = useMemo(() => [
    `Hello ${COMPANY.name}, I want to book a ${fest.name} trip.`,
    `From: Mumbai`,
    `To: ${route.to}, ${route.state}`,
    `Vehicle: ${vehicle?.name ?? ''}`,
    `Travellers: `,
    `Leaving on: `,
    `Please share your best ${fest.name} fare.`,
  ].join('\n'), [fest.name, route, vehicle]);

  const prefill = {
    message,
    pickup: 'Mumbai',
    drop: `${route.to}, ${route.state}`,
    vehicleType: vehicle?.name,
  };

  return (
    <section className="pt-16 sm:pt-20" aria-labelledby={`fest-${fest.key}`}>
      <div className="shell">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#0B2C45] via-[#123A5A] to-[#3B1F3A] text-white shadow-lift">
            <SunsetArt />
            {/* The festival's own name, very large and very faint, for the people it is for. */}
            <span aria-hidden="true"
              className="pointer-events-none absolute -bottom-5 left-4 select-none font-display text-[5.5rem] font-extrabold leading-none text-white/[0.05] sm:text-[8rem] lg:text-[10rem]">
              {fest.nameHi}
            </span>

            <div className="relative grid gap-8 p-5 sm:p-8 lg:grid-cols-[1.08fr,1fr] lg:gap-10 lg:p-12">
              {/* --------------------------- the occasion --------------------------- */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-[#F59E0B] to-[#F97316] px-3.5 py-1.5 text-2xs font-bold uppercase tracking-[0.14em] text-white shadow-lg shadow-orange-500/30">
                    <span aria-hidden="true">☀️</span> Festival special
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-amber-200 ring-1 ring-white/15">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-70" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-300" />
                    </span>
                    {countdown}
                  </span>
                </div>

                <p className="mt-5 font-display text-sm font-semibold text-amber-200/90">
                  {fest.name} {fest.year} · {shortDate(fest.days[0].date)} – {shortDate(fest.days[fest.days.length - 1].date)}
                </p>
                <h2 id={`fest-${fest.key}`}
                  className="mt-2 max-w-[22ch] font-display !text-white text-[1.75rem] font-bold leading-[1.12] tracking-[-0.025em] sm:text-[2.2rem] lg:text-[2.5rem]">
                  {fest.headline}
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-[1.75] text-white/75 sm:text-md">{fest.pitch}</p>

                {/* The four days */}
                <ol className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {fest.days.map((d, i) => {
                    const main = i === 2;
                    return (
                      <li key={d.date}
                        className={`rounded-2xl px-3.5 py-3 ring-1 ${main
                          ? 'bg-gradient-to-br from-amber-400/25 to-orange-500/20 ring-amber-300/40'
                          : 'bg-white/[0.06] ring-white/10'}`}>
                        <p className="text-2xs font-bold uppercase tracking-[0.12em] text-white/50">
                          Day {i + 1} · {shortDate(d.date, 'weekday')}
                        </p>
                        <p className="mt-1 font-display text-lg font-bold leading-none">{shortDate(d.date)}</p>
                        <p className={`mt-2 text-xs font-bold ${main ? 'text-amber-200' : 'text-white'}`}>{d.name}</p>
                        <p className="mt-0.5 text-2xs leading-snug text-white/55">{d.note}</p>
                      </li>
                    );
                  })}
                </ol>

                {/* When to travel */}
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-400/15 text-lg" aria-hidden="true">🚐</span>
                    <span>
                      <span className="block text-2xs font-bold uppercase tracking-[0.12em] text-white/50">Leave Mumbai by</span>
                      <span className="block text-sm font-semibold">{shortDate(fest.leaveBy, 'weekday')}, {shortDate(fest.leaveBy)} — reach for Nahay Khay</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-3 ring-1 ring-white/10">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-400/15 text-lg" aria-hidden="true">🏠</span>
                    <span>
                      <span className="block text-2xs font-bold uppercase tracking-[0.12em] text-white/50">Return from</span>
                      <span className="block text-sm font-semibold">{shortDate(fest.returnFrom, 'weekday')}, {shortDate(fest.returnFrom)} — after Usha Arghya</span>
                    </span>
                  </div>
                </div>

                <ul className="mt-6 grid gap-x-5 gap-y-2 sm:grid-cols-2">
                  {fest.promises.map((p) => (
                    <li key={p} className="flex items-start gap-2 text-sm text-white/85">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> {p}
                    </li>
                  ))}
                </ul>
              </div>

              {/* ------------------------------ the picker ------------------------------ */}
              <div className="min-w-0 rounded-[1.5rem] bg-white p-4 text-ink-900 shadow-2xl shadow-black/30 sm:p-6">
                <p className="text-2xs font-bold uppercase tracking-[0.16em] text-brand-600">1 · Where is home?</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {fest.routes.map((r) => {
                    const on = r.to === dest;
                    return (
                      <button key={r.to} type="button" onClick={() => setDest(r.to)} aria-pressed={on}
                        className={`rounded-full px-3.5 py-2 text-xs font-semibold transition-all duration-200 ${on
                          ? 'bg-gradient-to-r from-[#F59E0B] to-[#F97316] text-white shadow-md shadow-orange-500/30'
                          : 'bg-ink-50 text-ink-700 hover:bg-amber-50 hover:text-ink-900'}`}>
                        {r.to}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
                  <IconPin className="h-3.5 w-3.5 text-orange-500" />
                  Mumbai → <span className="font-semibold text-ink-800">{route.to}, {route.state}</span>
                  <span className="text-ink-300">·</span> ≈ {route.km.toLocaleString('en-IN')} km
                  <span className="text-ink-300">·</span> {route.drive}
                </p>

                <p className="mt-6 text-2xs font-bold uppercase tracking-[0.16em] text-brand-600">2 · How many of you?</p>
                <div className="mt-3 space-y-2">
                  {fest.vehicles.map((v) => {
                    const fv = FLEET.find((x) => x.slug === v.slug);
                    if (!fv) return null;
                    const on = v.slug === slug;
                    return (
                      <button key={v.slug} type="button" onClick={() => setSlug(v.slug)} aria-pressed={on}
                        className={`group flex w-full items-center gap-3 rounded-2xl p-2 pr-3 text-left transition-all duration-200 ${on
                          ? 'bg-amber-50 ring-2 ring-orange-400'
                          : 'bg-ink-50/60 ring-1 ring-transparent hover:bg-ink-50 hover:ring-ink-100'}`}>
                        <span className="grad-warm block h-12 w-[4.5rem] shrink-0 overflow-hidden rounded-xl">
                          <VehiclePhoto photo={fv.photo} art={fv.art} name={fv.name}
                            alt={`${fv.name} for ${fest.name} travel from Mumbai`}
                            className="h-full w-full object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-display text-sm font-bold">{fv.name}</span>
                            {v.tag && (
                              <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">{v.tag}</span>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-ink-500">{v.fits}</span>
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-600">
                          <IconSeat className="h-4 w-4 text-brand-500" /> {fv.seats}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-6 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3">
                  <p className="text-sm font-semibold text-ink-900">
                    Best {fest.name} price for {vehicle?.name} to {route.to}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                    Up to {pick.pax} travellers. Tell us your date — we reply with a fixed festive fare, toll and state permit shown separately.
                  </p>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[1.4fr,1fr]">
                  <WhatsAppButton category="outstation" prefill={prefill}
                    className="btn h-12 w-full rounded-full bg-[#25D366] text-md font-semibold text-white shadow-lg shadow-emerald-500/25 transition-[filter] hover:brightness-[1.05]">
                    <IconWhatsApp className="h-4 w-4" /> Get my {fest.name} fare
                  </WhatsAppButton>
                  <EnquiryButton category="outstation" prefill={prefill}
                    className="btn h-12 w-full rounded-full bg-ink-900 text-md font-semibold text-white transition-colors hover:bg-ink-800">
                    Send enquiry <IconArrowRight className="h-4 w-4" />
                  </EnquiryButton>
                </div>

                <p className="mt-4 text-2xs leading-relaxed text-ink-400">
                  Pickup from {fest.pickups.join(', ')}. Distances and drive times are approximate.
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** A setting sun over water — the Sandhya Arghya — drawn behind the card. */
function SunsetArt() {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1200 700">
      <defs>
        <radialGradient id="fest-glow" cx="50%" cy="14%" r="55%">
          <stop offset="0%" stopColor="#FDBA74" stopOpacity=".45" />
          <stop offset="45%" stopColor="#F97316" stopOpacity=".12" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fest-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#F97316" />
        </linearGradient>
      </defs>
      <rect width="1200" height="700" fill="url(#fest-glow)" />
      <circle cx="600" cy="96" r="54" fill="url(#fest-sun)" opacity=".3" />
      <g stroke="#FDBA74" strokeLinecap="round" opacity=".28">
        <path d="M500 172h200" strokeWidth="3" />
        <path d="M530 190h140" strokeWidth="3" />
        <path d="M560 208h80" strokeWidth="3" />
      </g>
    </svg>
  );
}
