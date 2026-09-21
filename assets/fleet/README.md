# Fleet photographs

A vehicle is shown as a **photograph of our own car** where we have one, and as
a **drawing of its class** where we do not. Both fill the card identically; the
drawing is the rear three-quarter studio view with the vehicle's name on its
number plate.

Photographs currently in use:

| File                | Vehicle              |
| ------------------- | -------------------- |
| `dzire.jpg`         | Dzire                |
| `aura.jpg`          | Hyundai Aura         |
| `city.jpg`          | Honda City           |
| `ciaz.jpg`          | Ciaz                 |
| `ertiga-cab.jpg`    | Ertiga               |
| `xl6.jpg`           | XL6                  |
| `rumion.jpg`        | Toyota Rumion        |
| `crysta.jpg`        | Toyota Innova Crysta |
| `carens.jpg`        | Kia Carens           |
| `traveller-12.jpg`  | Force Traveller 12   |
| `traveller-17.jpg`  | Force Traveller 17   |
| `coach.jpg`         | Bus / coach          |

Every vehicle in the fleet now has one. To change a photograph, put the file
here **and** set its `photo` path in `frontend/src/site/siteData.ts` — an empty
`photo` there is what falls back to the drawing, so a file dropped in on its own
does nothing.

**Give a replacement a new filename.** Browsers hold on to the old picture at a
URL they have already loaded, so overwriting `dzire.jpg` with a different car
can leave people looking at the previous one for a while. Renaming the file —
and its `photo` path in siteData — makes the change land on the next refresh.
`ertiga-cab.jpg` is the odd one out for exactly this reason: `ertiga.jpg` had
already served the old stock photo.

**No rebuild is needed.** This folder is served straight off disk by the running
server, the same way the logo and letterhead are. Copy a photo in, refresh the
browser, and it is live.

## What is in here right now

Twelve photographs, one per vehicle, all supplied by the office. Nothing here is
from Wikimedia any more, so no attribution is owed and the fleet pages carry no
"Photo credits" line — `CREDITS.txt` has been deleted along with the last stock
image it covered.

**Where these came from still matters.** Several are manufacturer or
marketplace press shots rather than pictures of our own vehicles, and one
arrived with a stock library's watermark across the corner. A customer-facing
page is exactly where someone else's copyright gets noticed, so photographs of
the actual cars on the yard are worth taking when there is time — see the last
section.

The list of vehicles lives in `frontend/src/site/siteData.ts` (the `FLEET`
array). Add a vehicle there and it appears on the home page, the Fleet page and
every service page at once. That one does need a rebuild
(`cd frontend && npm run build`), because it is code.

## What makes a good photo here

- **A three-quarter view on a plain WHITE background**, so a row of cards reads
  as one set rather than a mix of angles. White matters: an image shot against a
  grey studio backdrop cannot be lifted onto white cleanly, because that
  backdrop overlaps the shading on a white car and any automatic cut chews the
  bodywork. Supply it on white and the whole problem disappears.
- **Uncluttered background.** A photo fills the top of the card edge to edge, so
  whatever is behind the vehicle is on the page too. A forecourt, a plain wall or
  open road reads well; a crowded street does not.
- **3:2, 1080 × 720.** The card crops to fill that shape, so anything not in
  those proportions loses its edges — and on a vehicle the edges are the front
  and the rear. Crop to 3:2 yourself and you decide what stays in frame instead
  of the browser deciding for you. Most phone and camera photos are already 16:9
  or 4:3, so this usually costs only a strip of sky and road.
- **Under about 150 KB each.** These load on the home page, and oversized photos
  are the quickest way to make a fast site feel slow. This does the resize, crop
  and compression in one go:

  ```
  ffmpeg -i big.jpg -vf "scale=1080:720:force_original_aspect_ratio=increase,crop=1080:720" -q:v 5 ertiga.jpg
  ```

## If a photo is missing

Nothing breaks. `frontend/src/components/VehiclePhoto.tsx` draws the vehicle
instead — both when `photo` is empty and when a file fails to load (see
`frontend/src/components/CarArt.tsx`), so a mistyped filename shows a finished
card rather than a broken image. That is also why photos can be added one at a
time.

## Use photos you are allowed to use

Prefer photographs of our own vehicles. Manufacturer press shots and stock
images pulled from an image search are usually someone else's copyright, and a
customer-facing page is exactly where that gets noticed.
