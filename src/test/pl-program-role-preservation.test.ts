import { describe, expect, it } from "vitest";
import { buildCopiedExerciseRowPayload } from "@/lib/pl-programs";

const programmedRow = {
  sort_order: 2,
  exercise_id: "competition-squat",
  exercise_name_override: null,
  sets: 2,
  reps_text: "3",
  rpe: "8",
  rir: null,
  percentage: 87,
  percentage_basis: "top_set",
  load_kg: null,
  load_lb: 315,
  rest_seconds: 300,
  tempo: null,
  time_profile: "main_lift",
  notes: "Backoff — 7% below top set",
  measurement_type: "reps",
  tracking_type: "reps_weight",
  duration_seconds: null,
  reps_text_backup: null,
  duration_seconds_backup: null,
  purpose_label: "Primary",
  movement_family: "squat",
  card_color: "yellow",
};

describe("legacy program copy role preservation", () => {
  it("retains a Primary backoff role with its top-set-derived prescription", () => {
    const payload = buildCopiedExerciseRowPayload(programmedRow, "destination-day", {
      prescriptions: true,
      notes: true,
    });

    expect(payload).toMatchObject({
      day_id: "destination-day",
      purpose_label: "Primary",
      movement_family: "squat",
      card_color: "yellow",
      percentage_basis: "top_set",
      notes: "Backoff — 7% below top set",
    });
  });

  it("retains the canonical role even when numerical prescriptions are intentionally omitted", () => {
    const payload = buildCopiedExerciseRowPayload(
      { ...programmedRow, purpose_label: "Tertiary", movement_family: "bench", card_color: "sky" },
      "destination-day",
      { prescriptions: false, notes: false },
    );

    expect(payload).toMatchObject({
      purpose_label: "Tertiary",
      movement_family: "bench",
      card_color: "sky",
      sets: null,
      reps_text: null,
      percentage_basis: "manual",
      notes: null,
    });
  });

  it("does not synthesize or reorder roles during copy", () => {
    const primary = buildCopiedExerciseRowPayload(programmedRow, "destination-day", {
      prescriptions: true,
      notes: true,
    });
    const backoff = buildCopiedExerciseRowPayload(
      { ...programmedRow, sort_order: 3, purpose_label: "Primary" },
      "destination-day",
      { prescriptions: true, notes: true },
    );

    expect([primary.purpose_label, backoff.purpose_label]).toEqual(["Primary", "Primary"]);
    expect([primary.sort_order, backoff.sort_order]).toEqual([2, 3]);
  });
});
