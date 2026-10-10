/**
 * Cleo's program building blocks: a prescription as she writes it, how it
 * lands on a pl_exercise_rows row (the way the program editor stores it), how
 * it reads on a card, and which dates a new block's days fall on. Pure.
 */
import { z } from "zod";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One exercise's prescription. Every field optional so an edit can change just one. */
export const rxSchema = z.object({
  sets: z.number().int().min(1).max(20).optional(),
  reps: z.string().trim().min(1).max(30).optional().describe('Reps as written on the program: "5", "8-10", "AMRAP", "3x3 cluster".'),
  rpe: z.string().trim().max(10).optional().describe('Target RPE, e.g. "7" or "7-8". Use RPE or RIR, not both.'),
  rir: z.string().trim().max(10).optional().describe('Reps in reserve, e.g. "2" or "1-2".'),
  load: z.number().positive().max(2000).optional().describe("A fixed load, in load_unit."),
  load_unit: z.enum(["kg", "lb"]).optional(),
  percentage: z.number().min(1).max(120).optional().describe("Load as % of the basis (only for lifts with a max on file)."),
  percentage_of: z.enum(["1rm", "training_max", "est_1rm"]).optional(),
  rest_seconds: z.number().int().min(0).max(900).optional(),
  tempo: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional().describe("Coaching cue the client sees on this exercise."),
});
export type Rx = z.infer<typeof rxSchema>;

/** The pl_exercise_rows columns a prescription sets (only the fields given). */
export function rxToRow(rx: Rx): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (rx.sets !== undefined) row.sets = rx.sets;
  if (rx.reps !== undefined) row.reps_text = rx.reps;
  if (rx.rpe !== undefined) row.rpe = rx.rpe;
  if (rx.rir !== undefined) row.rir = rx.rir;
  if (rx.load !== undefined) {
    // Like the editor: the load lives in the row's own unit only.
    const unit = rx.load_unit ?? "lb";
    row.load_unit = unit;
    row.load_kg = unit === "kg" ? rx.load : null;
    row.load_lb = unit === "lb" ? rx.load : null;
    row.percentage = null;
    row.percentage_basis = "manual";
  } else if (rx.percentage !== undefined) {
    row.percentage = rx.percentage;
    row.percentage_basis = rx.percentage_of ?? "1rm";
    row.load_kg = null;
    row.load_lb = null;
    row.manual_override = false;
  }
  if (rx.rest_seconds !== undefined) {
    row.rest_seconds = rx.rest_seconds;
    row.rest_seconds_override = rx.rest_seconds;
  }
  if (rx.tempo !== undefined) row.tempo = rx.tempo;
  if (rx.notes !== undefined) row.notes = rx.notes;
  return row;
}

/** "4 x 6-8 @RPE 8, 225 lb, rest 2:30" */
export function rxText(rx: Rx | Record<string, any>): string {
  const r: any = rx;
  const sets = r.sets ?? null;
  const reps = r.reps ?? r.reps_text ?? null;
  const head = sets && reps ? `${sets} x ${reps}` : sets ? `${sets} sets` : reps ? `${reps} reps` : "";
  const effort = r.rpe ? `@RPE ${r.rpe}` : r.rir ? `@${r.rir} RIR` : "";
  const unit = r.load_unit ?? (r.load_kg != null && r.load_lb == null ? "kg" : "lb");
  const fixed = r.load ?? (unit === "kg" ? r.load_kg : r.load_lb) ?? null;
  const load = fixed != null ? `${fixed} ${unit}` : r.percentage != null ? `${r.percentage}% ${r.percentage_of ?? r.percentage_basis ?? "1rm"}` : "";
  const rest = r.rest_seconds != null ? `rest ${Math.floor(r.rest_seconds / 60)}:${String(r.rest_seconds % 60).padStart(2, "0")}` : "";
  const parts = [[head, effort].filter(Boolean).join(" "), load, rest, r.tempo ? `tempo ${r.tempo}` : ""].filter(Boolean);
  return parts.join(", ") + (r.notes ? ` ("${String(r.notes).slice(0, 80)}")` : "");
}

const DAY_MS = 86_400_000;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function weekdayOf(iso: string): Weekday {
  // getUTCDay: 0 = Sunday
  return WEEKDAYS[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
}

/**
 * Dates for one week of a block that starts on `startDate`: the i-th workout
 * falls on the i-th training weekday counted from that week's first day.
 * `week` is 1-based. Returns one date per training day, in order.
 */
export function trainingDayDates(startDate: string, week: number, trainingDays: readonly Weekday[]): string[] {
  const weekStart = addDays(startDate, (week - 1) * 7);
  const wanted = new Set(trainingDays);
  const out: string[] = [];
  for (let i = 0; i < 7 && out.length < trainingDays.length; i++) {
    const d = addDays(weekStart, i);
    if (wanted.has(weekdayOf(d))) out.push(d);
  }
  return out;
}

export function weekdayLabel(d: Weekday): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}
