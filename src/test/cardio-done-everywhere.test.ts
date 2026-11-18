import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cardioRowDone, cardioSetDone, withCardioDone } from "@/lib/workouts/workout-cardio";
import { dayProgress } from "@/lib/workout-progress";

// Jared McIntyre, Tue Nov 17 2026: seven lift sets logged, the treadmill walk
// logged at 21:55 (10:00, 80 cal, RPE 5), the workout finished at 21:55:19.
// The Workouts card still said "Cardio · 10 min · any time today · Log it".
const DAY = "492dbad3-a51e-466c-8100-ad8496425519";
const CLIENT = "3a548c6a-a07c-4832-aa32-92fdfdbe3282";

describe("the day's cardio: one rule for done", () => {
  it("a time over zero, or marked complete (the database's own rule)", () => {
    expect(cardioSetDone({ completed_duration_seconds: 600 })).toBe(true);
    expect(cardioSetDone({ completed_duration_seconds: 0, completed_at: "2026-11-17T21:55:13Z" })).toBe(true);
    expect(cardioSetDone({ completed_duration_seconds: null, completed_at: null })).toBe(false);
    expect(cardioSetDone(null)).toBe(false);
    expect(cardioRowDone("walk", [{ row_id: "lift", completed_duration_seconds: 600 }])).toBe(false);
    expect(cardioRowDone("walk", [{ row_id: "walk", completed_duration_seconds: 600 }])).toBe(true);
  });

  it("a day's progress is its lifts, and the cardio says done apart", () => {
    const rows = [
      { id: "a", sets: 1 }, { id: "b", sets: 2 }, { id: "c", sets: 1 },
      { id: "walk", sets: 1, cardio_target_id: "t" },
    ];
    const results = [
      { row_id: "a", actual_reps: 10, actual_load: 165, completed_duration_seconds: null },
      { row_id: "b", actual_reps: 10, actual_load: 30, completed_duration_seconds: null },
      { row_id: "walk", actual_reps: null, actual_load: null, completed_duration_seconds: 600, completed_at: "x" },
    ];
    const p = dayProgress(rows as any, results as any);
    expect(p.prescribedSets).toBe(4);
    expect(p.completedSets).toBe(2);
    expect(p.cardioDone).toBe(true);
    expect(dayProgress(rows.slice(0, 3) as any, results as any).cardioDone).toBeNull();
  });

  it("the cached list says it the moment it's logged, and nothing else changes", () => {
    const other = { day: { id: "other" }, cardio: { rowId: "w2", minutes: 10, done: false } };
    const today = { day: { id: DAY }, cardio: { rowId: "walk", minutes: 10, done: false }, progress: { pct: 78, cardioDone: false } };
    const list = [other, today];
    const next = withCardioDone(list, DAY, true);
    expect(next).not.toBe(list);
    expect(next[0]).toBe(other);
    expect((next[1] as any).cardio.done).toBe(true);
    expect((next[1] as any).progress.cardioDone).toBe(true);
    expect(withCardioDone(next, DAY, true)).toBe(next);
    expect(withCardioDone(undefined, DAY, true)).toBeUndefined();
    expect(withCardioDone({ day: { id: DAY }, cardio: null }, DAY, true)).toEqual({ day: { id: DAY }, cardio: null });
  });
});

// ── the program list, read against a fake database ─────────────────────────
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const requests: Array<{ table: string; inSize: number }> = [];
let nestedFails = false;
let failTable: string | null = null;

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let range: [number, number] | null = null;
  let nested = false;
  let inSize = 0;
  const b: any = {
    select: (cols: string) => { if (cols.includes("pl_weeks(")) nested = true; return b; },
    eq: (col: string, v: any) => { if (!col.includes(".")) filters.push((r) => r[col] === v); return b; },
    neq: (col: string, v: any) => { filters.push((r) => r[col] !== v); return b; },
    in: (col: string, vs: any[]) => { inSize = vs.length; const set = new Set(vs); filters.push((r) => set.has(r[col])); return b; },
    is: () => b, not: () => b, order: () => b, limit: () => b,
    range: (f: number, t: number) => { range = [f, t]; return b; },
    then: (res: any, rej: any) => {
      requests.push({ table, inSize });
      if (nested && nestedFails) return Promise.resolve({ data: null, error: { message: "Load failed" } }).then(res, rej);
      if (inSize > 400) return Promise.resolve({ data: null, error: { message: "Bad Request" } }).then(res, rej);
      if (failTable === table) return Promise.resolve({ data: null, error: { message: "network" } }).then(res, rej);
      let rows = (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (nested) rows = rows.map((blk) => ({ ...blk, pl_weeks: (db.pl_weeks ?? []).filter((w) => w.block_id === blk.id).map((w) => ({ ...w, pl_days: (db.pl_days ?? []).filter((d) => d.week_id === w.id).map((d) => ({ ...d, pl_exercise_rows: (db.pl_exercise_rows ?? []).filter((er) => er.day_id === d.id).map((er) => ({ ...er, pl_row_results: (db.pl_row_results ?? []).filter((rr) => rr.row_id === er.id) })) })) })) }));
      rows = rows.slice(0, 1000);
      if (range) rows = rows.slice(range[0], range[1] + 1);
      return Promise.resolve({ data: rows, error: null }).then(res, rej);
    },
  };
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => builder(t) } }));

function seedJared(extraRows = 0) {
  for (const k of Object.keys(db)) delete db[k];
  db.pl_blocks = [{ id: "blk", client_id: CLIENT, client_visible: true, status: "Active", name: "Block 1 — Nationals Base", sort_order: 0, created_at: "2026-09-29" }];
  db.pl_weeks = [{ id: "w1", block_id: "blk", week_index: 1 }, { id: "w0", block_id: "blk", week_index: 0 }];
  db.pl_days = [{ id: DAY, week_id: "w1", day_index: 3, title: "Tuesday — Low-Fatigue Development + Optional Deadlift Technique", scheduled_date: "2026-11-17", archived: false, deleted_at: null }];
  const lift = (id: string, sets: number) => ({ id, day_id: DAY, sets, rest_seconds: 120, time_profile: "accessory_compound", estimated_seconds_override: null, cardio_target_id: null, duration_seconds: null });
  db.pl_exercise_rows = [lift("r0", 1), lift("r1", 1), lift("r2", 2), lift("r3", 1), lift("r4", 1), lift("r5", 1), lift("r6", 1), lift("r7", 1),
    { id: "walk", day_id: DAY, sets: 1, rest_seconds: null, time_profile: null, estimated_seconds_override: null, cardio_target_id: "6781baff", duration_seconds: 600 }];
  const set = (id: string, row: string, reps: number, load: number) => ({ id, row_id: row, client_id: CLIENT, actual_load: load, actual_load_unit: "lb", actual_reps: reps, completed_duration_seconds: null, completed_at: "2026-11-17T20:40:00Z" });
  db.pl_row_results = [set("s1", "r1", 10, 165), set("s2", "r2", 10, 30), set("s3", "r2", 20, 20), set("s4", "r3", 20, 5), set("s5", "r4", 20, 90), set("s6", "r5", 20, 20), set("s7", "r6", 15, 0),
    { id: "s8", row_id: "walk", client_id: CLIENT, actual_load: null, actual_load_unit: null, actual_reps: null, completed_duration_seconds: 600, completed_at: "2026-11-17T21:55:13Z" }];
  // a long-time client's history: many more days and rows in earlier weeks
  for (let i = 0; i < extraRows; i++) {
    const d = `old-day-${Math.floor(i / 6)}`;
    if (!db.pl_days.some((x) => x.id === d)) db.pl_days.push({ id: d, week_id: "w0", day_index: Math.floor(i / 6) + 1, title: "Old", scheduled_date: "2026-07-01", archived: false, deleted_at: null });
    db.pl_exercise_rows.push(lift(`old-${i}`, 3));
    for (let k = 1; k <= 2; k++) db.pl_row_results.push({ ...set(`old-${i}-${k}`, `old-${i}`, 5, 100), set_index: k });
  }
  db.pl_exercise_rows.forEach((r) => { if (r.id.startsWith("old-")) r.day_id = `old-day-${Math.floor(Number(r.id.split("-")[1]) / 6)}`; });
  db.pl_day_completions = [{ id: "a93b", day_id: DAY, client_id: CLIENT, completed_at: "2026-11-17T21:55:19.615Z", in_progress_at: "2026-11-17T21:55:19.193Z", started_at: "2026-11-17T20:40:31Z", scheduled_workout_id: null }];
  db.pl_workout_feedback = [{ id: "fb", completion_id: "a93b" }];
  db.pl_scheduled_workouts = [];
}

describe("the Workouts list marks Jared's Tuesday cardio done", () => {
  beforeEach(() => { requests.length = 0; nestedFails = false; failTable = null; });

  it("from the one nested read", async () => {
    seedJared(900);
    const { getClientWorkouts } = await import("@/lib/pl-programs");
    const day = (await getClientWorkouts(CLIENT) as any[]).find((i) => i.day?.id === DAY);
    expect(day.cardio).toEqual({ rowId: "walk", minutes: 10, done: true });
    expect(day.progress.cardioDone).toBe(true);
    expect(day.progress.completedSets).toBe(7); // the lifts only
    expect(day.progress.prescribedSets).toBe(9);
  });

  it("and the same when that read fails and the step-by-step one runs, however long the history", async () => {
    seedJared(900); // 909 rows: one URL with every id is refused (HTTP 400), so it's asked in parts
    nestedFails = true;
    const { getClientWorkouts } = await import("@/lib/pl-programs");
    const day = (await getClientWorkouts(CLIENT) as any[]).find((i) => i.day?.id === DAY);
    expect(day.cardio.done).toBe(true);
    expect(day.progress.completedSets).toBe(7);
    expect(Math.max(...requests.map((r) => r.inSize))).toBeLessThanOrEqual(150);
    expect(requests.filter((r) => r.table === "pl_row_results").length).toBeGreaterThan(1);
  });

  it("a read that fails is an error, never a list with nothing logged", async () => {
    seedJared(10);
    nestedFails = true;
    failTable = "pl_row_results";
    const { getClientWorkouts } = await import("@/lib/pl-programs");
    await expect(getClientWorkouts(CLIENT)).rejects.toBeTruthy();
  });
});

describe("every screen reads it", () => {
  const experience = readFileSync("src/components/workouts/WorkoutsExperience.tsx", "utf8");
  const logger = readFileSync("src/components/workout-day/WorkoutDayView.tsx", "utf8");
  it("the Workouts card trusts the day's own read first", () => {
    expect(experience).toContain("const cardioDone = progress?.cardioDone ?? item.cardio.done;");
    expect(experience).toContain('data-day-cardio={cardioDone ? "done" : "open"}');
    expect(experience).toContain("data-workouts-load-failed");
  });
  it("logging the cardio updates the list, the day read, Nutrition and the calendar", () => {
    expect(logger).toContain("withCardioDone(old, dayId, done)");
    expect(logger).toContain('queryKey: ["workout-progress", dayId]');
    expect(logger).toContain('k.startsWith("cardio-completion")');
    expect(logger).toContain('k === "cal-client-cardio"');
  });
});
