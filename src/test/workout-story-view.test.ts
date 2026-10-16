import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickStoryStart } from "@/components/workout-day/workout-story";
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
    expect(day).toContain("paused={storyOpen}");
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
  it("pull-to-refresh and swipe-to-delete stay out of it; the bottom bar hides", () => {
    expect(day).toContain('data-no-pull-refresh={storyOpen ? "" : undefined}');
    expect(day).toContain('document.querySelectorAll<HTMLElement>("[data-mobile-bottom-nav]")');
    const swipe = read("src/components/workout-day/swipe-to-reveal.tsx");
    expect(swipe).toContain('!paused && "touch-pan-y"');
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
