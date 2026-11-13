/**
 * Selling AI credit packs through Stripe (server only).
 *
 * Each pack is a real Stripe product and price (found by its lookup key, made
 * once if it isn't there), sold before tax with Stripe Tax adding GST at
 * checkout like every other JF Effect price. A pack's Checkout Session and its
 * PaymentIntent carry `metadata.kind = "ai_credits"`, which is how the webhook
 * and the Stripe sync know it's a credit pack and never a payment on a
 * coaching sale. The credits are added once per session, by whichever comes
 * first: the webhook or the page they return to.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { formEncode, stripeFetch } from "@/lib/stripe.server";
import {
  CREDIT_CURRENCY,
  checkoutReturnUrls,
  packByKey,
  packLookupKey,
  type CreditPack,
  type CreditState,
} from "./packs";

export const AI_CREDITS_KIND = "ai_credits";

/** A Stripe object (Checkout Session, PaymentIntent, Charge) from a credit pack. */
export function isAiCreditsObject(obj: any): boolean {
  return obj?.metadata?.kind === AI_CREDITS_KIND;
}

const priceIds = new Map<string, string>();

async function packPriceId(pack: CreditPack): Promise<string> {
  const key = packLookupKey(pack);
  const cached = priceIds.get(key);
  if (cached) return cached;
  const found = await stripeFetch(
    `/prices?active=true&limit=1&lookup_keys[]=${encodeURIComponent(key)}`,
  );
  const hit = (found?.data ?? []).find(
    (p: any) => p?.unit_amount === pack.amountCents && p?.currency === CREDIT_CURRENCY,
  );
  if (hit?.id) {
    priceIds.set(key, hit.id);
    return hit.id;
  }
  const created = await stripeFetch("/prices", {
    method: "POST",
    idempotencyKey: `price_${key}`,
    body: formEncode({
      currency: CREDIT_CURRENCY,
      unit_amount: pack.amountCents,
      tax_behavior: "exclusive",
      lookup_key: key,
      transfer_lookup_key: true,
      product_data: {
        name: `JF Effect AI credits · ${pack.credits.toLocaleString("en-CA")}`,
        metadata: { kind: AI_CREDITS_KIND, credits: pack.credits },
      },
      metadata: { kind: AI_CREDITS_KIND, pack: pack.key, credits: pack.credits },
    }),
  });
  if (!created?.id) throw new Error("Stripe didn't return a price for the credit pack.");
  priceIds.set(key, created.id);
  return created.id;
}

export async function createCreditsCheckout(opts: {
  userId: string;
  email: string | null;
  packKey: string;
  origin: string;
  returnPath: string;
}): Promise<{ url: string; sessionId: string }> {
  const pack = packByKey(opts.packKey);
  if (!pack) throw new Error("That credit pack isn't for sale.");
  const { data: client } = await (supabaseAdmin as any)
    .from("clients")
    .select("id, email, stripe_customer_id")
    .eq("user_id", opts.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const priceId = await packPriceId(pack);
  const urls = checkoutReturnUrls(opts.origin, opts.returnPath);
  const meta = {
    kind: AI_CREDITS_KIND,
    user_id: opts.userId,
    pack: pack.key,
    credits: pack.credits,
  };
  const params: Record<string, any> = {
    mode: "payment",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: urls.success,
    cancel_url: urls.cancel,
    client_reference_id: opts.userId,
    // Stripe Tax adds GST/HST from the billing address, like every JF Effect checkout.
    "automatic_tax[enabled]": true,
    billing_address_collection: "required",
    metadata: meta,
    payment_intent_data: {
      metadata: meta,
      description: `JF Effect AI credits · ${pack.credits.toLocaleString("en-CA")}`,
    },
    "custom_text[submit][message]":
      "Credits are added to your JF Effect account right away and never expire.",
  };
  const customer = client?.stripe_customer_id ?? null;
  const email = opts.email ?? client?.email ?? null;
  if (customer) {
    params.customer = customer;
    params["customer_update[address]"] = "auto";
  } else if (email) {
    params.customer_email = email;
  }
  const session = await stripeFetch("/checkout/sessions", {
    method: "POST",
    body: formEncode(params),
  });
  if (!session?.url) throw new Error("Stripe didn't open a checkout.");
  return { url: String(session.url), sessionId: String(session.id) };
}

export type RecordedCredits = {
  added: number;
  duplicate: boolean;
  pending: boolean;
  credits: number;
  state: CreditState | null;
};

/**
 * Add a paid pack's credits (once per session). Not a credit pack: null.
 * Not paid yet (a delayed payment method): `pending`, nothing added.
 * `expectUser` makes sure the person confirming is the one who bought it.
 */
export async function recordCreditsFromSession(
  session: any,
  opts: { expectUser?: string } = {},
): Promise<RecordedCredits | null> {
  if (!isAiCreditsObject(session)) return null;
  const userId = String(session?.metadata?.user_id ?? "");
  if (!userId) throw new Error("This checkout has no account on it.");
  if (opts.expectUser && opts.expectUser !== userId)
    throw new Error("This checkout belongs to another account.");
  const credits =
    Number.parseInt(String(session?.metadata?.credits ?? ""), 10) ||
    packByKey(session?.metadata?.pack)?.credits ||
    0;
  if (session?.payment_status !== "paid")
    return { added: 0, duplicate: false, pending: true, credits, state: null };
  if (!(credits > 0)) throw new Error("This checkout has no credits on it.");
  const pi =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const customer =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  const { data, error } = await (supabaseAdmin as any).rpc("ai_credits_record_purchase", {
    _user: userId,
    _pack: String(session?.metadata?.pack ?? "custom"),
    _credits: credits,
    _amount_minor: Number(session.amount_subtotal ?? 0),
    _tax_minor: Number(session.total_details?.amount_tax ?? 0),
    _total_minor: Number(session.amount_total ?? 0),
    _currency: String(session.currency ?? CREDIT_CURRENCY),
    _session: String(session.id),
    _payment_intent: pi,
    _customer: customer,
    _mode: session.livemode === false ? "test" : "live",
    _paid_at: session.created
      ? new Date(Number(session.created) * 1000).toISOString()
      : new Date().toISOString(),
  });
  if (error) throw new Error(`Couldn't add the credits: ${error.message}`);
  return {
    added: Number(data?.added ?? 0),
    duplicate: !!data?.duplicate,
    pending: false,
    credits,
    state: (data?.state ?? null) as CreditState | null,
  };
}

/** Look a session up in Stripe and add its credits (the page they return to after paying). */
export async function confirmCreditsSession(
  sessionId: string,
  userId: string,
): Promise<RecordedCredits> {
  const session = await stripeFetch(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const r = await recordCreditsFromSession(session, { expectUser: userId });
  if (!r) throw new Error("That checkout wasn't for AI credits.");
  return r;
}

/**
 * A refund on a Stripe charge: if it paid for a credit pack, take back the
 * credits it paid for that are still unused. True when the charge was a
 * credit pack's (so the caller never treats it as a coaching sale's).
 */
export async function reverseCreditsForCharge(charge: any): Promise<boolean> {
  const pi =
    typeof charge?.payment_intent === "string"
      ? charge.payment_intent
      : (charge?.payment_intent?.id ?? null);
  if (pi) {
    const { data, error } = await (supabaseAdmin as any).rpc("ai_credits_record_refund", {
      _payment_intent: pi,
      _refunded_minor: Number(charge?.amount_refunded ?? 0),
    });
    if (error) throw new Error(`Couldn't take back refunded credits: ${error.message}`);
    if (data) return true;
  }
  if (isAiCreditsObject(charge)) {
    console.warn("[ai-credits] refund on a credit pack that was never recorded", {
      charge: charge?.id,
      pi,
    });
    return true;
  }
  return false;
}

/** A Stripe refund object (the account sync's list) on a credit pack's payment. */
export async function isCreditPackPayment(
  paymentIntentId: string | null | undefined,
): Promise<boolean> {
  if (!paymentIntentId) return false;
  const { data } = await (supabaseAdmin as any)
    .from("ai_credit_purchases")
    .select("id")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .limit(1);
  return (data ?? []).length > 0;
}
