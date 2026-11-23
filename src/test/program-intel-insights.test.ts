import { describe, expect, it } from "vitest";
import { buildGeneratorIntel } from "@/lib/program-intel/intelligence";
import { adherenceGrid, buildInsights, overviewSparks, sparkPath } from "@/lib/program-intel/insights";
import { bodybuilder, homeGym, powerlifter } from "./program-intel-scenarios";

describe("insights: one card per underlying issue", () => {
  it("never says the same exercise twice, and ranks risks first", () => {
    for (const rec of [homeGym(), powerlifter(), bodybuilder()]) {
      const intel = buildGeneratorIntel(rec);
      const ins = buildInsights(intel);
      const ids = ins.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
      // an exercise appears in at most one card
      const exCards = ins.filter((i) => i.id.startsWith("ex:"));
      expect(new Set(exCards.map((i) => i.id)).size).toBe(exCards.length);
      for (let k = 1; k < ins.length; k++) expect(ins[k].priority).toBeGreaterThanOrEqual(ins[k - 1].priority);
      // every card says what kind of statement it is
      expect(ins.every((i) => ["fact", "hypothesis", "missing", "approved"].includes(i.kind))).toBe(true);
    }
  });

  it("the records' gaps are one card, not one per gap", () => {
    const ins = buildInsights(buildGeneratorIntel(bodybuilder()));
    expect(ins.filter((i) => i.kind === "missing").length).toBeLessThanOrEqual(1);
  });

  it("what the coach confirmed reads as approved", () => {
    const ins = buildInsights(buildGeneratorIntel(powerlifter()), [{ statement: "Bench responds to 3x a week", date: "2026-10-01" }]);
    const a = ins.find((i) => i.kind === "approved" && i.title === "Bench responds to 3x a week");
    expect(a?.detail).toContain("You confirmed this on 2026-10-01");
  });
});

describe("overview pictures", () => {
  it("a heatmap of the last weeks, Monday to Sunday", () => {
    const grid = adherenceGrid(
      [
        { date: "2026-11-02", status: "completed" },
        { date: "2026-11-04", status: "missed" },
        { date: "2026-11-04", status: "partial" },
        { date: "2026-11-25", status: "upcoming" },
      ],
      "2026-11-23",
      4,
    );
    expect(grid).toHaveLength(4);
    expect(grid[3].start).toBe("2026-11-23");
    expect(grid.every((w) => w.cells.length === 7)).toBe(true);
    const nov2 = grid.flatMap((w) => w.cells).find((c) => c.date === "2026-11-02")!;
    expect(nov2.status).toBe("done");
    // a day both missed and logged reads as logged
    expect(grid.flatMap((w) => w.cells).find((c) => c.date === "2026-11-04")!.status).toBe("partial");
    expect(grid.flatMap((w) => w.cells).find((c) => c.date === "2026-11-25")!.status).toBe("planned");
    expect(grid.flatMap((w) => w.cells).find((c) => c.date === "2026-11-28")!.status).toBe("future");
  });

  it("sparklines are each exercise against itself", () => {
    expect(sparkPath([1], 60, 20)).toBeNull();
    expect(sparkPath([100, 110, 105], 60, 20)).toMatch(/^M2\.0 18\.0 L/);
    const intel = buildGeneratorIntel(powerlifter());
    const sparks = overviewSparks(intel.history, true);
    expect(sparks.length).toBeGreaterThan(0);
    expect(new Set(sparks.map((s) => s.label)).size).toBe(sparks.length);
  });
});
