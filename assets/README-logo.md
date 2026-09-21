# The logo

## What was wrong with the old one

`logo-gtt.jpg` is a **photograph of the signboard** — 907 × 913 pixels of a
physical sign, with the shop's grey wall behind it. That is why:

- it went soft and blotchy anywhere it was scaled;
- the header had to wrap it in `ring-2 ring-white` to hide its square corners
  against the site's pale ground;
- the curved "GUPTA TOURS & TRAVELS" around the rim was an unreadable smudge at
  the 38–44 px the site header actually renders it at;
- there was no transparent version, no one-colour version, and no favicon;
- and the low sports car in the middle spoke for a Dzire and nothing else
  in a fleet that runs to 49-seat coaches, weddings and corporate accounts.

**The old file is still here and nothing overwrote it.** Every reference in the
code is one search-and-replace from going back.

## What is in use now

One car, cut three ways, plus the poster. All three cuts are the same drawing
generated from the same stroke code — the difference is only how much of the
detail survives at the size each one is used.

| File | Use it for |
|---|---|
| `logo-poster.png` (1200px) · `logo-options/k-poster.svg` | **The poster.** Split G ring with the Mumbai skyline, the road, the car, the chrome GUPTA wordmark, the feature row and the tagline. Shop sign, vehicle sticker, WhatsApp Business profile, brochure cover. Works down to about 160px and no further. |
| `art-car-line-bold.svg` | **The header logo.** The drawing with every stroke thickened and the sunbursts cut to eight spokes, so it holds at the ~120px the site header gives it. Header and footer lockup, beside the wordmark. |
| `logo-car.svg` | **The square mark.** The same car in profile, fitted to a 1:1 box. For every place that needs a square and cannot take a 2.9:1 lockup: browser tab, admin sidebar, login card, About, Contact, social avatar. |
| `logo-512.png` `logo-192.png` `logo-48.png` | Raster of the mark, transparent. Social avatars, PWA install icon. |
| `favicon-32.png` `favicon-16.png` | Raster of the mark for browsers that still want PNG. |
| `art-car-line.svg` · `art-car-line.png` (1514px) · `art-car-line-800.png` | **The illustration.** The fine cut — the drawing as designed, all fifty strokes and sixteen-spoke sunbursts. Large format only: behind a panel, on the letterhead, in a WhatsApp broadcast. |

Why a pair rather than one file: the poster is a composition, and at the 44px
the site header actually uses it is an unreadable dark square.
`logo-options/_poster-scale.png` shows exactly where it gives out.

**The mark is matched to the portal, not to the poster.** The body carries the
site's own `grad-brand` (`#5AD6F7` into `#2E86F0`, the same gradient on every
primary button) and the cabin is the site's ink navy. The poster's steel and
gold stay on the poster, where a near-black ground supports them; on `#F5F8FC`
they wash out.

**The mark is not the illustration scaled down, and it could not be.** The
illustration is 2.9 times wider than it is tall and built from fifty thin
strokes. The mark renders in a *square* box at 44px in the header, 36px in the
admin sidebar, 32px on the login card and 16px in a browser tab — and below
about 40px thin strokes touch each other and the whole thing silts up. So the
mark's body is a solid filled silhouette with real wheel arches cut into its
underside, and only the swoosh stays a tapered stroke: enough to hold the
family resemblance without asking a hairline to carry the shape.
`logo-options/_mark-compare.png` has every candidate at every size that
matters, including the ones that failed.

**Why it is tilted 12 degrees.** A profile car is a 2:1 shape in a 1:1 box.
Level, it left 12px of dead space above and below in the header's 44px square
and looked weak beside a two-line wordmark. Rotated *with* the fall of the
swoosh it goes from 31 units tall to 39 in the same 64-unit box. The sign is
not obvious, and was wrong first time: rotating the other way, lifting the
nose, works against the swoosh and makes the mark shorter still — 28 units.

**Why it faces left.** Because the illustration does. A mark facing the other
way would look like a mistake next to it on the same page.

**No taxi lamp on the roof.** The business runs chauffeur-driven cars on
contract and says on its own FAQ that it does no self-drive and no metered work.
A roof lamp would say the wrong thing to a corporate account.

**Honest limit: 16px.** At favicon size this is a dark blue smudge that reads as
*something small and fast* rather than as a car. So was every other candidate,
the front-facing one it replaced included — 16px is 16px. If the browser tab
ever matters enough, the fix is a separate simplified 16px file, not a change to
this one.

## The illustration is not a logo

`art-car-line.svg` is a drawing, and it has a different job from the mark. It
is 2.9 times wider than it is tall and it is built from about fifty overlapping
tapered strokes, so:

- **Never use the FINE cut below about 220px wide.** Its strokes start
  touching and the sunbursts turn into grey discs. `logo-options/_line-car.png`
  has it at 320, 220, 150 and 96px so you can see the exact point it dies.
  Below that size use `art-car-line-bold.svg`, which exists for precisely this
  and is compared against the fine cut at header sizes in
  `logo-options/_header-fine-vs-bold.png`.
- **Neither cut is a favicon or an avatar.** A 2.9:1 drawing in a square box is
  mostly empty space. Anything that needs a square takes `logo-car.svg`.
- **Behind copy, keep it a texture.** It can go to about 20% and no further
  before it competes with the headline in front of it — 20% in the closing
  band on the home page, 11% on the vehicles page, which is a working screen.
- **A dark brand band was tried and reverted.** On `ink-950` the cyan strokes
  hold full strength and look roughly twice as bright as the pale ground
  allows, so it was a good showcase — but the owner wanted the drawing in the
  header instead, not as a section. The reverted markup is in the transcript
  if it is ever wanted back.
- **It is generated, not drawn by hand.** `scratchpad/draw-line-car.py` holds
  the centrelines and width profiles and emits BOTH cuts in one run — the fine
  one and the bold one, from one set of geometry, so they can never drift apart.
  The SVGs hold about 12 000 coordinates each and cannot usefully be
  hand-edited. Change the script and re-run it.

Why it is filled paths rather than strokes: an SVG `stroke` is one width from
end to end, and this drawing is entirely about strokes that swell in the middle
and vanish at the tips. Each one is generated as a closed outline around a
centreline instead. The script also reparameterises every curve by arc length
first — without that, the fat part of a stroke lands wherever the bezier
control points happen to bunch up rather than where it was asked for.

## Retired, but still on disk

Nothing was deleted. All of these are one search-and-replace from coming back:

| File | What it was |
|---|---|
| `logo-gtt.jpg` | The original photograph of the signboard. |
| `logo-mark.svg` `logo-icon.svg` `logo-mono.svg` `logo-lockup.svg` | The route-and-marker mark, used briefly in the header. |
| `logo-g.svg` | The split steel-and-gold G lifted from the poster, used briefly in the header. |
| `logo-cab.svg` | The front-facing cab face — body, windscreen, headlight slits, grille, intake. It held 16px better than anything since, and is the file to come back to if the profile car ever proves too fine for a browser tab. |
| `logo-options/m-*.svg` | The seven candidate marks from the round that produced `logo-car.svg`: level and tilted silhouettes, an all-strokes version and a hybrid. `_mark-compare.png` shows them all from 120px down to 16px. |
| `logo-options/*.svg` | Every direction explored: milestone, wheel, gateway, chevrons, wordmark, tile, round trip, ghat bends, and the faithful vector redraw of the old sign (`i-redraw.svg`, plus the `j*` variants). |

## Rules

- **Do not stretch either asset.** Scale both axes together.
- **Below about 90 px, use `logo-car.svg`** — never the poster. The poster is a
  composition and it collapses to a dark square.
- **Clear space around the mark:** leave at least a quarter of its width free on
  every side. At 44 px that is roughly 11 px.
- **Do not put the mark on a busy photograph.** Over an image, use the poster,
  which brings its own dark ground.
- **Do not recolour the body.** It is the site's `grad-brand`; changing it
  breaks the match with every primary button on the portal.
- **Do not hand-edit `logo-car.svg`.** It is generated by
  `scratchpad/draw-mark.py` on top of `scratchpad/strokekit.py` — the same
  geometry code that generates the illustration. Change the script, re-run it,
  then re-run `scratchpad/wire-mark.py` to re-export the rasters.

## Regenerating the PNGs

They are exported from `logo-car.svg` by `scratchpad/wire-mark.py` (Chrome
headless, transparent background). If you change the SVG, re-run it. It prints
the percentage of non-transparent pixels for each file as a check — the mark
should land around 18–28%, rising as the size falls because the strokes take up
proportionally more of a small box. **An export that comes back under
8% has silently failed**, which is exactly what happened on the first attempt at
this: the files had the right dimensions and a plausible size, and were blank.

## Where it is wired in

| Place | File | Asset |
|---|---|---|
| Site header and footer | `frontend/src/site/SiteLayout.tsx` | `art-car-line-bold.svg` |
| Browser tab, Apple touch icon | `frontend/index.html` | `logo-car.svg`, `favicon-*.png` |
| About, Contact, Login | `frontend/src/site/{About,Contact,Login}.tsx` | `logo-car.svg` |
| Admin sidebar, invoice preview | `frontend/src/admin/{AdminLayout,InvoiceDetail}.tsx` | `logo-car.svg` |
| Home page, closing band | `frontend/src/site/Home.tsx` | `art-car-line.svg` at 20% |
| Vehicles page, trip header | `frontend/src/site/Vehicles.tsx` | `art-car-line.svg` at 11% |
| Letterhead | `assets/letterhead.svg` | `art-car-line.svg` at 47mm as the logo, plus a 4.5% watermark low on the page. Sets the name in **Sora** and everything else in **Inter** — the site's own faces, embedded in the file as base64 woff2 (both SIL OFL, which permits embedding), so the sheet cannot reflow into Arial at a print shop. |

**The header width budget.** `Logo` treats its `size` prop as a HEIGHT now, not
a square side, so at 42 the lockup takes about 120px of the bar where the
square mark took 42. That fits only because the Call pill stopped printing the
whole phone number, which freed roughly 75px. Checked at 1440 and 1024 with no
clipping — but if anything is added to the right-hand cluster, this is the
first thing that will break.

Both are plain `<img>` tags rather than inline components on purpose: 32 KB of
generated path data has no business in the JS bundle when the browser can cache
it as a file. Both are `aria-hidden` with an empty `alt`, and both are hidden on
narrow viewports — at phone width the drawing sits under the copy and reads as
noise.

Assets are served twice over, and both copies need to stay in step:

- `assets/` — served at `/assets` by the backend, and used by the PDF generator.
- `frontend/public/assets/` — copied into `frontend/dist` at build time.

## Deliberately not changed: the invoice PDF

`backend/src/services/invoicePdf.ts` still points at `logo-gtt.jpg`. Vendors
have been receiving documents carrying that mark, and swapping the logo on a
tax document is the owner's call rather than a side effect of a brand refresh.
When you want it changed, it is one line — and `logo-512.png` is the file to
point it at, since the PDF layout wants raster.
