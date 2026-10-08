/**
 * Named permissions checked by has_permission() in SQL and requirePermission()
 * on the server. Keep in sync with public.role_permissions seeds.
 *
 *   finance.read   – payment ledgers, Taxes & Books, Summer
 *   finance.record – add/edit expenses, receipts, tax payments, tax settings
 *   finance.delete – delete books records (admin only)
 *
 * Admin has every permission. Every permission needs an MFA-verified session.
 */
export const PERMISSIONS = ["finance.read", "finance.record", "finance.delete"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Thrown when the session isn't MFA-verified; the UI sends the user to verify. */
export const MFA_REQUIRED = "MFA_REQUIRED";

export function isMfaRequiredError(e: unknown): boolean {
  return String((e as any)?.message ?? e ?? "").includes(MFA_REQUIRED);
}
