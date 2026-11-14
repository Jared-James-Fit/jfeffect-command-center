import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const summary = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout submission summary mobile layout", () => {
  it("uses a bounded mobile sheet with a scrollable body and fixed footer", () => {
    expect(summary).toContain('maxHeight: "min(94svh, 800px)"');
    expect(summary).toContain("sm:max-w-[520px]");
    expect(summary).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(summary).toContain("shrink-0 border-t");
    expect(summary).toContain("Close workout summary");
  });

  it("reveals completion, score, then analytics instead of opening as a static card", () => {
    expect(summary).toContain("revealStage");
    expect(summary).toContain("requestAnimationFrame");
    expect(summary).toContain("Workout complete");
    expect(summary).toContain("{displayScore}");
    expect(summary).toContain("animate-in");
  });

  it("progressively hides analytics that do not have useful data", () => {
    expect(summary).toContain("summary.totalLifted > 0");
    expect(summary).toContain("summary.avgRpe != null");
    expect(summary).toContain("durationMin != null && durationMin > 0");
    expect(summary).toContain("Baseline logged");
    // one score on the recap: no second "Recovery /100" or a Completed % beside Sets (Nov 14 2026)
    expect(summary).not.toContain('label="Recovery"');
    expect(summary).not.toContain('label="Completed"');
  });

  it("does not repeat the PR takeaway when a dedicated PR reveal is present", () => {
    expect(summary).toContain("takeaways.filter((t) => !/^🏆/.test(t.trim()))");
    expect(summary).toContain("Personal records");
  });
});
