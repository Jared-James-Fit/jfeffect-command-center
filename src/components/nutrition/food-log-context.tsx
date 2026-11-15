/**
 * What the food log knows from outside it: a coaching client's plan (each
 * date's targets from the coach's plan day, that day's meals to log in one
 * tap, the supplements the coach picked) and the one query every food-log
 * surface reads (the log sheet, the Nutrition page's intake card, the
 * Cookbook's "Log this meal"), keyed by the person's own day.
 *
 * Members have no plan here: their targets come with the day's data (their
 * own suggested targets), exactly as before.
 */

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { deleteMeal, getNutritionDashboard, logMeal } from "@/lib/nutrition-dashboard.functions";
import { localDayBounds, weekStartFor, type DayTarget, type PlanMeal } from "@/lib/food-log";

export type FoodLogPlan = {
  /** The coach's targets for a date (its plan day), or null when the plan has none for it. */
  targetFor: (date: string) => DayTarget | null;
  /** The plan day's meals with their macros, for "From your plan". */
  mealsFor: (date: string) => PlanMeal[];
  /** Names of the supplements the coach picked (to add to the daily checklist in one tap). */
  supplements: string[];
};

const FoodLogPlanContext = createContext<FoodLogPlan | null>(null);

export function FoodLogPlanProvider({ value, children }: { value: FoodLogPlan | null; children: ReactNode }) {
  return <FoodLogPlanContext.Provider value={value}>{children}</FoodLogPlanContext.Provider>;
}

export function useFoodLogPlan(): FoodLogPlan | null {
  return useContext(FoodLogPlanContext);
}

export const FOOD_LOG_KEY = "nutrition-dashboard";

/** One day of the food log (and the week behind it), the person's own calendar day. */
export function useFoodLogDay(date: string, enabled = true) {
  const getDashboard = usePovFn(useServerFn(getNutritionDashboard));
  const povUserId = usePovArgs().viewAsUserId;
  return useQuery({
    queryKey: [FOOD_LOG_KEY, date, povUserId ?? null],
    enabled,
    queryFn: () => {
      const { start, end } = localDayBounds(date);
      return getDashboard({ data: { date, dayStart: start, dayEnd: end, weekStart: weekStartFor(date) } });
    },
    retry: false,
    staleTime: 30_000,
  });
}

/** The day's target: the coach's plan day when there's a plan, else the member's own targets. */
export function targetFromDashboard(row: any): DayTarget | null {
  if (!row) return null;
  const num = (v: unknown) => {
    const x = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  const t: DayTarget = {
    calories: num(row.calories),
    protein: num(row.protein_g),
    carbs: num(row.carbs_g),
    fat: num(row.fat_g),
    label: "Your targets",
  };
  return t.calories || t.protein ? t : null;
}

export type MealToLog = {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  source: "preset" | "manual" | "ai";
  preset_id?: string | null;
  raw_text?: string | null;
  save_as_preset?: boolean;
  /** When it was eaten: undefined = now. */
  logged_at?: string;
};

/**
 * Log a meal and say so with Undo, from anywhere (the Food Log, the
 * Cookbook's "Log this meal"). Resolves true when it saved.
 */
export function useLogFood() {
  const log = usePovFn(useServerFn(logMeal));
  const del = usePovFn(useServerFn(deleteMeal));
  const qc = useQueryClient();
  return useCallback(
    async (meal: MealToLog): Promise<boolean> => {
      const refresh = () => qc.invalidateQueries({ queryKey: [FOOD_LOG_KEY] });
      try {
        const row: any = await log({ data: meal });
        void refresh();
        toast.success(`Logged ${meal.name}`, {
          description: `${Math.round(meal.calories).toLocaleString("en-CA")} kcal · ${Math.round(meal.protein_g)} g protein${
            meal.save_as_preset ? " · saved for next time" : ""
          }`,
          action: row?.id
            ? {
                label: "Undo",
                onClick: () => void del({ data: { id: row.id } }).then(refresh, () => toast.error("Couldn't undo that")),
              }
            : undefined,
        });
        return true;
      } catch (e: any) {
        toast.error(e?.message ?? "Couldn't log that");
        return false;
      }
    },
    [log, del, qc],
  );
}
