/**
 * Purchase term date management server functions.
 * Handles start/end date assignment, history tracking, and auto-calculation.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ── Update term dates (with history) ────────────────────────────────────────

export const updatePurchaseTermDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      purchaseId: z.string().uuid(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: result, error } = await supabase.rpc(
      "update_purchase_term_dates",
      {
        _purchase_id: data.purchaseId,
        _start_date: data.startDate,
        _end_date: data.endDate,
        _reason: data.reason ?? null,
      }
    );
    if (error) throw error;
    return result;
  });

// ── Auto-calculate term dates from product term ──────────────────────────────

export const autoCalculatePurchaseTermDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      purchaseId: z.string().uuid(),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      termLength: z.number().int().positive().nullable().optional(),
      termUnit: z.enum(["days", "weeks", "months", "years"]).nullable().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const today = new Date().toISOString().split("T")[0];
    const { data: result, error } = await supabase.rpc(
      "auto_calculate_purchase_term_dates",
      {
        _purchase_id: data.purchaseId,
        _start_date: data.startDate ?? today,
        _term_length: data.termLength ?? null,
        _term_unit: data.termUnit ?? null,
      }
    );
    if (error) throw error;
    return result;
  });

// ── Get Stripe failed payments for a purchase ────────────────────────────────
// Reads from the stripe_payment_intent_id on the purchase record and
// fetches failed charge attempts from Stripe via the admin Stripe key.

export const getPurchaseStripeFailures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ purchaseId: z.string().uuid() }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Get the purchase record
    const { data: purchase, error: pErr } = await supabase
      .from("purchase_records")
      .select("stripe_payment_intent_id, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id")
      .eq("id", data.purchaseId)
      .single();
    if (pErr || !purchase) return { failures: [] };

    // Only attempt Stripe lookup if we have a Stripe key
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return { failures: [] };

    try {
      const failures: Array<{
        id: string;
        amount: number;
        currency: string;
        status: string;
        failure_message: string | null;
        created: number;
      }> = [];

      // Fetch payment intent charges if we have a payment intent ID
      if (purchase.stripe_payment_intent_id) {
        const res = await fetch(
          `https://api.stripe.com/v1/charges?payment_intent=${purchase.stripe_payment_intent_id}&limit=10`,
          {
            headers: {
              Authorization: `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );
        if (res.ok) {
          const json = await res.json();
          for (const charge of json.data ?? []) {
            if (charge.status === "failed") {
              failures.push({
                id: charge.id,
                amount: charge.amount,
                currency: charge.currency,
                status: charge.status,
                failure_message: charge.failure_message ?? charge.failure_code ?? "Payment failed",
                created: charge.created,
              });
            }
          }
        }
      }

      // Fetch subscription invoices if we have a subscription ID
      if (purchase.stripe_subscription_id) {
        const res = await fetch(
          `https://api.stripe.com/v1/invoices?subscription=${purchase.stripe_subscription_id}&status=open&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
          }
        );
        if (res.ok) {
          const json = await res.json();
          for (const inv of json.data ?? []) {
            if (inv.status === "open" && inv.attempt_count > 0) {
              failures.push({
                id: inv.id,
                amount: inv.amount_due,
                currency: inv.currency,
                status: "failed_invoice",
                failure_message: `Invoice overdue — ${inv.attempt_count} attempt${inv.attempt_count > 1 ? "s" : ""}`,
                created: inv.created,
              });
            }
          }
        }
      }

      return { failures };
    } catch {
      return { failures: [] };
    }
  });
