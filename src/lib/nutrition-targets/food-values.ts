/**
 * A meal's foods, worked out: does its "Approximate macros" line say what its
 * foods give? A 4 / 4 / 9 calorie line that matches its macros proves nothing
 * if the macros themselves are guesses (Devin's Meal 3, 180 g cooked 90% lean
 * beef + 450 g cooked potatoes + 150 g green beans, said 702 kcal; the foods
 * are about 830).
 *
 * Only the plain staples the meal plan prompt is allowed to use (SHELF FIRST,
 * rule 2d), per 100 g as written (cooked unless the line says dry / raw), from
 * USDA FoodData Central (SR Legacy). A meal is only judged when every food in
 * it is one of these and its amount reads; anything else is left alone, so a
 * coach's own foods are never second-guessed. Pure.
 */
import { structureMealPlanDay, type PlanMeal } from "@/lib/nutrition-targets/meal-plan-structure";

type Per100 = readonly [kcal: number, protein: number, carbs: number, fat: number];
type Food = {
  key: string;
  match: RegExp;
  per100: Per100;
  /** Grams in one when it's counted ("2 whole eggs", "1 medium banana", "½ bagel"). */
  each?: number;
  /** Values when the line says it's dry / raw. */
  dry?: Per100;
};

// Order matters: the first match wins ("egg whites" before "eggs", "sweet potato" before "potato", "peanut butter" before "butter").
const FOODS: Food[] = [
  { key: "egg whites", match: /egg\s*whites?|liquid egg/, per100: [52, 10.9, 0.7, 0.2] },
  { key: "eggs", match: /\beggs?\b/, per100: [143, 12.6, 0.7, 9.5], each: 50 },
  { key: "greek yogurt", match: /greek\s+yog(?:h)?urt|skyr/, per100: [59, 10.3, 3.6, 0.4] },
  { key: "cottage cheese", match: /cottage cheese/, per100: [72, 12.4, 2.7, 1] },
  { key: "whey", match: /whey|protein powder|protein isolate/, per100: [400, 80, 10, 5], each: 30 },
  { key: "chicken thigh", match: /chicken thighs?/, per100: [209, 25.9, 0, 10.9], dry: [121, 19.7, 0, 4.1] },
  { key: "chicken breast", match: /chicken/, per100: [165, 31, 0, 3.6], dry: [120, 22.5, 0, 2.6] },
  { key: "ground turkey", match: /turkey/, per100: [203, 25.5, 0, 10.4], dry: [150, 19.6, 0, 8] },
  { key: "steak", match: /steak|sirloin|striploin|flank/, per100: [200, 29, 0, 8.5], dry: [143, 22, 0, 5.8] },
  { key: "ground beef", match: /beef/, per100: [217, 26.1, 0, 11.7], dry: [176, 20, 0, 10] },
  { key: "salmon", match: /salmon/, per100: [206, 22.1, 0, 12.4], dry: [208, 20.4, 0, 13.4] },
  { key: "white fish", match: /\bcod\b|tilapia|white\s*fish|haddock|pollock|halibut/, per100: [115, 24, 0, 1.6], dry: [86, 18.5, 0, 1] },
  { key: "shrimp", match: /shrimp|prawns?/, per100: [99, 24, 0.2, 0.3], dry: [85, 20.1, 0, 0.5] },
  { key: "tuna", match: /tuna/, per100: [116, 25.5, 0, 0.8], each: 120 },
  { key: "sweet potato", match: /sweet\s*potato/, per100: [90, 2, 20.7, 0.2], dry: [86, 1.6, 20.1, 0.1] },
  { key: "potatoes", match: /potato/, per100: [87, 1.9, 20.1, 0.1], dry: [77, 2, 17.5, 0.1] },
  { key: "rice cakes", match: /rice\s*cakes?/, per100: [387, 8.2, 81.5, 2.8], each: 9 },
  { key: "cream of rice", match: /cream of rice/, per100: [370, 6, 82, 0.5] },
  { key: "cereal", match: /cereal|krispies|corn flakes|cheerios/, per100: [382, 6.5, 84, 1.5] },
  { key: "brown rice", match: /brown rice/, per100: [123, 2.7, 25.6, 1], dry: [370, 7.9, 77.2, 2.9] },
  { key: "rice", match: /\brice\b|jasmine|basmati/, per100: [130, 2.7, 28.2, 0.3], dry: [365, 7.1, 80, 0.7] },
  { key: "pasta", match: /pasta|spaghetti|penne|macaroni|rotini|fusilli/, per100: [158, 5.8, 30.9, 0.9], dry: [371, 13, 74.7, 1.5] },
  { key: "oats", match: /\boats?\b|oatmeal/, per100: [379, 13.2, 67.7, 6.5] },
  { key: "bagel", match: /bagels?/, per100: [257, 10, 50.5, 1.6], each: 100 },
  { key: "bread", match: /bread|toast/, per100: [260, 10.5, 46, 3.4], each: 30 },
  { key: "tortilla", match: /tortillas?|wraps?\b/, per100: [304, 8.2, 49.4, 8], each: 70 },
  { key: "banana", match: /bananas?/, per100: [89, 1.1, 22.8, 0.3], each: 118 },
  { key: "apple", match: /apples?\b/, per100: [52, 0.3, 13.8, 0.2], each: 182 },
  { key: "blueberries", match: /blueberr/, per100: [57, 0.7, 14.5, 0.3] },
  { key: "berries", match: /berr/, per100: [45, 0.8, 10.5, 0.4] },
  { key: "broccoli", match: /broccoli/, per100: [35, 2.4, 7.2, 0.4] },
  { key: "green beans", match: /green beans?/, per100: [35, 1.9, 7.9, 0.3] },
  { key: "asparagus", match: /asparagus/, per100: [22, 2.4, 4.1, 0.2] },
  { key: "spinach", match: /spinach/, per100: [23, 2.9, 3.6, 0.4] },
  { key: "vegetables", match: /mixed veg|vegetable blend|stir[- ]?fry veg|frozen veg/, per100: [50, 2.5, 9, 0.3] },
  { key: "peanut butter", match: /peanut butter/, per100: [590, 24, 21, 50] },
  { key: "oil", match: /\boil\b/, per100: [884, 0, 0, 100] },
  { key: "butter", match: /\bbutter\b/, per100: [717, 0.9, 0.1, 81] },
  { key: "almonds", match: /almonds?\b/, per100: [579, 21.2, 21.6, 49.9] },
  { key: "avocado", match: /avocado/, per100: [160, 2, 8.5, 14.7], each: 150 },
  { key: "honey", match: /honey/, per100: [304, 0.3, 82.4, 0] },
  // plain milk only: a "protein milk" is its own product
  { key: "milk", match: /^(?!.*protein).*\bmilk\b/, per100: [42, 3.4, 5, 1] },
];

/** Leaner and fattier ground beef (cooked, broiled): "93% lean", "85/15". */
const BEEF_BY_LEAN: Record<number, Per100> = {
  95: [170, 26, 0, 6.5],
  93: [185, 26, 0, 8.5],
  90: [217, 26.1, 0, 11.7],
  85: [250, 25.9, 0, 15.4],
  80: [272, 25.8, 0, 17.8],
};

/** Free, never counted (FOOD-WEIGHING RULES): spices, sauces with no calories, water. */
const FREE = /\b(salt|pepper|spices?|seasonings?|herbs?|garlic|cinnamon|lemon|lime|vinegar|mustard|hot sauce|salsa|zero[- ]?cal\w*|water|coffee|tea|sweetener|stevia|to taste|as desired|cooking spray)\b/i;
const COUNT_UNIT = /^(?:whole|large|medium|small|pieces?|servings?)$/i;
const SIZE: Record<string, number> = { small: 0.85, medium: 1, large: 1.15 };

function num(s: string): number | null {
  const t = s.replace(",", ".").trim();
  const frac: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
  let m = t.match(/^(\d+)\s*([½¼¾⅓⅔])$/);
  if (m) return Number(m[1]) + frac[m[2]];
  if (frac[t] != null) return frac[t];
  m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const AMOUNT = /^~?\s*(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔]|[½¼¾⅓⅔]|\d+\/\d+|\d+(?:[.,]\d+)?)\s*(kg|g|grams?|ml|l|oz|lbs?|tbsp|tsp|scoops?|slices?|cans?|whole|large|medium|small|pieces?|servings?)?\b\.?\s*(.*)$/i;

export type FoodValues = { kcal: number; protein: number; carbs: number; fat: number };

/** One food line's values, `free` for a line that has none worth counting, or null when it can't be read. */
export function foodLineValues(line: string): FoodValues | "free" | null {
  const raw = line.trim();
  if (!raw) return "free";
  const m = raw.match(AMOUNT);
  if (!m) return FREE.test(raw) ? "free" : null;
  const qty = num(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  let name = m[3].toLowerCase();
  if (qty == null || qty <= 0) return null;
  const sizeWord = name.match(/^(small|medium|large)\s+/)?.[1];
  if (sizeWord) name = name.slice(sizeWord.length).trim();
  const food = FOODS.find((f) => f.match.test(name));
  if (!food) return FREE.test(name) ? "free" : null;
  const dry = /\b(dry|uncooked|raw)\b/.test(name) && !/\bcooked\b/.test(name);
  // oats are written dry; cooked oatmeal is mostly water, so it isn't judged
  if (food.key === "oats" && /\bcooked\b/.test(name)) return null;
  let per: Per100 = dry && food.dry ? food.dry : food.per100;
  if (food.key === "ground beef" && !dry) {
    const lean = Number(name.match(/(\d{2})\s*(?:%|\/\s*\d{1,2})/)?.[1]) || (/extra[- ]?lean/.test(name) ? 93 : 0);
    const near = [95, 93, 90, 85, 80].find((l) => lean >= l - 1);
    if (lean && near) per = BEEF_BY_LEAN[near];
  }
  // a label size in brackets beats the usual one: "1 scoop whey protein (about 30 g)"
  const about = Number(name.match(/about\s*(\d+(?:\.\d+)?)\s*g\b/)?.[1]);
  let grams: number | null = null;
  if (unit === "g" || unit === "gram" || unit === "grams") grams = qty;
  else if (unit === "kg") grams = qty * 1000;
  else if (unit === "ml") grams = qty;
  else if (unit === "l") grams = qty * 1000;
  else if (unit === "oz") grams = qty * 28.35;
  else if (unit === "lb" || unit === "lbs") grams = qty * 453.6;
  else if (unit === "tbsp") grams = qty * (food.key === "oil" ? 13.5 : 16);
  else if (unit === "tsp") grams = qty * (food.key === "oil" ? 4.5 : 5);
  else {
    const each = about || food.each;
    if (!each) return null;
    const size = SIZE[(COUNT_UNIT.test(unit) ? unit : sizeWord) ?? ""] ?? 1;
    grams = qty * each * (about ? 1 : size);
  }
  const f = grams / 100;
  return { kcal: per[0] * f, protein: per[1] * f, carbs: per[2] * f, fat: per[3] * f };
}

/** A meal's foods added up, or null when any of its foods isn't one we can read. */
export function mealFoodValues(meal: Pick<PlanMeal, "foods" | "notes">): FoodValues | null {
  const lines = [...meal.foods.map((f) => `${f.amount} ${f.name}`), ...meal.notes];
  const sum: FoodValues = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  let counted = 0;
  for (const l of lines) {
    const v = foodLineValues(l);
    if (v === null) return null;
    if (v === "free") continue;
    counted++;
    sum.kcal += v.kcal;
    sum.protein += v.protein;
    sum.carbs += v.carbs;
    sum.fat += v.fat;
  }
  return counted ? sum : null;
}

/**
 * A meal's macros as written are off from its foods when the calories are more
 * than 12% (and 80 kcal) apart, or the protein written is more than 10 g over
 * what the foods give (protein under what they give only means a little more).
 * Smaller gaps are the noise of any food table, and a whole day is never judged
 * this way (a day 8–10% apart is ordinary label error).
 */
export const FOOD_KCAL_SHARE = 0.12;
export const FOOD_KCAL_MIN = 80;
export const FOOD_PROTEIN_G = 10;

export type MealFoodCheck = { title: string; foods: string[]; stated: FoodValues; worked: FoodValues };

/** Each meal on a day whose Approximate macros don't say what its foods give. */
export function mealsOffTheirFoods(notes: string | null | undefined): MealFoodCheck[] {
  const out: MealFoodCheck[] = [];
  for (const m of structureMealPlanDay(notes).meals) {
    const x = m.macros;
    if (!x || x.protein == null || x.carbs == null || x.fat == null) continue;
    const worked = mealFoodValues(m);
    if (!worked) continue;
    const stated = { kcal: x.protein * 4 + x.carbs * 4 + x.fat * 9, protein: x.protein, carbs: x.carbs, fat: x.fat };
    const kcalOff = Math.abs(worked.kcal - stated.kcal) > Math.max(FOOD_KCAL_MIN, worked.kcal * FOOD_KCAL_SHARE);
    const proteinOver = stated.protein - worked.protein > FOOD_PROTEIN_G;
    if (kcalOff || proteinOver)
      out.push({ title: m.title.split(" · ")[0], foods: m.foods.map((f) => `${f.amount} ${f.name}`), stated, worked });
  }
  return out;
}

const r = (n: number) => Math.round(n).toLocaleString("en-US");

/** For the AI's fix: "Meal 3: its foods (…) come to about 830 kcal (58 g protein, 102 g carbs, 22 g fat), not the 702 kcal (50 / 85 / 18) its Approximate macros say". */
export function mealFoodLine(c: MealFoodCheck): string {
  return `${c.title}: its foods (${c.foods.join(", ")}) come to about ${r(c.worked.kcal)} kcal (${r(c.worked.protein)} g protein, ${r(c.worked.carbs)} g carbs, ${r(c.worked.fat)} g fat), not the ${r(c.stated.kcal)} kcal (${r(c.stated.protein)} / ${r(c.stated.carbs)} / ${r(c.stated.fat)}) its Approximate macros say`;
}

/** For the coach: "Meal 3's foods come to about 830 kcal and 58 g protein, not the 702 kcal and 50 g its macros say". */
export function mealFoodShort(c: MealFoodCheck): string {
  return `${c.title}'s foods come to about ${r(c.worked.kcal)} kcal and ${r(c.worked.protein)} g protein, not the ${r(c.stated.kcal)} kcal and ${r(c.stated.protein)} g its macros say`;
}

/** More than this of one weighed food in one meal is almost certainly a typo (5,000 g rice, 2 kg chicken). */
export const MAX_SINGLE_FOOD_G = 1000;

/** A weighed amount on a food line in grams (g, kg, ml, l, oz, lb), else null. */
function weighedGrams(line: string): number | null {
  const m = line.trim().match(AMOUNT);
  if (!m) return null;
  const qty = num(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  if (qty == null) return null;
  const per: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, ml: 1, l: 1000, oz: 28.35, lb: 453.6, lbs: 453.6 };
  return per[unit] != null ? qty * per[unit] : null;
}

export type MealMath = {
  title: string;
  /** The meal's Approximate macros as written (calories at 4 / 4 / 9), or null when it doesn't say them. */
  stated: FoodValues | null;
  /** What its foods give (USDA values for the plain staples), or null when any food can't be read. */
  worked: FoodValues | null;
  /** Lines that couldn't be read as a staple (a free meal, a food outside the table). */
  unread: string[];
  /** Amounts that can't be right: none of a food, or more than `MAX_SINGLE_FOOD_G` of one. */
  odd: string[];
};

/**
 * Each meal on a day, as written and by its foods: the coach's "Show the math"
 * on a plan (nothing here is shown to the client or written anywhere).
 */
export function mealMath(notes: string | null | undefined): MealMath[] {
  return structureMealPlanDay(notes).meals.map((m) => {
    const x = m.macros;
    const stated =
      x && x.protein != null && x.carbs != null && x.fat != null
        ? { kcal: x.protein * 4 + x.carbs * 4 + x.fat * 9, protein: x.protein, carbs: x.carbs, fat: x.fat }
        : null;
    const lines = [...m.foods.map((f) => `${f.amount} ${f.name}`), ...m.notes];
    const unread = lines.filter((l) => foodLineValues(l) === null);
    const odd = lines.filter((l) => {
      if (FREE.test(l)) return false;
      const g = weighedGrams(l);
      return g != null && (g <= 0 || g > MAX_SINGLE_FOOD_G);
    });
    return { title: m.title.split(" · ")[0], stated, worked: mealFoodValues(m), unread, odd };
  });
}
