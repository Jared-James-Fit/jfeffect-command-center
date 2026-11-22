import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRACE_DAYS,
  type BillingRow,
  assertTestMode,
  isCoachSeatsObject,
  planForEvent,
  reconcile,
  rowPricing,
  seatCheckoutParams,
  seatPriceLookupKey,
  seatPriceParams,
  seatSyncDecision,
  stateFromStripe,
  writeAccess,
} from "@/lib/coach-platform/coach-billing";
import { RECOMMENDED_PRICING, monthlyFeeCents, seatSyncKey } from "@/lib/coach-platform/seat-pricing";
import { verifyStripeSignature } from "@/lib/coach-platform/stripe-signature";

const DAY = 86_400_000;
const NOW = new Date("2026-12-01T12:00:00Z");
const ORG = "11111111-1111-4111-8111-111111111111";

function row(over: Partial<BillingRow> = {}): BillingRow {
  return {
    org_id: ORG,
    pricing: { free_clients: 1, per_client_cents: 500, volume_from: 26, volume_cents: 300 },
    state: "free",
    livemode: false,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_item_id: null,
    seats: 1,
    paid_seats: 0,
    seat_revision: 1,
    synced_revision: 0,
    synced_quantity: null,
    needs_setup_since: null,
    past_due_since: null,
    grace_until: null,
    current_period_end: null,
    ...over,
  };
}

const sub = (over: any = {}) => ({
  id: "sub_1",
  object: "subscription",
  status: "active",
  customer: "cus_1",
  metadata: { kind: "coach_seats", org_id: ORG },
  items: { data: [{ id: "si_1", quantity: 3, current_period_end: Math.floor(NOW.getTime() / 1000) + 20 * 86400 }] },
  ...over,
});
const ev = (type: string, object: any, over: any = {}) => ({ id: "evt_1", type, livemode: false, data: { object }, ...over });

describe("pricing on the business's row", () => {
  it("reads the frozen price the database stored", () => {
    expect(rowPricing(row())).toEqual(RECOMMENDED_PRICING);
    expect(rowPricing(row({ pricing: { free_clients: 1, per_client_cents: 500 } })).volume).toBeNull();
  });

  it("is one Stripe price per distinct pricing, graduated, before tax", () => {
    const p = seatPriceParams(RECOMMENDED_PRICING) as any;
    expect(p.billing_scheme).toBe("tiered");
    expect(p.tiers_mode).toBe("graduated");
    expect(p.tax_behavior).toBe("exclusive");
    expect(p.recurring).toEqual({ interval: "month", usage_type: "licensed" });
    // quantity = paid clients: paid 1..24 are clients 2..25 at $5, client 26 on at $3
    expect(p.tiers).toEqual([{ up_to: 24, unit_amount: 500 }, { up_to: "inf", unit_amount: 300 }]);
    expect(seatPriceLookupKey(RECOMMENDED_PRICING)).toBe("jf_coach_seats_f1_500_v26_300_cad");
  });

  it("Stripe's graduated tiers give the same monthly total as the engine, for every size", () => {
    const tiers = (seatPriceParams(RECOMMENDED_PRICING) as any).tiers as Array<{ up_to: number | "inf"; unit_amount: number }>;
    const stripeTotal = (qty: number) => {
      let left = qty, prev = 0, total = 0;
      for (const t of tiers) {
        const cap = t.up_to === "inf" ? Infinity : t.up_to;
        const n = Math.max(0, Math.min(left, cap - prev));
        total += n * t.unit_amount;
        left -= n;
        prev = cap === Infinity ? prev : cap;
      }
      return total;
    };
    for (const clients of [0, 1, 2, 5, 25, 26, 27, 50, 100, 250]) {
      expect(stripeTotal(Math.max(0, clients - 1))).toBe(monthlyFeeCents(clients, RECOMMENDED_PRICING));
    }
    expect(monthlyFeeCents(50, RECOMMENDED_PRICING)).toBe(24 * 500 + 25 * 300);
  });
});

describe("checkout", () => {
  it("is only for a business with a paid client, tagged so every webhook knows it", () => {
    expect(() => seatCheckoutParams({ orgId: ORG, priceId: "price_1", paidSeats: 0, customerId: null, email: "a@b.co", successUrl: "s", cancelUrl: "c" })).toThrow();
    const p = seatCheckoutParams({ orgId: ORG, priceId: "price_1", paidSeats: 2, customerId: null, email: "a@b.co", successUrl: "s", cancelUrl: "c" }) as any;
    expect(p.mode).toBe("subscription");
    expect(p.line_items).toEqual([{ price: "price_1", quantity: 2 }]);
    expect(p.subscription_data.metadata).toEqual({ kind: "coach_seats", org_id: ORG });
    expect(p.automatic_tax.enabled).toBe(true);
    expect(isCoachSeatsObject(p)).toBe(true);
  });
});

describe("JF Effect's own webhook never mistakes a coach's subscription for a client's sale", () => {
  it("recognizes every shape a coach seat object arrives in", () => {
    expect(isCoachSeatsObject(sub())).toBe(true);
    expect(isCoachSeatsObject({ object: "invoice", subscription_details: { metadata: { kind: "coach_seats" } } })).toBe(true);
    expect(isCoachSeatsObject({ object: "invoice", parent: { subscription_details: { metadata: { kind: "coach_seats" } } } })).toBe(true);
    expect(isCoachSeatsObject({ object: "checkout.session", metadata: { kind: "ai_credits" } })).toBe(false);
    expect(isCoachSeatsObject({ object: "invoice", metadata: {} })).toBe(false);
    expect(isCoachSeatsObject(null)).toBe(false);
  });

  it("the live webhook returns early for one, before its dedupe and matching", () => {
    const src = readFileSync("src/routes/api/public/stripe-webhook.ts", "utf8");
    const guard = src.indexOf("if (isCoachSeatsObject(obj))");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(src.indexOf("processed_stripe_events"));
  });
});

describe("write access (the same rule as public.org_can_write)", () => {
  it("free and active businesses write", () => {
    expect(writeAccess(row(), NOW).canWrite).toBe(true);
    expect(writeAccess(row({ state: "active", paid_seats: 4 }), NOW).canWrite).toBe(true);
  });

  it("a paid client with no card: 14 days, then read only", () => {
    const fresh = row({ state: "needs_setup", paid_seats: 1, needs_setup_since: new Date(NOW.getTime() - 3 * DAY).toISOString() });
    expect(writeAccess(fresh, NOW)).toMatchObject({ canWrite: true });
    const lapsed = row({ state: "needs_setup", paid_seats: 1, needs_setup_since: new Date(NOW.getTime() - 15 * DAY).toISOString() });
    expect(writeAccess(lapsed, NOW)).toMatchObject({ canWrite: false, reason: "setup_lapsed" });
  });

  it("a failed payment: until its grace ends", () => {
    const g = new Date(NOW.getTime() + DAY).toISOString();
    expect(writeAccess(row({ state: "past_due", paid_seats: 2, grace_until: g }), NOW).canWrite).toBe(true);
    const gone = new Date(NOW.getTime() - DAY).toISOString();
    expect(writeAccess(row({ state: "past_due", paid_seats: 2, grace_until: gone }), NOW)).toMatchObject({ canWrite: false, reason: "payment_lapsed" });
  });

  it("a cancelled subscription only stops writing while there are paid clients", () => {
    expect(writeAccess(row({ state: "canceled", paid_seats: 2 }), NOW).canWrite).toBe(false);
    expect(writeAccess(row({ state: "canceled", paid_seats: 0 }), NOW).canWrite).toBe(true);
  });

  it("matches the SQL function's conditions word for word", () => {
    const sql = readFileSync("supabase/migrations/20270510090000_coach_workspaces.sql", "utf8");
    expect(sql).toContain("b.state IN ('paused', 'canceled') AND b.paid_seats > 0");
    expect(sql).toContain(`b.state = 'needs_setup' AND b.needs_setup_since < now() - interval '${GRACE_DAYS} days'`);
    expect(sql).toContain("b.state = 'past_due' AND b.grace_until < now()");
  });
});

describe("Stripe status", () => {
  it.each([
    ["active", "active"], ["trialing", "active"], ["past_due", "past_due"], ["unpaid", "past_due"],
    ["paused", "paused"], ["canceled", "canceled"], ["incomplete_expired", "canceled"], ["incomplete", "needs_setup"], [undefined, "needs_setup"],
  ])("%s → %s", (s, want) => expect(stateFromStripe(s as any)).toBe(want));
});

describe("keeping the quantity in step", () => {
  it("nothing to do without a subscription, when in step, or once cancelled", () => {
    expect(seatSyncDecision(row({ paid_seats: 2, seat_revision: 3 })).kind).toBe("none");
    expect(seatSyncDecision(row({ stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 2, seat_revision: 3, synced_revision: 3, synced_quantity: 2 })).kind).toBe("none");
    expect(seatSyncDecision(row({ state: "canceled", stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 2, seat_revision: 4 })).kind).toBe("none");
    expect(seatSyncDecision(row({ livemode: true, stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 2, seat_revision: 4 })).kind).toBe("none");
  });

  it("an update keyed by the revision: a retry is the same update, the next change a new one", () => {
    const d = seatSyncDecision(row({ state: "active", stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 3, seat_revision: 7, synced_revision: 6, synced_quantity: 2 }));
    expect(d).toMatchObject({ kind: "update", itemId: "si_1", quantity: 3, revision: 7, idempotencyKey: seatSyncKey("sub_1", 7, 3) });
    const back = seatSyncDecision(row({ state: "active", stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 0, seat_revision: 8, synced_revision: 7, synced_quantity: 3 }));
    expect(back).toMatchObject({ kind: "update", quantity: 0 });
  });
});

describe("webhook events", () => {
  it("ignores live events, other kinds and other objects", () => {
    expect(planForEvent(ev("invoice.paid", sub(), { livemode: true }), row(), NOW)).toMatchObject({ kind: "ignore" });
    expect(planForEvent(ev("invoice.paid", { metadata: {} }), row(), NOW)).toMatchObject({ kind: "ignore" });
    expect(planForEvent(ev("customer.created", sub()), row(), NOW)).toMatchObject({ kind: "ignore" });
  });

  it("checkout completed: the subscription is recorded, then read in full", () => {
    const p = planForEvent(ev("checkout.session.completed", { mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { kind: "coach_seats", org_id: ORG } }), row(), NOW);
    expect(p).toMatchObject({ kind: "patch", orgId: ORG, then: "fetch_subscription", patch: { stripe_subscription_id: "sub_1", stripe_customer_id: "cus_1" } });
  });

  it("subscription updated: state, item, quantity and period from Stripe; active clears every grace", () => {
    const p = planForEvent(ev("customer.subscription.updated", sub()), row({ state: "past_due", grace_until: "x", past_due_since: "y" }), NOW) as any;
    expect(p.patch).toMatchObject({ state: "active", stripe_item_id: "si_1", synced_quantity: 3, past_due_since: null, grace_until: null, needs_setup_since: null });
    expect(p.patch.current_period_end).toBe(new Date((Math.floor(NOW.getTime() / 1000) + 20 * 86400) * 1000).toISOString());
  });

  it("a failed payment starts a 14-day grace that Stripe's retries never restart", () => {
    const inv = { object: "invoice", subscription: "sub_1", customer: "cus_1", subscription_details: { metadata: { kind: "coach_seats", org_id: ORG } } };
    const first = planForEvent(ev("invoice.payment_failed", inv), row({ state: "active" }), NOW) as any;
    expect(first.patch.state).toBe("past_due");
    expect(first.patch.grace_until).toBe(new Date(NOW.getTime() + GRACE_DAYS * DAY).toISOString());
    const later = new Date(NOW.getTime() + 3 * DAY);
    const retry = planForEvent(ev("invoice.payment_failed", inv), row({ state: "past_due", past_due_since: NOW.toISOString(), grace_until: first.patch.grace_until }), later) as any;
    expect(retry.patch.grace_until).toBe(first.patch.grace_until);
  });

  it("paid clears it; deleted ends it", () => {
    const inv = { object: "invoice", subscription: "sub_1", subscription_details: { metadata: { kind: "coach_seats", org_id: ORG } } };
    expect((planForEvent(ev("invoice.paid", inv), row({ state: "past_due" }), NOW) as any).patch).toMatchObject({ state: "active", grace_until: null });
    expect((planForEvent(ev("customer.subscription.deleted", sub({ status: "canceled" })), row({ state: "active" }), NOW) as any).patch).toMatchObject({ state: "canceled", stripe_item_id: null });
  });
});

describe("reconciliation", () => {
  it("paid clients and no subscription: needs setup; none: back to free", () => {
    expect(reconcile(row({ paid_seats: 1, state: "free" }), null, NOW)).toEqual([
      { kind: "patch", patch: { state: "needs_setup", needs_setup_since: NOW.toISOString() }, why: "paid clients and no subscription" },
    ]);
    expect(reconcile(row({ paid_seats: 0, state: "needs_setup", needs_setup_since: "x" }), null, NOW)[0]).toMatchObject({ patch: { state: "free" } });
  });

  it("a subscription Stripe doesn't have, or that's another business's, is flagged, never fixed silently", () => {
    expect(reconcile(row({ stripe_subscription_id: "sub_1" }), null, NOW)).toEqual([{ kind: "flag", why: "subscription sub_1 not found in Stripe" }]);
    expect(reconcile(row({ stripe_subscription_id: "sub_1" }), sub({ metadata: { kind: "coach_seats", org_id: "other" } }), NOW)[0].kind).toBe("flag");
  });

  it("Stripe is the truth for status, the database for seats", () => {
    const r = row({ state: "active", stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 5, seat_revision: 9 });
    const acts = reconcile(r, sub({ status: "past_due" }), NOW);
    expect(acts.find((a) => a.kind === "patch")).toMatchObject({ patch: { state: "past_due" } });
    expect(acts.find((a) => a.kind === "set_quantity")).toEqual({ kind: "set_quantity", quantity: 5, idempotencyKey: seatSyncKey("sub_1", 9, 5) });
  });

  it("a drift nobody recorded is fixed downward only; raising a bill is held for review", () => {
    const base = { state: "active" as const, stripe_subscription_id: "sub_1", stripe_item_id: "si_1", seat_revision: 9, synced_revision: 9 };
    const down = reconcile(row({ ...base, paid_seats: 2 }), sub(), NOW);
    expect(down.find((a) => a.kind === "set_quantity")).toMatchObject({ quantity: 2 });
    const up = reconcile(row({ ...base, paid_seats: 5 }), sub(), NOW);
    expect(up.find((a) => a.kind === "set_quantity")).toBeUndefined();
    expect(up.find((a) => a.kind === "flag")).toMatchObject({ why: expect.stringMatching(/held for review/) });
  });

  it("in step: nothing", () => {
    const pe = new Date((Math.floor(NOW.getTime() / 1000) + 20 * 86400) * 1000).toISOString();
    const r = row({ state: "active", stripe_subscription_id: "sub_1", stripe_item_id: "si_1", paid_seats: 3, current_period_end: pe });
    expect(reconcile(r, sub(), NOW)).toEqual([]);
  });
});

describe("test mode only", () => {
  it("refuses a live or missing key", () => {
    expect(() => assertTestMode(null)).toThrow(/test key/);
    expect(() => assertTestMode("sk_live_abc")).toThrow(/test mode only/);
    expect(() => assertTestMode("rk_live_abc")).toThrow(/test mode only/);
    expect(assertTestMode("sk_test_abc")).toBe("sk_test_abc");
  });

  it("the database holds it too: a billing row can't be live", () => {
    const sql = readFileSync("supabase/migrations/20270510090000_coach_workspaces.sql", "utf8");
    expect(sql).toMatch(/livemode boolean NOT NULL DEFAULT false CHECK \(livemode = false\)/);
  });
});

describe("Stripe signatures", () => {
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  const sign = (t: number, body = payload, s = secret) => `t=${t},v1=${createHmac("sha256", s).update(`${t}.${body}`).digest("hex")}`;

  it("accepts Stripe's own signature", async () => {
    expect(await verifyStripeSignature(payload, sign(1000), secret, { nowSec: 1010 })).toEqual({ ok: true, reason: "matched" });
  });
  it("refuses a changed body, another secret, an old timestamp or no header", async () => {
    expect((await verifyStripeSignature(payload + " ", sign(1000), secret, { nowSec: 1010 })).ok).toBe(false);
    expect((await verifyStripeSignature(payload, sign(1000, payload, "whsec_other"), secret, { nowSec: 1010 })).ok).toBe(false);
    expect(await verifyStripeSignature(payload, sign(1000), secret, { nowSec: 2000 })).toEqual({ ok: false, reason: "bad_timestamp" });
    expect(await verifyStripeSignature(payload, null, secret)).toEqual({ ok: false, reason: "missing" });
  });
});

/* ------------------------------------------------------------------ */
/* The webhook end to end, with Stripe and the database faked          */
/* ------------------------------------------------------------------ */

type Tables = Record<string, any[]>;
function fakeDb(tables: Tables) {
  const q = (name: string) => {
    let rows = () => tables[name];
    const filters: Array<(r: any) => boolean> = [];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: any = null;
    let ins: any = null;
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), api),
      lt: (c: string, v: any) => (filters.push((r) => r[c] < v), api),
      order: () => api,
      limit: () => api,
      update: (p: any) => ((op = "update"), (patch = p), api),
      delete: () => ((op = "delete"), api),
      insert: (r: any) => {
        op = "insert";
        ins = r;
        return api;
      },
      maybeSingle: () => Promise.resolve(run()).then((res: any) => ({ data: res.data?.[0] ?? null, error: res.error })),
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    const run = () => {
      const match = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "insert") {
        if (name === "coach_billing_events" && tables[name].some((r) => r.event_id === ins.event_id)) return { data: null, error: { code: "23505" } };
        tables[name].push({ ...ins });
        return { data: [ins], error: null };
      }
      if (op === "update") {
        match.forEach((r) => Object.assign(r, patch));
        return { data: match, error: null };
      }
      if (op === "delete") {
        tables[name] = rows().filter((r) => !match.includes(r));
        return { data: match, error: null };
      }
      return { data: match, error: null };
    };
    return api;
  };
  return { from: q };
}

describe("the coach billing webhook", () => {
  const secret = "whsec_coach_test";
  let tables: Tables;
  let stripeCalls: Array<{ url: string; init: any }>;
  let failNextStripe = false;

  beforeEach(() => {
    vi.resetModules();
    tables = {
      organization_billing: [row({ seats: 3, paid_seats: 2, seat_revision: 5, state: "needs_setup", needs_setup_since: NOW.toISOString() })],
      coach_billing_events: [],
    };
    stripeCalls = [];
    failNextStripe = false;
    process.env.COACH_BILLING_WEBHOOK_SECRET_TEST = secret;
    process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake";
    process.env.STRIPE_SECRET_KEY = "sk_live_must_never_be_used";
    vi.doMock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeDb(tables) }));
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      stripeCalls.push({ url, init });
      if (failNextStripe) {
        failNextStripe = false;
        return new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 });
      }
      if (url.includes("/subscriptions/sub_1")) return new Response(JSON.stringify(sub({ items: { data: [{ id: "si_1", quantity: 1 }] } })));
      if (url.includes("/subscription_items/si_1")) {
        const q = Number(new URLSearchParams(init.body).get("quantity"));
        return new Response(JSON.stringify({ id: "si_1", quantity: q }));
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("@/integrations/supabase/client.server");
  });

  const signed = (event: any) => {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    return { body, sig: `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}` };
  };
  const completed = { id: "evt_checkout1", type: "checkout.session.completed", livemode: false,
    data: { object: { mode: "subscription", subscription: "sub_1", customer: "cus_1", metadata: { kind: "coach_seats", org_id: ORG } } } };

  it("records the subscription, then syncs the quantity the count moved to while they were in Checkout (test key only)", async () => {
    const { handleCoachBillingWebhook } = await import("@/lib/coach-platform/coach-billing.server");
    const { body, sig } = signed(completed);
    const res = await handleCoachBillingWebhook(body, sig);
    expect(res.status).toBe(200);
    const b = tables.organization_billing[0];
    expect(b).toMatchObject({ stripe_subscription_id: "sub_1", stripe_item_id: "si_1", state: "active", synced_quantity: 2, synced_revision: 5 });
    const update = stripeCalls.find((c) => c.url.includes("/subscription_items/si_1"))!;
    expect(new URLSearchParams(update.init.body).get("proration_behavior")).toBe("create_prorations");
    expect(update.init.headers["Idempotency-Key"]).toBe(seatSyncKey("sub_1", 5, 2));
    expect(stripeCalls.every((c) => c.init.headers.Authorization === "Bearer sk_test_fake")).toBe(true);
  });

  it("the same event twice is handled once", async () => {
    const { handleCoachBillingWebhook } = await import("@/lib/coach-platform/coach-billing.server");
    const { body, sig } = signed(completed);
    await handleCoachBillingWebhook(body, sig);
    const n = stripeCalls.length;
    const again = await handleCoachBillingWebhook(body, sig);
    expect(again.body).toMatchObject({ duplicate: true });
    expect(stripeCalls.length).toBe(n);
  });

  it("a failure gives the claim back, so Stripe's retry is handled, not dropped", async () => {
    const { handleCoachBillingWebhook } = await import("@/lib/coach-platform/coach-billing.server");
    const { body, sig } = signed(completed);
    failNextStripe = true;
    const res = await handleCoachBillingWebhook(body, sig);
    expect(res.status).toBe(500);
    expect(tables.coach_billing_events).toHaveLength(0);
    const retry = await handleCoachBillingWebhook(body, sig);
    expect(retry.status).toBe(200);
    expect(tables.organization_billing[0].state).toBe("active");
  });

  it("refuses an unsigned or wrongly signed event, and ignores another kind of object", async () => {
    const { handleCoachBillingWebhook } = await import("@/lib/coach-platform/coach-billing.server");
    const { body } = signed(completed);
    expect((await handleCoachBillingWebhook(body, "t=1,v1=00")).status).toBe(400);
    const other = signed({ id: "evt_x", type: "invoice.paid", livemode: false, data: { object: { metadata: { kind: "ai_credits" } } } });
    expect((await handleCoachBillingWebhook(other.body, other.sig)).body).toMatchObject({ ignored: "not coach seats" });
    expect(tables.coach_billing_events).toHaveLength(0);
  });

  it("never uses the live key, even when it's the only default", async () => {
    delete process.env.STRIPE_SECRET_KEY_TEST;
    const { coachBillingKey } = await import("@/lib/coach-platform/coach-billing.server");
    expect(() => coachBillingKey()).toThrow(/test key/);
  });
});
