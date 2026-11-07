import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  REVIEW_AFTER_TYPING_MS, REVIEW_EFFORT_GRACE_MS, REVIEW_PROMPT_DELAY_MS,
  isLoggedSetDone, lastLoggedSet, reviewPromptDelay, shouldPromptReview, timedSetAwaitingEffort, workoutSetProgress,
  type ProgressResult,
} from "@/lib/workout-set-progress";

const day = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const at = "2026-10-20T07:30:00Z";
const set = (row: string, i: number, over: Partial<ProgressResult> = {}): ProgressResult => ({
  row_id: row,
  set_index: i,
  completed_at: at,
  actual_reps: 10,
  actual_load: 135,
  ...over,
});

describe("every set logged: one reading for the bars, the ring and the finish review", () => {
  const rows = [
    { id: "squat", sets: 3 },
    { id: "pullups", sets: 2 },
    { id: "plank", sets: 1 },
  ];
  const full = [
    set("squat", 1), set("squat", 2), set("squat", 3),
    // bodyweight: no load stored, still done (the logger stamped it)
    set("pullups", 1, { actual_load: null }), set("pullups", 2, { actual_load: null }),
    // timed: a duration, no reps
    set("plank", 1, { actual_reps: null, actual_load: null, completed_duration_seconds: 45 }),
  ];

  it("is done when each exercise's sets on screen are logged, bodyweight and timed included", () => {
    const p = workoutSetProgress(rows, full);
    expect(p.allDone).toBe(true);
    expect([p.setsDone, p.setsTotal, p.exercisesDone, p.exercisesTotal]).toEqual([6, 6, 3, 3]);
  });

  it("an extra set on one exercise never stands in for a missing one on another", () => {
    const p = workoutSetProgress(rows, [...full.filter((s) => !(s.row_id === "pullups" && s.set_index === 2)), set("squat", 4)]);
    expect(p.allDone).toBe(false);
    expect(p.doneRowIds.has("pullups")).toBe(false);
    expect(p.setsDone).toBe(5);
  });

  it("only sets the logger stamped done and that hold a value count; skipped exercises count as done", () => {
    expect(isLoggedSetDone(set("x", 1, { completed_at: null }))).toBe(false);
    // an old blank row stamped done
    expect(isLoggedSetDone(set("x", 1, { actual_reps: null, actual_load: null }))).toBe(false);
    // weight only (0 is a real entry)
    expect(isLoggedSetDone(set("x", 1, { actual_reps: null, actual_load: 0 }))).toBe(true);
    const p = workoutSetProgress([...rows, { id: "lunges", sets: 3, skipped: true }], full);
    expect(p.allDone).toBe(true);
    expect(p.doneRowIds.has("lunges")).toBe(true);
    expect(p.exercisesTotal).toBe(3);
    // nothing to do isn't "done"
    expect(workoutSetProgress([], []).allDone).toBe(false);
  });

  it("a set added after finishing (sets 3 → 4) re-opens the workout until it's logged", () => {
    expect(workoutSetProgress([{ id: "squat", sets: 4 }], full).allDone).toBe(false);
  });
});

describe("the finish review pops the moment it's all logged", () => {
  const base = { allDone: true, settled: true, finished: false, online: true, previewing: false, loggedHere: false, alreadyPrompted: false };

  it("pops for the athlete, logging the last set or opening a workout that's all logged but not finished", () => {
    expect(shouldPromptReview(base)).toBe(true);
    expect(shouldPromptReview({ ...base, loggedHere: true })).toBe(true);
  });

  it("in View as client, once the coach logs from that screen (never just for opening a client's full workout)", () => {
    expect(shouldPromptReview({ ...base, previewing: true })).toBe(false);
    expect(shouldPromptReview({ ...base, previewing: true, loggedHere: true })).toBe(true);
  });

  it("waits for settled data and a connection, and pops once (Close keeps it shut)", () => {
    expect(shouldPromptReview({ ...base, allDone: false })).toBe(false);
    expect(shouldPromptReview({ ...base, settled: false })).toBe(false);
    expect(shouldPromptReview({ ...base, online: false })).toBe(false);
    expect(shouldPromptReview({ ...base, finished: true })).toBe(false);
    expect(shouldPromptReview({ ...base, alreadyPrompted: true })).toBe(false);
  });

  it("the logger: marked shown only when it opens, re-armed when a set is cleared or added, never waits on the network", () => {
    expect(day).toContain("if (!autoFinishReady && reviewPromptedRef.current === promptKey) reviewPromptedRef.current = null;");
    expect(day).toContain("        if (!live || editing()) return;\n        reviewPromptedRef.current = promptKey;\n        setQuickFinishReviewOpen(true);");
    expect(day).toContain("        setQuickFinishReviewOpen(true);\n        // nothing left to rest for: no countdown or beep over the review\n        dismissRestTimer();\n        // never waits on the network: the session's start is stamped behind it\n        void markInProgress();");
    expect(day).not.toContain("await markInProgress();\n        setQuickFinishReviewOpen(true);");
    // a set saved from this screen (every save path calls the page's refresh)
    expect(day).toContain("  const refresh = () => {\n    setLoggedHereFor(promptKey);");
    // the bars and ring read the same progress
    expect(day).toContain("doneRowIds: loggedProgress.doneRowIds,");
    expect(day).not.toContain("loggedByRow");
  });
});

// The cardio walk at the end of a workout counted as done the moment its
// calories (or its timer) went in, and the review popped over it, blurring the
// RPE box the athlete was heading to. The set still counts as done at once;
// only the review waits for them to finish entering it.
describe("the finish review waits while the last set is still being entered", () => {
  const walk = (over: Partial<ProgressResult> & { actual_rpe_num?: unknown; actual_rpe?: unknown } = {}) =>
    set("walk", 1, { actual_reps: null, actual_load: null, completed_duration_seconds: 600, completed_at: "2026-10-20T08:30:00Z", ...over });

  it("never while a box is focused (calories then RPE, reps then RPE)", () => {
    expect(reviewPromptDelay({ editing: true, leftABox: false, awaitingEffort: false })).toBeNull();
    expect(reviewPromptDelay({ editing: true, leftABox: true, awaitingEffort: true })).toBeNull();
  });

  it("a beat after the last set, a longer one after leaving a box, and room for RPE on a timed set without it", () => {
    expect(reviewPromptDelay({ editing: false, leftABox: false, awaitingEffort: false })).toBe(REVIEW_PROMPT_DELAY_MS);
    expect(reviewPromptDelay({ editing: false, leftABox: true, awaitingEffort: false })).toBe(REVIEW_AFTER_TYPING_MS);
    expect(reviewPromptDelay({ editing: false, leftABox: false, awaitingEffort: true })).toBe(REVIEW_EFFORT_GRACE_MS);
    expect(REVIEW_AFTER_TYPING_MS).toBeGreaterThan(REVIEW_PROMPT_DELAY_MS);
    expect(REVIEW_EFFORT_GRACE_MS).toBeGreaterThanOrEqual(5000);
  });

  it("knows the set that finished the workout and whether it's a timed set still missing RPE", () => {
    const squat = set("squat", 3, { completed_at: "2026-10-20T08:00:00Z" });
    expect(lastLoggedSet([walk(), squat])?.row_id).toBe("walk");
    // a cleared set doesn't count as the last one logged
    expect(lastLoggedSet([squat, walk({ completed_at: null })])?.row_id).toBe("squat");
    expect(timedSetAwaitingEffort(walk())).toBe(true);
    expect(timedSetAwaitingEffort(walk({ actual_rpe_num: 6 }))).toBe(false);
    expect(timedSetAwaitingEffort(walk({ actual_rpe: "6" }))).toBe(false);
    // a lift's last set: the plain beat, not the cardio grace
    expect(timedSetAwaitingEffort(squat)).toBe(false);
    expect(timedSetAwaitingEffort(null)).toBe(false);
  });

  it("the logger holds it while a box is focused and re-times it on every focus change", () => {
    expect(day).toContain("const awaitingEffort = timedSetAwaitingEffort(lastLoggedSet(results as any[]));");
    expect(day).toContain("const wait = reviewPromptDelay({ editing: editing(), leftABox, awaitingEffort });");
    expect(day).toContain('document.addEventListener("focusin", onFocusIn);');
    expect(day).toContain('document.addEventListener("focusout", onFocusOut);');
    expect(day).toContain("}, [promptReview, promptKey, awaitingEffort]);");
    // it no longer pulls the keyboard out from under a box being typed in
    expect(day).not.toContain("if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) el.blur();");
  });
});
