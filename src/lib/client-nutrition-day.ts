/**
 * Canonical CLIENT-SIDE nutrition day-type resolution.
 *
 * Read-only. This module never writes coach data — it only decides which
 * coach-authored nutrition day (Training / Non-Training / High) applies to a
 * given local date so the client Nutrition page can show one consistent
 * selected day across targets, meal plan, water and instructions.
 *
 * Priority (highest first):
 *   1. Exact-date `nutrition_day_overrides` row for that date
 *   2. The configured High Day weekday (`clients.preferred_high_days`)
 *   3. A scheduled training workout on that date
 *   4. Non-Training
 *
 * `DEFAULT_HIGH_WEEKDAY` is used ONLY when the coach has made no selection at
 * all. It is never persisted and never overrides an exact-date override.
 *
 * Which saved plan day a date gets is `pickPlanDayForDate`: each plan day is
 * used on a kind of day (`nutrition_target_days.use_on`) and, if the coach
 * says so, only on some weekdays (`weekdays`); unset, both are read from the
 * day's name ("Training Day (Friday Only)" = training days, Fridays). A day
 * for this weekday beats one for any day, so Friday's plan wins on Fridays.
 */

import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";

export type ClientNutritionDayType = "training" | "non_training" | "high";

export const DEFAULT_HIGH_WEEKDAY: WeekDay = "Saturday";

const SUNDAY_FIRST: WeekDay[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as WeekDay[];

export type DayOverrideRow = { override_date: string; day_label?: string | null };

export type ResolveInput = {
  /** Local ISO date (YYYY-MM-DD). */
  dateISO: string;
  /** Exact-date overrides for this client. */
  overrides?: DayOverrideRow[] | null;
  /** `clients.preferred_high_days`. */
  preferredHighDays?: string[] | null;
  /** Local ISO dates that have a scheduled workout. */
  workoutDates?: string[] | null;
  /**
   * Whether the training schedule was actually loaded. When false the result
   * is flagged `suggested` so the UI can show a "Suggested" state instead of
   * claiming certainty.
   */
  scheduleKnown?: boolean;
};

export type DayResolution = {
  dayType: ClientNutritionDayType;
  source: "override" | "high_day" | "workout" | "default";
  /** Configured High Day weekday (or the fallback when none is configured). */
  highWeekday: WeekDay;
  /** True when no coach High Day selection exists and the fallback is used. */
  highWeekdayIsFallback: boolean;
  /** True when the schedule was unavailable, so the day type is a suggestion. */
  suggested: boolean;
  /** The day by the schedule alone (a workout or not): what a High Day is when the plan has none. */
  baseType: "training" | "non_training";
};

export function weekdayForISO(dateISO: string): WeekDay {
  const d = new Date(`${dateISO}T00:00:00`);
  return SUNDAY_FIRST[d.getDay()];
}

function normalizeWeekday(raw: unknown): WeekDay | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (
    ((WEEK_DAYS as readonly string[]).find((d) => d.toLowerCase() === value) as
      | WeekDay
      | undefined) ?? null
  );
}

/**
 * Map any free-text day label ("HIGH-DAY MENU", "Non-Training Day", "Rest")
 * onto a canonical day type. Order matters: "non-training" contains
 * "training", so the negative form is checked first.
 */
export function normalizeDayLabel(label: string | null | undefined): ClientNutritionDayType | null {
  const s = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s.includes("high")) return "high";
  if (s.includes("non-training") || s.includes("non training") || s.includes("nontraining"))
    return "non_training";
  if (s.includes("rest") || s.includes("off day")) return "non_training";
  if (s.includes("training") || s.includes("workout") || s.includes("lifting")) return "training";
  return null;
}

/** Configured High Day weekday, falling back only when nothing is set. */
export function configuredHighWeekday(preferredHighDays?: string[] | null): {
  weekday: WeekDay;
  isFallback: boolean;
} {
  const valid = (preferredHighDays ?? []).map(normalizeWeekday).filter(Boolean) as WeekDay[];
  if (valid.length > 0) return { weekday: valid[0], isFallback: false };
  return { weekday: DEFAULT_HIGH_WEEKDAY, isFallback: true };
}

export function resolveClientNutritionDay({
  dateISO,
  overrides,
  preferredHighDays,
  workoutDates,
  scheduleKnown = true,
}: ResolveInput): DayResolution {
  const high = configuredHighWeekday(preferredHighDays);
  const hasWorkout = (workoutDates ?? []).includes(dateISO);
  const baseType = hasWorkout ? "training" : "non_training";

  const override = (overrides ?? []).find((o) => o?.override_date === dateISO);
  const overrideType = normalizeDayLabel(override?.day_label);
  if (overrideType) {
    return {
      dayType: overrideType,
      source: "override",
      highWeekday: high.weekday,
      highWeekdayIsFallback: high.isFallback,
      suggested: false,
      baseType,
    };
  }

  if (weekdayForISO(dateISO) === high.weekday) {
    return {
      dayType: "high",
      source: "high_day",
      highWeekday: high.weekday,
      highWeekdayIsFallback: high.isFallback,
      // A fallback-derived High Day is a suggestion, not a coach instruction.
      suggested: high.isFallback,
      baseType,
    };
  }

  return {
    dayType: baseType,
    source: hasWorkout ? "workout" : "default",
    highWeekday: high.weekday,
    highWeekdayIsFallback: high.isFallback,
    suggested: !scheduleKnown,
    baseType,
  };
}

/** What a saved plan day is used on (`nutrition_target_days.use_on`). */
export type PlanDayUse = "training" | "rest" | "high" | "every_day" | "manual";

export const PLAN_DAY_USES: PlanDayUse[] = ["training", "rest", "high", "every_day", "manual"];

export const PLAN_DAY_USE_LABEL: Record<PlanDayUse, string> = {
  training: "Training days",
  rest: "Rest days",
  high: "High Day",
  every_day: "Every day",
  manual: "Only when picked",
};

export type PlanDayLike = {
  id?: string | null;
  day_label?: string | null;
  /** The coach's choice; null = read from the day's name. */
  use_on?: string | null;
  /** The coach's choice of weekdays ([] = any day); null = read from the day's name. */
  weekdays?: string[] | null;
};

export type PlanDayRule = {
  /** null = never picked automatically (the name doesn't say). */
  use: PlanDayUse | null;
  /** [] = any day of the week. */
  weekdays: WeekDay[];
  /** True when `use` / `weekdays` were read from the name, not set by the coach. */
  useFromName: boolean;
  weekdaysFromName: boolean;
};

/** A date as the plan-day picker needs it. */
export type PlanDayDate = {
  dayType: ClientNutritionDayType;
  weekday: WeekDay;
  /** The day by the schedule alone; a High Day falls back to it when the plan has no High Day. */
  baseType?: "training" | "non_training";
};

const DAY_WORD =
  "(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:s|nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?";
const DAY_BY_PREFIX: Record<string, WeekDay> = {
  mo: "Monday",
  tu: "Tuesday",
  we: "Wednesday",
  th: "Thursday",
  fr: "Friday",
  sa: "Saturday",
  su: "Sunday",
};
const dayOf = (word: string) => DAY_BY_PREFIX[word.slice(0, 2).toLowerCase()];

/**
 * The weekdays a plan day's name names: "Training Day (Friday Only)",
 * "Mon / Wed", "Mon-Fri", "Weekends", "Every day but Sunday". [] when it
 * names none (or all seven).
 */
export function weekdaysFromLabel(label: string | null | undefined): WeekDay[] {
  const s = String(label ?? "").toLowerCase();
  if (!s.trim()) return [];
  const token = new RegExp(
    `\\b(?:(not|except|excluding|besides|but|other than)|${DAY_WORD}\\s*(?:-|–|—|to|thru|through)\\s*${DAY_WORD}|${DAY_WORD}|(weekends?)|(weekdays?))\\b|([);])`,
    "g",
  );
  const on = new Set<WeekDay>();
  const off = new Set<WeekDay>();
  // "not" / "except" / "but" takes the days after it, up to a ")" or ";"
  let negated = false;
  for (const m of s.matchAll(token)) {
    if (m[1]) negated = true;
    if (m[7]) negated = false;
    const add = (d: WeekDay) => (negated ? off : on).add(d);
    if (m[2] && m[3]) {
      const to = WEEK_DAYS.indexOf(dayOf(m[3]));
      for (let i = WEEK_DAYS.indexOf(dayOf(m[2])); ; i = (i + 1) % 7) {
        add(WEEK_DAYS[i]);
        if (i === to) break;
      }
    } else if (m[4]) add(dayOf(m[4]));
    else if (m[5]) (["Saturday", "Sunday"] as WeekDay[]).forEach(add);
    else if (m[6]) WEEK_DAYS.slice(0, 5).forEach(add);
  }
  const base = on.size ? on : off.size ? new Set<WeekDay>(WEEK_DAYS) : on;
  const days = WEEK_DAYS.filter((d) => base.has(d) && !off.has(d));
  return days.length === 7 ? [] : days;
}

const EVERY_DAY_NAME = /\b(daily|every ?day|all days|same every day|any day)\b/;

function isPlanDayUse(v: unknown): v is PlanDayUse {
  return typeof v === "string" && (PLAN_DAY_USES as string[]).includes(v);
}

/**
 * When a saved plan day is used: the coach's setting, else read from its
 * name. `planSize` is how many days the plan has: a plan of one is every day.
 */
export function planDayRule(day: PlanDayLike, planSize = 2): PlanDayRule {
  const label = String(day?.day_label ?? "");
  const explicitUse = isPlanDayUse(day?.use_on) ? day.use_on : null;
  const explicitDays = Array.isArray(day?.weekdays)
    ? (day.weekdays.map(normalizeWeekday).filter(Boolean) as WeekDay[])
    : null;
  const fromName = weekdaysFromLabel(label);
  let use: PlanDayUse | null = explicitUse;
  if (!use) {
    const t = normalizeDayLabel(label);
    use = t === "non_training" ? "rest" : t;
    if (!use && (EVERY_DAY_NAME.test(label.toLowerCase()) || planSize === 1 || fromName.length > 0))
      use = "every_day";
  }
  const weekdays = explicitDays ? WEEK_DAYS.filter((d) => explicitDays.includes(d)) : fromName;
  return {
    use,
    weekdays: weekdays.length === 7 ? [] : weekdays,
    useFromName: !explicitUse,
    weekdaysFromName: !explicitDays,
  };
}

const USE_FOR: Record<ClientNutritionDayType, PlanDayUse> = {
  training: "training",
  non_training: "rest",
  high: "high",
};

/**
 * Which saved plan day a date gets. A day for this weekday beats one for any
 * day, and one for this kind of day beats an every-day one: on a training
 * Friday "Training Day (Friday Only)" wins over "Training Day". A High Day on
 * a plan with no High Day is the day the schedule says (training or rest).
 * Never another kind of day: no rest-day plan means no plan, not the training
 * one. `dayType` is the kind of day the pick was made for.
 */
export function pickPlanDayForDate(
  days: PlanDayLike[] | null | undefined,
  date: PlanDayDate,
): { index: number; dayType: ClientNutritionDayType } {
  const list = days ?? [];
  const rules = list.map((d) => planDayRule(d, list.length));
  const best = (type: ClientNutritionDayType) => {
    const want = USE_FOR[type];
    let at = -1;
    let top = 0;
    rules.forEach((r, i) => {
      const typeFit = r.use === want ? 2 : r.use === "every_day" ? 1 : 0;
      const dayFit = r.weekdays.length === 0 ? 1 : r.weekdays.includes(date.weekday) ? 2 : 0;
      const score = typeFit && dayFit ? dayFit * 2 + typeFit : 0;
      if (score > top) {
        top = score;
        at = i;
      }
    });
    return at;
  };
  const index = best(date.dayType);
  if (
    index < 0 &&
    date.dayType === "high" &&
    date.baseType &&
    !rules.some((r) => r.use === "high")
  ) {
    return { index: best(date.baseType), dayType: date.baseType };
  }
  return { index, dayType: date.dayType };
}

/**
 * Index of the coach plan day matching a day type on any weekday. Returns -1
 * when the coach did not author a day for that type (never substitutes
 * another day).
 */
export function pickPlanDayIndex(
  days: PlanDayLike[] | null | undefined,
  dayType: ClientNutritionDayType,
): number {
  const list = days ?? [];
  const rules = list.map((d) => planDayRule(d, list.length));
  const exact = rules.findIndex((r) => r.use === USE_FOR[dayType] && r.weekdays.length === 0);
  return exact >= 0 ? exact : rules.findIndex((r) => r.use === USE_FOR[dayType]);
}

/**
 * Resolves the automatic match for a date, then permits an explicit client
 * selection by the plan-day record ID. Titles remain display-only.
 */
export function resolvePlanDaySelection(
  days: PlanDayLike[] | null | undefined,
  date: PlanDayDate,
  manualPlanDayId: string | null | undefined,
): {
  automaticPlanDayId: string | null;
  selectedPlanDayId: string | null;
  isManual: boolean;
  /** The kind of day the automatic pick is for (a High Day with no High Day plan is training or rest). */
  dayType: ClientNutritionDayType;
} {
  const list = days ?? [];
  const pick = pickPlanDayForDate(list, date);
  const automaticPlanDayId = pick.index >= 0 ? (list[pick.index]?.id ?? null) : null;
  const selectedPlanDayId =
    manualPlanDayId && list.some((day) => day.id === manualPlanDayId)
      ? manualPlanDayId
      : automaticPlanDayId;
  return {
    automaticPlanDayId,
    selectedPlanDayId,
    isManual: selectedPlanDayId != null && selectedPlanDayId !== automaticPlanDayId,
    dayType: pick.dayType,
  };
}

/**
 * A rewrite of a plan's days (Cleo, a published nutrition review) keeps the
 * coach's "used on" for every day it keeps by name.
 */
export function carryPlanDayRules<T extends PlanDayLike>(
  before: PlanDayLike[] | null | undefined,
  after: T[],
): T[] {
  const key = (l: unknown) =>
    String(l ?? "")
      .trim()
      .toLowerCase();
  const old = new Map((before ?? []).map((d) => [key(d.day_label), d]));
  return after.map((d) => {
    const was = old.get(key(d.day_label));
    if (!was) return d;
    return {
      ...d,
      use_on: d.use_on !== undefined ? d.use_on : (was.use_on ?? null),
      weekdays: d.weekdays !== undefined ? d.weekdays : (was.weekdays ?? null),
    };
  });
}

export const DAY_TYPE_LABEL: Record<ClientNutritionDayType, string> = {
  training: "Training",
  non_training: "Rest Day",
  high: "High Day",
};

export const DAY_TYPE_INFO =
  "Your coach may set different nutrition targets for training days, rest days, and one weekly High Day. Follow the category that matches today.";
