/**
 * Training load for the AI: Program Intelligence's records read through the
 * same engine as the analytics page (training-load.ts), over the last
 * `TRAINING_LOAD_WEEKS` weeks, so Generate Next Program, Edit with AI and the
 * interpret job plan from the workload the coach and athlete see on screen.
 */
import { buildTrainingLoad, trainingLoadText, type LoadSet, type PlanRow, type TrainingLoad } from "@/lib/analytics/training-load";
import { localDate } from "./core";
import type { IntelRecords } from "./types";

export const TRAINING_LOAD_WEEKS = 12;

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** The read over the last weeks, from the records Program Intelligence already loaded. */
export function trainingLoadFromRecords(rec: IntelRecords, weeks = TRAINING_LOAD_WEEKS): TrainingLoad {
  const today = rec.today;
  const from = new Date(Date.parse(today) - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
  const tz = rec.client?.timezone ?? null;
  const ex = new Map(rec.exercises.map((e) => [e.id, e]));
  const rowById = new Map(rec.rows.map((r) => [r.id, r]));
  const dayById = new Map(rec.days.map((d) => [d.id, d]));
  const weekById = new Map(rec.weeks.map((w) => [w.id, w]));
  const facts = (row: { exercise_id: string | null; exercise_name_override: string | null }) => {
    const e = row.exercise_id ? ex.get(row.exercise_id) : undefined;
    return {
      exerciseId: row.exercise_id ?? null,
      exercise: e?.name ?? row.exercise_name_override ?? "",
      primary: e?.muscle_groups ?? [],
      secondary: e?.secondary_muscle_groups ?? [],
      fallbackMuscle: e?.primary_muscle_group ?? null,
      countsTowardVolume: e?.counts_toward_volume !== false,
      category: e?.exercise_category ?? null,
      competitionLiftType: e?.competition_lift_type ?? null,
      isCompetitionLift: e?.is_competition_lift === true,
      exerciseFamily: e?.movement_family ?? null,
    };
  };

  const sets: LoadSet[] = [];
  for (const r of rec.results) {
    if (r.is_working_set === false) continue; // a set flagged as a warm-up
    const reps = num(r.actual_reps);
    if (!reps || reps <= 0) continue;
    const row = rowById.get(r.row_id);
    if (!row) continue;
    const day = localDate(r.completed_at, tz) ?? dayById.get(row.day_id)?.scheduled_date ?? null;
    if (!day || day < from || day > today) continue;
    const kg = r.load_type === "assisted" ? 0 : num(r.normalized_kg) ?? num(r.actual_load_kg) ?? 0;
    sets.push({
      ...facts(row),
      day,
      dayId: row.day_id,
      rowId: row.id,
      reps,
      loadKg: kg > 0 ? kg : 0,
      rpe: num(r.actual_rpe_num) ?? num(r.actual_rpe),
      rir: num(r.actual_rir),
    });
  }

  const plan: PlanRow[] = [];
  for (const row of rec.rows) {
    const d = dayById.get(row.day_id);
    if (!d?.scheduled_date || d.scheduled_date < from) continue;
    plan.push({
      ...facts(row),
      rowId: row.id,
      dayId: row.day_id,
      day: d.scheduled_date,
      sets: row.sets,
      repsText: row.reps_text,
      rpeText: row.rpe,
      isTime: row.measurement_type === "time",
      weekPhase: weekById.get(d.week_id)?.phase ?? null,
    });
  }
  return buildTrainingLoad({ sets, plan, today });
}

/** The brief's section text, or "" when nothing was trained in the window. */
export function trainingLoadBrief(load: TrainingLoad | null | undefined): string {
  if (!load || !load.totals.sets) return "";
  return `Last ${TRAINING_LOAD_WEEKS} weeks (working sets only, warm-ups never counted):\n${trainingLoadText(load)}`;
}

export const TRAINING_LOAD_RULES = `HOW TO USE "TRAINING LOAD" (computed from their logged sets and the program as written)
- It says how much work was done, where it went (muscles, movement patterns, the competition lifts, the days of the week) and how that moved. Each flag carries its confidence and whether a change is required; a flag is context for a decision, never an instruction on its own.
- Don't add workload because the athlete is progressing (progress on the current dose means the dose works), and don't cut it for one hard session or one light week. Change volume only for a reason the records show over 2+ weeks, and say which.
- Prefer redistributing work (another day, another exercise for the same muscle, spacing heavy lower-body sessions) over adding sets. A muscle with most of its week in one session gets more from the same sets over two days.
- Read completion first: when sets were missed, judge execution (time, schedule, recovery) before calling the program too much or too little.
- Volume per muscle is an estimate (primary muscles a full set, secondary half); intensity is % of the best estimated max in the window, not a tested or training max. Say "estimated" where you use them.`;
