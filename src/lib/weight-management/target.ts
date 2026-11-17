/**
 * Is the target realistic, and what exactly is the target? A weight class is
 * made at the weigh-in in a normal, fed and hydrated state: the app never
 * plans dehydration, water loading or a crash cut to close a gap, so the
 * number it plans to is the class limit less a small buffer for the scale and
 * a normal morning swing. The rate it takes is then judged against what keeps
 * muscle and strength for that sport and goal (slower cuts keep more lean
 * mass and strength: Garthe et al. 2011, 0.7 vs 1.4%/week; Helms et al. 2014,
 * 0.5–1%/week for contest prep; lean gaining at 0.25–0.5% a month for trained
 * lifters, more for beginners), and a too-fast cut for a weight class points
 * at the next class up instead of a harder cut. Pure, tested.
 */
import { round, type WeightUnit, fmtWeight } from "@/lib/weight-management/units";

export type GoalContext =
  | "powerlifting_class"
  | "weight_class_sport"
  | "bodybuilding"
  | "fat_loss"
  | "recomp"
  | "maintain"
  | "gain"
  | "event";

export type Sex = "M" | "F";
export type Level = "beginner" | "intermediate" | "advanced";

/** Loss rates, % of bodyweight a week: up to `comfortable` keeps strength and muscle best; past `limit` costs them. */
export const LOSS_RATES: Record<Exclude<GoalContext, "gain" | "maintain">, { comfortable: number; limit: number }> = {
  powerlifting_class: { comfortable: 0.5, limit: 1.0 },
  weight_class_sport: { comfortable: 0.5, limit: 1.0 },
  bodybuilding: { comfortable: 0.75, limit: 1.0 },
  fat_loss: { comfortable: 0.75, limit: 1.0 },
  recomp: { comfortable: 0.35, limit: 0.75 },
  event: { comfortable: 0.75, limit: 1.0 },
};

/** Gain rates, % of bodyweight a week, by training age (about 1–1.5% a month for beginners, 0.5–1% intermediate, ≤0.5% advanced). */
export const GAIN_RATES: Record<Level, { comfortable: number; limit: number }> = {
  beginner: { comfortable: 0.35, limit: 0.6 },
  intermediate: { comfortable: 0.25, limit: 0.45 },
  advanced: { comfortable: 0.12, limit: 0.25 },
};

/* ------------------------------------------------------------------------ */
/* Weigh-in timing by federation                                             */

export type WeighIn = { hours: number | null; federation: string | null; known: boolean };

/**
 * Typical weigh-in timing. IPF and its affiliates weigh in 2 hours before
 * lifting; most untested and multi-ply federations 24 hours out. Always worth
 * checking the meet's own rules: "known" is false when the federation isn't
 * one of these.
 */
const TWO_HOUR = /\b(ipf|cpu|usapl|usa powerlifting|powerlifting america|epf|bp|british powerlifting|apu|nzpf|ppa|naplf|wpc-?2h)\b/i;
const DAY_BEFORE = /\b(uspa|wrpf|rps|spf|apf|wpc|ipl|cpf|ppl|100%? ?raw|rum|xpc|gpc|gpa|wpa|ipa)\b/i;

export function weighInTiming(federation: string | null | undefined): WeighIn {
  const f = String(federation ?? "").trim();
  if (!f) return { hours: null, federation: null, known: false };
  if (TWO_HOUR.test(f)) return { hours: 2, federation: f, known: true };
  if (DAY_BEFORE.test(f)) return { hours: 24, federation: f, known: true };
  return { hours: null, federation: f, known: false };
}

/* ------------------------------------------------------------------------ */
/* Weight classes                                                            */

/** IPF classes (kg); 53 / 43 only for sub-juniors and juniors (age ≤ 23). */
export function ipfLimits(sex: Sex, age: number | null = null): number[] {
  const youth = age != null && age <= 23;
  return sex === "M" ? [...(youth ? [53] : []), 59, 66, 74, 83, 93, 105, 120] : [...(youth ? [43] : []), 47, 52, 57, 63, 69, 76, 84];
}

/** "83", "-83kg", "83 kg", "84+" → its limit in kg (null for an open "+" class). */
export function classLimitKg(raw: string | null | undefined): number | null {
  const t = String(raw ?? "").trim();
  if (!t || /\+/.test(t)) return null;
  const isLb = /lb/i.test(t);
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const kg = isLb ? n / 2.2046226218 : n;
  return kg >= 30 && kg <= 200 ? round(kg, 2) : null;
}

/**
 * What to plan to for a class: the limit less a buffer for a different scale
 * and a normal morning swing (half a percent, or their own day-to-day scatter
 * when it's bigger, at most 1%). The plan is to be there in a normal state;
 * anything acute on top is the coach's call, never the app's.
 */
export function plannedClassWeight(limitKg: number, noiseKg: number | null = null): { kg: number; bufferKg: number } {
  const buffer = Math.min(limitKg * 0.01, Math.max(limitKg * 0.005, noiseKg ?? 0));
  return { kg: round(limitKg - buffer, 2), bufferKg: round(buffer, 2) };
}

/* ------------------------------------------------------------------------ */
/* Realism                                                                   */

export type TargetVerdict = "reached" | "comfortable" | "aggressive" | "too_fast" | "no_date" | "past";

export type TargetAssessment = {
  context: GoalContext;
  verdict: TargetVerdict;
  /** % of bodyweight a week it takes (negative = loss). */
  requiredPctPerWeek: number | null;
  requiredKgPerWeek: number | null;
  rates: { comfortable: number; limit: number };
  /** For a class: the next class up and what it would take. */
  alternative: { label: string; limitKg: number; requiredPctPerWeek: number } | null;
  /** What was learned from their own earlier cuts, when it changes the call. */
  history: string | null;
  message: string;
};

export type PastPhase = { phase: "cutting" | "gaining" | "maintaining"; from: string; to: string; pctPerWeek: number; strengthChangePct: number | null };

/**
 * Their own record: the fastest cut they've done that held strength (lower
 * lifts within 2%), and whether a faster one cost them. Used to tighten the
 * comfortable rate to what's worked for them, never to loosen past the limit.
 */
export function cutHistory(past: PastPhase[]): { safePct: number | null; costlyPct: number | null; line: string | null } {
  const cuts = past.filter((p) => p.phase === "cutting" && p.strengthChangePct != null);
  if (!cuts.length) return { safePct: null, costlyPct: null, line: null };
  const held = cuts.filter((c) => (c.strengthChangePct as number) >= -2);
  const lost = cuts.filter((c) => (c.strengthChangePct as number) < -3);
  const safePct = held.length ? Math.max(...held.map((c) => Math.abs(c.pctPerWeek))) : null;
  const costlyPct = lost.length ? Math.min(...lost.map((c) => Math.abs(c.pctPerWeek))) : null;
  const parts: string[] = [];
  if (safePct != null) parts.push(`held strength cutting at ${round(safePct, 2)}%/week before`);
  if (costlyPct != null) parts.push(`lost strength cutting at ${round(costlyPct, 2)}%/week`);
  return { safePct, costlyPct, line: parts.length ? `Their own record: ${parts.join("; ")}.` : null };
}

export function assessTarget(x: {
  context: GoalContext;
  currentKg: number;
  targetKg: number;
  weeks: number | null;
  sex: Sex | null;
  age?: number | null;
  level: Level | null;
  unit: WeightUnit;
  /** For a class: the class as written and its limit. */
  classLimitKg?: number | null;
  past?: PastPhase[];
}): TargetAssessment {
  const gapKg = x.targetKg - x.currentKg;
  const gain = x.context === "gain" || (x.context === "event" && gapKg > 0);
  const rates = x.context === "maintain" ? { comfortable: 0.25, limit: 0.5 } : gain ? { ...GAIN_RATES[x.level ?? "intermediate"] } : { ...LOSS_RATES[x.context as keyof typeof LOSS_RATES] };
  const hist = cutHistory(x.past ?? []);
  let history: string | null = null;
  if (!gain && x.context !== "maintain") {
    if (hist.costlyPct != null && hist.costlyPct < rates.limit) {
      rates.limit = round(Math.max(rates.comfortable, hist.costlyPct), 2);
      history = hist.line;
    }
    if (hist.safePct != null && hist.safePct < rates.comfortable) history = hist.line;
  }
  const isClass = x.context === "powerlifting_class" || x.context === "weight_class_sport";
  const done =
    x.context === "maintain" || x.context === "event"
      ? Math.abs(gapKg) <= Math.max(0.3, x.currentKg * (x.context === "maintain" ? 0.01 : 0.005))
      : gain
        ? gapKg <= 0
        : gapKg >= 0;
  const base = { context: x.context, rates, alternative: null, history } as const;
  const w = (kg: number) => fmtWeight(kg, x.unit);
  if (done) return { ...base, verdict: "reached", requiredPctPerWeek: 0, requiredKgPerWeek: 0, message: isClass ? `Already under the planned weight for the class (${w(x.targetKg)}): hold it there.` : `At the goal (${w(x.targetKg)}): hold it.` };
  if (x.weeks == null) return { ...base, verdict: "no_date", requiredPctPerWeek: null, requiredKgPerWeek: null, message: `No date set: ${w(Math.abs(gapKg))} to ${gapKg < 0 ? "lose" : "gain"} at whatever pace keeps training going well.` };
  if (x.weeks <= 0) return { ...base, verdict: "past", requiredPctPerWeek: null, requiredKgPerWeek: null, message: "The date has passed." };
  const kgPerWeek = gapKg / x.weeks;
  const pct = round((kgPerWeek / x.currentKg) * 100, 2);
  const a = Math.abs(pct);
  const verdict: TargetVerdict = a <= rates.comfortable ? "comfortable" : a <= rates.limit ? "aggressive" : "too_fast";
  let alternative: TargetAssessment["alternative"] = null;
  if (isClass && verdict !== "comfortable" && x.sex) {
    const limit = x.classLimitKg ?? null;
    const next = ipfLimits(x.sex, x.age ?? null).find((l) => limit != null && l > limit + 0.5);
    if (next) {
      const planned = plannedClassWeight(next).kg;
      const altPct = planned >= x.currentKg ? 0 : round(((planned - x.currentKg) / x.weeks / x.currentKg) * 100, 2);
      alternative = { label: `${next} kg`, limitKg: next, requiredPctPerWeek: altPct };
    }
  }
  const pace = `${w(Math.abs(kgPerWeek))} a week (${a}% of bodyweight) for ${round(x.weeks, 1)} weeks`;
  const message =
    verdict === "comfortable"
      ? `Realistic: ${pace}, inside the ${rates.comfortable}%/week that keeps ${gain ? "the gain mostly muscle" : "strength and muscle"}.`
      : verdict === "aggressive"
        ? `Aggressive: ${pace}. Doable, but ${gain ? "more of the gain will be fat" : "expect strength to suffer some"}; there's no room to fall behind.`
        : gain
          ? `Too fast: ${pace} is past ${rates.limit}%/week, so most of it would be fat. Give it more time.`
          : `Too fast: ${pace} is past ${rates.limit}%/week, which costs strength and muscle.${alternative ? ` The ${alternative.label} class takes ${alternative.requiredPctPerWeek === 0 ? "no cut at all" : `${Math.abs(alternative.requiredPctPerWeek)}%/week`}.` : " Move the date or the target before cutting harder."}`;
  return { ...base, verdict, requiredPctPerWeek: pct, requiredKgPerWeek: round(kgPerWeek, 3), alternative, message };
}
