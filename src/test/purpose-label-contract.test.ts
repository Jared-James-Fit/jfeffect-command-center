import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deriveWeeklyPurposeLabelByRowId,
  resolvePurposeLabel,
} from "@/lib/exercise-metadata";

const competition = (type: "squat" | "bench" | "deadlift") => ({
  exercise_category: "competition" as const,
  is_competition_lift: true,
  competition_lift_type: type,
});

const variation = (type: "squat" | "bench" | "deadlift") => ({
  exercise_category: "variation" as const,
  competition_lift_type: type,
});

describe("canonical purpose-label contract", () => {
  it("uses explicit weekly programming roles rather than row position", () => {
    const labels = deriveWeeklyPurposeLabelByRowId(
      [
        { order: 1, rows: [{ id: "late", purpose_label: "Primary", sort_order: 9 }] },
        { order: 2, rows: [{ id: "early", purpose_label: "Secondary", sort_order: 0 }] },
      ],
      () => competition("squat"),
    );
    expect(labels.get("late")).toBe("Primary");
    expect(labels.get("early")).toBe("Secondary");
  });

  it("carries the same programmed hierarchy into a repeating following week", () => {
    const weekOne = deriveWeeklyPurposeLabelByRowId(
      [{ order: 1, rows: [{ id: "w1-primary", purpose_label: "Primary" }, { id: "w1-secondary", purpose_label: "Secondary" }] }],
      () => competition("bench"),
    );
    const weekTwo = deriveWeeklyPurposeLabelByRowId(
      [{ order: 1, rows: [{ id: "w2-primary", purpose_label: "Primary" }, { id: "w2-secondary", purpose_label: "Secondary" }] }],
      () => competition("bench"),
    );
    expect([...weekOne.values()]).toEqual([...weekTwo.values()]);
  });

  it("allows a new block or phase to intentionally change the stored role", () => {
    expect(resolvePurposeLabel({ purpose_label: "Secondary" }, competition("deadlift"))).toBe("Secondary");
    expect(resolvePurposeLabel({ purpose_label: "Primary" }, competition("deadlift"))).toBe("Primary");
  });

  it("supports higher-frequency bench programming with Primary, Secondary, and Tertiary roles", () => {
    const labels = deriveWeeklyPurposeLabelByRowId(
      [
        { order: 1, rows: [{ id: "bench-volume", purpose_label: "Secondary" }] },
        { order: 2, rows: [{ id: "bench-technique", purpose_label: "Tertiary" }] },
        { order: 3, rows: [{ id: "bench-heavy", purpose_label: "Primary" }] },
      ],
      () => competition("bench"),
    );
    expect([...labels.values()]).toEqual(["Secondary", "Tertiary", "Primary"]);
  });

  it("keeps a light competition taper exposure from falling back to Assistance", () => {
    expect(resolvePurposeLabel({ purpose_label: "Secondary" }, competition("squat"))).toBe("Secondary");
  });

  it("honors a stored role over generic exercise metadata", () => {
    expect(resolvePurposeLabel({ purpose_label: "Tertiary" }, competition("bench"))).toBe("Tertiary");
    expect(resolvePurposeLabel({ purpose_label: "Primary" }, variation("bench"))).toBe("Primary");
  });

  it("keeps scheduling and rescheduling as source-day instance operations rather than prescription rewrites", () => {
    const source = readFileSync("src/lib/scheduled-workouts.functions.ts", "utf8");
    expect(source).toContain("pl_scheduled_workouts holds \"instances\"");
    expect(source).toContain("never mutates program structure");
    expect(source).not.toContain('from("pl_exercise_rows").update');
  });

  it("keeps the client workout experience and admin preview bound to the stored purpose_label", () => {
    const clientSource = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
    const previewSource = readFileSync("src/components/workout/shared/inline-workout-preview.tsx", "utf8");
    expect(clientSource).toContain("purpose_label");
    expect(previewSource).toContain("purpose_label");
  });

  it("keeps the program editor’s manual role override as the canonical edit value", () => {
    const source = readFileSync("src/routes/_authenticated/admin/program-library_.$templateId.tsx", "utf8");
    expect(source).toContain("Manual purpose label");
    expect(source).toContain("purpose_label: opt");
  });

  it("does not infer a variation role when a coach has stored a specific one", () => {
    expect(resolvePurposeLabel({ purpose_label: "Secondary" }, variation("squat"))).toBe("Secondary");
  });
});
