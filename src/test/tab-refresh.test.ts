import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PULL_RECENT_MS, PULL_TRIGGER, RECENT_MS, needsRefresh, pullProgress } from "@/lib/tab-refresh";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

describe("tabs: re-tap goes to the top and refreshes, pull down refreshes (Instagram's)", () => {
  it("a refresh reloads only what's on screen and old enough, and waits for anything already loading", () => {
    const now = 1_000_000;
    const q = (age: number | null, fetchStatus = "idle", status = "success") => ({ dataUpdatedAt: age == null ? 0 : now - age, fetchStatus, status });
    expect(needsRefresh(q(RECENT_MS + 1), now)).toBe(true);
    // a second tap right after never loads it twice
    expect(needsRefresh(q(3_000), now)).toBe(false);
    // a pull takes anything but what just loaded
    expect(needsRefresh(q(3_000), now, PULL_RECENT_MS)).toBe(true);
    expect(needsRefresh(q(500), now, PULL_RECENT_MS)).toBe(false);
    // already loading (Crew's own retap refresh): the spinner waits for it
    expect(needsRefresh(q(100, "fetching"), now)).toBe(true);
    // never loaded: the page's own loading state covers it
    expect(needsRefresh(q(null, "idle", "pending"), now)).toBe(false);
  });

  it("the pull fills up to the mark, then refreshes on letting go", () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(-20)).toBe(0);
    expect(pullProgress(PULL_TRIGGER / 2)).toBe(0.5);
    expect(pullProgress(PULL_TRIGGER * 3)).toBe(1);
    const tr = read("src/components/tab-refresh.tsx");
    expect(tr).toContain("const go = pullRef.current >= 1;");
    // sideways (carousels, swipe back) or scrolling the page down is never a pull
    expect(tr).toContain("(Math.abs(dx) > SLOP && Math.abs(dx) > Math.abs(dy)) || dy < -4 || window.scrollY > 0");
    // joins what's already loading instead of restarting it, and never spins forever
    expect(tr).toContain("{ cancelRefetch: false }");
    // never mid-save (a moved workout, a logged set), and never a gesture something else took (a calendar drag)
    expect(tr).toContain("if (qc.isMutating() > 0) {");
    expect(tr).toContain("if (e.defaultPrevented) {");
    expect(tr).toContain("sleep(8_000)");
    // makes room under the bar while it loads, then closes back up
    expect(tr).toContain('height: phase === "refreshing" ? GAP : 0');
    const lib = read("src/lib/tab-refresh.ts");
    expect(lib).toContain('if (el.closest(\'[role="dialog"],[role="alertdialog"],[data-no-pull-refresh],input,textarea,select,[contenteditable="true"]\')) return false;');
  });

  it("the bar: tapping the tab you're on goes back to the top (and any list that scrolls on its own) and refreshes", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("scrollPageToTop();");
    expect(shell).toContain('window.dispatchEvent(new CustomEvent("nav-retap", { detail: to }));');
    expect(shell).toContain("requestTabRefresh();");
    // the router stays out of a plain re-tap, so its own scroll reset never cuts the smooth trip short
    expect(shell).toContain("if (!hash) e.preventDefault();");
    // pull only on a tab's own page; the refresher sits first in the page, under the top bar
    expect(shell).toContain("pull={barItems.some((i) => i.to === pathname)}");
    // Crew's trophy, tapped on Rankings, does the same
    expect(shell).toContain("if (onRetap) onRetap(shortcut.to);");
  });

  it("one spinner everywhere: Instagram's ticks, also at the end of the feed while more loads", () => {
    expect(read("src/components/activity-spinner.tsx")).toContain("const TICKS = 8;");
    expect(read("src/styles.css")).toContain(".activity-spin { animation: activity-spin 0.8s steps(8) infinite;");
    expect(read("src/components/community/community-screen.tsx")).toContain('aria-label="Loading more posts" data-feed-more');
  });
});
