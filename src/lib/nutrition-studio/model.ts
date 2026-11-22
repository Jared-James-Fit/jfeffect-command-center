/**
 * A meal plan day as the Nutrition Studio edits it: meals of foods with
 * amounts, read from and written back to the plan's own text (the paste format
 * every reader already understands: the client's meal cards, the PDF, the
 * grocery list, the food log's one-tap meals, the coverage checks). The text
 * stays the one record; the Studio never keeps a second copy that could drift.
 *
 * Reading is tolerant: a line it can't place on a food stays exactly as
 * written. Writing is conservative: a meal nobody touched is written back
 * byte for byte, and only an edited meal gets new macros (worked out from its
 * foods, plus what any food it couldn't read was already contributing).
 * Pure.
 */
import { MEAL_HEADER, structureMealPlanDay, type PlanMacros } from "@/lib/nutrition-targets/meal-plan-structure";
import { MEAL_TIMING_LABEL, detectMealTiming, type MealTiming } from "@/lib/nutrition-targets/meal-timing";
import { DAILY_TOTAL_HEADING } from "@/lib/nutrition-targets/macro-line";
import { FLEX_HEADING } from "@/lib/nutrition-targets/meal-plan-structure";
import { withHonestTotals } from "@/lib/nutrition-targets/plan-coverage";
import { BUILTIN_FOODS, BUILTIN_SOURCES, type StudioFood } from "@/lib/nutrition-studio/foods";
import { splitAmount, stapleFor } from "@/lib/nutrition-targets/food-values";

export type Macros = { kcal: number; protein: number; carbs: number; fat: number };
export type StudioUnit = "g" | "ml" | "oz" | "each" | "tbsp" | "tsp";

export type StudioItem = {
  id: string;
  /** The food it is, or null for a line kept as written. */
  foodId: string | null;
  qty: number | null;
  unit: StudioUnit;
  /** A kept line's exact text (foodId null). */
  text?: string;
  /** The food's name as the plan wrote it ("berries"), kept while the food stays the same. */
  label?: string;
};

export type StudioMeal = {
  id: string;
  /** "Meal 1", "Breakfast", "Meal 2 · Chicken bowl". */
  title: string;
  timing: MealTiming;
  items: StudioItem[];
  /** Lines in the meal that aren't foods ("Swap: …", "Cook with spray"). */
  notes: string[];
  /** The meal's macros as written when it was read (null for a new meal). */
  written: Macros | null;
  /** What the foods it couldn't read add, from its written macros (never below 0). */
  unreadBase: Macros | null;
  /** The text it was read from, written back unchanged until it's edited. */
  raw: string | null;
  dirty: boolean;
};

export type StudioDay = {
  /** Lines before the first meal. */
  lead: string;
  meals: StudioMeal[];
  /** Everything after the meals (flexible calories, the Daily Total). */
  tail: string;
  /** A meal was removed or moved: the Daily Total is rebuilt even with no meal edited. */
  changed?: boolean;
};

export type FoodLookup = (id: string) => StudioFood | null;

const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
let seq = 0;
export const newId = (p = "x") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

const add = (a: Macros, b: Macros): Macros => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat });
const sub0 = (a: Macros, b: Macros): Macros => ({
  kcal: Math.max(0, a.kcal - b.kcal),
  protein: Math.max(0, a.protein - b.protein),
  carbs: Math.max(0, a.carbs - b.carbs),
  fat: Math.max(0, a.fat - b.fat),
});

export const kcalOf = (m: { protein: number; carbs: number; fat: number }) => m.protein * 4 + m.carbs * 4 + m.fat * 9;

/** Grams in an amount of a food, or null when it can't be weighed (a per-serving food with no weight). */
export function gramsOf(food: StudioFood, qty: number, unit: StudioUnit): number | null {
  switch (unit) {
    case "g":
    case "ml":
      return qty;
    case "oz":
      return qty * 28.35;
    case "tbsp":
      return qty * (food.tbspGrams ?? 15);
    case "tsp":
      return qty * ((food.tbspGrams ?? 15) / 3);
    case "each":
      return food.each ? qty * food.each.grams : null;
  }
}

/** An amount of a food, worked out. Null when it can't be (no amount, or nothing to work it from). */
export function itemMacros(food: StudioFood, qty: number | null, unit: StudioUnit): Macros | null {
  if (qty == null || !(qty > 0)) return null;
  if (unit === "each" && food.perServing) {
    const s = food.perServing;
    return { kcal: s.kcal * qty, protein: s.protein * qty, carbs: s.carbs * qty, fat: s.fat * qty };
  }
  const g = gramsOf(food, qty, unit);
  if (g == null || !food.per100) return null;
  const k = g / 100;
  const [kcal, p, c, f] = food.per100;
  return { kcal: kcal * k, protein: p * k, carbs: c * k, fat: f * k };
}

/** The meal's macros: its foods, plus what the lines it couldn't read already gave. Null when that isn't known. */
export function mealMacros(meal: StudioMeal, lookup: FoodLookup): Macros | null {
  let sum = ZERO;
  let unknown = false;
  for (const it of meal.items) {
    if (!it.foodId) {
      unknown = true;
      continue;
    }
    const f = lookup(it.foodId);
    const m = f ? itemMacros(f, it.qty, it.unit) : null;
    if (!m) {
      unknown = true;
      continue;
    }
    sum = add(sum, m);
  }
  if (unknown) return meal.unreadBase ? add(sum, meal.unreadBase) : null;
  return sum;
}

export function dayMacros(day: StudioDay, lookup: FoodLookup): Macros | null {
  let sum = ZERO;
  for (const m of day.meals) {
    const x = m.dirty ? mealMacros(m, lookup) : (m.written ?? mealMacros(m, lookup));
    if (!x) return null;
    sum = add(sum, x);
  }
  return day.meals.length ? sum : null;
}

// ── Reading ────────────────────────────────────────────────────────────────

const PLAIN_UNIT: Record<string, StudioUnit> = { g: "g", gram: "g", grams: "g", kg: "g", ml: "ml", l: "ml", oz: "oz", tbsp: "tbsp", tsp: "tsp" };

/** The food a plan line's name reads as: a custom food by its name first, then the staples the plan checks know, then the rest of the list. */
export function matchFood(name: string, customs: StudioFood[] = []): StudioFood | null {
  const n = name.toLowerCase().replace(/\s+/g, " ").replace(/[()]/g, "").trim();
  if (!n) return null;
  const custom = customs.find((c) => c.lineName === n || n.startsWith(`${c.lineName} `) || c.name.toLowerCase() === n);
  if (custom) return custom;
  const dry = /\b(dry|uncooked|raw)\b/.test(n) && !/\bcooked\b/.test(n);
  const staple = stapleFor(n);
  if (staple) {
    if (staple.key === "ground beef" && !dry) {
      const lean = Number(n.match(/(\d{2})\s*(?:%|\/\s*\d{1,2})/)?.[1]) || (/extra[- ]?lean/.test(n) ? 93 : 0);
      const near = [95, 93, 90, 85].find((l) => lean >= l - 1);
      const beef = near && near !== 90 ? BUILTIN_FOODS.find((f) => f.id === `b:beef_${near}_cooked`) : null;
      if (beef) return beef;
    }
    // whole wheat bread is the cookbook's
    if (staple.key === "bread" && /whole\s*wheat|whole\s*grain/.test(n)) return BUILTIN_FOODS.find((f) => f.id === "b:bread_whole_wheat") ?? null;
    const form = dry && staple.dry ? "dry" : "per100";
    const key = Object.entries(BUILTIN_SOURCES).find(([, s]) => s.table === "staple" && s.key === staple.key && s.form === form)?.[0];
    return key ? (BUILTIN_FOODS.find((f) => f.id === `b:${key}`) ?? null) : null;
  }
  // the cookbook's foods: every word of their plan name in the line
  for (const f of BUILTIN_FOODS) {
    const src = BUILTIN_SOURCES[f.id.slice(2)];
    if (!src || src.table !== "cookbook") continue;
    const words = f.lineName.split(" ").filter((w) => w.length > 2);
    if (words.length && words.every((w) => n.includes(w))) return f;
  }
  return null;
}

/** An amount that can't be right: more than 2 kg of a food, 20 of something counted, and so on. Null when it's fine. */
export function amountProblem(qty: number | null, unit: StudioUnit): string | null {
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return "Enter an amount";
  const max: Record<StudioUnit, number> = { g: 2000, ml: 2000, oz: 70, each: 20, tbsp: 20, tsp: 30 };
  if (qty > max[unit]) return unit === "each" ? "That's a lot of them: check the amount" : "That's a lot: check the amount";
  return null;
}

/** One plan line read as an item: a food and its amount, else kept as written. */
export function readItemLine(line: string, customs: StudioFood[] = []): StudioItem {
  const text = line.trim();
  const a = splitAmount(text);
  if (a) {
    const food = matchFood(a.rest, customs);
    if (food) {
      let unit: StudioUnit | null = PLAIN_UNIT[a.unit] ?? null;
      let qty = a.qty;
      if (a.unit === "kg" || a.unit === "l") qty = a.qty * 1000;
      if (!unit && (food.each || food.perServing)) unit = "each";
      if (unit) return { id: newId("i"), foodId: food.id, qty: round2(qty), unit, label: a.rest };
    }
  }
  return { id: newId("i"), foodId: null, qty: null, unit: "g", text };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toMacros = (m: PlanMacros | null): Macros | null =>
  m && m.protein != null && m.carbs != null && m.fat != null ? { protein: m.protein, carbs: m.carbs, fat: m.fat, kcal: kcalOf({ protein: m.protein, carbs: m.carbs, fat: m.fat }) } : null;

/** A plan day's text read into meals. */
export function readDay(notes: string | null | undefined, customs: StudioFood[] = []): StudioDay {
  const lines = String(notes ?? "").replace(/\r\n/g, "\n").split("\n");
  const isHeader = (l: string) => MEAL_HEADER.test(l.replace(/^[-*•·]\s*/, "").trim());
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (isHeader(l)) starts.push(i);
  });
  if (!starts.length) return { lead: String(notes ?? ""), meals: [], tail: "" };
  // the tail: from the first Daily Total / flexible calories line after the last meal's header
  let tailAt = lines.length;
  for (let i = starts[starts.length - 1] + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (DAILY_TOTAL_HEADING.test(t) || FLEX_HEADING.test(t)) {
      tailAt = i;
      break;
    }
  }
  const lookupCustom = (id: string) => customs.find((c) => c.id === id) ?? null;
  const meals: StudioMeal[] = starts.map((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1] : tailAt;
    const block = lines.slice(s, end);
    while (block.length > 1 && !block[block.length - 1].trim()) block.pop();
    const raw = block.join("\n");
    const parsed = structureMealPlanDay(raw).meals[0];
    const items: StudioItem[] = (parsed?.foods ?? []).map((f) => readItemLine(`${f.amount} ${f.name}`, customs));
    const written = toMacros(parsed?.macros ?? null);
    const meal: StudioMeal = {
      id: newId("m"),
      title: parsed?.title ?? lines[s].trim(),
      timing: parsed?.timing ?? detectMealTiming(lines[s]),
      items,
      notes: parsed?.notes ?? [],
      written,
      unreadBase: null,
      raw,
      dirty: false,
    };
    // what the lines it couldn't read add: its written macros less the foods it could
    const look = (id: string) => BUILTIN_FOODS.find((f) => f.id === id) ?? lookupCustom(id);
    if (written && items.some((i) => !i.foodId)) {
      let known = ZERO;
      for (const it of items) {
        const f = it.foodId ? look(it.foodId) : null;
        const m = f ? itemMacros(f, it.qty, it.unit) : null;
        if (m) known = add(known, m);
      }
      meal.unreadBase = sub0(written, known);
    }
    return meal;
  });
  return {
    lead: lines.slice(0, starts[0]).join("\n").replace(/\s+$/, ""),
    meals,
    tail: lines.slice(tailAt).join("\n").trim(),
  };
}

// ── Writing ────────────────────────────────────────────────────────────────

const fmtQty = (q: number) => {
  const frac: Record<string, string> = { "0.5": "½", "0.25": "¼", "0.75": "¾" };
  const whole = Math.floor(q);
  const rest = round2(q - whole);
  if (rest && frac[String(rest)]) return whole ? `${whole}${frac[String(rest)]}` : frac[String(rest)];
  return String(round2(q));
};
const pluralWord = (word: string, qty: number) => (qty <= 1 || !word || /^(whole|medium|large|small)$/.test(word) || word.endsWith("s") ? word : `${word}s`);

/** How an item is written in the plan ("150 g cooked chicken breast", "2 slices bread", "1 medium banana"). */
export function itemLine(it: StudioItem, lookup: FoodLookup): string {
  if (!it.foodId) return it.text ?? "";
  const f = lookup(it.foodId);
  if (!f || it.qty == null) return it.text ?? "";
  const q = fmtQty(it.qty);
  if (it.unit === "each") {
    const word = pluralWord(f.each?.word ?? f.perServing?.label ?? "", it.qty);
    const name = it.qty > 1 && f.plural ? f.plural : f.lineName;
    return [q, word, name].filter(Boolean).join(" ");
  }
  // a weighed food keeps the name the plan gave it ("berries", "chicken breast"), as long as that name still reads as this food
  const label = it.label && matchFood(it.label)?.id === f.id ? it.label : null;
  return `${q} ${it.unit} ${label ?? f.lineName}`;
}

/** The meal's header ("Meal 2 (Pre-Workout)"). */
export function mealHeader(meal: Pick<StudioMeal, "title" | "timing">): string {
  const [base, ...rest] = meal.title.split(" · ");
  const name = rest.length ? `${base} · ${rest.join(" · ")}` : base;
  return meal.timing ? `${name} (${MEAL_TIMING_LABEL[meal.timing]})` : name;
}

export function mealText(meal: StudioMeal, lookup: FoodLookup): string {
  if (!meal.dirty && meal.raw != null) return meal.raw;
  const out = [mealHeader(meal), ...meal.items.map((i) => itemLine(i, lookup)).filter(Boolean), ...meal.notes];
  const m = mealMacros(meal, lookup);
  if (m) {
    const r = Math.round;
    out.push("", "Approximate macros:", `${r(m.protein)} g protein`, `${r(m.carbs)} g carbohydrates`, `${r(m.fat)} g fat`);
  }
  return out.join("\n");
}

/** The day back as plan text. Untouched meals come back exactly; when anything changed, the Daily Total is the meals' sum. */
export function writeDay(day: StudioDay, lookup: FoodLookup): string {
  const parts: string[] = [];
  if (day.lead.trim()) parts.push(day.lead.trim());
  for (const m of day.meals) parts.push(mealText(m, lookup));
  if (day.tail.trim()) parts.push(day.tail.trim());
  const text = parts.join("\n\n");
  if (!day.changed && !day.meals.some((m) => m.dirty)) return text;
  // the same rule every plan's Daily Total follows (plan-coverage `withHonestTotals`)
  const honest = withHonestTotals(`DAY MENU\n${text}`);
  return honest.replace(/^DAY MENU\n/, "");
}

// ── Edits (each returns a new day; the meal it touches is marked edited) ───

export function newMeal(day: StudioDay): StudioMeal {
  const n = day.meals.filter((m) => /^meal\s*\d+/i.test(m.title)).length + 1;
  return { id: newId("m"), title: `Meal ${n}`, timing: null, items: [], notes: [], written: null, unreadBase: null, raw: null, dirty: true };
}

export function updateMeal(day: StudioDay, mealId: string, fn: (m: StudioMeal) => StudioMeal): StudioDay {
  return { ...day, meals: day.meals.map((m) => (m.id === mealId ? { ...fn(m), dirty: true } : m)) };
}

export function duplicateMeal(day: StudioDay, mealId: string): StudioDay {
  const i = day.meals.findIndex((m) => m.id === mealId);
  if (i < 0) return day;
  const src = day.meals[i];
  const copy: StudioMeal = { ...src, id: newId("m"), items: src.items.map((it) => ({ ...it, id: newId("i") })), raw: null, dirty: true, title: renumber(src.title, day) };
  const meals = day.meals.slice();
  meals.splice(i + 1, 0, copy);
  return { ...day, meals };
}

/** "Meal 3" when copying "Meal 2" into a day that has 3 numbered meals already → the next number. */
function renumber(title: string, day: StudioDay): string {
  if (!/^meal\s*\d+/i.test(title)) return title;
  const n = day.meals.filter((m) => /^meal\s*\d+/i.test(m.title)).length + 1;
  return title.replace(/^meal\s*\d+/i, `Meal ${n}`);
}

export function removeMeal(day: StudioDay, mealId: string): StudioDay {
  if (!day.meals.some((m) => m.id === mealId)) return day;
  return { ...day, meals: day.meals.filter((m) => m.id !== mealId), changed: true };
}

export function moveMeal(day: StudioDay, mealId: string, dir: -1 | 1): StudioDay {
  const i = day.meals.findIndex((m) => m.id === mealId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= day.meals.length) return day;
  const meals = day.meals.slice();
  [meals[i], meals[j]] = [meals[j], meals[i]];
  return { ...day, meals, changed: true };
}

/** Copy a meal into another day's text (as a new meal at its end). */
export function copyMealInto(target: StudioDay, meal: StudioMeal): StudioDay {
  const copy: StudioMeal = { ...meal, id: newId("m"), items: meal.items.map((it) => ({ ...it, id: newId("i") })), raw: null, dirty: true, title: renumber(meal.title, target) };
  return { ...target, meals: [...target.meals, copy] };
}
