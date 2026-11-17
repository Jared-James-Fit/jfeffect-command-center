import { describe, expect, it } from "vitest";
import { loadPrepReview, previewMeetDay } from "@/lib/prep-review.server";
import { BLOCKS, CLIENT_ID, DAY_INDEX, PREP_ID, WEEKS } from "@/lib/jared-nationals/program";
import { EX } from "@/lib/jared-nationals/catalog";
import { dayDate } from "@/lib/jared-nationals/sql";

/**
 * A stand-in for the database with Jared's Nationals prep as the program
 * defines it: just enough of PostgREST's query builder for prep-review.server.ts
 * (select / eq / in / not-is-null / gt / lte / order / range / maybeSingle).
 */
function fakeDb(tables: Record<string, any[]>) {
  const get = (row: any, col: string) => col.split(".").reduce((v, k) => (v == null ? v : v[k]), row);
  class Q {
    rows: any[];
    one = false;
    constructor(rows: any[]) {
      this.rows = rows.slice();
    }
    select() { return this; }
    order() { return this; }
    eq(c: string, v: any) { this.rows = this.rows.filter((r) => get(r, c) === v); return this; }
    in(c: string, vs: any[]) { this.rows = this.rows.filter((r) => vs.includes(get(r, c))); return this; }
    not(c: string, _op: string, _v: null) { this.rows = this.rows.filter((r) => get(r, c) != null); return this; }
    gt(c: string, v: number) { this.rows = this.rows.filter((r) => Number(get(r, c)) > v); return this; }
    lte(c: string, v: number) { this.rows = this.rows.filter((r) => Number(get(r, c)) <= v); return this; }
    range(f: number, t: number) { this.rows = this.rows.slice(f, t + 1); return this; }
    maybeSingle() { this.one = true; return this; }
    then(res: (x: any) => any) {
      return Promise.resolve(res(this.one ? { data: this.rows[0] ?? null, error: null } : { data: this.rows, error: null }));
    }
  }
  return { from: (t: string) => new Q(tables[t] ?? []) };
}

const comp = { squat: EX.compSquat.id, bench: EX.compBench.id, deadlift: EX.compDeadlift.id };
const exMeta = (id: string) => {
  const lift = Object.entries(comp).find(([, v]) => v === id)?.[0] ?? null;
  const fam = lift ?? (id === EX.pauseBench2ct.id || id === EX.closeGripBlock.id ? "bench" : id === EX.highBar.id || id === EX.pauseSquat.id ? "squat" : id === EX.pausedDeadlift.id ? "deadlift" : null);
  return { id, name: id, competition_lift_type: fam, movement_family: fam, is_competition_lift: !!lift };
};

function fixture() {
  const blocks = BLOCKS.map((b, i) => ({ id: b.blockId, prep_id: PREP_ID, client_id: CLIENT_ID, name: b.name, start_date: dayDate(b.weeks[0], "Mon"), end_date: dayDate(b.weeks[b.weeks.length - 1], "Sat"), status: i === 0 ? "Active" : "Draft", sort_order: i, archived: false }));
  // blocks start on the Sunday before their first Monday
  for (const b of blocks) b.start_date = new Date(Date.parse(`${b.start_date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const weeks: any[] = [];
  const days: any[] = [];
  const rows: any[] = [];
  for (const w of WEEKS) {
    const b = BLOCKS.find((x) => x.weeks.includes(w.n))!;
    const weekId = `w${w.n}`;
    weeks.push({ id: weekId, block_id: b.blockId, week_index: b.weeks.indexOf(w.n) + 1 });
    for (const d of w.days) {
      const dayId = `d${w.n}-${d.dow}`;
      days.push({ id: dayId, week_id: weekId, day_index: DAY_INDEX[d.dow], title: d.title, scheduled_date: dayDate(w.n, d.dow), schedule_locked: w.n >= 11, is_optional: !!d.optional, archived: false });
      d.rows.forEach((r, i) => {
        rows.push({
          id: `${dayId}-r${i}`,
          day_id: dayId,
          sort_order: i,
          sets: r.sets,
          reps_text: r.reps ?? null,
          rpe: r.rpe ?? null,
          percentage: r.pct ?? null,
          percentage_basis: r.basis ?? null,
          movement_family: null,
          exercises: exMeta(EX[r.ex].id),
        });
      });
    }
  }
  const maxes = BLOCKS.flatMap((b) => [
    { id: `m-sq-${b.key}`, client_id: CLIENT_ID, block_id: b.blockId, lift: "Competition Squat", training_max: 235, unit: "kg", active: true },
    { id: `m-bn-${b.key}`, client_id: CLIENT_ID, block_id: b.blockId, lift: "Competition Bench Press", training_max: 150, unit: "kg", active: true },
  ]);
  return { blocks, weeks, days, rows, maxes };
}

const prep = { id: PREP_ID, client_id: CLIENT_ID, title: "Jared McIntyre — 2027 Canadian Nationals Prep", event_name: "2027 Canada Powerlifting National Championships", event_date: "2027-02-08", event_end_date: "2027-02-13", event_day_tbd: true, archived: false };
const client = { id: CLIENT_ID, timezone: "America/Toronto", committed_training_days: ["Monday", "Tuesday", "Thursday", "Saturday"] };

describe("the coach's prep review, read from the program", () => {
  it("bench TM held, two hard bench sessions flag it; deadlift waits for its calibration", async () => {
    const f = fixture();
    // bench % TM sets on the Week 1 Monday tertiary/overload rows and Thursday back-offs, logged hard twice
    const benchRows = f.rows.filter((r) => r.percentage_basis === "training_max" && r.exercises.competition_lift_type === "bench" && /^d1-(Mon|Thu|Sat)/.test(r.day_id));
    expect(benchRows.length).toBeGreaterThan(1);
    const results = benchRows.slice(0, 2).flatMap((r, k) => {
      const planned = (150 * Number(r.percentage)) / 100;
      const cap = Number(String(r.rpe).split(/[-–]/).pop());
      return [1, 2].map((s) => ({ row_id: r.id, set_index: s, client_id: CLIENT_ID, normalized_kg: Math.round(planned / 2.5) * 2.5, actual_reps: Number(String(r.reps_text).split("-")[0]) || 3, actual_rpe_num: cap + 1.5, completed_at: `2026-11-${16 + k * 3}T22:00:00Z`, is_working_set: true }));
    });
    const db = fakeDb({ clients: [client], pl_preps: [prep], pl_blocks: f.blocks, pl_weeks: f.weeks, pl_days: f.days, pl_exercise_rows: f.rows, pl_row_results: results, pl_client_maxes: f.maxes });
    const r = await loadPrepReview(db, CLIENT_ID, "2026-11-20");
    expect(r.prep?.dayTbd).toBe(true);
    const bench = r.lifts.find((l) => l.lift === "bench")!;
    expect(bench.tmKg).toBe(150);
    expect(bench.review?.status).toBe("review");
    expect(bench.review?.suggestedKg).toBeLessThan(150);
    const squat = r.lifts.find((l) => l.lift === "squat")!;
    expect(squat.review?.status).toBe("too_early");
    const dl = r.lifts.find((l) => l.lift === "deadlift")!;
    expect(dl.tmKg).toBeNull();
    expect(dl.calibration?.status).toBe("waiting");
    expect(dl.calibration?.date).toBe("2026-11-21");
  });

  it("the deadlift calibration, once logged, suggests a Training Max; nothing writes it", async () => {
    const f = fixture();
    const single = f.rows.find((r) => r.day_id === "d1-Sat" && r.exercises.is_competition_lift && r.exercises.competition_lift_type === "deadlift" && r.reps_text === "1")!;
    const back = f.rows.find((r) => r.day_id === "d1-Sat" && r.percentage_basis === "top_set")!;
    const results = [
      { row_id: single.id, set_index: 1, client_id: CLIENT_ID, normalized_kg: 220, actual_reps: 1, actual_rpe_num: 6, completed_at: "2026-11-21T20:00:00Z", is_working_set: true },
      { row_id: back.id, set_index: 1, client_id: CLIENT_ID, normalized_kg: 170, actual_reps: 4, actual_rpe_num: 6, completed_at: "2026-11-21T20:10:00Z", is_working_set: true },
      { row_id: back.id, set_index: 2, client_id: CLIENT_ID, normalized_kg: 170, actual_reps: 4, actual_rpe_num: 6, completed_at: "2026-11-21T20:16:00Z", is_working_set: true },
    ];
    const db = fakeDb({ clients: [client], pl_preps: [prep], pl_blocks: f.blocks, pl_weeks: f.weeks, pl_days: f.days, pl_exercise_rows: f.rows, pl_row_results: results, pl_client_maxes: f.maxes });
    const r = await loadPrepReview(db, CLIENT_ID, "2026-11-22");
    const dl = r.lifts.find((l) => l.lift === "deadlift")!;
    expect(dl.calibration?.status).toBe("ready");
    expect(dl.calibration?.suggestedKg).toBeGreaterThan(200);
    expect(dl.calibration?.suggestedKg).toBeLessThan(243);
  });

  it("the taper preview reads Weeks 11–12 as they're written: three final heavies and a primer", async () => {
    const f = fixture();
    const db = fakeDb({ clients: [client], pl_preps: [prep], pl_blocks: f.blocks, pl_weeks: f.weeks, pl_days: f.days, pl_exercise_rows: f.rows, pl_row_results: [], pl_client_maxes: f.maxes, pl_day_completions: [] });
    const p = await previewMeetDay(db, CLIENT_ID, PREP_ID, "2027-02-11", "2026-11-17");
    expect(p.delta).toBe(3);
    expect(p.plan.sessions).toHaveLength(8);
    const heavy = Object.fromEntries(p.plan.sessions.filter((s) => s.heavy.length).map((s) => [s.heavy.join("+"), s.title]));
    expect(Object.keys(heavy).sort()).toEqual(["bench", "deadlift", "squat"]);
    expect(p.plan.sessions.find((s) => s.primer)?.title).toMatch(/Primer/);
    // no meets in the logs: the plan is the even shift, 14 / 11 / 9 days out as written
    expect(p.plan.moves).toEqual([]);
    expect(p.plan.finalHeavy.map((x) => x.daysOut)).toEqual([14, 11, 9]);
    expect(p.even.every((e) => e.to > e.from)).toBe(true);
  });
});
