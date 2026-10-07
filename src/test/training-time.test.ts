import { describe, expect, it } from "vitest";
import {
  formatClock,
  resolveTiming,
  rpeAdjustedE1rm,
  strengthIndexBySession,
  summarizeTrainingTime,
  trainingDayMinutes,
  windowForHour,
  zonedParts,
  zonedWallTimeToDate,
  type TrainingSession,
} from "@/lib/analytics/training-time";

const TZ = "America/Winnipeg";

function session(over: Partial<TrainingSession> & { id: string; startMinutes: number }): TrainingSession {
  const hour = Math.floor((over.startMinutes % 1440) / 60);
  return {
    dayId: `day-${over.id}`,
    title: null,
    start: new Date("2026-09-01T23:00:00Z"),
    end: null,
    durationMin: 75,
    activeMin: null,
    source: "tracked",
    weekday: 1,
    window: windowForHour(hour),
    loggedSets: 20,
    loggingPct: 100,
    setsPerHour: 16,
    rating: null,
    sessionRpe: null,
    strengthIndex: null,
    strengthFeel: null,
    fatigueFeel: null,
    pain: false,
    notes: null,
    reviewNote: null,
    ...over,
  };
}

describe("timezone helpers", () => {
  it("reads wall time in the athlete's zone, not the viewer's", () => {
    const p = zonedParts(new Date("2026-07-15T22:40:00Z"), TZ); // CDT = UTC-5
    expect(p.hour).toBe(17);
    expect(p.minute).toBe(40);
  });

  it("round-trips a wall time across DST", () => {
    const summer = zonedWallTimeToDate("2026-07-15", "17:40", TZ)!;
    expect(summer.toISOString()).toBe("2026-07-15T22:40:00.000Z");
    const winter = zonedWallTimeToDate("2026-01-15", "17:40", TZ)!;
    expect(winter.toISOString()).toBe("2026-01-15T23:40:00.000Z");
  });

  it("formats clock times and keeps late-night sessions after 11 PM", () => {
    expect(formatClock(17 * 60 + 40)).toBe("5:40 PM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(trainingDayMinutes(1, 0)).toBeGreaterThan(trainingDayMinutes(23, 0));
    expect(windowForHour(1)).toBe("night");
    expect(windowForHour(6)).toBe("early");
    expect(windowForHour(18)).toBe("evening");
  });
});

describe("resolveTiming", () => {
  it("prefers the confirmed start", () => {
    const t = resolveTiming({
      startedAt: "2026-10-01T03:00:00Z",
      trainingStartedAt: "2026-09-30T22:30:00Z",
      completedAt: "2026-10-01T03:05:00Z",
      durationMin: 80,
      loggedSets: 20,
    })!;
    expect(t.source).toBe("confirmed");
    expect(t.start.toISOString()).toBe("2026-09-30T22:30:00.000Z");
    expect(t.durationMin).toBe(80);
  });

  it("flags a workout logged after the fact as suspect", () => {
    const t = resolveTiming({
      startedAt: "2026-10-01T03:00:00Z",
      trainingStartedAt: null,
      completedAt: "2026-10-01T03:04:00Z",
      durationMin: 4,
      loggedSets: 18,
    })!;
    expect(t.source).toBe("suspect");
  });

  it("trusts a live-logged session", () => {
    const t = resolveTiming({
      startedAt: "2026-10-01T22:00:00Z",
      trainingStartedAt: null,
      completedAt: "2026-10-01T23:15:00Z",
      durationMin: 72,
      loggedSets: 18,
    })!;
    expect(t.source).toBe("tracked");
    expect(t.durationMin).toBe(72);
  });

  it("does not report a forgotten 9-hour timer as a session", () => {
    const t = resolveTiming({
      startedAt: "2026-10-01T13:00:00Z",
      trainingStartedAt: null,
      completedAt: "2026-10-01T22:00:00Z",
      durationMin: null,
      loggedSets: 18,
    })!;
    expect(t.source).toBe("suspect");
    expect(t.durationMin).toBeNull();
  });
});

describe("strength index", () => {
  it("puts submaximal and heavy sets on one scale via RPE", () => {
    const heavy = rpeAdjustedE1rm(400, 1, 9, null)!;
    const volume = rpeAdjustedE1rm(340, 5, 7, null)!;
    expect(Math.abs(heavy - volume) / heavy).toBeLessThan(0.05);
  });

  it("ignores sets without effort logged, warm-ups and high-rep sets", () => {
    expect(rpeAdjustedE1rm(300, 3, null, null)).toBeNull();
    expect(rpeAdjustedE1rm(135, 5, 4, null)).toBeNull();
    expect(rpeAdjustedE1rm(100, 15, 8, null)).toBeNull();
    expect(rpeAdjustedE1rm(300, 3, null, 2)).not.toBeNull();
  });

  it("scores each session against the prior 8 weeks only", () => {
    const day = 86_400_000;
    const t0 = Date.UTC(2026, 8, 1);
    const idx = strengthIndexBySession([
      { sessionKey: "a", at: t0, exerciseKey: "squat", loadLb: 400, reps: 1, rpe: 9, rir: null },
      { sessionKey: "b", at: t0 + 7 * day, exerciseKey: "squat", loadLb: 410, reps: 1, rpe: 9, rir: null },
      { sessionKey: "c", at: t0 + 120 * day, exerciseKey: "squat", loadLb: 300, reps: 1, rpe: 9, rir: null },
    ]);
    expect(idx.has("a")).toBe(false); // nothing to compare against
    expect(idx.get("b")!).toBeCloseTo(102.5, 1);
    expect(idx.has("c")).toBe(false); // prior best is outside the lookback
  });
});

describe("summarizeTrainingTime", () => {
  it("names a best window only when the gap is meaningful", () => {
    const sessions = [
      ...[0, 1, 2, 3].map((i) => session({ id: `m${i}`, startMinutes: 7 * 60, window: "early", strengthIndex: 96 })),
      ...[0, 1, 2, 3].map((i) => session({ id: `e${i}`, startMinutes: 18 * 60, window: "evening", strengthIndex: 100 })),
    ];
    const s = summarizeTrainingTime(sessions);
    expect(s.best?.key).toBe("evening");
    expect(s.insights.find((i) => i.id === "best-window")?.title).toContain("Evening");

    const flat = summarizeTrainingTime(sessions.map((x) => ({ ...x, strengthIndex: 99 })));
    expect(flat.insights.some((i) => i.id === "no-clear-window")).toBe(true);
  });

  it("asks for more data instead of guessing", () => {
    const s = summarizeTrainingTime([session({ id: "1", startMinutes: 18 * 60, strengthIndex: 101 })]);
    expect(s.best).toBeNull();
    expect(s.insights.some((i) => i.id === "need-data")).toBe(true);
  });

  it("keeps suspect sessions out of the stats and says so", () => {
    const s = summarizeTrainingTime([
      session({ id: "1", startMinutes: 18 * 60, durationMin: 80 }),
      session({ id: "2", startMinutes: 23 * 60, durationMin: 3, source: "suspect" }),
    ]);
    expect(s.timed).toHaveLength(1);
    expect(s.medianDurationMin).toBe(80);
    expect(s.suspectCount).toBe(1);
    expect(s.insights.some((i) => i.id === "suspect")).toBe(true);
  });

  it("doesn't call a split weekday-evening / weekend-morning schedule consistent", () => {
    const split = summarizeTrainingTime([
      ...[0, 1, 2, 3, 4, 5].map((i) => session({ id: `e${i}`, startMinutes: 18 * 60 + i * 5, window: "evening" })),
      ...[0, 1, 2].map((i) => session({ id: `m${i}`, startMinutes: 9 * 60, window: "morning" })),
    ]);
    expect(split.insights.some((i) => i.id === "consistency" && i.tone === "good")).toBe(false);
    expect(split.insights.find((i) => i.id === "split-schedule")?.title).toBe("You train in two slots: evening and morning");

    const steady = summarizeTrainingTime(
      [0, 1, 2, 3, 4, 5, 6, 7].map((i) => session({ id: `s${i}`, startMinutes: 18 * 60 + (i % 3) * 20, window: "evening" })),
    );
    expect(steady.nearTypicalCount).toBe(8);
    expect(steady.insights.find((i) => i.id === "consistency")?.tone).toBe("good");
  });

  it("tells a meet-prep athlete who trains at night to practice mornings", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const s = summarizeTrainingTime(
      [0, 1, 2].map((i) => session({ id: `${i}`, startMinutes: 19 * 60 })),
      { now, nextMeetDate: "2026-11-01" },
    );
    const meet = s.insights.find((i) => i.id === "meet-time");
    expect(meet?.tone).toBe("warn");
    expect(meet?.title).toContain("4 wks");
  });

  it("doesn't tell a peaking athlete to put heavy days in the evening", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    const sessions = [
      ...[0, 1, 2, 3].map((i) => session({ id: `m${i}`, startMinutes: 9 * 60, window: "morning", strengthIndex: 96 })),
      ...[0, 1, 2, 3, 4].map((i) => session({ id: `e${i}`, startMinutes: 18 * 60, window: "evening", strengthIndex: 100 })),
    ];
    const peaking = summarizeTrainingTime(sessions, { now, nextMeetDate: "2026-11-01" });
    expect(peaking.insights.find((i) => i.id === "best-window")?.body).toContain("Outside meet prep");
    const offSeason = summarizeTrainingTime(sessions, { now });
    expect(offSeason.insights.find((i) => i.id === "best-window")?.body).toContain("Put your heaviest day there");
  });
});
