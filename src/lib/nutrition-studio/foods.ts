/**
 * The Nutrition Studio's built-in foods: the plain staples a meal plan uses,
 * with the values the app already checks plans against (food-values.ts, USDA
 * FoodData Central / SR Legacy, cooked unless the name says raw or dry) and the
 * cookbook's ingredient table (cookbook/foods.ts, the same source). No number
 * here is new: every entry points at one of those two tables, and
 * nutrition-studio.test.ts holds each one to its source. A food that isn't
 * here is the person's own (a custom food from its label) or a recipe.
 *
 * Pure: the editor, the importer and the server read foods the same way.
 */
import { BEEF_PER100_BY_LEAN, STAPLE_FOODS, type Per100 } from "@/lib/nutrition-targets/food-values";
import { FOODS as COOKBOOK_FOODS, type FoodKey } from "@/lib/cookbook/foods";

export type FoodCategory = "protein" | "carb" | "fat" | "veg" | "fruit" | "dairy" | "extra";

/** A counted unit: "2 whole eggs", "1 scoop whey protein", "2 slices bread"; word "" for "1 apple". */
export type EachUnit = { grams: number; word: string };

export type StudioFood = {
  /** Stable id: `b:<key>` built-in, `c:<uuid>` custom, `r:<id>` cookbook recipe. */
  id: string;
  /** What the picker shows ("Chicken breast, cooked"). */
  name: string;
  /** How a plan line names it ("cooked chicken breast"): plan readers know these words. */
  lineName: string;
  /** The plan line's name for more than one counted ("2 medium bananas"). */
  plural?: string;
  /** Per 100 g as written: [kcal, protein, carbs, fat]. Null for a per-serving custom food with no weight. */
  per100: Per100 | null;
  /** One counted unit, when it's usually counted. */
  each?: EachUnit;
  /** Grams in a tablespoon (oils and nut butters differ from water). */
  tbspGrams?: number;
  category: FoodCategory;
  /** Where the numbers came from. */
  source: "usda" | "label" | "recipe";
  /** Extra words people search by. */
  aliases?: string[];
  /** A per-serving custom food (or a recipe): the values of one serving. */
  perServing?: { kcal: number; protein: number; carbs: number; fat: number; label: string; grams?: number | null };
};

const staple = (key: string) => {
  const s = STAPLE_FOODS.find((f) => f.key === key);
  if (!s) throw new Error(`Unknown staple ${key}`);
  return s;
};
const cook = (key: FoodKey): Per100 => COOKBOOK_FOODS[key];

type Def = Omit<StudioFood, "id" | "source"> & { key: string };

/** [key, from] pairs say exactly which table each value comes from (checked in tests). */
export const BUILTIN_SOURCES: Record<string, { table: "staple"; key: string; form: "per100" | "dry" } | { table: "cookbook"; key: FoodKey } | { table: "beef"; lean: number }> = {};

function fromStaple(key: string, form: "per100" | "dry", def: Omit<Def, "per100" | "each"> & { each?: EachUnit | "staple" }): Def {
  const s = staple(key);
  const per = form === "dry" ? s.dry : s.per100;
  if (!per) throw new Error(`Staple ${key} has no ${form} values`);
  BUILTIN_SOURCES[def.key] = { table: "staple", key, form };
  const each = def.each === "staple" ? (s.each ? { grams: s.each, word: "whole" } : undefined) : def.each;
  return { ...def, per100: per, each };
}
function fromCookbook(key: FoodKey, def: Omit<Def, "per100">): Def {
  BUILTIN_SOURCES[def.key] = { table: "cookbook", key };
  return { ...def, per100: cook(key) };
}
function fromBeef(lean: number, def: Omit<Def, "per100">): Def {
  BUILTIN_SOURCES[def.key] = { table: "beef", lean };
  return { ...def, per100: BEEF_PER100_BY_LEAN[lean] };
}

const DEFS: Def[] = [
  // protein
  fromStaple("chicken breast", "per100", { key: "chicken_breast_cooked", name: "Chicken breast, cooked", lineName: "cooked chicken breast", category: "protein", aliases: ["chicken"] }),
  fromStaple("chicken breast", "dry", { key: "chicken_breast_raw", name: "Chicken breast, raw", lineName: "raw chicken breast", category: "protein", aliases: ["chicken"] }),
  fromStaple("chicken thigh", "per100", { key: "chicken_thigh_cooked", name: "Chicken thigh, cooked", lineName: "cooked chicken thighs", category: "protein" }),
  fromStaple("chicken thigh", "dry", { key: "chicken_thigh_raw", name: "Chicken thigh, raw", lineName: "raw chicken thighs", category: "protein" }),
  fromStaple("ground turkey", "per100", { key: "ground_turkey_cooked", name: "Ground turkey, cooked", lineName: "cooked ground turkey", category: "protein", aliases: ["turkey"] }),
  fromStaple("ground turkey", "dry", { key: "ground_turkey_raw", name: "Ground turkey, raw", lineName: "raw ground turkey", category: "protein", aliases: ["turkey"] }),
  fromBeef(95, { key: "beef_95_cooked", name: "Lean ground beef 95%, cooked", lineName: "cooked 95% lean ground beef", category: "protein", aliases: ["extra lean beef"] }),
  fromBeef(93, { key: "beef_93_cooked", name: "Lean ground beef 93%, cooked", lineName: "cooked 93% lean ground beef", category: "protein", aliases: ["extra lean beef"] }),
  fromStaple("ground beef", "per100", { key: "beef_90_cooked", name: "Lean ground beef 90%, cooked", lineName: "cooked 90% lean ground beef", category: "protein", aliases: ["beef", "hamburger"] }),
  fromBeef(85, { key: "beef_85_cooked", name: "Ground beef 85%, cooked", lineName: "cooked 85% lean ground beef", category: "protein", aliases: ["beef", "hamburger"] }),
  fromStaple("ground beef", "dry", { key: "beef_90_raw", name: "Lean ground beef 90%, raw", lineName: "raw 90% lean ground beef", category: "protein", aliases: ["beef"] }),
  fromStaple("steak", "per100", { key: "steak_cooked", name: "Steak (sirloin), cooked", lineName: "cooked sirloin steak", category: "protein", aliases: ["beef", "striploin", "flank"] }),
  fromStaple("steak", "dry", { key: "steak_raw", name: "Steak (sirloin), raw", lineName: "raw sirloin steak", category: "protein", aliases: ["beef"] }),
  fromStaple("salmon", "per100", { key: "salmon_cooked", name: "Salmon, cooked", lineName: "cooked salmon", category: "protein", aliases: ["fish"] }),
  fromStaple("salmon", "dry", { key: "salmon_raw", name: "Salmon, raw", lineName: "raw salmon", category: "protein", aliases: ["fish"] }),
  fromStaple("white fish", "per100", { key: "white_fish_cooked", name: "White fish (cod, tilapia), cooked", lineName: "cooked white fish", category: "protein", aliases: ["cod", "tilapia", "haddock", "fish"] }),
  fromStaple("white fish", "dry", { key: "white_fish_raw", name: "White fish (cod, tilapia), raw", lineName: "raw white fish", category: "protein", aliases: ["cod", "tilapia", "fish"] }),
  fromStaple("shrimp", "per100", { key: "shrimp_cooked", name: "Shrimp, cooked", lineName: "cooked shrimp", category: "protein", aliases: ["prawns"] }),
  fromStaple("tuna", "per100", { key: "tuna_canned", name: "Tuna, canned in water (drained)", lineName: "tuna (in water)", category: "protein", each: { grams: 120, word: "can" } }),
  fromCookbook("deli_turkey", { key: "deli_turkey", name: "Deli turkey breast, sliced", lineName: "sliced deli turkey", category: "protein" }),
  fromStaple("eggs", "per100", { key: "eggs", name: "Eggs (large)", lineName: "egg", plural: "eggs", category: "protein", each: { grams: 50, word: "whole" }, aliases: ["egg"] }),
  fromStaple("egg whites", "per100", { key: "egg_whites", name: "Egg whites, liquid", lineName: "liquid egg whites", category: "protein" }),
  fromStaple("whey", "per100", { key: "whey", name: "Whey protein powder", lineName: "whey protein", category: "protein", each: { grams: 30, word: "scoop" }, aliases: ["protein powder", "shake"] }),
  fromCookbook("tofu_firm", { key: "tofu_firm", name: "Tofu, firm", lineName: "firm tofu", category: "protein" }),
  fromCookbook("edamame_shelled", { key: "edamame", name: "Edamame, shelled", lineName: "shelled edamame", category: "protein" }),
  // dairy
  fromStaple("greek yogurt", "per100", { key: "greek_yogurt", name: "Greek yogurt, 0% plain", lineName: "plain 0% greek yogurt", category: "dairy", aliases: ["skyr", "yoghurt"] }),
  fromStaple("cottage cheese", "per100", { key: "cottage_cheese", name: "Cottage cheese, 1%", lineName: "1% cottage cheese", category: "dairy" }),
  fromStaple("milk", "per100", { key: "milk_1", name: "Milk, 1%", lineName: "1% milk", category: "dairy" }),
  fromCookbook("mozzarella_part_skim", { key: "mozzarella", name: "Mozzarella, part-skim", lineName: "part-skim mozzarella", category: "dairy", aliases: ["cheese"] }),
  fromCookbook("cheddar", { key: "cheddar", name: "Cheddar cheese", lineName: "cheddar cheese", category: "dairy", aliases: ["cheese"] }),
  fromCookbook("parmesan", { key: "parmesan", name: "Parmesan cheese", lineName: "parmesan cheese", category: "dairy", aliases: ["cheese"] }),
  // carbs
  fromStaple("rice", "per100", { key: "white_rice_cooked", name: "White rice, cooked", lineName: "cooked white rice", category: "carb", aliases: ["rice", "jasmine", "basmati"] }),
  fromStaple("rice", "dry", { key: "white_rice_dry", name: "White rice, dry", lineName: "dry white rice", category: "carb", aliases: ["rice"] }),
  fromStaple("brown rice", "per100", { key: "brown_rice_cooked", name: "Brown rice, cooked", lineName: "cooked brown rice", category: "carb" }),
  fromStaple("brown rice", "dry", { key: "brown_rice_dry", name: "Brown rice, dry", lineName: "dry brown rice", category: "carb" }),
  fromStaple("pasta", "per100", { key: "pasta_cooked", name: "Pasta, cooked", lineName: "cooked pasta", category: "carb", aliases: ["spaghetti", "penne", "noodles"] }),
  fromStaple("pasta", "dry", { key: "pasta_dry", name: "Pasta, dry", lineName: "dry pasta", category: "carb", aliases: ["spaghetti", "penne"] }),
  fromStaple("potatoes", "per100", { key: "potatoes_cooked", name: "Potatoes, cooked", lineName: "cooked potatoes", category: "carb", aliases: ["potato"] }),
  fromStaple("potatoes", "dry", { key: "potatoes_raw", name: "Potatoes, raw", lineName: "raw potatoes", category: "carb", aliases: ["potato"] }),
  fromStaple("sweet potato", "per100", { key: "sweet_potato_cooked", name: "Sweet potatoes, cooked", lineName: "cooked sweet potatoes", category: "carb", aliases: ["yam"] }),
  fromStaple("sweet potato", "dry", { key: "sweet_potato_raw", name: "Sweet potatoes, raw", lineName: "raw sweet potatoes", category: "carb", aliases: ["yam"] }),
  fromStaple("oats", "per100", { key: "oats", name: "Oats, dry", lineName: "dry oats", category: "carb", aliases: ["oatmeal", "porridge"] }),
  fromStaple("cream of rice", "per100", { key: "cream_of_rice", name: "Cream of rice, dry", lineName: "dry cream of rice", category: "carb" }),
  fromStaple("cereal", "per100", { key: "cereal", name: "Cereal (rice or corn)", lineName: "cereal", category: "carb" }),
  fromStaple("bread", "per100", { key: "bread", name: "Bread", lineName: "bread", category: "carb", each: { grams: 30, word: "slice" }, aliases: ["toast"] }),
  fromCookbook("bread_whole_wheat", { key: "bread_whole_wheat", name: "Whole wheat bread", lineName: "whole wheat bread", category: "carb", each: { grams: 35, word: "slice" }, aliases: ["toast"] }),
  fromStaple("bagel", "per100", { key: "bagel", name: "Bagel", lineName: "bagel", plural: "bagels", category: "carb", each: { grams: 100, word: "" } }),
  fromStaple("tortilla", "per100", { key: "tortilla", name: "Flour tortilla (large wrap)", lineName: "large flour tortilla", plural: "large flour tortillas", category: "carb", each: { grams: 70, word: "" }, aliases: ["wrap"] }),
  fromStaple("rice cakes", "per100", { key: "rice_cakes", name: "Rice cakes", lineName: "rice cake", plural: "rice cakes", category: "carb", each: { grams: 9, word: "" } }),
  fromCookbook("black_beans_canned", { key: "black_beans", name: "Black beans, canned (drained)", lineName: "canned black beans", category: "carb", aliases: ["beans"] }),
  fromStaple("honey", "per100", { key: "honey", name: "Honey", lineName: "honey", category: "extra", tbspGrams: 21 }),
  // fruit
  fromStaple("banana", "per100", { key: "banana", name: "Banana (medium)", lineName: "banana", plural: "bananas", category: "fruit", each: { grams: 118, word: "medium" } }),
  fromStaple("apple", "per100", { key: "apple", name: "Apple (medium)", lineName: "apple", plural: "apples", category: "fruit", each: { grams: 182, word: "" } }),
  fromStaple("blueberries", "per100", { key: "blueberries", name: "Blueberries", lineName: "blueberries", category: "fruit" }),
  fromStaple("berries", "per100", { key: "berries", name: "Berries, mixed", lineName: "mixed berries", category: "fruit", aliases: ["strawberries", "raspberries"] }),
  fromCookbook("pineapple", { key: "pineapple", name: "Pineapple", lineName: "pineapple", category: "fruit" }),
  // vegetables
  fromStaple("broccoli", "per100", { key: "broccoli", name: "Broccoli", lineName: "broccoli", category: "veg" }),
  fromStaple("green beans", "per100", { key: "green_beans", name: "Green beans", lineName: "green beans", category: "veg" }),
  fromStaple("asparagus", "per100", { key: "asparagus", name: "Asparagus", lineName: "asparagus", category: "veg" }),
  fromStaple("spinach", "per100", { key: "spinach", name: "Spinach", lineName: "spinach", category: "veg" }),
  fromStaple("vegetables", "per100", { key: "mixed_veg", name: "Mixed vegetables (frozen)", lineName: "frozen mixed vegetables", category: "veg", aliases: ["stir fry vegetables"] }),
  fromCookbook("raw_veg", { key: "raw_veg", name: "Carrots, cucumber or peppers", lineName: "raw vegetables", category: "veg", aliases: ["carrots", "peppers"] }),
  fromCookbook("lettuce", { key: "lettuce", name: "Lettuce", lineName: "lettuce", category: "veg", aliases: ["salad"] }),
  fromCookbook("onion", { key: "onion", name: "Onion", lineName: "onion", category: "veg" }),
  fromCookbook("tomatoes_canned", { key: "tomatoes_canned", name: "Tomatoes, canned", lineName: "canned tomatoes", category: "veg" }),
  // fats
  fromStaple("oil", "per100", { key: "olive_oil", name: "Olive oil (or any cooking oil)", lineName: "olive oil", category: "fat", tbspGrams: 13.5, aliases: ["oil", "avocado oil"] }),
  fromStaple("butter", "per100", { key: "butter", name: "Butter", lineName: "butter", category: "fat", tbspGrams: 14 }),
  fromStaple("peanut butter", "per100", { key: "peanut_butter", name: "Peanut butter", lineName: "peanut butter", category: "fat", tbspGrams: 16, aliases: ["pb"] }),
  fromStaple("almonds", "per100", { key: "almonds", name: "Almonds", lineName: "almonds", category: "fat", aliases: ["nuts"] }),
  fromStaple("avocado", "per100", { key: "avocado", name: "Avocado", lineName: "avocado", plural: "avocados", category: "fat", each: { grams: 150, word: "" } }),
  // extras
  fromCookbook("salsa", { key: "salsa", name: "Salsa", lineName: "salsa", category: "extra" }),
  fromCookbook("marinara", { key: "marinara", name: "Marinara sauce", lineName: "marinara sauce", category: "extra", aliases: ["pasta sauce"] }),
  fromCookbook("light_mayo", { key: "light_mayo", name: "Light mayo", lineName: "light mayo", category: "extra", tbspGrams: 15 }),
  fromCookbook("cocoa", { key: "cocoa", name: "Cocoa powder, unsweetened", lineName: "unsweetened cocoa powder", category: "extra" }),
  fromCookbook("chocolate_chips", { key: "chocolate_chips", name: "Chocolate chips", lineName: "chocolate chips", category: "extra" }),
];

export const BUILTIN_FOODS: StudioFood[] = DEFS.map(({ key, ...d }) => ({ ...d, id: `b:${key}`, source: "usda" }));

const BY_ID = new Map(BUILTIN_FOODS.map((f) => [f.id, f]));
export function builtinFood(id: string): StudioFood | null {
  return BY_ID.get(id) ?? null;
}

/** A custom food row (nutrition_custom_foods) as a StudioFood. */
export type CustomFoodRow = {
  id: string;
  name: string;
  brand?: string | null;
  basis: "per_100g" | "per_serving";
  serving_label?: string | null;
  serving_grams?: number | null;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  category?: string | null;
};

export function customFood(row: CustomFoodRow): StudioFood {
  const name = row.brand ? `${row.name} (${row.brand})` : row.name;
  const category = (["protein", "carb", "fat", "veg", "fruit", "dairy", "extra"] as const).find((c) => c === row.category) ?? guessCategory(row);
  if (row.basis === "per_100g") {
    return { id: `c:${row.id}`, name, lineName: row.name.toLowerCase(), per100: [row.kcal, row.protein, row.carbs, row.fat], category, source: "label" };
  }
  const grams = row.serving_grams && row.serving_grams > 0 ? row.serving_grams : null;
  const label = (row.serving_label || "serving").trim();
  return {
    id: `c:${row.id}`,
    name,
    lineName: row.name.toLowerCase(),
    per100: grams ? scale4([row.kcal, row.protein, row.carbs, row.fat], 100 / grams) : null,
    each: grams ? { grams, word: label } : undefined,
    category,
    source: "label",
    perServing: { kcal: row.kcal, protein: row.protein, carbs: row.carbs, fat: row.fat, label, grams },
  };
}

function scale4(v: Per100, k: number): Per100 {
  return [v[0] * k, v[1] * k, v[2] * k, v[3] * k];
}

/** A food's category from where its calories come from (for a custom food that didn't say). */
export function guessCategory(m: { protein: number; carbs: number; fat: number }): FoodCategory {
  const p = m.protein * 4;
  const c = m.carbs * 4;
  const f = m.fat * 9;
  const total = p + c + f || 1;
  if (p / total >= 0.4) return "protein";
  if (f / total >= 0.55) return "fat";
  if (c / total >= 0.5) return "carb";
  return "extra";
}
