/**
 * Start-up data for the masters, fleet and OnSheet modules.
 *
 * Runs on every boot and is idempotent: it only ever ADDS what is missing. It
 * never edits a row an administrator has already changed, never deletes, and
 * never re-prices anything — the text already on bookings, rate cards and
 * invoices is left exactly as it was. Links to the new masters (category ids)
 * are filled in only where they are still empty.
 */
import { getDb, q } from '../db';
import { nextTripId } from './tripId';

/* ==========================================================================
   Permissions for the new modules
   ========================================================================== */

const NEW_MODULES = ['masters', 'fleet', 'onsheet', 'events'] as const;
const ACTIONS = ['view', 'create', 'update', 'delete'] as const;

/**
 * Who gets the new permissions on first boot.
 *
 * Derived from what each role can already do, so nobody loses access to a
 * screen they used yesterday (Vendors and Outstation Fares used to sit behind
 * vendors.*; the fleet list behind settings.* / bookings.*). A grant is made
 * only at the moment the permission itself is created — an administrator who
 * later removes it from a role is never overruled on the next restart.
 */
function grantRule(code: string, has: (c: string) => boolean): boolean {
  const [mod, action] = code.split('.');
  if (mod === 'masters') {
    if (action === 'view') return has('vendors.view');
    if (action === 'create') return has('vendors.create') || has('vendors.update');
    if (action === 'update') return has('vendors.update');
    return has('vendors.delete');
  }
  // Events are bookings in bulk: whoever can take bookings can run an event.
  if (mod === 'events') return has(`bookings.${action}`);
  if (mod === 'fleet') {
    if (action === 'view') return has('settings.view') || has('bookings.view');
    if (action === 'create') return has('settings.create') || has('bookings.create');
    if (action === 'update') return has('settings.update') || has('bookings.update');
    return has('settings.delete');
  }
  // OnSheet is a personal workspace: anyone who can sign in may keep sheets.
  // A read-only role can open what is shared with it but not create its own.
  if (mod === 'onsheet') {
    if (action === 'view') return true;
    return has('bookings.create') || has('billing.create') || has('settings.update') || has('vendors.update');
  }
  return false;
}

export function ensurePermissions(): string[] {
  const db = getDb();
  const created: string[] = [];
  const roles = q.all<{ id: number; code: string }>('SELECT id, code FROM roles');
  if (!roles.length) return created;   // not seeded yet — the seed script will run this again

  const insert = db.prepare('INSERT OR IGNORE INTO permissions (code, module, description) VALUES (?, ?, ?)');
  const link = db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  db.transaction(() => {
    for (const mod of NEW_MODULES) {
      for (const action of ACTIONS) {
        const code = `${mod}.${action}`;
        const info = insert.run(code, mod, `${action} ${mod}`);
        if (!info.changes) continue;     // already existed — leave the grants alone
        created.push(code);
        const pid = (q.get<{ id: number }>('SELECT id FROM permissions WHERE code = @c', { c: code }))!.id;
        for (const r of roles) {
          const perms = new Set(
            q.all<{ code: string }>(
              `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = @id`, { id: r.id }
            ).map((p) => p.code)
          );
          if (r.code === 'SUPER_ADMIN' || grantRule(code, (c) => perms.has(c))) link.run(r.id, pid);
        }
      }
    }
  })();
  return created;
}

/* ==========================================================================
   Vehicle categories
   ========================================================================== */

interface CategorySeed {
  code: string; name: string; segment: string; seating: number; luggage: number;
  models: string; aliases: string[]; group: string | null;
}

/**
 * The categories the business actually prices — the same twelve the website
 * shows and the rate cards are written against. Aliases are the other ways the
 * same class has been typed on bookings and vendor messages, so historic rows
 * can be linked without being rewritten.
 */
const CATEGORY_SEEDS: CategorySeed[] = [
  { code: 'DZIRE', name: 'Dzire', segment: 'Sedan', seating: 4, luggage: 2, models: 'Maruti Dzire, Toyota Etios, Hyundai Xcent',
    aliases: ['dzire', 'swift dzire', 'maruti dzire', 'sedan', 'dzire/etios/xcent', 'etios', 'toyota etios', 'xcent'], group: 'STANDARD' },
  { code: 'AURA', name: 'Hyundai Aura', segment: 'Sedan', seating: 4, luggage: 2, models: 'Hyundai Aura',
    aliases: ['aura', 'hyundai aura'], group: 'STANDARD' },
  { code: 'HONDA_CITY', name: 'Honda City', segment: 'Premium sedan', seating: 4, luggage: 2, models: 'Honda City',
    aliases: ['city', 'honda city'], group: 'PREMIUM_SEDAN' },
  { code: 'CIAZ', name: 'Ciaz', segment: 'Premium sedan', seating: 4, luggage: 2, models: 'Maruti Ciaz',
    aliases: ['ciaz', 'maruti ciaz'], group: 'PREMIUM_SEDAN' },
  { code: 'ERTIGA', name: 'Ertiga', segment: 'SUV', seating: 6, luggage: 3, models: 'Maruti Ertiga',
    aliases: ['ertiga', 'maruti ertiga', 'ertiga (suv)', 'suv'], group: 'SUV_MUV' },
  { code: 'XL6', name: 'XL6', segment: 'SUV', seating: 6, luggage: 3, models: 'Maruti XL6',
    aliases: ['xl6', 'maruti xl6'], group: 'SUV_MUV' },
  { code: 'RUMION', name: 'Toyota Rumion', segment: 'SUV', seating: 6, luggage: 3, models: 'Toyota Rumion',
    aliases: ['rumion', 'toyota rumion'], group: 'SUV_MUV' },
  { code: 'INNOVA_CRYSTA', name: 'Toyota Innova Crysta', segment: 'Premium SUV', seating: 6, luggage: 4, models: 'Toyota Innova Crysta',
    aliases: ['innova', 'innova crysta', 'toyota innova crysta', 'toyota innova crysta (premium suv)'], group: 'PREMIUM_MUV' },
  { code: 'CARENS', name: 'Kia Carens', segment: 'Premium SUV', seating: 6, luggage: 4, models: 'Kia Carens',
    aliases: ['carens', 'kia carens'], group: 'PREMIUM_MUV' },
  { code: 'TRAVELLER_12', name: 'Force Traveller 12', segment: 'Group', seating: 12, luggage: 8, models: 'Force Tempo Traveller',
    aliases: ['tempo traveller', 'force traveller', 'force tempo traveller', 'traveller 12', 'tempo traveller 12', 'force traveller 12'], group: null },
  { code: 'URBANIA_17', name: 'Force Urbania 17', segment: 'Group', seating: 17, luggage: 10, models: 'Force Urbania',
    aliases: ['urbania', 'force urbania', 'urbania 17', 'force urbania 17'], group: null },
  { code: 'BUS', name: 'Bus', segment: 'Coach', seating: 45, luggage: 30, models: 'Volvo / Ashok Leyland coaches',
    aliases: ['bus', 'coach'], group: null },
];

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Best category for a piece of free text, or null when it is ambiguous. */
export function matchCategoryId(text: unknown): number | null {
  const t = norm(text);
  if (!t) return null;
  const cats = q.all<{ id: number; name: string; aliases: string | null }>(
    'SELECT id, name, aliases FROM vehicle_categories'
  );
  // Exact name or exact alias first.
  for (const c of cats) {
    const aliases = String(c.aliases ?? '').split('|').map(norm).filter(Boolean);
    if (norm(c.name) === t || aliases.includes(t)) return c.id;
  }
  // Then the longest alias contained in the text ("Toyota Innova Crysta (Premium SUV)").
  let best: { id: number; len: number } | null = null;
  for (const c of cats) {
    const aliases = [norm(c.name), ...String(c.aliases ?? '').split('|').map(norm)].filter((a) => a.length > 3);
    for (const a of aliases) {
      if (t.includes(a) && (!best || a.length > best.len)) best = { id: c.id, len: a.length };
    }
  }
  return best?.id ?? null;
}

export function ensureVehicleCategories(): number {
  const count = (q.get<{ c: number }>('SELECT COUNT(*) c FROM vehicle_categories'))!.c;
  if (count === 0) {
    const ins = getDb().prepare(
      `INSERT OR IGNORE INTO vehicle_categories
         (code, name, segment, seating, luggage, example_models, aliases, outstation_group, display_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    getDb().transaction(() => {
      CATEGORY_SEEDS.forEach((c, i) =>
        ins.run(c.code, c.name, c.segment, c.seating, c.luggage, c.models, c.aliases.join('|'), c.group, (i + 1) * 10)
      );
    })();
  }

  // Link existing rows that have no category yet. Text is never changed.
  let linked = 0;
  const link = (table: string, textCol: string, idCol: string, extra = '') => {
    const rows = q.all<any>(
      `SELECT id, ${textCol} AS t${extra ? `, ${extra} AS t2` : ''} FROM ${table} WHERE ${idCol} IS NULL`
    );
    for (const r of rows) {
      const id = matchCategoryId(r.t) ?? (extra ? matchCategoryId(r.t2) : null);
      if (id) { q.run(`UPDATE ${table} SET ${idCol} = @id WHERE id = @rid`, { id, rid: r.id }); linked++; }
    }
  };
  link('rate_cards', 'vehicle_category', 'category_id');
  // A vehicle's model ("Maruti Dzire") is more specific than its type ("Sedan").
  link('vehicles', 'model', 'category_id', 'vehicle_type');
  link('bookings', 'vehicle_type', 'vehicle_category_id');
  return linked;
}

/* ==========================================================================
   Reusable lists
   ========================================================================== */

type ListSeed = [code: string, label: string, system?: boolean, description?: string];

/**
 * System codes are the ones the application logic branches on (a trip type
 * the fare engine prices, a payment mode the API validates). Everything else
 * is the office's own vocabulary and can be added to freely.
 */
export const LIST_TYPES: Record<string, { label: string; description: string; seeds: ListSeed[] }> = {
  TRIP_TYPE: {
    label: 'Trip types',
    description: 'How a journey is sold. The fare engine prices LOCAL, AIRPORT and OUTSTATION from the fare rules.',
    seeds: [
      ['LOCAL', 'Local (hourly package)', true], ['AIRPORT', 'Airport transfer', true],
      ['TRANSFER', 'Point-to-point transfer', true], ['OUTSTATION', 'Outstation', true],
      ['ROUND_TRIP', 'Outstation round trip', true], ['PACKAGE', 'Tour package', true],
    ],
  },
  BOOKING_SOURCE: {
    label: 'Booking sources',
    description: 'Where an enquiry or booking reached us. The code decides the Trip ID prefix.',
    seeds: [
      ['EMAIL', 'Email enquiry', true], ['WHATSAPP', 'WhatsApp enquiry', true],
      ['PORTAL', 'Customer portal', true], ['WALKIN', 'Walk-in / phone', true], ['VENDOR', 'Vendor booking', true],
    ],
  },
  PAYMENT_MODE: {
    label: 'Payment methods',
    description: 'Methods offered when recording money received or paid out.',
    seeds: [
      ['BANK_TRANSFER', 'Bank transfer', true], ['NEFT', 'NEFT', true], ['RTGS', 'RTGS', true],
      ['UPI', 'UPI', true], ['CHEQUE', 'Cheque', true], ['CASH', 'Cash', true], ['OTHER', 'Other', true],
    ],
  },
  CANCELLATION_REASON: {
    label: 'Cancellation reasons',
    description: 'Offered when a trip is cancelled, and reported on in the cancellation report.',
    seeds: [
      ['CUSTOMER_CANCELLED', 'Customer cancelled'], ['PLAN_CHANGED', 'Travel plan changed'],
      ['PRICE', 'Fare not accepted'], ['NO_VEHICLE', 'No vehicle available'],
      ['DUPLICATE', 'Duplicate enquiry'], ['NO_RESPONSE', 'Customer did not respond'],
      ['VENDOR_CANCELLED', 'Vendor cancelled'], ['OTHER', 'Other'],
    ],
  },
  CHARGE_TYPE: {
    label: 'Additional charge types',
    description: 'Names used for the "other charges" line on a fare.',
    seeds: [
      ['TOLL', 'Toll', true], ['PARKING', 'Parking', true], ['STATE_TAX', 'State / border tax', true],
      ['PERMIT', 'Permit', true], ['DRIVER_ALLOWANCE', 'Driver allowance', true],
      ['NIGHT', 'Night charge', true], ['WAITING', 'Waiting charge', true],
      ['DECORATION', 'Car decoration'], ['CLEANING', 'Extra cleaning'],
    ],
  },
  BRANCH: {
    label: 'Branches',
    description: 'Offices or operating bases a trip can be booked against.',
    seeds: [['MUMBAI', 'Mumbai (Goregaon)']],
  },
  FUEL_TYPE: {
    label: 'Fuel types',
    description: 'Used on fleet vehicles.',
    seeds: [['PETROL', 'Petrol'], ['DIESEL', 'Diesel'], ['CNG', 'CNG'], ['ELECTRIC', 'Electric'], ['HYBRID', 'Hybrid']],
  },
  OWNERSHIP_TYPE: {
    label: 'Vehicle ownership',
    description: 'Whether a vehicle is the business\'s own, attached, or a partner\'s.',
    seeds: [
      ['OWN', 'Own vehicle', true], ['ATTACHED', 'Attached (owner-driven)', true], ['PARTNER', 'Hired (partner / vendor vehicle)', true],
    ],
  },
};

export function ensureMasterLists(): void {
  const ins = getDb().prepare(
    `INSERT OR IGNORE INTO master_values (list_type, code, label, is_system, sort_order, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  getDb().transaction(() => {
    for (const [type, def] of Object.entries(LIST_TYPES)) {
      def.seeds.forEach(([code, label, system, description], i) =>
        ins.run(type, code, label, system ? 1 : 0, (i + 1) * 10, description ?? null)
      );
    }
  })();
}

/** Active codes of one list, in display order. */
export function listCodes(type: string): string[] {
  return q.all<{ code: string }>(
    `SELECT code FROM master_values WHERE list_type = @t AND is_active = 1 ORDER BY sort_order, label`,
    { t: type }
  ).map((r) => r.code);
}

/* ==========================================================================
   Trip IDs for the bookings that predate them
   ========================================================================== */

/**
 * Every trip carries a Trip ID. Rows entered before Trip IDs existed get one
 * now, numbered in the month they were booked, so the Trips screen can show
 * every booking from every source. Nothing else on those rows changes.
 */
export function backfillTripIds(): number {
  const rows = q.all<any>(
    `SELECT id, inquiry_source, booking_date, created_at FROM bookings
      WHERE trip_id IS NULL OR trip_id = '' ORDER BY id`
  );
  if (!rows.length) return 0;
  getDb().transaction(() => {
    for (const r of rows) {
      const src = ['EMAIL', 'WHATSAPP', 'PORTAL', 'WALKIN', 'VENDOR'].includes(r.inquiry_source)
        ? r.inquiry_source : 'VENDOR';
      const when = new Date(String(r.booking_date || r.created_at || '').slice(0, 10) + 'T00:00:00');
      const tripId = nextTripId(src, isNaN(when.getTime()) ? new Date() : when);
      q.run('UPDATE bookings SET trip_id = @t WHERE id = @id', { t: tripId, id: r.id });
    }
  })();
  return rows.length;
}

/* ==========================================================================
   Billing confirmation and payment transactions for existing rows
   ========================================================================== */

/**
 * Before billing confirmation existed, "billing_status = READY" on a completed
 * trip meant the office had priced it for invoicing. Those trips are treated
 * as already confirmed (stamped with their completion time), so nothing that
 * was waiting for an invoice yesterday drops back to "awaiting billing".
 */
export function backfillBillingConfirmation(): number {
  return q.run(
    `UPDATE bookings SET billing_confirmed_at = COALESCE(completed_at, updated_at, datetime('now'))
      WHERE billing_confirmed_at IS NULL
        AND booking_status = 'COMPLETED'
        AND billing_status IN ('READY','INVOICED')`
  ).changes;
}

/**
 * Every payment recorded before the ledger existed becomes its own received
 * transaction (one receipt, fully allocated to its invoice). The payment rows
 * themselves are not changed apart from the link.
 */
export function backfillPaymentTransactions(): number {
  const rows = q.all<any>(
    `SELECT p.id, p.vendor_id, p.payment_date, p.amount, p.mode, p.reference_no, p.bank, p.notes,
            p.created_at, p.created_by, p.is_reversed, p.reversed_at, p.reversed_by, p.reversal_reason
       FROM payments p WHERE p.transaction_id IS NULL ORDER BY p.id`
  );
  if (!rows.length) return 0;
  const db = getDb();
  db.transaction(() => {
    for (const r of rows) {
      const code = `RCPT-M${String(r.id).padStart(6, '0')}`;
      const info = q.run(
        `INSERT OR IGNORE INTO payment_transactions
           (txn_code, direction, vendor_id, txn_date, amount, mode, reference_no, bank, remarks, source,
            is_reversed, reversed_at, reversed_by, reversal_reason, created_at, created_by)
         VALUES (@code, 'IN', @vendor, @date, @amount, @mode, @ref, @bank, @notes, 'MIGRATED',
            @rev, @revAt, @revBy, @revWhy, @created, @by)`,
        { code, vendor: r.vendor_id, date: r.payment_date, amount: r.amount, mode: r.mode ?? 'BANK_TRANSFER',
          ref: r.reference_no, bank: r.bank, notes: r.notes, rev: r.is_reversed ?? 0, revAt: r.reversed_at,
          revBy: r.reversed_by, revWhy: r.reversal_reason, created: r.created_at, by: r.created_by }
      );
      const txn = info.changes
        ? Number(info.lastInsertRowid)
        : q.get<{ id: number }>('SELECT id FROM payment_transactions WHERE txn_code = @code', { code })!.id;
      q.run('UPDATE payments SET transaction_id = @t WHERE id = @id', { t: txn, id: r.id });
    }
  })();
  return rows.length;
}

/** Everything above, in order. Safe to call on every start. */
export function ensureRedesignData(): void {
  try {
    ensureMasterLists();
    ensureVehicleCategories();
    ensurePermissions();
    backfillTripIds();
    backfillBillingConfirmation();
    backfillPaymentTransactions();
  } catch (err: any) {
    // Reference data must never stop the portal from starting.
    console.warn('[bootstrap] ' + (err?.message ?? err));
  }
}
