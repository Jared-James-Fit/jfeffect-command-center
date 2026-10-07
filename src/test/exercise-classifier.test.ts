import { describe, expect, it } from "vitest";
import {
  classifyExercise,
  isDifferentTarget,
  swapScore,
  type SwapCandidateMeta,
} from "@/lib/exercise-classifier";
import { rankSuggestions } from "@/components/workout-day/QuickSwapButton";
import { weeklyMuscleVolume } from "@/lib/pl-programs";

const meta = (name: string, category?: string): SwapCandidateMeta => {
  const c = classifyExercise(name, category);
  return { pattern: c.pattern, primary: c.primary, secondary: c.secondary, equipment: c.equipment };
};

describe("exercise classifier", () => {
  it.each([
    ["Copenhagen Plank", "hip_adduction", ["adductors"]],
    ["Adductor Machine", "hip_adduction", ["adductors"]],
    ["Abduction Machine", "hip_abduction", ["glutes"]],
    ["Cable Hip Abduction", "hip_abduction", ["glutes"]],
    ["Romanian Deadlift", "hinge", ["hamstrings", "glutes"]],
    ["Close Grip Curl", "elbow_flexion", ["biceps"]],
    ["Machine Rear Delt Fly", "rear_delt", ["rear_delts"]],
    ["Leg Press Calf Raise", "calf_raise", ["calves"]],
    ["Incline Dumbbell Curl", "elbow_flexion", ["biceps"]],
    ["Cable Glute Kickback", "hip_thrust", ["glutes"]],
    ["Competition Bench Press", "horizontal_press", ["chest", "triceps"]],
    ["Sumo Deadlift", "hinge", ["glutes", "quads", "adductors"]],
    ["Kneeling Hip Flexor Stretch", "mobility", ["other"]],
  ])("%s → %s", (name, pattern, primary) => {
    const c = classifyExercise(name);
    expect(c.pattern).toBe(pattern);
    expect(c.primary).toEqual(primary);
  });

  it("lets a stretching/yoga category decide only when the name names no movement", () => {
    expect(classifyExercise("Resistance Band Glute Bridge", "Yoga").pattern).toBe("hip_thrust");
    expect(classifyExercise("Body Saw Plank", "Yoga").pattern).toBe("core_anti_extension");
    expect(classifyExercise("Happy Baby", "Yoga").pattern).toBe("mobility");
    expect(
      classifyExercise("Crossover Kneeling Hip Flexor Stretch", "Stretching - Mobility").equipment,
    ).toBeNull();
  });
});

describe("swap targets", () => {
  it("adductor machine ↔ Copenhagen is a close match, not a different target", () => {
    const src = meta("Adductor Machine");
    const cph = meta("Copenhagen Plank");
    expect(isDifferentTarget(src, cph)).toBe(false);
    expect(swapScore(src, cph)).toBeGreaterThanOrEqual(80);
  });

  it("abduction ≠ adduction even when tags would overlap", () => {
    expect(isDifferentTarget(meta("Abduction Machine"), meta("Copenhagen Plank"))).toBe(true);
    expect(
      isDifferentTarget(
        { pattern: "hip_abduction", primary: ["glutes", "adductors"] },
        { pattern: "hip_adduction", primary: ["adductors"] },
      ),
    ).toBe(true);
  });

  it("ranks same pattern + same muscles above loosely related lifts", () => {
    const src = meta("Barbell Romanian Deadlift");
    expect(swapScore(src, meta("Dumbbell Romanian Deadlift"))).toBeGreaterThan(
      swapScore(src, meta("Hip Thrust")),
    );
    expect(swapScore(src, meta("Hip Thrust"))).toBeGreaterThan(
      swapScore(src, meta("Lat Pulldown")),
    );
  });
});

describe("quick swap suggestions", () => {
  const ex = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, name, muscle_group: null, category: null, equipment: null, ...extra }) as never;
  const pool = [
    ex("1", "Copenhagen Plank", { muscle_groups: ["adductors"], equipment: "Bodyweight" }),
    ex("2", "Cable Hip Abduction", { muscle_groups: ["glutes"], equipment: "Cable" }),
    ex("3", "Band Clamshell", { muscle_groups: ["glutes"], equipment: "Bands" }),
    ex("4", "Adductor Machine", { muscle_groups: ["adductors"], equipment: "Machine" }),
    ex("5", "Lat Pulldown", { muscle_groups: ["lats"], equipment: "Cable" }),
    ex("6", "Side Plank", { muscle_groups: ["core"], equipment: "Bodyweight" }),
  ];

  it("abduction machine → other abduction work first, never a lat pulldown", () => {
    const out = rankSuggestions(
      ex("0", "Abduction Machine", { muscle_groups: ["glutes"], equipment: "Machine" }),
      pool,
    );
    const names = out.map((s) => (s.ex as { name: string }).name);
    expect(names.slice(0, 2).sort()).toEqual(["Band Clamshell", "Cable Hip Abduction"]);
    expect(names).not.toContain("Lat Pulldown");
  });

  it("adductor machine → Copenhagen is the top bodyweight substitute", () => {
    const out = rankSuggestions(
      ex("0", "Hip Adduction Machine", { muscle_groups: ["adductors"], equipment: "Machine" }),
      pool,
    );
    const names = out.map((s) => (s.ex as { name: string }).name);
    expect(names[0]).toBe("Adductor Machine");
    expect(names[1]).toBe("Copenhagen Plank");
  });
});

describe("weekly muscle volume", () => {
  const today = new Date().toISOString();
  it("credits primary 1 set, secondary ½, and skips non-volume work", () => {
    const out = weeklyMuscleVolume([
      {
        date: today,
        primary_muscles: ["adductors"],
        secondary_muscles: ["core"],
        counts_toward_volume: true,
      },
      {
        date: today,
        primary_muscles: ["hamstrings", "glutes"],
        secondary_muscles: ["lower_back"],
        counts_toward_volume: true,
      },
      {
        date: today,
        primary_muscles: ["other"],
        secondary_muscles: [],
        counts_toward_volume: false,
      },
    ]);
    const by = Object.fromEntries(out.map((r) => [r.muscle, r.sets]));
    expect(by.Adductors).toBe(1);
    expect(by.Hamstrings).toBe(1);
    expect(by.Glutes).toBe(1);
    expect(by.Other).toBeUndefined();
  });

  it("falls back to the legacy single label for untagged rows", () => {
    const out = weeklyMuscleVolume([{ date: today, muscle_group: "Adductors" }]);
    expect(out).toEqual([{ muscle: "Adductors", sets: 1 }]);
  });
});
