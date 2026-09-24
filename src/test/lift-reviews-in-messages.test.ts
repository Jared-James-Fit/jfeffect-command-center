import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const thread = readFileSync("src/components/message-thread.tsx", "utf8");
const plusMenu = readFileSync("src/components/composer-plus-menu.tsx", "utf8");
const adminCoaching = readFileSync("src/routes/_authenticated/admin/coaching.tsx", "utf8");
const adminNav = readFileSync("src/lib/internal-nav.ts", "utf8");
const legacyNav = readFileSync("src/lib/admin-nav.ts", "utf8");
const clientBadges = readFileSync("src/hooks/use-client-nav-badges.ts", "utf8");
const adminBadges = readFileSync("src/hooks/use-admin-nav-badges.ts", "utf8");
const clientLegacyRoute = readFileSync("src/routes/_authenticated/portal/lift-videos.tsx", "utf8");

describe("lift reviews live inside Messages", () => {
  it("gives both sides a direct lift-review action in the message composer", () => {
    expect(thread).toContain("LiftReviewMessageSheet");
    expect(thread).toContain("setLiftReviewOpen(true)");
    expect(plusMenu).toContain('key: "lift-review"');
    expect(plusMenu).toContain("onLiftReview");
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
