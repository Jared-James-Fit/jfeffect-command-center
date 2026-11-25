import { describe, it, expect } from "vitest";
import {
  durationOfCompletion,
  durationStats,
  sessionLengthFacts,
  formatHm,
  predictDuration,
  reliableRatios,
  sessionDuration,
  setSpan,
  type DurationHistory,
} from "@/lib/workouts/session-duration";

const at = (hhmm: string) => `2026-11-24T${hhmm}:00.000Z`;
/** sets every `everyMin` minutes from `from` */
const sets = (from: string, n: number, everyMin: number) => {
  const t0 = new Date(at(from)).getTime();
  return Array.from({ length: n }, (_, i) => new Date(t0 + i * everyMin * 60_000).toISOString());
};

describe("session duration: performed time, not entry time", () => {
  it("a clock left running all day is never an 11-hour workout: the sets' span wins", () => {
    const d = sessionDuration({ startedAt: at("09:00"), completedAt: at("20:00"), clockSeconds: 11 * 3600, setTimes: sets("09:10", 18, 5), estimatedMin: 90 });
    expect(d.source).toBe("sets");
    expect(d.minutes).toBe(85 + 10);
    expect(d.measured).toBe(false);
  });

  it("long powerlifting rests are kept as training", () => {
    // 12 heavy sets, 9 minutes apart
    const d = sessionDuration({ setTimes: sets("17:00", 12, 9), estimatedMin: 75 });
    expect(d.minutes).toBe(99 + 10);
    expect(d.source).toBe("sets");
  });

  it("sets typed in afterwards in a burst fall back to the estimate, never called measured", () => {
    const burst = Array.from({ length: 15 }, (_, i) => new Date(new Date(at("20:00")).getTime() + i * 8_000).toISOString());
    const d = sessionDuration({ startedAt: at("19:58"), completedAt: at("20:03"), clockSeconds: 300, setTimes: burst, estimatedMin: 80 });
    expect(d.lateEntry).toBe(true);
    expect(d.source).toBe("estimated");
    expect(d.minutes).toBe(80);
    expect(d.measured).toBe(false);
  });

  it("a session logged live, then the rest typed in hours later, reads the live part", () => {
    const live = sets("09:00", 8, 6);
    const later = Array.from({ length: 8 }, (_, i) => new Date(new Date(at("20:00")).getTime() + i * 5_000).toISOString());
    const span = setSpan([...live, ...later])!;
    expect(span.sets).toBe(8);
    expect(span.burst).toBe(false);
    expect(sessionDuration({ setTimes: [...live, ...later] }).minutes).toBe(42 + 10);
  });

  it("the session clock is measured when the sets agree with it", () => {
    const d = sessionDuration({ startedAt: at("17:00"), completedAt: at("18:35"), clockSeconds: 95 * 60, setTimes: sets("17:12", 16, 5) });
    expect(d).toMatchObject({ source: "clock", minutes: 95, measured: true, confidence: "high" });
  });

  it("a confirmed start or a typed length wins and is measured", () => {
    expect(sessionDuration({ trainingStartedAt: at("16:30"), completedAt: at("18:10") })).toMatchObject({ source: "confirmed", minutes: 100, measured: true });
    expect(sessionDuration({ correctedMin: 72, clockSeconds: 11 * 3600 })).toMatchObject({ source: "confirmed", minutes: 72 });
  });

  it("an overnight clock stored as 4 h is not read as a session", () => {
    expect(sessionDuration({ clockSeconds: 4 * 3600, estimatedMin: 60 })).toMatchObject({ source: "estimated", minutes: 60 });
  });

  it("reads stored fields first, then older rows", () => {
    expect(durationOfCompletion({ completed_at: at("18:00"), performed_duration_seconds: 5400, duration_source: "sets", duration_confidence: "medium" }))
      .toMatchObject({ minutes: 90, measured: false, source: "sets" });
    expect(durationOfCompletion({ started_at: at("17:00"), completed_at: at("18:00"), elapsed_duration_seconds: 3600, actual_duration_min: 60 }))
      .toMatchObject({ minutes: 60, source: "clock" });
    expect(durationOfCompletion({ started_at: at("17:00"), completed_at: at("18:00"), elapsed_duration_seconds: 3600, actual_duration_min: 75 }))
      .toMatchObject({ minutes: 75, source: "confirmed" });
    expect(durationOfCompletion({ completed_at: null })).toBeNull();
  });

  it("formats hours and minutes", () => {
    expect(formatHm(102)).toBe("1h 42m");
    expect(formatHm(45)).toBe("45m");
    expect(formatHm(120)).toBe("2h");
    expect(formatHm(null)).toBe("");
  });
});

describe("personalized duration prediction", () => {
  const h = (est: number, act: number, source: DurationHistory["source"] = "clock"): DurationHistory => ({ estimatedMin: est, actualMin: act, source });

  it("falls back to the plan's estimate until there are enough reliable sessions", () => {
    expect(predictDuration(80, [h(80, 100), h(80, 100)])).toMatchObject({ basis: "estimate", minutes: 80, low: 70, high: 90 });
    expect(predictDuration(null, [])).toBeNull();
  });

  it("scales the estimate by their own pace", () => {
    const p = predictDuration(80, [h(80, 100), h(70, 88), h(90, 110), h(80, 96)])!;
    expect(p.basis).toBe("personal");
    expect(p.minutes).toBe(100);
    expect(p.low).toBeLessThanOrEqual(p.minutes);
    expect(p.high).toBeGreaterThanOrEqual(p.minutes);
  });

  it("estimated sessions and outliers are left out", () => {
    const hist = [h(80, 80), h(80, 82), h(80, 78), h(80, 81), h(80, 190), h(80, 20, "estimated"), h(80, 200, "estimated")];
    const r = reliableRatios(hist);
    expect(r).toHaveLength(4);
    expect(predictDuration(80, hist)!.minutes).toBe(80);
  });
});

describe("duration analytics", () => {
  it("averages measured and reconstructed, compares with the estimate, and reads weekly time", () => {
    const d = (day: number) => new Date(Date.UTC(2026, 10, day, 17));
    const s = durationStats(
      [
        { start: d(2), minutes: 90, kind: "measured", estimatedMin: 75 },
        { start: d(4), minutes: 100, kind: "reconstructed", estimatedMin: 80 },
        { start: d(9), minutes: 80, kind: "measured", estimatedMin: 75 },
        { start: d(11), minutes: 60, kind: "estimated", estimatedMin: 60 },
      ],
      { start: d(2), end: d(16) },
    );
    expect(s.avgMin).toBe(90);
    expect(s.sessions).toBe(3);
    expect(s.measured).toBe(2);
    expect(s.overEstimateMin).toBe(13);
    expect(s.weeklyMin).toBe(165);
  });
  it("says nothing without sessions", () => {
    expect(durationStats([])).toMatchObject({ avgMin: null, weeklyMin: null, overEstimateMin: null });
  });
});

describe("session length facts for the brief", () => {
  it("compares real sessions with the limit and counts each kind", () => {
    const lines = sessionLengthFacts(
      [
        { minutes: 92, kind: "measured" },
        { minutes: 95, kind: "measured" },
        { minutes: 88, kind: "reconstructed" },
        { minutes: 60, kind: "estimated" },
      ],
      { minutes: 60, phrase: "their 60-min PT session" },
      75,
    );
    expect(lines[0]).toBe("- Session length: median 92 min over the last 3 (2 measured, 1 reconstructed from set times) vs their 60-min PT session; 3 of 3 over, by about 32 min; the program's estimates are about 75 min.");
    expect(lines[1]).toMatch(/fit the work to the time/);
  });
  it("says when there isn't enough, never guessing", () => {
    expect(sessionLengthFacts([{ minutes: 60, kind: "estimated" }], { minutes: null, phrase: "no stated limit" })[0]).toMatch(/not enough timed sessions/);
  });
});
