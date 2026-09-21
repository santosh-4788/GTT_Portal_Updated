# Invoice Template Analysis — Gupta Tours & Travels

**Source folder inspected:** `E:\Portal\InvoiceFormat` (READ ONLY — originals never modified)
**Date of analysis:** 2026-08-29
**Analyst:** Claude Code

---

## 1. What is actually in `E:\Portal\InvoiceFormat`

The folder is **not** a clean library of blank invoice templates. It is the live working folder of
the business and contains three very different kinds of content mixed together:

| Kind | Description |
|------|-------------|
| **A. Filled invoice workbooks** | Real invoices already issued to vendors (`.xlsx`). These double as the *format* for each vendor. |
| **B. Vendor booking data dumps** | Monthly/fortnightly booking sheets received from vendors (`.xlsx`). |
| **C. Trip evidence** | Thousands of WhatsApp photos (duty slips, toll receipts, odometer shots) filed in per-passenger folders, plus very large `.zip` archives (`Invoices_1.zip` ≈ 1.59 GB, `Invoices_2.zip` ≈ 798 MB). |

### 1.1 Vendor folders found (top level)

```
AuraFox      CALM         Delhi        Destination   Elcome
FleetOZ_Data JaiBajarang  Mantra       MMT           MTL
Samco        Santa_Fe_Relocation       Versetra      Wagon      ZiT
InvoiceFormat (nested)
```

That is **15 distinct vendor/client streams**, which confirms the requirement in the brief:
*do not hard-code one invoice layout for all vendors.*

### 1.2 Loose files at the root of `InvoiceFormat`

| File | Size | Classification |
|------|------|----------------|
| `DataEntryFormula.xlsx` | 15 KB | **★ Booking-message parser (most important file in the folder)** |
| `Gupta Tours and Wagon Local Invoice 1.xlsx` | 14 KB | Invoice template — Wagon, LOCAL duty |
| `Wagon Invoice.xlsx` / `Wagon Invoice (1).xlsx` | 14 KB | Invoice template — Wagon variants |
| `Gupta Tours and JaiBajarang Invoice 1.xlsx` | 107 KB | Invoice template — Jai Bajrang (multi-booking) |
| `Jai Bajrang Invoice.xlsx` | 14 KB | Invoice template — Jai Bajrang (single) |
| `VERSETRA Invoice 1.xlsx` | 14 KB | Invoice template — Versetra |
| `MLT_Invoice.xlsx` | 16 KB | Invoice template — MTL |
| `Shree Destnation Invoice (2).xlsx` | 13 KB | Invoice template — Shree Destinations |
| `Columbia_Andheri.xlsx` + `.pdf` | 17 KB / 431 KB | Invoice template — Columbia (Excel + PDF rendering of same) |
| `AuraFox Gupta Tours and Travels.xlsx` | 17 KB | Vendor booking data — AuraFox |
| `AuraFox_1FebTo15Feb.xlsx` | 55 KB | Vendor booking data — AuraFox fortnightly |
| `Copy of Jai_Bajrang_Mumbai_Feb_month_data(1).xlsx` | 24 KB | Vendor booking data — Jai Bajrang monthly |
| `Event_21&22(1).xlsx` | 16 KB | Event booking data |
| `Nov_2023.pdf`, `Jackromeo Colas_13May.pdf` | 428 KB / 231 KB | Issued invoices as PDF |
| `GuptaTravelsLogo.jpg` | 50 KB | **Brand asset — copied to `assets/logo-original.jpg`** |
| `Letter_Head.jpg` | 57 KB | **Brand asset — copied to `assets/letterhead.jpg`** |

> **Note on the large ZIPs.** `Invoices_1.zip` (1.59 GB) and `Invoices_2.zip` (798 MB) were **not**
> extracted. Based on the already-extracted `AuraFox\09_03\` tree they contain trip evidence
> photographs, not invoice formats. They are irrelevant to the template engine and extracting them
> would consume ~2.4 GB for no benefit. Flagged as a known limitation — see §7.

---

## 2. ★ The single most important discovery: `DataEntryFormula.xlsx`

This file is **not** an invoice. It is a hand-built Excel parser that reveals how the business
actually receives work, and it is the key to eliminating the Excel workload.

### 2.1 How the business currently works

Vendors send each booking as a **plain-text WhatsApp message**. The operator pastes that message
into column A of this sheet, and a stack of `SUBSTITUTE` / `SEARCH` / `LEFT` / `RIGHT` formulas
strips the labels off to extract the fields, finally assembling one flat output row.

### 2.2 Message format A — "Booking #" style (AuraFox / Shree Destinations)

Raw message pasted into column A:

```
Booking #88245430-1
For T Sridhar(9663655300)
Vehicle group: DZIRE/ETIOS/XCENT
Duty type: TRANSFER 4H40KMS
City: Mumbai
Date: 27/01 to 27/01
Reporting time: 10:00
Reporting address: AI 2846 BLR BOM ETA 10:10HRS T2
Flight/Train Number: NA
Drop address: NA
Remarks: Drop At R. R. Hosiery Bldg, 2nd Floor, ... Mahalaxmi, Mumbai
Regards Shreedestinations Travel Pvt. Ltd.
Contact: +919892616329
Car model 2022-2023 only
Good Condition car
Driver in uniform - No tobacco/Pan/Ghutkha
```

### 2.3 Message format B — "TripId #" style (FleetOZ / MMT)

```
TripId #674HPB-1
Passengers: Behari(+919870139050)
Vehicle Group: Sedan
Duty Type: MMT Flat Rate
City: Mumbai
Date: 30 OCT '24
Reporting Time: 17:45
Reporting Address: Terminal 1, Chhatrapati Shivaji International Airport, Mumbai
Flight/Train Number: N/A
Drop address: Graviss Foods Pvt. Ltd, Apollo Bandar, Colaba, Mumbai, Maharashtra, India
Remarks:
FleetOZ
24x7: +919056058033
```

### 2.4 Extraction rules reverse-engineered from the formulas

| Field | Format A label | Format B label | Extraction logic in the sheet |
|-------|----------------|----------------|-------------------------------|
| Vendor booking ref | `Booking #` | `TripId #` | `SUBSTITUTE(A, "Booking #", "")` |
| Passenger name | `For ` | `Passengers: ` | `LEFT(rest, SEARCH("(", rest) - 1)` |
| Passenger mobile | inside `(...)` | inside `(...)` | `TRIM(RIGHT(...))` then `LEFT(x, LEN(x)-1)` to drop `)` |
| Vehicle group | `Vehicle group: ` | `Vehicle Group: ` | `SUBSTITUTE` |
| Duty type | `Duty type: ` | `Duty Type: ` | `SUBSTITUTE`, then strip the words `LOCAL` / `TRANSFER` to leave the package (e.g. `4H40KMS`) |
| City | `City: ` | `City: ` | `SUBSTITUTE` |
| Travel date | `Date: ` | `Date: ` | `SUBSTITUTE` — **free text**, e.g. `27/01 to 27/01`, `30 OCT '24` |
| Reporting time | `Reporting time: ` | `Reporting Time: ` | `SUBSTITUTE` |
| Pickup address | `Reporting address: ` | `Reporting Address: ` | `SUBSTITUTE` |
| Flight/train no. | `Flight/Train Number:` | same | `SUBSTITUTE` |
| Drop address | `Drop address:` | same | `SUBSTITUTE` |
| Remarks | `Remarks: ` | `Remarks: ` | `SUBSTITUTE` |
| Route (derived) | — | — | `= pickup & " To " & drop` |

### 2.5 Bugs in the existing spreadsheet that the new system fixes

The live formulas are case-sensitive and therefore **already broken** on format B:

- `SUBSTITUTE(A9, "Reporting address: ", "")` fails on `Reporting Address:` (capital *A*),
  so cell `B9` keeps the label and the whole route string comes out as
  `Reporting Address: Terminal 1, ... To Graviss Foods...`.
- `SUBSTITUTE(A14, "Contact: ", "")` on `Contact: +919892616329` leaves `Contact: +919892616329`
  because the source row had a trailing space mismatch.
- Duty-type stripping leaves leading double spaces (`"  4H40KMS"`).

**Design consequence:** the portal's parser must be **case-insensitive, whitespace-tolerant, and
label-aliased**, and must let the operator visually confirm the parsed result before saving.

### 2.6 Output row layout the operator produces today

Row 20 (AuraFox sheet) / row 22 (Transfer sheet) assemble this flat record:

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| Booking ID | Date | Reporting time | Passenger name | Passenger mobile | Pickup **To** Drop | *(blank)* | Duty type | Vehicle group |

This is exactly the `bookings` row the new database stores — so the paste-parser writes straight
into the booking table with no intermediate spreadsheet.

---

## 3. Invoice template analysed in detail: `Gupta Tours and Wagon Local Invoice 1.xlsx`

Sheet name: **`LOCAL`**. Single-booking credit note. Grid is `A..J` × `1..36`.

### 3.1 Layout map

| Rows | Merges | Content | Static / Dynamic |
|------|--------|---------|------------------|
| 1 | `A1:J1` | `GUPTA TOURS AND TRAVELS` | **Static** (from Settings) |
| 2 | `A2:J2` | `706 P-8, New Aman Society, Ajit Glass Garden Road, Somani Gram, Ram Mandir, Goregaon (West).` | **Static** (Settings) |
| 3 | `A3:J3` | ` Mumbai - 400104. Maharashtra. ` | **Static** (Settings) |
| 4 | `A4:J4` | `Contact Details  : 9967381555 / 8591134747` | **Static** (Settings) |
| 5 | `A5:J5` | `GSTIN - 27ALRPG8019M1ZH` | **Static** (Settings) |
| 7 | `A7:J7` | `Credit Note` | **Static** (document title, vendor-configurable) |
| 9 | `A9:F9`, `G9:H9`, `I9:J9` | `Billing Details` \| `Invoie No.` \| `-` | Label static (**note the typo `Invoie` is preserved**); value **dynamic** → `Invoice.InvoiceNumber` |
| 10 | `B10:F10`, `G10:J10` | `Name :` \| `Siemens LTD` | **Dynamic** → `Vendor.CompanyName` |
| 11 | `B11:F13`, `G11:H11`, `I11:J11` | `Address :` \| vendor address \| `Date` \| `45456` | **Dynamic** → `Vendor.BillingAddress`, `Invoice.InvoiceDate` (Excel date serial) |
| 12 | `H12:J12` | `Vehicle No. :-` \| `MH04LQ1748` | **Dynamic** → `Booking.VehicleNumber` |
| 13 | `I13:J13` | `Vehicle Type :` \| `Sedan/Ertiga` | **Dynamic** → `Booking.VehicleType` |
| 14 | `B14:F14`, `I14:J14` | `GSTIN :` \| `27AAACS0764L1Z6` \| `Guest Name :` \| `Mahesh Kale` | **Dynamic** → `Vendor.GSTNumber`, `Booking.PassengerName` |
| 16 | — | `Sr. No.` \| `Particular` \| `KM/HRS` \| `RS` \| `Amount` | **Static** table header |
| 17 | `B17:E17` | `1` \| `Basic Fare` \| — \| — \| `1100` | **Dynamic** → `Billing.BaseFare` |
| 18 | `B18:E18` | `2` \| `Extra KM` \| qty | rate | `=H18*I18` | **Dynamic** qty/rate, **formula preserved** |
| 19 | `B19:E19` | `3` \| `Extra Hours` \| qty | rate | `=H19*I19` | **Dynamic** qty/rate, **formula preserved** |
| 23 | `B23:E23` | `Taxable Value` \| `=J17+J18+J19` | **Formula preserved** |
| 24 | `G24:H24` | `IGST 5%` \| `=J23*5%` | **Formula preserved** — rate is vendor-configurable |
| 25 | `B25:E25`, `G25:H25` | `Invoice Value` \| `=J23+J24` | **Formula preserved** |
| 26 | `B26:E26`, `G26:I26` | `Toll & Parking Charges` \| `0` | **Dynamic** → `Billing.Toll + Billing.Parking` |
| 27 | `B27:E27`, `G27:I27` | `Total` \| `=J25+J26` | **Formula preserved** |
| 28 | `B28:E28` | *(amount in words placeholder)* | Dynamic (optional) |
| 31 | — | `PAN NO : ALRPG8019M` | **Static** (Settings) |
| 32–36 | `G35:J35`, `G36:J36` | Bank block + `Vinay Gupta` / `Authorised Signatory` | **Static** (Settings) |

### 3.2 Critical observations

1. **Toll & Parking sits *outside* the taxable value.** `Total = (Taxable + IGST) + Toll&Parking`.
   Reimbursables are not taxed. This is correct GST practice for pure-agent expenses and must
   **not** be "simplified" into the taxable base.
2. **`IGST 5%`** — inter-state GST at the 5% cab rate (no ITC). Other vendors in the folder will
   use `CGST 2.5% + SGST 2.5%` for intra-Maharashtra billing. Tax structure is therefore a
   **per-vendor configuration**, exactly as the brief requires.
3. The document is titled **`Credit Note`**, not `Tax Invoice` — the document title must be a
   per-vendor setting.
4. The label `Invoie No.` is **misspelled in the original**. The engine writes *values into cells*
   and never rewrites labels, so the vendor keeps receiving the layout they are used to. This is a
   deliberate design decision, not an oversight.
5. `Date` is stored as the **Excel serial `45456`** (= 2024-06-14), not a string. The writer must
   emit a real date-typed cell so the existing number format renders correctly.
6. Charge lines are a **fixed 3-row block** (Basic Fare / Extra KM / Extra Hours). This template is
   **single-booking**; consolidation is not possible in this layout. Contrast with
   `Gupta Tours and JaiBajarang Invoice 1.xlsx` (107 KB — 7× larger), which is the multi-booking
   consolidated layout.

---

## 4. Company master data recovered (real — nothing invented)

Cross-verified between `Letter_Head.jpg` and the Wagon invoice header. Seeded into **Settings**.

| Field | Value | Source |
|-------|-------|--------|
| Company name | Gupta Tours & Travels | Letterhead + invoice |
| Tagline | Corporate Transport Car Rental and Outstation | Letterhead |
| Service promise | 24×7 Service | Letterhead |
| Owner / Authorised signatory | Vinay Gupta | Invoice row 35 |
| Address (letterhead form) | P-8, Building, New Aman CHS Ltd., Ajit Glass Garden Road, Goregaon (W), Mumbai - 400 104 | Letterhead |
| Address (invoice form) | 706 P-8, New Aman Society, Ajit Glass Garden Road, Somani Gram, Ram Mandir, Goregaon (West), Mumbai - 400104, Maharashtra | Invoice rows 2–3 |
| Mobile | 9967381555 | Letterhead + invoice + brief |
| Alternate mobiles | 8591134747 (invoice) | The letterhead's second line was removed from the project; the site and emails dial one number from a Call button rather than printing it |
| Email | vinaykumar87674@gmail.com | Letterhead |
| GSTIN | 27ALRPG8019M1ZH | Letterhead + invoice |
| PAN | ALRPG8019M | Invoice row 31 |
| Bank | SBI (Goregaon West) | Invoice row 35 |
| A/C No. | 30266344366 | Invoice row 33 |
| IFSC | SBIN0001266 | Invoice row 34 |

> Both address forms are kept: `company.address.letterhead` for the public website and
> `company.address.invoice` for generated documents, because the vendors already recognise the
> invoice form.

---

## 5. Proposed template architecture

The engine never regenerates a layout from scratch. It **opens the original workbook as a binary
template, writes values into known cells, and saves a new file** — so every border, merge, font,
column width, print area and formula survives untouched.

```
Booking(s) ──► BillingRecord ──► Vendor ──► VendorInvoiceTemplate
                                                   │
                                                   ▼
                                          TemplateMapping (JSON)
                                                   │
                                                   ▼
                              ┌────────────────────┴────────────────────┐
                              │          Invoice Generator              │
                              │  XlsxCellWriter │ DocxTagWriter │ Pdf   │
                              └────────────────────┬────────────────────┘
                                                   ▼
                            data/invoices/<FY>/<Vendor>/INV-....xlsx
```

### 5.1 Mapping record shape

Rather than hard-coding one vendor per code path, each template carries a JSON mapping:

```jsonc
{
  "templateFile": "Gupta Tours and Wagon Local Invoice 1.xlsx",
  "sheet": "LOCAL",
  "documentTitle": "Credit Note",
  "mode": "single",                  // "single" | "consolidated"
  "taxMode": "IGST",                 // "IGST" | "CGST_SGST" | "NONE"
  "taxRate": 5,
  "tollParkingTaxable": false,       // Toll & Parking added AFTER tax
  "preserveFormulas": true,
  "cells": {
    "G9":  { "static": "Invoie No." },
    "I9":  { "field": "invoice.invoiceNumber" },
    "I11": { "field": "invoice.invoiceDate", "type": "date" },
    "B10": { "field": "vendor.companyName" },
    "B11": { "field": "vendor.billingAddress" },
    "B14": { "field": "vendor.gstNumber" },
    "H12": { "field": "booking.vehicleNumber" },
    "I13": { "field": "booking.vehicleType" },
    "I14": { "field": "booking.passengerName" },
    "J17": { "field": "billing.baseFare",   "type": "number" },
    "H18": { "field": "billing.extraKm",    "type": "number" },
    "I18": { "field": "billing.extraKmRate","type": "number" },
    "H19": { "field": "billing.extraHours", "type": "number" },
    "I19": { "field": "billing.extraHourRate","type": "number" },
    "J26": { "field": "billing.tollParking","type": "number" }
  },
  "formulaCells": ["J18","J19","J23","J24","J25","J27"]
}
```

`formulaCells` are listed explicitly so the writer **skips** them — Excel recalculates on open.

### 5.2 Consolidated (multi-booking) templates

For layouts such as Jai Bajrang, the mapping additionally declares a repeating block:

```jsonc
"lineItems": {
  "startRow": 17,
  "rowsAvailable": 3,        // insert rows beyond this, copying style from startRow
  "columns": {
    "A": "index",
    "B": "booking.particular",
    "H": "billing.qty",
    "I": "billing.rate",
    "J": { "formula": "=H{row}*I{row}" }
  }
}
```

### 5.3 Writer strategies by file type

| Source type | Strategy | Library |
|-------------|----------|---------|
| `.xlsx` | Load original workbook → write mapped cells → save as new file. Styles/merges/formulas intact. | **ExcelJS** |
| `.docx` | Load original → replace `{Placeholder}` tags in body, header, footer and tables. | **docxtemplater** + PizZip |
| Fillable `.pdf` | Populate existing AcroForm fields, flatten. | **pdf-lib** |
| Static `.pdf` | Treat the PDF as visual reference only; rebuild the layout as a controlled PDF. | **PDFKit** |
| `.xlsx` → `.pdf` | Optional; requires LibreOffice headless. | see §7 |

---

## 6. Per-vendor configuration derived from this analysis

Every vendor record carries:

| Setting | Why it exists | Example (Wagon) |
|---------|---------------|-----------------|
| `invoiceTemplateId` | Vendors do not share layouts | Wagon LOCAL |
| `documentTitle` | Some say `Tax Invoice`, Wagon says `Credit Note` | `Credit Note` |
| `taxMode` / `taxRate` | IGST vs CGST+SGST vs exempt | `IGST` / `5` |
| `tollParkingTaxable` | Reimbursables outside the tax base | `false` |
| `consolidationAllowed` | Single-booking vs monthly consolidated | `false` |
| `invoicePrefix` / `numberFormat` | Vendor-specific numbering | `GTT/{FY}/{SEQ:5}` |
| `bookingMessageFormat` | Which paste-parser profile to use | `BOOKING_HASH` |
| `billingCycle` | Per-trip, fortnightly, monthly | Monthly |
| `paymentTerms` | Outstanding ageing | 30 days |

---

## 7. Known limitations

1. **`Invoices_1.zip` (1.59 GB) and `Invoices_2.zip` (798 MB) were not extracted.** Sampling of the
   already-extracted `AuraFox\09_03\` tree shows trip-evidence photographs, not invoice formats.
   Extraction can be run later if a template is believed to be inside.
2. **LibreOffice is not installed on this machine** (`soffice` not on PATH). XLSX→PDF and DOCX→PDF
   conversion is therefore wired as an *optional* step that activates automatically if LibreOffice
   is later installed. Native XLSX/DOCX output and native PDFKit output work without it.
3. **The `Date:` field in vendor messages is free text** (`27/01 to 27/01`, `30 OCT '24`). The
   parser normalises the common shapes and asks the operator to confirm anything ambiguous rather
   than guessing a year.
4. Only the Wagon LOCAL template is mapped cell-by-cell in this first pass. The remaining templates
   are registered in the template library and are mapped through the same JSON structure — no new
   code is required per vendor.

---

## 8. Toolchain verified on this machine

| Tool | Status |
|------|--------|
| Node.js | ✅ v22.14.0 |
| npm | ✅ 10.9.2 |
| Python | ✅ 3.14 (used for this read-only analysis) |
| Git | ✅ present |
| LibreOffice | ❌ not installed (optional — see §7) |
| Free disk on `E:` | ✅ 472 GB |
