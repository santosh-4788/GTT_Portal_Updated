# SEO keyword map: Gupta Tours & Travels

This file lists the searches the public website is built to answer, and which page answers each one. The pages themselves live in `frontend/src/site/seo/` (`landings.ts`, `areas.ts`, `routeInfo.ts`) and in the existing site pages.

## How keywords are used

These rules follow Google's Search Essentials and its spam policies.

- **One page per search intent.** Each page answers one kind of search (a Mumbai area, an airport, a route, a kind of trip, a language). Pages are never generated just to repeat a keyword with a different town name. Every area and route page carries facts that are specific to it: the distance, the road, landmarks, pickup points and what people go there for.
- **Keywords appear where a reader expects them.** That means the title, the H1, the first paragraph, sub-headings, image alt text and the FAQ. They are written as normal sentences. There are no keyword lists, no `<meta name="keywords">`, and no hidden or same-colour text.
- **Spelling variants and typos are not written on the pages.** Examples are "texi", "cab bookng" and "nasik". Google maps those to the correct spelling itself, and writing them out would read as spam. They are listed below only so the map is complete.
- **Hindi and Marathi pages are real translations**, linked to their English versions with `hreflang`. They are not machine-repeated English.
- **No prices on landing pages.** Fares come from the office's masters. **No phone number as text**, as on the rest of the site.
- **No ranking is guaranteed.** Search position depends on Google, competition, reviews, links and time. This work makes the site eligible and relevant. It cannot promise first place.

## Page inventory

| URL pattern | Count | Answers |
|---|---|---|
| `/` | 1 | cab booking Mumbai, car rental Mumbai, taxi service Mumbai |
| `/book` | 1 | book a cab, online cab booking, car booking online |
| `/cab-service/<area>` | 14 | cab / taxi in Andheri, Goregaon, Malad, Kandivali, Borivali, Bandra, Powai, Ghatkopar, Dadar, South Mumbai, Thane, Navi Mumbai, Panvel, Mira Road |
| `/mumbai-airport-cab` | 1 | Mumbai airport taxi, airport pickup and drop, T1 / T2 cab |
| `/navi-mumbai-airport-cab` | 1 | Navi Mumbai airport cab, NMIA taxi |
| `/one-way-cab-mumbai` | 1 | one way cab, drop taxi, one way outstation cab |
| `/round-trip-cab-mumbai` | 1 | round trip cab, return taxi, outstation round trip |
| `/hourly-car-rental-mumbai` | 1 | hourly car rental, 8 hr 80 km, car with driver for a day |
| `/outstation` | 1 | outstation cab from Mumbai, outstation taxi fares |
| `/cabs/mumbai-to-<place>` | 20 | Mumbai to Pune / Lonavala / Khandala / Nashik / Shirdi / Trimbakeshwar / Igatpuri / Mahabaleshwar / Panchgani / Alibaug / Kashid / Matheran / Goa / Kolhapur / Aurangabad / Bhimashankar / Surat / Ahmedabad / Daman / Ganpatipule cab, plus every fixed-fare route the office adds |
| `/services/<slug>` | 6 | airport transfers, local travel, outstation, corporate, tour packages, event transport |
| `/vehicles/<slug>` | 12 | Innova Crysta on rent, Ertiga on rent, Tempo Traveller on rent, bus hire… |
| `/destinations/<slug>` | 12 | Lonavala trip by cab, Mahabaleshwar trip… |
| `/weddings`, `/events`, `/corporate`, `/group-travel`, `/tours/mumbai`, `/weekend-trips` | 6 | wedding car rental, event transport, corporate car rental, tempo traveller hire, Mumbai sightseeing, weekend trips |
| `/hi/...` | 13 | Hindi: home, airport, local, outstation, wedding, 8 routes |
| `/mr/...` | 13 | Marathi: home, airport, local, outstation, wedding, 8 routes |

Every page in this table is listed in `/sitemap.xml`, and translated pages carry `xhtml:link` hreflang entries. All new landing pages are also pre-rendered to static HTML at build time.

## Keyword clusters (English)

### Short-tail, high volume
cab booking · taxi service · car rental · car hire · cab service · taxi booking · car booking · outstation cab · airport taxi · rent a car with driver
→ `/`, `/book`, `/services`

### Local and "near me"
cab near me · taxi near me · local taxi service near me · cab service in Andheri · taxi in Thane · car rental in Navi Mumbai · cab in Goregaon · Borivali taxi service · Powai cab · Bandra taxi · cab service in Dadar · Panvel taxi · Mira Road cab
→ `/cab-service/<area>`. "Near me" searches are matched by Google from the user's location and the business's address and area pages. The phrase itself is used only in a FAQ question, where it reads naturally.

### Airport transfers
Mumbai airport pickup and drop · Mumbai airport taxi · cab to Mumbai airport · airport cab Andheri · T2 airport taxi · Santacruz airport cab · Sahar airport cab · early morning airport cab · Navi Mumbai airport taxi · NMIA cab · Pune airport cab from Mumbai
→ `/mumbai-airport-cab`, `/navi-mumbai-airport-cab`, `/services/airport-transfers`, the area pages

### Outstation, by route
Mumbai to Pune cab · Mumbai to Pune taxi service · cab from Mumbai to Nashik · Mumbai to Shirdi cab · Mumbai to Lonavala cab · Mumbai to Mahabaleshwar taxi · Mumbai to Alibaug cab · Mumbai to Goa cab · Mumbai to Surat taxi · Mumbai to Trimbakeshwar cab · Mumbai to Matheran cab · Mumbai to Igatpuri taxi …
→ `/cabs/mumbai-to-<place>`

### Trip type
one way cab Mumbai · one way taxi Mumbai to Pune · drop taxi · round trip cab · return cab · outstation round trip · hourly car rental Mumbai · 8 hours 80 km cab · car with driver for a day · full day cab hire Mumbai
→ `/one-way-cab-mumbai`, `/round-trip-cab-mumbai`, `/hourly-car-rental-mumbai`

### Vehicle type
Innova Crysta on rent Mumbai · Ertiga on rent · sedan cab Mumbai · 7 seater cab Mumbai · SUV on rent with driver · Tempo Traveller on rent Mumbai · 12 seater / 17 seater Tempo Traveller · bus hire Mumbai · luxury car rental Mumbai
→ `/vehicles/<slug>`, `/group-travel`, `/vehicles`

### Occasion
wedding car rental Mumbai · car for wedding · baraat car · guest transport for wedding · event transport Mumbai · corporate car rental Mumbai · employee transport · Mumbai sightseeing by car · Mumbai darshan cab · weekend trip from Mumbai by cab · pilgrimage cab (Shirdi, Trimbakeshwar)
→ `/weddings`, `/events`, `/corporate`, `/tours/mumbai`, `/weekend-trips`, route pages

### Question-based (answered in FAQs)
How far is Shirdi from Mumbai by road? · How long does a cab from Andheri to the airport take? · Can I get a taxi in Thane late at night? · Is toll included in the cab fare? · What is an 8 hour 80 km package? · Can I book a one-way cab from Mumbai to Pune? · Do you track flight delays? · How far is Navi Mumbai airport from Mumbai?
→ FAQ sections, marked up as `FAQPage`

### High-intent / transactional
book cab online Mumbai · book taxi now · cab booking for tomorrow · 24x7 cab service Mumbai · book outstation cab · airport cab booking
→ `/book`, plus call-to-action buttons on every landing page

## Hindi (हिन्दी)

| Search | Page |
|---|---|
| कार बुकिंग · कैब बुकिंग मुंबई · टैक्सी सेवा मुंबई · गाड़ी किराये पर | `/hi/mumbai-cab-booking` |
| मुंबई एयरपोर्ट टैक्सी · एयरपोर्ट पिकअप ड्रॉप · एयरपोर्ट के लिए कैब | `/hi/mumbai-airport-taxi` |
| लोकल टैक्सी मुंबई · घंटे के हिसाब से कार · मुंबई दर्शन गाड़ी | `/hi/local-taxi-mumbai` |
| आउटस्टेशन कैब · वन वे टैक्सी · राउंड ट्रिप कैब | `/hi/outstation-cab-mumbai` |
| शादी के लिए कार · दूल्हे की गाड़ी · बारात के लिए गाड़ी | `/hi/shaadi-ke-liye-car` |
| मुंबई से नासिक कैब बुकिंग · मुंबई से पुणे टैक्सी · मुंबई से शिर्डी कैब · मुंबई से लोनावला · महाबलेश्वर · अलीबाग · गोवा · माथेरान | `/hi/mumbai-se-<place>-cab` |

Romanised Hindi, as typed on phones, goes to the same pages: "mumbai se nashik cab", "gadi booking", "taxi chahiye", "airport ke liye cab", "shaadi ke liye gaadi". The URL slugs use these spellings.

## Marathi (मराठी)

| Search | Page |
|---|---|
| कॅब बुकिंग · टॅक्सी सेवा मुंबई · गाडी भाड्याने | `/mr/mumbai-cab-booking` |
| मुंबई विमानतळ टॅक्सी · विमानतळ पिकअप ड्रॉप | `/mr/mumbai-airport-taxi` |
| लोकल टॅक्सी · तासाप्रमाणे गाडी · मुंबई दर्शन | `/mr/local-taxi-mumbai` |
| आउटस्टेशन कॅब · वन वे टॅक्सी | `/mr/outstation-cab-mumbai` |
| लग्नासाठी गाडी · नवरदेवाची गाडी | `/mr/lagnasathi-gadi` |
| मुंबई ते नाशिक टॅक्सी बुकिंग · मुंबई ते पुणे कॅब · मुंबई ते शिर्डी · लोणावळा · महाबळेश्वर · अलिबाग · गोवा · माथेरान | `/mr/mumbai-te-<place>-taxi` |

Romanised Marathi goes to the same pages: "mumbai te nashik taxi", "gadi bhadyane", "lagnasathi gadi".

## Spelling variants (for reference only, not written on pages)
taxi / texi / taxy · cab / cabs / kab · Nashik / Nasik · Shirdi / Shiridi · Lonavala / Lonavla / Lonawala · Mahabaleshwar / Mahableshwar · Alibaug / Alibag · Trimbakeshwar / Tryambakeshwar · Innova / Inova · Tempo Traveller / Tempo Traveler · Aurangabad / Chhatrapati Sambhajinagar · Bombay / Mumbai

## Structured data on the pages
- `LocalBusiness`, site-wide (index.html): address, opening hours (24x7) and area served.
- `TaxiService` on each landing page, with service type, area served and the provider linked to the business.
- `BreadcrumbList` on landing, route, service and vehicle pages.
- `FAQPage` wherever a page shows FAQs.

## After deploying (needs the owner)
1. Set `VITE_SITE_URL` to the real domain in the build, so the canonical and hreflang links are absolute. Also set `SITE_URL` on the server.
2. Verify the domain in **Google Search Console**, a free tool, and submit `/sitemap.xml`.
3. Create or claim the **Google Business Profile**, which is also free. Use the same name, address and category ("Taxi service", "Car rental agency") as the website. This drives most "near me" and map results.
4. Ask happy customers for Google reviews. Reviews matter more for local ranking than anything on the page.
5. Recheck Search Console's "Pages" and "Performance" reports monthly, and add a landing page only when a real search is showing impressions without a good page.
