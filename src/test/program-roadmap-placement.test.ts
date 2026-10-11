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
});
