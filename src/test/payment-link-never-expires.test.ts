import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

process.env.STRIPE_SECRET_KEY = "sk_test_fake_for_tests";

type Ctx = { table: string; op: "select" | "update"; patch?: any; filters: Array<[string, any]> };

/** Scenario state the fake Supabase client reads from. */
const state: {
  link: any;
  purchase: any;
  claimed: boolean;
  freshSessionId: string | null;
  log: Array<{ table: string; op: string; patch?: any }>;
} = { link: null, purchase: null, claimed: true, freshSessionId: null, log: [] };

function handler(ctx: Ctx) {
  state.log.push({ table: ctx.table, op: ctx.op, patch: ctx.patch });
  if (ctx.table === "payment_share_links") {
    if (ctx.op === "select") return { data: state.link, error: null };
    // The regeneration claim (sets regen_claimed_at to a timestamp) vs release/last_resolved.
    if (ctx.patch && typeof ctx.patch.regen_claimed_at === "string") {
      return { data: state.claimed ? [{ id: state.link.id }] : [], error: null };
    }
    return { data: null, error: null };
  }
  if (ctx.table === "purchase_records") {
    if (ctx.op === "select") {
      // While waiting on another request's claim the purchase gains a fresh session id.
      const sel = state.freshSessionId
        ? { ...state.purchase, stripe_checkout_session_id: state.freshSessionId }
        : state.purchase;
      return { data: sel, error: null };
    }
  }
  return { data: null, error: null };
}

function makeBuilder(table: string) {
  const ctx: Ctx = { table, op: "select", filters: [] };
  const b: any = {
    select: () => b,
    update: (patch: any) => { ctx.op = "update"; ctx.patch = patch; return b; },
    eq: (k: string, v: any) => { ctx.filters.push([k, v]); return b; },
    or: () => b,
    maybeSingle: async () => handler(ctx),
    then: (res: any, rej: any) => Promise.resolve(handler(ctx)).then(res, rej),
  };
  return b;
}

const createAssignmentCheckout = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => makeBuilder(t) },
}));
vi.mock("@/lib/stripe-checkout.functions", () => ({
  createAssignmentCheckout: (...a: any[]) => createAssignmentCheckout(...a),
}));

/** Stripe GETs keyed by path. */
let stripeSessions: Record<string, any> = {};
let stripeInvoices: any = { data: [] };

beforeEach(() => {
  state.link = { id: "link1", purchase_record_id: "p1", revoked: false };
  state.purchase = {
    id: "p1",
    payment_status: "Pending Payment",
    stripe_payment_link: "https://checkout.stripe.com/c/pay/cs_old#frag",
    stripe_checkout_session_id: "cs_old",
    stripe_subscription_id: null,
    offer_id: "o1",
    assigned_by: "u1",
    payment_link_expires_at: null,
  };
  state.claimed = true;
  state.freshSessionId = null;
  state.log = [];
  stripeSessions = {};
  stripeInvoices = { data: [] };
  createAssignmentCheckout.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).replace("https://api.stripe.com/v1", "");
      if (path.startsWith("/checkout/sessions/")) {
        const id = decodeURIComponent(path.split("/")[3]);
        const s = stripeSessions[id];
        return s ? { ok: true, json: async () => s } : { ok: false, json: async () => ({}) };
      }
      if (path.startsWith("/invoices")) return { ok: true, json: async () => stripeInvoices };
      return { ok: false, json: async () => ({}) };
    }),
  );
});

const TOKEN = "AbCde234Wxyz";

describe("payment link stays alive until paid", () => {
  it("mints a fresh checkout when the stored session expired (the Reece/Amanda bug)", async () => {
    stripeSessions["cs_old"] = { id: "cs_old", status: "expired", url: null, metadata: {} };
    createAssignmentCheckout.mockResolvedValue({
      sessionId: "cs_new",
      url: "https://checkout.stripe.com/c/pay/cs_new#frag",
    });
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res = await resolveShareToken(TOKEN);

    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_new#frag" });
    expect(createAssignmentCheckout).toHaveBeenCalledTimes(1);
    const [, assignedBy, input, opts] = createAssignmentCheckout.mock.calls[0];
    expect(assignedBy).toBe("u1");
    expect(input).toMatchObject({ purchaseRecordId: "p1", discountCodeId: null, origin: "https://jfeffect.com" });
    expect(opts).toEqual({ updateSource: "payment_link_refresh" });
    // The claim is released afterwards.
    const released = state.log.filter((l) => l.table === "payment_share_links" && l.patch && l.patch.regen_claimed_at === null);
    expect(released).toHaveLength(1);
  });

  it("keeps the discount the original link carried", async () => {
    stripeSessions["cs_old"] = {
      id: "cs_old",
      status: "expired",
      url: null,
      metadata: { applied_code_id: "3f2b8f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b" },
    };
    createAssignmentCheckout.mockResolvedValue({ sessionId: "cs_new", url: "https://checkout.stripe.com/c/pay/cs_new" });
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    await resolveShareToken(TOKEN);
    expect(createAssignmentCheckout.mock.calls[0][2].discountCodeId).toBe("3f2b8f5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b");
  });

  it("reuses a still-open session and never creates another", async () => {
    stripeSessions["cs_old"] = {
      id: "cs_old",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_old#frag",
      expires_at: Math.floor(Date.now() / 1000) + 3 * 3600,
      metadata: {},
    };
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res = await resolveShareToken(TOKEN);
    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_old#frag" });
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });

  it("does not mint a second checkout when the client already completed one", async () => {
    stripeSessions["cs_old"] = { id: "cs_old", status: "complete", url: null, metadata: {} };
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res: any = await resolveShareToken(TOKEN);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/being confirmed/i);
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });

  it("only stops at an explicit expiry date", async () => {
    state.purchase.payment_link_expires_at = "2026-01-15T12:00:00Z";
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res: any = await resolveShareToken(TOKEN);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(410);
    expect(res.message).toMatch(/expired on January 15, 2026/);
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });

  it("a future expiry date does not block the link", async () => {
    state.purchase.payment_link_expires_at = "2999-01-01T00:00:00Z";
    stripeSessions["cs_old"] = { id: "cs_old", status: "expired", url: null, metadata: {} };
    createAssignmentCheckout.mockResolvedValue({ sessionId: "cs_new", url: "https://checkout.stripe.com/c/pay/cs_new" });
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res: any = await resolveShareToken(TOKEN);
    expect(res.ok).toBe(true);
  });

  it("settled purchases are still never sent to checkout", async () => {
    state.purchase.payment_status = "Active Subscription";
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res: any = await resolveShareToken(TOKEN);
    expect(res).toMatchObject({ ok: false, status: 410 });
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });

  it("falls back to a friendly message (and releases the claim) if Stripe can't mint a session", async () => {
    stripeSessions["cs_old"] = { id: "cs_old", status: "expired", url: null, metadata: {} };
    createAssignmentCheckout.mockRejectedValue(new Error("Stripe is down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { resolveShareToken } = await import("@/lib/payment-share.server");
    const res: any = await resolveShareToken(TOKEN);
    expect(res).toMatchObject({ ok: false, status: 410 });
    expect(res.message).toMatch(/message your coach/i);
    expect(state.log.some((l) => l.patch && l.patch.regen_claimed_at === null)).toBe(true);
    err.mockRestore();
  });
});

describe("only one request mints a session at a time", () => {
  it("a concurrent tap waits for the other request's session instead of creating a duplicate", async () => {
    stripeSessions["cs_old"] = { id: "cs_old", status: "expired", url: null, metadata: {} };
    stripeSessions["cs_minted"] = {
      id: "cs_minted",
      status: "open",
      url: "https://checkout.stripe.com/c/pay/cs_minted",
      metadata: {},
    };
    state.claimed = false; // another request holds the claim
    state.freshSessionId = "cs_minted"; // ...and has already saved its session

    const { regenerateCheckoutForLink } = await import("@/lib/payment-link-regenerate.server");
    const res = await regenerateCheckoutForLink(
      (await import("@/integrations/supabase/client.server") as any).supabaseAdmin,
      { id: "link1" },
      { id: "p1", assigned_by: "u1", stripe_checkout_session_id: "cs_old" },
      null,
      {
        sleep: async () => {},
        stripeGet: async (path: string) => stripeSessions[decodeURIComponent(path.split("/")[3])] ?? null,
      },
    );
    expect(res).toEqual({ ok: true, url: "https://checkout.stripe.com/c/pay/cs_minted" });
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });

  it("asks the client to retry if the other request never finishes", async () => {
    state.claimed = false;
    const { regenerateCheckoutForLink } = await import("@/lib/payment-link-regenerate.server");
    const res: any = await regenerateCheckoutForLink(
      (await import("@/integrations/supabase/client.server") as any).supabaseAdmin,
      { id: "link1" },
      { id: "p1", assigned_by: null, stripe_checkout_session_id: "cs_old" },
      null,
      { sleep: async () => {}, stripeGet: async () => null },
    );
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(createAssignmentCheckout).not.toHaveBeenCalled();
  });
});

describe("contracts", () => {
  const routeSrc = readFileSync("src/routes/pay.$token.tsx", "utf8");
  const checkoutSrc = readFileSync("src/lib/stripe-checkout.functions.ts", "utf8");

  it("the admin/coach role gate still guards the exported assignment server function", () => {
    const fn = checkoutSrc.slice(checkoutSrc.indexOf("export const createCheckoutSessionForAssignment"));
    expect(fn.indexOf("Only admins or coaches")).toBeGreaterThan(-1);
    expect(fn.indexOf("Only admins or coaches")).toBeLessThan(fn.indexOf("return createAssignmentCheckout("));
  });

  it("the public route still just redirects to the resolved URL", () => {
    expect(routeSrc).toContain("status: 302");
    expect(routeSrc).toContain("Location: result.url");
  });
});
