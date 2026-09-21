# Gupta Tours & Travels — Portal

Public travel website **plus** an internal Booking, Vendor Billing and Invoice Management system.

**Owner:** Vinay Gupta · **Phone:** +91 99673 81555 · **GSTIN:** 27ALRPG8019M1ZH
**Project root:** `E:\Portal\GuptaToursAndTravels`

---

## What this replaces

The business currently receives each booking as a WhatsApp message, pastes it into
`DataEntryFormula.xlsx` to strip the labels off with Excel formulas, maintains a per-vendor
booking sheet, then copies the figures by hand into whichever invoice format that vendor requires.

This portal collapses all of that into one step:

```
Vendor's WhatsApp message
        │  paste it in — the fields are read out automatically
        ▼
    Booking saved  ──►  Vendor record  ──►  Billing line  ──►  Reports
        │
        ▼
  Select bookings → GENERATE INVOICE
        │  the vendor's own template is filled in, layout intact
        ▼
  Invoice numbered, saved, linked, booking marked Invoiced
        │
        ▼
  Payments tracked → outstanding and ageing
```

---

## Quick start

Double-click, in order:

| Step | File | What it does |
|------|------|--------------|
| 1 | `scripts\setup.bat` | Installs packages, creates the database, loads settings + sample data, builds the website |
| 2 | `scripts\start.bat` | Starts the portal on **http://localhost:4100** |

Then open **http://localhost:4100** and click **Login** (top right).

```
Login ID : Admin@gmail.com
Password : Pass@123
```

You are **required to change this password at first sign-in** — the rest of the portal stays
locked until you do.

### Prerequisites

- **Node.js 20 or later** — https://nodejs.org (the only requirement)
- Windows. No paid service, no internet connection and no cloud account is needed.

---

## The mobile apps

Two Android apps are built from the same code, so the office and its customers
can both work from a phone.

| App | For | Install | Rebuild |
|------|------|------|------|
| **GTT Portal** | admin & billing staff | `dist\GTT-Portal.apk` | `scripts\build-apk.bat` |
| **Gupta Tours** | customers | `dist\GTT-Customer.apk` | `scripts\build-customer-apk.bat` |

Different app ids, so both can sit on the same phone. The staff app signs in
with staff accounts and shows each role exactly what it already sees on the
website; the customer app signs in with a customer account and has no route to
the portal at all.

**On an iPhone**, open the site in Safari and use **Share → Add to Home
Screen**. That gives a full-screen icon — the portal from any `/admin` page, the
customer app from the home page. A native iOS build needs a Mac and a paid
Apple account, so this is the free route and it is the one this project uses.

Both apps talk to this PC's server, so the portal has to be running — and for a
phone on mobile data, reachable from outside the office.

Full guide: [docs\ANDROID-APP.md](docs/ANDROID-APP.md)

---

## Manual commands

If you prefer the command line to the `.bat` files:

```bash
# --- one-time setup -------------------------------------------------------
cd E:\Portal\GuptaToursAndTravels\backend
npm install
npm run migrate          # create the database from database/schema.sql
npm run seed             # settings, admin user, Wagon template, sample data

cd ..\frontend
npm install
npm run build

# --- run (production: one server on port 4100) ----------------------------
cd ..\backend
npm run build
npm start                # http://localhost:4100

# --- run (development: hot reload) ----------------------------------------
cd backend  && npm run dev      # API      http://localhost:4100
cd frontend && npm run dev      # website  http://localhost:5273  <- use this one
```

### Other useful commands

```bash
cd backend

npm test                 # 49 automated tests (uses a throwaway database)
npm run verify-template  # fills the real Wagon template and checks every cell
npm run backup           # back up database + templates + invoices
npm run backup:list      # list existing backups
npm run reset-admin      # reset the admin password if it is ever lost
```

---

## Where everything lives

```
E:\Portal\GuptaToursAndTravels\
│
├── backend\              Node + TypeScript + Express REST API
│   ├── src\
│   │   ├── routes\       auth, bookings, trips, customer, vendors, billing, invoices,
│   │   │                 payments, reports, settings, templates, users, audit, public
│   │   ├── services\     billing maths, message parser, invoice engine, numbering,
│   │   │                 Trip IDs, the trip lifecycle, email + templates
│   │   ├── middleware\   authentication, permissions, audit logging
│   │   └── db\           connection, migrate, seed
│   ├── scripts\          backup, reset-admin, template verification
│   └── tests\            end-to-end API tests
│
├── frontend\             React + TypeScript + Vite + Tailwind
│   ├── src\site\         customer website — 38 screens: booking, vehicle search and
│   │                     comparison, trip builder, group and fleet planners, corporate,
│   │                     events, weddings, tours, destinations, travel assistant,
│   │                     the WhatsApp enquiry sheet, customer sign-in, My Trips,
│   │                     trip tracking, support, profile
│   │                     (see docs\CUSTOMER_UI_UX.md)
│   └── src\admin\        admin portal (Dashboard, Trips, Bookings, Vendors, Billing,
│                         Invoices, Payments, Reports, Settings, Templates, Users, Audit Log)
│
├── database\
│   ├── schema.sql        full relational schema (26 tables)
│   └── gtt.db            the SQLite database  ← THIS IS YOUR DATA
│
├── templates\            working copies of vendor invoice formats
├── data\
│   ├── invoices\<FY>\<Vendor>\original\    generated invoices
│   │                        \revised\      regenerated versions
│   └── backups\          backups created by npm run backup
├── assets\               logo and letterhead
│   └── fleet\           vehicle photos for the website (README inside)
├── uploads\              uploaded files
├── docs\
│   ├── CUSTOMER_UI_UX.md
│   ├── INVOICE_TEMPLATE_ANALYSIS.md
│   └── PROJECT_DOCUMENTATION.md
└── scripts\              setup.bat, start.bat, dev.bat, backup.bat
```

> **`E:\Portal\InvoiceFormat` is never written to.** Templates are *copied* out of it.
> The originals stay exactly as they are.

---

## The customer journey, end to end

Every enquiry — however it arrives — becomes one record with one reference, and that record
carries the job through to the invoice.

```
Customer enquiry  →  Trip ID issued  →  office sees it under its source
                  →  vehicle + driver allotted  →  customer emailed
                  →  trip completed  →  GST / non-GST invoice raised
                  →  invoice emailed  →  invoice in the customer's account
```

### The Trip ID

Allocated the moment an enquiry is saved, and printed on the invoice. The source is in the
reference itself, so an operator reading one aloud already knows where the job came from:

| Prefix | Where it came from |
|--------|--------------------|
| `GTT-EM-2609-0042` | Email / website enquiry |
| `GTT-WA-2609-0007` | WhatsApp enquiry |
| `GTT-PB-2609-0113` | Booking placed by a signed-in customer |
| `GTT-OF-2609-0031` | Walk-in or phone booking entered by the office |
| `GTT-VN-2609-0290` | Vendor booking |

The counter is per source per month and `bookings.trip_id` carries a unique index, so two
operators saving at the same instant cannot collide.

### WhatsApp

The WhatsApp button still opens WhatsApp — that is what people actually use, and `wa.me` is a
plain link that costs nothing. A short form now runs in front of it: submitting it records the
enquiry, issues a Trip ID, emails the office, and *then* opens the chat with the whole
requirement already written out. **No WhatsApp Business API and no paid service is used
anywhere.** Replies are sent by hand from the phone, as before; the Trips screen gives the
office a ready-written WhatsApp link for the allotment message.

### Email

Everything the portal sends goes out from **one mailbox** — `vinaykumar87674@gmail.com` — over
Gmail's own free SMTP. Five kinds of message: the enquiry alert to the office, the
acknowledgement to the customer, the trip details when a car and driver are allotted, the
invoice, and the account welcome.

Setting it up takes about two minutes and costs nothing:

1. Turn on 2-Step Verification for the Google account.
2. Google Account → Security → **App passwords** → create one for "Mail".
3. Put the 16 characters in `backend\.env` as `MAIL_APP_PASSWORD` (or in **Settings → Email**).

Until that is done **the portal runs normally**: every message is written to the email log
first and held there with the reason, and **Settings → Email** shows what is waiting with a
Resend button beside each one. An enquiry is never lost because a mailbox was unreachable.
The same screen has a *Send test* button so it can be proved rather than hoped for.

### Customer accounts

Customers sign in at `/account` with an email address and password, or with Google. Google
Sign-In is free and optional — set `GOOGLE_CLIENT_ID` (or **Settings → Customer sign-in**) and
the button appears; leave it blank and it is hidden, with password sign-in working either way.

Signing up with the email address used on earlier enquiries attaches those trips automatically.
A trip booked over the phone can be added from **My trips → Add a trip** with its Trip ID and
the mobile number on the booking. Customers see only their own trips, their status, the allotted
vehicle and chauffeur, and their invoices to view, print or download.

Customer sessions are entirely separate from staff sessions: a different table, a different
cookie, and a token type that each middleware refuses from the other.

### The office

**Trips** is the whole lifecycle on one screen — filter by source, open a trip, allot a car and
a driver, email the customer, move the status, enter the fare, raise a GST or non-GST invoice
and send it. **New trip** takes a booking straight over the phone and issues a Trip ID for it.
The dashboard leads with what is waiting: enquiries nobody has picked up, trips with no vehicle,
and completed trips with no invoice.

---

## The two features that save the most time

### 1. Paste the vendor's message

**Bookings → New Booking → Paste vendor message.**

Drop in the WhatsApp text exactly as the vendor sent it. The reference, passenger name, mobile,
vehicle group, duty type, date, reporting time, pickup and drop are read out automatically, the
vendor is recognised from the sign-off line, and the matching fleet vehicle and its driver are
pre-filled. You review what was read before anything is saved.

Both formats found in the existing workbook are supported:

| Format | Used by | Starts with |
|--------|---------|-------------|
| A | AuraFox, Shree Destinations | `Booking #…` |
| B | FleetOZ, MMT | `TripId #…` |

The old Excel formulas were case-sensitive and silently failed on Format B's
`Reporting Address:` (capital A), leaving the label glued to the value. The parser here is
case-insensitive and alias-driven, and it tells you when it is unsure — for example when the
vendor's date has no year in it.

### 2. Generate the vendor's own invoice

**Billing → tick the bookings → Generate Invoice.**

The engine opens that vendor's actual workbook, writes values into the mapped cells and saves a
new file. Borders, merged cells, fonts, column widths, the logo, the print area and the sheet's
own formulas all survive untouched — the vendor keeps receiving the document they already
recognise.

Verified against the real Wagon template (`npm run verify-template`): 23 of 23 checks pass,
including formula preservation in `J18 J19 J23 J24 J25 J27` and merged ranges `A1:J1`, `A7:J7`,
`B11:F13`, `G35:J35`.

---

## Backup and restore

```bash
cd backend

npm run backup                                    # or double-click scripts\backup.bat
npm run backup:list
npx tsx scripts\backup.ts restore backup_2026-08-29_14-30-00
```

A backup contains the database, the invoice templates, every generated invoice and the brand
assets. It uses SQLite's online backup API, so it is **safe to run while the portal is running**.

Restoring parks a copy of the current database next to it first — nothing is destroyed silently.

For a manual copy, the single file that matters is:

```
E:\Portal\GuptaToursAndTravels\database\gtt.db
```

---

## Using it from other computers on the office network

1. In `backend\.env`, add this machine's LAN address to `CORS_ORIGINS`:
   ```
   CORS_ORIGINS=http://localhost:5273,http://192.168.1.20:4100
   ```
2. Allow port 4100 through Windows Firewall.
3. Others open `http://192.168.1.20:4100`.
4. Create separate user accounts under **Users** — do not share the admin login.

SQLite handles a handful of concurrent users comfortably. If the portal ever grows past roughly
ten simultaneous users, move to PostgreSQL; the schema in `database\schema.sql` ports across with
only minor type changes.

---

## Security

- Passwords hashed with **bcrypt** (12 rounds). No password is ever stored in readable form.
- The initial admin password **must** be changed at first sign-in; every other route is blocked
  until it is.
- Five wrong passwords locks the account for 15 minutes. Sign-in is rate limited.
- Five roles — Super Admin, Admin, Billing, Operations, View Only — and users only see the
  modules their role allows.
- All input validated server-side (mobile, email, GSTIN, PAN, IFSC, dates, amounts).
- SQL runs through prepared statements only. Helmet, CORS allow-list and CSRF-safe cookies.
- Uploads restricted to `.xlsx .xls .xlsm .docx .doc .pdf .csv`, 15 MB, with generated safe
  filenames. Executables cannot be uploaded.
- Every sign-in, booking, invoice, payment and settings change is written to the audit log with
  the user and IP address.

**Before putting the portal on a shared network, change `JWT_SECRET` in `backend\.env`.**

---

## Sample data

The seed loads three demo vendors and ten demo bookings so the dashboard and charts are not
empty on day one. Every one of those rows is flagged `is_sample = 1` in the database. To clear
them once real data is in:

```sql
DELETE FROM bookings WHERE is_sample = 1;
DELETE FROM vendors  WHERE is_sample = 1;
```

The company settings, admin user and the Wagon invoice template are **real** and should be kept.

---

## Known limitations

1. **PDF conversion needs LibreOffice.** Excel and Word invoices generate perfectly, and the
   portal has its own native PDF layout, but converting an XLSX/DOCX invoice to PDF requires
   LibreOffice (free). Install it and the portal picks it up automatically — no configuration
   needed. Until then, the Templates screen shows a notice.
2. **One template is mapped so far.** The Wagon LOCAL layout is fully mapped cell by cell. The
   other vendor formats in `E:\Portal\InvoiceFormat` use the same JSON mapping mechanism — add
   them through **Settings → Invoice Templates → Upload**, use *Inspect cells* to see the layout,
   then fill in the mapping. No code changes are needed per vendor.
3. **`Invoices_1.zip` (1.59 GB) and `Invoices_2.zip` (798 MB) were not extracted.** Sampling the
   already-extracted folders shows trip photographs, not invoice formats.
4. **Vendor dates are free text** (`27/01 to 27/01`, `30 OCT '24`). The parser normalises the
   common shapes and warns rather than guessing when the year is missing.
5. **Consolidated invoices need a template that supports repeating rows.** Single-booking
   templates such as Wagon's are rejected with a clear message rather than producing a wrong
   document.
6. **Email needs a Gmail App Password.** Free, and about two minutes to create — see
   *The customer journey* above. Everything works without one; messages queue instead of
   sending, and the portal says so plainly rather than pretending they went out.
7. **There is no customer password reset email yet.** A customer who forgets their password
   signs in with Google using the same address, or calls the office. Adding a reset link is a
   small change once the mailbox is configured.
8. **WhatsApp replies are sent by hand.** Deliberately: the WhatsApp Business API is a paid
   service. The portal records the enquiry, issues the Trip ID and hands the office a
   ready-written message to send from their own phone.

---

## Documentation

| Document | Contents |
|----------|----------|
| `docs\CUSTOMER_UI_UX.md` | The customer website: sitemap, design system, the competitor gap analysis behind it, where every number comes from, and the gaps left open on purpose |
| `docs\INVOICE_TEMPLATE_ANALYSIS.md` | What was found in `E:\Portal\InvoiceFormat`, the Wagon template mapped cell by cell, the message formats decoded, and the template architecture |
| `docs\PROJECT_DOCUMENTATION.md` | Architecture, database, modules, roles, workflows, API reference, troubleshooting |
