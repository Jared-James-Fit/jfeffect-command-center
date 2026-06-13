import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";

// Set env BEFORE the route module is imported.
process.env.STRIPE_WEBHOOK_SECRET_TEST = "whsec_test_secret_for_idempotency_tests";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret_for_idempotency_tests";
process.env.SUPABASE_URL = "http://test.supabase.local";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
process.env.STRIPE_SECRET_KEY_TEST = "sk_test_fake_for_tests";
process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_tests";
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto as any;

// ---------- Supabase mock with controllable dedupe behavior ----------
let processedEventIds = new Set<string>();
let trackedInserts: Array<{ table: string; row: any }> = [];
let trackedUpdates: Array<{ table: string; patch: any }> = [];

vi.mock("@supabase/supabase-js", () => {
  const makeClient = () => ({
    from(table: string) {
      const builder: any = {
        _table: table,
        select() { return this; },
        eq() { return this; },
        in() { return this; },
        is() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        insert(row: any) {
          if (table === "processed_stripe_events") {
            const ev = row?.event_id ?? row?.[0]?.event_id;
            if (ev && processedEventIds.has(ev)) {
              return Promise.resolve({ data: null, error: { code: "23505", message: "duplicate" } });
            }
            if (ev) processedEventIds.add(ev);
          }
          trackedInserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        update(patch: any) {
          trackedUpdates.push({ table, patch });
          return {
            eq: async () => ({ data: null, error: null }),
            in: async () => ({ data: null, error: null }),
          };
        },
        upsert(row: any) {
          trackedInserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        delete() {
          return { eq: async () => ({ data: null, error: null, count: 0 }), in: async () => ({ data: null, error: null, count: 0 }) };
        },
      };
      // Chain "then" so `await sb.from(...).insert(...).then(...)` works
      builder.then = undefined;
      return builder;
    },
  });
  return { createClient: () => makeClient() };
});

// ---------- Mock the dynamic SMS trigger import (defense-in-depth) ----------
vi.mock("@/lib/sms-trigger.server", () => ({
  fireAutomationTrigger: vi.fn(async () => {}),
}));
vi.mock("@/lib/promo-capture", () => ({
  buildPromoRowFromSession: vi.fn(async () => null),
  fetchExpandedCheckoutSession: vi.fn(async (id: string) => ({ id })),
  upsertPromoRedemption: vi.fn(async () => {}),
}));

// Import AFTER env + mocks are set.
import { Route } from "@/routes/api/public/stripe-webhook";

async function sign(payload: string, secret: string) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const enc = new TextEncoder();
  const key = await webcrypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
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

function syntheticEvent(type: string, id: string, object: Record<string, any> = {}) {
  return {
    id,
    type,
    livemode: false,
    data: { object: { id: `obj_${id}`, ...object } },
  };
}

beforeEach(() => {
  processedEventIds = new Set<string>();
  trackedInserts = [];
  trackedUpdates = [];
});

const EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

describe("Stripe webhook idempotency", () => {
  for (const type of EVENT_TYPES) {
    it(`deduplicates repeated ${type} on the same event.id`, async () => {
      // For invoice.* events we omit `subscription` so the handler falls through
      // to the purchase_records lookup (which returns nothing in the mock) instead
      // of calling stripeFetch — which the test's network guard would reject.
      const isInvoice = type.startsWith("invoice.");
      const ev = syntheticEvent(type, `evt_idem_${type}`, {
        customer: "cus_test",
        subscription: isInvoice ? null : "sub_test",
        status: "active",
        metadata: {},
        payment_status: "paid",
        mode: "subscription",
      });

      const r1 = await postEvent(ev);
      expect(r1.status).toBe(200);
      const body1 = await r1.json();
      expect(body1.duplicate).not.toBe(true);

      // Reset side-effect counters but KEEP processedEventIds — that's the dedupe oracle.
      const insertsAfterFirst = trackedInserts.length;
      const updatesAfterFirst = trackedUpdates.length;

      const r2 = await postEvent(ev);
      expect(r2.status).toBe(200);
      const body2 = await r2.json();
      expect(body2).toEqual({ received: true, duplicate: true });

      // No new inserts/updates happened on the duplicate call (beyond the dedupe attempt itself).
      expect(trackedInserts.length).toBe(insertsAfterFirst);
      expect(trackedUpdates.length).toBe(updatesAfterFirst);
    });
  }

  it("rejects an event with an invalid signature without touching state", async () => {
    const ev = syntheticEvent("checkout.session.completed", "evt_badsig");
    const handler: any = (Route as any).options.server.handlers.POST;
    const req = new Request("https://example.com/api/public/stripe-webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=0,v1=" + "0".repeat(64), "content-type": "application/json" },
      body: JSON.stringify(ev),
    });
    const res = await handler({ request: req });
    expect(res.status).toBe(401);
    expect(trackedInserts.length).toBe(0);
    expect(trackedUpdates.length).toBe(0);
  });

  it("does not restart the failed-payment grace window when payment_failed repeats", async () => {
    // First failure (no subscription => no stripeFetch lookup)
    const ev1 = syntheticEvent("invoice.payment_failed", "evt_pf_1", {
      customer: "cus_grace", subscription: null, attempt_count: 1,
    });
    await postEvent(ev1);
    // Same Stripe event delivered again (Stripe retries on timeout) → must be deduped.
    const ev1_dup = { ...ev1 };
    const r = await postEvent(ev1_dup);
    const body = await r.json();
    expect(body.duplicate).toBe(true);
    // A truly NEW event id with the same subscription is a separate failure attempt;
    // the handler is responsible for not re-starting grace, but that's enforced via
    // payment_failed_at being set-once in the lifecycle resolver, not here. The
    // idempotency layer guarantees the same Stripe delivery never restarts grace.
  });
});