/**
 * Fare rules and quotations.
 *
 *   GET  /api/fares/rules   the rules that can price a trip (vendor, category, plan, date)
 *   POST /api/fares/quote   price a trip from one rule — the full breakdown, nothing saved
 *
 * Saving a calculated fare onto a trip is POST /api/trips/:id/fare, which
 * accepts the rule id and the snapshot this returns, so the same numbers the
 * desk saw are the numbers stored.
 */
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { requireAuth, requirePermission } from '../middleware/auth';
import { validateBody } from '../utils/validate';
import { candidateRules, FareError, loadRule, quoteFare } from '../services/fareEngine';
import { ensureDirectVendor } from '../services/directCustomer';

const router = Router();
router.use(requireAuth);

const canQuote = requirePermission('bookings.view', 'billing.view', 'masters.view', 'vendors.view');

router.get('/rules', canQuote, (req, res) => {
  const p = req.query as Record<string, string>;
  let vendorId = Number(p.vendorId ?? 0);
  const categoryId = p.categoryId ? Number(p.categoryId) : null;
  const planType = String(p.planType ?? '').toUpperCase();
  const tripType = String(p.tripType ?? '').toUpperCase();
  // A trip type maps onto the three ways a rule can price.
  const plan = planType || (tripType === 'AIRPORT' ? 'AIRPORT'
    : ['OUTSTATION', 'ROUND_TRIP'].includes(tripType) ? 'OUTSTATION'
      : tripType ? 'LOCAL' : '');

  let { matches, all } = candidateRules({ vendorId, categoryId, vehicleText: p.vehicle, planType: plan, onDate: p.date });
  let fallback = false;
  // A vendor with no rule for this category falls back to the walk-in price list.
  if (!matches.length && vendorId) {
    const direct = ensureDirectVendor();
    if (direct.id !== vendorId) {
      const r = candidateRules({ vendorId: direct.id, categoryId, vehicleText: p.vehicle, planType: plan, onDate: p.date });
      if (r.matches.length) { matches = r.matches; fallback = true; vendorId = direct.id; }
    }
  }
  res.json({
    data: matches,
    // Everything else the vendor has, for picking a rule by hand.
    others: all.filter((r) => !matches.some((m) => m.id === r.id)).slice(0, 200),
    planType: plan,
    fallback,
    message: !matches.length
      ? 'No active fare rule matches this vehicle and trip type. Choose one by hand, or add one under Masters → Fare rules.'
      : fallback ? 'This vendor has no rule for the vehicle, so the walk-in price list is suggested.' : '',
  });
});

const n = (label: string) => z.coerce.number({ invalid_type_error: `${label} must be a number.` })
  .min(0, `${label} cannot be negative.`).max(9_999_999, `${label} looks too large.`).optional();

export const quoteSchema = z.object({
  ruleId: z.coerce.number().int().positive('Choose a fare rule.'),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  distanceKm: n('Distance'),
  oneWayKm: n('One-way distance'),
  roundTrip: z.coerce.boolean().optional(),
  hours: n('Hours'),
  days: z.coerce.number().int().min(1, 'Days must be at least 1.').max(60).optional(),
  nights: z.coerce.number().int().min(0).max(60).optional(),
  waitingMinutes: n('Waiting minutes'),
  toll: n('Toll'),
  parking: n('Parking'),
  stateTax: n('State tax'),
  permit: n('Permit'),
  otherCharges: n('Other charges'),
  otherChargesNote: z.string().trim().max(120).optional(),
  discount: n('Discount'),
  advance: n('Advance'),
  taxMode: z.enum(['IGST', 'CGST_SGST', 'NONE']).optional(),
  taxRate: z.coerce.number().min(0).max(28).optional(),
});

router.post('/quote', canQuote, validateBody(quoteSchema), (req, res) => {
  const b = req.body as z.infer<typeof quoteSchema>;
  const rule = loadRule(b.ruleId);
  if (!rule) return res.status(404).json({ error: 'That fare rule no longer exists.' });
  try {
    const quote = quoteFare(rule, b, b.onDate);
    res.json({ data: quote });
  } catch (err: any) {
    if (err instanceof FareError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

/** Category list for the fare and booking forms — active only. */
router.get('/categories', (_req, res) => {
  res.json({
    data: q.all<any>(
      `SELECT id, code, name, segment, seating, outstation_group FROM vehicle_categories
        WHERE is_active = 1 ORDER BY display_order, name`
    ),
  });
});

export default router;
