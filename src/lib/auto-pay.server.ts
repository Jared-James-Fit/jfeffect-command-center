/**
 * Auto-pay changes, the Stripe side (auto-pay.ts decides; this does). Load
 * inside handlers only.
 *
 * - `mintAutoPayCheckout`: the change's Stripe Checkout (a subscription, the
 *   first charge on the agreed day), kept on the change row, never on the
 *   sale: a link on the package would take it out of what the current
 *   auto-pay pays while it waits. /autopay/<token> mints a fresh one whenever
 *   the last has expired (Stripe caps them at 24 hours).
 * - `completeAutoPayChange`: the webhook, once the client has set it up:
 *   the package takes the new subscription and its schedule, and the auto-pay
 *   it replaces is cancelled (no refund, no proration, nothing charged).
 * - `stopSubscription`: stop an auto-pay now or at the end of its period.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGREEMENT_CHECKOUT_PARAMS } from "@/lib/coaching-agreement/checkout-notice";
import { businessToday, stripeFirstPaymentParams } from "@/lib/billing-schedule";
import {
  EVERY_STRIPE,
  FREQUENCY_FOR,
  paymentsToCover,
  priceLookupKey,
  stripeFirstCharge,
  structureText,
  type Every,
} from "@/lib/auto-pay";

type Db = SupabaseClient<any, any, any>;

async function stripe() {
  return import("@/lib/stripe.server");
}

/** The key for the account a sale lives in (a test sale stays in test). */
export async function keyFor(mode: string | null | undefined): Promise<string | undefined> {
  const { getStripeKeyForMode } = await stripe();
  return (mode === "test" ? getStripeKeyForMode("test") : getStripeKeyForMode("live")) ?? undefined;
}

/**
 * The Stripe product the new price belongs to: the package's own, its offer's,
 * else the product behind the current auto-pay's price.
 */
export async function productFor(
  admin: Db,
  sale: { stripe_product_id?: string | null; offer_id?: string | null; stripe_price_id?: string | null },
  replaced: { stripe_price_id?: string | null } | null,
  apiKey: string | undefined,
): Promise<string> {
  if (sale.stripe_product_id) return sale.stripe_product_id;
  if (sale.offer_id) {
    const { data: prod } = await admin.from("coaching_products").select("stripe_product_id").eq("id", sale.offer_id).maybeSingle();
    if ((prod as any)?.stripe_product_id) return (prod as any).stripe_product_id;
  }
  const { stripeFetch } = await stripe();
  for (const priceId of [sale.stripe_price_id, replaced?.stripe_price_id]) {
    if (!priceId) continue;
    const price = await stripeFetch(`/prices/${encodeURIComponent(priceId)}`, { apiKey }).catch(() => null);
    const product = typeof price?.product === "string" ? price.product : price?.product?.id;
    if (product) return product;
  }
  throw new Error("This package has no Stripe product to bill under. Open the package's product in Products and link it to Stripe first.");
}

/** One reusable price per product, amount and schedule (before tax; Stripe Tax adds GST). */
export async function findOrCreatePrice(
  apiKey: string | undefined,
  product: string,
  eachCents: number,
  every: Every,
  currency = "cad",
): Promise<string> {
  const { stripeFetch, formEncode } = await stripe();
  const lookup = priceLookupKey(product, eachCents, every);
  const found = await stripeFetch(`/prices?active=true&limit=1&lookup_keys[]=${encodeURIComponent(lookup)}`, { apiKey });
  if (found?.data?.[0]?.id) return found.data[0].id as string;
  const r = EVERY_STRIPE[every];
  const price = await stripeFetch("/prices", {
    apiKey,
    method: "POST",
    idempotencyKey: `price_${lookup}`,
    body: formEncode({
      product,
      unit_amount: String(eachCents),
      currency: currency.toLowerCase(),
      "recurring[interval]": r.interval,
      "recurring[interval_count]": String(r.count),
      tax_behavior: "exclusive",
      lookup_key: lookup,
      "metadata[kind]": "auto_pay",
    }),
  });
  return price.id as string;
}

export type ChangeRow = {
  id: string;
  client_id: string;
  sale_id: string;
  replaces_sale_id: string | null;
  replaces_subscription_id: string | null;
  each_cents: number;
  every: Every;
  first_charge_date: string | null;
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_mode: string | null;
  token: string;
  status: string;
  checkout_session_id: string | null;
  checkout_url: string | null;
  checkout_expires_at: string | null;
};

/**
 * The first charge, kept in step with the auto-pay it replaces: if that one
 * charged meanwhile, the new one starts at its next date instead, so a link
 * opened late never charges twice in one period.
 */
async function firstChargeNow(admin: Db, change: ChangeRow): Promise<string | null> {
  let first = change.first_charge_date;
  if (change.replaces_sale_id) {
    const { data: old } = await admin
      .from("purchase_records")
      .select("next_billing_date, stripe_subscription_status")
      .eq("id", change.replaces_sale_id)
      .maybeSingle();
    const next = (old as any)?.next_billing_date ? String((old as any).next_billing_date).slice(0, 10) : null;
    if (next && (!first || next > first)) first = next;
  }
  return stripeFirstCharge(first, businessToday());
}

/** The change's Checkout: the open one when it has time left, else a fresh one. */
export async function mintAutoPayCheckout(admin: Db, change: ChangeRow, origin: string): Promise<{ url: string; id: string }> {
  if (change.status !== "pending") throw new Error("This auto-pay link is no longer needed.");
  const leftMs = change.checkout_expires_at ? Date.parse(change.checkout_expires_at) - Date.now() : 0;
  if (change.checkout_url && change.checkout_session_id && leftMs > 60 * 60_000) {
    return { url: change.checkout_url, id: change.checkout_session_id };
  }
  const { stripeFetch, formEncode } = await stripe();
  const apiKey = await keyFor(change.stripe_mode);
  const { data: client } = await admin.from("clients").select("id, email, full_name, user_id, stripe_customer_id").eq("id", change.client_id).maybeSingle();
  if (!client) throw new Error("Client not found");
  const { data: sale } = await admin.from("purchase_records").select("stripe_customer_id").eq("id", change.sale_id).maybeSingle();
  let customer: string | null = (client as any).stripe_customer_id ?? (sale as any)?.stripe_customer_id ?? null;
  if (!customer && change.replaces_sale_id) {
    const { data: old } = await admin.from("purchase_records").select("stripe_customer_id").eq("id", change.replaces_sale_id).maybeSingle();
    customer = (old as any)?.stripe_customer_id ?? null;
  }
  if (!change.stripe_price_id) throw new Error("This change has no Stripe price.");

  const params: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": change.stripe_price_id,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/portal/purchases?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/portal/purchases`,
    "automatic_tax[enabled]": "true",
    billing_address_collection: "required",
    "metadata[purchase_record_id]": change.sale_id,
    "metadata[client_id]": change.client_id,
    "metadata[auto_pay_change_id]": change.id,
    "metadata[workspace]": "jfeffect",
    "subscription_data[metadata][purchase_record_id]": change.sale_id,
    "subscription_data[metadata][client_id]": change.client_id,
    "subscription_data[metadata][auto_pay_change_id]": change.id,
    "subscription_data[metadata][workspace]": "jfeffect",
    ...AGREEMENT_CHECKOUT_PARAMS,
    ...stripeFirstPaymentParams(await firstChargeNow(admin, change)),
  };
  if ((client as any).user_id) params["metadata[user_id]"] = (client as any).user_id;
  if (change.replaces_subscription_id) params["metadata[replaces_subscription_id]"] = change.replaces_subscription_id;
  if (customer) {
    params.customer = customer;
    params["customer_update[address]"] = "auto";
  } else if ((client as any).email) {
    params.customer_email = (client as any).email;
  }
  const session = await stripeFetch("/checkout/sessions", { apiKey, method: "POST", body: formEncode(params) });
  const expires = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
  await admin
    .from("auto_pay_changes")
    .update({ checkout_session_id: session.id, checkout_url: session.url, checkout_expires_at: expires })
    .eq("id", change.id)
    .eq("status", "pending");
  return { url: session.url as string, id: session.id as string };
}

/** Stop a subscription: now (nothing more is charged, no refund) or at the end of the period it's in. */
export async function stopSubscription(
  admin: Db,
  saleId: string,
  when: "now" | "period_end",
  why: string,
): Promise<{ subscriptionId: string } | null> {
  const { data: s } = await admin
    .from("purchase_records")
    .select("id, stripe_subscription_id, stripe_subscription_status, stripe_mode, cancel_at_period_end")
    .eq("id", saleId)
    .maybeSingle();
  const sub = (s as any)?.stripe_subscription_id as string | undefined;
  if (!sub) return null;
  const status = String((s as any).stripe_subscription_status ?? "").toLowerCase();
  if (status === "canceled" || status === "incomplete_expired") return { subscriptionId: sub };
  const { stripeFetch } = await stripe();
  const apiKey = await keyFor((s as any).stripe_mode);
  if (when === "now") {
    // Cancelled at once: no final invoice, no proration, no refund.
    await stripeFetch(`/subscriptions/${encodeURIComponent(sub)}?invoice_now=false&prorate=false`, {
      apiKey,
      method: "DELETE",
      idempotencyKey: `${why}_cancel_${sub}`,
    });
  } else if (!(s as any).cancel_at_period_end) {
    await stripeFetch(`/subscriptions/${encodeURIComponent(sub)}`, {
      apiKey,
      method: "POST",
      idempotencyKey: `${why}_end_${sub}`,
      body: "cancel_at_period_end=true",
    });
    await admin.from("purchase_records").update({ cancel_at_period_end: true, last_payment_update_source: why, last_payment_update_at: new Date().toISOString() }).eq("id", saleId);
  }
  return { subscriptionId: sub };
}

/**
 * The client set up the new auto-pay (checkout.session.completed): the package
 * takes the subscription and its schedule, the change is done, and the
 * auto-pay it replaces is cancelled. Idempotent: a change already done is left
 * as it is. Never throws (the webhook carries on).
 */
export async function completeAutoPayChange(
  admin: Db,
  input: { changeId?: string | null; saleId: string; subscriptionId: string | null; sessionId: string },
): Promise<{ completed: boolean; replaced?: string | null; error?: string } | null> {
  try {
    let q = admin.from("auto_pay_changes").select("*").eq("status", "pending");
    q = input.changeId ? q.eq("id", input.changeId) : q.eq("sale_id", input.saleId);
    const { data: change } = await q.limit(1).maybeSingle();
    if (!change) return null;
    const c = change as ChangeRow & { each_cents: number };
    if (!input.subscriptionId) return null;

    const { data: sale } = await admin.from("purchase_records").select("id, amount_outstanding_cents").eq("id", c.sale_id).maybeSingle();
    const left = Number((sale as any)?.amount_outstanding_cents ?? 0);
    const payments = paymentsToCover(left, c.each_cents);
    await admin
      .from("purchase_records")
      .update({
        stripe_subscription_id: input.subscriptionId,
        stripe_checkout_session_id: input.sessionId,
        stripe_price_id: c.stripe_price_id,
        stripe_product_id: c.stripe_product_id,
        stripe_mode: c.stripe_mode,
        installment_amount: c.each_cents / 100,
        payment_frequency: FREQUENCY_FOR[c.every],
        payment_structure: structureText(c.every, payments || null),
        number_of_payments: payments || null,
        first_payment_date: c.first_charge_date,
        is_recurring: true,
        payment_status: "Active Subscription",
        last_payment_update_source: "auto_pay_change",
        last_payment_update_at: new Date().toISOString(),
      } as any)
      .eq("id", c.sale_id);

    let replaceError: string | null = null;
    if (c.replaces_sale_id && c.replaces_subscription_id && c.replaces_subscription_id !== input.subscriptionId) {
      try {
        await stopSubscription(admin, c.replaces_sale_id, "now", `auto_pay_change_${c.id}`);
      } catch (e: any) {
        replaceError = String(e?.message ?? e).slice(0, 300);
      }
    }
    await admin
      .from("auto_pay_changes")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        new_subscription_id: input.subscriptionId,
        replaced_cancel_error: replaceError,
      })
      .eq("id", c.id)
      .eq("status", "pending");
    await admin.from("financial_audit_events").insert({
      client_id: c.client_id,
      actor_user_id: null,
      actor_role: "system",
      action: "auto_pay_changed",
      record_type: "purchase_records",
      record_id: c.sale_id,
      before_state: { subscription: c.replaces_subscription_id, sale: c.replaces_sale_id },
      after_state: { subscription: input.subscriptionId, each_cents: c.each_cents, every: c.every, first: c.first_charge_date },
      reason: replaceError ? `New auto-pay set up; the old one couldn't be cancelled: ${replaceError}` : "New auto-pay set up by the client",
    } as any);
    return { completed: true, replaced: c.replaces_subscription_id, error: replaceError ?? undefined };
  } catch (e: any) {
    console.error("[auto-pay] complete failed", e);
    return { completed: false, error: e?.message ?? String(e) };
  }
}

export type StartChangeInput = {
  clientId: string;
  saleId: string;
  eachWithTaxCents: number;
  every: "week" | "2 weeks" | "month";
  firstDate: string;
  note?: string;
};

/**
 * Start a new auto-pay (or a replacement for the one running) for a client:
 * check it against their billing as the Billing tab reads it, find or make
 * the Stripe price, record the change, make its checkout, and post the setup
 * card in their chat from `actorUserId`. `db` is who reads and posts: the
 * admin's own login from the app, the service role from a back-office hook.
 * `preview` only checks and says what it would send. Nothing is charged.
 */
export async function sendAutoPayChange({ admin, db, actorUserId, input, origin, preview = false }: {
  admin: Db;
  db: Db;
  actorUserId: string;
  input: StartChangeInput;
  origin: string;
  preview?: boolean;
}): Promise<{ changeId: string | null; url: string | null; summary: Record<string, unknown> }> {
  const { buildClientPayments } = await import("@/lib/payment-schedule");
  const { clientTaxRate } = await import("@/lib/client-billing-summary");
  const { autoPayOptions, beforeTax, changeProblem, setupMessage, withTax } = await import("@/lib/auto-pay");
  const { businessToday } = await import("@/lib/billing-schedule");
  const { formatMoney } = await import("@/lib/payment-display");

  const [salesRes, ledgerRes, eventsRes, balanceRes] = await Promise.all([
    db.from("purchase_records").select("*").eq("client_id", input.clientId),
    db.from("payment_ledger").select("*").eq("client_id", input.clientId),
    db.from("session_ledger_events").select("*").eq("client_id", input.clientId),
    db.rpc("session_balance", { _client_id: input.clientId }, { get: true }),
  ]);
  if (salesRes.error) throw new Error(salesRes.error.message);
  const sales = (salesRes.data ?? []) as any[];
  const today = businessToday();
  const p = buildClientPayments({ sales, ledger: ledgerRes.data ?? [], events: eventsRes.data ?? [], balance: balanceRes.data ?? [], today });
  const rate = clientTaxRate(sales as any);
  const opts = autoPayOptions({ p, sales, rate, today, preferSaleId: input.saleId });
  const target = opts.targets.find((t) => t.saleId === input.saleId) ?? null;
  const problem = changeProblem({ eachWithTaxCents: input.eachWithTaxCents, firstDate: input.firstDate, today, target });
  if (problem) throw new Error(problem);
  const sale = sales.find((s) => s.id === input.saleId)!;
  const current = opts.current;
  const replaced = current ? sales.find((s) => s.id === current.saleId) ?? null : null;
  const eachCents = beforeTax(input.eachWithTaxCents, rate);
  const summary = {
    pays_first: target?.label ?? null,
    left_cents: target?.leftCents ?? null,
    each_with_tax_cents: withTax(eachCents, rate),
    each_before_tax_cents: eachCents,
    every: input.every,
    first: input.firstDate,
    replaces: current ? { sale: current.saleId, subscription: current.subscriptionId, each_with_tax_cents: current.eachWithTaxCents, every: current.every, next: current.next } : null,
  };
  if (preview) return { changeId: null, url: null, summary };

  const mode = (replaced?.stripe_mode ?? sale.stripe_mode ?? "live") as string;
  const apiKey = await keyFor(mode);
  const product = await productFor(admin, sale, replaced, apiKey);
  const price = await findOrCreatePrice(apiKey, product, eachCents, input.every, String(sale.currency ?? "CAD"));

  // One change waiting per client: an earlier one is superseded (its link stops working).
  const { data: older } = await admin.from("auto_pay_changes").select("id, checkout_session_id, stripe_mode").eq("client_id", input.clientId).eq("status", "pending");
  for (const o of (older ?? []) as any[]) {
    await admin.from("auto_pay_changes").update({ status: "superseded", cancelled_at: new Date().toISOString() }).eq("id", o.id).eq("status", "pending");
    if (o.checkout_session_id) {
      const { stripeFetch } = await stripe();
      await stripeFetch(`/checkout/sessions/${encodeURIComponent(o.checkout_session_id)}/expire`, { apiKey: await keyFor(o.stripe_mode), method: "POST" }).catch(() => null);
    }
  }

  const { randomBytes } = await import("node:crypto");
  const token = randomBytes(18).toString("base64url");
  const { data: change, error } = await admin
    .from("auto_pay_changes")
    .insert({
      client_id: input.clientId,
      sale_id: sale.id,
      replaces_sale_id: replaced?.id ?? null,
      replaces_subscription_id: current?.subscriptionId ?? null,
      each_cents: eachCents,
      every: input.every,
      first_charge_date: input.firstDate,
      stripe_product_id: product,
      stripe_price_id: price,
      stripe_mode: mode,
      token,
      note: input.note || null,
      created_by: actorUserId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  // Make the checkout now, so a Stripe problem shows to the coach and not on the client's phone.
  try {
    await mintAutoPayCheckout(admin, change, origin);
  } catch (e: any) {
    await admin.from("auto_pay_changes").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", change.id);
    throw new Error(`Stripe couldn't make the link: ${e?.message ?? e}`);
  }

  const url = `${origin}/autopay/${token}`;
  const money = (c: number) => formatMoney(c / 100, String(sale.currency ?? "CAD"));
  const { data: client } = await admin.from("clients").select("preferred_name, first_name, full_name").eq("id", input.clientId).maybeSingle();
  const body = setupMessage({
    firstName: (client as any)?.preferred_name || (client as any)?.first_name || (client as any)?.full_name || null,
    eachWithTaxCents: withTax(eachCents, rate),
    every: input.every,
    firstDate: input.firstDate,
    today,
    replacing: current,
    url,
    money,
  });
  const attachment = {
    type: "link",
    kind: "auto_pay_setup",
    url,
    change_id: change.id,
    title: "Set up auto-pay",
    each_cents: withTax(eachCents, rate),
    every: input.every,
    first_date: input.firstDate,
    currency: String(sale.currency ?? "CAD"),
  };
  const { data: msg, error: mErr } = await db
    .from("messages")
    .insert({ client_id: input.clientId, sender_id: actorUserId, sender_role: "admin", body, attachments: [attachment], message_type: "Payment", read_by_admin_at: new Date().toISOString() })
    .select("id")
    .single();
  if (mErr) throw new Error(`The link is ready but the message didn't send: ${mErr.message}. Copy it from Billing.`);
  await admin.from("auto_pay_changes").update({ message_id: msg.id }).eq("id", change.id);
  await admin.from("financial_audit_events").insert({
    client_id: input.clientId,
    actor_user_id: actorUserId,
    actor_role: "admin",
    action: "auto_pay_change_sent",
    record_type: "auto_pay_changes",
    record_id: change.id,
    before_state: current ? { subscription: current.subscriptionId, each_cents: current.eachCents, every: current.every } : null,
    after_state: { sale_id: sale.id, each_cents: eachCents, every: input.every, first: input.firstDate },
    reason: input.note || null,
  });
  return { changeId: change.id as string, url, summary };
}
