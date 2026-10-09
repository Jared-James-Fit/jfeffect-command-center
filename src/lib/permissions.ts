/**
 * Named permissions checked by has_permission() in SQL and requirePermission()
 * on the server. Keep in sync with public.role_permissions seeds.
 *
 *   finance.read      – payment ledgers, Taxes & Books
 *   finance.record    – add/edit expenses, receipts, tax payments, tax settings
 *   finance.delete    – delete books records (the business owner only)
 *   admin.view        – see everything the admin sees, read-only (the finance login)
 *   payments.record   – mark a purchase paid / partly paid (no refunds or cancellations)
 *   payments.request  – send a client the payment link for an existing purchase
 *   discounts.manage  – create, edit and pause discount codes
 *
 * finance.* belongs to the business owner plus role grants (the finance role);
 * admins keep every other permission. Your own permissions need an
 * MFA-verified session.
 */
export const PERMISSIONS = [
  "finance.read", "finance.record", "finance.delete",
  "admin.view", "payments.record", "payments.request", "discounts.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Thrown when the session isn't MFA-verified; the UI sends the user to verify. */
export const MFA_REQUIRED = "MFA_REQUIRED";

export function isMfaRequiredError(e: unknown): boolean {
  return String((e as any)?.message ?? e ?? "").includes(MFA_REQUIRED);
}

/** What a view-only login sees when it tries to change something it can't. */
export const VIEW_ONLY_MESSAGE = "View only: your login can look but can't change this.";

/**
 * Header that turns on a view-only login's admin view for one API read (see
 * supabase/migrations/20261020093700_finance_admin_view.sql). It only ever
 * widens reads for a view-only login inside a read-only transaction; for anyone
 * else it does nothing.
 */
export const ADMIN_VIEW_HEADER = "x-jf-admin-view";

/** Payment statuses a payments.record login may set: money in, or still owed. */
export const RECORDABLE_PAYMENT_STATUSES = [
  "Paid", "Partially Paid", "Payment Plan Active", "Pending Payment", "Overdue", "Failed", "Manual Payment Needed",
] as const;
