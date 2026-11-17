import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TRAINING_LOAD_RULES, trainingLoadBrief, trainingLoadFromRecords } from "@/lib/program-intel/training-load-intel";

const read = (p: string) => readFileSync(p, "utf8");

function rec() {
  const exercises = [
    { id: "sq", name: "Competition Squat", primary_muscle_group: "Quads", muscle_groups: ["quads", "glutes"], secondary_muscle_groups: ["lower_back"], movement_family: "squat", is_competition_lift: true, competition_lift_type: "squat", exercise_category: "Lower", variation_type: null, counts_toward_volume: true, volume_multiplier: null },
  ];
  const weeks = [{ id: "w1", block_id: "b1", week_index: 1, start_date: null, end_date: null, phase: "Accumulation", notes: null }];
  const days = [
    { id: "d1", week_id: "w1", day_index: 1, title: "Day 1", focus: null, notes: null, scheduled_date: "2026-11-09" },
    { id: "d0", week_id: "w1", day_index: 2, title: "Old", focus: null, notes: null, scheduled_date: "2025-01-01" },
  ];
  const row = (id: string, day: string) => ({ id, day_id: day, sort_order: 0, exercise_id: "sq", exercise_name_override: null, sets: 4, reps_text: "5", rpe: "8", rir: null, percentage: null, percentage_basis: null, load_kg: null, load_lb: null, load_unit: null, tempo: null, rest_seconds: null, notes: null, purpose_label: null, measurement_type: "reps", duration_seconds: null, intensity_techniques: null, progression_method: null });
  const result = (id: string, rowId: string, at: string, extra: Record<string, unknown> = {}) => ({ id, row_id: rowId, set_index: 1, actual_load: 150, actual_load_unit: "kg", normalized_kg: 150, actual_load_kg: 150, actual_reps: 5, actual_rpe: "8", actual_rpe_num: 8, actual_rir: null, is_working_set: true, is_bodyweight: false, load_type: "external", completed_at: at, completed_duration_seconds: null, notes: null, ...extra });
  return {
    client: { timezone: "America/Winnipeg" },
    today: "2026-11-17",
    exercises,
    weeks,
    days,
    rows: [row("r1", "d1"), row("r0", "d0")],
    results: [
      result("x1", "r1", "2026-11-09T18:00:00Z"),
      result("x2", "r1", "2026-11-09T18:05:00Z"),
      result("x3", "r1", "2026-11-09T18:10:00Z"),
      // a flagged warm-up never counts
      result("x4", "r1", "2026-11-09T17:50:00Z", { is_working_set: false }),
      // older than the window
      result("x5", "r0", "2025-01-01T18:00:00Z"),
    ],
  } as any;
}

describe("training load reaches the AI from Program Intelligence's records", () => {
  it("reads the last 12 weeks of working sets against the program, warm-ups out", () => {
    const load = trainingLoadFromRecords(rec());
    expect(load.totals.sets).toBe(3);
    expect(load.weeks.map((w) => w.key)).toEqual(["2026-11-09"]);
    expect(load.weeks[0].prescribed).toBe(4);
    expect(load.weeks[0].completedOfPrescribed).toBe(3);
    expect(load.weeks[0].phase).toBe("Accumulation");
    const text = trainingLoadBrief(load);
    expect(text).toContain("Last 12 weeks");
    expect(text).toContain("Working sets: 3");
  });

  it("an athlete with nothing in the window adds no section", () => {
    const r = rec();
    r.results = [];
    expect(trainingLoadBrief(trainingLoadFromRecords(r))).toBe("");
    expect(trainingLoadBrief(null)).toBe("");
  });

  it("the brief carries the section and every prompt that reads it carries the rules", () => {
    expect(read("src/lib/program-intel/brief.ts")).toContain('add("training_load", "Training load (computed from their logged sets and the program)", loadText)');
    expect(read("src/lib/program-intel/intelligence.ts")).toContain("trainingLoad = trainingLoadFromRecords(rec);");
    for (const f of ["src/lib/program-ai/prompts.ts", "src/lib/program-intel/generator-prompts.ts", "src/lib/program-intel/next-program.ts"]) {
      expect(read(f), f).toContain("${TRAINING_LOAD_RULES}");
    }
    expect(read("src/lib/program-intel/jobs.server.ts")).toContain("trainingLoadBrief(gi.trainingLoad)");
    // never automatic in either direction
    expect(TRAINING_LOAD_RULES).toContain("Don't add workload because the athlete is progressing");
    expect(TRAINING_LOAD_RULES).toContain("don't cut it for one hard session");
  });
});
