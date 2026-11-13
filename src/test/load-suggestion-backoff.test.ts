import { describe, expect, it } from "vitest";
import { buildLoadModel, estimateFor, suggestSetLoad, type SetSample } from "@/lib/load-suggestion";
import { computeDayReads, type DayReadRow } from "@/lib/workout-day-read";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

// Nov 13 2026: Competition Deadlift, 1 × 4 @ 5–6 on one card, 2 × 4 @ 6 on the
// next. The top set went 495 lb × 4 @ 10 and the back-offs were still
// suggested at 485 (460–515), "Live +1%": the back-off was its history moved by
// a capped day factor, and history (495 × 3 @ 5 the week before) read as "495
// for 4 at anything heavy", so the top set rated 7, 8, 9 or 10 all gave 485.
const NOW = new Date("2026-11-13T19:00:00Z");
const LB = 2.2046226218;
const log = (session: string, date: string, lb: number, reps: number, rpe: number | null): PreviousLiftLog => ({
  id: `${session}-${lb}-${Math.random()}`, exerciseId: "dl", exerciseName: "Competition Deadlift", sessionKey: session,
  occurredAt: new Date(`${date}T18:00:00Z`).toISOString(), reps, rpe, rir: null,
  enteredValue: lb, enteredUnit: "lb", normalizedKg: lb / LB, normalizedLb: lb, isWorkingSet: true, loadType: "external",
});
const history = [
  log("n7", "2026-11-07", 495, 3, 5),
  log("o17", "2026-10-17", 386, 5, 6), log("o17", "2026-10-17", 265, 5, 6), log("o17", "2026-10-17", 353, 5, 6), log("o17", "2026-10-17", 375, 5, 6),
  log("o10", "2026-10-10", 441, 5, 5), log("o10", "2026-10-10", 375, 5, 6), log("o10", "2026-10-10", 375, 5, 6), log("o10", "2026-10-10", 375, 5, 6),
  log("o2", "2026-10-02", 495, 5, 4), log("o2", "2026-10-02", 315, 5, 6), log("o2", "2026-10-02", 315, 5, 6),
  log("s22", "2026-09-22", 546, 1, 8), log("s22", "2026-09-22", 595, 1, 8),
];
const BACKOFF = { reps: 4, rpe: 6 };
const card = (rowId: string, sets: DayReadRow["sets"] = []): DayReadRow =>
  ({ rowId, name: "Competition Deadlift", exerciseKey: "dl", family: "deadlift", history, sets });
const set = (lb: number, reps: number, rpe: number, at: number) => ({ load: lb / LB, reps, rpe, at });

/** What the back-off card suggests, wired like WorkoutDayView (kg day read → the card's unit). */
function backoff(topRpe: number, own: SetSample[] = []) {
  const reads = computeDayReads([card("top", [set(495, 4, topRpe, 1)]), card("back", own.map((s, i) => set(s.load, s.reps, s.rpe!, 2 + i)))], null, NOW);
  const r = reads.get("back")!;
  const model = buildLoadModel({
    history, today: own, unit: "lb", now: NOW,
    dayFactor: r.factor, carryToday: r.carryKg.map((x) => ({ ...x, load: x.load * LB })),
  });
  return { model, read: r, hint: suggestSetLoad(model, BACKOFF)! };
}

describe("a back-off on its own card follows today's top set", () => {
  it("495 × 4 @ 10 → 2 × 4 @ 6 at about 445, not 485", () => {
    const { hint, model, read } = backoff(10);
    expect(model.carried).toBe(true);
    expect(model.source).toBe("blend");
    expect(model.dayFactor).toBeNull(); // the top set is read directly, not as a capped nudge
    expect(read.fromName).toBe("Competition Deadlift");
    expect(hint.target).toBeGreaterThanOrEqual(435);
    expect(hint.target).toBeLessThanOrEqual(450);
    expect(hint.high).toBeLessThan(485);
  });

  it("a harder top set always means a lighter back-off", () => {
    const targets = [5, 6, 7, 8, 9, 10].map((rpe) => backoff(rpe).hint.target);
    for (let i = 1; i < targets.length; i++) expect(targets[i]).toBeLessThanOrEqual(targets[i - 1]);
    expect(targets[5]).toBeLessThan(targets[2] - 25); // @10 vs @7: a real difference, not 0
  });

  it("history only ever brings it down, never up", () => {
    const cold = estimateFor(buildLoadModel({ history, today: [], unit: "lb", now: NOW }), BACKOFF.reps, BACKOFF.rpe)!.load;
    expect(cold).toBeGreaterThan(470); // history alone still says ~480 for 4 @ 6
    const fromTopOnly = estimateFor(buildLoadModel({ history: [], today: [], unit: "lb", now: NOW, carryToday: [{ load: 495, reps: 4, rpe: 10 }] }), BACKOFF.reps, BACKOFF.rpe)!.load;
    expect(estimateFor(backoff(10).model, BACKOFF.reps, BACKOFF.rpe)!.load).toBeLessThanOrEqual(fromTopOnly + 1e-9);
  });

  it("set 2 holds when set 1 landed on target, and follows how set 1 felt", () => {
    const on = backoff(10, [{ load: 445, reps: 4, rpe: 6 }]).hint.target;
    const harder = backoff(10, [{ load: 445, reps: 4, rpe: 7 }]).hint.target;
    const easier = backoff(10, [{ load: 445, reps: 4, rpe: 5 }]).hint.target;
    expect(on).toBe(445); // never drifts back up toward history's 480
    expect(harder).toBeLessThan(on);
    expect(easier).toBeGreaterThan(on);
  });

  it("the top set's card never reads the back-offs after it (its Next time stays its own)", () => {
    const reads = computeDayReads([card("top", [set(495, 4, 10, 1)]), card("back", [set(445, 4, 6, 2), set(445, 4, 6, 3)])], null, NOW);
    expect(reads.get("top")!.carryKg).toEqual([]);
    expect(reads.get("back")!.carryKg).toHaveLength(1);
  });

  it("a variation of the family still moves by the capped day factor", () => {
    const reads = computeDayReads([
      card("top", [set(495, 4, 6, 1)]),
      { ...card("pause"), exerciseKey: "pdl", name: "Paused Deadlift" },
    ], null, NOW);
    expect(reads.get("pause")!.carryKg).toEqual([]);
    expect(reads.get("pause")!.factor).not.toBeNull();
  });
});
