import { describe, expect, it } from "vitest";
import { coachInviteAcceptable } from "@/lib/coaches.functions";

describe("accepting a coach invite", () => {
  const me = "user-1";
  it("accepts a pending invite sent to this login, or to nobody yet", () => {
    expect(
      coachInviteAcceptable({ status: "Pending Invite", archived: false, user_id: me }, me),
    ).toBe(true);
    expect(
      coachInviteAcceptable({ status: "Pending Invite", archived: false, user_id: null }, me),
    ).toBe(true);
  });
  it("never lets a suspended, archived or inactive coach put themselves back", () => {
    // The invite's coach_id stays in the login's metadata, so the old invite can be replayed.
    for (const status of ["Suspended", "Inactive", "Archived", "Active"]) {
      expect(coachInviteAcceptable({ status, archived: false, user_id: me }, me)).toBe(false);
    }
    expect(
      coachInviteAcceptable({ status: "Pending Invite", archived: true, user_id: me }, me),
    ).toBe(false);
  });
  it("never accepts an invite that belongs to another login", () => {
    expect(
      coachInviteAcceptable({ status: "Pending Invite", archived: false, user_id: "user-2" }, me),
    ).toBe(false);
  });
});
