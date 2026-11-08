/**
 * The edit language: what the model may ask for, as schema-checked JSON.
 * Every operation names records by their ref ("B1W3D2E4" an exercise,
 * "B1W3D2" a workout, "B1W3" a week) and exercises by catalog code ("X12")
 * or library name; the server resolves both and refuses anything else.
 */
import { z } from "zod";

export const ROW_REF = /^B\d+W\d+D\d+E\d+$/;
export const DAY_REF = /^B\d+W\d+D\d+$/;
export const WEEK_REF = /^B\d+W\d+$/;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const upper = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase() : v);
const rowRef = z.preprocess(upper, z.string().regex(ROW_REF, "an exercise ref looks like B1W3D2E4"));
const dayRef = z.preprocess(upper, z.string().regex(DAY_REF, "a workout ref looks like B1W3D2"));
const weekRef = z.preprocess(upper, z.string().regex(WEEK_REF, "a week ref looks like B1W3"));
const weekday = z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().slice(0, 3) : v), z.enum(WEEKDAYS));
const exerciseRef = z.string().trim().min(2).max(120);
const text = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).trim()).pipe(z.string().max(max));
const effort = z.union([z.string(), z.number()]).transform((v) => String(v).replace(/^@/, "").trim()).pipe(z.string().min(1).max(10));

/** Field names the model sometimes uses for the same thing. */
const ALIASES: Record<string, string> = {
  reps_text: "reps",
  rest: "rest_seconds",
  rest_s: "rest_seconds",
  rest_sec: "rest_seconds",
  pct: "percentage",
  percent: "percentage",
  weight: "load",
  unit: "load_unit",
  note: "notes",
  cue: "notes",
};

/** A prescription change: only the fields given change. Setting RPE clears RIR (and the other way), a % clears a fixed load. */
export const rxPatchSchema = z.preprocess(
  (v) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return v;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null) continue;
      out[ALIASES[k] ?? k] = val;
    }
    return out;
  },
  z
    .object({
      sets: z.coerce.number().int().min(1).max(20).optional(),
      reps: text(30).pipe(z.string().min(1)).optional(),
      rpe: effort.optional(),
      rir: effort.optional(),
      percentage: z.coerce.number().min(1).max(150).optional(),
      percentage_of: z.enum(["1rm", "training_max", "est_1rm"]).optional(),
      load: z.coerce.number().positive().max(2000).optional(),
      load_unit: z.enum(["kg", "lb"]).optional(),
      rest_seconds: z.coerce.number().int().min(0).max(1800).optional(),
      tempo: text(20).optional(),
      notes: text(500).optional(),
      clear: z.array(z.enum(["rpe", "rir", "percentage", "load", "tempo", "notes", "rest"])).max(7).optional(),
    })
    .strict(),
);
export type RxPatch = z.infer<typeof rxPatchSchema>;

const refs = <T extends z.ZodTypeAny>(t: T, max: number) => z.array(t).min(1).max(max);

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("update"), rows: refs(rowRef, 500), set: rxPatchSchema }).strict(),
  z.object({ op: z.literal("swap"), rows: refs(rowRef, 500), exercise: exerciseRef, set: rxPatchSchema.optional() }).strict(),
  z.object({ op: z.literal("add"), days: refs(dayRef, 300), exercise: exerciseRef, position: z.coerce.number().int().min(1).max(40).optional(), set: rxPatchSchema }).strict(),
  z.object({ op: z.literal("remove"), rows: refs(rowRef, 500) }).strict(),
  z.object({ op: z.literal("move"), rows: refs(rowRef, 300), position: z.coerce.number().int().min(1).max(40) }).strict(),
  z.object({ op: z.literal("rename_day"), days: refs(dayRef, 300), name: text(80).optional(), focus: text(120).optional() }).strict(),
  z
    .object({
      op: z.literal("add_day"),
      weeks: refs(weekRef, 60),
      name: text(80).pipe(z.string().min(1)),
      focus: text(120).optional(),
      exercises: z.array(z.object({ exercise: exerciseRef, set: rxPatchSchema }).strict()).min(1).max(15),
    })
    .strict(),
  z.object({ op: z.literal("remove_day"), days: refs(dayRef, 300) }).strict(),
  z.object({ op: z.literal("schedule"), training_days: z.array(weekday).min(1).max(7).optional(), redate: z.boolean().default(true) }).strict(),
]);
export type EditOp = z.infer<typeof opSchema>;

export const BASES = ["requested", "data", "speculative"] as const;

export const changeSchema = z
  .object({
    id: z.preprocess((v) => (typeof v === "number" ? `c${v}` : v), z.string().trim().min(1).max(16)),
    title: text(140).pipe(z.string().min(1)),
    why: text(700).default(""),
    basis: z.enum(BASES),
    evidence: z.array(text(240)).max(6).default([]),
    ops: z.array(opSchema).min(1).max(80),
  })
  .strict();
export type EditChange = z.infer<typeof changeSchema>;

export const RULE_KINDS = ["hard_constraint", "coach_preference", "client_preference", "temporary_restriction"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

export const replySchema = z
  .object({
    intent: z.enum(["edit", "question", "generate"]),
    answer: text(5000).default(""),
    analysis: z.array(z.object({ text: text(400).pipe(z.string().min(1)), kind: z.enum(["fact", "estimate", "hypothesis"]) }).strict()).max(10).default([]),
    drop: z.array(z.string().trim().max(16)).max(80).default([]),
    changes: z.array(changeSchema).max(40).default([]),
    generate: z
      .object({
        weeks: z.coerce.number().int().min(1).max(52).optional(),
        days_per_week: z.coerce.number().int().min(1).max(7).optional(),
        notes: text(2000).default(""),
      })
      .strict()
      .nullish(),
    remember: z.array(z.object({ kind: z.enum(RULE_KINDS), rule: text(300).pipe(z.string().min(3)), why: text(300).default("") }).strict()).max(4).default([]),
    questions: z.array(text(300)).max(3).default([]),
  })
  .strict();
export type EditReply = z.infer<typeof replySchema>;

/** The model's JSON (it may wrap it in a code fence or add a line before it). */
export function parseReply(raw: string): { ok: true; value: EditReply } | { ok: false; error: string } {
  const s = raw.trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "The reply had no JSON object." };
  let json: unknown;
  try {
    json = JSON.parse(s.slice(start, end + 1));
  } catch (e: any) {
    return { ok: false, error: `The JSON didn't parse: ${String(e?.message ?? e).slice(0, 160)}` };
  }
  const r = replySchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    error: r.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "reply"}: ${i.message}`)
      .join("; "),
  };
}

/** "B1W3D2E4" → its parts. */
export function parseRef(ref: string): { block: number; week?: number; day?: number; row?: number } | null {
  const m = /^B(\d+)(?:W(\d+)(?:D(\d+)(?:E(\d+))?)?)?$/.exec(ref.trim().toUpperCase());
  if (!m) return null;
  return { block: +m[1], week: m[2] ? +m[2] : undefined, day: m[3] ? +m[3] : undefined, row: m[4] ? +m[4] : undefined };
}
