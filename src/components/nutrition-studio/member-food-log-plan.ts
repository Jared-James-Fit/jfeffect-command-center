/**
 * A JF member's food log reads their own plan the way a coaching client's reads
 * their coach's: each date's targets from the plan day for that day (their
 * training days decide training or rest, `pickPlanDayForDate`), and that day's
 * meals to log in one tap. With no plan, the food log keeps their own
 * calculated targets, as before.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { pickPlanDayForDate, weekdayForISO } from "@/lib/client-nutrition-day";
import { planMealsFromNotes } from "@/lib/food-log-plan";
import { readPlanSupplements } from "@/lib/nutrition-targets/supplements";
import type { DayTarget, PlanMeal } from "@/lib/food-log";
import type { FoodLogPlan } from "@/components/nutrition/food-log-context";

const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The training days a member committed to, as full weekday names. */
export function trainingWeekdays(days: string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const d of days ?? []) {
    const k = String(d).trim().toLowerCase().slice(0, 3);
    const full = FULL.find((f) => f.toLowerCase().startsWith(k));
    if (full) out.add(full);
  }
  return FULL.filter((f) => out.has(f));
}

const num = (v: unknown) => {
  const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(x) && x > 0 ? x : null;
};

/** Pure: the food-log view of a plan, given which weekdays they train. */
export function memberFoodLogPlan(plan: { days?: any[] | null; supplements?: unknown } | null | undefined, training: string[]): FoodLogPlan | null {
  const days = Array.isArray(plan?.days) ? plan!.days! : [];
  if (!days.length) return null;
  const dayFor = (dateISO: string) => {
    const weekday = weekdayForISO(dateISO);
    const dayType = training.includes(weekday) ? "training" : "non_training";
    const { index } = pickPlanDayForDate(days, { dayType, weekday, baseType: dayType });
    return index >= 0 ? days[index] : days.length === 1 ? days[0] : null;
  };
  const meals = new Map<string, PlanMeal[]>();
  return {
    targetFor: (dateISO: string): DayTarget | null => {
      const pd = dayFor(dateISO);
      if (!pd) return null;
      const t: DayTarget = { calories: num(pd.calories), protein: num(pd.protein), carbs: num(pd.carbs), fat: num(pd.fats), label: pd.day_label ?? null };
      return t.calories || t.protein ? t : null;
    },
    mealsFor: (dateISO: string): PlanMeal[] => {
      const pd = dayFor(dateISO);
      if (!pd) return [];
      const key = String(pd.id ?? pd.day_label ?? "");
      if (!meals.has(key)) meals.set(key, planMealsFromNotes(pd.notes));
      return meals.get(key)!;
    },
    supplements: readPlanSupplements((plan?.supplements as any) ?? null).items.map((x) => x.name),
  };
}

export function useMemberFoodLogPlan(plan: { days?: any[] | null; supplements?: unknown } | null | undefined): FoodLogPlan | null {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const daysQ = useQuery({
    queryKey: ["member-training-weekdays", uid],
    enabled: !!uid && !!plan,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await (supabase as any).from("clients").select("committed_training_days").eq("user_id", uid!).maybeSingle();
      return trainingWeekdays(data?.committed_training_days ?? []);
    },
  });
  return useMemo(() => memberFoodLogPlan(plan, daysQ.data ?? []), [plan, daysQ.data]);
}
