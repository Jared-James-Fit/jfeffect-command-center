import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Workouts page: program roadmap under the calendar", () => {
  const src = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  it("renders after the calendar / Block View tabs, before cardio and analytics", () => {
    const tabsEnd = src.indexOf("</Tabs>");
    const card = src.indexOf("<ProgramRoadmapCard");
    expect(tabsEnd).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(tabsEnd);
    expect(card).toBeLessThan(src.indexOf("<ClientCardioSection"));
  });
  it("is compact by default with an expandable roadmap and per-block weeks", () => {
    const card = readFileSync("src/components/workouts/program-roadmap.tsx", "utf8");
    expect(card).toContain("See the full roadmap");
    expect(card).toContain("Open workouts in Block View");
    expect(card).toContain("<WeekPills");
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
