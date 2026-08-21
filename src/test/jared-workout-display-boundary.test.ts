import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/components/workouts/WorkoutsExperience.tsx"),
  "utf8",
);

describe("Jared workout display boundary", () => {
  it("derives the page header from the selected calendar workout before falling back", () => {
    expect(source).toContain("const selectedItems = byDate.get(toLocalISO(selectedDate)) ?? [];");
    expect(source).toContain("const selectedHeaderItem = selectedPrimaryItems[0] ?? null;");
    expect(source).toContain("const headerItem = selectedHeaderItem ?? fallbackHeaderItem;");
    expect(source).toContain("const headerWeek = headerItem?.week ?? null;");
  });

  it("does not infer Continue Workout from an empty completion row", () => {
    expect(source).not.toContain(
      "const inProgress = !!item.completion && !item.completion?.completed_at;",
    );
    expect(source).toContain('if (status === "in_progress")');
    expect(source).toContain('case "missed":');
    expect(source).toContain('label: "View Workout"');
    expect(source).toContain('secondary: { label: "Start Workout", search: { start: 1 } }');
  });
});
