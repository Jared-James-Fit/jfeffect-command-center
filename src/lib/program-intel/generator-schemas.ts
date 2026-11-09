/**
 * The shapes that pass between Generate Next Program's stages, checked with
 * Zod at every hand-off: the coach's setup (stage 3 → 4), the programming
 * strategy (stage 4 → 5) and each constructed block (stage 5 → 6). A model
 * answer that doesn't fit is never used as-is: it's asked again with the
 * problem named, or the stage fails with the reason.
 */
import { z } from "zod";
import { BRAINS, type Brain } from "./types";
import { EQUIPMENT_ITEMS } from "./equipment";

import { MAX_PROGRAM_WEEKS } from "./horizon";
export { MAX_PROGRAM_WEEKS };
/** One block is at most this long (a longer program is several blocks, each built in its own request). */
export const MAX_BLOCK_WEEKS = 12;

const ref = z.object({ id: z.string().trim().max(64).nullable(), name: z.string().trim().min(1).max(120) });

/**
 * Model answers are read tolerantly, never thrown away for being thorough: text over its cap is
 * cut to the cap (an object or number where text belongs is kept as its text), and a list keeps
 * every item that reads, up to its cap. Before Nov 9 2026 a long `intensity` or one 66-character
 * frequency label wiped the whole field to "" / [], so the most detailed strategies arrived with
 * their intensity, progression and day plans empty.
 */
const asText = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));
export const clip = (n: number) => z.preprocess(asText, z.string()).transform((s) => s.trim().slice(0, n));
export const clipReq = (n: number) => z.preprocess(asText, z.string().trim().min(1)).transform((s) => s.slice(0, n));
export function list<T extends z.ZodTypeAny>(schema: T, k: number) {
  return z
    .preprocess((v) => (Array.isArray(v) ? v : v == null ? [] : [v]), z.array(z.unknown()))
    .transform((arr) => arr.flatMap((x) => {
      const r = schema.safeParse(x);
      return r.success ? [r.data as z.output<T>] : [];
    }).slice(0, k));
}
const shortText = (n: number) => clip(n);

const cardioSessionSchema = z.object({
  type: z.string().trim().min(1).max(60),
  minutes: z.number().int().min(1).max(180),
  perWeek: z.number().int().min(0).max(7).nullable(),
  weekdays: z.array(z.string().trim().max(12)).max(7).default([]),
  incline: z.number().min(0).max(20).nullable(),
  zone: z.string().trim().max(40).nullable(),
});
export const cardioPlanSchema = z.object({
  source: z.enum(["plan", "proposed", "none"]),
  origin: z.enum(["nutrition", "coach", "program", "program_rows"]).nullable(),
  trainingDay: cardioSessionSchema.nullable(),
  restDay: cardioSessionSchema.nullable(),
  updatedAt: z.string().max(40).nullable(),
  done: z.object({ done: z.number().int().min(0), planned: z.number().int().min(0) }).nullable(),
  why: z.string().trim().max(400),
});

export const setupSchema = z.object({
  brain: z.enum(BRAINS as [Brain, ...Brain[]]),
  mainGoal: z.string().trim().min(1).max(300),
  secondaryGoals: z.array(z.string().trim().max(200)).max(8).default([]),
  daysPerWeek: z.number().int().min(1).max(7),
  trainingDays: z.array(z.string().trim().max(12)).max(7).default([]),
  weeks: z.number().int().min(1).max(MAX_PROGRAM_WEEKS),
  durationMode: z.enum(["default", "custom", "goal"]).default("default"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  sessionMinutes: z.number().int().min(15).max(240).nullable(),
  maxSessionMinutes: z.number().int().min(15).max(300).nullable(),
  blocks: z.array(z.object({ name: z.string().trim().min(1).max(80), weeks: z.number().int().min(1).max(MAX_BLOCK_WEEKS), objective: z.string().trim().max(400) })).max(6).default([]),
  priorities: z.array(z.string().trim().max(60)).max(10).default([]),
  equipment: z.object({
    items: z.array(z.enum(EQUIPMENT_ITEMS as [string, ...string[]])).max(40),
    location: z.string().trim().max(120).nullable(),
    cableStations: z.number().int().min(0).max(6).nullable(),
    notes: z.string().trim().max(600).nullable(),
    source: z.enum(["coach", "program", "goals", "unknown"]),
    confidence: z.enum(["confirmed", "inferred", "stated", "unknown"]),
  }),
  restrictions: z.array(z.string().trim().max(300)).max(12).default([]),
  retain: z.array(ref).max(40).default([]),
  replace: z.array(ref).max(30).default([]),
  meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  frequency: z.array(z.object({ target: z.string().trim().max(60), perWeek: z.number().min(0).max(7) })).max(24).default([]),
  volume: z.array(z.object({ target: z.string().trim().max(60), setsPerWeek: z.number().min(0).max(60) })).max(30).default([]),
  intensity: z.string().trim().max(800).default(""),
  effort: z.string().trim().max(400).default(""),
  progression: z.string().trim().max(600).default(""),
  specificity: z.string().trim().max(400).default(""),
  required: z.array(ref).max(20).default([]),
  excluded: z.array(ref).max(30).default([]),
  recovery: z.string().trim().max(1000).default(""),
  preferences: z.string().trim().max(1000).default(""),
  coachNotes: z.string().trim().max(2000).default(""),
  newCircumstances: z.string().trim().max(2000).default(""),
  /** The cardio plan the program is built around (never written into the workouts; see cardio.ts). */
  cardio: cardioPlanSchema.nullable().default(null),
});

// ── Stage 4: the programming strategy ────────────────────────────────────────

const item = z.object({ item: clipReq(400), why: clip(1200), evidence: list(clip(400), 8) });

export const decisionSchema = z.object({
  area: clip(60),
  observation: clipReq(1200),
  evidence: list(clip(400), 10),
  change: clipReq(1200),
  benefit: clip(800),
  monitor: clip(800),
  basis: z.enum(["fact", "hypothesis"]).catch("hypothesis"),
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
});
export type StrategyDecision = z.infer<typeof decisionSchema>;

export const strategySchema = z.object({
  athlete_read: clipReq(4000),
  previous_program: z.object({ intent: clip(1500), outcome: clip(2500) }),
  keep: list(item, 20),
  change: list(item, 20),
  prioritize: list(item, 14),
  reduce: list(item, 16),
  progression: z.object({ model: clip(4000), expected: clip(2000), fatigue: clip(2500), success_criteria: list(clip(400), 12) }),
  structure: z.object({
    weeks: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS),
    days_per_week: z.coerce.number().int().min(1).max(7),
    session_minutes: z.coerce.number().int().min(15).max(300).nullish(),
    blocks: z
      .array(
        z.object({
          name: clipReq(80),
          weeks: z.coerce.number().int().min(1).max(MAX_BLOCK_WEEKS),
          objective: clip(1000),
          // a phase often carries that week's main-lift prescription: never cut it to a label
          phases: list(z.object({ week: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS), phase: clip(600) }), MAX_PROGRAM_WEEKS),
        }),
      )
      .min(1)
      .max(6),
  }),
  /** How these weeks fit the longer timeline (a deadline months away, a long-term goal): what's written now vs later. */
  roadmap: z
    .object({
      timeline: clip(1200),
      this_program: clip(1200),
      phases: list(z.object({ weeks: clip(40), focus: clip(500), milestone: clip(500) }), 12),
      track: z.enum(["ahead", "on_track", "behind", "unknown"]).catch("unknown"),
      track_why: clip(1000),
    })
    .nullish()
    .catch(null),
  weekly_layout: z
    .array(z.object({ day: z.coerce.number().int().min(1).max(7), title: clipReq(100), focus: clip(800), primary: list(clip(200), 10), notes: clip(2500) }))
    .min(1)
    .max(7),
  frequency_targets: list(z.object({ target: clipReq(120), per_week: z.coerce.number().min(0).max(7) }), 30),
  volume_targets: list(z.object({ target: clipReq(120), sets_per_week: z.coerce.number().min(0).max(60), vs_previous: clip(300) }), 36),
  intensity: clip(4000),
  exercise_plan: z.object({
    retain: list(z.object({ exercise_id: z.string().trim().max(64).nullish().catch(null), name: clipReq(160), why: clip(600) }), 50),
    replace: list(z.object({ exercise_id: z.string().trim().max(64).nullish().catch(null), name: clipReq(160), with: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 160) || null)), why: clip(600) }), 30),
    add: list(z.object({ name: clipReq(160), why: clip(600) }), 30),
  }),
  decisions: list(decisionSchema, 16).refine((a) => a.length > 0, { message: "decisions needs at least one readable decision" }),
  coach_requirements: list(z.object({ requirement: clipReq(600), status: z.enum(["met", "conflict", "not_applicable"]).catch("met"), how: clip(800) }), 30),
  conflicts: list(z.object({ description: clipReq(800), resolution: clip(800) }), 16),
  data_limits: list(clip(800), 16),
  monitor: list(clip(500), 16),
});
export type Strategy = z.infer<typeof strategySchema>;

// ── Stage 5: one constructed block ───────────────────────────────────────────

const rxFields = {
  sets: z.coerce.number().int().min(1).max(15).optional(),
  reps: z.coerce.string().trim().min(1).max(30).optional(),
  rpe: z.coerce.string().trim().max(10).nullish(),
  rir: z.coerce.string().trim().max(10).nullish(),
  percentage: z.coerce.number().min(30).max(110).nullish(),
  notes: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 500) || null)).optional(),
};

export const builtExerciseSchema = z.object({
  exercise_id: z.string().trim().max(64).nullish(),
  exercise_name: clipReq(160),
  role: z.string().trim().max(60).nullish().catch(null),
  station: z.string().trim().max(40).nullish().catch(null),
  // "A1" / "A2": a longer label ("SS A1", "Superset A-2") is read down to its letter and number,
  // and one with neither is dropped (no superset), never failing the block
  superset: z.preprocess((v) => {
    if (v == null || v === "") return null;
    const t = String(v).toUpperCase();
    const m = t.match(/\b([A-Z])\s*-?\s*(\d{1,2})\b/) ?? t.match(/([A-Z])(\d{1,2})/);
    return m ? `${m[1]}${m[2]}` : t.trim().length <= 4 ? t.trim() : null;
  }, z.string().max(4).nullable()).optional(),
  ...rxFields,
  sets: z.coerce.number().int().min(1).max(15),
  reps: z.coerce.string().trim().min(1).max(30),
  rest_seconds: z.coerce.number().int().min(0).max(900).nullish(),
  tempo: z.string().trim().max(20).nullish().catch(null),
  progression: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 800) || null)).optional(),
  substitutions: list(z.object({ exercise_id: z.string().trim().max(64).nullish().catch(null), exercise_name: clipReq(160) }), 3),
  // a week's changes, each field read on its own: an impossible value (0 sets for "skip it that
  // week") is dropped for that field instead of failing the whole block (Devin, Nov 9 2026)
  weeks: list(
    z.object({
      week: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS),
      sets: rxFields.sets.catch(undefined),
      reps: rxFields.reps.catch(undefined),
      rpe: rxFields.rpe.catch(undefined),
      rir: rxFields.rir.catch(undefined),
      percentage: rxFields.percentage.catch(undefined),
      notes: rxFields.notes.catch(undefined),
    }),
    MAX_PROGRAM_WEEKS,
  ),
});
export type BuiltExercise = z.infer<typeof builtExerciseSchema>;

export const builtDaySchema = z.object({
  day: z.coerce.number().int().min(1).max(7).optional(),
  title: clipReq(100),
  focus: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 400) || null)).optional(),
  exercises: z.array(builtExerciseSchema).min(1).max(12),
});
export type BuiltDay = z.infer<typeof builtDaySchema>;

export const builtBlockSchema = z.object({
  name: clipReq(80),
  objective: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 1200) || null)).optional(),
  weeks: z.coerce.number().int().min(1).max(MAX_BLOCK_WEEKS),
  week_phases: list(z.object({ week: z.coerce.number().int().min(1).max(MAX_BLOCK_WEEKS), phase: clip(80) }), MAX_BLOCK_WEEKS),
  deload_rule: z.preprocess((v) => (v == null ? null : asText(v)), z.string().nullable()).transform((v) => (v == null ? null : v.trim().slice(0, 800) || null)).optional(),
  progression_rules: list(clip(600), 12),
  days: z.array(builtDaySchema).min(1).max(7),
});
export type BuiltBlock = z.infer<typeof builtBlockSchema>;

/** The whole draft as stored on the job (and shown in the preview). */
export type BuiltProgram = {
  program_name: string;
  summary: string;
  blocks: BuiltBlock[];
  progression: string;
  recovery: string;
  changes: Array<{ change: string; why: string; evidence: string[]; basis: "fact" | "hypothesis" }>;
  watch: string[];
};
