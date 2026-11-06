import { describe, expect, it } from "vitest";
import {
  chargeTimeText,
  clockTime,
  renewalChargeAt,
  renewalColumns,
  sameInstant,
  subscriptionPeriodEnd,
} from "@/lib/stripe-renewal";

const unix = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const TZ = "America/Winnipeg";

describe("a Stripe renewal, to the minute", () => {
  it("reads the period end from the subscription or, on newer APIs, its first item", () => {
    expect(subscriptionPeriodEnd({ current_period_end: 1794008853 })).toBe(1794008853);
    expect(subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1794008853 }] } })).toBe(
      1794008853,
    );
    expect(subscriptionPeriodEnd({ status: "active" })).toBeNull();
    expect(subscriptionPeriodEnd(null)).toBeNull();
  });

  it("stores the instant and its Winnipeg day, never the UTC day", () => {
    // Alyssa: signed up Oct 6 at 6:47 PM, so she renews Nov 6 at 6:47 PM (23:47 UTC).
    expect(renewalColumns(unix("2026-11-06T23:47:33Z"))).toEqual({
      next_billing_at: "2026-11-06T23:47:33.000Z",
      next_billing_date: "2026-11-06",
    });
    // 8:30 PM Nov 6 in Winnipeg is already Nov 7 in UTC: still Nov 6.
    expect(renewalColumns(unix("2026-11-07T01:30:00Z")).next_billing_date).toBe("2026-11-06");
    expect(renewalColumns(null)).toEqual({ next_billing_at: null, next_billing_date: null });
  });

  it("says when the card is charged: about an hour after the renewal", () => {
    const renews = new Date("2026-11-06T23:47:33Z");
    expect(clockTime(renews, TZ)).toBe("6:47 PM");
    expect(renewalChargeAt(renews).toISOString()).toBe("2026-11-07T00:47:33.000Z");
    expect(chargeTimeText(renews, TZ)).toBe("around 7:47 PM");
    // An hour after 11:30 PM is the next day, so the day is named.
    expect(chargeTimeText(new Date("2026-11-07T04:30:00Z"), TZ)).toBe("around 12:30 AM Nov 7");
  });

  it("compares stored instants by moment, null and missing alike", () => {
    expect(sameInstant("2026-11-06T23:47:33+00:00", "2026-11-06T23:47:33.000Z")).toBe(true);
    expect(sameInstant(null, undefined)).toBe(true);
    expect(sameInstant(null, "2026-11-06T23:47:33Z")).toBe(false);
  });
});
