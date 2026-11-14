/**
 * Program Intelligence → the next program (pure parts shared by the stages):
 * reading a model's JSON answer, the exercise catalog the model may choose
 * from, settling every exercise against the existing library (never creating
 * one), the rows written to the program, and the dates a draft gets when the
 * coach assigns it. The interpret run's prompt lives here too.
 */
import { DEVELOPMENT_RULES } from "./athlete-development";
import { z } from "zod";
import { isTimedCardio } from "@/lib/timed-cardio";
import { rxToRow } from "@/lib/cleo-program";
import { BRAIN_SUMMARY } from "./methods";
import { missingEquipment, type EquipmentResolution } from "./equipment";
import type { BuiltExercise, BuiltProgram } from "./generator-schemas";
import { athleteNotes, rxForWeek } from "./program-view";
import { BRAIN_LABEL, type Brain, type IntelReport, type RawExercise } from "./types";

export { MAX_PROGRAM_WEEKS } from "./generator-schemas";

export const interpretReplySchema = z.object({
  observations: z
    .array(
      z.object({
        statement: z.string().trim().min(1).max(600),
        category: z.string().trim().max(40).nullish(),
        evidence: z.array(z.string().trim().max(300)).max(8).default([]),
      }),
    )
    .max(12)
    .default([]),
  questions: z.array(z.string().trim().max(300)).max(8).default([]),
});
export type InterpretReply = z.infer<typeof interpretReplySchema>;

/** Pull the JSON object out of a model reply (fences, prose around it) and check it. */
export function parseJsonReply<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, any>): { ok: true; value: T } | { ok: false; error: string } {
  const t = String(text ?? "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "No JSON object in the reply" };
  let raw: unknown;
  try {
    raw = JSON.parse(t.slice(start, end + 1));
  } catch (e: any) {
    return { ok: false, error: `Invalid JSON: ${e?.message ?? e}` };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: parsed.data };
}

// ── The exercise catalog the model may choose from ───────────────────────────

export type CatalogExercise = { id: string; name: string; family: string | null; muscle: string | null; equipment?: string | null; history?: string | null };

/** "id | name | family | muscle | equipment | (their history)" lines. */
export function catalogText(list: CatalogExercise[]): string {
  return list.map((e) => [e.id, e.name, e.family ?? "", e.muscle ?? "", e.equipment ?? "", e.history ?? ""].join(" | ")).join("\n");
}

/** The athlete's own exercises with what happened on them (from the report), first in the catalog. */
export function athleteCatalog(report: IntelReport, meta?: Map<string, RawExercise>): CatalogExercise[] {
  return report.exercises
    .filter((e) => e.exerciseId)
    .map((e) => ({
      id: e.exerciseId as string,
      name: e.name,
      family: e.lift,
      muscle: e.muscles[0] ?? null,
      equipment: meta?.get(e.exerciseId as string)?.equipment ?? null,
      history: `${e.exposures} exposures${e.trend.changePct != null ? `, e1RM ${e.trend.changePct > 0 ? "+" : ""}${e.trend.changePct}%` : ""}${e.stalled ? ", stalled" : ""}${e.adherencePct != null ? `, ${e.adherencePct}% of sets done` : ""}`,
    }));
}

/** Only the exercises the athlete's equipment allows (nothing is filtered when equipment is unknown). */
export function equipmentFit<T extends { name: string; equipment?: string | null }>(list: T[], eq: Pick<EquipmentResolution, "items" | "confidence">): T[] {
  return list.filter((e) => missingEquipment(e, eq).length === 0);
}

export function interpretSystemPrompt(brain: Brain): string {
  return `You are the ${BRAIN_LABEL[brain]} coaching brain at JF Effect. ${BRAIN_SUMMARY[brain]}
Read the deterministic training report and write the coach's most useful interpretations for programming this athlete's next cycle.
Rules:
- Every observation is a HYPOTHESIS about how this athlete responds; never state it as proven.
- Each one must cite evidence that appears in the report (week labels, exercises, numbers copied exactly). Do not compute or invent numbers.
- Prefer specific, actionable observations (what to keep, change or test) over general advice. At most 10.
- Add questions for the coach about information the records are missing.
- Read the "Athlete development" section as the measured read of who they are and how they develop (training age and rate, strength against bodyweight and bodyweight phase, weight class, plateaus, adherence, fatigue, and progress / hold / back off per exercise); interpret it, don't repeat it.
${DEVELOPMENT_RULES}
Reply with ONE JSON object and nothing else:
{ "observations": [ { "statement": string, "category": "squat"|"bench"|"deadlift"|"volume"|"intensity"|"frequency"|"exercise"|"recovery"|"adherence"|"muscle"|"other", "evidence": [string] } ], "questions": [string] }`;
}

// ── Settling exercises against the library ───────────────────────────────────

export type ResolvedExercise = { id: string | null; name: string; matched: "catalog" | "library" | "unmatched" };

/**
 * Settle every exercise (and every swap option) against the library: an id
 * from the catalog is kept with the library's own name, a name is resolved by
 * the caller's resolver (the database's exact / alias match), anything else
 * stays a name only for the coach to pick (and is flagged). Never creates an
 * exercise.
 */
export async function resolveProgramExercises<P extends Pick<BuiltProgram, "blocks">>(
  program: P,
  known: Map<string, string>,
  resolveName: (name: string) => Promise<string | null>,
): Promise<{ program: P; resolved: Map<string, ResolvedExercise>; unmatched: string[] }> {
  const resolved = new Map<string, ResolvedExercise>();
  const cache = new Map<string, string | null>();
  const unmatched = new Set<string>();
  const out: P = JSON.parse(JSON.stringify(program));
  const settle = async (x: { exercise_id?: string | null; exercise_name: string }, counts: boolean) => {
    const id = x.exercise_id?.trim();
    if (id && known.has(id)) {
      x.exercise_id = id;
      x.exercise_name = known.get(id) as string;
      if (counts) resolved.set(x.exercise_name, { id, name: x.exercise_name, matched: "catalog" });
      return;
    }
    const key = x.exercise_name.trim().toLowerCase();
    if (!cache.has(key)) cache.set(key, await resolveName(x.exercise_name.trim()).catch(() => null));
    const hit = cache.get(key) ?? null;
    if (hit) {
      x.exercise_id = hit;
      if (known.has(hit)) x.exercise_name = known.get(hit) as string;
      if (counts) resolved.set(x.exercise_name, { id: hit, name: x.exercise_name, matched: "library" });
    } else {
      x.exercise_id = null;
      if (counts) {
        unmatched.add(x.exercise_name.trim());
        resolved.set(x.exercise_name, { id: null, name: x.exercise_name.trim(), matched: "unmatched" });
      }
    }
  };
  for (const block of out.blocks) {
    for (const day of block.days) {
      for (const ex of day.exercises) {
        await settle(ex, true);
        for (const s of (ex as BuiltExercise).substitutions ?? []) await settle(s, false);
      }
    }
  }
  return { program: out, resolved, unmatched: [...unmatched] };
}

/** The pl_exercise_rows columns for one exercise in one week (like Cleo's builder; % reads as % of estimated 1RM). */
/** Steady cardio done for time (a walk, a bike), not a strength movement that happens to walk. */
export { isTimedCardio };
/** Minutes from a cardio prescription the model wrote as reps ("10", "10 min", "10-15"): the first number, 1–120. */
export function cardioMinutes(reps: string | null | undefined): number | null {
  const m = String(reps ?? "").match(/\d+(?:\.\d+)?/);
  const n = m ? Number(m[0]) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 120 ? Math.round(n) : null;
}

/**
 * A built block without steady cardio rows: the client's cardio plan is the one place for cardio
 * (the app adds its training-day session to every workout), so a walk or bike the model wrote
 * would be a second copy. Returns the names taken out.
 */
export function withoutCardioRows<B extends { days: Array<{ exercises: Array<{ exercise_name: string }> }> }>(block: B): { block: B; removed: string[] } {
  const removed: string[] = [];
  const days = block.days.map((d) => {
    const keep = d.exercises.filter((e) => {
      if (!isTimedCardio(e.exercise_name)) return true;
      removed.push(e.exercise_name);
      return false;
    });
    return keep.length === d.exercises.length ? d : { ...d, exercises: keep };
  });
  return { block: removed.length ? { ...block, days } : block, removed };
}

/** A built exercise's percentage basis as the row stores it (a % with none named reads as e1RM, as before). */
function rowBasis(b: string | null | undefined): "training_max" | "1rm" | "est_1rm" {
  return b === "training_max" ? "training_max" : b === "1rm" ? "1rm" : "est_1rm";
}

export function exerciseRow(ex: BuiltExercise, week: number, sortOrder: number, day?: readonly BuiltExercise[] | null): Record<string, unknown> {
  const rx = rxForWeek(ex, week);
  // A walk or a bike is logged as time: "10" from the model is ten minutes, never ten reps.
  if (isTimedCardio(ex.exercise_name)) {
    const minutes = cardioMinutes(rx.reps) ?? 10;
    const notes = athleteNotes(ex, week, day);
    return {
      sets: Math.max(1, Math.min(3, Number(rx.sets) || 1)),
      reps_text: null,
      rpe: null,
      rest_seconds: 0,
      measurement_type: "time",
      tracking_type: "time",
      duration_seconds: minutes * 60,
      ...(notes ? { notes } : {}),
      sort_order: sortOrder,
      exercise_id: ex.exercise_id ?? null,
      exercise_name_override: ex.exercise_id ? null : ex.exercise_name,
      purpose_label: ex.role ?? null,
    };
  }
  const notes = athleteNotes(ex, week, day);
  const row = rxToRow({
    sets: rx.sets,
    reps: rx.reps,
    ...(rx.rpe ? { rpe: rx.rpe } : {}),
    ...(rx.rir && !rx.rpe ? { rir: rx.rir } : {}),
    ...(rx.percentage != null ? { percentage: rx.percentage, percentage_of: rowBasis(rx.percentage_of) } : {}),
    ...(ex.rest_seconds != null ? { rest_seconds: ex.rest_seconds } : {}),
    ...(ex.tempo ? { tempo: ex.tempo } : {}),
    ...(notes ? { notes } : {}),
  });
  // a back-off reads today's top set of the same exercise (the logger fills it in once that's logged)
  if (rx.percentage != null && rx.percentage_of === "top_set") row.percentage_basis = "top_set";
  return {
    ...row,
    sort_order: sortOrder,
    exercise_id: ex.exercise_id ?? null,
    exercise_name_override: ex.exercise_id ? null : ex.exercise_name,
    purpose_label: ex.role ?? null,
  };
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The dates of each draft block, back to back from the start date (each week 7 days). */
export function draftBlockDates(startDate: string, blockWeeks: number[]): Array<{ start: string; end: string; weeks: Array<{ start: string; end: string }> }> {
  let cursor = startDate;
  return blockWeeks.map((n) => {
    const start = cursor;
    const weeks = Array.from({ length: n }, (_, i) => ({ start: addDays(start, i * 7), end: addDays(start, i * 7 + 6) }));
    const end = addDays(start, n * 7 - 1);
    cursor = addDays(end, 1);
    return { start, end, weeks };
  });
}
