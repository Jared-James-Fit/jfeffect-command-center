/**
 * stripe-sync.functions.ts
 *
 * Admin-only, server-side reconciliation between Stripe and purchase_records.
 *
 * READ-ONLY against Stripe: it lists recent Checkout Sessions and their
 * subscriptions/invoices and writes the result back into the app. It never
 * charges, refunds, retries, cancels, or edits anything in Stripe, and it
 * never changes product prices.
 *
 * Idempotent: every write is an upsert/update keyed on a stable Stripe
 * reference (checkout session id, payment intent id, invoice id), so
 * re-running it produces no duplicates.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { stripeFetch, getStripeKeyForMode, type StripeMode } from "@/lib/stripe.server";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("admin")) throw new Error("Forbidden: admin only");
}

type SyncEntry = {
  session_id: string;
  purchase_id: string | null;
  client_id: string | null;
  action: "updated" | "no_change" | "skipped" | "unmapped";
  reason?: string;
  amount?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  occurred_at?: string | null;
};

const Input = z.object({
  /** How far back to scan Stripe, in days. */
  days: z.number().int().min(1).max(180).default(30),
  mode: z.enum(["test", "live"]).default("live"),
});

export const syncStripePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);

    const apiKey = getStripeKeyForMode(data.mode as StripeMode);
    if (!apiKey) {
      return {
        ok: false,
        error: `No Stripe ${data.mode} key is configured, so there is nothing to sync in ${data.mode} mode.`,
        entries: [] as SyncEntry[],
        counts: { updated: 0, no_change: 0, skipped: 0, unmapped: 0 },
      };
    }

    const createdAfter = Math.floor(Date.now() / 1000) - data.days * 86400;
    const entries: SyncEntry[] = [];

    // Page through recent Checkout Sessions (Stripe max 100 per page).
    let startingAfter: string | null = null;
    const sessions: any[] = [];
    for (let page = 0; page < 5; page++) {
      const qs = new URLSearchParams({
        limit: "100",
        "created[gte]": String(createdAfter),
      });
      if (startingAfter) qs.set("starting_after", startingAfter);
      const res: any = await stripeFetch(`/checkout/sessions?${qs.toString()}`, { apiKey });
      const rows: any[] = res?.data ?? [];
      sessions.push(...rows);
      if (!res?.has_more || rows.length === 0) break;
      startingAfter = rows[rows.length - 1].id;
    }

    for (const s of sessions) {
      const occurredAt = s.created ? new Date(s.created * 1000).toISOString() : null;
      const email = s.customer_details?.email ?? s.customer_email ?? null;
      const base: SyncEntry = {
        session_id: s.id,
        purchase_id: null,
        client_id: null,
        action: "skipped",
        amount: s.amount_total != null ? s.amount_total / 100 : null,
        currency: (s.currency ?? "usd").toUpperCase(),
        customer_email: email,
        occurred_at: occurredAt,
      };

      if (s.metadata?.preview === "true" || s.metadata?.kind === "jf_membership") {
        entries.push({ ...base, reason: "Not a coaching purchase (preview or membership)." });
        continue;
      }
      if (s.payment_status !== "paid" && s.payment_status !== "no_payment_required") {
        entries.push({ ...base, reason: `Stripe payment_status = ${s.payment_status}.` });
        continue;
      }

      // 1) Metadata match (authoritative).
      let purchase: any = null;
      const prId = s.metadata?.purchase_record_id || s.metadata?.payment_request_id || null;
      if (prId) {
        const { data: byId } = await supabase
          .from("purchase_records").select("*").eq("id", prId).maybeSingle();
        purchase = byId ?? null;
      }
      // 2) Session id already stored.
      if (!purchase) {
        const { data: bySession } = await supabase
          .from("purchase_records").select("*").eq("stripe_checkout_session_id", s.id).maybeSingle();
        purchase = bySession ?? null;
      }
      // 3) Safe fallback: client by Stripe customer id or email + an awaiting record.
      if (!purchase) {
        let clientId: string | null = null;
        if (s.customer) {
          const { data: c } = await supabase
            .from("clients").select("id").eq("stripe_customer_id", s.customer).maybeSingle();
          clientId = c?.id ?? null;
        }
        if (!clientId && email) {
          const { data: c } = await supabase
            .from("clients").select("id").ilike("email", email).maybeSingle();
          clientId = c?.id ?? null;
        }
        if (clientId) {
          const { data: pending } = await supabase
            .from("purchase_records")
            .select("*")
            .eq("client_id", clientId)
            .in("payment_status", ["Pending Payment", "Payment Link Sent", "Pending", "Unpaid"])
            .order("purchased_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          purchase = pending ?? null;
        }
      }

      if (!purchase) {
        entries.push({
          ...base,
          action: "unmapped",
          reason: "No matching purchase record — no metadata link, no stored session, and no awaiting purchase for this customer.",
        });
        continue;
      }

      const isSub = s.mode === "subscription" && !!s.subscription;
      const patch: Record<string, any> = {
        payment_status: isSub ? "Active Subscription" : "Paid",
        paid_at: purchase.paid_at ?? occurredAt,
        amount_paid: s.amount_total != null ? s.amount_total / 100 : purchase.amount_paid,
        stripe_checkout_session_id: s.id,
        stripe_payment_intent_id: s.payment_intent ?? purchase.stripe_payment_intent_id,
        stripe_subscription_id: s.subscription ?? purchase.stripe_subscription_id,
        stripe_customer_id: s.customer ?? purchase.stripe_customer_id,
        stripe_mode: data.mode,
        service_status: "Active",
        last_payment_update_source: "stripe_sync",
        last_payment_update_at: new Date().toISOString(),
      };

      // Recurring: read (never modify) the subscription for renewal state.
      if (isSub) {
        try {
          const sub: any = await stripeFetch(`/subscriptions/${s.subscription}`, { apiKey });
          patch.is_recurring = true;
          patch.stripe_subscription_status = sub?.status ?? null;
          patch.cancel_at_period_end = !!sub?.cancel_at_period_end;
          patch.next_billing_date =
            sub?.cancel_at_period_end || !sub?.current_period_end
              ? null
              : new Date(sub.current_period_end * 1000).toISOString();
        } catch (e: any) {
          entries.push({ ...base, purchase_id: purchase.id, client_id: purchase.client_id, action: "skipped", reason: `Subscription lookup failed: ${e?.message ?? "unknown"}` });
          continue;
        }
      }

      const unchanged =
        purchase.payment_status === patch.payment_status &&
        purchase.stripe_checkout_session_id === patch.stripe_checkout_session_id &&
        String(purchase.next_billing_date ?? "") === String(patch.next_billing_date ?? "");

      if (!unchanged) {
        const { error: upErr } = await supabase.from("purchase_records").update(patch).eq("id", purchase.id);
        if (upErr) {
          entries.push({ ...base, purchase_id: purchase.id, client_id: purchase.client_id, action: "skipped", reason: upErr.message });
          continue;
        }
      }

      // Ledger row — idempotent on external_reference (the session id).
      if (s.amount_total && s.amount_total > 0) {
        await supabase.from("payment_ledger").upsert({
          client_id: purchase.client_id,
          purchase_id: purchase.id,
          txn_type: "payment",
          method: "stripe",
          amount_minor: s.amount_total,
          currency: (s.currency ?? "usd").toUpperCase(),
          transaction_date: (occurredAt ?? new Date().toISOString()).slice(0, 10),
          received_at: occurredAt,
          external_reference: s.id,
          stripe_payment_intent_id: s.payment_intent ?? null,
          source: "stripe_sync",
          internal_note: `Stripe sync — checkout session ${s.id}`,
        }, { onConflict: "external_reference", ignoreDuplicates: true }).then(() => {}, () => {});
      }

      entries.push({
        ...base,
        purchase_id: purchase.id,
        client_id: purchase.client_id,
        action: unchanged ? "no_change" : "updated",
      });
    }

    const counts = {
      updated: entries.filter((e) => e.action === "updated").length,
      no_change: entries.filter((e) => e.action === "no_change").length,
      skipped: entries.filter((e) => e.action === "skipped").length,
      unmapped: entries.filter((e) => e.action === "unmapped").length,
    };

    await supabase.from("client_activity_log").insert({
      client_id: null,
      actor_user_id: userId,
      actor_role: "admin",
      action: "stripe_payments_synced",
      details: { mode: data.mode, days: data.days, scanned: sessions.length, ...counts },
    }).then(() => {}, () => {});

    return { ok: true, scanned: sessions.length, counts, entries };
  });
