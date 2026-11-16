/**
 * Auto-pay from the client's Billing tab (admins): see the card it charges,
 * change it (a new amount, schedule or card is a new subscription the client
 * sets up from a link sent in their chat; the current one keeps going until
 * then), cancel a change still waiting, or stop auto-pay. Nothing here
 * charges anyone: Stripe charges only on the dates the client agreed to at
 * checkout. The pure rules are auto-pay.ts, the Stripe calls auto-pay.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdminView } from "@/lib/permissions.server";

const SITE = "https://jfeffect.com";

async function assertAdmin(supabase: any, userId: string) {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (!data) throw new Error("Only an admin can change how a client pays.");
}

/** The card an auto-pay charges, read live from Stripe (brand and last 4 only). */
export const getAutoPayCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ saleId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = await assertAdminView(context as any);
    const { data: s } = await db.from("purchase_records").select("stripe_subscription_id, stripe_customer_id, stripe_mode").eq("id", data.saleId).maybeSingle();
    if (!(s as any)?.stripe_subscription_id) return { card: null as null | { brand: string; last4: string; exp: string | null } };
    const { stripeFetch } = await import("@/lib/stripe.server");
    const { keyFor } = await import("@/lib/auto-pay.server");
    const apiKey = await keyFor((s as any).stripe_mode);
    const read = (pm: any) =>
      pm?.card ? { brand: String(pm.card.brand ?? "card"), last4: String(pm.card.last4 ?? ""), exp: pm.card.exp_month ? `${pm.card.exp_month}/${String(pm.card.exp_year ?? "").slice(-2)}` : null } : null;
    try {
      const sub = await stripeFetch(`/subscriptions/${encodeURIComponent((s as any).stripe_subscription_id)}?expand[]=default_payment_method`, { apiKey });
      let card = read(sub?.default_payment_method);
      if (!card && (sub?.customer || (s as any).stripe_customer_id)) {
        const cus = await stripeFetch(`/customers/${encodeURIComponent(sub?.customer ?? (s as any).stripe_customer_id)}?expand[]=invoice_settings.default_payment_method`, { apiKey });
        card = read(cus?.invoice_settings?.default_payment_method);
      }
      return { card };
    } catch {
      return { card: null };
    }
  });

export const StartChange = z.object({
  clientId: z.string().uuid(),
  saleId: z.string().uuid(),
  eachWithTaxCents: z.number().int().min(100).max(10_000_000),
  every: z.enum(["week", "2 weeks", "month"]),
  firstDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

/** Start a new auto-pay (or replace the one running): the price, the change, the link, and the card in their chat. */
export const startAutoPayChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StartChange.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendAutoPayChange } = await import("@/lib/auto-pay.server");
    const r = await sendAutoPayChange({ admin: supabaseAdmin as any, db: supabase, actorUserId: userId, input: data, origin: SITE });
    return { ok: true, changeId: r.changeId as string, url: r.url as string };
  });

/** Take back a change the client hasn't set up yet (their link stops working; the current auto-pay carries on). */
export const cancelAutoPayChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ changeId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: c } = await (supabaseAdmin as any).from("auto_pay_changes").select("*").eq("id", data.changeId).maybeSingle();
    if (!c) throw new Error("Not found");
    if (c.status !== "pending") return { ok: true, already: true };
    await (supabaseAdmin as any).from("auto_pay_changes").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", c.id).eq("status", "pending");
    if (c.checkout_session_id) {
      const { stripeFetch } = await import("@/lib/stripe.server");
      const { keyFor } = await import("@/lib/auto-pay.server");
      await stripeFetch(`/checkout/sessions/${encodeURIComponent(c.checkout_session_id)}/expire`, { apiKey: await keyFor(c.stripe_mode), method: "POST" }).catch(() => null);
    }
    return { ok: true, already: false };
  });

/** Stop an auto-pay: now (no more charges, no refund) or at the end of the period it's in. What's owed stays owed. */
export const stopAutoPay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ saleId: z.string().uuid(), when: z.enum(["now", "period_end"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { stopSubscription } = await import("@/lib/auto-pay.server");
    const { data: s } = await (supabaseAdmin as any).from("purchase_records").select("client_id").eq("id", data.saleId).maybeSingle();
    if (!s) throw new Error("Not found");
    const r = await stopSubscription(supabaseAdmin as any, data.saleId, data.when, "coach_stopped_auto_pay");
    if (!r) throw new Error("There's no auto-pay on this sale.");
    await (supabaseAdmin as any).from("financial_audit_events").insert({
      client_id: s.client_id,
      actor_user_id: userId,
      actor_role: "admin",
      action: data.when === "now" ? "auto_pay_stopped" : "auto_pay_stops_at_period_end",
      record_type: "purchase_records",
      record_id: data.saleId,
      after_state: { subscription: r.subscriptionId, when: data.when },
    });
    return { ok: true };
  });
