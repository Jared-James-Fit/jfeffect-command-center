/**
 * Swapping a food for one like it: the same kind of food, at the amount that
 * gives the same of what it's there for (protein for a protein, carbs for a
 * carb or fruit, fat for a fat, calories for anything else), rounded to how
 * it's measured. Each option says how the meal's calories move. Pure.
 */
import type { StudioFood } from "@/lib/nutrition-studio/foods";
import { itemMacros, type Macros, type StudioItem, type StudioUnit } from "@/lib/nutrition-studio/model";

export type SwapOption = { food: StudioFood; qty: number; unit: StudioUnit; macros: Macros; kcalDelta: number };

type Key = "protein" | "carbs" | "fat" | "kcal";
const KEY_INDEX: Record<Key, number> = { kcal: 0, protein: 1, carbs: 2, fat: 3 };

export function swapKey(food: StudioFood): Key {
  switch (food.category) {
    case "protein":
    case "dairy":
      return "protein";
    case "carb":
    case "fruit":
      return "carbs";
    case "fat":
      return "fat";
    default:
      return "kcal";
  }
}

/** Swap groups: a protein swaps for a protein or dairy, a carb for a carb or fruit, a vegetable for a vegetable. */
const GROUP: Record<StudioFood["category"], string> = { protein: "p", dairy: "p", carb: "c", fruit: "c", fat: "f", veg: "v", extra: "x" };

function roundAmount(food: StudioFood, grams: number): { qty: number; unit: StudioUnit } {
  if (food.each && (food.each.word === "" || /^(whole|medium|scoop|slice|can)$/.test(food.each.word)) && food.each.grams >= 25) {
    const n = Math.max(0.5, Math.round((grams / food.each.grams) * 2) / 2);
    return { qty: n, unit: "each" };
  }
  const step = grams >= 100 ? 5 : grams >= 20 ? 5 : 1;
  return { qty: Math.max(step, Math.round(grams / step) * step), unit: "g" };
}

export function swapOptions(item: StudioItem, current: StudioFood, all: StudioFood[], limit = 8): SwapOption[] {
  const now = itemMacros(current, item.qty, item.unit);
  if (!now) return [];
  const key = swapKey(current);
  const want = now[key];
  const out: SwapOption[] = [];
  for (const f of all) {
    if (f.id === current.id || GROUP[f.category] !== GROUP[current.category]) continue;
    let qty: number;
    let unit: StudioUnit;
    if (f.per100) {
      const per = f.per100[KEY_INDEX[key]];
      if (!(per > 0)) continue;
      ({ qty, unit } = roundAmount(f, (want / per) * 100));
    } else if (f.perServing) {
      const per = key === "kcal" ? f.perServing.kcal : f.perServing[key];
      if (!(per > 0)) continue;
      qty = Math.max(0.5, Math.round((want / per) * 2) / 2);
      unit = "each";
    } else continue;
    const macros = itemMacros(f, qty, unit);
    if (!macros) continue;
    // skip a swap that only works at a silly amount (a kilo of broccoli for a slice of bread)
    if (unit === "g" && qty > 600) continue;
    out.push({ food: f, qty, unit, macros, kcalDelta: Math.round(macros.kcal - now.kcal) });
  }
  return out.sort((a, b) => Math.abs(a.kcalDelta) - Math.abs(b.kcalDelta)).slice(0, limit);
}
