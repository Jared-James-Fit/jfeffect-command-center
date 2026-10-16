import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { introShows } from "@/components/workout-day/focus-intro";
import { creditSets, emptyTally, tallyIsEmpty } from "@/lib/focus-usage";

const read = (p: string) => readFileSync(p, "utf8");

describe("Focus intro: once per launch until they try it", () => {
  const base = { eligible: true, known: true, tried: false, closed: false, launchDay: null as string | null, dayId: "d1" };
  it("shows in the first workout of a launch for someone who hasn't tried Focus", () => {
    expect(introShows(base)).toBe(true);
    expect(introShows({ ...base, launchDay: "d1" })).toBe(true); // same workout, still showing
  });
  it("never after they've tried it, never before the account answers, never twice in a launch", () => {
    expect(introShows({ ...base, tried: true })).toBe(false);
    expect(introShows({ ...base, known: false })).toBe(false);
    expect(introShows({ ...base, closed: true })).toBe(false);
    expect(introShows({ ...base, launchDay: "other-workout" })).toBe(false);
    expect(introShows({ ...base, eligible: false })).toBe(false);
  });
  it("only for a workout being logged by the athlete, with 2+ exercises, in the list", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain("!storyOpen && !readonly && !isImpersonating && rowsLoaded && (rows as any[]).length >= 2 &&");
    expect(day).toContain("!completionPending && !completion?.completed_at,");
    expect(day).toContain('<FocusIntro onTry={() => chooseWorkoutView("story")} onDismiss={focusIntro.dismiss} />');
  });
  it("the launch state lives in the module (a reload starts over) and the switch stamps tried_at", () => {
    const intro = read("src/components/workout-day/focus-intro.tsx");
    expect(intro).toContain("const launch = { day: null as string | null, closed: false, counted: false };");
    const hook = read("src/lib/use-workout-view.ts");
    expect(hook).toContain('db.rpc("workout_view_set", { _view: view })');
    expect(hook).toContain("known: isFetched && !isPlaceholderData");
    const sql = read("supabase/migrations/20261208090000_focus_intro_usage_and_exercise_trash.sql");
    expect(sql).toContain("tried_at = coalesce(public.workout_view_prefs.tried_at, now());");
  });
  it("the animation only moves transform / opacity / colour, and stops for reduced motion", () => {
    const css = read("src/styles.css");
    expect(css).toContain(".jf-fi-track { animation: jf-fi-swipe 4.8s");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\n  \.jf-fi-track, \.jf-fi-finger, \.jf-fi-bar-1, \.jf-fi-bar-2 \{ animation: none; \}/);
  });
});

describe("Focus usage: is it useful?", () => {
  it("sets go to the view they were logged in; an un-tick never subtracts", () => {
    const t = emptyTally();
    let seen = creditSets(t, "list", 0, 2);
    seen = creditSets(t, "story", seen, 5);
    seen = creditSets(t, "story", seen, 4);
    seen = creditSets(t, "story", seen, 6);
    expect([t.setsList, t.setsFocus, seen]).toEqual([2, 5, 6]);
  });
  it("nothing to send means no request", () => {
    expect(tallyIsEmpty(emptyTally())).toBe(true);
    expect(tallyIsEmpty({ ...emptyTally(), listMs: 500 })).toBe(true);
    expect(tallyIsEmpty({ ...emptyTally(), setsFocus: 1 })).toBe(false);
    expect(tallyIsEmpty({ ...emptyTally(), focusMs: 4000 })).toBe(false);
  });
  it("batched, deltas only, never a coach's preview, never a finished workout opened to look at", () => {
    const usage = read("src/lib/focus-usage.ts");
    expect(usage).toContain("const BATCH_MS = 20_000;");
    expect(usage).toContain('db.rpc("workout_view_session_add"');
    expect(usage).toContain("if (finished) off.current = true;");
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).toContain("enabled={!!authUser && !isImpersonating && !readonly}");
  });
  it("the report is admins only and the tables are own-rows", () => {
    const sql = read("supabase/migrations/20261208090000_focus_intro_usage_and_exercise_trash.sql");
    expect(sql).toContain("IF NOT (SELECT public.has_role((SELECT auth.uid()), 'admin')) THEN");
    expect(sql.match(/user_id = \(SELECT auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(read("src/route-pages/_authenticated/admin/training-intelligence.tsx")).toContain('{accountRole === "admin" && <FocusUsageCard />}');
  });
});

describe("Focus swipes stay smooth", () => {
  it("the bars follow the swipe themselves; the logger never re-renders on a swipe", () => {
    const day = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(day).not.toContain("const [storyIndex, setStoryIndex]");
    expect(day).not.toContain("onScroll={storyOpen");
    const story = read("src/components/workout-day/workout-story.tsx");
    expect(story).toContain('el.addEventListener("scroll", onScroll, { passive: true });');
  });
});

describe("Remove from this workout: reversible, this workout only", () => {
  const fns = read("src/lib/quick-swap.functions.ts");
  const sql = read("supabase/migrations/20261208090000_focus_intro_usage_and_exercise_trash.sql");
  const day = read("src/components/workout-day/WorkoutDayView.tsx");
  it("moves the exercise and everything on it to the trash in one transaction; nothing is deleted from the client", () => {
    expect(fns).toContain('rpc("pl_trash_exercise_row"');
    expect(fns).not.toContain('from("pl_row_results").delete()');
    expect(sql).toContain("INSERT INTO public.pl_exercise_row_trash");
    for (const part of ["results", "notes", "blocks", "block_set_rows", "block_drop_stages", "reviews", "warmups", "basis_refs"]) expect(sql).toContain(part);
  });
  it("Undo on the toast and Restore under the list put it back", () => {
    expect(day).toContain('action: { label: "Undo", onClick: () => void restoreExerciseNow(trashId, exerciseName) },');
    expect(day).toContain('data-testid="removed-exercises"');
    expect(fns).toContain('rpc("pl_restore_exercise_row"');
  });
  it("the ⋯ menu offers it (and says it's only this workout)", () => {
    expect(day).toContain('data-testid="card-remove"');
    expect(day).toContain("Only this workout. You can undo it.");
  });
  it("the trash is server-only", () => {
    expect(sql).toContain("REVOKE ALL ON public.pl_exercise_row_trash FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.pl_trash_exercise_row(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;");
  });
});
