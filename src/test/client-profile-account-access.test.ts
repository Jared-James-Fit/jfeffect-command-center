import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeAccountAccess } from "@/lib/client-account-access";

const SHELL = readFileSync("src/route-pages/_authenticated/admin/clients.$id.tsx", "utf8");

describe("client profile shell cleanup", () => {
  it("no longer renders the duplicate Actions grid", () => {
    expect(SHELL).not.toContain("EmbeddedActionCenter");
    expect(SHELL).not.toContain("WorkspaceActionCenter");
  });

  it("keeps account actions in one canonical Login & Access area", () => {
    expect(SHELL).not.toContain("<SetupStatusBanner");
    expect(SHELL).not.toContain("Mark setup complete");
    expect(SHELL).toContain("Email reset link");
    expect(SHELL).toContain("Text setup link");
    expect(SHELL).toContain("Copy reset link");
  });

  it("renders the workspace nav exactly once, directly inside Tabs", () => {
    expect(SHELL.match(/<SectionNav/g)?.length).toBe(1);
    const tabsIdx = SHELL.indexOf("<Tabs value={tab");
    const navIdx = SHELL.indexOf("<SectionNav");
    expect(SHELL.slice(tabsIdx, navIdx)).not.toContain("<Card");
  });

  it("keeps header actions (Message, POV, More) and one Training tab (program, schedule, setup, notes)", () => {
    expect(SHELL).toContain("EmbeddedIdentityHeader");
    expect(SHELL).toContain("POV");
    expect(SHELL).toContain("moreMenu");
    expect(SHELL).toContain("<ClientTrainingTab");
    expect(SHELL).not.toMatch(/<TrainingPhasesPanel|<ImportantDatesPanel|<AssignedProgramsCard|<TrainingProgramHub/);
  });

  it("puts login problems and missing fields in Summary's one Missing list, without duplicating last sign-in", () => {
    const cardIdx = SHELL.indexOf('data-testid="client-missing-card"');
    expect(cardIdx).toBeGreaterThan(-1);
    const card = SHELL.slice(cardIdx, cardIdx + 3200);
    expect(card).toContain('data-testid="account-access-card"');
    expect(card).toContain("Account created");
    expect(card).toContain("Invite status");
    expect(card).toContain("Manage access");
    expect(card).toContain("{missing.map((m) => (");
    expect(card).not.toContain("Last signed in");
    // shown only when something is missing
    expect(SHELL).toContain("{(missing.length > 0 || loginIssue) && (");
    expect(SHELL).toContain("<AppActivityCard");
  });

  it("Summary doesn't repeat the header: no identity card, quick-action grid or Personal Snapshot", () => {
    const summary = SHELL.slice(SHELL.indexOf("function ClientOverviewSnapshot("), SHELL.indexOf("function FoldedSection("));
    expect(summary).not.toContain("Open Client POV");
    expect(summary).not.toContain("Manage Schedule");
    expect(summary).not.toContain("Personal Snapshot");
    expect(summary).not.toContain("Add phase");
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
    const disabled = describeAccountAccess({ email: "a@b.com", user_id: "u", account_created_at: "x", portal_access_disabled: true });
    expect(disabled.statusLabel).toBe("Never signed in");
    expect(disabled.needsAttention).toBe(true);
    expect(describeAccountAccess({ user_id: "u", account_created_at: "x", last_signed_in_at: "y" }).needsAttention).toBe(true);
  });

  it("ignores stale invite expiry once an account exists", () => {
    const a = describeAccountAccess({ user_id: "u", email: "a@b.com", invite_expires_at: "2020-01-01T00:00:00Z" }, Date.parse("2026-01-01T00:00:00Z"));
    expect(a.stage).toBe("account_no_signin");
    expect(a.primaryAction).toBe("password_recovery");
    expect(a.inviteStatusLabel).toBe("Completed");
  });

  it("never exposes activity fields handled by App Activity", () => {
    expect(describeAccountAccess({}).excludedFields).toContain("last_signed_in_at");
  });
});
