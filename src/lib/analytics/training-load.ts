/**
 * Training load: how much work an athlete did, where it went (muscles,
 * movement patterns, the competition lifts, the days of the week) and what
 * that says about the program. One deterministic read for the analytics page
 * (coach and athlete see the same numbers) and Program Intelligence's brief
 * (so the AI plans from it too). No model decides anything here.
 *
 * Definitions (said the same way on screen, `TRAINING_LOAD_DEFINITIONS`):
 * - A working set is a logged set with reps (warm-ups live in their own table
 *   and never count). Stretches and conditioning (`counts_toward_volume`
 *   false, or a mobility / cardio pattern) are left out of strength volume.
 * - A hard set is a working set rated RPE 7+ (3 or fewer reps in reserve). An
 *   unrated set is a working set of unknown effort, counted apart, never
 *   guessed hard or easy.
 * - Sets credited to a muscle: every primary muscle 1, every secondary ½
 *   (`MUSCLE_CREDIT`), one credit per muscle per set, so a squat is a full
 *   quad set and half an erector set, never two quad sets. An estimate of
 *   where work went, not a measurement of stimulus.
 * - Prescribed sets are the sets written on workouts dated in the range;
 *   completed is, per exercise, what was logged up to what was written;
 *   missed is what was written on a past day and not logged; extra is logged
 *   beyond what was written.
 * - Relative intensity is a set's load as a % of the best estimated max that
 *   lift showed in the range (comparable sets only, strength-read.ts), said as
 *   such: never a tested max or a training max.
 * - Tonnage (sets × reps × load) is reported for what it is, total weight
 *   moved, and never read as stimulus or fatigue.
 */
import { classifyExercise, type MovementPattern } from "@/lib/exercise-classifier";
import { comparableE1rm, effortOf, strengthTrend, type StrengthTrend } from "@/lib/analytics/strength-read";

export type Lift = "squat" | "bench" | "deadlift";
export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
export const LIFT_LABEL: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

/** Primary muscles are a full set, secondary half: transparent and the same everywhere. */
export const MUSCLE_CREDIT = { primary: 1, secondary: 0.5 } as const;
/** A hard set is RPE 7+ (RIR 3 or fewer). */
export const HARD_RPE = 7;
/** A heavy exposure of a competition lift: a top set rated RPE 8+ or within 85% of its best estimated max. */
export const HEAVY_RPE = 8;
export const HEAVY_PCT = 85;

export type ExerciseFacts = {
  exerciseId: string | null;
  exercise: string;
  /** exercises.muscle_groups (primary) and secondary_muscle_groups, snake_case or labels */
  primary: string[];
  secondary: string[];
  /** the legacy single label, read when no muscle tags exist */
  fallbackMuscle?: string | null;
  countsTowardVolume?: boolean;
  category?: string | null;
  /** the row's own movement family (squat / bench / deadlift / accessory), the coach's word */
  rowFamily?: string | null;
  competitionLiftType?: string | null;
  isCompetitionLift?: boolean;
  /** exercises.movement_family */
  exerciseFamily?: string | null;
  /** exercises.primary_movement_pattern (coarse) */
  dbPattern?: string | null;
};

export type LoadSet = ExerciseFacts & {
  /** yyyy-mm-dd, the athlete's own day */
  day: string;
  dayId: string | null;
  rowId: string | null;
  reps: number;
  /** external load in kg (0 for bodyweight / assisted) */
  loadKg: number;
  rpe: number | null;
  rir: number | null;
};

export type PlanRow = ExerciseFacts & {
  rowId: string;
  dayId: string;
  /** yyyy-mm-dd the workout is dated, null when it has no date */
  day: string | null;
  sets: number | null;
  repsText?: string | null;
  rpeText?: string | null;
  isTime?: boolean;
  /** the week's phase as the coach wrote it ("Deload", "Peak"…) */
  weekPhase?: string | null;
};

// ── classification ─────────────────────────────────────────────────────

/** The muscles a coach reads, finer than the athlete's 13 (delts by head, upper back apart from erectors). */
export const FINE_MUSCLES = [
  "Quads", "Hamstrings", "Glutes", "Adductors", "Calves",
  "Chest", "Lats", "Upper back", "Erectors",
  "Front delts", "Side delts", "Rear delts",
  "Biceps", "Triceps", "Forearms", "Abs",
] as const;
export type FineMuscle = (typeof FINE_MUSCLES)[number];

export function fineMuscle(tag: string | null | undefined): FineMuscle | null {
  if (!tag) return null;
  const s = String(tag).toLowerCase().replace(/_/g, " ").trim();
  if (!s || s === "other") return null;
  if (s.includes("rear delt") || s.includes("posterior delt")) return "Rear delts";
  if (s.includes("side delt") || s.includes("lateral delt") || s.includes("medial delt")) return "Side delts";
  if (s.includes("front delt") || s.includes("anterior delt")) return "Front delts";
  if (s.includes("delt") || s.includes("shoulder")) return "Side delts";
  if (s.includes("chest") || s.includes("pec")) return "Chest";
  if (s.includes("lat") && !s.includes("plat") && !s.includes("lateral")) return "Lats";
  if (s.includes("lower back") || s.includes("low back") || s.includes("erector") || s.includes("spinal")) return "Erectors";
  if (s.includes("upper back") || s.includes("mid back") || s.includes("trap") || s.includes("rhomb") || s === "back") return "Upper back";
  if (s.includes("bicep")) return "Biceps";
  if (s.includes("tricep")) return "Triceps";
  if (s.includes("forearm") || s.includes("grip")) return "Forearms";
  if (s.includes("quad")) return "Quads";
  if (s.includes("hamstring") || s === "hams") return "Hamstrings";
  if (s.includes("adductor") || s.includes("groin") || s.includes("inner thigh")) return "Adductors";
  if (s.includes("glute") || s.includes("abductor")) return "Glutes";
  if (s.includes("calf") || s.includes("calves")) return "Calves";
  if (s.includes("core") || s.includes("abs") || s.includes("oblique") || s.includes("abdom")) return "Abs";
  return null;
}

/** Every muscle a set credits and how much (primary 1, secondary ½, one credit per muscle). */
export function muscleCredits(f: Pick<ExerciseFacts, "primary" | "secondary" | "fallbackMuscle">): Map<FineMuscle, number> {
  const out = new Map<FineMuscle, number>();
  const add = (tag: string | null | undefined, w: number) => {
    const m = fineMuscle(tag);
    if (m) out.set(m, Math.max(out.get(m) ?? 0, w));
  };
  const primary = (f.primary ?? []).filter(Boolean);
  if (primary.length) {
    for (const t of primary) add(t, MUSCLE_CREDIT.primary);
    for (const t of f.secondary ?? []) add(t, MUSCLE_CREDIT.secondary);
  } else {
    add(f.fallbackMuscle ?? null, MUSCLE_CREDIT.primary);
  }
  return out;
}

export const PATTERNS = [
  "Squat", "Hip hinge", "Single-leg", "Knee extension", "Knee flexion", "Hip thrust",
  "Horizontal press", "Vertical press", "Horizontal pull", "Vertical pull",
  "Shoulder isolation", "Arms", "Trunk", "Calves", "Other",
] as const;
export type Pattern = (typeof PATTERNS)[number];

const FINE_TO_PATTERN: Partial<Record<MovementPattern, Pattern | null>> = {
  squat: "Squat",
  lunge: "Single-leg",
  hinge: "Hip hinge",
  back_extension: "Hip hinge",
  knee_extension: "Knee extension",
  knee_flexion: "Knee flexion",
  hip_thrust: "Hip thrust",
  hip_abduction: "Hip thrust",
  hip_adduction: "Other",
  hip_flexion: "Trunk",
  calf_raise: "Calves",
  horizontal_press: "Horizontal press",
  incline_press: "Horizontal press",
  dip: "Horizontal press",
  chest_fly: "Horizontal press",
  vertical_press: "Vertical press",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  pullover: "Vertical pull",
  shrug: "Other",
  rear_delt: "Shoulder isolation",
  lateral_raise: "Shoulder isolation",
  front_raise: "Shoulder isolation",
  elbow_flexion: "Arms",
  elbow_extension: "Arms",
  wrist: "Arms",
  core_flexion: "Trunk",
  core_anti_extension: "Trunk",
  core_rotation: "Trunk",
  core_lateral: "Trunk",
  // not strength volume
  carry: null,
  olympic: null,
  plyometric: null,
  conditioning: null,
  mobility: null,
  other: "Other",
};

const COARSE_TO_PATTERN: Record<string, Pattern | null> = {
  squat: "Squat",
  hip_hinge: "Hip hinge",
  knee_extension: "Knee extension",
  hamstring_curl: "Knee flexion",
  glutes: "Hip thrust",
  horizontal_push: "Horizontal press",
  vertical_push: "Vertical press",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  delts: "Shoulder isolation",
  arms: "Arms",
  core: "Trunk",
  conditioning: null,
  other: "Other",
};

/** The competition lift an exercise belongs to (its own variation included), else null. */
export function liftOf(f: Pick<ExerciseFacts, "rowFamily" | "competitionLiftType" | "exerciseFamily" | "exercise">): Lift | null {
  for (const v of [f.rowFamily, f.competitionLiftType, f.exerciseFamily]) {
    const s = String(v ?? "").toLowerCase();
    if (s === "squat" || s === "bench" || s === "deadlift") return s;
  }
  return null;
}

/** True when the exercise is the competition lift itself (not a variation). */
export function isCompetition(f: Pick<ExerciseFacts, "isCompetitionLift" | "competitionLiftType" | "exercise">): boolean {
  if (f.isCompetitionLift) return true;
  return /\bcompetition\b|\bcomp\b/i.test(f.exercise) && !!f.competitionLiftType;
}

const patternCache = new Map<string, Pattern | null>();
/** The movement pattern a set trains, from the exercise's name (the library's classifier), then its stored pattern. Null = not strength volume. */
export function patternOf(f: Pick<ExerciseFacts, "exercise" | "category" | "dbPattern" | "countsTowardVolume">): Pattern | null {
  if (f.countsTowardVolume === false) return null;
  const key = `${f.exercise}|${f.category ?? ""}|${f.dbPattern ?? ""}`;
  if (patternCache.has(key)) return patternCache.get(key)!;
  let p: Pattern | null = "Other";
  try {
    const fine = classifyExercise(f.exercise ?? "", f.category ?? null).pattern;
    p = FINE_TO_PATTERN[fine] === undefined ? "Other" : (FINE_TO_PATTERN[fine] as Pattern | null);
    if (p === "Other" && f.dbPattern && COARSE_TO_PATTERN[f.dbPattern] !== undefined) p = COARSE_TO_PATTERN[f.dbPattern];
  } catch {
    p = f.dbPattern && COARSE_TO_PATTERN[f.dbPattern] !== undefined ? COARSE_TO_PATTERN[f.dbPattern] : "Other";
  }
  if (patternCache.size > 5000) patternCache.clear();
  patternCache.set(key, p);
  return p;
}

// ── dates ───────────────────────────────────────────────────────────────

function dayNum(day: string): number {
  return Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;
}
function dayStr(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}
/** The Monday of a day's week, yyyy-mm-dd. */
export function weekOf(day: string): string {
  const n = dayNum(day);
  const dow = (new Date(n * 86_400_000).getUTCDay() + 6) % 7; // Monday 0
  return dayStr(n - dow);
}
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function shortDay(day: string): string {
  const n = dayNum(day);
  const d = new Date(n * 86_400_000);
  return `${DOW[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`;
}
function weekLabel(monday: string): string {
  const n = dayNum(monday);
  const a = new Date(n * 86_400_000);
  const b = new Date((n + 6) * 86_400_000);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${M[a.getUTCMonth()]} ${a.getUTCDate()} – ${b.getUTCDate()}`
    : `${M[a.getUTCMonth()]} ${a.getUTCDate()} – ${M[b.getUTCMonth()]} ${b.getUTCDate()}`;
}

/**
 * How a "per week" number is said: an average over the weeks that are over,
 * or, before a week is over, this week so far (never an average).
 */
export function perWeekWords(load: Pick<TrainingLoad, "perWeekBasis">): { label: string; unit: string; note: string } {
  const b = load.perWeekBasis;
  if (b.partial) return { label: "this week so far", unit: "this week", note: "No full week yet" };
  return {
    label: "a week",
    unit: "a week",
    note: `Average of ${b.weeks} full week${b.weeks === 1 ? "" : "s"}`,
  };
}

// ── the read ───────────────────────────────────────────────────────────

export type LiftWeek = { sets: number; sessions: number; heavy: number };

export type WeekLoad = {
  key: string;
  label: string;
  /** the week isn't over yet (it holds today) */
  current: boolean;
  /** the week hasn't started: only what's written for it (never part of an average) */
  future: boolean;
  phase: string | null;
  sets: number;
  hardSets: number;
  unratedSets: number;
  reps: number;
  tonnageKg: number;
  sessions: number;
  /** null when nothing was written for that week (no plan on file) */
  prescribed: number | null;
  completedOfPrescribed: number | null;
  missed: number | null;
  extra: number | null;
  muscles: Partial<Record<FineMuscle, number>>;
  patterns: Partial<Record<Pattern, number>>;
  lifts: Record<Lift, LiftWeek>;
};

export type MuscleLoad = {
  muscle: FineMuscle;
  /** credited sets per week over the weeks in range (complete weeks when there are any) */
  perWeek: number;
  /** of that, from exercises that list it as a primary muscle */
  directPerWeek: number;
  lastWeek: number;
  /** days a week with a set aimed at it (primary), averaged */
  frequency: number;
  /** the biggest share of a week's sets done in one session, averaged over weeks */
  topSessionShare: number | null;
  /** last 2 complete weeks against the 2 before, % (null with too little) */
  changePct: number | null;
};

export type PatternLoad = { pattern: Pattern; perWeek: number; lastWeek: number; changePct: number | null };

export type LiftLoad = {
  lift: Lift;
  /** sessions with the lift (or its variations) in the range */
  sessions: number;
  sessionsPerWeek: number;
  setsPerWeek: number;
  competitionSets: number;
  variationSets: number;
  heavyExposures: number;
  /** % of the best estimated max in range, of loaded sets */
  intensity: { lt70: number; b70: number; b80: number; ge90: number; unknown: number };
  reps: { r1: number; r2_3: number; r4_6: number; r7_10: number; r11: number };
  effort: { le6: number; r7: number; r8: number; ge9: number; unrated: number };
  avgRpe: number | null;
  bestE1rmKg: number | null;
  trend: StrengthTrend;
  /** working sets, later half of the range against the earlier half (%), null with too little */
  volumeChangePct: number | null;
};

export type DayLoad = {
  day: string;
  label: string;
  sets: number;
  hardSets: number;
  /** credited sets by muscle, the biggest first */
  muscles: Array<{ muscle: FineMuscle; sets: number }>;
  /** the competition lifts trained that day and how hard its top set was */
  lifts: Array<{ lift: Lift; sets: number; heavy: boolean; topRpe: number | null; topPct: number | null }>;
  /** credited sets to hamstrings, glutes and erectors */
  posteriorSets: number;
};

export type InsightTone = "good" | "info" | "watch";
export type Insight = {
  id: string;
  tone: InsightTone;
  /** what is happening, in one line */
  title: string;
  observation: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  /** why it might be happening (an interpretation, said as one) */
  explanation: string;
  /** what to look at or change */
  action: string;
  /** whether anything needs changing: often it doesn't */
  actionNeeded: boolean;
  /** only for the coach (program design), or for both */
  audience: "coach" | "both";
};

export type TrainingLoad = {
  weeks: WeekLoad[];
  /** weeks that are over (the averages read these when there are any) */
  completeWeeks: number;
  /**
   * What every "a week" number divides by: the weeks that are over, from the
   * first week with training or a written workout (weeks off in between count
   * as zero), never a week that hasn't happened. With none over yet it's this
   * week so far (`partial`), said as such, never an average.
   */
  perWeekBasis: { weeks: number; partial: boolean };
  totals: {
    sets: number;
    hardSets: number;
    unratedSets: number;
    reps: number;
    tonnageKg: number;
    sessions: number;
    setsPerWeek: number;
    prescribed: number | null;
    completedOfPrescribed: number | null;
    completionPct: number | null;
    /** workouts written for days that have passed, and how many of them have a logged set */
    plannedSessions: number | null;
    plannedSessionsDone: number | null;
  };
  muscles: MuscleLoad[];
  patterns: PatternLoad[];
  lifts: LiftLoad[];
  /** the latest week with 2+ sessions, day by day */
  distribution: { week: string; label: string; days: DayLoad[] } | null;
  quality: { ratedShare: number | null; untaggedShare: number | null; weeksWithData: number };
  insights: Insight[];
};

type Enriched = LoadSet & { week: string; lift: Lift | null; comp: boolean; pattern: Pattern | null; credits: Map<FineMuscle, number>; effort: number | null };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function pctChange(now: number, before: number): number | null {
  if (!(before > 0)) return null;
  return Math.round(((now - before) / before) * 100);
}
function emptyLifts(): Record<Lift, LiftWeek> {
  return { squat: { sets: 0, sessions: 0, heavy: 0 }, bench: { sets: 0, sessions: 0, heavy: 0 }, deadlift: { sets: 0, sessions: 0, heavy: 0 } };
}
function rpeOfText(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = String(t).match(/(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  return m[2] != null ? Number(m[2]) : Number(m[1]);
}

/**
 * The read. `today` (yyyy-mm-dd) decides which weeks are over and which
 * written workouts were missed rather than still ahead.
 */
export function buildTrainingLoad(input: {
  sets: LoadSet[];
  plan?: PlanRow[];
  today: string;
  /** the period read (yyyy-mm-dd): a week mostly outside it never counts as a week of training */
  range?: { start: string; end: string };
}): TrainingLoad {
  const today = input.today;
  const currentWeek = weekOf(today);
  const sets: Enriched[] = [];
  for (const s of input.sets ?? []) {
    if (!s?.day || !(s.reps > 0)) continue;
    const pattern = patternOf(s);
    if (pattern === null) continue; // conditioning, mobility: not strength volume
    sets.push({
      ...s,
      week: weekOf(s.day),
      lift: liftOf(s),
      comp: isCompetition(s),
      pattern,
      credits: muscleCredits(s),
      effort: effortOf({ rpe: s.rpe, rir: s.rir }),
    });
  }
  const plan = (input.plan ?? []).filter((p) => p.day && patternOf(p) !== null && !p.isTime);

  // best comparable e1RM per lift (relative intensity reads against it)
  const best: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
  for (const s of sets) {
    if (!s.lift) continue;
    const e = comparableE1rm({ load: s.loadKg, reps: s.reps, rpe: s.rpe, rir: s.rir });
    if (e && e > best[s.lift]) best[s.lift] = e;
  }
  const pctOfBest = (s: Enriched): number | null =>
    s.lift && best[s.lift] > 0 && s.loadKg > 0 ? (s.loadKg / best[s.lift]) * 100 : null;

  // ── weeks ──
  const weekKeys = new Set<string>();
  for (const s of sets) weekKeys.add(s.week);
  for (const p of plan) weekKeys.add(weekOf(p.day!));
  // A week with nothing logged and nothing written between two that have
  // something is still a week (a week off): it counts as zero, never skipped.
  const active = [...weekKeys].filter((k) => k <= currentWeek).sort();
  if (active.length) {
    for (let n = dayNum(active[0]); n < dayNum(active[active.length - 1]); n += 7) weekKeys.add(dayStr(n));
  }
  const keys = [...weekKeys].sort();
  const doneByRow = new Map<string, number>();
  for (const s of sets) if (s.rowId) doneByRow.set(s.rowId, (doneByRow.get(s.rowId) ?? 0) + 1);

  const weeks: WeekLoad[] = keys.map((key) => {
    const ws = sets.filter((s) => s.week === key);
    const days = new Set(ws.map((s) => s.dayId ?? s.day));
    const muscles: Partial<Record<FineMuscle, number>> = {};
    const patterns: Partial<Record<Pattern, number>> = {};
    const lifts = emptyLifts();
    let hard = 0;
    let unrated = 0;
    let reps = 0;
    let tonnage = 0;
    for (const s of ws) {
      if (s.effort == null) unrated++;
      else if (s.effort >= HARD_RPE) hard++;
      reps += s.reps;
      tonnage += s.loadKg * s.reps;
      for (const [m, w] of s.credits) muscles[m] = (muscles[m] ?? 0) + w;
      if (s.pattern) patterns[s.pattern] = (patterns[s.pattern] ?? 0) + 1;
      if (s.lift) lifts[s.lift].sets++;
    }
    for (const lift of LIFTS) {
      const sessions = new Map<string, Enriched[]>();
      for (const s of ws) if (s.lift === lift) {
        const k = s.dayId ?? s.day;
        sessions.set(k, [...(sessions.get(k) ?? []), s]);
      }
      lifts[lift].sessions = sessions.size;
      lifts[lift].heavy = [...sessions.values()].filter((ss) => isHeavySession(ss, pctOfBest)).length;
    }
    const wp = plan.filter((p) => weekOf(p.day!) === key);
    let prescribed: number | null = null;
    let completed: number | null = null;
    let missed: number | null = null;
    let extra: number | null = null;
    if (wp.length) {
      prescribed = 0;
      completed = 0;
      missed = 0;
      extra = 0;
      for (const p of wp) {
        const want = Math.max(0, Number(p.sets) || 0);
        const did = doneByRow.get(p.rowId) ?? 0;
        prescribed += want;
        completed += Math.min(want, did);
        extra += Math.max(0, did - want);
        if (p.day! < today) missed += Math.max(0, want - did);
      }
    }
    const phase = wp.find((p) => p.weekPhase)?.weekPhase ?? null;
    return {
      key,
      label: weekLabel(key),
      current: key === currentWeek,
      future: key > currentWeek,
      phase,
      sets: ws.length,
      hardSets: hard,
      unratedSets: unrated,
      reps,
      tonnageKg: Math.round(tonnage),
      sessions: days.size,
      prescribed,
      completedOfPrescribed: completed,
      missed,
      extra,
      muscles,
      patterns,
      lifts,
    };
  });

  const done = weeks.filter((w) => !w.current && w.key < currentWeek);
  // Averages read the weeks that are over; a week the period barely touches
  // (a block starting on a Sunday) isn't a week of training. With none over
  // yet, this week so far, said as such. Never a week that hasn't happened:
  // dividing this week's sets by the block's four weeks read 37 sets as 9.3 a week.
  const inRange = (w: WeekLoad) => {
    if (!input.range) return true;
    const a = Math.max(dayNum(w.key), dayNum(input.range.start));
    const b = Math.min(dayNum(w.key) + 6, dayNum(input.range.end), dayNum(today));
    return b - a + 1 >= 4;
  };
  const counted = done.filter(inRange);
  const partial = counted.length === 0;
  const thisWeek = weeks.filter((w) => w.current);
  const basis = !partial ? counted : thisWeek.length ? thisWeek : done;
  const n = Math.max(1, basis.length);
  const lastDone = done[done.length - 1] ?? null;

  // ── totals ──
  const totals = {
    sets: sets.length,
    hardSets: sets.filter((s) => s.effort != null && s.effort >= HARD_RPE).length,
    unratedSets: sets.filter((s) => s.effort == null).length,
    reps: sets.reduce((a, s) => a + s.reps, 0),
    tonnageKg: Math.round(sets.reduce((a, s) => a + s.loadKg * s.reps, 0)),
    sessions: new Set(sets.map((s) => s.dayId ?? s.day)).size,
    setsPerWeek: round1(basis.reduce((a, w) => a + w.sets, 0) / n),
    prescribed: null as number | null,
    completedOfPrescribed: null as number | null,
    completionPct: null as number | null,
    plannedSessions: null as number | null,
    plannedSessionsDone: null as number | null,
  };
  // completion reads only weeks that are over or days that have passed
  const pastPlan = plan.filter((p) => p.day! < today);
  if (pastPlan.length) {
    let want = 0;
    let got = 0;
    for (const p of pastPlan) {
      const w = Math.max(0, Number(p.sets) || 0);
      want += w;
      got += Math.min(w, doneByRow.get(p.rowId) ?? 0);
    }
    totals.prescribed = want;
    totals.completedOfPrescribed = got;
    totals.completionPct = want > 0 ? Math.round((got / want) * 100) : null;
    const trainedDays = new Set(sets.map((x) => x.dayId).filter(Boolean));
    const plannedDays = new Set(pastPlan.map((p) => p.dayId));
    totals.plannedSessions = plannedDays.size;
    totals.plannedSessionsDone = [...plannedDays].filter((d) => trainedDays.has(d)).length;
  }

  // ── muscles ──
  const muscles: MuscleLoad[] = [];
  for (const m of FINE_MUSCLES) {
    const perWeek = basis.reduce((a, w) => a + (w.muscles[m] ?? 0), 0) / n;
    if (perWeek <= 0 && !(lastDone?.muscles[m])) continue;
    const direct = sets.filter((s) => s.credits.get(m) === MUSCLE_CREDIT.primary && basis.some((w) => w.key === s.week)).length / n;
    const freq: number[] = [];
    const shares: number[] = [];
    for (const w of basis) {
      const ws = sets.filter((s) => s.week === w.key && s.credits.has(m));
      const byDay = new Map<string, number>();
      for (const s of ws) byDay.set(s.dayId ?? s.day, (byDay.get(s.dayId ?? s.day) ?? 0) + (s.credits.get(m) ?? 0));
      freq.push(new Set(ws.filter((s) => s.credits.get(m) === MUSCLE_CREDIT.primary).map((s) => s.dayId ?? s.day)).size);
      const tot = [...byDay.values()].reduce((a, b) => a + b, 0);
      if (tot >= 4) shares.push(Math.max(...byDay.values()) / tot);
    }
    const lastTwo = done.slice(-2);
    const prevTwo = done.slice(-4, -2);
    const change = lastTwo.length === 2 && prevTwo.length === 2
      ? pctChange(lastTwo.reduce((a, w) => a + (w.muscles[m] ?? 0), 0), prevTwo.reduce((a, w) => a + (w.muscles[m] ?? 0), 0))
      : null;
    muscles.push({
      muscle: m,
      perWeek: round1(perWeek),
      directPerWeek: round1(direct),
      lastWeek: round1(lastDone?.muscles[m] ?? weeks[weeks.length - 1]?.muscles[m] ?? 0),
      frequency: round1(freq.reduce((a, b) => a + b, 0) / Math.max(1, freq.length)),
      topSessionShare: shares.length ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 100) / 100 : null,
      changePct: change,
    });
  }
  muscles.sort((a, b) => b.perWeek - a.perWeek);

  // ── patterns ──
  const patterns: PatternLoad[] = [];
  for (const p of PATTERNS) {
    const perWeek = basis.reduce((a, w) => a + (w.patterns[p] ?? 0), 0) / n;
    if (perWeek <= 0) continue;
    const lastTwo = done.slice(-2);
    const prevTwo = done.slice(-4, -2);
    patterns.push({
      pattern: p,
      perWeek: round1(perWeek),
      lastWeek: lastDone?.patterns[p] ?? 0,
      changePct: lastTwo.length === 2 && prevTwo.length === 2
        ? pctChange(lastTwo.reduce((a, w) => a + (w.patterns[p] ?? 0), 0), prevTwo.reduce((a, w) => a + (w.patterns[p] ?? 0), 0))
        : null,
    });
  }
  patterns.sort((a, b) => b.perWeek - a.perWeek);

  // ── the competition lifts ──
  const lifts: LiftLoad[] = [];
  for (const lift of LIFTS) {
    const ls = sets.filter((s) => s.lift === lift);
    if (!ls.length) continue;
    const intensity = { lt70: 0, b70: 0, b80: 0, ge90: 0, unknown: 0 };
    const reps = { r1: 0, r2_3: 0, r4_6: 0, r7_10: 0, r11: 0 };
    const effort = { le6: 0, r7: 0, r8: 0, ge9: 0, unrated: 0 };
    let rpeSum = 0;
    let rpeN = 0;
    for (const s of ls) {
      const pct = pctOfBest(s);
      if (pct == null) intensity.unknown++;
      else if (pct < 70) intensity.lt70++;
      else if (pct < 80) intensity.b70++;
      else if (pct < 90) intensity.b80++;
      else intensity.ge90++;
      if (s.reps <= 1) reps.r1++;
      else if (s.reps <= 3) reps.r2_3++;
      else if (s.reps <= 6) reps.r4_6++;
      else if (s.reps <= 10) reps.r7_10++;
      else reps.r11++;
      if (s.effort == null) effort.unrated++;
      else {
        rpeSum += s.effort;
        rpeN++;
        if (s.effort < 7) effort.le6++;
        else if (s.effort < 8) effort.r7++;
        else if (s.effort < 9) effort.r8++;
        else effort.ge9++;
      }
    }
    const sessions = new Map<string, Enriched[]>();
    for (const s of ls) {
      const k = s.dayId ?? s.day;
      sessions.set(k, [...(sessions.get(k) ?? []), s]);
    }
    const points: Array<{ date: string; value: number }> = [];
    for (const ss of sessions.values()) {
      const comp = ss.filter((s) => s.comp);
      const pool = comp.length ? comp : ss;
      const vals = pool.map((s) => comparableE1rm({ load: s.loadKg, reps: s.reps, rpe: s.rpe, rir: s.rir }) ?? 0).filter((v) => v > 0);
      if (vals.length) points.push({ date: ss[0].day, value: Math.max(...vals) });
    }
    const liftWeeks = basis.map((w) => w.lifts[lift]);
    const half = Math.floor(basis.length / 2);
    const early = basis.slice(0, half).reduce((a, w) => a + w.lifts[lift].sets, 0) / Math.max(1, half);
    const late = basis.slice(half).reduce((a, w) => a + w.lifts[lift].sets, 0) / Math.max(1, basis.length - half);
    lifts.push({
      lift,
      sessions: sessions.size,
      sessionsPerWeek: round1(liftWeeks.reduce((a, w) => a + w.sessions, 0) / n),
      setsPerWeek: round1(liftWeeks.reduce((a, w) => a + w.sets, 0) / n),
      competitionSets: ls.filter((s) => s.comp).length,
      variationSets: ls.filter((s) => !s.comp).length,
      heavyExposures: [...sessions.values()].filter((ss) => isHeavySession(ss, pctOfBest)).length,
      intensity,
      reps,
      effort,
      avgRpe: rpeN ? round1(rpeSum / rpeN) : null,
      bestE1rmKg: best[lift] > 0 ? Math.round(best[lift] * 10) / 10 : null,
      trend: strengthTrend(points),
      volumeChangePct: basis.length >= 4 ? pctChange(late, early) : null,
    });
  }

  // ── the week, day by day ──
  let distribution: TrainingLoad["distribution"] = null;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (weeks[i].sessions >= 2) {
      distribution = { week: weeks[i].key, label: weeks[i].label, days: daysOf(sets.filter((s) => s.week === weeks[i].key), pctOfBest) };
      break;
    }
  }

  const rated = sets.length ? sets.filter((s) => s.effort != null).length / sets.length : null;
  const untagged = sets.length ? sets.filter((s) => s.credits.size === 0).length / sets.length : null;
  const load: TrainingLoad = {
    weeks,
    completeWeeks: done.length,
    perWeekBasis: { weeks: partial ? 0 : basis.length, partial },
    totals,
    muscles,
    patterns,
    lifts,
    distribution,
    quality: {
      ratedShare: rated == null ? null : Math.round(rated * 100) / 100,
      untaggedShare: untagged == null ? null : Math.round(untagged * 100) / 100,
      weeksWithData: weeks.filter((w) => w.sets > 0).length,
    },
    insights: [],
  };
  load.insights = buildInsights(load, sets, plan, today);
  return load;
}

function isHeavySession(ss: Enriched[], pctOfBest: (s: Enriched) => number | null): boolean {
  return ss.some((s) => (s.effort != null && s.effort >= HEAVY_RPE && s.reps <= 6) || ((pctOfBest(s) ?? 0) >= HEAVY_PCT));
}

function daysOf(ws: Enriched[], pctOfBest: (s: Enriched) => number | null): DayLoad[] {
  const byDay = new Map<string, Enriched[]>();
  for (const s of ws) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ss]) => {
      const m = new Map<FineMuscle, number>();
      for (const s of ss) for (const [k, w] of s.credits) m.set(k, (m.get(k) ?? 0) + w);
      const lifts: DayLoad["lifts"] = [];
      for (const lift of LIFTS) {
        const ls = ss.filter((s) => s.lift === lift);
        if (!ls.length) continue;
        const efforts = ls.map((s) => s.effort).filter((e): e is number => e != null);
        const pcts = ls.map((s) => pctOfBest(s)).filter((p): p is number => p != null);
        lifts.push({
          lift,
          sets: ls.length,
          heavy: isHeavySession(ls, pctOfBest),
          topRpe: efforts.length ? Math.max(...efforts) : null,
          topPct: pcts.length ? Math.round(Math.max(...pcts)) : null,
        });
      }
      return {
        day,
        label: shortDay(day),
        sets: ss.length,
        hardSets: ss.filter((s) => s.effort != null && s.effort >= HARD_RPE).length,
        muscles: [...m.entries()].map(([muscle, sets]) => ({ muscle, sets: round1(sets) })).sort((a, b) => b.sets - a.sets),
        lifts,
        posteriorSets: round1((m.get("Hamstrings") ?? 0) + (m.get("Glutes") ?? 0) + (m.get("Erectors") ?? 0)),
      };
    });
}

// ── insights: only what the data supports, the smallest useful set ──

const INSIGHT_LIMIT = 5;

function buildInsights(load: TrainingLoad, sets: Enriched[], plan: PlanRow[], today: string): Insight[] {
  const out: Insight[] = [];
  const done = load.weeks.filter((w) => !w.current && w.key < weekOf(today));
  const ratedShare = load.quality.ratedShare ?? 0;

  // 1. completion before anything else: execution vs programming
  const t = load.totals;
  if (t.prescribed != null && t.prescribed >= 20 && t.completionPct != null && t.completionPct < 80) {
    out.push({
      id: "completion",
      tone: "watch",
      title: `${t.completionPct}% of prescribed sets done`,
      observation: `${t.completedOfPrescribed} of ${t.prescribed} sets written on past workouts were logged.`,
      evidence: done.slice(-4).filter((w) => w.prescribed).map((w) => `${w.label}: ${w.completedOfPrescribed}/${w.prescribed} sets`),
      confidence: t.prescribed >= 60 ? "high" : "medium",
      explanation: "Missed sets usually come from time, schedule or recovery, not from the program being wrong. Read the trends below as what was actually done.",
      action: "Find out why sets are being missed before changing volume or intensity: fix execution first, then judge the program.",
      actionNeeded: true,
      audience: "both",
    });
  }

  // 2. strength against volume, lift by lift
  for (const l of load.lifts) {
    if (l.trend.kind === "unclear" || l.volumeChangePct == null) continue;
    const name = LIFT_LABEL[l.lift];
    if (l.volumeChangePct >= 20 && (l.trend.kind === "steady" || l.trend.kind === "down")) {
      out.push({
        id: `volume-no-strength-${l.lift}`,
        tone: "watch",
        title: `${name} volume up ${l.volumeChangePct}%, strength ${l.trend.kind === "down" ? `down ${Math.abs(l.trend.pct)}%` : "flat"}`,
        observation: `${name} working sets rose ${l.volumeChangePct}% from the first half of this range to the second while the estimated max ${l.trend.kind === "down" ? `fell ${Math.abs(l.trend.pct)}%` : "held steady"}.`,
        evidence: [`${l.setsPerWeek} ${name.toLowerCase()} sets a week`, `Estimated max ${Math.round(l.trend.first)} → ${Math.round(l.trend.last)} kg over ${l.trend.sessions} comparable sessions`],
        confidence: l.trend.sessions >= 6 ? "medium" : "low",
        explanation: "More work isn't turning into more strength right now. It may be accumulated fatigue, recovery, the exercise selection, or simply a block that hasn't peaked yet. This is a correlation, not proof.",
        action: "Review exercise selection, recovery and how the sets are spread across the week before adding more.",
        actionNeeded: true,
        audience: "coach",
      });
    } else if (l.trend.kind === "up" && Math.abs(l.volumeChangePct) <= 10) {
      out.push({
        id: `progress-stable-${l.lift}`,
        tone: "good",
        title: `${name} improving on stable volume`,
        observation: `${name} estimated max up ${l.trend.pct}% while weekly sets ${Math.abs(l.volumeChangePct) <= 2 ? "held steady" : `stayed within ${Math.abs(l.volumeChangePct)}%`}.`,
        evidence: [`${l.setsPerWeek} ${name.toLowerCase()} sets a week`, `${l.trend.sessions} comparable sessions over ${l.trend.days} days`],
        confidence: l.trend.sessions >= 6 ? "high" : "medium",
        explanation: "The current dose is working.",
        action: "No increase is needed while it keeps progressing.",
        actionNeeded: false,
        audience: "both",
      });
    } else if (l.trend.kind === "down" && l.volumeChangePct <= -20) {
      out.push({
        id: `less-volume-down-${l.lift}`,
        tone: "info",
        title: `${name} down ${Math.abs(l.trend.pct)}% with ${Math.abs(l.volumeChangePct)}% less volume`,
        observation: `${name} sets fell ${Math.abs(l.volumeChangePct)}% and the estimated max dropped ${Math.abs(l.trend.pct)}%.`,
        evidence: [`${l.setsPerWeek} ${name.toLowerCase()} sets a week`],
        confidence: "low",
        explanation: "Planned lower volume (a deload or taper) often reads this way for a week or two; missed sessions do too.",
        action: "If the drop wasn't planned, check completion and recovery before reading it as lost strength.",
        actionNeeded: false,
        audience: "coach",
      });
    }
  }

  // 3. a big jump or drop in the week's workload
  if (done.length >= 4) {
    const last = done[done.length - 1];
    const prev = done.slice(-4, -1);
    const avg = prev.reduce((a, w) => a + w.sets, 0) / prev.length;
    const change = pctChange(last.sets, avg);
    const deload = /deload|taper|recovery|pivot/i.test(last.phase ?? "");
    if (avg >= 10 && change != null && change >= 25) {
      out.push({
        id: "week-jump",
        tone: "watch",
        title: `Last week's workload up ${change}%`,
        observation: `${last.sets} working sets in ${last.label}, against ${Math.round(avg)} a week the 3 weeks before.`,
        evidence: prev.concat(last).map((w) => `${w.label}: ${w.sets} sets`),
        confidence: "medium",
        explanation: "Big week-to-week jumps are where fatigue and aches tend to show up, more than steady high volume does.",
        action: "If it was planned, watch performance and soreness this week; if it wasn't, bring it back toward the usual dose.",
        actionNeeded: false,
        audience: "coach",
      });
    }
    // a planned deload that didn't lighten anything
    if (deload && avg >= 10 && last.sets >= avg * 0.85) {
      out.push({
        id: "deload-not-lighter",
        tone: "watch",
        title: "The deload week wasn't lighter",
        observation: `${last.label} is marked ${last.phase} but had ${last.sets} working sets, ${Math.round((last.sets / avg) * 100)}% of the usual ${Math.round(avg)}.`,
        evidence: [`${last.hardSets} hard sets that week`],
        confidence: "medium",
        explanation: "A deload that keeps the sets usually keeps the fatigue.",
        action: "Cut sets (roughly a third to a half) or intensity in the deload weeks.",
        actionNeeded: true,
        audience: "coach",
      });
    }
  }

  // 4. squat and deadlift heavy within 48 hours (a fact to judge, never a rule)
  if (load.distribution) {
    const heavyDays = load.distribution.days.filter((d) => d.lifts.some((l) => (l.lift === "squat" || l.lift === "deadlift") && l.heavy));
    for (let i = 1; i < heavyDays.length; i++) {
      const a = heavyDays[i - 1];
      const b = heavyDays[i];
      const gap = dayNum(b.day) - dayNum(a.day);
      const aLifts = a.lifts.filter((l) => l.heavy && l.lift !== "bench").map((l) => l.lift);
      const bLifts = b.lifts.filter((l) => l.heavy && l.lift !== "bench").map((l) => l.lift);
      const pair = new Set([...aLifts, ...bLifts]);
      if (gap <= 2 && pair.has("squat") && pair.has("deadlift")) {
        out.push({
          id: "heavy-lower-close",
          tone: "info",
          title: "Heavy squat and deadlift within 48 hours",
          observation: `${a.label} (${aLifts.map((l) => LIFT_LABEL[l]).join(" + ")}) and ${b.label} (${bLifts.map((l) => LIFT_LABEL[l]).join(" + ")}) were both heavy lower-body days ${gap === 1 ? "back to back" : "two days apart"}.`,
          evidence: [`${a.label}: ${a.posteriorSets} posterior-chain sets`, `${b.label}: ${b.posteriorSets} posterior-chain sets`],
          confidence: "medium",
          explanation: "Many programs do this on purpose. It matters only if the second session's performance or the lower back's recovery suffers.",
          action: "Check how the second session went. If its top sets ran harder than written, spacing them out is the first thing to try.",
          actionNeeded: false,
          audience: "coach",
        });
        break;
      }
    }
  }

  // 5. one muscle's week in one session
  for (const m of load.muscles) {
    if (m.perWeek >= 10 && m.topSessionShare != null && m.topSessionShare >= 0.75 && m.frequency <= 1.2) {
      out.push({
        id: `concentrated-${m.muscle}`,
        tone: "info",
        title: `${m.muscle}: ${Math.round(m.topSessionShare * 100)}% of the week in one session`,
        observation: `About ${m.perWeek} sets a week credited to ${m.muscle.toLowerCase()}, nearly all of it on one day.`,
        evidence: [`Trained about ${m.frequency}× a week`],
        confidence: load.completeWeeks >= 3 ? "medium" : "low",
        explanation: "Past roughly 6–8 hard sets for a muscle in one session, later sets add less. Splitting the same sets over two days usually gets more out of them.",
        action: "If this muscle matters for the goal, move part of it to a second day rather than adding sets.",
        actionNeeded: false,
        audience: "coach",
      });
      break;
    }
  }

  // 6. sets running harder than written
  const rated = sets.filter((s) => s.rowId && s.effort != null && s.day >= dayStr(dayNum(today) - 21));
  const target = new Map(plan.map((p) => [p.rowId, rpeOfText(p.rpeText)]));
  const compared = rated.filter((s) => target.get(s.rowId!) != null);
  if (compared.length >= 8) {
    const over = compared.filter((s) => (s.effort ?? 0) >= (target.get(s.rowId!) ?? 99) + 1).length;
    const share = over / compared.length;
    if (share >= 0.35) {
      out.push({
        id: "rpe-overshoot",
        tone: "watch",
        title: `${Math.round(share * 100)}% of sets rated a point or more over target`,
        observation: `${over} of ${compared.length} rated sets in the last 3 weeks came in at least 1 RPE above the top of what was written.`,
        evidence: [],
        confidence: compared.length >= 20 ? "high" : "medium",
        explanation: "The loads may be a little ahead of the athlete right now, or the ratings are conservative. Either way the written effort isn't what's being done.",
        action: "Check that loads follow the RPE (lighter when sets run hard) rather than raising the targets.",
        actionNeeded: true,
        audience: "both",
      });
    }
  }

  // 7. what the read can't see
  if (load.totals.sets >= 20 && ratedShare < 0.5) {
    out.push({
      id: "unrated",
      tone: "info",
      title: `Only ${Math.round(ratedShare * 100)}% of sets have an RPE`,
      observation: `${load.totals.unratedSets} of ${load.totals.sets} working sets were logged without an RPE or RIR.`,
      evidence: [],
      confidence: "high",
      explanation: "Hard sets, intensity and strength trends read only rated sets, so they're thin here.",
      action: "Ask for an RPE on top sets at least.",
      actionNeeded: false,
      audience: "both",
    });
  }
  if ((load.quality.untaggedShare ?? 0) >= 0.15) {
    out.push({
      id: "untagged",
      tone: "info",
      title: `${Math.round((load.quality.untaggedShare ?? 0) * 100)}% of sets have no muscle tagged`,
      observation: "Those sets count toward totals but not toward any muscle.",
      evidence: [],
      confidence: "high",
      explanation: "The exercises have no muscle groups in the library.",
      action: "Tag those exercises in the exercise library.",
      actionNeeded: false,
      audience: "coach",
    });
  }

  // nothing to flag is itself the answer
  if (!out.some((i) => i.tone !== "good") && load.completeWeeks >= 3 && (load.totals.completionPct ?? 100) >= 80) {
    out.push({
      id: "steady",
      tone: "good",
      title: "Steady, complete training",
      observation: `${load.totals.setsPerWeek} working sets a week${load.totals.completionPct != null ? `, ${load.totals.completionPct}% of what was written done` : ""}, with no big swings.`,
      evidence: [],
      confidence: "medium",
      explanation: "Steady, complete training is what progress is built on.",
      action: "Keep going.",
      actionNeeded: false,
      audience: "both",
    });
  }

  const rank: Record<InsightTone, number> = { watch: 0, info: 1, good: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, INSIGHT_LIMIT);
}

// ── text for the AI brief ────────────────────────────────────────────────

/**
 * The read as plain lines for a model: what was done, where it went, how it
 * moved, the flags with their confidence. Facts as facts, interpretations
 * marked, and the reminder that a flag is not an instruction.
 */
export function trainingLoadText(load: TrainingLoad): string {
  if (!load.totals.sets) return "";
  const lines: string[] = [];
  const t = load.totals;
  lines.push(`Working sets: ${t.sets} over ${load.quality.weeksWithData} week(s), ${t.setsPerWeek}/week; hard (RPE 7+) ${t.hardSets}, unrated ${t.unratedSets} (${Math.round((load.quality.ratedShare ?? 0) * 100)}% rated).`);
  if (t.completionPct != null) lines.push(`Prescribed vs completed (past workouts): ${t.completedOfPrescribed}/${t.prescribed} sets (${t.completionPct}%).`);
  const recent = load.weeks.slice(-6).map((w) => `${w.label}${w.phase ? ` [${w.phase}]` : ""}${w.current ? " (in progress)" : ""}: ${w.sets} sets${w.prescribed != null ? ` of ${w.prescribed} written` : ""}, ${w.sessions} sessions`);
  if (recent.length) lines.push(`By week: ${recent.join("; ")}.`);
  const mus = load.muscles.slice(0, 12).map((m) => `${m.muscle} ${m.perWeek}/wk (direct ${m.directPerWeek}, ${m.frequency}×/wk${m.topSessionShare != null ? `, biggest session ${Math.round(m.topSessionShare * 100)}%` : ""}${m.changePct != null ? `, ${m.changePct >= 0 ? "+" : ""}${m.changePct}% last 2 wk` : ""})`);
  if (mus.length) lines.push(`Sets credited per muscle (primary 1, secondary 0.5): ${mus.join("; ")}.`);
  const pat = load.patterns.slice(0, 10).map((p) => `${p.pattern} ${p.perWeek}/wk`);
  if (pat.length) lines.push(`By movement pattern: ${pat.join("; ")}.`);
  for (const l of load.lifts) {
    const total = l.intensity.lt70 + l.intensity.b70 + l.intensity.b80 + l.intensity.ge90;
    const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "–");
    lines.push(
      `${LIFT_LABEL[l.lift]}: ${l.sessionsPerWeek} sessions/wk, ${l.setsPerWeek} sets/wk (competition ${l.competitionSets}, variations ${l.variationSets}), heavy exposures ${l.heavyExposures}, avg RPE ${l.avgRpe ?? "unrated"}; intensity vs best estimated max in range <70% ${pct(l.intensity.lt70)}, 70s ${pct(l.intensity.b70)}, 80s ${pct(l.intensity.b80)}, 90+ ${pct(l.intensity.ge90)}; strength trend ${l.trend.kind === "unclear" ? "too early to call" : `${l.trend.kind} ${l.trend.pct}%`}${l.volumeChangePct != null ? `; volume ${l.volumeChangePct >= 0 ? "+" : ""}${l.volumeChangePct}% later vs earlier` : ""}.`,
    );
  }
  if (load.distribution) {
    const days = load.distribution.days.map((d) => `${d.label}: ${d.sets} sets${d.lifts.length ? ` (${d.lifts.map((l) => `${LIFT_LABEL[l.lift]}${l.heavy ? " heavy" : ""}`).join(", ")})` : ""}, posterior chain ${d.posteriorSets}`);
    lines.push(`Week of ${load.distribution.label}, day by day: ${days.join("; ")}.`);
  }
  for (const i of load.insights) {
    lines.push(`Flag (${i.tone}, ${i.confidence} confidence${i.actionNeeded ? "" : ", no change required"}): ${i.title}. ${i.observation} Possible reason (hypothesis): ${i.explanation} Coaching action: ${i.action}`);
  }
  return lines.join("\n");
}

export const TRAINING_LOAD_DEFINITIONS = [
  ["Working set", "A logged set with reps. Warm-ups never count; stretches and conditioning are left out."],
  ["Hard set", "A working set rated RPE 7 or more (3 or fewer reps in reserve). Sets with no rating are counted apart."],
  ["Sets per muscle", "Each exercise's primary muscles get a full set, its secondary muscles half. One credit per muscle per set, so nothing is counted twice. An estimate of where work went, not a measurement."],
  ["Prescribed vs done", "Prescribed is what was written on workouts dated in the range; done counts logged sets up to what was written; missed is what was written on a past day and not logged."],
  ["Relative intensity", "A set's load as a % of the best estimated max that lift showed in this range (from sets rated RPE 7+ of 10 reps or fewer). Not a tested max or a training max."],
  ["Heavy exposure", "A session of a competition lift (or its variations) with a top set rated RPE 8+ for 6 reps or fewer, or at 85%+ of its best estimated max."],
  ["Tonnage", "Sets × reps × load: total weight moved. Not a measure of muscle growth or fatigue."],
] as const;
