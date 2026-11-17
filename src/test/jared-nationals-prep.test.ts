import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EX, NEW_EXERCISE, type ExKey } from "@/lib/jared-nationals/catalog";
import { BLOCKS, MEET, WEEKS, type RowDef, type WeekDef } from "@/lib/jared-nationals/program";
import { PREP_MIGRATION, dayDate, planRows, prepSql } from "@/lib/jared-nationals/sql";
import { rowProblems } from "@/lib/pl-template-validation";
import { hasRpeCap, rpeCapValue } from "@/lib/workouts/load-reference";

const week = (n: number) => WEEKS.find((w) => w.n === n)!;
const rowsOf = (w: WeekDef) =>
  w.days.flatMap((d) => d.rows.map((r) => ({ ...r, dow: d.dow, optionalDay: !!d.optional })));
const SQUAT: ExKey[] = ["compSquat", "highBar", "pauseSquat", "beltSquat"];
const BENCH: ExKey[] = ["compBench", "closeGripBlock", "pauseBench2ct"];
const DEADLIFT: ExKey[] = ["compDeadlift", "pausedDeadlift"];
const hardSets = (w: WeekDef) =>
  rowsOf(w)
    .filter((r) => r.ex !== "walk")
    .reduce((a, r) => a + r.sets, 0);
const days = (w: WeekDef, pred: (r: RowDef) => boolean) =>
  new Set(
    rowsOf(w)
      .filter(pred)
      .map((r) => r.dow),
  ).size;
const isAcc = (r: RowDef) =>
  !SQUAT.includes(r.ex) && !BENCH.includes(r.ex) && !DEADLIFT.includes(r.ex) && r.ex !== "walk";

describe("Jared's 2027 Nationals prep: the coach's final audit", () => {
  it("is 12 weeks, 4 training days every week (Mon / Tue / Thu / Sat), on the right dates", () => {
    expect(WEEKS.map((w) => w.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const w of WEEKS) expect(w.days.map((d) => d.dow)).toEqual(["Mon", "Tue", "Thu", "Sat"]);
    expect(dayDate(1, "Mon")).toBe("2026-11-16");
    expect(dayDate(12, "Sat")).toBe("2027-02-06");
    // only Week 12's no-lifting Tuesday is optional
    expect(
      WEEKS.flatMap((w) => w.days.filter((d) => d.optional).map((d) => `${w.n}${d.dow}`)),
    ).toEqual(["12Tue"]);
    // the blocks cover the 12 weeks once, in order
    expect(BLOCKS.flatMap((b) => b.weeks)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("as written (placeholders until the lifting day is confirmed): the final heavy exposures and the primer from the Feb 8 anchor", () => {
    const out = (iso: string) =>
      Math.round(
        (Date.parse(`${MEET.windowStart}T00:00:00Z`) - Date.parse(`${iso}T00:00:00Z`)) / 86_400_000,
      );
    expect(out(dayDate(11, "Mon"))).toBe(14); // final heavy squat
    expect(out(dayDate(11, "Thu"))).toBe(11); // final heavy bench
    expect(out(dayDate(11, "Sat"))).toBe(9); // final heavy deadlift
    expect(out(dayDate(12, "Sat"))).toBe(2); // primer
  });

  it("deadlift: one mandatory day (Saturday), conventional, the Tuesday pull optional and low-fatigue, no sumo anywhere", () => {
    for (const w of WEEKS.filter((x) => x.n <= 11)) {
      const sat = w.days.find((d) => d.dow === "Sat")!;
      expect(sat.rows.some((r) => r.ex === "compDeadlift" && r.role === "Primary Deadlift")).toBe(
        true,
      );
    }
    for (const w of WEEKS) {
      for (const r of rowsOf(w).filter((x) => DEADLIFT.includes(x.ex) && x.dow !== "Sat")) {
        // off Saturday a pull is either the optional technique pull or Week 12's light taper single
        const light = (rpeCapValue(r.rpe ?? null) ?? 10) <= 5;
        expect(r.optional || light, `${w.n} ${r.dow} ${r.role}`).toBe(true);
      }
    }
    const tech = WEEKS.flatMap((w) =>
      rowsOf(w)
        .filter((r) => r.ex === "pausedDeadlift")
        .map((r) => ({ ...r, n: w.n })),
    );
    expect(tech.map((r) => r.n)).toEqual([1, 2, 3, 5, 6, 7]);
    for (const r of tech) {
      expect(r.dow).toBe("Tue");
      expect(r.optional).toBe(true);
      expect(r.sets).toBe(1);
      expect(rpeCapValue(r.rpe!)!).toBeLessThanOrEqual(6);
    }
    const all = JSON.stringify(WEEKS);
    expect(all).not.toMatch(/sumo/i);
    expect(
      Object.values(EX)
        .map((e) => e.name)
        .join("|"),
    ).not.toMatch(/sumo|primary|secondary|conventional/i);
    expect(EX.compDeadlift).toEqual({
      id: "c01ef5f7-9d97-4296-939d-306acc5bc1c9",
      name: "Competition Deadlift",
    });
  });

  it("squat twice a week, bench about three times, deadlift once", () => {
    for (const w of WEEKS) {
      expect(
        days(w, (r) => SQUAT.includes(r.ex) && r.ex !== "beltSquat"),
        `squat w${w.n}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        days(w, (r) => BENCH.includes(r.ex)),
        `bench w${w.n}`,
      ).toBeGreaterThanOrEqual(w.n === 12 ? 2 : 3);
    }
  });

  it("specificity rises: block press and belt squat go by Week 9, high bar becomes paused then competition squat", () => {
    const weeksWith = (ex: ExKey) =>
      WEEKS.filter((w) => rowsOf(w).some((r) => r.ex === ex)).map((w) => w.n);
    expect(weeksWith("closeGripBlock")).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(weeksWith("highBar")).toEqual([1, 2, 3, 4]);
    expect(weeksWith("pauseSquat")).toEqual([5, 6, 7, 8]);
    expect(Math.max(...weeksWith("beltSquat"))).toBeLessThanOrEqual(7);
    for (const n of [9, 10, 11]) {
      const thu = week(n).days.find((d) => d.dow === "Thu")!;
      expect(thu.rows[0].ex).toBe("compSquat");
    }
  });

  it("Weeks 4 and 8 reduce fatigue; Weeks 9–11 peak; Week 12 tapers", () => {
    expect(hardSets(week(4))).toBeLessThan(hardSets(week(3)));
    expect(hardSets(week(8))).toBeLessThan(hardSets(week(7)));
    const singleCap = (n: number, lift: string) =>
      rpeCapValue(
        week(n)
          .days.flatMap((d) => d.rows)
          .find((r) => r.role === `Primary ${lift}`)!.rpe!,
      )!;
    for (const lift of ["Squat", "Bench", "Deadlift"]) {
      expect(singleCap(4, lift)).toBeLessThanOrEqual(6);
      expect(singleCap(8, lift)).toBeLessThanOrEqual(6.5);
      expect(singleCap(7, lift)).toBe(8); // never @9
      expect(singleCap(10, lift)).toBeGreaterThanOrEqual(8);
    }
    // the peak: competition lifts only, no non-specific overload
    for (const n of [9, 10, 11, 12]) {
      expect(
        rowsOf(week(n)).some((r) =>
          ["closeGripBlock", "beltSquat", "pausedDeadlift", "highBar", "pauseSquat"].includes(r.ex),
        ),
        `w${n}`,
      ).toBe(false);
    }
    // the taper: nothing above @5
    for (const r of rowsOf(week(12)).filter((x) => x.ex !== "walk" && !isAcc(x)))
      expect(rpeCapValue(r.rpe!)!).toBeLessThanOrEqual(5);
    // accessories shrink toward the meet
    const accSets = (n: number) =>
      rowsOf(week(n))
        .filter(isAcc)
        .reduce((a, r) => a + r.sets, 0);
    expect(accSets(11)).toBeLessThan(accSets(9));
    expect(accSets(12)).toBeLessThan(accSets(11));
    expect(accSets(9)).toBeLessThan(accSets(7));
  });

  it("keeps the priority muscles (lats, side and rear delts, triceps) and the small stuff (calves, adductors, abductors)", () => {
    for (const w of WEEKS.filter((x) => x.n <= 10)) {
      const r = rowsOf(w);
      const sets = (pred: (x: RowDef) => boolean) => r.filter(pred).reduce((a, x) => a + x.sets, 0);
      expect(
        sets((x) => ["latPulldown", "verticalPull", "latRow"].includes(x.ex)),
        `lats w${w.n}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        sets((x) => x.ex === "lateralRaise"),
        `side delts w${w.n}`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        sets((x) => x.ex === "rearDelt"),
        `rear delts w${w.n}`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        days(w, (x) => x.ex === "calfRaise"),
        `calves w${w.n}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        days(w, (x) => x.ex === "hipAdduction"),
        `adduction w${w.n}`,
      ).toBe(2);
      expect(
        days(w, (x) => x.ex === "hipAbduction"),
        `abduction w${w.n}`,
      ).toBeGreaterThanOrEqual(w.n === 4 || w.n === 8 ? 1 : 2);
    }
    // triceps get direct work plus the block-press overload in the build weeks
    for (const n of [1, 2, 3, 5, 6, 7]) {
      expect(rowsOf(week(n)).some((r) => r.ex === "triceps")).toBe(true);
      expect(rowsOf(week(n)).some((r) => r.ex === "closeGripBlock")).toBe(true);
    }
    // Dorian Yates: one hard set, two only for the priority muscles
    for (const w of WEEKS)
      for (const r of rowsOf(w).filter(isAcc)) {
        if (r.sets > 1) expect(["lateralRaise"], `${w.n} ${r.ex}`).toContain(r.ex);
      }
  });

  it("cardio stays small: ~2 short Zone 2 sessions a week at most, Tuesday the main one", () => {
    for (const w of WEEKS) {
      const c = rowsOf(w).filter((r) => r.ex === "walk");
      expect(c.length, `w${w.n}`).toBeLessThanOrEqual(2);
      expect(
        c.some((r) => r.dow === "Tue"),
        `w${w.n}`,
      ).toBe(true);
      for (const r of c) expect(r.minutes).toBeLessThanOrEqual(15);
    }
  });

  it("never invents a Training Max: Week 1's deadlift reads the day's single; every % carries an RPE cap", () => {
    const w1 = rowsOf(week(1));
    expect(w1.filter((r) => DEADLIFT.includes(r.ex) && r.basis === "training_max")).toEqual([]);
    expect(w1.find((r) => r.role === "Primary Deadlift Backoff")).toMatchObject({
      basis: "top_set",
      pct: 77.5,
    });
    for (const w of WEEKS) {
      for (const r of rowsOf(w)) {
        if (r.pct != null) {
          expect(
            hasRpeCap({ percentage: r.pct, percentage_basis: r.basis, rpe: r.rpe }),
            `${w.n} ${r.dow} ${r.role}`,
          ).toBe(true);
        }
      }
    }
  });

  it("every row can be followed in the logger (the builder's own check) and names a library exercise", () => {
    for (const r of planRows()) {
      const timed = r.minutes != null;
      const row = {
        exercise_id: EX[r.ex].id,
        sets: r.sets,
        reps_text: timed ? null : r.reps,
        rpe: r.rpe ?? null,
        percentage: r.pct ?? null,
        percentage_basis: r.basis ?? "none",
        measurement_type: timed ? "time" : "reps",
        duration_seconds: timed ? r.minutes! * 60 : null,
      };
      expect(rowProblems(row), `${r.date} ${r.role}`).toEqual([]);
      expect(r.note.length).toBeGreaterThan(0);
      expect(r.note).not.toMatch(/ — /); // no em dashes in what the athlete reads
    }
    expect(NEW_EXERCISE.name).toBe("Cable Hip Adduction");
    // every other exercise is an existing library id
    expect(Object.values(EX).filter((e) => e.id === NEW_EXERCISE.id)).toHaveLength(1);
  });

  it("the migration file is generated from these definitions (never hand-edited)", () => {
    expect(readFileSync(PREP_MIGRATION, "utf8")).toBe(prepSql());
  });

  it("the migration only touches untouched workouts, backs up first and runs once", () => {
    const sql = prepSql();
    expect(sql).toContain("already trained; nothing changed");
    expect(sql).toContain("program_loading_update_backup");
    expect(sql.indexOf("back up everything this changes")).toBeLessThan(
      sql.indexOf("DELETE FROM public.pl_weeks"),
    );
    expect(sql).toContain("already applied");
    // cardio is switched before any block update (a block update runs the cardio sync)
    expect(sql.indexOf("'program_rows', 'Zone 2'")).toBeLessThan(
      sql.indexOf("UPDATE public.pl_blocks b"),
    );
  });
});
