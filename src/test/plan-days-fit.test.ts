import { describe, expect, it } from "vitest";
import { fitTrainingDays, listDays, weekOnePreview } from "@/lib/plan-days-fit";

describe("starting a plan fits its workouts to the days someone trains", () => {
  it("keeps their days when the plan matches", () => {
    expect(fitTrainingDays(["Monday", "Tuesday", "Thursday", "Friday"], 4)).toEqual({
      days: ["Monday", "Tuesday", "Thursday", "Friday"], added: [], dropped: [],
    });
  });

  it("a 5-day plan on a Mon/Tue/Thu/Fri week adds Saturday, not a 5-in-a-row Wednesday", () => {
    const fit = fitTrainingDays(["Monday", "Tuesday", "Thursday", "Friday"], 5);
    expect(fit.added).toEqual(["Saturday"]);
    expect(fit.days).toEqual(["Monday", "Tuesday", "Thursday", "Friday", "Saturday"]);
  });

  it("a 3-day plan on a Mon–Fri week keeps Mon, Wed, Fri", () => {
    const fit = fitTrainingDays(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], 3);
    expect(fit.days).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(fit.dropped).toEqual(["Tuesday", "Thursday"]);
  });

  it("nothing committed yet: a spread-out week, Monday first", () => {
    expect(fitTrainingDays([], 3).days).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(fitTrainingDays([], 4).days).toHaveLength(4);
    expect(fitTrainingDays([], 7).days).toHaveLength(7);
  });

  it("no known plan size leaves the days alone", () => {
    expect(fitTrainingDays(["Friday", "Monday"], null).days).toEqual(["Monday", "Friday"]);
  });

  it("week 1 runs from the start date, so a mid-week start begins on the next training day", () => {
    // Wed 2026-10-21 start, training Mon/Thu: Thu 22 is Day 1, Mon 26 is Day 2
    expect(weekOnePreview("2026-10-21", ["Monday", "Thursday"])).toEqual([
      { day: 1, date: "2026-10-22" },
      { day: 2, date: "2026-10-26" },
    ]);
    expect(weekOnePreview("", ["Monday"])).toEqual([]);
  });

  it("lists days the way people say them", () => {
    expect(listDays(["Saturday"])).toBe("Sat");
    expect(listDays(["Monday", "Wednesday", "Friday"])).toBe("Mon, Wed and Fri");
  });
});
