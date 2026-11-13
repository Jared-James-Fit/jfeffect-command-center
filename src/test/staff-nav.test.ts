import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { STAFF_BAR, buildInternalNav, buildInternalNavCollapsed } from "@/lib/internal-nav";

const read = (p: string) => readFileSync(p, "utf8");

describe("one staff app, laid out like the client app", () => {
  it("every staff phone bar is Dashboard, Clients, Crew (centre), Messages, Tasks: plain tabs", () => {
    expect(STAFF_BAR.map((i) => i.label)).toEqual(["Dashboard", "Clients", "Crew", "Messages", "Tasks"]);
    expect(STAFF_BAR.map((i) => i.to)).toEqual(["/admin", "/admin/clients", "/admin/community", "/admin/messages", "/admin/tasks"]);
    expect(STAFF_BAR.every((i) => !i.children && !!i.icon)).toBe(true);
  });

  it("Crew rings and counts new posts for staff, like the client button", () => {
    const badges = read("src/hooks/use-client-nav-badges.ts");
    expect(badges).toContain("useCommunityActivity(enabled || (adminEnabled && !viewOnly))");
    expect(badges).toContain('map["/admin/community"] = { count: community.unseen };');
  });

  it("More opens from a big header button for staff, clients and members (members use the portal)", () => {
    expect(read("src/routes/_authenticated/admin/route.tsx")).toContain("title={title} moreInHeader>");
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain('title="JF Effect" moreInHeader simpleHeader ownTopBarOn=');
    // on Crew (its own bar) More is your profile's ☰
    expect(read("src/components/community/community-screen.tsx")).toContain("onClick={openAppMore} data-crew-more");
    expect(read("src/routes/_authenticated/portal/route.tsx")).toContain("items={isSelfServe ? selfServeNav : clientNav}");
    expect(read("src/components/app-shell.tsx")).toContain('className="h-10 w-10 shrink-0 rounded-full px-0">');
  });

  it("Tasks lights up on the tasks page it opens", () => {
    expect(read("src/components/app-shell.tsx")).toContain('item.to === "/admin/tasks"\n          ? { path: "/admin/content", tab: "tasks" }');
  });

  it("bars saved before the reset start fresh", () => {
    expect(read("src/lib/floating-bar.ts")).toContain('const KEY = "jf-floating-bar-v4";');
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

describe("one menu row per page", () => {
  const listed = <C extends { searchOnly?: boolean }>(i: { children?: C[] }): C[] => (i.children ?? []).filter((c) => !c.searchOnly);

  it("admins and coaches get short menus: a row per page, a flyout only where a row has pages of its own", () => {
    expect(buildInternalNavCollapsed("admin").map((i) => i.label)).toEqual([
      "Dashboard", "Tasks", "Messages", "Clients", "Crew", "Calendar", "Coaching", "Sales", "Membership", "Team", "Settings",
    ]);
    expect(buildInternalNavCollapsed("coach").map((i) => i.label)).toEqual([
      "Dashboard", "Tasks", "Messages", "Clients", "Crew", "Calendar", "Coaching", "Settings",
    ]);
    const admin = buildInternalNavCollapsed("admin");
    const row = (label: string) => admin.find((i) => i.label === label)!;
    // tabs of one page are that page's row, not entries of their own
    for (const label of ["Messages", "Calendar", "Team"]) expect(listed(row(label))).toEqual([]);
    expect(listed(row("Crew")).map((c) => c.to)).toEqual(["/admin/community", "/admin/league", "/admin/athlete-records", "/admin/challenges"]);
    expect(listed(row("Coaching")).map((c) => c.to)).toEqual(["/admin/coaching", "/admin/forms", "/admin/programming"]);
    // Athlete Records sits under the League, not at the top
    expect(admin.some((i) => i.to === "/admin/athlete-records")).toBe(false);
  });

  it("an old address of a tab is search-only: findable, never listed", () => {
    const admin = buildInternalNavCollapsed("admin");
    const messages = admin.find((i) => i.label === "Messages")!;
    expect(messages.children?.map((c) => [c.to, !!c.searchOnly])).toEqual([
      ["/admin/communication", true], ["/admin/support-alerts", true], ["/admin/leads", true],
    ]);
    const all = admin.flatMap((i) => [i, ...(i.children ?? [])]);
    const listedTos = admin.flatMap((i) => [i.to, ...listed(i).map((c) => (c as { to: string }).to)]);
    // "Coming soon" stubs are in no menu, search or palette
    const palette = read("src/lib/admin-route-registry.ts");
    for (const stub of ["/admin/content-ideas", "/admin/testimonials", "/admin/membership/challenges", "/admin/membership/welcome-messages", "/admin/membership/promo-tools"]) {
      expect(all.some((i) => i.to === stub)).toBe(false);
      expect(listedTos).not.toContain(stub);
      expect(palette).not.toContain(`to: "${stub}"`);
    }
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("return (item.children ?? []).filter((c) => !c.searchOnly);");
    expect(shell).toContain("const hasFlyout = listedChildren(item).length > 0;");
  });

  it("a coach keeps every page they had: in their menu or found by More's search", () => {
    const coach = buildInternalNavCollapsed("coach");
    const reachable = new Set(coach.flatMap((i) => [i.to, ...(i.children ?? []).map((c) => c.to)]));
    for (const to of [
      "/admin", "/admin/tasks", "/admin/support-alerts", "/admin/messages", "/admin/communication",
      "/admin/community", "/admin/league", "/admin/athlete-records", "/admin/clients", "/admin/check-in-reviews",
      "/admin/training-intelligence", "/admin/coaching", "/admin/agreements",
      "/admin/programming", "/admin/program-library", "/admin/exercises", "/admin/cardio-targets", "/admin/warmup-protocols",
      "/admin/recipes", "/admin/native-forms", "/admin/forms", "/admin/fillout-submissions", "/admin/calendar",
      "/admin/pt-calendar", "/admin/google-calendar", "/admin/sales/coaching-applications",
      "/admin/settings", "/admin/account", "/admin/faqs", "/admin/automations", "/admin/floating-bar", "/admin/voice",
    ]) {
      expect(reachable.has(to), to).toBe(true);
    }
  });

  it("More lists what isn't already a bar tab (search still finds those), and light / dark is the bar's switch", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("const barPages = useMemo(() => new Set(barItems.map((i) => i.to)), [barItems]);");
    expect(shell).toContain("onBar={barPages}");
    expect(shell).toContain(".map((g) => ({ ...g, items: g.items.filter((i) => !(onBar?.has(i.to) && listedChildren(i).length === 0)) }))");
  });

  it("desktop has one search, one Sign out (the avatar menu) and no Crew pill in page headers", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(read("src/components/admin-top-bar.tsx")).not.toContain("open-command-palette");
    expect(shell).not.toContain('aria-label="Sign out"');
    expect(shell).not.toContain("CommunityNavButton");
    expect(shell).not.toContain("amber-400");
  });

  it("the Coaching hub opens on Training Intel; a named tab still wins", () => {
    const page = read("src/routes/_authenticated/admin/coaching.tsx");
    expect(page).toContain('const DEFAULT_TAB: TabKey = "training-intel";');
    expect(page).toContain('return { tab: t === "check-ins" ? "check-ins" : isTab(t) ? t : DEFAULT_TAB, open };');
    expect(read("src/lib/internal-nav.ts")).not.toContain("Legacy Hubs");
  });

  it("the old check-in queue is gone from the hub, and its links open Forms", () => {
    const page = read("src/routes/_authenticated/admin/coaching.tsx");
    expect(page).not.toContain("Check-ins (old)");
    expect(page).not.toContain("AdminCheckInReviews");
    expect(page).toContain('if (search.tab === "check-ins") throw redirect({ to: "/admin/forms", search: { tab: "submissions" } as any, replace: true });');
  });
});
