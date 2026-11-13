import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Home } from "lucide-react";
import { MORE_BAR_TO, resolveVisibleBarItems } from "@/lib/floating-bar";
import { clientBottomNav } from "@/lib/admin-nav";
import type { NavItem } from "@/components/app-shell";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const shell = read("src/components/app-shell.tsx");
const portal = read("src/routes/_authenticated/portal/route.tsx");
const entry = read("src/components/community/community-entry.tsx");
const tile = read("src/components/community/post-tile.tsx");
const profile = read("src/components/community/profile-view.tsx");
const screen = read("src/components/community/community-screen.tsx");
const item = (to: string): NavItem => ({ to, label: to, icon: Home });

describe("the tab bar: TikTok's / Instagram's", () => {
  it("five equal tabs, Crew in the middle", () => {
    const visible = resolveVisibleBarItems(clientBottomNav, { more: false });
    expect(visible.map((i) => i.label)).toEqual(["Home", "Workouts", "Crew", "Messages", "Nutrition"]);
    expect(visible.some((i) => i.to === MORE_BAR_TO)).toBe(false);
    // no raised disc, no satellite: Crew is a tab like the others
    expect(shell).not.toContain("data-featured-tab");
    expect(shell).not.toContain("data-featured-shortcut");
    expect(read("src/lib/admin-nav.ts")).not.toContain("featured: true");
    expect(read("src/lib/internal-nav.ts")).not.toContain("featured: true");
  });

  it("a bar without a header More keeps More as its last slot", () => {
    const visible = resolveVisibleBarItems(["/a", "/b", "/c", "/d", "/e"].map(item));
    expect(visible).toHaveLength(5);
    expect(visible[4].to).toBe(MORE_BAR_TO);
  });

  it("the client top bar: search and light / dark on the left, More on the right (the account at the top of More; light / dark only in the bar)", () => {
    expect(portal).toContain('title="JF Effect" moreInHeader simpleHeader ownTopBarOn={CREW_OWN_BAR}>');
    // Crew draws its own bar, so the shell's steps aside there (one bar, not two) and its ☰ opens More by event
    expect(portal).toContain('const CREW_OWN_BAR = ["/portal/community"] as const;');
    expect(shell).toContain("const pageBar = pageOwnsTopBar(pathname, ownTopBarOn);");
    expect(shell).toContain("{!pageBar && <header");
    expect(shell).toContain("window.addEventListener(OPEN_MORE_EVENT, open);");
    // search and the light / dark switch are in every shell bar, clients included; a client's search is More's
    expect(shell).not.toContain("{!simpleHeader && <ThemeToggle");
    expect(shell).toContain("if (isStaffRole) return setPaletteOpen(true);");
    expect(shell).toContain("focusSearch={moreSearch}");
    expect(shell).toContain("searchRef.current.focus();");
    expect(shell).toContain("{!simpleHeader && (");
    expect(shell).not.toContain('<span className="text-[15px] font-semibold">Appearance</span>');
    expect(shell).toContain("Photo, email, sign out");
    expect(shell).toContain('<Button variant="ghost" aria-label="More" onClick={() => setMoreOpen(true)} className="h-10 w-10 shrink-0 rounded-full px-0">');
    // the JF Effect mark sits in the middle of the bar, Crew's look, on every shell page
    // fixed at the top edge so iOS never blurs it (shell-bar-fixed.test.ts)
    expect(shell).toContain('className="shell-bar fixed inset-x-0 top-[var(--app-chrome-top)] z-40 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border/60 bg-background px-2 md:hidden"');
    expect(shell).toContain("<ShellBrand title={title} compact={!simpleHeader} />");
    // the bar is Crew's height, so the refresh spinner opens at the same spot on every tab
    expect(shell).toContain('top="calc(var(--app-chrome-top) + var(--app-safe-top) + 3rem + 5px)"');
    expect(shell).toContain("resolveVisibleBarItems(bottomItems, { more: !moreInHeader })");
  });

  it("edge to edge and flush with the bottom: a 50px row over the home indicator's room, opaque, a hairline on top", () => {
    expect(shell).toContain('"fixed inset-x-0 bottom-0 z-50 border-t md:hidden"');
    // the home indicator's room: env(safe-area-inset-bottom), less a short layout's band (styles.css)
    expect(shell).toContain('style={{ paddingBottom: "var(--mobile-bar-pad)" }}');
    expect(read("src/styles.css")).toContain("--mobile-bar-pad: max(0px, calc(env(safe-area-inset-bottom, 0px) - var(--ios-bottom-shift, 0px)));");
    expect(shell).toContain('<div className={cn("mx-auto grid h-[var(--mobile-bar-h)] max-w-[560px]"');
    const css = read("src/styles.css");
    // (less the iPhone home-screen app's short-layout gap, ios-bottom-gap.test.ts; 0 everywhere else)
    expect(css).toContain("  --mobile-bar-h: 50px;\n  --mobile-bar-top: calc(var(--mobile-bar-h) + var(--mobile-bar-pad));");
    // pages clear exactly the bar (the chats end at its top)
    expect(css).toContain("  :root { --bottom-nav-clearance: var(--mobile-bar-top); }");
    // no floating card: no side gutter, rounding, shadow, blur or fade under it
    const bar = shell.slice(shell.indexOf("export function MobileBottomBar"), shell.indexOf("// Every bar slot shares one box"));
    for (const gone of ["inset-x-4", "rounded-2xl", "shadow-", "backdrop-blur", "bg-gradient-to-t"]) expect(bar).not.toContain(gone);
    // floating buttons (page "+", Back to Today) still stack from the bar's real top edge
    expect(read("src/components/tasks/quick-notes.tsx")).toContain('"calc(var(--mobile-bar-top) + 14px)"');
    expect(read("src/components/return-to-dashboard.tsx")).toContain("bottom-[calc(var(--mobile-bar-top)+14px)]");
    // over Crew's paged feed it's black, like TikTok's over its videos
    expect(bar).toContain('overFeed ? "dark border-white/10 bg-black text-foreground" : "border-border/70 bg-background"');
  });

  it("each tab: a 24px icon (heavier when it's the one you're on) over a 10px label on one line; no underline", () => {
    expect(shell).toContain('const barIcon = (active?: boolean) => cn("h-6 w-6", active ? "stroke-[2.3]" : "stroke-[1.8]");');
    expect(shell).toContain('cn("w-full truncate text-center tracking-tight", dense ? "text-[10px]" : "text-[10.5px]", "leading-3", active ? "font-semibold" : "font-medium")');
    // the whole column is the tap, the icon dips on press
    expect(shell).toContain('"group/slot relative flex h-full min-w-0 flex-col items-center justify-center gap-[3px]');
    expect(shell).toContain("group-active/slot:scale-90");
    expect(shell).not.toContain("BarActiveMark");
    // the tab you're on is the brand red (the design system's one accent); counts read out
    expect(shell).toContain('className={cn(BAR_SLOT, active ? "text-primary" : "text-muted-foreground hover:text-foreground")}');
    expect(shell).toContain("aria-label={badge?.count ? `${item.label}, ${badge.count} new` : undefined}");
    // --primary is oklch; hsl(var(--primary)) is an invalid colour
    expect(shell).not.toContain("hsl(var(--primary)");
  });

  it("holds still while scrolling: only pinned to the visual viewport when zoomed or the keyboard is up", () => {
    // Safari's toolbar show/hide and iOS sub-pixel insets move the visual viewport mid-scroll
    expect(shell).toContain("const dy = Math.round(window.innerHeight - (vv.height + vv.offsetTop));");
    expect(shell).toContain("(zoomed || keyboard) && (dy > 0 || dx !== 0)");
    expect(shell).not.toContain("dy > 0 || dx !== 0 || scale !== 1");
  });

  it("Rankings is the trophy in Crew's bar, one tap from any post; the coach's League stays the bubble in his stories", () => {
    const rail = read("src/components/community/crew-stories.tsx");
    expect(rail).toContain("data-story-rankings");
    expect(rail).toContain("if (!groups.length && !mine && !addStory && !rankings) return null;");
    expect(screen).toContain('<BarButton label="Rankings" onClick={openRankings} data-crew-rankings>');
    expect(screen).toContain('const rankings = hideTabs ? { label: "League", onOpen: () => void navigate({ to: "/admin/league" }) } : undefined;');
    expect(screen).toContain('void navigate({ to: ".", hash: "rankings", replace: true, resetScroll: false });');
    expect(screen.match(/rankings=\{rankings\}/g)?.length).toBe(2);
    // the Crew screen follows the hash, so a link to #rankings still opens it
    expect(screen).toContain('if (rankingsFromHash(`#${routeHash}`)) setScope({ kind: "rankings" });');
    // ‹ back out of Rankings (or your profile) drops the hash
    expect(screen).toContain('if (k === "feed" && /^#(rankings|league|you)/.test(window.location.hash)) void navigate({ to: ".", hash: "", replace: true, resetScroll: false });');
  });

  it("no community for this account: no centre button", () => {
    // (members get their own bar, same rule)
    expect(portal).toContain("const base = isSelfServe ? selfServeBottomNav : clientBottomNav;");
    expect(portal).toContain('community?.enabled === false ? base.filter((i) => i.to !== "/portal/community") : base');
  });

  it("tapping it while you're there goes back to the top of the feed, fresh", () => {
    expect(screen).toContain("if ((e as CustomEvent).detail !== window.location.pathname) return;");
    expect(screen).toContain('window.addEventListener("nav-retap", onRetap);');
  });

  it("the header '🔥 new' nudge is for coaches only now", () => {
    expect(entry).toContain('const eligible = path.startsWith("/admin") && staff;');
  });
});

describe("Home's Crew feed", () => {
  it("newest first (yours too), then a card that opens the feed", () => {
    expect(entry).toContain("const { shown, more } = useMemo(() => homeCrewDeck(");
    // a session that posted itself is in the athlete's story; Home's shelf is posts people made
    expect(entry).not.toContain("HomePulseCard");
    expect(entry).toContain("<SeeMoreCard posts=");
  });

  it("new to you: a dot by the time; training right now: Live", () => {
    expect(entry).toContain('<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff5a4e]" aria-hidden />');
    expect(entry).toContain(">Live</span>");
  });

  it("the profile grid and the shelf draw posts the same way, from a small file (no feed card in the app shell)", () => {
    expect(read("src/components/community/post-grid.tsx")).toContain("<PostTileFace post={p} thumb={thumb} unit={unit} />");
    expect(profile).toContain("<PostGrid");
    expect(entry).toContain('import { PostTileFace, postThumbPath } from "@/components/community/post-tile";');
    expect(tile).not.toMatch(/from "@\/components\/community\/post-card"/);
    expect(entry).not.toMatch(/from "@\/components\/community\/post-card"/);
  });

  it("a reopened workout without a photo still shows something (its words or the session)", () => {
    expect(tile).toContain("{post.caption || <span");
    expect(tile).not.toContain('<div className="h-full w-full bg-muted" />');
  });
});

describe("Home order: what you do today, then what you check", () => {
  const home = read("src/routes/_authenticated/portal/index.tsx");
  const at = (s: string) => home.indexOf(s);
  it("two sections: Today (schedule), Progress (weigh-in, water, progress, one card each); Rankings and the block live elsewhere", () => {
    expect(home).not.toContain("<CommunityHomeStrip");
    expect(home).not.toContain("<TrainingBlockCard");
    const order = ['aria-label="Today"', "<UpcomingScheduleCard", 'aria-label="Progress"', "<BodyweightSummaryCard", "<HomeWaterCard", "<ProgressSummaryCard"];
    const idx = order.map(at);
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
});

describe("the recap's one-tap post", () => {
  const footer = read("src/components/community/recap-post.tsx");
  it("posts the workout card to the crew, with a caption right there (optional)", () => {
    expect(footer).toContain('saveCommunityPost({ completionId, caption: caption.trim(), visibility: "community", media: { action: "keep" } })');
    expect(footer).toContain("<CaptionRow value={caption} onOpen={() => setWriting(true)} />");
    expect(footer).toContain("<CaptionSheet open={writing}");
    // opening the camera instead keeps what they wrote
    expect(footer).toContain("onPhoto={() => onStudio(caption)}");
    expect(read("src/components/community/use-workout-studio.ts")).toContain("caption: existing ? existing.caption : draftCaption,");
  });
  it("says what it earns only when it really earns (DB rule: recent workout, 1 a day, 2 a week)", () => {
    expect(footer).toContain('const earn = hint?.tone === "earn" && points ? points.points : 0;');
    expect(footer).toContain("{earn > 0 && <span");
  });
  it("an earlier finish post: says where it is, Done takes over; a lock-in never counts as one", () => {
    expect(footer).toContain('"It\'s in the crew\'s feed"');
    expect(footer).toContain('existing?.visibility === "coach"');
    expect(footer).not.toContain("locked_in_at");
    expect(footer).toContain('useMyPostForCompletion(completionId, true, "lockin")');
  });
});

describe("the recap's composer, with the automatic story post", () => {
  const footer = read("src/components/community/recap-post.tsx");
  const summary = read("src/components/workout-submission-summary.tsx");
  it("shows what the crew will see first: the same headline win as the post, from the same stats", () => {
    expect(footer).toContain("useCompletionPreview(completionId)");
    expect(footer).toContain("pickWorkoutWin(stats, unit)");
    // weights hidden on their posts stay hidden on the preview
    expect(footer).toContain("const detail = win?.detail && !hideLoads ? win.detail : null;");
    expect(summary).toContain("unit={displayUnit}");
  });
  it("the automatic post isn't 'shared': Share to Crew upgrades that same post, Hide it takes it out of Crew", () => {
    expect(footer).toContain("const unshared = !justPosted && (!existing || auto || hidden);");
    expect(footer).toContain("On your story for 24 hours");
    expect(footer).toContain('saveCommunityPost({ completionId, caption: "", visibility: "private", media: { action: "keep" } })');
    // the hide is only a choice they make: never on its own
    expect(footer).toContain("onClick={() => void hide()}");
    expect(footer).not.toMatch(/useEffect\([^)]*hide\(\)/);
  });
  it("one save at a time, and a failed share keeps the caption to try again", () => {
    expect(footer).toContain("if (busy.current) return;");
    const fail = footer.slice(footer.indexOf("} catch (e: any) {"), footer.indexOf("} finally {"));
    expect(fail).not.toContain("setCaption");
  });
  it("tells them the review stays with the coach", () => {
    expect(footer).toContain("Your review and coach note stay private.");
    expect(footer).not.toMatch(/feedback|pain|session_rpe|pl_workout_feedback/);
  });
});

describe("crew feed shelf swipe", () => {
  it("snaps one card at a time, centred", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/community/community-entry.tsx", "utf8");
    expect(src).toMatch(/snap-x snap-mandatory[^"]*px-\[9%\]/);
    expect(src).toMatch(/w-\[82%\] shrink-0 snap-center snap-always/);
    expect(src).not.toMatch(/snap-start/);
  });
});
