import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  clientsLabel, emptyLibraryCopy, inScope, matchesSearch, membershipByTemplate, programLine,
  scopeCounts, toLibraryPrograms, usageByTemplate, visibleScopes, type UsageBlock,
} from "@/lib/programs/library-view";
import { buildInternalNav, buildInternalNavCollapsed } from "@/lib/internal-nav";

const read = (f: string) => readFileSync(f, "utf8");
const TODAY = "2026-11-13";

describe("who's on a program now", () => {
  const block = (over: Partial<UsageBlock>): UsageBlock => ({
    source_template_id: "t1", client_id: "c1", end_date: "2026-12-01", archived: false,
    client_name: "Ashley Example", client_archived: false, client_status: "Active", ...over,
  });

  it("counts a client once, by first name, while their copy is running or ahead", () => {
    const usage = usageByTemplate([
      block({}),
      block({ end_date: "2026-12-20" }), // a later block of the same program
      block({ client_id: "c2", client_name: "Dwayne", end_date: null }), // no end date = running
    ], TODAY);
    expect(usage.get("t1")).toEqual([{ clientId: "c1", name: "Ashley" }, { clientId: "c2", name: "Dwayne" }]);
  });

  it("leaves out finished, archived and deactivated clients' copies", () => {
    const usage = usageByTemplate([
      block({ end_date: "2026-11-01" }),
      block({ client_id: "c2", archived: true }),
      block({ client_id: "c3", client_status: "Deactivated" }),
      block({ client_id: "c4", client_archived: true }),
      block({ source_template_id: null }),
    ], TODAY);
    expect(usage.get("t1")).toBeUndefined();
  });

  it("names up to three, then counts the rest", () => {
    const u = (n: string) => ({ clientId: n, name: n });
    expect(clientsLabel([u("Ashley")])).toBe("Ashley");
    expect(clientsLabel([u("Ashley"), u("Dwayne")])).toBe("Ashley and Dwayne");
    expect(clientsLabel([u("A"), u("B"), u("C")])).toBe("A, B and C");
    expect(clientsLabel([u("A"), u("B"), u("C"), u("D"), u("E")])).toBe("A, B and 3 more");
  });
});

describe("in the membership app", () => {
  const rev = new Map<string, number | null>([["t1", 5], ["t2", 3]]);

  it("is a live listing; a program edited since it was listed reads as behind", () => {
    const m = membershipByTemplate([
      { id: "p1", source_template_id: "t1", status: "Published", membership_status: "live", last_published_version: 5 },
      { id: "p2", source_template_id: "t2", status: "Published", membership_status: "live", last_published_version: 2 },
    ], rev);
    expect(m.get("t1")).toEqual({ kind: "live", planId: "p1" });
    expect(m.get("t2")).toEqual({ kind: "behind", planId: "p2" });
  });

  it("a taken-out (or draft) listing is off, and a live one wins over it", () => {
    const m = membershipByTemplate([
      { id: "old", source_template_id: "t1", status: "Draft", membership_status: "unpublished", last_published_version: 1 },
      { id: "p1", source_template_id: "t1", status: "Published", membership_status: "live", last_published_version: 5 },
      { id: "p9", source_template_id: "t2", status: "Draft", membership_status: "unpublished", last_published_version: 1 },
    ], rev);
    expect(m.get("t1")?.kind).toBe("live");
    expect(m.get("t2")).toEqual({ kind: "off", planId: "p9" });
  });
});

describe("the library list", () => {
  const programs = toLibraryPrograms(
    [
      { id: "a", name: "Apex Glute", updated_at: "2026-11-10", weeks: 4, days_per_week: 4, training_style: "bodybuilding" },
      { id: "b", name: "Meet Prep", updated_at: "2026-11-12", weeks: 4, days_per_week: 4, training_style: "powerlifting" },
      { id: "c", name: "Old one", updated_at: "2026-01-01", archived: true },
    ],
    new Map([["a", [{ clientId: "c1", name: "Ashley" }]]]),
    new Map([["b", { kind: "live", planId: "p" } as const]]),
    (id) => (id === "b" ? { weeks: 12, blocks: 3 } : {}),
  );

  it("reads newest first, in one quiet line each", () => {
    expect(programs.map((p) => p.id)).toEqual(["b", "a", "c"]);
    expect(programs[0].line).toBe("3 blocks · 12 weeks · 4 days a week · Powerlifting");
    expect(programs[1].line).toBe("4 weeks · 4 days a week · Bodybuilding");
    expect(programLine({ training_style: "custom" })).toBe("");
  });

  it("scopes: all leaves archived out, on clients, membership app, archived", () => {
    const ids = (s: Parameters<typeof inScope>[1]) => programs.filter((p) => inScope(p, s)).map((p) => p.id);
    expect(ids("all")).toEqual(["b", "a"]);
    expect(ids("clients")).toEqual(["a"]);
    expect(ids("membership")).toEqual(["b"]);
    expect(ids("archived")).toEqual(["c"]);
    expect(scopeCounts(programs)).toEqual({ all: 2, clients: 1, membership: 1, archived: 1 });
  });

  it("search finds a program by its name, style or a client on it", () => {
    expect(programs.filter((p) => matchesSearch(p, "ashley")).map((p) => p.id)).toEqual(["a"]);
    expect(programs.filter((p) => matchesSearch(p, "power")).map((p) => p.id)).toEqual(["b"]);
    expect(programs.filter((p) => matchesSearch(p, "apex glute")).map((p) => p.id)).toEqual(["a"]);
  });

  it("chips: All always, Membership app for admins even at 0, the rest only when they hold something", () => {
    const counts = { all: 3, clients: 0, membership: 0, archived: 0 };
    expect(visibleScopes(counts, "all", true)).toEqual(["all", "membership"]);
    expect(visibleScopes(counts, "all", false)).toEqual(["all"]);
    expect(visibleScopes({ ...counts, clients: 2, archived: 1 }, "all", true)).toEqual(["all", "clients", "membership", "archived"]);
    expect(visibleScopes(counts, "archived", false)).toEqual(["all", "archived"]);
  });

  it("an empty membership app says how to add one", () => {
    expect(emptyLibraryCopy("membership", false).body).toContain("Add to membership app");
    expect(emptyLibraryCopy("all", true).title).toBe("No programs match");
  });
});

describe("one library, one way in", () => {
  it("the library page drops the team-sharing, tag and submission clutter", () => {
    const lib = read("src/route-pages/_authenticated/admin/program-library.tsx");
    for (const gone of ["ShareProgramSheet", "DestinationBadges", "MembershipLibraryBadge", "WEIGHT_CLASS_TAGS", "/admin/program-submissions", "/admin/program-assign", "Exercise Row"]) {
      expect(lib, gone).not.toContain(gone);
    }
    expect(lib).toContain("<ProgramStatusBadge template={tpl} quiet />");
    // archiving or deleting a listed program takes it out of the membership app first
    expect(lib).toContain("await leaveMembership(); await deleteTemplate(p.id);");
    expect(lib).toContain("await leaveMembership(); await setTemplateArchived(p.id, true);");
  });

  it("Programming has no second List view, and its tabs are neutral", () => {
    const page = read("src/routes/_authenticated/admin/programming.tsx");
    expect(page).not.toContain("AdminProgramBrowser");
    expect(page).not.toContain('active ? "border-primary');
  });

  it("the builder's ⋯ puts a program in the membership app", () => {
    const builder = read("src/route-pages/_authenticated/admin/program-library_.$templateId.tsx");
    expect(builder).toContain("data-builder-membership");
    expect(builder).toContain("<MembershipListingSheet");
  });

  it("every old library address redirects into the one library", () => {
    for (const f of [
      "src/routes/_authenticated/admin/membership.programs.tsx",
      "src/routes/_authenticated/admin/member-plans.index.tsx",
      "src/routes/_authenticated/admin/member-plans.$planId.tsx",
      "src/routes/_authenticated/admin/member-plans.new.tsx",
      "src/routes/_authenticated/admin/membership-library.tsx",
      "src/routes/_authenticated/admin/program-submissions.tsx",
      "src/routes/_authenticated/coach/programs.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("throw redirect(");
      expect(src, f).toContain('to: "/admin/programming"');
    }
  });

  it("the menu has Programs once; the membership library is only a search shortcut", () => {
    const menu = buildInternalNavCollapsed("admin").flatMap((i) => [i, ...(i.children ?? [])]);
    const listed = menu.filter((i) => !i.searchOnly).map((i) => i.to);
    expect(listed).toContain("/admin/programming");
    expect(listed).not.toContain("/admin/member-plans");
    expect(listed).not.toContain("/admin/membership/programs");
    const plans = buildInternalNav("admin").find((i) => i.to === "/admin/member-plans");
    expect(plans?.searchOnly).toBe(true);
  });
});

describe("the fresh-start cleanup", () => {
  const sql = read("supabase/migrations/20270313090000_program_library_fresh_start.sql");
  it("backs up every removed row first and re-checks each is still unused", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.program_library_cleanup_backup");
    expect(sql).toContain("REVOKE ALL ON public.program_library_cleanup_backup FROM anon, authenticated;");
    expect(sql.indexOf("INSERT INTO public.program_library_cleanup_backup")).toBeLessThan(sql.indexOf("DELETE FROM public.pl_templates"));
    expect(sql).toContain("AND dc.completed_at >= now() - interval '42 days'");
    // never a client's own program: only library templates and membership listings
    expect(sql).not.toMatch(/DELETE FROM public\.pl_blocks/);
  });
});
