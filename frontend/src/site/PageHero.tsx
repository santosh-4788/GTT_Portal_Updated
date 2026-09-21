import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BackLink } from './kit';

/**
 * Inner-page header. Light like the rest of the site — soft colour washes on
 * the pale ground rather than a dark slab, and no rule beneath it.
 *
 * TWO SIZES, AND THE REASON THERE ARE TWO
 * A marketing page earns a 3rem headline; My Trips does not. A list of your own
 * bookings with a billboard on top of it pushes the thing you came for below
 * the fold and reads as an advert for itself. `compact` gives the utility
 * screens — trips, profile, notifications, support, search, FAQ, policies — a
 * title sized like a tool, and drops the eyebrow, which on those pages only
 * repeated the breadcrumb and the heading a third time.
 */
export default function PageHero({
  eyebrow,
  title,
  sub,
  crumbs = [],
  compact = false,
  back,
  onBack,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  compact?: boolean;
  /**
   * Where Back goes when the page was opened cold, with no history behind it.
   * Defaults to the last linked breadcrumb, then Home. Pass `null` to leave it
   * off entirely — only the home page should.
   */
  back?: string | null;
  /** For screens whose steps are state rather than history. See `BackLink`. */
  onBack?: () => boolean;
  actions?: ReactNode;
}) {
  const fallback =
    back === undefined ? [...crumbs].reverse().find((c) => c.to)?.to ?? '/' : back;

  return (
    <section
      className={`relative overflow-hidden ${
        compact ? 'pb-7 pt-24 sm:pb-9 sm:pt-28' : 'pb-10 pt-28 sm:pb-14 sm:pt-36'
      }`}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-40 -top-56 h-[34rem] w-[34rem] rounded-full bg-brand-200/35 blur-[120px]" />
        <div className="absolute right-[-12rem] top-[-10rem] h-[30rem] w-[30rem] rounded-full bg-[#C7D2FE]/35 blur-[120px]" />
      </div>

      <div className="shell relative">
        {/* Back sits with the breadcrumbs: one row that says where you are and
            how to get out, rather than two competing for the same space. */}
        {(fallback !== null || crumbs.length > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {fallback !== null && <BackLink to={fallback} onBack={onBack} />}

            {crumbs.length > 0 && (
              <nav className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500" aria-label="Breadcrumb">
                <Link to="/" className="hover:text-brand-700">Home</Link>
                {crumbs.map((c) => (
                  <span key={c.label} className="flex items-center gap-1.5">
                    <span className="text-ink-300">/</span>
                    {c.to
                      ? <Link to={c.to} className="hover:text-brand-700">{c.label}</Link>
                      : <span className="font-medium text-ink-700">{c.label}</span>}
                  </span>
                ))}
              </nav>
            )}
          </div>
        )}

        <div className={actions ? 'flex flex-wrap items-end justify-between gap-4' : ''}>
          <div className="min-w-0">
            {eyebrow && !compact && <p className="lead">{eyebrow}</p>}

            <h1
              className={
                compact
                  ? 'max-w-3xl font-display text-[1.6rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink-900 sm:text-[2rem]'
                  : 'max-w-3xl font-display text-[2rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink-900 sm:text-[2.6rem] lg:text-[3rem]'
              }
            >
              {title}
            </h1>

            {sub && (
              <p className={`max-w-2xl leading-[1.7] text-ink-600 ${compact ? 'mt-2 text-sm' : 'mt-4 text-md leading-[1.75]'}`}>
                {sub}
              </p>
            )}
          </div>

          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </section>
  );
}
