import { describe, expect, it } from "vitest";
import { defaultPlanEvent, eventCountdown, planMilestones, plansOnDate, type PlanEvent } from "./plan-event-timeline";

const event: PlanEvent = { id: "meet", name: "Total Fortification", meet_date: "2026-12-05", status: "upcoming", is_primary: true };
describe("shared event timeline", () => {
  it("uses calendar dates, not elapsed DST hours", () => {
    expect(planMilestones(event).map((m) => m.date)).toEqual(["2026-09-12", "2026-10-10", "2026-11-07", "2026-11-21", "2026-11-28", "2026-12-05", "2026-12-06"]);
    expect(eventCountdown(event, "2026-11-26")).toBe("9 days out");
  });
  it("recalculates on event rescheduling", () => {
    expect(planMilestones({ ...event, meet_date: "2026-12-12" }).find((m) => m.daysOut === 7)?.date).toBe("2026-12-05");
  });
  it("selects the nearest upcoming event", () => {
    expect(defaultPlanEvent([{ ...event, id: "later", meet_date: "2027-01-01" }, event], "2026-11-26")?.id).toBe("meet");
  });
  it("does not invent a plan in gaps and returns both overlapping records", () => {
    const ranges = [{ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-10-15", end: "2026-11-01" }];
    expect(plansOnDate(ranges, "2026-10-20", (x) => x)).toHaveLength(2);
    expect(plansOnDate(ranges, "2026-11-02", (x) => x)).toHaveLength(0);
  });
});
