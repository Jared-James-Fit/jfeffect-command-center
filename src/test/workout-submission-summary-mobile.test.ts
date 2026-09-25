import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const summary = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout submission summary mobile layout", () => {
  it("uses a bounded mobile modal with a fixed header, scrollable body, and fixed footer", () => {
    expect(summary).toContain("max-h-[90svh]");
    expect(summary).toContain("max-w-[440px]");
    expect(summary).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(summary).toContain("shrink-0 border-t");
    expect(summary).toContain("Close workout summary");
  });

  it("keeps the hierarchy compact and easy to scan", () => {
    expect(summary).toContain("MetricHero");
    expect(summary).toContain("CompactStat");
    expect(summary).toContain("Session stats");
    expect(summary).toContain("grid grid-cols-2 gap-2");
    expect(summary).toContain("Back to workout");
  });

  it("does not repeat the PR takeaway when a dedicated PR card is present", () => {
    expect(summary).toContain("takeaways.filter((t) => !/^🏆/.test(t.trim()))");
  });
});
