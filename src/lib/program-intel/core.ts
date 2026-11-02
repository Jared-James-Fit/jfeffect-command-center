/**
 * Program Intelligence, step 1 (pure): every prescribed exercise lined up
 * with the sets actually logged for it, day by day, in the program's own
 * order. Numbers here are only ever measured from records: loads in kg from
 * the stored normalized value, e1RM from the app's one formula (e1rm.ts).
 */
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";
import { resolveMuscleGroups } from "@/lib/analytics/muscle-map";
import { isAtHomeBackupReservedBlock } from "@/lib/at-home-backup";
import {
  LIFTS,
  type DayCompare,
  type DayStatus,
  type IntelRecords,
  type Lift,
  type RawBlock,
  type RawExercise,
  type RawRow,
  type RawWeek,
  type RowCompare,
  type SetLine,
} from "./types";

export const LB_PER_KG = 2.2046226218;
/** e1RM is only read from sets of this many reps or fewer (beyond it the formula guesses). */
export const E1RM_MAX_REPS = 12;
/** A set counts as hard (effective for hypertrophy) at this RPE or more, i.e. 4 or fewer reps in reserve. */
export const HARD_SET_RPE = 6;

export const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function toNum(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = typeof x === "number" ? x : parseFloat(String(x));
  return Number.isFinite(n) ? n : null;
}

/** "5" → [5,5], "8-10" → [8,10], "5+" → [5,5], "AMRAP" / "" → null. */
export function repRange(text: string | null | undefined): [number, number] | null {
  const t = String(text ?? "").trim();
  if (!t || /amrap|max/i.test(t)) return null;
  const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Target RPE "7", "7-8", "@8" → range. */
export function rpeRange(text: string | null | undefined): [number, number] | null {
  const nums = (String(text ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** The athlete's local calendar date of an instant (yyyy-mm-dd). */
export function localDate(iso: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "America/Winnipeg", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Which competition lift a prescribed exercise trains: the coach's role label first, then the exercise's family. GPP is none. */
export function liftOf(row: Pick<RawRow, "purpose_label">, ex: RawExercise | undefined): Lift | null {
  const label = String(row.purpose_label ?? "").toLowerCase();
  if (/\bgpp\b/.test(label)) return null;
  for (const l of LIFTS) if (label.includes(l)) return l;
  for (const v of [ex?.competition_lift_type, ex?.movement_family]) {
    const s = String(v ?? "").toLowerCase();
    if ((LIFTS as string[]).includes(s)) return s as Lift;
  }
  return null;
}

export function isCompetition(ex: RawExercise | undefined): boolean {
  return !!ex && (ex.is_competition_lift === true || !!ex.competition_lift_type);
}

export function exerciseName(row: Pick<RawRow, "exercise_name_override" | "exercise_id">, ex: RawExercise | undefined): string {
  return (row.exercise_name_override?.trim() || ex?.name || "Unnamed exercise").trim();
}

export function musclesOf(ex: RawExercise | undefined): Array<{ group: string; weight: number }> {
  if (!ex || ex.counts_toward_volume === false) return [];
  const mult = toNum(ex.volume_multiplier) ?? 1;
  const primary = ex.muscle_groups?.length ? ex.muscle_groups : [ex.primary_muscle_group];
  return resolveMuscleGroups(primary, ex.secondary_muscle_groups).map((m) => ({ group: m.group, weight: m.weight * mult }));
}

/** One logged result as a set line (kg from the stored normalized value; never guessed from a unit-less number). */
export function setLine(r: IntelRecords["results"][number], settings: IntelRecords["settings"], tz: string | null): SetLine {
  const loadType = r.load_type === "bodyweight" || r.is_bodyweight ? "bodyweight" : r.load_type === "assisted" ? "assisted" : "external";
  let kg = toNum(r.normalized_kg) ?? toNum(r.actual_load_kg);
  if (kg == null && toNum(r.actual_load) != null) {
    const unit = String(r.actual_load_unit ?? "").toLowerCase();
    if (unit === "kg") kg = toNum(r.actual_load);
    else if (unit === "lb" || unit === "lbs") kg = (toNum(r.actual_load) as number) / LB_PER_KG;
  }
  if (kg != null) kg = round(kg, 2);
  const reps = toNum(r.actual_reps);
  const rir = toNum(r.actual_rir);
  let rpe = toNum(r.actual_rpe_num) ?? toNum(r.actual_rpe);
  if (rpe != null && (rpe < 1 || rpe > 10)) rpe = null;
  const effort = rpe ?? (rir != null ? Math.max(0, Math.min(10, 10 - rir)) : null);
  const logged = !!r.completed_at || reps != null;
  const explicitWarmup = r.is_working_set === false;
  const working = logged && !explicitWarmup && (reps ?? 0) > 0 && (effort == null || effort >= settings.workingRpeMin);
  const hard = working && (effort == null || effort >= HARD_SET_RPE);
  const e1rm =
    working && loadType === "external" && kg != null && kg > 0 && reps != null && reps >= 1 && reps <= E1RM_MAX_REPS
      ? round(estimate1RMWithRpe(kg, reps, rpe ?? (rir != null ? 10 - rir : null), settings.e1rmFormula), 1)
      : null;
  return {
    resultId: r.id,
    setIndex: r.set_index,
    kg,
    reps,
    rpe: effort,
    rir: rir ?? (effort != null ? round(10 - effort, 1) : null),
    e1rm: e1rm && e1rm > 0 ? e1rm : null,
    working,
    hard,
    loadType,
    logged,
    completedAt: r.completed_at ? localDate(r.completed_at, tz) : null,
    notes: r.notes?.trim() || null,
  };
}

export function fmtSet(s: SetLine | null, unit: "kg" | "lb"): string {
  if (!s) return "—";
  const load =
    s.loadType === "bodyweight"
      ? s.kg ? `BW+${fmtLoad(s.kg, unit)}` : "BW"
      : s.loadType === "assisted"
        ? `assist ${s.kg != null ? fmtLoad(s.kg, unit) : "?"}`
        : s.kg != null ? fmtLoad(s.kg, unit) : "?";
  return `${load}×${s.reps ?? "?"}${s.rpe != null ? ` @${s.rpe}` : ""}`;
}

export function fmtLoad(kg: number, unit: "kg" | "lb"): string {
  if (unit === "lb") return `${Math.round(kg * LB_PER_KG)}lb`;
  return `${Math.round(kg * 2) / 2}kg`;
}

export function blockOrder(blocks: RawBlock[], firstDateOf: Map<string, string | null>): RawBlock[] {
  const key = (b: RawBlock) => b.start_date ?? firstDateOf.get(b.id) ?? b.created_at?.slice(0, 10) ?? "9999";
  return [...blocks].sort((a, b) => key(a).localeCompare(key(b)) || (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
}

export type Graph = {
  blocks: RawBlock[];
  blockNumber: Map<string, number>;
  weeksByBlock: Map<string, RawWeek[]>;
  weekOf: Map<string, RawWeek>;
  blockOfWeek: Map<string, RawBlock>;
  exercise: Map<string, RawExercise>;
  days: DayCompare[];
  /** days in scope, in program order */
  dayOrder: string[];
  weekKey: (w: RawWeek) => string;
  weekLabel: (w: RawWeek) => string;
};

/**
 * Line up the program: each day in scope with its status and date, each
 * prescribed exercise with its logged sets. Days outside a date scope are
 * left out (the loader already limited blocks).
 */
export function buildGraph(rec: IntelRecords): Graph {
  const tz = rec.client.timezone ?? null;
  const exercise = new Map(rec.exercises.map((e) => [e.id, e]));
  const weekOf = new Map(rec.weeks.map((w) => [w.id, w]));
  const blockById = new Map(rec.blocks.map((b) => [b.id, b]));
  const blockOfWeek = new Map<string, RawBlock>();
  for (const w of rec.weeks) {
    const b = blockById.get(w.block_id);
    if (b) blockOfWeek.set(w.id, b);
  }
  const rowsByDay = new Map<string, RawRow[]>();
  for (const r of rec.rows) rowsByDay.set(r.day_id, [...(rowsByDay.get(r.day_id) ?? []), r]);
  const resultsByRow = new Map<string, IntelRecords["results"]>();
  for (const r of rec.results) resultsByRow.set(r.row_id, [...(resultsByRow.get(r.row_id) ?? []), r]);
  const setBlocksByRow = new Map<string, IntelRecords["setBlocks"]>();
  for (const s of rec.setBlocks) setBlocksByRow.set(s.row_id, [...(setBlocksByRow.get(s.row_id) ?? []), s]);
  const warmupsByRow = new Map<string, number>();
  for (const w of rec.warmups) warmupsByRow.set(w.row_id, (warmupsByRow.get(w.row_id) ?? 0) + 1);
  const completionByDay = new Map<string, IntelRecords["completions"][number]>();
  for (const c of rec.completions) {
    const prev = completionByDay.get(c.day_id);
    if (!prev || (c.completed_at && (!prev.completed_at || c.completed_at > prev.completed_at))) completionByDay.set(c.day_id, c);
  }
  const feedbackByDay = new Map<string, IntelRecords["feedback"][number]>();
  for (const f of rec.feedback) if (f.day_id) feedbackByDay.set(f.day_id, f);
  const notesByRow = new Map<string, string[]>();
  for (const n of rec.exerciseNotes) {
    if (!n.row_id || !n.content?.trim()) continue;
    notesByRow.set(n.row_id, [...(notesByRow.get(n.row_id) ?? []), n.content.trim()]);
  }

  // Each day's own date: when it was done, else when it was scheduled.
  const dayDate = new Map<string, string | null>();
  for (const d of rec.days) {
    const c = completionByDay.get(d.id);
    let date = c?.completed_at ? localDate(c.completed_at, tz) : null;
    if (!date) {
      for (const r of rowsByDay.get(d.id) ?? []) {
        for (const res of resultsByRow.get(r.id) ?? []) {
          const ld = res.completed_at ? localDate(res.completed_at, tz) : null;
          if (ld && (!date || ld < date)) date = ld;
        }
      }
    }
    dayDate.set(d.id, date ?? d.scheduled_date ?? null);
  }
  const firstDateOf = new Map<string, string | null>();
  for (const d of rec.days) {
    const w = weekOf.get(d.week_id);
    const dt = dayDate.get(d.id);
    if (!w || !dt) continue;
    const cur = firstDateOf.get(w.block_id);
    if (!cur || dt < cur) firstDateOf.set(w.block_id, dt);
  }
  const blocks = blockOrder(rec.blocks, firstDateOf);
  const blockNumber = new Map(blocks.map((b, i) => [b.id, i + 1]));
  const weeksByBlock = new Map<string, RawWeek[]>();
  for (const w of rec.weeks) weeksByBlock.set(w.block_id, [...(weeksByBlock.get(w.block_id) ?? []), w]);
  for (const list of weeksByBlock.values()) list.sort((a, b) => a.week_index - b.week_index);
  const weekKey = (w: RawWeek) => `${w.block_id}:${w.week_index}`;
  const weekLabel = (w: RawWeek) => `B${blockNumber.get(w.block_id) ?? "?"}·W${w.week_index}`;

  const days: DayCompare[] = [];
  for (const b of blocks) {
    // An archived (replaced) plan or an optional at-home backup counts only what was trained.
    const trainedOnly = !!b.archived || b.status === "Archived" || isAtHomeBackupReservedBlock(b);
    for (const w of weeksByBlock.get(b.id) ?? []) {
      const wDays = rec.days.filter((d) => d.week_id === w.id).sort((a, c) => a.day_index - c.day_index);
      for (const d of wDays) {
        const date = dayDate.get(d.id) ?? null;
        if (rec.scope.kind === "dates" && (!date || (rec.scope.from && date < rec.scope.from) || (rec.scope.to && date > rec.scope.to))) continue;
        const completion = completionByDay.get(d.id);
        const rows = (rowsByDay.get(d.id) ?? []).sort((a, c) => (a.sort_order ?? 0) - (c.sort_order ?? 0));
        const lines = new Map<string, SetLine[]>();
        let anyLogged = false;
        for (const r of rows) {
          const ls = (resultsByRow.get(r.id) ?? []).map((x) => setLine(x, rec.settings, tz)).sort((a, c) => a.setIndex - c.setIndex);
          if (ls.some((s) => s.logged)) anyLogged = true;
          lines.set(r.id, ls);
        }
        const status = dayStatus({ completed: !!completion?.completed_at, anyLogged, date, week: w, block: b, today: rec.today });
        if (trainedOnly && status !== "completed" && status !== "partial") continue;
        days.push({
          dayId: d.id,
          weekKey: weekKey(w),
          title: d.title?.trim() || `Day ${d.day_index}`,
          dayIndex: d.day_index,
          date,
          status,
          rows: rows.map((r) => compareRow(r, lines.get(r.id) ?? [], setBlocksByRow.get(r.id) ?? [], exercise.get(r.exercise_id ?? ""), status, warmupsByRow.get(r.id) ?? 0, notesByRow.get(r.id) ?? [])),
          durationMin: completion?.actual_duration_min ?? null,
          sessionRating: completion?.session_rating ?? null,
          clientNotes: completion?.client_notes?.trim() || null,
          feedback: feedbackByDay.get(d.id) ?? null,
        });
      }
    }
  }
  return { blocks, blockNumber, weeksByBlock, weekOf, blockOfWeek, exercise, days, dayOrder: days.map((d) => d.dayId), weekKey, weekLabel };
}

export function dayStatus(x: { completed: boolean; anyLogged: boolean; date: string | null; week: RawWeek; block: RawBlock; today: string }): DayStatus {
  if (x.completed) return "completed";
  if (x.anyLogged) return "partial";
  if (x.date) return x.date < x.today ? "missed" : "upcoming";
  if (x.week.end_date) return x.week.end_date < x.today ? "missed" : "upcoming";
  if (x.block.end_date) return x.block.end_date < x.today ? "missed" : "upcoming";
  return "unscheduled";
}

/** The sets a row prescribes: its set structure's working sets when it has one, else its own count. */
export function prescribedSetCount(row: RawRow, setBlocks: IntelRecords["setBlocks"]): number | null {
  const working = setBlocks.filter((s) => String(s.block_type ?? "").toLowerCase() !== "warmup");
  const n = sum(working.map((s) => toNum(s.sets) ?? 0));
  if (n > 0) return n;
  return toNum(row.sets);
}

function compareRow(
  row: RawRow,
  sets: SetLine[],
  setBlocks: IntelRecords["setBlocks"],
  ex: RawExercise | undefined,
  dayState: DayStatus,
  warmups: number,
  clientNotes: string[],
): RowCompare {
  const repR = repRange(row.reps_text);
  const rpeR = rpeRange(row.rpe);
  const loadKg = toNum(row.load_kg) ?? (toNum(row.load_lb) != null ? round((toNum(row.load_lb) as number) / LB_PER_KG, 2) : null);
  const working = sets.filter((s) => s.working);
  const prescribed = prescribedSetCount(row, setBlocks);
  const repsHit = repR ? working.filter((s) => (s.reps ?? 0) >= repR[0]).length : null;
  const rpes = working.map((s) => s.rpe).filter((n): n is number => n != null);
  const rpeDelta = rpeR && rpes.length ? round((mean(rpes) as number) - (rpeR[0] + rpeR[1]) / 2, 2) : null;
  const loads = working.map((s) => s.kg).filter((n): n is number => n != null && n > 0);
  const loadDelta = loadKg != null && loads.length ? round((mean(loads) as number) - loadKg, 2) : null;
  const top = working.filter((s) => s.e1rm != null).sort((a, b) => (b.e1rm as number) - (a.e1rm as number))[0] ?? null;
  let status: RowCompare["status"];
  if (dayState === "upcoming") status = working.length ? "partial" : "upcoming";
  else if (dayState === "unscheduled") status = working.length ? "partial" : "unscheduled";
  else if (!working.length) status = "skipped";
  else if (prescribed != null && working.length < prescribed) status = "partial";
  else status = "done";
  return {
    rowId: row.id,
    dayId: row.day_id,
    exerciseId: row.exercise_id,
    exercise: exerciseName(row, ex),
    lift: liftOf(row, ex),
    competition: isCompetition(ex),
    role: row.purpose_label?.trim() || null,
    prescribed: {
      sets: prescribed,
      reps: row.reps_text?.trim() || null,
      repRange: repR,
      rpe: row.rpe?.trim() || null,
      rpeRange: rpeR,
      rir: row.rir?.trim() || null,
      percentage: toNum(row.percentage),
      loadKg,
      tempo: row.tempo?.trim() || null,
      restSeconds: toNum(row.rest_seconds),
      notes: row.notes?.trim() || null,
      setBlocks: setBlocks
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map((s) => ({
          type: s.block_type,
          sets: toNum(s.sets),
          reps: s.reps_text,
          rpe: s.rpe ?? (s.rir ? `${s.rir} RIR` : null),
          load: s.load_value != null ? `${s.load_value}${s.load_type === "pct_1rm" || s.load_type === "ref_pct" ? "%" : s.load_unit ?? ""}` : null,
        })),
    },
    actual: sets,
    warmups,
    status,
    workingSetsDone: working.length,
    repsHitPct: repR && working.length ? Math.round(((repsHit as number) / working.length) * 100) : null,
    rpeDelta,
    loadDeltaKg: loadDelta,
    bestE1rm: top?.e1rm ?? null,
    topSet: top,
    clientNotes,
  };
}
