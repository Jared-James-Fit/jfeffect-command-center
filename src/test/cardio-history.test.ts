import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cardioClock, cardioHistorySummary, isCardioHistory, parseCardioTime } from "@/lib/cardio-history";
import { effortTrend, summarizeCardio, type CardioCompletionRow } from "@/lib/analytics/cardio-adherence";
import { cardioDraftIssue, cardioEditDraft, cardioEditPatch, HISTORY_EDIT_QUERY_KEYS } from "@/lib/history-set-edit";

describe("cardio history: what it is", () => {
  it("reads a timed cardio exercise as cardio, by name or by what was logged", () => {
    expect(isCardioHistory("Treadmill Walk", [])).toBe(true);
    expect(isCardioHistory("Zone 2 Cardio (optional)", [])).toBe(true);
    expect(isCardioHistory("Bench Press", [{ actual_load: 100, actual_reps: 5 }])).toBe(false);
    // a custom name, but only time and calories were ever logged
    expect(isCardioHistory("Morning engine", [{ completed_duration_seconds: 1200, actual_calories: 150 }])).toBe(true);
    expect(isCardioHistory("Morning engine", [{ completed_duration_seconds: 60, actual_reps: 10 }])).toBe(false);
    expect(isCardioHistory("Farmer Carry Walk", [])).toBe(false);
  });

  it("shows time as a clock", () => {
    expect(cardioClock(1110)).toBe("18:30");
    expect(cardioClock(600)).toBe("10:00");
    expect(cardioClock(3720)).toBe("1:02:00");
    expect(cardioClock(null)).toBe("—");
    expect(cardioClock(0)).toBe("—");
  });

  it("reads a typed time, a bare number as minutes", () => {
    expect(parseCardioTime("18:30")).toBe(1110);
    expect(parseCardioTime("20")).toBe(1200);
    expect(parseCardioTime("12.5")).toBe(750);
    expect(parseCardioTime("1:02:00")).toBe(3720);
    expect(parseCardioTime("18 min")).toBe(1080);
    expect(parseCardioTime("18:75")).toBeNull();
    expect(parseCardioTime("")).toBeNull();
    expect(parseCardioTime("abc")).toBeNull();
  });
});

describe("cardio history: the summary", () => {
  const day = (date: string, secs: number | null, cal: number | null, rpe: number | null) => ({
    date,
    sets: [{ completed_duration_seconds: secs, actual_calories: cal, actual_rpe: rpe != null ? String(rpe) : null }],
  });
  it("counts a day as one session: time and calories added up, the hardest RPE", () => {
    const s = cardioHistorySummary([
      { date: "2026-11-10", sets: [{ completed_duration_seconds: 600, actual_calories: 80, actual_rpe: "6" }, { completed_duration_seconds: 300, actual_calories: 40, actual_rpe: "8" }] },
      day("2026-11-09", 1200, null, 6),
    ]);
    expect(s.sessions).toBe(2);
    expect(s.avgSeconds).toBe(1050);
    expect(s.avgCalories).toBe(120);
    expect(s.avgRpe).toBe(7);
    expect(s.effort).toBeNull(); // 2 rated sessions is not a trend
  });
  it("leaves out days with nothing logged", () => {
    expect(cardioHistorySummary([day("2026-11-10", null, null, null)]).sessions).toBe(0);
  });
  it("says when the same walk is getting easier", () => {
    const s = cardioHistorySummary([
      day("2026-11-11", 1200, null, 5),
      day("2026-11-09", 1200, null, 5.5),
      day("2026-11-06", 1200, null, 7),
      day("2026-11-03", 1200, null, 7),
    ]);
    expect(s.effort?.direction).toBe("easier");
    expect(s.effort?.text).toMatch(/down from RPE 7 to 5.3 for about the same 20 min/);
  });
});

describe("effort trend", () => {
  const pts = (rows: Array<[string, number | null, number | null]>) => rows.map(([date, minutes, rpe]) => ({ date, minutes, rpe }));
  it("needs 4 rated sessions", () => {
    expect(effortTrend(pts([["2026-11-01", 20, 7], ["2026-11-02", 20, 6], ["2026-11-03", 20, 5]]))).toBeNull();
    expect(effortTrend(pts([["2026-11-01", 20, 7], ["2026-11-02", 20, null], ["2026-11-03", 20, 6], ["2026-11-04", 20, 5]]))).toBeNull();
  });
  it("harder at the same work is worth a look", () => {
    const t = effortTrend(pts([["2026-11-01", 20, 5], ["2026-11-02", 20, 5], ["2026-11-03", 20, 7], ["2026-11-04", 20, 7]]));
    expect(t?.direction).toBe("harder");
    expect(t?.text).toMatch(/sleep, recovery, food/);
  });
  it("never calls lower RPE on shorter sessions 'easier'", () => {
    const t = effortTrend(pts([["2026-11-01", 30, 7], ["2026-11-02", 30, 7], ["2026-11-03", 15, 5], ["2026-11-04", 15, 5]]));
    expect(t?.direction).toBe("steady");
    expect(t?.text).toBe("RPE went from 7 to 5 while sessions went from 30 to 15 min.");
  });
  it("higher RPE on longer sessions is expected, not 'harder'", () => {
    const t = effortTrend(pts([["2026-11-01", 15, 5], ["2026-11-02", 15, 5], ["2026-11-03", 30, 7], ["2026-11-04", 30, 7]]));
    expect(t?.direction).toBe("steady");
  });
  it("small changes are steady", () => {
    const t = effortTrend(pts([["2026-11-01", 20, 6], ["2026-11-02", 20, 6], ["2026-11-03", 20, 6], ["2026-11-04", 20, 6.5]]));
    expect(t?.direction).toBe("steady");
    expect(t?.text).toMatch(/steady at about RPE/);
  });
});

describe("cardio analytics: the details coaches read", () => {
  const c = (date: string, extra: Partial<CardioCompletionRow>): CardioCompletionRow => ({
    completed_date: date,
    completed: true,
    skipped: false,
    duration_minutes: 20,
    cardio_type: "Treadmill walk",
    ...extra,
  });
  const summary = summarizeCardio({
    targets: [{ id: "t1", cardio_type: "Treadmill walk", frequency_per_week: 3, duration_minutes: 20, start_date: "2026-11-02", status: "Active", enabled: true }],
    completions: [
      c("2026-11-02", { calories: 150, rpe: 7, completion_target: "workout", avg_heart_rate: 120 }),
      c("2026-11-04", { calories: 160, rpe: 7, completion_target: "workout" }),
      c("2026-11-09", { rpe: 6, completion_target: "workout" }),
      c("2026-11-11", { calories: 170, rpe: 5.5, completion_target: "workout" }),
      c("2026-11-12", { cardio_type: "Bike", rpe: 9 }),
      { completed_date: "2026-11-13", completed: false, skipped: true, cardio_type: "Treadmill walk" },
    ],
    start: "2026-11-02",
    end: "2026-11-15",
  });
  it("adds calories, effort and heart rate from what was logged", () => {
    expect(summary.totalCalories).toBe(480);
    expect(summary.avgCalories).toBe(160);
    expect(summary.caloriesSessions).toBe(3);
    expect(summary.avgRpe).toBe(6.9);
    expect(summary.rpeSessions).toBe(5);
    expect(summary.avgHeartRate).toBe(120);
  });
  it("has every session, newest first, with where it was logged", () => {
    expect(summary.sessions.map((x) => x.date)).toEqual(["2026-11-13", "2026-11-12", "2026-11-11", "2026-11-09", "2026-11-04", "2026-11-02"]);
    expect(summary.sessions[0].skipped).toBe(true);
    expect(summary.sessions[2]).toMatchObject({ minutes: 20, calories: 170, rpe: 5.5, fromWorkout: true });
    expect(summary.sessions[1].fromWorkout).toBe(false);
  });
  it("reads effort per modality: the bike's RPE 9 doesn't make the walks look harder", () => {
    expect(summary.effort?.modality).not.toMatch(/bike/i);
    expect(summary.effort?.direction).toBe("easier");
    expect(summary.effort?.sessions).toBe(4);
  });
  it("gives each week its effort and calories", () => {
    expect(summary.weeks[0]).toMatchObject({ avgRpe: 7, calories: 310 });
    expect(summary.weeks[1].calories).toBe(170);
  });
  it("keeps the existing numbers as they were", () => {
    expect(summary.completedSessions).toBe(5);
    expect(summary.skippedSessions).toBe(1);
    expect(summary.completedMinutes).toBe(100);
  });
});

describe("cardio history: fixing a day", () => {
  const set = { id: "s1", completed_duration_seconds: 600, actual_calories: 80, actual_rpe: "6" };
  it("opens with the logged values", () => {
    expect(cardioEditDraft(set)).toEqual({ time: "10:00", calories: "80", rpe: "6" });
    expect(cardioEditDraft({ id: "s2" })).toEqual({ time: "", calories: "", rpe: "" });
  });
  it("writes only what changed", () => {
    expect(cardioEditPatch(set, { time: "10:00", calories: "80", rpe: "6" })).toBeNull();
    expect(cardioEditPatch(set, { time: "18:30", calories: "80", rpe: "6" })).toEqual({ completed_duration_seconds: 1110 });
    expect(cardioEditPatch(set, { time: "10", calories: "", rpe: "6.5" })).toEqual({ actual_calories: null, actual_rpe: "6.5" });
  });
  it("says what's wrong in words", () => {
    expect(cardioDraftIssue({ time: "abc", calories: "", rpe: "" })).toMatch(/minutes, or mm:ss/);
    expect(cardioDraftIssue({ time: "400", calories: "", rpe: "" })).toMatch(/6 hours/);
    expect(cardioDraftIssue({ time: "20", calories: "12.5", rpe: "" })).toMatch(/whole number/);
    expect(cardioDraftIssue({ time: "20", calories: "9000", rpe: "" })).toMatch(/5000/);
    expect(cardioDraftIssue({ time: "20", calories: "200", rpe: "6.3" })).toMatch(/half steps/);
    expect(cardioDraftIssue({ time: "20", calories: "200", rpe: "6.5" })).toBeNull();
  });
  it("refreshes the cardio log and analytics after a fix", () => {
    const keys = HISTORY_EDIT_QUERY_KEYS.map((k) => k[0]);
    expect(keys).toEqual(expect.arrayContaining(["cardio-analytics", "cardio-completion", "client-cardio-resolved"]));
  });
});

describe("cardio history: wiring", () => {
  const sheet = readFileSync("src/components/exercise-history-sheet.tsx", "utf8");
  it("reads time and calories, and shows cardio columns", () => {
    expect(sheet).toContain("completed_duration_seconds, actual_calories");
    expect(sheet).toContain("isCardioHistory(exerciseName, rows)");
    expect(sheet).toContain("data-history-cardio");
    expect(sheet).toContain("data-history-editor-cardio");
  });
  it("the analytics read where each session was logged", () => {
    const section = readFileSync("src/components/analytics/cardio-analytics-section.tsx", "utf8");
    expect(section).toContain("completion_target");
    expect(section).toContain("data-cardio-sessions");
    expect(section).toContain("summary.effort");
  });
});

describe("charts draw in the theme's colours", () => {
  it("never wraps an oklch token in hsl() (the mark draws with no colour)", () => {
    expect(readFileSync("src/styles.css", "utf8")).toMatch(/--primary: oklch\(/);
    for (const f of [
      "src/components/analytics/cardio-analytics-section.tsx",
      "src/components/block-progress-section.tsx",
      "src/components/analytics/performance-insights/powerlifting-panel.tsx",
      "src/components/portal/wearables-card.tsx",
      "src/components/portal/training-recovery-panel.tsx",
    ]) {
      expect(readFileSync(f, "utf8"), f).not.toContain("hsl(var(--");
    }
  });
});

describe("last time on a timed card (cardio, holds)", () => {
  // lazy so the module's other tests don't depend on it
  const lib = () => import("@/lib/workout-previous-lift");
  const log = (o: Record<string, unknown>) => ({
    id: String(o.id), exerciseId: "walk", exerciseName: "Treadmill Walk", sessionKey: String(o.session), occurredAt: String(o.at),
    reps: null, rpe: (o.rpe as string) ?? null, rir: null, enteredValue: null, enteredUnit: null, normalizedKg: null, normalizedLb: null,
    isWorkingSet: null, durationSeconds: (o.secs as number) ?? null, calories: (o.cal as number) ?? null,
  });
  it("shows the last cardio session added up: time, calories, the hardest RPE", async () => {
    const { selectPreviousLifts, formatPreviousTimed } = await lib();
    const logs = [
      log({ id: 1, session: "day:a", at: "2026-11-04T18:00:00Z", secs: 1200, cal: 158, rpe: "5.5" }),
      log({ id: 2, session: "day:b", at: "2026-11-07T18:00:00Z", secs: 600, cal: 80, rpe: "5" }),
      log({ id: 3, session: "day:b", at: "2026-11-07T18:10:00Z", secs: 630, cal: 82, rpe: "6" }),
      log({ id: 4, session: "today", at: "2026-11-11T18:00:00Z", secs: 900, cal: 100, rpe: "7" }),
    ];
    const m = selectPreviousLifts([{ rowId: "r", exerciseId: "walk", exerciseName: "Treadmill Walk", timed: "cardio" }], logs as any, "today");
    const t = m.get("r")?.timed;
    expect(t).toEqual({ kind: "cardio", seconds: 1230, calories: 162, rpe: 6, sets: 2 });
    expect(formatPreviousTimed(t!, (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`)).toBe("20:30 · 162 kcal · RPE 6");
  });
  it("shows a hold's longest set", async () => {
    const { selectPreviousLifts, formatPreviousTimed } = await lib();
    const logs = [
      log({ id: 1, session: "day:a", at: "2026-11-07T18:00:00Z", secs: 40, rpe: "7" }),
      log({ id: 2, session: "day:a", at: "2026-11-07T18:02:00Z", secs: 45, rpe: "8" }),
    ];
    const t = selectPreviousLifts([{ rowId: "r", exerciseId: "walk", exerciseName: "Plank", timed: "hold" }], logs as any, "today").get("r")?.timed;
    expect(t).toMatchObject({ kind: "hold", seconds: 45, rpe: 8, calories: null, sets: 2 });
    expect(formatPreviousTimed(t!, (s) => `0:${s}`)).toBe("0:45 · RPE 8");
  });
  it("a cardio set with only RPE still counts; nothing logged doesn't", async () => {
    const { selectPreviousLifts } = await lib();
    const only = [log({ id: 1, session: "day:a", at: "2026-11-07T18:00:00Z", rpe: "6" })];
    expect(selectPreviousLifts([{ rowId: "r", exerciseId: "walk", exerciseName: "Treadmill Walk", timed: "cardio" }], only as any, "today").get("r")?.timed)
      .toMatchObject({ seconds: null, calories: null, rpe: 6 });
    const none = [log({ id: 1, session: "day:a", at: "2026-11-07T18:00:00Z" })];
    expect(selectPreviousLifts([{ rowId: "r", exerciseId: "walk", exerciseName: "Treadmill Walk", timed: "cardio" }], none as any, "today").has("r")).toBe(false);
  });
  it("lifts are unchanged: a timed flag is what switches it", async () => {
    const { selectPreviousLifts } = await lib();
    const lift = [{ ...log({ id: 1, session: "day:a", at: "2026-11-07T18:00:00Z" }), reps: 5, normalizedKg: 100, enteredValue: 100, enteredUnit: "kg" }];
    const m = selectPreviousLifts([{ rowId: "r", exerciseId: "walk", exerciseName: "Bench" }], lift as any, "today");
    expect(m.get("r")?.timed).toBeUndefined();
    expect(m.get("r")?.reps).toBe(5);
  });
  it("the logger asks for time and calories, and marks walks as cardio", () => {
    const src = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(src).toContain("is_bodyweight, load_type, completed_duration_seconds, actual_calories,");
    expect(src).toContain('timed: isTimedCardio(name) ? "cardio" : timedRow ? "hold" : null');
    expect(src).toContain("<PreviousTimedChip");
  });
});
