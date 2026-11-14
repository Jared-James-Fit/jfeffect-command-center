import { describe, expect, it } from "vitest";
import { dayMark, workoutMark } from "@/components/workouts/workout-status-mark";

const now = new Date(2026, 9, 12, 12);
const item = (o: any = {}) => ({ day: { id: "d" }, week: {}, block: {}, completion: null, logged_sets_count: 0, scheduledDate: "2026-10-14", ...o });

describe("one workout status mark for every calendar", () => {
  it("scheduled / not started is a grey dot; a past day with nothing logged is missed, never 'skipped'", () => {
    expect(workoutMark(item(), now)).toEqual({ kind: "scheduled" });
    expect(workoutMark(item({ scheduledDate: "2026-10-05" }), now)).toEqual({ kind: "missed" });
  });
  it("a missed day speaks over one still ahead or done, never over one in progress", () => {
    const missed = item({ scheduledDate: "2026-10-05" });
    expect(dayMark([item({ completion: { completed_at: "2026-10-05T10:00:00Z" } }), missed], now)?.kind).toBe("missed");
    expect(dayMark([missed, item({ logged_sets_count: 2, progress_pct: 20 })], now)?.kind).toBe("progress");
  });
  it("in progress is a ring filled to the real logged-set progress", () => {
    expect(workoutMark(item({ logged_sets_count: 4, progress_pct: 37 }), now)).toEqual({ kind: "progress", pct: 37 });
  });
  it("completed (review pending too) is a check", () => {
    expect(workoutMark(item({ completion: { completed_at: "2026-10-12T10:00:00Z" } }), now)).toEqual({ kind: "done" });
    expect(workoutMark(item({ completion: { completed_at: "2026-10-12T10:00:00Z", has_feedback: false } }), now)).toEqual({ kind: "done" });
  });
  it("skipped only when explicitly skipped; no workout, no mark", () => {
    expect(workoutMark(item({ completion: { skipped_at: "2026-10-10" } }), now)).toEqual({ kind: "skipped" });
    expect(workoutMark(null, now)).toBeNull();
    expect(dayMark([], now)).toBeNull();
  });
  it("two workouts on a day: the least finished one speaks for it", () => {
    expect(dayMark([item({ completion: { completed_at: "2026-10-12T10:00:00Z" } }), item({ logged_sets_count: 1, progress_pct: 10 })], now)?.kind).toBe("progress");
  });
});
