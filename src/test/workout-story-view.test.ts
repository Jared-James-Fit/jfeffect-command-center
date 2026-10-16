import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { focusTapDirection, focusTapIgnored, pickStoryStart } from "@/components/workout-day/workout-story";
import { resolveWorkoutView } from "@/lib/use-workout-view";
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

describe("Focus: tap to move, like Crew's stories", () => {
  it("the left third goes back, anywhere else forward", () => {
    expect(focusTapDirection(50, 390)).toBe(-1);
    expect(focusTapDirection(129, 390)).toBe(-1);
    expect(focusTapDirection(131, 390)).toBe(1);
    expect(focusTapDirection(380, 390)).toBe(1);
  });
  it("only controls (and a card swiped open) keep their taps; empty space anywhere moves, the set table's included", () => {
    expect(focusTapIgnored(null)).toBe(true);
    const story = read("src/components/workout-day/workout-story.tsx");
    for (const sel of ["button", "input", '[role="switch"]', "[data-swipe-open]"]) expect(story).toContain(sel);
    expect(story).not.toContain("[data-set-table]");
  });
  it("a tap is read from the finger (with a little wander), queues behind the last, and always shows", () => {
    const story = read("src/components/workout-day/workout-story.tsx");
    expect(story).toContain('el.addEventListener("pointerup", onUp, { passive: true });');
    expect(story).not.toContain('el.addEventListener("click"');
    expect(story).toContain("const to = (heading ?? i) + dir;");
    expect(story).toContain("if (typing) { typing.blur(); return; }");
    expect(story).toContain('flash.end ? "jf-tap-end" : "jf-tap-flash"');
  });
  it("How Focus works: by itself once per account, and from the ? any time", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain("if (storyOpen && focusKnown && !focusTipsSeen && !isImpersonating) setFocusTipsOpen(true);");
    expect(day).toContain("onHelp={() => setFocusTipsOpen(true)}");
    expect(read("supabase/migrations/20261209090000_focus_tips_seen.sql")).toContain("focus_tips_at = coalesce(public.workout_view_prefs.focus_tips_at, now());");
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
    // the row of screens only moves when told to (a tap, ‹ / Next, the bars)
    expect(read("src/styles.css")).toMatch(/\.workout-story \{\n  position: fixed;\n  inset: 0;\n  z-index: 40;\n  display: flex;\n  overflow: hidden;/);
  });
});

describe("Focus view (stored as story): easy to read, sets by the thumb", () => {
  const story = read("src/components/workout-day/workout-story.tsx");
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  const css = read("src/styles.css");
  it("is called Focus, and the way out says List", () => {
    expect(story).toContain('{ value: "story", label: "Focus", icon: RectangleVertical }');
    expect(story).not.toContain('label: "Story"');
    expect(story).toContain('data-testid="focus-exit"');
  });
  it("the top bar leads with where you are; the clock is plain and hides once stopped", () => {
    expect(story).toContain("Exercise {index + 1} of {count}");
    expect(story).toContain("if (!session || session.stoppedAt != null || isSessionAbandoned(session, now)) return null;");
    expect(story).toContain("border-b border-border/60 bg-background");
    expect(day).toContain("timer={!completion?.completed_at ? <FocusClock dayId={dayId} /> : undefined}");
  });
  it("the card fills the screen and its sets sit at the bottom (Focus only); adding exercises stays in the list", () => {
    expect(css).toContain(".workout-story [data-story-fill] > [data-workout-exercise] { flex: 1 0 auto; }");
    expect(day).toContain('focusMode && "flex flex-col"');
    expect(day).toContain('{focusMode && <div aria-hidden className="flex-1" data-focus-spacer />}');
    expect(day).toContain("{canEditWorkoutStructure && !storyOpen && (");
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
