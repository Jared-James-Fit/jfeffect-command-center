import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkoutCta, composePainArea, parsePainArea } from "@/lib/workout-review";

describe("pain side in the review", () => {
  it("writes the side the way earlier reviews stored it", () => {
    expect(composePainArea("Shoulder", "R")).toBe("Shoulder (R)");
    expect(composePainArea("Knee", "L")).toBe("Knee (L)");
    expect(composePainArea("Knee", "both")).toBe("Knee (L), Knee (R)");
    expect(composePainArea("Shoulder", null)).toBe("Shoulder");
    // Low back / Other have no side.
    expect(composePainArea("Low back", "R")).toBe("Low back");
  });

  it("reads stored values back into chip + side; unknown values stay as written", () => {
    expect(parsePainArea("Shoulder (R)")).toEqual({ area: "Shoulder", side: "R" });
    expect(parsePainArea("Knee (L), Knee (R)")).toEqual({ area: "Knee", side: "both" });
    expect(parsePainArea("Low back")).toEqual({ area: "Low back", side: null });
    expect(parsePainArea("General")).toEqual({ area: null, side: null });
    expect(parsePainArea("Shoulder (L), Knee (R)")).toEqual({ area: null, side: null });
    expect(parsePainArea(null)).toEqual({ area: null, side: null });
  });

  it("an older free-text area still saves; only a missing area blocks", () => {
    const base = { isEdit: true, effort: 7, pain: true, sleepBucket: null, recoveryToday: null };
    expect(checkoutCta({ ...base, painArea: "General" }).enabled).toBe(true);
    expect(checkoutCta({ ...base, painArea: null }).label).toBe("Pick where it hurts");
  });

  it("the editor says where to tap when an area is missing, and offers Left / Right / Both", () => {
    const ed = readFileSync("src/components/workout/shared/workout-review-editor.tsx", "utf8");
    expect(ed).toContain('{storedArea ? "Where" : "Where does it hurt? Tap one"}');
    expect(ed).toContain("painArea && SIDED_PAIN_AREAS.includes(painArea)");
    expect(ed).toContain("painArea: pain ? storedArea : null,");
  });
});
