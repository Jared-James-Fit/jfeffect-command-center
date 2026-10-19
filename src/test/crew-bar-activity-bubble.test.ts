import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACTIVITY_PREVIEW_STATE, activityBubbleCounts, activityBubbleLabel, bubbleCount, type ActivityItem } from "@/lib/crew-activity";
import { pageOwnsTopBar } from "@/lib/shell-events";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const line = (kind: ActivityItem["kind"], unread: boolean, fresh?: number) => ({ kind, unread, fresh });

describe("the heart's bubble: what's new since it last showed", () => {
  it("counts only unread lines, only their fresh notifications, by kind", () => {
    const c = activityBubbleCounts([
      line("reaction", true, 3),
      line("comment_like", true, 1),
      line("comment", true, 1),
      line("reply", true, 2),
      line("follow", true, 1),
      line("follow_request", true, 1),
      // read already, or nothing new since the last bubble: not in it
      line("reaction", false, 4),
      line("comment", true, 0),
      line("follow", true),
      // someone reposted your post: its own count (🔁), never a follow
      line("repost", true, 2),
    ]);
    expect(c).toEqual({ likes: 4, comments: 3, reposts: 2, follows: 2, total: 11 });
    expect(activityBubbleCounts(undefined).total).toBe(0);
    expect(activityBubbleCounts([line("reaction", true, 0)]).total).toBe(0);
  });

  it("reads out what's new, and keeps big numbers short", () => {
    expect(activityBubbleLabel({ likes: 3, comments: 1, reposts: 0, follows: 0, total: 4 })).toBe("3 new likes, 1 new comment");
    expect(activityBubbleLabel({ likes: 0, comments: 0, reposts: 0, follows: 1, total: 1 })).toBe("1 new follower");
    expect(activityBubbleLabel({ likes: 0, comments: 0, reposts: 1, follows: 0, total: 1 })).toBe("1 new repost");
    expect(bubbleCount(7)).toBe("7");
    expect(bubbleCount(120)).toBe("99+");
  });

  it("knows what's fresh on the server, from the list the heart already loads (no extra request)", () => {
    const sql = read("supabase/migrations/20261206090000_crew_activity_preview.sql");
    expect(ACTIVITY_PREVIEW_STATE).toEqual({ kind: "crew_preview", source_id: "activity" });
    expect(sql).toContain("s.user_id = auth.uid() AND s.kind = 'crew_preview' AND s.source_id = 'activity'");
    // after both the last bubble and the line's own read time
    expect(sql).toContain("greatest(coalesce(v_previewed, '-infinity'::timestamptz), coalesce(rs.read_at, '-infinity'::timestamptz))");
    expect(sql).toContain("'fresh', coalesce(f.fresh, 0)");
    const q = read("src/lib/crew-activity.queries.ts");
    // showing it is noted with the existing mark-read (every phone), and "fresh" drops here without a refetch
    expect(q).toContain('void (supabase.rpc as any)("notif_mark_read", { items: [ACTIVITY_PREVIEW_STATE] });');
    expect(q).toContain("prev?.map((i) => (i.fresh ? { ...i, fresh: 0 } : i))");
    // coming back to the app checks again
    expect(q).toContain("refetchOnWindowFocus: true,");
  });

  it("rises once per batch, from a real fetch, folds on any scroll, tap, key or app switch, and leaves the dot", () => {
    const heart = read("src/components/community/activity-heart.tsx");
    // never from the phone's saved copy (another phone may have shown it already)
    expect(heart).toContain("const ready = canPreview && q.isFetchedAfterMount && counts.total > 0 && signature !== lastShown;");
    expect(heart).toContain("markPreviewed();");
    // waits while a sheet or dialog is up, or the heart is off screen
    expect(heart).toContain("somethingOnTop()");
    expect(heart).toContain("heart.bottom > 0 && heart.top < window.innerHeight");
    expect(heart).toContain("const hold = window.setTimeout(() => close(), BUBBLE_HOLD_MS);");
    expect(heart).toContain('window.addEventListener("scroll", onScroll, { passive: true });');
    expect(heart).toContain('window.addEventListener("pointerdown", onPointer, true);');
    expect(heart).toContain('document.addEventListener("visibilitychange", onHidden);');
    // the dot lands as the fold finishes, and stays until Activity is read
    expect(heart).toContain('{unread && phase === "idle" && (');
    // it never moves anything: placed over the page, under the heart
    expect(heart).toContain('className="absolute right-[-6px] top-[calc(100%+4px)] z-50 w-max"');
    const css = read("src/styles.css");
    expect(css).toContain(".activity-bubble[data-state=\"open\"] { animation: activity-bubble-in 440ms");
    expect(css).toContain(".activity-bubble[data-state=\"open\"] { animation: activity-bubble-calm-in 160ms linear both; }");
  });
});

describe("Crew's one bar", () => {
  const screen = read("src/components/community/community-screen.tsx");
  const bar = read("src/components/community/crew-header.tsx");

  it("is + and search · JF Effect · heart and you, with no second row of controls", () => {
    expect(screen).toContain('<CrewBar\n      label="Crew"');
    expect(screen).toContain('<BarButton label="Create a post" onClick={begin} data-crew-create>');
    expect(screen).toContain("<CrewBrand");
    expect(screen).not.toContain('aria-label="Crew view"');
    expect(screen).not.toContain('aria-label="Show posts from"');
    expect(bar).toContain('{following ? "Following" : "JF Effect"}');
  });

  it("slides away reading down, back on any scroll up, fixed on phones with its room held", () => {
    expect(bar).toContain("} else if (dy > 8) {");
    expect(bar).toContain("} else if (dy < -8) {");
    expect(bar).toContain('className="crew-bar fixed inset-x-0 top-[var(--app-chrome-top)] z-40');
    expect(bar).toContain("md:relative md:inset-auto");
    expect(bar).toContain("calc(var(--app-safe-top) + ${CREW_BAR_HEIGHT})");
    expect(screen).toContain('const barHidden = useBarHidden(ownBar && scope.kind === "feed");');
  });

  it("back from a profile, Rankings or Activity lands where you were in the feed", () => {
    expect(screen).toContain('if (k === "feed") restoreY.current = feedY.current;');
    expect(screen).toContain('if (scopeRef.current.kind === "feed") feedY.current = window.scrollY;');
    expect(screen).toContain("requestAnimationFrame(() => requestAnimationFrame(() => window.scrollTo(0, y)));");
  });

  it("the shell's own bar steps aside only on pages that draw their own", () => {
    expect(pageOwnsTopBar("/portal/community", ["/portal/community"])).toBe(true);
    expect(pageOwnsTopBar("/portal/community/", ["/portal/community"])).toBe(true);
    expect(pageOwnsTopBar("/portal", ["/portal/community"])).toBe(false);
    expect(pageOwnsTopBar("/portal/community", undefined)).toBe(false);
    // and the dual-account switch moves under Crew's bar instead of disappearing
    expect(read("src/components/app-shell.tsx")).toContain("{!pageBar && <DualAccountSwitcher />}");
    expect(screen).toContain("{ownBar && <DualAccountSwitcher />}");
  });

  it("View as client: one bar, Crew's own, right under the preview banner (no shell bar on top, no notch gap)", () => {
    // the shell's bar steps aside on Crew for a coach previewing too, and Crew's bar is never drawn inline
    const portal = read("src/routes/_authenticated/portal/route.tsx");
    expect(portal).toContain("ownTopBarOn={CREW_OWN_BAR}>");
    expect(portal).not.toContain("isImpersonating ? undefined : CREW_OWN_BAR");
    expect(bar).not.toContain("inline?: boolean");
    expect(screen).not.toContain("barInline");
    // the banner holds the notch, so bars start under it with none of their own
    const banner = read("src/components/client-pov-banner.tsx");
    expect(banner).toContain('root.style.setProperty("--pov-banner-h", `${el.getBoundingClientRect().height}px`);');
    expect(banner).toContain('root.setAttribute("data-pov-banner-on", "");');
    const css = read("src/styles.css");
    expect(css).toContain(":root { --app-safe-top: env(safe-area-inset-top, 0px); --app-chrome-top: 0px; }");
    expect(css).toContain("html[data-pov-banner-on] { --app-safe-top: 0px; --app-chrome-top: var(--pov-banner-h, 0px); }");
    // sliding away reading down clears the banner too
    expect(css).toContain(".crew-bar[data-hidden] { transform: translateY(calc(-100% - var(--app-chrome-top))); }");
    // every other page's shell bar: no second notch under the banner
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain('style={{ paddingTop: "var(--app-safe-top)" }}\n          data-shell-bar');
    expect(shell).toContain('top="calc(var(--app-chrome-top) + var(--app-safe-top) + 3rem + 5px)"');
  });
});
