/**
 * How the athlete is developing, read from their own records (deterministic,
 * no model): who they are (age category, weight class and how far from its
 * limit, training age, bodyweight phase), what that does to the numbers
 * (strength against bodyweight, rate of progress against their training age,
 * strength through gaining / holding / cutting phases, IPF GL points with
 * meet results kept apart from gym estimates), where each exercise stands
 * (progress / hold / back off, from the last few sessions), and the trends
 * (plateaus, adherence, fatigue). Every AI feature reads this one analysis:
 * Edit with AI, Generate Next Program and Program Intelligence.
 *
 * It never fills a gap with a guess: anything missing is listed as missing,
 * and a read from little data says so (confidence).
 */
import { daysBetween, mean, round } from "./core";
import type { AthleteContext } from "./context";
import type { DayCompare, IntelRecords, IntelReport, Lift, RowCompare, Unit } from "./types";
import { LIFTS } from "./types";

const LB = 2.2046226218;

// ---------------------------------------------------------------------------
// Standard scoring and categories

export type Sex = "M" | "F";
export function sexOf(raw: string | null | undefined): Sex | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (/^(m|male|man|men)$/.test(t)) return "M";
  if (/^(f|female|woman|women)$/.test(t)) return "F";
  return null;
}

/**
 * IPF GL points (the "Goodlift" formula the IPF adopted in 2020):
 * points = result × 100 / (A − B·e^(−C·bodyweight)), bodyweight in kg; 0 under 35 kg.
 * Coefficients as published (and as OpenPowerlifting implements them).
 */
const GL: Record<"sbd" | "bench", Record<"classic" | "equipped", Record<Sex, [number, number, number]>>> = {
  sbd: {
    classic: { M: [1199.72839, 1025.18162, 0.00921], F: [610.32796, 1045.59282, 0.03048] },
    equipped: { M: [1236.25115, 1449.21864, 0.01644], F: [758.63878, 949.31382, 0.02435] },
  },
  bench: {
    classic: { M: [320.98041, 281.40258, 0.01008], F: [142.40398, 442.52671, 0.04724] },
    equipped: { M: [381.22073, 733.79378, 0.02398], F: [221.82209, 357.00377, 0.02937] },
  },
};
export function glPoints(resultKg: number | null | undefined, bodyweightKg: number | null | undefined, sex: Sex | null, event: "sbd" | "bench" = "sbd", equipment: "classic" | "equipped" = "classic"): number | null {
  if (!resultKg || !bodyweightKg || !sex || bodyweightKg < 35 || resultKg <= 0) return null;
  const [a, b, c] = GL[event][equipment][sex];
  const den = a - b * Math.exp(-c * bodyweightKg);
  if (den <= 0) return null;
  return round((resultKg * 100) / den, 2);
}

/** IPF weight classes (kg); 53 / 43 only for sub-juniors and juniors. */
export function ipfClass(bodyweightKg: number | null | undefined, sex: Sex | null, age: number | null = null): { label: string; limitKg: number | null } | null {
  if (!bodyweightKg || !sex) return null;
  const youth = age != null && age <= 23;
  const limits = sex === "M" ? [...(youth ? [53] : []), 59, 66, 74, 83, 93, 105, 120] : [...(youth ? [43] : []), 47, 52, 57, 63, 69, 76, 84];
  for (const l of limits) if (bodyweightKg <= l) return { label: `${l} kg`, limitKg: l };
  return { label: `${limits[limits.length - 1]}+ kg`, limitKg: null };
}

/** The class the coach wrote ("83", "-83kg", "84+") as its limit in kg (null for a "+" class). */
export function classLimit(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!t || /\+/.test(t)) return null;
  const n = Number(t.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 30 && n <= 200 ? n : null;
}

export function ageCategory(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 18) return "Sub-junior (14–18)";
  if (age <= 23) return "Junior (19–23)";
  if (age < 40) return "Open";
  if (age < 50) return "Masters 1 (40–49)";
  if (age < 60) return "Masters 2 (50–59)";
  if (age < 70) return "Masters 3 (60–69)";
  return "Masters 4 (70+)";
}

/** Years of training from what they told you ("3–5 years", "6 months", "14 years", "Beginner"); null when it doesn't say. */
export function trainingYears(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").toLowerCase().replace(/[–—]/g, "-").trim();
  if (!t) return null;
  if (/less than (1|one)|under (a|1|one) year|<\s*1/.test(t)) return 0.5;
  if (/more than 5|over 5|5\+/.test(t)) return 6;
  const range = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(years?|yrs?)/.exec(t);
  if (range) return round((Number(range[1]) + Number(range[2])) / 2, 1);
  const months = /(\d+(?:\.\d+)?)\s*(months?|mos?)\b/.exec(t);
  if (months) return round(Number(months[1]) / 12, 1);
  const years = /(\d+(?:\.\d+)?)\+?\s*(years?|yrs?)/.exec(t);
  if (years) return Number(years[1]);
  if (/beginner|novice|never|brand new|just start/.test(t)) return 0.5;
  if (/advanced|elite/.test(t)) return 6;
  if (/intermediate/.test(t)) return 2;
  return null;
}

export type TrainingLevel = "beginner" | "intermediate" | "advanced";
export function levelFromYears(y: number | null): TrainingLevel | null {
  if (y == null) return null;
  return y < 1 ? "beginner" : y <= 5 ? "intermediate" : "advanced";
}

/**
 * A rough reference for how fast a competition lift's e1RM tends to rise per
 * month at each training age (a sanity check against their own rate, never a
 * target): beginners fast, advanced lifters slowly and in steps.
 */
export const EXPECTED_MONTHLY_PCT: Record<TrainingLevel, [number, number]> = { beginner: [2, 5], intermediate: [0.5, 2], advanced: [0, 1] };

// ---------------------------------------------------------------------------
// Bodyweight

export type Phase = "gaining" | "cutting" | "maintaining";
/** %/week (of bodyweight) beyond which they're gaining or cutting. */
export const PHASE_PCT_PER_WEEK = 0.25;

type BW = { date: string; kg: number };

function slopePerWeek(points: BW[]): number | null {
  if (points.length < 3) return null;
  const x0 = points[0].date;
  const xs = points.map((p) => daysBetween(x0, p.date) / 7);
  if (xs[xs.length - 1] < 2) return null;
  const ys = points.map((p) => p.kg);
  const mx = mean(xs) as number;
  const my = mean(ys) as number;
  const den = xs.reduce((n, x) => n + (x - mx) ** 2, 0);
  return den > 0 ? xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / den : null;
}

/** Their phase in the ~5 weeks to `to`: needs 3+ weigh-ins spread over 2+ weeks. */
export function bodyweightPhase(entries: BW[], to: string, windowDays = 35): { phase: Phase; pctPerWeek: number; kgPerWeek: number; entries: number } | null {
  const pts = entries.filter((e) => e.date <= to && daysBetween(e.date, to) <= windowDays).sort((a, b) => a.date.localeCompare(b.date));
  const s = slopePerWeek(pts);
  if (s == null) return null;
  const avg = mean(pts.map((p) => p.kg)) as number;
  const pct = (s / avg) * 100;
  return { phase: pct > PHASE_PCT_PER_WEEK ? "gaining" : pct < -PHASE_PCT_PER_WEEK ? "cutting" : "maintaining", pctPerWeek: round(pct, 2), kgPerWeek: round(s, 2), entries: pts.length };
}

export type PhaseSpan = { phase: Phase; from: string; to: string; changeKg: number; pctPerWeek: number };

/** Their bodyweight history as phases (each 5-week window, stepped 2 weeks, the same phases merged). */
export function bodyweightPhases(entries: BW[]): PhaseSpan[] {
  const pts = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 3) return [];
  const out: PhaseSpan[] = [];
  const end = pts[pts.length - 1].date;
  for (let d = addDays(pts[0].date, 28); d <= addDays(end, 13); d = addDays(d, 14)) {
    const to = d > end ? end : d;
    const p = bodyweightPhase(pts, to);
    if (!p) continue;
    const from = addDays(to, -35) < pts[0].date ? pts[0].date : addDays(to, -35);
    const last = out[out.length - 1];
    if (last && last.phase === p.phase && from <= last.to) {
      last.to = to;
    } else out.push({ phase: p.phase, from: last && from <= last.to ? addDays(last.to, 1) : from, to, changeKg: 0, pctPerWeek: p.pctPerWeek });
    if (to === end) break;
  }
  for (const s of out) {
    const inside = pts.filter((p) => p.date >= s.from && p.date <= s.to);
    if (inside.length >= 2) {
      s.changeKg = round(inside[inside.length - 1].kg - inside[0].kg, 1);
      const weeks = Math.max(1, daysBetween(inside[0].date, inside[inside.length - 1].date) / 7);
      s.pctPerWeek = round((s.changeKg / (mean(inside.map((p) => p.kg)) as number) / weeks) * 100, 2);
    }
  }
  return out;
}

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Bodyweight on a date: the nearest weigh-in within 3 weeks, else null (never guessed). */
export function bodyweightOn(entries: BW[], date: string): number | null {
  let best: BW | null = null;
  let gap = Infinity;
  for (const e of entries) {
    const g = Math.abs(daysBetween(e.date, date));
    if (g < gap) {
      gap = g;
      best = e;
    }
  }
  return best && gap <= 21 ? best.kg : null;
}

// ---------------------------------------------------------------------------
// Lifts

export type Confidence = "low" | "moderate" | "high";

export type LiftDevelopment = {
  lift: Lift;
  points: number;
  from: string | null;
  to: string | null;
  weeks: number;
  firstKg: number | null;
  lastKg: number | null;
  changePct: number | null;
  /** e1RM %/month over the span */
  monthlyPct: number | null;
  bwFirstKg: number | null;
  bwLastKg: number | null;
  relFirst: number | null;
  relLast: number | null;
  relChangePct: number | null;
  /** strength through each bodyweight phase (only where 2+ sessions fall inside it) */
  /** Each bodyweight phase's best e1RM, at that phase's bodyweight: phases compared with each other, not first-to-last inside one (a block's rep ranges move a short phase's e1RMs more than its bodyweight does). */
  byPhase: Array<{ phase: Phase; from: string; to: string; bestKg: number; bwKg: number | null; rel: number | null; sessions: number }>;
  rate: "above" | "within" | "below" | null;
  /** weeks since the best e1RM, when the recent sessions haven't beaten it */
  plateauWeeks: number | null;
  /** the variation of the lift they've progressed most on (and the comp one), from their own history */
  variations: Array<{ exercise: string; changePct: number | null; exposures: number }>;
  confidence: Confidence;
  reading: string;
};

function robust(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function confidenceOf(points: number, weeks: number): Confidence {
  return points >= 10 && weeks >= 10 ? "high" : points >= 5 && weeks >= 5 ? "moderate" : "low";
}

const pct = (a: number, b: number) => round(((b - a) / a) * 100, 1);

/**
 * A session's e1RM says something about a max only when its top set was hard: an easy
 * day (a technique single @5) or a set with no effort logged extrapolates to far less
 * than they can lift, so a trend over every session reads deloads and light days as
 * strength lost. With 3+ such sessions only they count; else every session does, as floors.
 */
export const INFORMATIVE_RPE = 7;
const hardEnough = (e: { topSet: { rpe: number | null } | null }) => (e.topSet?.rpe ?? 0) >= INFORMATIVE_RPE;

export type StrengthPoints = { points: Array<{ date: string; value: number }>; sessions: number; easyLeftOut: number; floorsOnly: boolean };

/** One point per day (that day's best competition-lift e1RM), from the sessions that can show a max. */
export function strengthPoints(rep: IntelReport["lifts"][number] | undefined): StrengthPoints {
  const comp = (rep?.exposures ?? []).filter((e) => e.competition && e.date && (e.e1rm ?? 0) > 0);
  const hard = comp.filter(hardEnough);
  const floorsOnly = hard.length < 3;
  const src = floorsOnly ? comp : hard;
  const byDate = new Map<string, number>();
  for (const e of src) byDate.set(e.date!, Math.max(byDate.get(e.date!) ?? 0, e.e1rm!));
  const points = [...byDate].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  const days = new Set(comp.map((e) => e.date));
  return { points, sessions: days.size, easyLeftOut: floorsOnly ? 0 : days.size - byDate.size, floorsOnly };
}

/** Start and end of a run of points: the best of the first and last few (strength shows in the best sessions, not the average one). */
function ends(pts: Array<{ value: number }>): { first: number; last: number } | null {
  if (pts.length < 2) return null;
  const k = Math.min(3, Math.max(1, Math.floor(pts.length / 3)));
  return { first: Math.max(...pts.slice(0, k).map((p) => p.value)), last: Math.max(...pts.slice(-k).map((p) => p.value)) };
}

function liftDevelopment(h: IntelReport, lift: Lift, bw: BW[], phases: PhaseSpan[], level: TrainingLevel | null, today: string, unit: Unit): LiftDevelopment | null {
  const rep = h.lifts.find((l) => l.lift === lift);
  const sp = strengthPoints(rep);
  const pts = sp.points;
  if (!rep || pts.length < 2) return null;
  const k = Math.min(3, Math.max(1, Math.floor(pts.length / 3)));
  const { first: firstKg, last: lastKg } = ends(pts)!;
  const from = pts[0].date;
  const to = pts[pts.length - 1].date;
  const weeks = round(daysBetween(from, to) / 7, 1);
  const changePct = firstKg && lastKg ? pct(firstKg, lastKg) : null;
  const monthlyPct = changePct != null && weeks >= 3 ? round(changePct / (weeks / 4.345), 2) : null;
  const firstDates = pts.slice(0, k).map((p) => p.date);
  const lastDates = pts.slice(-k).map((p) => p.date);
  const bwFirstKg = robust(firstDates.map((d) => bodyweightOn(bw, d)).filter((n): n is number => n != null));
  const bwLastKg = robust(lastDates.map((d) => bodyweightOn(bw, d)).filter((n): n is number => n != null));
  const relFirst = firstKg && bwFirstKg ? round(firstKg / bwFirstKg, 2) : null;
  const relLast = lastKg && bwLastKg ? round(lastKg / bwLastKg, 2) : null;
  const relChangePct = relFirst && relLast ? pct(relFirst, relLast) : null;
  const byPhase: LiftDevelopment["byPhase"] = [];
  for (const s of phases) {
    const inside = pts.filter((p) => p.date >= s.from && p.date <= s.to);
    if (inside.length < 2) continue;
    const bestKg = Math.max(...inside.map((p) => p.value));
    const inBw = bw.filter((b) => b.date >= s.from && b.date <= s.to).map((b) => b.kg);
    const bwKg = inBw.length ? round(inBw.reduce((a, b) => a + b, 0) / inBw.length, 1) : null;
    byPhase.push({ phase: s.phase, from: s.from, to: s.to, bestKg: round(bestKg, 1), bwKg, rel: bwKg ? round(bestKg / bwKg, 2) : null, sessions: inside.length });
  }
  const band = level ? EXPECTED_MONTHLY_PCT[level] : null;
  const rate = band && monthlyPct != null && weeks >= 6 ? (monthlyPct > band[1] ? "above" : monthlyPct < band[0] ? "below" : "within") : null;
  const peakIdx = pts.reduce((bi, p, i) => (p.value > pts[bi].value ? i : bi), 0);
  const recentBest = Math.max(...pts.slice(-3).map((p) => p.value));
  const sincePeak = daysBetween(pts[peakIdx].date, today) / 7;
  const plateauWeeks = peakIdx < pts.length - 3 && recentBest <= pts[peakIdx].value * 1.01 && sincePeak >= 3 ? round(sincePeak, 0) : null;
  const variations = (rep.variations ?? [])
    .filter((v) => v.exposures >= 3)
    .map((v) => ({ exercise: v.exercise, changePct: v.trend.changePct, exposures: v.exposures }))
    .sort((a, b) => (b.changePct ?? -99) - (a.changePct ?? -99))
    .slice(0, 4);
  const confidence = confidenceOf(pts.length, weeks);
  const u = (kg: number) => (unit === "lb" ? `${Math.round(kg * LB)} lb` : `${round(kg, 1)} kg`);
  const parts: string[] = [`e1RM ${u(firstKg!)} → ${u(lastKg!)} (${changePct! > 0 ? "+" : ""}${changePct}%) over ${weeks} weeks`];
  if (monthlyPct != null) parts.push(`${monthlyPct > 0 ? "+" : ""}${monthlyPct}%/month${rate && level ? ` (${rate} the usual ${EXPECTED_MONTHLY_PCT[level][0]}–${EXPECTED_MONTHLY_PCT[level][1]}%/month for ${level === "beginner" ? "a" : "an"} ${level})` : ""}`);
  if (relFirst && relLast) {
    parts.push(`relative ${relFirst}× → ${relLast}× bodyweight (${relChangePct! > 0 ? "+" : ""}${relChangePct}%)`);
    const bwChange = bwFirstKg && bwLastKg ? pct(bwFirstKg, bwLastKg) : 0;
    if (Math.abs(bwChange) >= 2) {
      if (bwChange > 0 && (relChangePct ?? 0) < 0) parts.push("strength rose slower than bodyweight: expected while gaining; bodyweight alone isn't proof of muscle");
      else if (bwChange < 0 && (changePct ?? 0) >= -2) parts.push("held strength while losing weight: relative strength up, the read that matters in a cut");
      else if (bwChange < 0 && (changePct ?? 0) < -2) parts.push("lost absolute strength during the weight loss: watch the rate of loss and recovery");
      else if (bwChange > 0 && (relChangePct ?? 0) >= 0) parts.push("strength kept pace with the bodyweight gain");
    }
  } else parts.push("no bodyweight on those dates, so no relative read");
  if (plateauWeeks) parts.push(`no new best in ${plateauWeeks} weeks`);
  if (daysBetween(to, today) > 28) parts.push(`the competition ${lift} itself last trained ${to} (only variations since)`);
  if (sp.floorsOnly) parts.push(`few of these sessions had a top set at RPE ${INFORMATIVE_RPE}+ logged, so these e1RMs are floors, not maxes`);
  else if (sp.easyLeftOut) parts.push(`${sp.easyLeftOut} easy or unrated session${sp.easyLeftOut === 1 ? "" : "s"} left out (a light day isn't strength lost)`);
  return { lift, points: pts.length, from, to, weeks, firstKg, lastKg, changePct, monthlyPct, bwFirstKg, bwLastKg, relFirst, relLast, relChangePct, byPhase, rate, plateauWeeks, variations, confidence, reading: parts.join("; ") };
}

// ---------------------------------------------------------------------------
// Progress / hold / back off, per exercise

export type Decision = "progress" | "maintain" | "regress" | "not_enough_data";

export type ProgressionSignal = {
  exerciseId: string | null;
  exercise: string;
  lift: Lift | null;
  competition: boolean;
  decision: Decision;
  why: string;
  evidence: string[];
  method: string;
  confidence: Confidence;
  sessions: number;
  /** The top set's load (kg) in their latest session of it: what a change is measured against. */
  lastKg: number | null;
  /** Held because of a related pain report (backing it off is then a fair call). */
  pain: boolean;
};

type Exposure = { date: string; row: RowCompare; completion: number | null; repsHit: number | null; rpeDelta: number | null; e1rm: number | null };

const PAIN_REGION: Record<Lift, RegExp> = {
  squat: /knee|hip|back|groin|quad/i,
  bench: /shoulder|elbow|pec|chest|wrist|tricep/i,
  deadlift: /back|hip|hamstring|glute|si joint/i,
};

function exposuresOf(days: DayCompare[], today: string, weeks = 8): Map<string, Exposure[]> {
  const out = new Map<string, Exposure[]>();
  for (const d of days) {
    if (!d.date || d.date > today || daysBetween(d.date, today) > weeks * 7) continue;
    if (d.status !== "completed" && d.status !== "partial") continue;
    for (const r of d.rows) {
      if (!r.actual.some((s) => s.done)) continue;
      const key = r.exerciseId ?? r.exercise.toLowerCase();
      const presc = r.prescribed.sets ?? null;
      const ex: Exposure = {
        date: d.date,
        row: r,
        completion: presc ? Math.min(1, r.setsDone / presc) : null,
        repsHit: r.repsHitPct,
        rpeDelta: r.rpeDelta,
        e1rm: r.bestE1rm,
      };
      out.set(key, [...(out.get(key) ?? []), ex]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

const fmt = (n: number | null | undefined, d = 1) => (n == null ? "?" : String(round(n, d)));

function methodFor(decision: Decision, row: RowCompare, level: TrainingLevel | null, peaking: boolean): string {
  const main = row.competition || !!row.lift;
  if (decision === "regress") return main ? "drop the load ~5–10% (or a set) for a week, then rebuild at the target RPE" : "cut a set or drop the load one step, then rebuild the reps";
  if (decision === "maintain" || decision === "not_enough_data") return "keep it as written";
  if (peaking) return "hold the volume; let the intensity rise toward the meet";
  if (!main) return "double progression: hit the top of the rep range on every set, then add the smallest load";
  if (level === "beginner") return "add the smallest load jump next session at the same reps";
  if (level === "advanced") return "keep the RPE target and let the load ride the e1RM; add volume only if recovery holds";
  return "add ~2–3% load week to week at the same RPE";
}

/** Each exercise they'll train next (or trained in the last month): progress, hold or back off, from its last few sessions. */
export function progressionSignals(h: IntelReport, ctx: AthleteContext, level: TrainingLevel | null, phase: Phase | null): ProgressionSignal[] {
  const today = ctx.today;
  const byEx = exposuresOf(h.days, today);
  const upcoming = new Map<string, { exercise: string; exerciseId: string | null; lift: Lift | null; competition: boolean }>();
  for (const d of h.days) if ((d.status === "upcoming" || d.status === "unscheduled") || (d.date && d.date > today)) for (const r of d.rows) upcoming.set(r.exerciseId ?? r.exercise.toLowerCase(), { exercise: r.exercise, exerciseId: r.exerciseId, lift: r.lift, competition: r.competition });
  for (const [k, list] of byEx) if (!upcoming.has(k) && daysBetween(list[list.length - 1].date, today) <= 28) upcoming.set(k, { exercise: list[0].row.exercise, exerciseId: list[0].row.exerciseId, lift: list[0].row.lift, competition: list[0].row.competition });
  const peaking = !!ctx.competition.next && ctx.competition.next.weeksOut <= 3;
  const recentPain = ctx.injuries.painReports.filter((p) => p.date && daysBetween(p.date, today) <= 21);
  const out: ProgressionSignal[] = [];
  for (const [key, info] of upcoming) {
    const list = byEx.get(key) ?? [];
    const last3 = list.slice(-3);
    const evidence = last3.map((e) => {
      const r = e.row;
      const top = r.topSet;
      // the load in the athlete's own unit (an lb lifter's 205 reads as 205 lb, never 93 kg)
      const load = top?.kg ? (ctx.unit === "lb" ? `${Math.round(top.kg * LB)} lb` : `${fmt(top.kg)} kg`) : null;
      return `${e.date}: ${r.setsDone}/${r.prescribed.sets ?? "?"} sets${r.repsHitPct != null ? `, ${Math.round(r.repsHitPct)}% of reps` : ""}${load ? `, top ${load} × ${top?.reps ?? "?"}` : ""}${top?.rpe != null ? ` @${top.rpe}` : ""}${r.prescribed.rpe ? ` (target ${r.prescribed.rpe})` : ""}`;
    });
    const pain = info.lift ? recentPain.filter((p) => PAIN_REGION[info.lift!].test(p.area ?? "")) : [];
    const base = { exerciseId: info.exerciseId, exercise: info.exercise, lift: info.lift, competition: info.competition, sessions: list.length, lastKg: list.length ? list[list.length - 1].row.topSet?.kg ?? null : null, pain: pain.length > 0 };
    if (list.length < 2) {
      out.push({ ...base, decision: "not_enough_data", why: list.length ? "only one logged session in the last 8 weeks" : "not logged in the last 8 weeks", evidence, method: "keep it as written", confidence: "low" });
      continue;
    }
    const under = (e: Exposure) => (e.completion != null && e.completion < 0.85) || (e.repsHit != null && e.repsHit < 85) || (e.rpeDelta != null && e.rpeDelta >= 1);
    // easier than written: every set done with RPE well under target, or (with no RPE logged) the top of a rep range on every set
    const topOfRange = (e: Exposure) => {
      const rr = e.row.prescribed.repRange;
      const sets = e.row.actual.filter((s) => s.working);
      return !!rr && rr[1] > rr[0] && sets.length > 0 && sets.every((s) => (s.reps ?? 0) >= rr[1]);
    };
    const over = (e: Exposure) =>
      (e.completion == null || e.completion >= 1) && (e.repsHit == null || e.repsHit >= 100) && ((e.rpeDelta != null && e.rpeDelta <= -0.75) || (topOfRange(e) && (e.rpeDelta == null || e.rpeDelta <= 0)));
    const nUnder = last3.filter(under).length;
    const nOver = last3.filter(over).length;
    // strength from the sessions that can show it (top set at RPE 7+) when there are two; else every session's
    const hardE1 = list.filter((e) => (e.row.topSet?.rpe ?? 0) >= INFORMATIVE_RPE).map((e) => e.e1rm).filter((n): n is number => n != null && n > 0);
    const e1 = hardE1.length >= 2 ? hardE1 : list.map((e) => e.e1rm).filter((n): n is number => n != null && n > 0);
    const e1Change = e1.length >= 2 ? pct(robust(e1.slice(0, Math.ceil(e1.length / 2)))!, robust(e1.slice(Math.floor(e1.length / 2)))!) : null;
    let decision: Decision = "maintain";
    let why: string;
    if (pain.length) {
      decision = nUnder >= 2 ? "regress" : "maintain";
      why = `${pain.length} pain report${pain.length === 1 ? "" : "s"} in a related area in the last 3 weeks (${pain.map((p) => `${p.area} ${p.level ?? "?"}/10`).join(", ")}): don't push it${nUnder >= 2 ? ", and it's been falling short" : ""}`;
    } else if (nUnder >= 2 && (last3.length === 3 && nUnder === 3 || (e1Change != null && e1Change <= -2) || last3.filter((e) => (e.rpeDelta ?? 0) >= 1).length >= 2)) {
      decision = "regress";
      why = `fell short in ${nUnder} of the last ${last3.length} sessions${e1Change != null ? `, e1RM ${e1Change > 0 ? "+" : ""}${e1Change}%` : ""}: a trend, not one bad day`;
      // in a cut, a small dip (RPE-adjusted e1RM within 5%) with every rep still done is the cut, not a failing prescription
      if (phase === "cutting" && (e1Change == null || e1Change > -5) && last3.every((e) => (e.repsHit ?? 100) >= 85)) {
        decision = "maintain";
        why = `harder than prescribed in ${nUnder} of the last ${last3.length} sessions, but the reps were done and they're cutting: hold it rather than back off`;
      }
    } else if (nUnder >= 2) {
      why = `fell short in ${nUnder} of the last ${last3.length} sessions but strength is holding: hold it and watch the next one`;
    } else if (nOver >= 2 && (e1Change == null || e1Change >= 0)) {
      decision = peaking ? "maintain" : "progress";
      why = `easier than prescribed in ${nOver} of the last ${last3.length} sessions (all the work done, under the target RPE or at the top of the rep range)${e1Change != null ? `, e1RM ${e1Change > 0 ? "+" : ""}${e1Change}%` : ""}${peaking ? "; the meet is close, so hold the volume" : ""}`;
    } else if (nUnder === 1) {
      why = "one session fell short; the others were on target: a normal fluctuation, not a reason to change";
    } else {
      why = "on target: the work done at about the prescribed effort";
    }
    out.push({ ...base, decision, why, evidence, method: methodFor(decision, last3[last3.length - 1].row, level, peaking), confidence: list.length >= 4 && !pain.length ? "moderate" : "low" });
  }
  const rank: Record<Decision, number> = { regress: 0, progress: 1, maintain: 2, not_enough_data: 3 };
  return out.sort((a, b) => rank[a.decision] - rank[b.decision] || Number(b.competition) - Number(a.competition) || a.exercise.localeCompare(b.exercise));
}

// ---------------------------------------------------------------------------
// Adherence and fatigue

function adherenceTrend(h: IntelReport, today: string): { recentPct: number | null; earlierPct: number | null; trend: "improving" | "declining" | "stable" | null; missed: Array<{ workout: string; missed: number; due: number }> } {
  const done = h.days.filter((d) => d.date && d.date <= today && d.status !== "upcoming" && d.status !== "unscheduled");
  const share = (list: DayCompare[]) => {
    const due = list.length;
    if (due < 3) return null;
    return Math.round((list.filter((d) => d.status === "completed" || d.status === "partial").length / due) * 100);
  };
  const recent = done.filter((d) => daysBetween(d.date!, today) <= 28);
  const earlier = done.filter((d) => daysBetween(d.date!, today) > 28 && daysBetween(d.date!, today) <= 84);
  const r = share(recent);
  const e = share(earlier);
  const trend = r != null && e != null ? (r - e >= 10 ? "improving" : e - r >= 10 ? "declining" : "stable") : null;
  const window = done.filter((d) => daysBetween(d.date!, today) <= 56);
  const byTitle = new Map<string, { missed: number; due: number }>();
  for (const d of window) {
    const k = d.title || `Day ${d.dayIndex}`;
    const v = byTitle.get(k) ?? { missed: 0, due: 0 };
    v.due++;
    if (d.status === "missed") v.missed++;
    byTitle.set(k, v);
  }
  const missed = [...byTitle.entries()].filter(([, v]) => v.due >= 3 && v.missed / v.due >= 0.4).map(([workout, v]) => ({ workout, ...v })).sort((a, b) => b.missed / b.due - a.missed / a.due);
  return { recentPct: r, earlierPct: e, trend, missed };
}

function fatigueRead(h: IntelReport, today: string): { signs: string[]; possible: boolean } {
  const rows = h.days.filter((d) => d.date && d.date <= today && (d.status === "completed" || d.status === "partial")).flatMap((d) => d.rows.filter((r) => r.lift && r.rpeDelta != null).map((r) => ({ date: d.date!, delta: r.rpeDelta as number, e1: r.bestE1rm, lift: r.lift })));
  const recent = rows.filter((r) => daysBetween(r.date, today) <= 21);
  const before = rows.filter((r) => daysBetween(r.date, today) > 21 && daysBetween(r.date, today) <= 42);
  const signs: string[] = [];
  const dRecent = mean(recent.map((r) => r.delta));
  const dBefore = mean(before.map((r) => r.delta));
  if (dRecent != null && dBefore != null && recent.length >= 3 && before.length >= 3 && dRecent - dBefore >= 0.7) signs.push(`main lifts feel harder than prescribed lately: RPE ${dRecent > 0 ? "+" : ""}${round(dRecent, 1)} vs target in the last 3 weeks, ${dBefore > 0 ? "+" : ""}${round(dBefore, 1)} the 3 weeks before`);
  const fb = h.days.filter((d) => d.feedback && d.date);
  const sr = (from: number, to: number) => mean(fb.filter((d) => daysBetween(d.date!, today) > from && daysBetween(d.date!, today) <= to).map((d) => d.feedback!.session_rpe).filter((n): n is number => n != null));
  const s1 = sr(-1, 21);
  const s0 = sr(21, 42);
  if (s1 != null && s0 != null && s1 - s0 >= 1) signs.push(`session RPE up from ${round(s0, 1)} to ${round(s1, 1)}`);
  const pain = h.recovery.painReports.filter((p) => p.date && daysBetween(p.date, today) <= 21);
  if (pain.length >= 2) signs.push(`${pain.length} pain reports in the last 3 weeks`);
  return { signs, possible: signs.length >= 2 };
}

// ---------------------------------------------------------------------------
// All of it

export type MissingInfo = { field: string; why: string; where: "info" | "goals-setup" | "metrics" | "program" };

/** What's not on file that these reads need (the same list wherever it's shown); never filled in by a guess. */
export function missingInfo(x: { age: number | null; sex: Sex | null; heightCm: number | null; lastBodyweight: string | null; experience: string | null; isPowerlifter: boolean; meetWithoutClass: boolean; today: string }): MissingInfo[] {
  const out: MissingInfo[] = [];
  if (x.age == null) out.push({ field: "Date of birth", why: "age and IPF age category", where: "info" });
  if (!x.sex) out.push({ field: "Sex", why: "GL points and weight classes", where: "info" });
  if (!x.heightCm) out.push({ field: "Height", why: "body size context", where: "info" });
  if (!x.lastBodyweight) out.push({ field: "Bodyweight log", why: "relative strength, phase, weight class", where: "metrics" });
  else if (daysBetween(x.lastBodyweight, x.today) > 21) out.push({ field: "A recent bodyweight", why: `last weigh-in ${x.lastBodyweight}`, where: "metrics" });
  if (trainingYears(x.experience) == null) out.push({ field: "Training experience", why: "training age and the progress to expect", where: "goals-setup" });
  if (x.isPowerlifter && x.meetWithoutClass) out.push({ field: "Weight class for the meet", why: "the cut or gain to plan for", where: "program" });
  return out;
}

export type AthleteDevelopment = {
  age: number | null;
  ageCategory: string | null;
  sex: Sex | null;
  heightCm: number | null;
  bodyweightKg: number | null;
  bodyweightDate: string | null;
  trainingYears: number | null;
  level: TrainingLevel | null;
  levelSource: string;
  monthsWithCoach: number | null;
  weightClass: { current: { label: string; limitKg: number | null } | null; target: string | null; targetLimitKg: number | null; marginKg: number | null; weeksOut: number | null; neededPctPerWeek: number | null } | null;
  bodyweightGoal: string | null;
  phase: ReturnType<typeof bodyweightPhase>;
  phases: PhaseSpan[];
  lifts: LiftDevelopment[];
  gymTotal: { kg: number; gl: number | null; bodyweightKg: number | null; asOf: string } | null;
  meets: Array<{ date: string | null; name: string | null; totalKg: number | null; bodyweightKg: number | null; gl: number | null; weightClass: string | null }>;
  progression: ProgressionSignal[];
  adherence: ReturnType<typeof adherenceTrend>;
  fatigue: ReturnType<typeof fatigueRead>;
  missing: MissingInfo[];
};

export function buildAthleteDevelopment(rec: IntelRecords, ctx: AthleteContext, h: IntelReport): AthleteDevelopment {
  const today = ctx.today;
  const sex = sexOf(ctx.profile.sex);
  const age = ctx.profile.age;
  const bw = [...rec.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const raw = ctx.profile.experience;
  const ty = trainingYears(raw);
  const monthsWithCoach = ctx.profile.trainingSince ? round(daysBetween(ctx.profile.trainingSince, today) / 30.44, 0) : null;
  // what they told you, else at least as long as they've trained with you
  const years = ty ?? (monthsWithCoach != null && monthsWithCoach >= 12 ? round(monthsWithCoach / 12, 1) : null);
  const level = levelFromYears(years);
  const levelSource = ty != null ? `from "${raw}"` : years != null ? "from their time training with you (no training experience on file)" : "unknown (no training experience on file)";
  const phase = bw.length ? bodyweightPhase(bw, bw[bw.length - 1].date) : null;
  const phases = bodyweightPhases(bw);
  const lifts = LIFTS.map((l) => liftDevelopment(h, l, bw, phases, level, today, ctx.unit)).filter((x): x is LiftDevelopment => !!x);
  // gym total: each competition lift's latest e1RM, only when all three were trained in the last 10 weeks
  // (each lift's best hard session in its last 8 weeks of training, so a light last session doesn't sink it)
  const recentLast = LIFTS.map((l) => {
    const pts = strengthPoints(h.lifts.find((x) => x.lift === l)).points;
    if (!pts.length) return null;
    const lastDate = pts[pts.length - 1].date;
    if (daysBetween(lastDate, today) > 70) return null;
    const recent = pts.filter((p) => daysBetween(p.date, lastDate) <= 56);
    return { kg: Math.max(...recent.map((p) => p.value)), date: lastDate };
  });
  const gymTotal = recentLast.every(Boolean)
    ? (() => {
        const kg = round(recentLast.reduce((n, x) => n + x!.kg, 0), 1);
        const asOf = recentLast.map((x) => x!.date).sort().slice(-1)[0];
        const bwNow = bodyweightOn(bw, asOf) ?? ctx.profile.bodyweightKg;
        return { kg, gl: glPoints(kg, bwNow, sex), bodyweightKg: bwNow, asOf };
      })()
    : null;
  const meets = [...rec.meets]
    .sort((a, b) => String(a.meet_date ?? "").localeCompare(String(b.meet_date ?? "")))
    .map((m) => ({ date: m.meet_date, name: m.meet_name, totalKg: m.total_kg, bodyweightKg: m.bodyweight_kg, gl: glPoints(m.total_kg, m.bodyweight_kg, sex), weightClass: m.weight_class_kg }));
  const next = ctx.competition.next;
  const target = next?.weightClass ?? ctx.profile.weightClass ?? null;
  const targetLimitKg = classLimit(target);
  const cur = ipfClass(ctx.profile.bodyweightKg, sex, age);
  const marginKg = targetLimitKg != null && ctx.profile.bodyweightKg != null ? round(targetLimitKg - ctx.profile.bodyweightKg, 1) : null;
  const weeksOut = next?.weeksOut ?? null;
  const neededPctPerWeek = marginKg != null && marginKg < 0 && weeksOut && ctx.profile.bodyweightKg ? round((-marginKg / ctx.profile.bodyweightKg / weeksOut) * 100, 2) : null;
  const missing = missingInfo({ age, sex, heightCm: ctx.profile.heightCm, lastBodyweight: bw.length ? bw[bw.length - 1].date : null, experience: raw, isPowerlifter: ctx.profile.isPowerlifter, meetWithoutClass: !!next && !next.weightClass, today });
  return {
    age,
    ageCategory: ageCategory(age),
    sex,
    heightCm: ctx.profile.heightCm,
    bodyweightKg: ctx.profile.bodyweightKg,
    bodyweightDate: ctx.profile.bodyweightDate,
    trainingYears: years,
    level,
    levelSource,
    monthsWithCoach,
    weightClass: cur || target ? { current: cur, target, targetLimitKg, marginKg, weeksOut, neededPctPerWeek } : null,
    bodyweightGoal: ctx.goals.bodyweightGoal,
    phase,
    phases,
    lifts,
    gymTotal,
    meets,
    progression: progressionSignals(h, ctx, level, phase?.phase ?? null),
    adherence: adherenceTrend(h, today),
    fatigue: fatigueRead(h, today),
    missing,
  };
}

// ---------------------------------------------------------------------------
// As the AI reads it

const DECISION_LABEL: Record<Decision, string> = { progress: "PROGRESS", maintain: "HOLD", regress: "BACK OFF", not_enough_data: "NOT ENOUGH DATA" };

/** `exercises: false` leaves out the exercise-by-exercise signals (the nutrition AI reads the athlete, not the program). */
export function developmentText(d: AthleteDevelopment, unit: Unit, opts: { exercises?: boolean } = {}): string {
  const u = (kg: number | null | undefined) => (kg == null ? "?" : unit === "lb" ? `${Math.round(kg * LB)} lb` : `${round(kg, 1)} kg`);
  const L: string[] = [];
  const who = [
    d.age != null ? `${d.age} y${d.ageCategory ? ` (${d.ageCategory})` : ""}` : "age not on file",
    d.sex ? (d.sex === "M" ? "male" : "female") : "sex not on file",
    d.heightCm ? `${d.heightCm} cm` : "height not on file",
    d.bodyweightKg != null ? `${u(d.bodyweightKg)} (${d.bodyweightDate})` : "no bodyweight on file",
    `training age: ${d.trainingYears != null ? `~${d.trainingYears} years` : "unknown"} → ${d.level ?? "level unknown"} (${d.levelSource})${d.monthsWithCoach != null ? `, ${d.monthsWithCoach} months with you` : ""}`,
  ];
  L.push(`Who: ${who.join(" · ")}`);
  if (d.weightClass) {
    const w = d.weightClass;
    const parts = [w.current ? `bodyweight sits in the IPF ${w.current.label} class` : null, w.target ? `competing at ${w.target}` : null, w.marginKg != null ? (w.marginKg >= 0 ? `${u(w.marginKg)} under the limit` : `${u(-w.marginKg)} OVER the limit${w.weeksOut ? ` with ${w.weeksOut} weeks to the meet (${w.neededPctPerWeek}%/week to make it; over ~1%/week is aggressive and costs strength)` : ""}`) : null].filter(Boolean);
    if (parts.length) L.push(`Weight class: ${parts.join(" · ")}`);
  }
  if (d.bodyweightGoal) L.push(`Bodyweight goal: ${d.bodyweightGoal}`);
  L.push(
    d.phase
      ? `Bodyweight now: ${d.phase.phase} (${d.phase.pctPerWeek > 0 ? "+" : ""}${d.phase.pctPerWeek}%/week over the last 5 weeks, ${d.phase.entries} weigh-ins)`
      : "Bodyweight now: not enough recent weigh-ins to tell a phase (needs 3+ over 2+ weeks)",
  );
  if (d.phases.length > 1) L.push(`Bodyweight phases: ${d.phases.map((p) => `${p.from}→${p.to} ${p.phase} (${p.changeKg >= 0 ? "+" : "−"}${u(Math.abs(p.changeKg))})`).join("; ")}`);
  L.push("Lifts (competition lift e1RMs, gym estimates; read absolute and relative together):");
  if (!d.lifts.length) L.push("- not enough logged competition-lift sessions to read a trend");
  for (const l of d.lifts) {
    L.push(`- ${l.lift}: ${l.reading} [${l.points} sessions, ${l.confidence} confidence]`);
    if (l.byPhase.length >= 2) L.push(`  best e1RM in each bodyweight phase (compare phases, not one block's rep ranges): ${l.byPhase.map((p) => `${p.phase} ${p.from}→${p.to}: ${u(p.bestKg)}${p.bwKg != null ? ` at ${u(p.bwKg)} (${p.rel}×)` : ""}`).join("; ")}`);
    if (l.variations.length > 1) L.push(`  their own variation history: ${l.variations.map((v) => `${v.exercise} ${v.changePct != null ? `${v.changePct > 0 ? "+" : ""}${v.changePct}%` : "?"} (${v.exposures})`).join(", ")}`);
  }
  if (d.gymTotal) L.push(`Gym total (e1RM estimate, NOT a meet result): ${u(d.gymTotal.kg)}${d.gymTotal.gl != null ? ` ≈ ${d.gymTotal.gl} IPF GL points at ${u(d.gymTotal.bodyweightKg)}` : ""} (as of ${d.gymTotal.asOf})`);
  if (d.meets.length) L.push(`Meet results (competition, classic GL): ${d.meets.map((m) => `${m.date ?? "?"} ${m.name ?? ""}: ${u(m.totalKg)} @${u(m.bodyweightKg)}${m.gl != null ? ` = ${m.gl} GL` : ""}`).join("; ")}`);
  if (opts.exercises !== false) {
    L.push("Exercise by exercise (from the last 8 weeks; one hard session isn't a trend):");
    if (!d.progression.length) L.push("- nothing upcoming or recently trained to read");
    for (const p of d.progression.slice(0, 40)) L.push(`- ${p.exercise}: ${DECISION_LABEL[p.decision]} (${p.confidence}) — ${p.why}. Next: ${p.method}.${p.evidence.length ? ` [${p.evidence.join(" | ")}]` : ""}`);
  }
  const a = d.adherence;
  L.push(`Adherence: ${a.recentPct != null ? `${a.recentPct}% of workouts in the last 4 weeks` : "too few workouts due in the last 4 weeks to read"}${a.earlierPct != null ? `, ${a.earlierPct}% the 8 weeks before (${a.trend})` : ""}${a.missed.length ? ` · often missed: ${a.missed.map((m) => `${m.workout} (${m.missed} of ${m.due})`).join(", ")}` : ""}`);
  L.push(`Fatigue: ${d.fatigue.signs.length ? `${d.fatigue.possible ? "POSSIBLE ACCUMULATION — " : ""}${d.fatigue.signs.join("; ")}` : "no signs in the last 6 weeks"}`);
  if (d.missing.length) L.push(`Not on file (never guess these): ${d.missing.map((m) => `${m.field} (${m.why})`).join("; ")}. Limb proportions aren't tracked: use their variation history and anything in the coach's rules.`);
  return L.join("\n");
}

/** How to use the analysis: the same words for every AI feature that reads it. */
export const DEVELOPMENT_RULES = `HOW TO USE "ATHLETE DEVELOPMENT" (computed from their records; it decides more than it informs)
- Exercise by exercise: PROGRESS means raise the right variable for that exercise, athlete and phase (load for the main lifts; reps then load for accessories; a set only if recovery holds). HOLD means leave it. BACK OFF means reduce load, volume, complexity or frequency first, and say why. NOT ENOUGH DATA means don't change it on assumptions. Go against a signal only for a reason you state (the coach's instruction, an upcoming deload or meet, a pain report) — never by default, and never add load every week because it's a new week.
- PROGRESS asks a little more than their last session did: one load step on their last successful load (2.5 kg / 5 lb on a barbell, the next dumbbell, a stack plate), or a rep within the range, as the method says. Writing their last load again is a HOLD, not progress. A step from a logged load is supported by their records; where the machine's step isn't known, progress the reps and say "then add the smallest jump" instead of guessing a number.
- One hard session is a fluctuation; two or three in a row (missed reps, RPE over target) is a trend.
- Bodyweight: read strength against bodyweight. Gaining: relative strength can fall and that's fine; bodyweight gain is not proof of muscle or of more strength to come. Cutting: holding absolute strength is success; don't chase PRs or add volume in a cut. Maintaining: absolute and relative should move together.
- Weight class: if they're over their class limit for a meet, plan the rate (over ~1%/week is aggressive and costs strength); if they're gaining toward a heavier class, expect relative strength to dip first.
- Training age: beginners progress session to session, intermediates week to week, advanced lifters block to block with more specificity; judge their rate against their own level (the "%/month" reference is a sanity check, not a target).
- Age: weigh it with their recovery and performance data; never cut volume just because they're older, and never assume a young lifter recovers from anything.
- Height and proportions: never pick a squat stance, deadlift style or bench setup from height. Use their own variation history (which variations they progress on) and what they say feels right.
- GL points and gym totals are estimates; only meet results are competition results. Never call an estimate a total or a PR.
- Little data means low confidence: say so instead of concluding.`;
