import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeAccountAccess } from "@/lib/client-account-access";

const SHELL = readFileSync("src/routes/_authenticated/admin/clients.$id.tsx", "utf8");

describe("client profile shell cleanup", () => {
  it("no longer renders the duplicate Actions grid", () => {
    expect(SHELL).not.toContain("EmbeddedActionCenter");
    expect(SHELL).not.toContain("WorkspaceActionCenter");
  });

  it("does not render the Account Setup banner above the workspace nav", () => {
    const navIdx = SHELL.indexOf("<SectionNav");
    const bannerIdx = SHELL.indexOf("<SetupStatusBanner");
    expect(navIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeGreaterThan(navIdx);
  });

  it("renders the workspace nav exactly once, directly inside Tabs", () => {
    expect(SHELL.match(/<SectionNav/g)?.length).toBe(1);
    const tabsIdx = SHELL.indexOf("<Tabs value={tab");
    const navIdx = SHELL.indexOf("<SectionNav");
    expect(SHELL.slice(tabsIdx, navIdx)).not.toContain("<Card");
  });

  it("keeps header actions (Message, POV, More) and Assign Program in Training", () => {
    expect(SHELL).toContain("EmbeddedIdentityHeader");
    expect(SHELL).toContain("POV");
    expect(SHELL).toContain("moreMenu");
    expect(SHELL).toContain("<TrainingProgramHub");
  });

  it("surfaces Account & Access inside Summary without duplicating last sign-in", () => {
    const cardIdx = SHELL.indexOf("Account &amp; Access");
    expect(cardIdx).toBeGreaterThan(-1);
    const card = SHELL.slice(cardIdx, cardIdx + 1600);
    expect(card).toContain("Account created");
    expect(card).toContain("Invite status");
    expect(card).toContain("Manage access");
    expect(card).not.toContain("Last signed in");
    expect(SHELL).toContain("<AppActivityCard");
  });
});

describe("describeAccountAccess", () => {
  it("is quiet for a healthy live account", () => {
    const a = describeAccountAccess({
      user_id: "u1",
      email: "a@b.com",
      account_created_at: "2026-08-09T00:00:00Z",
      invite_sent_at: "2026-08-09T00:00:00Z",
      last_signed_in_at: "2026-08-20T00:00:00Z",
    });
    expect(a.statusLabel).toBe("Live");
    expect(a.needsAttention).toBe(false);
    expect(a.inviteStatusLabel).toBe("Completed");
    expect(a.accountCreatedAt).toBe("2026-08-09T00:00:00Z");
  });

  it("flags problem states", () => {
    expect(describeAccountAccess({ email: "a@b.com" }).statusLabel).toBe("No account");
    expect(
      describeAccountAccess(
        { email: "a@b.com", invite_sent_at: "2026-08-01T00:00:00Z", invite_expires_at: "2026-08-03T00:00:00Z" },
        Date.parse("2026-08-10T00:00:00Z"),
      ).statusLabel,
    ).toBe("Invite expired");
    expect(
      describeAccountAccess({ email: "a@b.com", user_id: "u", account_created_at: "x", portal_access_disabled: true })
        .statusLabel,
    ).toBe("Access disabled");
    expect(describeAccountAccess({ user_id: "u", account_created_at: "x", last_signed_in_at: "y" }).needsAttention).toBe(true);
  });

  it("never exposes activity fields handled by App Activity", () => {
    expect(describeAccountAccess({}).excludedFields).toContain("last_signed_in_at");
  });
});
