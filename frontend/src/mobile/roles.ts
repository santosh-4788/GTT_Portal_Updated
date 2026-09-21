/**
 * Who this app is for.
 *
 * The brief was an app for the admin and the billing department, so those are
 * the roles it lets in. SUPER_ADMIN is included because it is the owner's own
 * account and is, by definition, an admin.
 *
 * Operations and view-only staff are turned away at sign-in rather than shown
 * a stripped-back app: their screens are booking entry, which is a poor fit for
 * a phone, and letting them in would mean maintaining two more layouts nobody
 * asked for. The portal in a browser still works for them.
 *
 * This is a convenience gate, not a security boundary — the API enforces every
 * permission on its own, and always has.
 */
export const APP_ROLES = ['SUPER_ADMIN', 'ADMIN', 'BILLING'];

const LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  BILLING: 'Billing',
};

export function roleLabel(code: string): string {
  return LABELS[code] ?? code;
}

export function isAppRole(code: string | undefined | null): boolean {
  return !!code && APP_ROLES.includes(code);
}
