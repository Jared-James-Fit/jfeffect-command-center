import { describe, expect, it } from "vitest";
import { rowBadges, STATUS_META } from "@/components/clients/clients-status";

const row = (over: Record<string, unknown> = {}): any => ({
  account_status: "Account Created",
  f_needs_setup: false, f_needs_review: false, f_program_ending: false, f_payment_issue: false, f_new_client: false,
  f_missed_workouts: false, missed_workouts_count: 0, f_inactive: false, payment_state: "ok",
  ...over,
});
const labels = (r: any) => rowBadges(r).map((b) => b.label);

describe("client row badges", () => {
  it("does not say Needs Setup for an account that has already been created", () => {
    expect(labels(row({ f_needs_setup: true, account_status: "Account Created" }))).not.toContain("Needs Setup");
    expect(labels(row({ f_needs_setup: true, account_status: "Invite Sent" }))).toContain("Needs Setup");
  });

  it("shows payment states: missed, none set up, awaiting; nothing for ok or exempt", () => {
    expect(labels(row({ f_payment_issue: true, payment_state: "past_due" }))).toContain("Payment Issue");
    expect(labels(row({ payment_state: "not_set_up" }))).toContain("No Payment Set Up");
    expect(labels(row({ payment_state: "pending" }))).toContain("Awaiting Payment");
    expect(labels(row({ payment_state: "ok" }))).toEqual(["Active"]);
    expect(labels(row({ payment_state: "exempt" }))).toEqual(["Active"]);
  });

  it("every badge has a plain-English hint, and every status card does too", () => {
    const all = rowBadges(row({
      f_payment_issue: true, payment_state: "not_set_up", f_needs_review: true,
      f_missed_workouts: true, missed_workouts_count: 3, f_inactive: true, f_program_ending: true,
    }));
    expect(all.length).toBe(4);
    for (const b of all) expect(b.hint.length).toBeGreaterThan(20);
    for (const m of Object.values(STATUS_META)) if (m.label !== "All Clients") expect(m.hint).toBeTruthy();
    expect(STATUS_META.no_payment.label).toBe("No Payment");
  });
});
