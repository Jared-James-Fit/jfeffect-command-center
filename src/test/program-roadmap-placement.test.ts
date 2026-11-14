import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Workouts page: program roadmap under the calendar", () => {
  const src = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  it("renders after the calendar / Block view, before cardio and analytics", () => {
    const blockView = src.indexOf("<BlockViewTab");
    const card = src.indexOf("<ProgramRoadmapCard");
    expect(blockView).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(blockView);
    expect(card).toBeLessThan(src.indexOf("<ClientCardioSection"));
  });
  it("is compact by default with an expandable roadmap; one bar, no week pills on top of it", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(card).toContain("See the full roadmap");
    expect(card).toContain("Open workouts in Block View");
    expect(card).toContain("<ProgramBar blocks={blocks} />");
    expect(card).not.toContain("WeekPills");
  });
  it("is the one place that says the block and week, in neutral ink (no red or green bar)", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(card).toContain("? blockTitle(current)");
    expect(card).toContain("`Block ${currentIdx + 1} of ${blocks.length}`");
    expect(card).toContain('<div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />');
    expect(card).not.toMatch(/bg-primary|text-primary/);
    // the program's own week rides on the roadmap row
    expect(card).toContain(
      "{programWeekText ?? (blocks.length > 1 ? `${blocks.length} blocks` : weeksLabel(blocks[0].weekCount))}",
    );
  });
  it("reads in one pass: the program's name, the week, one bar, then this block and this week", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    // no box inside the card, no repeated counts under the bar, no "Block 1 — …" under the block's own name
    expect(card).not.toContain("rounded-xl border border-primary/30 bg-primary/5");
    expect(card).not.toContain("% through");
    expect(card).toContain("blockNameParts(b.name)");
    // the program picker is the name itself; Active only says something when you're looking at another one
    expect(card).toContain('aria-label="Choose a program"');
    expect(card).not.toContain("programs.length} programs");
    expect(card).toContain('text-[14px] leading-relaxed');
  });
});
