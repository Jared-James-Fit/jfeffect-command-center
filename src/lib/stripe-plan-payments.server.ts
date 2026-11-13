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

const LIVE_SUB = new Set(["active", "trialing", "past_due"]);

/**
 * After a payment recorded by hand: when it leaves nothing owed on a session
 * package auto-pay plan, the subscription is set to stop at the end of its
 * period, so Stripe never charges for what was already paid. Nothing is
 * charged here, and it never stops a plan that still owes anything (or when
 * that can't be read). The webhook does the same after a paid invoice.
 */
export async function endAutoPayIfPaidUp(
  db: Db,
  clientId: string,
): Promise<{ ended: boolean; saleId?: string; subscriptionId?: string; error?: string }> {
  const { data: carriers } = await db
    .from("purchase_records")
    .select("id, stripe_subscription_id, stripe_subscription_status, payment_status, cancel_at_period_end, sessions_purchased, stripe_mode")
    .eq("client_id", clientId)
    .is("archived_at", null)
    .gt("sessions_purchased", 0)
    .not("stripe_subscription_id", "is", null);
  for (const c of (carriers ?? []) as any[]) {
    if (c.cancel_at_period_end) continue;
    // Stripe's own status when it's known; the sale's label only when it isn't.
    const status = String(c.stripe_subscription_status ?? "").toLowerCase();
    const live = status ? LIVE_SUB.has(status) : c.payment_status === "Active Subscription";
    if (!live) continue;
    if ((await planStillOwed(db, c)) !== false) continue;
    try {
      const { stripeFetch, getStripeKeyForMode } = await import("@/lib/stripe.server");
      const apiKey = (c.stripe_mode === "test" ? getStripeKeyForMode("test") : getStripeKeyForMode("live")) ?? undefined;
      const day = new Date().toISOString().slice(0, 10);
      await stripeFetch(`/subscriptions/${encodeURIComponent(c.stripe_subscription_id)}`, {
        apiKey,
        method: "POST",
        body: "cancel_at_period_end=true",
        idempotencyKey: `plan_paid_by_hand_${c.stripe_subscription_id}_${day}`,
      });
      await db.from("purchase_records").update({
        cancel_at_period_end: true,
        last_payment_update_source: "manual_payment_paid_up",
        last_payment_update_at: new Date().toISOString(),
      }).eq("id", c.id);
      return { ended: true, saleId: c.id, subscriptionId: c.stripe_subscription_id };
    } catch (e: any) {
      return { ended: false, saleId: c.id, subscriptionId: c.stripe_subscription_id, error: e?.message ?? "Stripe refused" };
    }
  }
  return { ended: false };
}
