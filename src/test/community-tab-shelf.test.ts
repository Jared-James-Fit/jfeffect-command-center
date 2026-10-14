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

describe("client tab bar: Crew in the centre", () => {
  it("five destinations, Crew (feed + rankings) raised in the middle", () => {
    const visible = resolveVisibleBarItems(clientBottomNav, { more: false });
    expect(visible.map((i) => i.label)).toEqual(["Home", "Workouts", "Crew", "Nutrition", "Messages"]);
    expect(visible[2].featured).toBe(true);
    expect(visible.some((i) => i.to === MORE_BAR_TO)).toBe(false);
  });

  it("a bar without a header More keeps More as its last slot", () => {
    const visible = resolveVisibleBarItems(["/a", "/b", "/c", "/d", "/e"].map(item));
    expect(visible).toHaveLength(5);
    expect(visible[4].to).toBe(MORE_BAR_TO);
  });

  it("one control in the client top bar: More, with the account and appearance at its top", () => {
    expect(portal).toContain('title="JF Effect" moreInHeader simpleHeader>');
    expect(shell).toContain('{!simpleHeader && <ThemeToggle className="mr-0.5" />}');
    expect(shell).toContain("{!simpleHeader && (");
    expect(shell).toContain('<span className="text-[15px] font-semibold">Appearance</span>');
    expect(shell).toContain('<Button variant="outline" aria-label="More" onClick={() => setMoreOpen(true)} className="h-10 w-10 shrink-0 rounded-xl px-0">');
    expect(shell).toContain("resolveVisibleBarItems(bottomItems, { more: !moreInHeader })");
  });

  it("the raised button isn't clipped, and rings + counts when there's something new", () => {
    expect(shell).toContain('raised ? "overflow-visible" : "overflow-hidden"');
    expect(shell).toContain('badge?.count ? "bg-[linear-gradient(135deg,#ffb054,#ef3340)]" : "bg-card"');
  });

  it("the centre button is only brand-red on its own page, and every label sits on one line", () => {
    // a Cleo-style disc: brand gradient when you're on Crew, a quiet raised disc otherwise,
    // so it never reads as the selected tab
    expect(shell).toContain('? "bg-[image:var(--gradient-primary)] text-primary-foreground inset-ring');
    expect(shell).toContain(': "bg-gradient-to-b from-secondary to-card text-foreground inset-ring');
    // springy press, and the icon settles in when Crew opens
    expect(shell).toContain("group-active/tab:scale-[0.92]");
    expect(shell).toContain('lit && "animate-[crew-pop_360ms_cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:animate-none"');
    expect(read("src/styles.css")).toContain("@keyframes crew-pop {");
    // it shares the icon box with the other tabs, so its label lines up with theirs
    expect(shell).toContain('<div className={cn(BAR_ICON_BOX, "w-full")}>');
    // the active underline is absolute: lighting a tab doesn't shift it
    expect(shell).toContain('<span aria-hidden className="absolute bottom-0.5 left-1/2 h-[3px] w-4');
    expect(shell).not.toContain("min-h-[64px]");
    // --primary is oklch; hsl(var(--primary)) is an invalid colour
    expect(shell).not.toContain("hsl(var(--primary)");
  });

  it("sits just above the home indicator, lined up with the page, with the page fading out under it", () => {
    // ~22pt off the bottom on Face ID iPhones (not the full 34pt safe area), 10px elsewhere
    expect(shell).toContain('const BAR_BOTTOM = "var(--mobile-bar-bottom)";');
    expect(read("src/styles.css")).toContain("--mobile-bar-bottom: max(calc(env(safe-area-inset-bottom) - 12px), 10px);");
    // floating buttons (Cleo, page "+", Back to Today) stack from the bar's real top edge
    expect(read("src/styles.css")).toContain(".summer-fab { bottom: calc(var(--mobile-bar-top) + 14px); }");
    expect(read("src/components/tasks/quick-notes.tsx")).toContain('"calc(var(--mobile-bar-top) + 14px)"');
    expect(read("src/components/return-to-dashboard.tsx")).toContain("bottom-[calc(var(--mobile-bar-top)+14px)]");
    // same 16px gutter as the page's px-4
    expect(shell).toContain('"fixed inset-x-4 z-50 mx-auto grid max-w-md');
    // the fade is tagged like the bar, so keyboard / workout focus / pinch-zoom hide and pin it too
    expect(shell).toMatch(/aria-hidden\s+data-mobile-bottom-nav\s+className="pointer-events-none fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-background/);
  });

  it("holds still while scrolling: only pinned to the visual viewport when zoomed or the keyboard is up", () => {
    // Safari's toolbar show/hide and iOS sub-pixel insets move the visual viewport mid-scroll;
    // chasing them a frame late made the raised Crew button wiggle
    expect(shell).toContain("const dy = Math.round(window.innerHeight - (vv.height + vv.offsetTop));");
    expect(shell).toContain("(zoomed || keyboard) && (dy > 0 || dx !== 0)");
    expect(shell).not.toContain("dy > 0 || dx !== 0 || scale !== 1");
    // even 56px disc (50 + 3px ring), so centring it never lands on a half pixel
    expect(shell).toContain('"absolute bottom-px left-1/2 -translate-x-1/2 rounded-full p-[3px]"');
    expect(shell).toContain('"relative grid h-[50px] w-[50px] place-items-center rounded-full"');
    // a whole 12px label line, placed after the size so tailwind-merge keeps it
    expect(shell).toContain('dense ? "text-[10px]" : "text-[10.5px]", "leading-3", active && "font-semibold")');
  });

  it("League has its own satellite on Crew's button: one tap each, one lit at a time", () => {
    const visible = resolveVisibleBarItems(clientBottomNav, { more: false });
    expect(visible[2].shortcut).toMatchObject({ to: "/portal/community", hash: "rankings", label: "Rankings" });
    // lit while its view is open; Crew goes quiet then
    expect(shell).toContain("const shortcutOn = !!shortcut && pathname === shortcut.to && hash.startsWith(shortcut.hash);");
    expect(shell).toContain("const lit = active && !shortcutOn;");
    // its own link beside Crew's (never nested), told apart by the hash, tap area growing away from the disc
    expect(shell).toContain("if (!shortcut) return link;");
    expect(shell).toMatch(/<Link\s+to=\{shortcut\.to\}\s+hash=\{shortcut\.hash\}\s+activeOptions=\{\{ includeHash: true \}\}/);
    expect(shell).toContain("activeOptions={shortcut ? { includeHash: true } : undefined}");
    // A 44px tap area that grows up and left only, away from the disc.
    expect(shell).toContain('"after:absolute after:-left-4 after:-top-4 after:bottom-1/2 after:right-1/2 after:content-[\'\']"');
    // Docked on the disc's shoulder with the disc's own 3px cut-out ring.
    expect(shell).toContain("left-[calc(50%-38px)] top-[-33px]");
    expect(shell).toContain("ring-[3px] ring-card");
    // The trophy is gold in both states; lit, the satellite glows gold (Crew lights red).
    const satellite = shell.slice(shell.indexOf("data-featured-shortcut"), shell.indexOf("<ShortcutIcon"));
    expect(satellite.match(/text-amber-500/g)?.length).toBe(2);
    expect(satellite).not.toContain("text-primary-foreground");
    // the Crew screen follows the hash, so the shortcut and Crew switch the view in place
    const crew = read("src/components/community/community-screen.tsx");
    expect(crew).toContain('if (rankingsFromHash(`#${routeHash}`)) setScope({ kind: "rankings" });');
    expect(crew).toContain('void navigate({ to: ".", hash: k === "rankings" ? "rankings" : "", replace: true, resetScroll: false });');
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
    expect(profile).toContain("<PostTileFace post={p} thumb={thumb} unit={unit} />");
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
  it("three sections: Today (schedule), Rankings (one card; no feed shelf), Progress (weigh-in, water, progress); the block lives in Workouts", () => {
    expect(home).not.toContain("<CommunityHomeStrip");
    expect(home).not.toContain("<TrainingBlockCard");
    const order = ['aria-label="Today"', "<UpcomingScheduleCard", "<HomeLeaguePreviews", 'aria-label="Progress"', "<BodyweightSummaryCard", "<HomeWaterCard", "<ProgressSummaryCard"];
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
