/**
 * Grocery list derivation (pure, read-only).
 *
 * Reads ONLY the free-text `notes` of the coach-assigned meal plan days
 * (`nutrition_target_days.notes`). It never writes, never mutates the plan,
 * and never touches macros, logs, recipes or prescriptions.
 *
 * The existing MealPlanBulkPaste parser is untouched — this is an isolated
 * ingredient reader with conservative rules.
 */

export type GroceryDayType = "training" | "non_training" | "high";

export type GroceryMeasure =
  | { kind: "mass"; grams: number }
  | { kind: "volume"; ml: number }
  | { kind: "count"; qty: number; unit: string | null };

export type ParsedIngredient = {
  /** Display name exactly as written (whitespace-normalized). */
  name: string;
  /** Merge identity — case/whitespace normalized, state preserved. */
  identity: string;
  measure: GroceryMeasure;
};

export type GroceryItem = {
  identity: string;
  name: string;
  measure: GroceryMeasure;
  quantityLabel: string;
  category: GroceryCategory;
};

export type GroceryCategory =
  | "Protein"
  | "Produce"
  | "Carbs / Grains"
  | "Fats / Pantry"
  | "Dairy / Refrigerated"
  | "Frozen"
  | "Supplements"
  | "Other";

export const GROCERY_CATEGORY_ORDER: GroceryCategory[] = [
  "Protein",
  "Produce",
  "Carbs / Grains",
  "Fats / Pantry",
  "Dairy / Refrigerated",
  "Frozen",
  "Supplements",
  "Other",
];

/* ------------------------------------------------------------------ */
/* Line filtering                                                      */
/* ------------------------------------------------------------------ */

const MENU_HEADER = /(menu|day)\s*$/i;
const MEAL_HEADER = /^\s*(meal\s*\d+|breakfast|lunch|dinner|snack\s*\d*|pre[- ]?workout|post[- ]?workout|intra[- ]?workout)\b\s*:?\s*$/i;
const TOTALS_LINE = /^\s*(daily\s+total|totals?|macros?|calories|kcal|protein|carbs?|carbohydrates?|fats?|fibre|fiber|water|sleep)\b\s*[:\-–]?/i;
/** Macro shorthand blocks such as "40P / 60C / 12F" or "P40 C60 F12". */
const MACRO_SHORTHAND = /^[\s\d./|,+-]*((\d+(\.\d+)?\s*[pcfg]\b|[pcf]\s*[:=]?\s*\d+)[\s./|,+-]*){2,}$/i;
const RULE_PROSE = /\b(weigh|weighed|weighing|cooked weight unless|all weights|note|notes|tip|reminder|drink|aim for|optional swap)\b/i;

const COUNT_UNITS = new Set([
  "scoop", "scoops", "egg", "eggs", "slice", "slices", "piece", "pieces",
  "serving", "servings", "can", "cans", "packet", "packets", "sachet",
  "sachets", "bar", "bars", "tbsp", "tsp", "cup", "cups", "clove", "cloves",
  "fillet", "fillets", "whole", "unit", "units", "handful", "handfuls",
  "square", "squares", "capsule", "capsules", "tablet", "tablets",
]);

const COUNT_UNIT_SINGULAR: Record<string, string> = {
  scoops: "scoop", eggs: "egg", slices: "slice", pieces: "piece",
  servings: "serving", cans: "can", packets: "packet", sachets: "sachet",
  bars: "bar", cups: "cup", cloves: "clove", fillets: "fillet",
  units: "unit", handfuls: "handful", squares: "square",
  capsules: "capsule", tablets: "tablet",
};

/** Strip trailing macro annotations like "(40P/5C/2F)" or "(320 cal)". */
function stripMacroAnnotations(s: string): string {
  return s
    .replace(/\(([^)]*)\)/g, (full, inner: string) => {
      const t = String(inner).trim();
      if (/^[\s\d./|,+-]*((\d+(\.\d+)?\s*[pcf]\b|[pcf]\s*[:=]?\s*\d+)[\s./|,+-]*){1,}$/i.test(t)) return "";
      if (/\b(kcal|cal|calories)\b/i.test(t) && /\d/.test(t)) return "";
      return full;
    })
    .replace(/[–-]\s*\d+\s*(kcal|cal)\b.*$/i, "")
    .trim();
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function normalizeIdentityName(name: string): string {
  return normalizeWhitespace(name)
    .toLowerCase()
    .replace(/[.,;:]+$/g, "")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ") ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a single line. Returns null when the line is not an ingredient. */
export function parseIngredientLine(rawLine: string): ParsedIngredient | null {
  let line = normalizeWhitespace(String(rawLine ?? ""));
  if (!line) return null;
  line = line.replace(/^[-*•·]\s*/, "").trim();
  if (!line) return null;

  if (MEAL_HEADER.test(line)) return null;
  if (TOTALS_LINE.test(line)) return null;
  if (MACRO_SHORTHAND.test(line)) return null;
  if (!/\d/.test(line)) return null;
  if (MENU_HEADER.test(line) && !/^\d/.test(line)) return null;
  if (RULE_PROSE.test(line)) return null;

  line = stripMacroAnnotations(line);
  if (!line) return null;

  const m = line.match(
    /^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s*(?:of\s+)?(.*)$/,
  );
  if (!m) return null;
  const qty = Number(String(m[1]).replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const unitRaw = (m[2] ?? "").toLowerCase();
  let rest = normalizeWhitespace(m[3] ?? "");

  let measure: GroceryMeasure | null = null;
  if (unitRaw === "g" || unitRaw === "gram" || unitRaw === "grams") {
    measure = { kind: "mass", grams: qty };
  } else if (unitRaw === "kg" || unitRaw === "kgs" || unitRaw === "kilogram" || unitRaw === "kilograms") {
    measure = { kind: "mass", grams: qty * 1000 };
  } else if (unitRaw === "ml" || unitRaw === "mls" || unitRaw === "millilitre" || unitRaw === "millilitres") {
    measure = { kind: "volume", ml: qty };
  } else if (unitRaw === "l" || unitRaw === "litre" || unitRaw === "litres" || unitRaw === "liter" || unitRaw === "liters") {
    measure = { kind: "volume", ml: qty * 1000 };
  } else if (unitRaw && COUNT_UNITS.has(unitRaw)) {
    if (!rest) {
      // "2 eggs" — the count word IS the food.
      rest = String(m[2]);
      measure = { kind: "count", qty, unit: null };
    } else {
      measure = { kind: "count", qty, unit: COUNT_UNIT_SINGULAR[unitRaw] ?? unitRaw };
    }
  } else if (unitRaw) {
    // Unknown trailing word — treat it as part of the food name (count item).
    rest = normalizeWhitespace(`${m[2]} ${rest}`);
    measure = { kind: "count", qty, unit: null };
  } else {
    measure = { kind: "count", qty, unit: null };
  }

  const name = normalizeWhitespace(rest);
  if (!name || !/[a-zA-Z]/.test(name)) return null;

  const identity =
    measure.kind === "mass"
      ? `mass|${normalizeIdentityName(name)}`
      : measure.kind === "volume"
        ? `volume|${normalizeIdentityName(name)}`
        : `count:${measure.unit ?? "-"}|${normalizeIdentityName(name)}`;

  return { name, identity, measure };
}

export function parseIngredientLines(notes: string | null | undefined): ParsedIngredient[] {
  if (!notes) return [];
  const out: ParsedIngredient[] = [];
  for (const line of String(notes).split(/\r?\n/)) {
    const parsed = parseIngredientLine(line);
    if (parsed) out.push(parsed);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Day-type mapping                                                    */
/* ------------------------------------------------------------------ */

export function planDayType(label: string | null | undefined): GroceryDayType | null {
  const l = String(label ?? "").toLowerCase();
  if (!l.trim()) return null;
  if (l.includes("high")) return "high";
  if (l.includes("non") && l.includes("train")) return "non_training";
  if (l.includes("rest") || l.includes("off day")) return "non_training";
  if (l.includes("train")) return "training";
  return null;
}

/* ------------------------------------------------------------------ */
/* Quantity formatting                                                 */
/* ------------------------------------------------------------------ */

function trimNum(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

export function formatMeasure(measure: GroceryMeasure): string {
  if (measure.kind === "mass") {
    return measure.grams >= 1000 ? `${trimNum(measure.grams / 1000)} kg` : `${trimNum(measure.grams)} g`;
  }
  if (measure.kind === "volume") {
    return measure.ml >= 1000 ? `${trimNum(measure.ml / 1000)} L` : `${trimNum(measure.ml)} ml`;
  }
  const qty = trimNum(measure.qty);
  if (!measure.unit) return qty;
  const plural = measure.qty === 1 ? measure.unit : `${measure.unit}s`;
  return `${qty} ${plural}`;
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_RULES: { category: GroceryCategory; match: RegExp }[] = [
  { category: "Supplements", match: /\b(whey|casein|protein powder|isolate|creatine|bcaa|eaa|multivitamin|vitamin|omega|fish oil|electrolyte|greens powder|collagen|pre[- ]?workout)\b/i },
  { category: "Frozen", match: /\b(frozen|ice cream|freezer)\b/i },
  { category: "Dairy / Refrigerated", match: /\b(milk|skim milk|yogh?urt|greek yogh?urt|cheese|cottage cheese|feta|halloumi|cream|butter milk|kefir|egg whites?|liquid eggs?)\b/i },
  { category: "Protein", match: /\b(chicken|beef|steak|mince|turkey|pork|bacon|ham|lamb|salmon|tuna|cod|tilapia|prawn|shrimp|fish|egg|eggs|tofu|tempeh|seitan|jerky|venison|bison|sausage)\b/i },
  { category: "Produce", match: /\b(apple|banana|berry|berries|blueberr|strawberr|raspberr|orange|grape|melon|mango|pineapple|pear|peach|kiwi|avocado|spinach|kale|lettuce|broccoli|cauliflower|carrot|cucumber|tomato|pepper|onion|garlic|zucchini|courgette|asparagus|mushroom|green beans?|peas|celery|cabbage|beet|squash|lemon|lime|salad|greens)\b/i },
  { category: "Carbs / Grains", match: /\b(rice|oat|oats|oatmeal|pasta|noodle|bread|bagel|tortilla|wrap|potato|potatoes|sweet potato|quinoa|couscous|cereal|granola|cracker|barley|buckwheat|flour|rice cake|corn)\b/i },
  { category: "Fats / Pantry", match: /\b(oil|olive oil|coconut oil|nut butter|peanut butter|almond|cashew|walnut|pecan|nuts|seed|seeds|chia|flax|tahini|hummus|mayo|dressing|honey|maple syrup|sauce|spice|salt|pepper corn|stock|broth|vinegar)\b/i },
];

export function categorizeIngredient(name: string): GroceryCategory {
  const n = normalizeIdentityName(name);
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(n)) return rule.category;
  }
  return "Other";
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export type GroceryPlanDay = { id?: string; day_label?: string | null; notes?: string | null };

export type BuildGroceryListInput = {
  planDays: GroceryPlanDay[];
  /** Number of resolved calendar dates for each day type in the selected week. */
  dayCounts: Record<GroceryDayType, number>;
};

export type GroceryListResult = {
  items: GroceryItem[];
  sections: { category: GroceryCategory; items: GroceryItem[] }[];
  /** Day types present in the week that had no matching plan day. */
  unmatchedDayTypes: GroceryDayType[];
  totalDaysCovered: number;
};

export function buildGroceryList({ planDays, dayCounts }: BuildGroceryListInput): GroceryListResult {
  const days = (planDays ?? []).filter((d) => String(d?.notes ?? "").trim());
  const totalWeekDays = dayCounts.training + dayCounts.non_training + dayCounts.high;

  const contributions: { day: GroceryPlanDay; multiplier: number }[] = [];
  const unmatched: GroceryDayType[] = [];

  if (days.length === 1) {
    // Single plan day → it is the plan for every resolved date this week.
    contributions.push({ day: days[0], multiplier: totalWeekDays });
  } else {
    const byType = new Map<GroceryDayType, GroceryPlanDay>();
    for (const d of days) {
      const t = planDayType(d.day_label);
      if (t && !byType.has(t)) byType.set(t, d);
    }
    (["training", "non_training", "high"] as GroceryDayType[]).forEach((t) => {
      const count = dayCounts[t] ?? 0;
      if (count <= 0) return;
      const day = byType.get(t);
      if (!day) {
        unmatched.push(t);
        return;
      }
      contributions.push({ day, multiplier: count });
    });
  }

  const merged = new Map<string, GroceryItem>();
  let covered = 0;
  for (const { day, multiplier } of contributions) {
    if (multiplier <= 0) continue;
    covered += multiplier;
    for (const ing of parseIngredientLines(day.notes)) {
      const existing = merged.get(ing.identity);
      if (!existing) {
        const measure: GroceryMeasure =
          ing.measure.kind === "mass"
            ? { kind: "mass", grams: ing.measure.grams * multiplier }
            : ing.measure.kind === "volume"
              ? { kind: "volume", ml: ing.measure.ml * multiplier }
              : { kind: "count", qty: ing.measure.qty * multiplier, unit: ing.measure.unit };
        merged.set(ing.identity, {
          identity: ing.identity,
          name: ing.name,
          measure,
          quantityLabel: formatMeasure(measure),
          category: categorizeIngredient(ing.name),
        });
        continue;
      }
      if (existing.measure.kind === "mass" && ing.measure.kind === "mass") {
        existing.measure = { kind: "mass", grams: existing.measure.grams + ing.measure.grams * multiplier };
      } else if (existing.measure.kind === "volume" && ing.measure.kind === "volume") {
        existing.measure = { kind: "volume", ml: existing.measure.ml + ing.measure.ml * multiplier };
      } else if (existing.measure.kind === "count" && ing.measure.kind === "count") {
        existing.measure = { kind: "count", qty: existing.measure.qty + ing.measure.qty * multiplier, unit: existing.measure.unit };
      }
      existing.quantityLabel = formatMeasure(existing.measure);
    }
  }

  const items = Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
  const sections = GROCERY_CATEGORY_ORDER.map((category) => ({
    category,
    items: items.filter((i) => i.category === category),
  })).filter((s) => s.items.length > 0);

  return { items, sections, unmatchedDayTypes: unmatched, totalDaysCovered: covered };
}

/* ------------------------------------------------------------------ */
/* Week summary                                                        */
/* ------------------------------------------------------------------ */

export function weekSummaryText(dayCounts: Record<GroceryDayType, number>): string {
  const parts: string[] = [];
  const push = (n: number, singular: string, plural: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
  };
  push(dayCounts.training, "Training Day", "Training Days");
  push(dayCounts.non_training, "Non-Training Day", "Non-Training Days");
  push(dayCounts.high, "High Day", "High Days");
  return parts.join(" · ");
}
