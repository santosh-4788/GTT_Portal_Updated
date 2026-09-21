# Service photographs

The nine service cards — the "What do you need today?" grid on the home page,
and the same cards on the booking page — take their picture from **this folder**,
by filename. Nothing is wired up in code.

| File               | Card              |
| ------------------ | ----------------- |
| `local.jpg`        | Local Travel      |
| `airport.jpg`      | Airport Transfer  |
| `outstation.jpg`   | Outstation        |
| `hourly-clock.jpg`       | Hourly Rental     |
| `corporate.jpg`    | Corporate Travel  |
| `event.jpg`        | Events            |
| `wedding.jpg`      | Wedding           |
| `group.jpg`        | Group Travel      |
| `darshan.jpg`      | Mumbai Darshan    |

The names come from the `key` of each entry in
`frontend/src/site/catalog.ts` (the `NEEDS` array). Add a service there and its
bucket name is whatever key you gave it.

## What each card shows until you fill the bucket

Six of the nine ship with a photograph the site already owned — a Mumbai
place where the service is about the city, the vehicle where the service is
about the vehicle. They are set as `photo:` on the entry in `catalog.ts` and are
**defaults only**: a file in this folder always wins, so dropping `local.jpg` in
here replaces Marine Drive without touching any code.

| Card              | Ships with                         |
| ----------------- | ---------------------------------- |
| Local Travel      | Marine Drive                       |
| Airport Transfer  | — nothing yet                      |
| Outstation        | Khandala                           |
| Hourly Rental     | Colaba Causeway                    |
| Corporate Travel  | Honda City, from the fleet         |
| Events            | — nothing yet                      |
| Wedding           | — nothing yet                      |
| Group Travel      | Force Urbania, from the fleet      |
| Mumbai Darshan    | Gateway of India                   |

**Airport Transfer, Events and Wedding are the three worth photographing
first.** Nothing the site owns says "the T2 departure kerb", "a conference
shuttle" or "a decorated baraat car". A stock car was tried on the airport card
and taken off again: a white sedan on a white background tells a customer less
than the words under it already do, and it made the card look like filler. They
keep their tinted panel until there is a real picture — and these three are the
ones the office is most likely to already have, from its own jobs.

Good ones would be: the CSMIA T2 forecourt or the departure kerb with a car at
it; a car or coach lined up outside a banquet hall or convention centre; a
decorated baraat car. A photograph taken on an actual job beats any stock
image here, and it removes a licence obligation rather than adding one.

Note that the Mumbai place photographs are Wikimedia images under share-alike
licences, which is why the home page carries a credit line. Replacing one with
our own photograph is what removes that obligation.

## More than one picture per card

`darshan.jpg` is the first. `darshan-2.jpg` and `darshan-3.jpg` are the rest,
and the card **cycles through them** — six seconds each, with neighbouring cards
offset so a row does not flip in unison. Drop a second file in and the rotation
starts on the next refresh.

They are probed in order and stop at the first miss, so a card with one
photograph costs one request rather than three. Numbering must not skip:
`darshan-3.jpg` on its own, with no `-2`, is never looked for.

Rotation is skipped for anyone whose system asks for reduced motion.

## If a photograph is missing

Nothing breaks, and nothing looks unfinished. The card keeps the tinted panel
and the emoji it had before any picture existed, in the same shape as a card
with a photograph — so a half-filled bucket still reads as one grid rather than
a set with holes in it.

## No rebuild needed

This folder is served straight off disk, the same way `assets/fleet` is, and
with the same no-cache-but-revalidate headers. Copy a photo in, refresh, and it
is live. Replacing a file under the same name works too.

## What makes a good one

- **16:10, about 1080 x 675.** The card crops to that shape, so anything else
  loses its edges.
- **Under about 150 KB.** These load on the home page. This does the resize,
  crop and compression in one go:

  ```
  ffmpeg -i big.jpg -vf "scale=1080:675:force_original_aspect_ratio=increase,crop=1080:675" -q:v 5 darshan.jpg
  ```

- **Something recognisably Mumbai** where the service is local: the Gateway for
  Darshan, the airport forecourt for transfers, the Expressway for outstation.
  A generic stock car photograph says nothing the card's own words do not.
- **Photographs you are allowed to use.** A customer-facing page is exactly
  where someone else's copyright gets noticed.

## Why `hourly-clock.jpg` breaks the naming rule

`hourly.jpg` had already been served once, and the API hands this folder out
with a seven-day cache until the server is restarted with the `needs` bucket
added to the revalidating route in `backend/src/server.ts`. A replacement under
the same name would have sat behind that cache for a week, so the new artwork
took a new URL and `catalog.ts` points at it. Dropping a `hourly.jpg` in here
still overrides it, exactly as for every other card.

## Every card now rotates

Each of these has three pictures - `<key>.jpg`, `<key>-2.jpg`, `<key>-3.jpg` -
and the card cycles them, six seconds each, offset from its neighbours. Three
is the maximum: the probe looks for `-2` and `-3` and stops at the first miss,
so numbering must not skip.

  local        Marine Drive, Bandra, the Bandra-Worli Sea Link
  airport      CSMIA T2, a terminal concourse, an Air India 787
  outstation   Malshej Ghat, Khandala, Igatpuri
  hourly       the same dial over three different roads
  corporate    towers, a business district, an office in BKC
  darshan      the three-in-one frame, the Gateway, Haji Ali
  event        a lit conference hall, a festival stage, Sunburn in Goa
  wedding      two mandaps and varmala garlands - no people in any
  group        the Urbania, the Volvo coach, the Traveller 12

Weekend Trips and Multiple Vehicles were taken off the grid, so `tour.jpg`
and its rotation were deleted and no `fleet.jpg` was ever needed. Both
pages are still live; they are simply reached from elsewhere now.
