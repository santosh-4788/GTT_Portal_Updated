import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// --- Indian format validators ---------------------------------------------
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const mobile = z
  .string()
  .transform((s) => s.replace(/[^\d]/g, '').replace(/^91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, ''))
  .refine((s) => s === '' || MOBILE_RE.test(s), 'Mobile number must be 10 digits starting 6-9.');

export const optionalMobile = mobile.optional().or(z.literal(''));

/**
 * A mobile number that has to be there.
 *
 * `optionalMobile.refine(v => !!v)` reads the same but leaves the parsed type as
 * `string | undefined`, so every call site then has to assert it. This narrows
 * properly and lets each form supply its own wording.
 */
export const requiredMobile = (message = 'Enter a valid 10-digit mobile number.') =>
  mobile.refine((s) => MOBILE_RE.test(s), message);

export const gstin = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => s === '' || GSTIN_RE.test(s), 'GST number is not a valid 15-character GSTIN.');

export const pan = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => s === '' || PAN_RE.test(s), 'PAN must look like ABCDE1234F.');

export const ifsc = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => s === '' || IFSC_RE.test(s), 'IFSC must look like SBIN0001266.');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

export const money = z
  .coerce.number()
  .min(0, 'Amount cannot be negative.')
  .max(99_999_999, 'Amount is unrealistically large.');

/** Express middleware factory: validates req.body and replaces it with parsed data. */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(body)',
        message: i.message,
      }));
      return res.status(400).json({
        error: issues.length === 1
          ? `${issues[0].field}: ${issues[0].message}`
          : 'Some fields need attention.',
        issues,
      });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid filter values.',
        issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}
