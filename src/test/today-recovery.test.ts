import { describe, expect, it } from "vitest";
import {
  buildTodayRecovery,
  effortWeight,
  stateFor,
  weightLiftedKg,
  workoutKind,
  PAIN_CAP,
  SEVERE_PAIN_CAP,
  type RecentSet,
  type PlannedRow,
} from "@/lib/analytics/today-recovery";

// Wednesday Nov 25 2026, 9 AM local
const NOW = new Date(2026, 10, 25, 9, 0, 0).getTime();
const TODAY = "2026-11-25";
const at = (daysAgo: number, hour = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const squat = (daysAgo: number, n = 5, rpe = 8): RecentSet[] =>
  Array.from({ length: n }, () => ({ at: at(daysAgo), reps: 5, rpe, loadKg: 140, exercise: "Back Squat", primary: ["quads", "glutes"], secondary: ["adductors"] }));
const bench = (daysAgo: number, n = 5, rpe = 8): RecentSet[] =>
  Array.from({ length: n }, () => ({ at: at(daysAgo), reps: 5, rpe, loadKg: 100, exercise: "Bench Press", primary: ["chest"], secondary: ["triceps", "front delts"] }));
const row = (daysAgo: number, n = 4): RecentSet[] =>
  Array.from({ length: n }, () => ({ at: at(daysAgo), reps: 8, rpe: 8, loadKg: 70, exercise: "Barbell Row", primary: ["lats", "upper back"], secondary: ["biceps"] }));

/** Three weeks of an upper / lower split (Mon lower, Tue upper, Thu lower, Fri upper), so every muscle has a usual dose. */
function history(): RecentSet[] {
  const out: RecentSet[] = [];
  for (const w of [1, 2, 3]) {
    const base = w * 7;
    out.push(...squat(base + 2), ...bench(base + 1), ...row(base + 1), ...squat(base - 1), ...bench(base - 2), ...row(base - 2));
  }
  return out;
}
const upperDay: PlannedRow[] = [
  { sets: 5, primary: ["chest"], secondary: ["triceps", "front delts"] },
  { sets: 4, primary: ["lats", "upper back"], secondary: ["biceps"] },
];
const lowerDay: PlannedRow[] = [{ sets: 5, primary: ["quads", "glutes"], secondary: ["adductors"] }];

describe("today's recovery is read for today's workout", () => {
  it("fatigued quads still read recovered for an upper-body day, and low for a lower-body day", () => {
    const sets = [...history(), ...squat(1, 6, 9)]; // heavy squats yesterday
    const upper = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets });
    const lower = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets });
    expect(upper.muscles.Quads.state).toBe("elevated");
    expect(upper.scope).toBe("workout");
    expect(upper.score!).toBeGreaterThanOrEqual(75);
    expect(upper.band).toBe("recovered");
    expect(lower.score!).toBeLessThan(upper.score!);
    expect(lower.band).not.toBe("recovered");
    // the observation says why an upper day is still fine
    expect(upper.observation).toMatch(/Quads .*upper-body workout doesn't lean on them/);
    expect(lower.observation).toMatch(/^Quads still carry fatigue from yesterday \(Back Squat\)/);
    expect(upper.relevant[0]).toBe("Chest");
  });

  it("is deterministic: the same records give the same answer", () => {
    const sets = [...history(), ...squat(1)];
    const a = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets });
    const b = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets: [...sets].reverse() });
    expect(a).toEqual(b);
  });

  it("fatigue fades with time and each muscle is judged against the athlete's own usual dose", () => {
    const fresh = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets: [...history(), ...squat(1)] });
    const later = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets: [...history(), ...squat(3)] });
    expect(fresh.muscles.Quads.ratio).toBeGreaterThan(later.muscles.Quads.ratio);
    expect(later.muscles.Quads.state).toBe("recovered");
    // a muscle never trained in 6 weeks has no data: grey, never "recovered"
    expect(fresh.muscles.Calves.state).toBe("none");
    expect(fresh.muscles.Calves.lastTrained).toBeNull();
  });

  it("a rest day reads every trained muscle (general readiness)", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: [], sets: history() });
    expect(r.scope).toBe("general");
    expect(r.relevant).toContain("Quads");
    expect(r.relevant).toContain("Chest");
    expect(r.relevant).not.toContain("Calves");
    expect(r.status).toBe("Recovered");
  });
});

describe("never a fabricated score", () => {
  it("nothing logged: no score", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: [] });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("no_training");
    expect(r.status).toBe("Not enough data yet");
  });

  it("one workout three weeks ago and no check-out: no score", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: bench(12) });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("too_little");
  });

  it("a long break is said, never a perfect 100", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: [...bench(20), ...bench(18)] });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("break");
  });

  it("today's muscles with nothing logged: no score", () => {
    const sets = [...squat(2), ...squat(4)];
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets });
    expect(r.score).toBeNull();
    expect(r.reason).toBe("no_muscle_data");
  });
});

describe("pain is never hidden by a high score", () => {
  it("pain on today's muscles caps the score and leads the observation", () => {
    const sets = history();
    const clean = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets });
    expect(clean.score!).toBeGreaterThan(PAIN_CAP);
    const r = buildTodayRecovery({
      now: NOW, today: TODAY, planned: lowerDay, sets,
      pain: [{ day: "2026-11-23", region: "knee", side: "left", site: null, score: 5, severity: "moderate" }],
    });
    expect(r.score).toBe(PAIN_CAP);
    expect(r.painCapped).toBe(true);
    expect(r.status).toBe("Pain flagged");
    expect(r.pain[0]).toMatchObject({ label: "Left knee", relevant: true, muscles: ["Quads", "Hamstrings"] });
    expect(r.observation).toBe("Left knee flagged Monday (5/10), counted in today's score.");
    expect(r.muscles.Quads.pain).toBe(true);
  });

  it("a severe report caps lower; pain elsewhere is still listed but doesn't cap", () => {
    const sets = history();
    const severe = buildTodayRecovery({
      now: NOW, today: TODAY, planned: lowerDay, sets,
      pain: [{ day: "2026-11-24", region: "quad", side: "right", site: null, score: 8, severity: "severe" }],
    });
    expect(severe.score).toBe(SEVERE_PAIN_CAP);
    const elsewhere = buildTodayRecovery({
      now: NOW, today: TODAY, planned: lowerDay, sets,
      pain: [{ day: "2026-11-24", region: "elbow", side: "left", site: null, score: 3, severity: "mild" }],
    });
    expect(elsewhere.painCapped).toBe(false);
    expect(elsewhere.pain).toHaveLength(1);
    expect(elsewhere.observation).toMatch(/^Left elbow flagged yesterday \(3\/10\)\.$/);
  });

  it("old pain (past 14 days) is not active; a check-out's pain flag with no report still counts", () => {
    const sets = history();
    const old = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets, pain: [{ day: "2026-11-01", region: "knee", side: null, site: null, score: 6, severity: null }] });
    expect(old.pain).toHaveLength(0);
    const checkout = buildTodayRecovery({
      now: NOW, today: TODAY, planned: lowerDay, sets,
      checkouts: [{ at: at(1, 18), sleepBucket: null, recovery: null, fatigueFeel: null, sessionRpe: null, pain: true, painArea: "Lower back", painLevel: 4 }],
    });
    expect(checkout.pain[0]).toMatchObject({ label: "Pain (Lower back)", relevant: true });
    expect(checkout.score!).toBeLessThanOrEqual(PAIN_CAP);
  });

  it("no data with a pain flag still says the pain", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: [], pain: [{ day: "2026-11-24", region: "shoulder", side: "right", site: null, score: 4, severity: null }] });
    expect(r.score).toBeNull();
    expect(r.observation).toBe("Right shoulder flagged yesterday (4/10).");
  });
});

describe("check-outs, sleep, cardio, energy and load move the score, each marked for what it is", () => {
  const sets = history();
  it("a fresh check-out makes it measured; short sleep and feeling beaten up lower it", () => {
    const base = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets });
    expect(base.basis).toBe("estimated");
    const r = buildTodayRecovery({
      now: NOW, today: TODAY, planned: upperDay, sets,
      checkouts: [{ at: at(0, 7), sleepBucket: "lt5", recovery: 2, fatigueFeel: "fatigued", sessionRpe: 9.5, pain: false }],
    });
    expect(r.basis).toBe("measured");
    expect(r.score!).toBeLessThan(base.score!);
    const kinds = Object.fromEntries(r.factors.map((f) => [f.key, f.kind]));
    expect(kinds).toMatchObject({ muscles: "estimated", sleep: "logged", feel: "logged", fatigue: "logged", session: "logged" });
  });

  it("a device's sleep is measured and wins over a check-out's", () => {
    const r = buildTodayRecovery({
      now: NOW, today: TODAY, planned: upperDay, sets,
      sleep: [{ day: TODAY, hours: 4.6 }],
      checkouts: [{ at: at(0, 7), sleepBucket: "gte8", recovery: null, fatigueFeel: null, sessionRpe: null, pain: false }],
    });
    const sleep = r.factors.find((f) => f.key === "sleep")!;
    expect(sleep.kind).toBe("device");
    expect(sleep.effect).toBe(-12);
    expect(r.observation).toMatch(/^Short sleep/);
  });

  it("hard cardio yesterday weighs more on a leg day than an upper day", () => {
    const cardio = [{ day: "2026-11-24", minutes: 45, rpe: 8 }];
    const up = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets, cardio });
    const low = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets, cardio });
    expect(up.factors.find((f) => f.key === "cardio")!.effect).toBe(-2);
    expect(low.factors.find((f) => f.key === "cardio")!.effect).toBe(-5);
    // easy cardio says nothing
    const easy = buildTodayRecovery({ now: NOW, today: TODAY, planned: lowerDay, sets, cardio: [{ day: "2026-11-24", minutes: 30, rpe: 4 }] });
    expect(easy.factors.some((f) => f.key === "cardio")).toBe(false);
  });

  it("low energy lowers it; a load spike over their usual is estimated", () => {
    const low = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets, energy: [{ day: "2026-11-20", rating: 2 }] });
    expect(low.factors.find((f) => f.key === "energy")).toMatchObject({ effect: -4, kind: "logged" });
    const spike = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: [...sets, ...bench(3, 8), ...row(3, 8), ...bench(2, 8)] });
    expect(spike.factors.find((f) => f.key === "load")).toMatchObject({ kind: "estimated" });
  });

  it("days off add a little, never past 100", () => {
    const r = buildTodayRecovery({ now: NOW, today: TODAY, planned: upperDay, sets: [...bench(9), ...row(9), ...bench(5), ...row(5)] });
    expect(r.factors.find((f) => f.key === "rest")).toMatchObject({ effect: 3 });
    expect(r.score!).toBeLessThanOrEqual(100);
  });
});

describe("helpers", () => {
  it("effort and state thresholds", () => {
    expect(effortWeight(null)).toBe(0.85);
    expect(effortWeight(9.5)).toBe(1.3);
    expect(effortWeight(5)).toBe(0.6);
    expect(stateFor(0.2)).toBe("recovered");
    expect(stateFor(0.5)).toBe("moderate");
    expect(stateFor(1)).toBe("elevated");
  });
  it("what kind of workout today is", () => {
    expect(workoutKind(new Map([["Chest", 0.6], ["Triceps", 0.4]]))).toBe("upper-body");
    expect(workoutKind(new Map([["Quads", 0.5], ["Chest", 0.5]]))).toBeNull();
  });
  it("weight lifted this week, load × reps, bodyweight sets left out", () => {
    const sets = [
      { day: "2026-11-23", loadKg: 100, reps: 5 },
      { day: "2026-11-24", loadKg: 0, reps: 10 },
      { day: "2026-11-16", loadKg: 200, reps: 1 },
    ];
    expect(weightLiftedKg(sets, "2026-11-23", TODAY)).toBe(500);
  });
});
