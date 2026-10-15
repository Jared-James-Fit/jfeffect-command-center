import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clientBottomNav, clientNav, selfServeNav } from "@/lib/admin-nav";

const read = (p: string) => readFileSync(p, "utf8");

describe("Home has no notification bell", () => {
  const home = read("src/routes/_authenticated/portal/index.tsx");

  it("the greeting stands alone: no bell, no badge, no link to Announcements", () => {
    expect(home).not.toMatch(/\bBell\b/);
    expect(home).not.toContain('aria-label="Notifications"');
    expect(home).not.toContain('to="/portal/announcements"');
    expect(home).toContain("<GreetingHeader firstName={firstName} />");
  });

  it("the reads that only fed the bell's count are gone", () => {
    expect(home).not.toContain("portal-coach-updates");
    expect(home).not.toContain("unreadMsgs");
    expect(home).not.toContain('from("lift_video_comments")');
  });

  it("what the bell pointed at is still reachable: Messages tab, Announcements in the menu", () => {
    expect(clientBottomNav.map((n) => n.to)).toContain("/portal/messages");
    expect(clientNav.map((n) => n.to)).toContain("/portal/announcements");
    expect(selfServeNav.map((n) => n.to)).toContain("/portal/announcements");
  });
});
