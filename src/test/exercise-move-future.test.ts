import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { moveExerciseInFutureDays } from "@/lib/exercise-move-db";

/** Just enough of the Supabase query builder for the calls the function makes. */
function fakeDb(tables: Record<string, any[]>) {
  const from = (name: string) => {
    let rows = tables[name] ?? [];
    let patch: any = null;
    let single = false;
    const orders: string[] = [];
    const b: any = {
      select: () => b,
      update: (p: any) => ((patch = p), b),
      eq: (c: string, v: any) => ((rows = rows.filter((r) => r[c] === v)), b),
      gt: (c: string, v: any) => ((rows = rows.filter((r) => r[c] > v)), b),
      in: (c: string, v: any[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b),
      // chained order() calls are primary, secondary… sort keys (as in PostgREST)
      order: (c: string) => (orders.push(c), b),
      maybeSingle: () => ((single = true), b),
      then: (res: any, rej: any) => {
        if (orders.length) {
          rows = [...rows].sort((x, y) => {
            for (const c of orders) {
              if (x[c] !== y[c]) return (x[c] ?? 0) > (y[c] ?? 0) ? 1 : -1;
            }
            return 0;
          });
        }
        if (patch) rows.forEach((r) => Object.assign(r, patch));
        const out = rows.map((r) =>
          name === "pl_exercise_rows"
            ? { ...r, exercises: r.exercise_id ? { name: tables.exercises.find((e) => e.id === r.exercise_id)?.name } : null }
            : r,
        );
        return Promise.resolve({ data: single ? (out[0] ?? null) : out, error: null }).then(res, rej);
      },
    };
    return b;
  };
  return { from };
}

// 5-week block, two workout slots per week. Slot 1 = "Lower A", slot 2 = "Upper".
function seed(clientId: string | null = "client-1") {
  const exercises = ["Squat", "RDL", "Leg Press", "Calf Raise", "Bench"].map((n, i) => ({ id: `ex${i}`, name: n }));
  const weeks = [1, 2, 3, 4, 5].map((n) => ({ id: `w${n}`, block_id: "blk", week_index: n }));
  const days: any[] = [];
  const rows: any[] = [];
  for (const w of weeks) {
    for (const slot of [1, 2]) {
      const id = `${w.id}d${slot}`;
      days.push({ id, week_id: w.id, day_index: slot });
      const names = slot === 1 ? ["Squat", "RDL", "Leg Press", "Calf Raise"] : ["Bench", "Calf Raise"];
      names.forEach((n, i) =>
        rows.push({ id: `${id}-${n}`, day_id: id, sort_order: i, exercise_id: exercises.find((e) => e.name === n)!.id, exercise_name_override: null }),
      );
    }
  }
  return {
    exercises,
    weeks,
    days,
    rows,
    pl_blocks: [{ id: "blk", client_id: clientId }],
    pl_day_completions: [{ day_id: "w4d1" }], // week 4 Lower A already done
  };
}

const t = (s: any) => ({
  exercises: s.exercises, pl_weeks: s.weeks, pl_days: s.days, pl_exercise_rows: s.rows,
  pl_blocks: s.pl_blocks, pl_day_completions: s.pl_day_completions,
});
const order = (s: any, day: string) =>
  s.rows.filter((r: any) => r.day_id === day).sort((a: any, b: any) => a.sort_order - b.sort_order).map((r: any) => r.id.split("-").slice(1).join("-"));

describe("moveExerciseInFutureDays", () => {
  it("carries a move to the same workout in later weeks, skipping completed and other-slot workouts", async () => {
    const s = seed();
    // In week 2 Lower A the athlete moved Leg Press above RDL (Squat, Leg Press, RDL, Calf Raise).
    const move = (id: string, sort: number) => (s.rows.find((r) => r.id === id)!.sort_order = sort);
    move("w2d1-Leg Press", 1); move("w2d1-RDL", 2);

    const res = await moveExerciseInFutureDays(fakeDb(t(s)), {
      dayId: "w2d1", rowId: "w2d1-Leg Press", prevRowId: "w2d1-Squat", nextRowId: "w2d1-RDL",
    });

    expect(res).toEqual({ updatedDays: 2, matchedDays: 2 }); // weeks 3 and 5 (4 is completed)
    expect(order(s, "w3d1")).toEqual(["Squat", "Leg Press", "RDL", "Calf Raise"]);
    expect(order(s, "w5d1")).toEqual(["Squat", "Leg Press", "RDL", "Calf Raise"]);
    // untouched: completed week, earlier week, other slot
    expect(order(s, "w4d1")).toEqual(["Squat", "RDL", "Leg Press", "Calf Raise"]);
    expect(order(s, "w1d1")).toEqual(["Squat", "RDL", "Leg Press", "Calf Raise"]);
    expect(order(s, "w3d2")).toEqual(["Bench", "Calf Raise"]);
  });

  it("keeps a week's own customisations and exercises the source doesn't have", async () => {
    const s = seed();
    // Week 3 Lower A was customised: an extra exercise sits between Squat and RDL.
    s.rows.push({ id: "w3d1-Bench", day_id: "w3d1", sort_order: 0.5, exercise_id: "ex4", exercise_name_override: null });
    await moveExerciseInFutureDays(fakeDb(t(s)), {
      dayId: "w2d1", rowId: "w2d1-Calf Raise", prevRowId: null, nextRowId: "w2d1-Squat", // Calf Raise to the top
    });
    expect(order(s, "w3d1")).toEqual(["Calf Raise", "Squat", "Bench", "RDL", "Leg Press"]);
  });

  it("matches the same exercise by name even when week-to-week library records differ", async () => {
    const s = seed();
    // Week 3 uses a differently-recorded "squat" (override text, no library id).
    const r = s.rows.find((x) => x.id === "w3d1-Squat")!;
    r.exercise_id = null; r.exercise_name_override = " squat ";
    await moveExerciseInFutureDays(fakeDb(t(s)), {
      dayId: "w2d1", rowId: "w2d1-Squat", prevRowId: "w2d1-Calf Raise", nextRowId: null, // Squat to the bottom
    });
    expect(order(s, "w3d1").at(-1)).toBe("Squat");
  });

  it("changes nothing and reports 0 when no later workout has the exercise", async () => {
    const s = seed();
    s.rows = s.rows.filter((r) => !(r.id.startsWith("w3d1") || r.id.startsWith("w5d1")) || !r.id.endsWith("Leg Press"));
    const res = await moveExerciseInFutureDays(fakeDb({ ...t(s), pl_exercise_rows: s.rows }), {
      dayId: "w2d1", rowId: "w2d1-Leg Press", prevRowId: null, nextRowId: "w2d1-Squat",
    });
    expect(res).toEqual({ updatedDays: 0, matchedDays: 0 });
  });

  it("reports matched-but-already-in-order separately", async () => {
    const s = seed();
    const res = await moveExerciseInFutureDays(fakeDb(t(s)), {
      dayId: "w2d1", rowId: "w2d1-RDL", prevRowId: "w2d1-Squat", nextRowId: "w2d1-Leg Press", // already there
    });
    expect(res).toEqual({ updatedDays: 0, matchedDays: 2 });
  });

  it("does nothing from the last week", async () => {
    const s = seed();
    const res = await moveExerciseInFutureDays(fakeDb(t(s)), {
      dayId: "w5d1", rowId: "w5d1-RDL", prevRowId: null, nextRowId: "w5d1-Squat",
    });
    expect(res).toEqual({ updatedDays: 0, matchedDays: 0 });
  });

  it("refuses template blocks", async () => {
    const s = seed(null);
    await expect(
      moveExerciseInFutureDays(fakeDb(t(s)), { dayId: "w2d1", rowId: "w2d1-RDL", prevRowId: null, nextRowId: "w2d1-Squat" }),
    ).rejects.toThrow(/template/i);
  });

  it("rejects neighbours that aren't in the source workout", async () => {
    const s = seed();
    await expect(
      moveExerciseInFutureDays(fakeDb(t(s)), { dayId: "w2d1", rowId: "w2d1-RDL", prevRowId: "w3d1-Squat", nextRowId: null }),
    ).rejects.toThrow(/order changed/i);
  });
});

describe("logger wiring", () => {
  const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  const actions = readFileSync("src/lib/quick-swap.functions.ts", "utf8");

  it("offers to carry each move to later weeks, off by default", () => {
    expect(logger).toContain("moveExerciseInFutureWorkouts");
    expect(logger).toContain("Move it the same way in later weeks of this block?");
    expect(logger).toContain('label: "Apply"');
    // both move paths offer it
    expect(logger).toContain('offerFutureMove(ordered, rowId, direction < 0 ? "Moved up" : "Moved down")');
    expect(logger).toContain("offerFutureMove(ordered, rowId, `Moved to exercise ${to + 1}`)");
  });

  it("authorises the source day before touching other days", () => {
    const fn = actions.slice(actions.indexOf("export const moveExerciseInFutureWorkouts"));
    expect(fn.indexOf("assertVisibleDay")).toBeGreaterThan(-1);
    expect(fn.indexOf("assertVisibleDay")).toBeLessThan(fn.indexOf("moveExerciseInFutureDays"));
  });
});
