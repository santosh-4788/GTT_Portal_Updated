/**
 * Outstation fixed fares - the pricing master for the popular routes.
 *
 * Mumbai to Lonavala is sold at one published price per vehicle category, toll
 * included, not per kilometre. Those prices live in `outstation_fares` so the
 * office changes them from the admin, never in the website's code.
 *
 * Four categories per route, always shown in this order:
 *   Standard cab    Dzire / Aura
 *   SUV / MUV       Ertiga / XL6        (not premium)
 *   Premium sedan   Honda City / Ciaz
 *   Premium MUV     Innova Crysta / Kia Carens
 *
 * A NULL fare is "not priced yet" and the website shows Fare on request for it.
 * The premium fares and every return fare start that way: the office gave us
 * the one-way standard and SUV prices, and a price we made up would be quoted
 * to a customer as if it were real.
 */
import { q } from '../db';

export const CATEGORIES = ['STANDARD', 'SUV_MUV', 'PREMIUM_SEDAN', 'PREMIUM_MUV'] as const;
export type FareCategory = (typeof CATEGORIES)[number];

export const CATEGORY_VEHICLES: Record<FareCategory, string> = {
  STANDARD: 'Dzire / Aura',
  SUV_MUV: 'Ertiga / XL6',
  PREMIUM_SEDAN: 'Honda City / Ciaz',
  PREMIUM_MUV: 'Innova Crysta / Kia Carens',
};

export interface FareRow {
  id: number;
  route_key: string;
  origin: string;
  destination: string;
  category: FareCategory;
  vehicles: string;
  one_way_fare: number | null;
  return_fare: number | null;
  toll_included: number;
  is_active: number;
  display_order: number;
  updated_at: string;
}

/** One-way fares from the office's price list, toll included: [standard, SUV/MUV]. */
const STARTING_FARES: [string, number, number][] = [
  ['Lonavala', 3199, 3699],
  ['Pune', 3199, 3699],
  ['Nashik', 3499, 4499],
  ['Alibaug', 3199, 3699],
  ['Shirdi', 5499, 7499],
  ['Mahabaleshwar', 5799, 7499],
  ['Satara', 5799, 7499],
  ['Kolhapur', 7499, 9299],
  ['Surat', 4999, 6499],
  ['Ahmedabad', 9999, 11499],
  ['Vapi', 3499, 4499],
];

export const routeKeyFor = (destination: string) =>
  destination.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const SEEDED_FLAG = 'outstation.faresSeeded';

/**
 * Load the starting price list, once.
 *
 * Guarded by a settings flag rather than by the table being empty, so a route
 * the office deletes stays deleted instead of coming back on the next restart.
 */
export function ensureOutstationFares(): void {
  const done = q.get<{ value: string }>('SELECT value FROM settings WHERE key = @k', { k: SEEDED_FLAG });
  if (done?.value === 'true') return;

  q.tx(() => {
    STARTING_FARES.forEach(([destination, standard, suv], i) => {
      const key = routeKeyFor(destination);
      CATEGORIES.forEach((category, j) => {
        q.run(
          `INSERT OR IGNORE INTO outstation_fares
             (route_key, origin, destination, category, vehicles, one_way_fare, return_fare, display_order)
           VALUES (@key, 'Mumbai', @destination, @category, @vehicles, @oneWay, NULL, @order)`,
          {
            key, destination, category,
            vehicles: CATEGORY_VEHICLES[category],
            oneWay: category === 'STANDARD' ? standard : category === 'SUV_MUV' ? suv : null,
            order: i * 10 + j,
          }
        );
      });
    });
    q.run(
      `INSERT INTO settings (key, value, category, data_type, label)
       VALUES (@k, 'true', 'outstation', 'boolean', 'Outstation starting fares loaded')
       ON CONFLICT(key) DO UPDATE SET value = 'true'`,
      { k: SEEDED_FLAG }
    );
  });
}

export function allFares(activeOnly: boolean): FareRow[] {
  return q.all<FareRow>(
    `SELECT id, route_key, origin, destination, category, vehicles, one_way_fare, return_fare,
            toll_included, is_active, display_order, updated_at
       FROM outstation_fares
      ${activeOnly ? 'WHERE is_active = 1' : ''}
      ORDER BY display_order, destination,
        CASE category WHEN 'STANDARD' THEN 0 WHEN 'SUV_MUV' THEN 1 WHEN 'PREMIUM_SEDAN' THEN 2 ELSE 3 END`
  );
}

/** Routes with their categories, in the order the website shows them. */
export function groupedRoutes(activeOnly: boolean) {
  const out = new Map<string, {
    key: string; origin: string; destination: string; displayOrder: number;
    fares: {
      id: number; category: FareCategory; vehicles: string;
      oneWay: number | null; return: number | null; tollIncluded: boolean; isActive: boolean;
    }[];
  }>();
  for (const r of allFares(activeOnly)) {
    let route = out.get(r.route_key);
    if (!route) {
      route = { key: r.route_key, origin: r.origin, destination: r.destination, displayOrder: r.display_order, fares: [] };
      out.set(r.route_key, route);
    }
    route.fares.push({
      id: r.id, category: r.category, vehicles: r.vehicles,
      oneWay: r.one_way_fare, return: r.return_fare,
      tollIncluded: !!r.toll_included, isActive: !!r.is_active,
    });
  }
  return [...out.values()];
}

/** The fare the customer is being charged, looked up here rather than trusted from the browser. */
export function fareFor(routeKey: string, category: string, leg: 'ONE_WAY' | 'RETURN') {
  const r = q.get<FareRow>(
    `SELECT * FROM outstation_fares WHERE route_key = @routeKey AND category = @category AND is_active = 1`,
    { routeKey, category }
  );
  if (!r) return null;
  const amount = leg === 'RETURN' ? r.return_fare : r.one_way_fare;
  if (amount == null) return null;
  return { row: r, amount, tollIncluded: !!r.toll_included };
}
