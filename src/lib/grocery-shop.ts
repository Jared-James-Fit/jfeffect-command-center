/**
 * "What do I actually buy?" layer for the grocery list, tuned for Canadian
 * stores (Loblaws / No Frills / Sobeys / Metro / Walmart / Costco).
 *
 * Meal plans use COOKED weights for meat, rice, potatoes and vegetables, so
 * we convert to raw/dry buying weights, round up to real package sizes, and
 * group items in the order you walk a typical Canadian store. Pure functions.
 */
import type { GroceryItem, GroceryMeasure } from "@/lib/grocery-list";

export type StoreAisle =
  | "Produce"
  | "Bakery & Bread"
  | "Meat & Seafood"
  | "Dairy & Eggs"
  | "Frozen"
  | "Rice, Pasta & Grains"
  | "Breakfast & Cereal"
  | "Canned & Jarred"
  | "Nut Butters, Oils & Nuts"
  | "Spices, Sauces & Condiments"
  | "Snacks"
  | "Supplements"
  | "Other";

/** Typical walk path: perimeter first, then the centre aisles. */
export const STORE_AISLE_ORDER: StoreAisle[] = [
  "Produce",
  "Bakery & Bread",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Frozen",
  "Rice, Pasta & Grains",
  "Breakfast & Cereal",
  "Canned & Jarred",
  "Nut Butters, Oils & Nuts",
  "Spices, Sauces & Condiments",
  "Snacks",
  "Supplements",
  "Other",
];

export const STORE_AISLE_EMOJI: Record<StoreAisle, string> = {
  Produce: "🥦",
  "Bakery & Bread": "🍞",
  "Meat & Seafood": "🥩",
  "Dairy & Eggs": "🥚",
  Frozen: "🧊",
  "Rice, Pasta & Grains": "🍚",
  "Breakfast & Cereal": "🥣",
  "Canned & Jarred": "🥫",
  "Nut Butters, Oils & Nuts": "🥜",
  "Spices, Sauces & Condiments": "🧂",
  Snacks: "🍘",
  Supplements: "💊",
  Other: "🛒",
};

export type ShopInfo = {
  aisle: StoreAisle;
  /** Big, dummy-proof "grab this" line, e.g. "3 × 454 g (1 lb) packs". */
  buy: string;
  /** Supporting detail, e.g. "≈ 1.3 kg raw (2.9 lb) · 1 kg cooked in your plan". */
  detail: string | null;
  /** Where/how to find it, or a money-saving tip. */
  tip: string | null;
};

type Rule = {
  match: RegExp;
  aisle: StoreAisle;
  /** Multiply plan grams by this to get buying grams (cooked → raw / dry). */
  toRaw?: number;
  rawWord?: "raw" | "dry";
  /** Package size in grams (or ml for volume) and how to name it. */
  pack?: { size: number; name: string; plural?: string };
  /** Average grams per piece → buy by count. */
  each?: { grams: number; name: string; plural?: string };
  /** Show the lb equivalent (meat & produce are priced per lb in Canada). */
  lb?: boolean;
  tip?: string;
};

// Order matters: first match wins (specific before general).
const RULES: Rule[] = [
  // Supplements
  { match: /\b(whey|isolate|protein powder|casein)\b/, aisle: "Supplements", pack: { size: 907, name: "2 lb tub" }, tip: "Costco, Walmart or Popeyes have the best price per serving" },
  { match: /\b(creatine)\b/, aisle: "Supplements", pack: { size: 300, name: "300 g tub" } },
  { match: /\b(multivitamin|vitamin|omega|fish oil|electrolyte|greens powder|collagen|pre[- ]?workout|bcaa|eaa)\b/, aisle: "Supplements", tip: "Pharmacy / health aisle (Shoppers, Walmart, Costco)" },

  // Eggs
  { match: /\begg whites?\b|\bliquid eggs?\b/, aisle: "Dairy & Eggs", pack: { size: 500, name: "500 g carton" }, tip: "Naturegg / PC egg whites — next to the eggs" },
  { match: /\beggs?\b/, aisle: "Dairy & Eggs", each: { grams: 50, name: "egg", plural: "eggs" }, tip: "Costco 30-packs are the cheapest per egg" },

  // Ready-made soups / stews (before meat, so "chicken noodle soup" isn't raw chicken)
  { match: /\b(soup|stew|chili|chilli)\b/, aisle: "Canned & Jarred", pack: { size: 540, name: "540 ml can", plural: "540 ml cans" }, tip: "Canned soup aisle — low-sodium (Campbell's, PC, Habitant)" },

  // Meat & seafood (cooked → raw)
  { match: /\b(ground|lean|extra lean|mince|minced)\b.*\b(beef|turkey|chicken|pork|bison)\b|\b(beef|turkey|chicken|pork|bison)\b.*\b(ground|mince)\b/, aisle: "Meat & Seafood", toRaw: 1.3, rawWord: "raw", pack: { size: 454, name: "454 g (1 lb) pack", plural: "454 g (1 lb) packs" }, lb: true, tip: "Extra lean has the least fat — check the label for the %" },
  { match: /\b(chicken|turkey) (breast|thigh|tenderloin)s?\b|\bchicken\b/, aisle: "Meat & Seafood", toRaw: 1.33, rawWord: "raw", pack: { size: 1000, name: "family pack (~1 kg)", plural: "family packs (~1 kg each)" }, lb: true, tip: "Boneless, skinless. Family packs or Costco bags are cheapest — freeze what you won't use in 3 days" },
  { match: /\b(steak|sirloin|beef|bison|venison|roast)\b/, aisle: "Meat & Seafood", toRaw: 1.35, rawWord: "raw", lb: true, tip: "Sirloin and eye of round are the leanest, cheapest cuts" },
  { match: /\b(pork|tenderloin|ham)\b/, aisle: "Meat & Seafood", toRaw: 1.35, rawWord: "raw", lb: true },
  { match: /\bturkey\b/, aisle: "Meat & Seafood", toRaw: 1.33, rawWord: "raw", lb: true },
  { match: /\b(canned|can of)\b.*\btuna\b|\btuna\b.*\b(canned|can)\b|\btuna\b/, aisle: "Canned & Jarred", each: { grams: 120, name: "170 g can", plural: "170 g cans" }, tip: "Flaked light tuna in water (Clover Leaf / Rio Mare / PC)" },
  { match: /\b(salmon|cod|tilapia|haddock|basa|halibut|trout|fish|shrimp|prawn|scallop)s?\b/, aisle: "Meat & Seafood", toRaw: 1.2, rawWord: "raw", lb: true, tip: "Frozen fillet bags (frozen seafood aisle) are cheaper and just as good" },

  // Dairy
  { match: /\bgreek yogh?urt|\bskyr\b|\byogh?urt\b/, aisle: "Dairy & Eggs", pack: { size: 750, name: "750 g tub", plural: "750 g tubs" }, tip: "0% plain Greek (Oikos, Astro, Liberté, PC) — highest protein" },
  { match: /\bcottage cheese\b/, aisle: "Dairy & Eggs", pack: { size: 500, name: "500 g tub", plural: "500 g tubs" } },
  { match: /\b(milk|almond milk|oat milk|soy milk)\b/, aisle: "Dairy & Eggs", pack: { size: 2000, name: "2 L carton", plural: "2 L cartons" } },
  { match: /\b(cheese|feta|mozzarella|cheddar|parmesan)\b/, aisle: "Dairy & Eggs", pack: { size: 400, name: "400 g block", plural: "400 g blocks" } },
  { match: /^(?!.*\b(peanut|almond|nut|cashew|apple)\b).*\bbutter\b/, aisle: "Dairy & Eggs", pack: { size: 454, name: "454 g brick" } },

  // Grains (cooked → dry)
  { match: /\bcream of rice\b/, aisle: "Breakfast & Cereal", pack: { size: 800, name: "800 g box" } },
  { match: /\b(oat|oats|oatmeal)\b/, aisle: "Breakfast & Cereal", pack: { size: 1000, name: "1 kg bag", plural: "1 kg bags" }, tip: "Large-flake or quick oats — same macros, the bag is weighed dry" },
  { match: /\b(cereal|granola|muesli)\b/, aisle: "Breakfast & Cereal" },
  { match: /\b(rice)\b(?!\s*cakes?)/, aisle: "Rice, Pasta & Grains", toRaw: 0.36, rawWord: "dry", pack: { size: 2000, name: "2 kg bag", plural: "2 kg bags" }, tip: "Plan weights are cooked — 100 g dry rice ≈ 280 g cooked" },
  { match: /\b(pasta|spaghetti|penne|noodles?|macaroni)\b/, aisle: "Rice, Pasta & Grains", toRaw: 0.45, rawWord: "dry", pack: { size: 900, name: "900 g box", plural: "900 g boxes" } },
  { match: /\bquinoa\b/, aisle: "Rice, Pasta & Grains", toRaw: 0.37, rawWord: "dry", pack: { size: 900, name: "900 g bag", plural: "900 g bags" } },
  { match: /\bcouscous\b/, aisle: "Rice, Pasta & Grains", toRaw: 0.4, rawWord: "dry" },

  // Bakery
  { match: /\b(bagel)s?\b/, aisle: "Bakery & Bread", each: { grams: 100, name: "bagel", plural: "bagels" }, tip: "Sold in 6-packs" },
  { match: /\b(tortilla|wrap)s?\b/, aisle: "Bakery & Bread", each: { grams: 60, name: "wrap", plural: "wraps" }, tip: "Sold in packs of 10 — large flour or high-protein wraps" },
  { match: /\b(english muffin)s?\b/, aisle: "Bakery & Bread", each: { grams: 57, name: "muffin", plural: "muffins" }, tip: "Sold in 6-packs" },
  { match: /\bbread\b|\btoast\b/, aisle: "Bakery & Bread", pack: { size: 675, name: "675 g loaf", plural: "675 g loaves" }, tip: "1 slice ≈ 35–40 g — whole wheat or sourdough" },

  // Produce (bought by count where it makes sense)
  { match: /\bsweet potato(es)?\b/, aisle: "Produce", toRaw: 1.05, rawWord: "raw", each: { grams: 250, name: "medium sweet potato", plural: "medium sweet potatoes" }, lb: true },
  { match: /\bpotato(es)?\b/, aisle: "Produce", toRaw: 1.05, rawWord: "raw", each: { grams: 213, name: "medium potato", plural: "medium potatoes" }, lb: true, tip: "A 10 lb (4.5 kg) bag is the best deal" },
  { match: /\bbananas?\b/, aisle: "Produce", each: { grams: 118, name: "banana", plural: "bananas" } },
  { match: /\bapples?\b/, aisle: "Produce", each: { grams: 182, name: "apple", plural: "apples" } },
  { match: /\b(orange|clementine|mandarin)s?\b/, aisle: "Produce", each: { grams: 130, name: "orange", plural: "oranges" } },
  { match: /\bavocados?\b/, aisle: "Produce", each: { grams: 150, name: "avocado", plural: "avocados" } },
  { match: /\b(bell|red|green|yellow|orange|sweet) peppers?\b|^peppers?$/, aisle: "Produce", each: { grams: 150, name: "pepper", plural: "peppers" }, lb: true },
  { match: /\bonions?\b/, aisle: "Produce", each: { grams: 150, name: "onion", plural: "onions" } },
  { match: /\bcucumbers?\b/, aisle: "Produce", each: { grams: 300, name: "cucumber", plural: "cucumbers" } },
  { match: /\bzucchini\b/, aisle: "Produce", each: { grams: 200, name: "zucchini", plural: "zucchini" } },
  { match: /\bbroccoli\b/, aisle: "Produce", each: { grams: 450, name: "head of broccoli", plural: "heads of broccoli" }, tip: "Or frozen florets (750 g bag) — cheaper and pre-cut" },
  { match: /\b(spinach|kale|lettuce|salad|greens|arugula)\b/, aisle: "Produce", pack: { size: 312, name: "312 g clamshell", plural: "312 g clamshells" } },
  { match: /\b(berries|blueberr|strawberr|raspberr)/, aisle: "Produce", pack: { size: 510, name: "510 g clamshell", plural: "510 g clamshells" }, tip: "Frozen berries (600 g bag) are cheaper and last longer" },
  { match: /\b(mixed vegetables|stir[- ]?fry vegetables|frozen vegetables|frozen veg)\b/, aisle: "Frozen", pack: { size: 750, name: "750 g bag", plural: "750 g bags" } },
  { match: /\b(carrots?|green beans|asparagus|mushrooms?|cauliflower|tomato(es)?|celery|cabbage|vegetables|veggies|zucchini|squash)\b/, aisle: "Produce", toRaw: 1.0, lb: true },
  { match: /\b(grapes|melon|mango|pineapple|pear|peach|kiwi|fruit)\b/, aisle: "Produce", lb: true },
  { match: /\b(frozen)\b/, aisle: "Frozen" },

  // Pantry
  { match: /\b(peanut butter|almond butter|nut butter|pb)\b/, aisle: "Nut Butters, Oils & Nuts", pack: { size: 1000, name: "1 kg jar", plural: "1 kg jars" }, tip: "Natural peanut butter — stir the oil back in" },
  { match: /\b(olive oil|avocado oil|coconut oil|oil)\b/, aisle: "Nut Butters, Oils & Nuts", pack: { size: 920, name: "1 L bottle", plural: "1 L bottles" }, tip: "Weigh oil on the scale — 1 tbsp ≈ 14 g" },
  { match: /\b(almonds?|cashews?|walnuts?|pecans?|nuts|pistachios?|chia|flax|seeds?)\b/, aisle: "Nut Butters, Oils & Nuts", tip: "Bulk Barn lets you buy the exact amount" },
  { match: /\b(rice cakes?)\b/, aisle: "Snacks", each: { grams: 9, name: "rice cake", plural: "rice cakes" }, tip: "Sleeves of ~14 (Quaker / PC)" },
  { match: /\b(jerky|cracker|popcorn|protein bar)s?\b/, aisle: "Snacks" },
  { match: /\b(beans|chickpeas|lentils|canned)\b/, aisle: "Canned & Jarred", each: { grams: 400, name: "540 ml can", plural: "540 ml cans" } },
  { match: /\b(honey|maple syrup|jam)\b/, aisle: "Spices, Sauces & Condiments" },
  { match: /\b(sauce|salsa|ketchup|mustard|hot sauce|soy|seasoning|spice|salt|pepper|vinegar|dressing|mayo|stock|broth)\b/, aisle: "Spices, Sauces & Condiments" },
];

/** Grams per counted unit, so "2 slices bread" / "1 scoop whey" become packs. */
const UNIT_GRAMS: Record<string, number> = { scoop: 30, slice: 38 };

const fmtNum = (n: number) => (n >= 10 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
function fmtGrams(g: number) {
  return g >= 1000 ? `${fmtNum(g / 1000)} kg` : `${Math.round(g / 5) * 5} g`;
}
function fmtLb(g: number) {
  return `${fmtNum(g / 453.6)} lb`;
}
const plural = (n: number, one: string, many?: string) => {
  const word = n === 1 ? one : many ?? `${one}s`;
  // "2 × 454 g (1 lb) packs" reads better than "2 454 g packs".
  return /^\d/.test(word) ? `${n} × ${word}` : `${n} ${word}`;
};

export function shopInfo(item: Pick<GroceryItem, "name" | "measure">): ShopInfo {
  const name = item.name.toLowerCase();
  const rule = RULES.find((r) => r.match.test(name));
  const aisle = rule?.aisle ?? "Other";
  const m: GroceryMeasure = item.measure;

  const unitGrams = m.kind === "count" && m.unit ? UNIT_GRAMS[m.unit] : undefined;
  if (m.kind === "count" && unitGrams && (rule?.pack || rule?.each)) {
    return shopInfo({ name: item.name, measure: { kind: "mass", grams: m.qty * unitGrams } });
  }
  if (m.kind === "count") {
    const n = Math.ceil(m.qty);
    if (rule?.each?.name === "egg") {
      const dozens = Math.ceil(n / 12);
      return { aisle, buy: plural(dozens, "dozen", "dozen") + " eggs", detail: `${n} eggs in your plan`, tip: rule.tip ?? null };
    }
    return { aisle, buy: `${n}${m.unit ? ` ${m.unit}${n === 1 ? "" : "s"}` : ""}`, detail: null, tip: rule?.tip ?? null };
  }

  if (m.kind === "volume") {
    const packs = rule?.pack ? Math.ceil(m.ml / rule.pack.size) : 0;
    const vol = m.ml >= 1000 ? `${fmtNum(m.ml / 1000)} L` : `${Math.round(m.ml)} ml`;
    return {
      aisle,
      buy: packs ? plural(packs, rule!.pack!.name, rule!.pack!.plural) : vol,
      detail: packs ? `${vol} in your plan` : null,
      tip: rule?.tip ?? null,
    };
  }

  // Mass.
  const planned = m.grams;
  const raw = planned * (rule?.toRaw ?? 1);
  const converted = !!rule?.toRaw && Math.abs(rule.toRaw - 1) > 0.06;
  const amount = `${fmtGrams(raw)}${rule?.lb ? ` (${fmtLb(raw)})` : ""}`;
  const parts: string[] = [];
  if (converted) parts.push(`≈ ${amount} ${rule!.rawWord ?? "raw"}`, `${fmtGrams(planned)} cooked in your plan`);

  let buy: string;
  if (rule?.each) {
    const n = Math.max(1, Math.ceil(raw / rule.each.grams - 0.15));
    buy = plural(n, rule.each.name, rule.each.plural);
    if (!converted) parts.push(`${amount} in your plan`);
  } else if (rule?.pack) {
    const packs = Math.max(1, Math.ceil(raw / rule.pack.size - 0.08));
    buy = plural(packs, rule.pack.name, rule.pack.plural);
    if (!converted) parts.push(`${amount} in your plan`);
  } else {
    buy = converted ? `${amount} ${rule!.rawWord ?? "raw"}` : amount;
    if (converted) parts.splice(0, 1);
  }
  return { aisle, buy, detail: parts.length ? parts.join(" · ") : null, tip: rule?.tip ?? null };
}

export type ShopRow = GroceryItem & ShopInfo;

export function groupByAisle(items: GroceryItem[]): { aisle: StoreAisle; items: ShopRow[] }[] {
  const rows = items.map((i) => ({ ...i, ...shopInfo(i) }));
  return STORE_AISLE_ORDER.map((aisle) => ({ aisle, items: rows.filter((r) => r.aisle === aisle) })).filter((g) => g.items.length);
}

/** Plain-text list for Notes / texting a partner. */
export function groceryListText(groups: { aisle: StoreAisle; items: ShopRow[] }[], title: string): string {
  const out = [title, ""];
  for (const g of groups) {
    out.push(`${STORE_AISLE_EMOJI[g.aisle]} ${g.aisle.toUpperCase()}`);
    for (const r of g.items) out.push(`☐ ${r.name} — ${r.buy}`);
    out.push("");
  }
  return out.join("\n").trim();
}
