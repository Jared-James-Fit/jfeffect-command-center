/**
 * The numbers behind a Nutrition Update, worked out in code so the AI reasons
 * from facts instead of guessing them: how bodyweight is really moving (a
 * least-squares trend with its day-to-day scatter, so a normal fluctuation
 * never reads as a trend), what the client actually ate when they logged it,
 * the maintenance their own data implies, anything in their answers that needs
 * a professional, and checks on what the AI wrote (macros that don't add up,
 * menus off their targets, floors no lifter should go under). Pure.
 */
import { normalizeDayLabel, type ClientNutritionDayType } from "@/lib/client-nutrition-day";
import { planMenus } from "@/lib/nutrition-targets/plan-foods";

const DAY = 86_400_000;
const LB = 2.2046226;
/** Energy in a kg of bodyweight change once water and glycogen settle (the usual ~3,500 kcal per lb). */
export const KCAL_PER_KG = 7700;
/** The first two weeks after calories change move water and glycogen, not tissue. */
export const SETTLE_DAYS = 14;

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;
const days = (a: string, b: string) =>
  (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / DAY;
const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/* ------------------------------------------------------------------------ */
/* Bodyweight trend                                                          */

export type WeighIn = { date: string; kg: number };

export type WeightTrend = {
  /** Least-squares change, % of bodyweight per week (negative = losing). */
  pctPerWeek: number;
  kgPerWeek: number;
  weighIns: number;
  /** Weeks between the first and last weigh-in used. */
  weeks: number;
  from: string;
  to: string;
  /** Typical day-to-day scatter around the trend line, kg (1 SD). */
  noiseKg: number;
  /** Bigger than the scatter could make it look by chance (slope at least 2 standard errors from flat). */
  clear: boolean;
  /** The plan's first two weeks were left out (water and glycogen after a calorie change). */
  settledFrom: string | null;
};

/**
 * Their bodyweight trend from `start` to `end`: a straight line through every
 * weigh-in (each counts, none is "the" weight), from two weeks into the plan
 * when that still leaves 3+ weeks, else the whole window. Needs 4+ weigh-ins
 * over 2+ weeks; null otherwise (never a trend from two numbers).
 */
export function weightTrend(points: WeighIn[], start: string, end: string): WeightTrend | null {
  const inWindow = (from: string) =>
    points
      .filter((p) => p.date >= from && p.date <= end && Number.isFinite(p.kg) && p.kg > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  const settleAt = addDays(start, SETTLE_DAYS);
  const settled = days(settleAt, end) >= 21 ? inWindow(settleAt) : [];
  const usable = (xs: WeighIn[]) =>
    xs.length >= 4 && days(xs[0].date, xs[xs.length - 1].date) >= 14;
  const pts = usable(settled) ? settled : inWindow(start);
  if (!usable(pts)) return null;
  const x0 = pts[0].date;
  const xs = pts.map((p) => days(x0, p.date) / 7);
  const ys = pts.map((p) => p.kg);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (sxx <= 0) return null;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / sxx;
  const ssr = xs.reduce((a, x, i) => a + (ys[i] - (my + slope * (x - mx))) ** 2, 0);
  const noise = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  const se = noise / Math.sqrt(sxx);
  return {
    pctPerWeek: round((slope / my) * 100, 2),
    kgPerWeek: round(slope, 3),
    weighIns: n,
    weeks: round(xs[xs.length - 1], 1),
    from: pts[0].date,
    to: pts[n - 1].date,
    noiseKg: round(noise, 2),
    clear: se === 0 ? slope !== 0 : Math.abs(slope) >= 2 * se,
    settledFrom: pts === settled ? settleAt : null,
  };
}

/* ------------------------------------------------------------------------ */
/* Logged food                                                               */

export type FoodLogEntry = {
  at: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

export type FoodLog = {
  /** Days with anything logged, of the days in the window. */
  daysLogged: number;
  daysInWindow: number;
  /** Average per logged day (days with nothing logged left out). */
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
};

/** What they logged in the app's food log, per logged day. Null when fewer than 5 days have anything. */
export function foodLogSummary(
  entries: FoodLogEntry[],
  start: string,
  end: string,
  tz = "UTC",
): FoodLog | null {
  const byDay = new Map<string, { kcal: number; protein: number; carbs: number; fat: number }>();
  for (const e of entries) {
    const d = localDay(e.at, tz);
    if (!d || d < start || d > end) continue;
    const t = byDay.get(d) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    t.kcal += Number(e.kcal) || 0;
    t.protein += Number(e.protein) || 0;
    t.carbs += Number(e.carbs) || 0;
    t.fat += Number(e.fat) || 0;
    byDay.set(d, t);
  }
  const logged = [...byDay.values()].filter((t) => t.kcal > 0);
  if (logged.length < 5) return null;
  const avg = (k: keyof (typeof logged)[number]) =>
    Math.round(logged.reduce((a, t) => a + t[k], 0) / logged.length);
  return {
    daysLogged: logged.length,
    daysInWindow: Math.max(1, Math.round(days(start, end)) + 1),
    kcal: avg("kcal"),
    protein: avg("protein"),
    carbs: avg("carbs"),
    fat: avg("fat"),
  };
}

function localDay(iso: string, tz: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/* ------------------------------------------------------------------------ */
/* Maintenance their data implies                                            */

export type PlanDayKcal = { label: string; calories: number | null };
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The plan's average calories a day across a week: the High Day on its
 * weekday (one a week), the Training Day on their other training days, the
 * Non-Training Day on the rest. Null when the plan's days can't be read.
 */
export function weeklyAverageKcal(
  planDays: PlanDayKcal[],
  trainingDays: string[],
  highWeekday: string | null,
): number | null {
  const byType = new Map<ClientNutritionDayType, number>();
  for (const d of planDays) {
    const t = normalizeDayLabel(d.label);
    if (t && d.calories != null && Number(d.calories) > 0 && !byType.has(t))
      byType.set(t, Number(d.calories));
  }
  if (!byType.size) return null;
  const any = [...byType.values()][0];
  const train = new Set(trainingDays.map((d) => d.trim().toLowerCase()));
  let total = 0;
  for (const wd of WEEKDAYS) {
    const isTraining = train.has(wd.toLowerCase());
    const high =
      highWeekday && wd.toLowerCase() === highWeekday.toLowerCase()
        ? byType.get("high")
        : undefined;
    total +=
      high ??
      (isTraining ? byType.get("training") : byType.get("non_training")) ??
      byType.get("training") ??
      byType.get("non_training") ??
      any;
  }
  return Math.round(total / 7);
}

export type Maintenance = {
  kcal: number;
  from: "logged food" | "the plan's calories";
  confidence: "low" | "moderate" | "high";
  why: string;
};

/**
 * The maintenance their own results imply: what they ate minus the energy in
 * their weight change (about 7,700 kcal a kg once water settles). What they
 * ate is their food log when it covers most days, else the plan's calories
 * when they say they stuck to it (4/5+); with neither, nothing is claimed.
 */
export function observedMaintenance(x: {
  trend: WeightTrend | null;
  food: FoodLog | null;
  planKcal: number | null;
  adherence: number | null;
}): Maintenance | null {
  const t = x.trend;
  if (!t || t.weeks < 3) return null;
  const logged =
    x.food && x.food.daysLogged >= Math.max(10, x.food.daysInWindow * 0.6) ? x.food : null;
  const intake = logged
    ? logged.kcal
    : x.planKcal != null && x.adherence != null && x.adherence >= 4
      ? x.planKcal
      : null;
  if (intake == null) return null;
  const balance = (t.kgPerWeek * KCAL_PER_KG) / 7;
  const kcal = Math.round((intake - balance) / 25) * 25;
  const confidence =
    logged && t.clear && t.weighIns >= 10
      ? "high"
      : t.weighIns >= 8 && t.weeks >= 4
        ? "moderate"
        : "low";
  const why = `${logged ? `logged ${logged.kcal} kcal a day (${logged.daysLogged} days logged)` : `plan average ${intake} kcal a day at ${x.adherence}/5 adherence`}, bodyweight ${t.kgPerWeek >= 0 ? "+" : ""}${round(t.kgPerWeek, 2)} kg a week (${t.clear ? "a clear trend" : "within normal scatter, so about flat"})`;
  return { kcal, from: logged ? "logged food" : "the plan's calories", confidence, why };
}

/* ------------------------------------------------------------------------ */
/* Safety                                                                    */

const SAFETY_TERMS: Array<[RegExp, string]> = [
  [
    /\b(eating disorder|anorexi\w*|bulimi\w*|binge[- ]?eat\w*|arfid|orthorexi\w*|purg(e|ing)|disordered eating)\b/i,
    "eating disorder history or signs",
  ],
  [/\bpregnan\w*|\bbreast-?feed\w*|\bpost-?partum\b/i, "pregnancy or breastfeeding"],
  [
    /\bdiabet\w*|\bmetformin\b|\b(on|take|taking|using) insulin\b|\bblood sugar (medication|meds)\b/i,
    "diabetes or blood sugar medication",
  ],
  [/\bozempic|wegovy|mounjaro|zepbound|semaglutide|tirzepatide|glp-?1\b/i, "GLP-1 medication"],
  [/\bkidney|renal|ckd\b/i, "kidney condition"],
  [
    /\bheart (condition|disease)|cardiac|hypertension|high blood pressure\b/i,
    "heart or blood pressure condition",
  ],
  [/\bthyroid|hashimoto\w*|graves\b/i, "thyroid condition"],
  [/\bcrohn\w*|colitis|celiac|coeliac|ibs\b/i, "a digestive condition"],
  [/\bpcos\b|polycystic/i, "PCOS"],
];

/** Health things in their answers a coach shouldn't program around alone. "None" answers never count. */
export function safetyNotes(answers: Array<{ label: string; value: string }>): string[] {
  const found = new Set<string>();
  for (const a of answers) {
    const v = String(a.value ?? "").trim();
    if (!v || /^(none|no|n\/a|na|nothing|nope|-)\.?$/i.test(v)) continue;
    for (const [re, what] of SAFETY_TERMS) if (re.test(v)) found.add(what);
  }
  return [...found];
}

/* ------------------------------------------------------------------------ */
/* The AI's targets, read back                                               */

export type DayTargets = {
  label: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

/** CALORIE TARGETS + MACRO TARGETS from the targets text, per day type, in the order written. */
export function parseAiTargets(text: string | null | undefined): DayTargets[] {
  const out = new Map<string, DayTargets>();
  const get = (label: string) => {
    const k = normalizeDayLabel(label) ?? label.trim().toLowerCase();
    let d = out.get(k);
    if (!d)
      out.set(k, (d = { label: label.trim(), kcal: null, protein: null, carbs: null, fat: null }));
    return d;
  };
  let section: "kcal" | "macros" | null = null;
  let current: DayTargets | null = null;
  for (const raw of String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^calorie targets\s*:?$/i.test(line)) {
      section = "kcal";
      continue;
    }
    if (/^macro targets\s*:?$/i.test(line)) {
      section = "macros";
      current = null;
      continue;
    }
    if (/^[A-Z][A-Z\s/&-]+:?$/.test(line) && !/day/i.test(line)) {
      section = null;
      continue;
    }
    if (section === "kcal") {
      const m = line.match(/^([A-Za-z][A-Za-z\s-]*day)\s*:\s*([\d,]+)/i);
      if (m) get(m[1]).kcal = Number(m[2].replace(/,/g, ""));
    } else if (section === "macros") {
      if (/^[A-Za-z][A-Za-z\s-]*day\s*:?$/i.test(line)) {
        current = get(line.replace(/:$/, ""));
        continue;
      }
      const m = line.match(/^(protein|carbs?|carbohydrates?|fats?)\s*:\s*([\d.]+)/i);
      if (m && current) {
        const n = Number(m[2]);
        const k = m[1].toLowerCase();
        if (k.startsWith("prot")) current.protein = n;
        else if (k.startsWith("carb")) current.carbs = n;
        else current.fat = n;
      }
    }
  }
  return [...out.values()];
}

const macroKcal = (d: { protein: number | null; carbs: number | null; fat: number | null }) =>
  d.protein != null && d.carbs != null && d.fat != null
    ? d.protein * 4 + d.carbs * 4 + d.fat * 9
    : null;

/** Anything in the AI's targets whose numbers don't hold together (a calorie line its macros don't add to). */
export function targetsMathIssues(days: DayTargets[]): string[] {
  const out: string[] = [];
  for (const d of days) {
    const sum = macroKcal(d);
    if (d.kcal != null && sum != null && Math.abs(sum - d.kcal) / d.kcal > 0.03)
      out.push(`${d.label}: ${d.kcal} kcal listed, but its macros add to ${Math.round(sum)} kcal`);
  }
  return out;
}

/** "COACH NOTES" (the AI's reasoning and flags) is the coach's: it never goes where a client can read it. */
export function withoutCoachNotes(text: string | null | undefined): string | null {
  if (text == null) return null;
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => /^coach notes\s*:?\s*$/i.test(l.trim()));
  return at < 0 ? text : lines.slice(0, at).join("\n").trimEnd();
}

/** The AI's own "Flags:" line from COACH NOTES, or null when it says none. */
export function coachNotesFlags(text: string | null | undefined): string | null {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const at = lines.findIndex((l) => /^coach notes\s*:?\s*$/i.test(l.trim()));
  if (at < 0) return null;
  const line = lines.slice(at + 1).find((l) => /^flags\s*:/i.test(l.trim()));
  const v = line?.replace(/^\s*flags\s*:\s*/i, "").trim() ?? "";
  return !v || /^(none|nothing|n\/a|-)\.?$/i.test(v) ? null : v;
}

/* ------------------------------------------------------------------------ */
/* A written meal plan against its targets                                   */

type Totals = { protein: number | null; carbs: number | null; fat: number | null };

function readTotals(line: string): Totals {
  const pick = (re: RegExp) => {
    const m = line.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    protein: pick(/(\d+(?:\.\d+)?)\s*g?\s*protein/i),
    carbs: pick(/(\d+(?:\.\d+)?)\s*g?\s*carb/i),
    fat: pick(/(\d+(?:\.\d+)?)\s*g?\s*fat/i),
  };
}

/**
 * Where a written meal plan doesn't hold together: a menu whose Daily Total is
 * off its targets by more than 3% (calories or protein), or whose meals don't
 * add up to the Daily Total it states. What the client sees has to add up.
 */
export function planTotalsIssues(planText: string, targets: DayTargets[]): string[] {
  const out: string[] = [];
  const byType = new Map(
    targets.map((t) => [normalizeDayLabel(t.label) ?? t.label.toLowerCase(), t]),
  );
  for (const menu of planMenus(planText)) {
    const lines = menu.notes.split("\n").map((l) => l.trim());
    const at = lines.findIndex((l) => /^daily total\b/i.test(l));
    const totalLine = at >= 0 ? lines.slice(at, at + 3).join(" ") : "";
    const total = readTotals(totalLine);
    // the meals' own macro blocks, summed
    let p = 0;
    let c = 0;
    let f = 0;
    let meals = 0;
    let inMacros = false;
    for (const l of lines.slice(0, at >= 0 ? at : lines.length)) {
      if (/^approximate macros?:?$/i.test(l)) {
        inMacros = true;
        meals++;
        continue;
      }
      if (!l) {
        inMacros = false;
        continue;
      }
      if (!inMacros) continue;
      const m = l.match(/^(\d+(?:\.\d+)?)\s*g?\s*(protein|carb\w*|fat\w*)\b/i);
      if (!m) continue;
      const n = Number(m[1]);
      if (/^prot/i.test(m[2])) p += n;
      else if (/^carb/i.test(m[2])) c += n;
      else f += n;
    }
    const totalKcal = macroKcal(total);
    if (meals >= 2 && total.protein != null && total.carbs != null && total.fat != null) {
      const off = (a: number, b: number) => Math.abs(a - b) > Math.max(5, b * 0.05);
      if (off(p, total.protein) || off(c, total.carbs) || off(f, total.fat))
        out.push(
          `${menu.label}: the meals add to ${round(p)} g protein, ${round(c)} g carbs, ${round(f)} g fat, but its Daily Total says ${total.protein} / ${total.carbs} / ${total.fat}`,
        );
    }
    const target = byType.get(normalizeDayLabel(menu.label) ?? menu.label.toLowerCase());
    if (!target || totalKcal == null) continue;
    const want = target.kcal ?? macroKcal(target);
    // meal prep comes first (MEAL_PLAN_PROMPT rule 2c): within about 5% is on target
    if (want && Math.abs(totalKcal - want) / want > 0.05)
      out.push(
        `${menu.label}: Daily Total is ${Math.round(totalKcal)} kcal against a target of ${want} kcal`,
      );
    if (
      target.protein &&
      total.protein != null &&
      Math.abs(total.protein - target.protein) > Math.max(10, target.protein * 0.05)
    )
      out.push(`${menu.label}: ${total.protein} g protein against a target of ${target.protein} g`);
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Before the coach publishes                                                */

/**
 * What a coach should look at before publishing an AI plan: macros that don't
 * add up, a day under a floor no lifter should go under (fat under 0.5 g/kg,
 * protein under 1.2 g/kg, calories under 1,200 for women or 1,500 otherwise),
 * a weight class that would take more than 1% a week to make, and health
 * things in their answers. Empty when there's nothing to check.
 */
export function coachChecks(x: {
  days: DayTargets[];
  bodyweightKg: number | null;
  female: boolean;
  safety: string[];
  weightClassPctPerWeek?: number | null;
}): string[] {
  const out = [...targetsMathIssues(x.days)];
  const floor = x.female ? 1200 : 1500;
  for (const d of x.days) {
    const kcal = d.kcal ?? macroKcal(d);
    if (kcal != null && kcal < floor)
      out.push(`${d.label}: ${Math.round(kcal)} kcal is under ${floor}`);
    if (x.bodyweightKg) {
      if (d.fat != null && d.fat < 0.5 * x.bodyweightKg)
        out.push(`${d.label}: fat ${d.fat} g is under 0.5 g per kg of bodyweight`);
      if (d.protein != null && d.protein < 1.2 * x.bodyweightKg)
        out.push(`${d.label}: protein ${d.protein} g is under 1.2 g per kg of bodyweight`);
    }
  }
  if (x.weightClassPctPerWeek != null && x.weightClassPctPerWeek > 1)
    out.push(
      `Making the weight class takes ${x.weightClassPctPerWeek}% of bodyweight a week: over 1% costs strength, so talk it through (a heavier class, or a slower cut) before cutting harder`,
    );
  if (x.safety.length)
    out.push(
      `They mentioned ${x.safety.join(", ")}: plan it with their doctor or a registered dietitian`,
    );
  return out;
}

/** A bodyweight answer ("182", "182 lbs", "82 kg") in kg (the form asks in lbs). */
export function bodyweightAnswerKg(text: string | null | undefined): number | null {
  const m = String(text ?? "").match(/(\d+(?:\.\d+)?)\s*(kg|lb|lbs)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /kg/i.test(m[2] ?? "") ? n : n / LB;
}
