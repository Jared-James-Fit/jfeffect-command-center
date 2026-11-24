/**
 * What changed in a client's plan, how big a change it was, and when its
 * effect can be judged (Nov 24 2026). Pure and tested (plan-changes.test.ts);
 * the quality reads keep each plan's last-seen shape in
 * `plan_quality_baselines` (plan-changes.server.ts) and log the differences
 * here, so a change made anywhere (the builder, Adjust program, Adjust plan,
 * the cardio builder, a published Nutrition Update) is noticed.
 *
 *   Fingerprint   the parts of a plan that matter for its results: training
 *                 rows still to train, nutrition days' numbers and meals,
 *                 cardio sessions. Trained or past training rows are never a
 *                 change (they drop out of what's left, they aren't removed).
 *   Change        an area ("calories", "exercises", "cardio dose"…) and a size:
 *                 substantial changes what the plan asks for results-wise
 *                 (calories by 5% or 100 kcal, three or more exercises swapped,
 *                 added or removed, a fifth of the rows re-dosed, a session's
 *                 minutes by 15%…); anything smaller is minor. A minor edit
 *                 never restarts the evaluation of the plan.
 *   Window        each change is judged after its own window, by area: meals
 *                 or cardio placement in a week, macros, steps or training
 *                 tweaks in one to two weeks, calories and cardio dose on a
 *                 four-week bodyweight trend, a new program on three weeks of
 *                 logged strength; shorter near a meet or in a taper (decisions
 *                 can't wait four weeks), shorter with daily weigh-ins (the
 *                 trend reads sooner), longer with sparse ones.
 *
 * A planned next block of the same program is not a change: it was decided
 * when the program was written. Safety concerns and significant negative
 * trends are said whatever the windows (plan-quality.ts).
 */
import { addDays } from "date-fns";
import type { QualityChange, QualityScore } from "@/lib/plan-quality";

export type ChangeDomain = "training" | "nutrition" | "cardio";
export type ChangeArea =
  | "program"
  | "exercises"
  | "dose"
  | "calories"
  | "macros"
  | "steps"
  | "meals"
  | "structure"
  | "cardio_dose"
  | "cardio_intensity"
  | "cardio_placement";
export type ChangeSize = "minor" | "substantial";

export type PlanChange = {
  domain: ChangeDomain;
  area: ChangeArea;
  size: ChangeSize;
  /** One line: what changed ("Calories −250 a day", "3 exercises swapped"). */
  summary: string;
  /** When it takes effect (YYYY-MM-DD): the day it was made, or later when it starts later. */
  on: string;
  /** Seen only as "it was edited" (before the log existed): listed, never holds a read. */
  unknown?: boolean;
};

/** A plan's shape, by item: a training row, a nutrition day, a cardio session. */
export type Fingerprint = { v: 1; items: Record<string, Record<string, string | number | boolean | null>> };

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v).trim().toLowerCase());

/** A short, stable hash of text (meal plans), so a changed menu is seen without keeping it. */
export function textHash(s: string | null | undefined): string | null {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/* ─────────────────────────────── fingerprints ─────────────────────────────── */

export type TrainingRowIn = {
  id: string;
  exercise_id?: string | null;
  exercise_name_override?: string | null;
  sets?: unknown;
  reps_text?: unknown;
  rpe?: unknown;
  rir?: unknown;
  load_kg?: unknown;
  percentage?: unknown;
  duration_seconds?: unknown;
};

/**
 * Training: every row of the live program with whether it's still to train (`open`) and the
 * date its workout lands on. A row that becomes trained or past is never a removal.
 */
export function trainingFingerprint(rows: Array<TrainingRowIn & { open: boolean; date: string | null; dayId: string }>): Fingerprint {
  const items: Fingerprint["items"] = {};
  for (const r of rows) {
    items[r.id] = {
      ex: r.exercise_id ?? str(r.exercise_name_override),
      sets: num(r.sets),
      reps: str(r.reps_text),
      rpe: str(r.rpe),
      rir: str(r.rir),
      load: num(r.load_kg),
      pct: num(r.percentage),
      secs: num(r.duration_seconds),
      open: r.open,
      date: r.date,
      day: r.dayId,
    };
  }
  return { v: 1, items };
}

export type NutritionDayFp = { label: string; kcal: unknown; protein: unknown; carbs: unknown; fats: unknown; steps?: unknown; notes?: string | null };

/** Nutrition: each day type's numbers and a hash of its meals, under the plan it belongs to. */
export function nutritionFingerprint(planId: string, startDate: string | null, days: NutritionDayFp[]): Fingerprint {
  const items: Fingerprint["items"] = { _plan: { id: planId, start: startDate } };
  for (const d of days) {
    items[`day:${String(d.label).trim().toLowerCase()}`] = {
      label: d.label,
      kcal: num(d.kcal),
      p: num(d.protein),
      c: num(d.carbs),
      f: num(d.fats),
      steps: num(d.steps),
      meals: textHash(d.notes),
    };
  }
  return { v: 1, items };
}

export type CardioSessionFp = { key: string; enabled?: boolean; modality?: string | null; minutes?: unknown; days?: string[] | string | null; rpeMin?: unknown; rpeMax?: unknown; incline?: unknown; speed?: unknown; timing?: string | null; title?: string | null };

/** Cardio: each enabled session's dose, intensity and placement. */
export function cardioFingerprint(sessions: CardioSessionFp[], effectiveOn?: string | null): Fingerprint {
  const items: Fingerprint["items"] = { _plan: { effective: effectiveOn ?? null } };
  for (const s of sessions) {
    if (s.enabled === false) continue;
    items[`s:${s.key}`] = {
      title: s.title ?? s.modality ?? "Session",
      modality: str(s.modality),
      minutes: num(s.minutes),
      days: Array.isArray(s.days) ? s.days.slice().sort().join(",") : str(s.days),
      rpe: `${num(s.rpeMin) ?? ""}-${num(s.rpeMax) ?? ""}`,
      incline: num(s.incline),
      speed: num(s.speed),
      timing: str(s.timing),
    };
  }
  return { v: 1, items };
}

/* ─────────────────────────────── diffs ─────────────────────────────── */

const rel = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? Math.abs(b - a) / a : 0);
const later = (a: string, b: string | null) => (b && b > a ? b : a);

/** Training: swaps, additions and removals among rows still to train, and re-dosed rows. */
export function diffTraining(prev: Fingerprint, next: Fingerprint, today: string): PlanChange[] {
  let swapped = 0;
  let added = 0;
  let removed = 0;
  let dosed = 0;
  let compared = 0;
  const newDays = new Set<string>();
  const knownDays = new Set(Object.values(prev.items).map((r) => String(r.day)));
  let firstDate: string | null = null;
  const touch = (d: unknown) => {
    const s = typeof d === "string" ? d : null;
    if (s && s >= today && (!firstDate || s < firstDate)) firstDate = s;
  };
  for (const [id, n] of Object.entries(next.items)) {
    const p = prev.items[id];
    if (!n.open) continue;
    if (!p) {
      added++;
      if (!knownDays.has(String(n.day))) newDays.add(String(n.day));
      touch(n.date);
      continue;
    }
    if (!p.open) continue;
    compared++;
    if (p.ex !== n.ex) {
      swapped++;
      touch(n.date);
      continue;
    }
    if (["sets", "reps", "rpe", "rir", "load", "pct", "secs"].some((k) => p[k] !== n[k])) {
      dosed++;
      touch(n.date);
    }
  }
  for (const [id, p] of Object.entries(prev.items)) {
    if (p.open && !next.items[id]) {
      removed++;
      touch(p.date);
    }
  }
  if (!swapped && !added && !removed && !dosed) return [];
  const on = later(today, firstDate);
  const out: PlanChange[] = [];
  // a program's worth of new workouts is a new program (it takes effect when they start)
  if (newDays.size >= 3 && added >= 10) {
    out.push({ domain: "training", area: "program", size: "substantial", summary: `A new program or block was added (${newDays.size} workouts)`, on });
    return out;
  }
  const selection = swapped + added + removed;
  if (selection) {
    const parts = [swapped && `${swapped} swapped`, added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(", ");
    out.push({ domain: "training", area: "exercises", size: selection >= 3 || newDays.size > 0 ? "substantial" : "minor", summary: `Exercises: ${parts}`, on });
  }
  if (dosed) {
    const share = compared ? dosed / compared : 1;
    out.push({ domain: "training", area: "dose", size: share >= 0.2 && dosed >= 4 ? "substantial" : "minor", summary: `Sets, reps or loads changed on ${dosed} exercise${dosed === 1 ? "" : "s"}`, on });
  }
  return out;
}

const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(Math.round(n))}`;

/** Nutrition: calories (substantial at 5% or 100 kcal), macros, steps, meals, day types added or removed. */
export function diffNutrition(prev: Fingerprint, next: Fingerprint, today: string): PlanChange[] {
  const start = (next.items._plan?.start as string | null) ?? null;
  const on = later(today, start);
  const days = (fp: Fingerprint) => Object.keys(fp.items).filter((k) => k.startsWith("day:"));
  const pd = new Set(days(prev));
  const nd = new Set(days(next));
  const out: PlanChange[] = [];
  const addedDays = [...nd].filter((d) => !pd.has(d)).map((d) => String(next.items[d].label));
  const removedDays = [...pd].filter((d) => !nd.has(d)).map((d) => String(prev.items[d].label));
  if (addedDays.length || removedDays.length)
    out.push({
      domain: "nutrition",
      area: "structure",
      size: "substantial",
      summary: [addedDays.length && `Added ${addedDays.join(", ")}`, removedDays.length && `removed ${removedDays.join(", ")}`].filter(Boolean).join("; "),
      on,
    });
  const kcalBig: string[] = [];
  const deltas: number[] = [];
  let macro = 0;
  let protein = 0;
  let steps = 0;
  let meals = 0;
  for (const d of nd) {
    if (!pd.has(d)) continue;
    const a = prev.items[d];
    const b = next.items[d];
    const ka = num(a.kcal);
    const kb = num(b.kcal);
    if (ka != null && kb != null && ka !== kb) {
      deltas.push(kb - ka);
      if (Math.abs(kb - ka) >= 25) kcalBig.push(`${String(b.label)} ${signed(kb - ka)} kcal`);
    }
    const dp = Math.abs((num(b.p) ?? 0) - (num(a.p) ?? 0));
    const dc = Math.abs((num(b.c) ?? 0) - (num(a.c) ?? 0));
    const df = Math.abs((num(b.f) ?? 0) - (num(a.f) ?? 0));
    if (dp >= 20) protein++;
    if (dp >= 10 || dc >= 25 || df >= 8) macro++;
    if (Math.abs((num(b.steps) ?? 0) - (num(a.steps) ?? 0)) >= 2000) steps++;
    if (a.meals !== b.meals) meals++;
  }
  if (deltas.length) {
    // across their day types (unchanged ones count as 0): a step of 150+ kcal, 6%, or one day moved 250+
    const shared = [...nd].filter((d) => pd.has(d)).length || 1;
    const mean = deltas.reduce((x, y) => x + y, 0) / shared;
    const base = [...pd].map((d) => num(prev.items[d].kcal)).filter((n): n is number => n != null && n > 0);
    const avgBase = base.length ? base.reduce((x, y) => x + y, 0) / base.length : 0;
    const big = Math.abs(mean) >= 150 || (avgBase > 0 && Math.abs(mean) / avgBase >= 0.06) || deltas.some((d) => Math.abs(d) >= 250);
    out.push({ domain: "nutrition", area: "calories", size: big ? "substantial" : "minor", summary: kcalBig.length ? `Calories: ${kcalBig.join(", ")}` : "Calories nudged (under 25 kcal)", on });
  }
  if (macro)
    out.push({ domain: "nutrition", area: "macros", size: protein ? "substantial" : "minor", summary: protein ? "Protein changed by 20 g or more" : "Macros adjusted within the same calories", on });
  if (steps) out.push({ domain: "nutrition", area: "steps", size: "minor", summary: "Daily step targets changed", on });
  if (meals) out.push({ domain: "nutrition", area: "meals", size: "minor", summary: `Meals changed on ${meals} day type${meals === 1 ? "" : "s"}`, on });
  return out;
}

/** Cardio: weekly minutes or sessions (substantial at 15%), intensity, and placement. */
export function diffCardio(prev: Fingerprint, next: Fingerprint, today: string): PlanChange[] {
  const eff = (next.items._plan?.effective as string | null) ?? null;
  const on = later(today, eff);
  const sessions = (fp: Fingerprint) => Object.keys(fp.items).filter((k) => k.startsWith("s:"));
  const weekly = (fp: Fingerprint) =>
    sessions(fp).reduce((a, k) => {
      const s = fp.items[k];
      const days = String(s.days ?? "").split(",").filter(Boolean).length || 1;
      return a + (num(s.minutes) ?? 0) * days;
    }, 0);
  const ps = new Set(sessions(prev));
  const ns = new Set(sessions(next));
  const added = [...ns].filter((k) => !ps.has(k)).length;
  const removed = [...ps].filter((k) => !ns.has(k)).length;
  const wa = weekly(prev);
  const wb = weekly(next);
  const out: PlanChange[] = [];
  if (added || removed || rel(wa, wb) >= 0.15 || (wa === 0) !== (wb === 0)) {
    out.push({ domain: "cardio", area: "cardio_dose", size: "substantial", summary: `Weekly cardio ${Math.round(wa)} → ${Math.round(wb)} min${added || removed ? ` (${[added && `${added} added`, removed && `${removed} removed`].filter(Boolean).join(", ")})` : ""}`, on });
  } else if (wa !== wb) out.push({ domain: "cardio", area: "cardio_dose", size: "minor", summary: `Weekly cardio ${Math.round(wa)} → ${Math.round(wb)} min`, on });
  let intensity = 0;
  let placement = 0;
  for (const k of ns) {
    if (!ps.has(k)) continue;
    const a = prev.items[k];
    const b = next.items[k];
    if (a.rpe !== b.rpe || a.incline !== b.incline || a.speed !== b.speed || a.modality !== b.modality) intensity++;
    if (a.days !== b.days || a.timing !== b.timing) placement++;
  }
  if (intensity) out.push({ domain: "cardio", area: "cardio_intensity", size: "minor", summary: `Intensity or type changed on ${intensity} session${intensity === 1 ? "" : "s"}`, on });
  if (placement) out.push({ domain: "cardio", area: "cardio_placement", size: "minor", summary: `Days or timing changed on ${placement} session${placement === 1 ? "" : "s"}`, on });
  return out;
}

export function diffFingerprints(domain: ChangeDomain, prev: Fingerprint, next: Fingerprint, today: string): PlanChange[] {
  if (domain === "training") return diffTraining(prev, next, today);
  if (domain === "nutrition") return diffNutrition(prev, next, today);
  return diffCardio(prev, next, today);
}

/** Whether anything that matters moved (so the baseline is only written when it did). */
export function sameFingerprint(a: Fingerprint | null | undefined, b: Fingerprint): boolean {
  return !!a && JSON.stringify(a.items) === JSON.stringify(b.items);
}

/* ─────────────────────────────── windows ─────────────────────────────── */

/** The areas whose effect shows in results (bodyweight, logged strength): only these hold the verdict. */
export const RESULTS_AREAS: Record<ChangeDomain, ChangeArea[]> = {
  training: ["program", "exercises", "dose"],
  nutrition: ["calories", "structure", "macros"],
  cardio: ["cardio_dose"],
};

/** How long each kind of change takes to show (days), before context. */
export const BASE_WINDOW: Record<ChangeArea, Record<ChangeSize, number>> = {
  program: { substantial: 21, minor: 21 },
  exercises: { substantial: 21, minor: 10 },
  dose: { substantial: 14, minor: 7 },
  calories: { substantial: 28, minor: 14 },
  structure: { substantial: 28, minor: 14 },
  macros: { substantial: 14, minor: 10 },
  steps: { substantial: 14, minor: 14 },
  meals: { substantial: 7, minor: 7 },
  cardio_dose: { substantial: 28, minor: 14 },
  cardio_intensity: { substantial: 14, minor: 14 },
  cardio_placement: { substantial: 7, minor: 7 },
};

export type WindowContext = {
  /** Weeks to their next meet or show. */
  meetWeeksOut?: number | null;
  /** The training phase they're in (a taper or peak can't wait weeks). */
  phase?: "taper" | "peak" | "deload" | "accumulation" | "intensification" | "other" | null;
  /** Weigh-ins in the last 14 days (bodyweight reads sooner with more). */
  weighIns14?: number | null;
  /** Workouts they train a week (strength reads sooner with more). */
  sessionsPerWeek?: number | null;
};

const BODYWEIGHT_AREAS = new Set<ChangeArea>(["calories", "structure", "cardio_dose"]);
const TRAINING_AREAS = new Set<ChangeArea>(["program", "exercises", "dose"]);

/** A change's own window, adjusted for this client, with why when it isn't the default. */
export function windowFor(domain: ChangeDomain, c: Pick<PlanChange, "area" | "size">, ctx: WindowContext = {}): { days: number; why: string | null } {
  let days = BASE_WINDOW[c.area][c.size];
  let why: string | null = null;
  if (BODYWEIGHT_AREAS.has(c.area) && ctx.weighIns14 != null) {
    if (ctx.weighIns14 >= 10 && days > 21) {
      days = 21;
      why = "daily weigh-ins show the trend sooner";
    } else if (ctx.weighIns14 < 4) {
      days += 7;
      why = "few weigh-ins, so the trend takes longer to read";
    }
  }
  if (TRAINING_AREAS.has(c.area) && ctx.sessionsPerWeek != null) {
    if (ctx.sessionsPerWeek >= 4 && days > 14) {
      days = 14;
      why = `${Math.round(ctx.sessionsPerWeek)} workouts a week show it sooner`;
    } else if (ctx.sessionsPerWeek > 0 && ctx.sessionsPerWeek <= 2 && days >= 14) {
      days += 7;
      why = `${Math.round(ctx.sessionsPerWeek)} workouts a week take longer to show it`;
    }
  }
  const meet = ctx.meetWeeksOut;
  if (meet != null && meet >= 0 && meet <= 4) {
    const cap = domain === "training" ? 7 : 10;
    if (days > cap) {
      days = cap;
      const w = Math.max(1, Math.round(meet));
      why = `a meet in ${w} week${w === 1 ? "" : "s"} can't wait longer`;
    }
  } else if (meet != null && meet > 4 && meet <= 8 && days > 14) {
    days = 14;
    why = `a meet in ${Math.round(meet)} weeks`;
  }
  if ((ctx.phase === "taper" || ctx.phase === "peak") && TRAINING_AREAS.has(c.area) && days > 7) {
    days = 7;
    why = `a ${ctx.phase} changes week to week`;
  }
  return { days, why };
}

export type EvaluatedChange = PlanChange & {
  window: number;
  /** Days since it took effect (0 for one still to start). */
  daysIn: number;
  /** When its effect can be judged (YYYY-MM-DD). */
  ready: string;
  why: string | null;
  /** Still inside its window (or not started yet). */
  settling: boolean;
  /** Holds the plan's verdict: a substantial change in a results area, still settling. */
  holds: boolean;
};

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const plusDays = (iso: string, n: number) => addDays(new Date(`${iso}T00:00:00Z`), n).toISOString().slice(0, 10);

/**
 * Each recent change with its own window and whether it's still settling. Only a substantial change
 * in a results area holds the plan's verdict ("give it time"); a minor one is listed and judged on
 * its own, never restarting the plan's evaluation. Changes long past their window drop off.
 */
export function evaluateChanges(domain: ChangeDomain, changes: PlanChange[], today: string, ctx: WindowContext = {}): EvaluatedChange[] {
  const seen = new Set<string>();
  return changes
    .filter((c) => c.domain === domain)
    .filter((c) => {
      const k = `${c.area}|${c.on}|${c.summary}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((c) => {
      const { days, why } = windowFor(domain, c, ctx);
      const daysIn = Math.max(0, dayDiff(c.on, today));
      const settling = c.on > today || daysIn < days;
      return { ...c, window: days, daysIn, ready: plusDays(c.on, days), why, settling, holds: settling && !c.unknown && c.on <= today && c.size === "substantial" && RESULTS_AREAS[domain].includes(c.area) };
    })
    .filter((c) => c.settling || c.daysIn < c.window + 14)
    .sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/**
 * The plan's settling read: the substantial change whose effect is furthest off; else a minor
 * adjustment in a results area still inside its own window (`minor`: the plan's design is read as
 * usual, only its results wait for that adjustment); else null.
 */
export function settlingFrom(evaluated: EvaluatedChange[], domain?: ChangeDomain): { days: number; window: number; ready: string; why: string | null; what: string; area: ChangeArea; minor: boolean } | null {
  const holding = evaluated.filter((c) => c.holds).sort((a, b) => (a.ready < b.ready ? 1 : -1))[0];
  if (holding) return { days: holding.daysIn, window: holding.window, ready: holding.ready, why: holding.why, what: holding.summary, area: holding.area, minor: false };
  const adjusting = evaluated
    .filter((c) => c.settling && !c.unknown && c.daysIn >= 0 && c.size === "minor" && (!domain || RESULTS_AREAS[domain].includes(c.area)) && c.daysIn < c.window && c.on <= c.ready)
    .sort((a, b) => (a.ready < b.ready ? 1 : -1))[0];
  return adjusting ? { days: adjusting.daysIn, window: adjusting.window, ready: adjusting.ready, why: adjusting.why, what: adjusting.summary, area: adjusting.area, minor: true } : null;
}

/** Keep the log short: the last 90 days, newest first, at most 16. */
export function trimChanges(changes: PlanChange[], today: string): PlanChange[] {
  const since = plusDays(today, -90);
  return changes
    .filter((c) => c.on >= since)
    .sort((a, b) => (a.on < b.on ? 1 : -1))
    .slice(0, 16);
}

/* ─────────────────────────── changes from known sources ─────────────────────────── */

type ProgramOp = { op: string; rows?: unknown[]; days?: unknown[] };

/** An applied Adjust program change, sized by what its applied operations touched. */
export function programEditChanges(result: { changes?: Array<{ id: string; title?: string; ops?: ProgramOp[] }> } | null, applied: string[] | null, on: string): PlanChange[] {
  const picked = (result?.changes ?? []).filter((c) => !applied?.length || applied.includes(c.id));
  if (!picked.length) return [];
  let selection = 0;
  let dose = 0;
  let structure = 0;
  let placement = 0;
  for (const c of picked)
    for (const o of c.ops ?? []) {
      const n = Math.max(1, (o.rows?.length ?? 0) || (o.days?.length ?? 0));
      if (o.op === "swap" || o.op === "add" || o.op === "remove") selection += n;
      else if (o.op === "update") dose += n;
      else if (o.op === "add_day" || o.op === "remove_day") structure += n;
      else if (o.op === "schedule" || o.op === "move") placement += n;
    }
  const titles = picked.map((c) => c.title).filter(Boolean).slice(0, 2).join("; ");
  const out: PlanChange[] = [];
  if (structure) out.push({ domain: "training", area: "program", size: "substantial", summary: `Workouts added or removed${titles ? ` (${titles})` : ""}`, on });
  if (selection) out.push({ domain: "training", area: "exercises", size: selection >= 3 ? "substantial" : "minor", summary: titles || `${selection} exercise change${selection === 1 ? "" : "s"}`, on });
  if (dose) out.push({ domain: "training", area: "dose", size: dose >= 6 ? "substantial" : "minor", summary: titles || `Sets, reps or loads changed on ${dose} exercise${dose === 1 ? "" : "s"}`, on });
  if (!out.length && placement) out.push({ domain: "training", area: "exercises", size: "minor", summary: titles || "Order or days changed", on });
  return out;
}

/** A new nutrition plan against the one before (or a fresh start when there was none). */
export function newNutritionPlanChanges(prev: { id: string; start: string | null; days: NutritionDayFp[] } | null, next: { id: string; start: string | null; days: NutritionDayFp[] }, today: string): PlanChange[] {
  const on = next.start && next.start <= today ? next.start : today;
  if (!prev) return [{ domain: "nutrition", area: "calories", size: "substantial", summary: "First nutrition plan", on }];
  const diff = diffNutrition(nutritionFingerprint(prev.id, null, prev.days), nutritionFingerprint(next.id, null, next.days), on).map((c) => ({ ...c, on }));
  // a new plan with the same numbers and meals (a re-publish, new dates) is no change
  return diff;
}

/**
 * Cardio sessions as fingerprint items, matched by what they are (kind and day rule), never by row id:
 * publishing a changed session ends its row and starts a new one, which is a tweak, not a new session.
 */
export function cardioSlots(sessions: Array<{ modality?: string | null; days?: string | null; weekdays?: string[] | null; minutes?: unknown; rpeMin?: unknown; rpeMax?: unknown; incline?: unknown; speedMinMph?: unknown; timing?: string | null; enabled?: boolean; name?: string | null }>): CardioSessionFp[] {
  const n = new Map<string, number>();
  return (sessions ?? [])
    .filter((x) => x && x.enabled !== false)
    .map((x) => {
      const base = `${x.modality ?? "session"}|${x.days ?? "custom"}`;
      const i = (n.get(base) ?? 0) + 1;
      n.set(base, i);
      return { key: `${base}|${i}`, modality: x.modality ?? null, minutes: x.minutes, days: x.weekdays ?? null, rpeMin: x.rpeMin, rpeMax: x.rpeMax, incline: x.incline, speed: x.speedMinMph, timing: x.timing ?? null, title: x.name ?? x.modality ?? null };
    });
}

/** Consecutive cardio versions, as changes (the first version is a start). */
export function cardioVersionChanges(versions: Array<{ effective_date: string; state: string; sessions: CardioSessionFp[] }>, today: string): PlanChange[] {
  const live = versions.filter((v) => v.state !== "replaced").sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
  const out: PlanChange[] = [];
  for (let i = 0; i < live.length; i++) {
    const on = live[i].effective_date;
    const next = cardioFingerprint(live[i].sessions, on);
    if (i === 0) {
      out.push({ domain: "cardio", area: "cardio_dose", size: "substantial", summary: "Cardio plan started", on });
      continue;
    }
    out.push(...diffCardio(cardioFingerprint(live[i - 1].sessions), next, on).map((c) => ({ ...c, on })));
  }
  return out.filter((c) => c.on <= plusDays(today, 60));
}

/** The quality read's view of the change log: each change for the list, and the plan's settling (or null). */
export function changeRead(domain: ChangeDomain, changes: PlanChange[], today: string, ctx: WindowContext = {}): { changes: QualityChange[]; settling: QualityScore["settling"] } {
  const evaluated = evaluateChanges(domain, changes, today, ctx);
  const s = settlingFrom(evaluated.filter((c) => c.on <= today), domain);
  return {
    changes: evaluated.slice(0, 8).map((c) => ({ summary: c.summary, size: c.size, on: c.on, ready: c.ready, settling: c.settling, holds: c.holds, why: c.why })),
    settling: s ? { days: s.days, window: s.window, ready: s.ready, why: s.why, what: s.what, minor: s.minor } : null,
  };
}
