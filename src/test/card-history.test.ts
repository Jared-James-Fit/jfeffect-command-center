import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  canResetTo,
  planRestore,
  record,
  resetTarget,
  setPayload,
  snapshotKey,
  snapshotOf,
  stepBack,
  stepForward,
} from "@/lib/card-history";

const set = (i: number, load: number | null, extra: Record<string, unknown> = {}) => ({
  id: `r${i}`,
  set_index: i,
  actual_load: load,
  actual_load_unit: "lb",
  entered_value: load,
  entered_unit: "lb",
  actual_reps: 5,
  actual_rpe: "8",
  actual_rpe_num: 8,
  completed_at: "2026-10-12T10:00:00.123Z",
  load_type: "external",
  is_bodyweight: false,
  ...extra,
});

describe("card history: snapshots", () => {
  it("the same state looks the same however it was formatted", () => {
    const server = snapshotOf([set(1, 315, { completed_at: "2026-10-12T10:00:00.123+00:00", actual_reps: "5" })], 3);
    const optimistic = snapshotOf([set(1, 315, { is_bodyweight: undefined, load_type: undefined })], 3);
    expect(snapshotKey(server)).toBe(snapshotKey(optimistic));
    // NOT NULL columns fall back to their defaults, never null.
    expect(optimistic.sets[0].is_bodyweight).toBe(false);
    expect(optimistic.sets[0].load_type).toBe("external");
  });

  it("only what the athlete sees makes a step (a server timestamp tweak doesn't)", () => {
    const a = snapshotOf([set(1, 315)], 3);
    const b = snapshotOf([set(1, 315, { completed_at: "2026-10-12T10:00:05Z", completion_method: "manual" })], 3);
    expect(snapshotKey(a)).toBe(snapshotKey(b));
    expect(snapshotKey(a)).not.toBe(snapshotKey(snapshotOf([set(1, 320)], 3)));
    expect(snapshotKey(a)).not.toBe(snapshotKey(snapshotOf([set(1, 315, { completed_at: null })], 3)));
    expect(snapshotKey(a)).not.toBe(snapshotKey(snapshotOf([set(1, 315)], 4)));
  });

  it("warm-ups are part of the card", () => {
    const w = snapshotOf([], 3, [{ load: 225, unit: "lb", reps: 3, rpe: 7 }]);
    expect(w.warmups).toEqual([{ load: 225, unit: "lb", reps: 3, rpe: 7 }]);
    expect(canResetTo(w, 3)).toBe(true);
  });
});

describe("card history: undo / redo / reset", () => {
  const s0 = snapshotOf([], 3);
  const s1 = snapshotOf([set(1, 315)], 3);
  const s2 = snapshotOf([set(1, 315), set(2, 315)], 3);

  it("undo walks back, redo walks forward, a new change clears redo", () => {
    let h = record(record(record(EMPTY_HISTORY, s0), s1), s2);
    expect(h.past).toHaveLength(2);
    const back = stepBack(h)!;
    expect(snapshotKey(back.target)).toBe(snapshotKey(s1));
    h = back.history;
    const fwd = stepForward(h)!;
    expect(snapshotKey(fwd.target)).toBe(snapshotKey(s2));
    h = record(h, snapshotOf([set(1, 300)], 3));
    expect(h.future).toHaveLength(0);
    expect(stepForward(h)).toBeNull();
  });

  it("an unchanged state is not a step; history is capped", () => {
    const h = record(record(EMPTY_HISTORY, s1), snapshotOf([set(1, 315)], 3));
    expect(h.past).toHaveLength(0);
    let big = record(EMPTY_HISTORY, s0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) big = record(big, snapshotOf([set(1, 100 + i)], 3));
    expect(big.past).toHaveLength(HISTORY_LIMIT);
  });

  it("reset clears to the set count the card opened with, and is itself undoable", () => {
    const added = snapshotOf([set(1, 315), set(4, 315)], 4);
    expect(canResetTo(added, 3)).toBe(true);
    expect(canResetTo(s0, 3)).toBe(false);
    const h = record(record(EMPTY_HISTORY, added), resetTarget(3));
    expect(h.present).toEqual({ setCount: 3, sets: [], warmups: [] });
    expect(snapshotKey(stepBack(h)!.target)).toBe(snapshotKey(added));
  });
});

describe("card history: writing a snapshot back", () => {
  it("keeps row ids by set index, deletes the rest, only rewrites what changed", () => {
    const rows = [set(1, 315), set(2, 320), set(3, 325)];
    const current = snapshotOf(rows, 3);
    const target = snapshotOf([set(1, 315), set(2, 300)], 2);
    const plan = planRestore(rows, current, target);
    expect(plan.upserts.map((u) => [u.id, u.set.set_index, u.set.actual_load])).toEqual([["r2", 2, 300]]);
    expect(plan.deletes).toEqual(["r3"]);
    expect(plan.setCount).toBe(2);
    expect(plan.warmups).toBeNull();
  });

  it("undoing a removed set puts it back where it was (later sets shift back down)", () => {
    // Remove set 2 of 3: set 3 became set 2.
    const before = snapshotOf([set(1, 315), set(2, 320), set(3, 325)], 3);
    const rowsAfter = [set(1, 315), { ...set(2, 325), id: "r3" }];
    const after = snapshotOf(rowsAfter, 2);
    const plan = planRestore(rowsAfter, after, before);
    expect(plan.upserts.map((u) => [u.id, u.set.set_index, u.set.actual_load])).toEqual([["r3", 2, 320], [null, 3, 325]]);
    expect(plan.deletes).toEqual([]);
    expect(plan.setCount).toBe(3);
  });

  it("a stored row gets ISO timestamps and column defaults back", () => {
    const p = setPayload(snapshotOf([set(1, 315, { is_bodyweight: null })], 3).sets[0]);
    expect(p.completed_at).toBe("2026-10-12T10:00:00.123Z");
    expect(p.is_bodyweight).toBe(false);
    expect(p.load_type).toBe("external");
    expect(p.set_index).toBe(1);
    // normalized kg/lb are the DB trigger's job, never written from a snapshot
    expect(p).not.toHaveProperty("normalized_kg");
  });
});

describe("card history: wired into the exercise card", () => {
  const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("Undo / Redo / Reset sit at the top of the ⋯ menu", () => {
    const menu = wdv.slice(wdv.indexOf('data-testid="card-undo"') - 600, wdv.indexOf("Exercise {movePosition} of {moveCount}"));
    const order = ["card-undo", "card-redo", "card-reset", "Swap exercise", "Show cues", "Training help"].map((k) => menu.indexOf(k));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Undo/Redo keep the menu open for several steps in a row.
    expect(wdv).toContain('onSelect={(e) => { e.preventDefault(); void runCardHistory("undo"); }}');
    expect(wdv).not.toContain("<WorkoutToolsButton context={name} />");
  });
  it("only starts watching once server data has settled, and restores without autosaving back", () => {
    expect(wdv).toContain("ready: resultsReady && warmupsReady && !readonly && !!clientId,");
    expect(wdv).toContain("resultsReady={resultsLoaded && !resultsFetching}");
    expect(wdv).toContain("save.markClean();");
    expect(wdv).toContain("if (draftKey) clearLocalDraft(draftKey);");
  });
  it("Swap and Help open sheets that live outside the menu", () => {
    expect(wdv).toContain("<DeferredQuickSwapSheet");
    expect(wdv).toContain("<TrainingHelpSheet open={helpOpen} onOpenChange={setHelpOpen} />");
  });
});
