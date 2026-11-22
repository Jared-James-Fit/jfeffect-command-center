/**
 * Seat billing for coach workspaces: what Stripe should be told and what the
 * database should say, decided here (pure, tested in coach-billing.test.ts),
 * carried out by coach-billing.server.ts. Test mode only until the owner
 * approves pricing and the release gate in docs/COACHING_PLATFORM.md passes:
 * nothing here can reach a live key (assertTestMode).
 *
 * The model (docs/COACH_PLATFORM_BUSINESS_2026-11.md, "Seat billing"):
 *   * one Stripe subscription per business, one item, a graduated tiered
 *     price; the item's quantity is the business's PAID clients (the free
 *     ones are never a line), so Stripe's own tiers apply the volume price
 *   * a change in clients updates the quantity with proration onto the next
 *     invoice, never a charge on its own, keyed by seatSyncKey so a retry is
 *     one update
 *   * a business with no paid clients pays nothing and needs no card; the
 *     first paid client starts a 14-day grace to add one
 *   * a failed payment starts a 14-day grace; after either grace the
 *     business reads but can't write (writeAccess, the same rule as
 *     public.org_can_write); nothing is ever deleted for money
 */
import { type SeatPricing, seatSyncKey, stripeTiers, cleanPricing } from "./seat-pricing";

export const GRACE_DAYS = 14;
const DAY = 86_400_000;

/** Never true without a migration and the owner's approval. */
export const COACH_BILLING_LIVE = false;

export const COACH_SEATS_KIND = "coach_seats";
/** Stripe product id for coach seats (Stripe lets us name it, so it's found, never duplicated). */
export const COACH_SEATS_PRODUCT_ID = "jf_coach_seats";

export type BillingState = "free" | "needs_setup" | "active" | "past_due" | "paused" | "canceled";

/** The organization_billing row as the server reads it. */
export type BillingRow = {
  org_id: string;
  pricing: Record<string, unknown>;
  state: BillingState;
  livemode: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_item_id: string | null;
  seats: number;
  paid_seats: number;
  seat_revision: number;
  synced_revision: number;
  synced_quantity: number | null;
  needs_setup_since: string | null;
  past_due_since: string | null;
  grace_until: string | null;
  current_period_end: string | null;
};

/** The business's frozen price, read the way the database stored it. */
export function rowPricing(row: Pick<BillingRow, "pricing">): SeatPricing {
  const p = row.pricing ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  const from = num(p.volume_from);
  const vol = num(p.volume_cents);
  return cleanPricing({
    freeClients: Number.isFinite(num(p.free_clients)) ? num(p.free_clients) : 1,
    perClientCents: Number.isFinite(num(p.per_client_cents)) ? num(p.per_client_cents) : 500,
    volume: Number.isFinite(from) && Number.isFinite(vol) ? { fromClient: from, perClientCents: vol } : null,
    currency: "CAD",
  });
}

/* ------------------------------------------------------------------ */
/* Access                                                              */
/* ------------------------------------------------------------------ */

export type WriteAccess = { canWrite: boolean; reason: null | "setup_lapsed" | "payment_lapsed" | "paused" | "canceled"; graceEndsAt: string | null };

/**
 * May the business change its clients' records? The same rule as
 * public.org_can_write's billing half (20270510090000_coach_workspaces.sql).
 * A business with no paid clients always can.
 */
export function writeAccess(row: Pick<BillingRow, "state" | "paid_seats" | "needs_setup_since" | "grace_until">, now: Date = new Date()): WriteAccess {
  const t = now.getTime();
  if ((row.state === "paused" || row.state === "canceled") && row.paid_seats > 0) {
    return { canWrite: false, reason: row.state, graceEndsAt: null };
  }
  if (row.state === "needs_setup" && row.needs_setup_since) {
    const ends = new Date(row.needs_setup_since).getTime() + GRACE_DAYS * DAY;
    return t > ends
      ? { canWrite: false, reason: "setup_lapsed", graceEndsAt: new Date(ends).toISOString() }
      : { canWrite: true, reason: null, graceEndsAt: new Date(ends).toISOString() };
  }
  if (row.state === "past_due" && row.grace_until) {
    const ends = new Date(row.grace_until).getTime();
    return t > ends
      ? { canWrite: false, reason: "payment_lapsed", graceEndsAt: row.grace_until }
      : { canWrite: true, reason: null, graceEndsAt: row.grace_until };
  }
  return { canWrite: true, reason: null, graceEndsAt: null };
}

/** One line for the coach's billing screen. */
export function billingLine(row: BillingRow, now: Date = new Date()): string {
  const a = writeAccess(row, now);
  const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  switch (row.state) {
    case "free":
      return "You're on the free tier. Nothing to pay.";
    case "needs_setup":
      return a.canWrite
        ? `Add a card by ${day(a.graceEndsAt!)} to keep editing your clients' programs. Nothing is charged until then.`
        : "Add a card to keep editing. Your clients' records are safe and you can still read them.";
    case "active":
      return row.current_period_end ? `Billing is set up. Next invoice ${day(row.current_period_end)}.` : "Billing is set up.";
    case "past_due":
      return a.canWrite
        ? `Your last payment didn't go through. Update your card by ${day(a.graceEndsAt!)}.`
        : "Your last payment didn't go through. Update your card to keep editing. Nothing has been deleted.";
    case "paused":
      return "Billing is paused. Your clients' records are safe.";
    case "canceled":
      return row.paid_seats > 0 ? "Billing ended. Set it up again to keep editing." : "You're on the free tier. Nothing to pay.";
  }
}

/* ------------------------------------------------------------------ */
/* Stripe objects                                                      */
/* ------------------------------------------------------------------ */

/** Which Stripe subscription status means what here. */
export function stateFromStripe(status: string | null | undefined): BillingState {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "incomplete":
    default:
      return "needs_setup";
  }
}

/**
 * Is this Stripe object part of coach seat billing? Checked by JF Effect's own
 * payment webhook so a coach's subscription is never mistaken for a client's
 * sale (no "unlinked payment" flag, no "PAYMENT FAILED" email to the owner).
 */
export function isCoachSeatsObject(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  const kinds = [
    obj.metadata?.kind,
    obj.subscription_details?.metadata?.kind,
    obj.parent?.subscription_details?.metadata?.kind,
    obj.subscription_data?.metadata?.kind,
    obj.lines?.data?.[0]?.metadata?.kind,
  ];
  return kinds.includes(COACH_SEATS_KIND);
}

/** The lookup key of the price for a business's frozen pricing (one price per distinct pricing). */
export function seatPriceLookupKey(pricing: SeatPricing): string {
  const v = pricing.volume ? `_v${pricing.volume.fromClient}_${pricing.volume.perClientCents}` : "";
  return `jf_coach_seats_f${pricing.freeClients}_${pricing.perClientCents}${v}_${pricing.currency.toLowerCase()}`;
}

/** The form fields that create that price: monthly, graduated, before tax. */
export function seatPriceParams(pricing: SeatPricing): Record<string, unknown> {
  const tiers = stripeTiers(pricing).map((t) => ({
    up_to: t.upTo === "inf" ? "inf" : t.upTo,
    unit_amount: t.unitAmountCents,
  }));
  return {
    product: COACH_SEATS_PRODUCT_ID,
    currency: pricing.currency.toLowerCase(),
    lookup_key: seatPriceLookupKey(pricing),
    billing_scheme: "tiered",
    tiers_mode: "graduated",
    tiers,
    recurring: { interval: "month", usage_type: "licensed" },
    tax_behavior: "exclusive",
    nickname: `Coach seats: ${pricing.freeClients} free, then $${(pricing.perClientCents / 100).toFixed(2)}`
      + (pricing.volume ? `, $${(pricing.volume.perClientCents / 100).toFixed(2)} from client ${pricing.volume.fromClient}` : ""),
    metadata: { kind: COACH_SEATS_KIND },
  };
}

/**
 * The Checkout Session that sets up billing for a business's paid clients
 * (only offered once it has one: a free business never gives a card).
 */
export function seatCheckoutParams(opts: {
  orgId: string;
  priceId: string;
  paidSeats: number;
  customerId: string | null;
  email: string | null;
  successUrl: string;
  cancelUrl: string;
}): Record<string, unknown> {
  if (opts.paidSeats < 1) throw new Error("Billing is set up once there's a paid client");
  const meta = { kind: COACH_SEATS_KIND, org_id: opts.orgId };
  return {
    mode: "subscription",
    line_items: [{ price: opts.priceId, quantity: opts.paidSeats }],
    ...(opts.customerId ? { customer: opts.customerId } : opts.email ? { customer_email: opts.email } : {}),
    client_reference_id: opts.orgId,
    metadata: meta,
    subscription_data: { metadata: meta },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    custom_text: {
      submit: {
        message: "Billed monthly for your clients past the free one. Clients added or removed are prorated onto your next invoice. Cancel any time from your workspace.",
      },
    },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  };
}

/* ------------------------------------------------------------------ */
/* Keeping the quantity in step                                        */
/* ------------------------------------------------------------------ */

export type SeatSync =
  | { kind: "none"; why: string }
  | { kind: "update"; itemId: string; quantity: number; idempotencyKey: string; revision: number };

/** Should Stripe's quantity change, and with which key? */
export function seatSyncDecision(row: BillingRow): SeatSync {
  if (row.livemode) return { kind: "none", why: "live billing is off" };
  if (row.synced_revision >= row.seat_revision && row.synced_quantity === row.paid_seats) {
    return { kind: "none", why: "in step" };
  }
  if (!row.stripe_subscription_id || !row.stripe_item_id) return { kind: "none", why: "no subscription yet" };
  if (row.state === "canceled") return { kind: "none", why: "subscription ended" };
  const quantity = Math.max(0, row.paid_seats);
  return {
    kind: "update",
    itemId: row.stripe_item_id,
    quantity,
    revision: row.seat_revision,
    idempotencyKey: seatSyncKey(row.stripe_subscription_id, row.seat_revision, quantity),
  };
}

/** The subscription item update: prorated onto the next invoice, never invoiced on its own. */
export function seatUpdateParams(quantity: number): Record<string, unknown> {
  return { quantity: Math.max(0, Math.floor(quantity)), proration_behavior: "create_prorations", payment_behavior: "allow_incomplete" };
}

/* ------------------------------------------------------------------ */
/* Webhook events                                                      */
/* ------------------------------------------------------------------ */

export type BillingPatch = Partial<Omit<BillingRow, "org_id" | "pricing" | "seat_revision" | "seats" | "paid_seats">>;

export type EventPlan =
  | { kind: "ignore"; why: string }
  | { kind: "patch"; orgId: string | null; subscriptionId: string | null; customerId: string | null; patch: BillingPatch; then?: "fetch_subscription" };

const iso = (sec: unknown) => (typeof sec === "number" && sec > 0 ? new Date(sec * 1000).toISOString() : null);

/** The subscription's period end, from the subscription or (API 2025-03-31+) its item. */
export function periodEnd(sub: any): string | null {
  return iso(sub?.current_period_end) ?? iso(sub?.items?.data?.[0]?.current_period_end);
}

/** What one verified event means for a business's billing row. */
export function planForEvent(event: any, row: BillingRow | null, now: Date = new Date()): EventPlan {
  if (!event || typeof event !== "object") return { kind: "ignore", why: "not an event" };
  if (event.livemode === true && !COACH_BILLING_LIVE) return { kind: "ignore", why: "live event while coach billing is test mode only" };
  const obj = event.data?.object ?? {};
  if (!isCoachSeatsObject(obj)) return { kind: "ignore", why: "not coach seats" };
  const orgId: string | null = obj.metadata?.org_id ?? obj.subscription_details?.metadata?.org_id
    ?? obj.parent?.subscription_details?.metadata?.org_id ?? row?.org_id ?? null;
  const nowIso = now.toISOString();

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription" || !obj.subscription) return { kind: "ignore", why: "not a subscription checkout" };
      return {
        kind: "patch",
        orgId,
        subscriptionId: String(obj.subscription),
        customerId: obj.customer ? String(obj.customer) : null,
        patch: { stripe_subscription_id: String(obj.subscription), stripe_customer_id: obj.customer ? String(obj.customer) : null },
        then: "fetch_subscription",
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const item = obj.items?.data?.[0];
      const state = stateFromStripe(obj.status);
      const patch: BillingPatch = {
        state,
        stripe_subscription_id: obj.id ?? null,
        stripe_customer_id: obj.customer ? String(obj.customer) : null,
        stripe_item_id: item?.id ?? row?.stripe_item_id ?? null,
        synced_quantity: typeof item?.quantity === "number" ? item.quantity : row?.synced_quantity ?? null,
        current_period_end: periodEnd(obj) ?? row?.current_period_end ?? null,
      };
      if (state === "active") Object.assign(patch, { needs_setup_since: null, past_due_since: null, grace_until: null });
      if (state === "past_due") Object.assign(patch, pastDue(row, now));
      return { kind: "patch", orgId, subscriptionId: obj.id ?? null, customerId: patch.stripe_customer_id ?? null, patch };
    }
    case "customer.subscription.deleted":
      return {
        kind: "patch",
        orgId,
        subscriptionId: obj.id ?? null,
        customerId: obj.customer ? String(obj.customer) : null,
        patch: { state: "canceled", stripe_item_id: null, synced_quantity: null, current_period_end: null },
      };
    case "invoice.paid":
    case "invoice.payment_succeeded":
      return {
        kind: "patch",
        orgId,
        subscriptionId: invoiceSub(obj),
        customerId: obj.customer ? String(obj.customer) : null,
        patch: { state: "active", needs_setup_since: null, past_due_since: null, grace_until: null },
      };
    case "invoice.payment_failed":
      return {
        kind: "patch",
        orgId,
        subscriptionId: invoiceSub(obj),
        customerId: obj.customer ? String(obj.customer) : null,
        patch: { state: "past_due", ...pastDue(row, now) },
      };
    default:
      return { kind: "ignore", why: `nothing to do for ${event.type}` };
  }
}

function invoiceSub(inv: any): string | null {
  const s = inv?.subscription ?? inv?.parent?.subscription_details?.subscription ?? inv?.subscription_details?.subscription;
  return typeof s === "string" ? s : s?.id ?? null;
}

/** A failed payment's grace runs from the first failure, never restarted by Stripe's retries. */
function pastDue(row: BillingRow | null, now: Date): Pick<BillingPatch, "past_due_since" | "grace_until"> {
  const since = row?.state === "past_due" && row.past_due_since ? row.past_due_since : now.toISOString();
  return { past_due_since: since, grace_until: new Date(new Date(since).getTime() + GRACE_DAYS * DAY).toISOString() };
}

/* ------------------------------------------------------------------ */
/* Reconciliation                                                      */
/* ------------------------------------------------------------------ */

export type ReconcileAction =
  | { kind: "set_quantity"; quantity: number; idempotencyKey: string }
  | { kind: "patch"; patch: BillingPatch; why: string }
  | { kind: "flag"; why: string };

/**
 * Compare a business's row with its subscription as Stripe has it (null: no
 * subscription, or Stripe says it doesn't exist) and say what to fix. Stripe
 * is the truth for status and period; the database is the truth for seats.
 */
export function reconcile(row: BillingRow, sub: any | null, now: Date = new Date()): ReconcileAction[] {
  const out: ReconcileAction[] = [];
  if (row.livemode) return [{ kind: "flag", why: "live billing row while coach billing is test mode only" }];
  if (!row.stripe_subscription_id) {
    if (row.paid_seats > 0 && row.state !== "needs_setup") {
      out.push({ kind: "patch", patch: { state: "needs_setup", needs_setup_since: row.needs_setup_since ?? now.toISOString() }, why: "paid clients and no subscription" });
    }
    if (row.paid_seats === 0 && row.state === "needs_setup") {
      out.push({ kind: "patch", patch: { state: "free", needs_setup_since: null }, why: "no paid clients" });
    }
    return out;
  }
  if (!sub) {
    out.push({ kind: "flag", why: `subscription ${row.stripe_subscription_id} not found in Stripe` });
    return out;
  }
  if (isCoachSeatsObject(sub) && sub.metadata?.org_id && sub.metadata.org_id !== row.org_id) {
    return [{ kind: "flag", why: "subscription belongs to another business" }];
  }
  const state = stateFromStripe(sub.status);
  const item = sub.items?.data?.[0];
  const patch: BillingPatch = {};
  if (state !== row.state) patch.state = state;
  if (state === "past_due" && !row.grace_until) Object.assign(patch, pastDue(row, now));
  if (state === "active" && (row.past_due_since || row.grace_until || row.needs_setup_since)) {
    Object.assign(patch, { past_due_since: null, grace_until: null, needs_setup_since: null });
  }
  const pe = periodEnd(sub);
  if (pe && pe !== row.current_period_end) patch.current_period_end = pe;
  if (item?.id && item.id !== row.stripe_item_id) patch.stripe_item_id = item.id;
  if (Object.keys(patch).length) out.push({ kind: "patch", patch, why: "Stripe and the database disagree" });
  if (state !== "canceled" && item && item.quantity !== row.paid_seats) {
    // A seat change the database recorded and never synced is applied. A
    // difference with nothing recorded (Stripe changed by hand, say) is
    // corrected only downward: anything that would raise the coach's bill is
    // held for the owner to look at.
    const pending = row.synced_revision < row.seat_revision;
    if (pending || row.paid_seats < item.quantity) {
      out.push({
        kind: "set_quantity",
        quantity: row.paid_seats,
        idempotencyKey: seatSyncKey(row.stripe_subscription_id, row.seat_revision, row.paid_seats),
      });
    } else {
      out.push({ kind: "flag", why: `Stripe bills ${item.quantity} paid clients and the workspace has ${row.paid_seats}: raising the bill is held for review` });
    }
  }
  if ((sub.items?.data?.length ?? 0) > 1) out.push({ kind: "flag", why: "subscription has more than one item" });
  return out;
}

/** Refuse anything but a test key (and never while COACH_BILLING_LIVE is off). */
export function assertTestMode(key: string | null | undefined): string {
  if (!key) throw new Error("Coach billing needs a Stripe test key (STRIPE_SECRET_KEY_TEST)");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("Coach billing runs in test mode only until the owner approves pricing");
  }
  return key;
}
