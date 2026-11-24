import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Workouts page: program roadmap under the calendar", () => {
  const src = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  it("renders after the day (calendar / Block view), before readiness and the month", () => {
    const blockView = src.indexOf("<BlockViewTab");
    const card = src.indexOf("<ProgramRoadmapCard");
    expect(blockView).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(blockView);
    // the program summary, then the Performance card
    expect(card).toBeLessThan(src.indexOf("<PerformanceCard"));
    // the day's cardio is the day's (useDayCardio in SelectedDayList), never a section at the bottom
    expect(src).not.toContain("<ClientCardioSection");
  });
  it("is a compact summary (name, week, phase, one bar); every phase and week one tap away; no fold", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    // the card names the current phase in its one line; upcoming phases are the full plan's (Nov 22 2026)
    expect(card).toContain("data-program-phase");
    expect(card).not.toContain("data-roadmap-timeline");
    expect(card).not.toContain("<span>Plan details</span>");
    // the whole plan (every week and what it's for) opens in one sheet from "Full plan" or a block
    expect(card).toContain("data-roadmap-toggle");
    expect(card).toContain("<span>Full plan</span>");
    expect(card).toContain("function ProgramPlanSheet(");
    expect(card).toContain("See the workouts");
    expect(card).toContain("<ProgramBar blocks={blocks} />");
    expect(card).not.toContain("WeekPills");
  });
  it("is the one place that says the block and week, in neutral ink (no red bar)", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(card).toContain("{blockTitle(b)}");
    expect(card).toContain('<div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />');
    expect(card).not.toMatch(/bg-primary|text-primary/);
    // the program's own week is the one week number, on the line under its name
    expect(card).toContain("const progress = roadmapProgressParts(roadmap, todayLocalISO());");
    expect(card).not.toContain("programWeekText");
    // a week's label never repeats its number ("Week 1 · Week 1 · Calibration")
    expect(card).toContain("weekParts(thisWeek)");
  });
  it("reads in one pass: the program's name, the week, one bar, then the phases", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(card).not.toContain("rounded-xl border border-primary/30 bg-primary/5");
    expect(card).not.toContain("% through");
    expect(card).toContain("blockNameParts(b.name)");
    // other programs are looked at in the plan sheet; the card is always today's program
    expect(card).toContain('<ProgramList programs={roadmap.programs}');
    expect(card).toContain("const name = programHeading(roadmap.program, true);");
    expect(card).toContain("data-program-name");
    expect(card).toContain("data-program-progress");
  });
});
