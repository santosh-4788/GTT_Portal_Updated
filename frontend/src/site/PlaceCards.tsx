/**
 * Destination and sightseeing cards.
 *
 * Photographs are optional and they ROTATE. A place can have one picture or
 * three, and the card cycles whatever is actually on disk — a hill station is
 * a viewpoint, a lake and a ghat road, and one frame of it undersells the
 * trip.
 *
 * HOW EXTRA PICTURES GET ADDED: by filename, not by code. `lonavala.jpg` is the
 * first, `lonavala-2.jpg` and `lonavala-3.jpg` are the rest. Drop one in and it
 * joins the rotation on the next refresh — the folder is served straight off
 * disk, so there is no rebuild and no list to keep in step.
 *
 * The extras are probed one at a time and only while the previous one loaded,
 * so a place with no photograph costs a single 404 rather than three. A place
 * with none still gets its tinted panel and initials, which is why these pages
 * looked finished before a single picture existed.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Destination, Spot } from './places';
import { TINT_CLASS, type Need } from './catalog';
import { IconArrowRight, IconCheck, IconClock, IconPin } from '../components/icons';

const TINTS = [
  'bg-gradient-to-br from-[#DDF0FD] to-[#E7ECFE]',
  'bg-gradient-to-br from-[#E2F8F0] to-[#E6F5FE]',
  'bg-gradient-to-br from-[#FFF3D6] to-[#FFE9E3]',
  'bg-gradient-to-br from-[#EFEBFE] to-[#E4EDFE]',
];

/** How long each picture holds, and how far apart neighbouring cards start. */
const HOLD_MS = 6000;
const STAGGER_MS = 1300;

/** `lonavala.jpg` -> the numbered siblings it might have. */
function siblings(photo: string, extras = 2): string[] {
  const dot = photo.lastIndexOf('.');
  const stem = dot > 0 ? photo.slice(0, dot) : photo;
  const ext = dot > 0 ? photo.slice(dot) : '.jpg';
  return Array.from({ length: extras }, (_, i) => `${stem}-${i + 2}${ext}`);
}

/**
 * Bump this whenever a photo in assets/ is replaced under the SAME filename.
 *
 * These images are probed with `new Image()` from an effect, and a script-made
 * request like that is answered from the HTTP cache even on a hard reload —
 * Ctrl+Shift+R only bypasses the cache for what the document itself asks for
 * during load. Until the API server is restarted with assets/needs on the
 * revalidating route, this folder is handed out with a seven-day cache, so a
 * replaced photo stayed invisible however hard anyone refreshed. The query
 * makes the URL new, which is the one thing a cache cannot argue with.
 */
export const ASSET_V = '15';
const versioned = (src: string) => (src.includes('?') ? src : `${src}?v=${ASSET_V}`);

/**
 * The photographs actually on disk, from /public/photos. Asked once per visit.
 * `null` when the list could not be had - then the old probing takes over.
 */
let manifest: Promise<Set<string> | null> | null = null;
const onDisk = () => {
  if (!manifest) {
    manifest = api.get('/public/photos')
      .then(({ data }) => (data?.files ? new Set<string>(data.files) : null))
      .catch(() => null);
  }
  return manifest;
};
const bare = (src: string) => src.split('?')[0];

const load = (src: string) =>
  new Promise<boolean>((resolve) => {
    const im = new window.Image();
    im.onload = () => resolve(im.naturalWidth > 0);
    im.onerror = () => resolve(false);
    im.src = src;
  });

/**
 * Which of a name's pictures actually exist, and which one is showing.
 *
 * `null` while it is still deciding, so a caller can hold its placeholder
 * rather than flash a broken image. Shared with the service cards on the home
 * page, which want the same "drop a file in the folder" behaviour without a
 * second copy of the probing.
 */
export function usePhotoSet(photo: string, index = 0, rotate = true) {
  // siblings are worked out from the clean path, then every candidate is
  // versioned — a query string would break the `-2` / `-3` name derivation
  const wanted = useMemo(() => [photo, ...siblings(photo)].map(versioned), [photo]);
  const [found, setFound] = useState<string[] | null>(null);
  const [at, setAt] = useState(0);

  // Probe in order and stop at the first miss: a name with no photograph
  // should cost one request, not one per candidate.
  useEffect(() => {
    let alive = true;
    (async () => {
      const known = await onDisk();
      const good: string[] = [];
      for (const src of wanted) {
        // With the list, a missing file is never requested at all.
        if (known ? !known.has(bare(src)) : !(await load(src))) break;
        good.push(src);
      }
      if (alive) setFound(good);
    })();
    return () => { alive = false; };
  }, [wanted.join('|')]);

  useEffect(() => {
    if (!rotate || !found || found.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Neighbouring cards are offset, so a row of four does not flip in unison.
    let timer: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      timer = setInterval(() => setAt((i) => (i + 1) % found.length), HOLD_MS);
    }, (index % 4) * STAGGER_MS);

    return () => { clearTimeout(start); clearInterval(timer); };
  }, [found, rotate, index]);

  return { found, at };
}

export function PlacePhoto({
  photo, name, index = 0, className = '', rotate = true,
}: {
  photo: string; name: string; index?: number; className?: string;
  /** Set false to hold the first picture — for anywhere a moving image would
   *  compete with something the customer is reading. */
  rotate?: boolean;
}) {
  const { found, at } = usePhotoSet(photo, index, rotate);

  // Nothing decided yet: hold the tint rather than flash a broken image.
  if (found === null) {
    return <div className={`${TINTS[index % TINTS.length]} ${className}`} aria-hidden="true" />;
  }

  if (found.length === 0) {
    return (
      <div className={`${TINTS[index % TINTS.length]} grid place-items-center ${className}`} aria-hidden="true">
        <span className="font-display text-[2.5rem] font-extrabold tracking-tight text-white/70 drop-shadow-sm">
          {name.slice(0, 2)}
        </span>
      </div>
    );
  }

  if (found.length === 1) {
    return <img src={found[0]} alt={name} loading="lazy" className={className} />;
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {found.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={i === 0 ? name : ''}
          aria-hidden={i !== 0}
          loading="lazy"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[1200ms] ease-smooth ${
            i === at ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
}

/**
 * The picture on a service card.
 *
 * By filename, not by code: `assets/needs/<key>.jpg` — `local.jpg`,
 * `darshan.jpg` — with `-2` and `-3` siblings joining a rotation the same way
 * the destination cards work. The folder is served straight off disk, so a
 * photograph swapped in the bucket shows up on the next refresh with no
 * rebuild and no list to keep in step.
 *
 * A card with no photograph is not a gap: it keeps the tinted panel and its
 * emoji, which is what these cards were before any picture existed. That is
 * also why the photo goes in a band of its own rather than replacing the
 * emoji — both states are the same shape, so a half-filled bucket still reads
 * as one grid.
 */
export function NeedPhoto({ need, index }: { need: Need; index: number }) {
  const { found, at } = usePhotoSet(`/assets/needs/${need.key}.jpg`, index);

  // The bucket wins; the shipped default stands in until there is one.
  const shots = found && found.length > 0 ? found : need.photo ? [need.photo] : [];

  if (!found || shots.length === 0) {
    return (
      <span
        className={`${TINT_CLASS[need.tint]} relative grid aspect-[16/10] w-full place-items-center overflow-hidden`}
        aria-hidden="true"
      >
        {/* A lit disc behind the emoji. A 20px glyph adrift in a wide pale
            band read as a card still loading; this reads as a card that has
            been designed and simply has no photograph yet. */}
        <span
          className="absolute left-1/2 top-1/2 h-[8.5rem] w-[8.5rem] -translate-x-1/2 -translate-y-1/2
                     rounded-full bg-white/55 blur-2xl"
        />
        <span
          className="relative grid h-16 w-16 place-items-center rounded-[1.35rem] bg-white/70 text-3xl
                     shadow-card backdrop-blur-sm transition-transform duration-500 ease-smooth
                     group-hover:-translate-y-0.5 group-hover:scale-105"
        >
          {need.emoji}
        </span>
      </span>
    );
  }

  return (
    <span className="relative block aspect-[16/10] w-full overflow-hidden">
      {shots.map((src, i) => (
        <img
          key={src}
          src={src}
          alt={i === 0 ? need.label : ''}
          aria-hidden={i !== 0}
          loading="lazy"
          className={`absolute inset-0 h-full w-full object-cover transition-all duration-[1200ms] ease-smooth
                      group-hover:scale-[1.04] ${i === at % shots.length ? 'opacity-100' : 'opacity-0'}`}
        />
      ))}
      {/* The label sits on white below, so the foot of the picture is darkened
          just enough to keep the two from touching as one bright band. */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ink-950/15 to-transparent" />
    </span>
  );
}

/* ==========================================================================
   A weekend destination
   ========================================================================== */

export function DestinationCard({
  d, index = 0, nights,
}: {
  d: Destination; index?: number; nights?: number;
}) {
  return (
    <Link
      to={`/destinations/${d.slug}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-2xl bg-white shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-lift"
    >
      <div className="relative overflow-hidden">
        <PlacePhoto
          photo={d.photo} name={d.name} index={index}
          className="aspect-[3/2] w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.05]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-ink-950/10 to-transparent" />
        <span className="absolute left-3.5 top-3.5 rounded-full bg-white/90 px-2.5 py-1 text-2xs font-bold uppercase tracking-[0.1em] text-brand-700 backdrop-blur">
          {d.km} km · {d.hours}
        </span>
        <div className="absolute inset-x-4 bottom-3">
          <h3 className="font-display text-lg font-bold leading-tight text-white">{d.name}</h3>
          <p className="mt-0.5 text-2xs text-white/75">{d.state}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <p className="flex-1 text-sm leading-relaxed text-ink-500">{d.blurb}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.bestFor.slice(0, 2).map((b) => (
            <span key={b} className="rounded-full bg-brand-50 px-2.5 py-1 text-2xs font-semibold text-brand-700">{b}</span>
          ))}
          {typeof nights === 'number' && (
            <span className="rounded-full bg-ink-50 px-2.5 py-1 text-2xs font-semibold text-ink-600">
              {nights === 0 ? 'Day trip' : `${nights} night${nights > 1 ? 's' : ''}`}
            </span>
          )}
        </div>

        <span className="mt-3.5 inline-flex items-center gap-1 text-xs font-bold text-brand-700">
          Explore
          <IconArrowRight className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

/* ==========================================================================
   A Mumbai sightseeing stop
   ========================================================================== */

export function SpotCard({
  s, index = 0, on, onToggle,
}: {
  s: Spot; index?: number; on?: boolean; onToggle?: () => void;
}) {
  const body = (
    <>
      <div className="relative overflow-hidden">
        <PlacePhoto
          photo={s.photo} name={s.name} index={index}
          className="aspect-[4/3] w-full object-cover transition-transform duration-700 ease-smooth group-hover:scale-[1.05]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/75 via-ink-950/5 to-transparent" />
        <div className="absolute inset-x-3.5 bottom-2.5">
          <h3 className="font-display text-sm font-bold leading-tight text-white">{s.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-2xs text-white/75">
            <IconPin className="h-3 w-3" /> {s.area}
          </p>
        </div>
        {onToggle && (
          <span
            className={`absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full transition-all duration-200 ${
              on ? 'bg-brand-500 text-white' : 'bg-white/90 text-ink-400 backdrop-blur'
            }`}
          >
            <IconCheck className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="p-3.5">
        <p className="flex items-center gap-1.5 text-2xs font-semibold text-ink-500">
          <IconClock className="h-3.5 w-3.5 text-brand-500" />
          {s.minutes >= 60 ? `${(s.minutes / 60).toFixed(s.minutes % 60 ? 1 : 0)} hrs` : `${s.minutes} min`} · {s.idealFor}
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-500">{s.note}</p>
      </div>
    </>
  );

  const shell = `group flex h-full flex-col overflow-hidden rounded-2xl bg-white text-left transition-all duration-300 ${
    on ? 'shadow-raised ring-2 ring-brand-400' : 'shadow-card hover:-translate-y-1 hover:shadow-lift'
  }`;

  if (onToggle) {
    return (
      <button type="button" onClick={onToggle} aria-pressed={on} className={shell}>
        {body}
      </button>
    );
  }

  return <div className={shell}>{body}</div>;
}
