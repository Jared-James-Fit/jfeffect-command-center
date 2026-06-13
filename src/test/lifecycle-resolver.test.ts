import { describe, it, expect } from "vitest";
import { resolveLifecycle } from "@/lib/jf-lifecycle.server";

const t0 = new Date("2026-06-01T00:00:00Z");
const t3 = new Date("2026-06-04T00:00:00Z"); // 3 days later
const t6 = new Date("2026-06-07T00:00:00Z"); // 6 days later (past 5-day grace)

function sub(status: string, overrides: any = {}) {
  return {
    status,
    cancel_at_period_end: false,
    pause_collection: null,
    current_period_end: Math.floor(new Date("2026-07-01").getTime() / 1000),
    items: { data: [{ price: { id: "price_LIVE_123" } }] },
    ...overrides,
  };
}

describe("resolveLifecycle — grace-window contract", () => {
  it("trialing grants access with no grace window", () => {
    const r = resolveLifecycle({ member: {}, sub: sub("trialing"), holdPriceId: null, graceDays: 5, now: t0 });
    expect(r.status).toBe("Trialing");
    expect(r.grants_access).toBe(true);
    expect(r.grace_ends_at).toBeNull();
  });

  it("active grants access; clears grace and failed-at", () => {
    const r = resolveLifecycle({ member: {}, sub: sub("active"), holdPriceId: null, graceDays: 5, now: t0 });
    expect(r.status).toBe("Active");
    expect(r.grants_access).toBe(true);
    expect(r.payment_failed_at).toBeNull();
  });

  it("first past_due starts the grace window from now()", () => {
    const r = resolveLifecycle({ member: { payment_failed_at: null, grace_period_ends_at: null }, sub: sub("past_due"), holdPriceId: null, graceDays: 5, now: t0 });
    expect(r.status).toBe("Past Due");
    expect(r.grants_access).toBe(true);
    expect(r.in_grace).toBe(true);
    expect(r.grace_ends_at).toBe(new Date(t0.getTime() + 5 * 86400_000).toISOString());
  });

  it("repeated past_due does NOT restart the grace window", () => {
    const memberWithGrace = {
      payment_failed_at: t0.toISOString(),
      grace_period_ends_at: new Date(t0.getTime() + 5 * 86400_000).toISOString(),
    };
    const r = resolveLifecycle({ member: memberWithGrace, sub: sub("past_due"), holdPriceId: null, graceDays: 5, now: t3 });
    // grace_ends_at must equal the ORIGINAL value, not a new t3+5 calculation.
    expect(r.grace_ends_at).toBe(memberWithGrace.grace_period_ends_at);
    expect(r.payment_failed_at).toBe(memberWithGrace.payment_failed_at);
    expect(r.grants_access).toBe(true);
  });

  it("past_due after grace expiry restricts access", () => {
    const memberWithGrace = {
      payment_failed_at: t0.toISOString(),
      grace_period_ends_at: new Date(t0.getTime() + 5 * 86400_000).toISOString(),
    };
    const r = resolveLifecycle({ member: memberWithGrace, sub: sub("past_due"), holdPriceId: null, graceDays: 5, now: t6 });
    expect(r.status).toBe("Past Due (Access Restricted)");
    expect(r.grants_access).toBe(false);
    expect(r.in_grace).toBe(false);
  });

  it("recovery (active after past_due) clears grace and failed-at fields in the resolved shape", () => {
    const memberWithGrace = {
      payment_failed_at: t0.toISOString(),
      grace_period_ends_at: new Date(t0.getTime() + 5 * 86400_000).toISOString(),
    };
    const r = resolveLifecycle({ member: memberWithGrace, sub: sub("active"), holdPriceId: null, graceDays: 5, now: t3 });
    expect(r.status).toBe("Active");
    expect(r.grants_access).toBe(true);
    expect(r.payment_failed_at).toBeNull();
    expect(r.grace_ends_at).toBeNull();
  });

  it("cancel_at_period_end keeps access until period end, surfaces Keep Membership", () => {
    const r = resolveLifecycle({ member: {}, sub: sub("active", { cancel_at_period_end: true }), holdPriceId: null, graceDays: 5, now: t0 });
    expect(r.status).toBe("Active (Cancels at period end)");
    expect(r.grants_access).toBe(true);
    expect(r.action).toBe("keep_membership");
  });

  it("canceled removes paid access and surfaces Restart", () => {
    const r = resolveLifecycle({ member: {}, sub: sub("canceled"), holdPriceId: null, graceDays: 5, now: t0 });
    expect(r.status).toBe("Cancelled");
    expect(r.grants_access).toBe(false);
    expect(r.action).toBe("restart_membership");
    expect(r.subscription_ended).toBe(true);
  });

  it("no sub + member previously cancelled stays Expired (does not silently re-grant access)", () => {
    const r = resolveLifecycle({
      member: { subscription_ended_at: t0.toISOString(), subscription_status: "Cancelled" },
      sub: null,
      holdPriceId: null,
      graceDays: 5,
      now: t3,
    });
    expect(r.status).toBe("Expired");
    expect(r.grants_access).toBe(false);
  });

  it("hold-plan price resolves to Hold Plan, not Active", () => {
    const r = resolveLifecycle({
      member: {},
      sub: sub("active", { items: { data: [{ price: { id: "price_HOLD_42" } }] } }),
      holdPriceId: "price_HOLD_42",
      graceDays: 5,
      now: t0,
    });
    expect(r.status).toBe("Hold Plan");
  });
});