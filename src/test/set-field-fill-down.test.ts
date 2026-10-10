import { describe, expect, it } from "vitest";
import { planFieldCascade, validateSetField } from "@/lib/set-input-cascade";
import { applyOptimisticSetResult } from "@/lib/optimistic-set-result";

const sets = (...xs: Array<Partial<{ value: string; completed: boolean; manual: boolean }>>) =>
  xs.map((x, i) => ({ index: i + 1, value: "", completed: false, manual: false, ...x }));

describe("reps / RPE fill-down (planFieldCascade)", () => {
  it("fills every set below that wasn't set by hand", () => {
    expect(planFieldCascade(1, "6", sets({ value: "7" }, {}, {}, {}))).toEqual([2, 3, 4]);
  });
  it("never flows upward", () => {
    expect(planFieldCascade(3, "6", sets({}, {}, {}, {}))).toEqual([4]);
  });
  it("stops at a set the athlete typed by hand", () => {
    expect(planFieldCascade(1, "6", sets({}, {}, { manual: true }, {}))).toEqual([2]);
  });
  it("updates completed sets that were just following the old value (works after a reload)", () => {
    expect(planFieldCascade(1, "6", sets({ value: "7", completed: true }, { value: "6", completed: true }, { value: "6.0", completed: true }))).toEqual([2, 3]);
  });
  it("stops at a completed set holding its own different rating", () => {
    expect(planFieldCascade(1, "6", sets({ completed: true }, { value: "6", completed: true }, { value: "8", completed: true }, {}))).toEqual([2]);
  });
});

describe("typed reps / RPE validation", () => {
  it("accepts whole reps and rejects junk", () => {
    expect(validateSetField("reps", "5")).toEqual({ ok: true, value: "5" });
    expect(validateSetField("reps", "5.5").ok).toBe(false);
    expect(validateSetField("reps", "999").ok).toBe(false);
  });
  it("RPE is 1–10 in half steps; commas work; blank clears", () => {
    expect(validateSetField("rpe", "8.5")).toEqual({ ok: true, value: "8.5" });
    expect(validateSetField("rpe", "7,5")).toEqual({ ok: true, value: "7.5" });
    expect(validateSetField("rpe", "8.3")).toEqual({ ok: true, value: "8.5" });
    expect(validateSetField("rpe", "11").ok).toBe(false);
    expect(validateSetField("rpe", "0").ok).toBe(false);
    expect(validateSetField("rpe", "")).toEqual({ ok: true, value: "" });
  });
  it("RIR allows 0", () => {
    expect(validateSetField("rir", "0")).toEqual({ ok: true, value: "0" });
  });
});

describe("partial optimistic patches", () => {
  it("an RPE-only patch never wipes the set's load", () => {
    const rows = [{ id: "a", row_id: "r", set_index: 2, actual_load: 315, entered_value: 315, normalized_lb: 315, normalized_kg: 142.88, actual_rpe_num: null }];
    const out = applyOptimisticSetResult(rows, { row_id: "r", set_index: 2, actual_rpe: "7", actual_rpe_num: 7 }, "a")!;
    expect(out[0].normalized_lb).toBe(315);
    expect(out[0].normalized_kg).toBe(142.88);
    expect(out[0].actual_rpe_num).toBe(7);
  });
});
