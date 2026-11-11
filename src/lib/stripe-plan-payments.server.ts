// Server-only: which sale a subscription payment pays, for session packages on
// auto-pay. One Stripe subscription pays the client's packages in order, the
// oldest that still owes first (its own package, then the pay-later renewals
// after it), and stops once nothing is owed. The rule lives in the database
// (session_plan_payment_target) so the webhook, the reconcile and the daily
// sync can never disagree.
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, any, any>;

const isPackage = (p: any) => Number(p?.sessions_purchased ?? 0) > 0;

/** The package this subscription payment goes to: the oldest still owed on its plan, else the subscription's own sale. */
export async function planPaymentTarget<T extends { id: string; sessions_purchased?: number | null }>(db: Db, purchase: T): Promise<T> {
  if (!isPackage(purchase)) return purchase;
  const { data: target, error } = await (db as any).rpc("session_plan_payment_target", { _purchase_id: purchase.id });
  if (error || !target || target === purchase.id) return purchase;
  const { data: row } = await db.from("purchase_records").select("*").eq("id", target).maybeSingle();
  return (row as T | null) ?? purchase;
}

/**
 * Whether the plan still owes anything, so the subscription keeps charging.
 * Null when the sale isn't a session package (the caller keeps its own rule).
 */
export async function planStillOwed(db: Db, purchase: { id: string; sessions_purchased?: number | null }): Promise<boolean | null> {
  if (!isPackage(purchase)) return null;
  const { data: target, error } = await (db as any).rpc("session_plan_payment_target", { _purchase_id: purchase.id });
  if (error) return true; // unsure: never stop billing on a read error
  return !!target;
}

/** "Paid toward Package … (auto-pay carried on)" for the ledger note, when the payment moved. */
export function carriedNote(from: { id: string }, to: { id: string; offer_name?: string | null; short_description?: string | null }): string {
  return from.id === to.id ? "" : ` · paid toward ${to.offer_name ?? "the next package"} (auto-pay carried on from sale ${from.id})`;
}
