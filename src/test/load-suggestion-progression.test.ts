import { describe, expect, it } from "vitest";
import {
  buildLoadModel,
  equipmentKindOf,
  estimateFor,
  loadIncrement,
  repProgression,
  snapLoad,
  suggestSetLoad,
  warmupRelevance,
  WARMUP_RELEVANT_FROM,
  WARMUP_RELEVANT_FULL,
} from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const NOW = new Date("2026-11-20T18:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
let n = 0;
const log = (
  session: string,
  d: number,
  load: number,
  reps: number,
  rpe: number | null,
  unit: "kg" | "lb" = "lb",
  extra: Partial<PreviousLiftLog> = {},
): PreviousLiftLog => {
  const kg = unit === "kg" ? load : load * 0.45359237;
  return {
    id: `l${n++}`, exerciseId: "x", exerciseName: "X", sessionKey: session, occurredAt: daysAgo(d), reps, rpe, rir: null,
    enteredValue: load, enteredUnit: unit, normalizedKg: kg, normalizedLb: kg / 0.45359237,
    isWorkingSet: true, loadType: "external", rowId: `${session}-row`, rowOrder: 3, repsText: "8-12", ...extra,
  };
};
const session = (key: string, d: number, load: number, reps: number[], rpe: number | null, unit: "kg" | "lb" = "lb") =>
  reps.map((r) => log(key, d, load, r, rpe, unit));

const range = { lo: 8, hi: 12 };
const prog = { range, rpe: 8 };

describe("double progression on a rep range (note 12)", () => {
  it("every set at the top of the range at the target effort: the smallest step up", () => {
    const history = [...session("a", 14, 65, [12, 11, 10], 8), ...session("b", 7, 70, [12, 12, 12], 8)];
    const m = buildLoadModel({ history, today: [], unit: "lb", lift: "other", equipment: "machine", progression: prog, now: NOW });
    expect(m.source).toBe("progression");
    const s = suggestSetLoad(m, { reps: 10, rpe: 8 })!;
    expect(s.progression?.action).toBe("add");
    expect(s.target).toBe(75); // their own 5 lb steps (65 → 70)
    expect(s.low).toBe(75);
    expect(s.high).toBe(75);
  });

  it("the old engine read the range's middle and kept them on the same weight", () => {
    const history = [...session("a", 14, 65, [12, 11, 10], 8), ...session("b", 7, 70, [12, 12, 12], 8)];
    const old = suggestSetLoad(buildLoadModel({ history, today: [], unit: "lb", lift: "other", now: NOW }), { reps: 10, rpe: 8 })!;
    expect(old.target).toBe(70);
  });

  it("still building reps: stay on the weight", () => {
    const history = session("b", 7, 70, [12, 11, 9], 8);
    const s = suggestSetLoad(buildLoadModel({ history, today: [], unit: "lb", lift: "other", progression: prog, now: NOW }), { reps: 10, rpe: 8 })!;
    expect(s.progression?.action).toBe("hold");
    expect(s.target).toBe(70);
  });

  it("the top reps rated harder than the target aren't earned yet: stay", () => {
    const history = session("b", 7, 70, [12, 12, 12], 9.5);
    const s = suggestSetLoad(buildLoadModel({ history, today: [], unit: "lb", lift: "other", progression: prog, now: NOW }), { reps: 10, rpe: 8 })!;
    expect(s.progression?.action).toBe("hold");
    expect(s.target).toBe(70);
  });

  it("every set short of the bottom of the range: down a step", () => {
    const history = [...session("a", 14, 65, [10, 10], 8), ...session("b", 7, 75, [7, 6, 6], 9)];
    const s = suggestSetLoad(buildLoadModel({ history, today: [], unit: "lb", lift: "other", equipment: "machine", progression: prog, now: NOW }), { reps: 10, rpe: 8 })!;
    expect(s.progression?.action).toBe("drop");
    expect(s.target).toBe(65);
  });

  it("a new rep range isn't a failed set: 12 reps at the top of 10–12 is never 'short' of 15–20", () => {
    const history = [12, 12, 12].map((r) => log("b", 7, 30, r, 8, "lb", { repsText: "10-12" }));
    const m = buildLoadModel({ history, today: [], unit: "lb", lift: "other", progression: { range: { lo: 15, hi: 20 }, rpe: 8 }, now: NOW });
    expect(m.progression).toBeNull();
    // older history with no prescription on it: judged on today's range, but never a drop
    const bare = [12, 12, 12].map((r) => log("b", 7, 30, r, 8, "lb", { repsText: null }));
    const p = buildLoadModel({ history: bare, today: [], unit: "lb", lift: "other", progression: { range: { lo: 15, hi: 20 }, rpe: 8 }, now: NOW }).progression;
    expect(p?.action).toBe("hold");
  });

  it("a weight already moved up mid-session is the one to build on", () => {
    const history = [log("b", 7, 70, 12, 8), log("b", 7, 70, 12, 8), log("b", 7, 75, 10, 8)];
    const p = repProgression({ sets: history.map((h) => ({ load: h.enteredValue!, reps: h.reps!, rpe: 8 })), range, targetRpe: 8, step: 5 })!;
    expect(p.from).toBe(75);
    expect(p.action).toBe("hold");
  });

  it("a different rep range last time isn't read this way (the RPE model takes it)", () => {
    expect(repProgression({ sets: [{ load: 100, reps: 3, rpe: 8 }], range, targetRpe: 8, step: 5 })).toBeNull();
    expect(repProgression({ sets: [{ load: 30, reps: 20, rpe: 8 }], range, targetRpe: 8, step: 5 })).toBeNull();
    const history = session("b", 7, 100, [3, 3, 3], 8);
    const m = buildLoadModel({ history, today: [], unit: "lb", lift: "other", progression: prog, now: NOW });
    expect(m.source).not.toBe("progression");
  });

  it("a jump they've never lifted that's over a quarter of the weight: stay and add reps", () => {
    const p = repProgression({ sets: [{ load: 10, reps: 15, rpe: 8 }], range: { lo: 12, hi: 15 }, targetRpe: 8, step: 5, ladder: [10] })!;
    expect(p.action).toBe("hold");
    expect(p.bigJump).toBe(true);
    // they've done 15 before: it's a weight they have, so it's offered
    const q = repProgression({ sets: [{ load: 10, reps: 15, rpe: 8 }], range: { lo: 12, hi: 15 }, targetRpe: 8, step: 5, ladder: [10, 15] })!;
    expect(q.action).toBe("add");
    expect(q.load).toBe(15);
  });

  it("one session without a rating is enough (reps are what double progression reads)", () => {
    const history = session("b", 5, 40, [12, 12], null);
    const m = buildLoadModel({ history, today: [], unit: "lb", lift: "other", equipment: "dumbbell", progression: prog, now: NOW });
    expect(m.status).toBe("ready");
    expect(suggestSetLoad(m, { reps: 10, rpe: 8 })!.target).toBe(45); // a 5 lb dumbbell step
  });

  it("not on a competition lift, not once a set is logged today, not after a month off", () => {
    const history = session("b", 7, 70, [12, 12, 12], 8);
    expect(buildLoadModel({ history, today: [], unit: "lb", lift: "competition", progression: prog, now: NOW }).progression).toBeNull();
    expect(buildLoadModel({ history, today: [{ load: 75, reps: 9, rpe: null }], unit: "lb", lift: "other", progression: prog, now: NOW }).progression).toBeNull();
    const old = session("b", 35, 70, [12, 12, 12], 8);
    expect(buildLoadModel({ history: old, today: [], unit: "lb", lift: "other", progression: prog, now: NOW }).progression ?? null).toBeNull();
  });

  it("once the card is done, next time is read from today's sets the same way", () => {
    const history = session("b", 7, 70, [12, 12, 12], 8);
    const today = [{ load: 75, reps: 12, rpe: 8 }, { load: 75, reps: 12, rpe: 8 }, { load: 75, reps: 12, rpe: 8 }];
    const m = buildLoadModel({ history, today, unit: "lb", lift: "other", equipment: "machine", progression: prog, now: NOW });
    expect(m.progressionNext?.action).toBe("add");
    expect(m.progressionNext?.load).toBe(80);
  });

  it("the same logs in any order give the same answer", () => {
    const history = [...session("a", 14, 65, [12, 11, 10], 8), ...session("b", 7, 70, [12, 12, 12], 8)];
    const fwd = suggestSetLoad(buildLoadModel({ history, today: [], unit: "lb", lift: "other", progression: prog, now: NOW }), { reps: 10, rpe: 8 });
    const rev = suggestSetLoad(buildLoadModel({ history: [...history].reverse(), today: [], unit: "lb", lift: "other", progression: prog, now: NOW }), { reps: 10, rpe: 8 });
    expect(rev).toEqual(fwd);
  });
});

describe("weight steps the athlete actually loads", () => {
  it("a kg cable stack in 2.3 kg steps stays on the stack", () => {
    const ladder = [11.3, 13.6, 15.9];
    expect(loadIncrement({ ladder, unit: "kg", load: 13.6, kind: "cable" })).toBe(2.3);
    expect(snapLoad(14.1, 2.3, ladder)).toBe(13.6);
    expect(snapLoad(17.9, 2.3, ladder)).toBe(18.2);
    const p = repProgression({ sets: [{ load: 13.6, reps: 12, rpe: 8 }], range, targetRpe: 8, step: 2.3, ladder })!;
    expect(p.load).toBe(15.9);
  });

  it("a 10 lb machine stack moves in 10s; a dumbbell rack in 5 lb past the light ones", () => {
    expect(loadIncrement({ ladder: [90, 100, 110], unit: "lb", load: 100, kind: "machine" })).toBe(10);
    expect(loadIncrement({ ladder: [], unit: "lb", load: 40, kind: "dumbbell" })).toBe(5);
    expect(loadIncrement({ ladder: [], unit: "lb", load: 10, kind: "dumbbell" })).toBe(2.5);
    expect(loadIncrement({ ladder: [], unit: "kg", load: 16, kind: "dumbbell" })).toBe(2.5);
  });

  it("a bar never gets coarser than plates, whatever jumps were made; microplates make it finer", () => {
    expect(loadIncrement({ ladder: [135, 155, 185], unit: "lb", load: 185, kind: "barbell" })).toBe(5);
    expect(loadIncrement({ ladder: [135, 137.5, 140], unit: "lb", load: 140, kind: "barbell" })).toBe(2.5);
    expect(loadIncrement({ ladder: [100, 105], unit: "kg", load: 100, kind: null })).toBe(2.5);
  });

  it("knows a dumbbell, a cable and a machine by name or equipment", () => {
    expect(equipmentKindOf("Incline DB Press")).toBe("dumbbell");
    expect(equipmentKindOf("Lateral Raise", "Dumbbells")).toBe("dumbbell");
    expect(equipmentKindOf("Cable Lateral Raise")).toBe("cable");
    expect(equipmentKindOf("Leg Press")).toBe("machine");
    expect(equipmentKindOf("Romanian Deadlift", "Barbell")).toBe("barbell");
    expect(equipmentKindOf("Pull Up")).toBe("other");
  });

  it("a suggestion on a cable lands on a weight that's on their stack, not a round kg", () => {
    const history = [
      ...session("a", 14, 11.3, [10, 10], 8, "kg"),
      ...session("b", 9, 13.6, [10, 10], 8, "kg"),
      ...session("c", 2, 13.6, [10, 10], 7, "kg"),
    ];
    const s = suggestSetLoad(buildLoadModel({ history, today: [], unit: "kg", lift: "other", equipment: "cable", now: NOW }), { reps: 10, rpe: 8 })!;
    expect([11.3, 13.6, 15.9]).toContain(s.target);
  });

  it("the competition lifts keep plate steps", () => {
    const history = [...session("a", 9, 140, [5, 5], 8, "kg"), ...session("b", 2, 145, [5, 5], 8, "kg")];
    const m = buildLoadModel({ history, today: [], unit: "kg", lift: "competition", equipment: "barbell", now: NOW });
    expect(m.ladder).toEqual([]);
    expect(suggestSetLoad(m, { reps: 5, rpe: 8 })!.target % 2.5).toBe(0);
  });

  it("kg and lb read the same history the same way (within one step)", () => {
    const kg = [...session("a", 9, 140, [5, 5], 8, "kg"), ...session("b", 2, 145, [5, 5], 8, "kg")];
    const sKg = suggestSetLoad(buildLoadModel({ history: kg, today: [], unit: "kg", lift: "competition", now: NOW }), { reps: 5, rpe: 8 })!;
    const sLb = suggestSetLoad(buildLoadModel({ history: kg, today: [], unit: "lb", lift: "competition", now: NOW }), { reps: 5, rpe: 8 })!;
    expect(Math.abs(sLb.target * 0.45359237 - sKg.target)).toBeLessThanOrEqual(2.5);
  });
});

describe("a warm-up far under the working weight says nothing about today", () => {
  const history = [
    ...session("a", 9, 140, [5, 5, 5], 8, "kg"),
    ...session("b", 2, 145, [5, 5, 5], 8, "kg"),
  ];
  const model = (w: { load: number; reps: number; rpe: number | null }) =>
    buildLoadModel({ history, today: [], unit: "kg", lift: "competition", warmups: [w], now: NOW });
  const plain = estimateFor(buildLoadModel({ history, today: [], unit: "kg", lift: "competition", now: NOW }), 5, 8)!.load;

  it("relevance ramps from 0 at 60% of the working weight to full at 75%", () => {
    expect(warmupRelevance(60, 100)).toBe(0);
    expect(warmupRelevance(WARMUP_RELEVANT_FROM * 100, 100)).toBe(0);
    expect(warmupRelevance(WARMUP_RELEVANT_FULL * 100, 100)).toBe(1);
    expect(warmupRelevance(67.5, 100)).toBeCloseTo(0.5, 6);
  });

  it("the bar rated 'RPE 7' leaves history's number alone, and says it was too light", () => {
    const e = estimateFor(model({ load: 20, reps: 5, rpe: 7 }), 5, 8)!;
    expect(e.load).toBeCloseTo(plain, 6);
    expect(e.warmup).toBe("light");
    // however hard it was rated
    expect(estimateFor(model({ load: 60, reps: 3, rpe: 9.5 }), 5, 8)!.load).toBeCloseTo(plain, 6);
    expect(suggestSetLoad(model({ load: 60, reps: 3, rpe: 7 }), { reps: 5, rpe: 8 })!.warmup).toBe("light");
  });

  it("near the working weight it still tunes, and moving the weight never jumps the number", () => {
    const tuned = estimateFor(model({ load: 125, reps: 3, rpe: 7.5 }), 5, 8)!;
    expect(tuned.warmup).toBe("tuned");
    expect(tuned.load).toBeLessThan(plain);
    // a ramp from too light to fully read: the number moves a little at a time
    let prev = plain;
    for (let w = 70; w <= 130; w += 2.5) {
      const l = estimateFor(model({ load: w, reps: 3, rpe: 9 }), 5, 8)!.load;
      expect(Math.abs(l - prev) / plain).toBeLessThan(0.06);
      prev = l;
    }
  });

  it("several warm-ups in any order give the same weight", () => {
    const list = [{ load: 60, reps: 5, rpe: 6 }, { load: 100, reps: 3, rpe: 7 }, { load: 125, reps: 1, rpe: 7 }, { load: 122.5, reps: 2, rpe: 8 }];
    const a = suggestSetLoad(buildLoadModel({ history, today: [], unit: "kg", lift: "competition", warmups: list, now: NOW }), { reps: 5, rpe: 8 });
    const b = suggestSetLoad(buildLoadModel({ history, today: [], unit: "kg", lift: "competition", warmups: [...list].reverse(), now: NOW }), { reps: 5, rpe: 8 });
    expect(b).toEqual(a);
  });
});
