import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/workouts/WorkoutsExperience.tsx");
const card = read("src/components/training-schedule-card.tsx");
const shell = read("src/components/app-shell.tsx");

describe("Workouts: a compact top, no schedule card", () => {
  it("Today sits by the week / month arrows and shows only once you've moved off today", () => {
    const strip = read("src/components/workouts/week-strip.tsx");
    expect(strip).toContain("{!isSameDay(selectedDate, today) && (");
    expect(page).toContain("<BackToToday selectedDate={selectedDate} onSelectDate={onSelectDate} />");
    expect(page).toContain("if (isSameDay(selectedDate, today)) return null;");
  });
  it("the title and ⋮ share one row on the athlete's page; the coach's keeps the name whole", () => {
    expect(page).toContain("actionsInline={mode === \"self\"}");
    // no Today or Analytics buttons up top: analytics is in ⋮ and the month card
    expect(page).not.toContain('<Sun className="h-3.5 w-3.5" /> Today');
    expect(page).not.toContain('aria-label="Open training analytics"');
    expect(page).toContain("<Activity className=\"mr-2 h-4 w-4\" /> Training analytics");
    expect(shell).toContain("if (actionsInline && !showBack) {");
    expect(shell).toContain('<h1 className="min-w-0 truncate text-lg font-bold');
  });
  it("the committed days are a chip only while they still need setting; once set they live in ⋯ (same sheet), never a card", () => {
    expect(page).not.toContain("<TrainingScheduleCard");
    expect(page).toContain('{showDaysChip && !noProgram && <TrainingScheduleChip client={client as any} editable={mode === "self"} className="min-w-0" />}');
    expect(page).toContain('const showDaysChip = !!client && (mode === "coach" || !!daysState?.needed);');
    expect(page).toContain("<CalendarCheck className=\"mr-2 h-4 w-4\" /> Training days");
    expect(page).toContain("<TrainingDaysSheet client={client as any} open={daysOpen} onOpenChange={setDaysOpen} />");
    expect(card).toContain("export function TrainingScheduleChip(");
    expect(card).toContain('days.length >= 6 ? `${days.length} days a week` : days.join(" ")');
    expect(card).toContain('"Set your training days"');
    // the same editor and the same save, closing the sheet when it's done
    expect(card).toContain("<TrainingScheduleCard client={client} editable defaultEditing embedded onDone={() => onOpenChange(false)} />");
    expect(card).toContain("    onDone?.();");
  });
});
