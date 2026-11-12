/**
 * How easy a meal plan is to shop for and prep: how many different foods it
 * uses across its day types (the grocery list size), and which weighed foods
 * change amount between meals or days (`prepDrift`). A good plan reuses the
 * same staples at the same prepped amounts every day; a long list or a food at
 * three different weights means more shopping, more weighing and more to get
 * wrong. Pure.
 */
import { splitFoodLine } from "@/lib/nutrition-targets/meal-plan-reader";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";

const MACRO = /^(protein|carbs?|carbohydrates?|fats?|fib(?:re|er)s?)$/i;

/** "Cooked extra lean chicken breast (95/5)" → "chicken breast". */
export function foodKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+\s*\/\s*\d+\b|\b\d+\s*%/g, " ")
    .replace(
      /\b(cooked|uncooked|raw|dry|dried|extra|lean|natural|plain|non-?fat|low-?fat|fat-?free|unsweetened|fresh|frozen|organic|large|medium|small|whole|of)\b/g,
      " ",
    )
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map(singular)
    .join(" ");
}

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(o|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** The foods on one day's meal text (amount lines only; macro lines and notes skipped). */
export function dayFoods(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text ?? "").split("\n")) {
    const { amount, name } = splitFoodLine(raw.replace(/^[-*•·]\s*/, ""));
    if (!amount || MACRO.test(name.trim())) continue;
    const k = foodKey(name);
    if (k) out.add(k);
  }
  return out;
}

export type PlanFoodStats = { total: number; everyDay: number; foods: string[]; days: number };

export function planFoodStats(days: Array<{ notes?: string | null }>): PlanFoodStats {
  const sets = days.map((d) => dayFoods(d.notes)).filter((s) => s.size > 0);
  const all = new Set<string>();
  for (const s of sets) for (const f of s) all.add(f);
  const everyDay = sets.length ? [...all].filter((f) => sets.every((s) => s.has(f))).length : 0;
  return { total: all.size, everyDay, foods: [...all].sort(), days: sets.length };
}

/** About right for a staple-based plan (2-3 proteins, 2-3 carbs, 1-2 fats, 1-2 veg, 1 fruit, + extras). */
export const LEAN_GROCERY_LIST = 14;

/* ------------------------------------------------------------------------ */
/* Meal prep: one container, one weighed amount per food (MEAL_PLAN_PROMPT rule 2c) */

/** Something the client would have to weigh out differently on prep day. */
export type PrepDrift = {
  /**
   * food: one weighed food at more than one amount ("cooked chicken breast");
   * container: the main meals' protein or carb grams differ although each food
   * is consistent ("main-meal carbs": rice 200 g here, pasta 150 g there);
   * mixed: containers that switch between carbs of different weight per gram
   * (rice in one, potatoes in another).
   */
  kind?: "food" | "container" | "mixed";
  /** The food as the plan first wrote it ("cooked chicken breast"), or "main-meal protein" / "main-meal carbs". */
  food: string;
  unit: "g" | "ml";
  /** Its prepped amount: the one used most (the smaller on a tie). */
  base: number;
  /** Every amount it's written at, smallest first. */
  amounts: number[];
  /** Where each odd amount sits ("High Day Meal 3: 230 g"). */
  odd: string[];
};

const WEIGHED = /^(\d+(?:[.,]\d+)?)\s*(g|ml)$/i;

/** A container's protein: lean meat, fish or a plant protein, weighed (eggs, yogurt and whey are fixed-meal foods). */
const CONTAINER_PROTEIN =
  /\b(chicken|beef|turkey|bison|steak|sirloin|pork|fish|cod|tilapia|halibut|haddock|pollock|basa|salmon|tuna|shrimp|tofu|tempeh|seitan)\b/;
/** A container's carb, by how much carb a cooked gram carries: these rotate at the same grams only within a group. */
const CARB_GROUPS: Array<{ name: string; re: RegExp }> = [
  { name: "rice / pasta", re: /\b(rice|pasta|noodle|spaghetti|macaroni|penne|couscous|quinoa)\b/ },
  { name: "potatoes", re: /\b(potato|yam)\b/ },
];
/** Rice foods that aren't a container's rice (breakfast cereal, counted snacks). */
const NOT_CONTAINER_CARB = /\b(cream rice|rice cake|rice krispie|rice milk|rice cracker)\b/;

function carbGroup(key: string): string | null {
  if (NOT_CONTAINER_CARB.test(key)) return null;
  return CARB_GROUPS.find((g) => g.re.test(key))?.name ?? null;
}

/** The amount used most (the smaller on a tie), and every place another one is used. */
function oneAmount(at: Array<{ n: number; where: string }>) {
  const counts = new Map<number, number>();
  for (const a of at) counts.set(a.n, (counts.get(a.n) ?? 0) + 1);
  const base = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return {
    base,
    amounts: [...counts.keys()].sort((a, b) => a - b),
    odd: at.filter((a) => Math.abs(a.n - base) > 1),
  };
}

/**
 * What a client would weigh out differently on prep day. A meal-prep plan
 * makes every main meal one container (a weighed protein + a weighed carb) at
 * the same grams on every menu, and every weighed food one amount in the whole
 * plan; day types add or take out whole containers, a container's carb or
 * counted units, never a doubled or re-weighed portion. Reported: a food at
 * more than one amount (`food`), main meals whose protein or carb grams differ
 * when each food alone is consistent (`container`), and containers that switch
 * between rice and potatoes (`mixed`). Counted foods (a bagel, 2 eggs) and the
 * free meal never count. Pure.
 */
export function prepDrift(
  days: Array<{ label?: string | null; notes?: string | null }>,
): PrepDrift[] {
  const seen = new Map<
    string,
    { food: string; key: string; unit: "g" | "ml"; at: Array<{ n: number; where: string }> }
  >();
  const containers = {
    protein: [] as Array<{ n: number; where: string }>,
    carbs: [] as Array<{ n: number; where: string }>,
    groups: new Map<string, { food: string; where: string[] }>(),
  };
  for (const d of days) {
    for (const meal of structureMealPlanDay(d.notes).meals) {
      if (/free meal/i.test(meal.title)) continue;
      const where = [d.label, meal.title.split(" · ")[0]].filter(Boolean).join(" ");
      let protein = 0;
      let carbs = 0;
      const groups: Array<{ name: string; food: string }> = [];
      for (const f of meal.foods) {
        const m = f.amount.match(WEIGHED);
        const k = m ? foodKey(f.name) : "";
        if (!m || !k) continue;
        const unit = m[2].toLowerCase() as "g" | "ml";
        const n = Number(m[1].replace(",", "."));
        const key = `${k}|${unit}`;
        const row = seen.get(key) ?? { food: f.name.trim(), key: k, unit, at: [] };
        row.at.push({ n, where });
        seen.set(key, row);
        if (unit !== "g") continue;
        if (CONTAINER_PROTEIN.test(k)) protein += n;
        const g = carbGroup(k);
        if (g) {
          carbs += n;
          groups.push({ name: g, food: f.name.trim() });
        }
      }
      // a container is a weighed protein with a weighed carb (one with its carb left out is fine)
      if (!protein || !carbs) continue;
      containers.protein.push({ n: protein, where });
      containers.carbs.push({ n: carbs, where });
      for (const g of groups) {
        const row = containers.groups.get(g.name) ?? { food: g.food, where: [] };
        row.where.push(where);
        containers.groups.set(g.name, row);
      }
    }
  }
  const out: PrepDrift[] = [];
  for (const row of seen.values()) {
    const one = oneAmount(row.at);
    if (!one.odd.length) continue;
    out.push({
      kind: "food",
      food: row.food,
      unit: row.unit,
      base: one.base,
      amounts: one.amounts,
      odd: one.odd.map((a) => `${a.where}: ${a.n} ${row.unit}`),
    });
  }
  // container grams that differ though each food is consistent (chicken 150 g here, beef 200 g there)
  const drifting = (re: (key: string) => boolean) => out.some((d) => re(foodKey(d.food)));
  const sides: Array<[string, Array<{ n: number; where: string }>, (k: string) => boolean]> = [
    ["main-meal protein", containers.protein, (k) => CONTAINER_PROTEIN.test(k)],
    ["main-meal carbs", containers.carbs, (k) => !!carbGroup(k)],
  ];
  for (const [food, at, isSide] of sides) {
    if (at.length < 2 || drifting(isSide)) continue;
    const one = oneAmount(at);
    if (!one.odd.length) continue;
    out.push({
      kind: "container",
      food,
      unit: "g",
      base: one.base,
      amounts: one.amounts,
      odd: one.odd.map((a) => `${a.where}: ${a.n} g`),
    });
  }
  if (containers.groups.size > 1) {
    const [major, ...minor] = [...containers.groups.values()].sort(
      (a, b) => b.where.length - a.where.length,
    );
    out.push({
      kind: "mixed",
      food: `containers switch between ${major.food} and ${minor.map((m) => m.food).join(" and ")}`,
      unit: "g",
      base: 0,
      amounts: [],
      odd: minor.flatMap((m) => m.where.map((w) => `${w}: ${m.food}`)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* Shelf first: foods a normal grocery store always has (MEAL_PLAN_PROMPT 2d) */

/**
 * Foods a client would have to hunt for: a specialty store, a particular
 * aisle in a big city, or online. The plan uses the most common food that
 * fits the client's diet instead (sweet potatoes for AIP, never cassava),
 * unless the client named the food themselves.
 */
export const HARD_TO_FIND_FOODS: Array<{
  re: RegExp;
  name: string;
  kind: "carb" | "protein" | "fat";
}> = [
  { re: /\b(cassava|yuca|yucca|manioc)\b/, name: "cassava", kind: "carb" },
  { re: /\b(taro|malanga|eddo)\b/, name: "taro", kind: "carb" },
  { re: /\bplantain\b/, name: "plantain", kind: "carb" },
  { re: /\bjicama\b/, name: "jicama", kind: "carb" },
  { re: /\bbreadfruit\b/, name: "breadfruit", kind: "carb" },
  { re: /\b(tiger ?nut)\b/, name: "tigernut", kind: "carb" },
  { re: /\barrowroot\b/, name: "arrowroot", kind: "carb" },
  {
    re: /\b(teff|amaranth|millet|sorghum|fonio|farro|freekeh|kamut)\b/,
    name: "a specialty grain",
    kind: "carb",
  },
  { re: /\b(ube|purple yam)\b/, name: "purple yam", kind: "carb" },
  {
    re: /\b(cassava|coconut|almond|plantain|tigernut|green banana) flour\b/,
    name: "a specialty flour",
    kind: "carb",
  },
  {
    re: /\b(bison|venison|elk|goat(?! cheese)|rabbit|ostrich|kangaroo)\b/,
    name: "game meat",
    kind: "protein",
  },
  {
    re: /\b(liver|(?<!artichoke )heart(?! palm)|kidney(?! bean)|organ meat)\b/,
    name: "organ meat",
    kind: "protein",
  },
  {
    re: /\b(tallow|duck fat|lard|palm shortening|coconut butter)\b/,
    name: "a specialty fat",
    kind: "fat",
  },
];

/** What to use instead, by kind: the staples every store has. */
export const SHELF_STAPLE: Record<"carb" | "protein" | "fat", string> = {
  carb: "white rice, potatoes or sweet potatoes (whichever their diet allows, in that order)",
  protein: "chicken breast, lean ground beef or ground turkey",
  fat: "olive oil or avocado oil",
};

export type HardToFind = {
  food: string;
  name: string;
  kind: "carb" | "protein" | "fat";
  where: string[];
};

/**
 * The hard-to-find foods in a plan's meals (the free meal and the swap lines
 * never count), each with where it sits, leaving out any food the client
 * named themselves in their answers ("I love plantain"); a diet's name
 * ("AIP") never counts as naming one. Pure.
 */
export function hardToFindFoods(
  days: Array<{ label?: string | null; notes?: string | null }>,
  answers: Array<{ value?: string | null }> = [],
): HardToFind[] {
  const said = answers.map((a) => String(a.value ?? "").toLowerCase()).join(" \n ");
  const found = new Map<string, HardToFind>();
  for (const d of days) {
    for (const meal of structureMealPlanDay(d.notes).meals) {
      if (/free meal/i.test(meal.title)) continue;
      for (const f of meal.foods) {
        const k = foodKey(f.name);
        const hit = HARD_TO_FIND_FOODS.find((h) => h.re.test(k));
        if (!hit) continue;
        const named = (k.match(hit.re) ?? [])[0];
        if (named && said.includes(named)) continue;
        const row = found.get(k) ?? {
          food: f.name.trim(),
          name: hit.name,
          kind: hit.kind,
          where: [],
        };
        row.where.push([d.label, meal.title.split(" · ")[0]].filter(Boolean).join(" "));
        found.set(k, row);
      }
    }
  }
  return [...found.values()];
}

/** "Cooked chicken breast 150 / 165 / 180 g" for the coach and the fix prompt. */
export function prepDriftLine(d: PrepDrift): string {
  if (d.kind === "mixed") return d.food;
  return `${d.food} ${d.amounts.join(" / ")} ${d.unit}`;
}

/** "NON-TRAINING-DAY MENU" → "Non Training Day". */
function menuLabel(header: string): string {
  return header
    .replace(/\s*MENU\s*$/i, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The menus of a whole AI meal plan (the paste format), each with its text, before FOOD-WEIGHING RULES. */
export function planMenus(
  text: string | null | undefined,
): Array<{ label: string; notes: string }> {
  const lines = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const stop = lines.findIndex((l) => /^FOOD[- ]?WEIGHING\b/i.test(l.trim()));
  const body = stop < 0 ? lines : lines.slice(0, stop);
  const out: Array<{ label: string; notes: string[] }> = [];
  for (const raw of body) {
    const t = raw.trim();
    if (/MENU\s*$/i.test(t) && t.length < 80 && !/^meal/i.test(t))
      out.push({ label: menuLabel(t), notes: [] });
    else out.at(-1)?.notes.push(raw);
  }
  return out.map((m) => ({ label: m.label, notes: m.notes.join("\n") }));
}
