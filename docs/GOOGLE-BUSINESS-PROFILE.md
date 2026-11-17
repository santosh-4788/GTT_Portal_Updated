# Getting JustCabs onto Google

This file covers two jobs: getting **justcabs.in** into Google Search, and setting up the **Google Business Profile**. The profile is the listing that appears on Google Maps and beside search results, with reviews.

Both need the owner's own Google account. Google checks that the person creating a listing really runs the business, so nobody else can finish verification. The rest of this file is the content to paste in, field by field, and the order to do it in.

Use one Google account for both, ideally a business Gmail the owner controls (not a staff member's personal account).

---

## Part 1: Google Search Console (website in Google Search)

Expect around 30 minutes of work, then a wait of a few days to a few weeks while Google crawls the site.

1. **Deploy the latest code first.** Run `bash ~/app/deploy/vps/update.sh` on the server. Two changes in this release matter for Google:
   - Every page now carries its full address (`https://justcabs.in/...`) in its canonical link, link preview and business data. Before, these were relative and the address was missing.
   - `www.justcabs.in` now redirects permanently to `justcabs.in`. Before, both served the same pages, so Google saw two copies of the site.

   Check `grep PUBLIC_URL ~/app/backend/.env` on the server. It must read exactly `PUBLIC_URL=https://justcabs.in`.
2. Go to <https://search.google.com/search-console> and click **Add property**. Choose **Domain** and enter `justcabs.in`.
3. Google shows a **TXT record**. In the domain registrar's DNS settings (the company the domain was bought from), add it:
   - Type `TXT`, Host `@`, Value as given.
   - Click **Verify**. DNS can take up to an hour.
4. Go to **Sitemaps**, enter `sitemap.xml` and click **Submit**. It lists the site's 118 public pages.
5. Go to **URL inspection** and paste each of these URLs, then click **Request indexing**:
   - `https://justcabs.in/`
   - `https://justcabs.in/mumbai-airport-cab`
   - `https://justcabs.in/outstation`
   - `https://justcabs.in/cab-service/goregaon`
   - `https://justcabs.in/vehicles`
6. Optionally, go to <https://www.bing.com/webmasters> and choose **Import from Google Search Console**. This is free, takes one click, and covers Bing and the search results ChatGPT uses.

**What to expect.** Searches for "justcabs" usually find the site within days. Searches for "cab service Mumbai" or "taxi in Goregaon" are competitive and take months. Ranking for them depends on reviews, the Business Profile and links from other sites. Nobody can guarantee a position.

---

## Part 2: Google Business Profile

Go to <https://business.google.com/create> and fill in the fields below.

### 2.1 Basic details

| Field | Enter |
|---|---|
| **Business name** | `JustCabs` |
| **Primary category** | `Taxi service` |
| **Additional categories** | `Chauffeur service`, `Airport shuttle service`, `Car rental agency`, `Tour operator`, `Bus charter` |
| **Do customers visit your location?** | **No.** Customers are picked up, they do not come to the office. Google then hides the street address and shows a service area instead. Google still asks for the address privately, for verification. |
| **Address (for verification, not shown)** | P-8, New Aman CHS Ltd., Ajit Glass Garden Road, Goregaon (W), Mumbai, Maharashtra 400104 |
| **Service areas** (up to 20) | Mumbai · Mumbai Suburban · Goregaon · Andheri · Malad · Borivali · Bandra · Powai · Thane · Navi Mumbai · Panvel · Mira Bhayandar · Vasai-Virar · Kalyan · Pune · Lonavala · Nashik · Shirdi |
| **Phone** | +91 81043 38080 |
| **Website** | `https://justcabs.in` |
| **Hours** | Open 24 hours, all 7 days |
| **Opening date** | The date JustCabs started operating (the owner knows this) |

Some fields have rules that get listings suspended if broken:

- **Name.** Only "JustCabs". Do not add keywords such as "JustCabs – Cab Service Mumbai 24x7". Google treats that as spam and can suspend the listing.
- **Phone.** It must be a number Google can call during verification. The website does not show the number as text (to avoid spam scrapers), and that is fine. Google only needs it here.
- **Address.** Keep the address the same everywhere it appears (website, GST, any directories). Inconsistent addresses weaken the listing.

### 2.2 Description (paste as is: 681 characters, limit 750)

> JustCabs is a 24x7 cab and car rental service in Goregaon (West), Mumbai, run by Gupta Tours & Travels. We provide chauffeur-driven cabs for airport pickups and drops at Mumbai T1, T2 and Navi Mumbai airport, local hourly hire, one-way and round-trip outstation travel to Pune, Lonavala, Nashik, Shirdi and beyond, and corporate employee transport. Our fleet runs from sedans (Dzire, Aura, Honda City) and SUVs (Ertiga, XL6, Innova Crysta) to Tempo Travellers, Urbania mini buses and coaches for weddings, events and group travel. The fare is agreed before the trip, toll and parking are shown separately, and companies receive GST invoices. Book by call or WhatsApp, day or night.

Google does not allow links or phone numbers inside the description. This one has neither.

### 2.3 Services (Edit profile → Services → add each, with its description)

| Service | Description (under 300 characters) |
|---|---|
| Airport transfers | Pickups and drops at Mumbai T1, T2 and Navi Mumbai airport. The flight number goes on the booking, so a delayed flight does not mean a missed car. Meet-and-greet on request. |
| Local cab hire (hourly) | A car and driver for 4, 8 or 12 hours across Mumbai, for meetings, shopping or a day of errands. |
| Outstation one-way cab | One-way drops from Mumbai to Pune, Lonavala, Nashik, Shirdi, Mahabaleshwar, Goa and more. You pay one way, not a round trip. |
| Outstation round trip | Multi-day trips with the same driver throughout. The driver allowance and state permits are listed separately. |
| Corporate transport | Employee pickups, airport runs for visiting staff and monthly duty cars. Rate cards, duty slips and GST invoices in your company's format. |
| Wedding and event cars | Fleets of cars, Tempo Travellers and buses for weddings and events, planned as one schedule on one invoice. |
| Group travel and mini bus | Tempo Traveller 12, Urbania 17 and 35–49 seat coaches for family trips, pilgrimages and festival travel. |
| Mumbai darshan | A full-day city tour with a driver who knows the route: Gateway of India, Marine Drive, Siddhivinayak and more. |

### 2.4 Attributes (Edit profile → More)

Tick these only where true:

- Online appointments / bookings
- Accepts UPI / Google Pay
- Accepts debit and credit cards, if card payment is taken

### 2.5 Photos

Upload these first. They decide how the listing looks.

| Photo | What to upload |
|---|---|
| **Logo** | Square, at least 250 × 250 px. `assets/logo-512.png` works. |
| **Cover** | A real photo of one of your cars, clean, in daylight, ideally with the driver in uniform. |
| **Fleet** | One photo per vehicle type you actually run: Dzire, Ertiga, Innova Crysta, Tempo Traveller, and so on. |
| **Team** | The owner, the drivers, the office. Photos of people get noticeably more views. |

Use your own photos only. Most pictures under `assets/fleet/` are representative stock images, and Google removes stock or manufacturer photos from business listings. Take new ones on a phone. That is enough.

After launch, add 2–3 new photos a month. Active listings rank better.

### 2.6 Verification

After you submit, Google asks for verification, usually by **video**:

- Record one continuous clip showing the street sign or building, then a car with JustCabs or Gupta Tours branding.
- In the same clip, show proof the business is yours, such as the office, a GST certificate or a vehicle permit.
- Google may instead offer a phone or SMS code, or a postcard.

Verification takes from a few days to two weeks. The listing does not appear until it passes.

---

## Part 3: Reviews

Reviews are the biggest factor in appearing in the map results for "cab near me".

### Switch on the review button on the website

Once verified, open the profile and choose **Ask for reviews**, then copy the link (it looks like `https://g.page/r/XXXXXXXX/review`). Paste it into `frontend/src/site/siteData.ts`:

```ts
googleReviewUrl: 'https://g.page/r/XXXXXXXX/review',
```

Then deploy. A **★ Review us on Google** button appears in two places:

- on the Reviews page (`/reviews`)
- on the thank-you screen after a customer submits trip feedback

Until the link is filled in, both buttons stay hidden.

### Ask every customer, the same way

- **After each completed trip,** send the review link on WhatsApp with one line: *"Thank you for travelling with JustCabs. If you have a minute, a Google review helps other families find us: <link>"*
- **Print it as a QR code** (Google's **Ask for reviews** screen gives one) and stick it on the back of the front seats.
- **Reply to every review within a day or two,** good or bad. Thank the person by name. On a complaint, apologise once, say what was fixed, and give the office number.

### What Google bans

Breaking these can delete every review on the listing or suspend it:

- **Asking only happy customers** ("rate us 5 stars and…", or sending the link only to people who rated well). The website's button deliberately shows to everyone, whatever rating they gave.
- **Paying for reviews, or offering discounts or free rides in exchange.**
- **Reviews from the owner, staff, drivers or family,** or several reviews from one phone or Wi-Fi.
- **Buying reviews from agencies.** Google detects and removes them, often with the genuine ones too.

---

## Part 4: After the profile is live

1. **Link the profile from the website.** Send the Maps link of the listing (Share → Copy link). It goes into the website's business data (`sameAs` in `frontend/index.html`) so Google ties the site and the listing together.
2. **Post an update monthly** (Profile → Add update), for example a Chhath, Diwali or Ganpati travel offer, or a new vehicle. Seasonal posts match what people are searching for that month.
3. **Add Q&A.** Post and answer the 4–5 questions people ask on calls. Is it open at night? Can you book a one-way to Pune? Do you give GST invoices? Is the toll included?
4. **Use the same name, address and phone everywhere.** List the business on JustDial, Sulekha and IndiaMART with exactly the same name ("JustCabs"), address and phone as the profile, and link each to `https://justcabs.in`.
5. **Check Search Console monthly.** Look at **Performance** to see which searches show the site, and at **Pages** for any page Google could not index.
