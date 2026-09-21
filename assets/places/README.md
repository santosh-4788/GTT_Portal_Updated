# Destination photographs

The customer site's tour and weekend-trip pages show photographs of places.
Drop them in **this folder** (`assets/places/`), using exactly these filenames —
the site looks each one up by name.

**No rebuild is needed.** This folder is served straight off disk by the running
server, the same way the logo, the letterhead and the fleet photos are. Copy a
picture in, refresh the browser, and it is live.

**Until a file is here, the card shows a considered tinted panel with the place's
initials rather than a broken image** — so the pages look finished with none of
these present, and get better one file at a time. There is no rush and no
half-broken state.

## Weekend destinations

Used by `/weekend-trips`, `/destinations/<slug>` and the home page. The
destination pages use theirs as a wide hero, so landscape crops work best —
around 1600 × 900.

| File | Place |
| ---- | ----- |
| `lonavala.jpg` | Lonavala |
| `khandala.jpg` | Khandala |
| `alibaug.jpg` | Alibaug |
| `mahabaleshwar.jpg` | Mahabaleshwar |
| `nashik.jpg` | Nashik |
| `igatpuri.jpg` | Igatpuri |
| `matheran.jpg` | Matheran |
| `shirdi.jpg` | Shirdi |
| `goa.jpg` | Goa |
| `kashid.jpg` | Kashid |
| `panchgani.jpg` | Panchgani |
| `pune.jpg` | Pune |

## Mumbai sightseeing stops

Used by `/tours/mumbai`. These are shown as 4:3 cards, so around 1200 × 900.

| File | Place |
| ---- | ----- |
| `gateway-of-india.jpg` | Gateway of India |
| `marine-drive.jpg` | Marine Drive |
| `colaba.jpg` | Colaba Causeway |
| `bandra.jpg` | Bandra & Bandstand |
| `juhu.jpg` | Juhu Beach |
| `siddhivinayak.jpg` | Siddhivinayak Temple |
| `haji-ali.jpg` | Haji Ali Dargah |
| `film-city.jpg` | Film City |
| `elephanta.jpg` | Elephanta Caves |
| `dhobi-ghat.jpg` | Dhobi Ghat |
| `sanjay-gandhi.jpg` | Sanjay Gandhi National Park |
| `cst.jpg` | CSMT & Fort |

## Adding a new destination

The filenames above are the `photo:` field of each entry in
`frontend/src/site/places.ts`. Add an entry there and give it a `photo` path in
this folder; nothing else needs changing — the destination page, the weekend-trip
filters, the search index and the trip builder all read from that one list.

## Which pictures to use

Photographs you own, or ones you have the right to publish. If you use anything
under a Creative Commons licence, record the photographer and the licence the way
`../fleet/CREDITS.txt` does and the pages will need a credit line too.

Do not use pictures pulled from a search engine. The fleet photos already carry
an attribution obligation because of exactly that, and it is a nuisance worth not
repeating.
