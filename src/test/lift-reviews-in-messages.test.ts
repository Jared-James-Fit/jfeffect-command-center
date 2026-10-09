import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FINANCE_BAR, STAFF_BAR } from "@/lib/internal-nav";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const plusMenu = readFileSync("src/components/composer-plus-menu.tsx", "utf8");
const adminCoaching = readFileSync("src/routes/_authenticated/admin/coaching.tsx", "utf8");
const adminNav = readFileSync("src/lib/internal-nav.ts", "utf8");
const legacyNav = readFileSync("src/lib/admin-nav.ts", "utf8");
const clientBadges = readFileSync("src/hooks/use-client-nav-badges.ts", "utf8");
const adminBadges = readFileSync("src/hooks/use-admin-nav-badges.ts", "utf8");
const clientLegacyRoute = readFileSync("src/routes/_authenticated/portal/lift-videos.tsx", "utf8");
const adminLegacyPage = readFileSync("src/route-pages/_authenticated/admin/lift-videos.tsx", "utf8");
const adminShell = readFileSync("src/routes/_authenticated/admin/route.tsx", "utf8");

describe("lift reviews live inside Messages", () => {
  // "Send a lift for review" was retired: a form check is just a video in the
  // chat. No separate sheet, prompt, queue page or bottom-bar button.
  it("has no separate send-for-review flow anywhere", () => {
    expect(thread).not.toContain("LiftReviewMessageSheet");
    expect(plusMenu).not.toContain('key: "lift-review"');
    for (const gone of [
      "src/components/messages/lift-review-message-sheet.tsx",
      "src/components/post-workout-lift-prompt.tsx",
      "src/components/client-lift-video-uploader.tsx",
      "src/components/lift-videos-panel.tsx",
      "src/components/admin-lift-review-thread.tsx",
    ]) {
      expect(existsSync(gone), gone).toBe(false);
    }
  });

  it("no bottom-bar button for lifts (the staff bar is Dashboard, Clients, League, Messages, Tasks)", () => {
    expect(adminShell).not.toContain('pick("/admin/lift-videos")');
    expect(adminShell).toContain("const defaultBottom = viewOnly ? FINANCE_BAR : STAFF_BAR;");
    expect([...STAFF_BAR, ...FINANCE_BAR].some((i) => i.to === "/admin/lift-videos")).toBe(false);
  });

  it("old admin links land in Messages", () => {
    expect(adminLegacyPage).toContain('navigate({ to: "/admin/communication", search: { tab: "messages" } as any, replace: true });');
  });

  it("removes the standalone coaching tab and nav destinations", () => {
    expect(adminCoaching).not.toContain('{ value: "lift-reviews", label: "Lift Reviews" }');
    expect(adminNav).not.toContain('{ to: "/admin/lift-videos", label: "Lift Reviews"');
    expect(legacyNav).not.toContain('{ to: "/admin/lift-videos", label: "Lift Reviews"');
    expect(legacyNav).not.toContain('{ to: "/portal/lift-videos", label: "Coach Feedback"');
  });

  it("routes old client links to Messages", () => {
    expect(clientLegacyRoute).toContain('navigate({ to: "/portal/messages", replace: true })');
  });

  it("moves lift-review alerting onto Messages", () => {
    expect(clientBadges).toContain('result["/portal/messages"]');
    expect(clientBadges).not.toContain('result["/portal/lift-videos"]');
    expect(adminBadges).toContain('r["/admin/messages"]');
    expect(adminBadges).not.toContain('r["/admin/lift-videos"]');
  });
});
