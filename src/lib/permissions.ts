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
 *   tasks.manage      – add, edit, complete and remove tasks on the team board
 *
 * finance.* belongs to the business owner plus role grants (the finance role);
 * admins keep every other permission.
 */
export const PERMISSIONS = [
  "finance.read", "finance.record", "finance.delete",
  "admin.view", "payments.record", "payments.request", "discounts.manage", "tasks.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What a view-only login sees when it tries to change something it can't. */
export const VIEW_ONLY_MESSAGE = "View only: your login can look but can't change this.";

/**
 * Header that turns on a view-only login's admin view for one API read (see
 * supabase/migrations/20261020093700_finance_admin_view.sql). It only ever
 * widens reads for a view-only login inside a read-only transaction; for anyone
 * else it does nothing.
 */
export const ADMIN_VIEW_HEADER = "x-jf-admin-view";

/**
 * payments.record lets a login record money that came in (recordPayment, a payment row the
 * database adds up), never set a sale's status or total by hand; refunds, voids and comps stay
 * the owner's.
 */
