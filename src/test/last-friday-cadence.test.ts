import { describe, expect, it } from "vitest";
import { cadenceLabel, lastFridayOfMonth, lastMondayOfMonth, nextFinalWeekStart, nextLastFridayDate } from "@/lib/task-cadence";
import { computeNextDueUtc, type EffectiveSchedule } from "@/lib/action-centre.functions";
import { automatedRequestAlreadySent } from "@/lib/messenger-checkins.functions";

const sched = (over: Partial<EffectiveSchedule> = {}): EffectiveSchedule => ({
  task_type: "monthly_assessment",
  title: "Monthly Assessment",
  enabled: true,
  frequency: "monthly_last_friday",
  interval_days: null,
  due_day_of_week: null,
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

describe("last Friday of the month", () => {
  it.each([
    [2026, 1, 30],
    [2026, 2, 27],
    [2026, 5, 29], // May 31 is a Sunday
    [2026, 7, 31], // month ends on a Friday
    [2026, 10, 30], // Oct 31 is a Saturday
    [2026, 12, 25],
    [2027, 1, 29],
    [2028, 2, 25], // leap year
    [2028, 3, 31],
  ])("%i-%i → %i", (y, m, d) => {
    expect(lastFridayOfMonth(y, m)).toBe(d);
  });

  it("is always a Friday in the final 7 days, for 20 years", () => {
    for (let y = 2026; y < 2046; y++) {
      for (let m = 1; m <= 12; m++) {
        const d = lastFridayOfMonth(y, m);
        expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(5);
        expect(new Date(Date.UTC(y, m - 1, d + 7)).getUTCMonth()).not.toBe(m - 1);
      }
    }
  });

  it("rolls across month and year boundaries", () => {
    expect(nextLastFridayDate(2026, 10, 3, true)).toEqual({ y: 2026, m: 10, d: 30 });
    expect(nextLastFridayDate(2026, 10, 30, true)).toEqual({ y: 2026, m: 10, d: 30 });
    expect(nextLastFridayDate(2026, 10, 30, false)).toEqual({ y: 2026, m: 11, d: 27 });
    expect(nextLastFridayDate(2026, 10, 31, true)).toEqual({ y: 2026, m: 11, d: 27 });
    expect(nextLastFridayDate(2026, 12, 26, true)).toEqual({ y: 2027, m: 1, d: 29 });
  });

  it("labels the cadence", () => {
    expect(cadenceLabel("monthly_last_friday")).toBe("Last Friday of each month");
  });
});

describe("next last-Friday occurrence", () => {
  it("schedules this month's last Friday in the client's time zone", () => {
    const next = computeNextDueUtc(sched(), "Australia/Sydney", new Date("2026-10-03T00:00:00Z"))!;
    expect(next.localDate).toBe("2026-10-30");
  });

  it("never re-seeds the same Friday after completion (seed from due + 1s)", () => {
    const tz = "America/New_York";
    const first = computeNextDueUtc(sched(), tz, new Date("2026-10-03T12:00:00Z"))!;
    expect(first.localDate).toBe("2026-10-30");
    const afterDue = new Date(first.dueAtUtc.getTime() + 1000);
    const second = computeNextDueUtc(sched(), tz, afterDue)!;
    expect(second.localDate).toBe("2026-11-27");
    const third = computeNextDueUtc(sched(), tz, new Date(second.dueAtUtc.getTime() + 1000))!;
    expect(third.localDate).toBe("2026-12-25");
    const fourth = computeNextDueUtc(sched(), tz, new Date(third.dueAtUtc.getTime() + 1000))!;
    expect(fourth.localDate).toBe("2027-01-29");
  });

  it("still uses today when it is the last Friday and the due time is ahead", () => {
    const next = computeNextDueUtc(sched(), "UTC", new Date("2026-10-30T08:00:00Z"))!;
    expect(next.localDate).toBe("2026-10-30");
  });

  it("leaves the weekly schedule unchanged", () => {
    const weekly = sched({ task_type: "weekly_checkin", frequency: "weekly", due_day_of_week: 0 });
    // Saturday 3 Oct 2026 → Sunday 4 Oct.
    expect(computeNextDueUtc(weekly, "UTC", new Date("2026-10-03T10:00:00Z"))!.localDate).toBe("2026-10-04");
  });
});

describe("duplicate-send guard", () => {
  it("allows one automated Weekly Check-In per 4 days", () => {
    expect(automatedRequestAlreadySent("weekly_checkin", "2026-10-09", ["2026-10-02"])).toBe(false);
    expect(automatedRequestAlreadySent("weekly_checkin", "2026-10-10", ["2026-10-09"])).toBe(true);
  });
});

describe("start of the final week (last Monday of the month)", () => {
  it.each([
    [2026, 10, 26], // Oct 31 is a Saturday
    [2026, 11, 30], // Nov 30 is a Monday
    [2026, 8, 31], // Aug 31 is a Monday
    [2026, 12, 28],
    [2027, 1, 25],
    [2028, 2, 28], // leap year, Feb 29 is a Tuesday
  ])("%i-%i → %i", (y, m, d) => {
    expect(lastMondayOfMonth(y, m)).toBe(d);
  });

  it("is always a Monday in the final 7 days, for 20 years", () => {
    for (let y = 2026; y < 2046; y++) {
      for (let m = 1; m <= 12; m++) {
        const d = lastMondayOfMonth(y, m);
        expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1);
        expect(new Date(Date.UTC(y, m - 1, d + 7)).getUTCMonth()).not.toBe(m - 1);
      }
    }
  });

  it("rolls to the next month once this month's final week has started", () => {
    expect(nextFinalWeekStart(2026, 10, 6)).toEqual({ y: 2026, m: 10, d: 26 });
    expect(nextFinalWeekStart(2026, 10, 26)).toEqual({ y: 2026, m: 10, d: 26 });
    expect(nextFinalWeekStart(2026, 10, 27)).toEqual({ y: 2026, m: 11, d: 30 });
    expect(nextFinalWeekStart(2026, 12, 29)).toEqual({ y: 2027, m: 1, d: 25 });
  });
});
