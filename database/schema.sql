-- ============================================================================
-- Gupta Tours & Travels — Booking / Vendor Billing / Invoice Management
-- SQLite schema
-- ============================================================================
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Auth & access control
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,          -- SUPER_ADMIN | ADMIN | BILLING | OPERATIONS | VIEWER
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT NOT NULL UNIQUE,          -- e.g. bookings.create
  module        TEXT NOT NULL,                 -- dashboard|bookings|vendors|billing|invoices|payments|reports|settings|users|audit
  description   TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  email                 TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  role_id               INTEGER NOT NULL REFERENCES roles(id),
  mobile                TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  last_login_at         TEXT,
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

-- ---------------------------------------------------------------------------
-- Company settings (key/value so new settings need no migration)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  category    TEXT NOT NULL DEFAULT 'general',
  data_type   TEXT NOT NULL DEFAULT 'string',  -- string|number|boolean|json
  label       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by  INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS financial_years (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,            -- 2026-27
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  is_closed   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Invoice templates  (the originals in E:\Portal\InvoiceFormat are never touched;
-- a working copy is stored under templates/)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_templates (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  description        TEXT,
  file_name          TEXT NOT NULL,            -- stored filename under templates/
  original_name      TEXT,                     -- name as found in InvoiceFormat
  source_path        TEXT,                     -- provenance, read-only reference
  file_type          TEXT NOT NULL,            -- xlsx | docx | pdf_fillable | pdf_static
  sheet_name         TEXT,                     -- for xlsx
  document_title     TEXT DEFAULT 'Tax Invoice',
  mode               TEXT NOT NULL DEFAULT 'single',   -- single | consolidated
  mapping_json       TEXT NOT NULL DEFAULT '{}',       -- cell/tag -> field mapping
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         INTEGER REFERENCES users(id)
);

-- Optional normalised view of the mapping for the UI mapping editor
CREATE TABLE IF NOT EXISTS invoice_template_mappings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id    INTEGER NOT NULL REFERENCES invoice_templates(id) ON DELETE CASCADE,
  target         TEXT NOT NULL,                -- cell ref (B10) or docx tag ({VendorName})
  source_field   TEXT,                         -- vendor.companyName / booking.passengerName / ...
  static_value   TEXT,                         -- used when source_field is null
  value_type     TEXT NOT NULL DEFAULT 'string', -- string|number|date|currency
  notes          TEXT,
  UNIQUE (template_id, target)
);

-- ---------------------------------------------------------------------------
-- Vendors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  code                  TEXT NOT NULL UNIQUE,  -- short code used in invoice numbers / folders
  vendor_name           TEXT NOT NULL,
  company_name          TEXT,
  contact_person        TEXT,
  mobile                TEXT,
  alt_mobile            TEXT,
  email                 TEXT,
  address               TEXT,
  city                  TEXT,
  state                 TEXT,
  pincode               TEXT,
  gst_number            TEXT,
  pan                   TEXT,
  billing_address       TEXT,
  payment_terms_days    INTEGER NOT NULL DEFAULT 30,
  bank_name             TEXT,
  account_number        TEXT,
  ifsc                  TEXT,
  upi                   TEXT,
  status                TEXT NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE | INACTIVE

  -- invoicing configuration
  invoice_template_id   INTEGER REFERENCES invoice_templates(id),
  invoice_prefix        TEXT NOT NULL DEFAULT 'GTT',
  invoice_number_format TEXT NOT NULL DEFAULT '{PREFIX}/{FY}/{SEQ:5}',
  document_title        TEXT DEFAULT 'Tax Invoice',
  tax_mode              TEXT NOT NULL DEFAULT 'IGST',      -- IGST | CGST_SGST | NONE
  tax_rate              REAL NOT NULL DEFAULT 5,
  toll_parking_taxable  INTEGER NOT NULL DEFAULT 0,        -- 0 = added after tax
  consolidation_allowed INTEGER NOT NULL DEFAULT 0,
  billing_cycle         TEXT NOT NULL DEFAULT 'PER_TRIP',  -- PER_TRIP | FORTNIGHTLY | MONTHLY
  booking_message_format TEXT DEFAULT 'AUTO',              -- AUTO | BOOKING_HASH | TRIPID_HASH | NONE

  notes                 TEXT,
  is_sample             INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors(status);
CREATE INDEX IF NOT EXISTS idx_vendors_name   ON vendors(vendor_name);

-- ---------------------------------------------------------------------------
-- Rate cards (the Master)
--
-- What a vendor pays for a given vehicle class on a given plan. One row per
-- (vendor, vehicle class, plan), so AuraFox's Innova on 8H/80KM is a different
-- row from Wagon's, which is the whole point — no two accounts pay the same.
--
-- The rows belonging to the reserved DIRECT vendor are the retail price list,
-- and are the only ones the public website is allowed to read. Contract rates
-- never leave the portal.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rate_cards (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id         INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  vehicle_category  TEXT NOT NULL,                    -- 'Sedan', 'Innova Crysta', ...
  plan_type         TEXT NOT NULL DEFAULT 'LOCAL',    -- LOCAL | AIRPORT | OUTSTATION
  plan_label        TEXT NOT NULL,                    -- '8H/80KM', 'Airport transfer', 'Per km'

  -- LOCAL: what the base fare buys before the extras start
  included_hours    REAL NOT NULL DEFAULT 0,
  included_km       REAL NOT NULL DEFAULT 0,
  base_fare         REAL NOT NULL DEFAULT 0,
  extra_hour_rate   REAL NOT NULL DEFAULT 0,
  extra_km_rate     REAL NOT NULL DEFAULT 0,

  -- OUTSTATION: charged on distance with a floor per day
  per_km_rate       REAL NOT NULL DEFAULT 0,
  min_km_per_day    REAL NOT NULL DEFAULT 0,
  driver_allowance  REAL NOT NULL DEFAULT 0,          -- per night away

  notes             TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (base_fare >= 0 AND per_km_rate >= 0 AND extra_km_rate >= 0 AND extra_hour_rate >= 0)
);
CREATE INDEX IF NOT EXISTS idx_rate_cards_vendor ON rate_cards(vendor_id, is_active);
-- One rate per vehicle class per plan per vendor; re-adding the same one is an
-- edit, not a second row that silently shadows the first.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rate_cards
  ON rate_cards(vendor_id, vehicle_category, plan_label);

-- ---------------------------------------------------------------------------
-- Passengers (suggestion source — reduces typing on repeat guests)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passengers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  mobile        TEXT,
  email         TEXT,
  vendor_id     INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  company       TEXT,
  trip_count    INTEGER NOT NULL DEFAULT 0,
  last_trip_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name, mobile)
);
CREATE INDEX IF NOT EXISTS idx_passengers_mobile ON passengers(mobile);

-- Frequently used pickup/drop points — powers autocomplete
CREATE TABLE IF NOT EXISTS locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL UNIQUE,
  city        TEXT,
  kind        TEXT,                             -- AIRPORT | HOTEL | OFFICE | STATION | OTHER
  use_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Vehicles / fleet
CREATE TABLE IF NOT EXISTS vehicles (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_number TEXT NOT NULL UNIQUE,
  vehicle_type   TEXT NOT NULL,                 -- Sedan | SUV | Ertiga | Innova | Tempo ...
  model          TEXT,
  seating        INTEGER,
  driver_name    TEXT,
  driver_mobile  TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Bookings — the single point of data entry
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_code         TEXT NOT NULL UNIQUE,     -- GTT-B-000123 (auto)
  vendor_id            INTEGER NOT NULL REFERENCES vendors(id),
  vendor_booking_ref   TEXT,                     -- "Booking #88245430-1" / "TripId #674HPB-1"

  booking_date         TEXT NOT NULL DEFAULT (date('now')),
  travel_date          TEXT NOT NULL,
  travel_date_to       TEXT,                     -- multi-day duties
  reporting_time       TEXT,

  -- trip
  trip_type            TEXT NOT NULL DEFAULT 'LOCAL',  -- LOCAL|TRANSFER|OUTSTATION|AIRPORT|ROUND_TRIP|PACKAGE
  duty_type            TEXT,                     -- free text e.g. "4H40KMS", "MMT Flat Rate"
  city                 TEXT,
  pickup_location      TEXT,
  pickup_address       TEXT,
  drop_location        TEXT,
  drop_address         TEXT,
  flight_train_no      TEXT,
  trip_distance_km     REAL,
  trip_duration_hrs    REAL,

  -- passenger
  passenger_id         INTEGER REFERENCES passengers(id) ON DELETE SET NULL,
  passenger_name       TEXT,
  passenger_mobile     TEXT,
  passenger_email      TEXT,
  pax_count            INTEGER,
  bag_count            INTEGER,

  -- vehicle
  vehicle_id           INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  vehicle_type         TEXT,
  vehicle_number       TEXT,
  driver_name          TEXT,
  driver_mobile        TEXT,

  special_instructions TEXT,
  remarks              TEXT,
  raw_message          TEXT,                     -- original pasted vendor message

  booking_status       TEXT NOT NULL DEFAULT 'CONFIRMED', -- DRAFT|CONFIRMED|COMPLETED|CANCELLED|NO_SHOW
  billing_status       TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|READY|INVOICED|CANCELLED
  is_sample            INTEGER NOT NULL DEFAULT 0,

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  created_by           INTEGER REFERENCES users(id),
  updated_by           INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_vendor       ON bookings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_travel_date  ON bookings(travel_date);
CREATE INDEX IF NOT EXISTS idx_bookings_billing      ON bookings(billing_status);
CREATE INDEX IF NOT EXISTS idx_bookings_status       ON bookings(booking_status);
CREATE INDEX IF NOT EXISTS idx_bookings_passenger    ON bookings(passenger_name);
-- A vendor's own booking reference must be unique within that vendor (when present)
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_vendor_ref
  ON bookings(vendor_id, vendor_booking_ref)
  WHERE vendor_booking_ref IS NOT NULL AND vendor_booking_ref <> '';

-- ---------------------------------------------------------------------------
-- Charges — one row per booking (kept 1:1 for simplicity, extras in extra_json)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_charges (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id         INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  base_fare          REAL NOT NULL DEFAULT 0,
  extra_km           REAL NOT NULL DEFAULT 0,
  extra_km_rate      REAL NOT NULL DEFAULT 0,
  extra_hours        REAL NOT NULL DEFAULT 0,
  extra_hour_rate    REAL NOT NULL DEFAULT 0,
  toll               REAL NOT NULL DEFAULT 0,
  parking            REAL NOT NULL DEFAULT 0,
  driver_allowance   REAL NOT NULL DEFAULT 0,
  permit             REAL NOT NULL DEFAULT 0,
  night_charge       REAL NOT NULL DEFAULT 0,
  other_charges      REAL NOT NULL DEFAULT 0,
  other_charges_note TEXT,
  discount           REAL NOT NULL DEFAULT 0,

  -- computed & stored so reports never have to re-derive
  taxable_amount     REAL NOT NULL DEFAULT 0,
  tax_mode           TEXT NOT NULL DEFAULT 'IGST',
  tax_rate           REAL NOT NULL DEFAULT 5,
  cgst               REAL NOT NULL DEFAULT 0,
  sgst               REAL NOT NULL DEFAULT 0,
  igst               REAL NOT NULL DEFAULT 0,
  tax_amount         REAL NOT NULL DEFAULT 0,
  non_taxable_amount REAL NOT NULL DEFAULT 0,   -- toll+parking when not taxable
  total_amount       REAL NOT NULL DEFAULT 0,
  advance            REAL NOT NULL DEFAULT 0,
  balance            REAL NOT NULL DEFAULT 0,

  extra_json         TEXT NOT NULL DEFAULT '{}',
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (base_fare >= 0 AND discount >= 0 AND total_amount >= 0)
);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number      TEXT NOT NULL UNIQUE,
  vendor_id           INTEGER NOT NULL REFERENCES vendors(id),
  template_id         INTEGER REFERENCES invoice_templates(id),
  financial_year_id   INTEGER REFERENCES financial_years(id),

  invoice_date        TEXT NOT NULL DEFAULT (date('now')),
  due_date            TEXT,
  period_from         TEXT,
  period_to           TEXT,
  booking_count       INTEGER NOT NULL DEFAULT 0,

  taxable_amount      REAL NOT NULL DEFAULT 0,
  tax_mode            TEXT NOT NULL DEFAULT 'IGST',
  tax_rate            REAL NOT NULL DEFAULT 5,
  cgst                REAL NOT NULL DEFAULT 0,
  sgst                REAL NOT NULL DEFAULT 0,
  igst                REAL NOT NULL DEFAULT 0,
  tax_amount          REAL NOT NULL DEFAULT 0,
  non_taxable_amount  REAL NOT NULL DEFAULT 0,
  discount            REAL NOT NULL DEFAULT 0,
  total_amount        REAL NOT NULL DEFAULT 0,
  paid_amount         REAL NOT NULL DEFAULT 0,
  outstanding_amount  REAL NOT NULL DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'GENERATED',
    -- GENERATED | SENT | PARTIALLY_PAID | PAID | CANCELLED
  revision            INTEGER NOT NULL DEFAULT 1,
  file_path           TEXT,                     -- relative to data/invoices
  file_type           TEXT,
  notes               TEXT,
  cancelled_reason    TEXT,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  generated_by        INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor ON invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date   ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- Which bookings an invoice covers (many-to-one; a booking may only be on one live invoice)
CREATE TABLE IF NOT EXISTS invoice_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  booking_id     INTEGER NOT NULL REFERENCES bookings(id),
  line_no        INTEGER NOT NULL DEFAULT 1,
  particular     TEXT,
  qty            REAL,
  rate           REAL,
  amount         REAL NOT NULL DEFAULT 0,
  UNIQUE (invoice_id, booking_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_booking ON invoice_items(booking_id);

-- Revision history — an issued invoice is never silently overwritten
CREATE TABLE IF NOT EXISTS invoice_revisions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  revision        INTEGER NOT NULL,
  file_path       TEXT,
  total_amount    REAL,
  reason          TEXT,
  snapshot_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      INTEGER REFERENCES users(id),
  UNIQUE (invoice_id, revision)
);

-- Per-vendor, per-FY invoice sequence — guarantees no duplicate numbers
CREATE TABLE IF NOT EXISTS invoice_sequences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  scope             TEXT NOT NULL,              -- e.g. "GTT|2026-27" or "WAGON|2026-27"
  last_number       INTEGER NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scope)
);

-- ---------------------------------------------------------------------------
-- Payments (partial payments supported)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id     INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  vendor_id      INTEGER NOT NULL REFERENCES vendors(id),
  payment_date   TEXT NOT NULL DEFAULT (date('now')),
  amount         REAL NOT NULL,
  mode           TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    -- CASH | BANK_TRANSFER | UPI | NEFT | RTGS | CHEQUE | OTHER
  reference_no   TEXT,
  bank           TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_by     INTEGER REFERENCES users(id),
  CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_vendor  ON payments(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payments(payment_date);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id),
  user_email    TEXT,
  action        TEXT NOT NULL,                  -- LOGIN | BOOKING_CREATED | INVOICE_GENERATED ...
  entity_type   TEXT,                           -- booking | vendor | invoice | payment | user | settings
  entity_id     INTEGER,
  description   TEXT,
  ip_address    TEXT,
  user_agent    TEXT,
  meta_json     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user   ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_date   ON audit_logs(created_at);

-- ---------------------------------------------------------------------------
-- Public website enquiries (Contact Us form)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enquiries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  mobile       TEXT NOT NULL,
  email        TEXT,
  service      TEXT,
  pickup       TEXT,
  drop_off     TEXT,
  travel_date  TEXT,
  message      TEXT,
  status       TEXT NOT NULL DEFAULT 'NEW',     -- NEW | CONTACTED | CONVERTED | CLOSED
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_enquiries_status ON enquiries(status);

-- ===========================================================================
-- CUSTOMER JOURNEY
--
-- Everything below belongs to the end-to-end journey a retail customer sees:
-- an enquiry gets a Trip ID, the office assigns a car and a driver, the trip
-- runs, an invoice is raised, and the customer reads all of it back from their
-- own account. The tables the office already used (bookings, booking_charges,
-- invoices) carry the trip itself — these add the parts that did not exist:
-- who the customer is, who drives, what happened when, and what was emailed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Customer accounts (public website login)
--
-- Deliberately NOT the `users` table. Staff accounts carry roles, permissions
-- and lockout policy for the admin portal; a customer has none of that and must
-- never be able to reach it. Two tables, two token audiences, no overlap.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name      TEXT NOT NULL,
  mobile         TEXT,
  -- NULL for an account that has only ever signed in with Google.
  password_hash  TEXT,
  google_sub     TEXT UNIQUE,
  picture_url    TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  company        TEXT,
  gstin          TEXT,
  address        TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until   TEXT,
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);

-- ---------------------------------------------------------------------------
-- Drivers
--
-- Until now a driver was two free-text columns on the vehicle, which is fine
-- for a booking sheet but cannot answer "which trips did this driver run".
-- The columns stay (they are what the invoice prints); this is the roster the
-- office assigns from.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  mobile         TEXT NOT NULL,
  alt_mobile     TEXT,
  licence_number TEXT,
  licence_expiry TEXT,
  badge_number   TEXT,
  address        TEXT,
  languages      TEXT,
  experience_years REAL,
  default_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  notes          TEXT,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (full_name, mobile)
);
CREATE INDEX IF NOT EXISTS idx_drivers_active ON drivers(is_active);

-- ---------------------------------------------------------------------------
-- Trip timeline
--
-- One row per thing that happened to a trip, in order. This is what the
-- customer's status trail and the admin's activity strip both read from, so
-- neither has to infer history from the current status alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  trip_id     TEXT,
  status      TEXT NOT NULL,   -- INQUIRY|CONFIRMED|ASSIGNED|ONTRIP|COMPLETED|CANCELLED|INVOICED|EMAIL_SENT
  title       TEXT NOT NULL,
  detail      TEXT,
  -- Shown to the customer, or internal only.
  is_public   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_trip_events_booking ON trip_events(booking_id);

-- ---------------------------------------------------------------------------
-- Sequence allocator for Trip IDs — same guarantee as invoice_sequences.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_sequences (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL UNIQUE,   -- "EM|2609", "WA|2609", ...
  last_number INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Outgoing email log
--
-- Every message the portal tries to send is written here first, then marked
-- SENT or FAILED. A misconfigured mailbox therefore never loses an enquiry and
-- never breaks a request: the office can see exactly what did not go out and
-- retry it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,   -- INQUIRY_ADMIN | INQUIRY_CUSTOMER | TRIP_DETAILS | INVOICE | ACCOUNT
  to_address   TEXT NOT NULL,
  cc_address   TEXT,
  from_address TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body_html    TEXT,
  body_text    TEXT,
  attachment   TEXT,            -- file path, relative to data/invoices
  booking_id   INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  invoice_id   INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  trip_id      TEXT,
  status       TEXT NOT NULL DEFAULT 'QUEUED',  -- QUEUED | SENT | FAILED
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  sent_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_email_log_status  ON email_log(status);
CREATE INDEX IF NOT EXISTS idx_email_log_booking ON email_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);

-- ---------------------------------------------------------------------------
-- Addresses and road distance.
--
-- Three tables, and two of them exist purely so the free map services are
-- asked as little as possible: a place looked up once is never looked up
-- again, and a route measured once is never measured again. The third is the
-- month's meter, which is what makes the "stop at the free limit" promise
-- something the portal enforces rather than something it hopes for.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_places (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  query       TEXT NOT NULL UNIQUE,              -- the typed text, normalised
  payload     TEXT NOT NULL,                     -- JSON array of matches
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geo_routes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key    TEXT NOT NULL UNIQUE,             -- 'lat,lon>lat,lon', 5dp
  distance_km  REAL NOT NULL,
  duration_min REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS geo_usage (
  month      TEXT PRIMARY KEY,                   -- 'YYYY-MM', local time
  searches   INTEGER NOT NULL DEFAULT 0,
  routes     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The two settings the address/distance feature needs, created on every boot so
-- an existing database picks them up without re-running the seed. INSERT OR
-- IGNORE means an office that has changed the limit keeps its own value.
INSERT OR IGNORE INTO settings (key, value, category, data_type, label) VALUES
  ('maps.enabled',      'true', 'maps', 'boolean', 'Look up addresses and distance'),
  ('maps.monthlyLimit', '2000', 'maps', 'number',  'Address/distance lookups allowed per month');

-- ---------------------------------------------------------------------------
-- Outstation fixed fares.
--
-- The popular routes out of Mumbai are sold at one published price per vehicle
-- category, toll included, rather than per kilometre. One row per route per
-- category. A NULL fare means "not priced yet": the website then shows Fare on
-- request for that category instead of inventing a number, which is how the
-- premium and return fares start until the office fills them in.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outstation_fares (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  route_key      TEXT NOT NULL,                   -- 'lonavala'
  origin         TEXT NOT NULL DEFAULT 'Mumbai',
  destination    TEXT NOT NULL,                   -- 'Lonavala'
  category       TEXT NOT NULL CHECK (category IN ('STANDARD','SUV_MUV','PREMIUM_SEDAN','PREMIUM_MUV')),
  vehicles       TEXT NOT NULL,                   -- 'Dzire / Aura'
  one_way_fare   REAL CHECK (one_way_fare IS NULL OR one_way_fare >= 0),
  return_fare    REAL CHECK (return_fare IS NULL OR return_fare >= 0),
  toll_included  INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_outstation_fares_route_cat ON outstation_fares(route_key, category);

-- ---------------------------------------------------------------------------
-- Website assistant conversations.
--
-- Every chat is kept so the office can see exactly what a customer asked, what
-- the assistant answered, which vehicles and fares it showed, and when the
-- booking was confirmed. chat_messages is APPEND-ONLY: nothing updates or
-- deletes a row, so the original conversation is never overwritten; a later
-- change (a modified detail, the booking being created) is a new row with its
-- own time. chat_sessions only carries the latest headline for the list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  id             TEXT PRIMARY KEY,                -- random id made by the browser
  started_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_at        TEXT NOT NULL DEFAULT (datetime('now')),
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','BOOKED')),
  trip_id        TEXT,
  booking_id     INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  customer_name  TEXT,
  mobile         TEXT,
  email          TEXT,
  summary_json   TEXT,                            -- latest trip/plan headline
  page           TEXT,
  user_agent     TEXT,
  ip_address     TEXT
);
CREATE INDEX IF NOT EXISTS ix_chat_sessions_last ON chat_sessions(last_at);
CREATE INDEX IF NOT EXISTS ix_chat_sessions_trip ON chat_sessions(trip_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,                   -- order within the chat
  at          TEXT NOT NULL,                      -- when it was said (browser time, ISO)
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  sender      TEXT NOT NULL CHECK (sender IN ('customer','assistant','system')),
  text        TEXT NOT NULL,
  data_json   TEXT                                -- options shown, fares and how they were worked out
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_messages_seq ON chat_messages(session_id, seq);

-- ---------------------------------------------------------------------------
-- Customer feedback on a completed trip.
--
-- One row per booking, created the moment the office marks the trip completed
-- and the feedback email is sent. The UNIQUE booking_id is what stops a second
-- email going out when the completed booking is opened or saved again, and the
-- random token in the email link is the only way in — Trip IDs run in
-- sequence, so they are not secret enough to open a form on their own.
--
-- Who ran the trip (driver, vehicle, route, date) is copied onto the row when
-- the customer submits, so the admin's filters still read true if the booking
-- is edited afterwards.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_feedback (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  trip_id         TEXT,
  token           TEXT NOT NULL UNIQUE,
  customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name   TEXT,
  sent_to         TEXT,                          -- the address the link went to
  email_log_id    INTEGER REFERENCES email_log(id) ON DELETE SET NULL,
  email_status    TEXT,                          -- SENT | QUEUED | FAILED | NO_EMAIL
  requested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  requested_by    INTEGER REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED')),
  -- An admin can re-open a submitted form once; submitting clears it again.
  allow_resubmit  INTEGER NOT NULL DEFAULT 0,

  driver_rating   INTEGER CHECK (driver_rating BETWEEN 1 AND 5),
  service_rating  INTEGER CHECK (service_rating BETWEEN 1 AND 5),
  vehicle_rating  INTEGER CHECK (vehicle_rating BETWEEN 1 AND 5),
  overall_rating  INTEGER CHECK (overall_rating BETWEEN 1 AND 5),
  comments        TEXT,
  submitted_at    TEXT,
  submit_count    INTEGER NOT NULL DEFAULT 0,

  -- snapshot of the trip at submission
  travel_date     TEXT,
  pickup          TEXT,
  drop_off        TEXT,
  driver_id       INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name     TEXT,
  vehicle_type    TEXT,
  vehicle_number  TEXT
);
CREATE INDEX IF NOT EXISTS ix_trip_feedback_status    ON trip_feedback(status);
CREATE INDEX IF NOT EXISTS ix_trip_feedback_submitted ON trip_feedback(submitted_at);

-- ---------------------------------------------------------------------------
-- The website assistant's knowledge base.
--
-- The assistant runs in the visitor's browser on rules and this data - no AI
-- or translation service. These tables say what a customer MEANS (intents,
-- the example questions that show each one, synonyms for places, vehicles and
-- services); the answer itself still comes from the live portal data - fares,
-- the fleet, the booking - so nothing here can carry a price or a policy.
--
-- Questions the assistant could not place land in chatbot_unknown_questions
-- for the office to map to an intent. Nothing a customer types changes what
-- the assistant does until an admin has reviewed it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chatbot_intents (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT NOT NULL UNIQUE,          -- FARE_INQUIRY
  name               TEXT NOT NULL,
  category           TEXT NOT NULL,                 -- Booking, Fare, Vehicle, Support ...
  description        TEXT,
  service_type       TEXT,                          -- LOCAL | AIRPORT | OUTSTATION | HOURLY | NULL
  required_entities  TEXT,                          -- comma list: route,leg
  optional_entities  TEXT,
  -- Answered from live data (fares, trips): the wording is built by the
  -- assistant and no template can replace the figures.
  dynamic            INTEGER NOT NULL DEFAULT 0,
  -- Optional wording for a static answer, per language, as JSON
  -- {"en": "...", "hi": "...", "hi-Latn": "...", "mr": "...", "mr-Latn": "..."}.
  -- {phone} {whatsapp} {email} {address} {company} {hours} are filled in.
  response_template  TEXT,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chatbot_intent_examples (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_code  TEXT NOT NULL REFERENCES chatbot_intents(code) ON UPDATE CASCADE ON DELETE CASCADE,
  language     TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en','hi','hi-Latn','mr','mr-Latn')),
  example_text TEXT NOT NULL,
  keywords     TEXT,
  source       TEXT NOT NULL DEFAULT 'SEED' CHECK (source IN ('SEED','ADMIN','LEARNED')),
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (intent_code, language, example_text)
);
CREATE INDEX IF NOT EXISTS ix_chatbot_examples_intent ON chatbot_intent_examples(intent_code);

CREATE TABLE IF NOT EXISTS chatbot_entities (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('LOCATION','VEHICLE','SERVICE','TRIP_TYPE','FARE_TERM','TIME','GENERAL')),
  entity_value  TEXT NOT NULL,                      -- what the assistant reads: 'pune'
  display_name  TEXT,
  synonyms      TEXT,                               -- comma list: poona, puna, पुणे
  language      TEXT NOT NULL DEFAULT 'any',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entity_type, entity_value)
);

CREATE TABLE IF NOT EXISTS chatbot_unknown_questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question        TEXT NOT NULL,                    -- as first typed
  normalised      TEXT NOT NULL UNIQUE,             -- lower-cased, spaces collapsed
  language        TEXT,
  times_asked     INTEGER NOT NULL DEFAULT 1,
  first_asked_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_asked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_session_id TEXT,
  status          TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','MAPPED','IGNORED')),
  mapped_intent   TEXT,
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at     TEXT
);
CREATE INDEX IF NOT EXISTS ix_chatbot_unknown_status ON chatbot_unknown_questions(status, last_asked_at);

-- One row per customer message: what the assistant understood. The reply is
-- read from chat_messages (the next assistant line), so it is never copied.
CREATE TABLE IF NOT EXISTS chatbot_conversation_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  message       TEXT NOT NULL,
  language      TEXT,
  intent        TEXT,
  entities_json TEXT,
  confidence    REAL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS ix_chatbot_log_intent ON chatbot_conversation_log(intent, created_at);

-- ---------------------------------------------------------------------------
-- Generated invoices and uploaded invoice templates, kept in the database as
-- well as on disk - but only where the disk does not last (a serverless host;
-- see backend/src/services/fileStore.ts). On the office PC this stays empty.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stored_files (
  path        TEXT PRIMARY KEY,                   -- invoices/<fy>/<vendor>/... or templates/<file>
  data        BLOB NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===========================================================================
-- MASTERS, FLEET, BILLING CONTROL AND ONSHEET
--
-- Added with the portal redesign. Every table is additive: nothing above is
-- altered here, and the columns these features need on the older tables are
-- added by the column migrations in backend/src/db/index.ts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Vehicle / cab categories.
--
-- Before this the class of a car was free text typed four ways ("Dzire",
-- "DZIRE/ETIOS/XCENT", "Sedan"). The category is now a master row; the text
-- copied onto bookings and rate cards stays, because that is what historic
-- invoices print and it must not change under them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_categories (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE,              -- SEDAN, INNOVA_CRYSTA
  name              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  segment           TEXT,                              -- Hatchback | Sedan | SUV | MUV | Van | Bus
  seating           INTEGER,
  luggage           INTEGER,
  example_models    TEXT,                              -- Dzire, Aura, Etios
  aliases           TEXT,                              -- other spellings that mean this category
  outstation_group  TEXT,                              -- STANDARD | SUV_MUV | PREMIUM_SEDAN | PREMIUM_MUV
  description       TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Reusable lists the office maintains: trip types, booking sources, payment
-- methods, cancellation reasons, charge types, branches, fuel types.
--
-- is_system rows are codes the application logic depends on. Their label and
-- active flag can be changed, but they cannot be deleted or re-coded.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_values (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  list_type     TEXT NOT NULL,                         -- TRIP_TYPE | BOOKING_SOURCE | PAYMENT_MODE ...
  code          TEXT NOT NULL,
  label         TEXT NOT NULL,
  description   TEXT,
  is_system     INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  meta_json     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (list_type, code)
);
CREATE INDEX IF NOT EXISTS idx_master_values_type ON master_values(list_type, is_active);

-- ---------------------------------------------------------------------------
-- Vehicle and driver assignment history.
--
-- The booking row carries the CURRENT allotment; this keeps every allotment it
-- ever had, so "who drove this trip" and "which trips did this car run" can be
-- answered even after a re-allotment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_assignments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id      INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  driver_id       INTEGER REFERENCES drivers(id) ON DELETE SET NULL,
  vehicle_number  TEXT,
  vehicle_type    TEXT,
  driver_name     TEXT,
  driver_mobile   TEXT,
  window_start    TEXT,                               -- busy from (local yyyy-mm-dd HH:MM)
  window_end      TEXT,
  override_reason TEXT,                               -- set when a clash was knowingly overridden
  assigned_at     TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_by     INTEGER REFERENCES users(id),
  released_at     TEXT,                               -- replaced by a later allotment, or trip cancelled
  release_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_assignments_booking ON trip_assignments(booking_id);
CREATE INDEX IF NOT EXISTS idx_trip_assignments_vehicle ON trip_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trip_assignments_driver  ON trip_assignments(driver_id);

-- ---------------------------------------------------------------------------
-- Billing batches: the controlled route from "ready to bill" to an invoice.
--
--   DRAFT -> PENDING_APPROVAL -> APPROVED -> BILLED      (or CANCELLED)
--
-- A booking may sit in only one open batch at a time (enforced in
-- services/billingBatches.ts), which is what stops the same trip being billed
-- twice from two screens.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_batches (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_code         TEXT NOT NULL UNIQUE,            -- BB-2610-0001
  vendor_id          INTEGER NOT NULL REFERENCES vendors(id),
  status             TEXT NOT NULL DEFAULT 'DRAFT',   -- DRAFT | PENDING_APPROVAL | APPROVED | BILLED | CANCELLED
  separate_invoices  INTEGER NOT NULL DEFAULT 0,
  invoice_date       TEXT,
  notes              TEXT,
  booking_count      INTEGER NOT NULL DEFAULT 0,
  taxable_amount     REAL NOT NULL DEFAULT 0,
  tax_amount         REAL NOT NULL DEFAULT 0,
  non_taxable_amount REAL NOT NULL DEFAULT 0,
  total_amount       REAL NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_by         INTEGER REFERENCES users(id),
  submitted_at       TEXT,
  submitted_by       INTEGER REFERENCES users(id),
  approved_at        TEXT,
  approved_by        INTEGER REFERENCES users(id),
  billed_at          TEXT,
  billed_by          INTEGER REFERENCES users(id),
  cancelled_at       TEXT,
  cancelled_by       INTEGER REFERENCES users(id),
  cancel_reason      TEXT,
  invoice_ids        TEXT                             -- JSON array, once billed
);
CREATE INDEX IF NOT EXISTS idx_billing_batches_status ON billing_batches(status);

CREATE TABLE IF NOT EXISTS billing_batch_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    INTEGER NOT NULL REFERENCES billing_batches(id) ON DELETE CASCADE,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id),
  amount      REAL NOT NULL DEFAULT 0,                -- the booking total when it was added
  UNIQUE (batch_id, booking_id)
);
CREATE INDEX IF NOT EXISTS idx_billing_batch_items_booking ON billing_batch_items(booking_id);

-- ---------------------------------------------------------------------------
-- What the business pays OUT: to the owner of an attached or partner vehicle.
--
-- Kept apart from `payments` on purpose. Those are money RECEIVED against an
-- invoice; mixing the two is exactly how a receivable and a payable end up
-- netted against each other in a report.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  payee_name      TEXT NOT NULL,                      -- vehicle owner / partner operator
  booking_id      INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  vehicle_id      INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  payment_date    TEXT NOT NULL DEFAULT (date('now')),
  amount          REAL NOT NULL CHECK (amount > 0),
  mode            TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  reference_no    TEXT,
  notes           TEXT,
  is_reversed     INTEGER NOT NULL DEFAULT 0,
  reversed_at     TEXT,
  reversed_by     INTEGER REFERENCES users(id),
  reversal_reason TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  created_by      INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_payee ON supplier_payments(payee_name);

-- ---------------------------------------------------------------------------
-- OnSheet: spreadsheets kept inside the portal.
--
-- The workbook is stored whole, as the spreadsheet engine's own JSON snapshot
-- (values, formulas, styles, merges, sheet order). `version` goes up on every
-- save; a save that names an older version is refused, so two people editing
-- the same file can never silently overwrite each other.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onsheet_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT NOT NULL UNIQUE,                 -- random id used in URLs
  name          TEXT NOT NULL,
  owner_id      INTEGER NOT NULL REFERENCES users(id),
  data_json     TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  sheet_count   INTEGER NOT NULL DEFAULT 1,
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by    INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_onsheet_files_owner ON onsheet_files(owner_id, is_deleted);

-- VIEW: open and download. EDIT: change cells and sheets. MANAGE: EDIT plus
-- sharing it with others. The owner is never listed here; ownership is
-- onsheet_files.owner_id.
CREATE TABLE IF NOT EXISTS onsheet_shares (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id     INTEGER NOT NULL REFERENCES onsheet_files(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL CHECK (permission IN ('VIEW','EDIT','MANAGE')),
  granted_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (file_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_onsheet_shares_user ON onsheet_shares(user_id);

CREATE TABLE IF NOT EXISTS onsheet_recent (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id    INTEGER NOT NULL REFERENCES onsheet_files(id) ON DELETE CASCADE,
  opened_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, file_id)
);

-- Billing and invoice defaults introduced with the redesign. INSERT OR IGNORE
-- keeps any value the office has already changed.
INSERT OR IGNORE INTO settings (key, value, category, data_type, label) VALUES
  ('billing.requireApproval', 'false', 'invoice', 'boolean', 'Invoices from Billing need an approved batch first (true/false)'),
  ('invoice.sacCode', '996601', 'invoice', 'string', 'SAC code printed on invoices'),
  ('invoice.terms', 'Payment is due by the date shown above. Please quote the invoice number with your payment.', 'invoice', 'string', 'Payment terms printed on invoices');


-- ---------------------------------------------------------------------------
-- Events: a wedding, conference or corporate offsite needing many vehicles.
-- Each requirement line becomes ordinary trips (bookings.event_id), so the
-- event is billed, invoiced and paid through the normal modules.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  event_code       TEXT NOT NULL UNIQUE,           -- EV-2610-0001
  name             TEXT NOT NULL,
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id),   -- who is billed
  client_name      TEXT,
  contact_person   TEXT,
  contact_mobile   TEXT,
  contact_email    TEXT,
  venue            TEXT,
  city             TEXT,
  start_date       TEXT NOT NULL,
  end_date         TEXT,
  agreed_amount    REAL,
  status           TEXT NOT NULL DEFAULT 'PLANNED', -- PLANNED | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED
  notes            TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_events_vendor ON events(vendor_id);
CREATE INDEX IF NOT EXISTS idx_events_dates  ON events(start_date);

CREATE TABLE IF NOT EXISTS event_requirements (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id            INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  line_no             INTEGER NOT NULL DEFAULT 1,
  vehicle_category_id INTEGER REFERENCES vehicle_categories(id),
  vehicle_type        TEXT,
  vehicle_count       INTEGER NOT NULL DEFAULT 1,
  travel_date         TEXT NOT NULL,
  reporting_time      TEXT,
  pickup_address      TEXT,
  drop_address        TEXT,
  duty_type           TEXT,
  trip_type           TEXT NOT NULL DEFAULT 'LOCAL',
  passenger_name      TEXT,
  passenger_mobile    TEXT,
  pax_count           INTEGER,
  fare_per_vehicle    REAL,
  remarks             TEXT,
  status              TEXT NOT NULL DEFAULT 'OPEN',  -- OPEN | CANCELLED
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (vehicle_count > 0)
);
CREATE INDEX IF NOT EXISTS idx_event_req_event ON event_requirements(event_id);

-- ---------------------------------------------------------------------------
-- Payment transactions: the money that actually moved (a receipt from a
-- company or a payout to a supplier). payments rows allocate a received
-- transaction to invoices; the difference is the unallocated balance.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_code         TEXT NOT NULL UNIQUE,           -- RCPT-2610-0001 / PAY-2610-0001
  direction        TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  vendor_id        INTEGER REFERENCES vendors(id),
  party_name       TEXT,
  txn_date         TEXT NOT NULL,
  amount           REAL NOT NULL CHECK (amount > 0),
  mode             TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
  reference_no     TEXT,
  bank             TEXT,
  remarks          TEXT,
  source           TEXT NOT NULL DEFAULT 'MANUAL', -- MANUAL | IMPORT | MIGRATED
  is_reversed      INTEGER NOT NULL DEFAULT 0,
  reversed_at      TEXT,
  reversed_by      INTEGER REFERENCES users(id),
  reversal_reason  TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_by       INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ptx_vendor ON payment_transactions(vendor_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_ptx_ref    ON payment_transactions(reference_no);

-- Opening balance per company, so a ledger can start before the portal did.
CREATE TABLE IF NOT EXISTS ledger_opening_balances (
  vendor_id    INTEGER PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  as_of_date   TEXT NOT NULL,
  amount       REAL NOT NULL DEFAULT 0,             -- positive = company owes us
  notes        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id)
);

-- Ledger adjustments (write-off, TDS, rounding, credit note) — never edits.
CREATE TABLE IF NOT EXISTS ledger_adjustments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id    INTEGER NOT NULL REFERENCES vendors(id),
  adj_date     TEXT NOT NULL,
  amount       REAL NOT NULL,                       -- positive reduces what the company owes
  kind         TEXT NOT NULL DEFAULT 'OTHER',       -- TDS | WRITE_OFF | ROUNDING | CREDIT_NOTE | OTHER
  invoice_id   INTEGER REFERENCES invoices(id),
  remarks      TEXT,
  is_reversed  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_ledger_adj_vendor ON ledger_adjustments(vendor_id, adj_date);

-- Trip completed -> billing confirmed -> invoice. INSERT OR IGNORE keeps any
-- value the office has already chosen.
INSERT OR IGNORE INTO settings (key, value, category, data_type, label) VALUES
  ('billing.requireConfirmation', 'true', 'invoice', 'boolean', 'Invoices only for trips whose billing has been confirmed (true/false)');
