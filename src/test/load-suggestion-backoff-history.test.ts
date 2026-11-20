import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLoadModel, estimateFor, suggestSetLoad, todayVsUsual, BACKOFF_FATIGUE } from "@/lib/load-suggestion";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

const LB = 2.2046226218;
let n = 0;
// One logged set on a card (row) of a session, in lb.
function set(session: string, at: string, row: string, order: number, lb: number, reps: number, rpe: number, label: string | null = null): PreviousLiftLog {
  return {
    id: `s${n++}`, exerciseId: "comp-squat", exerciseName: "Competition Squat", sessionKey: session, occurredAt: at,
    reps, rpe, rir: null, enteredValue: lb, enteredUnit: "lb", normalizedKg: lb / LB, normalizedLb: lb,
    isWorkingSet: null, loadType: "external", purposeLabel: label, rowId: row, rowOrder: order,
  };
}

// Jared's squat, Oct–Nov 2026: a top set card, then a back-off card of the same lift.
const jared: PreviousLiftLog[] = [
  set("nov9", "2026-11-09T18:00:00Z", "n9-top", 1, 425, 4, 6, "Primary Squat"),
  set("nov9", "2026-11-09T18:10:00Z", "n9-bo", 2, 405, 4, 6, "Primary Squat Backoff"),
  set("nov9", "2026-11-09T18:15:00Z", "n9-bo", 2, 405, 4, 6, "Primary Squat Backoff"),
  set("nov2", "2026-11-02T18:00:00Z", "n2-top", 1, 405, 4, 5, "Primary Squat"),
  set("nov2", "2026-11-02T18:10:00Z", "n2-bo", 2, 365, 4, 6, "Primary Squat Backoff"),
];
const now = new Date("2026-11-16T17:00:00Z");
const model = (backoffs?: "as_top_set" | "as_logged", extra: Partial<Parameters<typeof buildLoadModel>[0]> = {}) =>
  buildLoadModel({ history: jared, today: [], unit: "lb", lift: "competition", now, backoffs, ...extra });

describe("a cold suggestion reads past back-offs as the top set they imply (note 11)", () => {
  it("Jared's 4 @ 6: last week's 425 top set leads, the tired 405 back-offs no longer drag it down", () => {
    const before = suggestSetLoad(model("as_logged"), { reps: 4, rpe: 6 })!;
    const after = suggestSetLoad(model(), { reps: 4, rpe: 6 })!;
    expect(before.target).toBeLessThan(425);
    expect(after.target).toBeGreaterThanOrEqual(425);
    expect(after.target).toBeLessThanOrEqual(435);
    expect(model().backoffsAsTopSet).toBe(3);
  });

  it("a back-off counts at exactly ÷ (1 − BACKOFF_FATIGUE): a lone back-off card reads as its top set", () => {
    const onlyBackoffs = [
      set("a", "2026-11-09T18:00:00Z", "a-bo", 1, 376, 4, 6, "Backoff"),
      set("b", "2026-11-02T18:00:00Z", "b-bo", 1, 376, 4, 6, "Backoff"),
    ];
    const asTop = estimateFor(buildLoadModel({ history: onlyBackoffs, today: [], unit: "lb", lift: "competition", now }), 4, 6)!;
    const asLogged = estimateFor(buildLoadModel({ history: onlyBackoffs, today: [], unit: "lb", lift: "competition", now, backoffs: "as_logged" }), 4, 6)!;
    expect(asTop.load / asLogged.load).toBeCloseTo(1 / (1 - BACKOFF_FATIGUE), 6);
  });

  it("with no label, a later card of the same exercise that day is the back-off; the first card is read as logged", () => {
    const unlabelled = jared.map((l) => ({ ...l, purposeLabel: null }));
    expect(buildLoadModel({ history: unlabelled, today: [], unit: "lb", lift: "competition", now }).backoffsAsTopSet).toBe(3);
    // Without card info (older history), only a label can say it was a back-off.
    const legacy = jared.map((l) => ({ ...l, rowId: null, rowOrder: null, purposeLabel: null }));
    expect(buildLoadModel({ history: legacy, today: [], unit: "lb", lift: "competition", now }).backoffsAsTopSet).toBe(0);
  });

  it("once a set is logged today, or a back-off reads today's top set, history is read as logged (unchanged)", () => {
    const today = [{ load: 430, reps: 4, rpe: 6.5 }];
    const live = model(undefined, { today });
    expect(live.backoffsAsTopSet).toBe(0);
    expect(estimateFor(live, 4, 6)!.load).toBeCloseTo(estimateFor(model("as_logged", { today }), 4, 6)!.load, 9);
    const carried = model(undefined, { carryToday: [{ load: 425, reps: 4, rpe: 7 }] });
    expect(carried.backoffsAsTopSet).toBe(0);
  });

  it("the day read across cards compares today's sets with history as logged", () => {
    const sets = [{ load: 425, reps: 4, rpe: 6 }];
    const ratio = todayVsUsual({ history: jared, sets, unit: "lb", lift: "competition", now })!;
    expect(ratio).toBeCloseTo(425 / estimateFor(model("as_logged"), 4, 6)!.load, 9);
  });

  it("the logger gives the engine each set's card and its place in the workout", () => {
    const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
    expect(wdv).toContain("purpose_label, sort_order, reps_text, exercises(name)");
    expect(wdv).toContain("rowId: log.row_id ?? null,");
    expect(wdv).toContain("rowOrder: historyRow?.sort_order ?? null,");
    const card = readFileSync("src/components/workout-day/load-suggestion-card.tsx", "utf8");
    expect(card).toContain("data-testid=\"load-backoff-history\"");
  });
});
