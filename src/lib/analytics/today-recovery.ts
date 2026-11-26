/**
 * Today's recovery, read for TODAY's workout (pure, deterministic, tested in
 * today-recovery.test.ts). The Workouts page's Recovery & Performance section
 * and its full-screen body read it; nothing here is a model.
 *
 * What it reads, each only when it's on file:
 *  - every logged set of the last 6 weeks: which muscles it trained (training-
 *    load's `muscleCredits`: primary 1, secondary ½), how hard (RPE) and how
 *    long ago; fatigue fades by the hour, faster for small muscles;
 *  - the muscles TODAY's planned workout leans on (its rows × sets), so tired
 *    quads don't drag down an upper-body day; a rest day reads every muscle;
 *  - the last check-out (sleep the night before, how recovered they felt,
 *    fatigue, the session's RPE), a device's sleep, a recent energy rating,
 *    cardio in the last two days, this week's load against their usual, and
 *    how long since they last trained;
 *  - what the athlete reported (pain_reports), each read for its kind
 *    (pain/symptoms.ts) and handled once, never twice:
 *      · pain, joint or tendon discomfort and numbness or tingling on a muscle
 *        today's workout uses cap the score (a high score never hides one) and
 *        are always listed;
 *      · training soreness, tightness and tired muscles confirm the fatigue the
 *        log already estimates: the muscle reads at least "moderate", never a
 *        second penalty on top of the same training;
 *      · a general symptom (a headache, dizziness, nausea, feeling unwell) is
 *        never put on a muscle or counted as fatigue: it's listed apart and
 *        changes the status, never the number.
 *    A check-out's pain flag with no report behind it is still a flag.
 *
 * Audit (Nov 26 2026): a check-out's "how recovered" and "fatigued" are one
 * subjective read (one factor, recovered first); a very hard session lowers
 * the score only when its sets weren't rated (rated sets already carry their
 * effort into each muscle); a heavy week counts half when today's muscles
 * already carry that work; how much of today's workout has history
 * (`coverage`) and what wasn't on file (`missing`) set the confidence.
 *
 * Each muscle's fatigue is measured against the athlete's OWN typical session
 * for that muscle (the median dose on the days they trained it), never a
 * universal number. Too little data is said as such (score null), never a
 * guessed score: no training in the last 14 days, fewer than 2 training days in
 * 3 weeks without a fresh check-out, or nothing logged for today's muscles.
 * The score is an estimate; `basis` says whether something logged about today
 * (a fresh check-out or a device's sleep) went into it ("measured") or only the
 * training log did ("estimated"), and every factor carries its own kind.
 */
import { muscleCredits, FINE_MUSCLES, type FineMuscle } from "@/lib/analytics/training-load";
import { sleepBucketHours, sleepBucketLabel, type SleepBucket } from "@/lib/analytics/recovery-score";
import { muscleOfSite } from "@/lib/body3d/muscle-sites";
import { confirmsFatigue, generalLabel, generalOf, generalSymptomsIn, limitsTraining, symptomClass, type SymptomClass } from "@/lib/pain/symptoms";
import { NON_TRAINING_REGIONS, areaLabel } from "@/lib/pain/regions";
import { siteLabel } from "@/lib/pain/sites";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Big muscles take longer to recover than small ones (hours for fatigue to fall to ~37%). */
const BIG: ReadonlySet<FineMuscle> = new Set<FineMuscle>([
  "Quads", "Hamstrings", "Glutes", "Adductors", "Erectors", "Chest", "Lats", "Upper back",
]);
export const TAU_BIG_H = 40;
export const TAU_SMALL_H = 28;
/** How far back a set can still carry fatigue, and how far back the athlete's own typical dose is read. */
export const FATIGUE_WINDOW_DAYS = 7;
export const BASELINE_DAYS = 42;
/** A muscle's state from fatigue ÷ its typical session dose. */
export const RECOVERED_BELOW = 0.35;
export const MODERATE_BELOW = 0.75;
/** Score bands. */
export const READY_FROM = 75;
export const MODERATE_FROM = 55;
/** A pain flag caps the score: any pain on today's muscles, and a severe one lower. */
export const PAIN_CAP = 60;
export const SEVERE_PAIN_CAP = 45;
/** Pain reported within this many days is active. */
export const PAIN_ACTIVE_DAYS = 14;
/** Soreness, tightness or tired muscles reported within this many days confirm fatigue. */
export const REPORTED_FATIGUE_DAYS = 3;
/** A general symptom (a headache, dizziness…) is today's news for this many days. */
export const GENERAL_ACTIVE_DAYS = 2;
/** A reported soreness reads at least this much fatigue (just inside "moderate"). */
export const REPORTED_RATIO = 0.4;
/** Under this share of today's workout on muscles with history: low confidence. */
export const LOW_COVERAGE = 0.5;
/** No training for this long: nothing to recover from, so no score. */
export const BREAK_DAYS = 14;

export type RecoveryState = "recovered" | "moderate" | "elevated" | "none";
export type FactorKind = "device" | "logged" | "estimated";

export type RecentSet = {
  /** ISO time the set was logged */
  at: string;
  reps: number;
  rpe: number | null;
  /** external load in kg (0 for bodyweight) */
  loadKg: number;
  exercise?: string | null;
  primary: string[];
  secondary: string[];
  fallbackMuscle?: string | null;
  countsTowardVolume?: boolean;
};

export type PlannedRow = {
  sets: number | null;
  primary: string[];
  secondary: string[];
  fallbackMuscle?: string | null;
  countsTowardVolume?: boolean;
};

export type CheckoutInput = {
  /** ISO time of the check-out (the workout it followed) */
  at: string;
  sleepBucket: SleepBucket | null;
  /** 1–5, higher = more recovered */
  recovery: number | null;
  fatigueFeel: string | null;
  sessionRpe: number | null;
  pain: boolean | null;
  painArea?: string | null;
  painLevel?: number | null;
};

export type PainReportInput = {
  /** yyyy-mm-dd */
  day: string;
  region: string;
  side: string | null;
  site: string | null;
  /** 0–10 */
  score: number | null;
  severity: string | null;
  /** what it feels like and when (pain/report.ts), for its kind */
  feel?: string[] | null;
  timing?: string[] | null;
  /** a general symptom (pain/symptoms.ts) */
  symptom?: string | null;
};

export type CardioInput = { day: string; minutes: number | null; rpe: number | null };
export type SleepInput = { day: string; hours: number };
export type EnergyInput = { day: string; rating: number };

export type TodayRecoveryInput = {
  now: number | Date;
  /** yyyy-mm-dd, the athlete's own day */
  today: string;
  /** today's planned rows (every workout today); empty on a rest day */
  planned: PlannedRow[];
  sets: RecentSet[];
  checkouts?: CheckoutInput[];
  pain?: PainReportInput[];
  cardio?: CardioInput[];
  /** a device's (or a logged) night of sleep, by the day it ended */
  sleep?: SleepInput[];
  /** energy 1–5 (the Nutrition Update's), by the day it was sent */
  energy?: EnergyInput[];
};

export type MuscleRecovery = {
  muscle: FineMuscle;
  state: RecoveryState;
  /** fatigue ÷ the athlete's typical session dose for this muscle (0 = fresh) */
  ratio: number;
  /** yyyy-mm-dd it was last trained (in the last 6 weeks), or null */
  lastTrained: string | null;
  hoursSince: number | null;
  /** credited sets in the last 72 hours */
  sets72h: number;
  /** the exercise that put the most fatigue on it, when it carries some */
  mainExercise: string | null;
  /** a pain flag sits on this muscle (pain, a joint or tendon, numbness: what limits training) */
  pain: boolean;
  /** soreness, tightness or tired muscles they reported on it in the last few days (confirms the estimate) */
  reported: SymptomClass | null;
  /** today's workout leans on it (share of today's planned work, 0–1) */
  todayShare: number;
};

export type RecoveryFactor = {
  key: "muscles" | "sleep" | "feel" | "fatigue" | "session" | "cardio" | "energy" | "load" | "rest" | "pain" | "symptoms" | "reported";
  label: string;
  detail: string;
  /** points it moved the score (negative = lower); 0 for a cap or a note */
  effect: number;
  kind: FactorKind;
};

export type PainFlag = {
  day: string;
  label: string;
  score: number | null;
  severe: boolean;
  muscles: FineMuscle[];
  /** on a muscle today's workout uses, or a place that can't be tied to a muscle */
  relevant: boolean;
  /** what kind of symptom it is (pain/symptoms.ts) */
  cls: SymptomClass;
  /** where it is, for the body (a general symptom has no place) */
  region: string;
  site: string | null;
  side: "L" | "R" | null;
  symptom: string | null;
};

export type TodayRecovery = {
  /** null when there isn't enough to say (see `reason`) */
  score: number | null;
  band: "recovered" | "moderate" | "elevated" | null;
  /** one or two words for the status */
  status: string;
  /** what the score is for */
  scope: "workout" | "general";
  basis: "measured" | "estimated";
  reason: "ok" | "no_training" | "break" | "too_little" | "no_muscle_data";
  muscles: Record<FineMuscle, MuscleRecovery>;
  /** today's muscles, most-used first */
  relevant: FineMuscle[];
  factors: RecoveryFactor[];
  /** what limits training (pain, joint or tendon, numbness), most relevant first */
  pain: PainFlag[];
  /** soreness, tightness and tired muscles they reported (they confirm fatigue, never cap) */
  reported: PainFlag[];
  /** general symptoms (a headache, dizziness, nausea…): listed apart, never on a muscle */
  general: PainFlag[];
  /** the score was capped by a pain flag */
  painCapped: boolean;
  /** the score from fatigue and what was logged, before any pain cap (null with no score) */
  uncapped: number | null;
  /** share of today's planned work on muscles with training history (1 on a rest day with data) */
  coverage: number;
  confidence: "high" | "medium" | "low";
  /** what wasn't on file that would have made it surer */
  missing: string[];
  observation: string | null;
};

const toMs = (t: number | Date) => (typeof t === "number" ? t : t.getTime());
const dayMs = (d: string) => Date.parse(`${d}T12:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r2 = (n: number) => Math.round(n * 100) / 100;

function localDayOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function tauHours(m: FineMuscle): number {
  return BIG.has(m) ? TAU_BIG_H : TAU_SMALL_H;
}

/** How much a set's effort counts (RPE); an unrated set is read as moderately hard. */
export function effortWeight(rpe: number | null | undefined): number {
  if (rpe == null || !Number.isFinite(rpe)) return 0.85;
  if (rpe < 6) return 0.6;
  if (rpe < 7) return 0.8;
  if (rpe < 8) return 1;
  if (rpe < 9) return 1.15;
  return 1.3;
}

export function stateFor(ratio: number): Exclude<RecoveryState, "none"> {
  if (ratio < RECOVERED_BELOW) return "recovered";
  if (ratio < MODERATE_BELOW) return "moderate";
  return "elevated";
}

/** Where a pain report sits, as training muscles (a site's own muscle first, else its region's). */
export const REGION_MUSCLES: Record<string, FineMuscle[]> = {
  neck: ["Upper back"],
  shoulder: ["Front delts", "Side delts", "Rear delts"],
  chest: ["Chest"],
  upper_arm: ["Biceps", "Triceps"],
  elbow: ["Biceps", "Triceps", "Forearms"],
  wrist_hand: ["Forearms"],
  upper_back: ["Upper back"],
  shoulder_blade: ["Upper back", "Rear delts"],
  mid_back: ["Upper back", "Lats"],
  low_back: ["Erectors"],
  abs: ["Abs"],
  hip_groin: ["Adductors", "Glutes"],
  glute: ["Glutes"],
  quad: ["Quads"],
  hamstring: ["Hamstrings"],
  knee: ["Quads", "Hamstrings"],
  shin: ["Calves"],
  calf: ["Calves"],
  ankle_foot: ["Calves"],
  // ribs brace every lift: no one muscle, so a rib symptom is read as relevant to any workout
  ribs: [],
  // never trained: a symptom here is never on a muscle
  head: [],
  face: [],
  jaw: [],
  general: [],
};

const REGION_WORD: Record<string, string> = {
  neck: "neck", shoulder: "shoulder", chest: "chest", upper_arm: "upper arm", elbow: "elbow",
  wrist_hand: "wrist / hand", upper_back: "upper back", shoulder_blade: "shoulder blade",
  mid_back: "mid back", low_back: "low back", abs: "abs", hip_groin: "hip / groin", glute: "glute",
  quad: "quad", hamstring: "hamstring", knee: "knee", shin: "shin", calf: "calf", ankle_foot: "ankle / foot",
};

/** "L" / "R" as stored ("left" / "right" from older callers). */
function sideOf(s: string | null | undefined): "L" | "R" | null {
  const t = (s ?? "").toLowerCase();
  return t === "l" || t === "left" ? "L" : t === "r" || t === "right" ? "R" : null;
}

function painPlace(p: PainReportInput): string {
  const gen = generalOf(p.symptom);
  if (gen) return gen.label;
  const side = sideOf(p.side);
  if (p.site && !REGION_WORD[p.site]) {
    const label = siteLabel(p.site, side);
    if (label !== p.site) return label;
  }
  if (!REGION_WORD[p.region] && p.region !== "other") return areaLabel(p.region, side);
  const word = REGION_WORD[p.region] ?? (p.region === "other" ? "pain" : p.region.replace(/_/g, " "));
  const s = `${side === "L" ? "Left " : side === "R" ? "Right " : ""}${word}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "yesterday", "Monday" (within a week), else "Nov 3". */
export function whenWords(day: string, today: string): string {
  const n = daysBetween(day, today);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  const d = new Date(dayMs(day));
  if (n < 7) return WEEKDAY[d.getUTCDay()];
  return `${MONTH[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const UPPER: ReadonlySet<FineMuscle> = new Set<FineMuscle>([
  "Chest", "Lats", "Upper back", "Front delts", "Side delts", "Rear delts", "Biceps", "Triceps", "Forearms",
]);
const LOWER: ReadonlySet<FineMuscle> = new Set<FineMuscle>(["Quads", "Hamstrings", "Glutes", "Adductors", "Calves"]);

/** "upper-body", "lower-body" or null: what today's workout mostly is, for the observation. */
export function workoutKind(shares: Map<FineMuscle, number>): "upper-body" | "lower-body" | null {
  let up = 0;
  let low = 0;
  for (const [m, s] of shares) {
    if (UPPER.has(m)) up += s;
    else if (LOWER.has(m)) low += s;
  }
  if (up >= 0.75) return "upper-body";
  if (low >= 0.75) return "lower-body";
  return null;
}

export function buildTodayRecovery(input: TodayRecoveryInput): TodayRecovery {
  const now = toMs(input.now);
  const today = input.today;
  const checkouts = [...(input.checkouts ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // ── the training log ────────────────────────────────────────────────
  const sets = input.sets
    .map((s) => ({ ...s, ms: Date.parse(s.at) }))
    .filter((s) => Number.isFinite(s.ms) && s.ms <= now && s.ms >= now - BASELINE_DAYS * DAY && s.reps > 0 && s.countsTowardVolume !== false);

  const fatigue = new Map<FineMuscle, number>();
  const topExercise = new Map<FineMuscle, Map<string, number>>();
  const doseByDay = new Map<FineMuscle, Map<string, number>>();
  const last = new Map<FineMuscle, number>();
  const sets72 = new Map<FineMuscle, number>();
  const trainingDays = new Set<string>();
  let lastSetMs = -Infinity;

  for (const s of sets) {
    const credits = muscleCredits(s);
    const day = localDayOf(s.ms);
    trainingDays.add(day);
    lastSetMs = Math.max(lastSetMs, s.ms);
    const w = effortWeight(s.rpe);
    const h = (now - s.ms) / HOUR;
    for (const [m, c] of credits) {
      const byDay = doseByDay.get(m) ?? new Map<string, number>();
      byDay.set(day, (byDay.get(day) ?? 0) + c * w);
      doseByDay.set(m, byDay);
      last.set(m, Math.max(last.get(m) ?? -Infinity, s.ms));
      if (h <= 72) sets72.set(m, (sets72.get(m) ?? 0) + c);
      if (h <= FATIGUE_WINDOW_DAYS * 24) {
        const f = c * w * Math.exp(-h / tauHours(m));
        fatigue.set(m, (fatigue.get(m) ?? 0) + f);
        const ex = (s.exercise ?? "").trim();
        if (ex) {
          const per = topExercise.get(m) ?? new Map<string, number>();
          per.set(ex, (per.get(ex) ?? 0) + f);
          topExercise.set(m, per);
        }
      }
    }
  }

  // ── today's workout: which muscles it leans on ──────────────────────
  const planShares = new Map<FineMuscle, number>();
  for (const r of input.planned) {
    if (r.countsTowardVolume === false) continue;
    const n = r.sets != null && r.sets > 0 ? r.sets : 3;
    for (const [m, c] of muscleCredits(r)) planShares.set(m, (planShares.get(m) ?? 0) + c * n);
  }
  const planTotal = [...planShares.values()].reduce((a, b) => a + b, 0);
  if (planTotal > 0) for (const [m, v] of planShares) planShares.set(m, v / planTotal);
  const scope: TodayRecovery["scope"] = planTotal > 0 ? "workout" : "general";

  // ── what they reported, each by its kind ────────────────────────────
  const pain: PainFlag[] = [];
  const reported: PainFlag[] = [];
  const general: PainFlag[] = [];
  const latestByPlace = new Map<string, PainReportInput>();
  for (const p of input.pain ?? []) {
    const age = daysBetween(p.day, today);
    if (age < 0 || age > PAIN_ACTIVE_DAYS) continue;
    const key = `${p.region}:${sideOf(p.side) ?? ""}:${p.site ?? ""}:${p.symptom ?? ""}`;
    const prev = latestByPlace.get(key);
    if (!prev || p.day > prev.day) latestByPlace.set(key, p);
  }
  for (const p of latestByPlace.values()) {
    const cls = symptomClass({ region: p.region, site: p.site, feel: p.feel ?? [], score: p.score, severity: p.severity, timing: p.timing ?? [], symptom: p.symptom });
    const age = daysBetween(p.day, today);
    const side = sideOf(p.side);
    const site = muscleOfSite(p.site);
    const nonTraining = cls === "general" || NON_TRAINING_REGIONS.has(p.region);
    const muscles = nonTraining ? [] : site ? [site] : REGION_MUSCLES[p.region] ?? [];
    const severe = (p.score ?? 0) >= 7 || p.severity === "severe";
    const flag: PainFlag = {
      day: p.day,
      label: painPlace(p),
      score: p.score,
      severe,
      muscles,
      // the head, face or jaw (and a general symptom) never touch a lift's muscles
      relevant: !nonTraining && (muscles.length === 0 || scope === "general" || muscles.some((m) => planShares.has(m))),
      cls,
      region: p.region,
      site: p.site,
      side,
      symptom: p.symptom ?? null,
    };
    if (cls === "general") {
      if (age <= GENERAL_ACTIVE_DAYS) general.push({ ...flag, relevant: false });
    } else if (confirmsFatigue(cls)) {
      if (age <= REPORTED_FATIGUE_DAYS) reported.push(flag);
    } else if (limitsTraining(cls)) {
      // pain in the head, face or jaw is listed, never capped by a muscle it isn't on
      pain.push(flag);
    }
  }
  // a check-out's pain flag with no structured report behind it is still a flag
  const recentCheckoutPain = checkouts.find(
    (c) => c.pain && now - Date.parse(c.at) <= 7 * DAY,
  );
  const allReported = [...pain, ...reported, ...general];
  if (recentCheckoutPain && !allReported.some((p) => daysBetween(p.day, localDayOf(Date.parse(recentCheckoutPain.at))) === 0)) {
    const day = localDayOf(Date.parse(recentCheckoutPain.at));
    const level = recentCheckoutPain.painLevel ?? null;
    const area = recentCheckoutPain.painArea?.trim() ?? "";
    const symptoms = area ? generalSymptomsIn(area) : [];
    // "Headache" typed as the check-out's area is a general symptom, not pain on a muscle
    if (symptoms.length && area.split(",").every((part) => generalSymptomsIn(part).length > 0)) {
      for (const k of symptoms)
        if (daysBetween(day, today) <= GENERAL_ACTIVE_DAYS)
          general.push({ day, label: generalLabel(k) ?? area, score: level, severe: (level ?? 0) >= 7, muscles: [], relevant: false, cls: "general", region: generalOf(k)!.region, site: null, side: null, symptom: k });
    } else {
      pain.push({
        day,
        label: area ? `Pain (${area})` : "Pain at your check-out",
        score: level,
        severe: (level ?? 0) >= 7,
        muscles: [],
        relevant: true,
        cls: "pain",
        region: "other",
        site: null,
        side: null,
        symptom: null,
      });
    }
  }
  const order = (a: PainFlag, b: PainFlag) => Number(b.relevant) - Number(a.relevant) || Number(b.severe) - Number(a.severe) || (b.day < a.day ? -1 : 1);
  pain.sort(order);
  reported.sort(order);
  general.sort((a, b) => (b.day < a.day ? -1 : 1));
  const painMuscles = new Set(pain.flatMap((p) => p.muscles));
  const reportedOn = new Map<FineMuscle, SymptomClass>();
  for (const r of reported) for (const m of r.muscles) if (!reportedOn.has(m)) reportedOn.set(m, r.cls);

  // ── each muscle against its own typical session ─────────────────────
  const muscles = {} as Record<FineMuscle, MuscleRecovery>;
  for (const m of FINE_MUSCLES) {
    const doses = [...(doseByDay.get(m)?.values() ?? [])];
    const lastMs = last.get(m);
    const share = planShares.get(m) ?? 0;
    const said = reportedOn.get(m) ?? null;
    if (!doses.length || lastMs == null) {
      // no log for it: what they reported is all there is, and it reads as moderate
      muscles[m] = { muscle: m, state: said ? "moderate" : "none", ratio: said ? REPORTED_RATIO : 0, lastTrained: null, hoursSince: null, sets72h: 0, mainExercise: null, pain: painMuscles.has(m), reported: said, todayShare: share };
      continue;
    }
    const baseline = Math.max(3, median(doses));
    // soreness they reported is the same fatigue the log estimates: the higher of the two, never both
    const ratio = Math.max((fatigue.get(m) ?? 0) / baseline, said ? REPORTED_RATIO : 0);
    const ex = topExercise.get(m);
    const main = ex && ratio >= RECOVERED_BELOW ? [...ex.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
    muscles[m] = {
      muscle: m,
      state: stateFor(ratio),
      ratio: r2(ratio),
      lastTrained: localDayOf(lastMs),
      hoursSince: Math.round((now - lastMs) / HOUR),
      sets72h: Math.round((sets72.get(m) ?? 0) * 10) / 10,
      mainExercise: main,
      pain: painMuscles.has(m),
      reported: said,
      todayShare: r2(share),
    };
  }

  const relevant =
    scope === "workout"
      ? [...planShares.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m)
      : FINE_MUSCLES.filter((m) => muscles[m].state !== "none");

  const factors: RecoveryFactor[] = [];
  const base = {
    muscles,
    relevant,
    pain,
    reported,
    general,
    scope,
  };
  const generalNote = general[0] ? `${general.length > 1 ? `${general[0].label} and ${general.length - 1} more` : general[0].label} reported ${whenWords(general[0].day, today)}: not counted as muscle fatigue.` : null;
  const none = (reason: TodayRecovery["reason"], status: string): TodayRecovery => ({
    ...base,
    score: null,
    band: null,
    status,
    basis: "estimated",
    reason,
    factors,
    painCapped: false,
    uncapped: null,
    coverage: 0,
    confidence: "low",
    missing: [],
    observation: pain[0] ? `${pain[0].label} flagged ${whenWords(pain[0].day, today)}${pain[0].score != null ? ` (${pain[0].score}/10)` : ""}.` : generalNote,
  });

  // ── enough to say something? ────────────────────────────────────────
  const freshCheckout = checkouts.find((c) => now - Date.parse(c.at) <= 3 * DAY) ?? null;
  const recentDays = [...trainingDays].filter((d) => daysBetween(d, today) <= 21).length;
  if (!sets.length) return none("no_training", "Not enough data yet");
  if (now - lastSetMs > BREAK_DAYS * DAY) return none("break", "Rested");
  if (recentDays < 2 && !freshCheckout) return none("too_little", "Not enough data yet");

  // the muscles today's workout uses, weighted by how much it uses them
  let wSum = 0;
  let mSum = 0;
  let planCovered = 0;
  for (const m of relevant) {
    const mr = muscles[m];
    if (mr.state === "none") continue;
    const w = scope === "workout" ? planShares.get(m) ?? 0 : 1;
    if (w <= 0) continue;
    wSum += w;
    if (scope === "workout") planCovered += w;
    mSum += w * (100 - Math.min(65, 55 * mr.ratio));
  }
  if (wSum === 0) return none("no_muscle_data", "Not enough data yet");
  // how much of today's workout the score can speak for
  const coverage = scope === "workout" ? Math.min(1, planCovered) : 1;
  const muscleScore = mSum / wSum;
  let score = muscleScore;
  const tired = relevant.filter((m) => muscles[m].state === "elevated");
  factors.push({
    key: "muscles",
    label: scope === "workout" ? "Today's muscles" : "Your muscles",
    detail: tired.length
      ? `${tired.slice(0, 2).join(" and ")} still carr${tired.length === 1 ? "ies" : "y"} fatigue`
      : relevant.some((m) => muscles[m].state === "moderate")
        ? "Some fatigue left from recent training"
        : "Recovered from recent training",
    effect: Math.round(muscleScore - 100),
    kind: "estimated",
  });
  // what they reported is part of the muscles' read above (never a second number), said so here
  const saidOnToday = reported.filter((r) => r.relevant);
  if (saidOnToday.length)
    factors.push({
      key: "reported",
      label: "What you reported",
      detail: `${saidOnToday.map((r) => `${r.label} (${r.cls === "fatigue" ? "tired" : r.cls === "tightness" ? "tight" : "sore"})`).join(", ")}: counted in your muscles' fatigue, not twice`,
      effect: 0,
      kind: "logged",
    });

  let measured = false;
  // sleep: a device's night first, else the last check-out's (it's the night before that workout)
  const todayDevice = (input.sleep ?? []).filter((s) => daysBetween(s.day, today) >= 0 && daysBetween(s.day, today) <= 1 && s.hours > 0)
    .sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  const sleepFrom = (hours: number) => (hours < 5 ? -12 : hours < 6 ? -6 : hours < 7 ? -2 : hours < 8.25 ? 0 : 2);
  if (todayDevice) {
    const e = sleepFrom(todayDevice.hours);
    score += e;
    measured = true;
    factors.push({ key: "sleep", label: "Sleep", detail: `${Math.round(todayDevice.hours * 10) / 10}h ${todayDevice.day === today ? "last night" : "the night before"}`, effect: e, kind: "device" });
  } else if (checkouts[0]?.sleepBucket) {
    const c = checkouts[0];
    const ageH = (now - Date.parse(c.at)) / HOUR;
    const hours = sleepBucketHours(c.sleepBucket);
    if (hours != null && ageH <= 36) {
      const e = Math.round(sleepFrom(hours) * (ageH <= 18 ? 1 : 0.5));
      score += e;
      measured = true;
      factors.push({ key: "sleep", label: "Sleep", detail: `${sleepBucketLabel(c.sleepBucket)} before your last workout`, effect: e, kind: "logged" });
    }
  }

  if (freshCheckout) {
    const ageH = (now - Date.parse(freshCheckout.at)) / HOUR;
    // "how recovered" and "fatigued" are one read of how they felt: recovered first, never both
    if (freshCheckout.recovery != null && ageH <= 48) {
      const e = Math.round((clamp(freshCheckout.recovery, 1, 5) - 3) * 4);
      score += e;
      measured = true;
      factors.push({ key: "feel", label: "How recovered you felt", detail: `${freshCheckout.recovery}/5 at your last check-out`, effect: e, kind: "logged" });
    }
    const feel = (freshCheckout.fatigueFeel ?? "").toLowerCase();
    if (ageH <= 48 && freshCheckout.recovery == null && (feel.includes("fatig") || feel.includes("tired") || feel.includes("fresh"))) {
      const e = feel.includes("fresh") ? 3 : -5;
      score += e;
      measured = true;
      factors.push({ key: "fatigue", label: "Fatigue", detail: feel.includes("fresh") ? "You felt fresh" : "You felt fatigued", effect: e, kind: "logged" });
    }
    // a very hard session: its rated sets already carry their effort into each muscle, so it
    // counts only when that session's sets weren't rated
    const coMs = Date.parse(freshCheckout.at);
    const sessionSets = sets.filter((x) => Math.abs(x.ms - coMs) <= 12 * HOUR);
    const rated = sessionSets.filter((x) => x.rpe != null).length;
    if (freshCheckout.sessionRpe != null && freshCheckout.sessionRpe >= 9 && ageH <= 48 && (!sessionSets.length || rated / sessionSets.length < 0.5)) {
      score -= 4;
      factors.push({ key: "session", label: "Last workout", detail: `A very hard session (RPE ${freshCheckout.sessionRpe})`, effect: -4, kind: "logged" });
    }
  }

  // cardio in the last two days: a long or hard one weighs on a leg day more
  const legs = scope === "general" || ["Quads", "Hamstrings", "Glutes", "Calves"].some((m) => (planShares.get(m as FineMuscle) ?? 0) >= 0.1);
  const hardCardio = (input.cardio ?? []).filter((c) => {
    const age = daysBetween(c.day, today);
    return age >= 0 && age <= 1 && (c.minutes ?? 0) >= 30 && (c.rpe ?? 0) >= 7;
  });
  if (hardCardio.length) {
    const e = legs ? -5 : -2;
    score += e;
    factors.push({ key: "cardio", label: "Cardio", detail: `${hardCardio.reduce((a, c) => a + (c.minutes ?? 0), 0)} min of hard cardio ${hardCardio.some((c) => c.day === today) ? "today" : "yesterday"}`, effect: e, kind: "logged" });
  }

  const energy = (input.energy ?? []).filter((e) => { const a = daysBetween(e.day, today); return a >= 0 && a <= 10; })
    .sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  if (energy && (energy.rating <= 2 || energy.rating >= 4)) {
    const e = energy.rating <= 2 ? -4 : 1;
    score += e;
    factors.push({ key: "energy", label: "Energy", detail: `${energy.rating}/5 at your last nutrition update`, effect: e, kind: "logged" });
  }

  // this week's load against their usual: the last 7 days vs the 4 weeks before
  const credited = (from: number, to: number) => {
    let n = 0;
    for (const s of sets) if (s.ms > from && s.ms <= to) for (const c of muscleCredits(s).values()) n += c * effortWeight(s.rpe);
    return n;
  };
  const week = credited(now - 7 * DAY, now);
  const before = credited(now - 35 * DAY, now - 7 * DAY) / 4;
  const weeksBefore = new Set([...trainingDays].filter((d) => { const a = daysBetween(d, today); return a >= 7 && a < 35; }).map((d) => Math.floor(daysBetween(d, today) / 7))).size;
  if (before > 0 && weeksBefore >= 3 && week / before > 1.2) {
    const pct = Math.round((week / before - 1) * 100);
    // the last few days of that week are already in today's muscles: half, so it isn't counted twice
    const full = week / before > 1.4 ? -6 : -3;
    const e = tired.length ? Math.round(full / 2) : full;
    score += e;
    factors.push({ key: "load", label: "This week's training", detail: `${pct}% above your usual week`, effect: e, kind: "estimated" });
  }

  const sinceLast = (now - lastSetMs) / DAY;
  if (sinceLast >= 4) {
    score += 3;
    factors.push({ key: "rest", label: "Rest", detail: `${Math.floor(sinceLast)} days since your last workout`, effect: 3, kind: "estimated" });
  }

  score = Math.round(clamp(score, 5, 100));
  const uncapped = score;

  // what wasn't on file, and how sure this is
  const missing: string[] = [];
  if (!freshCheckout) missing.push("No check-out in the last 3 days");
  if (!factors.some((f) => f.key === "sleep")) missing.push("No sleep logged for last night");
  if (coverage < 1) missing.push(`${Math.round((1 - coverage) * 100)}% of today's workout trains muscles with no recent history`);
  const confidence: TodayRecovery["confidence"] = coverage < LOW_COVERAGE ? "low" : measured && coverage >= 0.8 ? "high" : "medium";

  // pain: always listed, and it caps the score when it touches today's training
  let painCapped = false;
  const relevantPain = pain.filter((p) => p.relevant);
  if (relevantPain.length) {
    const cap = relevantPain.some((p) => p.severe) ? SEVERE_PAIN_CAP : PAIN_CAP;
    if (score > cap) {
      score = cap;
      painCapped = true;
    }
    factors.push({ key: "pain", label: "Pain flagged", detail: relevantPain.map((p) => p.label).join(", "), effect: 0, kind: "logged" });
  }

  const band: TodayRecovery["band"] = score >= READY_FROM ? "recovered" : score >= MODERATE_FROM ? "moderate" : "elevated";
  if (general.length)
    factors.push({ key: "symptoms", label: "Symptoms reported", detail: `${general.map((g) => g.label).join(", ")}: listed apart, not counted as fatigue`, effect: 0, kind: "logged" });
  const status =
    relevantPain.length ? "Pain flagged"
      : general.length ? "Symptoms reported"
        : band === "recovered" ? (scope === "workout" ? "Recovered for today" : "Recovered")
          : band === "moderate" ? "Some fatigue"
            : "High fatigue";

  return {
    ...base,
    score,
    band,
    status,
    basis: measured ? "measured" : "estimated",
    reason: "ok",
    factors,
    painCapped,
    uncapped,
    coverage: r2(coverage),
    confidence,
    missing,
    observation: observationFor({ muscles, relevant, planShares, pain, general, reported, factors, scope, today }),
  };
}

/** One short line when there's something worth saying, else null. */
function observationFor(x: {
  muscles: Record<FineMuscle, MuscleRecovery>;
  relevant: FineMuscle[];
  planShares: Map<FineMuscle, number>;
  pain: PainFlag[];
  general: PainFlag[];
  reported: PainFlag[];
  factors: RecoveryFactor[];
  scope: "workout" | "general";
  today: string;
}): string | null {
  const p = x.pain[0];
  if (p) return `${p.label} flagged ${whenWords(p.day, x.today)}${p.score != null ? ` (${p.score}/10)` : ""}${p.relevant ? ", counted in today's score" : ""}.`;
  const g = x.general[0];
  if (g) return `${x.general.length > 1 ? `${g.label} and ${x.general.length - 1} more` : g.label} reported ${whenWords(g.day, x.today)}: not counted as muscle fatigue.`;
  const tired = x.relevant.filter((m) => x.muscles[m].state === "elevated");
  if (tired.length) {
    const m = x.muscles[tired[0]];
    return `${m.muscle} still carr${m.muscle.endsWith("s") ? "y" : "ies"} fatigue from ${whenWords(m.lastTrained ?? x.today, x.today)}${m.mainExercise ? ` (${m.mainExercise})` : ""}.`;
  }
  if (x.scope === "workout") {
    const kind = workoutKind(x.planShares);
    const elsewhere = (Object.values(x.muscles) as MuscleRecovery[]).filter((m) => m.state === "elevated" && !x.planShares.has(m.muscle));
    if (kind && elsewhere.length) {
      const names = elsewhere.slice(0, 2).map((m) => m.muscle);
      return `${names.join(" and ")} ${names.length === 1 && !names[0].endsWith("s") ? "is" : "are"} still fatigued, but today's ${kind} workout doesn't lean on ${names.length === 1 && !names[0].endsWith("s") ? "it" : "them"}.`;
    }
  }
  const sleep = x.factors.find((f) => f.key === "sleep" && f.effect <= -6);
  if (sleep) return `Short sleep (${sleep.detail}) lowered today's score.`;
  const load = x.factors.find((f) => f.key === "load");
  if (load) return `This week's training is ${load.detail}, so recovery reads lower.`;
  return null;
}

/** Total weight lifted (load × reps) from `from` to `to` (yyyy-mm-dd, inclusive), in kg. */
export function weightLiftedKg(sets: Array<{ day: string; loadKg: number; reps: number }>, from: string, to: string): number {
  let kg = 0;
  for (const s of sets) if (s.day >= from && s.day <= to && s.loadKg > 0 && s.reps > 0) kg += s.loadKg * s.reps;
  return kg;
}
