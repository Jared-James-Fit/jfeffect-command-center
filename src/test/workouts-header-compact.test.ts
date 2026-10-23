import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/workouts/WorkoutsExperience.tsx");
const card = read("src/components/training-schedule-card.tsx");
const shell = read("src/components/app-shell.tsx");

describe("Workouts: a compact top, no schedule card", () => {
  it("the title and Today / Analytics / ⋮ share one row on the athlete's page; the coach's keeps the name whole", () => {
    expect(page).toContain("actionsInline={mode === \"self\"}");
    expect(shell).toContain("if (actionsInline && !showBack) {");
    expect(shell).toContain('<h1 className="min-w-0 truncate text-lg font-black');
  });
  it("the committed days are one chip beside Week / Month (tap to change them in a sheet), not a card", () => {
    expect(page).not.toContain("<TrainingScheduleCard");
    expect(page).toContain('<TrainingScheduleChip client={client as any} editable={mode === "self"} className="min-w-0" />');
    expect(card).toContain("export function TrainingScheduleChip(");
    expect(card).toContain('days.length >= 6 ? `${days.length} days a week` : days.join(" ")');
    expect(card).toContain('"Set your training days"');
    // the same editor and the same save, closing the sheet when it's done
    expect(card).toContain("<TrainingScheduleCard client={client} editable defaultEditing embedded onDone={() => setOpen(false)} />");
    expect(card).toContain("    onDone?.();");
  });
});
