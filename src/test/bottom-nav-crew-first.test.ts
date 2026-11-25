import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientBottomNav, selfServeBottomNav } from "@/lib/admin-nav";
import { FINANCE_BAR, STAFF_BAR } from "@/lib/internal-nav";
import { crewHome, launchTarget } from "@/lib/launch-home";
import { resolveVisibleBarItems } from "@/lib/floating-bar";
import {
  TAB_PLACE_TTL_MS,
  forgetPlaces,
  keepPlace,
  placeFor,
  placeKeepable,
  restorePlace,
} from "@/lib/tab-places";

const read = (p: string) => readFileSync(p, "utf8");

describe("the bottom bar opens on Crew, far left (Nov 21 2026)", () => {
  it("clients: Crew, Home, Workouts, Messages, Nutrition", () => {
    expect(resolveVisibleBarItems(clientBottomNav, { more: false }).map((i) => [i.label, i.to])).toEqual([
      ["Crew", "/portal/community"],
      ["Home", "/portal"],
      ["Workouts", "/portal/workouts"],
      ["Messages", "/portal/messages"],
      ["Nutrition", "/portal/nutrition-targets"],
    ]);
  });

  it("members: the same tabs; their Messages holds JF Effect Support", () => {
    expect(selfServeBottomNav.map((i) => i.label)).toEqual(["Crew", "Home", "Workouts", "Messages", "Nutrition"]);
  });

  it("coaches and admins: Crew, Dashboard, Clients, Messages, Tasks", () => {
    expect(resolveVisibleBarItems(STAFF_BAR, { more: false }).map((i) => [i.label, i.to])).toEqual([
      ["Crew", "/admin/community"],
      ["Dashboard", "/admin"],
      ["Clients", "/admin/clients"],
      ["Messages", "/admin/messages"],
      ["Tasks", "/admin/tasks"],
    ]);
  });

  it("the finance login keeps its home first (where it opens) and the same tabs", () => {
    expect(FINANCE_BAR.map((i) => i.label)).toEqual(["Home", "Money", "Crew", "Clients", "Tasks"]);
  });

  it("every destination is still a tab, so every badge (keyed by its page) still shows", () => {
    // nothing was added or dropped: only the order moved
    expect(clientBottomNav.map((i) => i.to).sort()).toEqual(
      ["/portal", "/portal/community", "/portal/messages", "/portal/nutrition-targets", "/portal/workouts"],
    );
    expect(STAFF_BAR.map((i) => i.to).sort()).toEqual(["/admin", "/admin/clients", "/admin/community", "/admin/messages", "/admin/tasks"]);
    const badges = read("src/hooks/use-client-nav-badges.ts");
    for (const to of ["/portal/community", "/portal/messages", "/portal/workouts", "/portal/nutrition-targets"]) expect(badges).toContain(`result["${to}"]`);
    expect(badges).toContain('map["/admin/community"]');
    // Workouts keeps lighting on programs and plans; members' too
    expect(clientBottomNav.find((i) => i.label === "Workouts")?.activeOn).toContain("/portal/programs");
    expect(selfServeBottomNav.find((i) => i.label === "Workouts")?.activeOn).toContain("/portal/programs");
  });

  it("a launch still opens Crew for both kinds of account", () => {
    expect(crewHome("client")).toBe("/portal/community");
    expect(crewHome("member")).toBe("/portal/community");
    expect(crewHome("coach")).toBe("/admin/community");
    expect(crewHome("admin")).toBe("/admin/community");
    expect(launchTarget("u1", "client")).toBe("/portal/community");
    expect(launchTarget("u1", "admin")).toBe("/admin/community");
  });

  it("a staff bar saved before the move starts over on the new order", () => {
    expect(read("src/lib/floating-bar.ts")).toContain('const KEY = "jf-floating-bar-v5";');
  });

  it("the middle tab is a tab like the others: no raised button", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).not.toContain("data-featured-tab");
    expect([...clientBottomNav, ...selfServeBottomNav, ...STAFF_BAR].every((i) => !("featured" in i))).toBe(true);
  });
});

describe("each tab keeps your place (tab-places.ts)", () => {
  const tabs = new Set(["/portal/community", "/portal", "/portal/workouts", "/portal/messages", "/portal/nutrition-targets"]);
  afterEach(() => forgetPlaces());

  it("only a tab's own page, with no #view, and on Crew only the feed", () => {
    expect(placeKeepable("/portal", "", tabs, false)).toBe(true);
    expect(placeKeepable("/portal/workouts/abc", "", tabs, false)).toBe(false);
    expect(placeKeepable("/portal/community", "rankings", tabs, true)).toBe(false);
    expect(placeKeepable("/portal/community", "", tabs, false)).toBe(false); // a profile on top of the feed
    expect(placeKeepable("/portal/community", "", tabs, true)).toBe(true);
    expect(placeKeepable("/admin/community", "", new Set(["/admin/community"]), false)).toBe(false);
  });

  it("is kept for the visit, and the top is the top", () => {
    keepPlace("/portal", 820, 1_000);
    expect(placeFor("/portal", 1_000 + TAB_PLACE_TTL_MS - 1)).toBe(820);
    expect(placeFor("/portal", 1_000 + TAB_PLACE_TTL_MS + 1)).toBeNull();
    keepPlace("/portal/workouts", 2, 1_000);
    expect(placeFor("/portal/workouts", 1_000)).toBeNull();
    expect(placeFor("/portal/nutrition-targets", 1_000)).toBeNull();
  });

  it("is only ever in memory: a launch opens at the top of Crew", () => {
    const src = read("src/lib/tab-places.ts");
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  it("puts the page back once it's tall enough, never later than a moment, and never under a moving finger", () => {
    let now = 0;
    let frames: Array<() => void> = [];
    let scrollY = 0;
    let height = 600;
    const listeners = new Map<string, Set<() => void>>();
    const win = {
      get scrollY() { return scrollY; },
      innerHeight: 800,
      requestAnimationFrame: (f: () => void) => { frames.push(f); return frames.length; },
      cancelAnimationFrame: () => { frames = []; },
      scrollTo: ({ top }: { top: number }) => { scrollY = Math.min(top, Math.max(0, height - 800)); },
      addEventListener: (t: string, f: () => void) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f); },
      removeEventListener: (t: string, f: () => void) => { listeners.get(t)?.delete(f); },
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", { scrollingElement: { get scrollHeight() { return height; } }, documentElement: {} });
    vi.stubGlobal("performance", { now: () => now });
    const tick = (ms = 16) => {
      now += ms;
      const run = frames;
      frames = [];
      run.forEach((f) => f());
    };
    try {
      // the page fills in over a few frames, then it's put back exactly
      restorePlace(1200);
      tick();
      expect(scrollY).toBe(0);
      height = 2400;
      tick();
      expect(scrollY).toBe(1200);
      tick(); tick(); tick(); tick();
      expect(frames).toHaveLength(0); // done

      // a page that never gets that tall stays at its top
      scrollY = 0;
      height = 900;
      restorePlace(1200);
      for (let i = 0; i < 60; i++) tick();
      expect(scrollY).toBe(0);
      expect(frames).toHaveLength(0);

      // a finger on the screen: the person is already moving, so it lets go
      height = 600;
      restorePlace(1200);
      tick();
      listeners.get("touchstart")?.forEach((f) => f());
      height = 2400;
      tick();
      expect(scrollY).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("the shell keeps a place on the bar's tap and puts it back only on the tab the bar went to", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("const tabTap = useTabPlaces(barTabs);");
    expect(shell).toContain("tabTap(to);");
    const src = read("src/lib/tab-places.ts");
    // the page on screen, never one still loading
    expect(src).toContain("(r.resolvedLocation ?? r.location).pathname");
    // the tab you're on is the retap's: back to the top
    expect(src).toContain("if (dest === pathname) return;");
  });
});
