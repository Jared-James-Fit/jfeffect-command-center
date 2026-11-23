import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  completenessPatch,
  requiredRowsFromExerciseRows,
  summarizeCompleteness,
  type LoggedSetSpec,
} from "@/lib/workout-completeness";
import {
  readsWorkoutData,
  WORKOUT_DATA_KEYS,
  workoutEditSignature,
} from "@/lib/workout-data-refresh";
import { HISTORY_EDIT_QUERY_KEYS } from "@/lib/history-set-edit";
import { finishedEditLine } from "@/components/workout/shared/completed-workout-actions";

const read = (p: string) => readFileSync(p, "utf8");

// A finished workout: squat 3 sets, bench 2 sets, the plan's walk (cardio, never required).
const rows = [
  { id: "squat", sets: 3, reps_text: "5" },
  { id: "bench", sets: 2, reps_text: "8" },
  { id: "plank", sets: 1, reps_text: "45 sec" },
  { id: "walk", sets: 1, cardio_target_id: "c1", duration_seconds: 600 },
];
const set = (rowId: string, i: number, extra: Partial<LoggedSetSpec> = {}): LoggedSetSpec => ({
  rowId,
  setIndex: i,
  reps: 5,
  loadKg: 100,
  ...extra,
});

describe("what a finished workout asks for (Finish and the re-sync read it the same way)", () => {
  it("one entry per exercise, never the plan's cardio; a timed row by its time", () => {
    const req = requiredRowsFromExerciseRows(rows);
    expect(req.map((r) => r.rowId)).toEqual(["squat", "bench", "plank"]);
    expect(req.find((r) => r.rowId === "plank")?.metricKind).toBe("timed");
    expect(req.find((r) => r.rowId === "squat")).toMatchObject({
      prescribedSets: 3,
      metricKind: "load_reps",
      skipped: false,
    });
  });

  it("a set count of nothing is one set; the library's time measurement counts as timed", () => {
    const req = requiredRowsFromExerciseRows([
      { id: "x", sets: null, exercises: { default_measurement_type: "time" } },
    ]);
    expect(req[0]).toMatchObject({ prescribedSets: 1, metricKind: "timed" });
  });

  it("the logger's Finish uses the shared reading, never its own copy", () => {
    const src = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(src).toContain(
      "const requiredRows: RequiredRowSpec[] = requiredRowsFromExerciseRows(rows as any[]);",
    );
  });
});

describe("the stored numbers catch up with an edit", () => {
  const req = requiredRowsFromExerciseRows(rows);
  // finished with the last bench set and the plank missing: 4 of 6
  const atFinish = summarizeCompleteness(req, [
    set("squat", 1),
    set("squat", 2),
    set("squat", 3),
    set("bench", 1),
  ]);
  const stored = {
    required_sets_count: atFinish.requiredSets,
    logged_sets_count: atFinish.loggedSets,
    skipped_exercises_count: atFinish.skippedExercises,
    logging_percentage: String(atFinish.loggingPercentage), // numeric columns come back as text
    logging_quality: atFinish.loggingQuality,
    completed_with_missing_logs: atFinish.completedWithMissingLogs,
  };

  it("in step: nothing to write", () => {
    expect(atFinish.loggingQuality).toBe("partially_logged");
    expect(completenessPatch(stored, atFinish)).toEqual({});
  });

  it("the missing sets filled in after Finish: fully logged (which earns its League points)", () => {
    const now = summarizeCompleteness(req, [
      set("squat", 1),
      set("squat", 2),
      set("squat", 3),
      set("bench", 1),
      set("bench", 2),
      set("plank", 1, { reps: null, loadKg: null, completedDurationSeconds: 45 }),
    ]);
    expect(completenessPatch(stored, now)).toEqual({
      logged_sets_count: 6,
      logging_percentage: 100,
      logging_quality: "complete",
      completed_with_missing_logs: false,
    });
  });

  it("a set taken out moves the numbers down the same way", () => {
    const now = summarizeCompleteness(req, [set("squat", 1), set("squat", 2), set("bench", 1)]);
    // 3 of 6: still partly logged, so only the count and the % move
    expect(completenessPatch(stored, now)).toEqual({
      logged_sets_count: 3,
      logging_percentage: 50,
    });
  });

  it("a row with nothing stored yet is written in full", () => {
    expect(Object.keys(completenessPatch(null, atFinish)).sort()).toEqual([
      "completed_with_missing_logs",
      "logged_sets_count",
      "logging_percentage",
      "logging_quality",
      "required_sets_count",
      "skipped_exercises_count",
    ]);
  });
});

describe("an edit is only an edit", () => {
  const results = [
    {
      id: "r1",
      set_index: 1,
      actual_reps: 5,
      actual_load: 100,
      actual_load_unit: "kg",
      completed_at: "2026-11-16T18:00:00Z",
      updated_at: "a",
    },
    {
      id: "r2",
      set_index: 2,
      actual_reps: 5,
      actual_load: 100,
      actual_load_unit: "kg",
      completed_at: "2026-11-16T18:05:00Z",
      updated_at: "b",
    },
  ];
  const base = workoutEditSignature(rows, results);

  it("the same sets in another order, or a new updated_at alone, is no edit", () => {
    expect(workoutEditSignature([...rows].reverse(), [...results].reverse())).toBe(base);
    expect(
      workoutEditSignature(
        rows,
        results.map((r) => ({ ...r, updated_at: "z" })),
      ),
    ).toBe(base);
  });

  it("a weight, reps or RPE changed, a set added or taken out, an exercise's sets changed: an edit", () => {
    expect(
      workoutEditSignature(rows, [{ ...results[0], actual_load: 102.5 }, results[1]]),
    ).not.toBe(base);
    expect(workoutEditSignature(rows, [{ ...results[0], actual_rpe: "8" }, results[1]])).not.toBe(
      base,
    );
    expect(workoutEditSignature(rows, [results[0]])).not.toBe(base);
    expect(
      workoutEditSignature(
        rows.map((r) => (r.id === "bench" ? { ...r, sets: 3 } : r)),
        results,
      ),
    ).not.toBe(base);
  });
});

describe("every screen that reads logged sets is marked stale", () => {
  it("covers what the History fix already refreshed, the analytics, records, points and Rankings", () => {
    for (const [k] of HISTORY_EDIT_QUERY_KEYS) {
      if (k === "pl-day-results") continue; // the open workout's own sets refetch as they save
      expect(readsWorkoutData(k), k).toBe(true);
    }
    for (const k of [
      "my-workouts",
      "workout-progress",
      "pl-day-completion",
      "pl-results",
      "pl-results-all",
      "exercise-history-cards",
      "athlete-xp",
      "athlete-rankings-monthly",
      "workout-points",
      "recovery-trends",
      "training-load-days",
      "my-client-prs",
    ]) {
      expect(readsWorkoutData(k), k).toBe(true);
    }
  });

  it("never the open workout's own reads or anything unrelated", () => {
    for (const k of [
      "pl-day-results",
      "pl-day-rows",
      "pl-day",
      "community-feed",
      "my-sessions",
      "messages-history",
      undefined,
      3,
    ]) {
      expect(readsWorkoutData(k)).toBe(false);
    }
  });

  it("every key it names is one the app uses", () => {
    const src = ["src/components", "src/lib", "src/routes", "src/hooks", "src/route-pages"];
    const used = execSync(`grep -rhoE 'queryKey: \\[.[a-z0-9-]+.' ${src.join(" ")}`, {
      encoding: "utf8",
    });
    const names = new Set([...used.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]));
    const missing = WORKOUT_DATA_KEYS.filter((k) => !names.has(k));
    expect(missing).toEqual([]);
  });
});

describe("Edit workout, from the Workouts card, the recap and the logger", () => {
  it("the finished card's ⋯ opens the workout to edit what was logged; a coach's program editor is Edit in program", () => {
    const src = read("src/components/workouts/WorkoutsExperience.tsx");
    expect(src).toContain('data-testid="day-card-edit-logged"');
    expect(src).toContain(
      "search: { edit: 1, ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) }",
    );
    expect(src).toContain('{isCompleted ? "Edit in program" : "Edit workout"}');
    expect(src).toContain(
      "const canEditLogged = isCompleted && !readonly && canChangeWorkoutStatus && !!item?.day?.id;",
    );
  });

  it("the recap has Edit workout beside the score, closing onto the workout in edit mode", () => {
    expect(read("src/components/workout-submission-summary.tsx")).toContain("data-recap-edit");
    const logger = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(logger).toContain("setEditingFinished(true);");
    expect(logger).toContain("editing={editingFinished}");
  });

  it("the logger syncs after edits settle, sends what's waiting before the score and on Done", () => {
    const logger = read("src/components/workout-day/WorkoutDayView.tsx");
    expect(logger).toContain("useFinishedWorkoutSync({");
    expect(logger).toContain(
      "onOpenScore={() => void finishedSync.flush().finally(openRecapSummary)}",
    );
    expect(logger).toMatch(/onDoneEditing=\{\(\) => \{[\s\S]*finishedSync\.flush\(\)/);
    const hook = read("src/hooks/use-finished-workout-sync.ts");
    // only after an edit seen on this visit: opening an old workout never rewrites it
    expect(hook).toContain("if (baseline.current == null) {");
    expect(hook).toContain("if (!o || !(touched.current || o.syncOnLeave)) return;");
    // a change that settles back to what it was is no edit, checked again when the sync fires
    expect(hook).toContain("if (sig === baseline.current) {");
  });

  it("the History fix re-syncs the finished workouts its sets belong to", () => {
    const sheet = read("src/components/exercise-history-sheet.tsx");
    expect(sheet).toContain("void syncFinished({ data: { workouts, clientId } })");
  });

  it("the card says what's happening, in plain words", () => {
    expect(finishedEditLine("idle", true)).toMatch(/saves as you go/);
    expect(finishedEditLine("idle", false)).toBeNull();
    expect(finishedEditLine("syncing", false)).toBe("Saving your changes…");
    expect(finishedEditLine("synced", true)).toMatch(
      /Records, analytics and points are up to date/,
    );
    expect(finishedEditLine("error", true)).toMatch(/tries again/);
  });
});

describe("the server re-sync", () => {
  const fn = read("src/lib/workout-completion.functions.ts");
  const sql = read("supabase/migrations/20270520090000_finished_workout_edits.sql");

  it("reads the workout itself (never the phone's set counts) and only touches a finished one's stored numbers", () => {
    const body = fn.slice(
      fn.indexOf("export const syncFinishedWorkout"),
      fn.indexOf("export const reopenWorkout"),
    );
    expect(body).toContain('.from("pl_exercise_rows")');
    expect(body).toContain("requiredRowsFromExerciseRows(");
    expect(body).toContain("completenessPatch(comp as any, summary)");
    expect(body).toContain('status: "not_finished"');
    // when it was finished, how long it took and the review stay as they are
    expect(body).not.toMatch(/completed_at:\s/);
    expect(body).not.toMatch(/actual_duration_min:\s/);
    // whose: their own, or a coach / admin through the same check as every POV write
    expect(body).toContain("resolveScopedClientId(supabase, userId, other)");
  });

  it("relabels a set video's card and film caption as the caller, with the move's permission check", () => {
    expect(fn).toContain('supabase.rpc("set_video_relabel" as any');
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_video_relabel(_id uuid, _label text, _label_no_load text DEFAULT NULL)",
    );
    expect(sql).toContain("OR v.client_id IN (SELECT public.coached_client_ids())) THEN");
    expect(sql).toContain("RETURN jsonb_build_object('id', v.id, 'changed', false);");
    // a chat video keeps the athlete's own words
    expect(sql).toContain("SET body = CASE WHEN v.origin = 'chat' THEN m.body");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.set_video_relabel(uuid, text, text) FROM PUBLIC, anon;",
    );
  });
});
