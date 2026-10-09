/**
 * How a client reads their meal plan: one meal at a time (swipe) or the whole
 * day as a list (scroll). Swipe is the default. The choice is a per-person,
 * per-device reading preference, so it lives in local storage keyed by the
 * signed-in user — no coach data or plan records are touched.
 */
import { useCallback, useEffect, useState } from "react";
import { kvStorage } from "@/platform/storage";

export type MealPlanView = "swipe" | "scroll";
export const DEFAULT_MEAL_PLAN_VIEW: MealPlanView = "swipe";

export function mealPlanViewKey(userId: string | null | undefined): string {
  return `meal-plan-view:${userId || "anon"}`;
}

export function readMealPlanView(userId: string | null | undefined): MealPlanView {
  const v = kvStorage.get<string>(mealPlanViewKey(userId), DEFAULT_MEAL_PLAN_VIEW);
  return v === "scroll" ? "scroll" : "swipe";
}

export function useMealPlanView(userId: string | null | undefined) {
  const [view, setViewState] = useState<MealPlanView>(() => readMealPlanView(userId));

  // Another account signing in on this device gets their own choice.
  useEffect(() => {
    setViewState(readMealPlanView(userId));
  }, [userId]);

  const setView = useCallback(
    (next: MealPlanView) => {
      setViewState(next);
      kvStorage.set(mealPlanViewKey(userId), next);
    },
    [userId],
  );

  return [view, setView] as const;
}
