import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";

function row(load: number, i: number, extra: Record<string, unknown> = {}) {
  return {
    exercise_id: "bench",
    exercise_name: "Competition Bench Press",
    load,
    counts_load: true,
    est_1rm: load * 1.1,
    reps: 3,
    date: `2026-09-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
    ...extra,
  };
}

describe("analytics load sanity", () => {
  it("leaves normal training progression untouched", () => {
    const input = [95, 100, 105, 110, 115, 120].map((v, i) => row(v, i));
    const out = neutralizeObviousLoadOutliers(input);
    expect(out.map((x) => x.load)).toEqual([95, 100, 105, 110, 115, 120]);
    expect(out.some((x) => x.analytics_load_outlier)).toBe(false);
  });

  it("neutralizes an absurd one-off load while preserving the set row", () => {
    const input = [95, 105, 110, 115, 755.3467].map((v, i) => row(v, i));
    const out = neutralizeObviousLoadOutliers(input);
    expect(out).toHaveLength(input.length);
    const bad = out[out.length - 1];
    expect(bad.analytics_load_outlier).toBe(true);
    expect(bad.analytics_excluded_load_lb).toBeCloseTo(755.3467);
    expect(bad.load).toBe(0);
    expect(bad.counts_load).toBe(false);
    expect(bad.est_1rm).toBe(0);
  });

  it("does not guess from too little exercise history", () => {
    const input = [100, 110, 900].map((v, i) => row(v, i));
    const out = neutralizeObviousLoadOutliers(input);
    expect(out[2].load).toBe(900);
    expect(out[2].analytics_load_outlier).toBeUndefined();
  });

  it("evaluates exercises independently", () => {
    const bench = [95, 100, 105, 110, 800].map((v, i) => row(v, i));
    const deadlift = [405, 425, 455, 475, 500].map((v, i) =>
      row(v, i + 10, {
        exercise_id: "deadlift",
        exercise_name: "Competition Deadlift",
      }),
    );
    const out = neutralizeObviousLoadOutliers([...bench, ...deadlift]);
    expect(out.filter((x) => x.analytics_load_outlier)).toHaveLength(1);
    expect(out.find((x) => x.exercise_id === "deadlift" && x.load === 500)).toBeTruthy();
  });

  it("requires completed_at in the canonical analytics query", () => {
    const source = readFileSync("src/lib/pl-programs.ts", "utf8");
    const queryStart = source.indexOf('.from("pl_row_results")');
    const mapStart = source.indexOf("const mapped =", queryStart);
    const querySlice = source.slice(queryStart, mapStart);
    expect(querySlice).toContain('.not("completed_at", "is", null)');
    expect(source).toContain("return neutralizeObviousLoadOutliers(mapped);");
  });
});
