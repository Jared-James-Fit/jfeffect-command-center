import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const summary = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout submission summary mobile layout", () => {
  it("uses a bounded scroll area with fixed header and footer", () => {
    expect(summary).toContain("max-h-[92svh]");
    expect(summary).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(summary).toContain("shrink-0 border-t");
  });

  it("keeps key metrics compact instead of stacking oversized cards", () => {
    expect(summary).toContain("MetricHero");
    expect(summary).toContain("CompactMetric");
    expect(summary).toContain("MiniStat");
    expect(summary).toContain("Back to workout");
  });

  it("does not repeat the PR takeaway when a dedicated PR card is present", () => {
    expect(summary).toContain("takeaways.filter((t) => !/^🏆/.test(t.trim()))");
  });
});
