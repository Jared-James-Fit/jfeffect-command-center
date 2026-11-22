/**
 * Everything the Studio can put in a meal, for the signed-in person: the
 * built-in staples, their own foods (nutrition_custom_foods, theirs only by
 * RLS), the cookbook's recipes, and their saved meals. One query each, kept
 * for the visit; changes refresh them.
 */
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { BUILTIN_FOODS, customFood, type CustomFoodRow, type StudioFood } from "@/lib/nutrition-studio/foods";
import { COOKBOOK, recipeMacros } from "@/lib/cookbook/library";
import type { FoodLookup } from "@/lib/nutrition-studio/model";

export type SavedMeal = { id: string; name: string; lines: string[]; timing: "pre" | "post" | "pre_post" | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };

/** The cookbook's recipes as foods: a serving at the recipe's own numbers. */
export const RECIPE_FOODS: StudioFood[] = COOKBOOK.map((r) => {
  const m = recipeMacros(r);
  return {
    id: `r:${r.id}`,
    name: r.title,
    lineName: r.title.toLowerCase(),
    per100: null,
    each: undefined,
    category: m.protein * 4 >= m.calories * 0.3 ? "protein" : "extra",
    source: "recipe",
    perServing: { kcal: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, label: "serving" },
  } satisfies StudioFood;
});

export const customFoodsKey = (uid: string | null) => ["nutrition-custom-foods", uid] as const;
export const savedMealsKey = (uid: string | null) => ["nutrition-saved-meals", uid] as const;

export function useStudioFoods() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const customs = useQuery({
    queryKey: customFoodsKey(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nutrition_custom_foods")
        .select("id, name, brand, basis, serving_label, serving_grams, kcal, protein, carbs, fat, category")
        .eq("archived", false)
        .order("name");
      if (error) throw error;
      return (data ?? []) as CustomFoodRow[];
    },
  });
  const saved = useQuery({
    queryKey: savedMealsKey(uid),
    enabled: !!uid,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nutrition_meal_templates")
        .select("id, name, lines, timing, kcal, protein, carbs, fat")
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SavedMeal[];
    },
  });

  const customFoods = useMemo(() => (customs.data ?? []).map(customFood), [customs.data]);
  /** What a plan line can be read as: their own foods and the recipes (the staples are always known). */
  const readable = useMemo(() => [...customFoods, ...RECIPE_FOODS], [customFoods]);
  const all = useMemo(() => [...customFoods, ...BUILTIN_FOODS, ...RECIPE_FOODS], [customFoods]);
  const lookup: FoodLookup = useMemo(() => {
    const map = new Map(all.map((f) => [f.id, f]));
    return (id: string) => map.get(id) ?? null;
  }, [all]);

  return { uid, all, readable, lookup, customRows: customs.data ?? [], savedMeals: saved.data ?? [], loading: customs.isLoading };
}

export function useSaveCustomFood() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (row: Omit<CustomFoodRow, "id"> & { id?: string }) => {
      const body = {
        name: row.name.trim(),
        brand: row.brand?.trim() || null,
        basis: row.basis,
        serving_label: row.basis === "per_serving" ? row.serving_label?.trim() || "serving" : null,
        serving_grams: row.basis === "per_serving" ? row.serving_grams || null : null,
        kcal: row.kcal,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        category: row.category ?? null,
      };
      const q = row.id
        ? (supabase as any).from("nutrition_custom_foods").update(body).eq("id", row.id).select("id").single()
        : (supabase as any).from("nutrition_custom_foods").insert(body).select("id").single();
      const { data, error } = await q;
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customFoodsKey(user?.id ?? null) }),
  });
}

export function useSaveMealTemplate() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (m: { name: string; lines: string[]; timing: SavedMeal["timing"]; kcal?: number | null; protein?: number | null; carbs?: number | null; fat?: number | null }) => {
      const { data, error } = await (supabase as any)
        .from("nutrition_meal_templates")
        .insert({ name: m.name.trim().slice(0, 80), lines: m.lines.slice(0, 30), timing: m.timing, kcal: m.kcal ?? null, protein: m.protein ?? null, carbs: m.carbs ?? null, fat: m.fat ?? null })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: savedMealsKey(user?.id ?? null) }),
  });
}

export function useArchiveSavedMeal() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("nutrition_meal_templates").update({ archived: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: savedMealsKey(user?.id ?? null) }),
  });
}
