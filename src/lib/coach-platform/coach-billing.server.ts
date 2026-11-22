/**
 * Seat billing against Stripe, TEST MODE ONLY (coach-billing.ts decides,
 * this carries it out). Every call takes the test key through assertTestMode,
 * so a live key in the environment can never be used here; COACH_BILLING_LIVE
 * stays false until the owner approves pricing and a migration lifts
 * organization_billing.livemode's check.
 *
 * Writes go to organization_billing / coach_billing_events with the service
 * role, which is only ever reached after a caller check (the server functions
 * in coach-workspace.functions.ts) or a verified webhook / hook secret.
 */
import { formEncode, getStripeKeyForMode, stripeFetch } from "@/lib/stripe.server";
import {
  type BillingPatch,
  type BillingRow,
  COACH_SEATS_KIND,
  COACH_SEATS_PRODUCT_ID,
  assertTestMode,
  planForEvent,
  reconcile,
  rowPricing,
  seatCheckoutParams,
  seatPriceLookupKey,
  seatPriceParams,
  seatSyncDecision,
  seatUpdateParams,
} from "./coach-billing";
import { verifyStripeSignature } from "./stripe-signature";

type Db = any;

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** The test key, or an error: never the live key. */
export function coachBillingKey(): string {
  return assertTestMode(getStripeKeyForMode("test"));
}

const stripe = (path: string, init: { method?: string; body?: string; idempotencyKey?: string } = {}) =>
  stripeFetch(path, { ...init, apiKey: coachBillingKey() });

export async function readBilling(db: Db, orgId: string): Promise<BillingRow | null> {
  const { data, error } = await db.from("organization_billing").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BillingRow) ?? null;
}

async function patchBilling(db: Db, orgId: string, patch: BillingPatch) {
  if (!Object.keys(patch).length) return;
  // a test-mode row stays test mode whatever a patch says
  const { livemode: _ignored, ...safe } = patch as any;
  const { error } = await db.from("organization_billing").update({ ...safe, updated_at: new Date().toISOString() }).eq("org_id", orgId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------------ */
/* The price                                                           */
/* ------------------------------------------------------------------ */

const priceCache = new Map<string, string>();

/** The price for a business's frozen pricing: found by lookup key, made once if missing. */
export async function ensureSeatPrice(row: Pick<BillingRow, "pricing">): Promise<string> {
  const pricing = rowPricing(row);
  const key = seatPriceLookupKey(pricing);
  const cached = priceCache.get(key);
  if (cached) return cached;
  const found = await stripe(`/prices?active=true&limit=1&lookup_keys[]=${encodeURIComponent(key)}`);
  let id: string | undefined = found?.data?.[0]?.id;
  if (!id) {
    try {
      await stripe(`/products/${COACH_SEATS_PRODUCT_ID}`);
    } catch {
      await stripe("/products", {
        method: "POST",
        idempotencyKey: `coach-seats-product:${COACH_SEATS_PRODUCT_ID}`,
        body: formEncode({
          id: COACH_SEATS_PRODUCT_ID,
          name: "JF Effect for coaches: clients",
          description: "Monthly, per active client past your free one.",
          metadata: { kind: COACH_SEATS_KIND },
          tax_code: "txcd_10103001", // SaaS, business use (Stripe Tax; confirm with the accountant)
        }),
      });
    }
    const created = await stripe("/prices", {
      method: "POST",
      idempotencyKey: `coach-seats-price:${key}`,
      body: formEncode(seatPriceParams(pricing) as any),
    });
    id = created.id;
  }
  priceCache.set(key, id!);
  return id!;
}

/* ------------------------------------------------------------------ */
/* Checkout, quantity, portal                                          */
/* ------------------------------------------------------------------ */

/** A Checkout Session to set up billing (only once a business has a paid client). */
export async function startSeatCheckout(orgId: string, opts: { email: string | null; origin: string }): Promise<{ url: string }> {
  const db = await admin();
  const row = await readBilling(db, orgId);
  if (!row) throw new Error("This workspace has no billing record");
  if (row.livemode) throw new Error("Live billing is off");
  if (row.stripe_subscription_id && row.state !== "canceled") throw new Error("Billing is already set up");
  if (row.paid_seats < 1) throw new Error("Nothing to pay yet: your first client is free");
  const priceId = await ensureSeatPrice(row);
  const params = seatCheckoutParams({
    orgId,
    priceId,
    paidSeats: row.paid_seats,
    customerId: row.stripe_customer_id,
    email: opts.email,
    successUrl: `${opts.origin}/workspace/billing?done=1`,
    cancelUrl: `${opts.origin}/workspace/billing`,
  });
  const session = await stripe("/checkout/sessions", {
    method: "POST",
    idempotencyKey: `coach-seats-checkout:${orgId}:${row.seat_revision}`,
    body: formEncode(params as any),
  });
  return { url: session.url };
}

/** The Stripe customer portal for the card and invoices. */
export async function seatBillingPortal(orgId: string, origin: string): Promise<{ url: string }> {
  const db = await admin();
  const row = await readBilling(db, orgId);
  if (!row?.stripe_customer_id) throw new Error("Billing isn't set up yet");
  const s = await stripe("/billing_portal/sessions", {
    method: "POST",
    body: formEncode({ customer: row.stripe_customer_id, return_url: `${origin}/workspace/billing` }),
  });
  return { url: s.url };
}

/**
 * Bring Stripe's quantity in line with the business's paid clients. Keyed by
 * the seat revision, so a retry (or two workers at once) is one update; a
 * newer revision that lands meanwhile is synced on the next call.
 */
export async function syncSeats(orgId: string): Promise<{ synced: boolean; why: string; quantity?: number }> {
  const db = await admin();
  const row = await readBilling(db, orgId);
  if (!row) return { synced: false, why: "no billing record" };
  const d = seatSyncDecision(row);
  if (d.kind === "none") return { synced: false, why: d.why };
  const item = await stripe(`/subscription_items/${d.itemId}`, {
    method: "POST",
    idempotencyKey: d.idempotencyKey,
    body: formEncode(seatUpdateParams(d.quantity) as any),
  });
  // only move synced_revision forward: a newer count isn't marked synced by an older call
  const { error } = await db
    .from("organization_billing")
    .update({ synced_revision: d.revision, synced_quantity: item?.quantity ?? d.quantity, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .lt("synced_revision", d.revision);
  if (error) throw new Error(error.message);
  return { synced: true, why: "updated", quantity: d.quantity };
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

async function rowFor(db: Db, orgId: string | null, subscriptionId: string | null, customerId: string | null): Promise<BillingRow | null> {
  if (orgId) {
    const r = await readBilling(db, orgId);
    if (r) {
      // a subscription already on the row must be the one the event is about
      if (r.stripe_subscription_id && subscriptionId && r.stripe_subscription_id !== subscriptionId && r.state !== "canceled") {
        throw new Error(`event for subscription ${subscriptionId} but the workspace has ${r.stripe_subscription_id}`);
      }
      return r;
    }
  }
  for (const [col, val] of [["stripe_subscription_id", subscriptionId], ["stripe_customer_id", customerId]] as const) {
    if (!val) continue;
    const { data } = await db.from("organization_billing").select("*").eq(col, val).limit(2);
    if ((data ?? []).length === 1) return data[0] as BillingRow;
  }
  return null;
}

/**
 * The coach billing webhook: verify, claim the event once, apply it, then
 * keep the quantity in step. A failure gives the claim back so Stripe's retry
 * is handled, not dropped as a duplicate.
 */
export async function handleCoachBillingWebhook(raw: string, signature: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const secret = process.env.COACH_BILLING_WEBHOOK_SECRET_TEST ?? "";
  if (!secret) return { status: 503, body: { error: "coach billing webhook isn't configured" } };
  const check = await verifyStripeSignature(raw, signature, secret);
  if (!check.ok) return { status: 400, body: { error: `signature ${check.reason}` } };
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "bad json" } };
  }
  if (!/^evt_[A-Za-z0-9]+$/.test(String(event?.id ?? ""))) return { status: 400, body: { error: "no event id" } };

  const db = await admin();
  const first = planForEvent(event, null);
  if (first.kind === "ignore") return { status: 200, body: { received: true, ignored: first.why } };

  const { error: claimErr } = await db.from("coach_billing_events").insert({
    event_id: event.id, type: String(event.type), org_id: first.orgId, livemode: !!event.livemode,
  });
  if (claimErr) {
    if ((claimErr as any).code === "23505") return { status: 200, body: { received: true, duplicate: true } };
    return { status: 500, body: { error: "dedupe store error" } };
  }

  try {
    const row = await rowFor(db, first.orgId, first.subscriptionId, first.customerId);
    if (!row) throw new Error("no workspace for this event");
    const plan = planForEvent(event, row);
    if (plan.kind === "ignore") {
      await db.from("coach_billing_events").update({ handled_at: new Date().toISOString(), outcome: `ignored: ${plan.why}` }).eq("event_id", event.id);
      return { status: 200, body: { received: true, ignored: plan.why } };
    }
    await patchBilling(db, row.org_id, plan.patch);
    if (plan.then === "fetch_subscription" && plan.subscriptionId) {
      const sub = await stripe(`/subscriptions/${plan.subscriptionId}`);
      const after = planForEvent({ id: event.id, type: "customer.subscription.updated", livemode: event.livemode, data: { object: sub } }, await readBilling(db, row.org_id));
      if (after.kind === "patch") await patchBilling(db, row.org_id, after.patch);
    }
    // the count may have moved while they were in Checkout
    const sync = await syncSeats(row.org_id);
    await db.from("coach_billing_events").update({ handled_at: new Date().toISOString(), outcome: `applied; seats ${sync.why}`, org_id: row.org_id }).eq("event_id", event.id);
    return { status: 200, body: { received: true } };
  } catch (e: any) {
    // give the claim back so the retry is handled
    await db.from("coach_billing_events").delete().eq("event_id", event.id);
    return { status: 500, body: { error: String(e?.message ?? e) } };
  }
}

/* ------------------------------------------------------------------ */
/* Reconciliation (the nightly hook, and the owner's button)          */
/* ------------------------------------------------------------------ */

export type ReconcileResult = { orgId: string; applied: string[]; flags: string[] };

export async function reconcileWorkspace(orgId: string): Promise<ReconcileResult> {
  const db = await admin();
  const row = await readBilling(db, orgId);
  if (!row) return { orgId, applied: [], flags: ["no billing record"] };
  let sub: any = null;
  if (row.stripe_subscription_id) {
    try {
      sub = await stripe(`/subscriptions/${row.stripe_subscription_id}`);
    } catch (e: any) {
      if (!/No such subscription/i.test(String(e?.message))) throw e;
    }
  }
  const actions = reconcile(row, sub);
  const applied: string[] = [];
  const flags: string[] = [];
  for (const a of actions) {
    if (a.kind === "flag") flags.push(a.why);
    else if (a.kind === "patch") {
      await patchBilling(db, orgId, a.patch);
      applied.push(`${a.why}: ${Object.keys(a.patch).join(", ")}`);
    } else if (a.kind === "set_quantity") {
      const itemId = sub?.items?.data?.[0]?.id;
      await stripe(`/subscription_items/${itemId}`, { method: "POST", idempotencyKey: a.idempotencyKey, body: formEncode(seatUpdateParams(a.quantity) as any) });
      await db.from("organization_billing").update({ synced_revision: row.seat_revision, synced_quantity: a.quantity }).eq("org_id", orgId);
      applied.push(`quantity set to ${a.quantity}`);
    }
  }
  await db.from("organization_billing").update({ last_reconciled_at: new Date().toISOString() }).eq("org_id", orgId);
  return { orgId, applied, flags };
}

/** Every workspace that has billing to keep in step: out-of-step seats first, then a subscription to check. */
export async function reconcileAllWorkspaces(limit = 50): Promise<ReconcileResult[]> {
  const db = await admin();
  const { data, error } = await db
    .from("organization_billing")
    .select("org_id, seat_revision, synced_revision, stripe_subscription_id, paid_seats, state")
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const out: ReconcileResult[] = [];
  for (const r of data ?? []) {
    if (!r.stripe_subscription_id && r.paid_seats === 0 && r.state === "free") continue;
    try {
      out.push(await reconcileWorkspace(r.org_id));
    } catch (e: any) {
      out.push({ orgId: r.org_id, applied: [], flags: [`failed: ${String(e?.message ?? e)}`] });
    }
  }
  return out;
}
