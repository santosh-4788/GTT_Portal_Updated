import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config, ensureDirectories } from '../config';

let _db: Database.Database | null = null;

/**
 * Where the data lives.
 *
 * On this PC: the SQLite file in database/ (better-sqlite3), as always.
 *
 * On a host with no lasting disk (Vercel): a Turso database, set by
 * TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Turso is SQLite served over the
 * network, and the `libsql` driver speaks the same synchronous API as
 * better-sqlite3 - prepare/get/all/run/transaction - so not one query in the
 * portal changes. Nothing is written to local disk in that mode.
 */
export const usingTurso = () => !!process.env.TURSO_DATABASE_URL;

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDirectories();

  if (usingTurso()) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const LibSql = require('libsql');
    const db = new LibSql(process.env.TURSO_DATABASE_URL, { authToken: process.env.TURSO_AUTH_TOKEN ?? '' });
    // libsql adds a `_metadata` timing field to each row .get() returns. It
    // would leak into every API response and every row comparison, so it is
    // stripped here, once, for the whole portal.
    const prepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = prepare(sql);
      const get = stmt.get.bind(stmt);
      stmt.get = (...args: unknown[]) => {
        const row = get(...args);
        if (row && typeof row === 'object' && '_metadata' in row) delete (row as Record<string, unknown>)._metadata;
        return row;
      };
      return stmt;
    };
    try { db.exec('PRAGMA foreign_keys = ON'); } catch { /* the server enforces its own */ }
    _db = db as Database.Database;
    return _db;
  }

  const dir = path.dirname(config.paths.dbFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Loaded only here, so a serverless host running on Turso never loads the
  // native SQLite module at all.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite3 = require('better-sqlite3') as typeof Database;
  _db = new BetterSqlite3(config.paths.dbFile);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

/**
 * Additive column migrations.
 *
 * schema.sql only uses CREATE TABLE IF NOT EXISTS, so it never alters a table
 * that already exists. New columns are added here instead — each one checked
 * against the live table first, so this is safe to run on every start.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  // A booking can now be raised straight for a walk-in customer instead of a
  // vendor, so the invoice needs somebody other than the vendor to bill.
  { table: 'bookings', column: 'booking_source', ddl: `TEXT NOT NULL DEFAULT 'VENDOR'` },
  { table: 'bookings', column: 'customer_name', ddl: 'TEXT' },
  { table: 'bookings', column: 'customer_mobile', ddl: 'TEXT' },
  { table: 'bookings', column: 'customer_email', ddl: 'TEXT' },
  { table: 'bookings', column: 'customer_address', ddl: 'TEXT' },
  { table: 'bookings', column: 'customer_gstin', ddl: 'TEXT' },
  { table: 'bookings', column: 'flight_sector', ddl: 'TEXT' },
  { table: 'bookings', column: 'flight_time', ddl: 'TEXT' },

  // Who the invoice is actually addressed to, snapshotted at generation time.
  { table: 'invoices', column: 'bill_to_name', ddl: 'TEXT' },
  { table: 'invoices', column: 'bill_to_address', ddl: 'TEXT' },
  { table: 'invoices', column: 'bill_to_gstin', ddl: 'TEXT' },
  { table: 'invoices', column: 'bill_to_mobile', ddl: 'TEXT' },

  // --- the customer journey -------------------------------------------------
  // The Trip ID is the one reference the customer, the office and the invoice
  // all quote. It is NOT declared UNIQUE here because SQLite cannot add a
  // unique column to an existing table — the unique index below does that job.
  { table: 'bookings', column: 'trip_id', ddl: 'TEXT' },
  // Where the job came from, which is what the admin filters on:
  // EMAIL | WHATSAPP | PORTAL | WALKIN | VENDOR
  { table: 'bookings', column: 'inquiry_source', ddl: `TEXT NOT NULL DEFAULT 'VENDOR'` },
  { table: 'bookings', column: 'customer_id', ddl: 'INTEGER REFERENCES customers(id) ON DELETE SET NULL' },
  { table: 'bookings', column: 'driver_id', ddl: 'INTEGER REFERENCES drivers(id) ON DELETE SET NULL' },
  { table: 'bookings', column: 'inquiry_message', ddl: 'TEXT' },
  { table: 'bookings', column: 'assigned_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'started_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'completed_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'details_sent_at', ddl: 'TEXT' },

  // Which way an airport transfer goes: TO the airport (drop) or FROM it
  // (pickup). NULL for every other trip type. Asked before anything else on
  // an airport booking, because it decides which end is the airport.
  { table: 'bookings', column: 'airport_direction', ddl: 'TEXT' },

  // When the invoice was emailed to the customer, and to which address.
  { table: 'invoices', column: 'sent_at', ddl: 'TEXT' },
  { table: 'invoices', column: 'sent_to', ddl: 'TEXT' },

  // --- the trip workflow ----------------------------------------------------
  // Which member of staff owns an enquiry, and where its quotation has got to.
  // Together with booking_status these place a trip in exactly one stage
  // (services/tripStages.ts) without adding a second status vocabulary.
  { table: 'bookings', column: 'owner_user_id', ddl: 'INTEGER REFERENCES users(id) ON DELETE SET NULL' },
  { table: 'bookings', column: 'owner_assigned_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'quote_status', ddl: 'TEXT' },        // NULL | SENT | ACCEPTED | DECLINED
  { table: 'bookings', column: 'quote_sent_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'quote_amount', ddl: 'REAL' },
  { table: 'bookings', column: 'cancel_reason', ddl: 'TEXT' },
  { table: 'bookings', column: 'cancelled_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'vehicle_category_id', ddl: 'INTEGER REFERENCES vehicle_categories(id) ON DELETE SET NULL' },
  { table: 'bookings', column: 'branch', ddl: 'TEXT' },
  // What the trip costs the business when the car belongs to somebody else —
  // the payable side, which is never mixed into the invoice total.
  { table: 'bookings', column: 'supplier_cost', ddl: 'REAL' },
  { table: 'bookings', column: 'supplier_name', ddl: 'TEXT' },

  // --- the fare actually applied --------------------------------------------
  // The rule a fare was calculated from, and a copy of that rule as it stood,
  // so a later rate change never re-prices a confirmed trip or an invoice.
  { table: 'booking_charges', column: 'fare_rule_id', ddl: 'INTEGER REFERENCES rate_cards(id) ON DELETE SET NULL' },
  { table: 'booking_charges', column: 'fare_snapshot', ddl: 'TEXT' },
  { table: 'booking_charges', column: 'waiting_charge', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'booking_charges', column: 'state_tax', ddl: 'REAL NOT NULL DEFAULT 0' },

  // --- fare rules (rate cards) gain the remaining configurable charges ------
  { table: 'rate_cards', column: 'category_id', ddl: 'INTEGER REFERENCES vehicle_categories(id) ON DELETE SET NULL' },
  { table: 'rate_cards', column: 'min_daily_charge', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'night_charge', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'waiting_rate', ddl: 'REAL NOT NULL DEFAULT 0' },          // per hour
  { table: 'rate_cards', column: 'free_waiting_minutes', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'toll_included', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'parking_included', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'state_tax', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'other_charge', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'other_charge_label', ddl: 'TEXT' },
  { table: 'rate_cards', column: 'discount_percent', ddl: 'REAL NOT NULL DEFAULT 0' },
  { table: 'rate_cards', column: 'tax_mode', ddl: 'TEXT' },        // NULL = the vendor's default
  { table: 'rate_cards', column: 'tax_rate', ddl: 'REAL' },
  { table: 'rate_cards', column: 'effective_from', ddl: 'TEXT' },
  { table: 'rate_cards', column: 'effective_to', ddl: 'TEXT' },

  // --- fleet ----------------------------------------------------------------
  { table: 'vehicles', column: 'category_id', ddl: 'INTEGER REFERENCES vehicle_categories(id) ON DELETE SET NULL' },
  { table: 'vehicles', column: 'make', ddl: 'TEXT' },
  { table: 'vehicles', column: 'fuel_type', ddl: 'TEXT' },
  { table: 'vehicles', column: 'ownership_type', ddl: `TEXT NOT NULL DEFAULT 'OWN'` },  // OWN | ATTACHED | PARTNER
  { table: 'vehicles', column: 'vendor_id', ddl: 'INTEGER REFERENCES vendors(id) ON DELETE SET NULL' },
  { table: 'vehicles', column: 'owner_name', ddl: 'TEXT' },
  { table: 'vehicles', column: 'owner_mobile', ddl: 'TEXT' },
  { table: 'vehicles', column: 'availability_status', ddl: `TEXT NOT NULL DEFAULT 'AVAILABLE'` }, // AVAILABLE | MAINTENANCE | UNAVAILABLE
  { table: 'vehicles', column: 'manufacture_year', ddl: 'INTEGER' },
  { table: 'vehicles', column: 'rc_expiry', ddl: 'TEXT' },
  { table: 'vehicles', column: 'permit_number', ddl: 'TEXT' },
  { table: 'vehicles', column: 'permit_expiry', ddl: 'TEXT' },
  { table: 'vehicles', column: 'insurance_number', ddl: 'TEXT' },
  { table: 'vehicles', column: 'insurance_expiry', ddl: 'TEXT' },
  { table: 'vehicles', column: 'fitness_expiry', ddl: 'TEXT' },
  { table: 'vehicles', column: 'puc_expiry', ddl: 'TEXT' },
  { table: 'vehicles', column: 'notes', ddl: 'TEXT' },
  { table: 'vehicles', column: 'updated_at', ddl: 'TEXT' },

  { table: 'drivers', column: 'vendor_id', ddl: 'INTEGER REFERENCES vendors(id) ON DELETE SET NULL' },
  { table: 'drivers', column: 'availability_status', ddl: `TEXT NOT NULL DEFAULT 'AVAILABLE'` }, // AVAILABLE | ON_LEAVE | UNAVAILABLE
  { table: 'drivers', column: 'licence_issued', ddl: 'TEXT' },
  { table: 'drivers', column: 'badge_expiry', ddl: 'TEXT' },
  { table: 'drivers', column: 'id_proof', ddl: 'TEXT' },
  { table: 'drivers', column: 'police_verified_on', ddl: 'TEXT' },

  // --- payments: a reversal is recorded, never erased -----------------------
  { table: 'payments', column: 'is_reversed', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'payments', column: 'reversed_at', ddl: 'TEXT' },
  { table: 'payments', column: 'reversed_by', ddl: 'INTEGER REFERENCES users(id)' },
  { table: 'payments', column: 'reversal_reason', ddl: 'TEXT' },
  // The money movement this allocation belongs to (payment_transactions). One
  // receipt can settle several invoices; each invoice share stays a payments row.
  { table: 'payments', column: 'transaction_id', ddl: 'INTEGER REFERENCES payment_transactions(id)' },

  // --- companies: how their booking messages are read ------------------------
  { table: 'vendors', column: 'aliases', ddl: 'TEXT' },               // comma-separated other names
  { table: 'vendors', column: 'parser_config', ddl: 'TEXT' },         // JSON: { labels, noReference, signature }
  { table: 'vendors', column: 'company_type', ddl: `TEXT NOT NULL DEFAULT 'CORPORATE'` }, // CORPORATE | TRAVEL_AGENT | DIRECT

  // --- trips: completion, billing confirmation, events ---------------------
  { table: 'bookings', column: 'start_km', ddl: 'REAL' },
  { table: 'bookings', column: 'end_km', ddl: 'REAL' },
  { table: 'bookings', column: 'actual_km', ddl: 'REAL' },
  { table: 'bookings', column: 'actual_hours', ddl: 'REAL' },
  { table: 'bookings', column: 'completion_remarks', ddl: 'TEXT' },
  { table: 'bookings', column: 'billing_confirmed_at', ddl: 'TEXT' },
  { table: 'bookings', column: 'billing_confirmed_by', ddl: 'INTEGER REFERENCES users(id)' },
  { table: 'bookings', column: 'event_id', ddl: 'INTEGER REFERENCES events(id) ON DELETE SET NULL' },
  { table: 'bookings', column: 'event_requirement_id', ddl: 'INTEGER REFERENCES event_requirements(id) ON DELETE SET NULL' },

  // --- fleet: who usually drives what, and who is away ----------------------
  { table: 'vehicles', column: 'regular_driver_id', ddl: 'INTEGER REFERENCES drivers(id) ON DELETE SET NULL' },
  { table: 'drivers', column: 'association_type', ddl: `TEXT NOT NULL DEFAULT 'EMPLOYEE'` }, // EMPLOYEE | ATTACHED | HIRED | FREELANCE
  { table: 'drivers', column: 'leave_from', ddl: 'TEXT' },
  { table: 'drivers', column: 'leave_to', ddl: 'TEXT' },
  { table: 'drivers', column: 'unavailable_reason', ddl: 'TEXT' },

  // --- the language each staff member reads the portal in ('en' | 'hi') ------
  { table: 'users', column: 'language', ddl: `TEXT NOT NULL DEFAULT 'en'` },
];

/**
 * Indexes that cannot live in schema.sql because they cover columns added by
 * the migrations above — schema.sql runs first, when the column may not exist.
 */
const INDEX_MIGRATIONS: { name: string; table: string; ddl: string }[] = [
  {
    name: 'uq_bookings_trip_id',
    table: 'bookings',
    // Partial, so the historic rows that predate Trip IDs (all NULL) coexist.
    ddl: `CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_trip_id
            ON bookings(trip_id) WHERE trip_id IS NOT NULL AND trip_id <> ''`,
  },
  {
    name: 'idx_bookings_inquiry_source',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_inquiry_source ON bookings(inquiry_source)`,
  },
  {
    name: 'idx_bookings_customer',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id)`,
  },
  {
    name: 'idx_bookings_owner',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_owner ON bookings(owner_user_id)`,
  },
  {
    name: 'idx_bookings_vehicle',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_vehicle ON bookings(vehicle_id, travel_date)`,
  },
  {
    name: 'idx_bookings_driver',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_driver ON bookings(driver_id, travel_date)`,
  },
  {
    name: 'idx_bookings_event',
    table: 'bookings',
    ddl: `CREATE INDEX IF NOT EXISTS idx_bookings_event ON bookings(event_id)`,
  },
  {
    name: 'idx_payments_transaction',
    table: 'payments',
    ddl: `CREATE INDEX IF NOT EXISTS idx_payments_transaction ON payments(transaction_id)`,
  },
];

function applyColumnMigrations(db: Database.Database): string[] {
  const applied: string[] = [];
  for (const m of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${m.table})`).all() as { name: string }[];
    if (!cols.length) continue;                       // table not created yet
    if (cols.some((c) => c.name === m.column)) continue;
    db.exec(`ALTER TABLE ${m.table} ADD COLUMN ${m.column} ${m.ddl}`);
    applied.push(`${m.table}.${m.column}`);
  }

  for (const ix of INDEX_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${ix.table})`).all() as { name: string }[];
    if (!cols.length) continue;
    try {
      db.exec(ix.ddl);
    } catch (err: any) {
      // A duplicate Trip ID in historic data must not stop the server booting;
      // it is a data problem for the office, reported rather than thrown.
      console.warn(`[db] could not create index ${ix.name}: ${err.message}`);
    }
  }
  return applied;
}

/** Run the whole schema file. Safe to re-run (everything is IF NOT EXISTS). */
export function applySchema(): string[] {
  const db = getDb();
  const sql = fs.readFileSync(config.paths.schema, 'utf8');
  db.exec(sql);
  return applyColumnMigrations(db);
}

/** Small helper so route code reads cleanly. */
export const q = {
  all<T = any>(sql: string, params: any = {}): T[] {
    return getDb().prepare(sql).all(params) as T[];
  },
  get<T = any>(sql: string, params: any = {}): T | undefined {
    return getDb().prepare(sql).get(params) as T | undefined;
  },
  run(sql: string, params: any = {}) {
    return getDb().prepare(sql).run(params);
  },
  tx<T>(fn: () => T): T {
    return getDb().transaction(fn)();
  },
};
