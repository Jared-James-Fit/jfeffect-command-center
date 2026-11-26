import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { teamSetupSteps } from "@/lib/team-account-setup";
const input = { createdAt: "2026-01-01", lastSignInAt: null, emailConfirmed: false, twoStepRequired: true, twoStepEnrolled: null };
describe("team account workspace", () => {
  it("does not count an unknown MFA read as completed", () => {
    expect(teamSetupSteps(input).map(s => s.state)).toEqual(["Completed","Awaiting team member","Awaiting team member","Check status"]);
  });
  it("requires MFA for staff who need it without requiring a client profile", () => {
    expect(teamSetupSteps({...input, lastSignInAt: "2026-01-02", emailConfirmed: true, twoStepEnrolled: true}).every(s => s.state === "Completed")).toBe(true);
    expect(teamSetupSteps({...input, twoStepRequired: false, twoStepEnrolled: false})).toHaveLength(3);
  });
  it("opens team accounts in the shared overlay, not through a fabricated client id", () => {
    const overlay = readFileSync("src/components/clients/profile/client-profile-overlay.tsx","utf8");
    const staff = readFileSync("src/route-pages/_authenticated/admin/staff.tsx","utf8");
    expect(overlay).toContain("<TeamAccountWorkspace key={teamUserId} userId={teamUserId}");
    expect(staff).toContain("open(m.user_id)");
    expect(staff).toContain("<ClientNameLink clientId={m.client.id}>Open client");
    expect(staff).toContain("WorkspaceIdentityHeader");
  });
});
