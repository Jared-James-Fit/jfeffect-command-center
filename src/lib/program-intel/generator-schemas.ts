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

export const MAX_PROGRAM_WEEKS = 16;

const ref = z.object({ id: z.string().trim().max(64).nullable(), name: z.string().trim().min(1).max(120) });
const shortText = (n: number) => z.string().trim().max(n).catch("");

export const setupSchema = z.object({
  brain: z.enum(BRAINS as [Brain, ...Brain[]]),
  mainGoal: z.string().trim().min(1).max(300),
  secondaryGoals: z.array(z.string().trim().max(200)).max(8).default([]),
  daysPerWeek: z.number().int().min(1).max(7),
  trainingDays: z.array(z.string().trim().max(12)).max(7).default([]),
  weeks: z.number().int().min(1).max(MAX_PROGRAM_WEEKS),
  sessionMinutes: z.number().int().min(15).max(240).nullable(),
  maxSessionMinutes: z.number().int().min(15).max(300).nullable(),
  blocks: z.array(z.object({ name: z.string().trim().min(1).max(80), weeks: z.number().int().min(1).max(MAX_PROGRAM_WEEKS), objective: z.string().trim().max(400) })).min(1).max(4),
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
});

// ── Stage 4: the programming strategy ────────────────────────────────────────

const item = z.object({ item: z.string().trim().min(1).max(300), why: shortText(700), evidence: z.array(z.string().trim().max(300)).max(6).catch([]) });

export const decisionSchema = z.object({
  area: shortText(40),
  observation: z.string().trim().min(1).max(700),
  evidence: z.array(z.string().trim().max(300)).max(8).catch([]),
  change: z.string().trim().min(1).max(700),
  benefit: shortText(500),
  monitor: shortText(500),
  basis: z.enum(["fact", "hypothesis"]).catch("hypothesis"),
  confidence: z.enum(["high", "medium", "low"]).catch("medium"),
});
export type StrategyDecision = z.infer<typeof decisionSchema>;

export const strategySchema = z.object({
  athlete_read: z.string().trim().min(1).max(2000),
  previous_program: z.object({ intent: shortText(1000), outcome: shortText(1500) }),
  keep: z.array(item).max(14).catch([]),
  change: z.array(item).max(14).catch([]),
  prioritize: z.array(item).max(10).catch([]),
  reduce: z.array(item).max(12).catch([]),
  progression: z.object({ model: shortText(900), expected: shortText(900), fatigue: shortText(900), success_criteria: z.array(z.string().trim().max(300)).max(10).catch([]) }),
  structure: z.object({
    weeks: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS),
    days_per_week: z.coerce.number().int().min(1).max(7),
    session_minutes: z.coerce.number().int().min(15).max(300).nullish(),
    blocks: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(80),
          weeks: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS),
          objective: shortText(600),
          phases: z.array(z.object({ week: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS), phase: z.string().trim().max(60) })).max(MAX_PROGRAM_WEEKS).catch([]),
        }),
      )
      .min(1)
      .max(4),
  }),
  weekly_layout: z
    .array(z.object({ day: z.coerce.number().int().min(1).max(7), title: z.string().trim().min(1).max(80), focus: shortText(300), primary: z.array(z.string().trim().max(100)).max(5).catch([]), notes: shortText(400) }))
    .min(1)
    .max(7),
  frequency_targets: z.array(z.object({ target: z.string().trim().max(60), per_week: z.coerce.number().min(0).max(7) })).max(24).catch([]),
  volume_targets: z.array(z.object({ target: z.string().trim().max(60), sets_per_week: z.coerce.number().min(0).max(60), vs_previous: shortText(160) })).max(30).catch([]),
  intensity: shortText(900),
  exercise_plan: z.object({
    retain: z.array(z.object({ exercise_id: z.string().trim().max(64).nullish(), name: z.string().trim().max(120), why: shortText(300) })).max(40).catch([]),
    replace: z.array(z.object({ exercise_id: z.string().trim().max(64).nullish(), name: z.string().trim().max(120), with: z.string().trim().max(120).nullish(), why: shortText(300) })).max(25).catch([]),
    add: z.array(z.object({ name: z.string().trim().max(120), why: shortText(300) })).max(25).catch([]),
  }),
  decisions: z.array(decisionSchema).min(1).max(16),
  coach_requirements: z.array(z.object({ requirement: z.string().trim().max(400), status: z.enum(["met", "conflict", "not_applicable"]).catch("met"), how: shortText(500) })).max(24).catch([]),
  conflicts: z.array(z.object({ description: z.string().trim().max(500), resolution: shortText(500) })).max(12).catch([]),
  data_limits: z.array(z.string().trim().max(500)).max(12).catch([]),
  monitor: z.array(z.string().trim().max(300)).max(12).catch([]),
});
export type Strategy = z.infer<typeof strategySchema>;

// ── Stage 5: one constructed block ───────────────────────────────────────────

const rxFields = {
  sets: z.coerce.number().int().min(1).max(15).optional(),
  reps: z.coerce.string().trim().min(1).max(30).optional(),
  rpe: z.coerce.string().trim().max(10).nullish(),
  rir: z.coerce.string().trim().max(10).nullish(),
  percentage: z.coerce.number().min(30).max(110).nullish(),
  notes: z.string().trim().max(300).nullish(),
};

export const builtExerciseSchema = z.object({
  exercise_id: z.string().trim().max(64).nullish(),
  exercise_name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(60).nullish(),
  station: z.string().trim().max(40).nullish(),
  superset: z.string().trim().max(4).nullish(),
  ...rxFields,
  sets: z.coerce.number().int().min(1).max(15),
  reps: z.coerce.string().trim().min(1).max(30),
  rest_seconds: z.coerce.number().int().min(0).max(900).nullish(),
  tempo: z.string().trim().max(20).nullish(),
  progression: z.string().trim().max(400).nullish(),
  substitutions: z.array(z.object({ exercise_id: z.string().trim().max(64).nullish(), exercise_name: z.string().trim().min(1).max(120) })).max(3).catch([]),
  weeks: z.array(z.object({ week: z.coerce.number().int().min(1).max(MAX_PROGRAM_WEEKS), ...rxFields })).max(MAX_PROGRAM_WEEKS).nullish(),
});
export type BuiltExercise = z.infer<typeof builtExerciseSchema>;

export const builtDaySchema = z.object({
  day: z.coerce.number().int().min(1).max(7).optional(),
  title: z.string().trim().min(1).max(80),
  focus: z.string().trim().max(200).nullish(),
  exercises: z.array(builtExerciseSchema).min(1).max(12),
});
export type BuiltDay = z.infer<typeof builtDaySchema>;

export const builtBlockSchema = z.object({
  name: z.string().trim().min(1).max(80),
  objective: z.string().trim().max(600).nullish(),
  weeks: z.coerce.number().int().min(1).max(12),
  week_phases: z.array(z.object({ week: z.coerce.number().int().min(1).max(12), phase: z.string().trim().max(60) })).max(12).catch([]),
  deload_rule: z.string().trim().max(400).nullish(),
  progression_rules: z.array(z.string().trim().max(400)).max(10).catch([]),
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
