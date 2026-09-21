# Gupta Tours & Travels — Project Documentation

**Version:** 1.0.0 · **Location:** `E:\Portal\GuptaToursAndTravels`
**Owner:** Vinay Gupta · +91 99673 81555 · GSTIN 27ALRPG8019M1ZH

---

## 1. Architecture

```
┌──────────────────────── Browser ────────────────────────┐
│  Public website  (/, /about, /services, /fleet, …)      │
│  Admin portal    (/admin/…)                             │
│  React 18 + TypeScript + Vite + Tailwind + Recharts     │
└───────────────────────────┬─────────────────────────────┘
                            │  REST + JWT (Bearer / httpOnly cookie)
┌───────────────────────────▼─────────────────────────────┐
│  Node 22 + TypeScript + Express                         │
│                                                          │
│  routes/     auth bookings vendors billing invoices      │
│              payments reports settings templates users   │
│              audit public                                │
│  middleware/ requireAuth · requirePermission · audit     │
│  services/   billing · bookingMessageParser              │
│              invoiceNumber · invoiceEngine               │
└───────────────────────────┬─────────────────────────────┘
                            │  better-sqlite3 (prepared statements)
┌───────────────────────────▼─────────────────────────────┐
│  SQLite — database\gtt.db   (WAL, foreign keys ON)      │
└──────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
   templates\        data\invoices\         assets\
   (vendor formats)  (generated files)      (logo, letterhead)
```

### Why this stack

| Choice | Reason |
|--------|--------|
| SQLite | One file, zero install, trivial backup. Right size for a single-office business. Ports to PostgreSQL if it ever outgrows that. |
| better-sqlite3 | Synchronous and transactional, which keeps invoice numbering race-free without extra machinery. |
| ExcelJS | Reads and rewrites a real `.xlsx` while preserving styles, merges and formulas — the whole basis of the invoice engine. |
| bcryptjs | Pure JavaScript, so no compiler toolchain is needed on the office machine. |
| Vite + React + Tailwind | Fast build, no runtime CSS cost, all free and open source. |

Everything is free/open-source. No paid API, no SaaS, no internet connection required at runtime.

---

## 2. Database

21 tables. Full DDL in `database\schema.sql`.

### Core relationships

```
roles ──< role_permissions >── permissions
  │
  └──< users ──< audit_logs
                 
invoice_templates ──< vendors ──< bookings ──1:1── booking_charges
                        │            │
                        │            └──< invoice_items >── invoices
                        │                                      │
                        └──────────────────────────────────────┤
                                                    ├──< payments
                                                    └──< invoice_revisions

financial_years ──< invoices        invoice_sequences (numbering)
passengers, locations, vehicles     (autocomplete sources)
settings, enquiries
```

### Table reference

| Table | Purpose |
|-------|---------|
| `roles`, `permissions`, `role_permissions` | 5 roles × 34 permissions |
| `users` | Accounts. bcrypt hash, lockout counters, forced password change |
| `settings` | Key/value company configuration — new settings need no migration |
| `financial_years` | Indian FY (1 Apr – 31 Mar); one is active |
| `invoice_templates` | Vendor invoice formats plus their JSON field mapping |
| `invoice_template_mappings` | Optional normalised view of a mapping, for a UI editor |
| `vendors` | Vendor master **and** its invoicing rules (template, tax mode, prefix, cycle) |
| `passengers`, `locations`, `vehicles` | Reference data that powers the booking form's autocomplete |
| `bookings` | The single point of data entry |
| `booking_charges` | 1:1 with a booking. Raw charge lines **and** the computed totals |
| `invoices` | Invoice header, amounts, status, file path, revision |
| `invoice_items` | Which bookings an invoice covers |
| `invoice_revisions` | Full regeneration history — an issued invoice is never silently overwritten |
| `invoice_sequences` | Per-scope counter guaranteeing no duplicate invoice number |
| `payments` | Receipts. Partial payments supported |
| `audit_logs` | Who did what, when, from which IP |
| `enquiries` | Public website contact form |

### Integrity guarantees

- `bookings.booking_code` — UNIQUE
- `(vendor_id, vendor_booking_ref)` — UNIQUE partial index (only when a ref is present), so the
  same vendor can never send the same reference twice
- `invoices.invoice_number` — UNIQUE
- `(invoice_id, booking_id)` — UNIQUE, so a booking cannot appear twice on one invoice
- `booking_charges` — `CHECK (base_fare >= 0 AND discount >= 0 AND total_amount >= 0)`
- `payments` — `CHECK (amount > 0)`
- Foreign keys enforced (`PRAGMA foreign_keys = ON`)

---

## 3. User roles

| Role | Reach |
|------|-------|
| **Super Admin** | Everything, including users and settings |
| **Admin** | All operational modules + settings; can view users and audit, not manage users |
| **Billing User** | Billing, invoices, payments; read-only on bookings and vendors |
| **Operations User** | Full booking entry; read-only vendors and billing |
| **View Only** | Read-only across the portal; no settings, no users |

Permissions are `module.action` — e.g. `bookings.create`, `invoices.update`. The sidebar hides
modules the role cannot reach, and every route re-checks server-side. Super Admin bypasses the
check by role, not by permission list, so it can never be locked out of its own portal.

---

## 4. Booking workflow

```
Vendor sends a WhatsApp message
        ▼
Bookings → New Booking → "Paste vendor message"
        ▼
Parser reads: reference · passenger · mobile · vehicle group · duty type ·
              date · reporting time · pickup · drop · flight no · remarks
        ▼
It also recognises the vendor (sign-off line, then contact number, then format)
and pre-fills the matching fleet vehicle and its driver
        ▼
Operator reviews the parsed table, clicks "Fill the form"
        ▼
Enters the charges — the total recalculates live using the vendor's tax rules
        ▼
Save  /  Save & New  /  Save & Bill
        ▼
Booking code allocated (GTT-B-000001), passenger and locations remembered,
billing_status set to READY
```

### What "minimal effort" means in practice

- Paste-parser instead of retyping
- Vendor dropdown carries its own tax rules, template and consolidation setting
- Booking code, timestamps and billing status generated automatically
- Passenger names, mobiles and locations suggested from history
- Selecting a fleet vehicle fills its number, driver name and driver mobile
- Live total panel mirrors the server's calculation exactly
- **Save & New** keeps the vendor and dates for the next booking in a batch
- **Save & Bill** goes straight to the billing screen with that vendor selected

---

## 5. Billing calculation

Derived from the real Wagon invoice (`Gupta Tours and Wagon Local Invoice 1.xlsx`, sheet `LOCAL`):

```
  Base fare
+ Extra KM        (qty × rate)
+ Extra hours     (qty × rate)
+ Driver allowance + Permit + Night charge + Other charges
− Discount
─────────────────────────────
= Taxable value

  Tax = Taxable value × rate      IGST, or CGST+SGST split half each
  Invoice value = Taxable value + Tax
  Total = Invoice value + Toll & Parking     ← reimbursables are NOT taxed
```

Toll and parking sit **outside** the taxable base by default, exactly as the vendor's own
workbook computes it (`J27 = J25 + J26`). A vendor that wants them taxed sets
**Toll & parking is part of the taxable value** on its vendor record, and both the live form
total and the invoice follow suit.

Tax modes: `IGST` (inter-state), `CGST_SGST` (intra-state, split half each with the rounding
remainder absorbed into SGST), `NONE` (exempt). Rate is per vendor.

Everything is rounded to 2 decimal places at each step, so a stored total never disagrees with
what was displayed.

---

## 6. Invoice workflow

```
Billing → Pending Billing
        │  bookings grouped by vendor, because one invoice = one vendor
        ▼
Tick the bookings → Generate Invoice
        ▼
┌─────────────────────── validation ────────────────────────┐
│ · all bookings belong to the chosen vendor                │
│ · none is cancelled                                       │
│ · none is already on a live invoice                       │
│ · every one has an amount                                 │
│ · consolidation is permitted, if more than one            │
│ · the vendor's template exists and is active              │
│ · a financial year covers the invoice date                │
└───────────────────────────────────────────────────────────┘
        ▼
Reserve the invoice number + write the DB rows  (single transaction)
        ▼
Render the file            (outside the transaction — no lock held during IO)
        ▼
Save under data\invoices\<FY>\<VENDOR>\original\
        ▼
Link bookings · mark them INVOICED · record revision 1 · audit log
        ▼
Preview  ·  Download  ·  Print
```

Failures are explained in plain language, e.g.
*"Booking GTT-B-000004 has already been invoiced on GTT/2026-27/00002."*
*"Template 'Wagon — Local' only supports one booking per invoice. Tick 'Separate invoice per booking', or assign a consolidated template to Wagon Travels."*

### Invoice numbering

Format tokens: `{PREFIX} {FY} {FYSHORT} {YYYY} {YY} {MM} {VENDOR} {SEQ:n}`
Default: `{PREFIX}/{FY}/{SEQ:5}` → `GTT/2026-27/00001`

The sequence is reserved inside the same transaction that writes the invoice row, and
`invoice_number` carries a UNIQUE constraint — so two operators generating at the same instant
cannot collide. Including `{VENDOR}` in the format switches that vendor to its own sequence.

### Regeneration

Regenerating keeps the invoice number and writes a new revision into
`data\invoices\<FY>\<VENDOR>\revised\`, with the previous version retained in
`invoice_revisions`. An invoice with any payment recorded against it cannot be regenerated —
the portal tells you to cancel and reissue instead.

### Cancellation

Requires a reason. The invoice is marked `CANCELLED` and its bookings return to `READY`, so they
can be billed again correctly.

---

## 7. Template system

```
Booking(s) → Vendor → invoice_templates.mapping_json → Writer → file
```

Writers by source type:

| Source | Strategy | Library |
|--------|----------|---------|
| `.xlsx` | Open the original workbook, write mapped cells, save a new file | ExcelJS |
| `.docx` | Replace `{Tag}` placeholders in body, header, footer and tables | docxtemplater |
| PDF (static) | Rebuild as a controlled PDF | PDFKit |
| *no template* | The portal's own PDF layout, with a warning on screen | PDFKit |

### Mapping format

```jsonc
{
  "sheet": "LOCAL",
  "documentTitle": "Credit Note",
  "mode": "single",                  // single | consolidated
  "preserveFormulas": true,
  "formulaCells": ["J18","J19","J23","J24","J25","J27"],
  "cells": {
    "I9":  { "field": "invoice.invoiceNumber" },
    "I11": { "field": "invoice.invoiceDate", "type": "date" },
    "B10": { "field": "vendor.companyName" },
    "B14": { "field": "vendor.gstNumber" },
    "H12": { "field": "booking.vehicleNumber" },
    "I14": { "field": "booking.passengerName" },
    "J17": { "field": "billing.baseFare", "type": "number" },
    "J26": { "field": "billing.tollParking", "type": "number" }
  },
  "lineItems": {                     // consolidated templates only
    "startRow": 17,
    "rowsAvailable": 3,
    "columns": {
      "A": "index",
      "B": "booking.particular",
      "J": { "formula": "=H{row}*I{row}" }
    }
  }
}
```

Two rules keep the vendor's document intact:

- Cells listed in `formulaCells` are **skipped**, so Excel recalculates them itself.
- A cell that already holds a formula is skipped even if it is mapped, unless
  `preserveFormulas` is explicitly `false`.

### Available fields

| Group | Fields |
|-------|--------|
| `company` | name, legalName, owner, mobile, altMobile2, email, addressInvoice, addressInvoice2, city, state, gstin, pan, bankName, bankAccount, bankIfsc |
| `vendor` | vendorName, companyName, billingAddress, gstNumber, pan, contactPerson, mobile, email, city, state, paymentTermsDays |
| `invoice` | invoiceNumber, invoiceDate, documentTitle, periodFrom, periodTo, amountInWords, notes, revision |
| `booking` | bookingCode, vendorBookingRef, travelDate, reportingTime, tripType, dutyType, passengerName, passengerMobile, pickupLocation, dropLocation, route, flightTrainNo, vehicleNumber, vehicleType, driverName, particular |
| `billing` | baseFare, extraKm, extraKmRate, extraHours, extraHourRate, toll, parking, tollParking, driverAllowance, permit, discount, taxableAmount, taxMode, taxRate, cgst, sgst, igst, taxAmount, nonTaxableAmount, invoiceValue, totalAmount |

For a consolidated invoice, additive `billing` components are summed across the bookings, and a
per-unit rate is carried through only when every booking agrees on it — otherwise it is left at
zero rather than quoting a misleading rate.

### Adding a new vendor format

1. **Settings → Invoice Templates → Upload template** — pick the vendor's file.
2. **Inspect cells** — read what is actually in each cell of the workbook.
3. **Edit mapping** — point cells at fields; list the vendor's own formula cells.
4. **Test** — generates a sample invoice from dummy data and downloads it.
5. **Vendors → edit the vendor → Invoice template** — assign it.

No code changes are required for a new vendor.

---

## 8. Payments

- Partial payments supported. Recording one moves the invoice to `PARTIALLY_PAID`; settling the
  balance moves it to `PAID`.
- A payment larger than the outstanding amount is refused with the exact figures in the message.
- Paid and outstanding amounts are **always recomputed from the payment rows**, never incremented
  in place, so reversing a payment restores the correct state.
- Bulk settle marks several invoices paid in full at once; cancelled and already-paid invoices are
  skipped and reported.
- Ageing buckets: 0–30, 31–60, 61–90, 90+ days.

---

## 9. API reference

All routes are under `/api`. Everything except `/api/health` and `/api/public/*` requires a
Bearer token.

| Method | Route | Permission |
|--------|-------|-----------|
| `POST` | `/auth/login` | — |
| `POST` | `/auth/logout` · `GET /auth/me` · `POST /auth/change-password` | signed in |
| `GET` | `/dashboard` · `/dashboard/search` | dashboard.view |
| `GET POST PUT DELETE` | `/vendors` · `/vendors/:id` | vendors.* |
| `GET` | `/vendors/options` | vendors.view or bookings.view |
| `GET POST PUT DELETE` | `/bookings` · `/bookings/:id` | bookings.* |
| `POST` | `/bookings/parse-message` | bookings.create |
| `POST` | `/bookings/:id/duplicate` · `/bookings/bulk-status` | bookings.create / update |
| `GET` | `/bookings/lookup/locations` · `/passengers` · `/vehicles` | bookings.view |
| `GET` | `/billing/pending` · `/billing/vendor-summary` · `/billing/outstanding` | billing.view |
| `POST` | `/invoices/generate` | invoices.create |
| `POST` | `/invoices/:id/regenerate` · `/invoices/:id/cancel` | invoices.update |
| `GET` | `/invoices` · `/invoices/:id` · `/:id/preview` · `/:id/download` | invoices.view |
| `GET POST DELETE` | `/payments` · `/payments/bulk-settle` | payments.* |
| `GET` | `/reports` · `/reports/:key` · `/reports/:key/export` | reports.view |
| `GET PUT` | `/settings` · `/settings/financial-years` · `/settings/vehicles` | settings.* |
| `GET POST PUT DELETE` | `/templates` · `/templates/:id` · `/:id/inspect` · `/:id/test` | settings.* |
| `GET POST PUT DELETE` | `/users` · `/users/roles` | users.* |
| `GET` | `/audit` | audit.view |
| `GET POST` | `/public/company` · `/public/enquiry` | — |

Errors always come back as `{ "error": "plain language message" }`, with `issues[]` added for
field validation. Stack traces are never sent to the browser.

---

## 10. Installation

See `README.md` for the double-click path. Manually:

```bash
cd E:\Portal\GuptaToursAndTravels\backend
npm install && npm run migrate && npm run seed && npm run build

cd ..\frontend
npm install && npm run build

cd ..\backend && npm start        # http://localhost:4100
```

Copy `backend\.env.example` to `backend\.env` to override anything. Every setting has a working
default, so the portal runs without a `.env` file at all.

**Before putting the portal on a shared network, set a real `JWT_SECRET`.**

---

## 11. Backup and restore

```bash
cd backend
npm run backup                                       # database + templates + invoices + assets
npm run backup:list
npx tsx scripts\backup.ts restore backup_2026-08-29_14-30-00
```

Uses SQLite's online backup API — safe while the portal is running. Restore parks a copy of the
current database beside it before overwriting, and clears stale `-wal`/`-shm` files so SQLite
cannot replay them over the restored data.

A sensible routine: run `scripts\backup.bat` at the end of each week, and copy
`data\backups\` to an external drive monthly.

---

## 12. Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| "Cannot reach the server" | The API is not running. Run `scripts\start.bat`. |
| Port 4100 already in use | `netstat -ano \| findstr :4100`, then `taskkill /PID <pid> /F`. Or set `PORT` in `.env`. |
| "Password change required" and nothing works | Expected on first sign-in. Change the password; the portal unlocks. |
| Account locked | Five wrong passwords locks it for 15 minutes. Wait, or run `npm run reset-admin`. |
| Admin password lost | `cd backend && npm run reset-admin` |
| "Vendor has no invoice template assigned" | Settings → Invoice Templates → upload and map it, then assign it on the vendor. |
| "Template only supports one booking per invoice" | Tick **Separate invoice per booking**, or map a consolidated template. |
| "The generated file is missing from disk" | The file was moved or deleted. Open the invoice and click **Regenerate**. |
| No PDF alongside the XLSX | LibreOffice is not installed. Install it (free); the portal detects it automatically. |
| Parser missed a field | The vendor changed their message wording. Fill the field by hand and add the new label to `LABELS` in `backend\src\services\bookingMessageParser.ts`. |
| Charts are empty | No bookings in range. Create bookings, or keep the sample data while testing. |
| `database is locked` | Two servers are running against the same file. Close one. |
| Website looks unstyled | The frontend was not built. `cd frontend && npm run build`. |

---

## 13. Test results

`npm test` — **49 tests, 49 passing** against a throwaway database.

| Area | Covered |
|------|---------|
| Authentication | wrong password, unknown user, identical error messages, forced password change, portal locked until changed, old password invalidated, weak password rejected |
| Message parser | both vendor formats, `+91` normalisation, the capital-A `Reporting Address` case the old sheet failed on, `NA` drop discarded, missing-year warning, empty input |
| Vendors | GSTIN validation, create, duplicate code rejected, billing roll-up, delete blocked when bookings exist |
| Bookings | vendor required, negative amount rejected, toll & parking outside the taxable value, CGST/SGST split, discount before tax, duplicate vendor reference rejected, duplication as draft |
| Invoices | vendor mixing rejected, consolidation rules, generation into the real Wagon template, file written to disk, **source template byte-identical afterwards**, booking marked invoiced, double-invoicing rejected, unique sequential numbering, regeneration keeps the number and adds a revision |
| Payments | over-payment rejected, zero rejected, partial → `PARTIALLY_PAID`, settle → `PAID`, paid invoice cannot be regenerated or cancelled, reversal restores the outstanding amount |
| Cancellation | reason required, bookings released back to the billing queue |
| Permissions | View Only can read but not write, and cannot reach user management |
| Reports & audit | report shape, unknown report rejected, invoice generation and failed sign-ins recorded |
| Public site | company details served without auth, enquiry validation |

`npm run verify-template` — **23 of 23 checks pass** against the real Wagon workbook: static
header and footer untouched (including the original `Invoie No.` typo), all mapped values written,
all six formula cells preserved, all merged ranges intact, source file unchanged at 14,021 bytes.

---

## 14. Completion status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Website works | ✅ 8 pages, responsive |
| 2 | Login works | ✅ real DB auth, bcrypt, lockout, forced change |
| 3 | Dashboard works | ✅ 8 tiles, 4 charts, recent activity, overdue |
| 4 | Vendor management | ✅ full CRUD + per-vendor invoicing config |
| 5 | Booking management | ✅ CRUD, paste-parser, duplicate, bulk actions |
| 6 | Billing works | ✅ pending queue grouped by vendor |
| 7 | Vendor-wise billing | ✅ summary + drill-down + ageing |
| 8 | Templates assignable to vendors | ✅ upload, inspect, map, test, assign |
| 9 | Invoices generate automatically | ✅ one click from selected bookings |
| 10 | Vendor layout preserved | ✅ verified 23/23 on the real template |
| 11 | Invoice numbering | ✅ configurable, sequential, collision-proof |
| 12 | Payment tracking | ✅ partial payments, ageing, bulk settle |
| 13 | Reports | ✅ 8 reports, Excel/CSV export, print |
| 14 | Search and filter | ✅ global search + per-module filters |
| 15 | Audit logs | ✅ 25 action types with user and IP |
| 16 | Role permissions | ✅ 5 roles × 34 permissions, enforced both ends |
| 17 | Data persists | ✅ SQLite WAL with foreign keys |
| 18 | Runs entirely from `E:` | ✅ every path under the project root |
| 19 | No paid service | ✅ all dependencies free/open-source |
| 20 | Documentation | ✅ README + this document + template analysis |
| 21 | Real files used for testing | ✅ Wagon template and both message formats |
