import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { STAFF_BAR, buildInternalNav, buildInternalNavCollapsed } from "@/lib/internal-nav";

const read = (p: string) => readFileSync(p, "utf8");

describe("one staff app, laid out like the client app", () => {
  it("every staff phone bar is Dashboard, Clients, Messages, Tasks: plain tabs", () => {
    expect(STAFF_BAR.map((i) => i.label)).toEqual(["Dashboard", "Clients", "Messages", "Tasks"]);
    expect(STAFF_BAR.map((i) => i.to)).toEqual(["/admin", "/admin/clients", "/admin/messages", "/admin/tasks"]);
    expect(STAFF_BAR.every((i) => !i.children && !!i.icon)).toBe(true);
  });

  it("More opens from a big header button for staff, clients and members", () => {
    expect(read("src/routes/_authenticated/admin/route.tsx")).toContain("title={title} moreInHeader>");
    expect(read("src/routes/_authenticated/m/route.tsx")).toContain('title="Member" moreInHeader>');
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain('title="Client Portal" moreInHeader>');
    expect(read("src/components/app-shell.tsx")).toContain('className="h-10 w-10 shrink-0 rounded-xl px-0">');
  });

  it("Tasks lights up on the tasks page it opens", () => {
    expect(read("src/components/app-shell.tsx")).toContain('item.to === "/admin/tasks"\n          ? { path: "/admin/content", tab: "tasks" }');
  });

  it("bars saved before the reset start fresh", () => {
    expect(read("src/lib/floating-bar.ts")).toContain('const KEY = "jf-floating-bar-v3";');
  });
});

describe("membership is a section of the admin menu, not a separate mode", () => {
  it("the admin menu has a Membership section with every membership page", () => {
    const flat = buildInternalNav("admin");
    const membership = flat.filter((i) => i.group === "Membership").map((i) => i.to);
    for (const to of ["/admin/membership", "/admin/members", "/admin/membership/billing", "/admin/member-plans", "/admin/membership/support", "/admin/membership/action-needed"]) {
      expect(membership).toContain(to);
    }
    const row = buildInternalNavCollapsed("admin").find((i) => i.label === "Membership");
    expect(row?.to).toBe("/admin/membership");
    expect(row?.children?.map((c) => c.to)).toContain("/admin/members");
  });

  it("coaches don't get the membership business", () => {
    expect(buildInternalNav("coach").some((i) => i.group === "Membership")).toBe(false);
  });

  it("no mode switch, no way to get stuck in membership", () => {
    expect(existsSync("src/lib/dashboard-mode.ts")).toBe(false);
    const nav = read("src/lib/internal-nav.ts");
    expect(nav).not.toContain("MEMBERSHIP_OVERLAY");
    expect(nav).not.toContain("buildMembershipAdminNav");
    expect(nav).not.toContain("Back to Coaching");
    const topBar = read("src/components/admin-top-bar.tsx");
    expect(topBar).not.toContain("useDashboardMode");
    expect(topBar).not.toContain("setPovPersona");
  });
});
