import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";

// Env BEFORE route import.
process.env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_test_secret_for_recurring_tests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_recurring_tests";
process.env.SUPABASE_URL = "http://test.supabase.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_for_tests";
process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_tests";
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto as any;

// A single mutable purchase_records row so update patches accumulate.
const purchaseRow: any = {
  id: "purchase_1",
  client_id: "client_1",
  stripe_customer_id: "cus_test",
  stripe_subscription_id: "sub_test",
  stripe_payment_intent_id: null,
  stripe_checkout_session_id: null,
  is_recurring: true,
  offer_id: null,
  payment_status: "Active Subscription",
  service_status: "Active",
  next_billing_date: null,
  stripe_subscription_status: null,
  cancel_at_period_end: false,
  stripe_receipt_url: null,
};

let processedEventIds = new Set<string>();
let updates: Array<{ table: string; patch: any }> = [];
let inserts: Array<{ table: string; row: any }> = [];
let upserts: Array<{ table: string; row: any }> = [];

vi.mock("@/lib/stripe.server", () => ({
  stripeFetch: vi.fn(async (path: string) => {
    if (path.startsWith("/subscriptions/")) {
      return { id: purchaseRow.stripe_subscription_id, customer: purchaseRow.stripe_customer_id, status: "active", metadata: {} };
    }
    return {};
  }),
  getStripeKeyForMode: () => "sk_test_fake_for_tests",
  detectStripeKeyMode: (k: string) => (k?.startsWith("sk_test_") ? "test" : "live"),
  getStripeKeyDiagnostics: () => ({}),
  formEncode: () => "",
}));
vi.mock("@/lib/billing-notify.server", () => ({
  sendBillingAdminEmail: vi.fn(async () => {}),
  buildBillingEmailBody: vi.fn(() => ""),
}));
vi.mock("@/lib/promo-capture", () => ({
  buildPromoRowFromSession: vi.fn(async () => null),
  fetchExpandedCheckoutSession: vi.fn(async (id: string) => ({ id })),
  upsertPromoRedemption: vi.fn(async () => {}),
}));

vi.mock("@supabase/supabase-js", () => {
  const makeClient = () => ({
    from(table: string) {
      const builder: any = {
        _table: table,
        _filters: [] as Array<[string, any]>,
        select() { return this; },
        eq(col: string, val: any) { this._filters.push([col, val]); return this; },
        in() { return this; },
        is() { return this; },
        neq() { return Promise.resolve({ data: null, error: null }); },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async function () {
          if (table === "purchase_records") {
            // Return the shared purchase row for any lookup that matches one of its fields.
            for (const [col, val] of this._filters) {
              if (val && (purchaseRow as any)[col] === val) return { data: { ...purchaseRow }, error: null };
            }
          }
          if (table === "product_access_grants") return { data: null, error: null };
          if (table === "clients") return { data: { first_name: "T", last_name: "U", email: "t@example.com", billing_source: null }, error: null };
          return { data: null, error: null };
        },
        single: async () => ({ data: null, error: null }),
        insert(row: any) {
          if (table === "processed_stripe_events") {
            const ev = row?.event_id ?? row?.[0]?.event_id;
            if (ev && processedEventIds.has(ev)) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
            }
            if (ev) processedEventIds.add(ev);
          }
          inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: any) {
          updates.push({ table, patch });
          if (table === "purchase_records") Object.assign(purchaseRow, patch);
          const chain: any = {
            eq() { return chain; },
            in() { return chain; },
            neq() { return chain; },
            then(res: any) { res({ data: null, error: null }); },
          };
          return chain;
        },
        upsert(row: any) {
          upserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          return { eq: async () => ({ data: null, error: null, count: 0 }), in: async () => ({ data: null, error: null, count: 0 }) };
        },
      };
      builder.then = undefined;
      return builder;
    },
  });
  return { createClient: () => makeClient() };
});

import { Route } from "@/routes/api/public/stripe-webhook";

async function sign(payload: string, secret: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const enc = new TextEncoder();
  const key = await webcrypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sigBuf = await webcrypto.subtle.sign("HMAC", key, enc.encode(`${ts}.${payload}`));
  const sigHex = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${ts},v1=${sigHex}`;
}

async function postEvent(event: any) {
  const body = JSON.stringify(event);
  const header = await sign(body, process.env.STRIPE_WEBHOOK_SECRET_TEST!);
  const handler: any = (Route as any).options.server.handlers.POST;
  const req = new Request("https://example.com/api/public/stripe-webhook", {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body,
  });
  return handler({ request: req });
}

function lastPurchaseUpdate() {
  const p = [...updates].reverse().find((u) => u.table === "purchase_records");
  return p?.patch ?? null;
}

beforeEach(() => {
  processedEventIds = new Set<string>();
  updates = [];
  inserts = [];
  upserts = [];
  Object.assign(purchaseRow, {
    next_billing_date: null,
    stripe_subscription_status: null,
    cancel_at_period_end: false,
    payment_status: "Active Subscription",
    service_status: "Active",
  });
});

describe("Stripe webhook — recurring billing sync", () => {
  it("customer.subscription.updated (active) stores status and next_billing_date", async () => {
    const periodEnd = Math.floor(new Date("2027-01-15T00:00:00Z").getTime() / 1000);
    const res = await postEvent({
      id: "evt_sub_upd_active",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: {
        id: "sub_test", customer: "cus_test", status: "active",
        current_period_end: periodEnd, cancel_at_period_end: false, metadata: {},
      } },
    });
    expect(res.status).toBe(200);
    const p = lastPurchaseUpdate();
    expect(p).toBeTruthy();
    expect(p.stripe_subscription_status).toBe("active");
    expect(p.cancel_at_period_end).toBe(false);
    expect(p.next_billing_date).toBe("2027-01-15");
  });

  it("customer.subscription.updated with cancel_at_period_end=true keeps status but clears next_billing_date", async () => {
    const periodEnd = Math.floor(new Date("2027-02-01T00:00:00Z").getTime() / 1000);
    const res = await postEvent({
      id: "evt_sub_upd_cape",
      type: "customer.subscription.updated",
      livemode: false,
      data: { object: {
        id: "sub_test", customer: "cus_test", status: "active",
        current_period_end: periodEnd, cancel_at_period_end: true, metadata: {},
      } },
    });
    expect(res.status).toBe(200);
    const p = lastPurchaseUpdate();
    expect(p.cancel_at_period_end).toBe(true);
    expect(p.stripe_subscription_status).toBe("active");
    expect(p.next_billing_date).toBeNull();
  });

  it("customer.subscription.deleted marks cancelled and clears next_billing_date", async () => {
    const res = await postEvent({
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      livemode: false,
      data: { object: { id: "sub_test", customer: "cus_test", status: "canceled", metadata: {} } },
    });
    expect(res.status).toBe(200);
    const p = lastPurchaseUpdate();
    expect(p.stripe_subscription_status).toBe("canceled");
    expect(p.payment_status).toBe("Cancelled");
    expect(p.next_billing_date).toBeNull();
    expect(p.cancel_at_period_end).toBe(false);
  });

  it("invoice.payment_succeeded rolls next_billing_date forward and does not duplicate purchases", async () => {
    const periodEnd = Math.floor(new Date("2027-03-10T00:00:00Z").getTime() / 1000);
    const res = await postEvent({
      id: "evt_inv_ok",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: "in_test_1", customer: "cus_test", subscription: "sub_test",
        amount_paid: 5000, currency: "cad", hosted_invoice_url: "https://stripe/rcpt",
        lines: { data: [{ period: { end: periodEnd } }] },
      } },
    });
    expect(res.status).toBe(200);
    const p = lastPurchaseUpdate();
    expect(p.next_billing_date).toBe("2027-03-10");
    expect(p.payment_status).toBe("Active Subscription");
    // No new purchase_records inserts.
    expect(inserts.filter((i) => i.table === "purchase_records")).toHaveLength(0);
    // Ledger upserted with idempotency key = invoice id.
    const ledger = upserts.find((u) => u.table === "payment_ledger");
    expect(ledger?.row?.external_reference).toBe("in_test_1");
  });

  it("duplicate delivery of the same invoice.payment_succeeded event is idempotent", async () => {
    const ev = {
      id: "evt_inv_dup",
      type: "invoice.payment_succeeded",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: "in_test_2", customer: "cus_test", subscription: "sub_test",
        amount_paid: 5000, currency: "cad",
        lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 86400 } }] },
      } },
    };
    const r1 = await postEvent(ev);
    expect(r1.status).toBe(200);
    const updatesAfterFirst = updates.length;
    const upsertsAfterFirst = upserts.length;
    const r2 = await postEvent(ev);
    const body2 = await r2.json();
    expect(body2).toEqual({ received: true, duplicate: true });
    expect(updates.length).toBe(updatesAfterFirst);
    expect(upserts.length).toBe(upsertsAfterFirst);
  });
});