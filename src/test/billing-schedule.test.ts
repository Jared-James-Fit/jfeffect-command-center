import { describe, it, expect } from "vitest";
import {
  addCycle,
  blankBillingSchedule,
  businessEpochSeconds,
  formatBusinessDate,
  installmentDates,
  nextMonthlyAnchor,
  resolveFirstPaymentDate,
  resolveServiceStartDate,
  scheduleSummary,
  stripeFirstPaymentParams,
  validateBillingSchedule,
} from "@/lib/billing-schedule";

const TODAY = "2026-09-14";

describe("first payment timing", () => {
  it("charges immediately by default (no Stripe delay params)", () => {
    const d = blankBillingSchedule();
    expect(resolveFirstPaymentDate(d, { frequency: "monthly", today: TODAY })).toBeNull();
    expect(stripeFirstPaymentParams(null, { today: TODAY })).toEqual({});
  });

  it("supports a specific future first payment date", () => {
    const d = { ...blankBillingSchedule(), firstPaymentMode: "on_date" as const, firstPaymentDate: "2026-10-01" };
    expect(validateBillingSchedule(d, { today: TODAY })).toBeNull();
    expect(resolveFirstPaymentDate(d, { frequency: "monthly", today: TODAY })).toBe("2026-10-01");
  });

  it("delays the charge with trial_end and never a bare future billing_cycle_anchor", () => {
    const p = stripeFirstPaymentParams("2026-10-01", { today: TODAY });
    expect(p["subscription_data[trial_end]"]).toBe(String(businessEpochSeconds("2026-10-01")));
    // No anchor is sent, so Stripe forbids proration_behavior in this request.
    expect(p["subscription_data[proration_behavior]"]).toBeUndefined();
    expect(Object.keys(p).some((k) => k.includes("billing_cycle_anchor"))).toBe(false);
  });

  it("rejects a past or absent first payment date", () => {
    expect(validateBillingSchedule({ ...blankBillingSchedule(), firstPaymentMode: "on_date", firstPaymentDate: "" }, { today: TODAY })).toMatch(/pick/i);
    expect(validateBillingSchedule({ ...blankBillingSchedule(), firstPaymentMode: "on_date", firstPaymentDate: "2026-09-01" }, { today: TODAY })).toMatch(/future/i);
  });

  it("keeps the selected date from shifting a day under UTC conversion", () => {
    const epoch = businessEpochSeconds("2026-10-01");
    const shown = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Winnipeg" }).format(epoch * 1000);
    expect(shown).toBe("2026-10-01");
    expect(formatBusinessDate("2026-10-01")).toBe("October 1, 2026");
  });
});

describe("billing anchor", () => {
  it("anchors monthly billing to a friendly billing day", () => {
    expect(nextMonthlyAnchor(TODAY, 1)).toBe("2026-10-01");
    expect(nextMonthlyAnchor(TODAY, 28)).toBe("2026-09-28");
    const d = { ...blankBillingSchedule(), billingDay: "1" };
    expect(resolveFirstPaymentDate(d, { frequency: "monthly", today: TODAY })).toBe("2026-10-01");
  });

  it("weekly and bi-weekly run from the first payment date", () => {
    expect(addCycle("2026-09-18", "weekly")).toBe("2026-09-25");
    expect(installmentDates("2026-09-18", "biweekly", 4)).toEqual([
      "2026-09-18", "2026-10-02", "2026-10-16", "2026-10-30",
    ]);
  });

  it("clamps month-end dates instead of inventing fake invoice days", () => {
    expect(addCycle("2026-01-31", "monthly")).toBe("2026-02-28");
  });
});

describe("schedule summary", () => {
  it("summarises renews-until-cancelled with a future first payment", () => {
    const s = scheduleSummary({
      draft: { ...blankBillingSchedule(), firstPaymentMode: "on_date", firstPaymentDate: "2026-10-01" },
      paymentType: "recurring", frequency: "monthly", today: TODAY,
    });
    expect(s.firstPayment).toBe("October 1, 2026");
    expect(s.anchor).toBe("1st of every month");
    expect(s.duration).toBe("Renews until cancelled");
  });

  it("computes the final payment of a fixed 4-payment plan", () => {
    const s = scheduleSummary({
      draft: { ...blankBillingSchedule(), firstPaymentMode: "on_date", firstPaymentDate: "2026-09-18" },
      paymentType: "recurring", frequency: "biweekly", numberOfPayments: 4, today: TODAY,
    });
    expect(s.duration).toContain("4 payments");
    expect(s.finalPayment).toBe("October 30, 2026");
  });

  it("hides recurring controls data for one-time sales", () => {
    const s = scheduleSummary({ draft: blankBillingSchedule(), paymentType: "one_time", frequency: null, today: TODAY });
    expect(s.recurring).toBeNull();
    expect(s.anchor).toBeNull();
    expect(s.firstPayment).toMatch(/checkout/i);
  });
});

describe("service access is separate from billing", () => {
  it("can start service before the first payment", () => {
    const d = { ...blankBillingSchedule(), firstPaymentMode: "on_date" as const, firstPaymentDate: "2026-10-01" };
    expect(resolveServiceStartDate(d, "2026-10-01", { today: TODAY })).toBeNull(); // immediate
    const withDate = { ...d, serviceStartMode: "on_date" as const, serviceStartDate: "2026-09-15" };
    expect(resolveServiceStartDate(withDate, "2026-10-01", { today: TODAY })).toBe("2026-09-15");
  });

  it("can follow the first payment when the coach chooses that", () => {
    const d = {
      ...blankBillingSchedule(),
      firstPaymentMode: "on_date" as const,
      firstPaymentDate: "2026-10-01",
      serviceStartMode: "with_first_payment" as const,
    };
    expect(resolveServiceStartDate(d, "2026-10-01", { today: TODAY })).toBe("2026-10-01");
  });
});
