import { pickPlanDayForDate, resolveClientNutritionDay, weekdayForISO, type PlanDayLike, type ResolveInput } from "@/lib/client-nutrition-day";

export type WeeklyPlanDay = PlanDayLike & { calories?: number | null; protein?: number | null; carbs?: number | null; fats?: number | null; fibre?: number | null; steps?: number | null; notes?: string | null };
export type WeekContext = Pick<ResolveInput, "overrides" | "preferredHighDays" | "workoutDates" | "scheduleKnown">;

export function summarizeNutritionWeek(days: WeeklyPlanDay[], dates: string[], context: WeekContext) {
  const rows = dates.map((dateISO) => {
    const resolution = resolveClientNutritionDay({ ...context, dateISO });
    const pick = pickPlanDayForDate(days, { dayType: resolution.dayType, baseType: resolution.baseType, weekday: weekdayForISO(dateISO) });
    const day = days[pick.index] ?? null;
    const calories = day?.calories;
    return { dateISO, day, kind: pick.dayType, calories: typeof calories === "number" && Number.isFinite(calories) && calories >= 0 ? calories : null, suggested: resolution.suggested && (resolution.source !== "high_day" || pick.dayType === "high") };
  });
  const complete = rows.length === 7 && new Set(dates).size === 7 && rows.every((r) => r.calories !== null);
  const total = complete ? rows.reduce((sum, r) => sum + r.calories!, 0) : null;
  return { rows, total, average: total === null ? null : total / 7, complete, estimated: rows.some((r) => r.suggested) || context.scheduleKnown === false };
}
