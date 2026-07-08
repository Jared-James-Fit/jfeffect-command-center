import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, getStripeKeyForMode, type StripeMode } from "@/lib/stripe.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

type BackfillEntry = {
  purchase_id: string;
  client_id: string | null;
  stripe_subscription_id: string;
  action: "updated" | "skipped" | "no_change";
  reason?: string;
  before?: {
    next_billing_date: string | null;
    stripe_subscription_status: string | null;
    cancel_at_period_end: boolean | null;
  };
  after?: {
    next_billing_date: string | null;
    stripe_subscription_status: string | null;
    cancel_at_period_end: boolean | null;
  };
};

/**
 * Idempotent backfill for recurring purchase_records missing
 * next_billing_date / stripe_subscription_status / cancel_at_period_end.
 *
 * Rules:
 *  - Only recurring rows with a stripe_subscription_id are considered.
 *  - Active/trialing (not cancelling) → store current_period_end.
 *  - cancel_at_period_end=true → preserve active state, do NOT surface a
 *    guaranteed next payment (next_billing_date = null).
 *  - canceled/deleted → clear next_billing_date.
 *  - Missing customer/client link or ambiguous → skip and report.
 *  - No new purchases or ledger rows are ever created here.
 *  - Safe to rerun: only writes when computed target differs from stored.
 */
export const backfillRecurringBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const { data: rows, error } = await supabase
      .from("purchase_records")
      .select(
        "id, client_id, stripe_customer_id, stripe_subscription_id, is_recurring, next_billing_date, stripe_subscription_status, cancel_at_period_end",
      )
      .not("stripe_subscription_id", "is", null)
      .eq("is_recurring", true);
    if (error) throw new Error(error.message);

    const results: BackfillEntry[] = [];
    let updated = 0;
    let skipped = 0;
    let unchanged = 0;

    for (const row of rows ?? []) {
      const subId: string = row.stripe_subscription_id;
      // Try live key first, then test key. Skip if neither can read the sub.
      let sub: any = null;
      let lastErr: string | null = null;
      for (const mode of ["live", "test"] as StripeMode[]) {
        const key = getStripeKeyForMode(mode);
        if (!key) continue;
        try {
          sub = await stripeFetch(`/subscriptions/${subId}`, { apiKey: key });
          break;
        } catch (e: any) {
          lastErr = e?.message ?? String(e);
        }
      }
      if (!sub) {
        skipped += 1;
        results.push({
          purchase_id: row.id,
          client_id: row.client_id ?? null,
          stripe_subscription_id: subId,
          action: "skipped",
          reason: `stripe subscription not readable (${lastErr ?? "no key"})`,
        });
        continue;
      }

      if (row.stripe_customer_id && sub.customer && row.stripe_customer_id !== sub.customer) {
        skipped += 1;
        results.push({
          purchase_id: row.id,
          client_id: row.client_id ?? null,
          stripe_subscription_id: subId,
          action: "skipped",
          reason: `stripe customer mismatch (record=${row.stripe_customer_id} sub=${sub.customer})`,
        });
        continue;
      }

      const status: string = sub.status ?? "unknown";
      const cancelAtPeriodEnd = !!sub.cancel_at_period_end;
      const isActive = status === "active" || status === "trialing";
      const isCancelled = status === "canceled" || status === "incomplete_expired";
      const nextBillingDate: string | null = (() => {
        if (isCancelled) return null;
        if (cancelAtPeriodEnd) return null;
        if (!isActive) return null;
        if (!sub.current_period_end) return null;
        return new Date(sub.current_period_end * 1000).toISOString().split("T")[0];
      })();

      const before = {
        next_billing_date: row.next_billing_date ?? null,
        stripe_subscription_status: row.stripe_subscription_status ?? null,
        cancel_at_period_end: row.cancel_at_period_end ?? null,
      };
      const after = {
        next_billing_date: nextBillingDate,
        stripe_subscription_status: status,
        cancel_at_period_end: cancelAtPeriodEnd,
      };

      const changed =
        before.next_billing_date !== after.next_billing_date ||
        before.stripe_subscription_status !== after.stripe_subscription_status ||
        before.cancel_at_period_end !== after.cancel_at_period_end;

      if (!changed) {
        unchanged += 1;
        results.push({
          purchase_id: row.id,
          client_id: row.client_id ?? null,
          stripe_subscription_id: subId,
          action: "no_change",
          before,
          after,
        });
        continue;
      }

      const { error: updErr } = await supabase
        .from("purchase_records")
        .update({
          next_billing_date: nextBillingDate,
          stripe_subscription_status: status,
          cancel_at_period_end: cancelAtPeriodEnd,
          last_payment_update_source: "recurring_backfill",
          last_payment_update_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updErr) {
        skipped += 1;
        results.push({
          purchase_id: row.id,
          client_id: row.client_id ?? null,
          stripe_subscription_id: subId,
          action: "skipped",
          reason: `update failed: ${updErr.message}`,
          before,
          after,
        });
        continue;
      }
      updated += 1;
      results.push({
        purchase_id: row.id,
        client_id: row.client_id ?? null,
        stripe_subscription_id: subId,
        action: "updated",
        before,
        after,
      });
    }

    return {
      audited: rows?.length ?? 0,
      updated,
      skipped,
      unchanged,
      results,
    };
  });