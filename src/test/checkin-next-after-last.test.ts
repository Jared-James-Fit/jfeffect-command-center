import { describe, expect, it } from "vitest";
import { computeNextDueUtc, nextDueAfterLast, type EffectiveSchedule } from "@/lib/action-centre.functions";

const weekly = (over: Partial<EffectiveSchedule> = {}): EffectiveSchedule => ({
  task_type: "weekly_checkin",
  title: "Weekly Check-In",
  enabled: true,
  frequency: "weekly",
  interval_days: null,
  due_day_of_week: 0,
  due_time_local: "23:59",
  tz_mode: "client",
  fixed_tz: null,
  reminder_offsets: [],
  overdue_after_days: null,
  reminder_after_days: null,
  form_id: null,
  source_definition_id: null,
  source_override_id: null,
  ...over,
});

describe("the next check-in never lands in the week just done", () => {
  // Nicole: due Sun Oct 11 23:59 Winnipeg (Oct 12 04:59 UTC), done Oct 10, then her
  // timezone became Edmonton. A second after that due instant is still Sunday
  // 22:59 in Edmonton, so the "next" was that same Sunday.
  const after = new Date("2026-10-12T04:59:01Z");

  it("reproduces the bug without the last date", () => {
    expect(computeNextDueUtc(weekly(), "America/Edmonton", after)?.localDate).toBe("2026-10-11");
  });

  it("moves on to the next Sunday when the last one was that week", () => {
    const next = nextDueAfterLast(weekly(), "America/Edmonton", after, "2026-10-11");
    expect(next?.localDate).toBe("2026-10-18");
    expect(next?.dueAtUtc.toISOString()).toBe("2026-10-19T05:59:00.000Z");
  });

  it("changes nothing when the timezone didn't move", () => {
    expect(nextDueAfterLast(weekly(), "America/Winnipeg", after, "2026-10-11")?.localDate).toBe("2026-10-18");
    expect(nextDueAfterLast(weekly(), "America/Edmonton", new Date("2026-10-13T12:00:00Z"), "2026-10-11")?.localDate).toBe(
      "2026-10-18",
    );
  });

  it("a first one (nothing done yet) is just the next due day", () => {
    expect(nextDueAfterLast(weekly(), "America/Edmonton", after, null)?.localDate).toBe("2026-10-11");
  });

  it("biweekly and manual keep their own rules", () => {
    expect(nextDueAfterLast(weekly({ frequency: "biweekly" }), "America/Edmonton", after, "2026-10-11")?.localDate).toBe(
      "2026-10-25",
    );
    expect(nextDueAfterLast(weekly({ frequency: "manual" }), "America/Edmonton", after, "2026-10-11")).toBeNull();
  });
});
