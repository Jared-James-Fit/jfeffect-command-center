/**
 * Profile-synced form questions (pure, tested). A question opts in with
 * `validation.prefill`; when the client opens the form the renderer saves what
 * the app already knows as the answer, and they can change it for this form
 * (only a changed sex answer is written back to the profile, on submit).
 *
 * Every key says where its answer comes from (`source`, shown under the
 * question while the answer still matches) and whether that beats the last
 * answer they gave (`strong`): a fact the app keeps up to date (their training
 * schedule, birth year, a weigh-in, when they actually train) wins over what
 * they said last time; a starting point (Goals & Setup's goal) only fills a
 * question they've never answered. `startingAnswer` is the one place that
 * decides between the two, for the form and the weekly check-in's fold alike.
 */
import { formatHeight, type HeightUnit } from "@/lib/basic-info";
import { sexLabel } from "@/lib/athlete-sex";
import { MEAL_CHOICE } from "@/lib/nutrition-history";
import { eligibleAgeClasses, eligibleOptions } from "@/lib/form-fields";

export type PrefillKey =
  | "sex"
  | "height"
  | "nutrition_plan"
  | "full_name"
  | "age_class"
  | "weight_class"
  // The meet a checklist is for (meet-checklist.ts pickMeet) and the latest weigh-in.
  | "meet_name"
  | "meet_date"
  | "meet_weight_class"
  | "bodyweight"
  // Their training schedule, Goals & Setup's goal, when they actually start their workouts.
  | "training_days"
  | "goal"
  | "training_time";

const KEYS: PrefillKey[] = [
  "sex",
  "height",
  "nutrition_plan",
  "full_name",
  "age_class",
  "weight_class",
  "meet_name",
  "meet_date",
  "meet_weight_class",
  "bodyweight",
  "training_days",
  "goal",
  "training_time",
];

export type PrefillProfile = {
  sex?: string | null;
  height_cm?: number | null;
  preferred_height_unit?: string | null;
  /** Has a meal plan they can see (null = unknown). */
  has_nutrition_plan?: boolean | null;
  full_name?: string | null;
  date_of_birth?: string | null;
  /** The meet the checklist is for: the one the coach sent it with, else their next meet. */
  meet?: { name: string | null; date: string | null; weightClass: string | null; source: string } | null;
  /** The latest weigh-in in their unit; only filled in by itself when it's from today or yesterday. */
  bodyweight?: { value: number; unit: "kg" | "lb"; date: string; fresh: boolean; ageDays?: number } | null;
  /** Their committed training days ("Monday", …): the one schedule. */
  training_days?: string[] | null;
  /** Goals & Setup's nutrition goal and main goal, as they picked them. */
  goals?: { nutrition?: string | null; main?: string | null } | null;
  /** The local hour (0–24, decimals for minutes) each recent workout started. */
  training_starts?: number[] | null;
  /** The weight class on their next meet prep (the coach's). */
  prep_weight_class?: string | null;
  /** Their recent bodyweight: the average of the week up to their latest weigh-in, in their unit. */
  recent_bodyweight?: { value: number; unit: "kg" | "lb"; count: number } | null;
  /** The competition season the form is about (October on is next year's). */
  season_year?: number | null;
};

/** A number answered in a unit (bodyweight): what the form keeps on screen. */
export type UnitValue = { value: string; unit: "kg" | "lb" };

export type Answer = string | string[] | UnitValue;

/** What the profile gives a question: the answer, where it's from, and whether it beats their last answer. */
export type Prefilled = { value: Answer; source: string | null; strong: boolean };

export function questionPrefill(q: {
  validation?: Record<string, unknown> | null;
}): PrefillKey | null {
  const k = q.validation?.prefill;
  return typeof k === "string" && (KEYS as string[]).includes(k) ? (k as PrefillKey) : null;
}

/** The competition season a form filled in now is about: from October on, next year's. */
export function seasonYear(today: Date = new Date()): number {
  return today.getMonth() >= 9 ? today.getFullYear() + 1 : today.getFullYear();
}

const LB_PER_KG = 2.2046226218;
const round1 = (n: number) => Math.round(n * 10) / 10;

// IPF classes (kg): the lightest only for sub-juniors and juniors.
const MEN = [59, 66, 74, 83, 93, 105, 120];
const WOMEN = [47, 52, 57, 63, 69, 76, 84];

/** The IPF class a bodyweight falls in ("83", "120+"), or null without a sex. */
export function ipfClassFor(kg: number, sex: string | null | undefined, junior: boolean): string | null {
  const s = String(sex ?? "").toLowerCase();
  const limits = s.startsWith("m") ? [...(junior ? [53] : []), ...MEN] : s.startsWith("f") || s.startsWith("w") ? [...(junior ? [43] : []), ...WOMEN] : null;
  if (!limits || !Number.isFinite(kg) || kg <= 0) return null;
  const fit = limits.find((l) => kg <= l);
  return fit != null ? String(fit) : `${limits.at(-1)}+`;
}

/** A class ("83", "-84kg", "120+", "Men's 93 kg") as one of a choice question's options, or null. */
export function matchClassOption(options: string[] | null | undefined, cls: string, sex: string | null | undefined): string | null {
  const opts = options ?? [];
  if (!opts.length || opts.includes(cls)) return cls;
  const n = cls.match(/\d+(?:\.\d+)?\s*\+?/)?.[0]?.replace(/\s+/g, "");
  if (!n) return null;
  const s = String(sex ?? "").toLowerCase();
  const named = /^\s*men/i.test(cls) ? /^men/i : /^\s*wom/i.test(cls) ? /^wom/i : null;
  const want = named ?? (s.startsWith("m") ? /^men/i : s.startsWith("f") || s.startsWith("w") ? /^wom/i : null);
  const plus = n.endsWith("+");
  const num = n.replace("+", "");
  const hits = opts.filter((o) => {
    const flat = o.replace(/\s+/g, "");
    return new RegExp(`(^|[^\\d.])${num.replace(".", "\\.")}kg${plus ? "\\+" : "(?!\\+)"}`).test(flat);
  });
  return (want ? hits.find((o) => want.test(o)) : hits.length === 1 ? hits[0] : null) ?? null;
}

/** "Early morning (before 8am)" → [0, 8); "11am–2pm" → [11, 14); "It varies" → null. */
export function optionHours(option: string): [number, number] | null {
  const t = option.toLowerCase().replace(/\s+/g, "");
  const to24 = (h: number, ap: string | undefined) => (ap === "pm" ? (h % 12) + 12 : ap === "am" ? h % 12 : h);
  const before = t.match(/before(\d{1,2})(?::(\d\d))?(am|pm)/);
  if (before) return [0, to24(Number(before[1]), before[3]) + Number(before[2] ?? 0) / 60];
  const after = t.match(/after(\d{1,2})(?::(\d\d))?(am|pm)/);
  if (after) return [to24(Number(after[1]), after[3]) + Number(after[2] ?? 0) / 60, 24];
  const range = t.match(/(\d{1,2})(?::(\d\d))?(am|pm)?[–—-](\d{1,2})(?::(\d\d))?(am|pm)/);
  if (!range) return null;
  const end = to24(Number(range[4]), range[6]) + Number(range[5] ?? 0) / 60;
  let start = to24(Number(range[1]), range[3] ?? range[6]) + Number(range[2] ?? 0) / 60;
  // "11–2pm": the start is the morning
  if (!range[3] && start >= end) start = to24(Number(range[1]), "am") + Number(range[2] ?? 0) / 60;
  return start < end ? [start, end] : null;
}

/** Workouts it takes before "when you usually train" is read from them, and the share one window needs. */
export const TRAINING_TIME_MIN = 5;
export const TRAINING_TIME_SHARE = 0.6;

/** How many recent workouts are read (the last 6 weeks), and the query's window. */
export const TRAINING_TIME_RECENT = 10;
export const TRAINING_TIME_DAYS = 42;

/** The local hour (decimal) each workout started, in their own time zone; rows with no start are left out. */
export function workoutStartHours(
  rows: Array<{ training_started_at?: string | null; started_at?: string | null }>,
  timeZone: string | null | undefined,
): number[] {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone || "America/Winnipeg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Winnipeg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  }
  const out: number[] = [];
  for (const r of rows) {
    const at = r.training_started_at || r.started_at;
    const t = at ? Date.parse(at) : NaN;
    if (!Number.isFinite(t)) continue;
    const parts = fmt.formatToParts(new Date(t));
    const h = Number(parts.find((p) => p.type === "hour")?.value);
    const m = Number(parts.find((p) => p.type === "minute")?.value);
    if (Number.isFinite(h)) out.push((h % 24) + (Number.isFinite(m) ? m / 60 : 0));
  }
  return out;
}

/** The option most of their recent workouts started in, when it's clear (≥ 60% of ≥ 5), else null. */
export function trainingTimeOption(options: string[] | null | undefined, starts: number[] | null | undefined): string | null {
  const hours = (starts ?? []).filter((h) => Number.isFinite(h) && h >= 0 && h < 24);
  if (hours.length < TRAINING_TIME_MIN) return null;
  const windows = (options ?? []).map((o) => ({ o, w: optionHours(o) })).filter((x): x is { o: string; w: [number, number] } => !!x.w);
  if (windows.length < 2) return null;
  const counts = new Map<string, number>();
  for (const h of hours) {
    const hit = windows.find(({ w }) => h >= w[0] && h < w[1]);
    if (hit) counts.set(hit.o, (counts.get(hit.o) ?? 0) + 1);
  }
  const [best, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return best && n / hours.length >= TRAINING_TIME_SHARE ? best : null;
}

/** Goals & Setup's goal ("Lose body fat") as one of the form's options ("Fat Loss"), or null. */
export function goalOption(options: string[] | null | undefined, goals: PrefillProfile["goals"]): string | null {
  const opts = options ?? [];
  if (!opts.length) return null;
  const find = (re: RegExp, not?: RegExp) => opts.find((o) => re.test(o) && !(not && not.test(o))) ?? null;
  for (const g of [goals?.nutrition, goals?.main]) {
    const s = String(g ?? "").toLowerCase();
    if (!s) continue;
    let hit: string | null = null;
    if (/recomp/.test(s)) hit = find(/recomp/i);
    else if (/lose|fat|cut|weight loss/.test(s)) hit = find(/^\s*(fat loss|lose|cut|weight loss)/i);
    else if (/muscle|gain|bulk|size/.test(s)) hit = find(/muscle|gain|bulk/i, /recomp/i);
    else if (/maintain|maintenance/.test(s)) hit = find(/^\s*maint/i);
    else if (/perform|strength|powerlifting|competition/.test(s)) hit = find(/perform|strength/i);
    if (hit) return hit;
  }
  return null;
}

/** Weekday options ("Mon", "Monday") their committed days pick out, in the options' order. */
function dayOptions(options: string[], days: string[]): string[] {
  const want = new Set(days.map((d) => d.trim().slice(0, 3).toLowerCase()));
  return options.filter((o) => want.has(o.trim().slice(0, 3).toLowerCase()));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const names = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
/** "SUB-JUNIOR (14–18)" → "Sub-Junior". */
export const ageClassName = (o: string) =>
  o.replace(/\s*\(.*\)\s*$/, "").toLowerCase().replace(/(^|\s|-)\w/g, (c) => c.toUpperCase());

/** What the profile gives a question, or null when it has nothing to say. */
export function prefillDetail(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null; label?: string | null; question_type?: string | null },
  profile: PrefillProfile | null | undefined,
): Prefilled | null {
  const key = questionPrefill(q);
  if (!key || !profile) return null;
  const opts = q.options ?? [];
  const fact = (value: Answer | null, source: string | null = null): Prefilled | null => (value == null ? null : { value, source, strong: true });

  if (key === "meet_name") return fact(profile.meet?.name?.trim() || null);
  if (key === "meet_date") return fact(profile.meet?.date || null);
  if (key === "meet_weight_class") {
    const cls = profile.meet?.weightClass?.trim();
    return fact(cls ? matchClassOption(opts, cls, profile.sex) : null);
  }
  if (key === "bodyweight") {
    const bw = profile.bodyweight;
    if (!bw || !bw.fresh) return null;
    const units = q.validation?.units;
    if (Array.isArray(units) && units.length) return fact({ value: String(bw.value), unit: bw.unit });
    // a plain number asked in one unit ("Current fasted bodyweight? (lbs)"): the weigh-in in that unit
    const label = String(q.label ?? "");
    const unit = q.validation?.unit;
    const named: "kg" | "lb" | null = unit === "kg" || unit === "lb" ? unit : /\bkg\b/i.test(label) ? "kg" : /\b(lbs?|pounds)\b/i.test(label) ? "lb" : null;
    if (!named) return fact({ value: String(bw.value), unit: bw.unit });
    const v = bw.unit === named ? bw.value : named === "lb" ? bw.value * LB_PER_KG : bw.value / LB_PER_KG;
    return fact(String(round1(v)));
  }
  if (key === "age_class") {
    const year = profile.season_year ?? seasonYear();
    const allowed = eligibleOptions(opts, eligibleAgeClasses(profile.date_of_birth, year));
    if (!allowed.length) return null;
    return fact(allowed, `From your birth year: you can lift ${names(allowed.map(ageClassName))} in ${year}`);
  }
  if (key === "weight_class") {
    // the coach's meet prep is the class; else the class their weigh-ins put them in, a starting point
    const prep = profile.prep_weight_class?.trim();
    const fromPrep = prep ? matchClassOption(opts, prep, profile.sex) : null;
    if (fromPrep) return fact(fromPrep, "From your meet prep");
    const bw = profile.recent_bodyweight;
    if (!bw) return null;
    const kg = bw.unit === "kg" ? bw.value : bw.value / LB_PER_KG;
    const year = profile.season_year ?? seasonYear();
    const junior = eligibleAgeClasses(profile.date_of_birth, year).some((c) => c === "junior" || c === "sub-junior");
    const cls = ipfClassFor(kg, profile.sex, junior);
    const hit = cls ? matchClassOption(opts, cls, profile.sex) : null;
    if (!hit) return null;
    const avg = `${round1(bw.value)} ${bw.unit}`;
    return { value: hit, source: `From your weigh-ins (${bw.count > 1 ? `${avg} average` : avg})`, strong: false };
  }
  if (key === "training_days") {
    const days = (profile.training_days ?? []).filter(Boolean);
    if (!days.length) return null;
    if (q.question_type === "multi_choice") {
      const picked = dayOptions(opts, days);
      return picked.length === days.length ? fact(picked, "From your training schedule") : null;
    }
    return fact(String(days.length), "From your training schedule");
  }
  if (key === "goal") {
    const hit = goalOption(opts, profile.goals);
    return hit ? { value: hit, source: "From your Goals & Setup", strong: false } : null;
  }
  if (key === "training_time") {
    const hit = trainingTimeOption(opts, profile.training_starts);
    return hit ? fact(hit, `From your last ${plural(profile.training_starts!.length, "workout")}`) : null;
  }
  if (key === "full_name") return fact(profile.full_name?.trim() || null);
  if (key === "nutrition_plan") {
    if (profile.has_nutrition_plan !== false) return null;
    return fact(!opts.length || opts.includes(MEAL_CHOICE.first) ? MEAL_CHOICE.first : null);
  }
  if (key === "sex") {
    const label = sexLabel(profile.sex);
    // Choice questions only accept their exact option text.
    if (!label) return null;
    return fact(!opts.length || opts.includes(label) ? label : null, "From your profile");
  }
  if (profile.height_cm == null) return null;
  const unit: HeightUnit = profile.preferred_height_unit === "metric" ? "metric" : "imperial";
  return fact(formatHeight(Number(profile.height_cm), unit), "From your profile");
}

/** The answer to pre-save for a question, or null to leave it blank. */
export function prefillAnswer(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null; label?: string | null; question_type?: string | null },
  profile: PrefillProfile | null | undefined,
): Answer | null {
  return prefillDetail(q, profile)?.value ?? null;
}

const blank = (v: unknown) => v == null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Where a question starts: the profile when it's a fact the app keeps (or the
 * only answer there is), else their last answer. Age classes keep the ones
 * they picked last time that their birth year still allows (a junior who
 * skipped Open stays without it), else every one it allows. `remembered` is
 * their last answer, passed only for questions that remember one.
 */
export function startingAnswer(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null; label?: string | null; question_type?: string | null },
  profile: PrefillProfile | null | undefined,
  remembered: unknown,
): { value: unknown; from: "profile" | "last" } | null {
  const p = prefillDetail(q, profile);
  const last = blank(remembered) ? null : remembered;
  if (questionPrefill(q) === "age_class" && p && Array.isArray(last)) {
    const allowed = new Set(p.value as string[]);
    const keep = (last as unknown[]).map(String).filter((o) => allowed.has(o));
    if (keep.length) return { value: keep, from: "last" };
  }
  if (p && (p.strong || last == null)) return { value: p.value, from: "profile" };
  return last == null ? null : { value: last, from: "last" };
}

/** Same answer, whatever its shape (a set of classes in any order, "4" and 4, a number in a unit). */
export function sameAnswer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    const s = new Set(a.map(String));
    return b.every((x) => s.has(String(x)));
  }
  if (a && typeof a === "object" && b && typeof b === "object") {
    const x = a as UnitValue;
    const y = b as UnitValue;
    return x.unit === y.unit && Number(x.value) === Number(y.value);
  }
  if (blank(a) || blank(b)) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a).trim() !== "" && String(b).trim() !== "") return na === nb;
  return String(a).trim() === String(b).trim();
}

/** The line under a question while its answer is still the profile's ("From your training schedule"). */
export function prefillNote(
  q: { validation?: Record<string, unknown> | null; options?: string[] | null; label?: string | null; question_type?: string | null },
  profile: PrefillProfile | null | undefined,
  answer: unknown,
): string | null {
  const p = prefillDetail(q, profile);
  if (!p?.source) return null;
  if (questionPrefill(q) === "age_class") return p.source;
  return sameAnswer(p.value, answer) ? p.source : null;
}

/**
 * The profile fill a question's words suggest, for the form builder and AI-drafted
 * forms ("Training days per week" → their training schedule). Never a guess on
 * a question whose options the profile couldn't answer.
 */
export function suggestPrefill(q: { label?: string | null; question_type?: string | null; options?: string[] | null }): PrefillKey | null {
  const l = String(q.label ?? "").toLowerCase();
  const t = String(q.question_type ?? "");
  const opts = q.options ?? [];
  const choice = t === "single_choice" || t === "dropdown";
  if (!l) return null;
  if (t === "number" && /training days|days (a|per) week|days do you train/.test(l)) return "training_days";
  if (t === "multi_choice" && /which days|training days|days do you train/.test(l) && opts.some((o) => /^mon/i.test(o.trim()))) return "training_days";
  if (choice && /what time|when do you (usually )?train|time of day/.test(l) && opts.filter((o) => optionHours(o)).length >= 2) return "training_time";
  if (choice && /\bgoal\b/.test(l) && opts.some((o) => /fat loss|muscle gain|maint/i.test(o))) return "goal";
  if (t === "multi_choice" && /age (class|categor|division)/.test(l)) return "age_class";
  if ((choice || t === "short_text") && /weight class/.test(l)) return "weight_class";
  if (t === "number" && /body ?weight/.test(l)) return "bodyweight";
  if ((choice || t === "short_text") && /^\s*(sex|gender)\b/.test(l)) return "sex";
  if (t === "short_text" && /^\s*height\b/.test(l)) return "height";
  if (t === "short_text" && /^\s*((your|full|first and last)\s+)*name\s*$/.test(l)) return "full_name";
  return null;
}
