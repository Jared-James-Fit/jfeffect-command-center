/**
 * One exercise card's load guidance, read the same way wherever it's shown:
 * the athlete's logger (the strip's right half: Suggested, the coach's planned
 * %, Next time) and the coach's workout quick view on the Clients list. The
 * engine is load-suggestion.ts; this is how a card feeds it (its history, the
 * day's other cards, warm-ups, readiness, bodyweight, the plan) and what it
 * says back. Pure; the reads live in card-suggestion-reads.ts.
 *
 * Anything a card's suggestion depends on goes through here, so the coach
 * never reads a number the athlete doesn't see.
 */
import { resolveMovementFamily } from "@/lib/exercise-family";
import {
  WARMUP_TOO_EASY,
  warmupStyleOf,
  warmupsForModel,
  type WarmupSetRow,
} from "@/lib/final-warmup";
import { buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { maxReference } from "@/lib/percent-load-line";
import { parseRepTarget } from "@/lib/set-input-cascade";
import { computeDayReads, type DayRead, type DayReadRow } from "@/lib/workout-day-read";
import { normalizeDefaultLoadType, resolveLoadType, type LoadType } from "@/lib/workout-load-type";
import {
  matchHistoryLogs,
  type PreviousLiftIdentity,
  type PreviousLiftLog,
} from "@/lib/workout-previous-lift";
import { convertLoad, displayLoadInUnit } from "@/lib/workout-unit-persistence";
import { smoothedBodyweightKgAt, type BodyweightKgPoint } from "@/lib/bodyweight";
import { isTimedCardio } from "@/lib/timed-cardio";
import {
  cardEquipment,
  currentSetup,
  loadEquipmentId,
  type EquipmentData,
} from "@/lib/equipment/equipment";
import {
  buildLoadModel,
  equipmentKindOf,
  liftKindOf,
  parseRpe,
  planningTarget,
  predictReadiness,
  suggestionPicks,
  suggestSetLoad,
  NEUTRAL_READINESS,
  type LiftKind,
  type LoadModel,
  type LoadSuggestion,
  type Readiness,
  type RepProgression,
} from "@/lib/load-suggestion";
import { trustedSessionRpe } from "@/lib/workout-review";
import { backoffCards, firstHeavyCards, rangeLift } from "@/lib/workouts/pick-range";
import { plannedLoadView, type PlannedLoadView } from "@/lib/workouts/planned-load";
import { isStrengthBasis, strengthLoadInputs, type StrengthRefs } from "@/lib/strength-intel/planning";
import {
  capAdjustedLoad,
  hasRpeCap,
  isMaxBasis,
  referenceFamily,
  rpeCapValue,
  topSetAdjustment,
  type LiftFamily,
} from "@/lib/workouts/load-reference";

export type WUnit = "kg" | "lb";
export type RangeTarget = { exact?: number; min?: number; max?: number };

/** "RPE 8", "@8", "RIR 2", "rir: 1-2", "~8.5" → a target or a range. */
export function parseEffortTarget(text?: string | null): RangeTarget {
  if (!text) return {};
  const s = String(text)
    .replace(/rpe|rir|[@~:]/gi, " ")
    .trim();
  if (!s) return {};
  const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const n = s.match(/^(\d+(?:\.\d+)?)$/);
  if (n) return { exact: Number(n[1]) };
  // Last resort: pull first number out of the string
  const any = s.match(/(\d+(?:\.\d+)?)/);
  if (any) return { exact: Number(any[1]) };
  return {};
}

export function weightIncrement(unit: WUnit): number {
  return unit === "kg" ? 2.5 : 5;
}

/** The step a % of the top set rounds to: a program's small plates (`load_round` "fine": 2.5 lb / 1 kg), else 5 lb / 2.5 kg. */
export function backoffRoundStep(unit: WUnit, round: string | null | undefined): number {
  if (round === "fine") return unit === "kg" ? 1 : 2.5;
  return weightIncrement(unit);
}

/** Today's logged top set a % back-off is worked out from, and how it went against its plan. */
export type TopSetBasis = {
  value: number;
  unit: WUnit;
  reps?: number | null;
  rpe?: number | null;
  target?: string | null;
};

const nameOf = (row: any): string =>
  row.exercises?.name ?? row.exercise_name_override ?? "Exercise";

/** Who a card's history is matched by: Last time and the suggestion read it the same way. */
export function liftIdentityOf(row: any, equipmentId: string | null): PreviousLiftIdentity {
  const name = nameOf(row);
  const tracking =
    row.tracking_type ?? row.measurement_type ?? row.exercises?.default_measurement_type;
  const timedRow = row.tracking_type === "time" || row.measurement_type === "time";
  return {
    rowId: row.id,
    exerciseId: row.exercises?.id ?? row.exercise_id ?? null,
    exerciseName: name,
    repsOnly: tracking === "reps",
    purposeLabel: row.purpose_label ?? null,
    // a walk or a bike: last time is its time, calories and effort; a plank: its longest hold
    timed: isTimedCardio(name) ? "cardio" : timedRow ? "hold" : null,
    equipmentId,
  };
}

/**
 * The machine each card is on, when it changes what a weight means: "Last time"
 * and the suggestions read history on it, never another machine's.
 */
export function loadEquipmentByRow(
  rows: any[],
  results: any[],
  equipment: EquipmentData,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const row of rows) {
    const exId = row.exercises?.id ?? row.exercise_id ?? null;
    if (!exId) continue;
    const shown = cardEquipment(
      results.filter((x) => x.row_id === row.id),
      currentSetup(equipment, exId),
    );
    const eq = shown.equipmentId
      ? (equipment.equipment.find((e) => e.id === shown.equipmentId) ?? null)
      : null;
    map.set(row.id, loadEquipmentId(eq));
  }
  return map;
}

/** Each card's history (this session left out), each set with the bodyweight on its day. */
export function historyByRow(
  identities: PreviousLiftIdentity[],
  logs: PreviousLiftLog[],
  sessionKey: string,
  bodyweightSeries: BodyweightKgPoint[],
): Map<string, PreviousLiftLog[]> {
  const map = new Map<string, PreviousLiftLog[]>();
  const bwAt = new Map<string, number | null>();
  const withBodyweight = (log: PreviousLiftLog): PreviousLiftLog => {
    if (!bodyweightSeries.length || !log.occurredAt) return log;
    const day = log.occurredAt.slice(0, 10);
    if (!bwAt.has(day))
      bwAt.set(day, smoothedBodyweightKgAt(bodyweightSeries, Date.parse(log.occurredAt)));
    return { ...log, bodyweightKg: bwAt.get(day) ?? null };
  };
  for (const identity of identities) {
    map.set(identity.rowId, matchHistoryLogs(identity, logs, sessionKey).map(withBodyweight));
  }
  return map;
}

const isMainLift = (f: unknown): f is "squat" | "bench" | "deadlift" =>
  f === "squat" || f === "bench" || f === "deadlift";

/** Today's sets of every card, for how the day is going across cards (computeDayReads). */
export function dayReads(
  rows: any[],
  results: any[],
  history: Map<string, PreviousLiftLog[]>,
  bodyweightKg: number | null,
): Map<string, DayRead> {
  const input: DayReadRow[] = rows.map((r) => {
    const family = r.exercises?.movement_family;
    return {
      rowId: r.id,
      name: r.exercises?.name ?? r.exercise_name_override ?? "this lift",
      exerciseKey: String(r.exercises?.id ?? r.exercise_id ?? r.id),
      family: isMainLift(family) ? family : null,
      lift: liftKindOf(r.exercises),
      history: history.get(r.id) ?? null,
      sets: results
        .filter(
          (x) =>
            x.row_id === r.id &&
            x.completed_at &&
            resolveLoadType(x.load_type, x.is_bodyweight) === "external",
        )
        .sort((a, b) => a.set_index - b.set_index)
        .map((x) => ({
          load: Number(displayLoadInUnit(x, "kg")),
          reps: Number(x.actual_reps),
          rpe: parseRpe(x.actual_rpe_num ?? x.actual_rpe),
          at: Date.parse(x.completed_at),
        }))
        .filter((x) => x.load > 0 && x.reps > 0),
    };
  });
  return computeDayReads(input, bodyweightKg);
}

/** Predicted readiness from the athlete's most recent other workout review (only v2 reviews carry a real session RPE). */
export function readinessFromReview(
  review:
    | {
        review_submitted_at?: string | null;
        session_rpe?: number | null;
        pain?: boolean | null;
        sleep_bucket?: string | null;
        recovery_today?: string | null;
        review_version?: number | null;
      }
    | null
    | undefined,
): Readiness {
  if (!review) return NEUTRAL_READINESS;
  return predictReadiness({
    submittedAt: review.review_submitted_at ?? null,
    sessionRpe: trustedSessionRpe(review as any),
    pain: !!review.pain,
    sleepBucket: (review.sleep_bucket as any) ?? null,
    recoveryToday: (review.recovery_today as any) ?? null,
  });
}

/**
 * A back-off at a % of today's top set follows the top set they LOGGED (its
 * number tapped, or its numbers typed in): never a weight only filled in from
 * Suggested and not lifted yet. The nearest card of the same exercise above
 * this one (or the one the program names), its heaviest logged load.
 */
export function topSetBasisFor(
  r: any,
  rowIndex: number,
  rows: any[],
  results: any[],
): TopSetBasis | null {
  if (r.percentage_basis !== "top_set" || !r.percentage) return null;
  let source: any = null;
  if (r.basis_row_id) source = rows.find((x) => x.id === r.basis_row_id) ?? null;
  if (!source) {
    for (let i = rowIndex - 1; i >= 0; i--) {
      const candidate = rows[i];
      const sameExercise =
        (r.exercise_id && candidate.exercise_id === r.exercise_id) ||
        (!r.exercise_id && candidate.exercise_name_override === r.exercise_name_override);
      if (sameExercise) {
        source = candidate;
        break;
      }
    }
  }
  if (!source) return null;
  const numeric = results
    .filter((x) => x.row_id === source.id)
    .filter(
      (x) =>
        x.completed_at &&
        x.actual_load != null &&
        Number.isFinite(Number(x.actual_load)) &&
        Number(x.actual_load) > 0,
    )
    .sort((a, b) => Number(b.actual_load) - Number(a.actual_load))[0];
  if (!numeric) return null;
  const sourceUnit: WUnit = numeric.actual_load_unit === "lb" ? "lb" : "kg";
  return {
    value: Number(numeric.actual_load),
    unit: sourceUnit,
    // how it went against its plan moves the back-offs (topSetAdjustment)
    reps: numeric.actual_reps != null ? Number(numeric.actual_reps) : null,
    rpe: parseRpe(numeric.actual_rpe_num ?? numeric.actual_rpe),
    target: source.rpe ?? null,
  };
}

/**
 * The coach's % of the logged top set, moved by how that top set went against
 * its prescribed RPE (topSetAdjustment: harder brings the back-offs down before
 * the first one, a clear point easier nudges them up half an RPE's worth).
 */
export function backoffPlanFor(
  row: any,
  topSetBasis: TopSetBasis | null,
  unit: WUnit,
): {
  load: number;
  plain: number;
  adjust: ReturnType<typeof topSetAdjustment>;
} | null {
  if (row.percentage_basis !== "top_set" || !topSetBasis || !row.percentage) return null;
  const baseInUnit =
    topSetBasis.unit === unit
      ? topSetBasis.value
      : convertLoad(topSetBasis.value, topSetBasis.unit, unit);
  const exact = (baseInUnit * Number(row.percentage)) / 100;
  const step = backoffRoundStep(unit, row.load_round);
  const plain = Math.round(exact / step) * step;
  const adj = topSetAdjustment({
    reps: topSetBasis.reps,
    rpe: topSetBasis.rpe,
    target: topSetBasis.target,
  });
  if (!adj) return { load: plain, plain, adjust: null };
  const moved = exact * adj.factor;
  // down rounds down and never above the plain %; up rounds to the nearest step
  const load =
    adj.dir === "down"
      ? Math.min(plain, Math.floor(moved / step) * step)
      : Math.max(plain, Math.round(moved / step) * step);
  return { load, plain, adjust: load !== plain ? adj : null };
}

/**
 * The weight the coach prescribed, in the card's unit: a fixed load the coach
 * set exactly (manual_override), a top-set back-off's %, a % of a max (already
 * rounded in the card's unit by computeRowLoad), else a stored load.
 */
export function prescribedWeightFor(
  row: any,
  unit: WUnit,
  backoffLoad: number | null,
  computed: { status: string; load: number | null; unit: WUnit } | null,
): number | null {
  const prescribedLoadInUnit = (): number | null => {
    const kg = Number(row.load_kg);
    const lb = Number(row.load_lb);
    const hasKg = row.load_kg != null && row.load_kg !== "" && Number.isFinite(kg);
    const hasLb = row.load_lb != null && row.load_lb !== "" && Number.isFinite(lb);
    if (unit === "kg") {
      if (hasKg) return kg;
      if (hasLb) return convertLoad(lb, "lb", "kg");
    } else {
      if (hasLb) return lb;
      if (hasKg) return convertLoad(kg, "kg", "lb");
    }
    return null;
  };
  if (row.manual_override) return prescribedLoadInUnit();
  if (backoffLoad != null) return backoffLoad;
  if (computed && computed.status === "ok" && computed.load != null) {
    if (computed.unit === unit) return computed.load;
    const step = weightIncrement(unit);
    return Math.round(convertLoad(computed.load, computed.unit, unit) / step) * step;
  }
  return prescribedLoadInUnit();
}

/**
 * RPE cap on a planned % load: a set logged over it brings the rest of the
 * exercise down to what would have sat at the cap (capAdjustedLoad), and it
 * stays down. Nothing here ever raises the load above the plan.
 */
export function capHeldFor(
  row: any,
  planned: number | null,
  cardResults: any[],
  unit: WUnit,
  repTarget: { exact?: number; min?: number; max?: number },
): { load: number; over: { set: number; rpe: number } } | null {
  if (!hasRpeCap(row) || planned == null) return null;
  const cap = rpeCapValue(row.rpe);
  if (cap == null) return null;
  const done = cardResults
    .filter(
      (r: any) => r.completed_at && resolveLoadType(r.load_type, r.is_bodyweight) === "external",
    )
    .sort((a: any, b: any) => a.set_index - b.set_index);
  let held = planned;
  let over: { set: number; rpe: number } | null = null;
  for (const r of done) {
    const load = Number(displayLoadInUnit(r, unit));
    const reps = Number(r.actual_reps);
    const rpe = parseRpe(r.actual_rpe_num ?? r.actual_rpe);
    const next = capAdjustedLoad({
      planned: held,
      last: { load, reps, rpe },
      cap,
      targetReps: repTarget?.exact ?? repTarget?.max ?? repTarget?.min ?? reps,
      step: weightIncrement(unit),
    });
    if (next != null) {
      held = next;
      over = { set: r.set_index, rpe: rpe as number };
    }
  }
  return over ? { load: held, over } : null;
}

/**
 * How the card is tracked by the program's prescription: reps with a weight,
 * reps only, or time (a duration prescribed, or "30 sec" typed in the reps).
 */
export function cardTrackingType(row: any): "reps_weight" | "reps" | "time" {
  if (row.tracking_type === "reps") return "reps";
  if (row.tracking_type === "time" || row.measurement_type === "time") return "time";
  if ((row.exercises?.default_measurement_type ?? null) === "time") return "time";
  if (row.duration_seconds != null && Number(row.duration_seconds) > 0) return "time";
  if (/\b(sec(onds?)?|min(utes?)?)\b/i.test(String(row.reps_text ?? ""))) return "time";
  return "reps_weight";
}

/** What the card's set 1 was logged as, else the exercise's default (an assisted pull-up, a bodyweight dip). */
export function cardLoadType(row: any, cardResults: any[]): LoadType {
  const first = cardResults.find((x) => x.set_index === 1);
  if (first) return resolveLoadType(first.load_type, first.is_bodyweight);
  return normalizeDefaultLoadType(row.exercises?.default_load_type) ?? "external";
}

/**
 * Double progression (load-suggestion.ts note 12): an accessory or variation on
 * a rep range starts from last session's weight and whether it earned the next
 * step. Never a barbell squat / bench / deadlift (RPE-led) or a back-off card.
 */
export function progressionPlanFor(x: {
  liftKind: LiftKind;
  family: string;
  name: string;
  equipment: string | null | undefined;
  followsSameExercise: boolean;
  repTarget: { min?: number; max?: number };
  loadPlan: { reps: number; rpe: number } | null;
}): { range: { lo: number; hi: number }; rpe: number } | null {
  const { repTarget, loadPlan } = x;
  return x.liftKind !== "competition" &&
    !rangeLift(x.family, x.name, x.equipment) &&
    !x.followsSameExercise &&
    repTarget.min != null &&
    repTarget.max != null &&
    repTarget.max > repTarget.min &&
    loadPlan
    ? { range: { lo: repTarget.min, hi: repTarget.max }, rpe: loadPlan.rpe }
    : null;
}

/** The card's completed external-load sets today, in the card's unit, in set order (what the engine reads as today). */
export function todaySetsIn(
  cardResults: any[],
  unit: WUnit,
): Array<{ load: number; reps: number; rpe: number | null }> {
  return cardResults
    .filter(
      (r: any) => r.completed_at && resolveLoadType(r.load_type, r.is_bodyweight) === "external",
    )
    .sort((a: any, b: any) => a.set_index - b.set_index)
    .map((r: any) => ({
      load: Number(displayLoadInUnit(r, unit)),
      reps: Number(r.actual_reps),
      rpe: parseRpe(r.actual_rpe_num ?? r.actual_rpe),
    }))
    .filter((x) => x.load > 0 && x.reps > 0);
}

/** Today's sets of this lift on other cards (the day read), in the card's unit. */
export function carryTodayIn(dayRead: DayRead | null | undefined, unit: WUnit) {
  const toUnit = (kg: number) => (unit === "kg" ? kg : kg * 2.2046226218);
  return (dayRead?.carryKg ?? []).map((x) => ({ ...x, load: toUnit(x.load) }));
}

/** What the number is: said beside it when it's news (live, an early estimate, warm-up tuned, a progression step). */
export function suggestionBadge(
  hint: LoadSuggestion,
  model: LoadModel,
): { text: string; live: boolean } | null {
  const dayPct = model.dayFactor ? Math.round((model.dayFactor - 1) * 100) : 0;
  const daySigned = `${dayPct > 0 ? "+" : "−"}${Math.abs(dayPct)}%`;
  return hint.progression
    ? {
        text:
          hint.progression.action === "add"
            ? "Earned the next step"
            : hint.progression.action === "drop"
              ? "Down a step"
              : "Build reps",
        live: false,
      }
    : model.source === "warmup"
      ? { text: "From warm-up", live: false }
      : model.source === "history_warmup"
        ? hint.warmup === "too_easy"
          ? { text: `${WARMUP_TOO_EASY} · from your history`, live: false }
          : hint.warmup === "light"
            ? { text: "Warm-up too light to tune · from your history", live: false }
            : { text: "Warm-up tuned", live: false }
        : model.source === "today" || model.source === "blend"
          ? { text: "Live", live: true }
          : model.early
            ? { text: "Early estimate", live: false }
            : dayPct !== 0
              ? { text: `Live ${daySigned}`, live: true }
              : null;
}

export function fmtLoadNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** A double-progression suggestion's change from last time, in a few words ("+5 lb", "same weight · build to 12", "−5 lb"). */
export function progressionChange(p: RepProgression, unit: string): string {
  const d = Math.round((p.load - p.from) * 100) / 100;
  if (Math.abs(d) < 0.01) return `same weight · build to ${p.range.hi}`;
  return `${d > 0 ? "+" : "−"}${fmtLoadNum(Math.abs(d))} ${unit}`;
}

/* ─────────────────────── A whole day, for the coach ─────────────────────── */

/** What one card says about the weight, for someone reading the workout (the coach's quick view). */
export type CardGuide =
  /** The engine's number (or the range to pick within by feel on the first heavy set of a main lift). */
  | {
      kind: "suggested";
      unit: WUnit;
      shown: string;
      target: number;
      plan: string | null;
      note: string | null;
      live: boolean;
    }
  /** The engine has nothing to go on yet. */
  | { kind: "pending"; note: string }
  /** The coach's % as today's weight. */
  | {
      kind: "planned";
      label: string;
      value: string | null;
      waiting: string | null;
      capped: boolean;
    }
  /** Every set is in: where next time starts. */
  | { kind: "next"; unit: WUnit; shown: string; note: string | null };

export type DayGuideInput = {
  /** The day's rows, in the coach's order. */
  rows: any[];
  /** This session's logged sets of the day (every card). */
  results: any[];
  /** The unit each card opens in (resolveWorkoutRowUnits: `row:<id>`). */
  units: Record<string, WUnit>;
  fallbackUnit: WUnit;
  /** Each card's history (historyByRow); undefined while it loads. */
  history: Map<string, PreviousLiftLog[]> | undefined;
  bodyweightKg: number | null;
  readiness: Readiness;
  /** This session's warm-ups by row. */
  warmups: Map<string, WarmupSetRow[]>;
  maxes: ClientMaxRow[];
  maxesPending: boolean;
  /** what a "% of …" reads from the strength read (strength-intel/planning.ts) */
  strengthRefs: StrengthRefs | null;
  /** that read is still loading */
  e1rmPending?: boolean;
};

/**
 * Every card's guidance for one workout, worked out exactly as the athlete's
 * logger does (cards' inputs in this file, the engine in load-suggestion.ts).
 * A card with nothing to say (timed, bodyweight, a coach's fixed weight, still
 * loading) has no entry.
 */
export function dayGuides(x: DayGuideInput): Map<string, CardGuide> {
  const out = new Map<string, CardGuide>();
  if (!x.history) return out;
  const reads = dayReads(x.rows, x.results, x.history, x.bodyweightKg);
  const loggedExternal = new Set<string>();
  for (const r of x.results) {
    if (r.completed_at && resolveLoadType(r.load_type, r.is_bodyweight) === "external")
      loggedExternal.add(r.row_id);
  }
  const firstHeavy = firstHeavyCards(x.rows, loggedExternal);
  const backoffs = backoffCards(x.rows);
  const maxIndex = buildMaxIndex(x.maxes);
  x.rows.forEach((row, rowIndex) => {
    const cardResults = x.results.filter((r) => r.row_id === row.id);
    const guide = cardGuide({
      row,
      rowIndex,
      rows: x.rows,
      dayResults: x.results,
      cardResults,
      unit: x.units[`row:${row.id}`] ?? x.fallbackUnit,
      history: x.history!.get(row.id) ?? [],
      bodyweightKg: x.bodyweightKg,
      readiness: x.readiness,
      warmups: x.warmups.get(row.id) ?? [],
      dayRead: reads.get(row.id) ?? null,
      firstHeavySet: firstHeavy.has(row.id),
      followsSameExercise: backoffs.has(row.id),
      maxIndex,
      maxesPending: x.maxesPending || (isStrengthBasis(row.percentage_basis) && !!x.e1rmPending),
      strengthRefs: x.strengthRefs,
    });
    if (guide) out.set(row.id, guide);
  });
  return out;
}

function cardGuide(c: {
  row: any;
  rowIndex: number;
  rows: any[];
  dayResults: any[];
  cardResults: any[];
  unit: WUnit;
  history: PreviousLiftLog[];
  bodyweightKg: number | null;
  readiness: Readiness;
  warmups: WarmupSetRow[];
  dayRead: DayRead | null;
  firstHeavySet: boolean;
  followsSameExercise: boolean;
  maxIndex: ReturnType<typeof buildMaxIndex>;
  maxesPending: boolean;
  strengthRefs: StrengthRefs | null;
}): CardGuide | null {
  const { row, unit } = c;
  if (row.cardio_target_id) return null;
  if (cardTrackingType(row) !== "reps_weight") return null;
  if (cardLoadType(row, c.cardResults) !== "external") return null;
  const name = nameOf(row);
  const exercise = row.exercises ?? null;
  const family = resolveMovementFamily(exercise, row.movement_family);

  // The coach's % (of a max, or of today's top set): the weight it means today.
  const refFamily = referenceFamily({
    rowFamily: row.movement_family,
    competitionLiftType: exercise?.competition_lift_type,
    movementFamily: exercise?.movement_family,
  });
  const ownCompetition =
    !!refFamily && String(exercise?.competition_lift_type ?? "").toLowerCase() === refFamily;
  const computed =
    row.percentage && row.percentage_basis && row.percentage_basis !== "manual"
      ? computeRowLoad({
          exerciseName: name,
          basis: row.percentage_basis,
          percentage: Number(row.percentage),
          manualLoadKg: row.load_kg ? Number(row.load_kg) : null,
          manualLoadLb: row.load_lb ? Number(row.load_lb) : null,
          unit,
          maxesIndex: c.maxIndex,
          family: refFamily,
          ownCompetition,
          ...(({ ref: _r, ...kgs }) => kgs)(strengthLoadInputs(c.strengthRefs, row.percentage_basis, refFamily, exercise?.id ?? row.exercise_id ?? null)),
        })
      : null;
  const plannedFromMax =
    !row.manual_override &&
    isMaxBasis(row.percentage_basis) &&
    computed?.status === "ok" &&
    computed.load != null;
  const topSetBasis = topSetBasisFor(row, c.rowIndex, c.rows, c.dayResults);
  const backoffPlan = backoffPlanFor(row, topSetBasis, unit);
  const planned = prescribedWeightFor(row, unit, backoffPlan?.load ?? null, computed as any);
  const repTarget = parseRepTarget(row.reps_text);
  const capHeld = capHeldFor(row, planned, c.cardResults, unit, repTarget);
  const open = capHeld?.load ?? planned;
  const maxBasedPct = !!row.percentage && isMaxBasis(row.percentage_basis);
  const pctLoadIsCoachs =
    maxBasedPct && (c.maxesPending || (computed?.status === "ok" && computed.load != null));
  const coachOwnsLoad =
    !!row.manual_override || row.percentage_basis === "top_set" || pctLoadIsCoachs;

  const logged = todaySetsIn(c.cardResults, unit);
  const setCount = Math.max(1, Number(row.sets) || 1);
  const doneSets = new Set(c.cardResults.filter((r) => r.completed_at).map((r) => r.set_index))
    .size;
  const done = logged.length > 0 && doneSets >= setCount;

  if (!row.manual_override && (row.percentage_basis === "top_set" || maxBasedPct)) {
    const topSet = row.percentage_basis === "top_set";
    const ok = !topSet && computed?.status === "ok";
    const view: PlannedLoadView | null = plannedLoadView({
      percentage: row.percentage,
      basis: row.percentage_basis,
      rpe: row.rpe,
      unit,
      planned: topSet ? (backoffPlan?.load ?? null) : plannedFromMax ? planned : null,
      plain: topSet ? (backoffPlan?.plain ?? null) : null,
      adjust: topSet ? (backoffPlan?.adjust ?? null) : null,
      open,
      linked: topSetBasis,
      reference: ok
        ? maxReference(
            (computed as any).max ??
              ((computed as any).refLift
                ? { lift: (computed as any).refLift, unit: (computed as any).unit }
                : null),
            (computed as any).base,
            (computed as any).unit,
          )
        : null,
      label: ok ? ((computed as any).label ?? null) : null,
      capOver: capHeld?.over ?? null,
      pending: !topSet && c.maxesPending,
    });
    if (view) {
      if (done) return null;
      return {
        kind: "planned",
        label: view.label,
        value: view.value,
        waiting: view.waiting ? "After the top set" : null,
        capped: view.capped,
      };
    }
  }
  if (coachOwnsLoad) return null;

  const rpeTarget = parseEffortTarget(row.rpe);
  const rirTarget = parseEffortTarget(row.rir);
  const loadPlan = planningTarget({ repTarget, rpeTarget, rirTarget });
  if (!loadPlan) return null;
  // the prescription already says "× 5 | RPE 6": the number says its reps and RPE only when they were picked from a range
  const rxSaysPlan = repTarget.exact === loadPlan.reps && rpeTarget.exact === loadPlan.rpe;
  const liftKind = liftKindOf(row.exercises);
  const progression = progressionPlanFor({
    liftKind,
    family,
    name,
    equipment: exercise?.equipment,
    followsSameExercise: c.followsSameExercise,
    repTarget,
    loadPlan,
  });
  const warmupsRead = warmupStyleOf(family, name, exercise?.equipment) === "last" && !progression;
  const model = buildLoadModel({
    history: c.history,
    today: logged,
    unit,
    readiness: c.readiness,
    warmups: warmupsRead ? warmupsForModel(c.warmups, unit) : [],
    bodyweightKg: c.bodyweightKg,
    dayFactor: c.dayRead?.factor ?? null,
    carryToday: carryTodayIn(c.dayRead, unit),
    lift: liftKind,
    backoffs: c.followsSameExercise ? "as_logged" : undefined,
    progression,
    equipment: equipmentKindOf(name, exercise?.equipment),
  });
  const hint = suggestSetLoad(model, loadPlan);

  if (done) {
    const p = model.progressionNext;
    const next: LoadSuggestion | null = p
      ? { low: p.load, high: p.load, target: p.load, unit: model.unit, progression: p }
      : hint;
    if (!next) return null;
    return {
      kind: "next",
      unit: next.unit as WUnit,
      shown: fmtLoadNum(next.target),
      note: next.progression ? progressionChange(next.progression, next.unit) : null,
    };
  }
  if (model.status === "calibrating" || !hint) {
    return {
      kind: "pending",
      note: model.warmupTooEasy
        ? "Warm-up too easy · after their first set"
        : "After their first set",
    };
  }
  const workedToday = c.cardResults.some(
    (r) => r.completed_at && resolveLoadType(r.load_type, r.is_bodyweight) === "external",
  );
  const picks = suggestionPicks({
    hint,
    model,
    mainLift: rangeLift(family, name, exercise?.equipment),
    // the logger passes "an effort was parsed", which is always so (parseEffortTarget returns a target object)
    effortPrescribed: rpeTarget != null || rirTarget != null,
    firstOfLift: c.firstHeavySet,
    loggedHere: workedToday,
  });
  const badge = suggestionBadge(hint, model);
  return {
    kind: "suggested",
    unit: hint.unit as WUnit,
    shown: picks ? `${fmtLoadNum(picks.low)}–${fmtLoadNum(picks.high)}` : fmtLoadNum(hint.target),
    target: hint.target,
    // a progression says its change from last time ("+5 lb", "same weight · build to 12"), as the logger does
    plan: hint.progression
      ? progressionChange(hint.progression, hint.unit)
      : rxSaysPlan
        ? null
        : `× ${loadPlan.reps} @ ${fmtLoadNum(loadPlan.rpe)}`,
    // the athlete's words ("from your history") read as the coach's
    // a progression's change already says it ("+5 lb"); else what moved the number, if anything did
    note: badge && !hint.progression ? badge.text.replace(/ · from your history$/, "") : null,
    live: badge?.live ?? false,
  };
}
