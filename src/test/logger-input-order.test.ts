import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { finalWarmupRow, pickFinalWarmup, warmupsForModel, WARMUP_TOO_EASY, type WarmupSetRow } from "@/lib/final-warmup";

/**
 * Nov 20 2026: the same weight, reps and RPE typed in a different order must
 * save the same sets and give the same suggestion. Three places didn't:
 * the last warm-up row lost an RPE typed while its first save was out (it
 * remounted when the saved row came back), the weight's fill-down saved the
 * source set's RPE onto a set that showed one typed on it, and an RPE filled
 * onto sets still being logged changed only the screen.
 */
const wdv = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
const rows = readFileSync("src/components/workout-day/final-warmup-input.tsx", "utf8");

const w = (id: string, load: number, reps: number, rpe: number | null, unit: "kg" | "lb" = "kg"): WarmupSetRow => ({ id, load, unit, reps, rpe });

describe("the final warm-up is the same whatever order they were logged in", () => {
  const sets = [w("a", 140, 1, 7), w("b", 140, 2, 7), w("c", 100, 3, null), w("d", 140, 1, 8)];
  const orders = [sets, [...sets].reverse(), [sets[2], sets[3], sets[0], sets[1]]];
  it("ties on weight go to the harder rating, then more reps, never the last one logged", () => {
    for (const o of orders) expect(finalWarmupRow(o)!.id).toBe("d");
    const noRating = [w("x", 140, 1, null), w("y", 140, 2, null)];
    expect(finalWarmupRow(noRating)!.id).toBe("y");
    expect(finalWarmupRow([...noRating].reverse())!.id).toBe("y");
  });
  it("compares across units, and the engine's list is one fixed order", () => {
    expect(pickFinalWarmup([w("k", 100, 2, 7), w("l", 225, 2, 7, "lb")], "kg")!.load).toBeCloseTo(102.06, 1);
    const lists = orders.map((o) => JSON.stringify(warmupsForModel(o, "kg")));
    for (const l of lists) expect(l).toBe(lists[0]);
  });
});

describe("the last warm-up row saves what's on screen, in any order", () => {
  it("stays mounted while its first save turns it from new into a saved warm-up", () => {
    expect(rows).toContain('key="last-warmup"');
    expect(rows).not.toContain('key={inlineRow?.id ?? "new"}');
  });
  it("runs its saves one at a time with what's shown when each runs, onto the warm-up its first save made", () => {
    expect(rows).toContain("queue.current = queue.current");
    expect(rows).toContain("const v = shown.current;");
    expect(rows).toContain('if (typeof id === "string" && !idRef.current) idRef.current = id;');
    // reps or effort typed after the weight save, saved or still out
    expect(rows).not.toContain("if (existing) save({ reps: v });");
    expect(rows).not.toContain("if (existing) save({ effort: v });");
  });
  it("the save hands back the new warm-up's id", () => {
    expect(rows).toContain('.select("id").single().throwOnError();');
    expect(wdv).toContain("const id = await saveWarmup(v);");
  });
  it("a weight with no reps says what's missing instead of saving nothing silently", () => {
    expect(rows).toContain("data-warmup-needs-reps");
  });
});

describe("the fill-down saves what each set shows", () => {
  it("the weight's fill-down takes a set's own typed or filled-down reps / RPE before the source set's", () => {
    expect(wdv).toContain("const shownRpe = shownFieldRef.current.rpe.get(idx);");
    expect(wdv).toContain("const shownReps = shownFieldRef.current.reps.get(idx);");
    expect(wdv).toContain("shownFieldRef.current[field].set(fromSetIndex, value);");
    expect(wdv).toContain("for (const t of targets) shownFieldRef.current[field].set(t, value);");
  });
  it("an RPE filled onto sets still being logged waits for their rows and patches them", () => {
    expect(wdv).toContain("weightCascadeRef.current = { targets: new Set(targets), done: settled };");
    expect(wdv).toContain("tasks.push(inflight.done.then(async () => {");
    expect(wdv).toContain("const ex = savedRowNow(idx);");
  });
  it("undo / redo / removing a set starts the shown values over", () => {
    expect(wdv.match(/shownFieldRef\.current\.rpe\.clear\(\);/g)?.length).toBe(2);
  });
});

describe("a warm-up too easy to read is said, never a made-up number", () => {
  it("one wording everywhere", () => {
    expect(WARMUP_TOO_EASY).toBe("RPE too low for a reliable estimate");
    expect(rows).toContain("data-warmup-too-easy");
    expect(readFileSync("src/components/workout-day/load-suggestion-card.tsx", "utf8")).toContain('tooEasy ? "Warm-up too easy · after your first set"');
  });
});
