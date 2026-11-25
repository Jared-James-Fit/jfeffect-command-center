import { describe, it, expect } from "vitest";
import {
  busyOnDay,
  clockLabel,
  confirmedClash,
  habitStart,
  parseTimeValue,
  suggestWorkoutTime,
  timeValue,
} from "@/lib/workouts/workout-time-suggest";

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe("suggested workout times", () => {
  it("picks the slot nearest their usual start that fits the long end of the prediction", () => {
    const s = suggestWorkoutTime({ busy: [{ start: h(9), end: h(12) }], durationMin: 95, durationHighMin: 110, habitStartMin: h(12, 30) });
    expect(s).toEqual({ startMin: h(12, 30), endMin: h(12, 30) + 95, basis: "habit" });
  });

  it("keeps clear of busy time with a buffer, and never squeezes one in", () => {
    // free 13:00–14:30 only; 95 min + buffers don't fit, so the evening
    const busy = [{ start: h(6), end: h(13) }, { start: h(14, 30), end: h(18) }];
    expect(suggestWorkoutTime({ busy, durationMin: 95, habitStartMin: h(13) })!.startMin).toBe(h(18, 15));
    expect(suggestWorkoutTime({ busy: [{ start: h(6), end: h(22) }], durationMin: 60 })).toBeNull();
  });

  it("informational events (all-day, free) never block", () => {
    const allDay = busyOnDay(new Date(2026, 10, 24), { start: "2026-11-24", allDay: true })!;
    expect(allDay.informational).toBe(true);
    expect(suggestWorkoutTime({ busy: [allDay, { start: h(17), end: h(18), informational: true }], durationMin: 60 })!.startMin).toBe(h(17));
  });

  it("with no history it suggests early evening; today never in the past", () => {
    expect(suggestWorkoutTime({ busy: [], durationMin: 60 })).toMatchObject({ startMin: h(17), basis: "default" });
    expect(suggestWorkoutTime({ busy: [], durationMin: 60, habitStartMin: h(7), notBeforeMin: h(10, 5) })!.startMin).toBe(h(10, 15));
  });

  it("is deterministic: a tie goes to the earlier time", () => {
    const busy = [{ start: h(16, 30), end: h(18) }];
    const a = suggestWorkoutTime({ busy, durationMin: 30, habitStartMin: h(17) });
    expect(a).toEqual(suggestWorkoutTime({ busy, durationMin: 30, habitStartMin: h(17) }));
    expect(a!.startMin).toBe(h(15, 45));
  });

  it("reads the usual start: this weekday, else any day", () => {
    const hist = [{ weekday: 1, startMin: h(12, 20) }, { weekday: 1, startMin: h(12, 40) }, { weekday: 3, startMin: h(18) }];
    expect(habitStart(hist, 1)).toBe(h(12, 30));
    expect(habitStart(hist, 5)).toBe(h(12, 45));
    expect(habitStart(hist.slice(0, 1), 5)).toBeNull();
  });

  it("places timed things on the day and says a confirmed clash", () => {
    const day = new Date(2026, 10, 24);
    const b = busyOnDay(day, { start: new Date(2026, 10, 24, 12).toISOString(), end: new Date(2026, 10, 24, 13).toISOString() })!;
    expect(b).toEqual({ start: h(12), end: h(13), informational: false });
    expect(busyOnDay(day, { start: new Date(2026, 10, 25, 12).toISOString() })).toBeNull();
    expect(confirmedClash(h(12, 30), 60, [b])).toBe(true);
    expect(confirmedClash(h(13), 60, [b])).toBe(false);
  });

  it("formats and parses times", () => {
    expect(clockLabel(h(12, 30))).toBe("12:30 PM");
    expect(clockLabel(h(0, 5))).toBe("12:05 AM");
    expect(timeValue(h(7, 5))).toBe("07:05");
    expect(parseTimeValue("12:30:00")).toBe(h(12, 30));
    expect(parseTimeValue(null)).toBeNull();
  });
});
