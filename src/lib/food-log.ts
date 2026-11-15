/**
 * The food log's pure pieces: which instants make up a person's day, totals,
 * the week behind a date, and the meals a coach's plan gives a day. Pure (no
 * React, no network) so the panel, the Nutrition page's intake card and the
 * Cookbook's "Log this meal" all read days the same way.
 *
 * A day is the person's own calendar day (the phone's clock), never a UTC
 * one: a meal eaten at 8 PM in Winnipeg is 01:00 UTC the next day, and the
 * log used to file it under tomorrow (and flip "today" to tomorrow every
 * evening).
 */

import { parseLocalDate, toLocalISO } from "@/lib/today";

export type MacroTotals = { calories: number; protein: number; carbs: number; fat: number };

export type LoggedMeal = {
  id: string;
  name: string;
  logged_at: string;
  calories: number | string | null;
  protein_g: number | string | null;
  carbs_g: number | string | null;
  fat_g: number | string | null;
};

/** What a day is aimed at: the coach's plan day or the member's own targets. */
export type DayTarget = {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** "Training Day", "Your targets"… */
  label?: string | null;
};

/** One meal of a coach's plan, ready to log in one tap. */
export type PlanMeal = { name: string; calories: number; protein_g: number; carbs_g: number; fat_g: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const n = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/** Local midnight to the next local midnight, as instants (DST days are 23 / 25 h). */
export function localDayBounds(dateISO: string): { start: string; end: string } {
  const d = parseLocalDate(dateISO) ?? new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Local midnight six days before: the start of the 7 days ending on `dateISO`. */
export function weekStartFor(dateISO: string): string {
  const d = parseLocalDate(dateISO) ?? new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).toISOString();
}

/** "YYYY-MM-DD" a few days from `dateISO` (negative goes back). */
export function shiftDate(dateISO: string, days: number): string {
  const d = parseLocalDate(dateISO) ?? new Date();
  return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
}

/** The person's calendar day an instant falls on. */
export function localDateOf(ts: string): string {
  return toLocalISO(new Date(ts));
}

/**
 * When a meal logged "for" a day happened: now for today, local noon for a
 * day before (a past day's meal, logged after the fact).
 */
export function loggedAtFor(dateISO: string, today: string): string | undefined {
  if (dateISO === today) return undefined;
  const d = parseLocalDate(dateISO);
  if (!d) return undefined;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString();
}

export function sumMacros(meals: Pick<LoggedMeal, "calories" | "protein_g" | "carbs_g" | "fat_g">[]): MacroTotals {
  return meals.reduce<MacroTotals>(
    (acc, m) => ({
      calories: acc.calories + n(m.calories),
      protein: acc.protein + n(m.protein_g),
      carbs: acc.carbs + n(m.carbs_g),
      fat: acc.fat + n(m.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Calories from grams (Atwater: 4 / 4 / 9). */
export function kcalFromMacros(protein: number, carbs: number, fat: number): number {
  return Math.round(protein * 4 + carbs * 4 + fat * 9);
}

/**
 * Quick add: a typed calorie number wins; left blank, it's worked out from the
 * macros (what a nutrition label gives you), so nobody does arithmetic.
 */
export function quickAddCalories(calories: string, protein: string, carbs: string, fat: string): number {
  const typed = parseFloat(calories);
  if (Number.isFinite(typed) && typed >= 0) return Math.round(typed);
  return kcalFromMacros(n(protein), n(carbs), n(fat));
}

export type WeekDay = {
  date: string;
  calories: number;
  protein: number;
  meals: number;
  target: number | null;
};

/** The 7 days ending on `dateISO`, oldest first, each with what was logged and its calorie target. */
export function weekDays(
  dateISO: string,
  weekMeals: Pick<LoggedMeal, "logged_at" | "calories" | "protein_g">[],
  targetFor: (date: string) => DayTarget | null,
): WeekDay[] {
  const byDay = new Map<string, { calories: number; protein: number; meals: number }>();
  for (const m of weekMeals) {
    if (!m.logged_at) continue;
    const d = localDateOf(m.logged_at);
    const cur = byDay.get(d) ?? { calories: 0, protein: 0, meals: 0 };
    cur.calories += n(m.calories);
    cur.protein += n(m.protein_g);
    cur.meals += 1;
    byDay.set(d, cur);
  }
  const out: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDate(dateISO, -i);
    const got = byDay.get(date) ?? { calories: 0, protein: 0, meals: 0 };
    out.push({ date, ...got, target: targetFor(date)?.calories ?? null });
  }
  return out;
}

/** One line under the week: averages over the days anything was logged, and how many landed near target. */
export function weekSummary(days: WeekDay[]): { logged: number; avgCalories: number; avgProtein: number; onTarget: number; withTarget: number } {
  const logged = days.filter((d) => d.meals > 0);
  const withTarget = logged.filter((d) => d.target != null && d.target > 0);
  const onTarget = withTarget.filter((d) => Math.abs(d.calories - (d.target as number)) <= (d.target as number) * 0.1).length;
  const avg = (f: (d: WeekDay) => number) => (logged.length ? Math.round(logged.reduce((s, d) => s + f(d), 0) / logged.length) : 0);
  return {
    logged: logged.length,
    avgCalories: avg((d) => d.calories),
    avgProtein: avg((d) => d.protein),
    onTarget,
    withTarget: withTarget.length,
  };
}

/** Is a [start, end) window one plausible local day? (server-side check on what the phone sent) */
export function plausibleDay(start: string, end: string): boolean {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const span = b - a;
  return span >= DAY_MS - 2 * 60 * 60 * 1000 && span <= DAY_MS + 2 * 60 * 60 * 1000;
}

/** Is `weekStart` about six days before a day's start? */
export function plausibleWeekStart(weekStart: string, dayStart: string): boolean {
  const a = Date.parse(weekStart);
  const b = Date.parse(dayStart);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const span = b - a;
  return span >= 6 * DAY_MS - 2 * 60 * 60 * 1000 && span <= 6 * DAY_MS + 2 * 60 * 60 * 1000;
}
