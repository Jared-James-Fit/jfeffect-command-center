/**
 * Shared types for the admin_transactions_v1 database view.
 *
 * The view is a UNION over payment_ledger (client purchases) and
 * member_payment_ledger (memberships) — see the corresponding migration.
 * RLS is enforced by the underlying base tables (security_invoker=true),
 * so admins/coaches see everything and members/clients only see their own
 * rows if we ever expose it to them (we currently only query from admin UI).
 */

export type TransactionSource = "client" | "membership";
export type TransactionSubjectKind = "client" | "member";

export type AdminTransactionRow = {
  id: string;
  source: TransactionSource;
  occurred_on: string;              // ISO date
  occurred_at: string;              // ISO timestamp
  subject_id: string | null;
  subject_kind: TransactionSubjectKind;
  subject_name: string | null;
  subject_email: string | null;
  purchase_id: string | null;
  offer_id: string | null;
  product_name: string;
  purchase_type: string | null;
  amount: number;
  currency: string;
  txn_type: string;
  method: string | null;
  status: string;
  stripe_customer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_invoice_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_subscription_id: string | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  receipt_url: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  stripe_mode: string | null;
  admin_notes: string | null;
  voided: boolean;
};