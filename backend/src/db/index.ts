import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config, ensureDirectories } from '../config';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDirectories();
  const dir = path.dirname(config.paths.dbFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  _db = new Database(config.paths.dbFile);
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
