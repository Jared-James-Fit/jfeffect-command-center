/**
 * Powerlifting Strength Intelligence: one deterministic read of an athlete's
 * squat, bench and deadlift that every screen and every AI reads (pure,
 * tested in strength-intel.test.ts; docs in the module's README.md).
 *
 * Six numbers per lift, kept apart because they answer different questions:
 *  - competitionPR: the most they've lifted on a platform (raw, as lifted).
 *  - trainingPR: the most they've lifted in training, with its reps.
 *  - peakE1rm: the highest a hard training set has ever implied.
 *  - current: what they can probably lift on a normal training day NOW, with a
 *    confidence and what it rests on (estimate.ts).
 *  - reference: the coach's programming max (a stored 1RM / TM / e1RM, locked
 *    to a block or not): reference.ts. Never computed here.
 *  - daily: what today's sets say against the estimate before today.
 * Nothing here uses the highest or the most recent number for everything:
 * a % of e1RM reads `current`, a % of a competition PR reads `competitionPR`,
 * a % of a 1RM or TM reads the coach's reference.
 *
 * Every number is in the caller's unit (lb from getClientResults); `toKg`.
 */
import {
  compLiftOfResult,
  COMP_LIFTS,
  type CompLift,
  type MeetResult,
} from "@/lib/analytics/competition-strength";
import { neutralizeObviousLoadOutliers } from "@/lib/analytics/load-sanity";
import { effortOf } from "@/lib/analytics/strength-read";
import { rangeLift } from "@/lib/workouts/pick-range";
import { STRENGTH_RULES as R, confidenceWord, dayMs, DAY_MS, LB_PER_KG } from "./rules";
import { sessionEvidence, type SessionEvidence, type StrengthSet } from "./evidence";
import { estimateLine, lineAt, restartDays, type EstimatePoint, type EstimateReason, type MeetEvidence, type PhaseSpan } from "./estimate";
import {
  backoffRatio,
  peakPremium,
  repFactor,
  rpeConsistency,
  NEUTRAL_CALIBRATION,
  type Calibration,
} from "./calibrate";
import { rowStyle, stylesByDay, type DeadliftStyle } from "./style";
import { velocityReads } from "./velocity";
import { painPhases } from "./phases";

/** The athlete's own calendar day of an ISO time. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Days after a meet its attempts may still be typed into the app. */
export const MEET_LOG_DAYS = 6;

/** A session that is a meet's own attempts logged in the app: its heaviest set at the meet's lift, within a few days. */
export function isMeetLog(s: { day: string; heaviest: number }, m: { day: string; lb: number }): boolean {
  const gap = (dayMs(s.day) - dayMs(m.day)) / DAY_MS;
  if (gap < -1 || gap > MEET_LOG_DAYS) return false;
  return Math.abs(s.heaviest - m.lb) <= Math.max(2.5, m.lb * 0.01);
}

export type CurrentStrength = {
  value: number;
  /** 0–1 */
  confidence: number;
  word: "high" | "moderate" | "low";
  state: EstimatePoint["state"];
  reason: EstimateReason;
  basis:
    | { kind: "meet"; day: string; name: string | null; lifted: number }
    | { kind: "set"; day: string; load: number; reps: number; effort: number | null; lower: boolean };
  /** the last day evidence moved or confirmed it */
  lastUpdate: string;
  /** sessions and meets in the read */
  points: number;
};

export type LiftIntel = {
  lift: CompLift;
  /** the stance of their latest deadlift sessions (null: never named, or not a deadlift) */
  style: DeadliftStyle | null;
  sessions: SessionEvidence[];
  /** meets as lifted (raw, this lift) */
  meets: Array<{ day: string; lb: number; name: string | null }>;
  line: EstimatePoint[];
  calibration: Calibration;
  competitionPR: { value: number; day: string; name: string | null } | null;
  trainingPR: { load: number; reps: number; day: string } | null;
  peakE1rm: { value: number; day: string; load: number; reps: number; effort: number | null } | null;
  current: CurrentStrength | null;
  /** the other stance's estimate, kept apart (a sumo → conventional switch) */
  otherStyle: { style: DeadliftStyle; current: CurrentStrength | null; sessions: number } | null;
};

export type VariationIntel = {
  exerciseId: string;
  name: string;
  family: CompLift;
  sessions: SessionEvidence[];
  line: EstimatePoint[];
  current: CurrentStrength | null;
  /** its own estimate against the competition lift's on the same days (3+ comparisons) */
  ratio: { value: number; pairs: number } | null;
};

export type StrengthIntel = {
  today: string;
  lifts: Record<CompLift, LiftIntel>;
  variations: VariationIntel[];
};

export type StrengthContext = {
  today: string;
  /** training phases from their blocks and cuts (phases.ts) */
  phases?: PhaseSpan[];
  /** pain reports, so a painful week on a lift is read like a fatigue phase for it */
  pains?: Array<{ day: string; region?: string | null; score?: number | null }>;
};

/** A meet row's equipment and attempts, when known (MeetResult from meetsFromRows carries them). */
type MeetLike = MeetResult & {
  equipment?: string | null;
  attempts?: { s?: Array<number | null>; b?: Array<number | null>; d?: Array<number | null> } | null;
};

const EQUIPPED = /\b(single|multi)[- ]?ply\b|equipped|unlimited/i;
const ATTEMPT_KEY: Record<CompLift, "s" | "b" | "d"> = { squat: "s", bench: "b", deadlift: "d" };

/** One lift's meets as evidence: raw only (wraps never for the squat), an opener with two misses after it worth less. */
export function meetEvidence(meets: MeetLike[], lift: CompLift): MeetEvidence[] {
  const out: MeetEvidence[] = [];
  for (const m of meets ?? []) {
    const lb = Number(m.lifts?.[lift]);
    if (!(lb > 0) || !m.date) continue;
    const eq = String(m.equipment ?? "");
    if (EQUIPPED.test(eq)) continue;
    if (lift === "squat" && /\bwraps?\b/i.test(eq)) continue;
    let reliability = 1;
    const att = m.attempts?.[ATTEMPT_KEY[lift]];
    if (Array.isArray(att) && att.length >= 3) {
      const made = att.map((a) => Number(a) > 0);
      if (made[0] && !made[1] && !made[2]) reliability = R.OPENER_ONLY_MEET_RELIABILITY;
    }
    out.push({ day: String(m.date).slice(0, 10), value: Math.round(lb * 10) / 10, name: m.name ?? null, reliability });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** The set rows of one lift (or one variation) as the engine reads them. */
function toSets(rows: any[], sameDay: Map<string, Array<{ order: number; lift: CompLift }>>, lift: CompLift | null): StrengthSet[] {
  return rows.map((r) => {
    const day = localDay(String(r.date));
    const order = Number(r.row_order ?? 0);
    const others = sameDay.get(`${r.day_id ?? day}`) ?? [];
    return {
      day,
      load: Number(r.load) || 0,
      reps: Number(r.reps) || 0,
      rpe: r.rpe,
      rir: r.rir,
      order: r.row_order ?? null,
      setIndex: r.set_index ?? null,
      role: r.purpose_label ?? null,
      basis: r.percentage_basis ?? null,
      afterOtherLift: lift != null && others.some((o) => o.lift !== lift && o.order < order),
    };
  });
}

function currentFrom(
  line: EstimatePoint[],
  sessions: SessionEvidence[],
  meets: MeetEvidence[],
  today: string,
  activity: string[] = [],
): CurrentStrength | null {
  const p = lineAt(line, today);
  if (!p) return null;
  // nothing of this lift (or its family) for half a year: that estimate is history, not today's strength
  const last = [...activity, ...sessions.map((s) => s.day), ...meets.map((m) => m.day)]
    .filter((d) => d <= today)
    .reduce((a, d) => (d > a ? d : a), "");
  if (!last || (dayMs(today) - dayMs(last)) / DAY_MS > R.FRESH_START_DAYS) return null;
  // … or it started again since (back after a long break) and nothing has said where they are yet
  if (restartDays(sessions.filter((s) => !s.outlier), meets, activity).some((d) => d > p.day && d <= today)) return null;
  const meet = meets.find((m) => m.day === p.basis);
  const sess = meet ? null : sessions.find((s) => s.day === p.basis && !s.outlier);
  const moved = [...line].reverse().find((q) => q.day <= today && q.reason !== "held" && q.reason !== "time-off" && q.reason !== "drift");
  return {
    value: p.value,
    confidence: p.confidence,
    word: confidenceWord(p.confidence),
    state: p.state,
    reason: p.reason,
    basis: meet
      ? { kind: "meet", day: meet.day, name: meet.name, lifted: meet.value }
      : sess
        ? { kind: "set", day: sess.day, load: sess.set.load, reps: sess.set.reps, effort: sess.set.effort, lower: sess.kind === "lower" }
        : { kind: "set", day: p.basis, load: p.value, reps: 1, effort: null, lower: false },
    lastUpdate: moved?.day ?? p.day,
    points: sessions.filter((s) => !s.outlier && s.day <= today).length + meets.filter((m) => m.day <= today).length,
  };
}

/** One series (a lift in one stance, or a variation) through the engine, calibrated to the athlete. */
function readSeries(sets: StrengthSet[], meets: MeetEvidence[], phases: PhaseSpan[], today: string, activity: string[] = []) {
  const sessions = sessionEvidence(sets).filter((s) => !meets.some((m) => isMeetLog(s, { day: m.day, lb: m.value })));
  const rep = repFactor(sessions, { phases, meetDays: meets.map((m) => m.day) });
  const cons = rpeConsistency(sessions);
  const base = { sessions, meets, phases, repFactor: rep.value, consistency: cons.value, until: today, activity };
  const first = estimateLine(base);
  const prem = meets.length ? peakPremium(first, meets) : { value: R.DEFAULT_PEAK_PREMIUM, meets: 0 };
  const line = prem.value === R.DEFAULT_PEAK_PREMIUM ? first : estimateLine({ ...base, premium: prem.value });
  const bo = backoffRatio(sessions);
  const calibration: Calibration = {
    ...NEUTRAL_CALIBRATION,
    premium: prem.value,
    premiumMeets: prem.meets,
    repFactor: rep.value,
    repPairs: rep.pairs,
    consistency: cons.value,
    scatter: cons.scatter,
    backoffRatio: bo.value,
    backoffSessions: bo.sessions,
  };
  return { sessions, line, calibration, current: currentFrom(line, sessions, meets, today, activity) };
}

/** The whole read: every competition lift, and every barbell variation with its own history. */
export function buildStrengthIntel(results: any[], meets: MeetResult[] = [], ctx: StrengthContext): StrengthIntel {
  const today = ctx.today;
  const loaded = neutralizeObviousLoadOutliers(
    (results ?? [])
      .filter((r) => r && r.date && r.counts_load !== false && Number(r.load) > 0 && localDay(String(r.date)) <= today)
      .map((r) => ({ ...r, est_1rm: Number(r.est_1rm) || 0 })),
  ) as any[];
  // which competition lift each workout's rows are, in order: "after another lift"
  const sameDay = new Map<string, Array<{ order: number; lift: CompLift }>>();
  for (const r of loaded) {
    const lift = compLiftOfResult(r);
    if (!lift) continue;
    const key = `${r.day_id ?? localDay(String(r.date))}`;
    sameDay.set(key, [...(sameDay.get(key) ?? []), { order: Number(r.row_order ?? 0), lift }]);
  }

  // every day each family was trained (the lift or a variation): a comp lift rested while its variations are trained isn't time off
  const familyDays: Record<CompLift, string[]> = { squat: [], bench: [], deadlift: [] };
  for (const r of loaded) {
    const fam = (compLiftOfResult(r) ?? String(r.exercise_movement_family ?? r.movement_family ?? "").toLowerCase()) as CompLift;
    if (familyDays[fam]) familyDays[fam].push(localDay(String(r.date)));
  }

  const lifts = {} as Record<CompLift, LiftIntel>;
  for (const lift of COMP_LIFTS) {
    const rows = loaded.filter((r) => compLiftOfResult(r) === lift);
    const liftMeets = meetEvidence(meets as MeetLike[], lift);
    const phases = [...(ctx.phases ?? []), ...painPhases(ctx.pains ?? [], lift)];
    let sets = toSets(rows, sameDay, lift);
    const reads = velocityReads(
      rows.map((r, i) => ({
        day: sets[i].day,
        load: sets[i].load,
        reps: sets[i].reps,
        effort: effortOf(r),
        velocity: r.velocity_mps,
        velocityQuality: r.velocity_quality,
        velocityUncertainty: r.velocity_uncertainty,
        tempo: r.tempo,
        session: r.day_id ?? null,
      })),
    );
    sets = sets.map((s, i) => ({ ...s, velocity: reads[i] }));

    // sumo and conventional apart (deadlift only)
    let style: DeadliftStyle | null = null;
    let otherStyle: LiftIntel["otherStyle"] = null;
    let mine = sets;
    let mineMeets = liftMeets;
    if (lift === "deadlift") {
      const byDay = stylesByDay(
        rows.map((r, i) => ({
          day: sets[i].day,
          style: rowStyle({ exerciseName: r.exercise_name, nameOverride: r.name_override, role: r.purpose_label, notes: r.row_notes }),
        })),
      );
      const days = [...byDay.keys()].sort();
      style = days.length ? (byDay.get(days[days.length - 1]) ?? null) : null;
      if (style) {
        const styleAt = (d: string) => {
          let s: DeadliftStyle | null = null;
          for (const day of days) if (day <= d) s = byDay.get(day) ?? s;
          return s ?? byDay.get(days[0]) ?? null;
        };
        mine = sets.filter((s) => byDay.get(s.day) === style);
        mineMeets = liftMeets.filter((m) => styleAt(m.day) === style);
        const other: DeadliftStyle = style === "sumo" ? "conventional" : "sumo";
        const theirs = sets.filter((s) => byDay.get(s.day) === other);
        if (theirs.length) {
          const o = readSeries(theirs, liftMeets.filter((m) => styleAt(m.day) === other), phases, today);
          otherStyle = { style: other, current: o.current, sessions: o.sessions.length };
        }
      }
    }

    const read = readSeries(mine, mineMeets, phases, today, familyDays[lift]);
    const usable = read.sessions.filter((s) => !s.outlier);
    const heaviest = mine.reduce<{ load: number; reps: number; day: string } | null>((a, s) => {
      if (usable.every((u) => u.day !== s.day)) return a; // a meet's typed-in attempts or an outlier day
      return !a || s.load > a.load || (s.load === a.load && s.reps > a.reps) ? { load: s.load, reps: s.reps, day: s.day } : a;
    }, null);
    const peak = usable
      .filter((s) => s.kind === "exact")
      .reduce<SessionEvidence | null>((a, s) => (!a || s.e1rm > a.e1rm ? s : a), null);
    const pr = liftMeets.reduce<MeetEvidence | null>((a, m) => (!a || m.value > a.value ? m : a), null);
    lifts[lift] = {
      lift,
      style,
      sessions: read.sessions,
      meets: liftMeets.map((m) => ({ day: m.day, lb: m.value, name: m.name })),
      line: read.line,
      calibration: read.calibration,
      competitionPR: pr ? { value: pr.value, day: pr.day, name: pr.name } : null,
      trainingPR: heaviest,
      peakE1rm: peak ? { value: peak.e1rm, day: peak.day, load: peak.set.load, reps: peak.set.reps, effort: peak.set.effort } : null,
      current: read.current,
      otherStyle,
    };
  }

  // barbell variations with their own history (a paused deadlift, a high-bar squat)
  const varRows = new Map<string, any[]>();
  for (const r of loaded) {
    if (compLiftOfResult(r) || !r.exercise_id) continue;
    const fam = String(r.exercise_movement_family ?? r.movement_family ?? "").toLowerCase();
    if (!rangeLift(fam, r.exercise_name)) continue;
    varRows.set(r.exercise_id, [...(varRows.get(r.exercise_id) ?? []), r]);
  }
  const variations: VariationIntel[] = [];
  for (const [exerciseId, rows] of varRows) {
    const family = String(rows[0].exercise_movement_family ?? rows[0].movement_family).toLowerCase() as CompLift;
    const read = readSeries(toSets(rows, sameDay, null), [], ctx.phases ?? [], today, familyDays[family] ?? []);
    if (!read.sessions.length) continue;
    const comp = lifts[family];
    const ratios: number[] = [];
    for (const s of read.sessions) {
      if (s.kind !== "exact" || s.outlier || !comp) continue;
      const c = lineAt(comp.line, s.day);
      if (!c || c.state === "floor" || c.state === "stale") continue;
      if ((dayMs(s.day) - dayMs(c.basis)) / DAY_MS > 21) continue;
      ratios.push(s.e1rm / c.value);
    }
    ratios.sort((a, b) => a - b);
    const mid = Math.floor(ratios.length / 2);
    const med = ratios.length ? (ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2) : 0;
    variations.push({
      exerciseId,
      name: String(rows[0].exercise_name ?? "Exercise"),
      family,
      sessions: read.sessions,
      line: read.line,
      current: read.current,
      ratio: ratios.length >= 3 ? { value: Math.round(med * 1000) / 1000, pairs: ratios.length } : null,
    });
  }
  return { today, lifts, variations };
}

export const toKg = (lb: number) => Math.round((lb / LB_PER_KG) * 10) / 10;

/** What today's sets say against the estimate before today ("moving well", "heavy today"), or null. */
export function dailyRead(l: LiftIntel, today: string): { ratio: number; word: "strong" | "normal" | "heavy"; e1rm: number } | null {
  const s = l.sessions.find((x) => x.day === today && x.kind === "exact" && !x.outlier);
  const yesterday = new Date(dayMs(today) - DAY_MS).toISOString().slice(0, 10);
  const before = lineAt(l.line, yesterday);
  if (!s || !before) return null;
  const ratio = Math.round((s.e1rm / before.value - 1) * 1000) / 1000;
  return { ratio, word: ratio >= R.DAILY_STRONG ? "strong" : ratio <= R.DAILY_HEAVY ? "heavy" : "normal", e1rm: s.e1rm };
}
