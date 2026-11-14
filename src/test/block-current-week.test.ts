import { describe, expect, it } from "vitest";
import { computeWeekRange, isCurrentWeek } from "@/lib/block-dates";

describe("the current week", () => {
  it("is never two weeks at once: the day after a week ends belongs to the next", () => {
    const w1 = computeWeekRange("2026-11-02", 1)!; // Mon Nov 2 – Sun Nov 8
    const w2 = computeWeekRange("2026-11-02", 2)!; // Mon Nov 9 – Sun Nov 15
    const day = (iso: string) => new Date(`${iso}T00:00:00`);
    expect(isCurrentWeek(w1, day("2026-11-08"))).toBe(true);
    expect(isCurrentWeek(w2, day("2026-11-08"))).toBe(false);
    expect(isCurrentWeek(w1, day("2026-11-09"))).toBe(false);
    expect(isCurrentWeek(w2, day("2026-11-09"))).toBe(true);
    expect(isCurrentWeek(w1, day("2026-11-02"))).toBe(true);
  });
});
