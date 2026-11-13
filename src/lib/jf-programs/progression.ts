/**
 * Week-by-week prescriptions for the JF Effect library programs (pure).
 *
 * A program never repeats Week 1 twelve times: each slot (one exercise in one
 * workout) turns into the rows for a given week here. Three models:
 *
 * - hyp(): hypertrophy / general fitness / at home. One RIR wave per block
 *   (3 → 2 → 1–2, deload; 2–3 → 2 → 1, deload; 2 → 1–2 → 1, reassess),
 *   double progression inside the rep range, half the hard sets at 3–4 RIR on
 *   Weeks 4 and 8 (a beginner keeps more sets and only drops the effort),
 *   optional extra sets for a program's priority muscles in Blocks 2–3 and a
 *   lower rep range for compounds in Block 3.
 * - pl(): powerlifting. An explicit 12-week table: straight sets at an RPE, or
 *   a top set plus back-off sets stored as their own row at a % of the top set
 *   the athlete actually lifted that day (percentage_basis "top_set", so no
 *   back-off load exists until the top set is logged, and there is never a
 *   second load instruction).
 * - timed(): holds and carries, seconds by block.
 */

import { EX, type ExKey } from "./catalog";

export type Role = "Primary" | "Secondary" | "Tertiary" | "Assistance";
export type Level = "beginner" | "intermediate" | "advanced";

/** One row of one week, before it becomes payload JSON. */
export type WeekRow = {
  ex: ExKey;
  sets: number;
  reps?: string;
  seconds?: number;
  rpe?: string;
  rir?: string;
  /** back-off: this % of the top set logged above it */
  pctOfTop?: number;
  rest: number;
  role?: Role;
  note?: string;
};

/** One exercise in one workout, for all 12 weeks. */
export type Slot = {
  ex: ExKey;
  role?: Role;
  rows: (week: number) => WeekRow[];
};

export const WEEKS = 12;
export const blockOf = (week: number) => (week <= 4 ? 1 : week <= 8 ? 2 : 3);
export const isDeload = (week: number) => week === 4 || week === 8;

// ---------------------------------------------------------------------------
// Hypertrophy / general

export type HypOptions = {
  sets: number;
  reps: string;
  /** compounds may move to a heavier range in Block 3 (e.g. "6-10" → "5-8") */
  repsB3?: string;
  rest: number;
  level: Level;
  /** extra working sets in Blocks 2–3 for a program's priority muscles */
  addB2?: number;
  addB3?: number;
  note?: string;
  /** keep the RIR at 2+ every week (core, carries, awkward-to-push movements) */
  conservative?: boolean;
  /** advanced physique: an optional rest-pause on the last set in Weeks 7, 10, 11 */
  intensityTechnique?: boolean;
  /**
   * Accessory work in a powerlifting program: its effort comes DOWN as the
   * competition lifts peak (2–3 in reserve in Weeks 10–11, 3 in Week 12), so
   * the singles and doubles get the recovery.
   */
  plAccessory?: boolean;
  role?: Role;
};

type RirTable = Record<number, string>;

const RIR: Record<Level, { compound: RirTable; isolation: RirTable }> = {
  beginner: {
    compound: { 1: "3", 2: "2-3", 3: "2", 5: "2-3", 6: "2", 7: "1-2", 9: "2", 10: "2", 11: "1-2", 12: "1-2" },
    isolation: { 1: "3", 2: "2-3", 3: "2", 5: "2-3", 6: "2", 7: "1-2", 9: "2", 10: "1-2", 11: "1-2", 12: "1-2" },
  },
  intermediate: {
    compound: { 1: "3", 2: "2", 3: "1-2", 5: "2-3", 6: "2", 7: "1-2", 9: "2", 10: "1-2", 11: "1", 12: "1-2" },
    isolation: { 1: "3", 2: "2", 3: "1-2", 5: "2-3", 6: "2", 7: "1", 9: "2", 10: "1-2", 11: "0-1", 12: "1-2" },
  },
  advanced: {
    compound: { 1: "3", 2: "2", 3: "1-2", 5: "2-3", 6: "2", 7: "1-2", 9: "2", 10: "1-2", 11: "1", 12: "1-2" },
    isolation: { 1: "3", 2: "2", 3: "1-2", 5: "2-3", 6: "2", 7: "1", 9: "2", 10: "1", 11: "0-1", 12: "1-2" },
  },
};

const DELOAD_RIR = "3-4";

const PL_ACCESSORY_RIR: RirTable = { 1: "3", 2: "2", 3: "2", 5: "2", 6: "2", 7: "1-2", 9: "2", 10: "2-3", 11: "2-3", 12: "3" };

export function hypRow(ex: ExKey, o: HypOptions, week: number): WeekRow {
  const block = blockOf(week);
  const isIso = EX[ex].kind === "isolation" || EX[ex].kind === "core";
  const base = o.sets + (block === 2 ? o.addB2 ?? 0 : block === 3 ? o.addB3 ?? o.addB2 ?? 0 : 0);
  const reps = block === 3 && o.repsB3 ? o.repsB3 : o.reps;
  let sets = base;
  let rir: string;
  const notes: string[] = [];
  if (isDeload(week)) {
    // a beginner's 2-set work doesn't need halving: same sets, easy effort
    // a beginner's 2-set hypertrophy work doesn't need halving (same sets, easy effort); a
    // strength program's accessories always halve so the whole week drops ~40–60%
    sets = o.level === "beginner" && !o.plAccessory ? (base >= 3 ? base - 1 : base) : Math.max(1, Math.round(base / 2));
    rir = DELOAD_RIR;
  } else if (o.plAccessory) {
    if (week === 12) sets = Math.max(1, base - 1);
    rir = PL_ACCESSORY_RIR[week];
  } else if (week === 12) {
    sets = Math.max(1, base - 1);
    rir = RIR[o.level][isIso ? "isolation" : "compound"][12];
    if (!isIso) notes.push("Rep-PR check: beat your Week 9–10 reps at the same load, or the same reps with more load, at this effort.");
  } else {
    rir = RIR[o.level][isIso ? "isolation" : "compound"][week];
  }
  if (o.conservative && !isDeload(week)) rir = week === 1 ? "3" : "2";
  if (o.intensityTechnique && (week === 7 || week === 10 || week === 11)) {
    notes.push("Optional: one rest-pause on the last set (15 s, then 2–4 more clean reps). Skip it if form slips.");
  }
  if (o.note) notes.unshift(o.note);
  return { ex, sets, reps, rir, rest: o.rest, role: o.role, note: notes.join(" ") || undefined };
}

export const hyp = (ex: ExKey, o: HypOptions): Slot => ({ ex, role: o.role, rows: (w) => [hypRow(ex, o, w)] });

// ---------------------------------------------------------------------------
// Timed holds and carries

export type TimedOptions = {
  sets: number;
  /** seconds per set in Blocks 1, 2, 3 */
  seconds: [number, number, number];
  rest: number;
  note?: string;
  perSide?: boolean;
};

export const timed = (ex: ExKey, o: TimedOptions): Slot => ({
  ex,
  rows: (week) => {
    const block = blockOf(week);
    const deload = isDeload(week);
    const seconds = o.seconds[block - 1];
    return [{
      ex,
      sets: deload ? Math.max(1, o.sets - 1) : o.sets,
      seconds,
      rir: deload ? DELOAD_RIR : week === 1 ? "3" : "2",
      rest: o.rest,
      note: [o.note, o.perSide ? `${seconds} s each side.` : undefined].filter(Boolean).join(" ") || undefined,
    }];
  },
});

// ---------------------------------------------------------------------------
// Powerlifting

/** straight sets at an RPE */
export type PlStraight = { k: "s"; sets: number; reps: number | string; rpe: string };
/** a top set at an RPE, then back-off sets at a % of what was lifted */
export type PlTop = { k: "t"; reps: number; rpe: string; back?: { sets: number; reps: number; pct: number } };
export type PlWeek = PlStraight | PlTop;

export const s = (sets: number, reps: number | string, rpe: string): PlStraight => ({ k: "s", sets, reps, rpe });
export const t = (reps: number, rpe: string, back?: [sets: number, reps: number, pct: number]): PlTop => ({
  k: "t",
  reps,
  rpe,
  back: back ? { sets: back[0], reps: back[1], pct: back[2] } : undefined,
});

export type PlOptions = {
  /** Primary / Secondary / Tertiary for competition-lift exposures (powerlifting analytics read it) */
  role?: Role;
  rest: number;
  /** rest for back-off sets (default: rest less 30 s) */
  backRest?: number;
  /** the movement's own cue, on every week's first row */
  note?: string;
  /** a word on the back-offs ("Expect about RPE 6.5–7.5…") */
  backNote?: string;
};

export function plRows(ex: ExKey, table: PlWeek[], o: PlOptions, week: number): WeekRow[] {
  if (table.length !== WEEKS) throw new Error(`${EX[ex].name}: a powerlifting table needs ${WEEKS} weeks, got ${table.length}`);
  const w = table[week - 1];
  const reps = (n: number | string) => String(n);
  if (w.k === "s") {
    return [{ ex, sets: w.sets, reps: reps(w.reps), rpe: w.rpe, rest: o.rest, role: o.role, note: o.note }];
  }
  const top: WeekRow = {
    ex,
    sets: 1,
    reps: reps(w.reps),
    rpe: w.rpe,
    rest: o.rest,
    role: o.role,
    note: [w.reps === 1 ? "Top single." : "Top set.", o.note].filter(Boolean).join(" "),
  };
  if (!w.back) return [top];
  const less = 100 - w.back.pct;
  return [
    top,
    {
      ex,
      sets: w.back.sets,
      reps: reps(w.back.reps),
      pctOfTop: w.back.pct,
      rest: o.backRest ?? Math.max(120, o.rest - 30),
      role: o.role,
      note: [`Back-off sets: ${less}% less than the top ${w.reps === 1 ? "single" : "set"} you just lifted.`, o.backNote ?? "Should feel about RPE 6.5–7.5; if one feels harder than 8, take off another 5%."].join(" "),
    },
  ];
}

export const pl = (ex: ExKey, table: PlWeek[], o: PlOptions): Slot => ({ ex, role: o.role, rows: (w) => plRows(ex, table, o, w) });

// ---------------------------------------------------------------------------
// Week labels (each pl_weeks.phase: what the week is for, on the client's screen)

export type Track = "hypertrophy" | "beginner" | "powerlifting";

export function weekPhase(track: Track, week: number): string {
  if (track === "powerlifting") {
    return ({
      1: "Accumulation · volume at RPE 6–7",
      2: "Accumulation · a little heavier",
      3: "Accumulation · hardest week of the block",
      4: "Deload · fewer sets, RPE 5–6.5",
      5: "Intensification · 4s and 3s, RPE 7",
      6: "Intensification · RPE 7–7.5",
      7: "Intensification · RPE 7.5–8",
      8: "Deload · fewer sets, RPE 6",
      9: "Specificity · heavier, fewer reps",
      10: "Specificity · heavier again",
      11: "Specificity · heaviest controlled week, RPE 8–8.5 cap",
      12: "Assess (no max test), or the start of a meet taper",
    } as Record<number, string>)[week];
  }
  const deload = track === "beginner" ? "Lighter week · same movements, 3–4 reps in reserve" : "Deload · half the hard sets, 3–4 reps in reserve";
  return ({
    1: "Baseline · find loads that leave ~3 reps in reserve",
    2: "Build · add reps or load, ~2 in reserve",
    3: "Push · hard but clean, 1–2 in reserve",
    4: deload,
    5: "Block 2 · new start, 2–3 in reserve",
    6: "Build · ~2 in reserve",
    7: "Push · ~1 in reserve on the right exercises",
    8: deload,
    9: "Block 3 · heavier rep ranges, ~2 in reserve",
    10: "Build · 1–2 in reserve",
    11: "Strongest week · ~1 in reserve, no grinding",
    12: "Reassess · rep PRs at 1–2 in reserve, then the next program",
  } as Record<number, string>)[week];
}
