import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FAMILY_ACCENT, FAMILY_BLOCK, FAMILY_CHIP, FAMILY_MONTH_CHIP, statusMark, statusWord } from "@/lib/calendar-palette";

/** Every screen a calendar or its bookings are drawn on. */
const CALENDAR_FILES = [
  "src/lib/calendar-palette.ts",
  "src/lib/calendar-sources.ts",
  "src/components/calendar/time-grid.tsx",
  "src/components/calendar/today-panel.tsx",
  "src/components/calendar/week-strip.tsx",
  "src/components/schedule/agenda.tsx",
  "src/components/schedule/home-calendar-views.tsx",
  "src/components/schedule/client-session-sheet.tsx",
  "src/components/schedule/session-actions-sheet.tsx",
  "src/components/schedule/use-conflict-check.tsx",
  "src/components/workouts/week-strip.tsx",
  "src/components/booking/availability-panel.tsx",
];

describe("the calendar is neutral (Nov 21 2026)", () => {
  it("draws no purple, violet or indigo anywhere a calendar shows", () => {
    for (const f of CALENDAR_FILES) expect(readFileSync(f, "utf8"), f).not.toMatch(/\b(violet|purple|indigo|fuchsia)-\d/);
  });
  it("keeps bookings in the text colour, Google muted grey, and red for nothing routine", () => {
    for (const map of [FAMILY_BLOCK, FAMILY_MONTH_CHIP, FAMILY_ACCENT]) {
      for (const cls of Object.values(map)) expect(cls).not.toMatch(/primary|destructive|red-/);
    }
    expect(FAMILY_BLOCK.people).toMatch(/foreground/);
    expect(FAMILY_BLOCK.google).toMatch(/muted/);
    expect(FAMILY_CHIP.google.chip + FAMILY_CHIP.google.dot).toMatch(/muted/);
  });
  it("says a status in more than a colour: a check for done, crossed out and named for the rest", () => {
    expect(statusMark("Completed")).toBe("done");
    expect(statusMark("cancelled")).toBe("struck");
    expect(statusMark("no_show")).toBe("struck");
    expect(statusMark("Scheduled")).toBeNull();
    expect(statusWord("no_show")).toBe("No-show");
    expect(statusWord("rescheduled")).toBe("Moved");
    expect(statusWord("Scheduled")).toBeNull();
  });
});
