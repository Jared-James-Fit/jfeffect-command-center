import type { IntelRecords, RawResult, RawRow } from "@/lib/program-intel/types";

/**
 * A small, fully known program: one block, three weeks, two days a week.
 * Week 1 done, week 2 day 2 missed, week 3 in the future.
 * Day 1: Competition Squat 3×5 @7 (+ Leg Extension 3×10-12 @8)
 * Day 2: Competition Bench 3×5 @7
 */
export const KG = (lb: number) => Math.round((lb / 2.2046226218) * 100) / 100;

export function fixture(over: Partial<IntelRecords> = {}): IntelRecords {
  const exercises = [
    { id: "ex-squat", name: "Competition Squat", primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: ["glutes"], movement_family: "squat", is_competition_lift: true, competition_lift_type: "squat", exercise_category: "compound", variation_type: null, counts_toward_volume: true, volume_multiplier: 1 },
    { id: "ex-bench", name: "Competition Bench", primary_muscle_group: "Chest", muscle_groups: ["chest"], secondary_muscle_groups: ["triceps", "front_delts"], movement_family: "bench", is_competition_lift: true, competition_lift_type: "bench", exercise_category: "compound", variation_type: null, counts_toward_volume: true, volume_multiplier: 1 },
    { id: "ex-legext", name: "Leg Extension", primary_muscle_group: "Quads", muscle_groups: ["quads"], secondary_muscle_groups: [], movement_family: "accessory", is_competition_lift: false, competition_lift_type: null, exercise_category: "isolation", variation_type: null, counts_toward_volume: true, volume_multiplier: 1 },
  ];
  const weeks = [1, 2, 3].map((i) => ({ id: `w${i}`, block_id: "b1", week_index: i, start_date: `2026-10-${String(5 + (i - 1) * 7).padStart(2, "0")}`, end_date: `2026-10-${String(11 + (i - 1) * 7).padStart(2, "0")}`, phase: null, notes: null }));
  const days = weeks.flatMap((w, wi) => [
    { id: `d${wi + 1}a`, week_id: w.id, day_index: 1, title: "Squat day", focus: null, notes: null, scheduled_date: `2026-10-${String(6 + wi * 7).padStart(2, "0")}` },
    { id: `d${wi + 1}b`, week_id: w.id, day_index: 2, title: "Bench day", focus: null, notes: null, scheduled_date: `2026-10-${String(8 + wi * 7).padStart(2, "0")}` },
  ]);
  const row = (id: string, day: string, ex: string, sets: number, reps: string, rpe: string | null, sort: number, extra: Partial<RawRow> = {}): RawRow => ({
    id, day_id: day, sort_order: sort, exercise_id: ex, exercise_name_override: null, sets, reps_text: reps, rpe, rir: null, percentage: null, percentage_basis: null, load_kg: null, load_lb: null, load_unit: null, tempo: null, rest_seconds: null, notes: null, purpose_label: null, measurement_type: null, duration_seconds: null, intensity_techniques: null, progression_method: null, ...extra,
  });
  const rows: RawRow[] = [];
  for (let w = 1; w <= 3; w++) {
    rows.push(row(`r${w}sq`, `d${w}a`, "ex-squat", 3, "5", "7", 0, { purpose_label: "Primary Squat" }));
    rows.push(row(`r${w}le`, `d${w}a`, "ex-legext", 3, "10-12", "8", 1));
    rows.push(row(`r${w}be`, `d${w}b`, "ex-bench", 3, "5", "7", 0));
  }
  const res = (id: string, rowId: string, set: number, kg: number | null, reps: number | null, rpe: number | null, at: string, extra: Partial<RawResult> = {}): RawResult => ({
    id, row_id: rowId, set_index: set, actual_load: kg, actual_load_unit: "kg", normalized_kg: kg, actual_load_kg: kg, actual_reps: reps, actual_rpe: rpe == null ? null : String(rpe), actual_rpe_num: rpe, actual_rir: null, is_working_set: null, is_bodyweight: false, load_type: "external", completed_at: at, completed_duration_seconds: null, notes: null, ...extra,
  });
  const results: RawResult[] = [
    // week 1 squat 140×5 @7 ×3, leg ext 50×12 @8 ×3, bench 100×5 @7 ×3
    ...[1, 2, 3].map((s) => res(`w1sq${s}`, "r1sq", s, 140, 5, 7, "2026-10-06T18:00:00Z")),
    ...[1, 2, 3].map((s) => res(`w1le${s}`, "r1le", s, 50, 12, 8, "2026-10-06T18:30:00Z")),
    ...[1, 2, 3].map((s) => res(`w1be${s}`, "r1be", s, 100, 5, 7, "2026-10-08T18:00:00Z")),
    // week 2 squat 150×5 @8 ×2 (one set short), warm-up flagged, no leg ext; bench missed
    res("w2sqwu", "r2sq", 0, 60, 5, 4, "2026-10-13T17:50:00Z", { is_working_set: false }),
    ...[1, 2].map((s) => res(`w2sq${s}`, "r2sq", s, 150, 5, 8, "2026-10-13T18:00:00Z")),
  ];
  const completions = [
    { id: "c1", day_id: "d1a", completed_at: "2026-10-06T19:00:00Z", started_at: null, actual_duration_min: 60, logging_percentage: 100, session_rating: 4, skipped_exercises_count: 0, client_notes: null },
    { id: "c2", day_id: "d1b", completed_at: "2026-10-08T19:00:00Z", started_at: null, actual_duration_min: 45, logging_percentage: 100, session_rating: 4, skipped_exercises_count: 0, client_notes: null },
  ];
  return {
    client: { id: "client-1", full_name: "Test Athlete", preferred_weight_unit: "kg", timezone: "America/Winnipeg", sex: null, coach_notes: null, goals: null, injuries: null, training_notes: null, lifestyle_notes: null },
    goals: { main_goal: "Compete in powerlifting", main_goal_other: null, goal_target: null, training_days_per_week: 2, workout_length_minutes: 60, training_experience: "intermediate", training_styles: ["powerlifting"], training_location: null, equipment: null, injuries_has: false, injuries_details: null, final_notes: null },
    preps: [{ id: "p1", title: "Provincials prep", goal_type: "meet", event_name: "Provincials", event_date: "2026-12-12", federation: "CPU", weight_class: "83", division: null, status: "active", coach_notes: null }],
    blocks: [{ id: "b1", prep_id: "p1", name: "Block 1 — Volume", status: "Active", start_date: "2026-10-05", end_date: "2026-10-25", weeks: 3, training_focus: "Volume", goal: null, coach_notes: null, client_visible: true, archived: false, sort_order: 0, created_at: "2026-10-01T00:00:00Z" }],
    weeks,
    days,
    rows,
    setBlocks: [],
    results,
    warmups: [],
    completions,
    feedback: [{ id: "f1", day_id: "d1a", completion_id: "c1", created_at: "2026-10-06T19:05:00Z", session_rpe: 7, overall_rating: 4, strength_feel: null, fatigue_feel: "normal", hit_target: null, recovery_today: null, sleep_bucket: "7-8", pain: true, pain_area: "Knee", pain_level: 3, pain_note: "a bit sore", client_note: null, review_version: 2 }],
    exerciseNotes: [],
    exercises,
    maxes: [],
    meets: [],
    bodyweight: [],
    roadmapNotes: [],
    fileNotes: [],
    observations: [],
    settings: { e1rmFormula: "epley", workingRpeMin: 6, muscleTargets: {} },
    scope: { kind: "program", label: "Current program", from: null, to: null, blockIds: ["b1"] },
    today: "2026-10-16",
    loadedAt: "2026-10-16T12:00:00Z",
    unreadable: [],
    ...over,
  };
}
