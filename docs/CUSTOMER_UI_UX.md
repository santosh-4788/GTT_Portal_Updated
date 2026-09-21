# Customer website — UI/UX

The public side of the portal, rebuilt from a seven-page brochure site into a
customer platform: booking, discovery, group and event planning, corporate
travel, and a customer's own record of what they have asked for.

Nothing in here touches the admin portal, the API, the database or the invoice
engine. The only backend endpoints the customer site uses are the three that
already existed — `/api/public/company`, `/api/public/locations`,
`/api/public/fare-options` and `/api/public/enquiry`.

---

## 1 · What was already there, and what was added

| | Before | Now |
|---|---|---|
| Customer screens | 7 | 35 |
| Booking entry points | 1 search bar (pickup / drop / date) | 4-tab widget + 10 service cards + 6 planners |
| Price shown before contact | Fare calculator on the home page only | On every vehicle card, in every planner, live |
| Group sizing | Not answered | Answered live, at every group size |
| Trip record for the customer | None | My Trips, trip detail, tracking, notifications |
| Mobile navigation | Header menu + a floating call button | Bottom navigation designed for the phone |

The seven original pages (Home, About, Services, Service detail, Fleet,
Packages, Contact) all still exist and are still linked. Home was rebuilt; the
other six were left in place and brought onto the same design system.

---

## 2 · Sitemap

```
/                             Home — "What do you need today?"
/book?tab=…                   Plan a trip · Local | Airport | Outstation | Hourly
/help-me-choose               Five questions → the vehicle we would send
/vehicles                     Vehicle search: filters, sort, estimates
/vehicles/compare?ids=…       Compare up to three
/vehicles/:slug               Vehicle details
/fleet                        The brochure view of the same seven vehicles
/build-trip                   Build my trip — 6 steps, multi-stop, live estimate

/group-travel                 "We are 25 — what do we need?" answered live
/fleet-request                Plan a fleet for one date
/corporate                    Corporate travel, simplified
/corporate/request            Corporate requirement — 3 steps
/events                       Event transportation — 7 event types
/events/planner?type=…        Event planner — 6 steps, movement timeline
/weddings                     Wedding transportation + schedule planner

/tours/mumbai                 Explore Mumbai + tour builder
/weekend-trips                Weekend escapes, filtered by nights and interest
/destinations/:slug           Destination detail + itinerary + estimate
/find-a-trip                  Discovery by interest, days and budget
/assistant                    Travel assistant — a sentence in, a trip out

/enquiry                      "Tell us what you need" — conversational
/request/:ref                 We've got your request
/trips                        My Trips — Upcoming | Active | Completed | Cancelled
/trips/:ref                   Trip details + status trail + driver
/trips/:ref/track             Trip tracking
/profile                      Profile, saved places, passengers, preferences
/notifications                Notification centre

/support                      Support centre
/faq                          Every answer, grouped and searchable
/reviews                      Customer reviews
/search?q=…                   Global search
/policies                     Terms and privacy, in plain words

/services  /services/:slug  /packages  /about  /contact
/login                        Corporate / partner login (the existing portal login)
```

---

## 3 · Design system

There is one, it already existed, and nothing new was invented for it. Tokens
live in `frontend/tailwind.config.js`; component classes live in
`frontend/src/index.css` under the `PUBLIC WEBSITE` heading.

**Colour** — one accent (`brand`, the cyan from the logo), one neutral ramp with
a slight blue bias (`ink`), three status colours (`ok`, `warn`, `danger`), and
gold reserved for the brand mark. Status colours are never decoration.

**Type** — Sora for display, Inter for body, JetBrains Mono for references and
figures. The scale is defined in the Tailwind config, not per page.

**Surfaces** — `.tile` and `.surface`: rounded, shadow-only, never outlined.
Depth is light, not lines. There are no rules, dividers or dark slabs anywhere
on the customer site; sections are separated by space and typography on one
continuous pale ground (`.page-bg`).

**Components** — the shared kit is `frontend/src/site/kit.tsx`:

| Piece | What it is |
|---|---|
| `SectionHead` | eyebrow + heading + sub + optional action |
| `Stepper` | the progress row on every wizard |
| `SegTabs` `Chip` `Counter` `ChoiceCard` | the four selection primitives |
| `PlaceInput` | address field with suggestions from our own locations table |
| `SoftField` / `SOFT_INPUT` | the booking-widget field pair |
| `BottomSheet` | the mobile pattern for filters and summaries |
| `EstimatePanel` | the price, and what it does and does not cover |
| `JourneyLine` `StatusTrail` `MapCanvas` | route, status and the tracking canvas |
| `TrustRow` `Stars` `Callout` `SampleTag` | trust marks and inline notes |
| `SiteEmpty` `SiteError` `CardSkeleton` `SkeletonGrid` `LineSkeleton` | empty, error and loading states |
| `ContactFields` `SubmitButton` `useSendRequirement` | the end of every journey |
| `CompareProvider` `useCompare` | the comparison tray |

Two more shared cards: `VehicleCard` (+ `CompareTray`) and
`DestinationCard` / `SpotCard`.

**Page headers** — `PageHero` has two sizes and the choice is not cosmetic. A
marketing page earns a 3rem headline; a list of your own bookings does not, and
a billboard on top of one pushes the thing you came for below the fold. So the
task and utility screens — trips, profile, notifications, support, search, FAQ,
policies, and the four request planners — pass `compact`, which drops the title
to 2rem, tightens the top padding and drops the eyebrow that was only repeating
the breadcrumb and the heading a third time.

**Going back** — every screen below the home page offers `BackLink`, sitting on
the same row as the breadcrumbs. Breadcrumbs alone are not enough: a customer who
went search → vehicle → trip builder wants the step they were on, not the section
root, and on a phone there may be no browser chrome to fall back on. It uses real
history when there is any and a per-screen fallback when the page was opened cold
from a link, so it can never dead-end — including on the "reference not found"
screens, which are the ones most in need of a way out.

Screens whose steps are state rather than history pass `onBack`, and Back unwinds
those first: on Help me choose it returns the recommendation to the questions and
then walks back through them one at a time; the trip builder, the event planner,
the corporate request, Find a trip and the enquiry do the same. Without it, Back
on step five of a six-step planner threw away all five answers.

**The header carries what the home page does not.** The home page opens with
"What do you need today?" — ten cards covering local, airport, outstation, hourly,
corporate, events, weddings, groups, tours and fleets — and then the fleet, the
destinations and the planners. Repeating all of that as five dropdown menus in the
bar bought nothing: the same content twice, a bar wider than the 76rem container
it sits in (which is why the phone number was clipped and the CTA pushed off the
right edge at 1920), and no room for the things the home page genuinely lacks.

The bar now holds only those — search, notifications, the phone number, one
primary action — plus **Menu**. The panel behind it shows every section at once
in seven columns rather than hiding five of them behind separate hovers, and its
last two columns are the half of the site the home page has no place for: *Yours*
(trips, profile, notifications) and *Help* (support, FAQ, services, contact). On
a phone the same markup stacks, with the search field at the top.

That leaves the bar at roughly 640px of 1152px, so it fits at every width with
room to spare — and anything added to it now has a budget to be measured against.

**Breakpoints tested** — 1920, 1440, 1280, 1024, 768, 500 and 390. No horizontal
scrolling and no overlap at any of them; wide content (the comparison table)
scrolls inside its own container, and on a phone it becomes one card per vehicle
with the same rows in the same order.

---

## 4 · Competitor patterns, and what we did instead

Patterns looked at across Cityflo, Blacklane, MakeMyTrip / myBiz, EaseMyTrip,
Savaari, Gozo, Uber and Ola. The gap analysis below is the deliverable; each row
names the pattern, what is wrong with it for *this* business's customers, and
what this site does.

| # | Existing UI pattern | The problem | What this site does |
|---|---|---|---|
| 1 | Home page is a pickup → drop → search bar | Serves one of five customer types. A wedding planner, a conference organiser and a family with four suitcases all bounce off it | Home opens with **"What do you need today?"** — ten cards, each landing on a screen that asks only that trip's questions |
| 2 | One search form for every trip type | An airport transfer is asked for a return date; an outstation trip is not asked for a flight number | Four-tab widget; each tab renders only its own fields (`QuickBook.tsx`) |
| 3 | Price hidden until you enter a phone number | The customer's first question is answered last, so they call a competitor instead | An estimate on every vehicle card, in every planner, before any contact detail is asked for |
| 4 | "Get quote" → a call centre, days later | No number, no commitment, no way to compare | Estimate is computed in the browser from the business's own published rate card; when no rate covers it, the screen says "quoted on request" rather than inventing a figure |
| 5 | Estimate, quote and fare used interchangeably | Customer thinks a number is binding when it is not, and disputes the invoice | Three words with three meanings, kept apart in the UI and defined on `/policies#terms`. Every estimate carries an "Estimate" badge and what is excluded |
| 6 | Vehicle lists are seat counts and a photo | Six people with a suitcase each do not fit in a six-seater, and the list does not say so | Cards carry seats **and** large bags; the recommender discounts seats when the luggage needs the last row (`recommend.ts`) |
| 7 | No recommendation — the customer must know what a Crysta is | First-time customers guess, then get the wrong vehicle | **Help me choose**: five questions → the vehicle we would send, with the reasons it won shown, not hidden |
| 8 | Comparison as a 4-column table | Unusable on a 375px screen; horizontal scrolling a table is not a fix | Desktop: aligned columns. Phone: one card per vehicle, same rows, same order |
| 9 | Group booking = "contact us for 10+" | The single most common question the office gets is left unanswered | **Group travel** answers it live: one vehicle or several, which ones, seats spare — as the number is typed |
| 10 | Multiple vehicles = a 30-field procurement form | Organisers abandon it and phone instead | **Plan my fleet**: tap a vehicle, set how many. Six fields and a notes box |
| 11 | Weddings treated as "group booking — enquire" | A wedding is a four-day schedule, not one pickup | **Wedding planner** builds the schedule day by day and sends it as one requirement |
| 12 | Events funnelled into one contact form | A conference and a concert need different things asked | Seven event types, each opening the planner with its own checklist |
| 13 | Event forms ask for text, not a timetable | The organiser has to describe legs in prose | **Event planner** with a movement timeline — Airport → Hotel → Pickup → Venue → Return — that builds as you fill it in |
| 14 | Corporate hidden behind "Business login" | A prospect cannot see what an account gets before signing up | **Corporate landing** states what is covered, how billing works and what appears on an invoice, line by line |
| 15 | Corporate onboarding is a tender document | Three routes and a frequency is enough to price an account | **Corporate request** in three short steps, each fitting a phone screen |
| 16 | Multi-stop trips not supported | "Mumbai → Lonavala → Mahabaleshwar → Mumbai" becomes three enquiries | **Build my trip** takes stops, reorders them, and shows total stops, approximate distance and driving time |
| 17 | Trip cost revealed at the last step | Customers back out at the end, having done all the work | The live summary rail carries the estimate through all six steps and re-runs on every change |
| 18 | Tour pages are a wall of destination text | No way to turn interest into a booking | **Mumbai tour builder**: pick hours, vehicle and stops; it returns a timed route and warns when the day is over-filled |
| 19 | Destination pages are SEO copy | Nothing to act on | Destination pages carry the itinerary, the vehicles we send, and a live round-trip estimate, with one button into the builder |
| 20 | Discovery only by "from / to" | Useless to somebody who does not yet know where they want to go | **Help me find a trip**: interests, days, group and budget → ranked destinations, each saying why it came up |
| 21 | Chatbots that answer with paragraphs | The customer still has to re-type everything into a form | **Travel assistant** parses the sentence and answers with cards — vehicle, itinerary, duration, estimate, extras — and buttons that carry it into the builder |
| 22 | Chatbots that invent policies and prices | Worse than no answer for a travel desk | It is a parser plus this site's own answers. It cannot make up a rate, a route or a cancellation policy, and says so when it is unsure |
| 23 | Long inquiry form, eight fields at once | The customer has to work out which fields matter | **"Tell us what you need"** asks one question at a time, in the order a person on the phone would; answered questions collapse to a tappable line |
| 24 | "Thank you, we will get back to you" | No reference, no summary, no expectation | Confirmation screen gives a reference, repeats the requirement back, and says what happens next and by when |
| 25 | No trip history without an account | The customer has nothing to quote when they call | **My Trips** keeps this device's requests and references, and says plainly that it is a device record, not an account |
| 26 | Status trails that advance on a timer | A trail that says "driver assigned" when nobody was assigned leaves someone on a pavement at 4am | The trail marks a step done only when the office has confirmed it; everything after is shown as still to come |
| 27 | Fake live maps with a moving dot | We have no vehicle telemetry; a moving dot would be a lie | The tracking screen draws the route plan, says in one line that it is not a live position, and gives the chauffeur's number instead |
| 28 | Star ratings on everything, sourced from nowhere | A decorative 4.8 next to a real fare estimate makes the honest number look invented too | No vehicle ratings, and the reviews page ships empty with a designed empty state until real reviews exist |
| 29 | Support = a ticket form and a queue | This business is one man with a phone; a ticket number would be theatre | **Support centre**: six topics, each listing what we need to settle it in one call, then three ways to reach a person |
| 30 | Promotional notification spam | Trains customers to ignore the notification centre | Notifications carry trip activity only, and the page says there is nothing to unsubscribe from |
| 31 | Mobile as a squeezed desktop | Nav with fourteen links does not belong on 375px | Bottom navigation, the booking action raised in the middle, bottom sheets for filters, docked summaries, sticky actions on tracking |
| 32 | Blank screens while data loads | Reads as broken on a slow connection | Skeleton cards, skeleton rows, button spinners and a route-level fallback that keeps the page ground |
| 33 | "Error 500" | The customer cannot act on a status code | "We couldn't load this right now", with Try again and Contact support |
| 34 | Booking lists that lead with a route | Two requests for the same route on the same day read as identical, and the reference — the one thing the office needs on the phone — is small grey type at the foot of the card | Every trip card leads with its reference, copyable in one tap, beside its status; the route, date and vehicle follow, and "Sent 2 hours ago" tells two otherwise identical requests apart |
| 35 | No way to find one booking among many | Scrolling four tabs to locate a reference | A find field that matches on reference, destination, vehicle, date, service or status, and searches across all four tabs at once because a reference belongs to exactly one trip |
| 36 | Breadcrumbs as the only way out | They return you to a section root, not to the step you were on | `BackLink` on every screen below home, using real history with a per-screen fallback |
| 37 | Back inside a multi-step form leaves the form | Five answers thrown away from step five of six | Back unwinds the wizard first — recommendation → questions → previous question — and only leaves the page when there is nothing left to unwind |
| 38 | A header that repeats the home page | The same fifteen links in two places, and no room left for the account and support items that appear nowhere else | The bar carries only what the home page does not; everything else is one tap away in a panel that shows all of it at once |
| 39 | "Contact us" as the only alternative to the form | In this market most people would rather send one WhatsApp message than fill anything in, especially at 11pm | The booking widget composes the requirement into a prefilled `wa.me` message — the free link, no Business API — and the home page carries a standing "Rather just send us a message?" card beside "Help me choose" |
| 40 | A trips page that looks like an account | Customers reasonably ask whether it shows other people's bookings | My Trips states before the list that it is this browser's requests only, that the page has no login and no customer list behind it, and that the reference is what identifies a booking to the office |

---

## 5 · Where the numbers come from

Everything shown as money is derived from the walk-in rate card the business
maintains in the Master (`vendors.code = 'DIRECT'`), served by the existing
`/api/public/fare-options`. The arithmetic lives in `frontend/src/site/fare.ts`,
which already existed, and is applied per screen through `estimateFor()` in the
kit.

A vehicle is matched to a rate row by the alias words in `catalog.ts`
(`rateAliases`), not by an id — so a new rate row named "Premium Sedan" or
"Crysta" finds the right vehicle with no code change. **When no row matches, no
number is shown.** Every screen falls back to "quoted on request".

Distances are the ones the office quotes, published in `places.ts`, and are
labelled approximate everywhere they appear.

---

## 6 · Honest gaps, on purpose

These are deliberate, and each is stated in the UI rather than papered over.

1. **No customer login.** There is no customer account in this portal and adding
   one would mean backend work. My Trips, saved places, saved passengers,
   preferences and recent searches are kept in the visitor's own browser
   (`tripStore.ts`), and the pages say so where it matters. A submitted
   requirement really is sent — it posts to the same `/api/public/enquiry`
   endpoint the contact form uses, so the office sees it in the enquiry list.
2. **Request references are device-local.** The enquiry endpoint returns a
   message, not an id, so the reference (`GTT-20260902-4821`) is generated in the
   browser and sent to the office inside the requirement text. It is labelled as
   the customer's own reference, and the office can find any request by travel
   date and mobile number.
3. **One sample trip is seeded** on first visit, flagged `sample` and marked as
   such on every screen, so the trip, driver and tracking screens can be seen
   before a real booking. It is deletable. Same convention as the portal's own
   `is_sample` seed data.
4. **No live tracking.** No GPS on the fleet and no map provider, so the tracking
   screen shows a drawn route plan and says so.
5. **No reviews and no vehicle ratings** until real ones exist. Add them to
   `src/site/reviewsData.ts`; `/reviews?preview=1` shows the layout with
   obviously-marked placeholder text.
6. **No social links** in the footer, because the business runs no social
   accounts. WhatsApp, phone and email are there instead.
7. **No EV in the fleet.** The Electric filter exists and says so when used,
   rather than returning nothing without explanation.
8. **Destination photographs are optional.** `/assets/places/<slug>.jpg` lights a
   card up; until then it gets a considered tinted panel rather than stock
   imagery pretending to be ours.
9. **`/policies` is a plain-language summary, not a contract.** The binding terms
   for a corporate account come with the account agreement.

---

## 7 · Performance

The site is thirty-five screens plus an admin portal, so every route except the
layout and the home page is code-split (`App.tsx`).

| | First-load JS |
|---|---|
| Before splitting | 1.34 MB raw · 363 KB gzipped |
| After | 424 KB raw · **133 KB gzipped** |

The 400 KB charting library used by the admin dashboard is now only fetched by
the admin dashboard.

---

## 8 · Where things live

```
frontend/src/site/
├── catalog.ts          vehicle attributes, add-ons, event types, trust, FAQ groups
├── places.ts           Mumbai stops, weekend destinations, distances
├── recommend.ts        the recommendation and fleet-plan arithmetic
├── fare.ts             the fare estimate (pre-existing)
├── tripParams.ts       the trip carried in the URL
├── tripStore.ts        the customer's device-local record
├── searchIndex.ts      the global search index
├── reviewsData.ts      reviews (ships empty — see §6)
├── kit.tsx             the shared component kit
├── VehicleCard.tsx  PlaceCards.tsx  DriverCard.tsx  ShareTrip.tsx
├── QuickBook.tsx    MobileNav.tsx   SiteLayout.tsx
├── assistantParse.ts   reading a trip out of a sentence
├── assistantKnowledge.ts  the prepared answers (pre-existing)
└── <one file per screen>
```
