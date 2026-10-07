import { describe, it, expect } from "vitest";
import {
  paymentReminderStatus, paymentLinkExpiryText, endOfBusinessDayIso, businessDateOf, MAX_PAYMENT_REMINDERS,
} from "@/lib/payment-reminder-status";

const SALE = { payment_status: "Pending Payment", stripe_payment_link: "https://checkout.stripe.com/x" };

describe("paymentReminderStatus", () => {
  it("only applies to unpaid, unarchived sales that have a payment link", () => {
    expect(paymentReminderStatus({ ...SALE, payment_status: "Paid" })).toBeNull();
    expect(paymentReminderStatus({ ...SALE, payment_status: "Active Subscription" })).toBeNull();
    expect(paymentReminderStatus({ ...SALE, archived_at: "2026-10-01T00:00:00Z" })).toBeNull();
    expect(paymentReminderStatus({ payment_status: "Pending Payment" })).toBeNull();
  });

  it("shows pause, progress and the text", () => {
    expect(paymentReminderStatus({ ...SALE, payment_reminders_paused: true })?.text).toBe("Payment reminders paused");
    expect(paymentReminderStatus({ ...SALE, payment_reminder_count: 0 })?.text).toMatch(/^Reminders on/);
    const one = paymentReminderStatus({ ...SALE, payment_reminder_count: 1, last_payment_reminder_at: "2026-10-08T17:40:00Z" });
    expect(one?.text).toBe("Reminder 1 of 3 sent (Oct 8)");
    const two = paymentReminderStatus({ ...SALE, payment_reminder_count: 2, last_payment_reminder_at: "2026-10-13T17:40:00Z", payment_sms_sent_at: "2026-10-10T17:40:00Z" });
    expect(two?.text).toBe("Reminder 2 of 3 sent (Oct 13) · text sent");
    const done = paymentReminderStatus({ ...SALE, payment_reminder_count: 3, payment_sms_sent_at: "2026-10-10T17:40:00Z" });
    expect(done).toEqual({ text: `All ${MAX_PAYMENT_REMINDERS} reminders sent · text sent`, tone: "warn" });
  });
});

describe("payment link expiry", () => {
  it("says nothing when the link never expires", () => {
    expect(paymentLinkExpiryText({ payment_link_expires_at: null })).toBeNull();
  });

  it("describes a future or past expiry", () => {
    const future = new Date(Date.now() + 5 * 86400000).toISOString();
    const past = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(paymentLinkExpiryText({ payment_link_expires_at: future })).toMatch(/^Link expires /);
    expect(paymentLinkExpiryText({ payment_link_expires_at: past })).toMatch(/^Link expired /);
  });

  it("stores the end of the chosen day in business time and reads it back as the same date", () => {
    for (const d of ["2026-10-20", "2026-11-01", "2026-11-02", "2027-03-14"]) {
      const iso = endOfBusinessDayIso(d);
      expect(businessDateOf(iso)).toBe(d);
      // 11:59:59pm local is the very end of that day: one minute later it is the next date.
      expect(businessDateOf(new Date(Date.parse(iso) + 60_000).toISOString())).not.toBe(d);
    }
    expect(businessDateOf(null)).toBe("");
  });
});
