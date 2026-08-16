import { supabase } from "@/integrations/supabase/client";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import { DEFAULT_HIGH_WEEKDAY } from "@/lib/client-nutrition-day";

/**
 * Shared High Day scheduling helpers.
 *
 * Source of truth for the recurring High Day weekday is
 * `clients.preferred_high_days` (existing column). One-week exceptions
 * live in `nutrition_day_overrides` (client_id, override_date, day_label).
 *
 * Priority when resolving a High Day for a given date:
 *   1) An override row for that exact date
 *   2) `preferred_high_days` weekday match
 *   3) The centralized no-selection fallback (`DEFAULT_HIGH_WEEKDAY`, Saturday)
 */

/** Re-exported so every consumer shares one fallback weekday. */
export { DEFAULT_HIGH_WEEKDAY };

export type NutritionDayOverride = {
  id: string;
  client_id: string;
  override_date: string; // YYYY-MM-DD
  day_label: string;
  notes?: string | null;
};

/** Given the recurring weekdays, return them or the centralized fallback. */
export function withHighDayFallback(days: string[] | null | undefined): WeekDay[] {
  const valid = (days ?? [])
    .map((d) => (d ?? "").trim())
    .filter((d): d is WeekDay => (WEEK_DAYS as readonly string[]).includes(d));
  if (valid.length > 0) return valid;
  return [DEFAULT_HIGH_WEEKDAY];
}

/** Format a JS Date as local YYYY-MM-DD. */
export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const WEEKDAY_NAMES: WeekDay[] = [
  "Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday",
] as WeekDay[];

/** Weekday name for a JS Date. */
export function weekdayFor(d: Date): WeekDay {
  return WEEKDAY_NAMES[d.getDay()];
}

export type OverrideMap = Map<string, string>; // date -> day_label

export function buildOverrideMap(rows: NutritionDayOverride[] | null | undefined): OverrideMap {
  const m: OverrideMap = new Map();
  for (const r of rows ?? []) {
    m.set(r.override_date, r.day_label);
  }
  return m;
}

/**
 * Given a date, resolve the day_label. Returns null if no override and the
 * weekday isn't a recurring high day.
 */
export function resolveHighDayForDate(
  date: Date,
  recurringHighDays: string[] | null | undefined,
  overrides: OverrideMap,
): boolean {
  const iso = toLocalISODate(date);
  const ov = overrides.get(iso);
  if (ov) return ov === "High Day";
  const wd = weekdayFor(date);
  const days = (recurringHighDays ?? []).map((d) => d?.trim());
  return days.includes(wd);
}

/**
 * Persist the coach's chosen recurring High Day weekday to `clients`.
 * Overwrites any existing value — only call when the coach explicitly picks.
 */
export async function setRecurringHighDays(clientId: string, weekdays: WeekDay[]) {
  const { error } = await supabase
    .from("clients")
    .update({ preferred_high_days: weekdays })
    .eq("id", clientId);
  if (error) throw error;
}

/**
 * Ensure `preferred_high_days` has at least one weekday. If empty, set the
 * centralized fallback. Never overwrites an existing coach selection.
 */
export async function ensureHighDayWeekday(
  clientId: string,
  current: string[] | null | undefined,
  fallback: WeekDay = DEFAULT_HIGH_WEEKDAY,
) {
  if ((current ?? []).length > 0) return;
  await setRecurringHighDays(clientId, [fallback]);
}

/** Upsert a one-week override row. */
export async function upsertNutritionDayOverride(
  clientId: string,
  isoDate: string,
  dayLabel: string,
  notes?: string | null,
) {
  const { error } = await (supabase.from("nutrition_day_overrides") as any).upsert(
    { client_id: clientId, override_date: isoDate, day_label: dayLabel, notes: notes ?? null },
    { onConflict: "client_id,override_date" },
  );
  if (error) throw error;
}

export async function deleteNutritionDayOverride(clientId: string, isoDate: string) {
  const { error } = await (supabase.from("nutrition_day_overrides") as any)
    .delete()
    .eq("client_id", clientId)
    .eq("override_date", isoDate);
  if (error) throw error;
}

/** Persist Full Cardio Rest weekdays. */
export async function setFullCardioRestDays(clientId: string, weekdays: WeekDay[]) {
  const { error } = await (supabase.from("clients") as any)
    .update({ full_cardio_rest_days: weekdays })
    .eq("id", clientId);
  if (error) throw error;
}