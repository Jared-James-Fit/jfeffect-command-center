import { describe, expect, it } from "vitest";
import {
  e1rmTrendPerWeek,
  groupLiftSessions,
  repMaxes,
  sameLoadEffortChange,
  sessionNotation,
  setEffort,
} from "@/lib/analytics/lift-sessions";
import { epley1RM } from "@/lib/analytics/e1rm";

let n = 0;
function set(date: string, load: number, reps: number, extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `s${n}`,
    row_id: "row-a",
    set_index: 1,
    date,
    load,
    reps,
    est_1rm: epley1RM(load, reps),
    rpe: null as string | null,
    rir: null as string | null,
    ...extra,
  };
}

describe("lift sessions", () => {
  // The real Oct 2 deadlift log: top set on one row, two back-offs on another
  // row saved together with set 2 a few ms before set 1.
  const oct2 = [
    set("2026-10-02T22:52:51Z", 495, 5, { rpe: "4", row_id: "top" }),
    set("2026-10-02T23:49:45.963Z", 315, 5, { rpe: "6", row_id: "backoff", set_index: 2 }),
    set("2026-10-02T23:49:45.969Z", 315, 5, { rpe: "6", row_id: "backoff", set_index: 1 }),
  ];

  it("charts one point per session, keyed to its best set — back-offs don't draw a fake drop", () => {
    const [s] = groupLiftSessions(oct2);
    expect(groupLiftSessions(oct2)).toHaveLength(1);
    expect(s.e1rm).toBe(577.5);
    expect(s.top.load).toBe(495);
    expect(s.setCount).toBe(3);
    expect(s.reps).toBe(15);
    expect(s.tonnage).toBe(495 * 5 + 315 * 10);
    expect(s.avgEffort).toBe(5.3);
    expect(s.effortSource).toBe("RPE");
  });

  it("orders sets as performed: row first, then set number", () => {
    const [s] = groupLiftSessions(oct2);
    expect(s.sets.map((x) => [x.row_id, x.set_index])).toEqual([
      ["top", 1],
      ["backoff", 1],
      ["backoff", 2],
    ]);
  });

  it("rows saved at the same moment list the top set before back-offs", () => {
    const t = "2026-10-04T22:11:01Z";
    const [s] = groupLiftSessions([
      set(t, 345, 5, { row_id: "a-backoff" }),
      set(t, 385, 5, { row_id: "z-top" }),
    ]);
    expect(s.sets.map((x) => x.load)).toEqual([385, 345]);
  });

  it("writes the session in coach shorthand", () => {
    const [s] = groupLiftSessions(oct2);
    expect(sessionNotation(s.sets, (lb) => String(lb))).toBe("495×5 @4 · 315×5×2 @6");
    const rir = [
      set("2026-10-01T10:00:00Z", 100, 8, { rir: "2" }),
      set("2026-10-01T10:05:00Z", 100, 8, { rir: "1" }),
    ];
    expect(sessionNotation(rir, (lb) => String(lb))).toBe("100×8×2 1–2 RIR");
  });

  it("reads effort from RPE, or RIR on the RPE scale", () => {
    expect(setEffort({ rpe: "8.5", rir: null })).toMatchObject({ value: 8.5, source: "RPE" });
    expect(setEffort({ rpe: null, rir: "2" })).toMatchObject({ value: 8, source: "RIR" });
    expect(setEffort({ rpe: "", rir: "" })).toBeNull();
  });

  it("rep maxes are exact-rep bests, dropping ones a heavier set for more reps already beats", () => {
    const pts = [
      set("2026-09-01T10:00:00Z", 455, 3),
      set("2026-09-08T10:00:00Z", 495, 5),
      set("2026-09-15T10:00:00Z", 545, 1),
      set("2026-09-22T10:00:00Z", 405, 8),
    ];
    // 3 × 455 is beaten by 5 × 495, so it's not shown.
    expect(repMaxes(pts).map((r) => [r.reps, r.load])).toEqual([
      [1, 545],
      [5, 495],
      [8, 405],
    ]);
  });

  it("e1RM trend is a per-week slope, and only with enough data", () => {
    const weekly = [0, 7, 14, 21].map((d, i) => ({
      date: new Date(Date.UTC(2026, 8, 1 + d)).toISOString(),
      e1rm: 500 + i * 5,
    }));
    expect(e1rmTrendPerWeek(weekly)).toBeCloseTo(5, 5);
    expect(e1rmTrendPerWeek(weekly.slice(0, 2))).toBeNull();
    expect(
      e1rmTrendPerWeek(
        weekly.map((w, i) => ({ ...w, date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString() })),
      ),
    ).toBeNull();
  });

  it("flags the same load getting easier — the cleanest strength signal", () => {
    const sessions = groupLiftSessions([
      set("2026-09-10T10:00:00Z", 315, 5, { rpe: "8" }),
      set("2026-09-10T10:05:00Z", 315, 5, { rpe: "8.5" }),
      set("2026-09-24T10:00:00Z", 315, 5, { rpe: "7" }),
      set("2026-10-02T10:00:00Z", 315, 5, { rpe: "6.5" }),
      set("2026-09-10T11:00:00Z", 225, 10, { rpe: "7" }),
      set("2026-10-02T11:00:00Z", 225, 10, { rpe: "6.5" }),
    ]);
    const c = sameLoadEffortChange(sessions)!;
    expect(c).toMatchObject({ load: 315, reps: 5, delta: -2 });
    expect(c.from.raw).toBe(8.5);
    expect(c.to.raw).toBe(6.5);
  });

  it("ignores effort wobble under 1 RPE", () => {
    const sessions = groupLiftSessions([
      set("2026-09-10T10:00:00Z", 315, 5, { rpe: "7" }),
      set("2026-10-02T10:00:00Z", 315, 5, { rpe: "7.5" }),
    ]);
    expect(sameLoadEffortChange(sessions)).toBeNull();
  });
});
