import { logLoadInUnit } from "@/lib/workout-pr";
import type { PreviousLiftLog } from "@/lib/workout-previous-lift";

// ───────────────────────────────────────────────────────────────────────────
// RPE-based load suggestions ("what should I put on the bar for this set?").
//
// Model, in powerlifting terms:
//   1. Every logged working set is converted with the RTS RPE chart (%1RM as
//      a function of reps + reps in reserve) into "the load you'd use for the
//      target reps @ target RPE".
//   2. Athletes rate RPE on their own scale (±1 is normal, pre-filled values
//      often go unchanged), so the chart correction is only partly trusted and
//      sets at similar reps/RPE count most. The athlete's own sets anchor the
//      number; the chart bridges the gap.
//   3. Recent sessions dominate (3-day half-life, relative), so a program's
//      heavy/light weeks and real progress show up quickly.
//   4. History needs at least 2 sessions spanning a week before we suggest
//      anything cold. Until then the athlete sees "calibrating".
//   5. Once a set is logged TODAY, today's sets dominate (75%): the top set
//      calibrates the back-offs, like RPE-based autoregulation. This works even
//      for a brand-new exercise after its first set.
//   6. Predicted readiness (last review: session RPE, pain, sleep, recovery,
//      faded by time) and a layoff (>3 weeks) can only trim a cold suggestion.
//   7. The range is target RPE ±0.5 widened to the error measured on real
//      client logs, so most sets genuinely land inside it.
//   8. SBD lifts can take an optional FINAL WARM-UP (load × reps, optional RPE)
//      before the first working set. It is submaximal by design and RIR guesses
//      on an easy single/double are optimistic, so it is deliberately weak: its
//      RPE is floored at 6 (a claimed "easy" can never inflate the estimate), it
//      only nudges a history-based suggestion (+1.5% / −3% at most, so a heavy
//      warm-up backs you off more readily than an easy one pushes you up), and
//      with no history at all it gives a conservative first suggestion (−4%,
//      wider range). Once a working set is logged today, that set takes over.
// Backtested on ~2,800 real sets (scratch script, not shipped): median error
// 8% cold, 4.4% once today's first set is in.
// Pure: no I/O, fully unit tested.
// ───────────────────────────────────────────────────────────────────────────

/** RTS chart: %1RM at RPE 10 for 1..12 reps. */
const PCT_AT_RPE10 = [1.0, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68];
/** Effective reps (reps + RIR) beyond which the chart stops being predictive. */
const MAX_EFFECTIVE_REPS = 20;
const HALF_LIFE_DAYS = 3;
const HISTORY_WINDOW_DAYS = 56;
const MAX_SESSIONS = 8;
export const MIN_HISTORY_SESSIONS = 2;
export const MIN_HISTORY_SPAN_DAYS = 6;
const DAY_MS = 86_400_000;

/**
 * Lowest RPE used as evidence and as a target. Light prescriptions (RPE 4–5:
 * primers, technique work, pivot weeks) are planned at their real effort
 * instead of being bumped to RPE 6. Backtest on real logs: light-target error
 * 10.9% → 8.5% cold and 13.7% → 9.8% once a set is in; normal targets unchanged.
 */
export const MIN_RPE = 4;

/**
 * Bodyweight: strength scales with bodyweight^~0.67 (allometric scaling), so a
 * past set is adjusted by (bodyweight now / bodyweight then)^0.67. Uses the
 * smoothed (7-day) bodyweight to ignore daily water swings, and ignores ratios
 * outside ±12% (a unit slip, not a real change). Backtest: SBD in-range 43% → 45%
 * cold, error 3.0% → 2.9% once a set is in; nothing got worse. Tested and
 * rejected (no gain): projecting the block's e1RM trend forward, and a flat
 * calibration bump for SBD.
 */
export const BODYWEIGHT_EXPONENT = 0.67;
const BODYWEIGHT_MAX_RATIO_SHIFT = 0.12;

export function bodyweightScale(nowKg: number | null | undefined, thenKg: number | null | undefined): number {
  if (!(nowKg && nowKg > 0) || !(thenKg && thenKg > 0)) return 1;
  const r = nowKg / thenKg;
  if (Math.abs(r - 1) > BODYWEIGHT_MAX_RATIO_SHIFT) return 1;
  return Math.pow(r, BODYWEIGHT_EXPONENT);
}

/** Fraction of 1RM for `reps` performed with `rir` reps left in the tank. */
export function percentOf1RM(reps: number, rir: number): number | null {
  const e = reps + Math.max(0, rir);
  if (!Number.isFinite(e) || e < 1 || e > MAX_EFFECTIVE_REPS) return null;
  if (e <= PCT_AT_RPE10.length) {
    const lo = Math.floor(e);
    const hi = Math.ceil(e);
    const a = PCT_AT_RPE10[lo - 1];
    const b = PCT_AT_RPE10[hi - 1];
    return a + (b - a) * (e - lo);
  }
  // Past 12 reps, continue from the chart with an Epley-shaped tail.
  const n = PCT_AT_RPE10.length;
  return PCT_AT_RPE10[n - 1] * ((1 + n / 30) / (1 + e / 30));
}

export function parseRpe(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

/** Optional final warm-up before the first working set (SBD lifts). */
export interface WarmupSet {
  load: number; // in the model's unit
  reps: number;
  /** How hard it felt. Optional — a typical final warm-up is assumed when missing. */
  rpe?: number | string | null;
}
/** Assumed effort when the athlete doesn't say: a normal final warm-up. */
export const WARMUP_DEFAULT_RPE = 7;
/** Floor on warm-up RPE. Lower claims mean MORE reps in reserve, hence a bigger e1RM: never let "easy" inflate it. */
export const WARMUP_RPE_FLOOR = 6;
export const WARMUP_MAX_REPS = 8;
/** With history: the warm-up moves the suggestion by half its disagreement, clamped to −6% / +3% of it → −3% / +1.5%. */
export const WARMUP_NUDGE_DOWN = -0.06;
export const WARMUP_NUDGE_UP = 0.03;
export const WARMUP_NUDGE_WEIGHT = 0.5;
/** No history at all: trim the warm-up's own estimate, widen the range, never suggest > 1.25× the warm-up load. */
export const WARMUP_COLD_START_FACTOR = 0.96;
export const WARMUP_COLD_START_SPREAD = 0.08;
export const WARMUP_COLD_START_MAX_RATIO = 1.25;

/** Estimated 1RM implied by a final warm-up, or null when it can't be trusted. */
export function warmupE1rm(w: WarmupSet): number | null {
  if (!(w.load > 0) || !(w.reps >= 1) || w.reps > WARMUP_MAX_REPS) return null;
  const rpe = Math.min(10, Math.max(WARMUP_RPE_FLOOR, parseRpe(w.rpe ?? null) ?? WARMUP_DEFAULT_RPE));
  const pct = percentOf1RM(w.reps, 10 - rpe);
  return pct ? w.load / pct : null;
}

export interface SetSample {
  load: number; // in the model's unit
  reps: number;
  rpe: number | null;
}

/** RPE-adjusted e1RM for one set and how much to trust it (0..1). */
export function setE1rm(s: SetSample): { e1rm: number; trust: number } | null {
  if (!(s.load > 0) || !(s.reps >= 1) || s.reps > 15) return null;
  // Below RPE 4 is warm-up territory. RPE 4–6 counts, but its RIR guess is
  // weak, so it's trusted less (see below) and its own reps/RPE neighbours
  // dominate through the kernel.
  if (s.rpe != null && s.rpe < MIN_RPE) return null;
  const rpe = s.rpe ?? 8.5; // unlogged working sets: assume a typical hard set
  const pct = percentOf1RM(s.reps, 10 - rpe);
  if (!pct) return null;
  let trust = s.rpe != null ? 1 : 0.5;
  if (s.reps > 8) trust *= 0.75; // high-rep e1RMs drift
  if (s.rpe != null && s.rpe < 7) trust *= 0.7; // RIR 3+ is a guess
  return { e1rm: s.load / pct, trust };
}

export interface Readiness {
  /** ≤ 1. Applied to cold (history-only) suggestions. */
  multiplier: number;
  reasons: string[];
}

export const NEUTRAL_READINESS: Readiness = { multiplier: 1, reasons: [] };

export interface LastReviewSignal {
  submittedAt: string | null;
  /** Only trusted for v2 reviews (real session RPE, not the legacy mapping). */
  sessionRpe: number | null;
  pain: boolean;
  sleepBucket: string | null;
  recoveryToday: number | null;
}

/**
 * Predict today's readiness from the most recent workout review. Effects fade
 * as time passes: full within 48h, half up to 96h, gone after that.
 * Capped at -5% so one bad night can't wreck the session.
 */
export function predictReadiness(last: LastReviewSignal | null, now: Date = new Date()): Readiness {
  if (!last?.submittedAt) return NEUTRAL_READINESS;
  const hours = (now.getTime() - Date.parse(last.submittedAt)) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return NEUTRAL_READINESS;
  const fade = hours <= 48 ? 1 : hours <= 96 ? 0.5 : 0;
  if (fade === 0) return NEUTRAL_READINESS;
  let pct = 0;
  const reasons: string[] = [];
  if (last.pain) { pct += 3; reasons.push("pain last session"); }
  if (last.sessionRpe != null && last.sessionRpe >= 9.5) { pct += 2; reasons.push("max-effort last session"); }
  else if (last.sessionRpe != null && last.sessionRpe >= 9) { pct += 1; reasons.push("hard last session"); }
  if (last.sleepBucket === "lt5") { pct += 2; reasons.push("short sleep"); }
  else if (last.sleepBucket === "5_6") { pct += 1; reasons.push("short sleep"); }
  if (last.recoveryToday === 1) { pct += 2; reasons.push("low recovery"); }
  else if (last.recoveryToday === 2) { pct += 1; reasons.push("low recovery"); }
  pct = Math.min(5, pct * fade);
  if (pct < 0.5) return NEUTRAL_READINESS;
  return { multiplier: 1 - pct / 100, reasons };
}

export interface ModelSample {
  e1rm: number;
  /** Load lifted, in the model's unit (staleness/readiness applied). */
  load: number;
  reps: number;
  /** The RPE the e1RM was computed with (logged, or the 8.5 default). */
  rpe: number;
  trust: number;
  /** Recency weight (history) or set order (today). */
  weight: number;
}

export interface LoadModel {
  status: "ready" | "calibrating";
  unit: "kg" | "lb";
  /** Where the estimate comes from. */
  source: "history" | "today" | "blend" | "warmup" | "history_warmup" | null;
  historySessions: number;
  /** Past sets of this lift (recency-weighted, readiness/staleness applied). */
  history: ModelSample[];
  /** Sets already completed on this row today. */
  today: ModelSample[];
  /** Cold suggestions only: readiness applied. */
  readiness: Readiness;
  /** Days since the last session of this lift, when it's been a while. */
  staleDays: number | null;
  /** Mean bodyweight adjustment applied to history (1 = none), for the "why". */
  bodyweightScale: number;
  /** The athlete's final warm-up, when given and no working set is logged yet today. */
  warmup: { e1rm: number; load: number; reps: number } | null;
}

function weightedMean(values: Array<{ v: number; w: number }>): number | null {
  const total = values.reduce((s, x) => s + x.w, 0);
  if (!(total > 0)) return null;
  return values.reduce((s, x) => s + x.v * x.w, 0) / total;
}

/**
 * Build the per-exercise model.
 * `history` = this exercise's logs from OTHER sessions (already matched to the
 * exercise). `today` = this row's sets completed in the current session, in
 * set order.
 */
export function buildLoadModel(input: {
  history: PreviousLiftLog[];
  today: SetSample[];
  unit: "kg" | "lb";
  readiness?: Readiness;
  /** Optional final warm-up (SBD). Ignored once a working set is logged today. */
  warmup?: WarmupSet | null;
  /** Today's smoothed bodyweight (kg); history logs carry theirs in `bodyweightKg`. */
  bodyweightKg?: number | null;
  now?: Date;
}): LoadModel {
  const { unit } = input;
  const now = (input.now ?? new Date()).getTime();
  const readiness = input.readiness ?? NEUTRAL_READINESS;

  // ── History: every valid working set, grouped by session ──
  const bySession = new Map<string, { at: number; sets: Array<Omit<ModelSample, "weight">> }>();
  const bwScales: number[] = [];
  for (const log of input.history) {
    if ((log.loadType ?? "external") !== "external" || log.isWorkingSet === false) continue;
    const at = log.occurredAt ? Date.parse(log.occurredAt) : NaN;
    if (!Number.isFinite(at) || now - at > HISTORY_WINDOW_DAYS * DAY_MS || at > now + DAY_MS) continue;
    const load = logLoadInUnit(log, unit);
    const reps = Number(log.reps);
    if (load == null || !Number.isFinite(reps)) continue;
    const rpe = parseRpe(log.rpe) ?? (log.rir != null && log.rir !== "" ? parseRpe(10 - Number(log.rir)) : null);
    const est = setE1rm({ load, reps, rpe });
    if (!est) continue;
    const bw = bodyweightScale(input.bodyweightKg, log.bodyweightKg);
    bwScales.push(bw);
    const s = bySession.get(log.sessionKey) ?? { at, sets: [] };
    s.at = Math.max(s.at, at);
    s.sets.push({ e1rm: est.e1rm * bw, load: load * bw, reps, rpe: rpe ?? 8.5, trust: est.trust });
    bySession.set(log.sessionKey, s);
  }
  const sessions = Array.from(bySession.values()).sort((a, b) => b.at - a.at).slice(0, MAX_SESSIONS);
  const spanDays = sessions.length > 1 ? (sessions[0].at - sessions[sessions.length - 1].at) / DAY_MS : 0;
  const historyReady = sessions.length >= MIN_HISTORY_SESSIONS && spanDays >= MIN_HISTORY_SPAN_DAYS;

  let staleDays: number | null = null;
  let scale = readiness.multiplier;
  if (sessions.length > 0) {
    const daysSince = (now - sessions[0].at) / DAY_MS;
    if (daysSince > 21) {
      // Detraining + rust: back off ~1% per week past three weeks (max 5%).
      scale *= 1 - Math.min(0.05, ((daysSince - 21) / 7) * 0.01);
      staleDays = Math.round(daysSince);
    }
  }
  const history: ModelSample[] = sessions.flatMap((s) =>
    s.sets.map((x) => ({
      ...x,
      e1rm: x.e1rm * scale,
      load: x.load * scale,
      weight: Math.pow(0.5, (now - s.at) / DAY_MS / HALF_LIFE_DAYS),
    })),
  );

  // ── Today: sets already done on this row (need a logged RPE to calibrate) ──
  const today: ModelSample[] = [];
  input.today.forEach((s, i) => {
    const est = setE1rm(s);
    if (est && s.rpe != null && est.trust >= 0.7) {
      today.push({ e1rm: est.e1rm, load: s.load, reps: s.reps, rpe: s.rpe, trust: est.trust, weight: i + 1 });
    }
  });

  const wE1rm = input.warmup ? warmupE1rm(input.warmup) : null;
  const warmup = wE1rm && input.warmup && today.length === 0 ? { e1rm: wE1rm, load: input.warmup.load, reps: input.warmup.reps } : null;
  const bodyweightScaleMean = bwScales.length ? bwScales.reduce((a, b) => a + b, 0) / bwScales.length : 1;
  const base = { unit, historySessions: sessions.length, staleDays, warmup, bodyweightScale: bodyweightScaleMean };
  if (today.length > 0) {
    return {
      ...base, status: "ready",
      source: historyReady ? "blend" : "today",
      history: historyReady ? history.map((h) => ({ ...h, e1rm: h.e1rm / readiness.multiplier, load: h.load / readiness.multiplier })) : [],
      today,
      readiness: NEUTRAL_READINESS, // today's sets already reflect readiness
    };
  }
  if (historyReady) {
    return { ...base, status: "ready", source: warmup ? "history_warmup" : "history", history, today: [], readiness };
  }
  // No usable history: a warm-up is the only same-day signal there is, which is
  // exactly when a brand-new lift needs a first suggestion.
  if (warmup) {
    return { ...base, status: "ready", source: "warmup", history: [], today: [], readiness: NEUTRAL_READINESS };
  }
  return { ...base, status: "calibrating", source: null, history: [], today: [], readiness: NEUTRAL_READINESS };
}

/**
 * Athletes rate effort on their own scale, so a set is best predicted from
 * their own sets at similar reps and RPE; the chart only bridges the gap.
 */
function kernel(sample: ModelSample, reps: number, rpe: number): number {
  return Math.exp(-Math.abs(sample.reps - reps) / REP_KERNEL) * Math.exp(-Math.abs(sample.rpe - rpe) / RPE_KERNEL);
}
const REP_KERNEL = 1;
const RPE_KERNEL = 1;

/**
 * Self-rated RPE is noisy (±1 is normal, and pre-filled values often go
 * unchanged), so the chart's correction is only partly trusted: a past set's
 * load is scaled by (chart ratio)^ALPHA. ALPHA < 1 shrinks toward "the load
 * you actually used", which backtests far better on real logs than the raw
 * chart. Today's sets are rated in the same state, so they get more trust.
 */
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const HISTORY_SPREAD = 0.05;
export const TODAY_SPREAD = 0.035;
export const HISTORY_ALPHA = 0.5;
export const TODAY_ALPHA = 0.8;

/** Target-specific equivalent load and its relative spread. */
/**
 * Accumulated fatigue: at the same load, each later set rates ~0.5 RPE harder,
 * so a set predicted from an earlier set today is discounted per set apart.
 */
export const SET_FATIGUE = 0.035;

export function estimateFor(model: LoadModel, reps: number, rpe: number): { load: number; spread: number } | null {
  if (model.status !== "ready") return null;
  const targetPct = percentOf1RM(reps, 10 - rpe);
  if (!targetPct) return null;
  const est = (samples: ModelSample[], alpha: number) => {
    const w = samples.map((s) => ({
      v: s.load * Math.pow(targetPct / (s.load / s.e1rm), alpha),
      w: s.weight * s.trust * kernel(s, reps, rpe),
    }));
    const mean = weightedMean(w);
    if (mean == null) return null;
    const variance = weightedMean(w.map((x) => ({ v: (x.v / mean - 1) ** 2, w: x.w }))) ?? 0;
    return { load: mean, spread: Math.sqrt(variance) };
  };
  // A light set (below RPE 6) says little about heavy capacity — athletes rate
  // easy sets loosely — so it only calibrates light targets, never heavier ones.
  const todayUsable = rpe >= 6 ? model.today.filter((s) => s.rpe >= 6) : model.today;
  const t = todayUsable.length ? est(todayUsable, TODAY_ALPHA) : null;
  const h = model.history.length ? est(model.history, HISTORY_ALPHA) : null;
  // Final warm-up: only before any working set is logged today (model.warmup is
  // null otherwise). It nudges a history estimate, or — with no history — gives
  // a conservative first suggestion. See header note 8.
  if (model.warmup && !t) {
    const w = model.warmup.e1rm * targetPct;
    if (h) {
      const shift = clamp(w / h.load - 1, WARMUP_NUDGE_DOWN, WARMUP_NUDGE_UP);
      return { load: h.load * (1 + WARMUP_NUDGE_WEIGHT * shift), spread: clamp(h.spread / 2, HISTORY_SPREAD, 0.07) };
    }
    return {
      load: Math.min(w * WARMUP_COLD_START_FACTOR, model.warmup.load * WARMUP_COLD_START_MAX_RATIO),
      spread: WARMUP_COLD_START_SPREAD,
    };
  }
  // Spread floors are calibrated on real logs so the range is honest (most
  // sets land inside it) rather than falsely precise.
  if (t && h) return { load: 0.75 * t.load + 0.25 * h.load, spread: clamp(h.spread / 2, TODAY_SPREAD, 0.05) };
  if (t) return { load: t.load, spread: TODAY_SPREAD };
  if (h) return { load: h.load, spread: clamp(h.spread / 2, HISTORY_SPREAD, 0.07) };
  return null;
}

export interface LoadSuggestion {
  low: number;
  high: number;
  target: number;
  unit: "kg" | "lb";
}

export function roundToStep(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Plate-loadable increments. Lighter lb loads (dumbbells, cables) use 2.5. */
export function loadStep(unit: "kg" | "lb", load: number): number {
  if (unit === "kg") return load < 20 ? 1 : 2.5;
  return load < 50 ? 2.5 : 5;
}

/**
 * Suggested load window for a set of `reps` at `rpe`.
 * Low = RPE −0.5, high = RPE +0.5, widened by the model's spread.
 */
export function suggestSetLoad(
  model: LoadModel,
  target: { reps: number; rpe: number },
): LoadSuggestion | null {
  const reps = Math.round(target.reps);
  const rpe = Math.min(10, Math.max(MIN_RPE, target.rpe));
  const est = estimateFor(model, reps, rpe);
  if (!est) return null;
  const mid = percentOf1RM(reps, 10 - rpe);
  const lowPct = percentOf1RM(reps, 10 - Math.max(MIN_RPE, rpe - 0.5));
  const highPct = percentOf1RM(reps, 10 - Math.min(10, rpe + 0.5));
  if (!mid || !lowPct || !highPct) return null;
  const raw = est.load;
  const step = loadStep(model.unit, raw);
  const targetLoad = roundToStep(raw, step);
  // ±0.5 RPE window (shrunk like the estimate), widened by history noise.
  const lowRatio = Math.pow(lowPct / mid, HISTORY_ALPHA);
  const highRatio = Math.pow(highPct / mid, HISTORY_ALPHA);
  let low = roundToStep(raw * lowRatio * (1 - est.spread), step);
  let high = roundToStep(raw * highRatio * (1 + est.spread), step);
  low = Math.min(low, targetLoad);
  high = Math.max(high, targetLoad);
  if (!(targetLoad > 0) || !(low > 0)) return null;
  return { low, high, target: targetLoad, unit: model.unit };
}

/**
 * The in-session "audible": how much to change the next set when the bar moves
 * clearly faster or slower than planned. ~2.5% (about half an RPE on the chart),
 * rounded to a loadable plate step and never less than one step.
 */
export function audibleStep(target: number, unit: "kg" | "lb"): number {
  const step = loadStep(unit, target);
  return Math.max(step, roundToStep(target * 0.025, step));
}

/**
 * What the athlete's LAST warm-up should be before the first working set, so it
 * is heavy enough to read how today feels yet light enough to cost nothing:
 * a single at ~90% for a top set of 1–3 reps, a double at ~87% for 4–6 and
 * ~85% for 7+ (standard powerlifting warm-up ramps), rounded DOWN to plates.
 */
export function suggestFinalWarmup(target: number, planReps: number, unit: "kg" | "lb"): { load: number; reps: number } | null {
  if (!(target > 0) || !(planReps >= 1)) return null;
  const pct = planReps <= 3 ? 0.9 : planReps <= 6 ? 0.87 : 0.85;
  const step = loadStep(unit, target);
  const load = Math.floor((target * pct) / step) * step;
  if (!(load > 0)) return null;
  return { load, reps: planReps <= 3 ? 1 : 2 };
}

/**
 * Which reps/RPE to plan for from the prescription. Rep ranges plan for the
 * midpoint; no prescribed effort means a normal working set (RPE 8).
 */
export function planningTarget(input: {
  repTarget: { exact?: number; min?: number; max?: number } | null | undefined;
  rpeTarget: { exact?: number; min?: number; max?: number } | null | undefined;
  rirTarget: { exact?: number; min?: number; max?: number } | null | undefined;
}): { reps: number; rpe: number } | null {
  const r = input.repTarget;
  const reps = r?.exact ?? (r?.min != null && r?.max != null ? Math.round((r.min + r.max) / 2) : r?.min ?? r?.max);
  if (!reps || reps < 1 || reps > 15) return null;
  const mid = (t: { exact?: number; min?: number; max?: number } | null | undefined) =>
    t?.exact ?? (t?.min != null && t?.max != null ? (t.min + t.max) / 2 : t?.min ?? t?.max ?? null);
  const rpe = mid(input.rpeTarget);
  const rir = mid(input.rirTarget);
  const effort = rpe != null ? rpe : rir != null ? 10 - rir : 8;
  return { reps, rpe: Math.min(10, Math.max(MIN_RPE, Math.round(effort * 2) / 2)) };
}

