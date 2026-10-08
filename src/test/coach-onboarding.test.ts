import { describe, it, expect } from "vitest";
import { decideCoachInviteAcceptance, isAssignableCoach } from "@/lib/coach-onboarding";

const user = { id: "u1", email: "Coach@Example.com" };
const row = (o: Partial<{ email: string; user_id: string | null; status: string; archived: boolean }>) => ({
  email: "coach@example.com", user_id: null, status: "Pending Invite", archived: false, ...o,
});

describe("decideCoachInviteAcceptance", () => {
  it("activates a pending invite for the same email", () => {
    expect(decideCoachInviteAcceptance(row({}), user)).toEqual({ action: "activate" });
    expect(decideCoachInviteAcceptance(row({ user_id: "u1" }), user)).toEqual({ action: "activate" });
  });

  it("links a call-routing row that has no login yet", () => {
    expect(decideCoachInviteAcceptance(row({ status: "Active" }), user)).toEqual({ action: "activate" });
  });

  it("does nothing for an already-active coach", () => {
    expect(decideCoachInviteAcceptance(row({ user_id: "u1", status: "Active" }), user)).toEqual({ action: "noop" });
  });

  it("never lets a deactivated coach switch themselves back on", () => {
    for (const status of ["Inactive", "Suspended", "Archived"]) {
      expect(decideCoachInviteAcceptance(row({ user_id: "u1", status }), user)).toEqual({ action: "refuse", reason: "not_pending" });
    }
    expect(decideCoachInviteAcceptance(row({ user_id: "u1", status: "Active", archived: true }), user))
      .toEqual({ action: "refuse", reason: "not_pending" });
  });

  it("refuses another person's row", () => {
    expect(decideCoachInviteAcceptance(row({ email: "other@example.com" }), user)).toEqual({ action: "refuse", reason: "email_mismatch" });
    expect(decideCoachInviteAcceptance(row({ user_id: "u2" }), user)).toEqual({ action: "refuse", reason: "linked_to_other_user" });
  });
});

describe("isAssignableCoach", () => {
  it("only active or pending, never archived", () => {
    expect(isAssignableCoach({ status: "Active", archived: false })).toBe(true);
    expect(isAssignableCoach({ status: "Pending Invite", archived: false })).toBe(true);
    expect(isAssignableCoach({ status: "Inactive", archived: false })).toBe(false);
    expect(isAssignableCoach({ status: "Suspended", archived: false })).toBe(false);
    expect(isAssignableCoach({ status: "Active", archived: true })).toBe(false);
  });
});
