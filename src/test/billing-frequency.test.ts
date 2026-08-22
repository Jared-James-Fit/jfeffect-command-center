import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BILLING_FREQUENCY_OPTIONS,
  billingCadencePhrase,
  billingFrequencyLabel,
  formatRecurringPrice,
  fromStripeRecurring,
  parseBillingFrequency,
  paymentStructureLabel,
  stripeRecurringPhrase,
  toStripeRecurring,
} from "@/lib/billing-frequency";

describe("billing frequency dropdown", () => {
  it("includes Bi-weekly alongside weekly/monthly/yearly", () => {
    expect(BILLING_FREQUENCY_OPTIONS.map((o) => o.value)).toEqual([
      "weekly",
      "biweekly",
      "monthly",
      "yearly",
    ]);
    const biweekly = BILLING_FREQUENCY_OPTIONS.find((o) => o.value === "biweekly")!;
    expect(biweekly.label).toBe("Bi-weekly");
    expect(biweekly.hint).toBe("Every 2 weeks");
  });

  it("is rendered by the product modal and admin payment-links form", () => {
    for (const file of [
      "src/components/products/new-product-modal.tsx",
      "src/routes/_authenticated/admin/payment-links.tsx",
    ]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("BILLING_FREQUENCY_OPTIONS");
      expect(src).not.toMatch(/<SelectItem value="week">Weekly<\/SelectItem>/);
    }
  });
});

describe("stripe mapping", () => {
  it("maps bi-weekly to interval=week", () => {
    expect(toStripeRecurring("biweekly").interval).toBe("week");
  });

  it("maps bi-weekly to interval_count=2", () => {
    expect(toStripeRecurring("biweekly").interval_count).toBe(2);
  });

  it("keeps the other cadences at count 1", () => {
    expect(toStripeRecurring("weekly")).toEqual({ interval: "week", interval_count: 1 });
    expect(toStripeRecurring("monthly")).toEqual({ interval: "month", interval_count: 1 });
    expect(toStripeRecurring("yearly")).toEqual({ interval: "year", interval_count: 1 });
  });

  it("round-trips back from Stripe without collapsing to weekly", () => {
    expect(fromStripeRecurring({ interval: "week", interval_count: 2 })).toBe("biweekly");
    expect(fromStripeRecurring({ interval: "week", interval_count: 1 })).toBe("weekly");
    expect(fromStripeRecurring({ interval: "week" })).toBe("weekly");
    expect(fromStripeRecurring({ interval: "month", interval_count: 1 })).toBe("monthly");
    expect(fromStripeRecurring(null)).toBeNull();
    expect(fromStripeRecurring({ interval: "week", interval_count: 3 })).toBeNull();
  });

  it("sends recurring[interval_count] when creating the Stripe price", () => {
    const src = readFileSync("src/lib/coaching-products.functions.ts", "utf8");
    expect(src).toContain('priceParams["recurring[interval_count]"]');
    expect(src).toContain("toStripeRecurring");
  });
});

describe("display", () => {
  it("never labels a bi-weekly plan as weekly", () => {
    expect(billingFrequencyLabel("biweekly")).toBe("Bi-weekly");
    expect(billingCadencePhrase("biweekly")).toBe("every 2 weeks");
    expect(stripeRecurringPhrase({ interval: "week", interval_count: 2 })).toBe("every 2 weeks");
    expect(stripeRecurringPhrase({ interval: "week", interval_count: 1 })).toBe("every week");
    expect(stripeRecurringPhrase({ interval: "week", interval_count: 3 })).toBe("every 3 weeks");
    expect(formatRecurringPrice("$800.00 CAD", "biweekly")).toBe("$800.00 CAD every 2 weeks");
  });

  it("stores an unambiguous payment structure label", () => {
    expect(paymentStructureLabel("biweekly")).toBe("Bi-weekly subscription (every 2 weeks)");
    expect(paymentStructureLabel("biweekly", 6)).toBe(
      "Bi-weekly subscription (every 2 weeks) — 6 payments",
    );
    // checkout treats stored structures containing bi-weekly as recurring
    expect(/monthly|weekly|bi-weekly|quarterly|annual|recurring/i.test(paymentStructureLabel("biweekly"))).toBe(
      true,
    );
  });

  it("parses legacy stored cadence text", () => {
    expect(parseBillingFrequency("Bi-weekly subscription")).toBe("biweekly");
    expect(parseBillingFrequency("every 2 weeks")).toBe("biweekly");
    expect(parseBillingFrequency("week")).toBe("weekly");
    expect(parseBillingFrequency("Annual plan")).toBe("yearly");
    expect(parseBillingFrequency(null)).toBeNull();
  });
});
