import { describe, it, expect } from "vitest";
import { INVITABLE_ROLES, STAFF_ROLE_INFO, inviteExpiryLabel, isInvitableRole, staffInviteMessage } from "@/lib/staff-roles";

describe("staff roles", () => {
  it("only finance can be invited by link (never admin; coaches go through People)", () => {
    expect([...INVITABLE_ROLES]).toEqual(["finance"]);
    expect(isInvitableRole("finance")).toBe(true);
    for (const r of ["admin", "coach", "media_manager", "client", "", null, undefined]) expect(isInvitableRole(r as any)).toBe(false);
    expect(STAFF_ROLE_INFO.admin.setup).toBe("owner_only");
    expect(STAFF_ROLE_INFO.media_manager.setup).toBe("retired");
  });

  it("finance sees everything view-only, changes only its own areas, and signs in with a password alone", () => {
    const f = STAFF_ROLE_INFO.finance;
    expect(f.can.join(" ")).toMatch(/everything in the admin app, view-only/);
    expect(f.cannot.join(" ")).toMatch(/Change clients, programs, check-ins, messages or settings/);
    expect(f.cannot.join(" ")).toMatch(/Refund, comp or cancel/);
    expect(f.cannot.join(" ")).toMatch(/Delete/);
    expect(f.cannot.join(" ")).toMatch(/tokens or invite links/);
    expect("requiresAuthenticator" in f).toBe(false);
  });

  it("labels invite expiry", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(inviteExpiryLabel(null, now)).toBe("No expiry");
    expect(inviteExpiryLabel("2026-10-09T11:00:00Z", now)).toBe("Expired");
    expect(inviteExpiryLabel("2026-10-09T20:00:00Z", now)).toBe("Expires today");
    expect(inviteExpiryLabel("2026-10-10T13:00:00Z", now)).toBe("Expires in 1 day");
    expect(inviteExpiryLabel("2026-10-16T12:00:00Z", now)).toBe("Expires in 7 days");
  });

  it("writes the Messenger invite with the new login email", () => {
    const text = staffInviteMessage({ firstName: "Fionna", role: "finance", email: "fionnafaye.ig@gmail.com" });
    expect(text).toMatch(/^Hey Fionna!/);
    expect(text).toContain("(Finance)");
    expect(text).toContain("fionnafaye.ig@gmail.com");
    expect(text).toContain("separate login");
    expect(text).not.toMatch(/—/);
  });
});
