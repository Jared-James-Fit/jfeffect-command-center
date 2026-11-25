import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const summary = readFileSync("src/components/workout-submission-summary.tsx", "utf8");

describe("workout submission summary mobile layout", () => {
  it("uses a bounded mobile sheet with a scrollable body and fixed footer", () => {
    // bounded by the dynamic viewport ("Optimize workout recap…", Sep 27 2026: was min(94svh, 800px))
    expect(summary).toContain('style={{ height: "min(96dvh, 820px)", maxHeight: "96dvh" }}');
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
    // only the stats this workout has (completion-screen.ts completionStats, Nov 25 2026)
    expect(summary).toContain("summary.totalLifted > 0");
    expect(summary).toContain("completionStats({");
    // one score on the recap: no second "Recovery /100" or a Completed % beside Sets (Nov 14 2026)
    expect(summary).not.toContain('label="Recovery"');
    expect(summary).not.toContain('label="Completed"');
  });

  it("does not repeat the PR takeaway when a dedicated PR reveal is present", () => {
    expect(summary).toContain("takeaways.filter((t) => !/^🏆/.test(t.trim()))");
    // the dedicated reveal: the server's records under "New records" (the headline-PR rule),
    // else (memberships' session PRs) its own all-time record box
    expect(summary).toContain("{records && <NewRecordsSection records={records} unit={displayUnit} setUnit={setUnit} highlight={!!lead} />}");
    expect(readFileSync("src/components/records/training-records.tsx", "utf8")).toContain(">New records</div>");
    // one records line (subtle gold only for a headline PR), the list behind it
    expect(summary).toContain("recordsText(recLine)");
    expect(summary).toContain('data-recap-records={bigMoment ? "headline" : "quiet"}');
  });
});
