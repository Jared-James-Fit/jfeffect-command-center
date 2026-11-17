/**
 * How a workout went against its prescription, read the same way in the
 * logger (one quiet line after a set that strays from the plan) and in the
 * recap ("Vs the plan"). Deterministic: only what was prescribed and what was
 * logged, never a guess at readiness or a model call.
 *
 * Thresholds (RPE is a ±1 read at best, so one point off is normal):
 *   - harder: a set's RPE at least HARDER_BY over the top of the prescribed
 *     range (10 vs 8.5, 9.5 vs 8); in the recap the working sets' average at
 *     least AVG_OFF_BY over it.
 *   - easier: at least EASIER_BY under the bottom with the reps done (5 vs 7);
 *     the recap's average EASIER_BY under it.
 *   - short: fewer reps than the bottom of the prescribed reps.
 * A set is a working set when it's logged (reps or a time) and not marked a
 * warm-up; a row with nothing logged is "not logged", never "missed".
 */
import { parseRpe, percentOf1RM } from "@/lib/load-suggestion";
import { parseRepTarget } from "@/lib/set-input-cascade";
import { displayExerciseName } from "@/lib/exercise-display-name";

export const HARDER_BY = 1.5;
export const EASIER_BY = 2;
export const AVG_OFF_BY = 1.5;
/** An easier set never asks for more than this much more weight next set. */
export const MAX_STEP_UP = 0.1;

export type EffortRange = { min: number; max: number };
export type RepTarget = { exact?: number; min?: number; max?: number };

/** The prescribed effort as an RPE range: "7-8", "@8", "RPE 8"; RIR "1-2" is RPE 8-9. Null when there's none. */
export function effortRange(rpe: unknown, rir?: unknown): EffortRange | null {
  const read = (text: unknown): EffortRange | null => {
    if (text == null || text === "") return null;
    const s = String(text).replace(/rpe|rir|[@~:]/gi, " ").trim();
    const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
    if (range) return { min: Number(range[1]), max: Number(range[2]) };
    const n = s.match(/^(\d+(?:\.\d+)?)$/);
    if (n) return { min: Number(n[1]), max: Number(n[1]) };
    return null;
  };
  const fromRpe = read(rpe);
  if (fromRpe && fromRpe.max <= 10 && fromRpe.min >= 1) return fromRpe;
  const fromRir = read(rir);
  if (fromRir && fromRir.max <= 9) return { min: 10 - fromRir.max, max: 10 - fromRir.min };
  return null;
}

const repFloor = (t: RepTarget): number | null => t.exact ?? t.min ?? null;
const repTop = (t: RepTarget): number | null => t.exact ?? t.max ?? null;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
const rangeText = (r: EffortRange) => (r.min === r.max ? fmt(r.min) : `${fmt(r.min)}-${fmt(r.max)}`);

/** A logged set's RPE: its own RPE, else 10 − its RIR. */
export function loggedRpe(r: { actual_rpe_num?: unknown; actual_rpe?: unknown; actual_rir?: unknown }): number | null {
  const rpe = parseRpe((r.actual_rpe_num ?? r.actual_rpe) as any);
  if (rpe != null) return rpe;
  const rir = r.actual_rir == null || r.actual_rir === "" ? null : Number(r.actual_rir);
  return rir != null && Number.isFinite(rir) && rir >= 0 && rir <= 9 ? 10 - rir : null;
}

/* ------------------------------------------------------------------------ */
/* In the logger: one line about the latest set                              */
/* ------------------------------------------------------------------------ */

export type GuidanceSet = { set: number; load: number | null; reps: number | null; rpe: number | null };

export type SetGuidanceInput = {
  reps: RepTarget;
  effort: EffortRange | null;
  /** This card's logged working sets (any order). */
  sets: GuidanceSet[];
  /** Sets still to log on this card. */
  openSets: number;
  /** A later card today holds the same exercise (its back-offs). */
  backoffsFollow: boolean;
  unit: "kg" | "lb";
  /** Plate step in the unit. */
  step: number;
  /** The coach set this weight (a fixed load or a %): never told to add to it. */
  coachLoad: boolean;
  /** What the logger's own suggestion says for the next set, so two numbers never disagree. */
  suggested?: number | null;
  /** The Suggest card is on screen for this card's next set (it already says the number). */
  suggestionShown?: boolean;
};

export type SetGuidance = { kind: "harder" | "easier" | "short"; set: number; next: number | null; text: string };

/** What the next set would weigh at `targetRpe` for `targetReps`, from the set just done (the RPE chart). */
function chartLoad(load: number, reps: number, rpe: number, targetReps: number, targetRpe: number, step: number): number | null {
  const now = percentOf1RM(reps, 10 - rpe);
  const then = percentOf1RM(Math.max(1, targetReps), 10 - targetRpe);
  if (!now || !then || !(step > 0)) return null;
  return Math.floor(((load / now) * then) / step) * step;
}

/**
 * The latest logged set against its prescription, said only when it changes
 * what comes next today: the next set on this card (its weight), or the
 * back-offs on a later card. A set on target, a stray with nothing left to
 * change, an easy set under the coach's weight, and anything the visible
 * Suggest card already answers say nothing (the recap has the rest).
 * Short and scannable: "RPE 10, planned 6 · next set ~435 lb".
 */
export function setGuidance(input: SetGuidanceInput): SetGuidance | null {
  const sets = [...input.sets].filter((s) => (s.reps ?? 0) > 0).sort((a, b) => a.set - b.set);
  const last = sets[sets.length - 1];
  if (!last) return null;
  const open = input.openSets > 0;
  // the Suggest card on screen already moved the next set's number
  if (open && input.suggestionShown) return null;
  if (!open && !input.backoffsFollow) return null;
  const reps = last.reps as number;
  const floor = repFloor(input.reps);
  const effort = input.effort;
  const load = last.load != null && last.load > 0 ? last.load : null;
  const atLoad = (n: number) => `~${fmt(n)} ${input.unit}`;
  const lighter = (n: number | null) => (!open ? "go lighter on the back-offs" : n != null ? `next set ${atLoad(n)}` : "ease off next set");
  const down = (n: number | null): number | null => {
    if (n == null || load == null) return null;
    const v = Math.min(n, load - input.step);
    return v > 0 ? v : null;
  };

  // Short of the reps: the plan's reps at the plan's effort (or a hard 9) from what was done.
  if (floor != null && reps < floor) {
    const doneRpe = last.rpe ?? 10;
    const next = open && load != null
      ? down(input.suggested != null && input.suggested < load ? input.suggested : chartLoad(load, reps, doneRpe, floor, Math.min(effort?.max ?? 9, doneRpe), input.step))
      : null;
    return { kind: "short", set: last.set, next, text: `${reps} of ${floor} reps · ${lighter(next)}` };
  }
  if (!effort || last.rpe == null) return null;
  const said = `RPE ${fmt(last.rpe)}, planned ${rangeText(effort)}`;

  if (last.rpe >= effort.max + HARDER_BY) {
    const next = open && load != null
      ? down(input.suggested != null && input.suggested < load ? input.suggested : chartLoad(load, reps, last.rpe, repTop(input.reps) ?? reps, effort.max, input.step))
      : null;
    return { kind: "harder", set: last.set, next, text: `${said} · ${lighter(next)}` };
  }

  // Easier: only a weight the athlete chooses, only with a set left, and never past the RPE target.
  if (last.rpe <= effort.min - EASIER_BY && (floor == null || reps >= floor) && open && !input.coachLoad && load != null) {
    const chart = chartLoad(load, reps, last.rpe, reps, effort.min, input.step);
    const capped = Math.floor((load * (1 + MAX_STEP_UP)) / input.step) * input.step;
    const fromSuggest = input.suggested != null && input.suggested > load ? input.suggested : null;
    const next = fromSuggest ?? (chart != null ? Math.min(chart, capped) : null);
    if (next == null || next < load + input.step) return null;
    return { kind: "easier", set: last.set, next, text: `${said} · up to ${atLoad(next)} next set` };
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* In the recap: the whole workout against its plan                          */
/* ------------------------------------------------------------------------ */

export type PlanRow = {
  id: string;
  sets?: number | null;
  reps_text?: string | null;
  rpe?: string | number | null;
  rir?: string | number | null;
  skipped?: boolean | null;
  measurement_type?: string | null;
  tracking_type?: string | null;
  exercises?: { name?: string | null } | null;
  exercise_name_override?: string | null;
  /** The day's cardio (the cardio plan's row): done any time that day, never "not logged" here. */
  cardio_target_id?: string | null;
};

export type PlanResult = {
  row_id: string;
  set_index?: number | null;
  actual_reps?: number | null;
  actual_rpe?: unknown;
  actual_rpe_num?: unknown;
  actual_rir?: unknown;
  completed_at?: string | null;
  completed_duration_seconds?: number | null;
  is_working_set?: boolean | null;
};

export type PlanLineKind = "harder" | "short" | "fewer" | "easier" | "extra";
export type PlanLine = { kind: PlanLineKind; name: string; text: string };

export type PlanCheck = {
  setsPlanned: number;
  setsDone: number;
  /** Prescribed exercises with nothing logged (the recap lists them on their own). */
  notLogged: number;
  /** Everything prescribed was done, at the reps and effort asked. */
  asPlanned: boolean;
  /** Something had an effort or rep target to check. */
  checked: { reps: boolean; effort: boolean };
  /** What strayed from the plan, most important first, at most 4. */
  lines: PlanLine[];
  /** One plain line for the next session, only when the day says something. */
  next: string | null;
};

const ORDER: Record<PlanLineKind, number> = { harder: 0, short: 1, fewer: 2, easier: 3, extra: 4 };

export function planCheck(rows: PlanRow[], results: PlanResult[]): PlanCheck {
  const byRow = new Map<string, PlanResult[]>();
  for (const r of results) {
    if (!r.completed_at || r.is_working_set === false) continue;
    if (!((Number(r.actual_reps ?? 0) > 0) || (Number(r.completed_duration_seconds ?? 0) > 0))) continue;
    (byRow.get(r.row_id) ?? byRow.set(r.row_id, []).get(r.row_id)!).push(r);
  }
  let setsPlanned = 0;
  let setsDone = 0;
  let notLogged = 0;
  const checked = { reps: false, effort: false };
  const lines: PlanLine[] = [];
  const harderNames: string[] = [];
  const shortNames: string[] = [];
  const easierNames: string[] = [];

  for (const row of rows) {
    if (row.skipped) continue;
    const planned = Math.max(0, Number(row.sets ?? 0));
    const done = byRow.get(row.id) ?? [];
    if (row.cardio_target_id && done.length === 0) continue;
    setsPlanned += planned;
    setsDone += Math.min(done.length, planned || done.length);
    const name = displayExerciseName(row as any);
    if (done.length === 0) {
      if (planned > 0) notLogged += 1;
      continue;
    }
    if (planned > 0 && done.length < planned) lines.push({ kind: "fewer", name, text: `${name}: ${done.length} of ${planned} sets` });
    if (planned > 0 && done.length > planned) lines.push({ kind: "extra", name, text: `${name}: ${done.length} sets, ${planned} planned` });

    const timed = row.tracking_type === "time" || row.measurement_type === "time";
    if (timed) continue;
    const target = parseRepTarget(row.reps_text);
    const floor = repFloor(target);
    if (floor != null) {
      checked.reps = true;
      const short = done.filter((r) => Number(r.actual_reps ?? 0) < floor);
      if (short.length) {
        const fewest = Math.min(...short.map((r) => Number(r.actual_reps ?? 0)));
        lines.push({ kind: "short", name, text: `${name}: reps short on ${short.length} of ${done.length} set${done.length === 1 ? "" : "s"} (${fewest} vs ${floor})` });
        shortNames.push(name);
      }
    }
    const effort = effortRange(row.rpe, row.rir);
    if (effort) {
      const rated = done.map(loggedRpe).filter((x): x is number => x != null);
      if (rated.length) {
        checked.effort = true;
        const avg = rated.reduce((a, b) => a + b, 0) / rated.length;
        const shown = Math.round(avg * 2) / 2;
        const label = rated.length > 1 ? `RPE ${fmt(shown)} on average` : `RPE ${fmt(shown)}`;
        if (avg >= effort.max + AVG_OFF_BY) {
          lines.push({ kind: "harder", name, text: `${name}: ${label}, planned ${rangeText(effort)}` });
          harderNames.push(name);
        } else if (avg <= effort.min - EASIER_BY) {
          lines.push({ kind: "easier", name, text: `${name}: ${label}, planned ${rangeText(effort)}` });
          easierNames.push(name);
        }
      }
    }
  }

  lines.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  // the same exercise on two cards (a top set, then its back-offs) is said once per kind
  const seenLine = new Set<string>();
  const kept = lines.filter((l) => {
    const k = `${l.kind}|${l.name.toLowerCase()}`;
    if (seenLine.has(k)) return false;
    seenLine.add(k);
    return true;
  });
  const names = (raw: string[]) => {
    const list = [...new Set(raw)];
    return list.length > 2 ? `${list.slice(0, 2).join(", ")} and ${list.length - 2} more` : list.join(" and ");
  };
  const harderCount = new Set(harderNames).size;
  const next = harderCount > 2
    ? "Next time, start the lifts that ran hard a little lighter."
    : harderCount
    ? `Next time, start ${names(harderNames)} a little lighter.`
    : shortNames.length
      ? `Next time, hold the weight on ${names(shortNames)} until the reps are there.`
      : easierNames.length
        ? `${names(easierNames)} felt easier than planned, so there may be room to add a little next time.`
        : null;
  return {
    setsPlanned,
    setsDone,
    notLogged,
    asPlanned: lines.length === 0 && notLogged === 0 && setsDone >= setsPlanned,
    checked,
    lines: kept.slice(0, 4),
    next,
  };
}
