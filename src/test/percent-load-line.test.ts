import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maxReference, percentLoadLine, rpeCap } from "@/lib/percent-load-line";

describe("the line under a % prescription: what it's of, and the RPE as its cap", () => {
  it("names a Training Max row's reference, read through its competition lift", () => {
    const ref = maxReference(
      { lift: "High Bar Squat", unit: "kg", source_lift: "Competition Squat", variation_modifier: 100, manual_override: false },
      235,
      "kg",
    );
    expect(ref).toEqual({ lift: "Competition Squat", value: 235, unit: "kg" });
    expect(percentLoadLine({ percentage: 62.5, basis: "training_max", rpe: "5-6", reference: ref })).toBe(
      "62.5% of Training Max (Competition Squat 235 kg) · RPE cap 6",
    );
  });

  it("a variation at anything but 100% names itself, and a lb max reads in lb", () => {
    expect(
      maxReference({ lift: "Paused Squat", unit: "kg", source_lift: "Competition Squat", variation_modifier: 90 }, 211.5, "kg")?.lift,
    ).toBe("Paused Squat");
    expect(maxReference({ lift: "Competition Bench Press", unit: "lb", source_lift: null }, 315 / 2.2046226218, "kg")).toEqual({
      lift: "Competition Bench Press",
      value: 315,
      unit: "lb",
    });
    expect(maxReference(null, 100, "kg")).toBeNull();
    expect(maxReference({ lift: "x", unit: "kg" }, null, "kg")).toBeNull();
  });

  it("a back-off says it's from today's top set, with the top set once it's logged", () => {
    expect(percentLoadLine({ percentage: "92.5", basis: "top_set", rpe: "6" })).toBe(
      "92.5% of today's top set, once the top set is logged · RPE cap 6",
    );
    expect(percentLoadLine({ percentage: 92.5, basis: "top_set", rpe: "6", linkedLoad: { value: 425, unit: "lb" } })).toBe(
      "92.5% of today's top set (425 lb) · RPE cap 6",
    );
    expect(percentLoadLine({ percentage: 80, basis: "top_set", rpe: "5-6", linkedLoad: { value: 247.5, unit: "kg" } })).toBe(
      "80% of today's top set (247.5 kg) · RPE cap 6",
    );
  });

  it("with no max on file it says so and points at the RPE, never a made-up load", () => {
    expect(percentLoadLine({ percentage: 60, basis: "training_max", rpe: "5" })).toBe(
      "60% of Training Max · none on file yet, go by RPE · RPE cap 5",
    );
  });

  it("nothing for a fixed load, no %, or a basis it doesn't know", () => {
    expect(percentLoadLine({ percentage: null, basis: "training_max" })).toBeNull();
    expect(percentLoadLine({ percentage: 70, basis: "manual" })).toBeNull();
    expect(percentLoadLine({ percentage: 70, basis: "none" })).toBeNull();
    expect(percentLoadLine({ percentage: 70, basis: null })).toBeNull();
    expect(percentLoadLine({ percentage: 70, basis: "1rm" })).toBe("70% of 1RM · none on file yet, go by RPE");
  });

  it("a range's cap is its top", () => {
    expect(rpeCap("5-6")).toBe("6");
    expect(rpeCap("8-8.5")).toBe("8.5");
    expect(rpeCap("5–6")).toBe("6");
    expect(rpeCap(7)).toBe("7");
    expect(rpeCap("")).toBeNull();
    expect(rpeCap("max")).toBeNull();
  });

  it("the logger shows it under the prescription, and a % of a max is the coach's load", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain('<p className="mt-0.5 text-xs text-muted-foreground" data-pct-line>{pctLine}</p>');
    expect(wdv).toContain("reference: computed?.status === \"ok\" ? maxReference(computed.max, computed.base, computed.unit) : null,");
    // the RPE engine never suggests over a % of a max (it waits while the max loads)
    expect(wdv).toContain("const pctLoadIsCoachs = maxBasedPct && (maxesPending || (computed?.status === \"ok\" && computed.load != null));");
  });
});
