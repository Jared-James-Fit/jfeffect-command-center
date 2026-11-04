import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/components/workouts/WorkoutsExperience.tsx"),
  "utf8",
);

describe("Jared workout display boundary", () => {
  it("the day's card reads the picked date; the block is the Program card's, so the header derives nothing", () => {
    expect(source).toContain("items={byDate.get(toLocalISO(selectedDate)) ?? []}");
    // a workout from another block than the current one names its own block on its card
    expect(source).toContain("const currentBlockId = todayItem?.block?.id ?? pickCurrentBlock(allBlocks, today)?.id ?? null;");
    expect(source).toContain("pageBlockId={currentBlockId}");
    expect(source).not.toContain("const headerItem =");
    expect(source).not.toContain("subtitle={subtitle");
  });

  it("does not infer Continue Workout from an empty completion row", () => {
    expect(source).not.toContain(
      "const inProgress = !!item.completion && !item.completion?.completed_at;",
    );
    expect(source).toContain('if (status === "in_progress")');
    expect(source).toContain('case "missed":');
    expect(source).toContain('label: "View Workout"');
    // A missed workout leads with Start (one main button; View went to the same page).
    const cta = source.slice(source.indexOf("function primaryCtaFor("));
    const missed = cta.slice(cta.indexOf('case "missed":'), cta.indexOf('case "today":'));
    expect(missed).toContain('label: "Start Workout"');
    expect(missed).not.toContain("View Workout");
  });
});
