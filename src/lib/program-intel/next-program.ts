/**
 * Program Intelligence → the next program (pure parts): the coaching brain's
 * instructions, the exercise catalog the model may use, the shape its answer
 * must take, and checking that answer. The model writes prescriptions only;
 * every number about the past comes from the deterministic report.
 */
import { z } from "zod";
import { rxToRow } from "@/lib/cleo-program";
import { BRAIN_SUMMARY } from "./brains";
import { BRAIN_LABEL, type Brain, type IntelReport } from "./types";

export const GENERATION_PROMPT_VERSION = 1;
export const MAX_PROGRAM_WEEKS = 16;

const rxFields = {
  sets: z.coerce.number().int().min(1).max(15).optional(),
  reps: z.coerce.string().trim().min(1).max(30).optional(),
  rpe: z.coerce.string().trim().max(10).nullish(),
  rir: z.coerce.string().trim().max(10).nullish(),
  percentage: z.coerce.number().min(30).max(110).nullish(),
  notes: z.string().trim().max(300).nullish(),
};

export const programExerciseSchema = z.object({
  exercise_id: z.string().trim().nullish(),
  exercise_name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(60).nullish(),
  ...rxFields,
  sets: z.coerce.number().int().min(1).max(15),
  reps: z.coerce.string().trim().min(1).max(30),
  rest_seconds: z.coerce.number().int().min(0).max(900).nullish(),
  tempo: z.string().trim().max(20).nullish(),
  weeks: z.array(z.object({ week: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS), ...rxFields })).max(MAX_PROGRAM_WEEKS).nullish(),
});

export const programDaySchema = z.object({
  title: z.string().trim().min(1).max(80),
  focus: z.string().trim().max(160).nullish(),
  exercises: z.array(programExerciseSchema).min(1).max(12),
});

export const programBlockSchema = z.object({
  name: z.string().trim().min(1).max(80),
  focus: z.string().trim().max(240).nullish(),
  weeks: z.coerce.number().int().min(1).max(12),
  week_phases: z.array(z.object({ week: z.coerce.number().int().min(1).max(12), phase: z.string().trim().max(60) })).nullish(),
  days: z.array(programDaySchema).min(1).max(7),
});

export const programReplySchema = z
  .object({
    program_name: z.string().trim().min(1).max(100),
    summary: z.string().trim().max(3000),
    blocks: z.array(programBlockSchema).min(1).max(4),
    progression: z.string().trim().max(3000),
    recovery: z.string().trim().max(3000),
    changes: z
      .array(
        z.object({
          change: z.string().trim().min(1).max(400),
          why: z.string().trim().min(1).max(900),
          evidence: z.array(z.string().trim().max(300)).max(8).default([]),
          basis: z.enum(["fact", "hypothesis"]).catch("hypothesis"),
        }),
      )
      .max(20)
      .default([]),
    watch: z.array(z.string().trim().max(300)).max(10).default([]),
  })
  .refine((p) => p.blocks.reduce((n, b) => n + b.weeks, 0) <= MAX_PROGRAM_WEEKS, { message: `At most ${MAX_PROGRAM_WEEKS} weeks in total` });

export type ProgramReply = z.infer<typeof programReplySchema>;
export type ProgramExercise = z.infer<typeof programExerciseSchema>;

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
export function parseJsonReply<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
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

export type CatalogExercise = { id: string; name: string; family: string | null; muscle: string | null; history?: string | null };

/** "id | name | family | muscle | (their history)" lines. */
export function catalogText(list: CatalogExercise[]): string {
  return list.map((e) => [e.id, e.name, e.family ?? "", e.muscle ?? "", e.history ?? ""].join(" | ")).join("\n");
}

/** The athlete's own exercises with what happened on them (from the report), first in the catalog. */
export function athleteCatalog(report: IntelReport): CatalogExercise[] {
  return report.exercises
    .filter((e) => e.exerciseId)
    .map((e) => ({
      id: e.exerciseId as string,
      name: e.name,
      family: e.lift,
      muscle: e.muscles[0] ?? null,
      history: `${e.exposures} exposures${e.trend.changePct != null ? `, e1RM ${e.trend.changePct > 0 ? "+" : ""}${e.trend.changePct}%` : ""}${e.stalled ? ", stalled" : ""}`,
    }));
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const METHOD: Record<Brain, string> = {
  powerlifting: `POWERLIFTING BRAIN. Program squat, bench and deadlift independently from how each one actually responded. Decide competition-lift frequency and weekly working sets per lift from the evidence (e.g. a lift that progressed at 2×/week and ~10 sets/week keeps that dose; a stalled lift changes ONE variable: frequency, volume, intensity or variation). Use top sets plus back-off sets with RPE targets (or % of e1RM where the athlete's e1RM is known), keep the competition lifts specific, choose variations that coincided with progress, manage fatigue (RPE drift above target means start lighter), and periodize (accumulation → intensification → realization / peak + taper if a meet is on file, with heavy singles before a meet).`,
  bodybuilding: `BODYBUILDING BRAIN. Program hypertrophy per muscle group: weekly hard sets per muscle (raise priority / lagging muscles, hold muscles that grew, trim volume that wasn't recovered from), frequency 2×/week per muscle where possible, exercises that progressed are kept (stable, full range, loadable), stalled ones are rotated, rep ranges mostly 6–15 with a double progression (reps then load), proximity to failure RPE 7–9 (RIR 1–3), and a deload when fatigue or pain reports build.`,
  powerbuilding: `POWERBUILDING BRAIN. Both at once: competition lifts programmed for strength (each lift independently: frequency, volume, intensity, variations, fatigue) and accessories programmed for hypertrophy per muscle group (hard sets, frequency, exercise selection, progression, proximity to failure).`,
  general_fitness: `GENERAL FITNESS BRAIN. A program they will actually do: match their days and session length, balance push / pull / legs / core, steady double progression on the main exercises, moderate effort (RPE 6–8), and keep exercises they did consistently.`,
};

export function generationSystemPrompt(brain: Brain): string {
  return `You are the ${BRAIN_LABEL[brain]} coaching brain at JF Effect, an elite strength and physique coaching business. You design the NEXT training program for one athlete from a deterministic report of their real training records.

${METHOD[brain]}

Rules:
- Build from THIS athlete's response, never a generic template. Every meaningful change from their last program needs a reason that cites the report (week, exercise, numbers). Mark each reason "fact" if it rests on measured records, "hypothesis" if it's your interpretation.
- Never invent past results. Numbers about the past must come from the report.
- Exercises: use exercise_id values from the catalog (the athlete's own exercises first; they have demo videos). Copy the id exactly and the name exactly. Only if nothing in the catalog fits, set exercise_id to null and give the exercise's standard name.
- Respect the athlete's schedule (days per week), session length, equipment and injuries. Max 12 exercises per day.
- Prescriptions: sets (int), reps as written ("5", "8-10", "AMRAP"), rpe ("7" or "7-8") or rir, optional percentage (of e1RM) for competition lifts, rest_seconds, tempo, short notes the athlete reads.
- Progression: give the base prescription per exercise and per-week overrides in "weeks" (e.g. week 2 RPE 8, week 4 deload sets 2). Anything not overridden repeats.
- At most 4 blocks and ${MAX_PROGRAM_WEEKS} weeks in total.

Reply with ONE JSON object and nothing else:
{
  "program_name": string,
  "summary": string (what the records show and the plan, 3-6 sentences),
  "blocks": [ { "name": string, "focus": string, "weeks": int, "week_phases": [ { "week": int, "phase": string } ],
    "days": [ { "title": string, "focus": string,
      "exercises": [ { "exercise_id": string|null, "exercise_name": string, "role": string (e.g. "Primary Squat", "Back-off", "Accessory"),
        "sets": int, "reps": string, "rpe": string|null, "rir": string|null, "percentage": number|null, "rest_seconds": int|null, "tempo": string|null, "notes": string|null,
        "weeks": [ { "week": int, "sets": int?, "reps": string?, "rpe": string?, "rir": string?, "percentage": number?, "notes": string? } ] } ] } ] } ],
  "progression": string,
  "recovery": string,
  "changes": [ { "change": string, "why": string, "evidence": [string], "basis": "fact"|"hypothesis" } ],
  "watch": [string]
}`;
}

export function generationUserPrompt(input: { reportMarkdown: string; athleteCatalog: CatalogExercise[]; libraryCatalog: CatalogExercise[]; instructions: string | null; options: GenerationOptions }): string {
  const o = input.options;
  return [
    `## Coach's instructions`,
    input.instructions?.trim() || "(none: use your judgement from the report)",
    ``,
    `## Program shape`,
    `- Days per week: ${o.daysPerWeek ?? "from the athlete's schedule in the report"}`,
    `- Total weeks: ${o.weeks ?? "your choice (usually 4-12)"}`,
    `- Session length: ${o.sessionMinutes ? `${o.sessionMinutes} minutes` : "from Goals & Setup if on file"}`,
    ``,
    `## Exercise catalog: the athlete's own exercises (id | name | family | muscle | what happened)`,
    catalogText(input.athleteCatalog) || "(none)",
    ``,
    `## Exercise catalog: library exercises coaches program (id | name | family | muscle)`,
    catalogText(input.libraryCatalog),
    ``,
    `## The report (deterministic, from the records)`,
    input.reportMarkdown,
  ].join("\n");
}

export function interpretSystemPrompt(brain: Brain): string {
  return `You are the ${BRAIN_LABEL[brain]} coaching brain at JF Effect. ${BRAIN_SUMMARY[brain]}
Read the deterministic training report and write the coach's most useful interpretations for programming this athlete's next cycle.
Rules:
- Every observation is a HYPOTHESIS about how this athlete responds; never state it as proven.
- Each one must cite evidence that appears in the report (week labels, exercises, numbers copied exactly). Do not compute or invent numbers.
- Prefer specific, actionable observations (what to keep, change or test) over general advice. At most 10.
- Add questions for the coach about information the records are missing.
Reply with ONE JSON object and nothing else:
{ "observations": [ { "statement": string, "category": "squat"|"bench"|"deadlift"|"volume"|"intensity"|"frequency"|"exercise"|"recovery"|"adherence"|"muscle"|"other", "evidence": [string] } ], "questions": [string] }`;
}

export type GenerationOptions = { daysPerWeek?: number | null; weeks?: number | null; sessionMinutes?: number | null };

// ── Turning the answer into rows ─────────────────────────────────────────────

export type ResolvedExercise = { id: string | null; name: string; matched: "catalog" | "library" | "unmatched" };

/**
 * Settle every exercise against the library: an id from the catalog is kept
 * (with the library's own name), a name is resolved by the caller's resolver
 * (the database's exact / alias match), and anything else stays unmatched,
 * written as a name only for the coach to pick. Never creates an exercise.
 */
export async function resolveProgramExercises(
  program: ProgramReply,
  known: Map<string, string>,
  resolveName: (name: string) => Promise<string | null>,
): Promise<{ program: ProgramReply; resolved: Map<string, ResolvedExercise>; unmatched: string[] }> {
  const resolved = new Map<string, ResolvedExercise>();
  const cache = new Map<string, string | null>();
  const unmatched = new Set<string>();
  const out: ProgramReply = JSON.parse(JSON.stringify(program));
  for (const block of out.blocks) {
    for (const day of block.days) {
      for (const ex of day.exercises) {
        const id = ex.exercise_id?.trim();
        if (id && known.has(id)) {
          ex.exercise_id = id;
          ex.exercise_name = known.get(id) as string;
          resolved.set(ex.exercise_name, { id, name: ex.exercise_name, matched: "catalog" });
          continue;
        }
        const key = ex.exercise_name.trim().toLowerCase();
        if (!cache.has(key)) cache.set(key, await resolveName(ex.exercise_name.trim()).catch(() => null));
        const hit = cache.get(key) ?? null;
        if (hit) {
          ex.exercise_id = hit;
          if (known.has(hit)) ex.exercise_name = known.get(hit) as string;
          resolved.set(ex.exercise_name, { id: hit, name: ex.exercise_name, matched: "library" });
        } else {
          ex.exercise_id = null;
          unmatched.add(ex.exercise_name.trim());
          resolved.set(ex.exercise_name, { id: null, name: ex.exercise_name.trim(), matched: "unmatched" });
        }
      }
    }
  }
  return { program: out, resolved, unmatched: [...unmatched] };
}

/** One exercise's prescription for a given week (the base, with that week's overrides). */
export function weekRx(ex: ProgramExercise, week: number): { sets: number; reps: string; rpe?: string; rir?: string; percentage?: number; notes?: string } {
  const o = (ex.weeks ?? []).find((w) => w.week === week) ?? {};
  const pick = <T>(a: T | null | undefined, b: T | null | undefined) => (a ?? b ?? undefined) as T | undefined;
  return {
    sets: pick((o as any).sets, ex.sets) as number,
    reps: pick((o as any).reps, ex.reps) as string,
    rpe: pick((o as any).rpe, ex.rpe),
    rir: pick((o as any).rir, ex.rir),
    percentage: pick((o as any).percentage, ex.percentage),
    notes: pick((o as any).notes, ex.notes),
  };
}

/** The pl_exercise_rows columns for one exercise in one week (like Cleo's builder; % reads as % of estimated 1RM). */
export function exerciseRow(ex: ProgramExercise, week: number, sortOrder: number): Record<string, unknown> {
  const rx = weekRx(ex, week);
  const row = rxToRow({
    sets: rx.sets,
    reps: rx.reps,
    ...(rx.rpe ? { rpe: rx.rpe } : {}),
    ...(rx.rir && !rx.rpe ? { rir: rx.rir } : {}),
    ...(rx.percentage != null ? { percentage: rx.percentage, percentage_of: "est_1rm" as const } : {}),
    ...(ex.rest_seconds != null ? { rest_seconds: ex.rest_seconds } : {}),
    ...(ex.tempo ? { tempo: ex.tempo } : {}),
    ...(rx.notes ? { notes: rx.notes } : {}),
  });
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
