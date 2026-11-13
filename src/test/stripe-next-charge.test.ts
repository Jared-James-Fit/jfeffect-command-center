import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { subscriptionNextCharge } from "@/lib/stripe-next-charge";

const unix = (iso: string) => Math.floor(Date.parse(`${iso}T23:34:00Z`) / 1000);
// Marc's package 2 subscription as Stripe sends it on API 2025-03-31+: the period on the item.
const marcSub = (start: string, end: string, extra: Record<string, unknown> = {}) => ({
  status: "active",
  cancel_at_period_end: false,
  items: { data: [{ current_period_start: unix(start), current_period_end: unix(end) }] },
  ...extra,
});

describe("a subscription's next charge (the webhook, the daily sync and Reconcile)", () => {
  it("reads the period from the subscription's item (Stripe API 2025-03-31+), not only the subscription", () => {
    expect(subscriptionNextCharge(marcSub("2026-10-30", "2026-11-13"), null)).toBe("2026-11-13");
    expect(subscriptionNextCharge({ status: "active", current_period_start: unix("2026-10-30"), current_period_end: unix("2026-11-13") }, null)).toBe("2026-11-13");
  });

  it("Nov 13 2026, 22:34 UTC: Stripe opens Marc's next period an hour before charging; today's charge stays the next one", () => {
    // Before, the webhook read a missing current_period_end and wrote null, so Billing showed no payment dates until the charge.
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27"), "2026-11-13")).toBe("2026-11-13");
  });

  it("once invoice.paid has rolled it on, later updates keep the period's end", () => {
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27"), "2026-11-27")).toBe("2026-11-27");
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27"), null)).toBe("2026-11-27");
  });

  it("an event with no period never wipes a date already known", () => {
    expect(subscriptionNextCharge({ status: "active", cancel_at_period_end: false }, "2026-11-13")).toBe("2026-11-13");
  });

  it("only a subscription that will charge again has one", () => {
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27", { cancel_at_period_end: true }), "2026-11-13")).toBeNull();
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27", { status: "canceled" }), "2026-11-13")).toBeNull();
    expect(subscriptionNextCharge(marcSub("2026-11-13", "2026-11-27", { status: "past_due" }), "2026-11-13")).toBeNull();
  });

  it("every writer of next_billing_date uses it", () => {
    for (const f of [
      "src/routes/api/public/stripe-webhook.ts",
      "src/lib/stripe-client-sync.server.ts",
      "src/lib/stripe-account-sync.server.ts",
      "src/lib/stripe-sync.functions.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("subscriptionNextCharge(");
      expect(src, f).not.toMatch(/next_billing_date:\s*\n?\s*obj\.current_period_end/);
    }
    const hook = readFileSync("src/routes/api/public/stripe-webhook.ts", "utf8");
    expect(hook.match(/next_billing_date: subscriptionNextCharge\(obj, purchase\.next_billing_date\)/g)).toHaveLength(2);
  });
});
