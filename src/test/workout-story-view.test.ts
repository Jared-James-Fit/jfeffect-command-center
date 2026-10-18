import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FLICK_IDLE_MS, NEARLY_FITS_PX, SWIPE_COMMIT_PX, SWIPE_VERTICAL_RATIO, flickSpeed, focusSwipeDirection, pastEdge, pastEdgeDirection, pickStoryStart } from "@/components/workout-day/workout-story";
import { SWIPE_LOCK_RATIO } from "@/components/workout-day/swipe-to-reveal";
import { FOCUS_TIPS_SINCE, resolveWorkoutView, tipsSeenSince } from "@/lib/use-workout-view";
import { TOP_FIRST_DOUBLE_TAP_MS, topFirstPage, topFirstTap } from "@/lib/tab-refresh";

const read = (p: string) => readFileSync(p, "utf8");

describe("story view: where it opens", () => {
  const order = ["squat", "bench", "row", "calf"];
  it("on the exercise you were looking at", () => {
    expect(pickStoryStart(order, new Set(), "row")).toBe(2);
  });
  it("from the top: the first exercise not done yet", () => {
    expect(pickStoryStart(order, new Set(["squat"]), null)).toBe(1);
    expect(pickStoryStart(order, new Set(), null)).toBe(0);
  });
  it("looking at a done one: the next unfinished after it, then any unfinished, then where you were", () => {
    expect(pickStoryStart(order, new Set(["bench"]), "bench")).toBe(2);
    expect(pickStoryStart(order, new Set(["row", "calf"]), "row")).toBe(0);
    expect(pickStoryStart(order, new Set(order), "row")).toBe(2);
  });
  it("an exercise that's gone, or none at all", () => {
    expect(pickStoryStart(order, new Set(), "deleted")).toBe(0);
    expect(pickStoryStart([], new Set(), null)).toBe(0);
  });
});

describe("Focus: a tap never moves (swipe, ‹ / Next, the bars or arrow keys do)", () => {
  it("no tap-to-move: a tap that misses a set box can't throw you to another exercise", () => {
    const story = read("src/components/workout-day/workout-story.tsx");
    expect(story).not.toContain('addEventListener("pointerup"');
    expect(story).not.toContain("focusTapDirection");
    // the only click listener is the swipe's swallow
    expect(story.match(/addEventListener\("click"/g)).toHaveLength(1);
    expect(story).toContain('z.addEventListener("click", onClickCapture, true);');
    expect(story).toContain("const to = (heading ?? i) + dir;");
    expect(story).toContain('data-testid="focus-end-nudge"');
  });
  it("How Focus works: by itself once per account (again for anyone who saw the tap version), and from the ? any time", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain("if (storyOpen && focusKnown && !focusTipsSeen && !isImpersonating) setFocusTipsOpen(true);");
    expect(day).toContain("onHelp={() => setFocusTipsOpen(true)}");
    expect(tipsSeenSince(null)).toBe(false);
    expect(tipsSeenSince("2026-10-17T12:00:00Z")).toBe(false);
    expect(tipsSeenSince(FOCUS_TIPS_SINCE)).toBe(true);
    expect(tipsSeenSince("2026-10-19T08:00:00Z")).toBe(true);
    expect(read("supabase/migrations/20261218090000_focus_tips_swipe.sql")).toContain("SET focus_tips_at = now();");
    const intro = read("src/components/workout-day/focus-intro.tsx");
    expect(intro).toContain("<b className=\"text-foreground\">Swipe up</b> for the next exercise");
    expect(intro).not.toContain("Tap the right side");
  });
});

describe("Focus: swipe up for the next exercise, down to go back", () => {
  const fits = { atTop: true, atBottom: true };
  it("a long enough swipe moves, up is next and down is back", () => {
    expect(focusSwipeDirection({ dy: -SWIPE_COMMIT_PX, speed: 0, ...fits })).toBe(1);
    expect(focusSwipeDirection({ dy: SWIPE_COMMIT_PX, speed: 0, ...fits })).toBe(-1);
    expect(focusSwipeDirection({ dy: -40, speed: 0.1, ...fits })).toBe(0);
  });
  it("a quick flick moves; a drag that stopped before lifting doesn't", () => {
    const flick = [{ y: 500, t: 0 }, { y: 485, t: 16 }, { y: 470, t: 32 }, { y: 455, t: 48 }];
    expect(focusSwipeDirection({ dy: -45, speed: flickSpeed(flick, -45, 56), ...fits })).toBe(1);
    expect(flickSpeed(flick, -45, 48 + FLICK_IDLE_MS + 1)).toBe(0);
    expect(focusSwipeDirection({ dy: -45, speed: flickSpeed(flick, -45, 300), ...fits })).toBe(0);
    // moving back the other way at the end isn't a flick this way
    expect(flickSpeed([{ y: 500, t: 0 }, { y: 460, t: 16 }, { y: 480, t: 32 }], -20, 40)).toBe(0);
  });
  it("one swipe is enough: a card that had more to show scrolls to its end, and the travel past it moves on", () => {
    // a card 30px too tall, swiped up 140px: 30 scrolls it, 110 is the swipe
    expect(pastEdge(140, 30, 30)).toBe(110);
    expect(focusSwipeDirection({ dy: -pastEdge(140, 30, 30), speed: 0, atTop: true, atBottom: true })).toBe(1);
    // reading a long card: the finger only scrolled it
    expect(pastEdge(100, 100, 400)).toBe(0);
    // a phone that reports the bounce past the end: only the real room counts
    expect(pastEdge(140, 45, 30)).toBe(110);
  });
  it("a card that nearly fits moves on with any swipe or flick; a long card only on a deliberate pull past its end", () => {
    expect(pastEdgeDirection({ up: true, past: 30, room: 40, speed: 0.8 })).toBe(1);
    expect(pastEdgeDirection({ up: false, past: SWIPE_COMMIT_PX, room: 40, speed: 0 })).toBe(-1);
    // reading a long card: a quick flick that just reaches the end stays on it
    expect(pastEdgeDirection({ up: true, past: 35, room: NEARLY_FITS_PX + 100, speed: 0.8 })).toBe(0);
    expect(pastEdgeDirection({ up: true, past: SWIPE_COMMIT_PX, room: NEARLY_FITS_PX + 100, speed: 0 })).toBe(1);
  });
  it("a thumb's arc still counts as up / down, and never overlaps swipe to delete", () => {
    expect(SWIPE_VERTICAL_RATIO).toBeLessThan(1);
    // delete claims |dx| ≥ 1.6|dy|, i.e. |dy| ≤ |dx| / 1.6: the vertical rule starts above that
    expect(SWIPE_VERTICAL_RATIO).toBeGreaterThan(1 / SWIPE_LOCK_RATIO);
  });
  it("the bars swipe too (the thumb rests on the bottom one), from the exercise on screen", () => {
    const story = read("src/components/workout-day/workout-story.tsx");
    expect(story).toContain("const zones = [el, topRef.current, bottomRef.current]");
    expect(story).toContain("ref={bottomRef}");
    expect(story).toContain("slide = slideOnScreen();");
  });
  it("a long card scrolls first: up only from its bottom, down only from its top", () => {
    expect(focusSwipeDirection({ dy: -200, speed: 1, atTop: true, atBottom: false })).toBe(0);
    expect(focusSwipeDirection({ dy: 200, speed: 1, atTop: false, atBottom: true })).toBe(0);
    expect(focusSwipeDirection({ dy: -200, speed: 1, atTop: false, atBottom: true })).toBe(1);
    expect(focusSwipeDirection({ dy: 200, speed: 1, atTop: true, atBottom: false })).toBe(-1);
  });
  it("touch only, never while typing or over a menu; the release can't tap the next card; no sideways glide", () => {
    const story = read("src/components/workout-day/workout-story.tsx");
    expect(story).toContain('z.addEventListener("touchmove", onTouchMove, { passive: false });');
    expect(story).toContain("if (document.activeElement?.closest?.(TYPING)) return;");
    expect(story).toContain("if (e.touches.length !== 1 || document.querySelector(OPEN_LAYER)) return;");
    expect(story).toContain('z.addEventListener("click", onClickCapture, true);');
    expect(story).toContain("jump(to, { instant: true });");
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain('behavior: opts?.instant || storyReduced() ? "auto" : "smooth"');
  });
  it("a ⋯ menu opens on a finger's tap, not as it lands (a swipe or scroll starting on it)", () => {
    const menu = read("src/components/ui/dropdown-menu.tsx");
    expect(menu).toContain('touch.current = e.pointerType === "touch";');
    expect(menu).toContain("if (touch.current && toggle) e.preventDefault();");
    expect(menu).toContain("if (!openAtDown.current) toggle.setOpen(true);");
  });
});

describe("story view: the choice is saved on the account", () => {
  it("a switch this phone hasn't saved yet wins, then the account, then the phone, then the list", () => {
    expect(resolveWorkoutView("list", "story", true)).toBe("story");
    expect(resolveWorkoutView("story", "list", false)).toBe("story");
    expect(resolveWorkoutView("list", "story", false)).toBe("list");
    expect(resolveWorkoutView(null, "story", false)).toBe("story");
    expect(resolveWorkoutView(null, null, false)).toBe("list");
  });
  it("its own table, own rows only, checked once per query", () => {
    const sql = read("supabase/migrations/20261207093000_workout_view_prefs.sql");
    expect(sql).toContain("CHECK (view IN ('list', 'story'))");
    expect(sql).toContain("DEFAULT 'list'");
    expect(sql.match(/user_id = \(SELECT auth\.uid\(\)\)/g)?.length).toBe(4);
    expect(sql).not.toMatch(/user_preferences\s*\(/);
  });
});

describe("story view: the same cards as the list, never a second copy", () => {
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  it("one list of cards; story view only swaps its classes", () => {
    expect(day.match(/<ExerciseBlock\s*\n/g)).toHaveLength(1);
    expect(day).toContain('? "workout-story"');
    expect(day).not.toContain("paused={storyOpen}");
    expect(day).toContain("focusMode={storyOpen}");
    expect(day).not.toContain("setFocusMode");
  });
  it("the saved choice opens it before the first paint, once per workout, only for logging", () => {
    expect(day).toContain("if (storyAutoDayRef.current === dayId || storyOpen || savedView !== \"story\") return;");
    expect(day).toContain("if (completion?.completed_at || search.focus || search.review === 1 || search.recap === 1 || search.edit === 1) return;");
    expect(day).toContain("openStory(false);");
  });
  it("its Finish uses the list's gate, and the end of a finished workout doesn't change the saved choice", () => {
    expect(day).toContain("!readonly && !workoutBodyError && !completion?.completed_at && !rowsIsError && authReady && rowsLoaded && (rows as any[]).length > 0\n      ? {");
    expect(day).toContain("onDone={closeStory}");
    expect(day).toContain('onExit={() => chooseWorkoutView("list")}');
  });
  it("pull-to-refresh stays out of it, the bottom bar hides, and a sideways swipe is the card's (delete, like the list)", () => {
    expect(day).toContain('data-no-pull-refresh={storyOpen ? "" : undefined}');
    expect(day).toContain('document.querySelectorAll<HTMLElement>("[data-mobile-bottom-nav]")');
    const swipe = read("src/components/workout-day/swipe-to-reveal.tsx");
    expect(swipe).toContain('className={cn("relative bg-background touch-pan-y",');
    expect(swipe).not.toContain("paused");
    // the row of screens only moves when told to (a swipe, ‹ / Next, the bars)
    expect(read("src/styles.css")).toMatch(/\.workout-story \{\n  position: fixed;\n  inset: 0;\n  z-index: 40;\n  display: flex;\n  overflow: hidden;/);
  });
});

describe("Focus view (stored as story): easy to read, sets by the thumb", () => {
  const story = read("src/components/workout-day/workout-story.tsx");
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  const css = read("src/styles.css");
  it("a finished exercise is green (fills once, \"Done\" pops), the one you're on is thicker", () => {
    expect(story).toContain('done[i] ? "bg-emerald-500" : "bg-foreground"');
    expect(story).toContain('i === index ? "h-1.5" : "h-1"');
    expect(story).toContain('done[i] && justDone?.i === i && "jf-bar-fill"');
    expect(story).toContain('data-testid="story-done"');
    expect(story).toContain("window.setTimeout(() => setJustDone(null), 900);");
    expect(css).toContain(".jf-bar-fill { transform-origin: left center;");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\n  \.jf-bar-fill, \.jf-done-pop \{ animation: none; \}/);
  });
  it("is called Focus, and the way out says List", () => {
    expect(story).toContain('{ value: "story", label: "Focus", icon: RectangleVertical }');
    expect(story).not.toContain('label: "Story"');
    expect(story).toContain('data-testid="focus-exit"');
  });
  it("← Workouts leaves the workout like the list's back button, keeping Focus as the saved view", () => {
    expect(story).toContain('data-testid="focus-leave"');
    expect(day).toContain("const pageBack = usePageBack(navigation.backTo);");
    expect(day).toContain('back={{ label: "Workouts", onBack: leaveFromStory }}');
    // a number being typed commits (and saves) before the page goes
    expect(day).toContain("(document.activeElement as HTMLElement | null)?.blur?.();\n    requestAnimationFrame(() => requestAnimationFrame(pageBack));");
    expect(read("src/components/app-shell.tsx")).toContain("const handleBack = usePageBack(backTo);");
  });
  it("the top bar leads with where you are; the clock is plain and hides once stopped", () => {
    expect(story).toContain("Exercise {index + 1} of {count}");
    expect(story).toContain("if (!session || session.stoppedAt != null || isSessionAbandoned(session, now)) return null;");
    expect(story).toContain("border-b border-border/60 bg-background");
    expect(day).toContain("timer={!completion?.completed_at ? <FocusClock dayId={dayId} /> : undefined}");
  });
  it("the card sits at its own height under the top bar, no gap in it; adding exercises stays in the list", () => {
    expect(css).not.toContain("data-story-fill");
    expect(day).not.toContain("data-focus-spacer");
    expect(day).not.toContain("data-story-fill");
    expect(day).toContain("{canEditWorkoutStructure && !storyOpen && (");
  });
  it("starts under the View as client banner, never behind it", () => {
    expect(css).toContain(":root { --focus-top: var(--pov-banner-h, env(safe-area-inset-top, 0px)); }");
    expect(css).toContain("padding: calc(var(--focus-top) + 114px) 12px");
    expect(story).toContain("pt-[calc(var(--focus-top)+6px)]");
    expect(read("src/components/client-pov-banner.tsx")).toContain('root.style.setProperty("--pov-banner-h", `${el.getBoundingClientRect().height}px`);');
  });
});

describe("workout logger: the Workouts tab goes to the top first", () => {
  it("only inside a workout", () => {
    expect(topFirstPage("/portal/workouts/0b5f3c3e-1111-4c2a-9d7e-123456789abc")).toBe(true);
    expect(topFirstPage("/portal/workouts")).toBe(false);
    expect(topFirstPage("/portal/workouts/abc/history")).toBe(false);
    expect(topFirstPage("/portal/community")).toBe(false);
  });
  it("scrolled down: the first tap goes up; the next (or a quick double tap) goes to Workouts", () => {
    expect(topFirstTap(900, Infinity)).toBe("top");
    expect(topFirstTap(0, Infinity)).toBe("tab");
    expect(topFirstTap(20, Infinity)).toBe("tab");
    expect(topFirstTap(600, 200)).toBe("tab");
    expect(topFirstTap(600, TOP_FIRST_DOUBLE_TAP_MS + 1)).toBe("top");
  });
  it("the bar stays out of the way when the tap only scrolled", () => {
    const shell = read("src/components/app-shell.tsx");
    expect(shell).toContain("} else if (prefixActive && topFirstPage(pathname)) {");
    expect(shell).toContain('if (topFirstTap(pageScrolledPx(), now - lastTopTapRef.current) === "top") {');
  });
});
