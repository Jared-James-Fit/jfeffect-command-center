import { describe, expect, it } from "vitest";
import { exerciseKey, planMove, withOccurrence } from "@/lib/exercise-move";

const k = (...names: string[]) => withOccurrence(names.map((n) => `name:${n}`));

describe("exerciseKey", () => {
  it("matches the same exercise across weeks by name, not library record", () => {
    expect(exerciseKey({ exercise_id: "a", exercises: { name: "Bench Press" } })).toBe(
      exerciseKey({ exercise_id: "b", exercises: { name: " bench press " } }),
    );
    expect(exerciseKey({ exercise_name_override: "Pause Squat", exercise_id: "x" })).toBe("name:pause squat");
  });
  it("falls back to the library id when there is no name", () => {
    expect(exerciseKey({ exercise_id: "abc" })).toBe("id:abc");
    expect(exerciseKey({})).toBe("unknown");
  });
});

describe("withOccurrence", () => {
  it("tells a back-off set apart from the top set", () => {
    expect(withOccurrence(["a", "b", "a"])).toEqual(["a#0", "b#0", "a#1"]);
  });
});

describe("planMove", () => {
  const [A, B, C, D] = k("a", "b", "c", "d");

  it("moving X up one step puts it above the exercise it now sits above", () => {
    // source was A B C D, C moved up -> A C B D (prev A, next B)
    expect(planMove([A, B, C, D], C, A, B)).toEqual([A, C, B, D]);
  });
  it("moving X down one step", () => {
    // source was A B C D, B moved down -> A C B D (prev C, next D)
    expect(planMove([A, B, C, D], B, C, D)).toEqual([A, C, B, D]);
  });
  it("moved to the top / bottom goes to the top / bottom", () => {
    expect(planMove([A, B, C, D], D, null, A)).toEqual([D, A, B, C]);
    expect(planMove([A, B, C, D], A, D, null)).toEqual([B, C, D, A]);
  });
  it("leaves exercises that only exist in the later workout where they are", () => {
    const [x, y, z, q] = k("a", "b", "c", "extra");
    // later week has an extra exercise between A and B
    expect(planMove([x, q, y, z], z, x, y)).toEqual([x, q, z, y]);
  });
  it("anchors below the previous exercise when the next one isn't in that workout", () => {
    const [x, y, z, gone] = k("a", "b", "c", "gone");
    expect(planMove([x, y, z], z, x, gone)).toEqual([x, z, y]);
  });
  it("does nothing when the exercise isn't in the later workout", () => {
    expect(planMove([A, B, D], C, A, B)).toBeNull();
  });
  it("does nothing when it can't anchor to either neighbour", () => {
    const [x, y, z, g1, g2] = k("a", "b", "c", "g1", "g2");
    expect(planMove([x, y, z], z, g1, g2)).toBeNull();
  });
  it("does nothing when the later workout is already in that order", () => {
    expect(planMove([A, C, B, D], C, A, B)).toBeNull();
  });
  it("keeps every exercise exactly once", () => {
    const out = planMove([A, B, C, D], A, D, null)!;
    expect([...out].sort()).toEqual([A, B, C, D].sort());
  });
  it("targets the right duplicate", () => {
    const [s0, b0, s1] = k("squat", "bench", "squat"); // squat#0, bench#0, squat#1
    // the back-off squat (#1) moved to the top of the source
    expect(planMove([s0, b0, s1], s1, null, s0)).toEqual([s1, s0, b0]);
  });
});
